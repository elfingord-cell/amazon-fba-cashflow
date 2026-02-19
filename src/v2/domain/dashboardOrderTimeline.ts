import { buildPaymentRows } from "../../ui/orderEditorFactory.js";
import {
  computeFoSchedule,
  computePoAggregateMetrics,
  computeScheduleFromOrderDate,
  convertToEur,
} from "./orderUtils";

const DAY_MS = 24 * 60 * 60 * 1000;
const PO_CONFIG = {
  slug: "po",
  entityLabel: "PO",
  numberField: "poNo",
};

type OrderSource = "po" | "fo";
type PaymentStatus = "open" | "paid";
type PaymentDirection = "in" | "out";

export interface DashboardOrderTimelineItem {
  id: string;
  type: "range" | "box";
  startMs: number;
  endMs?: number;
  content: string;
  className: string;
  title?: string;
}

export interface DashboardOrderTimeline {
  source: OrderSource;
  sourceId: string | null;
  sourceNumber: string | null;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  visibleStartMs: number;
  visibleEndMs: number;
  items: DashboardOrderTimelineItem[];
}

interface TimelinePayment {
  id: string;
  label: string;
  dueDate: string | null;
  amountEur: number;
  status: PaymentStatus;
  direction: PaymentDirection;
}

interface BuildTimelineInput {
  source: OrderSource;
  sourceId: string | null;
  sourceNumber: string | null;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  payments: TimelinePayment[];
}

function normalizeRef(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeIsoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function toMs(value: string | null): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ms = toMs(value);
  if (ms == null) return value;
  return new Date(ms).toLocaleDateString("de-DE");
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function makePoSettings(state: Record<string, unknown>): Record<string, unknown> {
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const cny = (settings.cny && typeof settings.cny === "object")
    ? settings.cny as Record<string, unknown>
    : { start: "", end: "" };
  const cnyBlackoutByYear = (settings.cnyBlackoutByYear && typeof settings.cnyBlackoutByYear === "object")
    ? settings.cnyBlackoutByYear as Record<string, unknown>
    : {};
  return {
    fxRate: Number(settings.fxRate || 0),
    fxFeePct: Number(settings.fxFeePct || 0),
    dutyRatePct: Number(settings.dutyRatePct || 0),
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: Number(settings.eustRatePct || 0),
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(settings.vatRefundLagMonths || 0),
    freightLagDays: Number(settings.freightLagDays || 0),
    cny,
    cnyBlackoutByYear,
  };
}

function resolvePoRecord(input: {
  state: Record<string, unknown>;
  sourceId: string | null;
  sourceNumber: string | null;
}): Record<string, unknown> | null {
  const sourceId = normalizeRef(input.sourceId);
  const sourceNumber = normalizeRef(input.sourceNumber);
  const rows = Array.isArray(input.state.pos) ? input.state.pos as Record<string, unknown>[] : [];
  return rows.find((entry) => {
    const byId = normalizeRef(entry.id);
    const byNo = normalizeRef(entry.poNo);
    if (sourceId && sourceId === byId) return true;
    if (sourceNumber && sourceNumber === byNo) return true;
    if (sourceNumber && sourceNumber === byId) return true;
    return false;
  }) || null;
}

function resolveFoRecord(input: {
  state: Record<string, unknown>;
  sourceId: string | null;
  sourceNumber: string | null;
}): Record<string, unknown> | null {
  const sourceId = normalizeRef(input.sourceId);
  const sourceNumber = normalizeRef(input.sourceNumber);
  const rows = Array.isArray(input.state.fos) ? input.state.fos as Record<string, unknown>[] : [];
  return rows.find((entry) => {
    const byId = normalizeRef(entry.id);
    const byFoNo = normalizeRef(entry.foNo);
    const byFoNumber = normalizeRef(entry.foNumber);
    if (sourceId && sourceId === byId) return true;
    if (sourceNumber && (sourceNumber === byFoNo || sourceNumber === byFoNumber || sourceNumber === byId)) return true;
    return false;
  }) || null;
}

function resolvePaymentStatus(value: unknown, paidDate: unknown, paymentId: unknown): PaymentStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "paid") return "paid";
  if (String(paidDate || "").trim()) return "paid";
  if (String(paymentId || "").trim()) return "paid";
  return "open";
}

function resolvePaymentDirection(input: {
  amount: number;
  eventType?: unknown;
  category?: unknown;
  label?: unknown;
  explicitDirection?: unknown;
}): PaymentDirection {
  const explicit = String(input.explicitDirection || "").trim().toLowerCase();
  if (explicit === "in") return "in";
  if (explicit === "out") return "out";
  const text = `${String(input.eventType || "")} ${String(input.category || "")} ${String(input.label || "")}`.toLowerCase();
  if (text.includes("refund") || text.includes("erstatt")) return "in";
  return input.amount < 0 ? "in" : "out";
}

function buildPoPayments(state: Record<string, unknown>, poRecord: Record<string, unknown>): TimelinePayment[] {
  const paymentRecords = Array.isArray(state.payments) ? state.payments as Record<string, unknown>[] : [];
  let rows: Array<Record<string, unknown>> = [];
  try {
    const clone = typeof structuredClone === "function"
      ? structuredClone(poRecord)
      : JSON.parse(JSON.stringify(poRecord));
    rows = buildPaymentRows(clone, PO_CONFIG, makePoSettings(state), paymentRecords, { includeIncoming: true }) as Array<Record<string, unknown>>;
  } catch {
    rows = [];
  }

  return rows
    .map((row) => {
      const dueDate = normalizeIsoDate(row.dueDate);
      if (!dueDate) return null;
      const plannedEur = Math.abs(Number(row.plannedEur || 0));
      if (!(plannedEur > 0)) return null;
      const direction = resolvePaymentDirection({
        amount: Number(row.plannedEur || 0),
        eventType: row.eventType,
        label: row.label || row.typeLabel,
        explicitDirection: row.direction,
      });
      return {
        id: String(row.id || `po-pay-${dueDate}`),
        label: String(row.typeLabel || row.label || "Zahlung"),
        dueDate,
        amountEur: plannedEur,
        status: resolvePaymentStatus(row.status, row.paidDate, row.paymentId),
        direction,
      } as TimelinePayment;
    })
    .filter((entry): entry is TimelinePayment => Boolean(entry));
}

function buildFoPayments(foRecord: Record<string, unknown>): TimelinePayment[] {
  const fxRate = Number(foRecord.fxRate || 0);
  const payments = Array.isArray(foRecord.payments) ? foRecord.payments as Record<string, unknown>[] : [];
  return payments
    .map((row, index) => {
      const dueDate = normalizeIsoDate(row.dueDate);
      if (!dueDate) return null;
      const amountRaw = Number(row.amount || 0);
      if (!Number.isFinite(amountRaw) || amountRaw === 0) return null;
      const direction = resolvePaymentDirection({
        amount: amountRaw,
        category: row.category,
        label: row.label,
      });
      const amountEur = Math.abs(convertToEur(amountRaw, row.currency || "EUR", fxRate));
      if (!(amountEur > 0)) return null;
      return {
        id: String(row.id || `fo-pay-${index + 1}`),
        label: String(row.label || row.category || "Zahlung"),
        dueDate,
        amountEur,
        status: resolvePaymentStatus(row.status, row.paidDate, row.paymentId),
        direction,
      } as TimelinePayment;
    })
    .filter((entry): entry is TimelinePayment => Boolean(entry));
}

function buildTimeline(input: BuildTimelineInput): DashboardOrderTimeline | null {
  const items: DashboardOrderTimelineItem[] = [];
  const orderMs = toMs(input.orderDate);
  const etdMs = toMs(input.etdDate);
  const etaMs = toMs(input.etaDate);

  if (orderMs != null && etdMs != null && etdMs >= orderMs) {
    items.push({
      id: `${input.source}:${input.sourceId || input.sourceNumber || "order"}:production`,
      type: "range",
      content: "Produktion",
      startMs: orderMs,
      endMs: etdMs,
      className: "v2-dashboard-order-timeline-item v2-dashboard-order-timeline-item--production",
      title: `Produktion: ${formatDate(input.orderDate)} bis ${formatDate(input.etdDate)}`,
    });
  }

  if (etdMs != null && etaMs != null && etaMs >= etdMs) {
    items.push({
      id: `${input.source}:${input.sourceId || input.sourceNumber || "order"}:transit`,
      type: "range",
      content: "Transit",
      startMs: etdMs,
      endMs: etaMs,
      className: "v2-dashboard-order-timeline-item v2-dashboard-order-timeline-item--transit",
      title: `Transit: ${formatDate(input.etdDate)} bis ${formatDate(input.etaDate)}`,
    });
  }

  const milestoneRows: Array<{ key: "order" | "etd" | "eta"; label: string; date: string | null }> = [
    { key: "order", label: "Order", date: input.orderDate },
    { key: "etd", label: "ETD", date: input.etdDate },
    { key: "eta", label: "ETA", date: input.etaDate },
  ];

  milestoneRows.forEach((entry) => {
    const ms = toMs(entry.date);
    if (ms == null) return;
    items.push({
      id: `${input.source}:${input.sourceId || input.sourceNumber || "order"}:milestone:${entry.key}`,
      type: "box",
      content: entry.label,
      startMs: ms,
      className: `v2-dashboard-order-timeline-item v2-dashboard-order-timeline-item--milestone v2-dashboard-order-timeline-item--milestone-${entry.key}`,
      title: `${entry.label}: ${formatDate(entry.date)}`,
    });
  });

  input.payments.forEach((payment) => {
    const dueMs = toMs(payment.dueDate);
    if (dueMs == null) return;
    items.push({
      id: `${input.source}:${input.sourceId || input.sourceNumber || "order"}:payment:${payment.id}`,
      type: "box",
      content: payment.direction === "in" ? "+" : " ",
      startMs: dueMs,
      className: [
        "v2-dashboard-order-timeline-item",
        "v2-dashboard-order-timeline-item--payment",
        payment.status === "paid"
          ? "v2-dashboard-order-timeline-item--payment-paid"
          : "v2-dashboard-order-timeline-item--payment-open",
        payment.direction === "in"
          ? "v2-dashboard-order-timeline-item--payment-incoming"
          : "v2-dashboard-order-timeline-item--payment-outgoing",
      ].join(" "),
      title: [
        payment.label,
        `Fällig: ${formatDate(payment.dueDate)}`,
        `Betrag: ${formatCurrency(payment.amountEur)}`,
        `Status: ${payment.status === "paid" ? "Bezahlt" : "Offen"}`,
      ].join("\n"),
    });
  });

  const timelinePoints = items.flatMap((entry) => [entry.startMs, entry.endMs].filter((value): value is number => Number.isFinite(value)));
  if (!timelinePoints.length) return null;
  const minMs = Math.min(...timelinePoints);
  const maxMs = Math.max(...timelinePoints);
  const paddedStart = minMs - (14 * DAY_MS);
  const paddedEnd = maxMs + (14 * DAY_MS);
  const visibleEndMs = paddedEnd > paddedStart ? paddedEnd : paddedStart + (30 * DAY_MS);

  return {
    source: input.source,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    orderDate: input.orderDate,
    etdDate: input.etdDate,
    etaDate: input.etaDate,
    visibleStartMs: paddedStart,
    visibleEndMs,
    items,
  };
}

export function buildDashboardOrderTimeline(input: {
  state: Record<string, unknown>;
  source: OrderSource;
  sourceId?: string | null;
  sourceNumber?: string | null;
}): DashboardOrderTimeline | null {
  const source = input.source === "fo" ? "fo" : "po";
  const sourceId = input.sourceId ? String(input.sourceId) : null;
  const sourceNumber = input.sourceNumber ? String(input.sourceNumber) : null;

  if (source === "po") {
    const poRecord = resolvePoRecord({ state: input.state, sourceId, sourceNumber });
    if (!poRecord) return null;
    const settings = (input.state.settings && typeof input.state.settings === "object")
      ? input.state.settings as Record<string, unknown>
      : {};
    const aggregate = computePoAggregateMetrics({
      items: poRecord.items,
      orderDate: poRecord.orderDate,
      fxRate: poRecord.fxOverride ?? settings.fxRate,
      fallback: poRecord,
    });
    const schedule = computeScheduleFromOrderDate({
      orderDate: poRecord.orderDate,
      productionLeadTimeDays: aggregate.prodDays || poRecord.prodDays,
      logisticsLeadTimeDays: aggregate.transitDays || poRecord.transitDays,
      bufferDays: 0,
    });
    return buildTimeline({
      source: "po",
      sourceId: String(poRecord.id || sourceId || ""),
      sourceNumber: String(poRecord.poNo || sourceNumber || ""),
      orderDate: normalizeIsoDate(poRecord.orderDate || schedule.orderDate),
      etdDate: normalizeIsoDate(poRecord.etdManual || schedule.etdDate),
      etaDate: normalizeIsoDate(poRecord.etaManual || schedule.etaDate),
      payments: buildPoPayments(input.state, poRecord),
    });
  }

  const foRecord = resolveFoRecord({ state: input.state, sourceId, sourceNumber });
  if (!foRecord) return null;
  const foSchedule = computeFoSchedule({
    targetDeliveryDate: foRecord.targetDeliveryDate || foRecord.deliveryDate,
    productionLeadTimeDays: foRecord.productionLeadTimeDays,
    logisticsLeadTimeDays: foRecord.logisticsLeadTimeDays,
    bufferDays: foRecord.bufferDays,
  });
  return buildTimeline({
    source: "fo",
    sourceId: String(foRecord.id || sourceId || ""),
    sourceNumber: String(foRecord.foNo || foRecord.foNumber || sourceNumber || ""),
    orderDate: normalizeIsoDate(foRecord.orderDate || foSchedule.orderDate),
    etdDate: normalizeIsoDate(foRecord.etdDate || foSchedule.etdDate),
    etaDate: normalizeIsoDate(foRecord.etaDate || foSchedule.etaDate || foRecord.targetDeliveryDate || foRecord.deliveryDate),
    payments: buildFoPayments(foRecord),
  });
}

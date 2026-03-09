import { parseDeNumber } from "../../lib/dataHealth.js";
import { resolveMasterDataHierarchy, type HierarchySource } from "./masterDataHierarchy";
import {
  buildSkuProjection,
  computeFoRecommendation,
  foSuggestionUtils,
  getLatestClosingSnapshotMonth,
} from "../../domain/foSuggestion.js";

export const FO_STATUS_VALUES = ["DRAFT", "ACTIVE", "CONVERTED", "ARCHIVED"] as const;
const FO_LEGACY_STATUS_MAP: Record<string, FoStatus> = {
  PLANNED: "ACTIVE",
  CANCELLED: "ARCHIVED",
};
export const TRANSPORT_MODES = ["SEA", "RAIL", "AIR"] as const;
export const INCOTERMS = ["EXW", "DDP", "FCA"] as const;
export const PAYMENT_TRIGGERS = ["ORDER_DATE", "PRODUCTION_END", "ETD", "ETA", "DELIVERY"] as const;
export const PAYMENT_CURRENCIES = ["EUR", "USD", "CNY"] as const;
export const PO_ANCHORS = ["ORDER_DATE", "PROD_DONE", "ETD", "ETA"] as const;

export type FoStatus = (typeof FO_STATUS_VALUES)[number];
export type PaymentTrigger = (typeof PAYMENT_TRIGGERS)[number];

export function normalizeFoStatus(value: unknown, fallback: FoStatus = "DRAFT"): FoStatus {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return fallback;
  if ((FO_STATUS_VALUES as readonly string[]).includes(raw)) {
    return raw as FoStatus;
  }
  return FO_LEGACY_STATUS_MAP[raw] || fallback;
}

export function isFoPlanningStatus(value: unknown): boolean {
  const normalized = normalizeFoStatus(value);
  return normalized === "DRAFT" || normalized === "ACTIVE";
}

export function isFoConvertibleStatus(value: unknown): boolean {
  return isFoPlanningStatus(value);
}

export interface SupplierPaymentTermDraft {
  id?: string;
  label: string;
  percent: number;
  triggerEvent: PaymentTrigger;
  offsetDays: number;
  offsetMonths?: number;
}

export interface FoSchedule {
  orderDate: string | null;
  productionEndDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  deliveryDate: string | null;
  logisticsLeadTimeDays: number;
}

export interface FoPaymentRow extends SupplierPaymentTermDraft {
  amount: number;
  currency: string;
  dueDate: string | null;
  category: "supplier" | "freight" | "duty" | "eust" | "eust_refund";
  isOverridden?: boolean;
  dueDateManuallySet?: boolean;
  status?: "open" | "paid" | string;
  paidDate?: string | null;
  paymentId?: string | null;
  paidEurActual?: number | null;
  paidUsdActual?: number | null;
  paidBy?: string | null;
  method?: string | null;
  note?: string | null;
  invoiceDriveUrl?: string;
  invoiceFolderDriveUrl?: string;
}

function mergeExistingPaymentState(
  generated: FoPaymentRow[],
  existingPayments: unknown,
): FoPaymentRow[] {
  const existingList = Array.isArray(existingPayments)
    ? (existingPayments as Record<string, unknown>[])
    : [];
  if (!existingList.length) return generated;
  const byId = new Map(existingList.map((entry) => [String(entry?.id || ""), entry]));
  return generated.map((row) => {
    const existing = byId.get(String(row.id || ""));
    if (!existing) return row;
    return {
      ...row,
      dueDate: existing.dueDateManuallySet ? String(existing.dueDate || row.dueDate || "") : row.dueDate,
      dueDateManuallySet: existing.dueDateManuallySet === true ? true : row.dueDateManuallySet,
      isOverridden: existing.isOverridden === true ? true : row.isOverridden,
    } as FoPaymentRow;
  });
}

export interface FoCostValues {
  supplierCost: number;
  supplierCostEur: number;
  freightAmount: number;
  freightEur: number;
  dutyAmountEur: number;
  eustAmountEur: number;
  landedCostEur: number;
}

interface FoAutoPaymentTimingDefaults {
  freight: { triggerEvent: PaymentTrigger; offsetDays: number };
  duty: { triggerEvent: PaymentTrigger; offsetDays: number };
  eust: { triggerEvent: PaymentTrigger; offsetDays: number };
  eustRefund: { triggerEvent: PaymentTrigger; offsetDays: number };
}

interface EntityWithDates {
  arrivalDateDe?: unknown;
  arrivalDate?: unknown;
  etaDate?: unknown;
  etaManual?: unknown;
  eta?: unknown;
  orderDate?: unknown;
  prodDays?: unknown;
  productionLeadTimeDays?: unknown;
  transitDays?: unknown;
  logisticsLeadTimeDays?: unknown;
  items?: unknown;
  sku?: unknown;
  units?: unknown;
}

export interface FoRecommendationContext {
  baselineMonth: string | null;
  plannedSalesBySku: Record<string, Record<string, number>>;
  closingStockBySku: Record<string, Record<string, number>>;
  inboundBySku: Record<string, Record<string, number>>;
  inboundWithoutEtaCount: number;
}

export interface PoItemDraft {
  id: string;
  sku: string;
  units: number;
  unitCostUsd: number;
  unitExtraUsd: number;
  extraFlatUsd: number;
  prodDays: number;
  transitDays: number;
  freightEur: number;
  sourceFoId?: string | null;
}

export interface PoMilestoneDraft {
  id: string;
  label: string;
  percent: number;
  anchor: string;
  lagDays: number;
}

export interface PoAggregateMetrics {
  items: PoItemDraft[];
  goodsUsd: number;
  goodsEur: number;
  freightEur: number;
  units: number;
  prodDays: number;
  transitDays: number;
  firstSku: string;
  minEtaDate: string | null;
  maxEtaDate: string | null;
  schedule: FoSchedule;
}

export type FoPaymentTermsSource = "order_override" | "supplier" | "default";

export interface MultiFoPoPreflightIssue {
  code: string;
  message: string;
  foIds: string[];
}

export interface MultiFoPoPreflightLine {
  foId: string;
  sku: string;
  alias: string;
  sourceFoNumber: string;
  supplierId: string;
  supplierName: string;
  units: number;
  unitPrice: number;
  currency: string | null;
  currencySource: HierarchySource;
  incoterm: string | null;
  incotermSource: HierarchySource;
  fxRate: number | null;
  fxRateSource: HierarchySource;
  paymentTerms: SupplierPaymentTermDraft[];
  paymentTermsSource: FoPaymentTermsSource;
  paymentTermsSummary: string;
  productionLeadTimeDays: number;
  logisticsLeadTimeDays: number;
  bufferDays: number;
  orderDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  targetDeliveryDate: string | null;
  previewOrderDate: string | null;
  previewEtdDate: string | null;
  previewEtaDate: string | null;
  dutyRatePct: number | null;
  eustRatePct: number | null;
}

export interface MultiFoPoPreflightResult {
  compatible: boolean;
  blockers: MultiFoPoPreflightIssue[];
  warnings: MultiFoPoPreflightIssue[];
  header: {
    supplierId: string | null;
    supplierName: string;
    lineCount: number;
    totalUnits: number;
    orderDate: string | null;
    etdDate: string | null;
    etaDate: string | null;
    currency: string | null;
    incoterm: string | null;
    paymentTermsSummary: string;
    earliestRequiredOrderDate: string | null;
    earliestTargetDeliveryDate: string | null;
    latestTargetDeliveryDate: string | null;
    timingIsConservative: boolean;
  };
  lines: MultiFoPoPreflightLine[];
}

export interface MultiFoPoConversionResult {
  po: Record<string, unknown>;
  updatedFos: Record<string, unknown>[];
  preflight: MultiFoPoPreflightResult;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return fallback;
  return Number(parsed);
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  const numeric = Number(parsed);
  if (numeric <= 0) return null;
  return numeric;
}

function asPositive(value: unknown, fallback = 0): number {
  return Math.max(0, asNumber(value, fallback));
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function asNullableNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Number(parsed);
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoDate(value: Date | null): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value.getTime());
  next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
  return next;
}

function compareIsoDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function normalizeFoNumberToken(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, "");
  return compact.startsWith("FO") ? compact.slice(2) : compact;
}

function resolveFoDisplayNumber(fo: Record<string, unknown>): string {
  const foNo = normalizeFoNumberToken(fo.foNo);
  if (foNo) return foNo;
  const foNumber = normalizeFoNumberToken(fo.foNumber);
  if (foNumber) return foNumber;
  return String(fo.id || "").slice(-6).toUpperCase();
}

function resolveFoTargetDeliveryDate(fo: Record<string, unknown>): string | null {
  return (
    asNullableString(fo.targetDeliveryDate)
    || asNullableString(fo.deliveryDate)
    || asNullableString(fo.etaDate)
  );
}

function normalizeComparableNumber(value: unknown, digits = 4): string | null {
  const parsed = asNullableNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Number(parsed).toFixed(digits);
}

function normalizePaymentTermsSignature(terms: SupplierPaymentTermDraft[]): string {
  return (terms || []).map((term) => [
    String(term.label || "").trim().toLowerCase(),
    normalizeComparableNumber(term.percent, 4) || "0.0000",
    normaliseTrigger(term.triggerEvent),
    String(asNumber(term.offsetDays, 0)),
    String(asNumber(term.offsetMonths, 0)),
  ].join(":")).join("|");
}

function describePaymentTrigger(trigger: PaymentTrigger): string {
  if (trigger === "ORDER_DATE") return "Order";
  if (trigger === "PRODUCTION_END") return "Prod. Ende";
  if (trigger === "ETD") return "ETD";
  if (trigger === "ETA") return "ETA";
  return "Lieferung";
}

export function summarizeSupplierTerms(terms: SupplierPaymentTermDraft[]): string {
  if (!Array.isArray(terms) || terms.length === 0) return "—";
  return terms.map((term) => {
    const percent = Math.round(asPositive(term.percent, 0) * 100) / 100;
    const trigger = describePaymentTrigger(normaliseTrigger(term.triggerEvent));
    const offsetDays = asNumber(term.offsetDays, 0);
    const offsetMonths = asNumber(term.offsetMonths, 0);
    const offsets: string[] = [];
    if (offsetMonths) offsets.push(`${offsetMonths}M`);
    if (offsetDays) offsets.push(`${offsetDays >= 0 ? "+" : ""}${offsetDays}d`);
    const suffix = offsets.length ? ` (${offsets.join(" / ")})` : "";
    return `${String(term.label || "Milestone").trim() || "Milestone"} ${percent}% · ${trigger}${suffix}`;
  }).join(" | ");
}

function resolveFoPaymentTermsSource(
  fo: Record<string, unknown>,
  supplierRow?: Record<string, unknown> | null,
): FoPaymentTermsSource {
  const foTerms = Array.isArray(fo.payments)
    ? (fo.payments as Record<string, unknown>[]).filter((entry) => String(entry?.category || "supplier") === "supplier")
    : [];
  if (foTerms.length > 0) return "order_override";
  const supplierTerms = Array.isArray(supplierRow?.paymentTermsDefault)
    ? supplierRow?.paymentTermsDefault as Record<string, unknown>[]
    : [];
  if (supplierTerms.length > 0) return "supplier";
  return "default";
}

function resolveFoScheduleFromRecord(fo: Record<string, unknown>, orderDateOverride?: string | null): FoSchedule {
  const deliveryDate = resolveFoTargetDeliveryDate(fo);
  const orderDate = parseIsoDate(orderDateOverride || fo.orderDate)
    ? String(orderDateOverride || fo.orderDate)
    : null;
  if (orderDate) {
    return computeScheduleFromOrderDate({
      orderDate,
      productionLeadTimeDays: fo.productionLeadTimeDays,
      logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
      bufferDays: fo.bufferDays,
      deliveryDate,
    });
  }
  return computeFoSchedule({
    targetDeliveryDate: deliveryDate,
    productionLeadTimeDays: fo.productionLeadTimeDays,
    logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
    bufferDays: fo.bufferDays,
  });
}

function resolveFoRequiredOrderDate(fo: Record<string, unknown>): string | null {
  return resolveFoScheduleFromRecord(fo).orderDate;
}

function mapPaymentAnchor(trigger: PaymentTrigger): string {
  if (trigger === "PRODUCTION_END") return "PROD_DONE";
  if (trigger === "DELIVERY") return "ETA";
  return trigger;
}

function monthKey(date: Date): string {
  return foSuggestionUtils.monthKey(date);
}

function normaliseTrigger(value: unknown): PaymentTrigger {
  const candidate = String(value || "").trim().toUpperCase();
  if ((PAYMENT_TRIGGERS as readonly string[]).includes(candidate)) {
    return candidate as PaymentTrigger;
  }
  return "ORDER_DATE";
}

function normaliseCurrency(value: unknown, fallback = "EUR"): string {
  const candidate = String(value || fallback).trim().toUpperCase();
  if ((PAYMENT_CURRENCIES as readonly string[]).includes(candidate)) return candidate;
  return fallback;
}

function defaultTerms(): SupplierPaymentTermDraft[] {
  return [
    {
      label: "Deposit",
      percent: 30,
      triggerEvent: "ORDER_DATE",
      offsetDays: 0,
      offsetMonths: 0,
    },
    {
      label: "Balance",
      percent: 70,
      triggerEvent: "ETD",
      offsetDays: 0,
      offsetMonths: 0,
    },
  ];
}

function asRoundedNumber(value: unknown, fallback = 0): number {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return fallback;
  return Math.round(Number(parsed));
}

function resolveFoAutoPaymentTimingDefaults(input: unknown): FoAutoPaymentTimingDefaults {
  const defaults: FoAutoPaymentTimingDefaults = {
    freight: { triggerEvent: "ETD", offsetDays: 0 },
    duty: { triggerEvent: "ETA", offsetDays: 0 },
    eust: { triggerEvent: "ETA", offsetDays: 0 },
    eustRefund: { triggerEvent: "ETA", offsetDays: 0 },
  };
  const root = (input && typeof input === "object")
    ? input as Record<string, unknown>
    : {};
  const fo = (root.fo && typeof root.fo === "object")
    ? root.fo as Record<string, unknown>
    : {};
  const getTiming = (key: "freight" | "duty" | "eust" | "eustRefund", fallback: { triggerEvent: PaymentTrigger; offsetDays: number }) => {
    const row = (fo[key] && typeof fo[key] === "object")
      ? fo[key] as Record<string, unknown>
      : {};
    return {
      triggerEvent: normaliseTrigger(row.triggerEvent ?? fallback.triggerEvent),
      offsetDays: asRoundedNumber(row.offsetDays, fallback.offsetDays),
    };
  };
  return {
    freight: getTiming("freight", defaults.freight),
    duty: getTiming("duty", defaults.duty),
    eust: getTiming("eust", defaults.eust),
    eustRefund: getTiming("eustRefund", defaults.eustRefund),
  };
}

function buildScheduleDates(schedule: FoSchedule): Record<PaymentTrigger, Date | null> {
  const dates: Record<PaymentTrigger, Date | null> = {
    ORDER_DATE: parseIsoDate(schedule.orderDate),
    PRODUCTION_END: parseIsoDate(schedule.productionEndDate),
    ETD: parseIsoDate(schedule.etdDate),
    ETA: parseIsoDate(schedule.etaDate),
    DELIVERY: parseIsoDate(schedule.deliveryDate),
  };
  if (!dates.ETD && dates.ETA && Number.isFinite(Number(schedule.logisticsLeadTimeDays))) {
    dates.ETD = addDays(dates.ETA, -Number(schedule.logisticsLeadTimeDays || 0));
  }
  return dates;
}

function resolveDueDate(
  trigger: PaymentTrigger,
  offsetDays: number,
  offsetMonths: number,
  scheduleDates: Record<PaymentTrigger, Date | null>,
): string | null {
  const base = scheduleDates[trigger] || null;
  if (!base) return null;
  let due = addDays(base, Number(offsetDays || 0));
  if (offsetMonths) {
    due = addMonths(due, Number(offsetMonths || 0));
  }
  return toIsoDate(due);
}

export function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function resolveFoYearCode(value: unknown): string {
  const fallback = new Date();
  const parsed = value instanceof Date
    ? value
    : (typeof value === "string" || typeof value === "number")
      ? new Date(value)
      : null;
  if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
    return String(parsed.getFullYear()).slice(-2);
  }
  return String(fallback.getFullYear()).slice(-2);
}

function parseFoSequence(value: unknown, yearCode: string): number | null {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  const compact = raw.replace(/[\s_-]+/g, "");
  const digits = compact.startsWith("FO") ? compact.slice(2) : compact;
  if (!/^\d+$/.test(digits)) return null;
  if (!digits.startsWith(yearCode)) return null;
  const suffix = digits.slice(yearCode.length);
  if (!suffix) return null;
  const sequence = Number(suffix);
  if (!Number.isFinite(sequence) || sequence <= 0) return null;
  return sequence;
}

export function suggestNextFoNumber(
  foRows: Array<Record<string, unknown>>,
  referenceDate?: unknown,
): { foNo: string; foNumber: string } {
  const yearCode = resolveFoYearCode(referenceDate);
  let bestSequence = 0;
  (foRows || []).forEach((entry) => {
    const row = entry || {};
    [row.foNo, row.foNumber, row.id].forEach((candidate) => {
      const sequence = parseFoSequence(candidate, yearCode);
      if (sequence != null && sequence > bestSequence) {
        bestSequence = sequence;
      }
    });
  });
  const nextSuffix = String(bestSequence + 1).padStart(3, "0");
  const foNo = `${yearCode}${nextSuffix}`;
  return {
    foNo,
    foNumber: `FO${foNo}`,
  };
}

export function convertToEur(amount: unknown, currency: unknown, fxRate: unknown): number {
  const value = asNumber(amount, 0);
  const curr = String(currency || "EUR").toUpperCase();
  if (curr === "EUR") return value;
  const fx = asPositive(fxRate, 0);
  if (!fx) return value;
  return value / fx;
}

export function computeFoSchedule(input: {
  targetDeliveryDate: unknown;
  productionLeadTimeDays: unknown;
  logisticsLeadTimeDays: unknown;
  bufferDays: unknown;
}): FoSchedule {
  const target = parseIsoDate(input.targetDeliveryDate);
  const productionLeadTimeDays = asPositive(input.productionLeadTimeDays, 0);
  const logisticsLeadTimeDays = asPositive(input.logisticsLeadTimeDays, 0);
  const bufferDays = asPositive(input.bufferDays, 0);
  if (!target || productionLeadTimeDays <= 0) {
    return {
      orderDate: null,
      productionEndDate: null,
      etdDate: null,
      etaDate: null,
      deliveryDate: target ? toIsoDate(target) : null,
      logisticsLeadTimeDays,
    };
  }

  const orderDate = addDays(target, -(productionLeadTimeDays + logisticsLeadTimeDays + bufferDays));
  const productionEndDate = addDays(orderDate, productionLeadTimeDays);
  const etdDate = productionEndDate;
  const etaDate = addDays(etdDate, logisticsLeadTimeDays);
  return {
    orderDate: toIsoDate(orderDate),
    productionEndDate: toIsoDate(productionEndDate),
    etdDate: toIsoDate(etdDate),
    etaDate: toIsoDate(etaDate),
    deliveryDate: toIsoDate(target),
    logisticsLeadTimeDays,
  };
}

export function computeScheduleFromOrderDate(input: {
  orderDate: unknown;
  productionLeadTimeDays: unknown;
  logisticsLeadTimeDays: unknown;
  bufferDays: unknown;
  deliveryDate?: unknown;
}): FoSchedule {
  const order = parseIsoDate(input.orderDate);
  const productionLeadTimeDays = asPositive(input.productionLeadTimeDays, 0);
  const logisticsLeadTimeDays = asPositive(input.logisticsLeadTimeDays, 0);
  const bufferDays = asPositive(input.bufferDays, 0);
  if (!order) {
    return {
      orderDate: null,
      productionEndDate: null,
      etdDate: null,
      etaDate: null,
      deliveryDate: input.deliveryDate ? String(input.deliveryDate) : null,
      logisticsLeadTimeDays,
    };
  }

  const productionEndDate = addDays(order, productionLeadTimeDays + bufferDays);
  const etdDate = productionEndDate;
  const etaDate = addDays(etdDate, logisticsLeadTimeDays);
  return {
    orderDate: toIsoDate(order),
    productionEndDate: toIsoDate(productionEndDate),
    etdDate: toIsoDate(etdDate),
    etaDate: toIsoDate(etaDate),
    deliveryDate: input.deliveryDate ? String(input.deliveryDate) : null,
    logisticsLeadTimeDays,
  };
}

function normalizePoItemEntry(input: unknown): PoItemDraft | null {
  const row = (input || {}) as Record<string, unknown>;
  const sku = String(row.sku || "").trim();
  if (!sku) return null;
  const units = Math.max(0, Math.round(asNumber(row.units, 0)));
  const unitCostUsd = asPositive(row.unitCostUsd, 0);
  const unitExtraUsd = asPositive(row.unitExtraUsd, 0);
  const extraFlatUsd = asPositive(row.extraFlatUsd, 0);
  const prodDays = Math.max(0, Math.round(asPositiveNumber(row.prodDays) ?? asPositive(row.productionLeadTimeDays, 0)));
  const transitDays = Math.max(0, Math.round(asPositiveNumber(row.transitDays) ?? asPositive(row.logisticsLeadTimeDays, 0)));
  const freightEur = asPositive(row.freightEur, 0);
  return {
    id: String(row.id || randomId("poi")),
    sku,
    units,
    unitCostUsd,
    unitExtraUsd,
    extraFlatUsd,
    prodDays,
    transitDays,
    freightEur,
    sourceFoId: asNullableString(row.sourceFoId),
  };
}

export function normalizePoItems(
  items: unknown,
  fallback?: Record<string, unknown> | null,
): PoItemDraft[] {
  const parsedItems = Array.isArray(items) ? items.map(normalizePoItemEntry).filter(Boolean) as PoItemDraft[] : [];
  if (parsedItems.length) return parsedItems;
  const sku = String(fallback?.sku || "").trim();
  if (!sku) return [];
  const fallbackItem = normalizePoItemEntry({
    id: String(fallback?.id || randomId("poi")),
    sku,
    units: fallback?.units,
    unitCostUsd: fallback?.unitCostUsd,
    unitExtraUsd: fallback?.unitExtraUsd,
    extraFlatUsd: fallback?.extraFlatUsd,
    prodDays: fallback?.prodDays,
    transitDays: fallback?.transitDays,
    freightEur: fallback?.freightEur,
  });
  return fallbackItem ? [fallbackItem] : [];
}

export function computePoAggregateMetrics(input: {
  items: unknown;
  orderDate: unknown;
  fxRate: unknown;
  fallback?: Record<string, unknown> | null;
}): PoAggregateMetrics {
  const normalizedItems = normalizePoItems(input.items, input.fallback);
  let goodsUsd = 0;
  let freightEur = 0;
  let units = 0;
  let prodDays = 0;
  let transitDays = 0;
  const orderDate = parseIsoDate(input.orderDate);
  let minEtaDate: Date | null = null;
  let maxEtaDate: Date | null = null;

  normalizedItems.forEach((item) => {
    const itemGoods = item.units * (item.unitCostUsd + item.unitExtraUsd) + item.extraFlatUsd;
    goodsUsd += itemGoods;
    freightEur += item.freightEur;
    units += item.units;
    prodDays = Math.max(prodDays, item.prodDays);
    transitDays = Math.max(transitDays, item.transitDays);
    if (orderDate) {
      const eta = addDays(orderDate, item.prodDays + item.transitDays);
      if (!minEtaDate || eta < minEtaDate) minEtaDate = eta;
      if (!maxEtaDate || eta > maxEtaDate) maxEtaDate = eta;
    }
  });

  const schedule = computeScheduleFromOrderDate({
    orderDate: input.orderDate,
    productionLeadTimeDays: prodDays,
    logisticsLeadTimeDays: transitDays,
    bufferDays: 0,
  });

  return {
    items: normalizedItems,
    goodsUsd,
    goodsEur: convertToEur(goodsUsd, "USD", input.fxRate),
    freightEur,
    units,
    prodDays,
    transitDays,
    firstSku: normalizedItems[0]?.sku || "",
    minEtaDate: toIsoDate(minEtaDate),
    maxEtaDate: toIsoDate(maxEtaDate),
    schedule,
  };
}

export function mapSupplierTermsToPoMilestones(
  supplierRow?: Record<string, unknown> | null,
): PoMilestoneDraft[] {
  const terms = extractSupplierTerms([], supplierRow);
  return terms.map((term, index) => ({
    id: String(term.id || `ms-${index + 1}-${Math.random().toString(36).slice(2, 8)}`),
    label: String(term.label || "Milestone"),
    percent: asPositive(term.percent, 0),
    anchor: mapPaymentAnchor(normaliseTrigger(term.triggerEvent)),
    lagDays: asNumber(term.offsetDays, 0),
  }));
}

export function computeFoCostValues(input: {
  units: unknown;
  unitPrice: unknown;
  currency: unknown;
  freight: unknown;
  freightCurrency: unknown;
  dutyRatePct: unknown;
  eustRatePct: unknown;
  fxRate: unknown;
}): FoCostValues {
  const units = asPositive(input.units, 0);
  const unitPrice = asPositive(input.unitPrice, 0);
  const supplierCost = units * unitPrice;
  const supplierCostEur = convertToEur(supplierCost, input.currency, input.fxRate);
  const freightAmount = asPositive(input.freight, 0);
  const freightEur = convertToEur(freightAmount, input.freightCurrency, input.fxRate);
  const dutyRatePct = asPositive(input.dutyRatePct, 0);
  const eustRatePct = asPositive(input.eustRatePct, 0);
  const dutyAmountEur = supplierCostEur * (dutyRatePct / 100);
  const eustAmountEur = (supplierCostEur + dutyAmountEur + freightEur) * (eustRatePct / 100);
  const landedCostEur = supplierCostEur + freightEur + dutyAmountEur + eustAmountEur;
  return {
    supplierCost,
    supplierCostEur,
    freightAmount,
    freightEur,
    dutyAmountEur,
    eustAmountEur,
    landedCostEur,
  };
}

export function extractSupplierTerms(inputPayments: unknown, supplierRow?: Record<string, unknown> | null): SupplierPaymentTermDraft[] {
  const existing = Array.isArray(inputPayments)
    ? (inputPayments as Record<string, unknown>[]).filter((entry) => String(entry?.category || "supplier") === "supplier")
    : [];

  if (existing.length) {
    return existing.map((entry) => ({
      id: entry.id ? String(entry.id) : undefined,
      label: String(entry.label || "Milestone"),
      percent: asPositive(entry.percent, 0),
      triggerEvent: normaliseTrigger(entry.triggerEvent),
      offsetDays: asNumber(entry.offsetDays, 0),
      offsetMonths: asNumber(entry.offsetMonths, 0),
    }));
  }

  const supplierTerms = Array.isArray(supplierRow?.paymentTermsDefault)
    ? (supplierRow?.paymentTermsDefault as Record<string, unknown>[])
    : [];

  if (supplierTerms.length) {
    return supplierTerms.map((entry) => ({
      id: entry.id ? String(entry.id) : undefined,
      label: String(entry.label || "Milestone"),
      percent: asPositive(entry.percent, 0),
      triggerEvent: normaliseTrigger(entry.triggerEvent),
      offsetDays: asNumber(entry.offsetDays, 0),
      offsetMonths: asNumber(entry.offsetMonths, 0),
    }));
  }

  return defaultTerms();
}

export function buildFoPayments(input: {
  supplierTerms: SupplierPaymentTermDraft[];
  schedule: FoSchedule;
  unitPrice: unknown;
  units: unknown;
  currency: unknown;
  freight: unknown;
  freightCurrency: unknown;
  dutyRatePct: unknown;
  eustRatePct: unknown;
  fxRate: unknown;
  incoterm: unknown;
  vatRefundLagMonths?: unknown;
  paymentDueDefaults?: unknown;
  existingPayments?: unknown;
}): FoPaymentRow[] {
  const costValues = computeFoCostValues(input);
  const scheduleDates = buildScheduleDates(input.schedule);
  const baseValue = asPositive(input.unitPrice, 0) * asPositive(input.units, 0);

  const supplierRows: FoPaymentRow[] = (input.supplierTerms || []).map((term, index) => {
    const triggerEvent = normaliseTrigger(term.triggerEvent);
    const offsetDays = asNumber(term.offsetDays, 0);
    const offsetMonths = asNumber(term.offsetMonths, 0);
    return {
      id: term.id || `supplier-${index}`,
      label: String(term.label || "Milestone"),
      percent: asPositive(term.percent, 0),
      amount: baseValue * (asPositive(term.percent, 0) / 100),
      currency: normaliseCurrency(input.currency, "EUR"),
      triggerEvent,
      offsetDays,
      offsetMonths,
      dueDate: resolveDueDate(triggerEvent, offsetDays, offsetMonths, scheduleDates),
      isOverridden: false,
      dueDateManuallySet: false,
      category: "supplier",
    };
  });

  const incoterm = String(input.incoterm || "EXW").toUpperCase();
  const vatRefundLagMonths = Math.max(0, Math.round(asPositive(input.vatRefundLagMonths, 2)));
  const autoDueDefaults = resolveFoAutoPaymentTimingDefaults(input.paymentDueDefaults);
  const rows: FoPaymentRow[] = [...supplierRows];
  if (incoterm !== "DDP" && costValues.freightAmount > 0) {
    rows.push({
      id: "auto-freight",
      label: "Fracht",
      percent: 0,
      amount: costValues.freightAmount,
      currency: normaliseCurrency(input.freightCurrency, "EUR"),
      triggerEvent: autoDueDefaults.freight.triggerEvent,
      offsetDays: autoDueDefaults.freight.offsetDays,
      offsetMonths: 0,
      dueDate: resolveDueDate(autoDueDefaults.freight.triggerEvent, autoDueDefaults.freight.offsetDays, 0, scheduleDates),
      category: "freight",
      isOverridden: false,
      dueDateManuallySet: false,
    });
  }

  const dutyRatePct = asPositive(input.dutyRatePct, 0);
  if (incoterm !== "DDP" && dutyRatePct > 0) {
    rows.push({
      id: "auto-duty",
      label: "Duty",
      percent: dutyRatePct,
      amount: costValues.dutyAmountEur,
      currency: "EUR",
      triggerEvent: autoDueDefaults.duty.triggerEvent,
      offsetDays: autoDueDefaults.duty.offsetDays,
      offsetMonths: 0,
      dueDate: resolveDueDate(autoDueDefaults.duty.triggerEvent, autoDueDefaults.duty.offsetDays, 0, scheduleDates),
      category: "duty",
      isOverridden: false,
      dueDateManuallySet: false,
    });
  }

  const eustRatePct = asPositive(input.eustRatePct, 0);
  if (incoterm !== "DDP" && eustRatePct > 0) {
    rows.push({
      id: "auto-eust",
      label: "EUSt",
      percent: eustRatePct,
      amount: costValues.eustAmountEur,
      currency: "EUR",
      triggerEvent: autoDueDefaults.eust.triggerEvent,
      offsetDays: autoDueDefaults.eust.offsetDays,
      offsetMonths: 0,
      dueDate: resolveDueDate(autoDueDefaults.eust.triggerEvent, autoDueDefaults.eust.offsetDays, 0, scheduleDates),
      category: "eust",
      isOverridden: false,
      dueDateManuallySet: false,
    });
    rows.push({
      id: "auto-eust-refund",
      label: "EUSt Erstattung",
      percent: eustRatePct,
      amount: -costValues.eustAmountEur,
      currency: "EUR",
      triggerEvent: autoDueDefaults.eustRefund.triggerEvent,
      offsetDays: autoDueDefaults.eustRefund.offsetDays,
      offsetMonths: vatRefundLagMonths,
      dueDate: resolveDueDate(
        autoDueDefaults.eustRefund.triggerEvent,
        autoDueDefaults.eustRefund.offsetDays,
        vatRefundLagMonths,
        scheduleDates,
      ),
      category: "eust_refund",
      isOverridden: false,
      dueDateManuallySet: false,
    });
  }

  return mergeExistingPaymentState(rows, input.existingPayments);
}

export function sumSupplierPercent(terms: SupplierPaymentTermDraft[]): number {
  return Math.round((terms || []).reduce((sum, term) => sum + asPositive(term.percent, 0), 0) * 100) / 100;
}

export function normalizeFoRecord(input: {
  existing?: Record<string, unknown> | null;
  supplierTerms: SupplierPaymentTermDraft[];
  values: Record<string, unknown>;
  schedule: FoSchedule;
  vatRefundLagMonths?: unknown;
  paymentDueDefaults?: unknown;
}): Record<string, unknown> {
  const now = nowIso();
  const values = input.values || {};
  const schedule = input.schedule;
  const terms = input.supplierTerms || [];
  const existing = input.existing || null;
  const payments = buildFoPayments({
    supplierTerms: terms,
    schedule,
    unitPrice: values.unitPrice,
    units: values.units,
    currency: values.currency,
    freight: values.freight,
    freightCurrency: values.freightCurrency,
    dutyRatePct: values.dutyRatePct,
    eustRatePct: values.eustRatePct,
    fxRate: values.fxRate,
    incoterm: values.incoterm,
    vatRefundLagMonths: input.vatRefundLagMonths,
    paymentDueDefaults: input.paymentDueDefaults,
    existingPayments: existing?.payments,
  });
  return {
    ...(existing || {}),
    id: String(values.id || existing?.id || randomId("fo")),
    sku: String(values.sku || ""),
    supplierId: String(values.supplierId || ""),
    targetDeliveryDate: values.targetDeliveryDate ? String(values.targetDeliveryDate) : null,
    units: asPositive(values.units, 0),
    transportMode: String(values.transportMode || "SEA").toUpperCase(),
    incoterm: String(values.incoterm || "EXW").toUpperCase(),
    unitPrice: asPositive(values.unitPrice, 0),
    unitPriceIsOverridden: Boolean(values.unitPriceIsOverridden),
    currency: normaliseCurrency(values.currency, "EUR"),
    freight: asPositive(values.freight, 0),
    freightCurrency: normaliseCurrency(values.freightCurrency, "EUR"),
    dutyRatePct: asPositive(values.dutyRatePct, 0),
    eustRatePct: asPositive(values.eustRatePct, 0),
    fxRate: asPositive(values.fxRate, 0),
    productionLeadTimeDays: asPositive(values.productionLeadTimeDays, 0),
    productionLeadTimeDaysManual: asPositive(values.productionLeadTimeDaysManual, 0),
    productionLeadTimeSource: values.productionLeadTimeSource || null,
    logisticsLeadTimeDays: asPositive(values.logisticsLeadTimeDays, 0),
    bufferDays: asPositive(values.bufferDays, 0),
    orderDate: schedule.orderDate,
    productionEndDate: schedule.productionEndDate,
    etdDate: schedule.etdDate,
    etaDate: schedule.etaDate,
    deliveryDate: schedule.deliveryDate,
    payments,
    status: normalizeFoStatus(values.status, "DRAFT"),
    convertedPoId: values.convertedPoId || existing?.convertedPoId || null,
    convertedPoNo: values.convertedPoNo || existing?.convertedPoNo || null,
    forecastBasisVersionId: asNullableString(values.forecastBasisVersionId ?? existing?.forecastBasisVersionId),
    forecastBasisVersionName: asNullableString(values.forecastBasisVersionName ?? existing?.forecastBasisVersionName),
    forecastBasisSetAt: asNullableString(values.forecastBasisSetAt ?? existing?.forecastBasisSetAt),
    forecastConflictState: asNullableString(values.forecastConflictState ?? existing?.forecastConflictState),
    supersedesFoId: asNullableString(values.supersedesFoId ?? existing?.supersedesFoId),
    supersededByFoId: asNullableString(values.supersededByFoId ?? existing?.supersededByFoId),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export function createPoFromFo(input: {
  fo: Record<string, unknown>;
  poNumber: string;
  orderDateOverride?: string | null;
}): Record<string, unknown> {
  const fo = input.fo || {};
  const poNo = String(input.poNumber || "").trim();
  const fxRate = asPositive(fo.fxRate, 0);
  const freightEur = convertToEur(fo.freight, fo.freightCurrency, fxRate);
  const productionLead = asPositive(fo.productionLeadTimeDays, 0);
  const bufferDays = asPositive(fo.bufferDays, 0);
  const transitDays = asPositive(fo.logisticsLeadTimeDays, 0);
  const prodDays = productionLead + bufferDays;
  const supplierMilestones = Array.isArray(fo.payments)
    ? (fo.payments as Record<string, unknown>[]).filter((payment) => String(payment?.category || "") === "supplier")
    : [];

  const milestoneDefaults = supplierMilestones.length
    ? supplierMilestones
    : defaultTerms();

  const overrideOrderDate = input.orderDateOverride || fo.orderDate || null;
  const orderDate = parseIsoDate(overrideOrderDate) ? String(overrideOrderDate) : null;
  const poRecord = {
    id: randomId("po"),
    poNo,
    sku: String(fo.sku || ""),
    supplierId: String(fo.supplierId || ""),
    units: asPositive(fo.units, 0),
    unitCostUsd: asPositive(fo.unitPrice, 0),
    unitExtraUsd: 0,
    extraFlatUsd: 0,
    orderDate,
    prodDays,
    transitDays,
    transport: String(fo.transportMode || "SEA").toLowerCase(),
    freightEur,
    dutyRatePct: asPositive(fo.dutyRatePct, 0),
    eustRatePct: asPositive(fo.eustRatePct, 0),
    fxOverride: fxRate || null,
    ddp: String(fo.incoterm || "").toUpperCase() === "DDP",
    items: [{
      id: randomId("poi"),
      sku: String(fo.sku || "").trim(),
      units: asPositive(fo.units, 0),
      unitCostUsd: asPositive(fo.unitPrice, 0),
      unitExtraUsd: 0,
      extraFlatUsd: 0,
      prodDays,
      transitDays,
      freightEur,
      sourceFoId: asNullableString(fo.id),
    }],
    milestones: milestoneDefaults.map((payment) => ({
      id: String(payment.id || randomId("ms")),
      label: String(payment.label || "Milestone"),
      percent: asPositive((payment as Record<string, unknown>).percent, 0),
      anchor: mapPaymentAnchor(normaliseTrigger((payment as Record<string, unknown>).triggerEvent)),
      lagDays: asNumber((payment as Record<string, unknown>).offsetDays, 0),
    })),
    sourceFoIds: [String(fo.id || "")].filter(Boolean),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return poRecord;
}

function resolveOrderDateForFoMerge(input: {
  orderDateOverride?: string | null;
  fos?: Record<string, unknown>[];
  targetDeliveryDate?: string | null;
  maxProdDays: number;
  maxTransitDays: number;
  fallbackOrderDate?: string | null;
}): string | null {
  const orderOverride = parseIsoDate(input.orderDateOverride);
  if (orderOverride) return toIsoDate(orderOverride);
  const fos = Array.isArray(input.fos) ? input.fos : [];
  const earliestRequired = fos
    .map((fo) => resolveFoRequiredOrderDate(fo))
    .filter((value): value is string => Boolean(parseIsoDate(value)))
    .sort((left, right) => compareIsoDate(left, right))[0];
  if (earliestRequired) return earliestRequired;
  const target = parseIsoDate(input.targetDeliveryDate);
  if (target) {
    const leadDays = Math.max(0, Math.round(Number(input.maxProdDays || 0) + Number(input.maxTransitDays || 0)));
    return toIsoDate(addDays(target, -leadDays));
  }
  const fallback = parseIsoDate(input.fallbackOrderDate);
  return fallback ? toIsoDate(fallback) : null;
}

function sanitizeFoForPoItem(foRaw: Record<string, unknown>): PoItemDraft {
  const productionLead = asPositive(foRaw.productionLeadTimeDays, 0);
  const bufferDays = asPositive(foRaw.bufferDays, 0);
  return {
    id: randomId("poi"),
    sku: String(foRaw.sku || "").trim(),
    units: asPositive(foRaw.units, 0),
    unitCostUsd: asPositive(foRaw.unitPrice, 0),
    unitExtraUsd: 0,
    extraFlatUsd: 0,
    prodDays: Math.max(0, Math.round(productionLead + bufferDays)),
    transitDays: Math.max(0, Math.round(asPositive(foRaw.logisticsLeadTimeDays, 0))),
    freightEur: convertToEur(foRaw.freight, foRaw.freightCurrency, foRaw.fxRate),
    sourceFoId: asNullableString(foRaw.id),
  };
}

export function createPoFromFos(input: {
  fos: Record<string, unknown>[];
  poNumber: string;
  orderDateOverride?: string | null;
  targetDeliveryDate?: string | null;
}): Record<string, unknown> {
  const fos = Array.isArray(input.fos) ? input.fos.filter(Boolean) : [];
  if (!fos.length) {
    throw new Error("Keine FOs fuer Merge vorhanden.");
  }
  const firstFo = fos[0] as Record<string, unknown>;
  const supplierIds = Array.from(new Set(fos.map((fo) => String(fo?.supplierId || "").trim()).filter(Boolean)));
  if (supplierIds.length > 1) {
    throw new Error("FO-Merge erlaubt nur einen gemeinsamen Lieferanten.");
  }
  const poNo = String(input.poNumber || "").trim();
  const items = fos.map((fo) => sanitizeFoForPoItem(fo));
  const maxProdDays = items.reduce((best, item) => Math.max(best, Number(item.prodDays || 0)), 0);
  const maxTransitDays = items.reduce((best, item) => Math.max(best, Number(item.transitDays || 0)), 0);
  const orderDate = resolveOrderDateForFoMerge({
    orderDateOverride: input.orderDateOverride,
    fos,
    targetDeliveryDate: input.targetDeliveryDate,
    maxProdDays,
    maxTransitDays,
    fallbackOrderDate: String(firstFo.orderDate || ""),
  });
  const supplierMilestones = Array.isArray(firstFo.payments)
    ? (firstFo.payments as Record<string, unknown>[]).filter((payment) => String(payment?.category || "") === "supplier")
    : [];
  const milestoneDefaults = supplierMilestones.length ? supplierMilestones : defaultTerms();
  const unitsTotal = items.reduce((sum, item) => sum + Number(item.units || 0), 0);
  const freightTotal = items.reduce((sum, item) => sum + Number(item.freightEur || 0), 0);
  return {
    id: randomId("po"),
    poNo,
    supplierId: String(firstFo.supplierId || ""),
    sku: String(firstFo.sku || ""),
    items,
    units: Math.max(0, Math.round(unitsTotal)),
    unitCostUsd: asPositive(firstFo.unitPrice, 0),
    unitExtraUsd: 0,
    extraFlatUsd: 0,
    orderDate,
    prodDays: maxProdDays,
    transitDays: maxTransitDays,
    transport: String(firstFo.transportMode || "SEA").toLowerCase(),
    freightEur: Math.max(0, Math.round(freightTotal * 100) / 100),
    dutyRatePct: asPositive(firstFo.dutyRatePct, 0),
    eustRatePct: asPositive(firstFo.eustRatePct, 0),
    fxOverride: asPositive(firstFo.fxRate, 0) || null,
    ddp: String(firstFo.incoterm || "").toUpperCase() === "DDP",
    etaManual: parseIsoDate(input.targetDeliveryDate) ? String(input.targetDeliveryDate) : null,
    milestones: milestoneDefaults.map((payment) => ({
      id: String(payment.id || randomId("ms")),
      label: String(payment.label || "Milestone"),
      percent: asPositive((payment as Record<string, unknown>).percent, 0),
      anchor: mapPaymentAnchor(normaliseTrigger((payment as Record<string, unknown>).triggerEvent)),
      lagDays: asNumber((payment as Record<string, unknown>).offsetDays, 0),
    })),
    sourceFoIds: fos.map((fo) => String(fo.id || "")).filter(Boolean),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function buildSupplierRowMap(state: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(
    (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => [String(entry.id || ""), entry]),
  );
}

function buildProductRowMap(state: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(
    (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => [String(entry.sku || "").trim(), entry]),
  );
}

function buildFoHierarchyOverrides(fo: Record<string, unknown>): Record<string, unknown> {
  return {
    unitPriceUsd: fo.unitPrice,
    productionLeadTimeDays: fo.productionLeadTimeDays,
    logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
    transitDays: fo.logisticsLeadTimeDays,
    dutyRatePct: fo.dutyRatePct,
    eustRatePct: fo.eustRatePct,
    ddp: String(fo.incoterm || "").toUpperCase() === "DDP",
    incoterm: fo.incoterm,
    currency: fo.currency,
    fxRate: fo.fxRate,
    transportMode: fo.transportMode,
  };
}

function createIssue(code: string, message: string, foIds: string[]): MultiFoPoPreflightIssue {
  return { code, message, foIds };
}

export function buildMultiFoPoPreflight(input: {
  state: Record<string, unknown>;
  fos: Record<string, unknown>[];
  orderDateOverride?: string | null;
}): MultiFoPoPreflightResult {
  const state = input.state || {};
  const fos = Array.isArray(input.fos) ? input.fos.filter(Boolean) : [];
  const supplierById = buildSupplierRowMap(state);
  const productBySku = buildProductRowMap(state);
  const provisionalOrderDate = resolveOrderDateForFoMerge({
    orderDateOverride: input.orderDateOverride,
    fos,
    targetDeliveryDate: null,
    maxProdDays: 0,
    maxTransitDays: 0,
    fallbackOrderDate: null,
  });

  const lines = fos.map((fo) => {
    const supplierId = String(fo.supplierId || "").trim();
    const supplier = supplierById.get(supplierId) || null;
    const sku = String(fo.sku || "").trim();
    const product = productBySku.get(sku) || null;
    const hierarchy = resolveMasterDataHierarchy({
      state,
      product,
      sku,
      supplierId,
      orderOverrides: buildFoHierarchyOverrides(fo),
      orderContext: "fo",
      transportMode: String(fo.transportMode || ""),
    });
    const paymentTerms = extractSupplierTerms(fo.payments, supplier || undefined);
    const paymentTermsSource = resolveFoPaymentTermsSource(fo, supplier);
    const currentSchedule = resolveFoScheduleFromRecord(fo);
    const previewSchedule = provisionalOrderDate
      ? computeScheduleFromOrderDate({
        orderDate: provisionalOrderDate,
        productionLeadTimeDays: fo.productionLeadTimeDays,
        logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
        bufferDays: fo.bufferDays,
        deliveryDate: resolveFoTargetDeliveryDate(fo),
      })
      : {
        orderDate: null,
        productionEndDate: null,
        etdDate: null,
        etaDate: null,
        deliveryDate: resolveFoTargetDeliveryDate(fo),
        logisticsLeadTimeDays: asPositive(fo.logisticsLeadTimeDays, 0),
      };
    return {
      foId: String(fo.id || ""),
      sku,
      alias: String(product?.alias || sku || "—"),
      sourceFoNumber: resolveFoDisplayNumber(fo),
      supplierId,
      supplierName: String(supplier?.name || "—"),
      units: Math.max(0, Math.round(asPositive(fo.units, 0))),
      unitPrice: asPositive(fo.unitPrice, 0),
      currency: asNullableString(hierarchy.fields.currency.value),
      currencySource: hierarchy.fields.currency.source,
      incoterm: asNullableString(hierarchy.fields.incoterm.value),
      incotermSource: hierarchy.fields.incoterm.source,
      fxRate: asNullableNumber(hierarchy.fields.fxRate.value),
      fxRateSource: hierarchy.fields.fxRate.source,
      paymentTerms,
      paymentTermsSource,
      paymentTermsSummary: summarizeSupplierTerms(paymentTerms),
      productionLeadTimeDays: Math.max(0, Math.round(asPositive(fo.productionLeadTimeDays, 0))),
      logisticsLeadTimeDays: Math.max(0, Math.round(asPositive(fo.logisticsLeadTimeDays, 0))),
      bufferDays: Math.max(0, Math.round(asPositive(fo.bufferDays, 0))),
      orderDate: currentSchedule.orderDate,
      etdDate: currentSchedule.etdDate,
      etaDate: currentSchedule.etaDate,
      targetDeliveryDate: resolveFoTargetDeliveryDate(fo),
      previewOrderDate: previewSchedule.orderDate,
      previewEtdDate: previewSchedule.etdDate,
      previewEtaDate: previewSchedule.etaDate,
      dutyRatePct: asNullableNumber(hierarchy.fields.dutyRatePct.value),
      eustRatePct: asNullableNumber(hierarchy.fields.eustRatePct.value),
    } satisfies MultiFoPoPreflightLine;
  });

  const blockers: MultiFoPoPreflightIssue[] = [];
  const warnings: MultiFoPoPreflightIssue[] = [];
  const allFoIds = lines.map((line) => line.foId).filter(Boolean);
  const supplierIds = Array.from(new Set(lines.map((line) => line.supplierId).filter(Boolean)));
  if (supplierIds.length > 1) {
    blockers.push(createIssue("supplier_mismatch", "Die ausgewählten FOs haben unterschiedliche Lieferanten.", allFoIds));
  }

  const currencies = Array.from(new Set(lines.map((line) => line.currency || "").filter(Boolean)));
  if (lines.some((line) => !line.currency)) {
    blockers.push(createIssue(
      "currency_missing",
      "Mindestens eine FO hat keine auflösbare Währung.",
      lines.filter((line) => !line.currency).map((line) => line.foId),
    ));
  } else if (currencies.length > 1) {
    blockers.push(createIssue("currency_mismatch", `Währungskonflikt: ${currencies.join(", ")}.`, allFoIds));
  }

  const incoterms = Array.from(new Set(lines.map((line) => line.incoterm || "").filter(Boolean)));
  if (lines.some((line) => !line.incoterm)) {
    blockers.push(createIssue(
      "incoterm_missing",
      "Mindestens eine FO hat keinen auflösbaren Incoterm.",
      lines.filter((line) => !line.incoterm).map((line) => line.foId),
    ));
  } else if (incoterms.length > 1) {
    blockers.push(createIssue("incoterm_mismatch", `Incoterm-Konflikt: ${incoterms.join(", ")}.`, allFoIds));
  }

  const paymentTermSignatures = Array.from(new Set(lines.map((line) => normalizePaymentTermsSignature(line.paymentTerms)).filter(Boolean)));
  if (paymentTermSignatures.length > 1) {
    blockers.push(createIssue("payment_terms_mismatch", "Die Supplier Payment Terms unterscheiden sich zwischen den ausgewählten FOs.", allFoIds));
  }

  const resolvedCurrency = currencies[0] || null;
  if (resolvedCurrency && resolvedCurrency !== "EUR") {
    const fxRates = Array.from(new Set(lines.map((line) => normalizeComparableNumber(line.fxRate, 6)).filter(Boolean)));
    if (lines.some((line) => !Number.isFinite(line.fxRate as number) || Number(line.fxRate) <= 0)) {
      blockers.push(createIssue(
        "fx_missing",
        "Für mindestens eine FO fehlt die FX Rate.",
        lines.filter((line) => !Number.isFinite(line.fxRate as number) || Number(line.fxRate) <= 0).map((line) => line.foId),
      ));
    } else if (fxRates.length > 1) {
      blockers.push(createIssue("fx_mismatch", "Die ausgewählten FOs haben unterschiedliche FX Rates.", allFoIds));
    }
  }

  const dutyRates = Array.from(new Set(lines.map((line) => normalizeComparableNumber(line.dutyRatePct, 4)).filter(Boolean)));
  if (dutyRates.length > 1) {
    blockers.push(createIssue("duty_mismatch", "Die ausgewählten FOs haben unterschiedliche Zollsätze.", allFoIds));
  }
  const eustRates = Array.from(new Set(lines.map((line) => normalizeComparableNumber(line.eustRatePct, 4)).filter(Boolean)));
  if (eustRates.length > 1) {
    blockers.push(createIssue("eust_mismatch", "Die ausgewählten FOs haben unterschiedliche EUSt-Sätze.", allFoIds));
  }

  if (!provisionalOrderDate) {
    blockers.push(createIssue("order_date_missing", "Das gemeinsame Bestelldatum kann nicht sicher ermittelt werden.", allFoIds));
  }

  lines.forEach((line) => {
    const baselineEta = line.targetDeliveryDate || line.etaDate;
    if (baselineEta && (!line.previewEtaDate || compareIsoDate(line.previewEtaDate, baselineEta) > 0)) {
      blockers.push(createIssue(
        "timing_conflict",
        `Timing-Konflikt: ${line.sourceFoNumber} würde mit dem gemeinsamen Bestelldatum nach ${baselineEta} ankommen.`,
        [line.foId],
      ));
    }
  });

  const distinctOrderDates = Array.from(new Set(lines.map((line) => line.orderDate || "").filter(Boolean)));
  if (distinctOrderDates.length > 1 && provisionalOrderDate) {
    warnings.push(createIssue(
      "order_date_alignment",
      `Gemeinsames Bestelldatum wird auf ${provisionalOrderDate} gesetzt (frühestes erforderliches Datum).`,
      allFoIds,
    ));
  }

  const timingProfiles = Array.from(new Set(lines.map((line) => `${line.productionLeadTimeDays}:${line.bufferDays}:${line.logisticsLeadTimeDays}`)));
  if (timingProfiles.length > 1) {
    warnings.push(createIssue(
      "timing_conservative",
      "Die ausgewählten FOs haben unterschiedliche Timing-Profile. Der PO-Header verwendet deshalb konservative ETD/ETA-Werte.",
      allFoIds,
    ));
  }

  const transportModes = Array.from(new Set(fos.map((fo) => String(fo.transportMode || "").trim().toUpperCase()).filter(Boolean)));
  if (transportModes.length > 1) {
    warnings.push(createIssue(
      "transport_mixed",
      `Unterschiedliche Transportmodi erkannt: ${transportModes.join(", ")}.`,
      allFoIds,
    ));
  }

  const defaultPaymentTermLines = lines.filter((line) => line.paymentTermsSource === "default").map((line) => line.foId);
  if (defaultPaymentTermLines.length > 0) {
    warnings.push(createIssue(
      "payment_terms_defaulted",
      "Mindestens eine FO nutzt Standard-Payment-Terms statt expliziter Supplier Defaults.",
      defaultPaymentTermLines,
    ));
  }

  const aggregate = provisionalOrderDate
    ? computePoAggregateMetrics({
      items: fos.map((fo) => sanitizeFoForPoItem(fo)),
      orderDate: provisionalOrderDate,
      fxRate: lines[0]?.fxRate || 1,
      fallback: fos[0] || null,
    })
    : null;

  const targetDates = lines
    .map((line) => line.targetDeliveryDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => compareIsoDate(left, right));
  const headerSupplierId = supplierIds[0] || null;
  const headerSupplier = headerSupplierId ? (supplierById.get(headerSupplierId) || null) : null;

  return {
    compatible: blockers.length === 0,
    blockers,
    warnings,
    header: {
      supplierId: headerSupplierId,
      supplierName: String(headerSupplier?.name || lines[0]?.supplierName || "—"),
      lineCount: lines.length,
      totalUnits: lines.reduce((sum, line) => sum + Number(line.units || 0), 0),
      orderDate: provisionalOrderDate,
      etdDate: aggregate?.schedule.etdDate || null,
      etaDate: aggregate?.schedule.etaDate || null,
      currency: currencies[0] || null,
      incoterm: incoterms[0] || null,
      paymentTermsSummary: lines[0]?.paymentTermsSummary || "—",
      earliestRequiredOrderDate: distinctOrderDates.sort((left, right) => compareIsoDate(left, right))[0] || null,
      earliestTargetDeliveryDate: targetDates[0] || null,
      latestTargetDeliveryDate: targetDates[targetDates.length - 1] || null,
      timingIsConservative: timingProfiles.length > 1,
    },
    lines,
  };
}

export function convertFoSelectionToPo(input: {
  state: Record<string, unknown>;
  fos: Record<string, unknown>[];
  poNumber: string;
  orderDateOverride?: string | null;
}): MultiFoPoConversionResult {
  const state = input.state || {};
  const fos = Array.isArray(input.fos) ? input.fos.filter(Boolean) : [];
  const preflight = buildMultiFoPoPreflight({
    state,
    fos,
    orderDateOverride: input.orderDateOverride,
  });
  if (!preflight.compatible) {
    throw new Error(preflight.blockers.map((entry) => entry.message).join(" "));
  }
  const basePo = createPoFromFos({
    fos,
    poNumber: input.poNumber,
    orderDateOverride: preflight.header.orderDate,
  });
  const primaryLine = preflight.lines[0] || null;
  const po: Record<string, unknown> = {
    ...basePo,
    orderDate: preflight.header.orderDate,
    dutyRatePct: Number(primaryLine?.dutyRatePct ?? basePo.dutyRatePct ?? 0),
    eustRatePct: Number(primaryLine?.eustRatePct ?? basePo.eustRatePct ?? 0),
    fxOverride: preflight.header.currency === "EUR"
      ? null
      : (Number(primaryLine?.fxRate ?? basePo.fxOverride ?? 0) || null),
    ddp: String(preflight.header.incoterm || "").toUpperCase() === "DDP",
  };
  const supplierById = buildSupplierRowMap(state);
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const updatedFos = fos.map((fo) => {
    const supplier = supplierById.get(String(fo.supplierId || "")) || null;
    const supplierTerms = extractSupplierTerms(fo.payments, supplier || undefined);
    const schedule = computeScheduleFromOrderDate({
      orderDate: preflight.header.orderDate,
      productionLeadTimeDays: fo.productionLeadTimeDays,
      logisticsLeadTimeDays: fo.logisticsLeadTimeDays,
      bufferDays: fo.bufferDays,
      deliveryDate: resolveFoTargetDeliveryDate(fo),
    });
    const payments = buildFoPayments({
      supplierTerms,
      schedule,
      unitPrice: fo.unitPrice,
      units: fo.units,
      currency: fo.currency,
      freight: fo.freight,
      freightCurrency: fo.freightCurrency,
      dutyRatePct: fo.dutyRatePct,
      eustRatePct: fo.eustRatePct,
      fxRate: fo.fxRate,
      incoterm: fo.incoterm,
      vatRefundLagMonths: settings.vatRefundLagMonths,
      paymentDueDefaults: settings.paymentDueDefaults,
    });
    return {
      ...fo,
      ...schedule,
      payments,
      status: "CONVERTED",
      convertedPoId: po.id,
      convertedPoNo: po.poNo,
      updatedAt: nowIso(),
    };
  });
  return {
    po,
    updatedFos,
    preflight,
  };
}

export function buildPlannedSalesBySku(state: Record<string, unknown>): Record<string, Record<string, number>> {
  const manual = (state?.forecast as Record<string, unknown> | undefined)?.forecastManual || {};
  const imported = (state?.forecast as Record<string, unknown> | undefined)?.forecastImport || {};
  const result: Record<string, Record<string, number>> = {};
  const mergeSku = (skuValue: string) => {
    const sku = String(skuValue || "").trim();
    if (!sku) return;
    if (!result[sku]) result[sku] = {};
    const manualMonths = (manual as Record<string, Record<string, unknown>>)[sku] || {};
    const importMonths = (imported as Record<string, Record<string, Record<string, unknown>>>)[sku] || {};
    const months = new Set([...Object.keys(importMonths), ...Object.keys(manualMonths)]);
    months.forEach((month) => {
      const manualValue = parseDeNumber(manualMonths[month]);
      if (Number.isFinite(manualValue as number)) {
        result[sku][month] = Number(manualValue);
        return;
      }
      const importValue = parseDeNumber(importMonths[month]?.units);
      if (Number.isFinite(importValue as number)) {
        result[sku][month] = Number(importValue);
      }
    });
  };
  Object.keys(imported as Record<string, unknown>).forEach(mergeSku);
  Object.keys(manual as Record<string, unknown>).forEach(mergeSku);
  return result;
}

export function buildClosingStockBySku(state: Record<string, unknown>): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  const snapshots = ((state?.inventory as Record<string, unknown> | undefined)?.snapshots || []) as Record<string, unknown>[];
  snapshots.forEach((snapshot) => {
    const month = String(snapshot?.month || "");
    if (!month) return;
    const items = Array.isArray(snapshot.items) ? (snapshot.items as Record<string, unknown>[]) : [];
    items.forEach((item) => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      if (!result[sku]) result[sku] = {};
      const amazonUnitsRaw = parseDeNumber(item?.amazonUnits);
      const threePlUnitsRaw = parseDeNumber(item?.threePLUnits);
      const legacyUnitsRaw = parseDeNumber(item?.units);
      const hasSplitUnits = Number.isFinite(amazonUnitsRaw as number) || Number.isFinite(threePlUnitsRaw as number);
      if (hasSplitUnits) {
        const amazonUnits = Number.isFinite(amazonUnitsRaw as number) ? Math.max(0, Number(amazonUnitsRaw)) : 0;
        const threePlUnits = Number.isFinite(threePlUnitsRaw as number) ? Math.max(0, Number(threePlUnitsRaw)) : 0;
        result[sku][month] = amazonUnits + threePlUnits;
        return;
      }
      result[sku][month] = Number.isFinite(legacyUnitsRaw as number)
        ? Math.max(0, Number(legacyUnitsRaw))
        : 0;
    });
  });
  return result;
}

function resolveInboundArrivalDate(record: EntityWithDates): Date | null {
  const raw =
    record?.arrivalDateDe
    || record?.arrivalDate
    || record?.etaDate
    || record?.etaManual
    || record?.eta;
  if (raw) {
    return parseIsoDate(raw);
  }
  const orderDate = parseIsoDate(record?.orderDate);
  if (!orderDate) return null;
  const prodDays = asPositive(record?.prodDays ?? record?.productionLeadTimeDays, 0);
  const transitDays = asPositive(record?.transitDays ?? record?.logisticsLeadTimeDays, 0);
  return addDays(orderDate, prodDays + transitDays);
}

function extractInboundItems(record: EntityWithDates): Array<{ sku: string; units: number }> {
  if (Array.isArray(record?.items) && record.items.length > 0) {
    return (record.items as Record<string, unknown>[]).map((item) => ({
      sku: String(item?.sku || "").trim(),
      units: asPositive(item?.units, 0),
    }));
  }
  const sku = String(record?.sku || "").trim();
  if (!sku) return [];
  return [{
    sku,
    units: asPositive(record?.units, 0),
  }];
}

export function buildInboundBySku(state: Record<string, unknown>): {
  inboundBySku: Record<string, Record<string, number>>;
  inboundWithoutEtaCount: number;
} {
  const inboundBySku: Record<string, Record<string, number>> = {};
  let inboundWithoutEtaCount = 0;
  const pos = Array.isArray(state?.pos) ? (state.pos as Record<string, unknown>[]) : [];
  pos.forEach((po) => {
    if (po?.archived) return;
    const arrival = resolveInboundArrivalDate(po as EntityWithDates);
    if (!arrival) {
      inboundWithoutEtaCount += 1;
      return;
    }
    const month = monthKey(arrival);
    extractInboundItems(po as EntityWithDates).forEach((item) => {
      if (!item.sku || item.units <= 0) return;
      if (!inboundBySku[item.sku]) inboundBySku[item.sku] = {};
      inboundBySku[item.sku][month] = (inboundBySku[item.sku][month] || 0) + item.units;
    });
  });

  const fos = Array.isArray(state?.fos) ? (state.fos as Record<string, unknown>[]) : [];
  fos.forEach((fo) => {
    if (!isFoPlanningStatus(fo?.status)) return;
    const arrival = resolveInboundArrivalDate(fo as EntityWithDates);
    if (!arrival) {
      inboundWithoutEtaCount += 1;
      return;
    }
    const month = monthKey(arrival);
    extractInboundItems(fo as EntityWithDates).forEach((item) => {
      if (!item.sku || item.units <= 0) return;
      if (!inboundBySku[item.sku]) inboundBySku[item.sku] = {};
      inboundBySku[item.sku][month] = (inboundBySku[item.sku][month] || 0) + item.units;
    });
  });

  return {
    inboundBySku,
    inboundWithoutEtaCount,
  };
}

export function buildFoRecommendationContext(state: Record<string, unknown>): FoRecommendationContext {
  const baselineMonth = getLatestClosingSnapshotMonth(
    (((state?.inventory as Record<string, unknown>)?.snapshots || []) as unknown[]),
  );
  const plannedSalesBySku = buildPlannedSalesBySku(state);
  const closingStockBySku = buildClosingStockBySku(state);
  const inbound = buildInboundBySku(state);
  return {
    baselineMonth,
    plannedSalesBySku,
    closingStockBySku,
    inboundBySku: inbound.inboundBySku,
    inboundWithoutEtaCount: inbound.inboundWithoutEtaCount,
  };
}

export function resolveProductBySku(
  products: Array<Record<string, unknown>>,
  sku: string,
): Record<string, unknown> | null {
  const key = String(sku || "").trim().toLowerCase();
  if (!key) return null;
  return (
    products.find((entry) => String(entry?.sku || "").trim().toLowerCase() === key)
    || null
  );
}

export function computeFoRecommendationForSku(input: {
  context: FoRecommendationContext;
  sku: string;
  leadTimeDays: number;
  product: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  horizonMonths?: number;
  requiredArrivalMonth?: string | null;
}): Record<string, unknown> | null {
  const { context } = input;
  if (!context.baselineMonth) return null;
  const sku = String(input.sku || "").trim();
  if (!sku) return null;
  const safetyDays = asPositiveNumber(input.product?.safetyStockDohOverride)
    ?? asPositiveNumber(input.settings?.safetyStockDohDefault)
    ?? 60;
  const coverageDays = asPositiveNumber(input.product?.foCoverageDohOverride)
    ?? asPositiveNumber(input.settings?.foCoverageDohDefault)
    ?? 90;
  const moqUnits = asPositiveNumber(input.product?.moqOverrideUnits)
    ?? asPositiveNumber(input.product?.moqUnits)
    ?? asPositiveNumber(input.settings?.moqDefaultUnits)
    ?? 0;
  const unitsPerCarton = asPositiveNumber(input.product?.unitsPerCarton) ?? null;
  const roundupCartonBlock = asPositiveNumber(input.settings?.foRecommendationRoundupCartonBlock) ?? 10;
  const roundupMaxPctRaw = Number(input.settings?.foRecommendationRoundupMaxPct);
  const roundupMaxPct = Number.isFinite(roundupMaxPctRaw)
    ? Math.max(0, roundupMaxPctRaw)
    : 10;
  const stock0 = context.closingStockBySku?.[sku]?.[context.baselineMonth] ?? 0;
  const projection = buildSkuProjection({
    sku,
    baselineMonth: context.baselineMonth,
    stock0,
    forecastByMonth: context.plannedSalesBySku?.[sku] || {},
    inboundByMonth: context.inboundBySku?.[sku] || {},
    horizonMonths: Number(input.horizonMonths || 12),
  });

  return computeFoRecommendation({
    sku,
    baselineMonth: context.baselineMonth,
    projection,
    plannedSalesBySku: context.plannedSalesBySku,
    safetyStockDays: safetyDays,
    coverageDays,
    leadTimeDays: Number(input.leadTimeDays || 0),
    cnyPeriod: input.settings?.cny,
    inboundWithoutEtaCount: context.inboundWithoutEtaCount,
    moqUnits,
    unitsPerCarton,
    roundupCartonBlock,
    roundupMaxPct,
    requiredArrivalMonth: input.requiredArrivalMonth,
  }) as Record<string, unknown>;
}

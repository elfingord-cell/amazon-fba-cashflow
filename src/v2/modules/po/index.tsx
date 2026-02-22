import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  message,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocation, useNavigate } from "react-router-dom";
import { buildPaymentRows } from "../../../ui/orderEditorFactory.js";
import { allocatePayment, isHttpUrl, normalizePaymentId } from "../../../ui/utils/paymentValidation.js";
import { DataTable } from "../../components/DataTable";
import { DeNumberInput } from "../../components/DeNumberInput";
import { StatsTableShell } from "../../components/StatsTableShell";
import { SkuAliasCell } from "../../components/SkuAliasCell";
import { applyAdoptedFieldToProduct, resolveMasterDataHierarchy, sourceChipClass } from "../../domain/masterDataHierarchy";
import { evaluateOrderBlocking } from "../../domain/productCompletenessV2";
import {
  computePoAggregateMetrics,
  computeScheduleFromOrderDate,
  mapSupplierTermsToPoMilestones,
  normalizePoItems,
  nowIso,
  PO_ANCHORS,
  randomId,
} from "../../domain/orderUtils";
import { formatMonthLabel, monthRange, normalizeMonthKey } from "../../domain/months";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { useSyncSession } from "../../sync/session";
import { useModalCollaboration } from "../../sync/modalCollaboration";

const { Paragraph, Text, Title } = Typography;

const PO_CONFIG = {
  slug: "po",
  entityLabel: "PO",
  numberField: "poNo",
};

interface PoMilestoneDraft {
  id?: string;
  label: string;
  percent: number;
  anchor: string;
  lagDays: number;
}

interface PoFormValues {
  id?: string;
  poNo: string;
  supplierId: string;
  orderDate: string;
  etdManual?: string;
  etaManual?: string;
  arrivalDate?: string;
  transport: "sea" | "rail" | "air";
  dutyRatePct: number;
  dutyIncludeFreight: boolean;
  eustRatePct: number;
  fxOverride: number;
  ddp: boolean;
  archived: boolean;
  milestones: PoMilestoneDraft[];
  items: PoItemDraft[];
}

interface PoItemDraft {
  id?: string;
  sku: string;
  units: number;
  unitCostUsd: number;
  unitExtraUsd: number;
  extraFlatUsd: number;
  prodDays: number;
  transitDays: number;
  freightEur: number;
}

interface PoTimelineMarkerRow {
  id: string;
  eventIds?: string[];
  typeLabel: string;
  label: string;
  dueDate: string | null;
  plannedEur: number;
  status: "open" | "paid";
  paidDate: string | null;
  eventType: string | null;
  direction: "out" | "in" | "neutral";
}

interface PoViewRow {
  id: string;
  poNo: string;
  sku: string;
  alias: string;
  skuCount: number;
  supplierName: string;
  orderDate: string | null;
  productionEndDate: string | null;
  etdDate: string | null;
  etaDate: string | null;
  arrivalDate: string | null;
  goodsEur: number;
  openEur: number;
  paidEur: number;
  statusText: "open" | "mixed" | "paid_only";
  itemSkusText: string;
  timelineMarkers: PoTimelineMarkerRow[];
  raw: Record<string, unknown>;
}

interface PoPaymentRow {
  id: string;
  eventIds?: string[];
  typeLabel: string;
  label: string;
  dueDate: string | null;
  plannedEur: number;
  status: "open" | "paid";
  paidDate: string | null;
  paidEurActual: number | null;
  paymentId: string | null;
  method: string | null;
  paidBy: string | null;
  note: string;
  invoiceDriveUrl: string;
  invoiceFolderDriveUrl: string;
  eventType: string | null;
  direction?: "out" | "in" | "neutral";
}

interface PoPaymentFormValues {
  selectedEventIds: string[];
  paidDate: string;
  method: string;
  paidBy: string;
  amountActualEur: number | null;
  amountActualUsd: number | null;
  paymentId: string;
  invoiceDriveUrl: string;
  invoiceFolderDriveUrl: string;
  note: string;
}

interface PoAggregateSnapshot {
  goodsUsd: number;
  goodsEur: number;
  freightEur: number;
  units: number;
  prodDays: number;
  transitDays: number;
}

interface PoCreatePrefill extends Partial<PoFormValues> {
  sku?: string;
  units?: number;
}

interface TimelineRange {
  startMs: number;
  endMs: number;
  totalDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value || "").trim();
  const [year, month, day] = raw.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function normalizeReturnPath(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!raw.startsWith("/v2/")) return null;
  return raw;
}

function etaSortValue(row: unknown): string {
  const eta = normalizeIsoDate((row as { etaDate?: unknown })?.etaDate);
  return eta || "9999-12-31";
}

function toTimelinePercent(date: Date | null, range: TimelineRange): number {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
  const clamped = Math.min(Math.max(date.getTime(), range.startMs), range.endMs);
  const diffDays = (clamped - range.startMs) / MS_PER_DAY;
  return Math.max(0, Math.min(100, (diffDays / range.totalDays) * 100));
}

function determineTimelineStartMonth(input: {
  state: Record<string, unknown>;
  rows: PoViewRow[];
}): string {
  const settings = (input.state.settings || {}) as Record<string, unknown>;
  const explicit = normalizeMonthKey(settings.startMonth);
  if (explicit) return explicit;
  const firstOrder = input.rows
    .map((row) => row.orderDate)
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)))
    .sort()[0];
  if (firstOrder) return firstOrder.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

function determineTimelineHorizon(state: Record<string, unknown>): number {
  const settings = (state.settings || {}) as Record<string, unknown>;
  const horizon = Number(settings.horizonMonths || 0);
  if (!Number.isFinite(horizon) || horizon <= 0) return 12;
  return Math.round(horizon);
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function shortId(value: string): string {
  return String(value || "").slice(-6).toUpperCase();
}

function statusTag(status: string): JSX.Element {
  if (status === "paid_only") return <Tag color="green">Bezahlt</Tag>;
  if (status === "mixed") return <Tag color="gold">Teilweise bezahlt</Tag>;
  return <Tag color="blue">Offen</Tag>;
}

function eventIdsOfRow(row: Pick<PoPaymentRow, "id" | "eventIds">): string[] {
  const ids = Array.isArray(row.eventIds) ? row.eventIds : [];
  const clean = ids.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (clean.length) return Array.from(new Set(clean));
  const fallback = String(row.id || "").trim();
  return fallback ? [fallback] : [];
}

function paymentFlowSortRank(entry: Pick<PoPaymentRow, "eventType" | "label" | "typeLabel">): number {
  const eventType = String(entry.eventType || "").toLowerCase();
  const text = `${String(entry.typeLabel || "")} ${String(entry.label || "")}`.toLowerCase();
  if (text.includes("deposit")) return 1;
  if (text.includes("balance")) return 2;
  if (eventType === "freight" || text.includes("shipping") || text.includes("fracht")) return 3;
  if (eventType === "tax_duty_combined" || eventType === "duty" || eventType === "eust" || text.includes("zoll") || text.includes("umsatzsteuer")) return 4;
  return 5;
}

function sortPaymentRowsByFlow(rows: PoPaymentRow[]): PoPaymentRow[] {
  return [...rows].sort((left, right) => {
    const dateCompare = String(left.dueDate || "").localeCompare(String(right.dueDate || ""));
    if (dateCompare !== 0) return dateCompare;
    const rankCompare = paymentFlowSortRank(left) - paymentFlowSortRank(right);
    if (rankCompare !== 0) return rankCompare;
    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}

function mapBuiltPaymentRow(row: Record<string, unknown>): PoPaymentRow {
  return {
    id: String(row.id || ""),
    eventIds: [String(row.id || "")],
    typeLabel: String(row.typeLabel || ""),
    label: String(row.label || ""),
    dueDate: row.dueDate ? String(row.dueDate) : null,
    plannedEur: Number(row.plannedEur || 0),
    status: row.status === "paid" ? "paid" : "open",
    paidDate: row.paidDate ? String(row.paidDate) : null,
    paidEurActual: Number.isFinite(Number(row.paidEurActual)) ? Number(row.paidEurActual) : null,
    paymentId: row.paymentId ? String(row.paymentId) : null,
    method: row.method ? String(row.method) : null,
    paidBy: row.paidBy ? String(row.paidBy) : null,
    note: String(row.note || ""),
    invoiceDriveUrl: String(row.invoiceDriveUrl || ""),
    invoiceFolderDriveUrl: String(row.invoiceFolderDriveUrl || ""),
    eventType: row.eventType ? String(row.eventType) : null,
    direction: row.direction === "in" ? "in" : (row.direction === "neutral" ? "neutral" : "out"),
  };
}

function paymentTypeLabel(row: Pick<PoPaymentRow, "typeLabel" | "eventType" | "label">): string {
  if (row.eventType === "tax_duty_combined") return "Umsatzsteuer + Zoll";
  if (row.eventType === "duty") return "Zoll";
  if (row.eventType === "eust") return "EUSt";
  if (row.eventType === "vat_refund") return "EUSt-Erstattung";
  if (row.eventType === "freight") return "Shipping";
  if (row.eventType === "fx_fee") return "FX Gebuehr";
  const base = String(row.typeLabel || row.label || "").trim();
  return base || "Payment";
}

function timelineMarkerSortRank(marker: Pick<PoTimelineMarkerRow, "eventType" | "label" | "typeLabel">): number {
  return paymentFlowSortRank({
    eventType: marker.eventType,
    label: marker.label,
    typeLabel: marker.typeLabel,
  });
}

function paymentMethodOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "Alibaba Trade Assurance", label: "Alibaba Trade Assurance" },
    { value: "Wise Transfer", label: "Wise Transfer" },
    { value: "PayPal", label: "PayPal" },
    { value: "SEPA Bank Transfer", label: "SEPA Bank Transfer" },
    { value: "Kreditkarte", label: "Kreditkarte" },
  ];
}

function paymentPayerOptions(input: {
  displayNameMap: Record<string, string>;
  syncEmail: string | null;
}): Array<{ value: string; label: string }> {
  const labels = new Set<string>();
  Object.entries(input.displayNameMap || {}).forEach(([key, name]) => {
    const clean = String(name || key || "").trim();
    if (clean) labels.add(clean);
  });
  if (input.syncEmail) labels.add(String(input.syncEmail).trim());
  if (!labels.size) return [];
  return Array.from(labels).sort((a, b) => a.localeCompare(b, "de-DE", { sensitivity: "base" })).map((entry) => ({
    value: entry,
    label: entry,
  }));
}

function canOpenLink(value: string): boolean {
  const url = String(value || "").trim();
  return url.length > 0 && isHttpUrl(url);
}

function buildSuggestedInvoiceFilename(input: {
  paidDate: string;
  poNo: string;
  alias: string;
  units: number;
  selectedRows: PoPaymentRow[];
}): string {
  const rawDate = String(input.paidDate || "").trim();
  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "DD-MM-YYYY";
  const poNo = String(input.poNo || "").trim() || "PO";
  const alias = String(input.alias || "").trim().replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-") || "Alias";
  const units = Number.isFinite(Number(input.units)) ? Math.max(0, Math.round(Number(input.units))) : 0;
  const labels = Array.from(new Set((input.selectedRows || []).map((row) => paymentTypeLabel(row))))
    .map((entry) => entry.replace(/\s+/g, "-").replace(/[\\/:*?"<>|]/g, "-"));
  const paymentChunk = labels.length ? labels.join("+") : "Payment";
  return `${date}_PO-${poNo}_${alias}_${units}u_${paymentChunk}.pdf`.replace(/-+/g, "-");
}

function round2(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function poSettingsFromState(state: Record<string, unknown>): Record<string, unknown> {
  const settings = (state.settings || {}) as Record<string, unknown>;
  return {
    fxRate: Number(settings.fxRate || 0),
    fxFeePct: Number(settings.fxFeePct || 0),
    dutyRatePct: Number(settings.dutyRatePct || 0),
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: Number(settings.eustRatePct || 0),
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(settings.vatRefundLagMonths || 0),
    freightLagDays: Number(settings.freightLagDays || 0),
    paymentDueDefaults: settings.paymentDueDefaults || {},
    cny: settings.cny || { start: "", end: "" },
    cnyBlackoutByYear: settings.cnyBlackoutByYear || {},
  };
}

function defaultMilestones(): PoMilestoneDraft[] {
  return [
    { label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
    { label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
  ];
}

function milestoneSum(milestones: PoMilestoneDraft[]): number {
  return Math.round((milestones || []).reduce((sum, row) => sum + Number(row.percent || 0), 0) * 100) / 100;
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function templateFields(product: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const template = (product?.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function resolvePoProductPrefill(input: {
  state: Record<string, unknown>;
  product: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  supplierId?: string;
  supplierDefaultProdDays?: number;
  units: number;
}): {
  transport: "sea" | "rail" | "air";
  prodDays: number;
  transitDays: number;
  unitCostUsd: number;
  unitExtraUsd: number;
  extraFlatUsd: number;
  freightEur: number;
  dutyRatePct: number;
  eustRatePct: number;
  fxOverride: number;
  ddp: boolean;
} {
  const product = input.product || {};
  const settings = input.settings || {};
  const template = templateFields(product);
  const hierarchy = resolveMasterDataHierarchy({
    state: input.state || {},
    product,
    sku: String(product.sku || ""),
    supplierId: input.supplierId || String(product.supplierId || ""),
    orderContext: "po",
  });

  const transport = String(template.transportMode || "SEA").toLowerCase() as "sea" | "rail" | "air";
  const transportLeadMap = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  const transitDays = toNumberOrNull(hierarchy.fields.transitDays.value)
    ?? toNumberOrNull(template.transitDays)
    ?? toNumberOrNull(transportLeadMap[transport])
    ?? 45;
  const prodDays = toNumberOrNull(hierarchy.fields.productionLeadTimeDays.value)
    ?? toNumberOrNull(product.productionLeadTimeDaysDefault ?? template.productionDays)
    ?? toNumberOrNull(input.supplierDefaultProdDays)
    ?? toNumberOrNull(settings.defaultProductionLeadTimeDays)
    ?? 60;
  const unitCostUsd = toNumberOrNull(hierarchy.fields.unitPriceUsd.value) ?? toNumberOrNull(template.unitPriceUsd) ?? 0;
  const fxOverride = toNumberOrNull(template.fxRate ?? settings.fxRate) ?? 0;
  const logisticsPerUnit = Math.max(
    0,
    toNumberOrNull(hierarchy.fields.logisticsPerUnitEur.value)
      ?? toNumberOrNull(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur)
      ?? 0,
  );
  const freightEur = Math.max(0, Math.round(logisticsPerUnit * Math.max(0, Number(input.units || 0)) * 100) / 100);

  return {
    transport,
    prodDays: Math.max(0, Math.round(prodDays)),
    transitDays: Math.max(0, Math.round(transitDays)),
    unitCostUsd,
    unitExtraUsd: 0,
    extraFlatUsd: 0,
    freightEur,
    dutyRatePct: toNumberOrNull(hierarchy.fields.dutyRatePct.value) ?? toNumberOrNull(product.dutyRatePct ?? template.dutyPct ?? settings.dutyRatePct) ?? 0,
    eustRatePct: toNumberOrNull(hierarchy.fields.eustRatePct.value) ?? toNumberOrNull(product.eustRatePct ?? template.vatImportPct ?? settings.eustRatePct) ?? 0,
    fxOverride,
    ddp: hierarchy.fields.ddp.value === true || template.ddp === true,
  };
}

function estimatePoItemFreightEur(input: {
  state: Record<string, unknown>;
  product: Record<string, unknown> | null;
  supplierId?: string;
  units: number;
}): number {
  const product = input.product || {};
  const template = templateFields(product);
  const hierarchy = resolveMasterDataHierarchy({
    state: input.state || {},
    product,
    sku: String(product.sku || ""),
    supplierId: input.supplierId || String(product.supplierId || ""),
    orderContext: "po",
  });
  const logisticsPerUnit = Math.max(
    0,
    toNumberOrNull(hierarchy.fields.logisticsPerUnitEur.value)
      ?? toNumberOrNull(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur)
      ?? 0,
  );
  return Math.max(0, Math.round(logisticsPerUnit * Math.max(0, Number(input.units || 0)) * 100) / 100);
}

function normalizeDraftItem(input: Partial<PoItemDraft>, fallbackSku = ""): PoItemDraft {
  return {
    id: String(input.id || randomId("poi")),
    sku: String(input.sku || fallbackSku || "").trim(),
    units: Math.max(0, Math.round(Number(input.units || 0))),
    unitCostUsd: Number(input.unitCostUsd || 0),
    unitExtraUsd: Number(input.unitExtraUsd || 0),
    extraFlatUsd: Number(input.extraFlatUsd || 0),
    prodDays: Math.max(0, Math.round(Number(input.prodDays || 0))),
    transitDays: Math.max(0, Math.round(Number(input.transitDays || 0))),
    freightEur: Math.max(0, Number(input.freightEur || 0)),
  };
}

function extractPaidEventCount(record: Record<string, unknown> | null): number {
  const log = (record?.paymentLog && typeof record.paymentLog === "object")
    ? record.paymentLog as Record<string, Record<string, unknown>>
    : {};
  return Object.values(log).filter((entry) => String(entry?.status || "") === "paid").length;
}

function aggregateSnapshotFromRecord(record: Record<string, unknown> | null, poSettings: Record<string, unknown>): PoAggregateSnapshot {
  const metrics = computePoAggregateMetrics({
    items: record?.items,
    orderDate: record?.orderDate,
    fxRate: record?.fxOverride ?? poSettings.fxRate,
    fallback: record,
  });
  return {
    goodsUsd: round2(metrics.goodsUsd),
    goodsEur: round2(metrics.goodsEur),
    freightEur: round2(metrics.freightEur),
    units: Math.round(metrics.units),
    prodDays: Math.round(metrics.prodDays),
    transitDays: Math.round(metrics.transitDays),
  };
}

function toPoRecord(values: PoFormValues, existing: Record<string, unknown> | null): Record<string, unknown> {
  const now = nowIso();
  const normalizedItems = normalizePoItems(values.items, existing).map((row) => ({
    id: String(row.id || randomId("poi")),
    sku: String(row.sku || "").trim(),
    units: Math.max(0, Math.round(Number(row.units || 0))),
    unitCostUsd: Number(row.unitCostUsd || 0),
    unitExtraUsd: Number(row.unitExtraUsd || 0),
    extraFlatUsd: Number(row.extraFlatUsd || 0),
    prodDays: Math.max(0, Math.round(Number(row.prodDays || 0))),
    transitDays: Math.max(0, Math.round(Number(row.transitDays || 0))),
    freightEur: Math.max(0, Number(row.freightEur || 0)),
  }));
  const aggregated = computePoAggregateMetrics({
    items: normalizedItems,
    orderDate: values.orderDate,
    fxRate: values.fxOverride,
    fallback: existing,
  });
  const firstItem = normalizedItems[0] || null;
  const milestones = (values.milestones || []).map((row) => ({
    id: String(row.id || randomId("ms")),
    label: String(row.label || "Milestone"),
    percent: Number(row.percent || 0),
    anchor: String(row.anchor || "ORDER_DATE"),
    lagDays: Number(row.lagDays || 0),
  }));
  return {
    ...(existing || {}),
    id: String(values.id || existing?.id || randomId("po")),
    poNo: String(values.poNo || "").trim(),
    sku: String(firstItem?.sku || existing?.sku || "").trim(),
    supplierId: String(values.supplierId || "").trim(),
    orderDate: values.orderDate || null,
    etdManual: values.etdManual || null,
    etaManual: values.etaManual || null,
    arrivalDate: values.arrivalDate || null,
    units: Math.max(0, Math.round(aggregated.units || 0)),
    unitCostUsd: Number(firstItem?.unitCostUsd || 0),
    unitExtraUsd: Number(firstItem?.unitExtraUsd || 0),
    extraFlatUsd: Number(firstItem?.extraFlatUsd || 0),
    prodDays: Number(aggregated.prodDays || 0),
    transitDays: Number(aggregated.transitDays || 0),
    transport: String(values.transport || "sea").toLowerCase(),
    freightEur: Number(aggregated.freightEur || 0),
    freightMode: "total",
    freightPerUnitEur: 0,
    dutyRatePct: Number(values.dutyRatePct || 0),
    dutyIncludeFreight: values.dutyIncludeFreight !== false,
    eustRatePct: Number(values.eustRatePct || 0),
    fxOverride: Number(values.fxOverride || 0),
    ddp: values.ddp === true,
    items: normalizedItems,
    milestones,
    archived: values.archived === true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    paymentLog: existing?.paymentLog || {},
    autoEvents: existing?.autoEvents || undefined,
  };
}

export interface PoModuleProps {
  embedded?: boolean;
}

export default function PoModule({ embedded = false }: PoModuleProps = {}): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const [search, setSearch] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<"all" | "open" | "mixed" | "paid_only">("all");
  const [onlyOpenPayments, setOnlyOpenPayments] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [skuPickerValues, setSkuPickerValues] = useState<string[]>([]);
  const [form] = Form.useForm<PoFormValues>();
  const [paymentForm] = Form.useForm<PoPaymentFormValues>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentEditingId, setPaymentEditingId] = useState<string | null>(null);
  const [paymentModalError, setPaymentModalError] = useState<string | null>(null);
  const [paymentInitialEventIds, setPaymentInitialEventIds] = useState<string[]>([]);
  const [markerPendingAction, setMarkerPendingAction] = useState<{ poId: string; eventId: string } | null>(null);
  const [modalFocusTarget, setModalFocusTarget] = useState<"payments" | "shipping" | "arrival" | null>(null);
  const [returnContext, setReturnContext] = useState<{ path: string; sku: string | null } | null>(null);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);
  const manualFreightOverrideIdsRef = useRef<Set<string>>(new Set());
  const suppressFreightTrackingRef = useRef(false);
  const poViewMode = useMemo<"table" | "timeline">(() => {
    const params = new URLSearchParams(location.search);
    return params.get("view") === "timeline" ? "timeline" : "table";
  }, [location.search]);

  const stateObj = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const displayNameMap = useMemo(() => readCollaborationDisplayNames(settings), [settings]);
  const ownDisplayName = useMemo(() => {
    return resolveCollaborationUserLabel({
      userId: syncSession.userId,
      userEmail: syncSession.email,
    }, displayNameMap);
  }, [displayNameMap, syncSession.email, syncSession.userId]);
  const modalScope = useMemo(
    () => `po:edit:${String(editingId || "new")}`,
    [editingId],
  );
  const modalCollab = useModalCollaboration({
    workspaceId: syncSession.workspaceId,
    modalScope,
    isOpen: modalOpen,
    userId: syncSession.userId,
    userEmail: syncSession.email,
    userDisplayName: ownDisplayName,
    displayNames: displayNameMap,
  });
  const poSettings = useMemo(() => poSettingsFromState(stateObj), [state.settings]);

  const supplierRows = useMemo(() => {
    return (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        id: String(entry.id || ""),
        name: String(entry.name || "—"),
        productionLeadTimeDaysDefault: Number(entry.productionLeadTimeDaysDefault || 0),
        paymentTermsDefault: Array.isArray(entry.paymentTermsDefault)
          ? entry.paymentTermsDefault as Record<string, unknown>[]
          : [],
        raw: entry,
      }))
      .filter((entry) => entry.id);
  }, [state.suppliers]);

  const supplierNameById = useMemo(() => new Map(supplierRows.map((entry) => [entry.id, entry.name])), [supplierRows]);
  const supplierById = useMemo(
    () => new Map(supplierRows.map((entry) => [entry.id, entry])),
    [supplierRows],
  );

  const productRows = useMemo(() => {
    return (Array.isArray(state.products) ? state.products : [])
      .map((entry) => entry as Record<string, unknown>)
      .map((entry) => ({
        sku: String(entry.sku || ""),
        alias: String(entry.alias || entry.sku || ""),
        supplierId: String(entry.supplierId || ""),
        raw: entry,
      }))
      .filter((entry) => entry.sku);
  }, [state.products]);

  const productBySku = useMemo(() => new Map(productRows.map((entry) => [entry.sku, entry])), [productRows]);

  const canonicalRows = useMemo<PoViewRow[]>(() => {
    const paymentRecords = Array.isArray(state.payments) ? state.payments : [];
    return (Array.isArray(state.pos) ? state.pos : [])
      .map((entry) => {
        const po = entry as Record<string, unknown>;
        const itemMetrics = computePoAggregateMetrics({
          items: po.items,
          orderDate: po.orderDate,
          fxRate: po.fxOverride ?? poSettings.fxRate,
          fallback: po,
        });
        const firstSku = String(itemMetrics.firstSku || po.sku || "");
        const schedule = computeScheduleFromOrderDate({
          orderDate: po.orderDate,
          productionLeadTimeDays: itemMetrics.prodDays || po.prodDays,
          logisticsLeadTimeDays: itemMetrics.transitDays || po.transitDays,
          bufferDays: 0,
        });
        const etdDate = String(po.etdManual || schedule.etdDate || "");
        const etaDate = String(po.etaManual || schedule.etaDate || "");
        const goodsEur = Number(itemMetrics.goodsEur || 0);
        const skuCount = itemMetrics.items.length;
        const itemSkusText = Array.isArray(po.items)
          ? (po.items as Record<string, unknown>[]).map((row) => String(row?.sku || "")).join(" ")
          : "";
        const paymentRows = (() => {
          try {
            const cloned = structuredClone(po);
            return buildPaymentRows(cloned, PO_CONFIG, poSettings, paymentRecords as Record<string, unknown>[]) as PoPaymentRow[];
          } catch {
            return [] as PoPaymentRow[];
          }
        })();
        const timelineMarkers = (() => {
          try {
            const flowRows = sortPaymentRowsByFlow(
              paymentRows
                .map((row) => mapBuiltPaymentRow(row as Record<string, unknown>))
                .filter((row) => row.eventType !== "vat_refund")
                .filter((row) => row.id && row.plannedEur > 0),
            );
            return flowRows
              .map((row): PoTimelineMarkerRow => ({
                id: row.id,
                eventIds: eventIdsOfRow(row),
                typeLabel: row.typeLabel,
                label: row.label,
                dueDate: row.dueDate,
                plannedEur: row.plannedEur,
                status: row.status,
                paidDate: row.paidDate,
                eventType: row.eventType,
                direction: row.direction || "out",
              }))
              .sort((left, right) => {
                const dateCompare = String(left.dueDate || "").localeCompare(String(right.dueDate || ""));
                if (dateCompare !== 0) return dateCompare;
                const rankCompare = timelineMarkerSortRank(left) - timelineMarkerSortRank(right);
                if (rankCompare !== 0) return rankCompare;
                return String(left.label || "").localeCompare(String(right.label || ""));
              });
          } catch {
            return [] as PoTimelineMarkerRow[];
          }
        })();
        const paidEur = paymentRows
          .filter((row) => row.status === "paid")
          .reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
        const openEur = paymentRows
          .filter((row) => row.status !== "paid")
          .reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
        const statusText: PoViewRow["statusText"] = openEur <= 0 && paidEur > 0
          ? "paid_only"
          : (openEur > 0 && paidEur > 0 ? "mixed" : "open");
        return {
          id: String(po.id || ""),
          poNo: String(po.poNo || ""),
          sku: firstSku,
          alias: productBySku.get(firstSku)?.alias || firstSku || "—",
          skuCount,
          supplierName: supplierNameById.get(String(po.supplierId || "")) || "—",
          orderDate: po.orderDate ? String(po.orderDate) : null,
          productionEndDate: schedule.productionEndDate ? String(schedule.productionEndDate) : null,
          etdDate: etdDate || null,
          etaDate: etaDate || null,
          arrivalDate: po.arrivalDate ? String(po.arrivalDate) : null,
          goodsEur,
          openEur,
          paidEur,
          statusText,
          itemSkusText,
          timelineMarkers,
          raw: po,
        } as PoViewRow;
      })
      .sort((a, b) => String(a.poNo || "").localeCompare(String(b.poNo || "")));
  }, [poSettings, productBySku, state.payments, state.pos, supplierNameById]);

  const filteredRows = useMemo<PoViewRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return canonicalRows.filter((row) => {
      const archived = row.raw.archived === true;
      if (archiveFilter === "active" && archived) return false;
      if (archiveFilter === "archived" && !archived) return false;
      if (paymentStatusFilter !== "all" && row.statusText !== paymentStatusFilter) return false;
      if (onlyOpenPayments && row.openEur <= 0) return false;
      if (!needle) return true;
      return [
        row.poNo,
        row.sku,
        row.alias,
        row.supplierName,
        row.itemSkusText,
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [archiveFilter, canonicalRows, onlyOpenPayments, paymentStatusFilter, search]);

  const timelineStartMonth = useMemo(
    () => determineTimelineStartMonth({ state: stateObj, rows: filteredRows }),
    [filteredRows, stateObj],
  );
  const timelineHorizon = useMemo(() => determineTimelineHorizon(stateObj), [stateObj]);
  const timelineMonths = useMemo(
    () => monthRange(timelineStartMonth, timelineHorizon),
    [timelineHorizon, timelineStartMonth],
  );
  const timelineRange = useMemo<TimelineRange | null>(() => {
    if (!timelineMonths.length) return null;
    const startDate = parseIsoDate(`${timelineMonths[0]}-01`);
    if (!startDate) return null;
    const endDate = new Date(startDate.getTime());
    endDate.setUTCMonth(endDate.getUTCMonth() + timelineHorizon);
    return {
      startMs: startDate.getTime(),
      endMs: endDate.getTime(),
      totalDays: Math.max(1, (endDate.getTime() - startDate.getTime()) / MS_PER_DAY),
    };
  }, [timelineHorizon, timelineMonths]);
  const todayLinePct = useMemo(() => {
    if (!timelineRange) return 0;
    return toTimelinePercent(new Date(), timelineRange);
  }, [timelineRange]);

  function updatePoViewMode(next: "table" | "timeline"): void {
    const params = new URLSearchParams(location.search);
    if (next === "timeline") params.set("view", "timeline");
    else params.delete("view");
    const query = params.toString();
    navigate({
      pathname: location.pathname,
      search: query ? `?${query}` : "",
    }, { replace: true });
  }

  const columns = useMemo<ColumnDef<PoViewRow>[]>(() => [
    { header: "PO", accessorKey: "poNo", meta: { width: 98 } },
    {
      header: "Produkt",
      meta: { width: 260 },
      cell: ({ row }) => (
        row.original.skuCount > 1
          ? (
            <div className="v2-proj-alias">
              <div className="v2-proj-alias-main" title={`${row.original.skuCount} SKUs`}>
                <span>{row.original.skuCount} SKUs</span>
                <Tag className="v2-po-sku-count-tag" style={{ marginInlineStart: 6 }}>Multi-SKU</Tag>
              </div>
              <Text className="v2-proj-sku-secondary" type="secondary" title={row.original.sku}>
                Start-SKU: {row.original.sku}
              </Text>
            </div>
          )
          : <SkuAliasCell alias={row.original.alias} sku={row.original.sku} />
      ),
    },
    { header: "Supplier", accessorKey: "supplierName", meta: { width: 150 } },
    { header: "Order", meta: { width: 112 }, cell: ({ row }) => formatDate(row.original.orderDate) },
    {
      header: "ETD / ETA",
      meta: { width: 162, sortAccessor: etaSortValue },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>ETD {formatDate(row.original.etdDate)}</Text>
          <Text type="secondary">ETA {formatDate(row.original.etaDate)}</Text>
        </Space>
      ),
    },
    {
      header: "Warenwert",
      meta: { width: 130, align: "right" },
      cell: ({ row }) => formatCurrency(row.original.goodsEur),
    },
    {
      header: "Open / Paid",
      meta: { width: 160, align: "right" },
      cell: ({ row }) => (
        <Space direction="vertical" size={0}>
          <Text>Open: {formatCurrency(row.original.openEur)}</Text>
          <Text type="secondary">Paid: {formatCurrency(row.original.paidEur)}</Text>
        </Space>
      ),
    },
    {
      header: "Status",
      meta: { width: 110 },
      cell: ({ row }) => statusTag(row.original.statusText),
    },
    {
      header: "Aktionen",
      meta: { width: 190, minWidth: 190 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button size="small" onClick={() => openEditModal(row.original.raw)}>Bearbeiten</Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "PO loeschen?",
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.pos = (Array.isArray(next.pos) ? next.pos : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    return next;
                  }, "v2:po:delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </div>
      ),
    },
  ], [saveWith]);

  const draftValues = Form.useWatch([], form) as PoFormValues | undefined;
  const selectedSupplierId = Form.useWatch("supplierId", form) as string | undefined;
  const draftItems = useMemo(
    () => normalizePoItems(draftValues?.items, null).map((row) => normalizeDraftItem(row)),
    [draftValues?.items],
  );

  const draftPoRecord = useMemo(() => {
    if (!draftValues) return null;
    const existing = editingId ? canonicalRows.find((row) => row.id === editingId)?.raw || null : null;
    return toPoRecord({ ...draftValues, items: draftItems }, existing);
  }, [canonicalRows, draftItems, draftValues, editingId]);

  const draftAggregate = useMemo(() => {
    return computePoAggregateMetrics({
      items: draftItems,
      orderDate: draftValues?.orderDate,
      fxRate: draftValues?.fxOverride ?? poSettings.fxRate,
      fallback: draftItems.length ? draftPoRecord : null,
    });
  }, [draftItems, draftPoRecord, draftValues?.fxOverride, draftValues?.orderDate, poSettings.fxRate]);

  const primaryDraftItem = draftItems[0] || null;
  const primaryDraftProduct = useMemo(() => {
    if (!primaryDraftItem?.sku) return null;
    return productBySku.get(primaryDraftItem.sku)?.raw || null;
  }, [primaryDraftItem?.sku, productBySku]);

  const poHierarchy = useMemo(() => {
    return resolveMasterDataHierarchy({
      state: stateObj,
      product: primaryDraftProduct || undefined,
      sku: String(primaryDraftItem?.sku || ""),
      supplierId: String(draftValues?.supplierId || primaryDraftProduct?.supplierId || ""),
      orderContext: "po",
      orderOverrides: {
        unitCostUsd: primaryDraftItem?.unitCostUsd,
        prodDays: primaryDraftItem?.prodDays,
        transitDays: primaryDraftItem?.transitDays,
        dutyRatePct: draftValues?.dutyRatePct,
        eustRatePct: draftValues?.eustRatePct,
        ddp: draftValues?.ddp,
        incoterm: draftValues?.ddp ? "DDP" : "EXW",
      },
    });
  }, [
    draftValues?.ddp,
    draftValues?.dutyRatePct,
    draftValues?.eustRatePct,
    draftValues?.supplierId,
    primaryDraftItem?.prodDays,
    primaryDraftItem?.sku,
    primaryDraftItem?.transitDays,
    primaryDraftItem?.unitCostUsd,
    primaryDraftProduct,
    stateObj,
  ]);

  const poHierarchyBase = useMemo(() => {
    return resolveMasterDataHierarchy({
      state: stateObj,
      product: primaryDraftProduct || undefined,
      sku: String(primaryDraftItem?.sku || ""),
      supplierId: String(draftValues?.supplierId || primaryDraftProduct?.supplierId || ""),
      orderContext: "po",
    });
  }, [draftValues?.supplierId, primaryDraftItem?.sku, primaryDraftProduct, stateObj]);

  const poBlockingPrimary = useMemo(() => {
    return evaluateOrderBlocking({
      product: primaryDraftProduct,
      state: stateObj,
      supplierId: String(draftValues?.supplierId || primaryDraftProduct?.supplierId || ""),
      orderContext: "po",
      orderOverrides: {
        unitCostUsd: primaryDraftItem?.unitCostUsd,
        prodDays: primaryDraftItem?.prodDays,
        transitDays: primaryDraftItem?.transitDays,
        dutyRatePct: draftValues?.dutyRatePct,
        eustRatePct: draftValues?.eustRatePct,
        ddp: draftValues?.ddp,
        incoterm: draftValues?.ddp ? "DDP" : "EXW",
      },
    });
  }, [
    draftValues?.ddp,
    draftValues?.dutyRatePct,
    draftValues?.eustRatePct,
    draftValues?.supplierId,
    primaryDraftItem?.prodDays,
    primaryDraftItem?.transitDays,
    primaryDraftItem?.unitCostUsd,
    primaryDraftProduct,
    stateObj,
  ]);

  function resetPrimaryPoField(field: "unitCostUsd" | "prodDays" | "transitDays" | "dutyRatePct" | "eustRatePct" | "ddp"): void {
    if (!primaryDraftItem) return;
    const currentItems = normalizePoItems(form.getFieldValue("items"), null).map((entry) => normalizeDraftItem(entry));
    const index = currentItems.findIndex((entry) => entry.id === primaryDraftItem.id);
    if (field === "unitCostUsd" && index >= 0) {
      currentItems[index] = { ...currentItems[index], unitCostUsd: Number(poHierarchyBase.fields.unitPriceUsd.value || 0) };
      form.setFieldValue("items", currentItems);
      return;
    }
    if (field === "prodDays" && index >= 0) {
      currentItems[index] = { ...currentItems[index], prodDays: Math.round(Number(poHierarchyBase.fields.productionLeadTimeDays.value || 0)) };
      form.setFieldValue("items", currentItems);
      return;
    }
    if (field === "transitDays" && index >= 0) {
      currentItems[index] = { ...currentItems[index], transitDays: Math.round(Number(poHierarchyBase.fields.transitDays.value || 0)) };
      form.setFieldValue("items", currentItems);
      return;
    }
    if (field === "dutyRatePct") {
      form.setFieldValue("dutyRatePct", Number(poHierarchyBase.fields.dutyRatePct.value || 0));
      return;
    }
    if (field === "eustRatePct") {
      form.setFieldValue("eustRatePct", Number(poHierarchyBase.fields.eustRatePct.value || 0));
      return;
    }
    form.setFieldValue("ddp", poHierarchyBase.fields.ddp.value === true);
  }

  function adoptPoFieldToProduct(field: "unitPriceUsd" | "productionLeadTimeDays" | "transitDays" | "dutyRatePct" | "eustRatePct" | "ddp", value: unknown): void {
    const sku = String(primaryDraftItem?.sku || "").trim();
    if (!sku) return;
    Modal.confirm({
      title: "Als neuen Produkt-Stammdatenwert uebernehmen?",
      content: `SKU ${sku}: Wert wird in den Produktstammdaten gespeichert.`,
      okText: "Uebernehmen",
      cancelText: "Abbrechen",
      onOk: () => {
        Modal.confirm({
          title: "Bist du sicher?",
          content: "Diese Aenderung beeinflusst zukuenftige FO/PO Prefills.",
          okText: "Ja, speichern",
          cancelText: "Nein",
          onOk: async () => {
            await saveWith((current) => {
              const next = ensureAppStateV2(current);
              const products = Array.isArray(next.products) ? [...next.products] : [];
              const index = products.findIndex((entry) => String((entry as Record<string, unknown>).sku || "").trim().toLowerCase() === sku.toLowerCase());
              if (index < 0) return next;
              const base = products[index] as Record<string, unknown>;
              products[index] = {
                ...applyAdoptedFieldToProduct({
                  product: base,
                  field,
                  value,
                }),
                updatedAt: nowIso(),
              };
              next.products = products;
              return next;
            }, "v2:po:adopt-masterdata");
            message.success("Produkt-Stammdaten aktualisiert.");
          },
        });
      },
    });
  }

  const supplierSkuOptions = useMemo(() => {
    const supplierId = String(selectedSupplierId || "");
    if (!supplierId) return [];
    const taken = new Set(draftItems.map((item) => item.sku));
    return productRows
      .filter((product) => product.supplierId === supplierId)
      .map((product) => ({
        value: product.sku,
        label: `${product.alias} (${product.sku})`,
        disabled: taken.has(product.sku),
      }));
  }, [draftItems, productRows, selectedSupplierId]);

  const itemValidationWarnings = useMemo(() => {
    const warnings: string[] = [];
    draftItems.forEach((item) => {
      const reasons: string[] = [];
      if (item.units <= 0) reasons.push("Units <= 0");
      if (item.unitCostUsd <= 0) reasons.push("Unit Cost fehlt");
      if (item.prodDays <= 0) reasons.push("Prod Days fehlen");
      if (item.transitDays <= 0) reasons.push("Transit Days fehlen");
      if (reasons.length) warnings.push(`${item.sku || "SKU?"}: ${reasons.join(", ")}`);
    });
    return warnings;
  }, [draftItems]);

  const draftPaymentRowsRaw = useMemo<PoPaymentRow[]>(() => {
    if (!draftPoRecord) return [];
    try {
      const cloned = structuredClone(draftPoRecord);
      const rows = buildPaymentRows(
        cloned,
        PO_CONFIG,
        poSettings,
        (Array.isArray(state.payments) ? state.payments : []) as Record<string, unknown>[],
      );
      return rows
        .map((row) => mapBuiltPaymentRow(row as Record<string, unknown>))
        .filter((row) => row.direction !== "in")
        .filter((row) => row.id && row.plannedEur > 0);
    } catch {
      return [];
    }
  }, [draftPoRecord, poSettings, state.payments]);

  const draftIncomingPaymentRows = useMemo<PoPaymentRow[]>(() => {
    if (!draftPoRecord) return [];
    try {
      const cloned = structuredClone(draftPoRecord);
      const rows = buildPaymentRows(
        cloned,
        PO_CONFIG,
        poSettings,
        (Array.isArray(state.payments) ? state.payments : []) as Record<string, unknown>[],
        { includeIncoming: true },
      );
      return rows
        .map((row) => mapBuiltPaymentRow(row as Record<string, unknown>))
        .filter((row) => row.eventType === "vat_refund" || row.direction === "in")
        .filter((row) => row.id && row.plannedEur > 0)
        .sort((left, right) => String(left.dueDate || "").localeCompare(String(right.dueDate || "")));
    } catch {
      return [];
    }
  }, [draftPoRecord, poSettings, state.payments]);

  const draftPaymentRows = useMemo<PoPaymentRow[]>(
    () => sortPaymentRowsByFlow(draftPaymentRowsRaw),
    [draftPaymentRowsRaw],
  );

  useEffect(() => {
    if (!markerPendingAction || !modalOpen) return;
    if (editingId !== markerPendingAction.poId) return;
    if (!draftPoRecord) return;
    const markerRow = draftPaymentRows.find((row) => row.id === markerPendingAction.eventId) || null;
    if (markerRow) {
      openPaymentBookingModal(markerRow);
      setMarkerPendingAction(null);
      return;
    }
    setModalFocusTarget("payments");
    setMarkerPendingAction(null);
  }, [draftPaymentRows, draftPoRecord, editingId, markerPendingAction, modalOpen]);

  useEffect(() => {
    if (!modalOpen || !modalFocusTarget) return;
    const focusWithScroll = (element: HTMLElement | null): void => {
      if (!element) return;
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.focus();
    };
    const frame = window.requestAnimationFrame(() => {
      if (modalFocusTarget === "payments") {
        const section = paymentSectionRef.current;
        if (section) {
          section.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setModalFocusTarget(null);
        return;
      }
      if (modalFocusTarget === "shipping") {
        focusWithScroll(document.getElementById("v2-po-etd-manual"));
        setModalFocusTarget(null);
        return;
      }
      if (modalFocusTarget === "arrival") {
        focusWithScroll(document.getElementById("v2-po-arrival-date"));
        setModalFocusTarget(null);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [modalFocusTarget, modalOpen]);

  const paymentRecordById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    (Array.isArray(state.payments) ? state.payments : []).forEach((entry) => {
      const row = entry as Record<string, unknown>;
      const id = String(row.id || "").trim();
      if (!id) return;
      map.set(id, row);
    });
    return map;
  }, [state.payments]);

  const payerOptions = useMemo(
    () => paymentPayerOptions({ displayNameMap, syncEmail: syncSession.email }),
    [displayNameMap, syncSession.email],
  );
  const methodOptions = useMemo(() => paymentMethodOptions(), []);
  const paymentSelectedIds = Form.useWatch("selectedEventIds", paymentForm) as string[] | undefined;
  const paymentDraftValues = Form.useWatch([], paymentForm) as PoPaymentFormValues | undefined;
  const paymentSelectedRows = useMemo(() => {
    const selected = new Set((paymentSelectedIds || []).map((entry) => String(entry || "")));
    return draftPaymentRows.filter((entry) => selected.has(entry.id));
  }, [draftPaymentRows, paymentSelectedIds]);
  const suggestedPaymentFilename = useMemo(() => {
    if (!draftPoRecord || !paymentDraftValues) return "";
    const items = normalizePoItems(draftPoRecord.items, draftPoRecord);
    const firstSku = String(items[0]?.sku || draftPoRecord.sku || "");
    const itemCount = items.length;
    const alias = itemCount > 1
      ? `Multi-SKU-${itemCount}`
      : (productBySku.get(firstSku)?.alias || firstSku || "Alias");
    return buildSuggestedInvoiceFilename({
      paidDate: paymentDraftValues.paidDate,
      poNo: String(draftPoRecord.poNo || ""),
      alias,
      units: Number(draftPoRecord.units || 0),
      selectedRows: paymentSelectedRows,
    });
  }, [draftPoRecord, paymentDraftValues, paymentSelectedRows, productBySku]);

  useEffect(() => {
    if (!modalOpen || !modalCollab.readOnly || !modalCollab.remoteDraftPatch) return;
    form.setFieldsValue(modalCollab.remoteDraftPatch as Partial<PoFormValues>);
  }, [form, modalCollab.readOnly, modalCollab.remoteDraftPatch, modalCollab.remoteDraftVersion, modalOpen]);

  function withSuppressedFreightTracking(action: () => void): void {
    suppressFreightTrackingRef.current = true;
    action();
    Promise.resolve().then(() => {
      suppressFreightTrackingRef.current = false;
    });
  }

  function pruneFreightOverrideIds(items: PoItemDraft[]): void {
    const validIds = new Set(items.map((item) => String(item.id || "").trim()).filter(Boolean));
    Array.from(manualFreightOverrideIdsRef.current).forEach((id) => {
      if (!validIds.has(id)) {
        manualFreightOverrideIdsRef.current.delete(id);
      }
    });
  }

  function trackFreightOverrides(changedValues: Partial<PoFormValues>): void {
    if (suppressFreightTrackingRef.current) return;
    const changedItems = Array.isArray(changedValues.items)
      ? changedValues.items as Array<Record<string, unknown> | undefined>
      : null;
    if (!changedItems?.length) return;
    const currentItems = normalizePoItems(form.getFieldValue("items"), null).map((entry) => normalizeDraftItem(entry));
    pruneFreightOverrideIds(currentItems);
    changedItems.forEach((row, index) => {
      if (!row) return;
      const itemId = String(currentItems[index]?.id || "").trim();
      if (!itemId) return;
      if (Object.prototype.hasOwnProperty.call(row, "sku")) {
        manualFreightOverrideIdsRef.current.delete(itemId);
      }
      if (Object.prototype.hasOwnProperty.call(row, "freightEur")) {
        manualFreightOverrideIdsRef.current.add(itemId);
      }
    });
  }

  function buildDefaultDraft(
    existing?: Record<string, unknown> | null,
    prefill?: PoCreatePrefill,
  ): PoFormValues {
    const prefillSku = String(prefill?.sku || "").trim();
    const prefillUnits = Math.max(0, Math.round(Number(prefill?.units || 0)));
    const seedSupplierFromSku = prefillSku ? String(productBySku.get(prefillSku)?.supplierId || "") : "";
    const supplierId = String(
      prefill?.supplierId
      || existing?.supplierId
      || seedSupplierFromSku
      || supplierRows[0]?.id
      || "",
    );
    const supplier = supplierById.get(supplierId) || null;
    const existingItems = normalizePoItems(existing?.items, existing).map((entry) => normalizeDraftItem(entry));
    const prefillItems = normalizePoItems(prefill?.items, null).map((entry) => normalizeDraftItem(entry));
    let seedItems = prefillItems.length ? prefillItems : existingItems;
    if (!seedItems.length && prefillSku) {
      const product = productBySku.get(prefillSku) || null;
      const defaults = resolvePoProductPrefill({
        state: stateObj,
        product: product?.raw || null,
        settings,
        supplierId,
        supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
        units: prefillUnits,
      });
      seedItems = [normalizeDraftItem({
        id: randomId("poi"),
        sku: prefillSku,
        units: prefillUnits,
        unitCostUsd: defaults.unitCostUsd,
        unitExtraUsd: defaults.unitExtraUsd,
        extraFlatUsd: defaults.extraFlatUsd,
        prodDays: defaults.prodDays,
        transitDays: defaults.transitDays,
        freightEur: defaults.freightEur,
      })];
    }
    if (!seedItems.length && existing?.sku) {
      const fallbackSku = String(existing.sku || "").trim();
      const fallbackUnits = Math.max(0, Math.round(Number(existing.units || 0)));
      const product = productBySku.get(fallbackSku) || null;
      const defaults = resolvePoProductPrefill({
        state: stateObj,
        product: product?.raw || null,
        settings,
        supplierId,
        supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
        units: fallbackUnits,
      });
      seedItems = [normalizeDraftItem({
        id: randomId("poi"),
        sku: fallbackSku,
        units: fallbackUnits,
        unitCostUsd: Number(existing.unitCostUsd ?? defaults.unitCostUsd ?? 0),
        unitExtraUsd: Number(existing.unitExtraUsd ?? defaults.unitExtraUsd ?? 0),
        extraFlatUsd: Number(existing.extraFlatUsd ?? defaults.extraFlatUsd ?? 0),
        prodDays: Number(existing.prodDays ?? defaults.prodDays ?? 0),
        transitDays: Number(existing.transitDays ?? defaults.transitDays ?? 0),
        freightEur: Number(existing.freightEur ?? defaults.freightEur ?? 0),
      })];
    }
    const supplierScopedItems = seedItems.filter((item) => {
      if (!supplierId) return true;
      const productSupplierId = String(productBySku.get(item.sku)?.supplierId || "");
      if (!productSupplierId) return true;
      return productSupplierId === supplierId;
    });
    const firstProduct = productBySku.get(String(supplierScopedItems[0]?.sku || prefillSku || existing?.sku || "")) || null;
    const defaults = resolvePoProductPrefill({
      state: stateObj,
      product: firstProduct?.raw || null,
      settings,
      supplierId,
      supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
      units: supplierScopedItems[0]?.units || prefillUnits,
    });
    const supplierMilestones = mapSupplierTermsToPoMilestones(supplier?.raw || null).map((row) => ({
      id: row.id,
      label: row.label,
      percent: row.percent,
      anchor: row.anchor,
      lagDays: row.lagDays,
    }));
    return {
      id: existing?.id ? String(existing.id) : undefined,
      poNo: String(existing?.poNo || ""),
      supplierId,
      orderDate: String(prefill?.orderDate || existing?.orderDate || new Date().toISOString().slice(0, 10)),
      etdManual: String(prefill?.etdManual || existing?.etdManual || ""),
      etaManual: String(prefill?.etaManual || existing?.etaManual || ""),
      arrivalDate: String(prefill?.arrivalDate || existing?.arrivalDate || ""),
      transport: (String(existing?.transport || defaults.transport || "sea").toLowerCase() as "sea" | "rail" | "air"),
      dutyRatePct: Number(existing?.dutyRatePct ?? defaults.dutyRatePct ?? settings.dutyRatePct ?? 0),
      dutyIncludeFreight: existing?.dutyIncludeFreight !== false,
      eustRatePct: Number(existing?.eustRatePct ?? defaults.eustRatePct ?? settings.eustRatePct ?? 0),
      fxOverride: Number(existing?.fxOverride ?? defaults.fxOverride ?? settings.fxRate ?? 0),
      ddp: existing?.ddp === true ? true : Boolean(defaults.ddp),
      archived: existing?.archived === true,
      milestones: Array.isArray(existing?.milestones)
        ? (existing?.milestones as Record<string, unknown>[]).map((row) => ({
          id: String(row.id || randomId("ms")),
          label: String(row.label || "Milestone"),
          percent: Number(row.percent || 0),
          anchor: String(row.anchor || "ORDER_DATE"),
          lagDays: Number(row.lagDays || 0),
        }))
        : (supplierMilestones.length ? supplierMilestones : defaultMilestones()),
      items: supplierScopedItems,
    };
  }

  function applyDefaultsToItem(index: number, skuValue: string): void {
    const sku = String(skuValue || "").trim();
    if (!sku) return;
    const product = productBySku.get(sku) || null;
    if (!product) return;
    const current = form.getFieldsValue();
    const items = normalizePoItems(current.items, null).map((entry) => normalizeDraftItem(entry));
    if (index < 0 || index >= items.length) return;
    const supplierId = String(current.supplierId || product.supplierId || "");
    const supplier = supplierById.get(supplierId) || null;
    const priorItemId = String(items[index]?.id || "").trim();
    const defaults = resolvePoProductPrefill({
      state: stateObj,
      product: product.raw,
      settings,
      supplierId,
      supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
      units: Number(items[index]?.units || 0),
    });
    items[index] = normalizeDraftItem({
      ...items[index],
      sku,
      unitCostUsd: defaults.unitCostUsd,
      unitExtraUsd: defaults.unitExtraUsd,
      extraFlatUsd: defaults.extraFlatUsd,
      prodDays: defaults.prodDays,
      transitDays: defaults.transitDays,
      freightEur: defaults.freightEur,
    });
    const nextItemId = String(items[index]?.id || "").trim();
    if (priorItemId) manualFreightOverrideIdsRef.current.delete(priorItemId);
    if (nextItemId) manualFreightOverrideIdsRef.current.delete(nextItemId);
    pruneFreightOverrideIds(items);
    withSuppressedFreightTracking(() => {
      form.setFieldsValue({
        items,
        supplierId: supplierId || current.supplierId,
        transport: current.transport || defaults.transport,
        dutyRatePct: Number(current.dutyRatePct || defaults.dutyRatePct || 0),
        eustRatePct: Number(current.eustRatePct || defaults.eustRatePct || 0),
        fxOverride: Number(current.fxOverride || defaults.fxOverride || 0),
        ddp: current.ddp === true ? true : defaults.ddp,
      });
    });
  }

  function addSkusToDraft(skus: string[]): void {
    const current = form.getFieldsValue();
    const currentItems = normalizePoItems(current.items, null).map((entry) => normalizeDraftItem(entry));
    const bySku = new Set(currentItems.map((item) => item.sku));
    const supplierId = String(current.supplierId || "");
    const supplier = supplierById.get(supplierId) || null;
    const additions: PoItemDraft[] = [];
    skus.forEach((sku) => {
      const cleanSku = String(sku || "").trim();
      if (!cleanSku || bySku.has(cleanSku)) return;
      const product = productBySku.get(cleanSku);
      if (!product || String(product.supplierId || "") !== supplierId) return;
      const defaults = resolvePoProductPrefill({
        state: stateObj,
        product: product.raw,
        settings,
        supplierId,
        supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
        units: 0,
      });
      additions.push(normalizeDraftItem({
        id: randomId("poi"),
        sku: cleanSku,
        units: 0,
        unitCostUsd: defaults.unitCostUsd,
        unitExtraUsd: defaults.unitExtraUsd,
        extraFlatUsd: defaults.extraFlatUsd,
        prodDays: defaults.prodDays,
        transitDays: defaults.transitDays,
        freightEur: defaults.freightEur,
      }));
    });
    if (!additions.length) return;
    const nextItems = [...currentItems, ...additions];
    pruneFreightOverrideIds(nextItems);
    withSuppressedFreightTracking(() => {
      form.setFieldsValue({
        items: nextItems,
        transport: current.transport || resolvePoProductPrefill({
          state: stateObj,
          product: productBySku.get(additions[0].sku)?.raw || null,
          settings,
          supplierId,
          supplierDefaultProdDays: supplier?.productionLeadTimeDaysDefault,
          units: additions[0].units,
        }).transport,
      });
    });
    setSkuPickerValues([]);
  }

  function onSupplierChange(nextSupplierId: string): void {
    const supplierId = String(nextSupplierId || "");
    const current = form.getFieldsValue();
    const currentItems = normalizePoItems(current.items, null).map((entry) => normalizeDraftItem(entry));
    const filteredItems = currentItems.filter((item) => {
      const productSupplierId = String(productBySku.get(item.sku)?.supplierId || "");
      if (!productSupplierId) return true;
      return productSupplierId === supplierId;
    });
    if (currentItems.length !== filteredItems.length) {
      message.info(`${currentItems.length - filteredItems.length} SKU(s) wurden entfernt, da sie nicht zum Lieferanten passen.`);
    }
    const supplier = supplierById.get(supplierId) || null;
    const supplierMilestones = mapSupplierTermsToPoMilestones(supplier?.raw || null).map((row) => ({
      id: row.id,
      label: row.label,
      percent: row.percent,
      anchor: row.anchor,
      lagDays: row.lagDays,
    }));
    const shouldReplaceMilestones = !editingId && (!Array.isArray(current.milestones) || milestoneSum(current.milestones) === milestoneSum(defaultMilestones()));
    manualFreightOverrideIdsRef.current.clear();
    withSuppressedFreightTracking(() => {
      form.setFieldsValue({
        supplierId,
        items: filteredItems,
        milestones: shouldReplaceMilestones
          ? (supplierMilestones.length ? supplierMilestones : defaultMilestones())
          : current.milestones,
      });
    });
    setSkuPickerValues([]);
  }

  function openCreateModal(prefill?: PoCreatePrefill, options?: { preserveReturnContext?: boolean }): void {
    setEditingId(null);
    setModalFocusTarget(null);
    if (!options?.preserveReturnContext) {
      setReturnContext(null);
    }
    const draft = buildDefaultDraft(null, prefill);
    manualFreightOverrideIdsRef.current.clear();
    withSuppressedFreightTracking(() => {
      form.resetFields();
      form.setFieldsValue({
        ...draft,
        ...(prefill || {}),
      });
    });
    setSkuPickerValues([]);
    setModalOpen(true);
  }

  function openEditModal(
    existing: Record<string, unknown>,
    focusTarget: "payments" | "shipping" | "arrival" | null = null,
    options?: { preserveReturnContext?: boolean },
  ): void {
    setEditingId(String(existing.id || ""));
    setModalFocusTarget(focusTarget);
    if (!options?.preserveReturnContext) {
      setReturnContext(null);
    }
    manualFreightOverrideIdsRef.current.clear();
    withSuppressedFreightTracking(() => {
      form.resetFields();
      form.setFieldsValue(buildDefaultDraft(existing));
    });
    setSkuPickerValues([]);
    setModalOpen(true);
  }

  function hydrateFreightFromMasterData(changedValues: Partial<PoFormValues>): void {
    const changedItems = Array.isArray(changedValues.items)
      ? changedValues.items as Array<Record<string, unknown> | undefined>
      : null;
    if (!changedItems?.length) return;
    const hasRecalcTrigger = changedItems.some((row) => row && (
      Object.prototype.hasOwnProperty.call(row, "units")
      || Object.prototype.hasOwnProperty.call(row, "sku")
    ));
    if (!hasRecalcTrigger) return;

    const current = form.getFieldsValue();
    const supplierId = String(current.supplierId || "");
    const currentItems = normalizePoItems(current.items, null).map((entry) => normalizeDraftItem(entry));
    pruneFreightOverrideIds(currentItems);
    let patched = false;
    const nextItems = currentItems.map((item, index) => {
      const changedRow = changedItems[index];
      const touchedUnits = Boolean(changedRow && Object.prototype.hasOwnProperty.call(changedRow, "units"));
      const touchedSku = Boolean(changedRow && Object.prototype.hasOwnProperty.call(changedRow, "sku"));
      if (!touchedUnits && !touchedSku) return item;
      const itemId = String(item.id || "").trim();
      if (touchedSku && itemId) {
        manualFreightOverrideIdsRef.current.delete(itemId);
      }
      if (!item.sku) return item;
      if (itemId && manualFreightOverrideIdsRef.current.has(itemId)) return item;
      const product = productBySku.get(item.sku) || null;
      if (!product) return item;
      const estimated = estimatePoItemFreightEur({
        state: stateObj,
        product: product.raw,
        supplierId: supplierId || product.supplierId,
        units: item.units,
      });
      if (Math.abs(Number(item.freightEur || 0) - estimated) <= 0.0001) return item;
      patched = true;
      return {
        ...item,
        freightEur: estimated,
      };
    });
    if (patched) {
      withSuppressedFreightTracking(() => {
        form.setFieldValue("items", nextItems);
      });
    }
  }

  function openTimelinePayment(row: PoViewRow, marker: PoTimelineMarkerRow): void {
    setMarkerPendingAction({ poId: row.id, eventId: marker.id });
    openEditModal(row.raw, "payments");
  }

  function openPaymentBookingModal(seed?: PoPaymentRow | null): void {
    if (!editingId) {
      message.info("Bitte PO zuerst speichern, danach koennen Zahlungen verbucht werden.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const fromSeed = seed || null;
    const fromPaymentId = fromSeed?.paymentId || null;
    const selectedRows = fromPaymentId
      ? draftPaymentRows.filter((entry) => entry.paymentId === fromPaymentId)
      : (fromSeed ? [fromSeed] : draftPaymentRows.filter((entry) => entry.status !== "paid"));
    const selectedRowIds = selectedRows.map((entry) => entry.id);
    const selectedEventIds = Array.from(new Set(selectedRows.flatMap((entry) => eventIdsOfRow(entry))));
    const plannedSum = selectedRows.reduce((sum, entry) => sum + Number(entry.plannedEur || 0), 0);
    const paymentRecord = fromPaymentId ? (paymentRecordById.get(fromPaymentId) || null) : null;
    const requestedPaymentId = String(
      paymentRecord?.id
      || fromPaymentId
      || normalizePaymentId(randomId("pay"))
      || randomId("pay"),
    );
    paymentForm.setFieldsValue({
      selectedEventIds: selectedRowIds,
      paidDate: String(paymentRecord?.paidDate || fromSeed?.paidDate || today),
      method: String(paymentRecord?.method || fromSeed?.method || "Alibaba Trade Assurance"),
      paidBy: String(paymentRecord?.payer || fromSeed?.paidBy || ownDisplayName || syncSession.email || ""),
      amountActualEur: Number.isFinite(Number(paymentRecord?.amountActualEurTotal))
        ? Number(paymentRecord?.amountActualEurTotal)
        : Math.round(plannedSum * 100) / 100,
      amountActualUsd: Number.isFinite(Number(paymentRecord?.amountActualUsdTotal))
        ? Number(paymentRecord?.amountActualUsdTotal)
        : null,
      paymentId: requestedPaymentId,
      invoiceDriveUrl: String(paymentRecord?.invoiceDriveUrl || fromSeed?.invoiceDriveUrl || ""),
      invoiceFolderDriveUrl: String(paymentRecord?.invoiceFolderDriveUrl || fromSeed?.invoiceFolderDriveUrl || ""),
      note: String(paymentRecord?.note || fromSeed?.note || ""),
    });
    setPaymentInitialEventIds(selectedEventIds);
    setPaymentEditingId(paymentRecord?.id ? String(paymentRecord.id) : null);
    setPaymentModalError(null);
    setPaymentModalOpen(true);
  }

  async function savePaymentBooking(values: PoPaymentFormValues): Promise<void> {
    if (modalCollab.readOnly) throw new Error("Nur Lesemodus: keine Zahlungen speichern.");
    if (!editingId) throw new Error("PO muss zuerst gespeichert werden.");
    const selectedRowIds = Array.from(new Set((values.selectedEventIds || []).map((entry) => String(entry || "").trim()).filter(Boolean)));
    if (!selectedRowIds.length) throw new Error("Bitte mindestens einen Zahlungsbaustein auswaehlen.");
    if (!values.paidDate) throw new Error("Bitte ein Zahlungsdatum setzen.");
    if (!values.method.trim()) throw new Error("Bitte eine Zahlungsmethode waehlen.");
    if (!values.paidBy.trim()) throw new Error("Bitte angeben, wer gezahlt hat.");
    const amountActualEur = Number(values.amountActualEur);
    if (!Number.isFinite(amountActualEur) || amountActualEur < 0) {
      throw new Error("Bitte einen gueltigen Ist-Betrag in EUR eingeben.");
    }
    if (values.invoiceDriveUrl && !isHttpUrl(values.invoiceDriveUrl)) {
      throw new Error("Invoice-Link muss mit http:// oder https:// beginnen.");
    }
    if (values.invoiceFolderDriveUrl && !isHttpUrl(values.invoiceFolderDriveUrl)) {
      throw new Error("Folder-Link muss mit http:// oder https:// beginnen.");
    }

    const paymentId = String(normalizePaymentId(values.paymentId) || normalizePaymentId(randomId("pay")) || randomId("pay"));
    const selectedDisplayRows = draftPaymentRows.filter((entry) => selectedRowIds.includes(entry.id));
    const selectedIds = Array.from(new Set(selectedDisplayRows.flatMap((entry) => eventIdsOfRow(entry))));
    if (!selectedIds.length) throw new Error("Bitte mindestens einen gueltigen Zahlungsbaustein auswaehlen.");
    const selectedRows = draftPaymentRowsRaw.filter((entry) => selectedIds.includes(entry.id));
    const allocations = allocatePayment(amountActualEur, selectedRows.map((row) => ({ id: row.id, plannedEur: row.plannedEur })));
    if (!allocations || !allocations.length) throw new Error("Konnte die Zahlung nicht auf die gewaehlten Bausteine verteilen.");

    const amountActualUsdRaw = Number(values.amountActualUsd);
    const amountActualUsd = Number.isFinite(amountActualUsdRaw) ? amountActualUsdRaw : null;
    const plannedSum = selectedRows.reduce((sum, row) => sum + Number(row.plannedEur || 0), 0);
    const usdAllocations = amountActualUsd != null && plannedSum > 0
      ? selectedRows.map((row) => {
        const share = Number(row.plannedEur || 0) / plannedSum;
        return {
          eventId: row.id,
          actual: Math.round(amountActualUsd * share * 100) / 100,
        };
      })
      : [];
    const usdByEvent = new Map(usdAllocations.map((entry) => [entry.eventId, entry.actual]));

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const pos = Array.isArray(next.pos) ? [...next.pos] : [];
      const index = pos.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === editingId);
      if (index < 0) throw new Error("PO nicht gefunden.");
      const record = { ...(pos[index] as Record<string, unknown>) };
      const paymentLog = (record.paymentLog && typeof record.paymentLog === "object")
        ? { ...(record.paymentLog as Record<string, Record<string, unknown>>) }
        : {};
      const oldPaymentId = paymentEditingId ? String(paymentEditingId) : null;

      paymentInitialEventIds.forEach((eventId) => {
        if (selectedIds.includes(eventId)) return;
        const prev = (paymentLog[eventId] && typeof paymentLog[eventId] === "object")
          ? { ...(paymentLog[eventId] as Record<string, unknown>) }
          : {};
        paymentLog[eventId] = {
          ...prev,
          status: "open",
          paidDate: null,
          paymentId: null,
          amountActualEur: null,
          amountActualUsd: null,
          method: null,
          payer: null,
          note: null,
        };
      });

      allocations.forEach((entry) => {
        const prev = (paymentLog[entry.eventId] && typeof paymentLog[entry.eventId] === "object")
          ? { ...(paymentLog[entry.eventId] as Record<string, unknown>) }
          : {};
        paymentLog[entry.eventId] = {
          ...prev,
          paymentInternalId: String(prev.paymentInternalId || randomId("payrow")),
          status: "paid",
          paidDate: values.paidDate,
          paymentId,
          amountActualEur: Number(entry.actual || 0),
          amountActualUsd: usdByEvent.get(entry.eventId) ?? null,
          method: values.method.trim(),
          payer: values.paidBy.trim(),
          note: values.note?.trim() || null,
        };
      });

      record.paymentLog = paymentLog;
      record.updatedAt = nowIso();
      pos[index] = record;
      next.pos = pos;

      const payments = Array.isArray(next.payments) ? [...next.payments] : [];
      const duplicateIndex = payments.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === paymentId);
      if (duplicateIndex >= 0 && (!oldPaymentId || String((payments[duplicateIndex] as Record<string, unknown>).id || "") !== oldPaymentId)) {
        const currentCovered = new Set((payments[duplicateIndex] as Record<string, unknown>).coveredEventIds as string[] || []);
        const overlap = selectedIds.some((eventId) => currentCovered.has(eventId));
        if (!overlap && paymentId !== oldPaymentId) {
          throw new Error(`Payment-ID ${paymentId} ist bereits vergeben.`);
        }
      }
      const payload: Record<string, unknown> = {
        id: paymentId,
        paidDate: values.paidDate,
        method: values.method.trim(),
        payer: values.paidBy.trim(),
        currency: "EUR",
        amountActualEurTotal: amountActualEur,
        amountActualUsdTotal: amountActualUsd,
        coveredEventIds: selectedIds,
        note: values.note?.trim() || null,
        invoiceDriveUrl: values.invoiceDriveUrl?.trim() || "",
        invoiceFolderDriveUrl: values.invoiceFolderDriveUrl?.trim() || "",
      };
      const upsertIndex = payments.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === paymentId);
      if (upsertIndex >= 0) payments[upsertIndex] = { ...(payments[upsertIndex] as Record<string, unknown>), ...payload };
      else payments.push(payload);
      next.payments = payments;
      return next;
    }, "v2:po:payment-booking");

    setPaymentModalOpen(false);
    setPaymentEditingId(null);
    setPaymentInitialEventIds([]);
    setPaymentModalError(null);
    paymentForm.resetFields();
    message.success("Zahlung wurde gespeichert.");
  }

  async function savePo(values: PoFormValues, forceAfterPaidWarning = false): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Diese PO wird gerade von einem anderen Nutzer bearbeitet.");
    }
    if (!values.poNo.trim()) {
      throw new Error("PO Nummer ist erforderlich.");
    }
    const normalizedItems = normalizePoItems(values.items, null).map((entry) => normalizeDraftItem(entry));
    if (!normalizedItems.length) {
      throw new Error("Bitte mindestens eine SKU in der PO erfassen.");
    }
    const supplierId = String(values.supplierId || "").trim();
    if (!supplierId) {
      throw new Error("Bitte einen Lieferanten auswaehlen.");
    }
    const supplierMismatch = normalizedItems.find((item) => String(productBySku.get(item.sku)?.supplierId || "") !== supplierId);
    if (supplierMismatch) {
      throw new Error(`SKU ${supplierMismatch.sku} gehoert nicht zum gewaehlten Lieferanten.`);
    }
    const invalidItem = normalizedItems.find((item) => (
      item.units <= 0
      || item.unitCostUsd <= 0
      || item.prodDays <= 0
      || item.transitDays <= 0
    ));
    if (invalidItem) {
      throw new Error(`SKU ${invalidItem.sku} ist unvollstaendig. Bitte Units, Unit Cost, Prod Days und Transit Days pflegen.`);
    }
    const hierarchyBlock = normalizedItems.find((item) => {
      const product = productBySku.get(item.sku)?.raw || null;
      if (!product) return false;
      const result = evaluateOrderBlocking({
        product,
        state: stateObj,
        supplierId,
        orderContext: "po",
        orderOverrides: {
          unitCostUsd: item.unitCostUsd,
          prodDays: item.prodDays,
          transitDays: item.transitDays,
          dutyRatePct: values.dutyRatePct,
          eustRatePct: values.eustRatePct,
          ddp: values.ddp,
          incoterm: values.ddp ? "DDP" : "EXW",
        },
      });
      return result.blocked;
    });
    if (hierarchyBlock) {
      const product = productBySku.get(hierarchyBlock.sku)?.raw || null;
      const result = evaluateOrderBlocking({
        product,
        state: stateObj,
        supplierId,
        orderContext: "po",
        orderOverrides: {
          unitCostUsd: hierarchyBlock.unitCostUsd,
          prodDays: hierarchyBlock.prodDays,
          transitDays: hierarchyBlock.transitDays,
          dutyRatePct: values.dutyRatePct,
          eustRatePct: values.eustRatePct,
          ddp: values.ddp,
          incoterm: values.ddp ? "DDP" : "EXW",
        },
      });
      throw new Error(`SKU ${hierarchyBlock.sku}: blockierende Stammdaten fehlen (${result.issues.map((entry) => entry.label).join(", ")}).`);
    }
    const sum = milestoneSum(values.milestones || []);
    if (Math.abs(sum - 100) > 0.01) {
      throw new Error("Milestone Prozentwerte muessen 100% ergeben.");
    }
    const existing = editingId
      ? canonicalRows.find((row) => row.id === editingId)?.raw || null
      : null;
    const nextValues: PoFormValues = {
      ...values,
      supplierId,
      items: normalizedItems,
    };
    const record = toPoRecord(nextValues, existing);
    const paidEventCount = extractPaidEventCount(existing);
    if (paidEventCount > 0 && !forceAfterPaidWarning) {
      const before = aggregateSnapshotFromRecord(existing, poSettings);
      const after = aggregateSnapshotFromRecord(record, poSettings);
      const changed = (
        before.goodsUsd !== after.goodsUsd
        || before.goodsEur !== after.goodsEur
        || before.freightEur !== after.freightEur
        || before.units !== after.units
        || before.prodDays !== after.prodDays
        || before.transitDays !== after.transitDays
      );
      if (changed) {
        Modal.confirm({
          title: "Bereits bezahlte Events vorhanden",
          content: "Du hast Positionen oder Summen geaendert, obwohl bereits Zahlungen verbucht sind. Bitte bewusst bestaetigen.",
          okText: "Trotzdem speichern",
          cancelText: "Abbrechen",
          onOk: () => void savePo(nextValues, true),
        });
        return;
      }
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const list = Array.isArray(next.pos) ? [...next.pos] : [];
      const duplicate = list.find((entry) =>
        String((entry as Record<string, unknown>).poNo || "") === record.poNo
        && String((entry as Record<string, unknown>).id || "") !== String(record.id || ""),
      );
      if (duplicate) {
        throw new Error(`PO Nummer ${record.poNo} existiert bereits.`);
      }
      const index = list.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === String(record.id || ""));
      if (index >= 0) list[index] = record;
      else list.push(record);
      next.pos = list;
      return next;
    }, editingId ? "v2:po:update" : "v2:po:create");
    modalCollab.clearDraft();

    setModalOpen(false);
    setModalFocusTarget(null);
    setMarkerPendingAction(null);
    setEditingId(null);
    setSkuPickerValues([]);
    setReturnContext(null);
    form.resetFields();
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const source = params.get("source");
    const returnPath = normalizeReturnPath(params.get("returnTo"));
    const returnSku = String(params.get("returnSku") || "").trim() || null;
    const applyReturnContext = (): void => {
      if (!returnPath) {
        setReturnContext(null);
        return;
      }
      setReturnContext({ path: returnPath, sku: returnSku });
    };
    const clearHandledParams = (keys: string[]): void => {
      let changed = false;
      keys.forEach((key) => {
        if (!params.has(key)) return;
        params.delete(key);
        changed = true;
      });
      if (!changed) return;
      const query = params.toString();
      navigate({
        pathname: location.pathname,
        search: query ? `?${query}` : "",
      }, { replace: true });
    };
    if (source === "fo_convert") {
      const poNo = String(params.get("poNo") || "").trim();
      if (poNo) {
        setSearch(poNo);
        const target = canonicalRows.find((entry) => (
          String(entry.poNo || "").trim() === poNo
          || String(entry.id || "").trim() === poNo
        ));
        if (target?.raw) {
          applyReturnContext();
          openEditModal(target.raw, null, { preserveReturnContext: true });
        }
      }
      clearHandledParams(["source", "poNo", "returnTo", "returnSku"]);
      return;
    }
    if (source !== "inventory_projection") return;
    const sku = String(params.get("sku") || "").trim();
    if (!sku) {
      clearHandledParams(["source", "returnTo", "returnSku"]);
      return;
    }
    const product = productRows.find((entry) => entry.sku === sku) || null;
    const suggestedUnits = Math.max(0, Math.round(Number(params.get("suggestedUnits") || 0)));
    const requiredArrivalDate = String(params.get("requiredArrivalDate") || "");
    const recommendedOrderDate = String(params.get("recommendedOrderDate") || "");

    const prefill: PoCreatePrefill = {
      sku,
      units: suggestedUnits,
    };
    if (product?.supplierId) prefill.supplierId = String(product.supplierId);
    if (requiredArrivalDate) prefill.etaManual = requiredArrivalDate;
    if (recommendedOrderDate) prefill.orderDate = recommendedOrderDate;

    applyReturnContext();
    openCreateModal(prefill, { preserveReturnContext: true });
    clearHandledParams(["source", "sku", "suggestedUnits", "requiredArrivalDate", "recommendedOrderDate", "returnTo", "returnSku"]);
  }, [canonicalRows, location.pathname, location.search, navigate, productRows]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        {!embedded ? (
          <div className="v2-page-head">
            <div>
              <Title level={3}>Purchase Orders</Title>
              <Paragraph>
                PO-Stammdaten, Milestones, Auto-Events und Payment-Status in einem konsistenten Arbeitsbereich.
              </Paragraph>
            </div>
          </div>
        ) : null}
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => openCreateModal()}>Neue PO</Button>
            <Segmented
              value={poViewMode}
              options={[
                { label: "Tabelle", value: "table" },
                { label: "Timeline", value: "timeline" },
              ]}
              onChange={(value) => updatePoViewMode(String(value) === "timeline" ? "timeline" : "table")}
            />
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-toolbar-row" style={{ marginBottom: 10 }}>
          <Input
            placeholder="PO Nummer, SKU, Alias, Supplier"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 320, maxWidth: "100%" }}
          />
          <Select
            value={archiveFilter}
            onChange={(value) => setArchiveFilter(String(value) as "active" | "archived" | "all")}
            options={[
              { value: "active", label: "Aktiv" },
              { value: "archived", label: "Archiv" },
              { value: "all", label: "Aktiv + Archiv" },
            ]}
            style={{ width: 170 }}
          />
          <Select
            value={paymentStatusFilter}
            onChange={(value) => setPaymentStatusFilter(String(value) as "all" | "open" | "mixed" | "paid_only")}
            options={[
              { value: "all", label: "Status: Alle" },
              { value: "open", label: "Status: Offen" },
              { value: "mixed", label: "Status: Teilweise bezahlt" },
              { value: "paid_only", label: "Status: Bezahlt" },
            ]}
            style={{ width: 220 }}
          />
          <Checkbox checked={onlyOpenPayments} onChange={(event) => setOnlyOpenPayments(event.target.checked)}>
            Nur POs mit offenen Zahlungen
          </Checkbox>
        </div>
        {poViewMode === "table" ? (
          <DataTable
            data={filteredRows}
            columns={columns}
            minTableWidth={1360}
            tableLayout="auto"
          />
        ) : (
          <div className="v2-po-timeline">
            <div
              className="v2-po-timeline-head"
              style={{ "--po-timeline-cols": timelineMonths.length } as CSSProperties}
            >
              <div className="v2-po-timeline-head-cell v2-po-timeline-head-cell--meta">PO / Supplier</div>
              {timelineMonths.map((month) => (
                <div key={month} className="v2-po-timeline-head-cell">{formatMonthLabel(month)}</div>
              ))}
            </div>

            {!filteredRows.length ? (
              <Alert
                type="info"
                showIcon
                message="Keine POs für die aktuelle Suche/Filter."
              />
            ) : null}

            {filteredRows.map((row) => {
              const orderDate = parseIsoDate(row.orderDate);
              const productionEndDate = parseIsoDate(row.productionEndDate);
              const etdDate = parseIsoDate(row.etdDate);
              const etaDate = parseIsoDate(row.etaDate);
              const productionLeft = timelineRange ? toTimelinePercent(orderDate, timelineRange) : 0;
              const productionEnd = timelineRange ? toTimelinePercent(productionEndDate, timelineRange) : 0;
              const transitLeft = timelineRange ? toTimelinePercent(etdDate, timelineRange) : 0;
              const transitEnd = timelineRange ? toTimelinePercent(etaDate, timelineRange) : 0;
              const productionWidth = Math.max(0.75, productionEnd - productionLeft);
              const transitWidth = Math.max(0.75, transitEnd - transitLeft);
              return (
                <div key={row.id} className="v2-po-timeline-row">
                  <button
                    type="button"
                    className="v2-po-timeline-meta"
                    onClick={() => openEditModal(row.raw)}
                  >
                    <div className="v2-po-timeline-title">{row.poNo || "PO"}</div>
                    <div className="v2-po-timeline-subtitle">
                      {row.supplierName} · {row.skuCount > 1 ? `Multi-SKU (${row.skuCount}), Start ${row.sku}` : row.alias}
                    </div>
                    <div className="v2-po-timeline-subtitle">
                      Order {formatDate(row.orderDate)} · ETA {formatDate(row.etaDate)}
                    </div>
                    <div className="v2-po-timeline-action-row">
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(row.raw, "shipping");
                        }}
                      >
                        Versendet am...
                      </Button>
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(row.raw, "arrival");
                        }}
                      >
                        Empfangen am...
                      </Button>
                    </div>
                  </button>
                  <div className="v2-po-timeline-track">
                    <div className="v2-po-timeline-track-bg" />
                    {timelineRange ? (
                      <div className="v2-po-timeline-today" style={{ left: `${todayLinePct}%` }} title="Heute" />
                    ) : null}
                    {timelineRange && productionWidth > 0 ? (
                      <div
                        className="v2-po-timeline-segment v2-po-timeline-segment--production"
                        style={{ left: `${productionLeft}%`, width: `${productionWidth}%` }}
                        title="Produktion"
                      />
                    ) : null}
                    {timelineRange && transitWidth > 0 ? (
                      <div
                        className="v2-po-timeline-segment v2-po-timeline-segment--transit"
                        style={{ left: `${transitLeft}%`, width: `${transitWidth}%` }}
                        title="Transit"
                      />
                    ) : null}
                    {timelineRange ? row.timelineMarkers.map((marker) => {
                      const dueDate = parseIsoDate(marker.dueDate);
                      const markerLeft = toTimelinePercent(dueDate, timelineRange);
                      const markerClass = marker.status === "paid"
                        ? "v2-po-timeline-marker v2-po-timeline-marker--paid"
                        : "v2-po-timeline-marker v2-po-timeline-marker--open";
                      const markerTypeClass = marker.direction === "in" ? "v2-po-timeline-marker--incoming" : "";
                      const tooltip = [
                        `${paymentTypeLabel(marker)} (${marker.status === "paid" ? "bezahlt" : "offen"})`,
                        `Soll: ${formatCurrency(marker.plannedEur)}`,
                        `Faellig: ${formatDate(marker.dueDate)}`,
                        marker.paidDate ? `Bezahlt am: ${formatDate(marker.paidDate)}` : "Bezahlt am: —",
                      ].join("\n");
                      return (
                        <Tooltip key={marker.id} title={<span style={{ whiteSpace: "pre-line" }}>{tooltip}</span>}>
                          <button
                            type="button"
                            className={`${markerClass} ${markerTypeClass}`.trim()}
                            style={{ left: `${markerLeft}%` }}
                            onClick={() => openTimelinePayment(row, marker)}
                            aria-label={`${paymentTypeLabel(marker)} fuer ${row.poNo}`}
                          />
                        </Tooltip>
                      );
                    }) : null}
                  </div>
                </div>
              );
            })}

            <div className="v2-po-timeline-legend">
              <span><span className="v2-po-timeline-legend-box v2-po-timeline-legend-box--production" /> Produktion</span>
              <span><span className="v2-po-timeline-legend-box v2-po-timeline-legend-box--transit" /> Transit</span>
              <span><span className="v2-po-timeline-legend-dot v2-po-timeline-legend-dot--open" /> Zahlung offen</span>
              <span><span className="v2-po-timeline-legend-dot v2-po-timeline-legend-dot--paid" /> Zahlung bezahlt</span>
              <span><span className="v2-po-timeline-legend-line" /> Heute</span>
            </div>
          </div>
        )}
      </Card>

      <Modal
        title={editingId ? "PO bearbeiten" : "PO anlegen"}
        open={modalOpen}
        width={1120}
        onCancel={() => {
          modalCollab.clearDraft();
          setModalOpen(false);
          setModalFocusTarget(null);
          setMarkerPendingAction(null);
          setSkuPickerValues([]);
          setReturnContext(null);
        }}
        onOk={() => {
          if (modalCollab.readOnly) {
            Modal.warning({
              title: "Nur Lesemodus",
              content: `${modalCollab.remoteUserLabel || "Kollege"} bearbeitet diese PO. Bitte Bearbeitung übernehmen oder warten.`,
            });
            return;
          }
          void form.validateFields().then((values) => savePo(values)).catch((error: unknown) => {
            if (error && typeof error === "object" && "errorFields" in error) return;
            const text = error instanceof Error
              ? error.message
              : (error && typeof error === "object" && "message" in error
                ? String((error as { message?: unknown }).message || "")
                : "");
            if (text) message.error(text);
          });
        }}
      >
        {modalCollab.banner ? (
          <Alert
            style={{ marginBottom: 10 }}
            type={modalCollab.banner.tone}
            showIcon
            message={modalCollab.banner.text}
            action={modalCollab.readOnly ? (
              <Button size="small" onClick={modalCollab.takeOver}>
                Bearbeitung uebernehmen
              </Button>
            ) : null}
          />
        ) : null}
        {modalCollab.readOnly && modalCollab.remoteDraftVersion > 0 ? (
          <Tag color="orange" style={{ marginBottom: 10 }}>
            Entwurf von {modalCollab.remoteUserLabel || "Kollege"} wird live gespiegelt.
          </Tag>
        ) : null}
        {returnContext ? (
          <Space style={{ width: "100%", marginBottom: 10 }} wrap>
            <Button
              size="small"
              onClick={() => {
                const params = new URLSearchParams();
                if (returnContext.sku) params.set("sku", returnContext.sku);
                const query = params.toString();
                navigate({
                  pathname: returnContext.path,
                  search: query ? `?${query}` : "",
                });
              }}
            >
              Zurueck zur SKU Planung
            </Button>
            {returnContext.sku ? <Text type="secondary">Fokus: {returnContext.sku}</Text> : null}
          </Space>
        ) : null}
        <Form
          name="v2-po-modal"
          form={form}
          layout="vertical"
          disabled={modalCollab.readOnly}
          onValuesChange={(changedValues) => {
            if (modalCollab.readOnly) return;
            trackFreightOverrides(changedValues as Partial<PoFormValues>);
            hydrateFreightFromMasterData(changedValues as Partial<PoFormValues>);
            modalCollab.publishDraftPatch(changedValues as Record<string, unknown>);
          }}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item
              name="poNo"
              label="PO Nummer"
              style={{ width: 190 }}
              rules={[{ required: true, message: "PO Nummer ist erforderlich." }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="supplierId"
              label="Supplier"
              style={{ minWidth: 260, flex: 1 }}
              rules={[{ required: true, message: "Supplier ist erforderlich." }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={supplierRows.map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                }))}
                onChange={(value) => onSupplierChange(String(value || ""))}
              />
            </Form.Item>
            <Form.Item name="transport" label="Transport" style={{ width: 150 }}>
              <Select
                options={[
                  { value: "sea", label: "SEA" },
                  { value: "rail", label: "RAIL" },
                  { value: "air", label: "AIR" },
                ]}
              />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="orderDate" label="Order Date" style={{ width: 190 }} rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="etdManual" label="ETD Manual" style={{ width: 190 }}>
              <Input id="v2-po-etd-manual" type="date" />
            </Form.Item>
            <Form.Item name="etaManual" label="ETA Manual" style={{ width: 190 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="arrivalDate" label="Empfangen am" style={{ width: 190 }}>
              <Input id="v2-po-arrival-date" type="date" />
            </Form.Item>
            <Form.Item name="fxOverride" label="FX Override" style={{ width: 150 }}>
              <DeNumberInput mode="fx" min={0} />
            </Form.Item>
            <Form.Item name="dutyRatePct" label="Duty %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
            <Form.Item name="eustRatePct" label="EUSt %" style={{ width: 140 }}>
              <DeNumberInput mode="percent" min={0} max={100} />
            </Form.Item>
          </Space>

          <Space style={{ width: "100%" }} align="start" wrap>
            <Form.Item name="dutyIncludeFreight" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>Duty inkl. Freight</Checkbox>
            </Form.Item>
            <Form.Item name="ddp" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>DDP</Checkbox>
            </Form.Item>
            <Form.Item name="archived" valuePropName="checked" style={{ marginTop: 31 }}>
              <Checkbox>Archiviert</Checkbox>
            </Form.Item>
          </Space>

          <Card size="small" className="v2-po-items-card" style={{ marginBottom: 12 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Text strong>PO Positionen (Supplier-first)</Text>
              <Text type="secondary">{draftItems.length} SKU(s)</Text>
            </Space>
            <Space style={{ width: "100%", marginTop: 8 }} align="start" wrap>
              <Select
                mode="multiple"
                allowClear
                placeholder={selectedSupplierId ? "SKUs auswaehlen" : "Zuerst Supplier waehlen"}
                value={skuPickerValues}
                onChange={(values) => setSkuPickerValues((values || []).map((entry) => String(entry || "")))}
                options={supplierSkuOptions}
                style={{ minWidth: 420, flex: 1 }}
                optionFilterProp="label"
                disabled={!selectedSupplierId || !supplierSkuOptions.length}
              />
              <Button
                onClick={() => addSkusToDraft(skuPickerValues)}
                disabled={!selectedSupplierId || !skuPickerValues.length}
              >
                SKUs hinzufuegen
              </Button>
            </Space>

            <Form.List name="items">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 10 }}>
                  {fields.map((field) => (
                    <div key={field.key} className="v2-po-item-row">
                      <div className="v2-po-item-row-main">
                        <Form.Item
                          {...field}
                          name={[field.name, "sku"]}
                          label="SKU"
                          className="v2-po-item-col v2-po-item-col--sku"
                          rules={[{ required: true, message: "SKU fehlt." }]}
                        >
                          <Select
                            showSearch
                            optionFilterProp="label"
                            options={productRows
                              .filter((product) => String(product.supplierId || "") === String(selectedSupplierId || ""))
                              .map((product) => ({
                                value: product.sku,
                                label: `${product.alias} (${product.sku})`,
                              }))}
                            onChange={(nextSku) => applyDefaultsToItem(Number(field.name), String(nextSku || ""))}
                            disabled={!selectedSupplierId}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "units"]}
                          label="Units"
                          className="v2-po-item-col v2-po-item-col--narrow"
                          rules={[{ required: true, message: "Units fehlen." }]}
                        >
                          <DeNumberInput mode="int" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "unitCostUsd"]}
                          label="Unit Cost USD"
                          className="v2-po-item-col"
                          rules={[{ required: true, message: "Preis fehlt." }]}
                        >
                          <DeNumberInput mode="decimal" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "unitExtraUsd"]}
                          label="Unit Extra USD"
                          className="v2-po-item-col"
                        >
                          <DeNumberInput mode="decimal" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "extraFlatUsd"]}
                          label="Extra Flat USD"
                          className="v2-po-item-col"
                        >
                          <DeNumberInput mode="decimal" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "freightEur"]}
                          label="Shipping EUR"
                          className="v2-po-item-col"
                        >
                          <DeNumberInput mode="decimal" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "prodDays"]}
                          label="Prod Days"
                          className="v2-po-item-col v2-po-item-col--narrow"
                          rules={[{ required: true, message: "Prod fehlt." }]}
                        >
                          <DeNumberInput mode="int" min={0} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, "transitDays"]}
                          label="Transit Days"
                          className="v2-po-item-col v2-po-item-col--narrow"
                          rules={[{ required: true, message: "Transit fehlt." }]}
                        >
                          <DeNumberInput mode="int" min={0} />
                        </Form.Item>
                      </div>
                      <Button
                        danger
                        size="small"
                        style={{ marginTop: 31 }}
                        onClick={() => remove(field.name)}
                      >
                        Entfernen
                      </Button>
                    </div>
                  ))}
                  <Button
                    onClick={() => add(normalizeDraftItem({
                      id: randomId("poi"),
                      sku: "",
                      units: 0,
                      unitCostUsd: 0,
                      unitExtraUsd: 0,
                      extraFlatUsd: 0,
                      prodDays: 0,
                      transitDays: 0,
                      freightEur: 0,
                    }))}
                    disabled={!selectedSupplierId}
                  >
                    Leere Position
                  </Button>
                </Space>
              )}
            </Form.List>
          </Card>

          <Card size="small" className="v2-po-aggregate-card" style={{ marginBottom: 12 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Text strong>Aggregierte Sicht (kritischer Pfad)</Text>
              <Tag className="v2-po-critical-path-tag">ETA folgt langsamster SKU</Tag>
            </Space>
            <div className="v2-po-aggregate-grid">
              <div>
                <Text type="secondary">Goods USD</Text>
                <div>{formatNumber(draftAggregate.goodsUsd, 2)}</div>
              </div>
              <div>
                <Text type="secondary">Goods EUR</Text>
                <div>{formatCurrency(draftAggregate.goodsEur)}</div>
              </div>
              <div>
                <Text type="secondary">Freight EUR</Text>
                <div>{formatCurrency(draftAggregate.freightEur)}</div>
              </div>
              <div>
                <Text type="secondary">Units gesamt</Text>
                <div>{formatNumber(draftAggregate.units, 0)}</div>
              </div>
              <div>
                <Text type="secondary">Prod/Transit (kritisch)</Text>
                <div>{formatNumber(draftAggregate.prodDays, 0)} / {formatNumber(draftAggregate.transitDays, 0)} Tage</div>
              </div>
              <div>
                <Text type="secondary">ETD / ETA</Text>
                <div>{formatDate(draftAggregate.schedule.etdDate)} / {formatDate(draftAggregate.schedule.etaDate)}</div>
              </div>
              <div>
                <Text type="secondary">Ankunftsfenster</Text>
                <div>
                  {draftAggregate.minEtaDate || draftAggregate.maxEtaDate
                    ? `${formatDate(draftAggregate.minEtaDate)} - ${formatDate(draftAggregate.maxEtaDate)}`
                    : "—"}
                </div>
              </div>
            </div>
          </Card>

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Text strong>Stammdaten-Herkunft (PO)</Text>
              {!primaryDraftItem ? (
                <Text type="secondary">Bitte mindestens eine SKU erfassen.</Text>
              ) : (
                <>
                  <div className="v2-source-row">
                    <span>Primary SKU</span>
                    <Text>{primaryDraftItem.sku}</Text>
                  </div>
                  <div className="v2-source-row">
                    <span>Unit Cost USD</span>
                    <span className={sourceChipClass(poHierarchy.fields.unitPriceUsd.source, true)}>{poHierarchy.fields.unitPriceUsd.label}</span>
                    <Button size="small" onClick={() => resetPrimaryPoField("unitCostUsd")}>Zuruecksetzen</Button>
                    <Button size="small" onClick={() => adoptPoFieldToProduct("unitPriceUsd", primaryDraftItem.unitCostUsd)}>Als Produktwert uebernehmen</Button>
                  </div>
                  <div className="v2-source-row">
                    <span>Prod / Transit</span>
                    <span className={sourceChipClass(poHierarchy.fields.productionLeadTimeDays.source, true)}>{poHierarchy.fields.productionLeadTimeDays.label}</span>
                    <span className={sourceChipClass(poHierarchy.fields.transitDays.source, false)}>{poHierarchy.fields.transitDays.label}</span>
                    <Button size="small" onClick={() => resetPrimaryPoField("prodDays")}>Prod reset</Button>
                    <Button size="small" onClick={() => resetPrimaryPoField("transitDays")}>Transit reset</Button>
                  </div>
                  <div className="v2-source-row">
                    <span>Duty / EUSt</span>
                    <span className={sourceChipClass(poHierarchy.fields.dutyRatePct.source, false)}>{poHierarchy.fields.dutyRatePct.label}</span>
                    <span className={sourceChipClass(poHierarchy.fields.eustRatePct.source, false)}>{poHierarchy.fields.eustRatePct.label}</span>
                    <Button size="small" onClick={() => resetPrimaryPoField("dutyRatePct")}>Duty reset</Button>
                    <Button size="small" onClick={() => resetPrimaryPoField("eustRatePct")}>EUSt reset</Button>
                    <Button size="small" onClick={() => adoptPoFieldToProduct("dutyRatePct", draftValues?.dutyRatePct)}>Duty uebernehmen</Button>
                    <Button size="small" onClick={() => adoptPoFieldToProduct("eustRatePct", draftValues?.eustRatePct)}>EUSt uebernehmen</Button>
                  </div>
                  <div className="v2-source-row">
                    <span>DDP</span>
                    <span className={sourceChipClass(poHierarchy.fields.ddp.source, true)}>{poHierarchy.fields.ddp.label}</span>
                    <Button size="small" onClick={() => resetPrimaryPoField("ddp")}>Zuruecksetzen</Button>
                    <Button size="small" onClick={() => adoptPoFieldToProduct("ddp", draftValues?.ddp === true)}>Als Produktwert uebernehmen</Button>
                  </div>
                </>
              )}
            </Space>
          </Card>

          {primaryDraftItem?.sku && poBlockingPrimary.blocked ? (
            <Alert
              className="v2-po-warning"
              type="error"
              showIcon
              message="Blockierende Stammdaten fehlen"
              description={poBlockingPrimary.issues.map((entry) => entry.label).join(", ")}
            />
          ) : null}

          {selectedSupplierId && !supplierSkuOptions.length ? (
            <Alert
              className="v2-po-warning"
              type="warning"
              showIcon
              message="Dieser Lieferant hat aktuell keine zugeordneten SKUs. Bitte zuerst Stammdaten pflegen."
            />
          ) : null}
          {itemValidationWarnings.length ? (
            <Alert
              className="v2-po-warning"
              type="warning"
              showIcon
              message="Einige Positionen sind unvollstaendig."
              description={itemValidationWarnings.slice(0, 6).join(" | ")}
            />
          ) : null}

          <Card size="small" style={{ marginBottom: 12 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Text strong>Milestones</Text>
              <Text type={Math.abs(milestoneSum(draftValues?.milestones || []) - 100) <= 0.01 ? "secondary" : "danger"}>
                Summe: {formatNumber(milestoneSum(draftValues?.milestones || []), 2)}%
              </Text>
            </Space>
            <Form.List name="milestones">
              {(fields, { add, remove }) => (
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ width: "100%" }} wrap>
                      <Form.Item
                        {...field}
                        name={[field.name, "label"]}
                        style={{ minWidth: 240, flex: 2 }}
                        rules={[{ required: true, message: "Label fehlt." }]}
                      >
                        <Input placeholder="Label" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "percent"]}
                        style={{ width: 100 }}
                        rules={[{ required: true, message: "%" }]}
                      >
                        <DeNumberInput mode="percent" min={0} max={100} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "anchor"]}
                        style={{ width: 160 }}
                        rules={[{ required: true, message: "Anchor fehlt." }]}
                      >
                        <Select options={PO_ANCHORS.map((anchor) => ({ value: anchor, label: anchor }))} />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "lagDays"]}
                        style={{ width: 120 }}
                      >
                        <DeNumberInput mode="int" />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>X</Button>
                    </Space>
                  ))}
                  <Button
                    onClick={() => add({
                      id: randomId("ms"),
                      label: "Milestone",
                      percent: 0,
                      anchor: "ORDER_DATE",
                      lagDays: 0,
                    })}
                  >
                    Milestone
                  </Button>
                </Space>
              )}
            </Form.List>
          </Card>

          <div ref={paymentSectionRef}>
            <Card size="small">
            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
              <Text strong>Event / Payment Preview</Text>
              <Button
                size="small"
                onClick={() => openPaymentBookingModal(null)}
                disabled={!editingId || !draftPaymentRows.length || modalCollab.readOnly}
              >
                Sammelzahlung buchen
              </Button>
            </Space>
            {draftPoRecord ? (
              <Space direction="vertical" size={4} style={{ width: "100%", marginTop: 8 }}>
                <Text>
                  Timeline: Order {formatDate(draftPoRecord.orderDate)} · ETD {
                    formatDate(
                      draftPoRecord.etdManual
                      || computeScheduleFromOrderDate({
                        orderDate: draftPoRecord.orderDate,
                        productionLeadTimeDays: draftPoRecord.prodDays,
                        logisticsLeadTimeDays: draftPoRecord.transitDays,
                        bufferDays: 0,
                      }).etdDate,
                    )
                  } · ETA {
                    formatDate(
                      draftPoRecord.etaManual
                      || computeScheduleFromOrderDate({
                        orderDate: draftPoRecord.orderDate,
                        productionLeadTimeDays: draftPoRecord.prodDays,
                        logisticsLeadTimeDays: draftPoRecord.transitDays,
                        bufferDays: 0,
                      }).etaDate,
                    )
                  }
                </Text>
                {!editingId ? (
                  <Alert
                    type="info"
                    showIcon
                    message="PO zuerst speichern, danach koennen Zahlungen (inkl. Sammelzahlung) verbucht werden."
                  />
                ) : null}
                <StatsTableShell>
                  <table className="v2-stats-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Typ</th>
                        <th>Due</th>
                        <th>Planned EUR</th>
                        <th>Ist EUR</th>
                        <th>Status</th>
                        <th>Paid Date</th>
                        <th>Methode / Von</th>
                        <th>Invoice / Folder</th>
                        <th>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftPaymentRows.map((row) => (
                        <tr key={row.id}>
                          <td>{shortId(String(row.id || ""))}</td>
                          <td>{paymentTypeLabel(row)}</td>
                          <td>{formatDate(row.dueDate)}</td>
                          <td>{formatCurrency(row.plannedEur)}</td>
                          <td>{row.paidEurActual != null ? formatCurrency(row.paidEurActual) : "—"}</td>
                          <td>{row.status === "paid" ? "Bezahlt" : "Offen"}</td>
                          <td>{formatDate(row.paidDate)}</td>
                          <td>
                            {row.method || row.paidBy ? (
                              <Space direction="vertical" size={0}>
                                <Text>{row.method || "—"}</Text>
                                <Text type="secondary">{row.paidBy || "—"}</Text>
                              </Space>
                            ) : "—"}
                          </td>
                          <td>
                            <Space direction="vertical" size={0}>
                              {canOpenLink(row.invoiceDriveUrl) ? (
                                <a href={String(row.invoiceDriveUrl)} target="_blank" rel="noreferrer">Invoice</a>
                              ) : <Text type="secondary">Invoice —</Text>}
                              {canOpenLink(row.invoiceFolderDriveUrl) ? (
                                <a href={String(row.invoiceFolderDriveUrl)} target="_blank" rel="noreferrer">Folder</a>
                              ) : <Text type="secondary">Folder —</Text>}
                            </Space>
                          </td>
                          <td>
                            <Button
                              size="small"
                              onClick={() => openPaymentBookingModal(row)}
                              disabled={!editingId || modalCollab.readOnly}
                            >
                              {row.status === "paid" ? "Bearbeiten" : "Zahlung buchen"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </StatsTableShell>
                {draftIncomingPaymentRows.length ? (
                  <Space direction="vertical" size={6} style={{ width: "100%", marginTop: 8 }}>
                    <Text strong>Automatische Eingaenge (Info)</Text>
                    <Alert
                      type="info"
                      showIcon
                      message="EUSt-Erstattung wird automatisch verbucht und muss nicht manuell als Zahlung validiert werden."
                    />
                    <StatsTableShell>
                      <table className="v2-stats-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Typ</th>
                            <th>Due</th>
                            <th>Planned EUR</th>
                            <th>Status</th>
                            <th>Hinweis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draftIncomingPaymentRows.map((row) => (
                            <tr key={`incoming-${row.id}`}>
                              <td>{shortId(String(row.id || ""))}</td>
                              <td>{paymentTypeLabel(row)}</td>
                              <td>{formatDate(row.dueDate)}</td>
                              <td>{formatCurrency(row.plannedEur)}</td>
                              <td>{row.status === "paid" ? "Bereits eingegangen" : "Geplant"}</td>
                              <td>Automatisch (kein Zahlung buchen)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </StatsTableShell>
                  </Space>
                ) : null}
              </Space>
            ) : (
              <Text type="secondary">Preview erscheint nach Eingabe.</Text>
            )}
            </Card>
          </div>
        </Form>
      </Modal>

      <Modal
        title="PO Zahlung verbuchen"
        open={paymentModalOpen}
        width={920}
        onCancel={() => {
          setPaymentModalOpen(false);
          setPaymentEditingId(null);
          setPaymentInitialEventIds([]);
          setPaymentModalError(null);
          paymentForm.resetFields();
        }}
        onOk={() => {
          setPaymentModalError(null);
          void paymentForm.validateFields().then((values) => savePaymentBooking(values)).catch((saveError) => {
            if (saveError?.errorFields) return;
            setPaymentModalError(String(saveError instanceof Error ? saveError.message : saveError));
          });
        }}
      >
        {paymentModalError ? (
          <Alert type="error" showIcon message={paymentModalError} style={{ marginBottom: 10 }} />
        ) : null}
        <Form
          form={paymentForm}
          layout="vertical"
          onFinish={(values) => {
            setPaymentModalError(null);
            void savePaymentBooking(values).catch((saveError) => {
              setPaymentModalError(String(saveError instanceof Error ? saveError.message : saveError));
            });
          }}
        >
          <Form.Item
            name="selectedEventIds"
            label="Welche Zahlungsbausteine sind in dieser Zahlung enthalten?"
            rules={[{ required: true, message: "Bitte mindestens einen Baustein waehlen." }]}
          >
            <Checkbox.Group style={{ width: "100%" }}>
              <Space direction="vertical" style={{ width: "100%" }}>
                {draftPaymentRows.map((row) => {
                  const lockedByOtherPayment = row.status === "paid"
                    && row.paymentId
                    && row.paymentId !== paymentEditingId
                    && !paymentInitialEventIds.includes(row.id);
                  return (
                    <Card key={row.id} size="small" style={{ width: "100%" }}>
                      <Checkbox value={row.id} disabled={lockedByOtherPayment}>
                        <Space size={10} wrap>
                          <Text strong>{paymentTypeLabel(row)}</Text>
                          <Text type="secondary">Due {formatDate(row.dueDate)}</Text>
                          <Text>{formatCurrency(row.plannedEur)}</Text>
                          {row.status === "paid" ? <Tag color="green">Bereits bezahlt</Tag> : <Tag>Offen</Tag>}
                          {row.paymentId ? <Text type="secondary">Payment-ID {row.paymentId}</Text> : null}
                        </Space>
                      </Checkbox>
                    </Card>
                  );
                })}
              </Space>
            </Checkbox.Group>
          </Form.Item>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="paidDate" label="Zahlungsdatum" style={{ width: 170 }} rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="method" label="Zahlungsmethode" style={{ minWidth: 240, flex: 1 }} rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={methodOptions}
                placeholder="z. B. Alibaba Trade Assurance"
              />
            </Form.Item>
            <Form.Item name="paidBy" label="Bezahlt durch" style={{ minWidth: 220, flex: 1 }} rules={[{ required: true }]}>
              <Input placeholder={payerOptions.map((entry) => entry.label).join(" / ") || "Name oder E-Mail"} />
            </Form.Item>
          </Space>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="amountActualEur" label="Ist-Betrag EUR" style={{ width: 190 }} rules={[{ required: true }]}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="amountActualUsd" label="Ist-Betrag USD (optional)" style={{ width: 210 }}>
              <DeNumberInput mode="decimal" min={0} />
            </Form.Item>
            <Form.Item name="paymentId" label="Payment-ID (intern)" style={{ minWidth: 300, flex: 1 }}>
              <Input placeholder="pay-..." />
            </Form.Item>
          </Space>

          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="invoiceDriveUrl" label="Invoice Link (Google Drive)" style={{ minWidth: 360, flex: 1 }}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Button
              style={{ marginTop: 31 }}
              disabled={!canOpenLink(String(paymentDraftValues?.invoiceDriveUrl || ""))}
              onClick={() => window.open(String(paymentDraftValues?.invoiceDriveUrl || ""), "_blank", "noopener,noreferrer")}
            >
              Link oeffnen
            </Button>
          </Space>
          <Space align="start" wrap style={{ width: "100%" }}>
            <Form.Item name="invoiceFolderDriveUrl" label="Ordner-Link (Google Drive)" style={{ minWidth: 360, flex: 1 }}>
              <Input placeholder="https://..." />
            </Form.Item>
            <Button
              style={{ marginTop: 31 }}
              disabled={!canOpenLink(String(paymentDraftValues?.invoiceFolderDriveUrl || ""))}
              onClick={() => window.open(String(paymentDraftValues?.invoiceFolderDriveUrl || ""), "_blank", "noopener,noreferrer")}
            >
              Ordner oeffnen
            </Button>
          </Space>

          <Form.Item name="note" label="Notiz">
            <Input.TextArea rows={2} placeholder="Optionaler Hinweis" />
          </Form.Item>

          <Card size="small">
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              <Text strong>Dateiname-Vorschlag fuer Rechnung</Text>
              <Text code>{suggestedPaymentFilename || "—"}</Text>
              <div>
                <Button
                  size="small"
                  onClick={() => {
                    if (!suggestedPaymentFilename) return;
                    void navigator.clipboard.writeText(suggestedPaymentFilename);
                    message.success("Dateiname kopiert.");
                  }}
                >
                  Dateiname kopieren
                </Button>
              </div>
            </Space>
          </Card>
        </Form>
      </Modal>
    </div>
  );
}

import { getActiveForecastVersion } from "./forecastVersioning";
import { buildPhantomFoSuggestions } from "./phantomFo";
import { formatMonthLabel, monthRange, normalizeMonthKey } from "./months";
import { isFoPlanningStatus } from "./orderUtils";
import type {
  AppStateV2,
  SupplierOutlookCell,
  SupplierOutlookExportFormat,
  SupplierOutlookRecord,
  SupplierOutlookRow,
  SupplierOutlookSourceBreakdown,
  SupplierOutlookSourceType,
  SupplierOutlookStatus,
  SupplierOutlookSupplierStatus,
} from "../state/types";

export const SUPPLIER_OUTLOOK_SOURCE_TYPES = ["po", "fo", "pfo", "plan"] as const;
export const SUPPLIER_OUTLOOK_GENERATION_SOURCE_TYPES = ["po", "fo", "pfo"] as const;
export const SUPPLIER_OUTLOOK_STATUS_VALUES = ["draft", "frozen"] as const;
export const SUPPLIER_OUTLOOK_EXPORT_FORMATS = ["pdf", "xlsx"] as const;
export const DEFAULT_SUPPLIER_OUTLOOK_HORIZON = 6;

export interface SupplierOutlookActor {
  userId?: string | null;
  userLabel?: string | null;
}

export interface SupplierOutlookSkuOption {
  id: string;
  sku: string;
  alias: string;
  productId: string | null;
}

export interface SupplierOutlookProposalInput {
  state: Record<string, unknown>;
  supplierId: string;
  startMonth: string;
  horizonMonths: number;
  includedSkuIds: string[];
  includedSourceTypes: SupplierOutlookSourceType[];
  actor?: SupplierOutlookActor;
}

export interface SupplierOutlookSupplierPreviewCell {
  month: string;
  qty: number;
  status: SupplierOutlookSupplierStatus;
  text: string;
  hidden: boolean;
}

export interface SupplierOutlookSupplierPreviewRow {
  label: string;
  sku: string | null;
  rowType: "catalog" | "manual";
  cells: Record<string, SupplierOutlookSupplierPreviewCell>;
}

export interface SupplierOutlookTraceRow {
  rowId: string;
  label: string;
  sku: string | null;
  month: string;
  monthLabel: string;
  systemQty: number;
  finalQty: number;
  excluded: boolean;
  deviation: number;
  supplierStatus: SupplierOutlookSupplierStatus;
  sourceSummary: string;
  sourceRefs: string;
  timingSummary: string;
  note: string;
  reason: string;
}

export interface SupplierOutlookExportModel {
  supplierId: string;
  supplierName: string;
  startMonth: string;
  horizonMonths: number;
  months: string[];
  supplierMonthAxisLabel: string;
  status: SupplierOutlookStatus;
  generatedAt: string;
  frozenAt: string | null;
  lastExportedAt: string | null;
  lastExportFormat: SupplierOutlookExportFormat | null;
  forecastVersionName: string | null;
  inventoryBaselineMonth: string | null;
  supplierRows: SupplierOutlookSupplierPreviewRow[];
  traceRows: SupplierOutlookTraceRow[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizePositiveInt(value: unknown, fallback = 0): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeSourceType(value: unknown): SupplierOutlookSourceType | null {
  const raw = normalizeKey(value);
  if ((SUPPLIER_OUTLOOK_SOURCE_TYPES as readonly string[]).includes(raw)) {
    return raw as SupplierOutlookSourceType;
  }
  return null;
}

function normalizeSourceTypeList(
  value: unknown,
  fallback: SupplierOutlookSourceType[] = ["po", "fo"],
): SupplierOutlookSourceType[] {
  const seen = new Set<string>();
  const list = asArray(value)
    .map((entry) => normalizeSourceType(entry))
    .filter(Boolean) as SupplierOutlookSourceType[];
  const next = list.filter((entry) => {
    if (seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
  return next.length ? next : [...fallback];
}

function normalizeStatus(value: unknown): SupplierOutlookStatus {
  const raw = normalizeKey(value);
  return raw === "frozen" ? "frozen" : "draft";
}

function normalizeExportFormat(value: unknown): SupplierOutlookExportFormat | null {
  const raw = normalizeKey(value);
  if ((SUPPLIER_OUTLOOK_EXPORT_FORMATS as readonly string[]).includes(raw)) {
    return raw as SupplierOutlookExportFormat;
  }
  return null;
}

function normalizeIsoDate(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeMonth(value: unknown, fallback: string | null = null): string | null {
  return normalizeMonthKey(value) || fallback;
}

function resolveInventoryBaselineMonth(state: Record<string, unknown>): string | null {
  const snapshots = asArray<Record<string, unknown>>((state.inventory as Record<string, unknown> | undefined)?.snapshots);
  return snapshots
    .map((entry) => normalizeMonth(entry.month))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;
}

function supplierNameById(state: Record<string, unknown>): Map<string, string> {
  return new Map(
    asArray<Record<string, unknown>>(state.suppliers)
      .map((entry) => ({
        id: normalizeText(entry.id),
        name: normalizeText(entry.name || entry.supplierName || entry.id),
      }))
      .filter((entry) => entry.id)
      .map((entry) => [entry.id, entry.name || entry.id]),
  );
}

function resolveSkuLabel(row: SupplierOutlookRow): string {
  if (row.rowType === "manual") return normalizeText(row.manualLabel || row.alias || row.linkedSku || "Manuelle Zeile");
  return normalizeText(row.alias || row.sku || row.manualLabel || "SKU");
}

function resolveRowSku(row: SupplierOutlookRow): string | null {
  return normalizeText(row.sku || row.linkedSku) || null;
}

function normalizeQty(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeSupplierReference(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  return /^po(?:\b|-)/i.test(raw) ? raw : `PO ${raw}`;
}

function normalizeBreakdown(value: unknown): SupplierOutlookSourceBreakdown[] {
  return asArray<Record<string, unknown>>(value)
    .map((entry) => {
      const sourceType = normalizeSourceType(entry.sourceType);
      if (!sourceType) return null;
      const sourceId = normalizeText(entry.sourceId || entry.id);
      if (!sourceId) return null;
      return {
        sourceType,
        sourceId,
        sourceLabel: normalizeText(entry.sourceLabel || sourceId),
        qty: normalizeQty(entry.qty),
        sku: normalizeText(entry.sku),
        arrivalMonth: normalizeMonth(entry.arrivalMonth),
        signalMonth: normalizeMonth(entry.signalMonth),
        supplierReference: normalizeSupplierReference(entry.supplierReference),
        arrivalDate: normalizeIsoDate(entry.arrivalDate),
        orderDate: normalizeIsoDate(entry.orderDate),
        targetDate: normalizeIsoDate(entry.targetDate),
        timingLabel: normalizeText(entry.timingLabel) || null,
      } satisfies SupplierOutlookSourceBreakdown;
    })
    .filter(Boolean) as SupplierOutlookSourceBreakdown[];
}

function emptyCell(month: string): SupplierOutlookCell {
  return {
    month,
    systemQty: 0,
    finalQty: 0,
    excluded: false,
    note: "",
    reason: "",
    sourceBreakdown: [],
  };
}

function normalizeCell(input: unknown, month: string): SupplierOutlookCell {
  const source = (input && typeof input === "object" && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};
  return {
    month,
    systemQty: normalizeQty(source.systemQty),
    finalQty: normalizeQty(source.finalQty ?? source.systemQty),
    excluded: source.excluded === true,
    note: normalizeText(source.note),
    reason: normalizeText(source.reason),
    sourceBreakdown: normalizeBreakdown(source.sourceBreakdown),
  };
}

function normalizeRow(input: unknown, months: string[]): SupplierOutlookRow | null {
  const source = (input && typeof input === "object" && !Array.isArray(input))
    ? input as Record<string, unknown>
    : null;
  if (!source) return null;
  const rowType = normalizeKey(source.rowType) === "manual" ? "manual" : "catalog";
  const cellsSource = (source.cells && typeof source.cells === "object" && !Array.isArray(source.cells))
    ? source.cells as Record<string, unknown>
    : {};
  const cells = Object.fromEntries(months.map((month) => [month, normalizeCell(cellsSource[month], month)]));
  const id = normalizeText(source.id) || randomId(rowType === "manual" ? "sod-manual" : "sod-row");
  return {
    id,
    rowType,
    productId: normalizeText(source.productId) || null,
    sku: normalizeText(source.sku) || null,
    alias: normalizeText(source.alias) || null,
    manualLabel: normalizeText(source.manualLabel) || null,
    linkedSku: normalizeText(source.linkedSku) || null,
    cells,
  };
}

export function normalizeSupplierOutlookRecord(input: unknown): SupplierOutlookRecord | null {
  const source = (input && typeof input === "object" && !Array.isArray(input))
    ? input as Record<string, unknown>
    : null;
  if (!source) return null;
  const startMonth = normalizeMonth(source.startMonth);
  if (!startMonth) return null;
  const horizonMonths = Math.max(1, normalizePositiveInt(source.horizonMonths, DEFAULT_SUPPLIER_OUTLOOK_HORIZON) || DEFAULT_SUPPLIER_OUTLOOK_HORIZON);
  const months = monthRange(startMonth, horizonMonths);
  const rows = asArray(source.rows)
    .map((entry) => normalizeRow(entry, months))
    .filter(Boolean) as SupplierOutlookRow[];
  return {
    id: normalizeText(source.id) || randomId("supplier-outlook"),
    supplierId: normalizeText(source.supplierId),
    startMonth,
    horizonMonths,
    includedSkuIds: Array.from(new Set(asArray(source.includedSkuIds).map((entry) => normalizeText(entry)).filter(Boolean))).sort(),
    includedSourceTypes: normalizeSourceTypeList(source.includedSourceTypes),
    forecastVersionId: normalizeText(source.forecastVersionId) || null,
    forecastVersionName: normalizeText(source.forecastVersionName) || null,
    inventoryBaselineMonth: normalizeMonth(source.inventoryBaselineMonth),
    generatedAt: normalizeIsoTimestamp(source.generatedAt) || nowIso(),
    status: normalizeStatus(source.status),
    rows,
    createdAt: normalizeIsoTimestamp(source.createdAt) || nowIso(),
    createdByUserId: normalizeText(source.createdByUserId) || null,
    createdByLabel: normalizeText(source.createdByLabel) || null,
    updatedAt: normalizeIsoTimestamp(source.updatedAt) || nowIso(),
    updatedByUserId: normalizeText(source.updatedByUserId) || null,
    updatedByLabel: normalizeText(source.updatedByLabel) || null,
    frozenAt: normalizeIsoTimestamp(source.frozenAt) || null,
    frozenByUserId: normalizeText(source.frozenByUserId) || null,
    frozenByLabel: normalizeText(source.frozenByLabel) || null,
    lastExportedAt: normalizeIsoTimestamp(source.lastExportedAt) || null,
    lastExportedByUserId: normalizeText(source.lastExportedByUserId) || null,
    lastExportedByLabel: normalizeText(source.lastExportedByLabel) || null,
    lastExportFormat: normalizeExportFormat(source.lastExportFormat),
  };
}

export function normalizeSupplierOutlooks(input: unknown): SupplierOutlookRecord[] {
  return asArray(input)
    .map((entry) => normalizeSupplierOutlookRecord(entry))
    .filter(Boolean)
    .sort((left, right) => String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""))) as SupplierOutlookRecord[];
}

export function supplierOutlookHash(record: SupplierOutlookRecord | null | undefined): string {
  return JSON.stringify(record || null);
}

export function collectSupplierOutlookSkuOptions(
  state: Record<string, unknown>,
  supplierId: string,
): SupplierOutlookSkuOption[] {
  const supplierKey = normalizeKey(supplierId);
  if (!supplierKey) return [];

  const products = asArray<Record<string, unknown>>(state.products);
  const productBySku = new Map<string, Record<string, unknown>>();
  const productIdsBySku = new Map<string, string | null>();

  products.forEach((entry) => {
    const sku = normalizeText(entry.sku);
    if (!sku) return;
    productBySku.set(normalizeKey(sku), entry);
    productIdsBySku.set(normalizeKey(sku), normalizeText(entry.id) || null);
  });

  const matchedSkus = new Set<string>();
  products.forEach((entry) => {
    const sku = normalizeText(entry.sku);
    if (!sku) return;
    if (normalizeKey(entry.supplierId) === supplierKey) {
      matchedSkus.add(sku);
    }
  });

  asArray<Record<string, unknown>>(state.productSuppliers).forEach((entry) => {
    const sku = normalizeText(entry.sku);
    if (!sku) return;
    if (normalizeKey(entry.supplierId) === supplierKey) {
      matchedSkus.add(sku);
    }
  });

  return Array.from(matchedSkus)
    .map((sku) => {
      const product = productBySku.get(normalizeKey(sku)) || null;
      return {
        id: sku,
        sku,
        alias: normalizeText(product?.alias || sku),
        productId: productIdsBySku.get(normalizeKey(sku)) || null,
      } satisfies SupplierOutlookSkuOption;
    })
    .sort((left, right) => {
      const byAlias = left.alias.localeCompare(right.alias, "de-DE", { sensitivity: "base" });
      if (byAlias !== 0) return byAlias;
      return left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" });
    });
}

function resolveEntityArrivalDate(record: Record<string, unknown>): string | null {
  return normalizeIsoDate(record.arrivalDateDe)
    || normalizeIsoDate(record.arrivalDate)
    || normalizeIsoDate(record.etaDate)
    || normalizeIsoDate(record.etaManual)
    || normalizeIsoDate(record.eta)
    || null;
}

function resolveEntityOrderDate(record: Record<string, unknown>): string | null {
  return normalizeIsoDate(record.orderDate);
}

function extractPoItems(record: Record<string, unknown>): Array<{ sku: string; qty: number }> {
  const items = asArray<Record<string, unknown>>(record.items);
  if (items.length) {
    return items
      .map((entry) => ({
        sku: normalizeText(entry.sku),
        qty: normalizeQty(entry.units),
      }))
      .filter((entry) => entry.sku && entry.qty > 0);
  }
  const sku = normalizeText(record.sku);
  const qty = normalizeQty(record.units);
  return sku && qty > 0 ? [{ sku, qty }] : [];
}

function matchesSelectedSku(selectedSkuKeys: Set<string>, sku: string): boolean {
  return selectedSkuKeys.size === 0 || selectedSkuKeys.has(normalizeKey(sku));
}

function pushBreakdown(
  target: Map<string, Map<string, SupplierOutlookSourceBreakdown[]>>,
  sku: string,
  month: string,
  breakdown: SupplierOutlookSourceBreakdown,
): void {
  const skuKey = normalizeKey(sku);
  if (!skuKey || !month) return;
  if (!target.has(skuKey)) target.set(skuKey, new Map());
  const monthMap = target.get(skuKey) as Map<string, SupplierOutlookSourceBreakdown[]>;
  if (!monthMap.has(month)) monthMap.set(month, []);
  (monthMap.get(month) as SupplierOutlookSourceBreakdown[]).push(breakdown);
}

function collectPoBreakdowns(input: {
  state: Record<string, unknown>;
  supplierId: string;
  selectedSkuKeys: Set<string>;
  monthSet: Set<string>;
  target: Map<string, Map<string, SupplierOutlookSourceBreakdown[]>>;
}): void {
  asArray<Record<string, unknown>>(input.state.pos).forEach((po) => {
    if (po.archived === true) return;
    if (normalizeKey(po.status) === "cancelled") return;
    if (normalizeKey(po.supplierId || po.supplier) !== normalizeKey(input.supplierId)) return;
    const arrivalDate = resolveEntityArrivalDate(po);
    const arrivalMonth = normalizeMonth(arrivalDate?.slice(0, 7));
    if (!arrivalMonth || !input.monthSet.has(arrivalMonth)) return;
    const orderDate = resolveEntityOrderDate(po);
    const signalMonth = normalizeMonth(orderDate?.slice(0, 7), arrivalMonth);
    const poNumber = normalizeText(po.poNo || po.poNumber);
    extractPoItems(po).forEach((item) => {
      if (!matchesSelectedSku(input.selectedSkuKeys, item.sku)) return;
      pushBreakdown(input.target, item.sku, arrivalMonth, {
        sourceType: "po",
        sourceId: normalizeText(po.id || po.poNo || po.poNumber) || randomId("po"),
        sourceLabel: `PO ${normalizeText(po.poNo || po.poNumber || po.id) || "PO"}`,
        qty: item.qty,
        sku: item.sku,
        arrivalMonth,
        signalMonth,
        supplierReference: normalizeSupplierReference(poNumber),
        arrivalDate,
        orderDate,
        targetDate: arrivalDate,
        timingLabel: [
          arrivalDate ? `Ankunft ${arrivalDate}` : arrivalMonth ? `Ankunft ${formatMonthLabel(arrivalMonth)}` : "",
          orderDate ? `Bestellung ${orderDate}` : "",
        ].filter(Boolean).join(" · "),
      });
    });
  });
}

function collectFoBreakdowns(input: {
  state: Record<string, unknown>;
  supplierId: string;
  selectedSkuKeys: Set<string>;
  monthSet: Set<string>;
  target: Map<string, Map<string, SupplierOutlookSourceBreakdown[]>>;
}): void {
  asArray<Record<string, unknown>>(input.state.fos).forEach((fo) => {
    if (normalizeKey(fo.supplierId) !== normalizeKey(input.supplierId)) return;
    if (!isFoPlanningStatus(fo.status)) return;
    const sku = normalizeText(fo.sku);
    if (!sku || !matchesSelectedSku(input.selectedSkuKeys, sku)) return;
    const targetDate = normalizeIsoDate(fo.targetDeliveryDate) || normalizeIsoDate(fo.deliveryDate) || normalizeIsoDate(fo.etaDate) || normalizeIsoDate(fo.etaManual);
    const targetMonth = normalizeMonth(targetDate?.slice(0, 7));
    if (!targetMonth || !input.monthSet.has(targetMonth)) return;
    const orderDate = resolveEntityOrderDate(fo);
    pushBreakdown(input.target, sku, targetMonth, {
      sourceType: "fo",
      sourceId: normalizeText(fo.id || fo.foNumber) || randomId("fo"),
      sourceLabel: `FO ${normalizeText(fo.foNumber || fo.id) || "FO"}`,
      qty: normalizeQty(fo.units),
      sku,
      arrivalMonth: targetMonth,
      signalMonth: normalizeMonth(orderDate?.slice(0, 7), targetMonth),
      supplierReference: null,
      arrivalDate: targetDate,
      orderDate,
      targetDate,
      timingLabel: [
        targetDate ? `Lieferziel ${targetDate}` : targetMonth ? `Lieferziel ${formatMonthLabel(targetMonth)}` : "",
        orderDate ? `Bestellung ${orderDate}` : "",
      ].filter(Boolean).join(" · "),
    });
  });
}

function collectPfoBreakdowns(input: {
  state: Record<string, unknown>;
  supplierId: string;
  selectedSkuKeys: Set<string>;
  monthSet: Set<string>;
  target: Map<string, Map<string, SupplierOutlookSourceBreakdown[]>>;
}): void {
  buildPhantomFoSuggestions({ state: input.state }).forEach((entry) => {
    if (normalizeKey(entry.supplierId) !== normalizeKey(input.supplierId)) return;
    const sku = normalizeText(entry.sku);
    if (!sku || !matchesSelectedSku(input.selectedSkuKeys, sku)) return;
    const arrivalDate = normalizeIsoDate(entry.requiredArrivalDate);
    const arrivalMonth = normalizeMonth(arrivalDate?.slice(0, 7) || entry.firstRiskMonth || entry.orderMonth);
    if (!arrivalMonth || !input.monthSet.has(arrivalMonth)) return;
    const orderDate = normalizeIsoDate(entry.recommendedOrderDate);
    pushBreakdown(input.target, sku, arrivalMonth, {
      sourceType: "pfo",
      sourceId: normalizeText(entry.id) || randomId("pfo"),
      sourceLabel: `PFO ${normalizeText(entry.id || entry.sku) || "PFO"}`,
      qty: normalizeQty(entry.suggestedUnits),
      sku,
      arrivalMonth,
      signalMonth: normalizeMonth(orderDate?.slice(0, 7) || entry.orderMonth, arrivalMonth),
      supplierReference: null,
      arrivalDate,
      orderDate,
      targetDate: arrivalDate,
      timingLabel: [
        arrivalDate ? `Empfohlene Ankunft ${arrivalDate}` : arrivalMonth ? `Empfohlene Ankunft ${formatMonthLabel(arrivalMonth)}` : "",
        orderDate ? `Empfohlene Bestellung ${orderDate}` : "",
      ].filter(Boolean).join(" · "),
    });
  });
}

function systemQtyFromBreakdown(breakdown: SupplierOutlookSourceBreakdown[]): number {
  return breakdown.reduce((sum, entry) => sum + normalizeQty(entry.qty), 0);
}

function isSameEditableCell(left: SupplierOutlookCell, right: SupplierOutlookCell): boolean {
  return left.finalQty === right.finalQty
    && left.excluded === right.excluded
    && normalizeText(left.note) === normalizeText(right.note)
    && normalizeText(left.reason) === normalizeText(right.reason);
}

function createCatalogRow(option: SupplierOutlookSkuOption, months: string[], breakdownByMonth: Map<string, SupplierOutlookSourceBreakdown[]>): SupplierOutlookRow {
  const cells = Object.fromEntries(months.map((month) => {
    const breakdown = breakdownByMonth.get(month) || [];
    const systemQty = systemQtyFromBreakdown(breakdown);
    return [month, {
      month,
      systemQty,
      finalQty: systemQty,
      excluded: false,
      note: "",
      reason: "",
      sourceBreakdown: breakdown,
    } satisfies SupplierOutlookCell];
  }));
  return {
    id: randomId("sod-row"),
    rowType: "catalog",
    productId: option.productId,
    sku: option.sku,
    alias: option.alias,
    manualLabel: null,
    linkedSku: null,
    cells,
  };
}

export function buildSupplierOutlookDraft(input: SupplierOutlookProposalInput): SupplierOutlookRecord {
  const state = input.state || {};
  const supplierId = normalizeText(input.supplierId);
  const startMonth = normalizeMonth(input.startMonth, null) || nowIso().slice(0, 7);
  const horizonMonths = Math.max(1, normalizePositiveInt(input.horizonMonths, DEFAULT_SUPPLIER_OUTLOOK_HORIZON) || DEFAULT_SUPPLIER_OUTLOOK_HORIZON);
  const months = monthRange(startMonth, horizonMonths);
  const monthSet = new Set(months);
  const activeForecast = getActiveForecastVersion((state.forecast as Record<string, unknown>) || {});
  const inventoryBaselineMonth = resolveInventoryBaselineMonth(state);
  const skuOptions = collectSupplierOutlookSkuOptions(state, supplierId);
  const selectedSkus = Array.from(new Set(
    (input.includedSkuIds.length ? input.includedSkuIds : skuOptions.map((entry) => entry.id))
      .map((entry) => normalizeText(entry))
      .filter(Boolean),
  ));
  const selectedSkuKeys = new Set(selectedSkus.map((entry) => normalizeKey(entry)));
  const optionBySkuKey = new Map(
    skuOptions.map((entry) => [normalizeKey(entry.id), entry] as const),
  );
  const selectedOptions = selectedSkus.map((sku) => optionBySkuKey.get(normalizeKey(sku)) || {
    id: sku,
    sku,
    alias: sku,
    productId: null,
  });
  const includedSourceTypes = normalizeSourceTypeList(input.includedSourceTypes, [])
    .filter((entry) => (SUPPLIER_OUTLOOK_GENERATION_SOURCE_TYPES as readonly string[]).includes(entry));
  if (!includedSourceTypes.length) {
    throw new Error("Bitte mindestens einen Quelltyp für den Lieferantenausblick wählen.");
  }
  const breakdowns = new Map<string, Map<string, SupplierOutlookSourceBreakdown[]>>();

  if (includedSourceTypes.includes("po")) {
    collectPoBreakdowns({ state, supplierId, selectedSkuKeys, monthSet, target: breakdowns });
  }
  if (includedSourceTypes.includes("fo")) {
    collectFoBreakdowns({ state, supplierId, selectedSkuKeys, monthSet, target: breakdowns });
  }
  if (includedSourceTypes.includes("pfo")) {
    collectPfoBreakdowns({ state, supplierId, selectedSkuKeys, monthSet, target: breakdowns });
  }

  // Draft rows are a communication snapshot derived from current source truth.
  // Manual edits that follow stay inside SupplierOutlook only and never write back into PO/FO/PFO/Forecast state.
  const rows = selectedOptions.map((option) => createCatalogRow(
    option,
    months,
    breakdowns.get(normalizeKey(option.sku)) || new Map<string, SupplierOutlookSourceBreakdown[]>(),
  ));

  const timestamp = nowIso();
  return {
    id: randomId("supplier-outlook"),
    supplierId,
    startMonth,
    horizonMonths,
    includedSkuIds: selectedSkus.sort(),
    includedSourceTypes,
    forecastVersionId: activeForecast?.id || null,
    forecastVersionName: activeForecast?.name || null,
    inventoryBaselineMonth,
    generatedAt: timestamp,
    status: "draft",
    rows,
    createdAt: timestamp,
    createdByUserId: normalizeText(input.actor?.userId) || null,
    createdByLabel: normalizeText(input.actor?.userLabel) || null,
    updatedAt: timestamp,
    updatedByUserId: normalizeText(input.actor?.userId) || null,
    updatedByLabel: normalizeText(input.actor?.userLabel) || null,
    frozenAt: null,
    frozenByUserId: null,
    frozenByLabel: null,
    lastExportedAt: null,
    lastExportedByUserId: null,
    lastExportedByLabel: null,
    lastExportFormat: null,
  };
}

function touchRecord(record: SupplierOutlookRecord, actor?: SupplierOutlookActor): SupplierOutlookRecord {
  return {
    ...record,
    updatedAt: nowIso(),
    updatedByUserId: normalizeText(actor?.userId) || record.updatedByUserId || null,
    updatedByLabel: normalizeText(actor?.userLabel) || record.updatedByLabel || null,
  };
}

function replaceRow(record: SupplierOutlookRecord, rowId: string, nextRow: SupplierOutlookRow): SupplierOutlookRecord {
  return {
    ...record,
    rows: record.rows.map((row) => row.id === rowId ? nextRow : row),
  };
}

export function updateSupplierOutlookCell(
  record: SupplierOutlookRecord,
  input: {
    rowId: string;
    month: string;
    patch: Partial<Pick<SupplierOutlookCell, "finalQty" | "excluded" | "note" | "reason">>;
    actor?: SupplierOutlookActor;
  },
): SupplierOutlookRecord {
  const month = normalizeMonth(input.month);
  if (!month || record.status === "frozen") return record;
  const targetRow = record.rows.find((row) => row.id === input.rowId);
  if (!targetRow) return record;
  const currentCell = targetRow.cells[month] || emptyCell(month);
  const nextCell: SupplierOutlookCell = {
    ...currentCell,
    finalQty: input.patch.finalQty == null ? currentCell.finalQty : normalizeQty(input.patch.finalQty),
    excluded: input.patch.excluded == null ? currentCell.excluded : input.patch.excluded === true,
    note: input.patch.note == null ? currentCell.note || "" : normalizeText(input.patch.note),
    reason: input.patch.reason == null ? currentCell.reason || "" : normalizeText(input.patch.reason),
  };
  if (isSameEditableCell(currentCell, nextCell)) return record;
  const nextRecord = replaceRow(record, input.rowId, {
    ...targetRow,
    cells: {
      ...targetRow.cells,
      [month]: nextCell,
    },
  });
  return touchRecord(nextRecord, input.actor);
}

export function resetSupplierOutlookCell(
  record: SupplierOutlookRecord,
  input: { rowId: string; month: string; actor?: SupplierOutlookActor },
): SupplierOutlookRecord {
  const row = record.rows.find((entry) => entry.id === input.rowId);
  const month = normalizeMonth(input.month);
  if (!row || !month) return record;
  const cell = row.cells[month];
  if (!cell) return record;
  return updateSupplierOutlookCell(record, {
    rowId: input.rowId,
    month,
    patch: {
      finalQty: cell.systemQty,
      excluded: false,
      note: "",
      reason: "",
    },
    actor: input.actor,
  });
}

export function setSupplierOutlookRowExcluded(
  record: SupplierOutlookRecord,
  input: { rowId: string; excluded: boolean; actor?: SupplierOutlookActor },
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const row = record.rows.find((entry) => entry.id === input.rowId);
  if (!row) return record;
  const hasChange = Object.values(row.cells).some((cell) => cell.excluded !== (input.excluded === true));
  if (!hasChange) return record;
  const nextRow: SupplierOutlookRow = {
    ...row,
    cells: Object.fromEntries(Object.entries(row.cells).map(([month, cell]) => [
      month,
      { ...cell, excluded: input.excluded === true },
    ])),
  };
  return touchRecord(replaceRow(record, input.rowId, nextRow), input.actor);
}

export function resetSupplierOutlookRow(
  record: SupplierOutlookRecord,
  input: { rowId: string; actor?: SupplierOutlookActor },
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const row = record.rows.find((entry) => entry.id === input.rowId);
  if (!row) return record;
  const hasChange = Object.values(row.cells).some((cell) => (
    cell.finalQty !== cell.systemQty
    || cell.excluded === true
    || Boolean(normalizeText(cell.note))
    || Boolean(normalizeText(cell.reason))
  ));
  if (!hasChange) return record;
  const nextRow: SupplierOutlookRow = {
    ...row,
    cells: Object.fromEntries(Object.entries(row.cells).map(([month, cell]) => [
      month,
      {
        ...cell,
        finalQty: cell.systemQty,
        excluded: false,
        note: "",
        reason: "",
      },
    ])),
  };
  return touchRecord(replaceRow(record, input.rowId, nextRow), input.actor);
}

export function addSupplierOutlookManualRow(
  record: SupplierOutlookRecord,
  input?: { actor?: SupplierOutlookActor; label?: string; linkedSku?: string | null },
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const months = monthRange(record.startMonth, record.horizonMonths);
  const row: SupplierOutlookRow = {
    id: randomId("sod-manual"),
    rowType: "manual",
    productId: null,
    sku: null,
    alias: null,
    manualLabel: normalizeText(input?.label) || `Manuelle Zeile ${record.rows.filter((entry) => entry.rowType === "manual").length + 1}`,
    linkedSku: normalizeText(input?.linkedSku) || null,
    cells: Object.fromEntries(months.map((month) => [month, emptyCell(month)])),
  };
  return touchRecord({
    ...record,
    rows: [...record.rows, row],
  }, input?.actor);
}

export function updateSupplierOutlookRowMeta(
  record: SupplierOutlookRecord,
  input: {
    rowId: string;
    patch: Partial<Pick<SupplierOutlookRow, "manualLabel" | "linkedSku">>;
    actor?: SupplierOutlookActor;
  },
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const row = record.rows.find((entry) => entry.id === input.rowId);
  if (!row) return record;
  const nextRow: SupplierOutlookRow = {
    ...row,
    manualLabel: input.patch.manualLabel == null ? row.manualLabel || null : normalizeText(input.patch.manualLabel) || null,
    linkedSku: input.patch.linkedSku == null ? row.linkedSku || null : normalizeText(input.patch.linkedSku) || null,
  };
  if (
    normalizeText(nextRow.manualLabel) === normalizeText(row.manualLabel)
    && normalizeText(nextRow.linkedSku) === normalizeText(row.linkedSku)
  ) {
    return record;
  }
  return touchRecord(replaceRow(record, input.rowId, nextRow), input.actor);
}

export function removeSupplierOutlookRow(
  record: SupplierOutlookRecord,
  input: { rowId: string; actor?: SupplierOutlookActor },
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const nextRows = record.rows.filter((entry) => entry.id !== input.rowId);
  if (nextRows.length === record.rows.length) return record;
  return touchRecord({ ...record, rows: nextRows }, input.actor);
}

export function duplicateSupplierOutlookRecord(
  record: SupplierOutlookRecord,
  actor?: SupplierOutlookActor,
): SupplierOutlookRecord {
  const timestamp = nowIso();
  return {
    ...clone(record),
    id: randomId("supplier-outlook"),
    status: "draft",
    createdAt: timestamp,
    createdByUserId: normalizeText(actor?.userId) || null,
    createdByLabel: normalizeText(actor?.userLabel) || null,
    updatedAt: timestamp,
    updatedByUserId: normalizeText(actor?.userId) || null,
    updatedByLabel: normalizeText(actor?.userLabel) || null,
    frozenAt: null,
    frozenByUserId: null,
    frozenByLabel: null,
    lastExportedAt: null,
    lastExportedByUserId: null,
    lastExportedByLabel: null,
    lastExportFormat: null,
  };
}

export function freezeSupplierOutlookRecord(
  record: SupplierOutlookRecord,
  actor?: SupplierOutlookActor,
): SupplierOutlookRecord {
  if (record.status === "frozen") return record;
  const timestamp = nowIso();
  return {
    ...clone(record),
    status: "frozen",
    updatedAt: timestamp,
    updatedByUserId: normalizeText(actor?.userId) || null,
    updatedByLabel: normalizeText(actor?.userLabel) || null,
    frozenAt: timestamp,
    frozenByUserId: normalizeText(actor?.userId) || null,
    frozenByLabel: normalizeText(actor?.userLabel) || null,
  };
}

export function markSupplierOutlookRecordExported(
  record: SupplierOutlookRecord,
  input: {
    format: SupplierOutlookExportFormat;
    actor?: SupplierOutlookActor;
  },
): SupplierOutlookRecord {
  if (record.status !== "frozen") return record;
  const format = normalizeExportFormat(input.format);
  if (!format) return record;
  const timestamp = nowIso();
  return {
    ...clone(record),
    updatedAt: timestamp,
    updatedByUserId: normalizeText(input.actor?.userId) || record.updatedByUserId || null,
    updatedByLabel: normalizeText(input.actor?.userLabel) || record.updatedByLabel || null,
    lastExportedAt: timestamp,
    lastExportedByUserId: normalizeText(input.actor?.userId) || null,
    lastExportedByLabel: normalizeText(input.actor?.userLabel) || null,
    lastExportFormat: format,
  };
}

export function upsertSupplierOutlookRecordInState(
  current: AppStateV2,
  record: SupplierOutlookRecord,
): AppStateV2 {
  const next = clone(current);
  const currentRows = normalizeSupplierOutlooks(next.supplierOutlooks);
  const hasExisting = currentRows.some((entry) => entry.id === record.id);
  next.supplierOutlooks = hasExisting
    ? currentRows.map((entry) => entry.id === record.id ? clone(record) : entry)
    : [clone(record), ...currentRows];
  return next;
}

function buildSourceSummary(breakdown: SupplierOutlookSourceBreakdown[]): string {
  if (!breakdown.length) return "Manuell";
  const totals = new Map<string, number>();
  breakdown.forEach((entry) => {
    const key = entry.sourceType.toUpperCase();
    totals.set(key, (totals.get(key) || 0) + normalizeQty(entry.qty));
  });
  return Array.from(totals.entries())
    .map(([key, qty]) => `${key}: ${qty}`)
    .join(" · ");
}

function buildSourceRefs(breakdown: SupplierOutlookSourceBreakdown[]): string {
  return breakdown.map((entry) => `${entry.sourceLabel} (${entry.qty})`).join(" | ");
}

function buildTimingSummary(breakdown: SupplierOutlookSourceBreakdown[]): string {
  return Array.from(new Set(
    breakdown
      .map((entry) => normalizeText(entry.timingLabel || entry.arrivalDate || entry.arrivalMonth))
      .filter(Boolean),
  )).join(" | ");
}

function resolveSupplierFacingMonth(
  entry: SupplierOutlookSourceBreakdown,
  fallbackMonth: string,
): string {
  return normalizeMonth(entry.signalMonth)
    || normalizeMonth(entry.orderDate?.slice(0, 7))
    || normalizeMonth(entry.arrivalMonth)
    || fallbackMonth;
}

function allocateQtyByWeight(
  totalQty: number,
  groups: Array<{ month: string; weight: number }>,
): Map<string, number> {
  const normalizedTotal = normalizeQty(totalQty);
  const filteredGroups = groups.filter((entry) => entry.month && entry.weight > 0);
  if (!normalizedTotal || !filteredGroups.length) return new Map();
  const totalWeight = filteredGroups.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) {
    return new Map([[filteredGroups[0].month, normalizedTotal]]);
  }

  const allocations = filteredGroups.map((entry) => {
    const raw = (normalizedTotal * entry.weight) / totalWeight;
    const floor = Math.floor(raw);
    return {
      month: entry.month,
      floor,
      fraction: raw - floor,
    };
  });
  let remainder = normalizedTotal - allocations.reduce((sum, entry) => sum + entry.floor, 0);
  allocations
    .sort((left, right) => {
      if (right.fraction !== left.fraction) return right.fraction - left.fraction;
      return left.month.localeCompare(right.month);
    })
    .forEach((entry) => {
      if (remainder <= 0) return;
      entry.floor += 1;
      remainder -= 1;
    });
  return new Map(allocations.map((entry) => [entry.month, entry.floor]));
}

function dominantSupplierStatus(statuses: SupplierOutlookSupplierStatus[]): SupplierOutlookSupplierStatus {
  if (statuses.includes("indicative")) return "indicative";
  if (statuses.includes("planned")) return "planned";
  return "confirmed";
}

function buildSupplierPoReferenceLabel(references: string[]): string {
  const uniqueReferences = Array.from(new Set(
    references
      .map((entry) => normalizeSupplierReference(entry))
      .filter(Boolean) as string[],
  ));
  if (!uniqueReferences.length) return "";
  const joined = uniqueReferences.join(", ");
  if (uniqueReferences.length <= 3 && joined.length <= 34) return joined;
  return `${uniqueReferences.length} POs`;
}

function buildSupplierFacingCellText(input: {
  qty: number;
  status: SupplierOutlookSupplierStatus;
  poReferences: string[];
}): string {
  const parts = [`${normalizeQty(input.qty)} · ${input.status}`];
  if (input.status === "confirmed") {
    const poSummary = buildSupplierPoReferenceLabel(input.poReferences);
    if (poSummary) parts.push(poSummary);
  }
  return parts.join(" · ");
}

function resolveSupplierFacingBreakdownStatus(
  row: SupplierOutlookRow,
  cell: SupplierOutlookCell,
  breakdown: SupplierOutlookSourceBreakdown[],
): SupplierOutlookSupplierStatus {
  if (row.rowType === "manual") return "indicative";
  const sourceTypes = new Set(breakdown.map((entry) => entry.sourceType));
  const isOverridden = cell.finalQty !== cell.systemQty || normalizeText(cell.note) || normalizeText(cell.reason);
  if (sourceTypes.has("pfo")) return "indicative";
  if (isOverridden) return "planned";
  if (sourceTypes.has("fo")) return "planned";
  if (sourceTypes.has("po")) return "confirmed";
  return "planned";
}

function projectSupplierFacingCells(
  row: SupplierOutlookRow,
  months: string[],
): Map<string, SupplierOutlookSupplierPreviewCell> {
  const aggregates = new Map<string, {
    qty: number;
    statuses: SupplierOutlookSupplierStatus[];
    poReferences: Set<string>;
  }>();

  months.forEach((month) => {
    const cell = row.cells[month] || emptyCell(month);
    const finalQty = normalizeQty(cell.finalQty);
    if (cell.excluded === true || finalQty <= 0) return;

    const breakdownGroups = new Map<string, SupplierOutlookSourceBreakdown[]>();
    cell.sourceBreakdown.forEach((entry) => {
      const supplierMonth = resolveSupplierFacingMonth(entry, month);
      if (!breakdownGroups.has(supplierMonth)) breakdownGroups.set(supplierMonth, []);
      (breakdownGroups.get(supplierMonth) as SupplierOutlookSourceBreakdown[]).push(entry);
    });

    if (!breakdownGroups.size) {
      const status = resolveSupplierFacingCellStatus(row, cell);
      aggregates.set(month, {
        qty: (aggregates.get(month)?.qty || 0) + finalQty,
        statuses: [...(aggregates.get(month)?.statuses || []), status],
        poReferences: aggregates.get(month)?.poReferences || new Set<string>(),
      });
      return;
    }

    const allocations = allocateQtyByWeight(
      finalQty,
      Array.from(breakdownGroups.entries()).map(([groupMonth, entries]) => ({
        month: groupMonth,
        weight: systemQtyFromBreakdown(entries),
      })),
    );

    breakdownGroups.forEach((entries, groupMonth) => {
      const allocatedQty = allocations.get(groupMonth) || 0;
      if (allocatedQty <= 0) return;
      const status = resolveSupplierFacingBreakdownStatus(row, cell, entries);
      const existing = aggregates.get(groupMonth) || {
        qty: 0,
        statuses: [],
        poReferences: new Set<string>(),
      };
      const nextReferences = new Set(existing.poReferences);
      entries.forEach((entry) => {
        if (status === "confirmed" && entry.sourceType === "po" && entry.supplierReference) {
          nextReferences.add(entry.supplierReference);
        }
      });
      aggregates.set(groupMonth, {
        qty: existing.qty + allocatedQty,
        statuses: [...existing.statuses, status],
        poReferences: nextReferences,
      });
    });
  });

  return new Map(Array.from(aggregates.entries())
    .sort(([leftMonth], [rightMonth]) => leftMonth.localeCompare(rightMonth))
    .map(([month, aggregate]) => {
      const status = dominantSupplierStatus(aggregate.statuses);
      return [month, {
        month,
        qty: aggregate.qty,
        status,
        text: buildSupplierFacingCellText({
          qty: aggregate.qty,
          status,
          poReferences: Array.from(aggregate.poReferences),
        }),
        hidden: aggregate.qty <= 0,
      } satisfies SupplierOutlookSupplierPreviewCell];
    }));
}

export function resolveSupplierFacingCellStatus(
  row: SupplierOutlookRow,
  cell: SupplierOutlookCell,
): SupplierOutlookSupplierStatus {
  if (row.rowType === "manual") return "indicative";
  const sourceTypes = new Set(cell.sourceBreakdown.map((entry) => entry.sourceType));
  const isOverridden = cell.finalQty !== cell.systemQty || cell.excluded === true || normalizeText(cell.note) || normalizeText(cell.reason);
  if (sourceTypes.has("pfo")) return "indicative";
  if (isOverridden) return "planned";
  if (sourceTypes.has("fo")) return "planned";
  if (sourceTypes.has("po")) return "confirmed";
  return "planned";
}

export function buildSupplierOutlookExportModel(input: {
  record: SupplierOutlookRecord;
  state: Record<string, unknown>;
}): SupplierOutlookExportModel {
  const record = normalizeSupplierOutlookRecord(input.record) as SupplierOutlookRecord;
  const internalMonths = monthRange(record.startMonth, record.horizonMonths);
  const supplierNames = supplierNameById(input.state);
  const supplierName = supplierNames.get(record.supplierId) || record.supplierId || "Lieferant";
  const supplierRowProjections = record.rows
    .map((row) => ({
      row,
      label: resolveSkuLabel(row),
      cells: projectSupplierFacingCells(row, internalMonths),
    }))
    .filter((entry) => entry.cells.size > 0);
  const months = Array.from(new Set(
    supplierRowProjections.flatMap((entry) => Array.from(entry.cells.keys())),
  )).sort();
  const supplierRows = supplierRowProjections
    .map((entry) => ({
      label: entry.label,
      sku: resolveRowSku(entry.row),
      rowType: entry.row.rowType,
      cells: Object.fromEntries(months.map((month) => {
        const cell = entry.cells.get(month);
        return [month, cell || {
          month,
          qty: 0,
          status: "planned",
          text: "",
          hidden: true,
        } satisfies SupplierOutlookSupplierPreviewCell];
      })),
    } satisfies SupplierOutlookSupplierPreviewRow));

  const traceRows = record.rows.flatMap((row) => {
    const label = resolveSkuLabel(row);
    return internalMonths.flatMap((month) => {
      const cell = row.cells[month] || emptyCell(month);
      const systemQty = normalizeQty(cell.systemQty);
      const finalQty = normalizeQty(cell.finalQty);
      const excluded = cell.excluded === true;
      const note = normalizeText(cell.note);
      const reason = normalizeText(cell.reason);
      const hasMaterialValue = systemQty > 0 || finalQty > 0 || excluded || Boolean(note) || Boolean(reason) || cell.sourceBreakdown.length > 0;
      if (!hasMaterialValue) return [];
      return [{
        rowId: row.id,
        label,
        sku: resolveRowSku(row),
        month,
        monthLabel: formatMonthLabel(month),
        systemQty,
        finalQty,
        excluded,
        deviation: finalQty - systemQty,
        supplierStatus: resolveSupplierFacingCellStatus(row, cell),
        sourceSummary: buildSourceSummary(cell.sourceBreakdown),
        sourceRefs: buildSourceRefs(cell.sourceBreakdown),
        timingSummary: buildTimingSummary(cell.sourceBreakdown),
        note,
        reason,
      } satisfies SupplierOutlookTraceRow];
    });
  });

  return {
    supplierId: record.supplierId,
    supplierName,
    startMonth: record.startMonth,
    horizonMonths: record.horizonMonths,
    months,
    supplierMonthAxisLabel: "Bestell-/Signalmonat",
    status: record.status,
    generatedAt: record.generatedAt,
    frozenAt: record.frozenAt || null,
    lastExportedAt: record.lastExportedAt || null,
    lastExportFormat: record.lastExportFormat || null,
    forecastVersionName: record.forecastVersionName || null,
    inventoryBaselineMonth: record.inventoryBaselineMonth || null,
    supplierRows,
    traceRows,
  };
}

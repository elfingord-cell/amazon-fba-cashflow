import { parseDeNumber } from "../../lib/dataHealth.js";
import { evaluateProductCompleteness } from "../../lib/productCompleteness.js";
import { currentMonthKey, monthRange, normalizeMonthKey } from "./months";

export type ProductStatusFilter = "all" | "active" | "prelaunch" | "inactive";
export type ForecastViewMode = "units" | "revenue" | "profit";

export interface ProductGridRow {
  id: string;
  sku: string;
  alias: string;
  supplierId: string;
  categoryId: string | null;
  status: "active" | "prelaunch" | "inactive";
  avgSellingPriceGrossEUR: number | null;
  templateUnitPriceUsd: number | null;
  landedUnitCostEur: number | null;
  shippingPerUnitEur: number | null;
  sellerboardMarginPct: number | null;
  moqUnits: number | null;
  hsCode: string;
  goodsDescription: string;
  completeness: "blocked" | "warn" | "ok";
  raw: Record<string, unknown>;
}

export interface ForecastRecord {
  sku: string;
  month: string;
  units: number | null;
  revenueEur: number | null;
  profitEur: number | null;
}

export interface ForecastProductRow {
  sku: string;
  alias: string;
  categoryLabel: string;
  isActive: boolean;
  avgSellingPriceGrossEUR: number | null;
  sellerboardMarginPct: number | null;
}

export type ManualMap = Record<string, Record<string, number>>;

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function templateFields(product: Record<string, unknown>): Record<string, unknown> {
  const template = (product.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function normalizeStatus(value: unknown): "active" | "prelaunch" | "inactive" {
  const normalized = String(value || "active").trim().toLowerCase();
  if (normalized === "inactive") return "inactive";
  if (normalized === "prelaunch" || normalized === "not_launched" || normalized === "planned") return "prelaunch";
  return "active";
}

export function buildCategoryLabelMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.productCategories) ? state.productCategories : []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const id = String(row.id || "");
    if (!id) return;
    map.set(id, String(row.name || "Ohne Kategorie"));
  });
  return map;
}

export function buildSupplierLabelMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.suppliers) ? state.suppliers : []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const id = String(row.id || "");
    if (!id) return;
    map.set(id, String(row.name || ""));
  });
  return map;
}

export function buildProductGridRows(input: {
  state: Record<string, unknown>;
  search: string;
  statusFilter: ProductStatusFilter;
  categoryLabelById: Map<string, string>;
  supplierLabelById: Map<string, string>;
}): ProductGridRow[] {
  const products = Array.isArray(input.state.products) ? input.state.products : [];
  const mapped = products.map((entry, index) => {
    const product = entry as Record<string, unknown>;
    const template = templateFields(product);
    const sku = String(product.sku || "");
    const completeness = evaluateProductCompleteness(product, { state: input.state })?.status || "blocked";
    return {
      id: String(product.id || (sku ? `prod-${sku}` : `prod-${index}`)),
      sku,
      alias: String(product.alias || ""),
      supplierId: String(product.supplierId || ""),
      categoryId: product.categoryId ? String(product.categoryId) : null,
      status: normalizeStatus(product.status),
      avgSellingPriceGrossEUR: asNumber(product.avgSellingPriceGrossEUR),
      templateUnitPriceUsd: asNumber(template.unitPriceUsd),
      landedUnitCostEur: asNumber(product.landedUnitCostEur),
      shippingPerUnitEur: asNumber(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur),
      sellerboardMarginPct: asNumber(product.sellerboardMarginPct),
      moqUnits: asNumber(product.moqUnits),
      hsCode: String(product.hsCode || "").trim(),
      goodsDescription: String(product.goodsDescription || "").trim(),
      completeness: completeness as "blocked" | "warn" | "ok",
      raw: product,
    } satisfies ProductGridRow;
  });

  const needle = input.search.trim().toLowerCase();
  return mapped
    .filter((row) => {
      if (input.statusFilter !== "all" && row.status !== input.statusFilter) return false;
      if (!needle) return true;
      const haystack = [
        row.sku,
        row.alias,
        row.supplierId,
        row.categoryId || "",
        row.hsCode,
        row.goodsDescription,
        input.supplierLabelById.get(row.supplierId) || "",
        input.categoryLabelById.get(row.categoryId || "") || "",
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

export function isForecastProductActive(product: Record<string, unknown>): boolean {
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv" || status === "prelaunch" || status === "not_launched" || status === "planned";
}

export function normalizeManualMap(source: unknown): ManualMap {
  const out: ManualMap = {};
  if (!source || typeof source !== "object") return out;
  Object.entries(source as Record<string, unknown>).forEach(([sku, monthMap]) => {
    if (!monthMap || typeof monthMap !== "object") return;
    const nextMonthMap: Record<string, number> = {};
    Object.entries(monthMap as Record<string, unknown>).forEach(([monthRaw, value]) => {
      const month = normalizeMonthKey(monthRaw);
      const parsed = parseDeNumber(value);
      if (!month || !Number.isFinite(parsed)) return;
      nextMonthMap[month] = parsed;
    });
    if (Object.keys(nextMonthMap).length) out[sku] = nextMonthMap;
  });
  return out;
}

export function serializeManualMap(source: ManualMap): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  Object.entries(source || {}).forEach(([sku, monthMap]) => {
    const nextMonthMap: Record<string, number> = {};
    Object.entries(monthMap || {}).forEach(([month, value]) => {
      if (!normalizeMonthKey(month)) return;
      if (!Number.isFinite(value)) return;
      nextMonthMap[month] = value;
    });
    if (Object.keys(nextMonthMap).length) out[sku] = nextMonthMap;
  });
  return out;
}

export function getImportValue(
  forecastImport: Record<string, unknown>,
  sku: string,
  month: string,
): ForecastRecord | null {
  const skuMap = forecastImport?.[sku] as Record<string, unknown> | undefined;
  if (!skuMap || typeof skuMap !== "object") return null;
  const row = skuMap[month] as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") return null;
  return {
    sku,
    month,
    units: parseDeNumber(row.units),
    revenueEur: parseDeNumber(row.revenueEur),
    profitEur: parseDeNumber(row.profitEur),
  };
}

export function getEffectiveUnits(
  manual: ManualMap,
  forecastImport: Record<string, unknown>,
  sku: string,
  month: string,
): number | null {
  const manualValue = manual?.[sku]?.[month];
  if (Number.isFinite(manualValue)) return manualValue;
  return getImportValue(forecastImport, sku, month)?.units ?? null;
}

export function deriveForecastValue(view: ForecastViewMode, units: number | null, product: ForecastProductRow): number | null {
  if (!Number.isFinite(units as number)) return null;
  if (view === "units") return Number(units);
  const price = product.avgSellingPriceGrossEUR;
  if (!Number.isFinite(price as number)) return null;
  const revenue = Number(units) * Number(price);
  if (view === "revenue") return revenue;
  const margin = product.sellerboardMarginPct;
  if (!Number.isFinite(margin as number)) return null;
  return revenue * (Number(margin) / 100);
}

export function buildForecastMonths(settings: Record<string, unknown>): string[] {
  const startMonth = normalizeMonthKey(settings.startMonth) || currentMonthKey();
  const horizon = Number(settings.horizonMonths);
  const count = Number.isFinite(horizon) && horizon > 0 ? Math.round(horizon) : 18;
  return monthRange(startMonth, count);
}

export function buildForecastProducts(
  state: Record<string, unknown>,
  categoriesById: Map<string, string>,
): ForecastProductRow[] {
  return (Array.isArray(state.products) ? state.products : [])
    .map((entry) => {
      const product = entry as Record<string, unknown>;
      const sku = String(product.sku || "").trim();
      if (!sku) return null;
      return {
        sku,
        alias: String(product.alias || sku),
        categoryLabel: categoriesById.get(String(product.categoryId || "")) || "Ohne Kategorie",
        isActive: isForecastProductActive(product),
        avgSellingPriceGrossEUR: parseDeNumber(product.avgSellingPriceGrossEUR),
        sellerboardMarginPct: parseDeNumber(product.sellerboardMarginPct),
      } satisfies ForecastProductRow;
    })
    .filter(Boolean) as ForecastProductRow[];
}

export function filterForecastProducts(input: {
  products: ForecastProductRow[];
  search: string;
  onlyActive: boolean;
  onlyWithForecast: boolean;
  visibleMonths: string[];
  manualDraft: ManualMap;
  forecastImport: Record<string, unknown>;
}): ForecastProductRow[] {
  const needle = input.search.trim().toLowerCase();
  return input.products
    .filter((product) => {
      if (input.onlyActive && !product.isActive) return false;
      if (needle) {
        const haystack = [product.sku, product.alias, product.categoryLabel].join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (input.onlyWithForecast) {
        const hasValue = input.visibleMonths.some((month) => {
          const value = getEffectiveUnits(input.manualDraft, input.forecastImport, product.sku, month);
          return Number.isFinite(value as number) && Number(value) > 0;
        });
        if (!hasValue) return false;
      }
      return true;
    })
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

export function buildForecastRevenueByMonth(input: {
  allMonths: string[];
  products: ForecastProductRow[];
  manualDraft: ManualMap;
  forecastImport: Record<string, unknown>;
}): Map<string, number> {
  const map = new Map<string, number>();
  input.allMonths.forEach((month) => map.set(month, 0));
  input.products.forEach((product) => {
    input.allMonths.forEach((month) => {
      const units = getEffectiveUnits(input.manualDraft, input.forecastImport, product.sku, month);
      const revenue = deriveForecastValue("revenue", units, product);
      if (!Number.isFinite(revenue as number)) return;
      map.set(month, (map.get(month) || 0) + Number(revenue));
    });
  });
  return map;
}

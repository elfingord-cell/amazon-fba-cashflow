import { computeInventoryProjection, getProjectionSafetyClass } from "../../domain/inventoryProjection.js";
import { getEffectiveUnits } from "./tableModels";
import { normalizeIncludeInForecast } from "../../domain/portfolioBuckets.js";

export type RiskClass = "normal" | "safety-low" | "safety-negative";

export interface InventoryMonthRiskBySku {
  month: string;
  sku: string;
  abcClass: "A" | "B" | "C";
  riskClass: RiskClass;
}

export interface InventoryMonthRiskSummary {
  month: string;
  abLowCount: number;
  abOosCount: number;
  abRiskSkuCount: number;
  affectedSkus: string[];
}

export interface DashboardMaturityCheckV2 {
  key: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface DashboardMaturityRowV2 {
  month: string;
  scorePct: number;
  allGreen: boolean;
  checks: DashboardMaturityCheckV2[];
}

export interface DashboardEntry {
  id?: string;
  direction?: "in" | "out" | string;
  amount?: number;
  label?: string;
  tooltip?: string;
  date?: string;
  kind?: string;
  group?: string;
  source?: "po" | "fo" | "sales" | "fixcosts" | "extras" | "dividends" | "vat" | string;
  portfolioBucket?: string | null;
  sourceNumber?: string;
  sourceId?: string;
  paid?: boolean;
  provisional?: boolean;
  meta?: Record<string, unknown>;
}

export interface DashboardBreakdownRow {
  month: string;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  net: number;
  plannedClosing?: number;
  actualClosing?: number | null;
  hasActualClosing?: boolean;
  entries?: DashboardEntry[];
}

export interface DashboardPnlRow {
  month: string;
  group: "inflow" | "outflow" | "po_fo" | "fixcost" | "tax" | "other";
  label: string;
  tooltip?: string;
  amount: number;
  provisional: boolean;
  paid: boolean | null;
  source: "po" | "fo" | "sales" | "fixcosts" | "extras" | "dividends" | "vat" | "unknown";
  portfolioBucket?: string | null;
  sourceNumber?: string;
  sourceId?: string;
  tooltipMeta?: {
    aliases: string[];
    units: number | null;
    milestone?: string | null;
    dueDate?: string | null;
  };
  cashInMeta?: {
    quoteSource?: "manual" | "recommendation" | string;
    revenueSource?: "manual_override" | "forecast_calibrated" | "manual_no_forecast" | string;
    component?: "live" | "plan" | string | null;
    forecastRevenueRaw?: number | null;
    calibrationFactorApplied?: number | null;
    calibrationSourceMonth?: string | null;
    calibrationMethod?: "sellerboard" | "linear" | string | null;
    planRevenueAfterCalibration?: number | null;
    recommendationQuotePct?: number | null;
    recommendationSourceTag?: "IST" | "PROGNOSE" | "BASELINE_NORMAL" | "BASELINE_Q4" | string;
    recommendationExplanation?: string | null;
    payoutPct?: number | null;
    payoutAmount?: number | null;
  };
}

interface ProjectionCellData {
  endAvailable?: number | null;
  safetyUnits?: number | null;
  doh?: number | null;
  safetyDays?: number | null;
}

interface ProductLike {
  sku: string;
  status?: unknown;
  includeInForecast?: unknown;
  safetyStockDohOverride?: unknown;
  foCoverageDohOverride?: unknown;
}

function normalizeSkuKey(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeSkuRaw(value: unknown): string {
  return String(value || "").trim();
}

function isActiveProduct(product: ProductLike): boolean {
  if (!normalizeIncludeInForecast(product.includeInForecast, true)) return false;
  if (typeof product.status === "boolean") return Boolean(product.status);
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function resolveAbcClass(abcBySku: Map<string, { abcClass?: string }>, sku: string): "A" | "B" | "C" {
  const byRaw = abcBySku.get(sku);
  const byNormalized = abcBySku.get(normalizeSkuKey(sku));
  const candidate = String(byRaw?.abcClass || byNormalized?.abcClass || "C").toUpperCase();
  if (candidate === "A" || candidate === "B" || candidate === "C") return candidate;
  return "C";
}

function statusWeight(status: "ok" | "warning" | "error"): number {
  if (status === "ok") return 1;
  if (status === "warning") return 0.5;
  return 0;
}

function toRiskClass(value: string): RiskClass {
  if (value === "safety-negative") return "safety-negative";
  if (value === "safety-low") return "safety-low";
  return "normal";
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSignedAmount(entry: DashboardEntry): number {
  const amount = Math.abs(asNumber(entry.amount));
  if (String(entry.direction || "").toLowerCase() === "out") return -amount;
  return amount;
}

function resolvePnlSource(entry: DashboardEntry): DashboardPnlRow["source"] {
  const source = String(entry.source || "").toLowerCase();
  if (source === "po") return "po";
  if (source === "fo") return "fo";
  if (source === "sales" || source === "sales-plan") return "sales";
  if (source === "fixcosts") return "fixcosts";
  if (source === "extras") return "extras";
  if (source === "dividends") return "dividends";
  if (source === "vat") return "vat";
  if (source === "launch-costs") return "extras";
  return "unknown";
}

function resolvePnlGroup(entry: DashboardEntry): DashboardPnlRow["group"] {
  const source = String(entry.source || "").toLowerCase();
  const kind = String(entry.kind || "").toLowerCase();
  const group = String(entry.group || "").toLowerCase();

  if (source === "po" || source === "fo") return "po_fo";
  if (source === "sales" || source === "sales-plan") return "inflow";
  if (source === "fixcosts" || group === "fixkosten") return "fixcost";
  if (
    kind.includes("duty")
    || kind.includes("eust")
    || kind.includes("vat")
    || group.includes("import")
  ) {
    return "tax";
  }
  if (String(entry.direction || "").toLowerCase() === "in") return "inflow";
  if (String(entry.direction || "").toLowerCase() === "out") return "outflow";
  return "other";
}

interface OrderTooltipMeta {
  aliases: string[];
  units: number | null;
}

function buildOrderTooltipMetaIndex(state: Record<string, unknown>): Map<string, OrderTooltipMeta> {
  const products = Array.isArray(state.products) ? state.products as Record<string, unknown>[] : [];
  const aliasBySku = new Map<string, string>();
  products.forEach((product) => {
    const sku = normalizeSkuRaw(product.sku);
    if (!sku) return;
    const alias = String(product.alias || "").trim() || sku;
    aliasBySku.set(sku, alias);
  });

  const index = new Map<string, OrderTooltipMeta>();

  const collect = (prefix: "po" | "fo", order: Record<string, unknown>) => {
    const refs = (
      prefix === "po"
        ? [order.poNo, order.id]
        : [order.foNo, order.foNumber, order.id]
    )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (!refs.length) return;
    const items = Array.isArray(order.items) && order.items.length
      ? (order.items as Record<string, unknown>[])
      : [{ sku: order.sku, units: order.units } as Record<string, unknown>];
    const aliasSet = new Set<string>();
    let totalUnits = 0;
    items.forEach((item) => {
      const sku = normalizeSkuRaw(item.sku);
      if (!sku) return;
      aliasSet.add(aliasBySku.get(sku) || sku);
      const units = asNumber(item.units ?? item.qty ?? item.quantity);
      totalUnits += units;
    });
    const meta = {
      aliases: Array.from(aliasSet),
      units: Number.isFinite(totalUnits) ? totalUnits : null,
    };
    Array.from(new Set(refs)).forEach((ref) => {
      index.set(`${prefix}:${ref}`, meta);
    });
  };

  (Array.isArray(state.pos) ? state.pos as Record<string, unknown>[] : []).forEach((order) => collect("po", order));
  (Array.isArray(state.fos) ? state.fos as Record<string, unknown>[] : []).forEach((order) => collect("fo", order));

  return index;
}

export function buildInventoryMonthRiskIndex(input: {
  state: Record<string, unknown>;
  months: string[];
  abcBySku: Map<string, { abcClass?: string }>;
}): {
  rows: InventoryMonthRiskBySku[];
  summaryByMonth: Map<string, InventoryMonthRiskSummary>;
} {
  const months = Array.isArray(input.months) ? input.months.filter(Boolean) : [];
  const productsRaw = Array.isArray(input.state.products)
    ? input.state.products as ProductLike[]
    : [];

  const activeProducts = productsRaw
    .filter((product) => normalizeSkuRaw(product.sku))
    .filter(isActiveProduct);

  const projection = computeInventoryProjection({
    state: input.state,
    months,
    products: activeProducts,
    snapshot: null,
    snapshotMonth: months[0] || undefined,
    projectionMode: "units",
  }) as {
    perSkuMonth: Map<string, Map<string, ProjectionCellData>>;
  };

  const summaryByMonth = new Map<string, InventoryMonthRiskSummary>();
  months.forEach((month) => {
    summaryByMonth.set(month, {
      month,
      abLowCount: 0,
      abOosCount: 0,
      abRiskSkuCount: 0,
      affectedSkus: [],
    });
  });

  const rows: InventoryMonthRiskBySku[] = [];

  activeProducts.forEach((product) => {
    const sku = normalizeSkuRaw(product.sku);
    if (!sku) return;
    const abcClass = resolveAbcClass(input.abcBySku, sku);
    const skuProjection = projection.perSkuMonth.get(sku) || projection.perSkuMonth.get(normalizeSkuKey(sku));

    months.forEach((month) => {
      const monthData = skuProjection?.get(month);
      const riskClass = toRiskClass(getProjectionSafetyClass({
        projectionMode: "units",
        endAvailable: monthData?.endAvailable,
        safetyUnits: monthData?.safetyUnits,
        doh: monthData?.doh,
        safetyDays: monthData?.safetyDays,
      }));

      rows.push({
        month,
        sku,
        abcClass,
        riskClass,
      });

      if (abcClass !== "A" && abcClass !== "B") return;
      if (riskClass === "normal") return;
      const summary = summaryByMonth.get(month);
      if (!summary) return;
      if (riskClass === "safety-negative") summary.abOosCount += 1;
      if (riskClass === "safety-low") summary.abLowCount += 1;
      summary.affectedSkus.push(sku);
    });
  });

  summaryByMonth.forEach((summary) => {
    summary.abRiskSkuCount = new Set(summary.affectedSkus).size;
    summary.affectedSkus = Array.from(new Set(summary.affectedSkus));
  });

  return {
    rows,
    summaryByMonth,
  };
}

export function buildDashboardMaturityRows(input: {
  months: string[];
  seriesByMonth: Map<string, { inflow?: { total?: number } }>;
  incomingsMonthSet: Set<string>;
  hasFixcosts: boolean;
  hasVatConfig: boolean;
  activeABucketSkus: string[];
  forecastManual: Record<string, Record<string, number>>;
  forecastImport: Record<string, unknown>;
  inventoryRiskSummaryByMonth: Map<string, InventoryMonthRiskSummary>;
}): DashboardMaturityRowV2[] {
  return input.months.map((month) => {
    const seriesForMonth = input.seriesByMonth.get(month);
    const inflow = asNumber(seriesForMonth?.inflow?.total);

    const coveredABCount = input.activeABucketSkus.filter((sku) => {
      const units = getEffectiveUnits(input.forecastManual, input.forecastImport, sku, month);
      return Number.isFinite(units as number) && Number(units) > 0;
    }).length;

    const abCoveragePct = input.activeABucketSkus.length
      ? Math.round((coveredABCount / input.activeABucketSkus.length) * 100)
      : 100;

    const inventorySummary = input.inventoryRiskSummaryByMonth.get(month);
    const abOos = Number(inventorySummary?.abOosCount || 0);
    const abLow = Number(inventorySummary?.abLowCount || 0);

    const checks: DashboardMaturityCheckV2[] = [
      {
        key: "incomings",
        label: "Cash-In Monat gepflegt",
        status: input.incomingsMonthSet.has(month) ? "ok" : "error",
        detail: input.incomingsMonthSet.has(month) ? "vorhanden" : "fehlend",
      },
      {
        key: "inventoryCoverage",
        label: "Bestands-/Bestellabdeckung A/B",
        status: abOos > 0 ? "error" : abLow > 0 ? "warning" : "ok",
        detail:
          abOos > 0
            ? `${abOos} A/B SKU OOS`
            : abLow > 0
              ? `${abLow} A/B SKU unter Safety`
              : "keine A/B Risiken",
      },
      {
        key: "forecastAB",
        label: "A/B-Produkte Forecast",
        status: abCoveragePct === 100 ? "ok" : "warning",
        detail: `${coveredABCount}/${input.activeABucketSkus.length || 0} (${abCoveragePct} %)`,
      },
      {
        key: "fixcosts",
        label: "Fixkosten vorhanden",
        status: input.hasFixcosts ? "ok" : "warning",
        detail: input.hasFixcosts ? "ja" : "nein",
      },
      {
        key: "vat",
        label: "USt-Konfiguration",
        status: input.hasVatConfig ? "ok" : "warning",
        detail: input.hasVatConfig ? "ja" : "nein",
      },
      {
        key: "inflow",
        label: "Einzahlungen geplant",
        status: inflow > 0 ? "ok" : "warning",
        detail: inflow > 0 ? "vorhanden" : "keine Einzahlungen",
      },
    ];

    const score = checks.reduce((sum, check) => sum + statusWeight(check.status), 0);
    const scorePct = checks.length ? Math.round((score / checks.length) * 100) : 0;
    const allGreen = checks.every((check) => check.status === "ok");

    return {
      month,
      checks,
      scorePct,
      allGreen,
    };
  });
}

export function buildDashboardPnlRowsByMonth(input: {
  breakdown: DashboardBreakdownRow[];
  state: Record<string, unknown>;
  provisionalFoIds?: Set<string>;
}): Map<string, DashboardPnlRow[]> {
  const result = new Map<string, DashboardPnlRow[]>();
  const tooltipMetaIndex = buildOrderTooltipMetaIndex(input.state);

  (Array.isArray(input.breakdown) ? input.breakdown : []).forEach((monthRow) => {
    const month = String(monthRow.month || "").trim();
    if (!month) return;
    const entries = Array.isArray(monthRow.entries) ? monthRow.entries : [];
    const rows: DashboardPnlRow[] = entries.map((entry) => {
      const source = resolvePnlSource(entry);
      const sourceNumber = entry.sourceNumber ? String(entry.sourceNumber) : undefined;
      const sourceId = entry.sourceId ? String(entry.sourceId) : undefined;
      const entryMeta = (entry.meta && typeof entry.meta === "object")
        ? entry.meta as Record<string, unknown>
        : {};
      const isProvisionalFo = source === "fo" && (
        entryMeta.phantom === true
        || (sourceId ? input.provisionalFoIds?.has(sourceId) === true : false)
      );
      const provisional = entry.provisional === true || isProvisionalFo;
      const orderMetaKey = sourceNumber && (source === "po" || source === "fo")
        ? `${source}:${sourceNumber}`
        : null;
      const orderMeta = orderMetaKey ? tooltipMetaIndex.get(orderMetaKey) : null;
      const cashInMetaRaw = (entryMeta.cashIn && typeof entryMeta.cashIn === "object")
        ? entryMeta.cashIn as Record<string, unknown>
        : null;

      return {
        month,
        group: resolvePnlGroup(entry),
        label: String(entry.label || "Eintrag"),
        tooltip: typeof entry.tooltip === "string" ? entry.tooltip : undefined,
        amount: toSignedAmount(entry),
        provisional,
        paid: typeof entry.paid === "boolean" ? entry.paid : null,
        source,
        portfolioBucket: entry.portfolioBucket ? String(entry.portfolioBucket) : (entryMeta.portfolioBucket ? String(entryMeta.portfolioBucket) : null),
        sourceNumber,
        sourceId,
        tooltipMeta: orderMeta
          ? {
            aliases: orderMeta.aliases,
            units: orderMeta.units,
            milestone: String(entry.label || ""),
            dueDate: entry.date ? String(entry.date) : null,
          }
          : undefined,
        cashInMeta: cashInMetaRaw
          ? {
            quoteSource: cashInMetaRaw.quoteSource ? String(cashInMetaRaw.quoteSource) : undefined,
            revenueSource: cashInMetaRaw.revenueSource ? String(cashInMetaRaw.revenueSource) : undefined,
            component: cashInMetaRaw.component ? String(cashInMetaRaw.component) : null,
            forecastRevenueRaw: Number.isFinite(Number(cashInMetaRaw.forecastRevenueRaw))
              ? Number(cashInMetaRaw.forecastRevenueRaw)
              : null,
            calibrationFactorApplied: Number.isFinite(Number(cashInMetaRaw.calibrationFactorApplied))
              ? Number(cashInMetaRaw.calibrationFactorApplied)
              : null,
            calibrationSourceMonth: cashInMetaRaw.calibrationSourceMonth
              ? String(cashInMetaRaw.calibrationSourceMonth)
              : null,
            calibrationMethod: cashInMetaRaw.calibrationMethod
              ? String(cashInMetaRaw.calibrationMethod)
              : null,
            planRevenueAfterCalibration: Number.isFinite(Number(cashInMetaRaw.planRevenueAfterCalibration))
              ? Number(cashInMetaRaw.planRevenueAfterCalibration)
              : null,
            payoutPct: Number.isFinite(Number(cashInMetaRaw.payoutPct))
              ? Number(cashInMetaRaw.payoutPct)
              : null,
            payoutAmount: Number.isFinite(Number(cashInMetaRaw.payoutAmount))
              ? Number(cashInMetaRaw.payoutAmount)
              : null,
          }
          : undefined,
      };
    });

    result.set(month, rows);
  });

  return result;
}

import { parseDeNumber } from "../../lib/dataHealth.js";
import { computeAbcClassification } from "../../domain/abcClassification.js";
import { computeInventoryProjection, getProjectionSafetyClass } from "../../domain/inventoryProjection.js";
import { addMonths, currentMonthKey, monthRange, normalizeMonthKey } from "./months";
import {
  buildFoRecommendationContext,
  computeFoRecommendationForSku,
  normalizeFoStatus,
  resolveProductBySku,
} from "./orderUtils";
import { normalizeForecastImportMap } from "./forecastVersioning";

const ABC_THRESHOLD: Record<"A" | "B" | "C", { pct: number; units: number }> = {
  A: { pct: 10, units: 50 },
  B: { pct: 15, units: 80 },
  C: { pct: 25, units: 120 },
};

type AbcClass = "A" | "B" | "C";

interface ForecastVersionLike {
  id?: string;
  name?: string;
  forecastImport?: Record<string, unknown>;
}

interface SkuRiskMeta {
  hasSafetyRisk: boolean;
  firstSafetyMonth: string | null;
}

export interface ForecastSkuImpactRow {
  sku: string;
  alias: string;
  abcClass: AbcClass;
  delta1Units: number;
  delta1Pct: number;
  delta3Units: number;
  delta3Pct: number;
  delta6Units: number;
  delta6Pct: number;
  delta1Revenue: number | null;
  delta3Revenue: number | null;
  delta6Revenue: number | null;
  flagged: boolean;
  reasons: string[];
  firstSafetyMonth: string | null;
}

export type FoConflictType = "units_too_small" | "units_too_large" | "timing_too_late" | "timing_too_early";

export interface FoImpactConflictRow {
  foId: string;
  sku: string;
  alias: string;
  abcClass: AbcClass;
  supplierName: string;
  supplierId: string;
  conflictTypes: FoConflictType[];
  currentUnits: number;
  currentTargetDeliveryDate: string | null;
  currentEtaDate: string | null;
  firstMonthBelowSafety: string | null;
  requiredArrivalDate: string | null;
  requiredArrivalMonth: string | null;
  recommendedUnits: number;
  recommendedOrderDate: string | null;
  recommendedArrivalDate: string | null;
  recommendedArrivalMonth: string | null;
  recommendedCoverageDays: number | null;
  recommendedStatus: string;
  severityScore: number;
  rawFo: Record<string, unknown>;
}

export interface ForecastImpactSummary {
  comparedAt: string;
  fromVersionId: string | null;
  fromVersionName: string | null;
  toVersionId: string | null;
  toVersionName: string | null;
  flaggedSkus: number;
  flaggedAB: number;
  foConflictsTotal: number;
  foConflictsOpen: number;
}

export interface ForecastImpactResult {
  comparedAt: string;
  months: {
    now: string;
    months1: string[];
    months3: string[];
    months6: string[];
  };
  skuRows: ForecastSkuImpactRow[];
  foConflicts: FoImpactConflictRow[];
  summary: ForecastImpactSummary;
}

export interface ComputeForecastImpactInput {
  state: Record<string, unknown>;
  fromVersion: ForecastVersionLike | null;
  toVersion: ForecastVersionLike | null;
  nowMonth?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAbcClass(value: unknown): AbcClass {
  const candidate = String(value || "").trim().toUpperCase();
  if (candidate === "A" || candidate === "B" || candidate === "C") return candidate;
  return "C";
}

function abcPriority(value: AbcClass): number {
  if (value === "A") return 0;
  if (value === "B") return 1;
  return 2;
}

function asNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed);
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Math.max(0, Number(parsed));
}

function percentDelta(previous: number, next: number): number {
  if (previous === 0) return next === 0 ? 0 : 100;
  return ((next - previous) / Math.abs(previous)) * 100;
}

function resolveFromImport(
  index: Map<string, Record<string, unknown>>,
  sku: string,
  month: string,
): { units: number; revenue: number | null } {
  const monthMap = index.get(String(sku || "").trim().toLowerCase()) || {};
  const row = monthMap?.[month];
  if (!row || typeof row !== "object") return { units: 0, revenue: null };
  const units = asNumber((row as Record<string, unknown>).units);
  const revenue = asNumber((row as Record<string, unknown>).revenueEur);
  return {
    units: Number.isFinite(units as number) ? Number(units) : 0,
    revenue: Number.isFinite(revenue as number) ? Number(revenue) : null,
  };
}

function sumForWindow(
  index: Map<string, Record<string, unknown>>,
  sku: string,
  months: string[],
): { units: number; revenue: number | null } {
  let units = 0;
  let revenue = 0;
  let hasRevenue = false;
  months.forEach((month) => {
    const row = resolveFromImport(index, sku, month);
    units += Number(row.units || 0);
    if (Number.isFinite(row.revenue as number)) {
      revenue += Number(row.revenue || 0);
      hasRevenue = true;
    }
  });
  return {
    units,
    revenue: hasRevenue ? revenue : null,
  };
}

function mapImportBySku(input: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  Object.entries(input || {}).forEach(([skuRaw, monthMapRaw]) => {
    const sku = String(skuRaw || "").trim();
    if (!sku || !monthMapRaw || typeof monthMapRaw !== "object") return;
    out.set(sku.toLowerCase(), monthMapRaw as Record<string, unknown>);
  });
  return out;
}

function resolveFoArrivalDate(fo: Record<string, unknown>): string | null {
  const fields = ["targetDeliveryDate", "deliveryDate", "etaDate", "etaManual", "eta", "arrivalDate", "arrivalDateDe"];
  for (const field of fields) {
    const value = String(fo?.[field] || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}

function resolveFoLeadTimeDays(fo: Record<string, unknown>, product: Record<string, unknown> | null, settings: Record<string, unknown>): number {
  const fromFo = Number(fo.productionLeadTimeDays || 0) + Number(fo.logisticsLeadTimeDays || 0) + Number(fo.bufferDays || 0);
  if (Number.isFinite(fromFo) && fromFo > 0) return Math.round(fromFo);
  const fromProduct = Number(product?.productionLeadTimeDaysDefault || 0) + Number(product?.transitDays || 0) + Number(settings?.defaultBufferDays || 0);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return Math.round(fromProduct);
  const fromSettings = Number(settings?.defaultProductionLeadTimeDays || 0) + Number(settings?.transportLeadTimesDays?.sea || 0) + Number(settings?.defaultBufferDays || 0);
  if (Number.isFinite(fromSettings) && fromSettings > 0) return Math.round(fromSettings);
  return 0;
}

function buildSupplierNameMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.suppliers) ? state.suppliers : []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const id = String(row.id || "").trim();
    if (!id) return;
    map.set(id, String(row.name || id));
  });
  return map;
}

function buildProductPriceMap(state: Record<string, unknown>): Map<string, number> {
  const map = new Map<string, number>();
  (Array.isArray(state.products) ? state.products : []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const sku = String(row.sku || "").trim();
    if (!sku) return;
    const price = asNumber(row.avgSellingPriceGrossEUR);
    if (!Number.isFinite(price as number) || Number(price) <= 0) return;
    map.set(sku.toLowerCase(), Number(price));
  });
  return map;
}

function buildAliasMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.products) ? state.products : []).forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const sku = String(row.sku || "").trim();
    if (!sku) return;
    map.set(sku.toLowerCase(), String(row.alias || sku));
  });
  return map;
}

function buildAbcMap(state: Record<string, unknown>): Map<string, AbcClass> {
  const copy = structuredClone(state || {});
  const classification = computeAbcClassification(copy as Record<string, unknown>);
  const map = new Map<string, AbcClass>();
  classification.bySku.forEach((entry, key) => {
    const skuKey = String(key || "").trim().toLowerCase();
    if (!skuKey) return;
    map.set(skuKey, normalizeAbcClass((entry as Record<string, unknown>)?.abcClass));
  });
  return map;
}

function buildSkuRiskMeta(stateWithForecast: Record<string, unknown>, nowMonth: string): Map<string, SkuRiskMeta> {
  const monthList = monthRange(nowMonth, 12);
  const projection = computeInventoryProjection({
    state: stateWithForecast,
    months: monthList,
    products: Array.isArray(stateWithForecast.products) ? stateWithForecast.products : [],
    projectionMode: "units",
  }) as {
    perSkuMonth: Map<string, Map<string, Record<string, unknown>>>;
  };
  const result = new Map<string, SkuRiskMeta>();
  projection.perSkuMonth.forEach((monthMap, skuRaw) => {
    const sku = String(skuRaw || "").trim().toLowerCase();
    if (!sku) return;
    let firstSafetyMonth: string | null = null;
    monthList.forEach((month) => {
      if (firstSafetyMonth) return;
      const row = monthMap?.get(month);
      if (!row) return;
      const riskClass = getProjectionSafetyClass({
        projectionMode: "units",
        endAvailable: row.endAvailable,
        safetyUnits: row.safetyUnits,
        doh: row.doh,
        safetyDays: row.safetyDays,
      });
      if (riskClass === "safety-low" || riskClass === "safety-negative") {
        firstSafetyMonth = month;
      }
    });
    result.set(sku, {
      hasSafetyRisk: Boolean(firstSafetyMonth),
      firstSafetyMonth,
    });
  });
  return result;
}

function computeSeverityScore(input: {
  abcClass: AbcClass;
  firstSafetyMonth: string | null;
  conflictTypes: FoConflictType[];
  recommendedArrivalMonth: string | null;
}): number {
  const abcBase = input.abcClass === "A" ? 0 : input.abcClass === "B" ? 1000 : 2000;
  const monthScore = input.recommendedArrivalMonth
    ? Number(String(input.recommendedArrivalMonth).replace("-", ""))
    : 999999;
  const typePenalty = input.conflictTypes.includes("timing_too_late")
    ? -150
    : input.conflictTypes.includes("units_too_small")
      ? -90
      : input.conflictTypes.includes("timing_too_early")
        ? -20
        : 0;
  const safetyPenalty = input.firstSafetyMonth ? -40 : 0;
  return abcBase + monthScore + typePenalty + safetyPenalty;
}

export function computeForecastImpact(input: ComputeForecastImpactInput): ForecastImpactResult {
  const nowMonth = normalizeMonthKey(input.nowMonth || currentMonthKey()) || currentMonthKey();
  const months1 = [nowMonth];
  const months3 = [nowMonth, addMonths(nowMonth, 1), addMonths(nowMonth, 2)];
  const months6 = [nowMonth, addMonths(nowMonth, 1), addMonths(nowMonth, 2), addMonths(nowMonth, 3), addMonths(nowMonth, 4), addMonths(nowMonth, 5)];

  const comparedAt = nowIso();
  const previousImport = normalizeForecastImportMap(input.fromVersion?.forecastImport || {});
  const nextImport = normalizeForecastImportMap(input.toVersion?.forecastImport || {});
  const previousIndex = mapImportBySku(previousImport);
  const nextIndex = mapImportBySku(nextImport);

  const stateForNext = structuredClone(input.state || {});
  if (!stateForNext.forecast || typeof stateForNext.forecast !== "object") {
    stateForNext.forecast = {};
  }
  (stateForNext.forecast as Record<string, unknown>).forecastImport = structuredClone(nextImport);

  const abcBySku = buildAbcMap(stateForNext);
  const aliasBySku = buildAliasMap(stateForNext);
  const priceBySku = buildProductPriceMap(stateForNext);
  const skuRiskBySku = buildSkuRiskMeta(stateForNext, nowMonth);

  const skuSet = new Set<string>([
    ...Array.from(previousIndex.keys()),
    ...Array.from(nextIndex.keys()),
    ...((Array.isArray(stateForNext.products) ? stateForNext.products : [])
      .map((entry) => String((entry as Record<string, unknown>)?.sku || "").trim().toLowerCase())
      .filter(Boolean)),
  ]);

  const skuRows: ForecastSkuImpactRow[] = Array.from(skuSet)
    .map((skuKey) => {
      const abcClass = abcBySku.get(skuKey) || "C";
      const threshold = ABC_THRESHOLD[abcClass];
      const prev1 = sumForWindow(previousIndex, skuKey, months1);
      const prev3 = sumForWindow(previousIndex, skuKey, months3);
      const prev6 = sumForWindow(previousIndex, skuKey, months6);
      const next1 = sumForWindow(nextIndex, skuKey, months1);
      const next3 = sumForWindow(nextIndex, skuKey, months3);
      const next6 = sumForWindow(nextIndex, skuKey, months6);
      const delta1Units = next1.units - prev1.units;
      const delta3Units = next3.units - prev3.units;
      const delta6Units = next6.units - prev6.units;
      const delta1Pct = percentDelta(prev1.units, next1.units);
      const delta3Pct = percentDelta(prev3.units, next3.units);
      const delta6Pct = percentDelta(prev6.units, next6.units);
      const fallbackPrice = priceBySku.get(skuKey) ?? null;
      const delta1Revenue = Number.isFinite(prev1.revenue as number) && Number.isFinite(next1.revenue as number)
        ? Number(next1.revenue || 0) - Number(prev1.revenue || 0)
        : (Number.isFinite(fallbackPrice as number) ? delta1Units * Number(fallbackPrice) : null);
      const delta3Revenue = Number.isFinite(prev3.revenue as number) && Number.isFinite(next3.revenue as number)
        ? Number(next3.revenue || 0) - Number(prev3.revenue || 0)
        : (Number.isFinite(fallbackPrice as number) ? delta3Units * Number(fallbackPrice) : null);
      const delta6Revenue = Number.isFinite(prev6.revenue as number) && Number.isFinite(next6.revenue as number)
        ? Number(next6.revenue || 0) - Number(prev6.revenue || 0)
        : (Number.isFinite(fallbackPrice as number) ? delta6Units * Number(fallbackPrice) : null);
      const riskMeta = skuRiskBySku.get(skuKey) || { hasSafetyRisk: false, firstSafetyMonth: null };
      const thresholdHit = Math.abs(delta3Pct) > threshold.pct || Math.abs(delta3Units) > threshold.units;
      const reasons: string[] = [];
      if (thresholdHit) reasons.push("abc_threshold");
      if (riskMeta.hasSafetyRisk) reasons.push("safety_risk");
      const flagged = thresholdHit || riskMeta.hasSafetyRisk;

      return {
        sku: skuKey.toUpperCase(),
        alias: aliasBySku.get(skuKey) || skuKey.toUpperCase(),
        abcClass,
        delta1Units,
        delta1Pct,
        delta3Units,
        delta3Pct,
        delta6Units,
        delta6Pct,
        delta1Revenue,
        delta3Revenue,
        delta6Revenue,
        flagged,
        reasons,
        firstSafetyMonth: riskMeta.firstSafetyMonth,
      } satisfies ForecastSkuImpactRow;
    })
    .sort((left, right) => {
      const abc = abcPriority(left.abcClass) - abcPriority(right.abcClass);
      if (abc !== 0) return abc;
      const delta = Math.abs(right.delta3Units) - Math.abs(left.delta3Units);
      if (delta !== 0) return delta;
      return left.sku.localeCompare(right.sku);
    });

  const settings = (stateForNext.settings || {}) as Record<string, unknown>;
  const products = (Array.isArray(stateForNext.products) ? stateForNext.products : []) as Array<Record<string, unknown>>;
  const supplierById = buildSupplierNameMap(stateForNext);
  const recommendationContext = buildFoRecommendationContext(stateForNext);

  const foConflicts: FoImpactConflictRow[] = (Array.isArray(stateForNext.fos) ? stateForNext.fos : [])
    .map((entry) => entry as Record<string, unknown>)
    .filter((fo) => {
      const status = normalizeFoStatus(fo.status);
      return status === "ACTIVE" || status === "DRAFT";
    })
    .map((fo) => {
      const foId = String(fo.id || "").trim();
      const skuRaw = String(fo.sku || "").trim();
      const skuKey = skuRaw.toLowerCase();
      if (!foId || !skuKey) return null;
      const product = resolveProductBySku(products, skuRaw);
      const abcClass = abcBySku.get(skuKey) || "C";
      const threshold = ABC_THRESHOLD[abcClass];
      const leadTimeDays = resolveFoLeadTimeDays(fo, product, settings);
      const recommendation = computeFoRecommendationForSku({
        context: recommendationContext,
        sku: skuRaw,
        leadTimeDays,
        product,
        settings,
        horizonMonths: 12,
      }) as Record<string, unknown> | null;
      if (!recommendation || String(recommendation.status || "") !== "ok") return null;

      const requiredArrivalDate = String(recommendation.requiredArrivalDate || "") || null;
      const requiredArrivalMonth = requiredArrivalDate ? requiredArrivalDate.slice(0, 7) : null;
      const recommendedOrderDate = String(recommendation.orderDateAdjusted || recommendation.orderDate || "") || null;
      const recommendedUnits = Math.max(0, Math.round(Number(recommendation.recommendedUnits || 0)));
      const recommendedCoverageDays = asPositiveNumber(recommendation.coverageDays);
      const currentUnits = Math.max(0, Math.round(Number(fo.units || 0)));
      const currentTargetDeliveryDate = String(fo.targetDeliveryDate || "") || null;
      const currentEtaDate = String(fo.etaDate || "") || null;
      const currentArrivalDate = resolveFoArrivalDate(fo);
      const currentArrivalMonth = currentArrivalDate ? currentArrivalDate.slice(0, 7) : null;
      const riskMeta = skuRiskBySku.get(skuKey) || { hasSafetyRisk: false, firstSafetyMonth: null };
      const firstMonthBelowSafety = riskMeta.firstSafetyMonth;
      const deltaUnits = currentUnits - recommendedUnits;
      const deltaPct = recommendedUnits > 0
        ? (deltaUnits / recommendedUnits) * 100
        : (currentUnits > 0 ? 100 : 0);
      const coverageExcess = Math.abs(deltaPct) > threshold.pct || Math.abs(deltaUnits) > threshold.units;

      const conflictTypes: FoConflictType[] = [];
      if (currentUnits < recommendedUnits && (coverageExcess || riskMeta.hasSafetyRisk)) {
        conflictTypes.push("units_too_small");
      }
      if (currentUnits > recommendedUnits && coverageExcess) {
        conflictTypes.push("units_too_large");
      }
      if (
        currentArrivalMonth
        && (
          (requiredArrivalMonth && currentArrivalMonth > requiredArrivalMonth)
          || (firstMonthBelowSafety && currentArrivalMonth > firstMonthBelowSafety)
        )
      ) {
        conflictTypes.push("timing_too_late");
      }
      if (
        currentArrivalMonth
        && requiredArrivalMonth
        && currentArrivalMonth < requiredArrivalMonth
        && currentUnits > recommendedUnits
        && coverageExcess
      ) {
        conflictTypes.push("timing_too_early");
      }

      if (!conflictTypes.length) return null;
      const severityScore = computeSeverityScore({
        abcClass,
        firstSafetyMonth: firstMonthBelowSafety,
        conflictTypes,
        recommendedArrivalMonth: requiredArrivalMonth,
      });
      return {
        foId,
        sku: skuRaw,
        alias: aliasBySku.get(skuKey) || skuRaw,
        abcClass,
        supplierName: supplierById.get(String(fo.supplierId || "")) || String(fo.supplierId || "—"),
        supplierId: String(fo.supplierId || ""),
        conflictTypes,
        currentUnits,
        currentTargetDeliveryDate,
        currentEtaDate,
        firstMonthBelowSafety,
        requiredArrivalDate,
        requiredArrivalMonth,
        recommendedUnits,
        recommendedOrderDate,
        recommendedArrivalDate: requiredArrivalDate,
        recommendedArrivalMonth: requiredArrivalMonth,
        recommendedCoverageDays,
        recommendedStatus: String(recommendation.status || ""),
        severityScore,
        rawFo: fo,
      } satisfies FoImpactConflictRow;
    })
    .filter(Boolean) as FoImpactConflictRow[];

  foConflicts.sort((left, right) => {
    if (left.severityScore !== right.severityScore) return left.severityScore - right.severityScore;
    if (left.requiredArrivalMonth !== right.requiredArrivalMonth) {
      return String(left.requiredArrivalMonth || "").localeCompare(String(right.requiredArrivalMonth || ""));
    }
    return left.foId.localeCompare(right.foId);
  });

  const flaggedRows = skuRows.filter((row) => row.flagged);
  const summary: ForecastImpactSummary = {
    comparedAt,
    fromVersionId: input.fromVersion?.id ? String(input.fromVersion.id) : null,
    fromVersionName: input.fromVersion?.name ? String(input.fromVersion.name) : null,
    toVersionId: input.toVersion?.id ? String(input.toVersion.id) : null,
    toVersionName: input.toVersion?.name ? String(input.toVersion.name) : null,
    flaggedSkus: flaggedRows.length,
    flaggedAB: flaggedRows.filter((row) => row.abcClass === "A" || row.abcClass === "B").length,
    foConflictsTotal: foConflicts.length,
    foConflictsOpen: foConflicts.length,
  };

  return {
    comparedAt,
    months: {
      now: nowMonth,
      months1,
      months3,
      months6,
    },
    skuRows,
    foConflicts,
    summary,
  };
}

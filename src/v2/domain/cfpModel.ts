// CFP Mobile — pures Datenmodell.
//
// Spiegelt EXAKT die Berechnungs-Pipeline aus
// `src/v2/modules/dashboard/index.tsx` (DashboardModule), nur als pure
// Funktion gekapselt, damit die Mobile-App dieselben Zahlen wie das Desktop-
// Dashboard zeigt, OHNE den Desktop-Code zu berühren.
//
// WICHTIG: Wenn sich die Pipeline im Desktop-Dashboard ändert (Schritte 1–11
// unten), muss diese Funktion nachgezogen werden. Die zugrundeliegende Logik
// liegt in den hier importierten Domain-Funktionen (computeSeries,
// buildMonthPlanningResult, aggregateDashboardMonthEntries, …) — hier wird nur
// dieselbe Orchestrierung nachgebaut.

import { computeSeries } from "../../domain/cashflow.js";
import { PORTFOLIO_BUCKET } from "../../domain/portfolioBuckets.js";
import { buildSharedPlanProductProjection } from "../../domain/planProducts.js";
import {
  aggregateDashboardMonthEntries,
  alignDashboardCashInToMirror,
  applyDashboardBucketScopeToBreakdown,
  applyTaxInstancesToBreakdown,
  DEFAULT_V2_BUCKET_SCOPE,
  type DashboardCashflowEntry,
  type DashboardMonthAggregation,
} from "./dashboardCashflow";
import { buildCashInPayoutMirrorByMonth } from "./cashInPayoutMirror";
import { buildMonthPlanningResult, type MonthPlanningMonth, type MonthPlanningResult } from "./monthPlanning";
import { buildPhantomFoSuggestions, type PhantomFoSuggestion } from "./phantomFo";
import { currentMonthKey, formatMonthLabel, monthIndex, normalizeMonthKey } from "./months";

// Re-Export für die Mobile-Schicht (cfpModel ist die Mobile-zugewandte API).
export { DEFAULT_V2_BUCKET_SCOPE };

export type CfpRange = "next6" | "next12" | "next18" | "all";
export type CfpQuoteMode = "manual" | "recommendation";
export type CfpRevenueBasisMode = "hybrid" | "forecast_direct";

export const CFP_RANGE_OPTIONS: Array<{ value: CfpRange; label: string; shortLabel: string; count: number | null }> = [
  { value: "next6", label: "6 Monate", shortLabel: "6M", count: 6 },
  { value: "next12", label: "12 Monate", shortLabel: "12M", count: 12 },
  { value: "next18", label: "18 Monate", shortLabel: "18M", count: 18 },
  { value: "all", label: "Alle", shortLabel: "Alle", count: null },
];

export const CFP_BUCKET_OPTIONS = [
  { value: PORTFOLIO_BUCKET.CORE, label: "Core", hint: "Bestseller · stabile Marge" },
  { value: PORTFOLIO_BUCKET.PLAN, label: "Plan", hint: "Wachstum · saisonal" },
  { value: PORTFOLIO_BUCKET.IDEAS, label: "Ideen", hint: "Idee · grobe Planung" },
];

export interface CfpMonthRow {
  month: string;
  label: string;
  opening: number;
  closing: number;
  inflow: number;
  outflow: number;
  net: number;
  inflowSplit: DashboardMonthAggregation["inflow"];
  outflowSplit: DashboardMonthAggregation["outflow"];
  entries: DashboardCashflowEntry[];
  robust: boolean;
  statusKey: string;
  statusLabel: string;
  coverageRatio: number;
  coveredSkus: number;
  activeSkus: number;
  blockerCount: number;
  blockers: Array<{ id: string; message: string; route: string }>;
  hasActualClosing: boolean;
  isPast: boolean;
  isCurrent: boolean;
}

export interface CfpRadarItem {
  id: string;
  sku: string;
  alias: string;
  supplierId: string;
  units: number;
  value: number | null;
  latestOrderDate: string;
  requiredArrivalDate: string;
  orderMonth: string;
  firstRiskMonth: string;
  overdue: boolean;
  shortageUnits: number | null;
}

export interface CfpModel {
  months: string[];
  visibleMonths: string[];
  currentMonth: string;
  opening: number;
  // Erster Negativmonat über den VOLLEN Horizont (aus computeSeries.kpis) — informativ.
  firstNegativeMonth: string | null;
  // Erster Negativmonat im SICHTBAREN Fenster (rows). Treibt Hero-Chip & Banner,
  // damit die Liquiditätslücken-Warnung immer mit Tiefstand/minClosing übereinstimmt.
  firstNegativeVisibleMonth: string | null;
  rows: CfpMonthRow[];
  totals: { inflow: number; outflow: number; net: number; minClosing: number | null };
  radar: CfpRadarItem[];
  radarTotalValue: number | null;
  robustness: MonthPlanningResult;
  cockpit: {
    bucketScope: string[];
    quoteMode: CfpQuoteMode;
    revenueBasisMode: CfpRevenueBasisMode;
    calibrationEnabled: boolean;
  };
}

export interface CfpModelParams {
  range: CfpRange;
  bucketScope?: string[];
  quoteMode: CfpQuoteMode;
  revenueBasisMode: CfpRevenueBasisMode;
  calibrationEnabled: boolean;
  showAllPastMonths?: boolean;
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyDashboardCalculationOverrides(
  sourceState: Record<string, unknown>,
  options: { quoteMode: CfpQuoteMode; revenueBasisMode: CfpRevenueBasisMode; calibrationEnabled: boolean },
): Record<string, unknown> {
  const next = structuredClone(sourceState || {});
  if (!next.settings || typeof next.settings !== "object") next.settings = {};
  const settings = next.settings as Record<string, unknown>;
  settings.cashInQuoteMode = options.quoteMode;
  settings.cashInCalibrationEnabled = options.calibrationEnabled;
  settings.cashInRevenueBasisMode = options.revenueBasisMode;
  return next;
}

function deriveRadarValue(suggestion: PhantomFoSuggestion): number | null {
  const fo = (suggestion.foRecord && typeof suggestion.foRecord === "object")
    ? suggestion.foRecord as Record<string, unknown>
    : {};
  const direct = toFiniteNumberOrNull(fo.value ?? fo.amount ?? fo.totalValue ?? fo.orderValue);
  if (direct != null && direct > 0) return direct;
  const items = Array.isArray(fo.items) ? fo.items as Record<string, unknown>[] : [];
  if (items.length) {
    const sum = items.reduce((acc, item) => {
      const lineValue = toFiniteNumberOrNull(item.value ?? item.amount ?? item.lineTotal);
      if (lineValue != null) return acc + lineValue;
      const units = Number(item.units ?? item.qty ?? item.quantity ?? 0);
      const unitCost = toFiniteNumberOrNull(item.unitCost ?? item.ek ?? item.landedCost);
      return unitCost != null ? acc + units * unitCost : acc;
    }, 0);
    if (sum > 0) return sum;
  }
  return null;
}

/**
 * Baut das komplette Mobile-Datenmodell aus dem rohen Workspace-State.
 * Spiegelt die Desktop-Pipeline (siehe Kopfkommentar).
 */
export function buildCfpModel(rawState: Record<string, unknown>, params: CfpModelParams): CfpModel {
  const stateObject = (rawState && typeof rawState === "object") ? rawState : {};
  const settings = (stateObject.settings && typeof stateObject.settings === "object")
    ? stateObject.settings as Record<string, unknown>
    : {};
  const bucketScope = (params.bucketScope && params.bucketScope.length)
    ? params.bucketScope.slice()
    : DEFAULT_V2_BUCKET_SCOPE.slice();
  const bucketScopeSet = new Set(bucketScope);
  const currentMonth = currentMonthKey();

  // 1) Plan-Projektion -> Berechnungs-State
  const sharedPlanProjection = buildSharedPlanProductProjection({ state: stateObject });
  const dashboardSeriesState = (sharedPlanProjection?.planningState || stateObject) as Record<string, unknown>;

  // 2) Erforderlicher Horizont aus dem gewählten Zeitraum
  const option = CFP_RANGE_OPTIONS.find((entry) => entry.value === params.range);
  const settingsHorizon = Math.max(1, Number(settings.horizonMonths) || 12);
  let requiredHorizon = settingsHorizon;
  if (option && option.count != null) {
    const startMonthRaw = normalizeMonthKey(settings.startMonth) || currentMonth;
    const startIdx = monthIndex(startMonthRaw);
    const currentIdx = monthIndex(currentMonth);
    const monthsBeforeNow = startIdx != null && currentIdx != null ? Math.max(0, currentIdx - startIdx) : 0;
    requiredHorizon = Math.max(settingsHorizon, monthsBeforeNow + option.count);
  }

  // 3) Cash-in-Overrides + Horizont
  const base = applyDashboardCalculationOverrides(dashboardSeriesState, {
    quoteMode: params.quoteMode,
    revenueBasisMode: params.revenueBasisMode,
    calibrationEnabled: params.calibrationEnabled,
  });
  const baseSettings = (base.settings && typeof base.settings === "object")
    ? base.settings as Record<string, unknown>
    : {};
  const calculationState = {
    ...base,
    settings: { ...baseSettings, horizonMonths: requiredHorizon },
  } as Record<string, unknown>;

  // 4) Serie berechnen
  const report = computeSeries(calculationState) as {
    months?: string[];
    breakdown?: Array<{ month: string }>;
    kpis?: { opening?: number; firstNegativeMonth?: string | null };
  };
  const months = report.months || [];
  const breakdown = (report.breakdown || []) as Parameters<typeof applyTaxInstancesToBreakdown>[0];

  // 5) Cash-in-Spiegel
  const cashInMirrorByMonth = buildCashInPayoutMirrorByMonth({ months, state: calculationState });

  // 6) Dashboard-Breakdown (Steuern + Cash-in-Spiegel)
  const dashboardBreakdown = alignDashboardCashInToMirror(
    applyTaxInstancesToBreakdown(breakdown, stateObject),
    cashInMirrorByMonth,
  );

  // 7) Sichtbarkeits-Fenster (letzter abgeschlossener Referenzmonat + Future-Window)
  const monthClosedByMonth = new Map<string, boolean>();
  const monthlyActualsMap = (stateObject.monthlyActuals && typeof stateObject.monthlyActuals === "object")
    ? stateObject.monthlyActuals as Record<string, Record<string, unknown>>
    : {};
  months.forEach((month) => {
    const entry = monthlyActualsMap[month];
    const closed = Number.isFinite(Number(entry?.realRevenueEUR))
      && Number.isFinite(Number(entry?.realPayoutRatePct))
      && Number.isFinite(Number(entry?.realClosingBalanceEUR));
    monthClosedByMonth.set(month, closed);
  });
  const past = months.filter((m) => m < currentMonth);
  const future = months.filter((m) => m >= currentMonth);
  const futureWindow = option?.count == null ? future : future.slice(0, option.count);
  const lastClosed = [...past].reverse().find((m) => monthClosedByMonth.get(m) === true) || null;
  let visibleMonths: string[];
  if (option?.count == null || params.showAllPastMonths) {
    visibleMonths = [...past, ...futureWindow];
  } else {
    const visiblePast = lastClosed ? [lastClosed] : [];
    visibleMonths = [...visiblePast, ...futureWindow];
  }
  const visibleMonthSet = new Set(visibleMonths);

  // 8) Bucket-Scope auf den Breakdown anwenden
  const filteredByMonth = dashboardBreakdown.filter((row) => visibleMonthSet.has(row.month));
  const visibleBreakdown = applyDashboardBucketScopeToBreakdown(filteredByMonth, bucketScopeSet);

  // 9) Robustheit / Monatsplanung
  const robustness = buildMonthPlanningResult({ state: stateObject, months: visibleMonths });

  // 10) Phantom-FO-Vorschläge (Radar)
  const phantomFoSuggestions = buildPhantomFoSuggestions({ state: stateObject });
  const phantomFoIdSet = new Set(phantomFoSuggestions.map((entry) => entry.id));

  // 11) Pro-Monats-Zeilen mit In-/Outflow-Split
  const currentIdx = monthIndex(currentMonth);
  const rows: CfpMonthRow[] = visibleBreakdown.map((row) => {
    const entries = Array.isArray(row.entries) ? row.entries : [];
    const aggregation = aggregateDashboardMonthEntries(entries, {
      bucketScope: bucketScopeSet,
      provisionalFoIds: phantomFoIdSet,
    });
    const planMonth: MonthPlanningMonth | undefined = robustness.monthMap.get(row.month);
    const coverage = planMonth?.coverage;
    const rowIdx = monthIndex(row.month);
    const blockers = (planMonth?.blockers || []).map((blocker) => ({
      id: String(blocker.id || `${row.month}:blocker`),
      message: String(blocker.message || ""),
      route: String(blocker.route || ""),
    }));
    return {
      month: row.month,
      label: formatMonthLabel(row.month),
      opening: Number(row.opening || 0),
      closing: Number(row.closing || 0),
      inflow: Number(row.inflow || 0),
      outflow: Number(row.outflow || 0),
      net: Number(row.net || 0),
      inflowSplit: aggregation.inflow,
      outflowSplit: aggregation.outflow,
      entries,
      robust: planMonth?.robust === true,
      statusKey: coverage?.statusKey || "insufficient",
      statusLabel: planMonth?.statusLabel || coverage?.statusLabel || "—",
      coverageRatio: Number(coverage?.ratio || 0),
      coveredSkus: Number(coverage?.coveredSkus || 0),
      activeSkus: Number(coverage?.activeSkus || 0),
      blockerCount: Number(planMonth?.blockerCount || 0),
      blockers,
      hasActualClosing: row.hasActualClosing === true,
      isPast: rowIdx != null && currentIdx != null ? rowIdx < currentIdx : row.month < currentMonth,
      isCurrent: row.month === currentMonth,
    };
  });

  const totalInflow = rows.reduce((sum, row) => sum + row.inflow, 0);
  const totalOutflow = rows.reduce((sum, row) => sum + row.outflow, 0);
  const totalNet = rows.reduce((sum, row) => sum + row.net, 0);
  const minClosing = rows.length ? Math.min(...rows.map((row) => row.closing)) : null;
  const firstNegativeVisibleMonth = rows.find((row) => row.closing < 0)?.month || null;

  const radar: CfpRadarItem[] = phantomFoSuggestions.map((suggestion) => ({
    id: suggestion.id,
    sku: suggestion.sku,
    alias: suggestion.alias || suggestion.sku,
    supplierId: suggestion.supplierId || "",
    units: Number(suggestion.suggestedUnits || 0),
    value: deriveRadarValue(suggestion),
    latestOrderDate: suggestion.latestOrderDate || "",
    requiredArrivalDate: suggestion.requiredArrivalDate || "",
    orderMonth: suggestion.orderMonth || "",
    firstRiskMonth: suggestion.firstRiskMonth || "",
    overdue: suggestion.overdue === true,
    shortageUnits: suggestion.shortageUnits ?? null,
  }));
  const radarValues = radar.map((entry) => entry.value).filter((value): value is number => value != null);
  const radarTotalValue = radarValues.length ? radarValues.reduce((sum, value) => sum + value, 0) : null;

  return {
    months,
    visibleMonths,
    currentMonth,
    opening: Number(report.kpis?.opening || 0),
    firstNegativeMonth: report.kpis?.firstNegativeMonth || null,
    firstNegativeVisibleMonth,
    rows,
    totals: { inflow: totalInflow, outflow: totalOutflow, net: totalNet, minClosing },
    radar,
    radarTotalValue,
    robustness,
    cockpit: {
      bucketScope,
      quoteMode: params.quoteMode,
      revenueBasisMode: params.revenueBasisMode,
      calibrationEnabled: params.calibrationEnabled,
    },
  };
}

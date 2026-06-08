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
import { buildPhantomFoSuggestions } from "./phantomFo";
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
  blockers: Array<{ id: string; message: string; route: string; category: string; sku?: string; alias?: string }>;
  // Niedrigster Endsaldo von DIESEM Monat bis zum Ende des Fensters — „Puffer ab hier".
  // Beantwortet z. B. „kann ich in diesem Monat eine Dividende leisten, ohne den Tiefstand zu reißen?".
  minClosingFromHere: number;
  hasActualClosing: boolean;
  isPast: boolean;
  isCurrent: boolean;
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
  // Monat des niedrigsten Endsaldos im sichtbaren Fenster (Tiefstand) — für „Tiefstand · <Monat>".
  minClosingMonth: string | null;
  rows: CfpMonthRow[];
  totals: { inflow: number; outflow: number; net: number; minClosing: number | null };
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

/**
 * Baut das komplette Mobile-Datenmodell aus dem rohen Workspace-State.
 * Spiegelt die Desktop-Pipeline (siehe Kopfkommentar).
 */
// Leitet eine grobe Blocker-Kategorie ab, damit am Handy „mein Job (Bestand/Forecast)"
// von „Finanz-/Datenthema" unterscheidbar ist (Felder kommen 1:1 aus der Robustheit).
function blockerCategory(blocker: { issueType?: string; checkKey?: string; sourceKind?: string }): string {
  const it = String(blocker.issueType || "").toLowerCase();
  const ck = String(blocker.checkKey || "").toLowerCase();
  const sk = String(blocker.sourceKind || "").toLowerCase();
  if (it.includes("stock") || ck.includes("stock") || ck.includes("coverage") || ck.includes("inventory")) return "Bestand";
  if (it === "order_duty" || ck.includes("order")) return "Bestellpflicht";
  if (sk.includes("forecast") || ck.includes("forecast")) return "Forecast";
  if (ck.includes("cash") || ck.includes("vat") || ck.includes("tax") || ck.includes("fixcost") || ck.includes("revenue")) return "Finanzen / Daten";
  return "Prüfen";
}

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

  // 10) Phantom-FO-IDs — nur für die Aggregations-Parität (provisionalFoIds),
  // identisch zum Desktop. Werden in der Mobile-UI NICHT als eigener Bereich gezeigt.
  const phantomFoSuggestions = buildPhantomFoSuggestions({ state: stateObject });
  const phantomFoIdSet = new Set(phantomFoSuggestions.map((entry) => entry.id));

  // 11) Pro-Monats-Zeilen mit In-/Outflow-Split
  const currentIdx = monthIndex(currentMonth);
  // Suffix-Minimum der Endsalden: niedrigster Endsaldo ab Monat i bis Ende ("Puffer ab hier").
  const closingSeq = visibleBreakdown.map((row) => Number(row.closing || 0));
  const suffixMinClosing: number[] = new Array(closingSeq.length);
  for (let i = closingSeq.length - 1; i >= 0; i -= 1) {
    suffixMinClosing[i] = i === closingSeq.length - 1 ? closingSeq[i] : Math.min(closingSeq[i], suffixMinClosing[i + 1]);
  }
  const rows: CfpMonthRow[] = visibleBreakdown.map((row, rowPos) => {
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
      category: blockerCategory(blocker),
      sku: blocker.sku ? String(blocker.sku) : undefined,
      alias: blocker.alias ? String(blocker.alias) : undefined,
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
      minClosingFromHere: suffixMinClosing[rowPos] ?? Number(row.closing || 0),
      hasActualClosing: row.hasActualClosing === true,
      isPast: rowIdx != null && currentIdx != null ? rowIdx < currentIdx : row.month < currentMonth,
      isCurrent: row.month === currentMonth,
    };
  });

  const totalInflow = rows.reduce((sum, row) => sum + row.inflow, 0);
  const totalOutflow = rows.reduce((sum, row) => sum + row.outflow, 0);
  const totalNet = rows.reduce((sum, row) => sum + row.net, 0);
  const minClosing = rows.length ? Math.min(...rows.map((row) => row.closing)) : null;
  const minClosingMonth = minClosing != null ? (rows.find((row) => row.closing === minClosing)?.month || null) : null;
  const firstNegativeVisibleMonth = rows.find((row) => row.closing < 0)?.month || null;

  return {
    months,
    visibleMonths,
    currentMonth,
    opening: Number(report.kpis?.opening || 0),
    firstNegativeMonth: report.kpis?.firstNegativeMonth || null,
    firstNegativeVisibleMonth,
    minClosingMonth,
    rows,
    totals: { inflow: totalInflow, outflow: totalOutflow, net: totalNet, minClosing },
    robustness,
    cockpit: {
      bucketScope,
      quoteMode: params.quoteMode,
      revenueBasisMode: params.revenueBasisMode,
      calibrationEnabled: params.calibrationEnabled,
    },
  };
}

import { parseDeNumber } from "../../lib/dataHealth.js";
import {
  CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  CASH_IN_QUOTE_MAX_PCT,
  CASH_IN_QUOTE_MIN_PCT,
  buildCalibrationProfile,
  buildPayoutRecommendation,
  clampPct,
  normalizeRevenueCalibrationMode,
  parsePayoutPctInput,
} from "../../domain/cashInRules.js";
import { buildEffectiveCashInByMonth } from "../../domain/cashflow.js";
import { currentMonthKey, monthRange } from "./months";
import {
  buildCategoryLabelMap,
  buildForecastProducts,
  buildForecastRevenueByMonth,
  normalizeManualMap,
} from "./tableModels";

type CashInQuoteMode = "manual" | "recommendation";
type CashInRevenueBasisMode = "hybrid" | "forecast_direct";

interface IncomingRow {
  id: string;
  month: string;
  revenueEur: number | null;
  payoutPct: number | null;
  source: "manual" | "forecast";
  calibrationCutoffDate: string | null;
  calibrationRevenueToDateEur: number | null;
  calibrationPayoutRateToDatePct: number | null;
  calibrationSellerboardMonthEndEur: number | null;
}

interface EffectiveCashInMonthSnapshot {
  revenueUsedEUR?: number | null;
  revenueSource?: string | null;
  payoutPctUsed?: number | null;
  payoutSource?: string | null;
  payoutEUR?: number | null;
}

function isMonthKey(value: unknown): boolean {
  return /^\d{4}-\d{2}$/.test(String(value || "").trim());
}

function normalizeMonth(value: unknown, fallback = currentMonthKey()): string {
  const raw = String(value || "").trim();
  return isMonthKey(raw) ? raw : fallback;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function normalizePayoutInput(value: unknown): number | null {
  const parsed = parsePayoutPctInput(value);
  if (!Number.isFinite(parsed as number)) return null;
  return clampPct(Number(parsed), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
}

function normalizeManualPayoutInput(value: unknown): number | null {
  const parsed = parsePayoutPctInput(value);
  if (!Number.isFinite(parsed as number)) return null;
  if (Number(parsed) <= 0) return null;
  return clampPct(Number(parsed), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
}

function normalizeCashInQuoteMode(value: unknown): CashInQuoteMode {
  return String(value || "").trim().toLowerCase() === "recommendation"
    ? "recommendation"
    : "manual";
}

function normalizeCashInRevenueBasisMode(value: unknown): CashInRevenueBasisMode {
  return String(value || "").trim().toLowerCase() === "forecast_direct"
    ? "forecast_direct"
    : "hybrid";
}

function normalizeIncomingRows(input: unknown, fallbackMonth: string): IncomingRow[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry, index) => {
    const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    const rawCutoffDate = String(row.calibrationCutoffDate || "").trim();
    const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(rawCutoffDate) ? rawCutoffDate : null;
    return {
      id: String(row.id || `inc-${index + 1}`),
      month: normalizeMonth(row.month, fallbackMonth),
      revenueEur: toNumber(row.revenueEur),
      payoutPct: toNumber(row.payoutPct),
      source: String(row.source || "manual") === "forecast" ? "forecast" : "manual",
      calibrationCutoffDate: cutoffDate,
      calibrationRevenueToDateEur: toNumber(row.calibrationRevenueToDateEur),
      calibrationPayoutRateToDatePct: toNumber(row.calibrationPayoutRateToDatePct),
      calibrationSellerboardMonthEndEur: toNumber(row.calibrationSellerboardMonthEndEur),
    } satisfies IncomingRow;
  });
}

function sortIncomings(rows: IncomingRow[]): IncomingRow[] {
  return rows
    .slice()
    .sort((a, b) => (a.month === b.month ? a.id.localeCompare(b.id) : a.month.localeCompare(b.month)));
}

function createIncomingRow(month: string): IncomingRow {
  return {
    id: `inc-${month}`,
    month,
    revenueEur: null,
    payoutPct: null,
    source: "forecast",
    calibrationCutoffDate: null,
    calibrationRevenueToDateEur: null,
    calibrationPayoutRateToDatePct: null,
    calibrationSellerboardMonthEndEur: null,
  };
}

function syncIncomingsToWindow(rows: IncomingRow[], startMonth: string, horizonMonths: number): IncomingRow[] {
  const months = monthRange(startMonth, Math.max(1, Math.round(horizonMonths || 1)));
  const monthSet = new Set(months);
  const byMonth = new Map<string, IncomingRow>();
  sortIncomings(rows).forEach((row) => {
    if (!monthSet.has(row.month)) return;
    byMonth.set(row.month, row);
  });
  return sortIncomings(months.map((month) => byMonth.get(month) || createIncomingRow(month)));
}

function normalizeLearningPayload(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  return JSON.parse(JSON.stringify(input));
}

function buildMonthlyActualsMap(state: Record<string, unknown>): Record<string, { realRevenueEUR?: number; realPayoutRatePct?: number }> {
  const monthlyRaw = (state.monthlyActuals && typeof state.monthlyActuals === "object")
    ? state.monthlyActuals as Record<string, Record<string, unknown>>
    : {};
  const map: Record<string, { realRevenueEUR?: number; realPayoutRatePct?: number }> = {};
  Object.entries(monthlyRaw).forEach(([monthRaw, row]) => {
    const month = normalizeMonth(monthRaw);
    const revenue = toNumber(row?.realRevenueEUR);
    const payoutPct = toNumber(row?.realPayoutRatePct);
    const out: { realRevenueEUR?: number; realPayoutRatePct?: number } = {};
    if (Number.isFinite(revenue as number)) out.realRevenueEUR = Number(revenue);
    if (Number.isFinite(payoutPct as number)) out.realPayoutRatePct = Number(payoutPct);
    if (Object.keys(out).length) map[month] = out;
  });
  return map;
}

export function buildCashInPayoutMirrorByMonth(input: {
  months: string[];
  state: Record<string, unknown>;
}): Record<string, number> {
  const requestedMonths = Array.isArray(input.months)
    ? input.months.map((month) => String(month || "").trim()).filter(Boolean)
    : [];
  const result: Record<string, number> = {};
  if (!requestedMonths.length) return result;

  const state = (input.state && typeof input.state === "object")
    ? input.state
    : {};
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const forecastState = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};

  const startMonth = normalizeMonth(settings.startMonth, currentMonthKey());
  const horizonMonths = Math.max(1, Math.round(Number(settings.horizonMonths || 18) || 18));
  const planningMonths = monthRange(startMonth, horizonMonths);
  const planningMonthSet = new Set(planningMonths);

  const incomings = syncIncomingsToWindow(
    normalizeIncomingRows(state.incomings, startMonth),
    startMonth,
    horizonMonths,
  );
  const incomingByMonth = new Map(incomings.map((row) => [row.month, row] as const));

  const categoriesById = buildCategoryLabelMap(state);
  const products = buildForecastProducts(state, categoriesById);
  const forecastImport = (forecastState.forecastImport && typeof forecastState.forecastImport === "object")
    ? forecastState.forecastImport as Record<string, unknown>
    : {};
  const manualDraft = normalizeManualMap(forecastState.forecastManual || {});
  const forecastRevenueByMonth = buildForecastRevenueByMonth({
    allMonths: planningMonths,
    products,
    manualDraft,
    forecastImport,
  });
  const forecastRevenueByMonthObject: Record<string, number> = {};
  planningMonths.forEach((month) => {
    forecastRevenueByMonthObject[month] = Number(forecastRevenueByMonth.get(month) || 0);
  });

  const monthlyActualsMap = buildMonthlyActualsMap(state);
  const seasonalityEnabled = settings.cashInRecommendationSeasonalityEnabled == null
    ? settings.cashInRecommendationIgnoreQ4 !== true
    : settings.cashInRecommendationSeasonalityEnabled !== false;
  const ignoreQ4 = !seasonalityEnabled;
  const baselineNormalPct = normalizePayoutInput(settings.cashInRecommendationBaselineNormalPct)
    ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
  const baselineQ4Pct = normalizePayoutInput(settings.cashInRecommendationBaselineQ4Pct);

  const payoutRecommendation = buildPayoutRecommendation({
    months: planningMonths,
    incomings,
    monthlyActuals: monthlyActualsMap,
    currentMonth: currentMonthKey(),
    mode: "plan",
    seasonalityEnabled: !ignoreQ4,
    ignoreQ4,
    maxMonth: currentMonthKey(),
    baselineNormalPct,
    baselineQ4Pct,
    learningState: normalizeLearningPayload(settings.cashInLearning),
    now: new Date(),
    minSamples: 4,
  });
  const payoutRecommendationByMonth = new Map<string, number>();
  incomings.forEach((incoming) => {
    const quoteRaw = Number((payoutRecommendation.byMonth || {})[incoming.month]?.quotePct);
    if (!Number.isFinite(quoteRaw)) return;
    payoutRecommendationByMonth.set(
      incoming.month,
      clampPct(quoteRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
    );
  });

  const calibrationMode = normalizeRevenueCalibrationMode(settings.cashInCalibrationMode) as "basis" | "conservative";
  const revenueCalibrationProfile = buildCalibrationProfile({
    incomings,
    months: planningMonths,
    forecastRevenueByMonth: forecastRevenueByMonthObject,
    mode: calibrationMode,
    currentMonth: currentMonthKey(),
    now: new Date(),
    monthlyActuals: monthlyActualsMap,
    learningState: settings.revenueCalibration,
    sourceForecastVersionId: forecastState.activeVersionId,
  });

  const globalQuoteMode = normalizeCashInQuoteMode(settings.cashInQuoteMode);
  const globalRevenueBasisMode = normalizeCashInRevenueBasisMode(settings.cashInRevenueBasisMode);
  const globalCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const helperByMonth = buildEffectiveCashInByMonth(planningMonths, state, null) as Record<string, EffectiveCashInMonthSnapshot>;

  planningMonths.forEach((month) => {
    const incoming = incomingByMonth.get(month) || createIncomingRow(month);

    const forecastRevenue = Number(forecastRevenueByMonth.get(month) || 0);
    const calibrationByMonth = (revenueCalibrationProfile.byMonth?.[month] || null) as Record<string, unknown> | null;
    const factorBasis = Number(calibrationByMonth?.factorBasis || 1);
    const factorConservative = Number(calibrationByMonth?.factorConservative || 1);
    const selectedFactorRaw = calibrationMode === "conservative" ? factorConservative : factorBasis;
    const factorApplied = globalCalibrationEnabled && Number.isFinite(selectedFactorRaw)
      ? selectedFactorRaw
      : 1;
    const calibratedRevenue = forecastRevenue * factorApplied;
    const autoRevenue = globalCalibrationEnabled ? calibratedRevenue : forecastRevenue;
    const autoRevenueSource = globalCalibrationEnabled ? "forecast_calibrated" : "forecast_raw";

    const manualRevenue = toNumber(incoming.revenueEur);
    const hasManualRevenue = (
      incoming.source === "manual"
      && Number.isFinite(manualRevenue as number)
      && Number(manualRevenue) > 0
    );
    const expectedRevenue = (
      globalRevenueBasisMode === "hybrid"
      && hasManualRevenue
    )
      ? Number(manualRevenue)
      : autoRevenue;
    const expectedRevenueSource = (
      globalRevenueBasisMode === "hybrid"
      && hasManualRevenue
    )
      ? "manual_override"
      : autoRevenueSource;

    const manualQuote = normalizeManualPayoutInput(incoming.payoutPct);
    const recommendedQuote = payoutRecommendationByMonth.get(month) ?? null;
    const expectedQuoteSource = (
      globalQuoteMode === "manual"
      && Number.isFinite(manualQuote as number)
    )
      ? "manual"
      : "recommendation";
    const expectedQuote = expectedQuoteSource === "manual"
      ? Number(manualQuote)
      : (Number.isFinite(recommendedQuote as number) ? Number(recommendedQuote) : null);

    const helper = helperByMonth[month] || {};
    let usedRevenue = Number.isFinite(Number(helper.revenueUsedEUR))
      ? Number(helper.revenueUsedEUR)
      : null;
    let usedRevenueSource = helper.revenueSource ? String(helper.revenueSource) : null;
    let usedQuote = Number.isFinite(Number(helper.payoutPctUsed))
      ? Number(helper.payoutPctUsed)
      : null;
    let usedQuoteSource = helper.payoutSource ? String(helper.payoutSource) : null;
    const helperPayout = Number.isFinite(Number(helper.payoutEUR))
      ? Number(helper.payoutEUR)
      : null;

    const shouldRepairRevenue = (
      !Number.isFinite(usedRevenue as number)
      || usedRevenueSource !== expectedRevenueSource
      || (
        Number.isFinite(expectedRevenue)
        && Number(expectedRevenue) > 0
        && Number.isFinite(usedRevenue as number)
        && Number(usedRevenue) <= 0
      )
    );
    if (shouldRepairRevenue) {
      usedRevenue = Number.isFinite(expectedRevenue) ? Number(expectedRevenue) : null;
      usedRevenueSource = usedRevenue != null ? expectedRevenueSource : null;
    }

    const shouldRepairQuote = (
      !Number.isFinite(usedQuote as number)
      || Number(usedQuote) <= 0
      || usedQuoteSource !== expectedQuoteSource
    );
    if (shouldRepairQuote) {
      usedQuote = Number.isFinite(expectedQuote as number) ? Number(expectedQuote) : null;
      usedQuoteSource = usedQuote != null ? expectedQuoteSource : null;
    }

    const computedPayout = (
      Number.isFinite(usedRevenue as number)
      && Number.isFinite(usedQuote as number)
    )
      ? Number(usedRevenue) * (Number(usedQuote) / 100)
      : null;
    let usedPayout = Number.isFinite(computedPayout as number)
      ? Number(computedPayout)
      : (Number.isFinite(helperPayout as number) ? Number(helperPayout) : 0);
    if (
      Number.isFinite(computedPayout as number)
      && Number(computedPayout) > 0
      && (!Number.isFinite(helperPayout as number) || Number(helperPayout) <= 0)
    ) {
      usedPayout = Number(computedPayout);
    }

    if (planningMonthSet.has(month)) {
      result[month] = Number.isFinite(usedPayout) ? Math.max(0, usedPayout) : 0;
    }
  });

  requestedMonths.forEach((month) => {
    if (Object.prototype.hasOwnProperty.call(result, month)) return;
    const fallback = Number((helperByMonth[month] || {}).payoutEUR);
    result[month] = Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  });

  return result;
}

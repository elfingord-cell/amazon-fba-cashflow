"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCashInPayoutMirrorByMonth = buildCashInPayoutMirrorByMonth;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const cashInRules_js_1 = require("../../domain/cashInRules.js");
const cashflow_js_1 = require("../../domain/cashflow.js");
const months_1 = require("./months");
const tableModels_1 = require("./tableModels");
function isMonthKey(value) {
    return /^\d{4}-\d{2}$/.test(String(value || "").trim());
}
function normalizeMonth(value, fallback = (0, months_1.currentMonthKey)()) {
    const raw = String(value || "").trim();
    return isMonthKey(raw) ? raw : fallback;
}
function toNumber(value) {
    if (value === null || value === undefined || value === "")
        return null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    return Number.isFinite(parsed) ? Number(parsed) : null;
}
function normalizePayoutInput(value) {
    const parsed = (0, cashInRules_js_1.parsePayoutPctInput)(value);
    if (!Number.isFinite(parsed))
        return null;
    return (0, cashInRules_js_1.clampPct)(Number(parsed), cashInRules_js_1.CASH_IN_QUOTE_MIN_PCT, cashInRules_js_1.CASH_IN_QUOTE_MAX_PCT);
}
function normalizeManualPayoutInput(value) {
    const parsed = (0, cashInRules_js_1.parsePayoutPctInput)(value);
    if (!Number.isFinite(parsed))
        return null;
    if (Number(parsed) <= 0)
        return null;
    return (0, cashInRules_js_1.clampPct)(Number(parsed), cashInRules_js_1.CASH_IN_QUOTE_MIN_PCT, cashInRules_js_1.CASH_IN_QUOTE_MAX_PCT);
}
function normalizeCashInQuoteMode(value) {
    return String(value || "").trim().toLowerCase() === "recommendation"
        ? "recommendation"
        : "manual";
}
function normalizeCashInRevenueBasisMode(value) {
    return String(value || "").trim().toLowerCase() === "forecast_direct"
        ? "forecast_direct"
        : "hybrid";
}
function normalizeIncomingRows(input, fallbackMonth) {
    if (!Array.isArray(input))
        return [];
    return input.map((entry, index) => {
        const row = (entry && typeof entry === "object") ? entry : {};
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
        };
    });
}
function sortIncomings(rows) {
    return rows
        .slice()
        .sort((a, b) => (a.month === b.month ? a.id.localeCompare(b.id) : a.month.localeCompare(b.month)));
}
function createIncomingRow(month) {
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
function syncIncomingsToWindow(rows, startMonth, horizonMonths) {
    const months = (0, months_1.monthRange)(startMonth, Math.max(1, Math.round(horizonMonths || 1)));
    const monthSet = new Set(months);
    const byMonth = new Map();
    sortIncomings(rows).forEach((row) => {
        if (!monthSet.has(row.month))
            return;
        byMonth.set(row.month, row);
    });
    return sortIncomings(months.map((month) => byMonth.get(month) || createIncomingRow(month)));
}
function normalizeLearningPayload(input) {
    if (!input || typeof input !== "object")
        return null;
    return JSON.parse(JSON.stringify(input));
}
function buildMonthlyActualsMap(state) {
    const monthlyRaw = (state.monthlyActuals && typeof state.monthlyActuals === "object")
        ? state.monthlyActuals
        : {};
    const map = {};
    Object.entries(monthlyRaw).forEach(([monthRaw, row]) => {
        const month = normalizeMonth(monthRaw);
        const revenue = toNumber(row?.realRevenueEUR);
        const payoutPct = toNumber(row?.realPayoutRatePct);
        const out = {};
        if (Number.isFinite(revenue))
            out.realRevenueEUR = Number(revenue);
        if (Number.isFinite(payoutPct))
            out.realPayoutRatePct = Number(payoutPct);
        if (Object.keys(out).length)
            map[month] = out;
    });
    return map;
}
function buildCashInPayoutMirrorByMonth(input) {
    const requestedMonths = Array.isArray(input.months)
        ? input.months.map((month) => String(month || "").trim()).filter(Boolean)
        : [];
    const result = {};
    if (!requestedMonths.length)
        return result;
    const state = (input.state && typeof input.state === "object")
        ? input.state
        : {};
    const settings = (state.settings && typeof state.settings === "object")
        ? state.settings
        : {};
    const forecastState = (state.forecast && typeof state.forecast === "object")
        ? state.forecast
        : {};
    const startMonth = normalizeMonth(settings.startMonth, (0, months_1.currentMonthKey)());
    const horizonMonths = Math.max(1, Math.round(Number(settings.horizonMonths || 18) || 18));
    const planningMonths = (0, months_1.monthRange)(startMonth, horizonMonths);
    const planningMonthSet = new Set(planningMonths);
    const incomings = syncIncomingsToWindow(normalizeIncomingRows(state.incomings, startMonth), startMonth, horizonMonths);
    const incomingByMonth = new Map(incomings.map((row) => [row.month, row]));
    const categoriesById = (0, tableModels_1.buildCategoryLabelMap)(state);
    const products = (0, tableModels_1.buildForecastProducts)(state, categoriesById);
    const forecastImport = (forecastState.forecastImport && typeof forecastState.forecastImport === "object")
        ? forecastState.forecastImport
        : {};
    const manualDraft = (0, tableModels_1.normalizeManualMap)(forecastState.forecastManual || {});
    const forecastRevenueByMonth = (0, tableModels_1.buildForecastRevenueByMonth)({
        allMonths: planningMonths,
        products,
        manualDraft,
        forecastImport,
    });
    const forecastRevenueByMonthObject = {};
    planningMonths.forEach((month) => {
        forecastRevenueByMonthObject[month] = Number(forecastRevenueByMonth.get(month) || 0);
    });
    const monthlyActualsMap = buildMonthlyActualsMap(state);
    const seasonalityEnabled = settings.cashInRecommendationSeasonalityEnabled == null
        ? settings.cashInRecommendationIgnoreQ4 !== true
        : settings.cashInRecommendationSeasonalityEnabled !== false;
    const ignoreQ4 = !seasonalityEnabled;
    const baselineNormalPct = normalizePayoutInput(settings.cashInRecommendationBaselineNormalPct)
        ?? cashInRules_js_1.CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
    const baselineQ4Pct = normalizePayoutInput(settings.cashInRecommendationBaselineQ4Pct);
    const payoutRecommendation = (0, cashInRules_js_1.buildPayoutRecommendation)({
        months: planningMonths,
        incomings,
        monthlyActuals: monthlyActualsMap,
        currentMonth: (0, months_1.currentMonthKey)(),
        mode: "plan",
        seasonalityEnabled: !ignoreQ4,
        ignoreQ4,
        maxMonth: (0, months_1.currentMonthKey)(),
        baselineNormalPct,
        baselineQ4Pct,
        learningState: normalizeLearningPayload(settings.cashInLearning),
        now: new Date(),
        minSamples: 4,
    });
    const payoutRecommendationByMonth = new Map();
    incomings.forEach((incoming) => {
        const quoteRaw = Number((payoutRecommendation.byMonth || {})[incoming.month]?.quotePct);
        if (!Number.isFinite(quoteRaw))
            return;
        payoutRecommendationByMonth.set(incoming.month, (0, cashInRules_js_1.clampPct)(quoteRaw, cashInRules_js_1.CASH_IN_QUOTE_MIN_PCT, cashInRules_js_1.CASH_IN_QUOTE_MAX_PCT));
    });
    const calibrationMode = (0, cashInRules_js_1.normalizeRevenueCalibrationMode)(settings.cashInCalibrationMode);
    const revenueCalibrationProfile = (0, cashInRules_js_1.buildCalibrationProfile)({
        incomings,
        months: planningMonths,
        forecastRevenueByMonth: forecastRevenueByMonthObject,
        mode: calibrationMode,
        currentMonth: (0, months_1.currentMonthKey)(),
        now: new Date(),
        monthlyActuals: monthlyActualsMap,
        learningState: settings.revenueCalibration,
        sourceForecastVersionId: forecastState.activeVersionId,
    });
    const globalQuoteMode = normalizeCashInQuoteMode(settings.cashInQuoteMode);
    const globalRevenueBasisMode = normalizeCashInRevenueBasisMode(settings.cashInRevenueBasisMode);
    const globalCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
    const helperByMonth = (0, cashflow_js_1.buildEffectiveCashInByMonth)(planningMonths, state, null);
    planningMonths.forEach((month) => {
        const incoming = incomingByMonth.get(month) || createIncomingRow(month);
        const forecastRevenue = Number(forecastRevenueByMonth.get(month) || 0);
        const calibrationByMonth = (revenueCalibrationProfile.byMonth?.[month] || null);
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
        const hasManualRevenue = (incoming.source === "manual"
            && Number.isFinite(manualRevenue)
            && Number(manualRevenue) > 0);
        const expectedRevenue = (globalRevenueBasisMode === "hybrid"
            && hasManualRevenue)
            ? Number(manualRevenue)
            : autoRevenue;
        const expectedRevenueSource = (globalRevenueBasisMode === "hybrid"
            && hasManualRevenue)
            ? "manual_override"
            : autoRevenueSource;
        const manualQuote = normalizeManualPayoutInput(incoming.payoutPct);
        const recommendedQuote = payoutRecommendationByMonth.get(month) ?? null;
        const expectedQuoteSource = (globalQuoteMode === "manual"
            && Number.isFinite(manualQuote))
            ? "manual"
            : "recommendation";
        const expectedQuote = expectedQuoteSource === "manual"
            ? Number(manualQuote)
            : (Number.isFinite(recommendedQuote) ? Number(recommendedQuote) : null);
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
        const shouldRepairRevenue = (!Number.isFinite(usedRevenue)
            || usedRevenueSource !== expectedRevenueSource
            || (Number.isFinite(expectedRevenue)
                && Number(expectedRevenue) > 0
                && Number.isFinite(usedRevenue)
                && Number(usedRevenue) <= 0));
        if (shouldRepairRevenue) {
            usedRevenue = Number.isFinite(expectedRevenue) ? Number(expectedRevenue) : null;
            usedRevenueSource = usedRevenue != null ? expectedRevenueSource : null;
        }
        const shouldRepairQuote = (!Number.isFinite(usedQuote)
            || Number(usedQuote) <= 0
            || usedQuoteSource !== expectedQuoteSource);
        if (shouldRepairQuote) {
            usedQuote = Number.isFinite(expectedQuote) ? Number(expectedQuote) : null;
            usedQuoteSource = usedQuote != null ? expectedQuoteSource : null;
        }
        const computedPayout = (Number.isFinite(usedRevenue)
            && Number.isFinite(usedQuote))
            ? Number(usedRevenue) * (Number(usedQuote) / 100)
            : null;
        let usedPayout = Number.isFinite(computedPayout)
            ? Number(computedPayout)
            : (Number.isFinite(helperPayout) ? Number(helperPayout) : 0);
        if (Number.isFinite(computedPayout)
            && Number(computedPayout) > 0
            && (!Number.isFinite(helperPayout) || Number(helperPayout) <= 0)) {
            usedPayout = Number(computedPayout);
        }
        if (planningMonthSet.has(month)) {
            result[month] = Number.isFinite(usedPayout) ? Math.max(0, usedPayout) : 0;
        }
    });
    requestedMonths.forEach((month) => {
        if (Object.prototype.hasOwnProperty.call(result, month))
            return;
        const fallback = Number((helperByMonth[month] || {}).payoutEUR);
        result[month] = Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
    });
    return result;
}

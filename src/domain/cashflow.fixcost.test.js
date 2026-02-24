import test from "node:test";
import assert from "node:assert/strict";

import { computeSeries, expandFixcostInstances } from "./cashflow.js";
import { CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL } from "./cashInRules.js";
import { PORTFOLIO_BUCKET } from "./portfolioBuckets.js";
import { createEmptyState, saveState, STORAGE_KEY } from "../data/storageLocal.js";

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
};

function resetStorage() {
  store.clear();
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(offset || 0), 1);
  return monthKeyFromDate(date);
}

function withMockedNow(date, callback) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(date.getTime());
        return;
      }
      super(...args);
    }

    static now() {
      return date.getTime();
    }
  }
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  globalThis.Date = MockDate;
  try {
    return callback();
  } finally {
    globalThis.Date = RealDate;
  }
}

function salesPayoutAmountForMonth(report, month) {
  const row = report.series.find((entry) => entry.month === month);
  if (!row) return 0;
  return row.itemsIn
    .filter((entry) => entry.kind === "sales-payout")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

function salesEntriesForMonth(report, month) {
  const row = report.series.find((entry) => entry.month === month);
  if (!row) return [];
  return (Array.isArray(row.entries) ? row.entries : [])
    .filter((entry) => entry.kind === "sales-payout");
}

function salesCashInMetaForMonth(report, month) {
  const entry = salesEntriesForMonth(report, month)[0];
  return entry?.meta?.cashIn || null;
}

test.beforeEach(() => {
  resetStorage();
  saveState(createEmptyState());
});

test("expandFixcostInstances respects overrides and auto-paid", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 6 },
    fixcosts: [
      {
        id: "fc-1",
        name: "Miete",
        category: "Miete",
        amount: "1.000,00",
        frequency: "monthly",
        anchor: "15",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
        autoPaid: true,
      },
      {
        id: "fc-2",
        name: "Versicherung",
        category: "Versicherung",
        amount: "600,00",
        frequency: "quarterly",
        anchor: "LAST",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
      },
    ],
    fixcostOverrides: {
      "fc-1": {
        "2025-02": { amount: "1.200,00", note: "Index" },
      },
      "fc-2": {
        "2025-04": { dueDate: "2025-04-10" },
      },
    },
    status: { autoManualCheck: false, events: {} },
  };

  const months = ["2025-01", "2025-02", "2025-03", "2025-04"];
  const result = expandFixcostInstances(state, { months, today: "2025-03-20" });

  assert.strictEqual(result.length, 6);

  const feb = result.find(row => row.month === "2025-02" && row.fixedCostId === "fc-1");
  assert.ok(feb);
  assert.strictEqual(feb.overrideActive, true);
  assert.strictEqual(feb.amount, 1200);
  assert.strictEqual(feb.paid, true); // auto-paid before today

  const aprilInsurance = result.find(row => row.month === "2025-04" && row.fixedCostId === "fc-2");
  assert.ok(aprilInsurance);
  assert.strictEqual(aprilInsurance.dueDateIso, "2025-04-10");
  assert.strictEqual(aprilInsurance.paid, false);
});

test("autoManualCheck suppresses automatic paid flag", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 3 },
    fixcosts: [
      {
        id: "fc-auto",
        name: "Lizenz",
        category: "Tools",
        amount: "500,00",
        frequency: "monthly",
        anchor: "1",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
        autoPaid: true,
      },
    ],
    fixcostOverrides: {},
    status: { autoManualCheck: true, events: {} },
  };

  const result = expandFixcostInstances(state, { months: ["2025-01"], today: "2025-02-05" });
  assert.strictEqual(result.length, 1);
  const entry = result[0];
  assert.strictEqual(entry.paid, false);
  assert.strictEqual(entry.autoSuppressed, true);
  assert.match(entry.autoTooltip || "", /manuelle Prüfung aktiv/);
});

test("daily proration adjusts first and last month", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 1 },
    fixcosts: [
      {
        id: "fc-pro",
        name: "Marketing",
        category: "Sonstiges",
        amount: "1.000,00",
        frequency: "monthly",
        anchor: "15",
        startMonth: "2025-01",
        endMonth: "2025-01",
        proration: { enabled: true, method: "daily" },
      },
    ],
    fixcostOverrides: {},
    status: { autoManualCheck: false, events: {} },
  };

  const [entry] = expandFixcostInstances(state, { months: ["2025-01"], today: "2025-01-16" });
  assert.strictEqual(entry.prorationApplied, true);
  assert.strictEqual(entry.amount, 265.35);
});

test("saveState persists fixcost masters and overrides", () => {
  const state = createEmptyState();
  state.fixcosts = [
    {
      id: "fc-store",
      name: "Miete",
      category: "Miete",
      amount: "2.500,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "LAST",
      startMonth: "2025-01",
      proration: { enabled: false, method: "none" },
      autoPaid: false,
      notes: "Büro",
    },
  ];
  state.fixcostOverrides = {
    "fc-store": {
      "2025-03": { amount: "3.000,00", dueDate: "2025-03-28", note: "Index" },
    },
  };
  state.status = { autoManualCheck: false, events: { "fix-fc-store-2025-03": { manual: true } } };

  saveState(state);
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(raw, "state should be stored in localStorage");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.fixcosts[0].name, "Miete");
  assert.strictEqual(parsed.fixcostOverrides["fc-store"]["2025-03"].amount, "3.000,00");
  assert.strictEqual(parsed.status.events["fix-fc-store-2025-03"].manual, true);
});

test("computeSeries treats FO milestones as plan-only and excludes converted/archived", () => {
  const state = {
    settings: {
      startMonth: "2025-03",
      horizonMonths: 2,
      openingBalance: 0,
      fxRate: 1,
      vatRefundLagMonths: 2,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [],
    extras: [],
    dividends: [],
    pos: [],
    fos: [
      {
        id: "fo-active",
        status: "ACTIVE",
        orderDate: "2025-03-01",
        prodDays: 0,
        transitDays: 0,
        payments: [
          { id: "fo-active-pay", label: "Deposit", amount: 100, currency: "EUR", dueDate: "2025-03-05", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-planned",
        status: "PLANNED",
        orderDate: "2025-03-01",
        prodDays: 0,
        transitDays: 0,
        payments: [
          { id: "fo-planned-pay", label: "Deposit", amount: 50, currency: "EUR", dueDate: "2025-04-05", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-converted",
        status: "CONVERTED",
        orderDate: "2025-03-01",
        payments: [
          { id: "fo-converted-pay", label: "Deposit", amount: 999, currency: "EUR", dueDate: "2025-03-10", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-archived",
        status: "ARCHIVED",
        orderDate: "2025-03-01",
        payments: [
          { id: "fo-archived-pay", label: "Deposit", amount: 999, currency: "EUR", dueDate: "2025-03-10", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
    ],
  };

  const report = computeSeries(state);
  const march = report.series.find((entry) => entry.month === "2025-03");
  const april = report.series.find((entry) => entry.month === "2025-04");
  assert.ok(march);
  assert.ok(april);
  const marchFoEntries = march.entries.filter((entry) => entry.source === "fo");
  const aprilFoEntries = april.entries.filter((entry) => entry.source === "fo");
  assert.equal(marchFoEntries.length, 1);
  assert.equal(aprilFoEntries.length, 1);
  assert.equal(marchFoEntries[0].amount, 100);
  assert.equal(aprilFoEntries[0].amount, 50);
  assert.equal(marchFoEntries[0].paid, false);
  assert.equal(aprilFoEntries[0].paid, false);
});

test("computeSeries uses manual quote first and recommendation for future months without manual quote", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const state = {
    settings: {
      startMonth: prev1,
      horizonMonths: 4,
      openingBalance: 0,
      cashInMode: "basis",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: prev1, revenueEur: "1.000,00", payoutPct: "55", source: "manual" },
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "56", source: "manual" },
      { month: next1, revenueEur: "1.000,00", payoutPct: "58", source: "manual" },
      { month: next2, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
    ],
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 48 },
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(salesPayoutAmountForMonth(report, next1), 580);
  const recommendedNext2 = salesPayoutAmountForMonth(report, next2);
  const next1Entry = salesEntriesForMonth(report, next1)[0];
  const next2Entry = salesEntriesForMonth(report, next2)[0];
  const next2Meta = next2Entry?.meta?.cashIn;
  assert.ok(next2Meta);
  const expectedNext2Pct = Math.min(
    Number(next2Meta.quoteMaxPct),
    Math.max(
      Number(next2Meta.quoteMinPct),
      Number(next2Meta.recommendationLevelPct) + Number(next2Meta.recommendationSeasonalityPct) - Number(next2Meta.recommendationSafetyMarginPct),
    ),
  );
  assert.ok(Math.abs(Number(next2Meta.payoutPct) - expectedNext2Pct) < 0.000001);
  assert.ok(Math.abs(recommendedNext2 - (Number(next2Meta.payoutPct) * 10)) < 0.000001);

  assert.equal(next1Entry?.meta?.cashIn?.quoteSource, "manual");
  assert.equal(next2Entry?.meta?.cashIn?.quoteSource, "recommendation");
  assert.equal(next2Meta.recommendationSeasonalityProfileSource, CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL);
});

test("computeSeries keeps recommendation near profile when only two IST months exist", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 3,
      openingBalance: 0,
      cashInMode: "basis",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
      { month: next1, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
    ],
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 55 },
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 54 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.ok(report.kpis?.cashIn?.basisQuotePct >= 54 && report.kpis?.cashIn?.basisQuotePct <= 56);
  const nextQuote = salesPayoutAmountForMonth(report, next1);
  const nextMeta = salesCashInMetaForMonth(report, next1);
  assert.ok(nextMeta);
  const expectedNextPct = Math.min(
    Number(nextMeta.quoteMaxPct),
    Math.max(
      Number(nextMeta.quoteMinPct),
      Number(nextMeta.recommendationLevelPct) + Number(nextMeta.recommendationSeasonalityPct) - Number(nextMeta.recommendationSafetyMarginPct),
    ),
  );
  assert.ok(Math.abs(Number(nextMeta.payoutPct) - expectedNextPct) < 0.000001);
  assert.ok(Math.abs(nextQuote - (Number(nextMeta.payoutPct) * 10)) < 0.000001, `unexpected payout for ${next1}: ${nextQuote}`);
  assert.equal(nextMeta.quoteSource, "recommendation");
  assert.equal(nextMeta.recommendationSeasonalityProfileSource, CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL);
});

test("computeSeries seasonality toggle changes recommendation without extreme jumps", () => {
  const currentMonth = monthKeyFromDate(new Date());
  let seasonalMonth = null;
  let seasonalOffset = null;
  for (let idx = 0; idx < 18; idx += 1) {
    const month = addMonths(currentMonth, idx);
    if (month.endsWith("-12")) {
      seasonalMonth = month;
      seasonalOffset = idx;
      break;
    }
  }
  assert.ok(seasonalMonth);
  assert.ok(seasonalOffset != null);
  const currentYear = Number(currentMonth.slice(0, 4));
  const priorYear = currentYear - 1;

  const baseState = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: Number(seasonalOffset) + 1,
      openingBalance: 0,
      cashInMode: "basis",
      cashInRecommendationBaselineNormalPct: 51,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: seasonalMonth, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
    ],
    monthlyActuals: {
      [`${priorYear}-01`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-02`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-03`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-04`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-05`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-06`]: { realRevenueEUR: 10000, realPayoutRatePct: 49 },
      [`${priorYear}-07`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-08`]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [`${priorYear}-09`]: { realRevenueEUR: 10000, realPayoutRatePct: 49 },
      [`${priorYear}-10`]: { realRevenueEUR: 10000, realPayoutRatePct: 49 },
      [`${priorYear}-11`]: { realRevenueEUR: 10000, realPayoutRatePct: 50 },
      [`${priorYear}-12`]: { realRevenueEUR: 10000, realPayoutRatePct: 58 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const seasonalityOnReport = computeSeries(baseState);
  const seasonalityOn = Math.round(salesPayoutAmountForMonth(seasonalityOnReport, seasonalMonth));

  const seasonalityOffReport = computeSeries({
    ...baseState,
    settings: {
      ...baseState.settings,
      cashInRecommendationSeasonalityEnabled: false,
      cashInRecommendationIgnoreQ4: true,
    },
  });
  const seasonalityOff = Math.round(salesPayoutAmountForMonth(seasonalityOffReport, seasonalMonth));
  assert.ok(seasonalityOn > seasonalityOff, `expected seasonality to lift recommendation, got on=${seasonalityOn}, off=${seasonalityOff}`);
  assert.ok((seasonalityOn - seasonalityOff) < 120, "seasonality difference should stay bounded");
});

test("computeSeries applies plan safety margin without conservative horizon deduction", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const next5 = addMonths(currentMonth, 5);
  const next7 = addMonths(currentMonth, 7);
  const seasonalityZeroMap = {
    1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0,
    7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
  };
  const seasonalityCountsMap = {
    1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3,
    7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3,
  };
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 8,
      openingBalance: 0,
      cashInMode: "conservative",
      cashInRecommendationBaselineNormalPct: 60,
      cashInLearning: {
        levelPct: 60,
        riskBasePct: 2,
        seasonalityByMonth: seasonalityZeroMap,
        seasonalityPriorByMonth: seasonalityZeroMap,
        seasonalitySampleCountByMonth: seasonalityCountsMap,
      },
    },
    forecast: { settings: { useForecast: false } },
    incomings: Array.from({ length: 8 }, (_, idx) => ({
      month: addMonths(currentMonth, idx),
      revenueEur: "1.000,00",
      payoutPct: null,
      source: "manual",
    })),
    monthlyActuals: {},
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 60);
  const monthsToCheck = [currentMonth, next1, next2, next5, next7];
  monthsToCheck.forEach((month) => {
    const meta = salesCashInMetaForMonth(report, month);
    assert.ok(meta);
    assert.equal(meta.quoteSource, "recommendation");
    assert.equal(meta.recommendationSeasonalityProfileSource, CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL);
    assert.ok(Math.abs(Number(meta.recommendationRiskAdjustmentPct) - 0.3) < 0.000001);
    assert.ok(Math.abs(Number(meta.recommendationSafetyMarginPct) - 0.3) < 0.000001);
    const expectedPct = Math.min(
      Number(meta.quoteMaxPct),
      Math.max(
        Number(meta.quoteMinPct),
        Number(meta.recommendationLevelPct) + Number(meta.recommendationSeasonalityPct) - Number(meta.recommendationSafetyMarginPct),
      ),
    );
    assert.ok(Math.abs(Number(meta.payoutPct) - expectedPct) < 0.000001, `unexpected quote in ${month}`);
    assert.ok(Math.abs(salesPayoutAmountForMonth(report, month) - (Number(meta.payoutPct) * 10)) < 0.000001, `unexpected payout in ${month}`);
  });
  assert.equal(report.kpis?.cashIn?.quoteMinPct, 40);
  assert.equal(report.kpis?.cashIn?.quoteMaxPct, 60);
});

test("computeSeries enforces final quote band 40..60 for manual values", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const next1 = addMonths(currentMonth, 1);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 2,
      openingBalance: 0,
      cashInMode: "basis",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "80", source: "manual" },
      { month: next1, revenueEur: "1.000,00", payoutPct: "10", source: "manual" },
    ],
    monthlyActuals: {},
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(salesPayoutAmountForMonth(report, currentMonth), 600);
  assert.equal(salesPayoutAmountForMonth(report, next1), 400);
});

test("computeSeries applies revenue calibration with live anchor, mode switch and transparent tooltip/meta", () => {
  withMockedNow(new Date(2026, 1, 15, 10, 0, 0), () => {
    const currentMonth = monthKeyFromDate(new Date());
    const nextMonth = addMonths(currentMonth, 1);
    const baseState = {
      settings: {
        startMonth: currentMonth,
        horizonMonths: 2,
        openingBalance: 0,
        cashInMode: "basis",
        cashInCalibrationEnabled: true,
        cashInCalibrationMode: "basis",
        revenueCalibration: {
          biasB: 0.9,
          riskR: 0.05,
          forecastLock: {},
        },
      },
      forecast: {
        settings: { useForecast: true },
        forecastImport: {
          "SKU-LIVE": {
            [currentMonth]: { revenueEur: 80000 },
            [nextMonth]: { revenueEur: 100000 },
          },
        },
      },
      incomings: [
        {
          month: currentMonth,
          payoutPct: "100",
          source: "forecast",
          calibrationSellerboardMonthEndEur: 68000,
        },
        {
          month: nextMonth,
          payoutPct: "100",
          source: "forecast",
        },
      ],
      monthlyActuals: {},
      extras: [],
      dividends: [],
      pos: [],
      fos: [],
    };

    const basisReport = computeSeries(baseState);
    const basisNextEntry = salesEntriesForMonth(basisReport, nextMonth)[0];
    assert.ok(basisNextEntry);
    assert.equal(Math.round(Number(basisNextEntry.meta?.cashIn?.appliedRevenue || 0)), 88333);
    assert.equal(Math.round(salesPayoutAmountForMonth(basisReport, nextMonth)), 53000);
    assert.equal(basisNextEntry.meta?.cashIn?.payoutPct, 60);

    const conservativeReport = computeSeries({
      ...baseState,
      settings: {
        ...baseState.settings,
        cashInCalibrationMode: "conservative",
      },
    });
    const conservativeNextEntry = salesEntriesForMonth(conservativeReport, nextMonth)[0];
    assert.ok(conservativeNextEntry);
    assert.equal(Math.round(Number(conservativeNextEntry.meta?.cashIn?.appliedRevenue || 0)), 82833);
    assert.equal(Math.round(salesPayoutAmountForMonth(conservativeReport, nextMonth)), 49700);
    assert.equal(conservativeNextEntry.meta?.cashIn?.payoutPct, 60);

    const currentEntry = salesEntriesForMonth(conservativeReport, currentMonth)[0];
    const nextEntry = salesEntriesForMonth(conservativeReport, nextMonth)[0];
    assert.ok(currentEntry);
    assert.ok(nextEntry);
    assert.equal(currentEntry.meta?.cashIn?.quoteSource, "manual");
    assert.equal(currentEntry.meta?.cashIn?.revenueSource, "forecast_calibrated");
    assert.equal(nextEntry.meta?.cashIn?.calibrationSourceMonth, currentMonth);
    assert.equal(nextEntry.meta?.cashIn?.calibrationMode, "conservative");
    assert.match(String(currentEntry.tooltip || ""), /Forecast-Umsatz:/);
    assert.match(String(currentEntry.tooltip || ""), /K_basis:/);
    assert.match(String(currentEntry.tooltip || ""), /K_cons:/);
    assert.match(String(currentEntry.tooltip || ""), /C_live:/);
    assert.match(String(currentEntry.tooltip || ""), /W_eff:/);
    assert.match(String(currentEntry.tooltip || ""), /d:/);
  });
});

test("computeSeries uses manual normal baseline when no IST quotes exist", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 3,
      openingBalance: 0,
      cashInMode: "basis",
      cashInRecommendationBaselineNormalPct: 53,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "58", source: "manual" },
      { month: next1, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
      { month: next2, revenueEur: "1.000,00", payoutPct: null, source: "manual" },
    ],
    monthlyActuals: {},
    actuals: [],
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(report.kpis?.cashIn?.fallbackUsed, "learning_model");
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 53);
  const next1Meta = salesCashInMetaForMonth(report, next1);
  const next2Meta = salesCashInMetaForMonth(report, next2);
  assert.ok(next1Meta);
  assert.ok(next2Meta);
  assert.equal(next1Meta.recommendationSeasonalityProfileSource, CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL);
  assert.equal(next2Meta.recommendationSeasonalityProfileSource, CASH_IN_SEASONALITY_PROFILE_SOURCE_LABEL);
  const expectedNext1Pct = Math.min(
    Number(next1Meta.quoteMaxPct),
    Math.max(
      Number(next1Meta.quoteMinPct),
      Number(next1Meta.recommendationLevelPct) + Number(next1Meta.recommendationSeasonalityPct) - Number(next1Meta.recommendationSafetyMarginPct),
    ),
  );
  const expectedNext2Pct = Math.min(
    Number(next2Meta.quoteMaxPct),
    Math.max(
      Number(next2Meta.quoteMinPct),
      Number(next2Meta.recommendationLevelPct) + Number(next2Meta.recommendationSeasonalityPct) - Number(next2Meta.recommendationSafetyMarginPct),
    ),
  );
  assert.ok(Math.abs(Number(next1Meta.payoutPct) - expectedNext1Pct) < 0.000001);
  assert.ok(Math.abs(Number(next2Meta.payoutPct) - expectedNext2Pct) < 0.000001);
  assert.ok(Math.abs(salesPayoutAmountForMonth(report, next1) - (Number(next1Meta.payoutPct) * 10)) < 0.000001);
  assert.ok(Math.abs(salesPayoutAmountForMonth(report, next2) - (Number(next2Meta.payoutPct) * 10)) < 0.000001);
  assert.notEqual(Number(next1Meta.payoutPct), Number(next2Meta.payoutPct));
});

test("computeSeries honors global quote mode recommendation and ignores manual payout input", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev1 = addMonths(currentMonth, -1);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      cashInQuoteMode: "recommendation",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "60", source: "manual" },
    ],
    monthlyActuals: {
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  const meta = salesCashInMetaForMonth(report, currentMonth);
  assert.ok(meta);
  assert.equal(meta.quoteSource, "recommendation");
  const expectedPct = Math.min(
    Number(meta.quoteMaxPct),
    Math.max(
      Number(meta.quoteMinPct),
      Number(meta.recommendationLevelPct) + Number(meta.recommendationSeasonalityPct) - Number(meta.recommendationSafetyMarginPct),
    ),
  );
  assert.ok(Math.abs(Number(meta.payoutPct) - expectedPct) < 0.000001);
  assert.ok(Math.abs(salesPayoutAmountForMonth(report, currentMonth) - (Number(meta.appliedRevenue) * Number(meta.payoutPct) / 100)) < 0.000001);
});

test("computeSeries honors global revenue basis forecast_direct and ignores manual revenue override", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "forecast_direct",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-A": {
          [currentMonth]: { revenueEur: 1000 },
        },
      },
    },
    incomings: [
      { month: currentMonth, revenueEur: "5.000,00", payoutPct: "50", source: "manual" },
    ],
    products: [
      {
        sku: "SKU-A",
        alias: "A",
        status: "active",
        includeInForecast: true,
      },
    ],
    monthlyActuals: {},
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  const meta = salesCashInMetaForMonth(report, currentMonth);
  assert.ok(meta);
  assert.equal(meta.revenueSource, "forecast_raw");
  assert.equal(Number(meta.appliedRevenue), 1000);
  assert.equal(salesPayoutAmountForMonth(report, currentMonth), 500);
});

test("computeSeries splits manual revenue override by forecast bucket shares in hybrid mode", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-CORE": {
          [currentMonth]: { revenueEur: 600 },
        },
        "SKU-PLAN": {
          [currentMonth]: { revenueEur: 400 },
        },
      },
    },
    incomings: [
      { month: currentMonth, revenueEur: "2.000,00", payoutPct: "50", source: "manual" },
    ],
    products: [
      {
        sku: "SKU-CORE",
        alias: "Core",
        status: "active",
        includeInForecast: true,
        portfolioBucket: "core",
      },
      {
        sku: "SKU-PLAN",
        alias: "Plan",
        status: "active",
        includeInForecast: true,
        portfolioBucket: "plan",
      },
    ],
    monthlyActuals: {},
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  const monthRow = report.series.find((row) => row.month === currentMonth);
  assert.ok(monthRow);
  const salesEntries = (monthRow.entries || []).filter((entry) => entry.kind === "sales-payout");
  assert.ok(salesEntries.length >= 2);
  assert.equal(salesEntries.some((entry) => entry.portfolioBucket == null), false);
  const totalPayout = salesEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  assert.ok(Math.abs(totalPayout - 1000) < 0.000001);
  const payoutByBucket = salesEntries.reduce((acc, entry) => {
    const bucket = String(entry.portfolioBucket || "");
    acc[bucket] = Number(acc[bucket] || 0) + Number(entry.amount || 0);
    return acc;
  }, {});
  assert.ok(Math.abs(Number(payoutByBucket[PORTFOLIO_BUCKET.CORE] || 0) - 600) < 0.01);
  assert.ok(Math.abs(Number(payoutByBucket[PORTFOLIO_BUCKET.PLAN] || 0) - 400) < 0.01);
  const meta = salesEntries[0]?.meta?.cashIn;
  assert.ok(meta);
  assert.equal(meta.revenueSource, "manual_override");
  assert.ok(Math.abs(Number(meta.appliedRevenue) - 2000) < 0.000001);
});

test("computeSeries uses core fallback bucket when manual override has no forecast split basis", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {},
    },
    incomings: [
      { month: currentMonth, revenueEur: "2.000,00", payoutPct: "50", source: "manual" },
    ],
    products: [],
    monthlyActuals: {},
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  const monthRow = report.series.find((row) => row.month === currentMonth);
  assert.ok(monthRow);
  const salesEntries = (monthRow.entries || []).filter((entry) => entry.kind === "sales-payout");
  assert.equal(salesEntries.length, 1);
  assert.equal(salesEntries[0].portfolioBucket, PORTFOLIO_BUCKET.CORE);
  assert.ok(Math.abs(Number(salesEntries[0].amount || 0) - 1000) < 0.000001);
});

test("computeSeries keeps monthly amazon payout invariant: sum(entries) == appliedRevenue * payoutPct", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const nextMonth = addMonths(currentMonth, 1);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 2,
      openingBalance: 0,
      cashInMode: "basis",
      cashInQuoteMode: "recommendation",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: true,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-CORE": {
          [currentMonth]: { revenueEur: 800 },
          [nextMonth]: { revenueEur: 1000 },
        },
        "SKU-PLAN": {
          [currentMonth]: { revenueEur: 200 },
          [nextMonth]: { revenueEur: 500 },
        },
      },
    },
    incomings: [
      { month: currentMonth, revenueEur: "2.200,00", payoutPct: "59", source: "manual" },
      { month: nextMonth, revenueEur: null, payoutPct: "58", source: "forecast" },
    ],
    products: [
      {
        sku: "SKU-CORE",
        alias: "Core",
        status: "active",
        includeInForecast: true,
        portfolioBucket: "core",
      },
      {
        sku: "SKU-PLAN",
        alias: "Plan",
        status: "active",
        includeInForecast: true,
        portfolioBucket: "plan",
      },
    ],
    monthlyActuals: {
      [addMonths(currentMonth, -1)]: { realRevenueEUR: 10000, realPayoutRatePct: 52 },
      [addMonths(currentMonth, -2)]: { realRevenueEUR: 9000, realPayoutRatePct: 54 },
      [addMonths(currentMonth, -3)]: { realRevenueEUR: 8000, realPayoutRatePct: 53 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  [currentMonth, nextMonth].forEach((month) => {
    const salesEntries = salesEntriesForMonth(report, month);
    assert.ok(salesEntries.length > 0);
    const meta = salesEntries[0]?.meta?.cashIn;
    assert.ok(meta);
    const totalPayout = salesEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const expected = Number(meta.appliedRevenue || 0) * Number(meta.payoutPct || 0) / 100;
    assert.ok(Math.abs(totalPayout - expected) < 0.01);
  });
});

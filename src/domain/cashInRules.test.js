import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalibrationProfile,
  buildPayoutRecommendation,
  buildHistoricalPayoutPrior,
  learnRevenueCalibrationState,
} from "./cashInRules.js";

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(offset || 0), 1);
  return monthKeyFromDate(date);
}

function near(actual, expected, epsilon = 0.0001) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `expected ${actual} to be near ${expected}`);
}

test("recommendation stays near start profile with only two IST months", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);

  const result = buildPayoutRecommendation({
    mode: "basis",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [currentMonth, next1],
    baselineNormalPct: 51,
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 54 },
      [prev1]: { realRevenueEUR: 12000, realPayoutRatePct: 52 },
    },
  });

  const nextQuote = Number(result.byMonth?.[next1]?.quotePct);
  assert.ok(Number.isFinite(nextQuote));
  assert.ok(nextQuote >= 49 && nextQuote <= 54, `quote should stay near prior, got ${nextQuote}`);
});

test("plan recommendation uses fixed safety margin and ignores conservative mode flag", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);

  const input = {
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [currentMonth, next1],
    learningState: {
      levelPct: 54,
      riskBasePct: 2,
      seasonalityByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      seasonalityPriorByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
    },
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 53 },
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 50 },
    },
  };

  const planResult = buildPayoutRecommendation({
    ...input,
    mode: "plan",
  });
  const conservativeResult = buildPayoutRecommendation({
    ...input,
    mode: "conservative",
  });

  assert.equal(planResult.mode, "plan");
  near(planResult.safetyMarginPct, 0.5, 0.0001);
  near(Number(planResult.byMonth?.[next1]?.safetyMarginPct), 0.5, 0.0001);
  near(
    Number(planResult.byMonth?.[next1]?.quotePct),
    Number(conservativeResult.byMonth?.[next1]?.quotePct),
    0.0001,
  );
  assert.equal(planResult.byMonth?.[next1]?.sourceTag, "RECOMMENDED_PLAN");
});

test("shrinkage limits seasonal outliers until three samples", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const nextJuly = (() => {
    for (let i = 0; i < 24; i += 1) {
      const month = addMonths(currentMonth, i);
      if (month.endsWith("-07")) return month;
    }
    return addMonths(currentMonth, 1);
  })();
  const yearBase = Number(currentMonth.slice(0, 4));

  const withOneJuly = buildPayoutRecommendation({
    mode: "basis",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [nextJuly],
    baselineNormalPct: 51,
    monthlyActuals: {
      [`${yearBase - 1}-07`]: { realRevenueEUR: 8000, realPayoutRatePct: 60 },
    },
  });

  const oneJulyEntry = withOneJuly.byMonth?.[nextJuly];
  assert.ok(Number(oneJulyEntry?.seasonalityWeight) < 1);
  assert.ok(Math.abs(Number(oneJulyEntry?.seasonalityPct || 0)) <= 4);

  const withThreeJuly = buildPayoutRecommendation({
    mode: "basis",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [nextJuly],
    baselineNormalPct: 51,
    monthlyActuals: {
      [`${yearBase - 3}-07`]: { realRevenueEUR: 8000, realPayoutRatePct: 58 },
      [`${yearBase - 2}-07`]: { realRevenueEUR: 9000, realPayoutRatePct: 59 },
      [`${yearBase - 1}-07`]: { realRevenueEUR: 10000, realPayoutRatePct: 60 },
    },
  });

  const threeJulyEntry = withThreeJuly.byMonth?.[nextJuly];
  assert.ok(Number(threeJulyEntry?.seasonalityWeight) >= 1);
  assert.ok(Math.abs(Number(threeJulyEntry?.seasonalityPct || 0)) >= 2);
});

test("historical prior import is robust and clamps outputs", () => {
  const prior = buildHistoricalPayoutPrior({
    startMonth: "2022-05",
    values: "51\n50\n49\n60\n10\n52\n51\n52",
  });

  assert.equal(prior.ok, true);
  assert.ok(Number(prior.levelPct) >= 40 && Number(prior.levelPct) <= 60);

  const currentMonth = monthKeyFromDate(new Date());
  const nextMonth = addMonths(currentMonth, 1);
  const recommendation = buildPayoutRecommendation({
    mode: "conservative",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [nextMonth],
    learningState: {
      levelPct: 60,
      riskBasePct: 6,
      seasonalityByMonth: prior.ok ? prior.seasonalityPriorByMonth : {},
      seasonalityPriorByMonth: prior.ok ? prior.seasonalityPriorByMonth : {},
      seasonalitySampleCountByMonth: { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3 },
    },
  });

  const entry = recommendation.byMonth?.[nextMonth];
  assert.ok(Number(entry?.quotePct) <= 60);
  assert.equal(entry?.sourceTag, "RECOMMENDED_PLAN");
  near(Number(entry?.safetyMarginPct), 0.5, 0.0001);
  assert.ok(Array.isArray(entry?.capsApplied));
});

test("revenue calibration follows day-weighted live anchor (Tag 5/15/25)", () => {
  const currentMonth = "2026-02";
  const nextMonth = "2026-03";
  const sharedInput = {
    months: [currentMonth, nextMonth],
    currentMonth,
    mode: "basis",
    learningState: {
      biasB: 0.9,
      riskR: 0.05,
      forecastLock: {},
    },
    monthlyActuals: {},
    incomings: [
      {
        month: currentMonth,
        calibrationSellerboardMonthEndEur: 68000,
      },
    ],
    forecastRevenueByMonth: {
      [currentMonth]: 80000,
      [nextMonth]: 100000,
    },
  };

  const day5 = buildCalibrationProfile({
    ...sharedInput,
    now: new Date(2026, 1, 5, 10, 0, 0),
  });
  const day15 = buildCalibrationProfile({
    ...sharedInput,
    now: new Date(2026, 1, 15, 10, 0, 0),
  });
  const day25 = buildCalibrationProfile({
    ...sharedInput,
    now: new Date(2026, 1, 25, 10, 0, 0),
  });

  const entry5 = day5.byMonth[nextMonth];
  const entry15 = day15.byMonth[nextMonth];
  const entry25 = day25.byMonth[nextMonth];

  near(entry5.wTime, 0);
  near(entry5.wH, 2 / 3);
  near(entry5.wEff, 0);
  near(entry5.signal, 0.9);
  near(entry5.factorBasis, 0.9);
  near(entry5.factorConservative, 0.845);
  near(entry5.calibratedRevenueBasis, 90000);
  near(entry5.calibratedRevenueConservative, 84500);

  near(entry15.wTime, 0.5);
  near(entry15.wEff, 1 / 3);
  near(entry15.signal, 0.8833333333);
  near(entry15.factorConservative, 0.8283333333);

  near(entry25.wTime, 1);
  near(entry25.wEff, 2 / 3);
  near(entry25.signal, 0.8666666667);
  near(entry25.factorConservative, 0.8116666667);
});

test("revenue calibration falls back to bias when live anchor cannot be used", () => {
  const currentMonth = "2026-02";
  const nextMonth = "2026-03";

  const missingForecast = buildCalibrationProfile({
    months: [currentMonth, nextMonth],
    currentMonth,
    mode: "basis",
    now: new Date(2026, 1, 25, 10, 0, 0),
    learningState: { biasB: 0.9, riskR: 0.05, forecastLock: {} },
    monthlyActuals: {},
    incomings: [{ month: currentMonth, calibrationSellerboardMonthEndEur: 68000 }],
    forecastRevenueByMonth: { [currentMonth]: 0, [nextMonth]: 100000 },
  });
  near(missingForecast.byMonth[nextMonth].wEff, 0);
  near(missingForecast.byMonth[nextMonth].factorBasis, 0.9);

  const missingLive = buildCalibrationProfile({
    months: [currentMonth, nextMonth],
    currentMonth,
    mode: "basis",
    now: new Date(2026, 1, 25, 10, 0, 0),
    learningState: { biasB: 0.9, riskR: 0.05, forecastLock: {} },
    monthlyActuals: {},
    incomings: [{ month: currentMonth, calibrationSellerboardMonthEndEur: null }],
    forecastRevenueByMonth: { [currentMonth]: 80000, [nextMonth]: 100000 },
  });
  near(missingLive.byMonth[nextMonth].wEff, 0);
  near(missingLive.byMonth[nextMonth].factorBasis, 0.9);
});

test("revenue calibration clamps extreme live factor before blending", () => {
  const profile = buildCalibrationProfile({
    months: ["2026-02", "2026-03"],
    currentMonth: "2026-02",
    mode: "basis",
    now: new Date(2026, 1, 25, 10, 0, 0),
    learningState: { biasB: 0.9, riskR: 0.05, forecastLock: {} },
    monthlyActuals: {},
    incomings: [{ month: "2026-02", calibrationSellerboardMonthEndEur: 200000 }],
    forecastRevenueByMonth: { "2026-02": 80000, "2026-03": 100000 },
  });

  near(profile.liveAnchor.cLiveRaw, 2.5);
  near(profile.liveAnchor.cLive, 1.2);
  near(profile.byMonth["2026-03"].factorBasis, 1.05);
});

test("revenue calibration learning updates bias/risk and creates monthly lock", () => {
  const learning = learnRevenueCalibrationState({
    currentMonth: "2026-02",
    now: new Date(2026, 1, 28, 12, 0, 0),
    learningState: {
      biasB: 1,
      riskR: 0.05,
      forecastLock: {},
    },
    monthlyActuals: {
      "2026-01": { realRevenueEUR: 70000 },
    },
    forecastRevenueByMonth: {
      "2026-01": 80000,
    },
    sourceForecastVersionId: "fv-1",
  });

  const lock = learning.state.forecastLock["2026-01"];
  assert.ok(lock);
  near(lock.forecastRevenueLockedEUR, 80000);
  assert.equal(lock.sourceForecastVersionId, "fv-1");
  near(learning.state.biasB, 0.975);
  near(learning.state.riskR, 0.06875);
});

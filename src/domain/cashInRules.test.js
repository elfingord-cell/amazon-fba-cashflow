import test from "node:test";
import assert from "node:assert/strict";

import { buildPayoutRecommendation, buildHistoricalPayoutPrior } from "./cashInRules.js";

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(offset || 0), 1);
  return monthKeyFromDate(date);
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

test("risk base rises after optimistic miss and lowers conservative quote", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);

  const result = buildPayoutRecommendation({
    mode: "conservative",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [currentMonth, next1],
    learningState: {
      levelPct: 54,
      riskBasePct: 0.5,
      seasonalityByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      seasonalityPriorByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      predictionSnapshotByMonth: {
        [prev1]: { quotePct: 58, mode: "conservative", source: "test" },
      },
    },
    monthlyActuals: {
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 50 },
    },
  });

  const riskBase = Number(result.riskBasePct);
  assert.ok(riskBase > 0.5, `risk base should increase, got ${riskBase}`);

  const currentQuote = Number(result.byMonth?.[currentMonth]?.quotePct);
  const futureQuote = Number(result.byMonth?.[next1]?.quotePct);
  assert.ok(Number.isFinite(currentQuote));
  assert.ok(Number.isFinite(futureQuote));
  assert.ok(futureQuote <= currentQuote, "future conservative quote should not exceed current quote");
});

test("positive surprises do not drive risk base negative", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev1 = addMonths(currentMonth, -1);

  const result = buildPayoutRecommendation({
    mode: "conservative",
    seasonalityEnabled: true,
    currentMonth,
    maxMonth: currentMonth,
    months: [currentMonth],
    learningState: {
      levelPct: 52,
      riskBasePct: 2,
      seasonalityByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      seasonalityPriorByMonth: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 },
      predictionSnapshotByMonth: {
        [prev1]: { quotePct: 50, mode: "conservative", source: "test" },
      },
    },
    monthlyActuals: {
      [prev1]: { realRevenueEUR: 11000, realPayoutRatePct: 56 },
    },
  });

  const riskBase = Number(result.riskBasePct);
  assert.ok(riskBase >= 1.9, `risk base should stay stable on positive surprise, got ${riskBase}`);
  assert.ok(riskBase <= 2.1, `risk base should not jump, got ${riskBase}`);
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
  assert.equal(entry?.capApplied, true);
  assert.ok(Array.isArray(entry?.capsApplied));
  assert.ok((entry?.capsApplied || []).includes("risk_cap_6pp") || (entry?.capsApplied || []).includes("quote_band_40_60"));
});

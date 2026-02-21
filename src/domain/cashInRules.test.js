import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalibrationProfile,
  buildPayoutRecommendation,
  clampPct,
  normalizeCalibrationHorizonMonths,
} from "./cashInRules.js";

test("buildPayoutRecommendation applies IST/PROGNOSE/BASELINE priority and Q4 baseline suggestion", () => {
  const recommendation = buildPayoutRecommendation({
    months: ["2026-01", "2026-02", "2026-10", "2026-12"],
    currentMonth: "2026-02",
    baselineNormalPct: 51,
    monthlyActuals: {
      "2025-12": { realRevenueEUR: 10000, realPayoutRatePct: 58 },
      "2026-01": { realRevenueEUR: 10000, realPayoutRatePct: 54 },
    },
    incomings: [
      {
        month: "2026-02",
        calibrationSellerboardMonthEndEur: 100000,
        calibrationPayoutRateToDatePct: 52000,
      },
    ],
    ignoreQ4: false,
    maxMonth: "2026-02",
    minSamples: 4,
  });

  assert.equal(recommendation.baselineNormalPct, 51);
  assert.equal(recommendation.decemberQuotePct, 58);
  assert.equal(Number(recommendation.baselineQ4SuggestedPct.toFixed(2)), 54.5);
  assert.equal(Number(recommendation.baselineQ4Pct.toFixed(2)), 54.5);
  assert.equal(recommendation.byMonth["2026-01"].sourceTag, "IST");
  assert.equal(Number(recommendation.byMonth["2026-01"].quotePct.toFixed(2)), 54);
  assert.equal(recommendation.byMonth["2026-02"].sourceTag, "PROGNOSE");
  assert.equal(Number(recommendation.byMonth["2026-02"].quotePct.toFixed(2)), 52);
  assert.equal(recommendation.byMonth["2026-10"].sourceTag, "BASELINE_Q4");
  assert.equal(Number(recommendation.byMonth["2026-10"].quotePct.toFixed(2)), 54.5);
  assert.equal(recommendation.sampleCount, 2);
  assert.equal(recommendation.uncertain, true);
});

test("buildPayoutRecommendation switches Q4 months to normal baseline when ignoreQ4 is active", () => {
  const recommendation = buildPayoutRecommendation({
    months: ["2026-10"],
    currentMonth: "2026-02",
    baselineNormalPct: 51,
    monthlyActuals: {
      "2025-12": { realRevenueEUR: 10000, realPayoutRatePct: 58 },
    },
    ignoreQ4: true,
    maxMonth: "2026-02",
  });

  assert.equal(recommendation.byMonth["2026-10"].sourceTag, "BASELINE_NORMAL");
  assert.equal(Number(recommendation.byMonth["2026-10"].quotePct.toFixed(2)), 51);
});

test("buildPayoutRecommendation uses manual Q4 baseline override when provided", () => {
  const recommendation = buildPayoutRecommendation({
    months: ["2026-10"],
    currentMonth: "2026-02",
    baselineNormalPct: 51,
    baselineQ4Pct: 56,
    monthlyActuals: {
      "2025-12": { realRevenueEUR: 10000, realPayoutRatePct: 58 },
    },
    ignoreQ4: false,
    maxMonth: "2026-02",
  });

  assert.equal(recommendation.baselineQ4Source, "manual");
  assert.equal(Number(recommendation.byMonth["2026-10"].quotePct.toFixed(2)), 56);
});

test("buildCalibrationProfile uses sellerboard value if provided", () => {
  const profile = buildCalibrationProfile({
    months: ["2025-06", "2025-07", "2025-08"],
    horizonMonths: 6,
    forecastRevenueByMonth: {
      "2025-06": 10000,
      "2025-07": 12000,
      "2025-08": 15000,
    },
    incomings: [
      {
        month: "2025-06",
        calibrationSellerboardMonthEndEur: 9000,
      },
    ],
  });

  const june = profile.byMonth["2025-06"];
  assert.equal(june.active, true);
  assert.equal(june.method, "sellerboard");
  assert.equal(Number(june.rawFactor.toFixed(4)), 0.9);
  assert.equal(Number(june.factor.toFixed(4)), 0.9);
});

test("buildCalibrationProfile uses linear projection and decays to one", () => {
  const profile = buildCalibrationProfile({
    months: ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
    horizonMonths: 6,
    forecastRevenueByMonth: {
      "2025-06": 10000,
      "2025-07": 10000,
      "2025-08": 10000,
      "2025-09": 10000,
      "2025-10": 10000,
      "2025-11": 10000,
      "2025-12": 10000,
    },
    incomings: [
      {
        month: "2025-06",
        calibrationCutoffDate: "2025-06-15",
        calibrationRevenueToDateEur: 4500,
      },
    ],
  });

  assert.equal(Number(profile.byMonth["2025-06"].factor.toFixed(4)), 0.9);
  assert.equal(Number(profile.byMonth["2025-07"].factor.toFixed(4)), 0.92);
  assert.equal(Number(profile.byMonth["2025-11"].factor.toFixed(4)), 1);
  assert.equal(Number(profile.byMonth["2025-12"].factor.toFixed(4)), 1);
});

test("buildCalibrationProfile resolves overlap by latest valid month", () => {
  const profile = buildCalibrationProfile({
    months: ["2025-06", "2025-07", "2025-08"],
    horizonMonths: 6,
    forecastRevenueByMonth: {
      "2025-06": 10000,
      "2025-07": 10000,
      "2025-08": 10000,
    },
    incomings: [
      {
        month: "2025-06",
        calibrationCutoffDate: "2025-06-10",
        calibrationRevenueToDateEur: 3000,
      },
      {
        month: "2025-07",
        calibrationCutoffDate: "2025-07-10",
        calibrationRevenueToDateEur: 5000,
      },
    ],
  });

  assert.equal(profile.byMonth["2025-08"].sourceMonth, "2025-07");
});

test("normalizeCalibrationHorizonMonths and clampPct enforce allowed ranges", () => {
  assert.equal(normalizeCalibrationHorizonMonths(3), 3);
  assert.equal(normalizeCalibrationHorizonMonths(4), 6);
  assert.equal(normalizeCalibrationHorizonMonths(null, 12), 12);

  assert.equal(clampPct(39), 40);
  assert.equal(clampPct(55), 55);
  assert.equal(clampPct(61), 60);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalibrationProfile,
  buildPayoutRecommendation,
  clampPct,
  normalizeCalibrationHorizonMonths,
} from "./cashInRules.js";

test("buildPayoutRecommendation computes median and Q4 filter", () => {
  const monthlyActuals = {
    "2025-07": { realPayoutRatePct: 45 },
    "2025-08": { realPayoutRatePct: 55 },
    "2025-10": { realPayoutRatePct: 60 },
    "2025-11": { realPayoutRatePct: 58 },
  };

  const allMonths = buildPayoutRecommendation({ monthlyActuals, ignoreQ4: false, maxMonth: "2025-12", minSamples: 4 });
  const noQ4 = buildPayoutRecommendation({ monthlyActuals, ignoreQ4: true, maxMonth: "2025-12", minSamples: 4 });

  assert.equal(allMonths.sampleCount, 4);
  assert.equal(allMonths.medianPct, 56.5);
  assert.equal(allMonths.uncertain, false);
  assert.deepEqual(allMonths.usedMonths, ["2025-07", "2025-08", "2025-10", "2025-11"]);

  assert.equal(noQ4.sampleCount, 2);
  assert.equal(noQ4.medianPct, 50);
  assert.equal(noQ4.uncertain, true);
  assert.deepEqual(noQ4.usedMonths, ["2025-07", "2025-08"]);
});

test("buildPayoutRecommendation marks uncertain for less than 4 samples", () => {
  const two = buildPayoutRecommendation({
    monthlyActuals: {
      "2025-01": { realPayoutRatePct: 41 },
      "2025-02": { realPayoutRatePct: 43 },
    },
    maxMonth: "2025-12",
    minSamples: 4,
  });
  const four = buildPayoutRecommendation({
    monthlyActuals: {
      "2025-01": { realPayoutRatePct: 41 },
      "2025-02": { realPayoutRatePct: 43 },
      "2025-03": { realPayoutRatePct: 45 },
      "2025-04": { realPayoutRatePct: 47 },
    },
    maxMonth: "2025-12",
    minSamples: 4,
  });

  assert.equal(two.sampleCount, 2);
  assert.equal(two.uncertain, true);
  assert.equal(four.sampleCount, 4);
  assert.equal(four.uncertain, false);
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
        calibrationCutoffDate: "2025-06-12",
        calibrationRevenueToDateEur: 5000,
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
  assert.equal(Number(profile.byMonth["2025-07"].factor.toFixed(4)), 0.9167);
  assert.equal(Number(profile.byMonth["2025-11"].factor.toFixed(4)), 0.9833);
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
  assert.equal(normalizeCalibrationHorizonMonths(null, 9), 9);

  assert.equal(clampPct(39), 40);
  assert.equal(clampPct(55), 55);
  assert.equal(clampPct(61), 60);
});

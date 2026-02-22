import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSkuProjection,
  computeFoRecommendation,
  getLatestClosingSnapshotMonth,
} from "./foSuggestion.js";

test("no snapshot blocks recommendation", () => {
  const baselineMonth = getLatestClosingSnapshotMonth([]);
  const recommendation = computeFoRecommendation({
    sku: "SKU-1",
    baselineMonth,
    projection: null,
    safetyStockDays: 60,
    coverageDays: 90,
    leadTimeDays: 30,
  });

  assert.equal(baselineMonth, null);
  assert.strictEqual(recommendation.status, "no_snapshot");
});

test("snapshot exists and demand triggers critical month", () => {
  const projection = buildSkuProjection({
    sku: "SKU-2",
    baselineMonth: "2025-01",
    stock0: 100,
    forecastByMonth: { "2025-02": 300 },
    inboundByMonth: {},
    horizonMonths: 3,
  });

  const recommendation = computeFoRecommendation({
    sku: "SKU-2",
    baselineMonth: "2025-01",
    projection,
    safetyStockDays: 60,
    coverageDays: 90,
    leadTimeDays: 30,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.criticalMonth, "2025-02");
  assert.strictEqual(recommendation.requiredArrivalDate, "2025-02-01");
});

test("CNY overlap extends lead time and shifts order date", () => {
  const projection = buildSkuProjection({
    sku: "SKU-3",
    baselineMonth: "2025-01",
    stock0: 80,
    forecastByMonth: { "2025-02": 200 },
    inboundByMonth: {},
    horizonMonths: 2,
  });

  const recommendation = computeFoRecommendation({
    sku: "SKU-3",
    baselineMonth: "2025-01",
    projection,
    safetyStockDays: 60,
    coverageDays: 90,
    leadTimeDays: 40,
    cnyPeriod: { start: "2025-01-20", end: "2025-02-10" },
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.ok(recommendation.overlapDays > 0);
  assert.ok(new Date(recommendation.orderDateAdjusted) < new Date(recommendation.orderDate));
});

test("no demand leads to no FO needed", () => {
  const projection = buildSkuProjection({
    sku: "SKU-4",
    baselineMonth: "2025-01",
    stock0: 200,
    forecastByMonth: {},
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku: "SKU-4",
    baselineMonth: "2025-01",
    projection,
    safetyStockDays: 60,
    coverageDays: 90,
    leadTimeDays: 20,
  });

  assert.strictEqual(recommendation.status, "no_fo_needed");
});

test("coverage-window units are based on target arrival month and respect MOQ floor", () => {
  const sku = "SKU-5";
  const projection = buildSkuProjection({
    sku,
    baselineMonth: "2025-01",
    stock0: 100,
    forecastByMonth: { "2025-02": 300, "2025-03": 310, "2025-04": 300 },
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku,
    baselineMonth: "2025-01",
    projection,
    plannedSalesBySku: { [sku]: { "2025-03": 310, "2025-04": 300 } },
    safetyStockDays: 60,
    coverageDays: 60,
    leadTimeDays: 30,
    requiredArrivalMonth: "2025-03",
    moqUnits: 800,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.selectedArrivalMonth, "2025-03");
  assert.strictEqual(recommendation.requiredArrivalDate, "2025-03-01");
  assert.strictEqual(recommendation.coverageDaysForOrder, 60);
  assert.strictEqual(recommendation.recommendedUnitsRaw, 600);
  assert.strictEqual(recommendation.recommendedUnits, 800);
  assert.strictEqual(recommendation.moqApplied, true);
  assert.ok(Array.isArray(recommendation.coverageDemandBreakdown));
  assert.strictEqual(recommendation.coverageDemandBreakdown[0].month, "2025-03");
  const breakdownSum = recommendation.coverageDemandBreakdown
    .reduce((sum, entry) => sum + Number(entry.demandUnitsInWindow || 0), 0);
  assert.strictEqual(Math.round(breakdownSum), 600);
  assert.strictEqual(Math.round(recommendation.coverageDemandUnits), 600);
});

test("carton rounding without MOQ rounds up to full cartons", () => {
  const sku = "SKU-CARTON-1";
  const projection = buildSkuProjection({
    sku,
    baselineMonth: "2025-01",
    stock0: 50,
    forecastByMonth: { "2025-02": 300, "2025-03": 181 },
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku,
    baselineMonth: "2025-01",
    projection,
    plannedSalesBySku: { [sku]: { "2025-03": 181 } },
    safetyStockDays: 60,
    coverageDays: 31,
    leadTimeDays: 30,
    requiredArrivalMonth: "2025-03",
    unitsPerCarton: 4,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.recommendedUnitsRaw, 181);
  assert.strictEqual(recommendation.moqApplied, false);
  assert.strictEqual(recommendation.unitsAfterMoq, 181);
  assert.strictEqual(recommendation.unitsAfterCartonRounding, 184);
  assert.strictEqual(recommendation.recommendedUnits, 184);
  assert.strictEqual(recommendation.cartonRoundingApplied, true);
  assert.strictEqual(recommendation.recommendedCartons, 46);
});

test("MOQ is applied before carton rounding", () => {
  const sku = "SKU-CARTON-2";
  const projection = buildSkuProjection({
    sku,
    baselineMonth: "2025-01",
    stock0: 100,
    forecastByMonth: { "2025-02": 300, "2025-03": 490 },
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku,
    baselineMonth: "2025-01",
    projection,
    plannedSalesBySku: { [sku]: { "2025-03": 490 } },
    safetyStockDays: 60,
    coverageDays: 31,
    leadTimeDays: 30,
    requiredArrivalMonth: "2025-03",
    moqUnits: 500,
    unitsPerCarton: 12,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.recommendedUnitsRaw, 490);
  assert.strictEqual(recommendation.unitsAfterMoq, 500);
  assert.strictEqual(recommendation.unitsAfterCartonRounding, 504);
  assert.strictEqual(recommendation.recommendedUnits, 504);
  assert.strictEqual(recommendation.moqApplied, true);
});

test("block roundup applies when lift percent is within threshold", () => {
  const sku = "SKU-CARTON-3";
  const projection = buildSkuProjection({
    sku,
    baselineMonth: "2025-01",
    stock0: 50,
    forecastByMonth: { "2025-02": 300, "2025-03": 181 },
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku,
    baselineMonth: "2025-01",
    projection,
    plannedSalesBySku: { [sku]: { "2025-03": 181 } },
    safetyStockDays: 60,
    coverageDays: 31,
    leadTimeDays: 30,
    requiredArrivalMonth: "2025-03",
    unitsPerCarton: 4,
    roundupCartonBlock: 10,
    roundupMaxPct: 10,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.unitsAfterCartonRounding, 184);
  assert.strictEqual(recommendation.roundupCandidateUnits, 200);
  assert.strictEqual(recommendation.blockRoundupApplied, true);
  assert.strictEqual(recommendation.recommendedUnits, 200);
});

test("block roundup is skipped when lift percent exceeds threshold", () => {
  const sku = "SKU-CARTON-4";
  const projection = buildSkuProjection({
    sku,
    baselineMonth: "2025-01",
    stock0: 50,
    forecastByMonth: { "2025-02": 300, "2025-03": 181 },
    inboundByMonth: {},
    horizonMonths: 4,
  });

  const recommendation = computeFoRecommendation({
    sku,
    baselineMonth: "2025-01",
    projection,
    plannedSalesBySku: { [sku]: { "2025-03": 181 } },
    safetyStockDays: 60,
    coverageDays: 31,
    leadTimeDays: 30,
    requiredArrivalMonth: "2025-03",
    unitsPerCarton: 4,
    roundupCartonBlock: 10,
    roundupMaxPct: 5,
  });

  assert.strictEqual(recommendation.status, "ok");
  assert.strictEqual(recommendation.unitsAfterCartonRounding, 184);
  assert.strictEqual(recommendation.roundupCandidateUnits, 200);
  assert.strictEqual(recommendation.blockRoundupApplied, false);
  assert.strictEqual(recommendation.recommendedUnits, 184);
});

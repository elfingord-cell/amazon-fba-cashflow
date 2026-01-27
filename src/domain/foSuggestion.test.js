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
    minSafetyDays: 60,
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
    minSafetyDays: 60,
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
    minSafetyDays: 60,
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
    minSafetyDays: 60,
    leadTimeDays: 20,
  });

  assert.strictEqual(recommendation.status, "no_fo_needed");
});

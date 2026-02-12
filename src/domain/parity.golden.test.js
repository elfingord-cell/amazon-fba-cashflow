import test from "node:test";
import assert from "node:assert/strict";

import { computeSeries } from "./cashflow.js";
import { computeInventoryProjection } from "./inventoryProjection.js";
import { computeVatPreview } from "./vatPreview.js";
import { computeAbcClassification } from "./abcClassification.js";
import { createParityGoldenState } from "./fixtures/parityGoldenState.js";

function near(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= tolerance,
    `expected ${actual} to be within ±${tolerance} of ${expected}`,
  );
}

test("golden parity: dashboard plan/ist breakdown remains stable", () => {
  const state = createParityGoldenState();
  const result = computeSeries(state);

  assert.deepEqual(result.months, ["2025-01", "2025-02", "2025-03"]);
  near(result.breakdown[0].opening, 10000);
  near(result.breakdown[0].closing, 18900);
  near(result.breakdown[1].closing, 34100);
  near(result.breakdown[2].closing, 34000);

  const febActual = result.actualComparisons.find((entry) => entry.month === "2025-02");
  assert.ok(febActual, "missing 2025-02 actual comparison row");
  near(febActual.plannedRevenue, 30000);
  near(febActual.actualRevenue, 28000);
  near(febActual.revenueDelta, -2000);
  near(febActual.plannedPayout, 15000);
  near(febActual.actualPayout, 14000);
  near(febActual.payoutDelta, -1000);
  near(febActual.plannedClosing, 34100);
  near(febActual.actualClosing, 33000);
  near(febActual.closingDelta, -1100);
});

test("golden parity: inventory projection keeps units and inbound behavior", () => {
  const state = createParityGoldenState();
  const projection = computeInventoryProjection({
    state,
    months: ["2025-02", "2025-03"],
    products: state.products,
    projectionMode: "units",
  });

  const skuA = projection.perSkuMonth.get("SKU-A");
  const skuB = projection.perSkuMonth.get("SKU-B");
  assert.ok(skuA, "SKU-A projection missing");
  assert.ok(skuB, "SKU-B projection missing");

  near(skuA.get("2025-02").forecastUnits, 30);
  near(skuA.get("2025-02").endAvailable, 70);
  near(skuA.get("2025-03").inboundUnits, 50);
  near(skuA.get("2025-03").endAvailable, 80);
  assert.equal(skuA.get("2025-03").isCovered, true);

  near(skuB.get("2025-02").endAvailable, 20);
  near(skuB.get("2025-03").endAvailable, 10);
  assert.equal(skuB.get("2025-03").isCovered, true);
});

test("golden parity: vat preview payable values stay reproducible", () => {
  const state = createParityGoldenState();
  const result = computeVatPreview(state);
  const jan = result.rows.find((row) => row.month === "2025-01");
  const feb = result.rows.find((row) => row.month === "2025-02");

  assert.ok(jan, "January VAT row missing");
  assert.ok(feb, "February VAT row missing");
  near(jan.grossDe, 16000, 0.001);
  near(jan.payable, 1241.18, 0.05);
  near(feb.grossDe, 24000, 0.001);
  near(feb.payable, 1911.76, 0.05);
});

test("golden parity: abc classification remains deterministic on reference state", () => {
  const state = createParityGoldenState();
  const result = computeAbcClassification(state);
  const skuA = result.bySku.get("sku-a");
  const skuB = result.bySku.get("sku-b");

  assert.ok(skuA, "SKU-A missing in ABC snapshot");
  assert.ok(skuB, "SKU-B missing in ABC snapshot");
  assert.equal(skuA.abcClass, "B");
  assert.equal(skuB.abcClass, "C");
});

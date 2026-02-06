import test from "node:test";
import assert from "node:assert/strict";

import {
  getProjectionSafetyClass,
  resolveCoverageDays,
  resolveSafetyStockDays,
} from "./inventoryProjection.js";

test("resolves safety stock and coverage days with overrides and defaults", () => {
  const product = { safetyStockDohOverride: 21, foCoverageDohOverride: 45 };
  const state = { settings: { safetyStockDohDefault: 60, foCoverageDohDefault: 90 } };

  assert.strictEqual(resolveSafetyStockDays(product, state), 21);
  assert.strictEqual(resolveCoverageDays(product, state), 45);

  const fallbackProduct = {};
  assert.strictEqual(resolveSafetyStockDays(fallbackProduct, state), 60);
  assert.strictEqual(resolveCoverageDays(fallbackProduct, state), 90);

  const emptyState = { settings: {} };
  assert.strictEqual(resolveSafetyStockDays(fallbackProduct, emptyState), null);
  assert.strictEqual(resolveCoverageDays(fallbackProduct, emptyState), null);

  const zeroState = { settings: { safetyStockDohDefault: 0, foCoverageDohDefault: 0 } };
  assert.strictEqual(resolveSafetyStockDays(fallbackProduct, zeroState), null);
  assert.strictEqual(resolveCoverageDays(fallbackProduct, zeroState), null);
});

test("projection safety class prioritizes red stockout over orange safety", () => {
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 0, safetyUnits: 10 }), "safety-negative");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: -4, safetyUnits: 10 }), "safety-negative");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 5, safetyUnits: 10 }), "safety-low");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 5, safetyUnits: null }), "");
});

test("defaults apply in DOH mode and orange when below safety days", () => {
  const product = {};
  const state = { settings: { safetyStockDohDefault: 60, foCoverageDohDefault: 90 } };

  assert.strictEqual(resolveSafetyStockDays(product, state), 60);
  assert.strictEqual(resolveCoverageDays(product, state), 90);
  assert.strictEqual(
    getProjectionSafetyClass({ projectionMode: "doh", doh: 45, safetyDays: 60 }),
    "safety-low",
  );
});

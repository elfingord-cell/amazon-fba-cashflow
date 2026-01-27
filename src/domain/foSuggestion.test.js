import test from "node:test";
import assert from "node:assert/strict";

import { computeFoSuggestion } from "./foSuggestion.js";

const baseDefaults = {
  safetyStockDaysTotalDe: 60,
  minimumStockDaysTotalDe: 20,
  leadTimeDaysTotal: 0,
  moqUnits: 0,
  operationalCoverageDaysDefault: 10,
};

test("single-month horizon returns zero when inventory covers demand", () => {
  const result = computeFoSuggestion({
    sku: "SKU-1",
    today: "2025-04-10",
    policyDefaults: baseDefaults,
    plannedSalesBySku: { "SKU-1": { "2025-04": 300 } },
    closingStockBySku: { "SKU-1": { "2025-04": 100 } },
  });

  assert.strictEqual(result.suggestedUnits, 0);
  assert.strictEqual(result.status, "ok");
  assert.ok(result.rationale.projectedInventoryAtEta > result.rationale.requiredUnits);
});

test("multi-month horizon integrates demand across month boundary", () => {
  const result = computeFoSuggestion({
    sku: "SKU-2",
    today: "2025-04-25",
    policyDefaults: {
      ...baseDefaults,
      leadTimeDaysTotal: 5,
      operationalCoverageDaysDefault: 15,
    },
    plannedSalesBySku: {
      "SKU-2": { "2025-04": 300, "2025-05": 310 },
    },
    closingStockBySku: {
      "SKU-2": { "2025-04": 100, "2025-05": 50 },
    },
  });

  assert.strictEqual(result.rationale.requiredUnits, 150);
  assert.strictEqual(result.suggestedUnits, 40);
});

test("MOQ is applied when suggestion is below threshold", () => {
  const result = computeFoSuggestion({
    sku: "SKU-3",
    today: "2025-04-25",
    policyDefaults: {
      ...baseDefaults,
      leadTimeDaysTotal: 5,
      operationalCoverageDaysDefault: 15,
      moqUnits: 100,
    },
    plannedSalesBySku: {
      "SKU-3": { "2025-04": 300, "2025-05": 310 },
    },
    closingStockBySku: {
      "SKU-3": { "2025-04": 100, "2025-05": 50 },
    },
  });

  assert.strictEqual(result.suggestedUnits, 100);
  assert.ok(result.warnings.some(warning => warning.includes("MOQ applied")));
});

test("missing forecast uses fallback daily rate and reports status", () => {
  const result = computeFoSuggestion({
    sku: "SKU-4",
    today: "2025-04-10",
    policyDefaults: baseDefaults,
    plannedSalesBySku: { "SKU-4": { "2025-03": 310 } },
    closingStockBySku: { "SKU-4": { "2025-04": 100 } },
  });

  assert.strictEqual(result.status, "insufficient_forecast");
  assert.ok(result.warnings.some(warning => warning.includes("Forecast missing")));
});

test("missing snapshot returns low confidence and demand-only suggestion", () => {
  const result = computeFoSuggestion({
    sku: "SKU-5",
    today: "2025-04-10",
    policyDefaults: baseDefaults,
    plannedSalesBySku: { "SKU-5": { "2025-04": 300 } },
    closingStockBySku: { "SKU-5": {} },
  });

  assert.strictEqual(result.status, "insufficient_inventory_snapshot");
  assert.strictEqual(result.confidence, "low");
  assert.strictEqual(result.suggestedUnits, result.rationale.requiredUnits);
});

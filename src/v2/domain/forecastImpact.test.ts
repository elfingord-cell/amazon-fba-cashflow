import test from "node:test";
import assert from "node:assert/strict";
import { computeForecastImpact } from "./forecastImpact.ts";

function createBaseState() {
  return {
    settings: {
      safetyStockDohDefault: 60,
      foCoverageDohDefault: 90,
      defaultBufferDays: 0,
      transportLeadTimesDays: { sea: 45 },
    },
    products: [
      { sku: "SKU-A", alias: "Alpha", status: "active", avgSellingPriceGrossEUR: 1 },
      { sku: "SKU-B", alias: "Beta", status: "active", avgSellingPriceGrossEUR: 1 },
      { sku: "SKU-C", alias: "Gamma", status: "active", avgSellingPriceGrossEUR: 1 },
      { sku: "SKU-S", alias: "Safety", status: "active", avgSellingPriceGrossEUR: 1 },
    ],
    suppliers: [{ id: "SUP-1", name: "Supplier One" }],
    pos: [],
    fos: [],
    forecast: {
      forecastManual: {},
      forecastImport: {},
    },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [
            { sku: "SKU-A", units: 9999 },
            { sku: "SKU-B", units: 9999 },
            { sku: "SKU-C", units: 9999 },
            { sku: "SKU-S", units: 5 },
          ],
        },
      ],
      settings: { projectionMonths: 12, safetyDays: 60 },
    },
  };
}

test("forecast impact flags SKU deltas for next 3 months and returns summary", () => {
  const state = createBaseState();
  const fromVersion = {
    id: "v-old",
    name: "Old",
    forecastImport: {
      "SKU-A": { "2026-02": { units: 70 }, "2026-03": { units: 70 }, "2026-04": { units: 70 } },
      "SKU-B": { "2026-02": { units: 20 }, "2026-03": { units: 20 }, "2026-04": { units: 20 } },
      "SKU-C": { "2026-02": { units: 10 }, "2026-03": { units: 10 }, "2026-04": { units: 10 } },
      "SKU-S": { "2026-02": { units: 2 }, "2026-03": { units: 2 }, "2026-04": { units: 2 } },
    },
  };
  const toVersion = {
    id: "v-new",
    name: "New",
    forecastImport: {
      "SKU-A": { "2026-02": { units: 90 }, "2026-03": { units: 90 }, "2026-04": { units: 90 } },
      "SKU-B": { "2026-02": { units: 55 }, "2026-03": { units: 55 }, "2026-04": { units: 55 } },
      "SKU-C": { "2026-02": { units: 13 }, "2026-03": { units: 13 }, "2026-04": { units: 13 } },
      "SKU-S": { "2026-02": { units: 3 }, "2026-03": { units: 3 }, "2026-04": { units: 3 } },
    },
  };

  const result = computeForecastImpact({
    state,
    fromVersion,
    toVersion,
    nowMonth: "2026-02",
  });

  const bySku = new Map(result.skuRows.map((row) => [row.sku, row]));
  assert.equal((bySku.get("SKU-A")?.flagged), true);
  assert.equal((bySku.get("SKU-B")?.flagged), true);
  assert.equal((bySku.get("SKU-C")?.flagged), true);
  assert.equal(result.summary.flaggedSkus >= 3, true);
  assert.equal(result.summary.toVersionId, "v-new");
  assert.equal(result.summary.fromVersionId, "v-old");
});

test("forecast impact forces conflict on safety risk even when delta is small", () => {
  const state = createBaseState();
  const fromVersion = {
    id: "v1",
    name: "V1",
    forecastImport: {
      "SKU-S": {
        "2026-02": { units: 3 },
        "2026-03": { units: 3 },
        "2026-04": { units: 3 },
      },
    },
  };
  const toVersion = {
    id: "v2",
    name: "V2",
    forecastImport: {
      "SKU-S": {
        "2026-02": { units: 4 },
        "2026-03": { units: 4 },
        "2026-04": { units: 4 },
      },
    },
  };

  const result = computeForecastImpact({
    state,
    fromVersion,
    toVersion,
    nowMonth: "2026-02",
  });

  const skuRow = result.skuRows.find((row) => row.sku === "SKU-S");
  assert.ok(skuRow);
  assert.equal(skuRow.flagged, true);
  assert.equal(skuRow.reasons.includes("safety_risk"), true);
});

test("forecast impact creates FO conflicts for unit and timing deviations", () => {
  const state = createBaseState();
  state.fos = [
    {
      id: "FO-LATE",
      sku: "SKU-A",
      supplierId: "SUP-1",
      status: "ACTIVE",
      units: 10,
      targetDeliveryDate: "2026-07-15",
      productionLeadTimeDays: 20,
      logisticsLeadTimeDays: 35,
      bufferDays: 0,
    },
    {
      id: "FO-EARLY",
      sku: "SKU-A",
      supplierId: "SUP-1",
      status: "ACTIVE",
      units: 5000,
      targetDeliveryDate: "2026-01-10",
      productionLeadTimeDays: 20,
      logisticsLeadTimeDays: 35,
      bufferDays: 0,
    },
  ];

  const fromVersion = {
    id: "v1",
    name: "V1",
    forecastImport: {
      "SKU-A": {
        "2026-02": { units: 80 },
        "2026-03": { units: 80 },
        "2026-04": { units: 80 },
      },
    },
  };
  const toVersion = {
    id: "v2",
    name: "V2",
    forecastImport: {
      "SKU-A": {
        "2026-02": { units: 360 },
        "2026-03": { units: 360 },
        "2026-04": { units: 360 },
      },
    },
  };

  const result = computeForecastImpact({
    state,
    fromVersion,
    toVersion,
    nowMonth: "2026-02",
  });

  const late = result.foConflicts.find((entry) => entry.foId === "FO-LATE");
  const early = result.foConflicts.find((entry) => entry.foId === "FO-EARLY");
  assert.ok(late);
  assert.ok(early);
  assert.equal(late.conflictTypes.includes("units_too_small"), true);
  assert.equal(late.conflictTypes.includes("timing_too_late"), true);
  assert.equal(early.conflictTypes.includes("units_too_large"), true);
  assert.equal(early.conflictTypes.includes("timing_too_early"), true);
});

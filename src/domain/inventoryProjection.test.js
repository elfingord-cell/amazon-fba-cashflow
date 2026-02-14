import test from "node:test";
import assert from "node:assert/strict";

import {
  computeInventoryProjection,
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

test("projection resolves latest snapshot fallback and exposes PO/FO inbound details", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [
            { sku: "SKU-A", amazonUnits: 120, threePLUnits: 30 },
          ],
        },
      ],
    },
    forecast: {
      forecastManual: {
        "SKU-A": {
          "2026-02": 50,
        },
      },
    },
    pos: [
      {
        id: "po-1",
        poNo: "260001",
        sku: "SKU-A",
        units: 200,
        etaManual: "2026-02-18",
      },
    ],
    fos: [
      {
        id: "fo-1",
        sku: "SKU-A",
        units: 40,
        targetDeliveryDate: "2026-02-05",
        status: "PLANNED",
      },
    ],
    products: [
      { sku: "SKU-A", status: "active" },
    ],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-02"],
    products: state.products,
    snapshot: null,
    snapshotMonth: "2026-03",
  });

  assert.strictEqual(projection.resolvedSnapshotMonth, "2026-01");
  assert.strictEqual(projection.snapshotFallbackUsed, true);
  assert.strictEqual(projection.inboundUnitsMap.get("SKU-A").get("2026-02"), 240);

  const inbound = projection.inboundDetailsMap.get("SKU-A").get("2026-02");
  assert.equal(inbound.poUnits, 200);
  assert.equal(inbound.foUnits, 40);
  assert.equal(inbound.totalUnits, 240);
  assert.equal(inbound.poItems[0].ref, "260001");
  assert.equal(inbound.foItems[0].id, "fo-1");
});

test("running-month anchor rolls forward from previous snapshot", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", amazonUnits: 100, threePLUnits: 20 }],
        },
      ],
    },
    forecast: {
      forecastManual: {
        "SKU-A": {
          "2026-02": 40,
          "2026-03": 30,
        },
      },
    },
    fos: [
      {
        id: "fo-1",
        sku: "SKU-A",
        units: 10,
        targetDeliveryDate: "2026-02-12",
        status: "PLANNED",
      },
    ],
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-03"],
    products: state.products,
    snapshotMonth: "2026-02",
  });

  assert.equal(projection.anchorMonth, "2026-02");
  assert.equal(projection.anchorSourceMonth, "2026-01");
  assert.equal(projection.anchorMode, "rollforward");
  assert.equal(projection.startAvailableBySku.get("SKU-A"), 90);
});

test("anchor rollforward spans multiple months and keeps arithmetic stable", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", amazonUnits: 150, threePLUnits: 0 }],
        },
      ],
    },
    forecast: {
      forecastManual: {
        "SKU-A": {
          "2026-02": 25,
          "2026-03": 30,
          "2026-04": 35,
        },
      },
    },
    pos: [
      {
        id: "po-1",
        sku: "SKU-A",
        units: 20,
        etaManual: "2026-03-10",
      },
    ],
    fos: [
      {
        id: "fo-1",
        sku: "SKU-A",
        units: 8,
        targetDeliveryDate: "2026-04-03",
        status: "PLANNED",
      },
    ],
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-05"],
    products: state.products,
    snapshotMonth: "2026-04",
  });

  // 150 - 25 + 20 - 30 + 8 - 35 = 88
  assert.equal(projection.startAvailableBySku.get("SKU-A"), 88);
  assert.equal(projection.anchorMonth, "2026-04");
  assert.equal(projection.anchorMode, "rollforward");
});

test("missing forecast during anchor rollforward subtracts 0 and marks warning", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", amazonUnits: 90, threePLUnits: 0 }],
        },
      ],
    },
    forecast: { forecastManual: {} },
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-03"],
    products: state.products,
    snapshotMonth: "2026-02",
  });

  assert.equal(projection.startAvailableBySku.get("SKU-A"), 90);
  assert.deepEqual(projection.anchorForecastGapSkus, ["SKU-A"]);
});

test("legacy snapshot units fallback is used when split fields are missing", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", units: 77 }],
        },
      ],
    },
    forecast: { forecastManual: { "SKU-A": { "2026-02": 10 } } },
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-02"],
    products: state.products,
    snapshotMonth: "2026-01",
  });

  assert.equal(projection.startAvailableBySku.get("SKU-A"), 77);
});

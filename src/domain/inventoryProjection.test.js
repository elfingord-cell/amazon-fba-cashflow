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
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 0, safetyDays: 60, daysToOos: 15 }), "safety-negative");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: -4, safetyDays: 60, daysToOos: 15 }), "safety-negative");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 5, safetyDays: 60, daysToOos: 59 }), "safety-low");
  assert.strictEqual(getProjectionSafetyClass({ endAvailable: 5, safetyDays: 60, daysToOos: 60 }), "");
});

test("defaults apply in DOH mode and trigger by days-to-oos threshold", () => {
  const product = {};
  const state = { settings: { safetyStockDohDefault: 60, foCoverageDohDefault: 90 } };

  assert.strictEqual(resolveSafetyStockDays(product, state), 60);
  assert.strictEqual(resolveCoverageDays(product, state), 90);
  assert.strictEqual(
    getProjectionSafetyClass({ projectionMode: "doh", doh: 120, safetyDays: 60, daysToOos: 45 }),
    "safety-low",
  );
});

test("under-safety trigger follows days-to-oos threshold with constant demand", () => {
  const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-C", units: 180 }],
        },
      ],
    },
    forecast: {
      forecastManual: {
        "SKU-C": {
          "2026-02": 30,
          "2026-03": 30,
          "2026-04": 30,
          "2026-05": 30,
          "2026-06": 30,
          "2026-07": 30,
          "2026-08": 30,
        },
      },
    },
    products: [{ sku: "SKU-C", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months,
    products: state.products,
    snapshotMonth: "2026-01",
  });
  const sku = projection.perSkuMonth.get("SKU-C");
  assert.ok(sku);

  const firstLowMonth = months.find((month) => {
    const row = sku.get(month);
    const riskClass = getProjectionSafetyClass({
      projectionMode: "units",
      endAvailable: row?.endAvailable,
      safetyUnits: row?.safetyUnits,
      doh: row?.doh,
      safetyDays: row?.safetyDays,
      daysToOos: row?.daysToOos,
    });
    return riskClass === "safety-low";
  });

  assert.equal(firstLowMonth, "2026-06");
  assert.equal(sku.get("2026-05").daysToOos >= 60, true);
  assert.equal(sku.get("2026-06").daysToOos < 60, true);
});

test("seasonal peak does not trigger under-safety long before oos window", () => {
  const months = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"];
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-07",
          items: [{ sku: "OBERROHRTASCHE", units: 288 }],
        },
      ],
    },
    forecast: {
      forecastManual: {
        OBERROHRTASCHE: {
          "2026-08": 171,
          "2026-09": 20,
          "2026-10": 20,
          "2026-11": 20,
          "2026-12": 20,
          "2027-01": 20,
          "2027-02": 40,
        },
      },
    },
    products: [{ sku: "OBERROHRTASCHE", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months,
    products: state.products,
    snapshotMonth: "2026-07",
  });
  const sku = projection.perSkuMonth.get("OBERROHRTASCHE");
  assert.ok(sku);

  const firstLowMonth = months.find((month) => {
    const row = sku.get(month);
    const riskClass = getProjectionSafetyClass({
      projectionMode: "units",
      endAvailable: row?.endAvailable,
      safetyUnits: row?.safetyUnits,
      doh: row?.doh,
      safetyDays: row?.safetyDays,
      daysToOos: row?.daysToOos,
    });
    return riskClass === "safety-low";
  });

  assert.equal(firstLowMonth, "2026-12");
  assert.equal(getProjectionSafetyClass({
    projectionMode: "units",
    endAvailable: sku.get("2026-08")?.endAvailable,
    safetyUnits: sku.get("2026-08")?.safetyUnits,
    doh: sku.get("2026-08")?.doh,
    safetyDays: sku.get("2026-08")?.safetyDays,
    daysToOos: sku.get("2026-08")?.daysToOos,
  }), "");
  assert.equal(getProjectionSafetyClass({
    projectionMode: "units",
    endAvailable: sku.get("2026-12")?.endAvailable,
    safetyUnits: sku.get("2026-12")?.safetyUnits,
    doh: sku.get("2026-12")?.doh,
    safetyDays: sku.get("2026-12")?.safetyDays,
    daysToOos: sku.get("2026-12")?.daysToOos,
  }), "safety-low");
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
  assert.strictEqual(projection.anchorTargetMonth, "2026-01");
  assert.deepEqual(projection.months, ["2026-02"]);
  assert.strictEqual(projection.snapshotFallbackUsed, true);
  assert.strictEqual(projection.inboundUnitsMap.get("SKU-A").get("2026-02"), 240);

  const inbound = projection.inboundDetailsMap.get("SKU-A").get("2026-02");
  assert.equal(inbound.poUnits, 200);
  assert.equal(inbound.foUnits, 40);
  assert.equal(inbound.totalUnits, 240);
  assert.equal(inbound.poItems[0].ref, "260001");
  assert.equal(inbound.foItems[0].id, "fo-1");
});

test("projection counts only active FO statuses for inbound planning", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", amazonUnits: 100, threePLUnits: 0 }],
        },
      ],
    },
    forecast: { forecastManual: { "SKU-A": { "2026-02": 10 } } },
    fos: [
      { id: "fo-active", sku: "SKU-A", units: 20, targetDeliveryDate: "2026-02-02", status: "ACTIVE" },
      { id: "fo-planned", sku: "SKU-A", units: 30, targetDeliveryDate: "2026-02-12", status: "PLANNED" },
      { id: "fo-converted", sku: "SKU-A", units: 40, targetDeliveryDate: "2026-02-18", status: "CONVERTED" },
      { id: "fo-archived", sku: "SKU-A", units: 50, targetDeliveryDate: "2026-02-24", status: "ARCHIVED" },
    ],
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-02"],
    products: state.products,
    snapshotMonth: "2026-01",
  });

  assert.strictEqual(projection.inboundUnitsMap.get("SKU-A").get("2026-02"), 50);
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
  assert.equal(projection.anchorTargetMonth, "2026-02");
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
  assert.equal(projection.anchorTargetMonth, "2026-04");
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

test("sku missing in anchor snapshot falls back to latest sku-specific snapshot", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2025-12",
          items: [{ sku: "SKU-A", amazonUnits: 80, threePLUnits: 0 }],
        },
        {
          month: "2026-01",
          items: [{ sku: "SKU-B", amazonUnits: 50, threePLUnits: 0 }],
        },
      ],
    },
    forecast: {
      forecastManual: {
        "SKU-A": {
          "2026-01": 10,
          "2026-02": 12,
        },
      },
    },
    products: [{ sku: "SKU-A", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-02"],
    products: state.products,
    snapshotMonth: "2026-01",
  });

  assert.equal(projection.anchorTargetMonth, "2026-01");
  assert.equal(projection.startAvailableBySku.get("SKU-A"), 70);
  assert.equal(projection.anchorSkuFallbackCount, 1);
  assert.deepEqual(projection.anchorSkuFallbackSkus, ["SKU-A"]);
  assert.deepEqual(projection.anchorSkuMissingHistory, []);
});

test("sku without any snapshot history is marked and starts with zero anchor", () => {
  const state = {
    settings: { safetyStockDohDefault: 60 },
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          items: [{ sku: "SKU-A", amazonUnits: 100, threePLUnits: 0 }],
        },
      ],
    },
    forecast: { forecastManual: {} },
    products: [{ sku: "SKU-Z", status: "active" }],
  };

  const projection = computeInventoryProjection({
    state,
    months: ["2026-02"],
    products: state.products,
    snapshotMonth: "2026-01",
  });

  assert.equal(projection.startAvailableBySku.get("SKU-Z"), 0);
  assert.equal(projection.anchorSkuFallbackCount, 0);
  assert.deepEqual(projection.anchorSkuMissingHistory, ["SKU-Z"]);
});

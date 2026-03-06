const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

let server;
let buildMonthPlanningResult;
let currentMonthKey;
let addMonths;
let monthRange;

function baseSettings(overrides = {}) {
  return {
    startMonth: currentMonthKey(),
    horizonMonths: 6,
    safetyStockDohDefault: 60,
    foCoverageDohDefault: 90,
    fxRate: 1,
    defaultBufferDays: 0,
    transportLeadTimesDays: { sea: 45 },
    vatPreview: { deShareDefault: 1, feeRateDefault: 0.38, fixInputDefault: 0 },
    ...overrides,
  };
}

function makeProduct(sku, input = {}) {
  return {
    sku,
    alias: input.alias || sku,
    status: input.status || "active",
    supplierId: input.supplierId || "sup-1",
    avgSellingPriceGrossEUR: input.avgSellingPriceGrossEUR ?? 20,
    productionLeadTimeDaysDefault: input.productionLeadTimeDaysDefault ?? 20,
    transitDays: input.transitDays ?? 20,
    template: input.template || {
      fields: {
        unitPriceUsd: 1,
        freightEur: 0,
        transportMode: "SEA",
        transitDays: input.transitDays ?? 20,
        productionDays: input.productionLeadTimeDaysDefault ?? 20,
      },
    },
    ...input.extra,
  };
}

function buildState(input = {}) {
  const now = currentMonthKey();
  const previousMonth = addMonths(now, -1);
  const months = monthRange(now, 6);
  return {
    settings: baseSettings(input.settings),
    inventory: {
      snapshots: [
        {
          month: previousMonth,
          items: input.snapshotItems || [],
        },
      ],
      settings: {
        projectionMonths: 6,
        safetyDays: 60,
      },
    },
    forecast: {
      settings: { useForecast: false },
      forecastManual: input.forecastManual || {},
      forecastImport: input.forecastImport || {},
      versions: input.versions || [],
      activeVersionId: input.activeVersionId || null,
      lastImpactSummary: input.lastImpactSummary || null,
      foConflictDecisionsByVersion: input.foConflictDecisionsByVersion || {},
    },
    products: input.products || [],
    suppliers: input.suppliers || [{ id: "sup-1", name: "Supplier 1" }],
    fos: input.fos || [],
    pos: [],
    incomings: input.incomings || months.map((month) => ({ month, revenueEur: 1, payoutPct: 1 })),
    fixcosts: input.fixcosts || [{ id: "fc-1", amount: 1 }],
    vatPreviewMonths: input.vatPreviewMonths || Object.fromEntries(months.map((month) => [month, { deShare: 1 }])),
    monthlyActuals: input.monthlyActuals || {},
  };
}

test.before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    optimizeDeps: {
      noDiscovery: true,
      entries: [],
    },
  });

  ({ buildMonthPlanningResult } = await server.ssrLoadModule("/src/v2/domain/monthPlanning.ts"));
  ({ currentMonthKey, addMonths, monthRange } = await server.ssrLoadModule("/src/v2/domain/months.ts"));
});

test.after(async () => {
  await server.close();
});

test("month planning keeps accepted inventory cases as accepted items and does not introduce state.pfos", async () => {
  const now = currentMonthKey();
  const months = monthRange(now, 6);
  const sku = "SKU-ACCEPT";
  const baseState = buildState({
    snapshotItems: [{ sku, amazonUnits: 220, threePLUnits: 0 }],
    forecastManual: {
      [sku]: Object.fromEntries(months.map((month, index) => [month, index < 4 ? 90 : 30])),
    },
    products: [
      makeProduct(sku, {
        productionLeadTimeDaysDefault: 20,
        transitDays: 25,
        extra: {
          unitPriceUsd: 1,
          moqUnits: 100,
          sellerboardMarginPct: 25,
          incoterm: "FOB",
          ddp: false,
        },
      }),
    ],
  });

  const openResult = buildMonthPlanningResult({ state: baseState, months });
  const openMonth = openResult.months.find((entry) => (
    entry.reviewItems.some((item) => (
      item.status === "open"
      && item.sku === sku
      && (
        item.type === "inventory_order_required"
        || item.type === "inventory_risk_acceptance_required"
        || item.type === "overdue_order_decision"
      )
    ))
  ));
  assert.ok(openMonth, "Es muss mindestens einen Review-Monat mit offenem Inventory-Fall geben.");
  const openItem = openMonth.reviewItems.find((entry) => (
    entry.status === "open"
    && entry.sku === sku
    && (
      entry.type === "inventory_order_required"
      || entry.type === "inventory_risk_acceptance_required"
      || entry.type === "overdue_order_decision"
    )
  ));
  assert.ok(openItem, "Vor der Risiko-Akzeptanz muss ein offener Inventory-Fall vorhanden sein.");

  const acceptedKey = `${sku.toLowerCase()}::${openItem.issueType}::${openItem.impactMonth}`;
  const acceptedState = buildState({
    snapshotItems: [{ sku, amazonUnits: 220, threePLUnits: 0 }],
    forecastManual: {
      [sku]: Object.fromEntries(months.map((month, index) => [month, index < 4 ? 90 : 30])),
    },
    products: [
      makeProduct(sku, {
        productionLeadTimeDaysDefault: 20,
        transitDays: 25,
        extra: {
          unitPriceUsd: 1,
          moqUnits: 100,
          sellerboardMarginPct: 25,
          incoterm: "FOB",
          ddp: false,
        },
      }),
    ],
    settings: {
      phantomFoShortageAcceptBySku: {
        [acceptedKey]: {
          sku,
          reason: openItem.issueType,
          acceptedFromMonth: openItem.impactMonth,
          acceptedUntilMonth: openItem.impactMonth,
          durationMonths: 1,
        },
      },
    },
  });

  const acceptedResult = buildMonthPlanningResult({ state: acceptedState, months });
  const openInventoryCountBefore = openResult.months
    .flatMap((monthEntry) => monthEntry.reviewItems)
    .filter((entry) => (
      entry.status === "open"
      && entry.sku === sku
      && entry.type !== "forecast_conflict_relevant"
    )).length;
  const openInventoryCountAfter = acceptedResult.months
    .flatMap((monthEntry) => monthEntry.reviewItems)
    .filter((entry) => (
      entry.status === "open"
      && entry.sku === sku
      && entry.type !== "forecast_conflict_relevant"
    )).length;
  assert.equal(
    acceptedResult.months.some((monthEntry) => monthEntry.reviewItems.some((entry) => entry.status === "accepted" && entry.sku === sku)),
    true,
    "Akzeptierte Inventory-Fälle müssen als akzeptierte Review-Items sichtbar bleiben.",
  );
  assert.equal(openInventoryCountAfter < openInventoryCountBefore, true, "Risiko-Akzeptanz muss die offenen Inventory-Fälle für dieselbe SKU reduzieren.");
  assert.equal(
    Object.prototype.hasOwnProperty.call(acceptedState, "pfos"),
    false,
    "Die Monatsplanung darf kein persistiertes state.pfos einführen.",
  );
});

test("month planning splits revenue input blockers from master-data blockers", async () => {
  const now = currentMonthKey();
  const months = [now];
  const state = buildState({
    snapshotItems: [],
    forecastManual: {},
    products: [
      makeProduct("SKU-PRICE", {
        avgSellingPriceGrossEUR: 0,
        extra: {
          template: {
            fields: {
              unitPriceUsd: 1,
              freightEur: 0,
              transportMode: "SEA",
              transitDays: 20,
              productionDays: 20,
            },
          },
        },
      }),
      makeProduct("SKU-BLOCKED", {
        avgSellingPriceGrossEUR: 19,
        template: { fields: {} },
      }),
    ],
  });

  const month = buildMonthPlanningResult({ state, months }).monthMap.get(now);
  assert.ok(month, "Der Review-Monat muss berechnet werden.");
  assert.equal(
    month.reviewItems.some((entry) => entry.type === "revenue_input_missing" && entry.sku === "SKU-PRICE"),
    true,
    "Fehlende VK-Preise müssen als revenue_input_missing auftauchen.",
  );
  assert.equal(
    month.reviewItems.some((entry) => entry.type === "master_data_blocking" && entry.sku === "SKU-BLOCKED"),
    true,
    "Geblockte Stammdatenfälle müssen als master_data_blocking auftauchen.",
  );
});

test("month planning maps forecast conflicts into exactly one actionable review month", async () => {
  const now = currentMonthKey();
  const month1 = now;
  const month2 = addMonths(now, 1);
  const month3 = addMonths(now, 2);
  const state = buildState({
    snapshotItems: [{ sku: "SKU-FO", amazonUnits: 40, threePLUnits: 0 }],
    products: [
      makeProduct("SKU-FO", {
        productionLeadTimeDaysDefault: 20,
        transitDays: 35,
        extra: {
          unitPriceUsd: 1,
          moqUnits: 100,
          sellerboardMarginPct: 25,
          incoterm: "FOB",
          ddp: false,
        },
      }),
    ],
    fos: [
      {
        id: "FO-LATE",
        sku: "SKU-FO",
        supplierId: "sup-1",
        status: "ACTIVE",
        units: 10,
        targetDeliveryDate: `${month3}-15`,
        productionLeadTimeDays: 20,
        logisticsLeadTimeDays: 35,
        bufferDays: 0,
      },
    ],
    versions: [
      {
        id: "v1",
        name: "V1",
        forecastImport: {
          "SKU-FO": {
            [month1]: { units: 80 },
            [month2]: { units: 80 },
            [month3]: { units: 80 },
          },
        },
        stats: { rowCount: 3, skuCount: 1, monthCount: 3 },
      },
      {
        id: "v2",
        name: "V2",
        forecastImport: {
          "SKU-FO": {
            [month1]: { units: 320 },
            [month2]: { units: 320 },
            [month3]: { units: 320 },
          },
        },
        stats: { rowCount: 3, skuCount: 1, monthCount: 3 },
      },
    ],
    activeVersionId: "v2",
    lastImpactSummary: {
      fromVersionId: "v1",
      toVersionId: "v2",
    },
  });

  const months = monthRange(now, 4);
  const result = buildMonthPlanningResult({ state, months });
  const monthsWithConflict = result.months.filter((entry) => (
    entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")
  ));

  assert.equal(monthsWithConflict.length, 1, "Ein Forecast-Konflikt darf nur in genau einem Review-Monat landen.");
  assert.equal(monthsWithConflict[0].forecastConflictCount, 1, "Der Zielmonat muss den Forecast-Konflikt zählen.");
  assert.equal(monthsWithConflict[0].robust, false, "Ein offener Forecast-Konflikt darf den Zielmonat nicht robust lassen.");
});

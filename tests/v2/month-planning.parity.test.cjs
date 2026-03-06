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
let isMonthPlanningReadOnly;
let buildMonthPlanningActionSurface;
let buildMonthPlanningSupplyVisualModel;
let buildMonthPlanningConflictBadges;
let updateForecastConflictFo;
let createForecastConflictDraft;
let ignoreForecastConflict;

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

function buildForecastConflictState({ inventoryUnits = 5000 } = {}) {
  const now = currentMonthKey();
  const month1 = now;
  const month2 = addMonths(now, 1);
  const month3 = addMonths(now, 2);
  return buildState({
    snapshotItems: [{ sku: "SKU-FO", amazonUnits: inventoryUnits, threePLUnits: 0 }],
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
  ({ isMonthPlanningReadOnly } = await server.ssrLoadModule("/src/v2/domain/monthPlanning.ts"));
  ({
    buildMonthPlanningActionSurface,
    buildMonthPlanningSupplyVisualModel,
    buildMonthPlanningConflictBadges,
  } = await server.ssrLoadModule("/src/v2/domain/monthPlanningUi.ts"));
  ({
    updateForecastConflictFo,
    createForecastConflictDraft,
    ignoreForecastConflict,
  } = await server.ssrLoadModule("/src/v2/domain/forecastConflictActions.ts"));
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
  const state = buildForecastConflictState({ inventoryUnits: 40 });
  const months = monthRange(now, 4);
  const result = buildMonthPlanningResult({ state, months });
  const monthsWithConflict = result.months.filter((entry) => (
    entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")
  ));

  assert.equal(monthsWithConflict.length, 1, "Ein Forecast-Konflikt darf nur in genau einem Review-Monat landen.");
  assert.equal(monthsWithConflict[0].forecastConflictCount, 1, "Der Zielmonat muss den Forecast-Konflikt zählen.");
  assert.equal(monthsWithConflict[0].robust, false, "Ein offener Forecast-Konflikt darf den Zielmonat nicht robust lassen.");
});

test("month planning action surface is type-specific and labels overdue forecast conflicts clearly", async () => {
  const overdueForecastItem = {
    id: "forecast-overdue",
    type: "forecast_conflict_relevant",
    status: "open",
    severity: "error",
    month: currentMonthKey(),
    impactMonth: currentMonthKey(),
    title: "SKU-FO (SKU-FO)",
    detail: "Bestehende FO passt nicht mehr zum Forecast.",
    route: "/v2/forecast?panel=conflicts",
    sortDate: "2025-12-25",
    overdue: true,
    isOverdue: true,
    actionKind: "forecast_conflict",
    sku: "SKU-FO",
    alias: "SKU-FO",
    foId: "FO-LATE",
    latestOrderDate: "2025-12-25",
    requiredArrivalDate: "2026-04-01",
    recommendedArrivalDate: "2026-04-01",
    suggestedUnits: 420,
    sourceKind: "fo_conflict",
    conflictTypes: ["timing_too_late", "units_too_small"],
  };
  const inventoryItem = {
    id: "inventory-open",
    type: "inventory_order_required",
    status: "open",
    severity: "error",
    month: currentMonthKey(),
    impactMonth: addMonths(currentMonthKey(), 1),
    title: "SKU-ORDER (SKU-ORDER)",
    detail: "Bestellpflicht fällig.",
    route: "/v2/orders/fo",
    sortDate: `${currentMonthKey()}-01`,
    overdue: false,
    isOverdue: false,
    actionKind: "inventory_order",
    sku: "SKU-ORDER",
    alias: "SKU-ORDER",
    issueType: "stock_under_safety",
    latestOrderDate: `${currentMonthKey()}-15`,
    requiredArrivalDate: `${addMonths(currentMonthKey(), 1)}-10`,
    suggestedUnits: 300,
    sourceKind: "coverage",
  };

  const forecastSurface = buildMonthPlanningActionSurface(overdueForecastItem, "2026-03-06");
  const inventorySurface = buildMonthPlanningActionSurface(inventoryItem, "2026-03-06");

  assert.deepEqual(
    forecastSurface.actions.map((entry) => entry.id),
    ["resolve_forecast_conflict", "open_specialist"],
    "Forecast-Konflikte dürfen nur ihre eigenen Auflösungsaktionen zeigen.",
  );
  assert.equal(forecastSurface.dateMeta.label, "Überfällig seit");
  assert.equal(forecastSurface.showSupplyVisual, true);
  assert.deepEqual(
    buildMonthPlanningConflictBadges(overdueForecastItem),
    ["Timing zu spät", "Menge zu klein"],
    "Konflikttypen müssen für Liste und Detailpanel lesbar aufbereitet werden.",
  );

  assert.deepEqual(
    inventorySurface.actions.map((entry) => entry.id),
    ["convert_to_fo", "accept_risk_1", "accept_risk_2", "open_sku_planning"],
    "Inventory-Fälle müssen ihre operativen Standardaktionen behalten.",
  );
  assert.equal(inventorySurface.showSupplyVisual, true);
});

test("month planning supply visual model exposes chart and timeline for supply items", async () => {
  const reviewMonth = currentMonthKey();
  const forecastItem = {
    id: "forecast-visual",
    type: "forecast_conflict_relevant",
    status: "open",
    severity: "error",
    month: reviewMonth,
    impactMonth: reviewMonth,
    title: "SKU-FO (SKU-FO)",
    detail: "Bestehende FO passt nicht mehr zum Forecast.",
    route: "/v2/forecast?panel=conflicts",
    sortDate: "2025-12-25",
    overdue: true,
    isOverdue: true,
    actionKind: "forecast_conflict",
    sku: "SKU-FO",
    alias: "SKU-FO",
    foId: "FO-LATE",
    latestOrderDate: "2025-12-25",
    requiredArrivalDate: `${addMonths(reviewMonth, 1)}-10`,
    recommendedArrivalDate: `${addMonths(reviewMonth, 1)}-04`,
    suggestedUnits: 420,
    currentUnits: 90,
    currentTargetDeliveryDate: `${addMonths(reviewMonth, 1)}-15`,
    currentEtaDate: `${addMonths(reviewMonth, 1)}-18`,
    sourceKind: "fo_conflict",
  };
  const context = {
    firstUnderSafety: reviewMonth,
    firstOos: addMonths(reviewMonth, 1),
    selectedMonth: reviewMonth,
    monthRows: [
      {
        month: reviewMonth,
        projectedUnits: 280,
        inboundUnits: 0,
        poCount: 0,
        foCount: 0,
        daysToOos: 45,
        safetyUnits: 240,
        poItems: [],
        foItems: [],
      },
      {
        month: addMonths(reviewMonth, 1),
        projectedUnits: 120,
        inboundUnits: 90,
        poCount: 1,
        foCount: 1,
        daysToOos: 12,
        safetyUnits: 240,
        poItems: [{ id: "po-1", ref: "PO-1", units: 80, arrivalDate: `${addMonths(reviewMonth, 1)}-05`, arrivalSource: "po" }],
        foItems: [{ id: "FO-LATE", ref: "FO-LATE", units: 90, arrivalDate: `${addMonths(reviewMonth, 1)}-18`, arrivalSource: "fo" }],
      },
      {
        month: addMonths(reviewMonth, 2),
        projectedUnits: -20,
        inboundUnits: 0,
        poCount: 0,
        foCount: 0,
        daysToOos: 0,
        safetyUnits: 240,
        poItems: [],
        foItems: [],
      },
    ],
  };

  const visual = buildMonthPlanningSupplyVisualModel(forecastItem, context);
  const financeSurface = buildMonthPlanningActionSurface({
    id: "cash-in",
    type: "cash_in_missing",
    status: "open",
    severity: "error",
    month: reviewMonth,
    impactMonth: reviewMonth,
    title: "Cash-in Setup fehlt",
    detail: "Cash-in Basis fehlt",
    route: "/v2/abschluss/eingaben",
    sortDate: `${reviewMonth}-01`,
    overdue: false,
    isOverdue: false,
    actionKind: "specialist",
  });

  assert.ok(visual, "Supply-Items müssen ein Visual-Model erzeugen.");
  assert.equal(Array.isArray(visual.timeline.markers), true);
  assert.equal(
    visual.timeline.markers.some((entry) => entry.label === "Überfällig"),
    true,
    "Überfällige Entscheidungen müssen in der Timeline markiert werden.",
  );
  assert.equal(
    visual.timeline.markers.some((entry) => entry.label.includes("Aktuelle FO")),
    true,
    "Forecast-Konflikte müssen die aktuelle konfliktbehaftete FO im Timeline-Strip zeigen.",
  );
  assert.equal(
    visual.timeline.markers.some((entry) => entry.label === "Empfohlene Ankunft"),
    true,
    "Die empfohlene Ankunft muss in der Plausibilisierung sichtbar sein.",
  );
  assert.equal(financeSurface.showSupplyVisual, false, "Finanz-Items dürfen keine Supply-Grafik verlangen.");
});

test("month planning forecast conflict actions reuse the shared mutation path and clear blockers", async () => {
  const months = monthRange(currentMonthKey(), 4);
  const baseState = buildForecastConflictState({ inventoryUnits: 40 });
  const initialResult = buildMonthPlanningResult({ state: baseState, months });
  const conflictMonth = initialResult.months.find((entry) => (
    entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")
  ));
  assert.ok(conflictMonth, "Ein offener Forecast-Konflikt wird für den Test benötigt.");
  const conflictItem = conflictMonth.reviewItems.find((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE");
  assert.ok(conflictItem, "Der Forecast-Konflikt muss als Review-Item vorliegen.");

  const ignoredState = structuredClone(baseState);
  ignoreForecastConflict(ignoredState, conflictItem);
  const ignoredResult = buildMonthPlanningResult({ state: ignoredState, months });
  assert.equal(
    ignoredResult.months.some((entry) => entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")),
    false,
    "Ignorierte Forecast-Konflikte dürfen im Review nicht offen bleiben.",
  );

  const updatedState = structuredClone(baseState);
  updateForecastConflictFo(updatedState, conflictItem);
  const updatedFo = updatedState.fos.find((entry) => entry.id === "FO-LATE");
  assert.ok(updatedFo, "Die betroffene FO muss weiter existieren.");
  assert.equal(updatedFo.units, conflictItem.suggestedUnits, "FO-Update muss die empfohlene Menge übernehmen.");
  assert.equal(updatedFo.forecastConflictState, "reviewed_updated", "Die bestehende FO muss als reviewed_updated markiert werden.");
  const updatedResult = buildMonthPlanningResult({ state: updatedState, months });
  assert.equal(
    updatedResult.months.some((entry) => entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")),
    false,
    "Ein aktualisierter Forecast-Konflikt darf nicht offen bleiben.",
  );

  const draftState = structuredClone(baseState);
  const draftOutcome = createForecastConflictDraft(draftState, conflictItem);
  assert.ok(draftOutcome.draftId, "Die Draft-Aktion muss eine neue FO erzeugen.");
  const createdDraft = draftState.fos.find((entry) => entry.id === draftOutcome.draftId);
  assert.ok(createdDraft, "Die neue Draft-FO muss im State angelegt werden.");
  assert.equal(createdDraft.status, "DRAFT", "Der neue Datensatz muss als Draft angelegt werden.");
  const originalFo = draftState.fos.find((entry) => entry.id === "FO-LATE");
  assert.equal(originalFo.forecastConflictState, "superseded", "Die alte FO muss als superseded markiert werden.");
  const draftResult = buildMonthPlanningResult({ state: draftState, months });
  assert.equal(
    draftResult.months.some((entry) => entry.reviewItems.some((item) => item.type === "forecast_conflict_relevant" && item.foId === "FO-LATE")),
    false,
    "Eine per Draft abgeleitete Konflikt-FO darf nicht offen bleiben.",
  );
});

test("month planning marks past and closed months as read only", async () => {
  const now = currentMonthKey();
  const previous = addMonths(now, -1);
  const openState = buildState();
  const closedState = buildState({
    monthlyActuals: {
      [now]: {
        realRevenueEUR: 1000,
        realPayoutRatePct: 100,
        realClosingBalanceEUR: 500,
      },
    },
  });

  assert.equal(isMonthPlanningReadOnly(openState, previous), true, "Vergangene Review-Monate müssen read only sein.");
  assert.equal(isMonthPlanningReadOnly(openState, now), false, "Der aktuelle Monat darf offen bleiben.");
  assert.equal(isMonthPlanningReadOnly(closedState, now), true, "Geschlossene Monate müssen read only sein.");
});

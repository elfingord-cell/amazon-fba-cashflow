const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

let server;
let buildPhantomFoSuggestions;
let buildPhantomFoWorklist;
let buildStateWithPhantomFos;
let buildDashboardRobustness;
let currentMonthKey;
let addMonths;
let monthRange;

function localTodayIso() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function baseSettings(overrides = {}) {
  return {
    safetyStockDohDefault: 60,
    foCoverageDohDefault: 90,
    fxRate: 1,
    vatRefundLagMonths: 0,
    paymentDueDefaults: {},
    ...overrides,
  };
}

function makeProduct(sku, input = {}) {
  return {
    sku,
    alias: input.alias || sku,
    status: "active",
    supplierId: "sup-1",
    productionLeadTimeDaysDefault: input.productionLeadTimeDaysDefault ?? 10,
    transitDays: input.transitDays ?? 10,
    avgSellingPriceGrossEUR: input.avgSellingPriceGrossEUR ?? 20,
    template: {
      fields: {
        unitPriceUsd: 1,
        freightEur: 0,
        transportMode: "SEA",
        transitDays: input.transitDays ?? 10,
        productionDays: input.productionLeadTimeDaysDefault ?? 10,
      },
    },
    ...input.extra,
  };
}

function buildState(input) {
  const now = currentMonthKey();
  const previousMonth = addMonths(now, -1);
  const settings = {
    ...baseSettings(input.settings),
  };
  if (input.acceptances) {
    settings.phantomFoShortageAcceptBySku = input.acceptances;
  }
  if (input.decisions) {
    settings.phantomFoWorklistDecisionById = input.decisions;
  }
  return {
    settings,
    inventory: {
      snapshots: [
        {
          month: previousMonth,
          items: input.snapshotItems,
        },
      ],
    },
    forecast: {
      forecastManual: input.forecastManual,
    },
    products: input.products,
    suppliers: [{ id: "sup-1", name: "Supplier 1" }],
    pos: [],
    fos: [],
    incomings: Array.isArray(input.incomings) ? input.incomings : [],
    fixcosts: Array.isArray(input.fixcosts) ? input.fixcosts : [],
    vatPreviewMonths: input.vatPreviewMonths || {},
    monthlyActuals: {},
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

  ({
    buildPhantomFoSuggestions,
    buildPhantomFoWorklist,
    buildStateWithPhantomFos,
  } = await server.ssrLoadModule("/src/v2/domain/phantomFo.ts"));
  ({
    buildDashboardRobustness,
  } = await server.ssrLoadModule("/src/v2/domain/dashboardRobustness.ts"));
  ({
    currentMonthKey,
    addMonths,
    monthRange,
  } = await server.ssrLoadModule("/src/v2/domain/months.ts"));
});

test.after(async () => {
  await server.close();
});

test("shared PFO source keeps overdue PFOs visible", async () => {
  const now = currentMonthKey();
  const months = monthRange(now, 12);
  const sku = "SKU-OVERDUE";
  const state = buildState({
    snapshotItems: [{ sku, amazonUnits: 220, threePLUnits: 0 }],
    forecastManual: {
      [sku]: Object.fromEntries(months.map((month, index) => [month, index < 6 ? 80 : 20])),
    },
    products: [
      makeProduct(sku, {
        productionLeadTimeDaysDefault: 20,
        transitDays: 25,
      }),
    ],
  });

  const suggestions = buildPhantomFoSuggestions({ state, months });
  const overdueSuggestions = suggestions.filter((entry) => entry.overdue);

  assert.ok(overdueSuggestions.length >= 1, "Offene überfällige PFOs dürfen nicht verschwinden.");
  assert.equal(overdueSuggestions[0].sku, sku);
  assert.equal(overdueSuggestions[0].overdue, true);
  assert.ok(
    String(overdueSuggestions[0].recommendedOrderDate || overdueSuggestions[0].latestOrderDate || "") < localTodayIso(),
    "Der Testfall muss ein Bestelldatum in der Vergangenheit haben.",
  );
});

test("overdue PFOs stay chain-relevant and unlock later follow-up PFOs", async () => {
  const now = currentMonthKey();
  const months = monthRange(now, 12);
  const sku = "SKU-CHAIN";
  const state = buildState({
    snapshotItems: [{ sku, amazonUnits: 160, threePLUnits: 0 }],
    forecastManual: {
      [sku]: Object.fromEntries([
        [months[0], 120],
        [months[1], 40],
        [months[2], 60],
        [months[3], 30],
        [months[4], 10],
        [months[5], 10],
        [months[6], 260],
        [months[7], 260],
        [months[8], 100],
        [months[9], 100],
        [months[10], 100],
        [months[11], 140],
      ]),
    },
    products: [
      makeProduct(sku, {
        productionLeadTimeDaysDefault: 80,
        transitDays: 40,
      }),
    ],
  });

  const suggestions = buildPhantomFoSuggestions({ state, months });
  const [firstSuggestion] = suggestions;

  assert.ok(firstSuggestion, "Der Testfall braucht mindestens einen offenen PFO.");
  assert.equal(firstSuggestion.overdue, true, "Der erste Ketten-PFO muss überfällig sein.");
  assert.ok(suggestions.length >= 2, "Der Testfall muss mindestens einen späteren Folge-PFO erzeugen.");

  const chainedState = buildStateWithPhantomFos({
    state,
    suggestions: [firstSuggestion],
  });
  const chainedFoIds = new Set(
    (Array.isArray(chainedState.fos) ? chainedState.fos : [])
      .map((entry) => String((entry || {}).id || "")),
  );
  assert.equal(
    chainedFoIds.has(firstSuggestion.id),
    true,
    "Ein überfälliger offener PFO muss in den hypothetischen FO-State übernommen werden.",
  );

  const followUpSuggestions = buildPhantomFoSuggestions({ state: chainedState, months });
  assert.equal(
    followUpSuggestions.some((entry) => entry.id === firstSuggestion.id),
    false,
    "Ein bereits eingespielter PFO darf nicht erneut als offener PFO vorgeschlagen werden.",
  );
  assert.equal(
    followUpSuggestions.some((entry) => entry.firstRiskMonth > firstSuggestion.firstRiskMonth),
    true,
    "Nach Einspielung des überfälligen PFOs müssen spätere Folge-PFOs im Horizont sichtbar werden.",
  );
});

test("PFO worklist uses the shared source, filters to the next six order months, and hides converted PFOs", async () => {
  const now = currentMonthKey();
  const months = monthRange(now, 12);
  const overdueSku = "SKU-OVERDUE";
  const worklistSku = "SKU-WORKLIST";
  const state = buildState({
    snapshotItems: [
      { sku: overdueSku, amazonUnits: 220, threePLUnits: 0 },
      { sku: worklistSku, amazonUnits: 420, threePLUnits: 0 },
    ],
    forecastManual: {
      [overdueSku]: Object.fromEntries(months.map((month, index) => [month, index < 6 ? 80 : 20])),
      [worklistSku]: Object.fromEntries(months.map((month, index) => [month, index < 6 ? 80 : 20])),
    },
    products: [
      makeProduct(overdueSku, {
        productionLeadTimeDaysDefault: 20,
        transitDays: 25,
      }),
      makeProduct(worklistSku, {
        productionLeadTimeDaysDefault: 10,
        transitDays: 10,
      }),
    ],
  });

  const suggestions = buildPhantomFoSuggestions({ state, months });
  const worklistSuggestions = suggestions.filter((entry) => entry.sku === worklistSku);
  assert.equal(worklistSuggestions.length, 1, "Der Worklist-Test braucht genau einen offenen PFO im 6-Monatsfenster.");

  const worklist = buildPhantomFoWorklist({
    state,
    baseMonth: now,
    windowMonths: 6,
    months,
  });

  assert.equal(
    worklist.some((entry) => entry.sku === overdueSku && entry.overdue),
    true,
    "Überfällige offene PFOs müssen als Ausnahme in der Arbeitsliste sichtbar bleiben.",
  );
  assert.deepEqual(
    Array.from(new Set(worklist.map((entry) => entry.sku))),
    [overdueSku, worklistSku],
    "Die Arbeitsliste zeigt das 6-Monatsfenster plus überfällige offene PFOs.",
  );
  assert.equal(
    worklist.every((entry) => (
      entry.overdue === true
      || (entry.orderMonth >= now && entry.orderMonth <= addMonths(now, 5))
    )),
    true,
    "Nicht-überfällige Worklist-PFOs müssen im aktuellen 6-Monatsfenster liegen.",
  );

  const openWorklistSuggestion = worklistSuggestions[0];
  const resolvedState = buildState({
    snapshotItems: [
      { sku: overdueSku, amazonUnits: 220, threePLUnits: 0 },
      { sku: worklistSku, amazonUnits: 420, threePLUnits: 0 },
    ],
    forecastManual: state.forecast.forecastManual,
    products: state.products,
    decisions: {
      [openWorklistSuggestion.id]: {
        id: openWorklistSuggestion.id,
        sku: openWorklistSuggestion.sku,
        issueType: openWorklistSuggestion.issueType,
        firstRiskMonth: openWorklistSuggestion.firstRiskMonth,
        orderMonth: openWorklistSuggestion.orderMonth,
        decision: "fo_converted",
        decidedAt: "2026-03-05T10:00:00.000Z",
        source: "inventory_pfo_worklist",
      },
    },
  });

  const resolvedSuggestions = buildPhantomFoSuggestions({ state: resolvedState, months });
  const resolvedWorklist = buildPhantomFoWorklist({
    state: resolvedState,
    baseMonth: now,
    windowMonths: 6,
    months,
  });

  assert.equal(
    resolvedSuggestions.some((entry) => entry.id === openWorklistSuggestion.id),
    false,
    "Ein in FO umgewandelter PFO darf nicht als offener PFO zurückkommen.",
  );
  assert.equal(
    resolvedWorklist.some((entry) => entry.key === openWorklistSuggestion.id),
    false,
    "Ein in FO umgewandelter PFO darf nicht in der PFO-Arbeitsliste bleiben.",
  );
});

test("accepted shortage risk removes the open PFO and clears the matching robustness blocker", async () => {
  const now = currentMonthKey();
  const months = monthRange(now, 12);
  const sku = "SKU-WORKLIST";
  const forecastManual = {
    [sku]: Object.fromEntries(months.map((month, index) => [month, index < 6 ? 80 : 20])),
  };
  const product = makeProduct(sku, {
    productionLeadTimeDaysDefault: 10,
    transitDays: 10,
  });
  const baseState = buildState({
    settings: {
      vatPreview: { deShareDefault: 1 },
    },
    snapshotItems: [{ sku, amazonUnits: 420, threePLUnits: 0 }],
    forecastManual,
    products: [product],
    incomings: months.map((month) => ({ month, revenueEur: 1, payoutPct: 1 })),
    fixcosts: [{ id: "fc-1", amount: 1 }],
    vatPreviewMonths: Object.fromEntries(months.map((month) => [month, { deShare: 1 }])),
  });

  const [openSuggestion] = buildPhantomFoSuggestions({ state: baseState, months });
  assert.ok(openSuggestion, "Der Testfall braucht einen offenen PFO vor der Risiko-Akzeptanz.");

  const acceptedKey = `${sku.toLowerCase()}::${openSuggestion.issueType}::${openSuggestion.firstRiskMonth}`;
  const acceptedState = buildState({
    settings: {
      vatPreview: { deShareDefault: 1 },
    },
    snapshotItems: [{ sku, amazonUnits: 420, threePLUnits: 0 }],
    forecastManual,
    products: [product],
    incomings: months.map((month) => ({ month, revenueEur: 1, payoutPct: 1 })),
    fixcosts: [{ id: "fc-1", amount: 1 }],
    vatPreviewMonths: Object.fromEntries(months.map((month) => [month, { deShare: 1 }])),
    acceptances: {
      [acceptedKey]: {
        sku,
        reason: openSuggestion.issueType,
        acceptedFromMonth: openSuggestion.firstRiskMonth,
        acceptedUntilMonth: openSuggestion.firstRiskMonth,
        durationMonths: 1,
      },
    },
  });

  const acceptedSuggestions = buildPhantomFoSuggestions({ state: acceptedState, months });
  const robustness = buildDashboardRobustness({ state: acceptedState, months });
  const acceptedMonth = robustness.monthMap.get(openSuggestion.firstRiskMonth);

  assert.equal(
    acceptedSuggestions.some((entry) => entry.id === openSuggestion.id),
    false,
    "Ein akzeptierter PFO darf nicht weiter als offener PFO angezeigt werden.",
  );
  assert.ok(acceptedMonth, "Der Risikomonat muss in der Robustheitsauswertung vorhanden sein.");
  assert.equal(
    acceptedMonth.coverage.orderDutyIssueCount,
    0,
    "Akzeptiertes Risiko darf im Risikomonat keine offene Bestellpflicht mehr blockieren.",
  );
  assert.equal(
    acceptedMonth.blockers.some((entry) => (
      entry.issueType === "order_duty"
      || entry.issueType === "stock_oos"
      || entry.issueType === "stock_under_safety"
    )),
    false,
    "Akzeptiertes Risiko darf keine Bestands-/Bestellpflicht-Blocker für diesen Monat mehr erzeugen.",
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
};

function resetStorage() {
  store.clear();
}

function createFixcostState(overrides = {}) {
  return {
    settings: {
      startMonth: "2026-01",
      horizonMonths: 6,
      openingBalance: 10000,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
      ...(overrides.settings || {}),
    },
    forecast: { settings: { useForecast: false } },
    incomings: overrides.incomings || [
      { id: "inc-jan", month: "2026-01", revenueEur: 1000, payoutPct: 50, source: "manual" },
      { id: "inc-feb", month: "2026-02", revenueEur: 1000, payoutPct: 50, source: "manual" },
      { id: "inc-mar", month: "2026-03", revenueEur: 1000, payoutPct: 50, source: "manual" },
    ],
    fixcosts: overrides.fixcosts || [
      {
        id: "fc-rent",
        name: "Rent",
        category: "Ops",
        amount: "130,00",
        frequency: "monthly",
        anchor: "LAST",
        startMonth: "2026-01",
        proration: { enabled: false, method: "none" },
      },
    ],
    fixcostOverrides: overrides.fixcostOverrides || {},
    status: overrides.status || { autoManualCheck: false, events: {} },
    monthlyActuals: overrides.monthlyActuals || {},
  };
}

let server;
let buildFixcostComparisonSnapshot;
let buildPlannedFixcostByMonth;
let normalizeFixcostActualInputValue;
let buildDashboardPnlRowsByMonth;
let computeSeries;
let createEmptyState;
let loadState;
let saveState;

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
    buildFixcostComparisonSnapshot,
    buildPlannedFixcostByMonth,
    normalizeFixcostActualInputValue,
  } = await server.ssrLoadModule("/src/v2/domain/sollIstFixcost.ts"));
  ({ buildDashboardPnlRowsByMonth } = await server.ssrLoadModule("/src/v2/domain/dashboardMaturity.ts"));
  ({ computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js"));
  ({ createEmptyState, loadState, saveState } = await server.ssrLoadModule("/src/data/storageLocal.js"));
});

test.after(async () => {
  await server.close();
});

test.beforeEach(() => {
  resetStorage();
  saveState(createEmptyState());
});

test("soll-ist fixkosten persists the monthly real field and exposes it in the comparison model", () => {
  const base = createEmptyState();
  base.monthlyActuals = {
    "2026-03": { realFixkostenEUR: 275.5 },
  };
  saveState(base);

  const loaded = loadState();
  assert.equal(loaded.monthlyActuals["2026-03"].realFixkostenEUR, 275.5);

  const snapshot = buildFixcostComparisonSnapshot({
    months: ["2026-03"],
    plannedByMonth: { "2026-03": 300 },
    monthlyActuals: loaded.monthlyActuals,
    selectedMonth: "2026-03",
  });

  assert.equal(snapshot.currentMonth?.actual, 275.5);
  assert.equal(snapshot.currentMonth?.status, "erfasst");
});

test("soll-ist fixkosten treats empty as offen and zero as erfasst", () => {
  const snapshot = buildFixcostComparisonSnapshot({
    months: ["2026-01", "2026-02"],
    plannedByMonth: {
      "2026-01": 120,
      "2026-02": 120,
    },
    monthlyActuals: {
      "2026-02": { realFixkostenEUR: 0 },
    },
    selectedMonth: "2026-02",
  });

  const january = snapshot.rows.find((row) => row.month === "2026-01");
  const february = snapshot.rows.find((row) => row.month === "2026-02");
  assert.equal(january?.actual, null);
  assert.equal(january?.status, "offen");
  assert.equal(january?.delta, null);
  assert.equal(february?.actual, 0);
  assert.equal(february?.status, "erfasst");
  assert.equal(february?.delta, 120);
});

test("soll-ist fixkosten keeps empty input distinct from zero", () => {
  assert.equal(normalizeFixcostActualInputValue(""), null);
  assert.equal(normalizeFixcostActualInputValue(null), null);
  assert.equal(normalizeFixcostActualInputValue(undefined), null);
  assert.equal(normalizeFixcostActualInputValue(0), 0);
});

test("soll-ist fixkosten monthly delta is calculated as soll minus ist", () => {
  const snapshot = buildFixcostComparisonSnapshot({
    months: ["2026-03"],
    plannedByMonth: { "2026-03": 300 },
    monthlyActuals: {
      "2026-03": { realFixkostenEUR: 420 },
    },
    selectedMonth: "2026-03",
  });

  assert.equal(snapshot.currentMonth?.planned, 300);
  assert.equal(snapshot.currentMonth?.actual, 420);
  assert.equal(snapshot.currentMonth?.delta, -120);
  assert.equal(snapshot.currentMonth?.deltaPct, -40);
});

test("soll-ist fixkosten accumulates YTD with delta YTD as soll minus ist", () => {
  const snapshot = buildFixcostComparisonSnapshot({
    months: ["2026-01", "2026-02", "2026-03"],
    plannedByMonth: {
      "2026-01": 100,
      "2026-02": 120,
      "2026-03": 150,
    },
    monthlyActuals: {
      "2026-01": { realFixkostenEUR: 90 },
      "2026-03": { realFixkostenEUR: 160 },
    },
    selectedMonth: "2026-03",
  });

  assert.deepEqual(snapshot.ytd.months, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(snapshot.ytd.planned, 370);
  assert.equal(snapshot.ytd.actual, 250);
  assert.equal(snapshot.ytd.delta, 120);
  assert.equal(snapshot.ytd.deltaPct, 32.43);
});

test("soll-ist fixkosten keeps plan on the fixkosten path and actual only on realFixkostenEUR", () => {
  const state = createFixcostState({
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
    },
    fixcosts: [
      {
        id: "fc-mar",
        name: "Tooling",
        category: "Ops",
        amount: "130,00",
        frequency: "monthly",
        anchor: "LAST",
        startMonth: "2026-03",
        proration: { enabled: false, method: "none" },
      },
    ],
    status: {
      autoManualCheck: false,
      events: {
        "fix-fc-mar-2026-03": {
          paid: true,
          updatedAt: "2026-03-31T00:00:00.000Z",
        },
      },
    },
  });

  const report = computeSeries(state);
  const plannedByMonth = buildPlannedFixcostByMonth(
    buildDashboardPnlRowsByMonth({
      breakdown: report.breakdown,
      state,
    }),
  );

  const withoutActual = buildFixcostComparisonSnapshot({
    months: ["2026-03"],
    plannedByMonth,
    monthlyActuals: {},
    selectedMonth: "2026-03",
  });
  assert.equal(plannedByMonth["2026-03"], 130);
  assert.equal(withoutActual.currentMonth?.actual, null);
  assert.equal(withoutActual.currentMonth?.status, "offen");

  const withActual = buildFixcostComparisonSnapshot({
    months: ["2026-03"],
    plannedByMonth,
    monthlyActuals: {
      "2026-03": { realFixkostenEUR: 95 },
    },
    selectedMonth: "2026-03",
  });
  assert.equal(withActual.currentMonth?.planned, 130);
  assert.equal(withActual.currentMonth?.actual, 95);
  assert.equal(withActual.currentMonth?.delta, 35);
});

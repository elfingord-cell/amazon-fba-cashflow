const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

let server;
let buildDemoState;
let buildSharedPlanProductProjection;
let buildPhantomFoSuggestions;
let buildStateWithPhantomFos;
let computeSeries;
let PORTFOLIO_BUCKET;

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + Number(offset || 0), 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonths(startMonth, horizonMonths) {
  const count = Math.max(1, Math.round(Number(horizonMonths || 1)));
  return Array.from({ length: count }, (_, index) => addMonths(startMonth, index));
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

  ({ buildDemoState } = await server.ssrLoadModule("/src/ui/debug.js"));
  ({ buildSharedPlanProductProjection } = await server.ssrLoadModule("/src/domain/planProducts.js"));
  ({ buildPhantomFoSuggestions, buildStateWithPhantomFos } = await server.ssrLoadModule("/src/v2/domain/phantomFo.ts"));
  ({ computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js"));
  ({ PORTFOLIO_BUCKET } = await server.ssrLoadModule("/src/domain/portfolioBuckets.js"));
});

test.after(async () => {
  await server?.close();
});

test("local V2 demo seed includes a visible shared-path plan product case", async () => {
  const state = buildDemoState();
  const months = buildMonths(state.settings.startMonth, state.settings.horizonMonths);
  const projection = buildSharedPlanProductProjection({ state, months });
  const suggestions = buildPhantomFoSuggestions({ state, months });
  const planningState = buildStateWithPhantomFos({
    state: projection.planningState,
    suggestions,
  });
  const report = computeSeries(planningState);

  assert.equal(state.forecast.settings.useForecast, true);
  assert.equal(state.settings.dashboardShowPhantomFoInChart, true);
  assert.ok(Array.isArray(state.planProducts) && state.planProducts.length > 0);
  assert.ok(
    projection.sharedPathEntries.some((entry) => entry.alias === "Planprodukt Demo Shaker"),
    "Der Demo-Seed muss ein procurement-ready Planprodukt enthalten.",
  );
  assert.ok(
    suggestions.some((entry) => entry.alias === "Planprodukt Demo Shaker"),
    "Der Demo-Seed muss einen Phantom-FO/PFO-Vorschlag für das Planprodukt erzeugen.",
  );

  const entries = (report.breakdown || []).flatMap((row) => row.entries || []);
  const planSalesEntries = entries.filter((entry) => (
    String(entry.kind || "").toLowerCase() === "sales-payout"
    && String(entry.portfolioBucket || "") === PORTFOLIO_BUCKET.PLAN
    && Number(entry.amount || 0) > 0
  ));
  const planFoEntries = entries.filter((entry) => (
    String(entry.source || "").toLowerCase() === "fo"
    && String(entry.portfolioBucket || "") === PORTFOLIO_BUCKET.PLAN
    && Number(entry.amount || 0) > 0
  ));

  assert.ok(planSalesEntries.length > 0, "Der Demo-Seed muss sichtbaren Planprodukte-Umsatz im Dashboard erzeugen.");
  assert.ok(planFoEntries.length > 0, "Der Demo-Seed muss sichtbare Planprodukte-FO-Outflows im Dashboard erzeugen.");
});

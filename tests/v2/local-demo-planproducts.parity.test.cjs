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

// --- Regression: gemappte (archivierte) Plan-Produkte überbrücken weiter (Bug-Fix 2026-05-29) ---
function buildBridgeState(extraImport) {
  const ref = "REF-SEASON-001";
  return {
    settings: { startMonth: "2026-08", horizonMonths: 3 },
    products: [
      { sku: ref, status: "active", includeInForecast: true },
      { sku: "REAL-BRIDGE-002", status: "active", includeInForecast: true },
    ],
    forecast: {
      forecastImport: Object.assign({
        [ref]: { "2026-08": { units: 100 }, "2026-09": { units: 100 }, "2026-10": { units: 100 } },
      }, extraImport || {}),
    },
    planProducts: [
      {
        id: "pp-bridge", alias: "Bridge Plan", status: "archived", plannedSku: "REAL-BRIDGE-002",
        baselineUnitsInReferenceMonth: 100, baselineReferenceMonth: 8,
        seasonalityReferenceSku: ref, rampUpWeeks: 1, softLaunchStartSharePct: 100,
        launchDate: "2026-08-01", includeInForecast: true,
        unitPriceUsd: 5, transitDays: 45, productionLeadTimeDaysDefault: 60,
        logisticsPerUnitEur: 2, avgSellingPriceGrossEUR: 20,
      },
    ],
  };
}

test("archived plan product mapped (via plannedSku) to an existing SKU still bridges its forecast", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const proj = buildSharedPlanProductProjection({ state: buildBridgeState(), months });
  const feed = proj.forecastUnitsBySkuMonth["REAL-BRIDGE-002"];
  assert.ok(feed, "Die gemappte echte SKU muss Plan-Mengen erhalten (Brücke), obwohl das Plan-Produkt archiviert ist.");
  const total = months.reduce((sum, m) => sum + Number(feed[m] || 0), 0);
  assert.ok(total > 0, "Die überbrückten Plan-Mengen müssen > 0 sein.");
  assert.ok(proj.sharedPathEntries.length > 0, "Das archiviert-gemappte Plan-Produkt muss im sharedPath (Cashflow) erscheinen.");
});

test("bridged plan product yields to live forecast per month (no double count)", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  // Live-Forecast für die echte SKU im August → August darf NICHT mehr überbrückt werden.
  const proj = buildSharedPlanProductProjection({
    state: buildBridgeState({ "REAL-BRIDGE-002": { "2026-08": { units: 77 } } }),
    months,
  });
  const feed = proj.forecastUnitsBySkuMonth["REAL-BRIDGE-002"] || {};
  assert.ok(!(Number(feed["2026-08"]) > 0), "August hat Live-Forecast → Plan darf August nicht zusätzlich überbrücken (sonst Doppelzählung).");
  assert.ok(Number(feed["2026-09"]) > 0, "September ohne Live-Forecast muss weiter überbrückt werden.");
});

// --- Phase 1: Reifegrad-Bucket-Logik (Plan bleibt Planprodukt bis Launch) ---
function bridgeStateWithPo(opts) {
  const s = buildBridgeState(opts && opts.extraImport);
  s.pos = [{
    id: "po-bridge-1", poNo: "BR-001", supplierId: "sup-x", orderDate: "2026-06-01",
    items: [{ id: "it1", sku: "REAL-BRIDGE-002", units: 500 }],
  }];
  return s;
}
function bucketOfMapped(proj) {
  const e = (proj.entries || proj.sharedPathEntries || []).find((x) => String(x.planningSku) === "REAL-BRIDGE-002");
  return e ? e.effectivePortfolioBucket : null;
}

test("plan-mapped SKU with PO but no live forecast stays Planprodukt (not Core)", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const proj = buildSharedPlanProductProjection({ state: bridgeStateWithPo(), months });
  assert.equal(bucketOfMapped(proj), PORTFOLIO_BUCKET.PLAN, "Vor Launch (kein Live-Forecast) darf eine PO NICHT auf Kernportfolio hochstufen.");
});

test("plan-mapped SKU promotes to Kernportfolio once it has live forecast (launched)", () => {
  const months = ["2026-08", "2026-09", "2026-10"];
  const proj = buildSharedPlanProductProjection({
    state: bridgeStateWithPo({ extraImport: { "REAL-BRIDGE-002": { "2026-08": { units: 120 }, "2026-09": { units: 120 }, "2026-10": { units: 120 } } } }),
    months,
  });
  assert.equal(bucketOfMapped(proj), PORTFOLIO_BUCKET.CORE, "Nach Launch (Live-Forecast vorhanden) stuft die PO auf Kernportfolio hoch.");
});

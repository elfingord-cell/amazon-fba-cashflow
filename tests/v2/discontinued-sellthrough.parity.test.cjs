const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

let server;
let capRevenueByStock;
let computeSeries;

test.before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, entries: [] },
  });
  ({ capRevenueByStock, computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js"));
});

test.after(async () => {
  await server?.close();
});

// ---- Pure helper: capRevenueByStock(entries, availableStock) -> Map<month, revenue> ----

test("capRevenueByStock: tapers — full, partial overflow month, then zero", () => {
  const entries = [
    { month: "2026-06", units: 60, revenueEur: 600 },
    { month: "2026-07", units: 60, revenueEur: 600 },
    { month: "2026-08", units: 60, revenueEur: 600 },
  ];
  const out = capRevenueByStock(entries, 100);
  assert.equal(round2(out.get("2026-06")), 600); // cum 60 <= 100 -> full
  assert.equal(round2(out.get("2026-07")), 400); // remaining 40 of 60 -> 600 * 40/60
  assert.equal(round2(out.get("2026-08")), 0); // cum 120 > 100 -> 0
});

test("capRevenueByStock: stock exceeds total forecast -> every month full", () => {
  const entries = [
    { month: "2026-06", units: 60, revenueEur: 600 },
    { month: "2026-07", units: 60, revenueEur: 600 },
    { month: "2026-08", units: 60, revenueEur: 600 },
  ];
  const out = capRevenueByStock(entries, 500);
  assert.equal(round2(out.get("2026-06")), 600);
  assert.equal(round2(out.get("2026-07")), 600);
  assert.equal(round2(out.get("2026-08")), 600);
});

test("capRevenueByStock: zero stock -> all months zero", () => {
  const entries = [
    { month: "2026-06", units: 60, revenueEur: 600 },
    { month: "2026-07", units: 60, revenueEur: 600 },
  ];
  const out = capRevenueByStock(entries, 0);
  assert.equal(round2(out.get("2026-06")), 0);
  assert.equal(round2(out.get("2026-07")), 0);
});

test("capRevenueByStock: missing units -> full revenue while stock remains (no div-by-zero)", () => {
  const entries = [
    { month: "2026-06", units: 0, revenueEur: 50 },
    { month: "2026-07", units: 0, revenueEur: 50 },
  ];
  const out = capRevenueByStock(entries, 100);
  assert.equal(round2(out.get("2026-06")), 50);
  assert.equal(round2(out.get("2026-07")), 50);
});

test("capRevenueByStock: sorts entries chronologically before accumulating", () => {
  const entries = [
    { month: "2026-08", units: 60, revenueEur: 600 },
    { month: "2026-06", units: 60, revenueEur: 600 },
    { month: "2026-07", units: 60, revenueEur: 600 },
  ];
  const out = capRevenueByStock(entries, 100);
  assert.equal(round2(out.get("2026-06")), 600);
  assert.equal(round2(out.get("2026-07")), 400);
  assert.equal(round2(out.get("2026-08")), 0);
});

// ---- Integration via computeSeries: wiring of cap + orphan-guard ----

function baseState(overrides) {
  return {
    settings: {
      startMonth: "2026-06",
      horizonMonths: 6,
      openingBalance: 0,
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {},
    },
    products: [],
    suppliers: [],
    pos: [],
    fos: [],
    fixcosts: [],
    incomings: [],
    inventory: { snapshots: [] },
    ...overrides,
  };
}

function forecastImportFor(sku) {
  return {
    [sku]: {
      "2026-06": { units: 60, revenueEur: 600 },
      "2026-07": { units: 60, revenueEur: 600 },
      "2026-08": { units: 60, revenueEur: 600 },
    },
  };
}

function totalSalesInflow(report) {
  return (report.series || []).reduce((sum, row) => {
    const sales = (row.itemsIn || [])
      .filter((i) => String(i.kind || "") === "sales-payout")
      .reduce((a, b) => a + Number(b.amount || 0), 0);
    return sum + sales;
  }, 0);
}

test("integration: active product books forecast revenue (control)", () => {
  const state = baseState({
    products: [{ sku: "AKT-1", status: "active", includeInForecast: true }],
    forecast: { settings: { useForecast: true }, forecastImport: forecastImportFor("AKT-1") },
  });
  assert.ok(totalSalesInflow(computeSeries(state)) > 0, "Aktives Produkt muss Forecast-Umsatz buchen.");
});

test("integration: discontinued product with zero stock books no forecast revenue", () => {
  const state = baseState({
    products: [{ sku: "EOL-1", status: "inactive", includeInForecast: true, discontinued: true }],
    forecast: { settings: { useForecast: true }, forecastImport: forecastImportFor("EOL-1") },
    inventory: { snapshots: [] }, // kein Bestand
  });
  assert.equal(totalSalesInflow(computeSeries(state)), 0, "Auslaufprodukt ohne Bestand darf 0 buchen.");
});

test("integration: discontinued product caps revenue at snapshot stock", () => {
  const stateCapped = baseState({
    products: [{ sku: "EOL-2", status: "inactive", includeInForecast: true, discontinued: true }],
    forecast: { settings: { useForecast: true }, forecastImport: forecastImportFor("EOL-2") },
    inventory: { snapshots: [{ month: "2026-06", items: [{ sku: "EOL-2", amazonUnits: 100, threePLUnits: 0 }] }] },
  });
  const stateFull = baseState({
    products: [{ sku: "EOL-2", status: "active", includeInForecast: true }],
    forecast: { settings: { useForecast: true }, forecastImport: forecastImportFor("EOL-2") },
  });
  const capped = totalSalesInflow(computeSeries(stateCapped));
  const full = totalSalesInflow(computeSeries(stateFull));
  assert.ok(capped > 0 && capped < full, "Gedeckelter Umsatz muss >0 und < voll sein.");
  // 100 von 180 Stück -> ~5/9 des vollen Umsatzes
  assert.ok(Math.abs(capped / full - 100 / 180) < 0.02, `Cap-Verhältnis ~100/180, war ${(capped / full).toFixed(3)}`);
});

test("integration: orphan forecastImport SKU (no product) books no revenue", () => {
  const state = baseState({
    products: [], // kein Produkt zur SKU
    forecast: { settings: { useForecast: true }, forecastImport: forecastImportFor("ORPHAN-1") },
  });
  assert.equal(totalSalesInflow(computeSeries(state)), 0, "Verwaiste forecastImport-SKU darf 0 buchen.");
});

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

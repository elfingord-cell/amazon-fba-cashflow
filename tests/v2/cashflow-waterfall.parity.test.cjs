const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("vite");
const root = path.resolve(__dirname, "../..");
let server, buildDemoState, computeSeries, buildCashflowWaterfall;

test.before(async () => {
  server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  ({ buildDemoState } = await server.ssrLoadModule("/src/ui/debug.js"));
  ({ computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js"));
  ({ buildCashflowWaterfall } = await server.ssrLoadModule("/src/v2/domain/cashflowWaterfall.ts"));
});
test.after(async () => { await server?.close(); });

// DIE Plausibilitäts-Garantie: das Wasserfall-Ende muss exakt dem Monats-Netto entsprechen.
test("waterfall reconciles to series.net.total for every month", () => {
  const report = computeSeries(buildDemoState());
  let checked = 0;
  for (const row of report.series) {
    const steps = buildCashflowWaterfall(row, report.cashInByMonth?.[row.month]);
    if (!steps.length) continue;
    checked += 1;
    assert.equal(steps[0].kind, "start", `Monat ${row.month}: erster Schritt ist kein Start`);
    const end = steps[steps.length - 1];
    assert.equal(end.kind, "end", `Monat ${row.month}: letzter Schritt ist kein Ende`);
    assert.ok(Math.abs(end.outValue - row.net.total) < 1,
      `Monat ${row.month}: Wasserfall-Ende ${end.outValue} ≠ Netto ${row.net.total}`);
  }
  assert.ok(checked > 0, "kein Monat geprüft");
});

test("waterfall contains the income chain (Auszahlungsquote step)", () => {
  const report = computeSeries(buildDemoState());
  const row = report.series.find((r) => (report.cashInByMonth?.[r.month]?.forecastRevenueRaw || 0) > 0);
  assert.ok(row, "Demo braucht einen Monat mit Brutto-Umsatz");
  const steps = buildCashflowWaterfall(row, report.cashInByMonth?.[row.month]);
  assert.ok(steps.some((s) => s.key === "quote"), "Auszahlungsquote-Schritt fehlt");
  assert.ok(steps.some((s) => s.key === "brutto"), "Brutto-Schritt fehlt");
});

// Regression: Steuern (separat angehängte Einträge, group="Steuern") müssen mit abgezogen werden
// und das Ende muss = inflow − Σ(alle Ausgaben inkl. Steuern) sein (Match zur PnL/Chart-Netto).
test("waterfall includes tax outflow entries and reconciles to inflow − all outflows", () => {
  const row = {
    month: "2026-06",
    entries: [
      { direction: "in", kind: "sales-payout", source: "sales", amount: 100 },
      { direction: "out", kind: "tax_payment", group: "Steuern", source: "taxes", amount: 10, label: "USt-Zahllast" },
      { direction: "out", kind: "fixcost", group: "Fixkosten", source: "fixcosts", amount: 5, label: "Miete" },
    ],
  };
  const cashIn = { forecastRevenueRaw: 200, appliedRevenue: 180, payout: 100 };
  const steps = buildCashflowWaterfall(row, cashIn);
  assert.ok(steps.some((s) => s.key === "steuern"), "Steuern-Schritt fehlt");
  const end = steps[steps.length - 1];
  assert.ok(Math.abs(end.outValue - 85) < 0.5, `Ende ${end.outValue} ≠ 85 (100 − 10 Steuern − 5 Fix)`);
});

test("each running value chains (inValue of step n == outValue of step n-1)", () => {
  const report = computeSeries(buildDemoState());
  const row = report.series.find((r) => (report.cashInByMonth?.[r.month]?.forecastRevenueRaw || 0) > 0);
  const steps = buildCashflowWaterfall(row, report.cashInByMonth?.[row.month]);
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(Math.abs(steps[i].inValue - steps[i - 1].outValue) < 1,
      `Kette gebrochen bei ${steps[i].key}: in ${steps[i].inValue} ≠ vorher-out ${steps[i - 1].outValue}`);
  }
});

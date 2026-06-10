import test from "node:test";
import assert from "node:assert/strict";
import { computeSeries } from "./cashflow.js";

function buildState(overrides = {}) {
  return {
    settings: {
      startMonth: "2025-12",
      horizonMonths: 3,
      openingBalance: "0",
      dividendKapest: { enabled: true, ratePct: 26.375 },
      ...overrides,
    },
    incomings: [],
    extras: [],
    dividends: [
      { id: "div-1", month: "2025-12", date: "2025-12-22", label: "Dividende", amountEur: "30.000" },
    ],
    fixcosts: [],
    fixcostOverrides: {},
    fos: [],
    pos: [],
    products: [],
    vatCostRules: [],
    vatPreviewMonths: {},
    recentProducts: [],
    status: { autoManualCheck: false, events: {} },
  };
}

test("KapESt+Soli wird im Folgemonat der Ausschüttung abgeführt (Netto-Eingabe)", () => {
  const series = computeSeries(buildState());
  const entries = series.breakdown.flatMap((b) => b.entries || []);
  const kapest = entries.filter((e) => e.kind === "dividend-kapest");

  assert.equal(kapest.length, 1);
  assert.equal(kapest[0].month, "2026-01");
  assert.equal(kapest[0].direction, "out");
  // Netto 30.000 → Brutto 40.747,03 → KapESt+Soli 10.747,03 (real Jan 2026: 10.746,27)
  assert.ok(Math.abs(kapest[0].amount - 30000 * (0.26375 / 0.73625)) < 0.01);
  assert.equal(kapest[0].date, "2026-01-10");
});

test("KapESt entfällt bei deaktiviertem Setting", () => {
  const series = computeSeries(buildState({ dividendKapest: { enabled: false } }));
  const entries = series.breakdown.flatMap((b) => b.entries || []);
  assert.equal(entries.filter((e) => e.kind === "dividend-kapest").length, 0);
});

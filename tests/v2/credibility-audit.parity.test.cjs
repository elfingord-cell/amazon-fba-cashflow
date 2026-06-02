const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("vite");
const root = path.resolve(__dirname, "../..");
let server, audit;

test.before(async () => {
  server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  audit = await server.ssrLoadModule("/src/domain/credibilityAudit.js");
});
test.after(async () => { await server?.close(); });

const NOW = new Date("2026-06-02T08:00:00Z");
function baseInput(over = {}) {
  return {
    now: NOW,
    state: { inventory: { snapshots: [{ month: "2026-06", items: [] }] },
             forecast: {}, products: [], fos: [], provenance: {} },
    report: { kpis: { actuals: { avgRevenueDeltaPct: 5 } }, firstNegativeMonth: null,
              series: [{ month: "2026-06", inflow: { total: 100 }, outflow: { total: 0 }, net: { total: 100 }, entries: [] }],
              breakdown: [{ month: "2026-06", closing: 1000 }] },
    phantomSuggestions: [],
    ...over,
  };
}
function find(res, key) { return res.checks.find((c) => c.key === key); }

// snapshot_fresh
test("snapshot_fresh: green within 35 days", () => {
  assert.equal(find(audit.runCredibilityAudit(baseInput()), "snapshot_fresh").status, "green");
});
test("snapshot_fresh: red older than 60 days", () => {
  const res = audit.runCredibilityAudit(baseInput({ state: { inventory: { snapshots: [{ month: "2026-02" }] }, forecast: {}, products: [], fos: [], provenance: {} } }));
  assert.equal(find(res, "snapshot_fresh").status, "red");
});

// forecast_current
test("forecast_current: amber when baseline unknown", () => {
  assert.equal(find(audit.runCredibilityAudit(baseInput()), "forecast_current").status, "amber");
});
test("forecast_current: green with recent baseline", () => {
  const res = audit.runCredibilityAudit(baseInput({ state: { inventory: { snapshots: [{ month: "2026-06" }] }, products: [], fos: [], provenance: {}, forecast: { activeVersionId: "v1", versions: [{ id: "v1", createdAt: "2026-05-20T00:00:00Z" }] } } }));
  assert.equal(find(res, "forecast_current").status, "green");
});

// pfo_complete
test("pfo_complete: red with overdue suggestion", () => {
  assert.equal(find(audit.runCredibilityAudit(baseInput({ phantomSuggestions: [{ sku: "X", overdue: true }] })), "pfo_complete").status, "red");
});
test("pfo_complete: green with no overdue", () => {
  assert.equal(find(audit.runCredibilityAudit(baseInput({ phantomSuggestions: [{ sku: "X", overdue: false }] })), "pfo_complete").status, "green");
});

// fo_plausible
test("fo_plausible: red when stored FO has units<=0 or delivery before order", () => {
  const res = audit.runCredibilityAudit(baseInput({ state: { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: {}, products: [], provenance: {}, fos: [{ id: "fo-1", units: 0, orderDate: "2026-06-10", deliveryDate: "2026-06-01" }] } }));
  assert.equal(find(res, "fo_plausible").status, "red");
});

// revenue_realistic
test("revenue_realistic: amber when no actuals", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, kpis: { actuals: { avgRevenueDeltaPct: null } } } }));
  assert.equal(find(res, "revenue_realistic").status, "amber");
});
test("revenue_realistic: red beyond 40%", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, kpis: { actuals: { avgRevenueDeltaPct: -55 } } } }));
  assert.equal(find(res, "revenue_realistic").status, "red");
});

// balance_sane
test("balance_sane: red when closing is NaN", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, breakdown: [{ month: "2026-06", closing: NaN }] } }));
  assert.equal(find(res, "balance_sane").status, "red");
});
test("balance_sane: amber when a month goes negative (real computeSeries shape: kpis.firstNegativeMonth)", () => {
  const base = baseInput();
  const res = audit.runCredibilityAudit({ ...base, report: { ...base.report, kpis: { ...base.report.kpis, firstNegativeMonth: "2026-09" } } });
  assert.equal(find(res, "balance_sane").status, "amber");
});

// bucket_sums
test("bucket_sums: red when a sales-payout inflow lacks a bucket", () => {
  const series = [{ month: "2026-06", inflow: { total: 100 }, outflow: { total: 0 }, net: { total: 100 },
    entries: [{ kind: "sales-payout", direction: "in", amount: 100, portfolioBucket: null }] }];
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, series } }));
  assert.equal(find(res, "bucket_sums").status, "red");
});

// provenance_coverage + overall cap
test("provenance_coverage: 0% shows amber (capped) and overall is not red from it alone", () => {
  const state = { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: { versions: [{ id: "v", createdAt: "2026-05-25T00:00:00Z" }], activeVersionId: "v" }, products: [{ sku: "A" }, { sku: "B" }], fos: [], provenance: {} };
  const res = audit.runCredibilityAudit(baseInput({ state }));
  assert.equal(find(res, "provenance_coverage").status, "amber");
  assert.notEqual(res.overall, "red");
});
test("provenance_coverage: green at >=80% stamped", () => {
  const state = { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: {}, fos: [],
    products: [{ sku: "A" }, { sku: "B" }, { sku: "C" }, { sku: "D" }, { sku: "E" }],
    provenance: { "product:A": {}, "product:B": {}, "product:C": {}, "product:D": {} } };
  assert.equal(find(audit.runCredibilityAudit(baseInput({ state })), "provenance_coverage").status, "green");
});

// shape
test("runCredibilityAudit returns 8 checks + overall + lastRun", () => {
  const res = audit.runCredibilityAudit(baseInput());
  assert.equal(res.checks.length, 8);
  assert.ok(["green", "amber", "red"].includes(res.overall));
  assert.equal(res.lastRun, NOW.toISOString());
});

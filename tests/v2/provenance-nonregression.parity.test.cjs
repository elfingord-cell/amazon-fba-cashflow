// Datenverlust-Auflage (Spec): computeSeries muss mit UND ohne die additiven Keys
// provenance/audit/changeLog identisch rechnen — die Engine darf sie ignorieren.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("vite");
const root = path.resolve(__dirname, "../..");
let server, buildDemoState, computeSeries;

test.before(async () => {
  server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  ({ buildDemoState } = await server.ssrLoadModule("/src/ui/debug.js"));
  ({ computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js"));
});
test.after(async () => { await server?.close(); });

test("computeSeries ignores additive provenance/audit/changeLog keys (identical result)", () => {
  const base = buildDemoState();
  const withMeta = {
    ...structuredClone(base),
    provenance: { "product:DEMO": { source: "vo", asOf: "2026-06-01T00:00:00Z", by: "claude", method: "x", rev: "r1" } },
    audit: { lastRun: "2026-06-02T08:00:00Z", by: "claude", overall: "green", checks: [{ key: "k", label: "l", status: "green", detail: "d" }] },
    changeLog: [{ at: "2026-06-02T08:00:00Z", by: "claude", label: "x", source: "claude", rev: "r1", summary: "s" }],
  };
  const a = computeSeries(structuredClone(base));
  const b = computeSeries(withMeta);
  assert.deepEqual(b.breakdown, a.breakdown);
  assert.deepEqual(b.series, a.series);
  assert.deepEqual(b.kpis, a.kpis);
});

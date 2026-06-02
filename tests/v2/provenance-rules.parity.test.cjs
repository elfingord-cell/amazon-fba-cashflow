const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createServer } = require("vite");
const root = path.resolve(__dirname, "../..");
let server, mod;

test.before(async () => {
  server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  mod = await server.ssrLoadModule("/src/domain/provenanceRules.js");
});
test.after(async () => { await server?.close(); });

test("entityKey builds type:id, falls back to bare type", () => {
  assert.equal(mod.entityKey("product", "029.001-TAMPER-STEEL"), "product:029.001-TAMPER-STEEL");
  assert.equal(mod.entityKey("opening", ""), "opening");
});
test("leading source resolves for known types, null for unknown", () => {
  assert.equal(mod.resolveLeadingSource("snapshot"), "vo");
  assert.equal(mod.resolveLeadingSource("dividend"), "human");
  assert.equal(mod.resolveLeadingSource("nonsense"), null);
});
test("audit thresholds present and ordered", () => {
  const t = mod.AUDIT_THRESHOLDS;
  assert.ok(t.snapshotFreshDays.green < t.snapshotFreshDays.amber);
  assert.ok(t.revenueRealisticPct.green < t.revenueRealisticPct.amber);
});

test("applyProvenance stamps entities and appends a capped changeLog entry", () => {
  const state = { provenance: {}, changeLog: [] };
  mod.applyProvenance(state, { entityKeys: ["product:A"], source: "vo", by: "claude",
    method: "snapshot-sync", rev: "r1", label: "snapshot-2026-06", summary: "1 SKU", nowIso: "2026-06-02T08:00:00Z" });
  assert.equal(state.provenance["product:A"].source, "vo");
  assert.equal(state.provenance["product:A"].rev, "r1");
  assert.equal(state.changeLog.length, 1);
  assert.equal(state.changeLog[0].label, "snapshot-2026-06");
});
test("applyProvenance caps changeLog at 100 entries", () => {
  const state = { provenance: {}, changeLog: Array.from({ length: 100 }, (_, i) => ({ label: `old-${i}` })) };
  mod.applyProvenance(state, { source: "claude", by: "claude", method: "x", rev: "r", label: "new", nowIso: "2026-06-02T08:00:00Z" });
  assert.equal(state.changeLog.length, 100);
  assert.equal(state.changeLog[state.changeLog.length - 1].label, "new");
});

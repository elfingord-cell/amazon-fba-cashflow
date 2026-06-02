// Glaubwuerdigkeits-Audit-Runner. Laedt die ECHTE Engine via vite-SSR (wie die Parity-Tests),
// damit der Audit nie eine zweite Wahrheit nachbaut. Default Dry; mit commit=true wird state.audit
// geschrieben (additiv, via commitState -> Backup + rev). Liefert das Audit-Ergebnis + reportText.
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.mjs";
import { loadState, commitState } from "./client.mjs";
import { validateState } from "./validate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function loadEngine() {
  const server = await createServer({ root: repoRoot, configFile: false, appType: "custom", logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] } });
  const { computeSeries } = await server.ssrLoadModule("/src/domain/cashflow.js");
  const { buildPhantomFoSuggestions, resolvePlanningMonthsFromState } = await server.ssrLoadModule("/src/v2/domain/phantomFo.ts");
  const { runCredibilityAudit } = await server.ssrLoadModule("/src/domain/credibilityAudit.js");
  return { server, computeSeries, buildPhantomFoSuggestions, resolvePlanningMonthsFromState, runCredibilityAudit };
}

export async function runAudit({ commit = false, workspaceId } = {}) {
  const cfg = getConfig({ workspaceId });
  const { state } = await loadState(cfg);
  const eng = await loadEngine();
  try {
    const now = new Date();
    const report = eng.computeSeries(state);
    let phantomSuggestions = [];
    try {
      const months = eng.resolvePlanningMonthsFromState(state);
      phantomSuggestions = eng.buildPhantomFoSuggestions({ state, months }) || [];
    } catch (e) {
      phantomSuggestions = [];
    }
    const result = eng.runCredibilityAudit({ state, report, phantomSuggestions, now });

    const icon = { green: "🟢", amber: "🟡", red: "🔴" };
    const lines = [`${icon[result.overall]} CFP-Glaubwürdigkeit: ${result.overall.toUpperCase()}`];
    for (const c of result.checks) lines.push(`${icon[c.status]} ${c.label}: ${c.detail}`);
    const reportText = lines.join("\n");
    console.log("\n" + reportText + `\n(${result.lastRun})`);

    if (commit) {
      const res = await commitState(cfg, (s) => { s.audit = result; }, {
        dryRun: false, label: "audit", validateFn: validateState,
        provenance: { source: "claude", by: "claude", method: "audit", label: "audit", summary: `overall=${result.overall}` },
      });
      console.log(`\n[COMMITTED] state.audit aktualisiert · rev ${res.rev} · Backup ${res.backupFile}`);
    } else {
      console.log("\n[DRY] state.audit nicht geschrieben (mit --commit schreiben).");
    }
    return { ...result, reportText };
  } finally {
    await eng.server.close();
  }
}

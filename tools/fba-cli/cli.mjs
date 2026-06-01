#!/usr/bin/env node
// FBA Cashflow CLI — Kommandozeile.
//
// Lesen ist immer erlaubt. Schreiben ist standardmäßig DRY-RUN; echtes Schreiben nur mit --commit.
// Vor jedem echten Write wird automatisch ein Backup nach ~/.fba-cli-backups/ geschrieben.
//
// Beispiele:
//   node tools/fba-cli/cli.mjs status
//   node tools/fba-cli/cli.mjs get products --out /tmp/products.json
//   node tools/fba-cli/cli.mjs find products sku PO-6TKA-Q0VA
//   node tools/fba-cli/cli.mjs validate
//   node tools/fba-cli/cli.mjs backup
//   node tools/fba-cli/cli.mjs apply ./mypatch.mjs            # dry-run (zeigt Diff)
//   node tools/fba-cli/cli.mjs apply ./mypatch.mjs --commit   # schreibt
//   node tools/fba-cli/cli.mjs set-setting safetyStockDohDefault 70 --commit
//   node tools/fba-cli/cli.mjs rm fos fo-jc13zdt --commit

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig } from "./config.mjs";
import { loadState, commitState, writeBackup } from "./client.mjs";
import { validateState } from "./validate.mjs";
import * as entities from "./entities.mjs";
import { setSetting, removeById } from "./entities.mjs";
import { runImportBwa } from "./import-bwa.mjs";
import { runSyncPoStatus } from "./sync-po-status.mjs";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }
  return { positional, flags };
}

function out(obj) {
  process.stdout.write(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  process.stdout.write("\n");
}

function collectionCounts(state) {
  const counts = {};
  for (const [k, kind] of Object.entries(entities.COLLECTIONS)) {
    const v = state[k];
    if (kind === "array") counts[k] = Array.isArray(v) ? v.length : 0;
    else counts[k] = v && typeof v === "object" ? Object.keys(v).length : 0;
  }
  return counts;
}

function diffCounts(before, next) {
  const a = collectionCounts(before);
  const b = collectionCounts(next);
  const rows = {};
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) rows[k] = `${a[k]} → ${b[k]}`;
  }
  return rows;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const cfg = getConfig({ workspaceId: flags.workspace });

  if (!cmd || cmd === "help") {
    out([
      "FBA Cashflow CLI",
      "  status                         Rev + Zähler je Collection",
      "  get <collection|state>         JSON ausgeben (--out <datei>)",
      "  find <collection> <feld> <wert>  Einträge filtern",
      "  validate                       State gegen Regeln prüfen",
      "  backup [datei]                 Voll-Backup schreiben",
      "  apply <patch.mjs> [--commit]   Mutation anwenden (default dry-run)",
      "  set-setting <pfad> <json> [--commit]",
      "  rm <collection> <id> [--commit] [--id-field=<feld>]",
      "  import-bwa <csv> [--commit] [--base-year=2025] [--forecast-year=2026]",
      "  sync-po-status [--commit]      PO-Empfangsstatus von VentoryOne in CFP übertragen",
      "Optionen: --commit (echtes Schreiben), --force (trotz Validierungsfehler), --workspace=<uuid>",
    ].join("\n"));
    return;
  }

  if (cmd === "status") {
    const { rev, updatedAt, state } = await loadState(cfg);
    out({ workspaceId: cfg.workspaceId, rev, updatedAt, schemaVersion: state.schemaVersion, counts: collectionCounts(state) });
    return;
  }

  if (cmd === "get") {
    const what = positional[1] || "state";
    const { state } = await loadState(cfg);
    const data = what === "state" ? state : state[what];
    if (data === undefined) { out(`Unbekannte Collection: ${what}`); process.exit(2); }
    if (flags.out) { fs.writeFileSync(String(flags.out), JSON.stringify(data, null, 2)); out(`geschrieben: ${flags.out}`); }
    else out(data);
    return;
  }

  if (cmd === "find") {
    const [, collection, field, value] = positional;
    const { state } = await loadState(cfg);
    const arr = Array.isArray(state[collection]) ? state[collection] : [];
    out(arr.filter((e) => e && String(e[field]) === String(value)));
    return;
  }

  if (cmd === "validate") {
    const { state } = await loadState(cfg);
    out(validateState(state));
    return;
  }

  if (cmd === "backup") {
    const { state } = await loadState(cfg);
    if (positional[1]) { fs.writeFileSync(positional[1], JSON.stringify(state, null, 2)); out(`Backup: ${positional[1]}`); }
    else out(`Backup: ${writeBackup(state, "manual")}`);
    return;
  }

  // --- Schreib-Kommandos -------------------------------------------------
  const dryRun = !flags.commit;
  const force = Boolean(flags.force);

  if (cmd === "import-bwa") {
    // BWA-GuV-Zeitreihe importieren (Teil A: monthlyActuals additiv; Teil B: forecastCalibration).
    // Logik + Report leben in import-bwa.mjs; default Dry-Run, echtes Schreiben nur mit --commit.
    const csvPath = positional[1];
    if (!csvPath) { out("import-bwa benötigt <csv> (Pfad zur GuV-Zeitreihe-CSV)"); process.exit(2); }
    await runImportBwa({
      csvPath,
      commit: Boolean(flags.commit),
      force,
      baseYear: flags["base-year"] || 2025,
      forecastYear: flags["forecast-year"] || 2026,
      workspaceId: flags.workspace,
    });
    return;
  }

  if (cmd === "sync-po-status") {
    // PO-Empfangsstatus von VentoryOne (führend) in den CFP-State übertragen.
    // Logik + Report leben in sync-po-status.mjs; default Dry-Run, echtes Schreiben nur mit --commit.
    await runSyncPoStatus({
      commit: Boolean(flags.commit),
      force,
      workspaceId: flags.workspace,
    });
    return;
  }

  if (cmd === "apply") {
    const patchPath = positional[1];
    if (!patchPath) { out("apply benötigt <patch.mjs>"); process.exit(2); }
    const mod = await import(pathToFileURL(path.resolve(patchPath)).href);
    const patch = mod.default;
    if (typeof patch !== "function") { out("Patch muss `export default async (state, helpers) => {…}` sein."); process.exit(2); }
    const res = await commitState(cfg, (state) => patch(state, entities), { dryRun, force, label: path.basename(patchPath), validateFn: validateState });
    reportWrite(res, dryRun);
    return;
  }

  if (cmd === "set-setting") {
    const [, dottedPath, rawValue] = positional;
    let value;
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }
    const res = await commitState(cfg, (state) => { setSetting(state, dottedPath, value); }, { dryRun, force, label: `set-${dottedPath}`, validateFn: validateState });
    reportWrite(res, dryRun, { change: `settings.${dottedPath} = ${JSON.stringify(value)}` });
    return;
  }

  if (cmd === "rm") {
    const [, collection, id] = positional;
    const idField = flags["id-field"] || "id";
    const res = await commitState(cfg, (state) => { removeById(state, collection, id, idField); }, { dryRun, force, label: `rm-${collection}`, validateFn: validateState });
    reportWrite(res, dryRun, { change: `remove ${collection}.${idField}=${id}` });
    return;
  }

  out(`Unbekanntes Kommando: ${cmd} (siehe 'help')`);
  process.exit(2);
}

function reportWrite(res, dryRun, extra = {}) {
  if (res.dryRun) {
    out({
      mode: "DRY-RUN (nichts geschrieben — mit --commit ausführen)",
      ...extra,
      changedCounts: diffCounts(res.before, res.next),
      stateChanged: JSON.stringify(res.before) !== JSON.stringify(res.next),
      newErrors: res.validation?.newErrors || [],
      preexistingErrors: res.validation?.preexistingErrors || [],
      warnings: res.validation?.warnings || [],
      currentRev: res.rev,
    });
  } else {
    out({ mode: "COMMITTED", ...extra, newRev: res.rev, counts: res.counts, backup: res.backupFile, newErrors: res.validation?.newErrors || [], preexistingErrors: res.validation?.preexistingErrors || [] });
  }
}

main().catch((err) => {
  process.stderr.write(`FEHLER: ${err.message}\n`);
  if (err.validation) process.stderr.write(JSON.stringify(err.validation, null, 2) + "\n");
  process.exit(1);
});

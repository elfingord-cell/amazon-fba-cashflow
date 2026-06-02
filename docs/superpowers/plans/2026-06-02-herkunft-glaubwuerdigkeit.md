# Herkunfts-Ledger + Glaubwürdigkeits-Ampel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede Zahl im CFP wird nachvollziehbar (Herkunft), überprüfbar (wöchentlicher Auto-Audit mit Ampel) und umkehrbar (Änderungs-Log) — das Vertrauens-Fundament, bevor irgendeine UI-/Logik-Politur kommt.

**Architecture:** Drei additive, non-breaking Erweiterungen am bestehenden `state_json`: (1) ein statisches Herkunfts-Regelwerk (`provenanceRules.js`) als Contract „eine Quelle pro Feld"; (2) eine **reine** Audit-Funktion (`credibilityAudit.js`), die aus dem echten Engine-Output (`computeSeries`, `buildPhantomFoSuggestions`) eine Ampel + Checks berechnet; (3) Provenienz-Stempel + Änderungs-Log, die jeder CLI-Write hinterlässt. Ein CLI-Runner (`tools/fba-cli/audit.mjs`) lädt die echte Engine via vite-SSR (wie die Parity-Tests), damit der Audit nie eine zweite Wahrheit nachbaut. UI liest `state.audit`/`state.provenance` rein lesend.

**Tech Stack:** Node ESM (`.mjs` CLI), src-Domain in ESM-`.js`/TS, Tests via `node --test` + vite `ssrLoadModule`, React 18 + Ant Design (V2-UI), Supabase via `app_sync` (bestehende `commitState`), Telegram Bot API für den Wochenreport, MCP `scheduled-tasks` für die Kadenz.

**Spec:** `docs/superpowers/specs/2026-06-02-herkunft-glaubwuerdigkeit-design.md`

---

## File Structure

**Neu:**
- `docs/operating-model/herkunfts-ledger.md` — menschenlesbarer Contract (Quelle pro Feld + Konfliktprotokoll).
- `src/domain/provenanceRules.js` — `PROVENANCE_RULES`, `AUDIT_THRESHOLDS`, `entityKey()`, `resolveLeadingSource()`. Reine Konstanten/Helfer, keine Seiteneffekte.
- `src/domain/credibilityAudit.js` — `runCredibilityAudit({state, report, phantomSuggestions, now, thresholds})` → `{lastRun, by, overall, checks}`. **Pure**, keine I/O.
- `tools/fba-cli/audit.mjs` — Runner: vite-SSR lädt Engine + Audit, berechnet, druckt Report, optional `--write` (commitState `state.audit`).
- `tools/fba-cli/notify-telegram.mjs` — kleiner Helfer: lädt Keys, POST an Telegram `sendMessage` (Mahona-Gruppe).
- `tools/fba-cli/weekly-audit.sh` — Wrapper: `audit --write` + Telegram-Report (für Scheduled-Task).
- `tests/v2/provenance-rules.parity.test.cjs` — Regelwerk-Tests.
- `tests/v2/credibility-audit.parity.test.cjs` — Audit-Check-Tests (grün/amber/rot je Check).
- `src/v2/components/CredibilityBadge.tsx` — Ampel-Header-Komponente (liest `state.audit`).
- `src/v2/components/ProvenanceTag.tsx` — kleines Herkunfts-Badge (liest `state.provenance`).

**Modifiziert:**
- `tools/fba-cli/client.mjs` — `commitState` bekommt `opts.provenance` → stempelt `state.provenance` + hängt `state.changeLog`-Eintrag an.
- `tools/fba-cli/cli.mjs` — neues Kommando `audit`; `set-setting`/`rm`/`apply`/`sync-po-status` reichen `provenance` durch.
- `src/v2/modules/dashboard/index.tsx` — `CredibilityBadge` oben einhängen.
- `src/v2/modules/forecast/index.tsx` + `src/v2/modules/products/index.tsx` — `ProvenanceTag` an Zeilen (read-only).

**Datenmodell (additiv, Engine ignoriert):** `state.provenance` (Map), `state.audit` (letzter Lauf), `state.changeLog` (Ringpuffer ≤100).

---

## PHASE 1 — Herkunfts-Regelwerk (reine Festlegung, null Risiko)

### Task 1: `provenanceRules.js` — Konstanten + Helfer

**Files:**
- Create: `src/domain/provenanceRules.js`
- Test: `tests/v2/provenance-rules.parity.test.cjs`

- [ ] **Step 1: Failing test**

```js
// tests/v2/provenance-rules.parity.test.cjs
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
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/v2/provenance-rules.parity.test.cjs`
Expected: FAIL (`Cannot find module '/src/domain/provenanceRules.js'`).

- [ ] **Step 3: Implement**

```js
// src/domain/provenanceRules.js
// Statisches Herkunfts-Regelwerk: eine fuehrende Quelle pro Feld + Audit-Schwellen.
// Reine Konstanten/Helfer, keine Seiteneffekte. Von Engine NICHT genutzt (nur Audit/CLI/UI).

export const AUDIT_THRESHOLDS = {
  snapshotFreshDays: { green: 35, amber: 60 },
  forecastCurrentDays: { green: 35, amber: 60 },
  revenueRealisticPct: { green: 25, amber: 40 },
  provenanceCoveragePct: { green: 80, amber: 50 },
};

export const PROVENANCE_RULES = {
  snapshot:       { leadingSource: "vo",          conflict: "vo-wins" },
  forecastImport: { leadingSource: "vo",          conflict: "vo-wins-manual-override" },
  po:             { leadingSource: "vo",          conflict: "vo-wins-keep-payplan" },
  landedCost:     { leadingSource: "vo",          conflict: "vo-wins" },
  fo:             { leadingSource: "computed",     conflict: "engine-source" },
  payment:        { leadingSource: "holvi",       conflict: "bank-wins" },
  fixcost:        { leadingSource: "holvi",       conflict: "bank-wins-assumptions-human" },
  revenueActual:  { leadingSource: "sellerboard", conflict: "sellerboard-wins" },
  tax:            { leadingSource: "bwa",         conflict: "bwa-wins" },
  dividend:       { leadingSource: "human",       conflict: "human-only" },
  openingBalance: { leadingSource: "holvi",       conflict: "bank-wins-human-confirm" },
};

export const PROVENANCE_SOURCES = ["vo", "sellerboard", "holvi", "bwa", "claude", "human", "computed"];

export function entityKey(type, id) {
  const t = String(type || "").trim();
  if (id == null || String(id).trim() === "") return t;
  return `${t}:${String(id).trim()}`;
}

export function resolveLeadingSource(type) {
  const rule = PROVENANCE_RULES[String(type || "").trim()];
  return rule ? rule.leadingSource : null;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `node --test tests/v2/provenance-rules.parity.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/provenanceRules.js tests/v2/provenance-rules.parity.test.cjs
git commit -m "feat(provenance): Herkunfts-Regelwerk + Audit-Schwellen (provenanceRules.js)"
```

### Task 2: Herkunfts-Ledger Doc (menschenlesbarer Contract)

**Files:**
- Create: `docs/operating-model/herkunfts-ledger.md`

- [ ] **Step 1: Schreiben** — Inhalt: die Quelle-pro-Feld-Tabelle aus der Spec (Abschnitt A) + das Konfliktprotokoll (fix&log / propose&dispose / stop&ask) + ein Verweis auf `src/domain/provenanceRules.js` als maschinenlesbare Quelle der Wahrheit. Kopiere die Tabelle 1:1 aus der Spec, ergänze je Zeile die `PROVENANCE_RULES`-Key-Spalte (z. B. `snapshot`, `forecastImport`, …), damit Doc und Config eindeutig verknüpft sind.

- [ ] **Step 2: Commit**

```bash
git add docs/operating-model/herkunfts-ledger.md
git commit -m "docs: Herkunfts-Ledger Contract (eine Quelle pro Feld + Konfliktprotokoll)"
```

---

## PHASE 2 — Glaubwürdigkeits-Audit (Kern: reine Check-Funktion + Runner)

### Task 3: `credibilityAudit.js` — reine Check-Funktion, Check für Check (TDD)

**Files:**
- Create: `src/domain/credibilityAudit.js`
- Test: `tests/v2/credibility-audit.parity.test.cjs`

Jeder Check ist eine pure Funktion `(input) -> {key, label, status, detail, drill}`. `runCredibilityAudit` ruft alle auf und leitet `overall` ab. Wir bauen Test-für-Test auf.

- [ ] **Step 1: Test-Gerüst + erster Check `snapshot_fresh` (failing)**

```js
// tests/v2/credibility-audit.parity.test.cjs
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
              series: [{ month: "2026-06", inflow: { total: 100 }, outflow: { total: 0 }, net: { total: 100 } }],
              breakdown: [{ month: "2026-06", closing: 1000 }] },
    phantomSuggestions: [],
    ...over,
  };
}
function find(res, key) { return res.checks.find((c) => c.key === key); }

test("snapshot_fresh: green when latest snapshot within 35 days", () => {
  const res = audit.runCredibilityAudit(baseInput());
  assert.equal(find(res, "snapshot_fresh").status, "green");
});
test("snapshot_fresh: red when latest snapshot older than 60 days", () => {
  const res = audit.runCredibilityAudit(baseInput({
    state: { inventory: { snapshots: [{ month: "2026-02", items: [] }] }, forecast: {}, products: [], fos: [], provenance: {} },
  }));
  assert.equal(find(res, "snapshot_fresh").status, "red");
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `node --test tests/v2/credibility-audit.parity.test.cjs`
Expected: FAIL (`runCredibilityAudit is not a function`).

- [ ] **Step 3: Implement skeleton + `snapshot_fresh`**

```js
// src/domain/credibilityAudit.js
// Reine Glaubwuerdigkeits-Pruefung: nimmt fertigen Engine-Output (report, phantomSuggestions)
// + state + now, gibt Ampel-Checks zurueck. KEINE I/O, KEINE Engine-Aufrufe hier (der Runner
// liefert report/phantomSuggestions). So bleibt die Funktion deterministisch testbar.
import { AUDIT_THRESHOLDS } from "./provenanceRules.js";

const DAY_MS = 86400000;

function monthEndIso(month) {
  const m = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)); // letzter Tag des Monats (UTC)
}
function daysSince(date, now) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.round((now.getTime() - date.getTime()) / DAY_MS);
}
function statusByDays(days, thr) {
  if (days == null) return "amber";
  if (days <= thr.green) return "green";
  if (days <= thr.amber) return "amber";
  return "red";
}

function checkSnapshotFresh(state, now, thr) {
  const snaps = Array.isArray(state?.inventory?.snapshots) ? state.inventory.snapshots : [];
  const latest = snaps.map((s) => String(s?.month || "")).filter(Boolean).sort().pop() || null;
  const days = latest ? daysSince(monthEndIso(latest), now) : null;
  return {
    key: "snapshot_fresh", label: "Bestand frisch",
    status: latest ? statusByDays(days, thr.snapshotFreshDays) : "red",
    detail: latest ? `Letzter Snapshot ${latest} (${days} Tage alt)` : "Kein Snapshot vorhanden",
    drill: "#/v2/inventory/snapshot",
  };
}

const CHECK_BUILDERS = [
  ({ state, now, thresholds }) => checkSnapshotFresh(state, now, thresholds),
];

function deriveOverall(checks) {
  // provenance_coverage darf overall hoechstens auf amber ziehen, nie auf rot.
  const effective = checks.map((c) =>
    c.key === "provenance_coverage" && c.status === "red" ? { ...c, status: "amber" } : c);
  if (effective.some((c) => c.status === "red")) return "red";
  if (effective.some((c) => c.status === "amber")) return "amber";
  return "green";
}

export function runCredibilityAudit({ state, report, phantomSuggestions, now, thresholds = AUDIT_THRESHOLDS }) {
  const ctx = { state: state || {}, report: report || {}, phantomSuggestions: phantomSuggestions || [], now, thresholds };
  const checks = CHECK_BUILDERS.map((build) => build(ctx));
  return { lastRun: now.toISOString(), by: "claude", overall: deriveOverall(checks), checks };
}
```

- [ ] **Step 4: Run, verify PASS** — Run: `node --test tests/v2/credibility-audit.parity.test.cjs` → 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/credibilityAudit.js tests/v2/credibility-audit.parity.test.cjs
git commit -m "feat(audit): credibilityAudit skeleton + snapshot_fresh check"
```

### Task 4: Check `forecast_current`

**Files:** Modify `src/domain/credibilityAudit.js`, `tests/v2/credibility-audit.parity.test.cjs`

- [ ] **Step 1: Failing tests** (append)

```js
test("forecast_current: amber when baseline date unknown", () => {
  const res = audit.runCredibilityAudit(baseInput());
  assert.equal(find(res, "forecast_current").status, "amber");
});
test("forecast_current: green with recent baseline", () => {
  const res = audit.runCredibilityAudit(baseInput({
    state: { inventory: { snapshots: [{ month: "2026-06" }] }, products: [], fos: [], provenance: {},
             forecast: { activeVersionId: "v1", versions: [{ id: "v1", createdAt: "2026-05-20T00:00:00Z" }] } },
  }));
  assert.equal(find(res, "forecast_current").status, "green");
});
```

- [ ] **Step 2: Run, verify FAIL** (`forecast_current` undefined).

- [ ] **Step 3: Implement** — add helper + check, register in `CHECK_BUILDERS`.

```js
// in credibilityAudit.js — Baseline-Datum defensiv aufloesen (mehrere bekannte Orte probieren).
export function resolveForecastBaselineIso(state) {
  const f = state?.forecast || {};
  const versions = Array.isArray(f.versions) ? f.versions : [];
  const active = versions.find((v) => v && v.id === f.activeVersionId) || versions[versions.length - 1] || null;
  const iso = active?.createdAt || f.baselineCreatedAt || f.importedAt || null;
  return iso ? String(iso) : null;
}
function checkForecastCurrent(state, now, thr) {
  const iso = resolveForecastBaselineIso(state);
  const date = iso ? new Date(iso) : null;
  const days = date && !Number.isNaN(date.getTime()) ? daysSince(date, now) : null;
  return {
    key: "forecast_current", label: "Forecast aktuell",
    status: days == null ? "amber" : statusByDays(days, thr.forecastCurrentDays),
    detail: days == null ? "Baseline-Datum unbekannt" : `Aktive Baseline ${days} Tage alt`,
    drill: "#/v2/forecast",
  };
}
// CHECK_BUILDERS: ..., ({state, now, thresholds}) => checkForecastCurrent(state, now, thresholds),
```

- [ ] **Step 4: PASS** — `node --test tests/v2/credibility-audit.parity.test.cjs`.
- [ ] **Step 5: Commit** — `git commit -am "feat(audit): forecast_current check"`

### Task 5: Checks `pfo_complete` + `fo_plausible`

**Files:** Modify `credibilityAudit.js`, test file.

- [ ] **Step 1: Failing tests** (append)

```js
test("pfo_complete: red when an overdue phantom-FO exists", () => {
  const res = audit.runCredibilityAudit(baseInput({ phantomSuggestions: [{ sku: "X", overdue: true }] }));
  assert.equal(find(res, "pfo_complete").status, "red");
});
test("pfo_complete: green with no overdue suggestions", () => {
  const res = audit.runCredibilityAudit(baseInput({ phantomSuggestions: [{ sku: "X", overdue: false }] }));
  assert.equal(find(res, "pfo_complete").status, "green");
});
test("fo_plausible: red when a stored FO has units<=0 or delivery before order", () => {
  const res = audit.runCredibilityAudit(baseInput({
    state: { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: {}, products: [], provenance: {},
             fos: [{ id: "fo-1", units: 0, orderDate: "2026-06-10", deliveryDate: "2026-06-01" }] },
  }));
  assert.equal(find(res, "fo_plausible").status, "red");
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

```js
function checkPfoComplete(phantomSuggestions) {
  const overdue = (phantomSuggestions || []).filter((s) => s && s.overdue === true);
  return {
    key: "pfo_complete", label: "PFOs vollständig",
    status: overdue.length ? "red" : "green",
    detail: overdue.length ? `${overdue.length} überfällige Bestellvorschläge offen` : "Keine überfälligen PFOs",
    drill: "#/v2/orders/po",
  };
}
function checkFoPlausible(state) {
  const fos = Array.isArray(state?.fos) ? state.fos : [];
  const bad = fos.filter((f) => {
    if (!f) return false;
    const units = Number(f.units);
    if (Number.isFinite(units) && units <= 0) return true;
    const od = f.orderDate ? new Date(f.orderDate) : null;
    const dd = f.deliveryDate ? new Date(f.deliveryDate) : null;
    return od && dd && !Number.isNaN(od) && !Number.isNaN(dd) && dd.getTime() < od.getTime();
  });
  return {
    key: "fo_plausible", label: "FOs plausibel",
    status: bad.length ? "red" : "green",
    detail: bad.length ? `${bad.length} FO(s) mit unplausibler Menge/Datum` : "Alle FOs plausibel",
    drill: "#/v2/orders/fo",
  };
}
// CHECK_BUILDERS: ..., ({phantomSuggestions}) => checkPfoComplete(phantomSuggestions),
//                 ({state}) => checkFoPlausible(state),
```

- [ ] **Step 4: PASS.** **Step 5: Commit** — `git commit -am "feat(audit): pfo_complete + fo_plausible checks"`

### Task 6: Checks `revenue_realistic` + `balance_sane` + `bucket_sums`

**Files:** Modify `credibilityAudit.js`, test file.

- [ ] **Step 1: Failing tests** (append)

```js
test("revenue_realistic: amber when no actuals", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, kpis: { actuals: { avgRevenueDeltaPct: null } } } }));
  assert.equal(find(res, "revenue_realistic").status, "amber");
});
test("revenue_realistic: red when avg deviation beyond 40%", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, kpis: { actuals: { avgRevenueDeltaPct: -55 } } } }));
  assert.equal(find(res, "revenue_realistic").status, "red");
});
test("balance_sane: red when a closing balance is NaN", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, breakdown: [{ month: "2026-06", closing: NaN }] } }));
  assert.equal(find(res, "balance_sane").status, "red");
});
test("balance_sane: amber when a future month goes negative", () => {
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, firstNegativeMonth: "2026-09", breakdown: [{ month: "2026-06", closing: 1000 }] } }));
  assert.equal(find(res, "balance_sane").status, "amber");
});
test("bucket_sums: red when a sales-payout inflow lacks a bucket", () => {
  const series = [{ month: "2026-06", inflow: { total: 100 }, outflow: { total: 0 }, net: { total: 100 },
    entries: [{ kind: "sales-payout", direction: "in", amount: 100, portfolioBucket: null }] }];
  const res = audit.runCredibilityAudit(baseInput({ report: { ...baseInput().report, series } }));
  assert.equal(find(res, "bucket_sums").status, "red");
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement**

```js
function checkRevenueRealistic(report, thr) {
  const v = report?.kpis?.actuals?.avgRevenueDeltaPct;
  if (!Number.isFinite(v)) return { key: "revenue_realistic", label: "Umsatz realistisch", status: "amber",
    detail: "Noch keine Ist-Daten zum Abgleich", drill: "#/v2/soll-ist" };
  const abs = Math.abs(v);
  const status = abs <= thr.revenueRealisticPct.green ? "green" : abs <= thr.revenueRealisticPct.amber ? "amber" : "red";
  return { key: "revenue_realistic", label: "Umsatz realistisch", status,
    detail: `ø Forecast-vs-Ist ${v > 0 ? "+" : ""}${v.toFixed(1)} %`, drill: "#/v2/soll-ist" };
}
function checkBalanceSane(report) {
  const rows = Array.isArray(report?.breakdown) ? report.breakdown : [];
  const nan = rows.some((r) => !Number.isFinite(Number(r?.closing)));
  if (nan) return { key: "balance_sane", label: "Kontostand belastbar", status: "red",
    detail: "Ungültiger (NaN) Kontostand in der Projektion", drill: "#/v2/dashboard" };
  const neg = report?.firstNegativeMonth || null;
  return { key: "balance_sane", label: "Kontostand belastbar", status: neg ? "amber" : "green",
    detail: neg ? `Negativer Kontostand ab ${neg}` : "Kontostand-Kette durchgehend positiv", drill: "#/v2/dashboard" };
}
function checkBucketSums(report) {
  const rows = Array.isArray(report?.series) ? report.series : [];
  let unbucketed = 0;
  rows.forEach((row) => (row?.entries || []).forEach((e) => {
    if (String(e?.kind || "") === "sales-payout" && String(e?.direction || "") === "in"
        && Number(e?.amount || 0) > 0 && !(e?.portfolioBucket || e?.meta?.portfolioBucket)) unbucketed += 1;
  }));
  return { key: "bucket_sums", label: "Bucket-Integrität", status: unbucketed ? "red" : "green",
    detail: unbucketed ? `${unbucketed} Forecast-Umsatz-Positionen ohne Bucket` : "Alle Forecast-Umsätze einem Bucket zugeordnet",
    drill: "#/v2/methodik" };
}
// CHECK_BUILDERS erweitern um die drei (revenue_realistic, balance_sane, bucket_sums).
```

- [ ] **Step 4: PASS.** **Step 5: Commit** — `git commit -am "feat(audit): revenue_realistic + balance_sane + bucket_sums checks"`

### Task 7: Check `provenance_coverage` + overall-Kappung

**Files:** Modify `credibilityAudit.js`, test file.

- [ ] **Step 1: Failing tests** (append)

```js
test("provenance_coverage: red coverage cannot push overall to red (capped at amber)", () => {
  const state = { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: { versions: [{ id: "v", createdAt: "2026-05-25T00:00:00Z" }], activeVersionId: "v" },
    products: [{ sku: "A" }, { sku: "B" }], fos: [], provenance: {} }; // 0% coverage
  const res = audit.runCredibilityAudit(baseInput({ state }));
  assert.equal(find(res, "provenance_coverage").status, "amber"); // displayed amber (capped from red)
  assert.notEqual(res.overall, "red"); // coverage alone must not make overall red
});
test("provenance_coverage: green at >=80% stamped", () => {
  const state = { inventory: { snapshots: [{ month: "2026-06" }] }, forecast: {}, fos: [],
    products: [{ sku: "A" }, { sku: "B" }, { sku: "C" }, { sku: "D" }, { sku: "E" }],
    provenance: { "product:A": {}, "product:B": {}, "product:C": {}, "product:D": {} } }; // 4/5 = 80%
  const res = audit.runCredibilityAudit(baseInput({ state }));
  assert.equal(find(res, "provenance_coverage").status, "green");
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — note: cap happens in `deriveOverall` (already coded for `provenance_coverage`); here the *displayed* status is also capped to amber so UI and overall agree.

```js
import { entityKey } from "./provenanceRules.js"; // ergänzen am Dateikopf

function checkProvenanceCoverage(state, thr) {
  const prov = state?.provenance && typeof state.provenance === "object" ? state.provenance : {};
  const keys = [];
  (Array.isArray(state?.products) ? state.products : []).forEach((p) => p?.sku && keys.push(entityKey("product", p.sku)));
  (Array.isArray(state?.pos) ? state.pos : []).forEach((p) => p?.id && keys.push(entityKey("po", p.id)));
  (Array.isArray(state?.fos) ? state.fos : []).forEach((f) => f?.id && keys.push(entityKey("fo", f.id)));
  const total = keys.length;
  const stamped = keys.filter((k) => prov[k]).length;
  const pct = total ? Math.round((stamped / total) * 100) : 100;
  const raw = pct >= thr.provenanceCoveragePct.green ? "green" : pct >= thr.provenanceCoveragePct.amber ? "amber" : "red";
  return { key: "provenance_coverage", label: "Herkunft hinterlegt",
    status: raw === "red" ? "amber" : raw, // Anzeige max. amber (nur Info)
    detail: `${stamped}/${total} Entitäten mit Herkunft (${pct} %)`, drill: "#/v2/dashboard" };
}
// CHECK_BUILDERS: ..., ({state, thresholds}) => checkProvenanceCoverage(state, thresholds),
```

- [ ] **Step 4: PASS** — Gesamt 8 Checks, alle grün/amber/rot getestet.
- [ ] **Step 5: Commit** — `git commit -am "feat(audit): provenance_coverage check + overall capping"`

### Task 8: CLI-Runner `audit.mjs` (vite-SSR lädt echte Engine) + Verdrahtung in `cli.mjs`

**Files:**
- Create: `tools/fba-cli/audit.mjs`
- Modify: `tools/fba-cli/cli.mjs`

- [ ] **Step 1: Implement Runner** — lädt Engine wie die Parity-Tests, berechnet report + phantomSuggestions, ruft die reine Audit-Funktion, druckt Report; mit `--write` committet `state.audit`.

```js
// tools/fba-cli/audit.mjs
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
    const months = eng.resolvePlanningMonthsFromState(state);
    const phantomSuggestions = eng.buildPhantomFoSuggestions({ state, months });
    const result = eng.runCredibilityAudit({ state, report, phantomSuggestions, now });

    const icon = { green: "🟢", amber: "🟡", red: "🔴" };
    console.log(`\n${icon[result.overall]} Glaubwürdigkeit gesamt: ${result.overall.toUpperCase()}  (${result.lastRun})`);
    for (const c of result.checks) console.log(`  ${icon[c.status]} ${c.label}: ${c.detail}`);

    if (commit) {
      const res = await commitState(cfg, (s) => { s.audit = result; }, { dryRun: false, label: "audit", validateFn: validateState });
      console.log(`\n[COMMITTED] state.audit aktualisiert · rev ${res.rev} · Backup ${res.backupFile}`);
    } else {
      console.log("\n[DRY] state.audit nicht geschrieben (mit --commit schreiben).");
    }
    return result;
  } finally {
    await eng.server.close();
  }
}
```

- [ ] **Step 2: Verdrahten in `cli.mjs`** — Import + Kommando.

```js
// oben bei den Imports:
import { runAudit } from "./audit.mjs";

// im Help-Block ergänzen:
"  audit [--commit]              Glaubwürdigkeits-Ampel berechnen (Default Dry, --commit schreibt state.audit)",

// vor den Schreib-Kommandos (lesend, daher hier ok):
if (cmd === "audit") {
  await runAudit({ commit: Boolean(flags.commit), workspaceId: flags.workspace });
  return;
}
```

- [ ] **Step 3: Manuell verifizieren (Dry)** — Run: `node tools/fba-cli/cli.mjs audit`
Expected: Ampel-Zeilen für alle 8 Checks, „[DRY] …", kein Write. (Erwartung gegen Live-State: `snapshot_fresh` grün, `forecast_current` grün/amber, `revenue_realistic` je nach Ist-Daten.)

- [ ] **Step 4: Manuell verifizieren (Write)** — Run: `node tools/fba-cli/cli.mjs audit --commit`
Expected: „[COMMITTED] state.audit aktualisiert · rev …". Danach `node tools/fba-cli/cli.mjs get state --out /tmp/s.json` und prüfen, dass `audit.overall` + `audit.checks` vorhanden sind.

- [ ] **Step 5: Commit**

```bash
git add tools/fba-cli/audit.mjs tools/fba-cli/cli.mjs
git commit -m "feat(cli): audit command — Glaubwürdigkeits-Ampel via echte Engine (vite-SSR)"
```

---

## PHASE 3 — Provenienz-Stempel + Änderungs-Log (jeder Write hinterlässt Spur)

### Task 9: `commitState` stempelt Provenienz + changeLog

**Files:**
- Modify: `tools/fba-cli/client.mjs`
- Test: `tests/v2/provenance-rules.parity.test.cjs` (erweitern — testet die reine Stempel-Logik, die wir in `provenanceRules.js` als Helfer auslagern, damit sie ohne DB testbar ist)

Begründung: Die eigentliche Stempel-Mutation als **pure Helfer** in `provenanceRules.js` (`applyProvenance(state, {entityKeys, source, by, method, rev, summary, label, now})`), damit testbar; `commitState` ruft sie nur auf.

- [ ] **Step 1: Failing test** (append zu provenance-rules-Test)

```js
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
```

- [ ] **Step 2: Run, verify FAIL** (`applyProvenance is not a function`).

- [ ] **Step 3: Implement helper in `provenanceRules.js`**

```js
const CHANGELOG_CAP = 100;
export function applyProvenance(state, { entityKeys = [], source, by = "claude", method = "", rev = null, label = "", summary = "", nowIso }) {
  if (!state || typeof state !== "object") return state;
  if (!state.provenance || typeof state.provenance !== "object") state.provenance = {};
  if (!Array.isArray(state.changeLog)) state.changeLog = [];
  const at = nowIso || new Date().toISOString();
  for (const key of entityKeys) {
    if (!key) continue;
    state.provenance[key] = { source: source || null, asOf: at, by, method, rev };
  }
  state.changeLog.push({ at, by, label, source: source || null, rev, summary });
  if (state.changeLog.length > CHANGELOG_CAP) state.changeLog = state.changeLog.slice(-CHANGELOG_CAP);
  return state;
}
```

- [ ] **Step 4: Run, verify PASS** — `node --test tests/v2/provenance-rules.parity.test.cjs`.

- [ ] **Step 5: Wire into `commitState`** — in `tools/fba-cli/client.mjs`: nach dem Anwenden von `mutate(draft)` und sobald der neue `rev` feststeht, falls `opts.provenance` gesetzt ist, `applyProvenance(draft, {...opts.provenance, rev, nowIso})` aufrufen **bevor** geschrieben wird. (Import `applyProvenance` aus `../../src/domain/provenanceRules.js` — Achtung: `client.mjs` ist Node-ESM; `provenanceRules.js` ist reines ESM ohne Abhängigkeiten → direkter Import funktioniert. Falls der Node-ESM-Import von `.js` im Repo nicht greift, eine 1:1-Kopie als `tools/fba-cli/provenance.mjs` anlegen — wie bei `validate.mjs` — und daraus importieren.)

```js
// client.mjs (Skizze der Einbindung in commitState):
import { applyProvenance } from "./provenance.mjs"; // ggf. .mjs-Kopie, s.o.
// ... nachdem draft mutiert und der ziel-rev bekannt ist:
if (opts && opts.provenance) {
  applyProvenance(draft, { ...opts.provenance, rev: targetRev, nowIso: new Date().toISOString() });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/domain/provenanceRules.js tools/fba-cli/client.mjs tools/fba-cli/provenance.mjs tests/v2/provenance-rules.parity.test.cjs
git commit -m "feat(provenance): applyProvenance helper + commitState stamping + changeLog"
```

### Task 10: CLI-Kommandos reichen Provenienz durch + Backfill-Kommando

**Files:** Modify `tools/fba-cli/cli.mjs`

- [ ] **Step 1: `set-setting` / `rm` / `apply` mit `--source`** — Default `source="claude"`, `by="claude"`. Beispiel `set-setting`:

```js
// in cli.mjs set-setting:
const res = await commitState(cfg, (state) => { setSetting(state, dottedPath, value); },
  { dryRun, force, label: `set-${dottedPath}`, validateFn: validateState,
    provenance: { entityKeys: [`setting:${dottedPath}`], source: flags.source || "human", by: "claude",
                  method: "cli-set-setting", label: `set-${dottedPath}`, summary: `${dottedPath}=${JSON.stringify(value)}` } });
```

(Analog für `rm` mit `entityKeys: [\`${collection}:${id}\`]`, `method: "cli-rm"`; für `apply` `entityKeys: []`, `method: "cli-apply-<patchname>"`, da generisch.)

- [ ] **Step 2: Backfill-Kommando `provenance-backfill`** — best-effort Stempel für bekannte Quellen, falls noch kein Stempel existiert.

```js
if (cmd === "provenance-backfill") {
  const res = await commitState(cfg, (state) => {
    if (!state.provenance) state.provenance = {};
    const stamp = (key, source, method) => { if (!state.provenance[key]) state.provenance[key] = { source, asOf: null, by: "backfill", method, rev: null }; };
    (state.products || []).forEach((p) => p.sku && stamp(`product:${p.sku}`, "vo", "backfill"));
    (state.pos || []).forEach((p) => p.id && stamp(`po:${p.id}`, "vo", "backfill"));
    (state.fos || []).forEach((f) => f.id && stamp(`fo:${f.id}`, "computed", "backfill"));
  }, { dryRun: !flags.commit, force, label: "provenance-backfill", validateFn: validateState });
  reportWrite(res, !flags.commit, { change: "provenance backfill (best-effort)" });
  return;
}
```

- [ ] **Step 3: Manuell verifizieren** — `node tools/fba-cli/cli.mjs provenance-backfill` (Dry) zeigt geänderten State; mit `--commit` schreiben; danach `audit` erneut → `provenance_coverage` steigt.

- [ ] **Step 4: Commit** — `git add tools/fba-cli/cli.mjs && git commit -m "feat(cli): provenance pass-through + provenance-backfill"`

---

## PHASE 4 — UI: Ampel-Header + Herkunfts-Badge + Änderungs-Log (read-only, additiv)

> Hinweis: V2-UI liest den State aus dem Workspace-Store. `state.audit` / `state.provenance` sind additiv — wenn leer, rendern die Komponenten einen neutralen „noch nicht geprüft"-Zustand.

### Task 11: `CredibilityBadge` Komponente + Einbau ins Dashboard

**Files:**
- Create: `src/v2/components/CredibilityBadge.tsx`
- Modify: `src/v2/modules/dashboard/index.tsx`

- [ ] **Step 1: Komponente**

```tsx
// src/v2/components/CredibilityBadge.tsx
import { Alert, Collapse, Tag, Typography } from "antd";

type Check = { key: string; label: string; status: "green" | "amber" | "red"; detail: string; drill?: string };
type Audit = { lastRun?: string; overall?: "green" | "amber" | "red"; checks?: Check[] } | null | undefined;

const COLOR = { green: "green", amber: "gold", red: "red" } as const;
const ALERT = { green: "success", amber: "warning", red: "error" } as const;

export function CredibilityBadge({ audit }: { audit: Audit }) {
  if (!audit || !audit.overall) {
    return <Alert type="info" showIcon message="Glaubwürdigkeit: noch nicht geprüft" description="Audit per CLI oder wöchentlichem Task ausführen." style={{ marginBottom: 12 }} />;
  }
  const checks = Array.isArray(audit.checks) ? audit.checks : [];
  const greens = checks.filter((c) => c.status === "green").length;
  const when = audit.lastRun ? new Date(audit.lastRun).toLocaleString("de-DE") : "—";
  return (
    <Alert
      type={ALERT[audit.overall]} showIcon style={{ marginBottom: 12 }}
      message={<span>Glaubwürdigkeit: <strong>{audit.overall.toUpperCase()}</strong> · {greens}/{checks.length} grün · geprüft {when}</span>}
      description={
        <Collapse ghost items={[{ key: "c", label: "Checks anzeigen", children: (
          <div>{checks.map((c) => (
            <div key={c.key} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
              <Tag color={COLOR[c.status]}>{c.label}</Tag><Typography.Text type="secondary">{c.detail}</Typography.Text>
            </div>))}
          </div>) }]} />
      } />
  );
}
```

- [ ] **Step 2: Einbau** — in `src/v2/modules/dashboard/index.tsx` nahe der obersten Überschrift (`<Title level={3}>Dashboard</Title>`, ~Z. 1912) den Badge einsetzen, gespeist aus dem State, der dort bereits geladen ist (denselben State-Zugriff wie für `computeSeries`/`robustness` verwenden — `state.audit`):

```tsx
import { CredibilityBadge } from "../../components/CredibilityBadge";
// im Render, direkt unter dem Title:
<CredibilityBadge audit={(state as any)?.audit} />
```

- [ ] **Step 3: Build verifizieren** — Run: `npm run build` → Expected: „✓ built" ohne TS-Fehler.

- [ ] **Step 4: Visuell verifizieren** — App laden (Chrome, Dashboard); Badge zeigt nach einem `audit --commit` die Ampel + aufklappbare Checks. (Falls `state.audit` leer: „noch nicht geprüft".)

- [ ] **Step 5: Commit** — `git add src/v2/components/CredibilityBadge.tsx src/v2/modules/dashboard/index.tsx && git commit -m "feat(ui): Glaubwürdigkeits-Ampel auf dem Dashboard"`

### Task 12: `ProvenanceTag` + Einbau in Forecast-/Produkt-Tabellen

**Files:**
- Create: `src/v2/components/ProvenanceTag.tsx`
- Modify: `src/v2/modules/forecast/index.tsx`, `src/v2/modules/products/index.tsx`

- [ ] **Step 1: Komponente**

```tsx
// src/v2/components/ProvenanceTag.tsx
import { Tooltip, Typography } from "antd";

type Entry = { source?: string; asOf?: string | null; by?: string; method?: string } | undefined;
const LABEL: Record<string, string> = { vo: "VentoryOne", sellerboard: "Sellerboard", holvi: "Holvi", bwa: "BWA", claude: "Claude", human: "manuell", computed: "berechnet" };

export function ProvenanceTag({ entry }: { entry: Entry }) {
  if (!entry || !entry.source) return <Typography.Text type="secondary" style={{ fontSize: 11 }}>Herkunft unbekannt</Typography.Text>;
  const when = entry.asOf ? new Date(entry.asOf).toLocaleDateString("de-DE") : "—";
  return (
    <Tooltip title={`Quelle: ${LABEL[entry.source] || entry.source} · Stand ${when} · von ${entry.by || "—"}${entry.method ? ` · ${entry.method}` : ""}`}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>Herkunft: {LABEL[entry.source] || entry.source} · {when}</Typography.Text>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Einbau Produkte** — in `src/v2/modules/products/index.tsx` eine kleine Spalte/Zelle ergänzen, die `state.provenance[\`product:\${row.sku}\`]` an `ProvenanceTag` gibt. Wo der State im Modul verfügbar ist (derselbe Zugriff wie `poSkuSet`), eine Map `provenance` ableiten und in der SKU-Zelle unter dem Alias rendern.

```tsx
import { ProvenanceTag } from "../../components/ProvenanceTag";
// in der SKU/Alias-Zelle:
<ProvenanceTag entry={(state as any)?.provenance?.[`product:${row.original.sku}`]} />
```

- [ ] **Step 3: Einbau Forecast** — analog in `src/v2/modules/forecast/index.tsx` in der Alias-Spalte: `provenance[\`forecastImport:\${sku}\`] ?? provenance[\`product:\${sku}\`]`.

- [ ] **Step 4: Build verifizieren** — `npm run build` → „✓ built".

- [ ] **Step 5: Commit** — `git add src/v2/components/ProvenanceTag.tsx src/v2/modules/products/index.tsx src/v2/modules/forecast/index.tsx && git commit -m "feat(ui): Herkunfts-Badge an Produkt-/Forecast-Zeilen"`

### Task 13: Änderungs-Log-Ansicht (read-only)

**Files:**
- Modify: `src/v2/modules/methodik/index.tsx` (oder neuer Tab — MVP: als Card in Methodik, da dort schon „hinter die Kulissen"-Inhalte sind)

- [ ] **Step 1: Card** — eine Tabelle der letzten `state.changeLog`-Einträge (Zeit, Label, Quelle, rev, summary), absteigend.

```tsx
// in methodik/index.tsx, neue Card:
const log = Array.isArray((state as any)?.changeLog) ? [...(state as any).changeLog].reverse() : [];
<Card size="small" title="Änderungs-Log (letzte Writes)">
  <table style={{ width: "100%", fontSize: 12 }}>
    <thead><tr><th>Zeit</th><th>Was</th><th>Quelle</th><th>rev</th></tr></thead>
    <tbody>{log.slice(0, 30).map((e: any, i: number) => (
      <tr key={i}><td>{e.at ? new Date(e.at).toLocaleString("de-DE") : "—"}</td><td>{e.label} {e.summary ? `· ${e.summary}` : ""}</td><td>{e.source || "—"}</td><td>{String(e.rev || "").slice(0, 8)}</td></tr>))}
    </tbody>
  </table>
</Card>
```

- [ ] **Step 2: Build verifizieren** — `npm run build`.
- [ ] **Step 3: Commit** — `git add src/v2/modules/methodik/index.tsx && git commit -m "feat(ui): Änderungs-Log-Ansicht (read-only)"`

---

## PHASE 5 — Wöchentlicher Auto-Audit + Telegram-Report

### Task 14: Telegram-Helfer

**Files:**
- Create: `tools/fba-cli/notify-telegram.mjs`

- [ ] **Step 1: Implement** — lädt Keys aus `~/.pierre-keys.env` (Pattern wie `build-snapshot-from-ventory.mjs`), sendet an Mahona-Gruppe.

```js
// tools/fba-cli/notify-telegram.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
function loadEnv() {
  const f = path.join(os.homedir(), ".pierre-keys.env");
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("="); if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
export async function sendTelegram(text) {
  loadEnv();
  const token = process.env.TELEGRAM_MAHONA_BOT_TOKEN, chat = process.env.TELEGRAM_MAHONA_GROUP_ID;
  if (!token || !chat) throw new Error("Telegram-Keys fehlen (TELEGRAM_MAHONA_BOT_TOKEN/GROUP_ID).");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }) });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return true;
}
```

- [ ] **Step 2: Manuell verifizieren** — kleines Inline-Skript: `node -e "import('./tools/fba-cli/notify-telegram.mjs').then(m=>m.sendTelegram('CFP-Audit Testnachricht'))"` → Nachricht erscheint in der Mahona-Gruppe. (Vorsicht: das versendet real — nur zum Verifizieren, sonst überspringen.)

- [ ] **Step 3: Commit** — `git add tools/fba-cli/notify-telegram.mjs && git commit -m "feat(cli): Telegram-Helfer (Mahona-Gruppe)"`

### Task 15: Wochen-Wrapper-Skript + `runAudit` liefert Report-Text

**Files:**
- Modify: `tools/fba-cli/audit.mjs` (Report-Text als Rückgabe ergänzen)
- Create: `tools/fba-cli/weekly-audit.sh`

- [ ] **Step 1: `runAudit` gibt zusätzlich `reportText` zurück** — in `audit.mjs` den Klartext sammeln und im Rückgabeobjekt mitgeben:

```js
// in runAudit, statt nur console.log: zusätzlich aufbauen
const icon = { green: "🟢", amber: "🟡", red: "🔴" };
const lines = [`${icon[result.overall]} <b>CFP-Glaubwürdigkeit: ${result.overall.toUpperCase()}</b>`];
for (const c of result.checks) lines.push(`${icon[c.status]} ${c.label}: ${c.detail}`);
const reportText = lines.join("\n");
console.log("\n" + reportText.replace(/<\/?b>/g, ""));
// ... return { ...result, reportText };
return { ...result, reportText };
```

- [ ] **Step 2: Wrapper-Skript**

```bash
#!/usr/bin/env bash
# tools/fba-cli/weekly-audit.sh — wöchentlicher Glaubwürdigkeits-Audit + Telegram-Report.
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/fba-cli/cli.mjs audit --commit
node -e "import('./tools/fba-cli/audit.mjs').then(async m => { const r = await m.runAudit({}); const t = await import('./tools/fba-cli/notify-telegram.mjs'); await t.sendTelegram(r.reportText); console.log('Telegram gesendet.'); })"
```

- [ ] **Step 3: Ausführbar + manuell testen** — `chmod +x tools/fba-cli/weekly-audit.sh` und einmal `bash tools/fba-cli/weekly-audit.sh` → commit von `state.audit` + Telegram in der Mahona-Gruppe.

- [ ] **Step 4: Commit** — `git add tools/fba-cli/audit.mjs tools/fba-cli/weekly-audit.sh && git commit -m "feat(cli): weekly-audit Wrapper + Telegram-Report"`

### Task 16: Scheduled-Task (Montag 07:00) registrieren

**Files:** keine (MCP `scheduled-tasks`)

- [ ] **Step 1: Task anlegen** — via `mcp__scheduled-tasks__create_scheduled_task`: wöchentlich Montag 07:00 Europe/Berlin, Aktion „CFP-Glaubwürdigkeits-Audit": führt `bash tools/fba-cli/weekly-audit.sh` im Repo aus (analog zum bestehenden Monats-Snapshot-Task). Beschreibung + Prompt so, dass bei `overall != green` zusätzlich ein kurzer Klartext-Hinweis kommt, was rot/amber ist.

- [ ] **Step 2: Verifizieren** — `mcp__scheduled-tasks__list_scheduled_tasks` zeigt den neuen Task; einmal manuell triggern und Telegram-Eingang prüfen.

- [ ] **Step 3: Doku** — In `docs/operating-model/herkunfts-ledger.md` einen Abschnitt „Kadenz" ergänzen (wöchentl. Audit Mo 07:00, monatl. Snapshot 1.) und in der Obsidian-Deep-Reference (`Amazon FBA Cashflow Planner - Deep Reference.md`) §13 (CLI) um das `audit`-Verb + die Ampel ergänzen. Commit.

```bash
git add docs/operating-model/herkunfts-ledger.md
git commit -m "docs: Audit-Kadenz + CLI-audit dokumentiert"
```

---

## Abschluss

- [ ] **Volle Parity-Suite grün** — Run: `node --test tests/v2/provenance-rules.parity.test.cjs tests/v2/credibility-audit.parity.test.cjs tests/v2/discontinued-sellthrough.parity.test.cjs` (+ bestehende Suite) → alle PASS (vorbestehender phantom-fo #452-Flake ausgenommen, separat getrackt).
- [ ] **Build grün** — `npm run build`.
- [ ] **Push + Deploy** — `git push origin main` (Vercel Auto-Deploy); Live-Verifikation: Dashboard zeigt Ampel, Produkte/Forecast zeigen Herkunfts-Badges.

---

## Self-Review (gegen die Spec)

- **Spec-Abdeckung:** A-Regelwerk → Task 1+2. B-Provenienz → Task 9+10. C-Audit (8 Checks, `state.audit`, CLI, Report) → Task 3–8, 14–16. D-UI (Ampel/Badge/Log) → Task 11–13. Festgelegte Parameter (Schwellen/overall-Kappung/entityKey/changeLog/Report-Kanal/Kadenz/MVP-Set) → in Task 1, 7, 9, 14–16 abgebildet. ✓
- **Phase-2-Abgrenzung:** `revenue_reconciled`/`payments_matched` bewusst NICHT enthalten (Spec: Phase 2). ✓
- **Placeholders:** keine „TBD/TODO"; jeder Code-Step zeigt echten Code; Test-Code vollständig. Einzige bewusste Nicht-Determinismen sind manuelle Verifikations-Steps für CLI-Runner/UI/Telegram/Scheduled (im Repo gibt es dafür kein etabliertes Auto-Test-Pattern) — dort sind exakte Befehle + erwartete Beobachtung angegeben.
- **Typ-Konsistenz:** `runCredibilityAudit({state, report, phantomSuggestions, now, thresholds})`, Check-Form `{key,label,status,detail,drill}`, `applyProvenance(state, {entityKeys,source,by,method,rev,label,summary,nowIso})`, `state.audit/{lastRun,by,overall,checks}`, `entityKey(type,id)` — durchgehend identisch verwendet. ✓
- **Bekanntes Risiko:** Node-ESM-Import von `src/domain/provenanceRules.js` aus `client.mjs` — Fallback (1:1-`.mjs`-Kopie wie `validate.mjs`) ist in Task 9 Step 5 vorgesehen. Feldname des Forecast-Baseline-Datums (`createdAt`/`baselineCreatedAt`/`importedAt`) defensiv mehrfach probiert (Task 4) — Implementer prüft den realen Ort einmal gegen den Live-State.

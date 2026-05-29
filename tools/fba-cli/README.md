# FBA Cashflow CLI

Dünner, abhängigkeitsfreier Node-Client (ESM) über die **vorhandenen** Supabase-RPCs des FBA-Cashflow-Tools.
Erlaubt Lesen/Schreiben aller Inhalte (Stammdaten, PO, FO, Fixkosten, Settings …) per Skript/Kommandozeile —
ohne den Umweg über die Browser-UI.

## Wie es funktioniert (Kurz)

- **Single Source of Truth** ist `workspace_state.state_json`. Die Einzeltabellen (`products`, `pos`, …) sind
  materialisierte Spiegel.
- **Lesen:** direkter PostgREST-Select auf `workspace_state` (+ `workspace_meta` für `rev`). service_role umgeht RLS.
- **Schreiben:** immer Read-Modify-Write des kompletten States über RPC **`app_sync(workspace_id, user_id, if_match_rev, state)`**.
  Diese RPC re-materialisiert alle Tabellen, setzt `rev` + Changelog, löst Realtime aus.
  **Nie roh in Tabellen schreiben.**
- **Optimistic Concurrency** über `rev`: bei `REV_MISMATCH` lädt der Client neu und wendet den Patch erneut an.
- **Sicherheit:** jedes echte Schreiben (`--commit`) schreibt vorher ein Backup nach `~/.fba-cli-backups/`.
  Default ist **Dry-Run**. Validierungsfehler blockieren den Write (Override mit `--force`).

## Setup

`~/.pierre-keys.env` ergänzen:

```
# --- FBA CASHFLOW (SUPABASE) ---
FBA_SUPABASE_URL=https://kpjkymvyypbstehqqcph.supabase.co
FBA_SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
```

Den `service_role`-Key gibt es in Supabase → Projekt `amazon-fba-cashflow-prod` →
Project Settings → API → "Project API keys" → `service_role` (`secret`).
⚠️ God-Key: nie loggen, nie committen, nur in `~/.pierre-keys.env`.

## Kommandos

```
node tools/fba-cli/cli.mjs status
node tools/fba-cli/cli.mjs get products [--out datei.json]
node tools/fba-cli/cli.mjs get state --out backup.json
node tools/fba-cli/cli.mjs find products sku PO-6TKA-Q0VA
node tools/fba-cli/cli.mjs validate
node tools/fba-cli/cli.mjs backup
node tools/fba-cli/cli.mjs apply ./patch.mjs            # Dry-Run (zeigt Diff)
node tools/fba-cli/cli.mjs apply ./patch.mjs --commit   # schreibt (mit Backup)
node tools/fba-cli/cli.mjs set-setting safetyStockDohDefault 70 --commit
node tools/fba-cli/cli.mjs rm fos fo-xxxxxxx --commit
```

## Patch-Skript (für komplexere Mutationen)

```js
// patch.mjs
export default async function (state, h) {
  // h = alle Helfer aus entities.mjs
  h.upsertProduct(state, { sku: "029.003-TAMPER-LEATHER", landedUnitCostEur: 5.10 });
  h.addFo(state, { sku: "PO-6TKA-Q0VA", units: 500, supplierId: "sup-7aco79f" });
  h.setSetting(state, "fxRate", 1.19);
}
```

Erst `apply ./patch.mjs` (Dry-Run, zeigt geänderte Zähler + Validierung), dann mit `--commit`.

## Offline-Test (ohne Key/Netz)

`node tools/fba-cli/selftest.mjs <backup.json>` lädt ein exportiertes State-JSON,
läuft Validator + Beispiel-Mutationen rein in-memory durch. Gut zum Verifizieren der Logik.

## Bekannte Schuld

`validate.mjs` ist eine 1:1-Portierung von `validateState()` aus
`src/v2/modules/export-import/WorkspaceTransferPanel.tsx`. Sauberer wäre, diese Funktion dort in ein
framework-freies Modul zu extrahieren und in beiden zu importieren (kein Drift). TODO.

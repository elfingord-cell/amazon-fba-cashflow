// FBA Cashflow CLI — Supabase-Client (service_role).
//
// Lesemodell: direkter PostgREST-Select auf workspace_state/_meta/_members (service_role umgeht RLS).
// Schreibmodell: IMMER über RPC app_sync(p_workspace_id, p_user_id, p_if_match_rev, p_state).
//   Diese RPC ersetzt state_json, MATERIALISIERT alle Einzeltabellen neu (app_materialize_state),
//   setzt rev + Changelog und löst Realtime aus. NIEMALS roh in die Tabellen schreiben.
//
// Optimistic Concurrency: app_sync verlangt p_if_match_rev == aktueller rev, sonst REV_MISMATCH
//   → der Client lädt neu und der Aufrufer muss den Patch erneut anwenden.

import fs from "node:fs";
import path from "node:path";
import { getConfig, backupDir } from "./config.mjs";

function headers(cfg, extra = {}) {
  return {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    "Content-Type": "application/json",
    "X-Client-Info": "fba-cli",
    ...extra,
  };
}

async function rest(cfg, pathAndQuery, options = {}) {
  const res = await fetch(`${cfg.url}/rest/v1${pathAndQuery}`, {
    method: options.method || "GET",
    headers: headers(cfg, options.headers),
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!res.ok) {
    const msg = payload?.message || payload?.error || payload?.hint || `HTTP ${res.status}`;
    const err = new Error(`Supabase REST ${res.status}: ${msg}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export async function rpc(cfg, fn, params = {}) {
  const payload = await rest(cfg, `/rpc/${fn}`, { method: "POST", body: params });
  return Array.isArray(payload) ? (payload[0] ?? null) : payload;
}

// --- Lesen ---------------------------------------------------------------

export async function loadState(cfg) {
  const stateRows = await rest(
    cfg,
    `/workspace_state?workspace_id=eq.${cfg.workspaceId}&select=state_json,updated_at`,
  );
  const metaRows = await rest(
    cfg,
    `/workspace_meta?workspace_id=eq.${cfg.workspaceId}&select=rev,updated_at`,
  );
  const stateRow = Array.isArray(stateRows) ? stateRows[0] : null;
  const metaRow = Array.isArray(metaRows) ? metaRows[0] : null;
  if (!stateRow) {
    throw new Error(`Kein workspace_state für Workspace ${cfg.workspaceId} gefunden.`);
  }
  return {
    state: stateRow.state_json || {},
    rev: metaRow?.rev ?? null,
    updatedAt: metaRow?.updated_at ?? stateRow.updated_at ?? null,
  };
}

export async function resolveUserId(cfg) {
  if (process.env.FBA_USER_ID) return process.env.FBA_USER_ID.trim();
  const owner = await rest(
    cfg,
    `/workspace_members?workspace_id=eq.${cfg.workspaceId}&role=eq.owner&select=user_id&limit=1`,
  );
  if (Array.isArray(owner) && owner[0]?.user_id) return owner[0].user_id;
  const any = await rest(
    cfg,
    `/workspace_members?workspace_id=eq.${cfg.workspaceId}&select=user_id&limit=1`,
  );
  if (Array.isArray(any) && any[0]?.user_id) return any[0].user_id;
  throw new Error(`Kein workspace_member für Workspace ${cfg.workspaceId} gefunden (kein user_id für app_sync).`);
}

// --- Backup --------------------------------------------------------------

export function writeBackup(state, label = "pre-write") {
  // Datumsstempel deterministisch aus Prozesszeit (Date.now ist im CLI erlaubt).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(backupDir(), `fba-state-${label}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  return file;
}

// --- Schreiben -----------------------------------------------------------
// commitState lädt frisch, wendet mutate(state) an, validiert, backupt und ruft app_sync.
// Bei REV_MISMATCH wird bis `retries` mal neu geladen + neu angewendet.

export async function commitState(cfg, mutate, options = {}) {
  const { dryRun = true, label = "write", retries = 2, force = false, validateFn = null } = options;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { state, rev } = await loadState(cfg);
    const before = structuredClone(state);
    // draft wird in-place mutiert. Helfer geben Result-Objekte zurück (kein State) → wir verwenden
    // immer den draft, es sei denn, der Patch gibt explizit ein vollständiges State-Objekt zurück.
    const draft = structuredClone(state);
    const returned = await mutate(draft);
    const next = (returned && typeof returned === "object" && returned.schemaVersion !== undefined)
      ? returned
      : draft;

    // Validierung: vorbestehende Fehler (schon im before-State) blockieren NICHT — nur
    // NEU eingeführte Fehler (Regression durch diese Mutation) blockieren. Wie in der App ist
    // die Validierung sonst advisory.
    let validation = { errors: [], warnings: [], newErrors: [], preexistingErrors: [] };
    if (typeof validateFn === "function") {
      const beforeV = validateFn(before) || { errors: [], warnings: [] };
      const nextV = validateFn(next) || { errors: [], warnings: [] };
      const beforeSet = new Set(beforeV.errors);
      const newErrors = nextV.errors.filter((e) => !beforeSet.has(e));
      const preexistingErrors = nextV.errors.filter((e) => beforeSet.has(e));
      validation = { errors: nextV.errors, warnings: nextV.warnings, newErrors, preexistingErrors };
    }

    if (dryRun) {
      return { dryRun: true, before, next, rev, validation };
    }

    if (validation.newErrors.length && !force) {
      const e = new Error(`Mutation führt ${validation.newErrors.length} NEUE Validierungsfehler ein. Mit force:true überschreibbar.`);
      e.validation = validation;
      throw e;
    }

    const backupFile = writeBackup(before, label);
    const userId = await resolveUserId(cfg);
    const result = await rpc(cfg, "app_sync", {
      p_workspace_id: cfg.workspaceId,
      p_user_id: userId,
      p_if_match_rev: rev,
      p_state: next,
    });

    if (result?.ok) {
      return { dryRun: false, ok: true, rev: result.rev, counts: result.counts, backupFile, validation };
    }
    if (result?.reason === "REV_MISMATCH" || result?.reason === "MISSING_IF_MATCH") {
      if (attempt < retries) continue; // neu laden + erneut anwenden
      throw new Error(`app_sync REV_MISMATCH nach ${retries + 1} Versuchen (paralleler Schreibzugriff?).`);
    }
    throw new Error(`app_sync abgelehnt: ${result?.reason || "unbekannt"}`);
  }
  throw new Error("commitState: unerreichbarer Zustand.");
}

export { getConfig };

// FBA Cashflow CLI — Konfiguration
// Lädt Supabase-Zugang aus ~/.pierre-keys.env (Single Source of Truth für Keys).
// Werte NIEMALS loggen/ausgeben.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Bekannter Prod-Workspace (siehe Obsidian Deep Reference). Per --workspace / FBA_WORKSPACE_ID überschreibbar.
export const DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_SUPABASE_URL = "https://kpjkymvyypbstehqqcph.supabase.co";

function loadEnvFile() {
  const envFile = path.join(os.homedir(), ".pierre-keys.env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const idx = t.indexOf("=");
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}

export function getConfig(overrides = {}) {
  loadEnvFile();
  const url = String(
    overrides.url || process.env.FBA_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
  ).trim().replace(/\/+$/, "");
  const serviceKey = String(
    overrides.serviceKey
      || process.env.FBA_SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || "",
  ).trim();
  const workspaceId = String(
    overrides.workspaceId || process.env.FBA_WORKSPACE_ID || DEFAULT_WORKSPACE_ID,
  ).trim();

  if (!serviceKey) {
    throw new Error(
      "FBA_SUPABASE_SERVICE_ROLE_KEY fehlt in ~/.pierre-keys.env.\n"
      + "Lege dort an:\n"
      + "  # --- FBA CASHFLOW (SUPABASE) ---\n"
      + `  FBA_SUPABASE_URL=${DEFAULT_SUPABASE_URL}\n`
      + "  FBA_SUPABASE_SERVICE_ROLE_KEY=<service_role secret aus Supabase → Project Settings → API>",
    );
  }
  return { url, serviceKey, workspaceId };
}

// Verzeichnis für automatische Backups vor jedem Write.
export function backupDir() {
  const dir = path.join(os.homedir(), ".fba-cli-backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

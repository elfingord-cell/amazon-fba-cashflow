import { getRuntimeConfig, isRuntimeConfigLoaded } from "./runtimeConfig.js";

function readEnv(key) {
  try {
    if (typeof import.meta !== "undefined" && import.meta?.env && import.meta.env[key] != null) {
      return import.meta.env[key];
    }
  } catch {
    // no-op
  }
  if (typeof process !== "undefined" && process?.env && process.env[key] != null) {
    return process.env[key];
  }
  return "";
}

function resolveBackendFromEnv() {
  const backend = String(readEnv("VITE_SYNC_BACKEND") || readEnv("SYNC_BACKEND") || "db")
    .trim()
    .toLowerCase();
  return backend === "db" ? "db" : "disabled";
}

function resolveConfig() {
  const cfg = getRuntimeConfig();
  if (isRuntimeConfigLoaded()) {
    return {
      backend: cfg.syncBackend === "db" ? "db" : "disabled",
      url: String(cfg.supabaseUrl || "").trim(),
      anonKey: String(cfg.supabaseAnonKey || "").trim(),
      source: cfg.source || "runtime",
    };
  }

  return {
    backend: resolveBackendFromEnv(),
    url: String(readEnv("VITE_SUPABASE_URL") || readEnv("SUPABASE_URL") || "").trim(),
    anonKey: String(readEnv("VITE_SUPABASE_ANON_KEY") || readEnv("SUPABASE_ANON_KEY") || "").trim(),
    source: "env-fallback",
  };
}

export function getSyncBackend() {
  return resolveConfig().backend;
}

export function isDbSyncEnabled() {
  return getSyncBackend() === "db";
}

export function getSupabaseClientConfig() {
  const cfg = resolveConfig();
  return {
    url: cfg.url,
    anonKey: cfg.anonKey,
    source: cfg.source,
  };
}

export function hasSupabaseClientConfig() {
  const cfg = getSupabaseClientConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

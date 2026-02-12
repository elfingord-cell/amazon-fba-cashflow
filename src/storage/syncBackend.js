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

export function getSyncBackend() {
  const backend = String(readEnv("VITE_SYNC_BACKEND") || "blobs")
    .trim()
    .toLowerCase();
  return backend === "db" ? "db" : "blobs";
}

export function isDbSyncEnabled() {
  return getSyncBackend() === "db";
}

export function getSupabaseClientConfig() {
  return {
    url: String(readEnv("VITE_SUPABASE_URL") || "").trim(),
    anonKey: String(readEnv("VITE_SUPABASE_ANON_KEY") || "").trim(),
  };
}

export function hasSupabaseClientConfig() {
  const cfg = getSupabaseClientConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

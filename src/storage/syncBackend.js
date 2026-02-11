const RAW_BACKEND = String(import.meta.env.VITE_SYNC_BACKEND || "blobs")
  .trim()
  .toLowerCase();

export function getSyncBackend() {
  return RAW_BACKEND === "db" ? "db" : "blobs";
}

export function isDbSyncEnabled() {
  return getSyncBackend() === "db";
}

export function getSupabaseClientConfig() {
  return {
    url: String(import.meta.env.VITE_SUPABASE_URL || "").trim(),
    anonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim(),
  };
}

export function hasSupabaseClientConfig() {
  const cfg = getSupabaseClientConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

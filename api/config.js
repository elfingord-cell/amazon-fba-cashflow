function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function toBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function toMs(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(100, Math.round(parsed));
}

module.exports = function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = readEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseAnonKey = readEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
  const syncBackendRaw = readEnv("SYNC_BACKEND", "VITE_SYNC_BACKEND") || "db";
  const syncBackend = String(syncBackendRaw).trim().toLowerCase() === "db" ? "db" : "disabled";

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({
      error: "SUPABASE_URL or SUPABASE_ANON_KEY missing",
      syncBackend: "disabled",
    });
    return;
  }

  res.status(200).json({
    syncBackend,
    supabaseUrl,
    supabaseAnonKey,
    realtimeEnabled: toBoolean(readEnv("REALTIME_ENABLED", "VITE_REALTIME_ENABLED"), true),
    presenceHeartbeatMs: toMs(readEnv("PRESENCE_HEARTBEAT_MS", "VITE_PRESENCE_HEARTBEAT_MS"), 20000),
    fallbackPollMs: toMs(readEnv("FALLBACK_POLL_MS", "VITE_FALLBACK_POLL_MS"), 4000),
    editGraceMs: toMs(readEnv("EDIT_GRACE_MS", "VITE_EDIT_GRACE_MS"), 1200),
  });
};

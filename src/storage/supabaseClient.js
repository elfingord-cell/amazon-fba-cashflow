import { createClient } from "@supabase/supabase-js";
import { getSupabaseClientConfig } from "./syncBackend.js";

let cachedClient = null;
let cachedKey = "";

function buildClientKey(url, anonKey) {
  return `${url}::${anonKey}`;
}

export function getSupabaseBrowserClient() {
  const cfg = getSupabaseClientConfig();
  const url = String(cfg.url || "").trim().replace(/\/+$/, "");
  const anonKey = String(cfg.anonKey || "").trim();
  if (!url || !anonKey) return null;

  const nextKey = buildClientKey(url, anonKey);
  if (cachedClient && cachedKey === nextKey) {
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "amazon-fba-cashflow-v2",
      },
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
  cachedKey = nextKey;
  return cachedClient;
}

export function resetSupabaseBrowserClientForTests() {
  cachedClient = null;
  cachedKey = "";
}

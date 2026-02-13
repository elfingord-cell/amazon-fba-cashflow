"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabaseBrowserClient = getSupabaseBrowserClient;
exports.resetSupabaseBrowserClientForTests = resetSupabaseBrowserClientForTests;
const supabase_js_1 = require("@supabase/supabase-js");
const syncBackend_js_1 = require("./syncBackend.js");
let cachedClient = null;
let cachedKey = "";
function buildClientKey(url, anonKey) {
    return `${url}::${anonKey}`;
}
function getSupabaseBrowserClient() {
    const cfg = (0, syncBackend_js_1.getSupabaseClientConfig)();
    const url = String(cfg.url || "").trim().replace(/\/+$/, "");
    const anonKey = String(cfg.anonKey || "").trim();
    if (!url || !anonKey)
        return null;
    const nextKey = buildClientKey(url, anonKey);
    if (cachedClient && cachedKey === nextKey) {
        return cachedClient;
    }
    cachedClient = (0, supabase_js_1.createClient)(url, anonKey, {
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
function resetSupabaseBrowserClientForTests() {
    cachedClient = null;
    cachedKey = "";
}

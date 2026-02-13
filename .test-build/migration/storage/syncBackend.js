"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSyncBackend = getSyncBackend;
exports.isDbSyncEnabled = isDbSyncEnabled;
exports.getSupabaseClientConfig = getSupabaseClientConfig;
exports.hasSupabaseClientConfig = hasSupabaseClientConfig;
const runtimeConfig_js_1 = require("./runtimeConfig.js");
function readEnv(key) {
    try {
        if (typeof import.meta !== "undefined" && import.meta?.env && import.meta.env[key] != null) {
            return import.meta.env[key];
        }
    }
    catch {
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
    const cfg = (0, runtimeConfig_js_1.getRuntimeConfig)();
    if ((0, runtimeConfig_js_1.isRuntimeConfigLoaded)()) {
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
function getSyncBackend() {
    return resolveConfig().backend;
}
function isDbSyncEnabled() {
    return getSyncBackend() === "db";
}
function getSupabaseClientConfig() {
    const cfg = resolveConfig();
    return {
        url: cfg.url,
        anonKey: cfg.anonKey,
        source: cfg.source,
    };
}
function hasSupabaseClientConfig() {
    const cfg = getSupabaseClientConfig();
    return Boolean(cfg.url && cfg.anonKey);
}

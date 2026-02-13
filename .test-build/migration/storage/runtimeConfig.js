"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRuntimeConfig = setRuntimeConfig;
exports.getRuntimeConfig = getRuntimeConfig;
exports.isRuntimeConfigLoaded = isRuntimeConfigLoaded;
exports.getRuntimeLoadError = getRuntimeLoadError;
exports.resetRuntimeConfigForTests = resetRuntimeConfigForTests;
exports.loadRuntimeConfig = loadRuntimeConfig;
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
    syncBackend: "db",
    supabaseUrl: "",
    supabaseAnonKey: "",
    realtimeEnabled: true,
    presenceHeartbeatMs: 20000,
    fallbackPollMs: 15000,
    editGraceMs: 1200,
    loaded: false,
    source: "default",
    loadError: null,
});
let runtimeConfig = { ...DEFAULT_RUNTIME_CONFIG };
let loadPromise = null;
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
function toBoolean(value, fallback) {
    if (value === true || value === "true" || value === 1 || value === "1")
        return true;
    if (value === false || value === "false" || value === 0 || value === "0")
        return false;
    return fallback;
}
function toMs(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.max(100, Math.round(parsed));
}
function normalizeBackend(value) {
    const raw = String(value || "db").trim().toLowerCase();
    return raw === "db" ? "db" : "disabled";
}
function normalizeConfig(input = {}, source = "manual") {
    return {
        syncBackend: normalizeBackend(input.syncBackend),
        supabaseUrl: String(input.supabaseUrl || "").trim().replace(/\/+$/, ""),
        supabaseAnonKey: String(input.supabaseAnonKey || "").trim(),
        realtimeEnabled: toBoolean(input.realtimeEnabled, true),
        presenceHeartbeatMs: toMs(input.presenceHeartbeatMs, 20000),
        fallbackPollMs: toMs(input.fallbackPollMs, 15000),
        editGraceMs: toMs(input.editGraceMs, 1200),
        loaded: true,
        source,
        loadError: null,
    };
}
function isDevLikeEnvironment() {
    try {
        if (typeof import.meta !== "undefined" && import.meta?.env) {
            if (import.meta.env.DEV === true)
                return true;
            if (String(import.meta.env.MODE || "").toLowerCase() === "development")
                return true;
            if (String(import.meta.env.MODE || "").toLowerCase() === "test")
                return true;
        }
    }
    catch {
        // no-op
    }
    const env = String(readEnv("NODE_ENV") || "").toLowerCase();
    return env === "development" || env === "test";
}
function buildEnvFallbackConfig() {
    const url = String(readEnv("VITE_SUPABASE_URL") || readEnv("SUPABASE_URL") || "").trim();
    const anonKey = String(readEnv("VITE_SUPABASE_ANON_KEY") || readEnv("SUPABASE_ANON_KEY") || "").trim();
    const backend = String(readEnv("VITE_SYNC_BACKEND") || readEnv("SYNC_BACKEND") || "db").trim().toLowerCase();
    if (!url || !anonKey)
        return null;
    return normalizeConfig({
        syncBackend: backend === "db" ? "db" : "disabled",
        supabaseUrl: url,
        supabaseAnonKey: anonKey,
        realtimeEnabled: toBoolean(readEnv("VITE_REALTIME_ENABLED"), true),
        presenceHeartbeatMs: toMs(readEnv("VITE_PRESENCE_HEARTBEAT_MS"), 20000),
        fallbackPollMs: toMs(readEnv("VITE_FALLBACK_POLL_MS"), 15000),
        editGraceMs: toMs(readEnv("VITE_EDIT_GRACE_MS"), 1200),
    }, "env-fallback");
}
function setLoadError(message) {
    runtimeConfig = {
        ...runtimeConfig,
        loaded: true,
        loadError: message || "Runtime config could not be loaded.",
        source: "error",
    };
}
function setRuntimeConfig(next, source = "manual") {
    runtimeConfig = normalizeConfig(next, source);
    loadPromise = Promise.resolve(runtimeConfig);
    return runtimeConfig;
}
function getRuntimeConfig() {
    return { ...runtimeConfig };
}
function isRuntimeConfigLoaded() {
    return Boolean(runtimeConfig.loaded);
}
function getRuntimeLoadError() {
    return runtimeConfig.loadError;
}
function resetRuntimeConfigForTests() {
    runtimeConfig = { ...DEFAULT_RUNTIME_CONFIG };
    loadPromise = null;
}
async function loadRuntimeConfig(options = {}) {
    if (runtimeConfig.loaded && !options.force) {
        return runtimeConfig;
    }
    if (!options.force && loadPromise) {
        return loadPromise;
    }
    loadPromise = (async () => {
        try {
            const response = await fetch("/api/config", {
                method: "GET",
                cache: "no-store",
                headers: {
                    Accept: "application/json",
                },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || `Runtime config request failed (${response.status})`);
            }
            runtimeConfig = normalizeConfig(payload, "api");
            return runtimeConfig;
        }
        catch (error) {
            const allowEnvFallback = options.allowEnvFallback ?? isDevLikeEnvironment();
            if (allowEnvFallback) {
                const envConfig = buildEnvFallbackConfig();
                if (envConfig) {
                    runtimeConfig = envConfig;
                    return runtimeConfig;
                }
            }
            const message = error instanceof Error ? error.message : "Runtime config could not be loaded.";
            setLoadError(message);
            return runtimeConfig;
        }
    })();
    return loadPromise;
}

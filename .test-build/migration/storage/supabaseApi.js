"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseHttpError = exports.SupabaseTimeoutError = exports.SupabaseConfigurationError = void 0;
exports.normalizeRpcPayload = normalizeRpcPayload;
exports.supabaseRequest = supabaseRequest;
exports.supabaseAuthRequest = supabaseAuthRequest;
exports.supabaseRpc = supabaseRpc;
const syncBackend_js_1 = require("./syncBackend.js");
const DEFAULT_TIMEOUT_MS = 15000;
class SupabaseConfigurationError extends Error {
    constructor(message = "Supabase is not configured") {
        super(message);
        this.name = "SupabaseConfigurationError";
    }
}
exports.SupabaseConfigurationError = SupabaseConfigurationError;
class SupabaseTimeoutError extends Error {
    constructor(message = "Supabase request timed out") {
        super(message);
        this.name = "SupabaseTimeoutError";
    }
}
exports.SupabaseTimeoutError = SupabaseTimeoutError;
class SupabaseHttpError extends Error {
    constructor(message = "Supabase request failed", status = 0, details = null) {
        super(message);
        this.name = "SupabaseHttpError";
        this.status = status;
        this.details = details;
    }
}
exports.SupabaseHttpError = SupabaseHttpError;
function getConfiguredBaseUrl() {
    const cfg = (0, syncBackend_js_1.getSupabaseClientConfig)();
    const baseUrl = String(cfg.url || "").trim().replace(/\/+$/, "");
    const anonKey = String(cfg.anonKey || "").trim();
    if (!baseUrl || !anonKey) {
        throw new SupabaseConfigurationError("Supabase runtime config is missing (check /api/config).");
    }
    return { baseUrl, anonKey };
}
function toTimeoutMs(timeoutMs) {
    const numeric = Number(timeoutMs);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return DEFAULT_TIMEOUT_MS;
    return Math.max(1000, Math.floor(numeric));
}
function buildErrorMessage(details, fallback) {
    if (!details || typeof details !== "object")
        return fallback;
    return (details.error_description ||
        details.msg ||
        details.error ||
        details.message ||
        fallback);
}
async function parsePayload(response) {
    const text = await response.text();
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
function normalizeRpcPayload(payload) {
    if (Array.isArray(payload))
        return payload[0] || null;
    return payload || null;
}
async function supabaseRequest(path, options = {}) {
    const { method = "GET", headers = {}, body = null, accessToken = null, timeoutMs = DEFAULT_TIMEOUT_MS, } = options;
    const { baseUrl, anonKey } = getConfiguredBaseUrl();
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const endpoint = `${baseUrl}${normalizedPath}`;
    const controller = new AbortController();
    const timeout = toTimeoutMs(timeoutMs);
    const timeoutHandle = setTimeout(() => {
        controller.abort();
    }, timeout);
    let response;
    try {
        const requestHeaders = {
            apikey: anonKey,
            ...headers,
        };
        if (accessToken) {
            requestHeaders.Authorization = `Bearer ${String(accessToken).trim()}`;
        }
        if (body != null && !requestHeaders["Content-Type"]) {
            requestHeaders["Content-Type"] = "application/json";
        }
        response = await fetch(endpoint, {
            method,
            headers: requestHeaders,
            body: body != null ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    }
    catch (error) {
        if (error?.name === "AbortError") {
            throw new SupabaseTimeoutError(`Supabase request timeout after ${timeout}ms`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeoutHandle);
    }
    const payload = await parsePayload(response);
    if (!response.ok) {
        const message = buildErrorMessage(payload, "Supabase request failed");
        throw new SupabaseHttpError(message, response.status, payload);
    }
    return payload;
}
async function supabaseAuthRequest(path, options = {}) {
    return supabaseRequest(`/auth/v1${path}`, options);
}
async function supabaseRpc(functionName, params = {}, options = {}) {
    return supabaseRequest(`/rest/v1/rpc/${functionName}`, {
        ...options,
        method: "POST",
        body: params,
    });
}

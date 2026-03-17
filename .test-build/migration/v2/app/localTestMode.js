"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLocalHostname = isLocalHostname;
exports.isLocalV2TestModeEnabled = isLocalV2TestModeEnabled;
exports.createLocalTestSyncSession = createLocalTestSyncSession;
exports.ensureLocalTestWorkspaceSeed = ensureLocalTestWorkspaceSeed;
const storageLocal_js_1 = require("../../data/storageLocal.js");
const LOCAL_TEST_MODE_SOURCE = "v2:local-test-mode:seed";
const LOCAL_TEST_MODE_QUERY_KEYS = ["local-v2-test-mode", "localV2TestMode"];
let hasSeededLocalTestState = false;
function toBoolean(value) {
    return value === true || value === "true" || value === 1 || value === "1";
}
function hasViteDevClient() {
    if (typeof document === "undefined" || typeof document.querySelector !== "function")
        return false;
    return Boolean(document.querySelector('script[src="/@vite/client"]'));
}
function hasExplicitLocalTestFlag(location) {
    const searchParams = new URLSearchParams(String(location?.search || ""));
    const hash = String(location?.hash || "");
    const hashQueryIndex = hash.indexOf("?");
    const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? hash.slice(hashQueryIndex + 1) : "");
    return LOCAL_TEST_MODE_QUERY_KEYS.some((key) => (toBoolean(searchParams.get(key)) || toBoolean(hashParams.get(key))));
}
function isLocalHostname(hostname) {
    const value = String(hostname || "").trim().toLowerCase();
    return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}
function isLocalV2TestModeEnabled() {
    if (typeof window === "undefined" || !window.location)
        return false;
    if (!isLocalHostname(window.location.hostname))
        return false;
    if (!hasViteDevClient())
        return false;
    return hasExplicitLocalTestFlag(window.location);
}
function createLocalTestSyncSession(options = {}) {
    return {
        userId: null,
        email: null,
        workspaceId: null,
        role: null,
        online: options.online !== false,
        // Intentionally unauthenticated and workspace-less:
        // V2 becomes visible because requiresAuth is false, without fabricating real auth/workspace state.
        isAuthenticated: false,
        hasWorkspaceAccess: false,
        requiresAuth: false,
    };
}
async function ensureLocalTestWorkspaceSeed() {
    const { ensureAppStateV2 } = await Promise.resolve().then(() => __importStar(require("../state/appState")));
    if (!isLocalV2TestModeEnabled())
        return ensureAppStateV2((0, storageLocal_js_1.loadState)());
    if (hasSeededLocalTestState)
        return ensureAppStateV2((0, storageLocal_js_1.loadState)());
    const debugUi = await Promise.resolve().then(() => __importStar(require("../../ui/debug.js")));
    const seeded = ensureAppStateV2(debugUi.buildDemoState());
    (0, storageLocal_js_1.commitState)(seeded, { source: LOCAL_TEST_MODE_SOURCE });
    hasSeededLocalTestState = true;
    return seeded;
}

import { commitState, loadState } from "../../data/storageLocal.js";

const LOCAL_TEST_MODE_SOURCE = "v2:local-test-mode:seed";
const LOCAL_TEST_MODE_QUERY_KEYS = ["local-v2-test-mode", "localV2TestMode"];
let hasSeededLocalTestState = false;

function toBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasViteDevClient() {
  if (typeof document === "undefined" || typeof document.querySelector !== "function") return false;
  return Boolean(document.querySelector('script[src="/@vite/client"]'));
}

function hasExplicitLocalTestFlag(location) {
  const searchParams = new URLSearchParams(String(location?.search || ""));
  const hash = String(location?.hash || "");
  const hashQueryIndex = hash.indexOf("?");
  const hashParams = new URLSearchParams(hashQueryIndex >= 0 ? hash.slice(hashQueryIndex + 1) : "");
  return LOCAL_TEST_MODE_QUERY_KEYS.some((key) => (
    toBoolean(searchParams.get(key)) || toBoolean(hashParams.get(key))
  ));
}

export function isLocalHostname(hostname) {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

export function isLocalV2TestModeEnabled() {
  if (typeof window === "undefined" || !window.location) return false;
  if (!isLocalHostname(window.location.hostname)) return false;
  if (!hasViteDevClient()) return false;
  return hasExplicitLocalTestFlag(window.location);
}

export function createLocalTestSyncSession(options = {}) {
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

export async function ensureLocalTestWorkspaceSeed() {
  const { ensureAppStateV2 } = await import("../state/appState");
  if (!isLocalV2TestModeEnabled()) return ensureAppStateV2(loadState());
  if (hasSeededLocalTestState) return ensureAppStateV2(loadState());
  const debugUi = await import("../../ui/debug.js");
  const seeded = ensureAppStateV2(debugUi.buildDemoState());
  commitState(seeded, { source: LOCAL_TEST_MODE_SOURCE });
  hasSeededLocalTestState = true;
  return seeded;
}

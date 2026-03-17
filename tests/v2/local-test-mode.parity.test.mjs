import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE_ROOT = process.cwd();
const MODULE_PATH = path.join(WORKSPACE_ROOT, "src/v2/app/localTestMode.js");

function installWindow(hostname) {
  globalThis.window = {
    location: {
      hostname,
      search: "",
      hash: "",
    },
  };
}

function installDocument({ viteDevClient = true } = {}) {
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'script[src="/@vite/client"]' && viteDevClient) {
        return { src: "/@vite/client" };
      }
      return null;
    },
  };
}

function cleanupGlobals() {
  delete globalThis.window;
  delete globalThis.document;
}

function cleanupEnv() {
  // no-op: helper is URL-flag driven
}

async function importFreshLocalTestMode() {
  const url = pathToFileURL(MODULE_PATH);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

test("local test mode stays off without explicit flag", async () => {
  installWindow("localhost");
  installDocument();

  try {
    const mod = await importFreshLocalTestMode();
    assert.equal(mod.isLocalV2TestModeEnabled(), false);
  } finally {
    cleanupGlobals();
    cleanupEnv();
  }
});

test("local test mode enables only for localhost with explicit flag", async () => {
  installWindow("127.0.0.1");
  globalThis.window.location.search = "?local-v2-test-mode=1";
  installDocument();

  try {
    const mod = await importFreshLocalTestMode();
    assert.equal(mod.isLocalV2TestModeEnabled(), true);
    assert.deepEqual(mod.createLocalTestSyncSession({ online: false }), {
      userId: null,
      email: null,
      workspaceId: null,
      role: null,
      online: false,
      isAuthenticated: false,
      hasWorkspaceAccess: false,
      requiresAuth: false,
    });
  } finally {
    cleanupGlobals();
    cleanupEnv();
  }
});

test("local test mode never enables on non-local hosts", async () => {
  installWindow("preview.example.com");
  globalThis.window.location.search = "?local-v2-test-mode=1";
  installDocument();

  try {
    const mod = await importFreshLocalTestMode();
    assert.equal(mod.isLocalV2TestModeEnabled(), false);
  } finally {
    cleanupGlobals();
    cleanupEnv();
  }
});

test("local test mode never enables without Vite dev client", async () => {
  installWindow("localhost");
  globalThis.window.location.search = "?local-v2-test-mode=1";
  installDocument({ viteDevClient: false });

  try {
    const mod = await importFreshLocalTestMode();
    assert.equal(mod.isLocalV2TestModeEnabled(), false);
  } finally {
    cleanupGlobals();
    cleanupEnv();
  }
});

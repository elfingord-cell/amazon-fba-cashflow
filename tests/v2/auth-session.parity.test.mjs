import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE_ROOT = process.cwd();
const AUTH_MODULE_PATH = path.join(WORKSPACE_ROOT, "src/storage/authSession.js");
const SESSION_KEY = "supabaseAuthSession";
const WORKSPACE_KEY = "supabaseWorkspaceSession";

function makeResponse(status, payload) {
  const body = JSON.stringify(payload ?? {});
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload ?? {};
    },
    async text() {
      return body;
    },
  };
}

function createLocalStorage(initial = {}) {
  const map = new Map(
    Object.entries(initial).map(([key, value]) => [String(key), String(value)]),
  );
  return {
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null;
    },
    key(index) {
      const keys = Array.from(map.keys());
      return keys[index] ?? null;
    },
    removeItem(key) {
      map.delete(String(key));
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    get length() {
      return map.size;
    },
  };
}

function createWindowMock() {
  const listeners = new Map();
  return {
    location: {
      hash: "",
      pathname: "/",
      search: "",
    },
    history: {
      replaceState() {
        // no-op
      },
    },
    addEventListener(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    removeEventListener(event, handler) {
      const list = listeners.get(event) || [];
      listeners.set(
        event,
        list.filter((entry) => entry !== handler),
      );
    },
    dispatchEvent(event) {
      const list = listeners.get(event.type) || [];
      list.forEach((handler) => handler(event));
      return true;
    },
  };
}

async function importFreshAuthSession() {
  const url = pathToFileURL(AUTH_MODULE_PATH);
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`);
  return import(url.href);
}

function installBrowserMocks({ localStorage }) {
  globalThis.localStorage = localStorage;
  globalThis.window = createWindowMock();
  globalThis.document = { title: "test" };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
}

function setDbEnv() {
  process.env.VITE_SYNC_BACKEND = "db";
  process.env.VITE_SUPABASE_URL = "https://example.supabase.test";
  process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
}

function clearDbEnv() {
  delete process.env.VITE_SYNC_BACKEND;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
}

function cleanupGlobals() {
  delete globalThis.fetch;
  delete globalThis.localStorage;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.CustomEvent;
}

test("auth/session parity: owner login -> workspace role -> logout", async () => {
  setDbEnv();
  const localStorage = createLocalStorage();
  installBrowserMocks({ localStorage });

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push({
      url: target,
      method: options.method || "GET",
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (target.includes("/auth/v1/token?grant_type=password")) {
      return makeResponse(200, {
        access_token: "token-owner",
        refresh_token: "refresh-owner",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-owner" },
      });
    }
    if (target.includes("/rest/v1/rpc/app_auth_session_client")) {
      return makeResponse(200, [{
        ok: true,
        userId: "user-owner",
        workspaceId: "ws-owner",
        role: "owner",
      }]);
    }
    if (target.includes("/auth/v1/logout")) {
      return makeResponse(200, { ok: true });
    }
    return makeResponse(404, { error: "unexpected endpoint" });
  };

  try {
    const auth = await importFreshAuthSession();
    const events = [];
    const unsub = auth.onAuthSessionChange((session, event) => {
      events.push({ session, event });
    });

    await auth.signInWithPassword("owner@example.com", "secret");
    const serverSession = await auth.fetchServerSession();

    assert.equal(serverSession.workspaceId, "ws-owner");
    assert.equal(serverSession.role, "owner");
    assert.equal(auth.getWorkspaceId(), "ws-owner");
    assert.equal(await auth.getAccessToken(), "token-owner");

    await auth.signOut();
    assert.equal(await auth.getAccessToken(), null);
    assert.equal(auth.getWorkspaceId(), null);

    assert.ok(events.some((entry) => entry.event === "password-sign-in"));
    assert.ok(events.some((entry) => entry.event === "sign-out"));
    unsub();

    const rpcCalls = requests.filter((entry) => entry.url.includes("app_auth_session_client"));
    assert.equal(rpcCalls.length, 1);
  } finally {
    cleanupGlobals();
    clearDbEnv();
  }
});

test("auth/session parity: editor session recovery from persisted storage", async () => {
  setDbEnv();
  const localStorage = createLocalStorage({
    [SESSION_KEY]: JSON.stringify({
      access_token: "token-editor",
      refresh_token: "refresh-editor",
      expires_at: Date.now() + 60_000,
      token_type: "bearer",
      user: { id: "user-editor" },
    }),
    [WORKSPACE_KEY]: JSON.stringify({
      userId: "user-editor",
      workspaceId: "ws-editor",
      role: "editor",
    }),
  });
  installBrowserMocks({ localStorage });

  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return makeResponse(500, { error: "network should not be used in cached recovery test" });
  };

  try {
    const auth = await importFreshAuthSession();

    const user = await auth.getCurrentUser();
    const serverSession = await auth.fetchServerSession();

    assert.equal(user.id, "user-editor");
    assert.equal(serverSession.workspaceId, "ws-editor");
    assert.equal(serverSession.role, "editor");
    assert.equal(auth.getWorkspaceId(), "ws-editor");
    assert.equal(fetchCalls, 0);
  } finally {
    cleanupGlobals();
    clearDbEnv();
  }
});

test("auth/session parity: sign-up is allowed but user without membership gets no_access session", async () => {
  setDbEnv();
  const localStorage = createLocalStorage();
  installBrowserMocks({ localStorage });

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/auth/v1/signup")) {
      return makeResponse(200, {
        access_token: "token-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-new", email: "new@example.com" },
      });
    }
    if (target.includes("/rest/v1/rpc/app_auth_session_client")) {
      return makeResponse(200, [{
        ok: false,
        reason: "NOT_A_MEMBER",
      }]);
    }
    if (target.includes("/auth/v1/logout")) {
      return makeResponse(200, { ok: true });
    }
    return makeResponse(404, { error: "unexpected endpoint" });
  };

  try {
    const auth = await importFreshAuthSession();
    const result = await auth.signUpWithPassword("new@example.com", "secret");
    const user = await auth.getCurrentUser();
    const serverSession = await auth.fetchServerSession();

    assert.equal(result.user.id, "user-new");
    assert.equal(user.id, "user-new");
    assert.equal(serverSession, null);
    assert.equal(auth.getWorkspaceId(), null);

    await auth.signOut();
  } finally {
    cleanupGlobals();
    clearDbEnv();
  }
});

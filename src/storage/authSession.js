import { hasSupabaseClientConfig, getSupabaseClientConfig, isDbSyncEnabled } from "./syncBackend.js";

const SESSION_KEY = "supabaseAuthSession";
const AUTH_DRIFT_MS = 20000;
const listeners = new Set();

function emitAuthChanged(detail = {}) {
  if (typeof window === "undefined") return;
  if (typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("remote-sync:auth-changed", { detail }));
  }
  listeners.forEach((handler) => {
    try {
      handler(detail?.session || null, detail?.event || "unknown");
    } catch {
      // no-op
    }
  });
}

function getConfigOrThrow() {
  const cfg = getSupabaseClientConfig();
  if (!cfg.url || !cfg.anonKey) {
    throw new Error("Supabase ist nicht konfiguriert.");
  }
  return cfg;
}

function buildAuthUrl(path) {
  const { url } = getConfigOrThrow();
  const base = String(url || "").replace(/\/+$/, "");
  return `${base}/auth/v1${path}`;
}

function saveSession(session) {
  if (typeof window === "undefined") return;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function readSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function toSessionFromAuthPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const expiresIn = Number(payload.expires_in || 3600);
  return {
    access_token: payload.access_token || null,
    refresh_token: payload.refresh_token || null,
    expires_at: Date.now() + Math.max(30, expiresIn) * 1000,
    user: payload.user || null,
    token_type: payload.token_type || "bearer",
  };
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

function extractSessionFromUrl() {
  if (typeof window === "undefined") return null;
  const hash = String(window.location.hash || "");
  if (!hash.includes("access_token=")) return null;

  const params = new URLSearchParams(hash.slice(1));
  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  const refreshToken = params.get("refresh_token");
  const expiresIn = Number(params.get("expires_in") || 3600);
  const tokenType = params.get("token_type") || "bearer";

  const session = {
    access_token: accessToken,
    refresh_token: refreshToken || null,
    expires_at: Date.now() + Math.max(30, expiresIn) * 1000,
    user: null,
    token_type: tokenType,
  };

  const cleanHash = window.location.hash.replace(/#.*/, "");
  if (window.history?.replaceState) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}${cleanHash}`);
  }

  return session;
}

async function refreshSession(session) {
  if (!session?.refresh_token) return session;
  const { anonKey } = getConfigOrThrow();
  const response = await fetch(buildAuthUrl("/token?grant_type=refresh_token"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      refresh_token: session.refresh_token,
    }),
  });
  if (!response.ok) {
    saveSession(null);
    return null;
  }
  const payload = await parseJson(response);
  const nextSession = toSessionFromAuthPayload(payload);
  saveSession(nextSession);
  emitAuthChanged({ event: "token-refresh", session: nextSession, userId: nextSession?.user?.id || null });
  return nextSession;
}

async function ensureSession() {
  if (!isDbSyncEnabled()) return null;
  if (!hasSupabaseClientConfig()) return null;

  const urlSession = extractSessionFromUrl();
  if (urlSession) {
    saveSession(urlSession);
    emitAuthChanged({ event: "url-session", session: urlSession, userId: null });
  }

  const session = readSession();
  if (!session?.access_token) return null;

  if (session.expires_at && Date.now() + AUTH_DRIFT_MS >= Number(session.expires_at || 0)) {
    return refreshSession(session);
  }

  return session;
}

export function isSupabaseConfigured() {
  return hasSupabaseClientConfig();
}

export async function getCurrentSession() {
  return ensureSession();
}

export async function getAccessToken() {
  const session = await ensureSession();
  return session?.access_token || null;
}

export async function getCurrentUser() {
  const session = await ensureSession();
  if (!session?.access_token) return null;
  if (session.user?.id) return session.user;

  const { anonKey } = getConfigOrThrow();
  const response = await fetch(buildAuthUrl("/user"), {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!response.ok) return null;
  const user = await parseJson(response);
  const nextSession = { ...session, user };
  saveSession(nextSession);
  return user || null;
}

export async function fetchServerSession() {
  if (!isDbSyncEnabled()) return null;
  const token = await getAccessToken();
  if (!token) return null;
  const response = await fetch("/.netlify/functions/auth-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ accessToken: token }),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    const payload = await parseJson(response);
    throw new Error(payload?.error || "Failed to resolve server session");
  }
  const payload = await parseJson(response);
  return payload?.ok ? payload : null;
}

export async function signInWithPassword(email, password) {
  if (!isDbSyncEnabled()) throw new Error("DB Sync ist nicht aktiv.");
  const cleanEmail = String(email || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanEmail || !cleanPassword) {
    throw new Error("E-Mail und Passwort sind erforderlich.");
  }

  const { anonKey } = getConfigOrThrow();
  const response = await fetch(buildAuthUrl("/token?grant_type=password"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: cleanEmail,
      password: cleanPassword,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.msg || "Login fehlgeschlagen");
  }
  const session = toSessionFromAuthPayload(payload);
  saveSession(session);
  emitAuthChanged({ event: "password-sign-in", session, userId: session?.user?.id || null });
  return session;
}

export async function signInWithMagicLink(email) {
  if (!isDbSyncEnabled()) throw new Error("DB Sync ist nicht aktiv.");
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("E-Mail ist erforderlich.");

  const { anonKey } = getConfigOrThrow();
  const response = await fetch(buildAuthUrl("/otp"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: cleanEmail,
      create_user: false,
    }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.msg || "Magic Link fehlgeschlagen");
  }
  return true;
}

export async function signOut() {
  const session = await ensureSession();
  if (session?.access_token) {
    const { anonKey } = getConfigOrThrow();
    try {
      await fetch(buildAuthUrl("/logout"), {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch {
      // no-op
    }
  }
  saveSession(null);
  emitAuthChanged({ event: "sign-out", session: null, userId: null });
}

export function onAuthSessionChange(handler) {
  if (typeof handler !== "function") return () => {};
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

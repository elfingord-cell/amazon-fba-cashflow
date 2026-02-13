import { hasSupabaseClientConfig, isDbSyncEnabled } from "./syncBackend.js";
import {
  normalizeRpcPayload,
  supabaseAuthRequest,
  supabaseRpc,
  SupabaseHttpError,
  SupabaseTimeoutError,
} from "./supabaseApi.js";

const SESSION_KEY = "supabaseAuthSession";
const WORKSPACE_KEY = "supabaseWorkspaceSession";
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

function saveWorkspaceSession(session) {
  if (typeof window === "undefined") return;
  if (!session) {
    localStorage.removeItem(WORKSPACE_KEY);
    return;
  }
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(session));
}

function readWorkspaceSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
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

function toReadableAuthError(error, fallback) {
  if (error instanceof SupabaseTimeoutError) {
    return new Error("Supabase-Timeout. Bitte Netzwerk, URL und Projektstatus prüfen.");
  }
  if (error instanceof SupabaseHttpError) {
    if (error.status === 400 || error.status === 422) {
      return new Error(error.message || fallback);
    }
    if (error.status === 401 || error.status === 403) {
      return new Error("Zugang abgelehnt. Bitte Login-Daten und Workspace-Zugriff prüfen.");
    }
    if (error.status >= 500) {
      return new Error("Supabase ist aktuell nicht erreichbar. Bitte später erneut versuchen.");
    }
    return new Error(error.message || fallback);
  }
  return new Error(error?.message || fallback);
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
  try {
    const payload = await supabaseAuthRequest("/token?grant_type=refresh_token", {
      method: "POST",
      body: {
        refresh_token: session.refresh_token,
      },
    });
    const nextSession = toSessionFromAuthPayload(payload);
    saveSession(nextSession);
    emitAuthChanged({ event: "token-refresh", session: nextSession, userId: nextSession?.user?.id || null });
    return nextSession;
  } catch {
    saveSession(null);
    saveWorkspaceSession(null);
    return null;
  }
}

async function resolveWorkspaceSession(accessToken) {
  const payload = await supabaseRpc("app_auth_session_client", {}, { accessToken });
  const data = normalizeRpcPayload(payload) || {};
  if (!data.ok) {
    if (data.reason === "UNAUTHENTICATED" || data.reason === "NOT_A_MEMBER") return null;
    throw new Error(data.reason || "Workspace session unavailable");
  }
  const session = {
    userId: data.userId || null,
    workspaceId: data.workspaceId || null,
    role: data.role || null,
  };
  saveWorkspaceSession(session);
  return session;
}

async function ensureWorkspaceSession() {
  if (!isDbSyncEnabled()) return null;
  const session = await ensureSession();
  if (!session?.access_token) {
    saveWorkspaceSession(null);
    return null;
  }

  const cached = readWorkspaceSession();
  if (cached?.workspaceId && cached?.userId && cached.userId === session?.user?.id) {
    return cached;
  }

  try {
    return await resolveWorkspaceSession(session.access_token);
  } catch (error) {
    if (error instanceof SupabaseHttpError && (error.status === 401 || error.status === 403)) {
      saveWorkspaceSession(null);
      return null;
    }
    throw error;
  }
}

async function fetchCurrentUser(accessToken) {
  return supabaseAuthRequest("/user", {
    method: "GET",
    accessToken,
  });
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

export function getWorkspaceId() {
  return readWorkspaceSession()?.workspaceId || null;
}

export async function getCurrentUser() {
  const session = await ensureSession();
  if (!session?.access_token) return null;
  if (session.user?.id) return session.user;

  try {
    const user = await fetchCurrentUser(session.access_token);
    const nextSession = { ...session, user };
    saveSession(nextSession);
    return user || null;
  } catch (error) {
    if (error instanceof SupabaseHttpError && (error.status === 401 || error.status === 403)) {
      saveSession(null);
      saveWorkspaceSession(null);
      emitAuthChanged({ event: "session-invalid", session: null, userId: null });
      return null;
    }
    throw toReadableAuthError(error, "Benutzer konnte nicht geladen werden.");
  }
}

export async function fetchServerSession() {
  if (!isDbSyncEnabled()) return null;
  try {
    const workspace = await ensureWorkspaceSession();
    if (!workspace?.workspaceId) return null;
    return {
      ok: true,
      userId: workspace.userId,
      workspaceId: workspace.workspaceId,
      role: workspace.role,
    };
  } catch (error) {
    throw toReadableAuthError(error, "Workspace konnte nicht geladen werden.");
  }
}

export async function signInWithPassword(email, password) {
  if (!isDbSyncEnabled()) throw new Error("DB Sync ist nicht aktiv.");
  const cleanEmail = String(email || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanEmail || !cleanPassword) {
    throw new Error("E-Mail und Passwort sind erforderlich.");
  }

  let payload;
  try {
    payload = await supabaseAuthRequest("/token?grant_type=password", {
      method: "POST",
      body: {
        email: cleanEmail,
        password: cleanPassword,
      },
    });
  } catch (error) {
    throw toReadableAuthError(error, "Login fehlgeschlagen");
  }

  const session = toSessionFromAuthPayload(payload);
  saveSession(session);
  saveWorkspaceSession(null);
  emitAuthChanged({ event: "password-sign-in", session, userId: session?.user?.id || null });
  return session;
}

export async function signUpWithPassword(email, password) {
  if (!isDbSyncEnabled()) throw new Error("DB Sync ist nicht aktiv.");
  const cleanEmail = String(email || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanEmail || !cleanPassword) {
    throw new Error("E-Mail und Passwort sind erforderlich.");
  }

  let payload;
  try {
    payload = await supabaseAuthRequest("/signup", {
      method: "POST",
      body: {
        email: cleanEmail,
        password: cleanPassword,
      },
    });
  } catch (error) {
    throw toReadableAuthError(error, "Registrierung fehlgeschlagen");
  }

  const session = toSessionFromAuthPayload(payload);
  if (session?.access_token) {
    saveSession(session);
  } else {
    saveSession(null);
  }
  saveWorkspaceSession(null);
  emitAuthChanged({ event: "password-sign-up", session, userId: session?.user?.id || null });

  return {
    session,
    user: payload?.user || session?.user || null,
  };
}

export async function signInWithMagicLink(email) {
  if (!isDbSyncEnabled()) throw new Error("DB Sync ist nicht aktiv.");
  const cleanEmail = String(email || "").trim();
  if (!cleanEmail) throw new Error("E-Mail ist erforderlich.");

  try {
    await supabaseAuthRequest("/otp", {
      method: "POST",
      body: {
        email: cleanEmail,
        create_user: false,
      },
    });
  } catch (error) {
    throw toReadableAuthError(error, "Magic Link fehlgeschlagen");
  }
  return true;
}

export async function signOut() {
  const session = await ensureSession();
  if (session?.access_token) {
    try {
      await supabaseAuthRequest("/logout", {
        method: "POST",
        accessToken: session.access_token,
      });
    } catch {
      // no-op
    }
  }
  saveSession(null);
  saveWorkspaceSession(null);
  emitAuthChanged({ event: "sign-out", session: null, userId: null });
}

export function onAuthSessionChange(handler) {
  if (typeof handler !== "function") return () => {};
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

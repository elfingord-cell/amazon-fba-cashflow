import { getAccessToken, isSupabaseConfigured } from "./authSession.js";
import { isDbSyncEnabled } from "./syncBackend.js";

const BASE_PATH = "/.netlify/functions";

export class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConflictError";
    this.details = details;
  }
}

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class ConfigurationError extends Error {
  constructor(message = "Sync backend not configured") {
    super(message);
    this.name = "ConfigurationError";
  }
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  return data || {};
}

function isAuthFailure(response) {
  return response.status === 401 || response.status === 403;
}

async function buildDbHeaders() {
  if (!isSupabaseConfigured()) {
    throw new ConfigurationError("Supabase client env vars are missing.");
  }
  const token = await getAccessToken();
  if (!token) {
    throw new AuthRequiredError("Please sign in to access shared sync.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function normalizeBootstrapPayload(data) {
  const state = data?.state && typeof data.state === "object" && !Array.isArray(data.state)
    ? data.state
    : null;
  return {
    exists: Boolean(data?.exists),
    rev: data?.rev || null,
    updatedAt: data?.updatedAt || null,
    data: state,
  };
}

export async function fetchRemoteState() {
  if (isDbSyncEnabled()) {
    const response = await fetch(`${BASE_PATH}/db-bootstrap`, {
      method: "GET",
      headers: await buildDbHeaders(),
      cache: "no-store",
    });

    if (isAuthFailure(response)) {
      const data = await parseJsonResponse(response);
      throw new AuthRequiredError(data?.error || "Auth required");
    }

    if (!response.ok) {
      const data = await parseJsonResponse(response);
      throw new Error(data?.error || "Remote DB bootstrap failed");
    }

    const data = await parseJsonResponse(response);
    return normalizeBootstrapPayload(data);
  }

  const response = await fetch(`${BASE_PATH}/state-get`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    throw new Error(data?.error || "Remote state fetch failed");
  }

  return parseJsonResponse(response);
}

export async function pushRemoteState({ ifMatchRev, updatedBy, data }) {
  if (isDbSyncEnabled()) {
    const response = await fetch(`${BASE_PATH}/db-sync`, {
      method: "PUT",
      headers: await buildDbHeaders(),
      body: JSON.stringify({
        ifMatchRev: ifMatchRev ?? null,
        updatedBy: updatedBy ?? null,
        state: data,
      }),
    });

    if (response.status === 409) {
      const details = await parseJsonResponse(response);
      throw new ConflictError("Remote state conflict", details);
    }

    if (isAuthFailure(response)) {
      const details = await parseJsonResponse(response);
      throw new AuthRequiredError(details?.error || "Auth required");
    }

    if (!response.ok) {
      const details = await parseJsonResponse(response);
      throw new Error(details?.error || "Remote DB sync failed");
    }

    return parseJsonResponse(response);
  }

  const response = await fetch(`${BASE_PATH}/state-put`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ifMatchRev: ifMatchRev ?? null,
      updatedBy: updatedBy ?? null,
      data,
    }),
  });

  if (response.status === 409) {
    const details = await parseJsonResponse(response);
    throw new ConflictError("Remote state conflict", details);
  }

  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new Error(payload?.error || "Remote state push failed");
  }

  return parseJsonResponse(response);
}

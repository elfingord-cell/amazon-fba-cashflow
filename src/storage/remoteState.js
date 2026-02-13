import { getAccessToken, getWorkspaceId, isSupabaseConfigured } from "./authSession.js";
import { isDbSyncEnabled } from "./syncBackend.js";
import {
  normalizeRpcPayload,
  supabaseRpc,
  SupabaseHttpError,
  SupabaseTimeoutError,
} from "./supabaseApi.js";

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

async function buildDbHeaders() {
  if (!isDbSyncEnabled()) {
    throw new ConfigurationError("DB sync backend is disabled.");
  }
  if (!isSupabaseConfigured()) {
    throw new ConfigurationError("Supabase client config is missing.");
  }
  const token = await getAccessToken();
  if (!token) {
    throw new AuthRequiredError("Please sign in to access shared sync.");
  }
  return token;
}

function appendWorkspaceArg(args = {}) {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) return args;
  return { ...args, p_workspace_id: workspaceId };
}

function mapDbRpcError(error, fallback = "Remote DB request failed") {
  if (error instanceof SupabaseTimeoutError) {
    return new Error("Supabase timeout while contacting shared storage.");
  }
  if (error instanceof SupabaseHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new AuthRequiredError(error.message || "Auth required");
    }
    return new Error(error.message || fallback);
  }
  return new Error(error?.message || fallback);
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
  const token = await buildDbHeaders();
  try {
    const payload = await supabaseRpc(
      "app_bootstrap_client",
      appendWorkspaceArg(),
      { accessToken: token }
    );
    const data = normalizeRpcPayload(payload) || {};
    if (!data.ok) {
      if (data.reason === "UNAUTHENTICATED" || data.reason === "NOT_A_MEMBER") {
        const authMessage = data.reason === "NOT_A_MEMBER"
          ? "Kein Workspace-Zugriff für diesen Benutzer."
          : "Auth required";
        throw new AuthRequiredError(authMessage);
      }
      throw new Error(data.reason || "Remote DB bootstrap failed");
    }
    return normalizeBootstrapPayload(data);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      throw error;
    }
    throw mapDbRpcError(error, "Remote DB bootstrap failed");
  }
}

export async function pushRemoteState({ ifMatchRev, updatedBy, data }) {
  const token = await buildDbHeaders();
  try {
    const payload = await supabaseRpc(
      "app_sync_client",
      appendWorkspaceArg({
        p_if_match_rev: ifMatchRev ?? null,
        p_state: data,
      }),
      { accessToken: token }
    );

    const result = normalizeRpcPayload(payload) || {};
    if (!result.ok) {
      if (result.reason === "UNAUTHENTICATED" || result.reason === "NOT_A_MEMBER" || result.reason === "WRITE_FORBIDDEN") {
        const authMessage = result.reason === "NOT_A_MEMBER"
          ? "Kein Workspace-Zugriff für diesen Benutzer."
          : "Auth required";
        throw new AuthRequiredError(authMessage);
      }
      if (result.reason === "MISSING_IF_MATCH" || result.reason === "REV_MISMATCH") {
        throw new ConflictError("Remote state conflict", {
          ok: false,
          reason: result.reason,
          currentRev: result.currentRev || null,
          updatedAt: result.updatedAt || null,
        });
      }
      throw new Error(result.reason || "Remote DB sync failed");
    }

    return {
      ok: true,
      rev: result.rev || null,
      updatedAt: result.updatedAt || null,
    };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof AuthRequiredError) {
      throw error;
    }
    throw mapDbRpcError(error, "Remote DB sync failed");
  }
}

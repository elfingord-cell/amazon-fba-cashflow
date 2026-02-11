let cachedConfig = null;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function isDbBackendEnabled() {
  const raw = String(process.env.SYNC_BACKEND || process.env.VITE_SYNC_BACKEND || "blobs")
    .trim()
    .toLowerCase();
  return raw === "db";
}

function parseJsonBody(event) {
  if (!event || !event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function getSupabaseConfig() {
  if (cachedConfig) return cachedConfig;
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_ENV_MISSING");
  }
  cachedConfig = { url, serviceRoleKey };
  return cachedConfig;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();
  const {
    method = "GET",
    query = null,
    body = null,
    headers = {},
    authMode = "service",
    accessToken = null,
  } = options;

  const url = new URL(`${config.url}${path}`);
  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }

  const requestHeaders = {
    apikey: config.serviceRoleKey,
    ...headers,
  };

  if (authMode === "user") {
    requestHeaders.Authorization = `Bearer ${String(accessToken || "").trim()}`;
  } else {
    requestHeaders.Authorization = `Bearer ${config.serviceRoleKey}`;
  }

  if (body != null) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url.toString(), {
    method,
    headers: requestHeaders,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    data: payload,
  };
}

function getAccessToken(event, body = null) {
  const authHeader = event?.headers?.authorization || event?.headers?.Authorization || "";
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  const tokenFromBody = body?.accessToken;
  if (typeof tokenFromBody === "string" && tokenFromBody.trim()) {
    return tokenFromBody.trim();
  }
  return null;
}

function rolePriority(role) {
  if (role === "owner") return 0;
  if (role === "editor") return 1;
  return 99;
}

async function getMembershipForUser(userId, requestedWorkspaceId = null) {
  const query = {
    select: "workspace_id,role,created_at",
    user_id: `eq.${userId}`,
  };
  if (requestedWorkspaceId) query.workspace_id = `eq.${requestedWorkspaceId}`;

  const response = await supabaseRequest("/rest/v1/workspace_members", {
    method: "GET",
    query,
  });

  if (!response.ok) {
    throw new Error("MEMBERSHIP_LOOKUP_FAILED");
  }

  const rows = Array.isArray(response.data) ? response.data : [];
  if (!rows.length) return null;

  const sorted = [...rows].sort((a, b) => {
    const prio = rolePriority(a.role) - rolePriority(b.role);
    if (prio !== 0) return prio;
    const aTs = new Date(a.created_at || 0).getTime();
    const bTs = new Date(b.created_at || 0).getTime();
    return aTs - bTs;
  });

  return sorted[0] || null;
}

async function callRpc(functionName, params) {
  const response = await supabaseRequest(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: params || {},
  });
  if (!response.ok) {
    return {
      ok: false,
      error: response.data?.message || response.data?.error || "RPC_FAILED",
      status: response.status,
      data: response.data,
    };
  }
  return {
    ok: true,
    data: response.data,
  };
}

async function requireAuthContext(event, options = {}) {
  const { allowTokenInBody = false, workspaceId = null } = options;
  let body = null;

  try {
    body = parseJsonBody(event);
  } catch (error) {
    if (error && error.message === "INVALID_JSON") {
      return {
        ok: false,
        response: jsonResponse(400, { ok: false, error: "Invalid JSON body" }),
      };
    }
    return {
      ok: false,
      response: jsonResponse(500, { ok: false, error: "Failed to parse request body" }),
    };
  }

  try {
    getSupabaseConfig();
  } catch (error) {
    if (error && error.message === "SUPABASE_ENV_MISSING") {
      return {
        ok: false,
        response: jsonResponse(500, { ok: false, error: "Supabase environment missing" }),
      };
    }
    return {
      ok: false,
      response: jsonResponse(500, { ok: false, error: "Supabase setup failed" }),
    };
  }

  const accessToken = allowTokenInBody ? getAccessToken(event, body) : getAccessToken(event, null);
  if (!accessToken) {
    return {
      ok: false,
      response: jsonResponse(401, { ok: false, error: "Auth required" }),
    };
  }

  const userResponse = await supabaseRequest("/auth/v1/user", {
    method: "GET",
    authMode: "user",
    accessToken,
  });
  if (!userResponse.ok || !userResponse.data?.id) {
    return {
      ok: false,
      response: jsonResponse(401, { ok: false, error: "Invalid auth token" }),
    };
  }

  const user = userResponse.data;
  let membership = null;
  try {
    membership = await getMembershipForUser(user.id, workspaceId);
  } catch {
    return {
      ok: false,
      response: jsonResponse(500, { ok: false, error: "Failed to resolve workspace membership" }),
    };
  }

  if (!membership) {
    return {
      ok: false,
      response: jsonResponse(403, { ok: false, error: "No workspace membership found" }),
    };
  }

  return {
    ok: true,
    user,
    membership: {
      workspaceId: membership.workspace_id,
      role: membership.role,
    },
    body,
    rpc: callRpc,
  };
}

function parseRpcResult(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

module.exports = {
  jsonResponse,
  isDbBackendEnabled,
  parseJsonBody,
  requireAuthContext,
  parseRpcResult,
};

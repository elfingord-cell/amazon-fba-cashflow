const {
  jsonResponse,
  requireAuthContext,
  parseRpcResult,
  isDbBackendEnabled,
} = require("./_supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }
  if (!isDbBackendEnabled()) {
    return jsonResponse(503, { ok: false, error: "DB sync backend disabled" });
  }

  const ctx = await requireAuthContext(event);
  if (!ctx.ok) return ctx.response;

  const { user, membership, rpc } = ctx;
  const rpcResponse = await rpc("app_bootstrap", {
    p_workspace_id: membership.workspaceId,
    p_user_id: user.id,
  });

  if (!rpcResponse.ok) {
    return jsonResponse(500, {
      ok: false,
      error: "Failed to load workspace state",
      details: rpcResponse.error || "unknown",
    });
  }

  const payload = parseRpcResult(rpcResponse.data) || {};
  if (payload.ok === false && payload.reason === "NOT_A_MEMBER") {
    return jsonResponse(403, { ok: false, error: "No workspace membership found" });
  }

  return jsonResponse(200, {
    ok: true,
    exists: Boolean(payload.exists),
    rev: payload.rev || null,
    updatedAt: payload.updatedAt || null,
    state: payload.state && typeof payload.state === "object" ? payload.state : null,
    workspaceId: membership.workspaceId,
    role: membership.role,
  });
};

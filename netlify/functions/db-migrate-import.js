const {
  jsonResponse,
  parseJsonBody,
  requireAuthContext,
  parseRpcResult,
  isDbBackendEnabled,
} = require("./_supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }
  if (!isDbBackendEnabled()) {
    return jsonResponse(503, { ok: false, error: "DB sync backend disabled" });
  }

  const ctx = await requireAuthContext(event);
  if (!ctx.ok) return ctx.response;

  let body = null;
  try {
    body = parseJsonBody(event);
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const state = body?.state || body?.data || null;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return jsonResponse(400, { ok: false, error: "Invalid state payload" });
  }

  const { user, membership, rpc } = ctx;
  const rpcResponse = await rpc("app_migrate_import", {
    p_workspace_id: membership.workspaceId,
    p_user_id: user.id,
    p_state: state,
  });

  if (!rpcResponse.ok) {
    return jsonResponse(500, {
      ok: false,
      error: "Failed to import state",
      details: rpcResponse.error || "unknown",
    });
  }

  const result = parseRpcResult(rpcResponse.data) || {};
  if (!result.ok) {
    if (result.reason === "NOT_A_MEMBER" || result.reason === "WRITE_FORBIDDEN") {
      return jsonResponse(403, {
        ok: false,
        reason: result.reason,
      });
    }
    if (result.reason === "MISSING_IF_MATCH" || result.reason === "REV_MISMATCH") {
      return jsonResponse(409, {
        ok: false,
        reason: result.reason,
        currentRev: result.currentRev || null,
        updatedAt: result.updatedAt || null,
      });
    }
    return jsonResponse(400, {
      ok: false,
      reason: result.reason || "MIGRATION_REJECTED",
    });
  }

  return jsonResponse(200, {
    ok: true,
    rev: result.rev || null,
    updatedAt: result.updatedAt || null,
    counts: result.counts || {},
  });
};

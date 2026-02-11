const { jsonResponse, requireAuthContext, isDbBackendEnabled } = require("./_supabase");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }
  if (!isDbBackendEnabled()) {
    return jsonResponse(503, { ok: false, error: "DB sync backend disabled" });
  }

  const ctx = await requireAuthContext(event, { allowTokenInBody: true });
  if (!ctx.ok) return ctx.response;

  return jsonResponse(200, {
    ok: true,
    userId: ctx.user.id,
    email: ctx.user.email || null,
    workspaceId: ctx.membership.workspaceId,
    role: ctx.membership.role,
  });
};

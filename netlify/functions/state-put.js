const { getStore } = require("@netlify/blobs");

const KEY = "amazon_fba_cashflow_state_v1";
const STORE_NAME = "app-state";

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function newRev() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "PUT") {
    return buildResponse(405, { ok: false, error: "Method not allowed" });
  }

  let payload = null;
  try {
    payload = event.body ? JSON.parse(event.body) : null;
  } catch {
    return buildResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  if (!payload || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    return buildResponse(400, { ok: false, error: "Invalid data payload" });
  }

  const ifMatchRev = payload.ifMatchRev ?? null;
  const updatedBy = payload.updatedBy ?? null;

  try {
    const store = getStore(STORE_NAME);
    const existing = await store.get(KEY, { type: "json" });

    if (existing) {
      if (!ifMatchRev) {
        return buildResponse(409, { ok: false, reason: "MISSING_IF_MATCH", currentRev: existing.rev, updatedAt: existing.updatedAt });
      }
      if (existing.rev !== ifMatchRev) {
        return buildResponse(409, { ok: false, reason: "REV_MISMATCH", currentRev: existing.rev, updatedAt: existing.updatedAt });
      }
    }

    const updatedAt = new Date().toISOString();
    const rev = newRev();
    const doc = {
      schemaVersion: 1,
      rev,
      updatedAt,
      updatedBy,
      data: payload.data,
    };

    await store.set(KEY, doc, { type: "json" });

    return buildResponse(200, { ok: true, rev, updatedAt });
  } catch (error) {
    return buildResponse(500, { ok: false, error: "Failed to save state" });
  }
};

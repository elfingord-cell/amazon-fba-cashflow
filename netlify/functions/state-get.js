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

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return buildResponse(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const store = getStore(STORE_NAME);
    const existing = await store.get(KEY, { type: "json" });

    if (!existing) {
      return buildResponse(200, { exists: false });
    }

    const { schemaVersion, rev, updatedAt, data } = existing;
    return buildResponse(200, {
      exists: true,
      schemaVersion,
      rev,
      updatedAt,
      data,
    });
  } catch (error) {
    return buildResponse(500, { ok: false, error: "Failed to load state" });
  }
};

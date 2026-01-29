const BASE_PATH = "/.netlify/functions";

export class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConflictError";
    this.details = details;
  }
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  return data || {};
}

export async function fetchRemoteState() {
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
    const data = await parseJsonResponse(response);
    throw new Error(data?.error || "Remote state push failed");
  }

  return parseJsonResponse(response);
}

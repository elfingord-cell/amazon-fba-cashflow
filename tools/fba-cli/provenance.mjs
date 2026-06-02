// CLI-Kopie des Provenienz-Stempel-Helfers (Node-ESM, ohne src-Import — vermeidet die
// MODULE_TYPELESS-Warnung beim Import von src/domain/provenanceRules.js aus dem CLI).
// KANONISCH ist src/domain/provenanceRules.js (applyProvenance); bei Änderungen DORT mitziehen.

const CHANGELOG_CAP = 100;

export function entityKey(type, id) {
  const t = String(type || "").trim();
  if (id == null || String(id).trim() === "") return t;
  return `${t}:${String(id).trim()}`;
}

export function applyProvenance(state, { entityKeys = [], source, by = "claude", method = "", rev = null, label = "", summary = "", nowIso } = {}) {
  if (!state || typeof state !== "object") return state;
  if (!state.provenance || typeof state.provenance !== "object") state.provenance = {};
  if (!Array.isArray(state.changeLog)) state.changeLog = [];
  const at = nowIso || new Date().toISOString();
  for (const key of entityKeys) {
    if (!key) continue;
    state.provenance[key] = { source: source || null, asOf: at, by, method, rev };
  }
  state.changeLog.push({ at, by, label, source: source || null, rev, summary });
  if (state.changeLog.length > CHANGELOG_CAP) state.changeLog = state.changeLog.slice(-CHANGELOG_CAP);
  return state;
}

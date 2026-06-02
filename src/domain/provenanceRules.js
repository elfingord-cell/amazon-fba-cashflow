// Statisches Herkunfts-Regelwerk: eine fuehrende Quelle pro Feld + Audit-Schwellen + Stempel-Helfer.
// Reine Konstanten/Helfer, keine Seiteneffekte (ausser applyProvenance, das einen uebergebenen
// State-Draft additiv mutiert). Von der Cashflow-Engine NICHT genutzt (nur Audit / CLI / UI).

export const AUDIT_THRESHOLDS = {
  snapshotFreshDays: { green: 35, amber: 60 },
  forecastCurrentDays: { green: 35, amber: 60 },
  revenueRealisticPct: { green: 25, amber: 40 },
  provenanceCoveragePct: { green: 80, amber: 50 },
};

export const PROVENANCE_RULES = {
  snapshot:       { leadingSource: "vo",          conflict: "vo-wins" },
  forecastImport: { leadingSource: "vo",          conflict: "vo-wins-manual-override" },
  po:             { leadingSource: "vo",          conflict: "vo-wins-keep-payplan" },
  landedCost:     { leadingSource: "vo",          conflict: "vo-wins" },
  fo:             { leadingSource: "computed",     conflict: "engine-source" },
  payment:        { leadingSource: "holvi",       conflict: "bank-wins" },
  fixcost:        { leadingSource: "holvi",       conflict: "bank-wins-assumptions-human" },
  revenueActual:  { leadingSource: "sellerboard", conflict: "sellerboard-wins" },
  tax:            { leadingSource: "bwa",         conflict: "bwa-wins" },
  dividend:       { leadingSource: "human",       conflict: "human-only" },
  openingBalance: { leadingSource: "holvi",       conflict: "bank-wins-human-confirm" },
};

export const PROVENANCE_SOURCES = ["vo", "sellerboard", "holvi", "bwa", "claude", "human", "computed"];

const CHANGELOG_CAP = 100;

export function entityKey(type, id) {
  const t = String(type || "").trim();
  if (id == null || String(id).trim() === "") return t;
  return `${t}:${String(id).trim()}`;
}

export function resolveLeadingSource(type) {
  const rule = PROVENANCE_RULES[String(type || "").trim()];
  return rule ? rule.leadingSource : null;
}

// Stempelt Provenienz je Entitaet + haengt einen (gekappten) changeLog-Eintrag an.
// Mutiert den uebergebenen State-Draft additiv; Engine ignoriert provenance/changeLog.
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

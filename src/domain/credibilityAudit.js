// Reine Glaubwuerdigkeits-Pruefung: nimmt fertigen Engine-Output (report, phantomSuggestions)
// + state + now und gibt Ampel-Checks zurueck. KEINE I/O, KEINE Engine-Aufrufe hier — der Runner
// (tools/fba-cli/audit.mjs) liefert report/phantomSuggestions. So bleibt die Funktion deterministisch
// testbar und baut nie eine zweite Wahrheit nach.
import { AUDIT_THRESHOLDS, entityKey } from "./provenanceRules.js";

const DAY_MS = 86400000;

function monthEndDate(month) {
  const m = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)); // letzter Tag des Monats (UTC)
}
function daysSince(date, now) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.round((now.getTime() - date.getTime()) / DAY_MS);
}
function statusByDays(days, thr) {
  if (days == null) return "amber";
  if (days <= thr.green) return "green";
  if (days <= thr.amber) return "amber";
  return "red";
}

function checkSnapshotFresh(state, now, thr) {
  const snaps = Array.isArray(state?.inventory?.snapshots) ? state.inventory.snapshots : [];
  const latest = snaps.filter((s) => s && /^\d{4}-\d{2}$/.test(String(s.month || "")))
    .sort((a, b) => String(a.month).localeCompare(String(b.month))).pop() || null;
  if (!latest) {
    return { key: "snapshot_fresh", label: "Bestand frisch", status: "red", detail: "Kein Snapshot vorhanden", drill: "#/v2/inventory/snapshot" };
  }
  // Frische bevorzugt am echten Aufnahme-Zeitpunkt (capturedAt) messen; Fallback Monatsende.
  const captured = latest.capturedAt ? new Date(latest.capturedAt) : null;
  const ref = captured && !Number.isNaN(captured.getTime()) ? captured : monthEndDate(latest.month);
  const days = Math.max(0, daysSince(ref, now) ?? 0);
  return { key: "snapshot_fresh", label: "Bestand frisch",
    status: statusByDays(days, thr.snapshotFreshDays),
    detail: `Letzter Snapshot ${latest.month} (${days} Tage alt)`,
    drill: "#/v2/inventory/snapshot" };
}

export function resolveForecastBaselineIso(state) {
  const f = state?.forecast || {};
  const versions = Array.isArray(f.versions) ? f.versions : [];
  const active = versions.find((v) => v && v.id === f.activeVersionId) || versions[versions.length - 1] || null;
  const iso = active?.createdAt || f.baselineCreatedAt || f.importedAt || null;
  return iso ? String(iso) : null;
}
function checkForecastCurrent(state, now, thr) {
  const iso = resolveForecastBaselineIso(state);
  const date = iso ? new Date(iso) : null;
  const days = date && !Number.isNaN(date.getTime()) ? daysSince(date, now) : null;
  return { key: "forecast_current", label: "Forecast aktuell",
    status: days == null ? "amber" : statusByDays(days, thr.forecastCurrentDays),
    detail: days == null ? "Baseline-Datum unbekannt" : `Aktive Baseline ${days} Tage alt`,
    drill: "#/v2/forecast" };
}

function checkPfoComplete(phantomSuggestions) {
  const overdue = (phantomSuggestions || []).filter((s) => s && s.overdue === true);
  return { key: "pfo_complete", label: "PFOs vollständig",
    status: overdue.length ? "red" : "green",
    detail: overdue.length ? `${overdue.length} überfällige Bestellvorschläge offen` : "Keine überfälligen PFOs",
    drill: "#/v2/orders/po" };
}

function checkFoPlausible(state) {
  const fos = Array.isArray(state?.fos) ? state.fos : [];
  const bad = fos.filter((f) => {
    if (!f) return false;
    const units = Number(f.units);
    if (Number.isFinite(units) && units <= 0) return true;
    const od = f.orderDate ? new Date(f.orderDate) : null;
    const dd = f.deliveryDate ? new Date(f.deliveryDate) : null;
    return od && dd && !Number.isNaN(od.getTime()) && !Number.isNaN(dd.getTime()) && dd.getTime() < od.getTime();
  });
  return { key: "fo_plausible", label: "FOs plausibel",
    status: bad.length ? "red" : "green",
    detail: bad.length ? `${bad.length} FO(s) mit unplausibler Menge/Datum` : "Alle FOs plausibel",
    drill: "#/v2/orders/fo" };
}

function checkRevenueRealistic(report, thr) {
  const v = report?.kpis?.actuals?.avgRevenueDeltaPct;
  if (!Number.isFinite(v)) return { key: "revenue_realistic", label: "Umsatz realistisch", status: "amber",
    detail: "Noch keine Ist-Daten zum Abgleich", drill: "#/v2/soll-ist" };
  const abs = Math.abs(v);
  const status = abs <= thr.revenueRealisticPct.green ? "green" : abs <= thr.revenueRealisticPct.amber ? "amber" : "red";
  return { key: "revenue_realistic", label: "Umsatz realistisch", status,
    detail: `ø Forecast-vs-Ist ${v > 0 ? "+" : ""}${v.toFixed(1)} %`, drill: "#/v2/soll-ist" };
}

function checkBalanceSane(report) {
  const rows = Array.isArray(report?.breakdown) ? report.breakdown : [];
  const nan = rows.some((r) => !Number.isFinite(Number(r?.closing)));
  if (nan) return { key: "balance_sane", label: "Kontostand belastbar", status: "red",
    detail: "Ungültiger (NaN) Kontostand in der Projektion", drill: "#/v2/dashboard" };
  // computeSeries legt firstNegativeMonth unter kpis ab; Top-Level nur als Fallback (Altdaten/Tests).
  const neg = report?.kpis?.firstNegativeMonth ?? report?.firstNegativeMonth ?? null;
  return { key: "balance_sane", label: "Kontostand belastbar", status: neg ? "amber" : "green",
    detail: neg ? `Negativer Kontostand ab ${neg}` : "Kontostand-Kette durchgehend positiv", drill: "#/v2/dashboard" };
}

function checkBucketSums(report) {
  const rows = Array.isArray(report?.series) ? report.series : [];
  let unbucketed = 0;
  rows.forEach((row) => (row?.entries || []).forEach((e) => {
    if (String(e?.kind || "") === "sales-payout" && String(e?.direction || "") === "in"
        && Number(e?.amount || 0) > 0 && !(e?.portfolioBucket || e?.meta?.portfolioBucket)) unbucketed += 1;
  }));
  return { key: "bucket_sums", label: "Bucket-Integrität", status: unbucketed ? "red" : "green",
    detail: unbucketed ? `${unbucketed} Forecast-Umsatz-Positionen ohne Bucket` : "Alle Forecast-Umsätze einem Bucket zugeordnet",
    drill: "#/v2/methodik" };
}

function checkProvenanceCoverage(state, thr) {
  const prov = state?.provenance && typeof state.provenance === "object" ? state.provenance : {};
  const keys = [];
  (Array.isArray(state?.products) ? state.products : []).forEach((p) => p?.sku && keys.push(entityKey("product", p.sku)));
  (Array.isArray(state?.pos) ? state.pos : []).forEach((p) => p?.id && keys.push(entityKey("po", p.id)));
  (Array.isArray(state?.fos) ? state.fos : []).forEach((f) => f?.id && keys.push(entityKey("fo", f.id)));
  const total = keys.length;
  const stamped = keys.filter((k) => prov[k]).length;
  const pct = total ? Math.round((stamped / total) * 100) : 100;
  const raw = pct >= thr.provenanceCoveragePct.green ? "green" : pct >= thr.provenanceCoveragePct.amber ? "amber" : "red";
  return { key: "provenance_coverage", label: "Herkunft hinterlegt",
    status: raw === "red" ? "amber" : raw, // Anzeige max. amber (nur Info)
    detail: `${stamped}/${total} Entitäten mit Herkunft (${pct} %)`, drill: "#/v2/methodik" };
}

const CHECK_BUILDERS = [
  ({ state, now, thresholds }) => checkSnapshotFresh(state, now, thresholds),
  ({ state, now, thresholds }) => checkForecastCurrent(state, now, thresholds),
  ({ phantomSuggestions }) => checkPfoComplete(phantomSuggestions),
  ({ state }) => checkFoPlausible(state),
  ({ report, thresholds }) => checkRevenueRealistic(report, thresholds),
  ({ report }) => checkBalanceSane(report),
  ({ report }) => checkBucketSums(report),
  ({ state, thresholds }) => checkProvenanceCoverage(state, thresholds),
];

function deriveOverall(checks) {
  // provenance_coverage darf overall hoechstens auf amber ziehen, nie auf rot.
  const eff = checks.map((c) => (c.key === "provenance_coverage" && c.status === "red" ? { ...c, status: "amber" } : c));
  if (eff.some((c) => c.status === "red")) return "red";
  if (eff.some((c) => c.status === "amber")) return "amber";
  return "green";
}

export function runCredibilityAudit({ state, report, phantomSuggestions, now, thresholds = AUDIT_THRESHOLDS }) {
  const ctx = { state: state || {}, report: report || {}, phantomSuggestions: phantomSuggestions || [], now, thresholds };
  const checks = CHECK_BUILDERS.map((build) => build(ctx));
  return { lastRun: now.toISOString(), by: "claude", overall: deriveOverall(checks), checks };
}

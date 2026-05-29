// VO Forecast-Import (repliziert App persistImportedVersion mode=activate, merge)
// Quelle: /tmp/vo_new_forecast.json (aus VO Revenue-Forecast-Export 2026-05-29)
import fs from "fs";
export default async function (state) {
  const fc = state.forecast;
  if (!fc) throw new Error("kein forecast im state");
  const newF = JSON.parse(fs.readFileSync("/tmp/vo_new_forecast.json", "utf8"));

  const versions = Array.isArray(fc.versions) ? fc.versions : [];
  const activeId = String(fc.activeVersionId || "");
  const active = versions.find((v) => v.id === activeId) || versions[versions.length - 1] || null;
  const base = active && active.forecastImport ? structuredClone(active.forecastImport) : structuredClone(fc.forecastImport || {});

  const productSkus = new Set((state.products || []).map((p) => String(p.sku)));
  const candidate = structuredClone(base);
  let imported = 0; const skipped = [];
  for (const [sku, mm] of Object.entries(newF)) {
    if (!productSkus.has(sku)) { skipped.push(sku); continue; }
    candidate[sku] = mm; imported++;
  }

  let rowCount = 0; const monthSet = new Set();
  for (const sku of Object.keys(candidate)) {
    for (const m of Object.keys(candidate[sku] || {})) { rowCount++; monthSet.add(m); }
  }
  const stats = { rowCount, skuCount: Object.keys(candidate).length, monthCount: monthSet.size };

  const r = () => Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();
  const d = new Date(createdAt); const pad = (n) => String(n).padStart(2, "0");
  const name = `VentoryOne Forecast – ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const newVersion = {
    id: `fv-${r()}-${r()}`, name, note: null, createdAt,
    sourceLabel: "VO - Revenue Forecast 2026-05-29.csv",
    importMode: "merge", onlyActiveSkus: true,
    forecastImport: candidate, stats,
  };
  versions.push(newVersion);
  versions.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  fc.versions = versions;
  fc.activeVersionId = newVersion.id;
  fc.forecastImport = structuredClone(candidate);
  fc.lastImportAt = createdAt;
  fc.importSource = newVersion.sourceLabel;
  fc.importCadence = "monthly";
  fc.lastDriftSummary = null;
  fc.lastImpactSummary = null;

  console.log("IMPORT: " + imported + " SKUs gemerged | übersprungen (kein CFP-Produkt): " + JSON.stringify(skipped));
  console.log("STATS: " + JSON.stringify(stats));
  console.log("Neue aktive Version: " + name + " (" + newVersion.id + ")");
}

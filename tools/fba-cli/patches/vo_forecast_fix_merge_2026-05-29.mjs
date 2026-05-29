// FIX: korrekte Pro-Monat-Merge-Semantik (Vorgänger-Patch hatte ganze SKU-Map ersetzt → Jan-Apr verloren)
import fs from "fs";
export default async function (state) {
  const fc = state.forecast;
  const newF = JSON.parse(fs.readFileSync("/tmp/vo_new_forecast.json", "utf8"));
  const versions = Array.isArray(fc.versions) ? fc.versions : [];

  // alte Baseline (vor meinem Import) = die 2026-05-01-Version (hat Jan-Apr + alle Monate)
  const baseV = versions.find((v) => /2026-05-01/.test(v.name || ""));
  if (!baseV) throw new Error("alte Baseline 2026-05-01 nicht gefunden");
  // meine kaputte Version (2026-05-29) entfernen
  const broken = versions.find((v) => /2026-05-29/.test(v.name || ""));
  fc.versions = versions.filter((v) => v !== broken);

  const productSkus = new Set((state.products || []).map((p) => String(p.sku)));
  const candidate = structuredClone(baseV.forecastImport);  // enthält Jan-Apr etc.
  let cells = 0;
  for (const [sku, mm] of Object.entries(newF)) {
    if (!productSkus.has(sku)) continue;
    if (!candidate[sku] || typeof candidate[sku] !== "object") candidate[sku] = {};
    for (const [month, row] of Object.entries(mm)) {   // PRO MONAT überlagern
      candidate[sku][month] = row; cells++;
    }
  }

  let rowCount = 0; const ms = new Set();
  for (const sku of Object.keys(candidate)) for (const m of Object.keys(candidate[sku] || {})) { rowCount++; ms.add(m); }
  const stats = { rowCount, skuCount: Object.keys(candidate).length, monthCount: ms.size };

  const r = () => Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();
  const d = new Date(createdAt); const pad = (n) => String(n).padStart(2, "0");
  const name = `VentoryOne Forecast – ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nv = { id: `fv-${r()}-${r()}`, name, note: "Pro-Monat-Merge korrigiert", createdAt,
    sourceLabel: "VO - Revenue Forecast 2026-05-29.csv", importMode: "merge", onlyActiveSkus: true,
    forecastImport: candidate, stats };
  fc.versions.push(nv);
  fc.versions.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  fc.activeVersionId = nv.id;
  fc.forecastImport = structuredClone(candidate);
  fc.lastImportAt = createdAt; fc.importSource = nv.sourceLabel; fc.importCadence = "monthly";
  fc.lastDriftSummary = null; fc.lastImpactSummary = null;
  console.log(`FIX: ${cells} Monats-Zellen überlagert | ${JSON.stringify(stats)} | aktive Version: ${name}`);
}

// FBA-CF-0012 — Export/Import nur Management + Validierung
// - Keine Editor-Felder mehr hier (Eingaben passieren im Tab "Eingaben")
// - Kurzübersicht, Validierung, JSON-Vorschau, Download/Upload

import { loadState, saveState, exportState, importStateFile } from "../data/storageLocal.js";
import { expandFixcostInstances } from "../domain/cashflow.js";

const $  = (sel, r=document)=> r.querySelector(sel);
const esc = (s)=> String(s??"").replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- Zahl & Format-Helfer (DE) --------------------------------------------
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function sumDE(list, pick){
  return (list||[]).reduce((acc, r)=> acc + (parseDE(pick(r))||0), 0);
}
function fmtDE(n){ return (Number(n)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ---- Validierung -----------------------------------------------------------
function validateState(s){
  const errors = [];
  const warns  = [];

  // Opening plausibel
  if (parseDE(s.openingEur) < 0) errors.push("Opening darf nicht negativ sein.");

  // Settings vorhanden
  if (!s?.settings?.startMonth) errors.push("Startmonat fehlt (settings.startMonth).");
  if (!s?.settings?.horizonMonths) errors.push("Zeitraum (Monate) fehlt (settings.horizonMonths).");

  // Incomings (Umsatz × Quote) prüfen
  (s.incomings||[]).forEach((r,i)=>{
    if (!r.month) errors.push(`Umsatz-Zeile ${i+1}: Monat fehlt.`);
    const rev = parseDE(r.revenueEur);
    if (!Number.isFinite(rev) || rev<0) errors.push(`Umsatz-Zeile ${i+1}: Umsatz ungültig.`);
    let pct = r.payoutPct;
    if (pct>1) pct = pct/100; // Toleranz
    if (!(pct>=0 && pct<=1)) errors.push(`Umsatz-Zeile ${i+1}: Quote muss zwischen 0 und 1 liegen (oder 0–100%).`);
  });

  // Extras Beträge prüfbar
  (s.extras||[]).forEach((r,i)=>{
    if (!r.month) warns.push(`Extras-Zeile ${i+1}: Monat fehlt (wird beim Import/Export dennoch übernommen).`);
    if (!Number.isFinite(parseDE(r.amountEur))) errors.push(`Extras-Zeile ${i+1}: Betrag ungültig.`);
  });

  (s.fixcosts||[]).forEach((row, i) => {
    if (!row.name) errors.push(`Fixkosten ${i + 1}: Name fehlt.`);
    if (!(parseDE(row.amount) > 0)) errors.push(`Fixkosten ${i + 1}: Betrag ungültig.`);
    if (row.startMonth && row.endMonth && row.startMonth > row.endMonth) {
      errors.push(`Fixkosten ${i + 1}: Startmonat darf nicht nach Endmonat liegen.`);
    }
  });
  const overrides = s.fixcostOverrides || {};
  Object.entries(overrides).forEach(([fixId, months]) => {
    if (!months || typeof months !== "object") return;
    Object.entries(months).forEach(([monthKey, data]) => {
      if (data && data.amount && !Number.isFinite(parseDE(data.amount))) {
        errors.push(`Fixkosten-Override ${fixId} ${monthKey}: Betrag ungültig.`);
      }
      if (data && data.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) {
        warns.push(`Fixkosten-Override ${fixId} ${monthKey}: Fälligkeit im Format JJJJ-MM-TT angeben.`);
      }
    });
  });

  return { errors, warns };
}

// ---- JSON aufbereiten (Clean) ---------------------------------------------
function buildCleanJson(s){
  const { _computed, ...clean } = structuredClone(s || {});

  // Migration: falls ein altes Backup nur settings.openingBalance hatte
  if (!clean.openingEur && clean?.settings?.openingBalance) {
    clean.openingEur = clean.settings.openingBalance;
  }
  // Alt-Feld konsequent entfernen, damit es in der Vorschau nicht mehr auftaucht
  if (clean?.settings) {
    delete clean.settings.openingBalance;
  }
  clean.export = {
    forecast: buildForecastExport(clean),
  };
  return clean;
}

function buildForecastExport(state) {
  const settings = state?.settings || {};
  const start = settings.startMonth || "2025-01";
  const horizon = Number(settings.horizonMonths || 18);
  const months = [];
  const [y0, m0] = String(start).split("-").map(Number);
  for (let i = 0; i < horizon; i += 1) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const m = ((m0 - 1 + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  const manual = state?.forecast?.forecastManual || {};
  const imported = state?.forecast?.forecastImport || {};
  const items = (state?.products || [])
    .filter(product => product?.sku)
    .map(product => {
      const sku = String(product.sku || "").trim();
      const values = {};
      const manualMonths = [];
      months.forEach(month => {
        const manualVal = manual?.[sku]?.[month] ?? null;
        const importVal = imported?.[sku]?.[month]?.units ?? null;
        const effective = manualVal ?? importVal ?? null;
        values[month] = effective;
        if (manualVal != null) manualMonths.push(month);
      });
      return {
        sku,
        alias: product.alias || "",
        categoryId: product.categoryId || "",
        avgSellingPriceGrossEUR: Number.isFinite(Number(product.avgSellingPriceGrossEUR))
          ? Number(product.avgSellingPriceGrossEUR)
          : null,
        sellerboardMarginPct: Number.isFinite(Number(product.sellerboardMarginPct))
          ? Number(product.sellerboardMarginPct)
          : null,
        values,
        meta: {
          manualOverridesMonths: manualMonths,
        },
      };
    });
  return {
    generatedAt: new Date().toISOString(),
    sourcePriority: ["manual", "ventoryOne"],
    lastImportAt: state?.forecast?.lastImportAt || null,
    forecastLastImportedAt: state?.forecast?.lastImportAt || null,
    months,
    items,
  };
}

// ---- Render ---------------------------------------------------------------
export async function render(root){
  let s = loadState();
  // Fallback-Struktur
  s.settings  = s.settings  || { startMonth:"2025-02", horizonMonths:18, openingBalance:"50.000,00" };
  s.incomings = Array.isArray(s.incomings) ? s.incomings : [];
  s.extras    = Array.isArray(s.extras)    ? s.extras    : [];
  s.fixcosts  = Array.isArray(s.fixcosts)  ? s.fixcosts  : [];
  s.fixcostOverrides = (s.fixcostOverrides && typeof s.fixcostOverrides === "object") ? s.fixcostOverrides : {};

  const totalPayout = (s.incomings||[]).reduce((acc, r)=>{
    const rev = parseDE(r.revenueEur);
    let pct = r.payoutPct;
    if (pct>1) pct = pct/100;
    return acc + rev * (pct||0);
  }, 0);
  const totalExtras = sumDE(s.extras,   r=>r.amountEur);
  const fixInstances = expandFixcostInstances(s, { today: new Date() });
  const totalFix    = fixInstances.reduce((acc, inst)=> acc + (inst.amount || 0), 0);

  const { errors, warns } = validateState(s);
  const canDownload = errors.length===0;

  const clean = buildCleanJson(s);
  const pretty = JSON.stringify(clean, null, 2);

  root.innerHTML = `
    <section class="card">
      <h2>Export / Import</h2>

      <div class="row" style="gap:8px; flex-wrap:wrap">
        <button id="btn-dl" class="btn${canDownload?'':' disabled'}" title="${canDownload?'':'Bitte Fehler beheben, dann exportieren.'}" ${canDownload ? '' : 'disabled aria-disabled="true"'}>
          JSON herunterladen
        </button>
        <button id="btn-dl-backup" class="btn secondary">
          Backup JSON herunterladen
        </button>
        <label class="btn" for="file-imp" style="cursor:pointer">JSON importieren</label>
        <input id="file-imp" type="file" accept="application/json" class="hidden" />
        <button id="btn-seed" class="btn secondary">Testdaten laden</button>
        <span class="muted">Namespace: localStorage</span>
      </div>

      <div class="grid two" style="margin-top:12px">
        <div class="card soft">
          <h3 class="muted">Aktueller Stand (kurz)</h3>
          <ul class="simple">
            <li>Opening: <b>${fmtDE(parseDE(s.openingEur))} €</b></li>
            <li>Sales × Payout: <b>${fmtDE(totalPayout)} €</b></li>
            <li>Extras (Σ): <b>${fmtDE(totalExtras)} €</b></li>
            <li>Fixkosten (Σ): <b>${fmtDE(totalFix)} €</b></li>
            <li>Zeitraum: <b>${esc(s?.settings?.startMonth || "—")}, ${esc(s?.settings?.horizonMonths || 0)} Monate</b></li>
          </ul>
        </div>

        <div class="card soft">
          <h3 class="muted">Validierung</h3>
          ${errors.length===0 && warns.length===0 ? `
            <div class="ok">✔︎ Keine Probleme gefunden.</div>
          `:`
            ${errors.length ? `<div class="danger" style="margin-bottom:6px"><b>Fehler</b><ul class="simple">${errors.map(e=>`<li>${esc(e)}</li>`).join("")}</ul></div>`:""}
            ${warns.length  ? `<div class="warn"><b>Hinweise</b><ul class="simple">${warns.map(w=>`<li>${esc(w)}</li>`).join("")}</ul></div>`:""}
          `}
        </div>
      </div>

      <div class="card soft" style="margin-top:12px">
        <h3 class="muted">JSON Vorschau</h3>
        <pre style="white-space:pre-wrap;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;max-height:420px;overflow:auto">${esc(pretty)}</pre>
      </div>
    </section>
  `;

  // ---- Events --------------------------------------------------------------
  $("#btn-dl")?.addEventListener("click", ()=>{
    if (!canDownload) return;
    exportState(clean); // nutzt bestehenden Export (Dateiname mit Timestamp)
  });

  $("#btn-dl-backup")?.addEventListener("click", ()=>{
    exportState(loadState());
  });

  $("#file-imp")?.addEventListener("change", (ev)=>{
    const file = ev.target.files?.[0];
    if (!file) return;
    importStateFile(file, (result)=>{
      if (!result || result.__error){
        alert("Ungültige JSON-Datei." + (result?.__error ? `\n${result.__error}` : ""));
        return;
      }
      const { state, warnings } = result;
      // Soft-merge + speichern
      window.dispatchEvent(new CustomEvent("remote-sync:local-import"));
      saveState(state);
      // Info & Reload der View
      alert("Import übernommen.");
      render(root);
    });
    // reset input
    ev.target.value = "";
  });

  $("#btn-seed")?.addEventListener("click", ()=>{
    // einfache Testdaten (nicht invasiv)
    const demo = {
      ...s,
      openingEur: "10.000,00",
      incomings: [
        { month: s?.settings?.startMonth || "2025-02", revenueEur: "20.000,00", payoutPct: 0.85 },
        { month: "2025-03", revenueEur: "22.000,00", payoutPct: 0.85 },
      ],
      extras: [
        { month: "2025-04", label: "USt-Erstattung", amountEur: "1.500,00" }
      ],
      fixcosts: [
        {
          id: "fix-export-demo",
          name: "Fixkosten",
          category: "Miete",
          amount: "2.000,00",
          frequency: "monthly",
          intervalMonths: 1,
          anchor: "LAST",
          startMonth: s?.settings?.startMonth || "2025-02",
          endMonth: "",
          proration: { enabled: false, method: "none" },
          autoPaid: true,
          notes: "Demo-Position",
        }
      ],
      fixcostOverrides: {},
    };
    saveState(demo);
    alert("Testdaten geladen.");
    render(root);
  });
}

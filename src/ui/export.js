// FBA-CF-0007 — Export/Import (stabiler Editor)
// - Inputs speichern auf change/blur (kein Cursor-Sprung)
// - JSON-Vorschau & Kurz-Summary aktualisieren sich lokal
// - Import nutzt storageLocal.importStateFile

import {
  loadState,
  saveState,
  exportState,
  importStateFile,
} from "../data/storageLocal.js";

// ----- kleine Helfer -----
const $ = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => [...r.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function fmtEUR(numLike){
  const n = Number(String(numLike).replace(/\./g, "").replace(",", ".")) || 0;
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function toDE(n){ // Zahl → "1.234,56"
  if (n === "" || n == null) return "";
  const v = Number(n); if (isNaN(v)) return String(n);
  return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function sum(arr, prop){
  return (arr||[]).reduce((a,x)=> a + (Number(String(x[prop]||"").replace(/\./g,"").replace(",","."))||0), 0);
}

// ----- Rendering -----
export async function render(root){
  const state = loadState();

  root.innerHTML = `
    <section class="card">
      <h2>Export / Import</h2>

      <div class="row" style="gap:8px">
        <button id="btn-dl" class="btn">JSON herunterladen</button>
        <label class="btn" for="file-imp" style="cursor:pointer;">JSON importieren</label>
        <input id="file-imp" type="file" accept="application/json" style="display:none" />
      </div>

      <div class="grid two" style="margin-top:12px">
        <div class="card soft" id="summary">
          <h3 class="muted">Aktueller Stand (kurz)</h3>
          <ul id="summary-ul" class="muted"></ul>
        </div>

        <div class="card soft" id="extras-card">
          <h3 class="muted">Extras (Editor)</h3>
          <div id="extras-rows"></div>
          <button id="btn-add" class="btn" style="margin-top:8px">+ Zeile</button>
        </div>
      </div>

      <div class="card soft" style="margin-top:12px">
        <h3 class="muted">JSON Vorschau</h3>
        <pre id="json-pre" style="white-space:pre-wrap;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;max-height:45vh;overflow:auto"></pre>
      </div>
    </section>
  `;

  // ---- lokale, veränderliche Kopie für diese Ansicht ----
  let s = structuredClone(state);

  // ---- Summary + Vorschau initial ----
  redrawSummary();
  redrawPreview();

  // ---- Buttons ----
  $("#btn-dl", root).addEventListener("click", () => exportState(s));
  $("#file-imp", root).addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importStateFile(file, (merged) => {
      s = structuredClone(merged);
      redrawSummary();
      renderExtras();
      redrawPreview();
    });
    e.target.value = ""; // reset
  });
  $("#btn-add", root).addEventListener("click", () => {
    s.extras = Array.isArray(s.extras) ? s.extras : [];
    s.extras.push({ month: "2025-05", label: "", amountEur: "0,00" });
    // persist erst bei blur/change, aber UI zeigen
    renderExtras();
    redrawPreview();
  });

  // ---- Extras-Editor ----
  renderExtras();

  // ---------- Funktionen ----------
  function renderExtras(){
    const box = $("#extras-rows", root);
    const rows = Array.isArray(s.extras) ? s.extras : [];
    box.innerHTML = rows.map((r, idx) => rowTpl(r, idx)).join("");

    // Listener je Zeile
    rows.forEach((r, idx) => {
      // Monat
      const m = $(`[data-idx="${idx}"][data-field="month"]`, box);
      m.addEventListener("change", () => {
        s.extras[idx].month = m.value;
        saveState(s);                       // persistiert
        redrawSummary(); redrawPreview();   // lokal aktualisieren
      });
      m.addEventListener("blur", () => m.dispatchEvent(new Event("change")));

      // Label
      const l = $(`[data-idx="${idx}"][data-field="label"]`, box);
      l.addEventListener("change", () => {
        s.extras[idx].label = l.value;
        saveState(s);
        redrawSummary(); redrawPreview();
      });
      l.addEventListener("blur", () => l.dispatchEvent(new Event("change")));

      // Betrag
      const a = $(`[data-idx="${idx}"][data-field="amount"]`, box);
      a.addEventListener("change", () => {
        // Eingabe tolerant annehmen; DE → String sauber halten
        const raw = a.value.trim();
        // Try parse, dann wieder in DE-Format schreiben (bleibt „ruhig“ bis blur)
        const parsed = Number(raw.replace(/\./g,"").replace(",", ".")) || 0;
        const pretty = toDE(parsed);
        s.extras[idx].amountEur = pretty.replace(".", ","); // sicher DE-Komma
        a.value = s.extras[idx].amountEur;
        saveState(s);
        redrawSummary(); redrawPreview();
      });
      a.addEventListener("blur", () => a.dispatchEvent(new Event("change")));

      // Entfernen
      const rm = $(`[data-idx="${idx}"][data-action="rm"]`, box);
      rm.addEventListener("click", () => {
        s.extras.splice(idx, 1);
        saveState(s);
        renderExtras();
        redrawSummary(); redrawPreview();
      });
    });
  }

  function rowTpl(r, idx){
    const m = esc(r?.month ?? "");
    const l = esc(r?.label ?? "");
    const a = esc(r?.amountEur ?? "");
    return `
      <div class="row" style="gap:8px;align-items:center;margin-bottom:6px">
        <input class="in" type="month" value="${m}" data-idx="${idx}" data-field="month" />
        <input class="in" type="text"  placeholder="Label" value="${l}" data-idx="${idx}" data-field="label" />
        <input class="in" type="text"  placeholder="Betrag (z.B. 1.234,56)" value="${a}" data-idx="${idx}" data-field="amount" style="max-width:160px" />
        <button class="btn danger" data-idx="${idx}" data-action="rm">✕</button>
      </div>
    `;
  }

  function redrawSummary(){
    const ul = $("#summary-ul", root);
    const opening = Number(String(s.openingEur||"").replace(/\./g,"").replace(",", ".")) || 0;
    const sales   = Number(String(s.monthlyAmazonEur||"").replace(/\./g,"").replace(",", ".")) || 0;
    const payout  = Number(s.payoutPct ?? 0.85) || 0;
    const sxp     = sales * payout;
    const extrasΣ = sum(s.extras, "amountEur");
    const outΣ    = sum(s.outgoings, "amountEur");
    const range   = `${s?.settings?.startMonth || "—"} , ${s?.settings?.horizonMonths || "18"} Monate`;

    ul.innerHTML = `
      <li>Opening: <b>${fmtEUR(opening)}</b></li>
      <li>Sales × Payout: <b>${fmtEUR(sxp)}</b></li>
      <li>Extras (Σ): <b>${fmtEUR(extrasΣ)}</b></li>
      <li>Ausgaben (Σ): <b>${fmtEUR(outΣ)}</b></li>
      <li>Zeitraum: <b>${esc(range)}</b></li>
    `;
  }

  function redrawPreview(){
    // Vorschau zeigt den aktuellen (lokalen) Zustand
    $("#json-pre", root).textContent = JSON.stringify(s, null, 2);
  }
}

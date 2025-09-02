// FBA-CF-0008 — Export/Import View
// - DE-Zahlenformat stabil (z.B. 2.000,00), kein Reset auf 0
// - Inputs speichern auf change/blur (Enter optional)
// - Vorschau & Summary aktualisieren ohne komplettes Re-Render

import {
  loadState,
  saveState,
  exportState,
  importStateFile,
} from "../data/storageLocal.js";

// ---------- Helpers ----------
const $ = (sel, r = document) => r.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// DE-Parsing: "1.234,56" -> 1234.56
function parseDE(str){
  if (str == null) return 0;
  const s = String(str).trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n) ? n : 0;
}
// DE-Format: 1234.56 -> "1.234,56"
function fmtDE(num){
  const n = Number(num) || 0;
  return n.toLocaleString("de-DE", { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function fmtEUR(num){ return `${fmtDE(num)} €`; }
function sumDE(rows, prop){
  return (rows||[]).reduce((a,r)=> a + parseDE(r?.[prop] ?? 0), 0);
}

// ---------- View ----------
export async function render(root){
  let state = loadState();              // aktuelle App-Daten
  let s = structuredClone(state);       // lokale, veränderliche Kopie

  root.innerHTML = `
    <section class="card">
      <h2>Export / Import</h2>

      <div class="row" style="gap:8px">
        <button id="btn-dl" class="btn">JSON herunterladen</button>
        <label class="btn" for="file-imp" style="cursor:pointer;">JSON importieren</label>
        <input id="file-imp" type="file" accept="application/json" style="display:none" />
      </div>

      <div class="grid two" style="margin-top:12px">
        <div class="card soft">
          <h3 class="muted">Aktueller Stand (kurz)</h3>
          <ul id="summary" class="muted"></ul>
        </div>

        <div class="card soft" id="extras-card">
          <h3 class="muted">Extras (Editor)</h3>
          <div id="extras"></div>
          <button id="btn-add" class="btn" style="margin-top:8px">+ Zeile</button>
          <p class="muted" style="margin-top:6px">Hinweis: Extras werden in einem späteren Schritt in den Reiter „Eingaben“ verschoben.</p>
        </div>
      </div>

      <div class="card soft" style="margin-top:12px">
        <h3 class="muted">JSON Vorschau</h3>
        <pre id="json" style="white-space:pre-wrap;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;max-height:45vh;overflow:auto"></pre>
      </div>
    </section>
  `;

  $("#btn-dl").addEventListener("click", () => exportState(s));
  $("#file-imp").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    importStateFile(f, (merged) => {
      s = structuredClone(merged);
      drawSummary(); drawExtras(); drawJSON();
    });
    e.target.value = "";
  });

  $("#btn-add").addEventListener("click", () => {
    s.extras = Array.isArray(s.extras) ? s.extras : [];
    s.extras.push({ month:"2025-06", label:"", amountEur:"0,00" });
    drawExtras(); drawJSON();
  });

  drawSummary(); drawExtras(); drawJSON();

  // ---------- Drawer ----------
  function drawSummary(){
    const opening = parseDE(s.openingEur ?? s?.settings?.openingBalance ?? 0);
    const sales   = parseDE(s.monthlyAmazonEur ?? 0);
    const payout  = Number(s.payoutPct ?? 0.85) || 0;
    const sxp     = sales * payout;
    const extrasΣ = sumDE(s.extras, "amountEur");
    const outΣ    = sumDE(s.outgoings, "amountEur");
    const range   = `${s?.settings?.startMonth || "—"}, ${s?.settings?.horizonMonths || 18} Monate`;

    $("#summary").innerHTML = `
      <li>Opening: <b>${fmtEUR(opening)}</b></li>
      <li>Sales × Payout: <b>${fmtEUR(sxp)}</b></li>
      <li>Extras (Σ): <b>${fmtEUR(extrasΣ)}</b></li>
      <li>Ausgaben (Σ): <b>${fmtEUR(outΣ)}</b></li>
      <li>Zeitraum: <b>${esc(range)}</b></li>
    `;
  }

  function drawJSON(){
    $("#json").textContent = JSON.stringify(s, null, 2);
  }

  function drawExtras(){
    const box = $("#extras");
    const rows = Array.isArray(s.extras) ? s.extras : [];
    box.innerHTML = rows.map((r, i) => rowTpl(r, i)).join("");

    rows.forEach((r, i) => {
      const m = box.querySelector(`[data-i="${i}"][data-f="m"]`);
      const l = box.querySelector(`[data-i="${i}"][data-f="l"]`);
      const a = box.querySelector(`[data-i="${i}"][data-f="a"]`);
      const x = box.querySelector(`[data-i="${i}"][data-f="x"]`);

      // Monat
      m.addEventListener("change", () => {
        s.extras[i].month = m.value;
        saveState(s); drawSummary(); drawJSON();
      });
      m.addEventListener("blur", () => m.dispatchEvent(new Event("change")));

      // Label
      l.addEventListener("change", () => {
        s.extras[i].label = l.value;
        saveState(s); drawSummary(); drawJSON();
      });
      l.addEventListener("blur", () => l.dispatchEvent(new Event("change")));

      // Betrag (DE)
      a.addEventListener("change", () => {
        const val = parseDE(a.value);
        const pretty = fmtDE(val);        // <<< KEIN zusätzliches Ersetzen!
        s.extras[i].amountEur = pretty;   // z.B. "2.000,00"
        a.value = pretty;
        saveState(s); drawSummary(); drawJSON();
      });
      a.addEventListener("blur", () => a.dispatchEvent(new Event("change")));
      a.addEventListener("keydown", (ev) => { if (ev.key === "Enter") a.blur(); });

      // Remove
      x.addEventListener("click", () => {
        s.extras.splice(i, 1);
        saveState(s); drawExtras(); drawSummary(); drawJSON();
      });
    });
  }

  function rowTpl(r, i){
    const m = esc(r?.month ?? "");
    const l = esc(r?.label ?? "");
    const a = esc(r?.amountEur ?? "");
    return `
      <div class="row" style="gap:8px;align-items:center;margin-bottom:6px">
        <input class="in" type="month" value="${m}" data-i="${i}" data-f="m" />
        <input class="in" type="text"  placeholder="Label" value="${l}" data-i="${i}" data-f="l" />
        <input class="in" type="text"  placeholder="Betrag (z.B. 1.234,56)" value="${a}" data-i="${i}" data-f="a" style="max-width:160px" />
        <button class="btn danger" data-i="${i}" data-f="x">✕</button>
      </div>
    `;
  }
}

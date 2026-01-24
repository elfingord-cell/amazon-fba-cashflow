// FBA-CF-0028 — Eingaben: Opening-Balance bindet korrekt an settings.openingBalance
import { loadState, saveState } from "../data/storageLocal.js";

function $(sel, r=document){ return r.querySelector(sel); }
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtDE(n){ return Number(n||0).toLocaleString("de-DE",{minimumFractionDigits:2, maximumFractionDigits:2}); }

export async function render(root){
  const s = loadState();
  const openingStr = s?.settings?.openingBalance ?? "50.000,00";

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>
      <div class="grid two">
        <div>
          <label>Opening Balance (€)</label>
          <input id="opening" value="${openingStr}">
          <div class="muted" style="margin-top:6px">Tipp: 10.000,00 (Komma erlaubt)</div>
        </div>
        <div>
          <label>Startmonat (YYYY-MM)</label>
          <input id="startMonth" value="${s?.settings?.startMonth || "2025-02"}" placeholder="YYYY-MM">
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Sales × Payout (pro Monat)</h3>
      <table>
        <thead><tr><th>Monat</th><th>Umsatz (€)</th><th>Payout (%)</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <button class="btn" id="addRow">+ Monat hinzufügen</button>
    </section>
  `;

  const opening = $("#opening", root);
  const startMonth = $("#startMonth", root);
  const rows = $("#rows", root);

  function paintRows(){
    rows.innerHTML = "";
    const arr = Array.isArray(s.incomings)? s.incomings : [];
    arr.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input data-k="month" value="${r.month||""}"></td>
        <td><input data-k="revenueEur" value="${r.revenueEur||"0,00"}"></td>
        <td><input data-k="payoutPct" value="${r.payoutPct||"100"}"></td>
        <td><button class="btn danger" data-del="${i}">Entfernen</button></td>
      `;
      rows.append(tr);
    });
  }

  paintRows();

  // Opening speichern (blur oder Enter)
  opening.addEventListener("change", ()=>{
    const val = opening.value;
    s.settings = s.settings || {};
    s.settings.openingBalance = val;     // <-- wichtig: korrektes Feld
    saveState(s);
  });
  opening.addEventListener("keydown", (e)=>{
    if (e.key === "Enter") { opening.blur(); }
  });

  startMonth.addEventListener("change", ()=>{
    s.settings = s.settings || {};
    s.settings.startMonth = startMonth.value || s.settings.startMonth;
    saveState(s);
  });

  rows.addEventListener("input", (e)=>{
    const inp = e.target.closest("input");
    if (!inp) return;
    const tr = e.target.closest("tr");
    const idx = [...rows.children].indexOf(tr);
    const key = inp.dataset.k;
    s.incomings[idx][key] = inp.value;
  });
  rows.addEventListener("change", ()=>{
    saveState(s);
  });
  rows.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-del]");
    if (!btn) return;
    const idx = Number(btn.dataset.del);
    s.incomings.splice(idx,1);
    saveState(s);
    paintRows();
  });

  $("#addRow", root).addEventListener("click", ()=>{
    s.incomings = Array.isArray(s.incomings)? s.incomings : [];
    s.incomings.push({ month: s?.settings?.startMonth || "2025-02", revenueEur:"0,00", payoutPct:"100" });
    saveState(s);
    paintRows();
  });
}

// FBA-CF-0006 — Export/Import + Extras-Editor (Tabelle)
import { loadState, saveState, exportState, importStateFile, addStateListener } from "../data/storageLocal.js";
import { fmtEUR } from "../domain/metrics.js";

export async function render(root){
  root.innerHTML = `
    <section class="card">
      <h2>Export / Import</h2>

      <div class="row" style="gap:8px; flex-wrap:wrap">
        <button id="btnExport" class="btn">JSON herunterladen</button>
        <label class="btn">
          JSON importieren
          <input id="file" type="file" accept="application/json" style="display:none"/>
        </label>
        <button id="btnSeed" class="btn secondary">Testdaten laden</button>
        <div style="flex:1"></div>
        <span class="muted">Namespace: localStorage</span>
      </div>

      <div class="grid two" style="margin-top:12px; gap:12px">
        <div class="card sub">
          <h3>Aktueller Stand (Kurz)</h3>
          <ul id="summary" class="list"></ul>
        </div>

        <div class="card sub">
          <h3>Extras (Editor)</h3>
          <div class="table-wrap">
            <table class="tbl" id="tblExtras" aria-label="Extras Editor">
              <thead><tr><th>Monat (YYYY-MM)</th><th>Label</th><th class="num">Betrag (€)</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="row" style="margin-top:6px"><button id="btnAddExtra" class="btn">+ Zeile</button></div>
        </div>
      </div>

      <div class="card sub" style="margin-top:12px">
        <h3>JSON Vorschau</h3>
        <pre id="json" class="jsonpreview" aria-label="JSON Preview"></pre>
      </div>
    </section>
  `;

  const $ = (sel,el=root)=>el.querySelector(sel);
  const $$ = (sel,el=root)=>[...el.querySelectorAll(sel)];

  const elSummary = $("#summary");
  const elJson    = $("#json");
  const elTblBody = $("#tblExtras tbody");
  const inputFile = $("#file");

  // Live-Refresh von Preview/Summary
  const off = addStateListener(updateAll);
  root._cleanup = () => { try { off && off(); } catch {} };

  $("#btnExport").addEventListener("click", ()=> exportState(loadState()));
  $("#btnSeed").addEventListener("click", seed);
  $("#btnAddExtra").addEventListener("click", ()=> { const s=loadState(); (s.extras ||= []).push({month:s?.settings?.startMonth||"2025-02", label:"Extra", amountEur:"0,00"}); saveState(s); updateAll(); });
  inputFile.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    importStateFile(f, s => { saveState(s); updateAll(); });
    e.target.value="";
  });

  updateAll();

  function updateAll(){
    const s = loadState();
    // Summary
    const extraSum = (s.extras||[]).reduce((a,r)=>a+toNum(r.amountEur),0);
    const outSum   = (s.outgoings||[]).reduce((a,r)=>a+Math.abs(toNum(r.amountEur)),0);
    elSummary.innerHTML = `
      <li>Opening: <strong>${fmtEUR(toNum(s.openingEur))}</strong></li>
      <li>Sales × Payout: <strong>${fmtEUR(toNum(s.monthlyAmazonEur)*(toNum(s.payoutPct)||0))}</strong></li>
      <li>Extras (Σ): <strong>${fmtEUR(extraSum)}</strong></li>
      <li>Ausgaben (Σ): <strong>${fmtEUR(outSum)}</strong></li>
      <li>Zeitraum: <strong>${escapeHtml(s?.settings?.startMonth||"—")}</strong>, ${escapeHtml(String(s?.settings?.horizonMonths||18))} Monate</li>
    `;

    // Extras-Tabelle
    renderExtrasTable(s);

    // JSON-Preview (gereinigt)
    const clean = cleanStateForExport(loadState());
    elJson.textContent = JSON.stringify(clean, null, 2);
  }

  function renderExtrasTable(s){
    const rows = Array.isArray(s.extras) ? s.extras : (s.extras = []);
    elTblBody.innerHTML = rows.map((r,i)=> tr(r,i)).join("");
    // Bindings
    rows.forEach((r,i)=>{
      const row = elTblBody.querySelector(`tr[data-i="${i}"]`);
      const im = row.querySelector('input[name="month"]');
      const il = row.querySelector('input[name="label"]');
      const ia = row.querySelector('input[name="amount"]');
      const del= row.querySelector('button[data-del]');

      im.value = r.month || "";
      il.value = r.label || "";
      ia.value = r.amountEur ?? "0,00";

      im.oninput = ()=> { r.month = im.value.trim(); saveState(s); };
      il.oninput = ()=> { r.label = il.value; saveState(s); };
      ia.oninput = ()=> { r.amountEur = ia.value; saveState(s); updateAll(); }; // Update sums live
      del.onclick = ()=> { rows.splice(i,1); saveState(s); updateAll(); };
    });
  }

  function tr(_r,i){
    return `<tr data-i="${i}">
      <td><input name="month" class="in month" placeholder="YYYY-MM" /></td>
      <td><input name="label" class="in" placeholder="Bezeichnung" /></td>
      <td class="num"><input name="amount" class="in num" placeholder="1.234,56" /></td>
      <td class="num"><button data-del class="btn danger">×</button></td>
    </tr>`;
  }

  function seed(){
    const s = loadState();
    s.openingEur = "50.000,00";
    s.monthlyAmazonEur = "22.500,00";
    s.payoutPct = "0,85";
    s.settings ||= {};
    s.settings.startMonth = "2025-02";
    s.settings.horizonMonths = 18;
    s.extras = [
      { month:"2025-03", label:"USt-Erstattung", amountEur:"1.500,00" },
      { month:"2025-04", label:"Einmalzahlung", amountEur:"2.000,00" },
    ];
    s.outgoings = [
      { month:"2025-02", label:"Fixkosten", amountEur:"3.000,00" }
    ];
    saveState(s);
    updateAll();
  }

  function cleanStateForExport(s){
    const { _computed, ...rest } = s || {};
    return rest;
  }
  function toNum(x){ if(typeof x==="number") return x; return Number(String(x||"").replace(/\./g,"").replace(",", "."))||0; }
  function escapeHtml(str){ return String(str).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
}

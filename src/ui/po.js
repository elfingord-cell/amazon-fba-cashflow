// src/ui/po.js
// FBA-CF-0026 — PO-Form stabil: Prozentfelder als Text; Parsing erst beim Speichern.
// Export: render(root)

import { loadState, saveState } from "../data/storageLocal.js";
import { newPO, expandPO, fmtEUR } from "../domain/po.js";

function $(sel, r=document){ return r.querySelector(sel); }

function renderTable(root, pos){
  const rows = (pos||[]).map(p=>`
    <tr>
      <td>${p.number || "—"}</td>
      <td>${p.orderDate || "—"}</td>
      <td>${p.transportMode || "sea"} (${p.transportDays||0} T)</td>
      <td>${p.goodsEur || "0,00"}</td>
      <td>${p.depositPct ?? ""}/${p.balancePct ?? ""}</td>
    </tr>
  `).join("");
  return `
    <section class="card">
      <h2>Purchase Orders</h2>
      <table>
        <thead>
          <tr>
            <th>PO</th><th>Orderdatum</th><th>Transport</th><th>Warenwert (€)</th><th>Dep/Bal (%)</th>
          </tr>
        </thead>
        <tbody>${rows || ""}</tbody>
      </table>
    </section>
  `;
}

function renderForm(root, draft){
  // Prozentfelder SIND TEXT (nicht type="number")
  return `
  <section class="card">
    <h3>PO bearbeiten/anlegen</h3>
    <div class="grid two">
      <div>
        <label>PO-Nummer</label>
        <input id="po-number" type="text" value="${draft.number||""}">
      </div>
      <div>
        <label>Orderdatum</label>
        <input id="po-order" type="date" value="${draft.orderDate||""}">
      </div>
      <div>
        <label>Warenwert (EUR)</label>
        <input id="po-goods" type="text" inputmode="decimal" value="${draft.goodsEur||"0,00"}" placeholder="8.000,00">
      </div>
      <div>
        <label>Freight (EUR)</label>
        <input id="po-freight" type="text" inputmode="decimal" value="${draft.freightEur||"0,00"}" placeholder="500,00">
      </div>
      <div>
        <label>Deposit (%)</label>
        <input id="po-dep" type="text" inputmode="decimal" value="${draft.depositPct ?? 30}" placeholder="30 oder 30%">
      </div>
      <div>
        <label>Balance (%)</label>
        <input id="po-bal" type="text" inputmode="decimal" value="${draft.balancePct ?? 70}" placeholder="70 oder 70%">
      </div>
      <div>
        <label>Zoll (%)</label>
        <input id="po-duty" type="text" inputmode="decimal" value="${draft.dutyPct ?? 6}" placeholder="6,5%">
      </div>
      <div>
        <label>EUSt (%)</label>
        <input id="po-vat" type="text" inputmode="decimal" value="${draft.vatPct ?? 19}" placeholder="19%">
      </div>
      <div>
        <label>Produktion (Tage)</label>
        <input id="po-prod" type="number" min="0" step="1" value="${draft.productionDays ?? 30}">
      </div>
      <div>
        <label>Transport</label>
        <select id="po-mode">
          <option value="sea" ${draft.transportMode==="sea"?"selected":""}>Sea</option>
          <option value="rail" ${draft.transportMode==="rail"?"selected":""}>Rail</option>
          <option value="air" ${draft.transportMode==="air"?"selected":""}>Air</option>
        </select>
      </div>
      <div>
        <label>Transportdauer (Tage)</label>
        <input id="po-tdays" type="number" min="0" step="1" value="${draft.transportDays ?? 60}">
      </div>
      <div>
        <label>USt-Erstattung aktiv?</label>
        <select id="po-vatrefund">
          <option value="true"  ${(draft.vatRefund!==false)?"selected":""}>Ja</option>
          <option value="false" ${(draft.vatRefund===false)?"selected":""}>Nein</option>
        </select>
      </div>
      <div>
        <label>USt-Lag (Monate)</label>
        <input id="po-vatlag" type="number" min="0" step="1" value="${draft.vatLagMonths ?? 2}">
      </div>
    </div>

    <div style="margin-top:10px; display:flex; gap:8px">
      <button id="po-save" class="btn primary">Speichern</button>
      <button id="po-new"  class="btn">Neu</button>
    </div>

    <div id="po-preview" style="margin-top:12px"></div>
  </section>
  `;
}

function drawPreview(container, draft){
  try{
    const ev = expandPO(draft, {});
    const rows = ev.map(e=>`<tr><td>${e.date}</td><td>${e.type}</td><td>${e.label}</td><td style="text-align:right">${fmtEUR(e.amount)}</td></tr>`).join("");
    container.innerHTML = `
      <h4>Vorschau Cash-Events</h4>
      <table>
        <thead><tr><th>Datum</th><th>Typ</th><th>Label</th><th>Betrag</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }catch(err){
    container.innerHTML = `<div class="card warn"><strong>Fehler in Vorschau:</strong> ${String(err)}</div>`;
  }
}

export async function render(root){
  const state = loadState() || {};
  const pos = Array.isArray(state.pos) ? state.pos : [];
  let draft = newPO();

  root.innerHTML = `
    ${renderTable(root, pos)}
    ${renderForm(root, draft)}
  `;

  const els = {
    number:   $("#po-number", root),
    order:    $("#po-order", root),
    goods:    $("#po-goods", root),
    freight:  $("#po-freight", root),
    dep:      $("#po-dep", root),
    bal:      $("#po-bal", root),
    duty:     $("#po-duty", root),
    vat:      $("#po-vat", root),
    prod:     $("#po-prod", root),
    mode:     $("#po-mode", root),
    tdays:    $("#po-tdays", root),
    vatrefund:$("#po-vatrefund", root),
    vatlag:   $("#po-vatlag", root),
    save:     $("#po-save", root),
    neu:      $("#po-new", root),
    preview:  $("#po-preview", root)
  };

  function syncDraftFromInputs(){
    draft = {
      ...draft,
      number: (els.number.value || "").trim(),
      orderDate: els.order.value || draft.orderDate,
      goodsEur: els.goods.value,
      freightEur: els.freight.value,
      depositPct: els.dep.value,     // bewusst NICHT vorparsen
      balancePct: els.bal.value,     // parsing passiert in expandPO()
      dutyPct: els.duty.value,
      vatPct: els.vat.value,
      productionDays: Number(els.prod.value||0),
      transportMode: els.mode.value || "sea",
      transportDays: Number(els.tdays.value||0),
      vatRefund: (els.vatrefund.value === "true"),
      vatLagMonths: Number(els.vatlag.value||0),
    };
  }

  function refreshPreview(){
    syncDraftFromInputs();
    drawPreview(els.preview, draft);
  }

  // Vorschau aktualisieren bei Blur/Change (nicht bei jedem Key, damit Cursor nicht springt)
  ["change","blur"].forEach(evt=>{
    root.addEventListener(evt, (e)=>{
      const t = e.target;
      if (!t || !(t.id||"").startsWith("po-")) return;
      refreshPreview();
    });
  });

  els.neu.addEventListener("click", (e)=>{
    e.preventDefault();
    // neuen Draft – Formular neu rendern
    let fresh = newPO();
    draft = fresh;
    render(root);
  });

  els.save.addEventListener("click", (e)=>{
    e.preventDefault();
    syncDraftFromInputs();
    const s = loadState() || {};
    const arr = Array.isArray(s.pos) ? s.pos.slice() : [];
    if (!draft.id) draft.id = "po-"+Math.random().toString(36).slice(2,10);
    const idx = arr.findIndex(x=>x.id === draft.id);
    if (idx >= 0) arr[idx] = draft; else arr.push(draft);
    s.pos = arr;
    saveState(s);
    render(root);
  });

  // Initiale Vorschau
  refreshPreview();
}

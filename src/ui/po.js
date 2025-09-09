// src/ui/po.js
// FBA-CF-0023 — PO-UI (Liste + Formular + Vorschau)

import { loadState, saveState } from "../data/storageLocal.js";
import { newPO, expandPO, fmtEUR } from "../domain/po.js";

function $(sel, r=document){ return r.querySelector(sel); }
function $$ (sel, r=document){ return [...r.querySelectorAll(sel)]; }
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function toDE(n){ return new Intl.NumberFormat("de-DE",{minimumFractionDigits:2, maximumFractionDigits:2}).format(n||0); }
function clamp01(x){ const n=Number(x||0); return n>1 ? n/100 : n; }

function poRow(po){
  const gv = toDE(parseDE(po.goodsEur));
  return `<tr data-id="${po.id}">
    <td>${po.number || "—"}</td>
    <td>${po.orderDate}</td>
    <td class="muted">${gv} €</td>
  </tr>`;
}

function readPO(form){
  const f = new FormData(form);
  return {
    id: f.get("id"),
    number: f.get("number")?.trim(),
    orderDate: f.get("orderDate"),
    goodsEur: f.get("goodsEur"),
    depositPct: Number(f.get("depositPct")||0.3),
    balancePct: Number(f.get("balancePct")||0.7),
    productionDays: Number(f.get("productionDays")||30),
    transportMode: f.get("transportMode") || "sea",
    transportDays: Number(f.get("transportDays")||60),
    freightEur: f.get("freightEur"),
    dutyPct: Number(f.get("dutyPct")||0.06),
    vatPct: Number(f.get("vatPct")||0.19),
    vatRefund: f.get("vatRefund")==="on",
    vatLagMonths: Number(f.get("vatLagMonths")||2)
  };
}

function fillForm(form, po){
  form.reset();
  $$("[name]", form).forEach(el=>{
    const k = el.name;
    if (el.type==="checkbox") el.checked = !!po[k];
    else el.value = po[k] ?? "";
  });
}

export async function render(root){
  const state = loadState();
  const pos   = Array.isArray(state.pos) ? state.pos : [];
  let current = pos[0] || newPO();

  root.innerHTML = `
    <section class="card">
      <div class="page-header">
        <h2>Purchase Orders</h2>
        <div class="topnav">
          <button class="btn primary" id="po-add">+ Neue PO</button>
          <button class="btn" id="po-save">Speichern/Aktualisieren</button>
          <button class="btn danger" id="po-del">Löschen</button>
        </div>
      </div>

      <div class="grid two">
        <div>
          <table>
            <thead><tr><th>PO</th><th>Datum</th><th>Warenwert</th></tr></thead>
            <tbody id="po-list">
              ${pos.map(poRow).join("") || `<tr><td colspan="3" class="muted">Noch keine PO.</td></tr>`}
            </tbody>
          </table>
        </div>

        <form id="po-form" class="grid two" style="align-content:start">
          <input type="hidden" name="id" value="${current.id}">
          <div>
            <label>PO-Nummer</label>
            <input name="number" value="${current.number||""}">
          </div>
          <div>
            <label>Bestell-Datum</label>
            <input name="orderDate" type="date" value="${current.orderDate}">
          </div>

          <div>
            <label>Warenwert (EUR)</label>
            <input name="goodsEur" value="${current.goodsEur}">
          </div>
          <div></div>

          <div>
            <label>Deposit (%)</label>
            <input name="depositPct" value="${current.depositPct}">
          </div>
          <div>
            <label>Balance (%)</label>
            <input name="balancePct" value="${current.balancePct}">
          </div>

          <div>
            <label>Produktions-Tage</label>
            <input name="productionDays" value="${current.productionDays}">
          </div>
          <div>
            <label>Transport</label>
            <select name="transportMode">
              <option value="sea"  ${current.transportMode==="sea"?"selected":""}>Sea</option>
              <option value="rail" ${current.transportMode==="rail"?"selected":""}>Rail</option>
              <option value="air"  ${current.transportMode==="air"?"selected":""}>Air</option>
            </select>
          </div>

          <div>
            <label>Transport-Tage</label>
            <input name="transportDays" value="${current.transportDays}">
          </div>
          <div>
            <label>Freight (EUR)</label>
            <input name="freightEur" value="${current.freightEur}">
          </div>

          <div>
            <label>Zollsatz (%)</label>
            <input name="dutyPct" value="${current.dutyPct}">
          </div>
          <div>
            <label>EUSt (%)</label>
            <input name="vatPct" value="${current.vatPct}">
          </div>

          <div>
            <label>USt-Erstattung?</label>
            <input type="checkbox" name="vatRefund" ${current.vatRefund?"checked":""}>
          </div>
          <div>
            <label>Erstattung: Verzögerung (Monate)</label>
            <input name="vatLagMonths" value="${current.vatLagMonths}">
          </div>
        </form>
      </div>
    </section>

    <section class="card">
      <h3>Vorschau: Cash-Events</h3>
      <table>
        <thead><tr><th>Datum</th><th>Typ</th><th>Label</th><th style="text-align:right">Betrag</th></tr></thead>
        <tbody id="po-preview"></tbody>
      </table>
    </section>
  `;

  const form = $("#po-form", root);
  const list = $("#po-list", root);
  const prev = $("#po-preview", root);

  function renderPreview(){
    const po = readPO(form);
    const rows = expandPO(po).map(ev =>
      `<tr><td>${ev.date}</td><td class="muted">${ev.type}</td><td>${ev.label}</td><td style="text-align:right">${fmtEUR(ev.amount)}</td></tr>`
    ).join("");
    prev.innerHTML = rows || `<tr><td colspan="4" class="muted">Keine Events.</td></tr>`;
  }

  // Row click → load PO
  list.addEventListener("click", (e)=>{
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const po = pos.find(x=>x.id===tr.dataset.id); if (!po) return;
    fillForm(form, po);
    renderPreview();
  });

  // Add new
  $("#po-add", root).addEventListener("click", ()=>{
    const po = newPO();
    fillForm(form, po);
    renderPreview();
  });

  // Save / Update
  $("#po-save", root).addEventListener("click", ()=>{
    const po = readPO(form);
    const idx = pos.findIndex(x=>x.id===po.id);
    if (idx>=0) pos[idx]=po; else pos.push(po);
    state.pos = pos;
    saveState(state);
    render(root); // re-render page
  });

  // Delete
  $("#po-del", root).addEventListener("click", ()=>{
    const po = readPO(form);
    const idx = pos.findIndex(x=>x.id===po.id);
    if (idx>=0){ pos.splice(idx,1); state.pos=pos; saveState(state); render(root); }
  });

  // Live preview on input blur (keine Cursor-Sprünge beim Tippen)
  form.addEventListener("change", renderPreview);
  renderPreview();
}

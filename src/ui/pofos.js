// src/ui/pofos.js
import { loadState, saveState, addStateListener } from "../data/storageLocal.js";
import { expandOrders } from "../domain/orders.js";

const $ = (s,r=document)=>r.querySelector(s);
function parseDE(x){ return Number(String(x ?? 0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtEUR(n){ return n.toLocaleString("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:2}); }

const DEFAULT_PO = () => ({
  id: crypto.randomUUID(),
  poNo: "",
  orderDate: new Date().toISOString().slice(0,10),
  goodsEur: "0,00",
  mode: "sea",
  prodDays: 60,
  ddp: false,
  freightEur: "0,00",
  dutyPct: 0.065,
  dutyIncludeFreight: false,
  dutyOverrideEur: "",
  eustOverrideEur: "",
  milestones: [
    { label:"Deposit 30%", percent:30, anchor:"ORDER_DATE", lagDays:0 },
    { label:"Balance 70%", percent:70, anchor:"PROD_DONE",  lagDays:0 },
  ],
});

export async function render(root){
  let state = loadState();
  if (!state.orders) state.orders = { pos:[], fos:[] };

  function commit(){
    saveState(state);
    // Trigger Re-Render nur dieses Views
    render(root);
  }

  root.innerHTML = `
  <section class="card">
    <h2>PO/FO</h2>
    <p class="muted">Bestell- und Fracht-Cashflows modellieren. Beträge in EUR.</p>
  </section>

  <section class="card">
    <h3>Purchase Orders</h3>
    <div class="grid three">
      <div>
        <label>POs (Liste)</label>
        <table>
          <thead><tr><th>PO</th><th>Datum</th><th>Warenwert (€)</th><th></th></tr></thead>
          <tbody id="po-rows"></tbody>
        </table>
        <button class="btn" id="add-po">+ Neue PO</button>
      </div>
      <div id="po-form-wrap" class="grid" style="grid-template-columns:1fr">
        <!-- Formular -->
      </div>
      <div>
        <label>Vorschau: Cash-Events (Auswahl)</label>
        <div id="po-preview" class="muted">—</div>
      </div>
    </div>
  </section>

  <section class="card">
    <h3>Freight/Other (FO)</h3>
    <div class="grid two">
      <div>
        <table>
          <thead><tr><th>Datum</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
          <tbody id="fo-rows"></tbody>
        </table>
        <button class="btn" id="add-fo">+ FO hinzufügen</button>
      </div>
      <div class="muted">
        <p>FO sind einfache, datumsgenaue Ausgaben (z.B. zusätzliche Freight, Gebühren).</p>
      </div>
    </div>
  </section>
  `;

  // ----- POs -----
  const poTbody = $("#po-rows", root);
  const foTbody = $("#fo-rows", root);
  const formWrap = $("#po-form-wrap", root);
  const preview = $("#po-preview", root);

  function renderPOList(){
    poTbody.innerHTML = (state.orders.pos||[]).map(po => `
      <tr>
        <td>${po.poNo || "—"}</td>
        <td>${po.orderDate}</td>
        <td>${parseDE(po.goodsEur).toLocaleString("de-DE")}</td>
        <td style="text-align:right">
          <button class="btn" data-edit="${po.id}">Bearbeiten</button>
          <button class="btn danger" data-del="${po.id}">Löschen</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Noch keine POs</td></tr>`;
  }

  let editing = state.orders.pos?.[0]?.id || null;

  function renderPOForm(){
    const po = (state.orders.pos||[]).find(p=>p.id===editing) || DEFAULT_PO();
    formWrap.innerHTML = `
      <div class="grid two">
        <div>
          <label>PO-Nummer</label>
          <input id="poNo" value="${po.poNo||""}">
        </div>
        <div>
          <label>Bestell-Datum</label>
          <input id="orderDate" type="date" value="${po.orderDate}">
        </div>
        <div>
          <label>Warenwert (EUR)</label>
          <input id="goodsEur" value="${po.goodsEur}">
        </div>
        <div>
          <label>Transport</label>
          <select id="mode">
            <option value="sea" ${po.mode==="sea"?"selected":""}>Sea (~60)</option>
            <option value="rail" ${po.mode==="rail"?"selected":""}>Rail (~30)</option>
            <option value="air" ${po.mode==="air"?"selected":""}>Air (~10)</option>
          </select>
        </div>
        <div>
          <label>Produktionstage</label>
          <input id="prodDays" type="number" value="${po.prodDays}">
        </div>
        <div>
          <label>Freight (EUR)</label>
          <input id="freightEur" value="${po.freightEur}">
        </div>
        <div>
          <label>Zollsatz (%)</label>
          <input id="dutyPct" value="${String((po.dutyPct||0)*100).replace(".",",")}">
        </div>
        <div>
          <label><input id="ddp" type="checkbox" ${po.ddp?"checked":""}> DDP (Duty/ EUSt in Preis enthalten)</label>
          <label><input id="dutyIncF" type="checkbox" ${po.dutyIncludeFreight?"checked":""}> Duty-Basis inkl. Freight</label>
        </div>
        <div>
          <label>Zoll Override (EUR, optional)</label>
          <input id="dutyOv" value="${po.dutyOverrideEur ?? ""}">
        </div>
        <div>
          <label>EUSt Override (EUR, optional)</label>
          <input id="eustOv" value="${po.eustOverrideEur ?? ""}">
        </div>
      </div>

      <div class="card" style="margin:0">
        <h4 style="margin:0 0 8px">Meilensteine</h4>
        <table>
          <thead><tr><th>Label</th><th>%</th><th>Anker</th><th>Lag (T)</th><th></th></tr></thead>
          <tbody id="ms-rows">
            ${(po.milestones||[]).map((m,i)=>`
              <tr>
                <td><input data-ms="label" data-i="${i}" value="${m.label||""}"></td>
                <td><input data-ms="percent" data-i="${i}" type="number" value="${m.percent ?? 0}"></td>
                <td>
                  <select data-ms="anchor" data-i="${i}">
                    <option ${m.anchor==="ORDER_DATE"?"selected":""}>ORDER_DATE</option>
                    <option ${m.anchor==="PROD_DONE"?"selected":""}>PROD_DONE</option>
                    <option ${m.anchor==="ETD"?"selected":""}>ETD</option>
                    <option ${m.anchor==="ETA"?"selected":""}>ETA</option>
                  </select>
                </td>
                <td><input data-ms="lag" data-i="${i}" type="number" value="${m.lagDays ?? 0}"></td>
                <td style="text-align:right"><button class="btn danger" data-ms-del="${i}">×</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <button class="btn" id="add-ms">+ Meilenstein</button>
      </div>

      <div style="display:flex; gap:8px; margin-top:8px">
        <button class="btn primary" id="save-po">Speichern/Aktualisieren</button>
        <button class="btn" id="new-po">Neu</button>
      </div>
    `;

    // Handlers
    $("#add-ms", formWrap).onclick = ()=>{ po.milestones.push({label:"MS",percent:0,anchor:"ETD",lagDays:0}); commit(); };
    formWrap.querySelectorAll("button[data-ms-del]").forEach(b=> b.onclick = ()=>{ po.milestones.splice(Number(b.dataset.msDel),1); commit(); });

    formWrap.querySelectorAll("input[data-ms], select[data-ms]").forEach(inp=>{
      inp.oninput = ()=>{
        const i = Number(inp.dataset.i);
        const k = inp.dataset.ms;
        if (k==="percent" || k==="lag") po.milestones[i][k==="lag"?"lagDays":"percent"] = Number(inp.value||0);
        else if (k==="anchor") po.milestones[i].anchor = inp.value;
        else po.milestones[i].label = inp.value;
        saveState(state); // live
      };
    });

    $("#save-po", formWrap).onclick = ()=>{
      const upd = {
        ...po,
        poNo: $("#poNo", formWrap).value.trim(),
        orderDate: $("#orderDate", formWrap).value,
        goodsEur: $("#goodsEur", formWrap).value,
        mode: $("#mode", formWrap).value,
        prodDays: Number($("#prodDays", formWrap).value||0),
        freightEur: $("#freightEur", formWrap).value,
        dutyPct: parseDE($("#dutyPct", formWrap).value)/100,
        ddp: $("#ddp", formWrap).checked,
        dutyIncludeFreight: $("#dutyIncF", formWrap).checked,
        dutyOverrideEur: $("#dutyOv", formWrap).value,
        eustOverrideEur: $("#eustOv", formWrap).value,
      };
      const idx = (state.orders.pos||[]).findIndex(p=>p.id===po.id);
      if (idx>=0) state.orders.pos[idx]=upd; else state.orders.pos.push(upd);
      commit();
    };

    $("#new-po", formWrap).onclick = ()=>{ state.orders.pos.push(DEFAULT_PO()); editing = state.orders.pos.at(-1).id; commit(); };

    // Vorschau
    const events = expandOrders({ pos:[po], fos:[] });
    if (events.length===0){ preview.textContent = "—"; }
    else {
      preview.innerHTML = `
        <table>
          <thead><tr><th>Datum</th><th>Typ</th><th>Label</th><th style="text-align:right">Betrag</th></tr></thead>
          <tbody>
            ${events.map(e=>`
              <tr><td>${e.date.toISOString().slice(0,10)}</td><td>${e.type}</td><td>${e.label}</td><td style="text-align:right">${fmtEUR(e.amountEur)}</td></tr>
            `).join("")}
          </tbody>
        </table>`;
    }
  }

  function bindPOList(){
    poTbody.querySelectorAll("button[data-edit]").forEach(b=> b.onclick = ()=>{ editing = b.dataset.edit; renderPOForm(); });
    poTbody.querySelectorAll("button[data-del]").forEach(b=> b.onclick = ()=>{
      state.orders.pos = state.orders.pos.filter(p=>p.id!==b.dataset.del);
      if (editing===b.dataset.del) editing = state.orders.pos?.[0]?.id || null;
      commit();
    });
    $("#add-po", root).onclick = ()=>{ const n = DEFAULT_PO(); state.orders.pos.push(n); editing = n.id; commit(); };
  }

  // ----- FO -----
  function renderFOList(){
    foTbody.innerHTML = (state.orders.fos||[]).map(fo => `
      <tr>
        <td><input data-fo="date" data-id="${fo.id}" type="date" value="${fo.date}"></td>
        <td><input data-fo="label" data-id="${fo.id}" value="${fo.label||""}"></td>
        <td><input data-fo="amount" data-id="${fo.id}" value="${fo.amountEur||"0,00"}"></td>
        <td style="text-align:right"><button class="btn danger" data-fo-del="${fo.id}">×</button></td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Keine FO</td></tr>`;

    foTbody.querySelectorAll("input[data-fo]").forEach(inp=>{
      inp.onchange = ()=>{
        const id = inp.dataset.id;
        const k  = inp.dataset.fo;
        const row = state.orders.fos.find(x=>x.id===id);
        if (!row) return;
        if (k==="amount") row.amountEur = inp.value;
        else row[k] = inp.value;
        saveState(state);
      };
    });

    foTbody.querySelectorAll("button[data-fo-del]").forEach(b=> b.onclick = ()=>{
      state.orders.fos = state.orders.fos.filter(x=>x.id!==b.dataset.foDel);
      commit();
    });

    $("#add-fo", root).onclick = ()=>{
      const id = crypto.randomUUID();
      (state.orders.fos ||= []).push({ id, date:new Date().toISOString().slice(0,10), label:"FO", amountEur:"0,00" });
      commit();
    };
  }

  // initial render
  renderPOList(); bindPOList(); renderPOForm(); renderFOList();

  // Live neuzeichnen, wenn außerhalb Werte geändert werden
  const off = addStateListener(()=>{ render(root); });
  root.addEventListener("DOMNodeRemoved", ()=>off && off());
}

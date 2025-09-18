// FBA-CF-0028 — PO-UI: beliebig viele Zahlungsmeilensteine, ohne Abhängigkeit zu ../domain/po.js
import { loadState, saveState } from "../data/storageLocal.js";

// ---- Helpers ----
function $(sel, r = document) { return r.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "dataset") { for (const [dk,dv] of Object.entries(v)) n.dataset[dk]=dv; }
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) n.append(c?.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function parseDE(x) {
  if (x == null) return 0;
  const s = String(x).trim().replace(/\./g,"").replace(",",".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n){ return Number(n||0).toLocaleString("de-DE",{style:"currency",currency:"EUR"}) }
function clampPct(x){ const v=parseDE(x); if (v<0) return 0; if (v>100) return 100; return v; }
function addDays(date, days){ const d=new Date(date); d.setDate(d.getDate()+Number(days||0)); return d; }

function defaultPO(){
  const today = new Date().toISOString().slice(0,10);
  return {
    id: Math.random().toString(36).slice(2,9),
    poNo: "",
    orderDate: today,
    goodsEur: "0,00",
    prodDays: 60,
    transport: "sea",
    transitDays: 60, // sea default
    milestones: [
      { id: Math.random().toString(36).slice(2,9), label:"Deposit", percent:30, anchor:"ORDER_DATE", lagDays:0 },
      { id: Math.random().toString(36).slice(2,9), label:"Balance", percent:70, anchor:"PROD_DONE", lagDays:0 }
    ]
  };
}

function anchorDate(po, anchor){
  const order = new Date(po.orderDate);
  const prodDone = addDays(order, Number(po.prodDays||0));
  const etd = prodDone;
  const eta = addDays(etd, Number(po.transitDays||0));
  if (anchor==="ORDER_DATE") return order;
  if (anchor==="PROD_DONE") return prodDone;
  if (anchor==="ETD") return etd;
  return eta;
}
function msSum100(ms){
  const s = (ms||[]).reduce((a,b)=> a + clampPct(b.percent||0), 0);
  return Math.round(s*10)/10;
}

function renderList(container, pos, onEdit, onDelete){
  container.innerHTML = "";
  const table = el("table", {}, [
    el("thead",{},[ el("tr",{},[
      el("th",{},["PO"]),
      el("th",{},["Order"]),
      el("th",{},["Warenwert"]),
      el("th",{},["Zahlungen"]),
      el("th",{},["Transport"]),
      el("th",{},["Aktionen"])
    ])]),
    el("tbody",{}, pos.map(p => {
      return el("tr",{},[
        el("td",{},[p.poNo||"—"]),
        el("td",{},[p.orderDate||"—"]),
        el("td",{},[fmtEUR(parseDE(p.goodsEur))]),
        el("td",{},[String((p.milestones||[]).length)]),
        el("td",{},[`${p.transport||"sea"} · ${p.transitDays||0}d`]),
        el("td",{},[
          el("button",{class:"btn", onclick:()=>onEdit(p)},["Bearbeiten"]),
          " ",
          el("button",{class:"btn danger", onclick:()=>onDelete(p)},["Löschen"])
        ])
      ]);
    }))
  ]);
  container.append(table);
}

function renderMsTable(container, po, onChange){
  container.innerHTML = "";
  const hdr = el("div", {class:"muted", style:"margin-bottom:6px"}, ["Zahlungsmeilensteine (Summe muss 100 % sein)"]);
  container.append(hdr);

  const tbl = el("table",{},[
    el("thead",{},[ el("tr",{},[
      el("th",{},["Label"]),
      el("th",{},["%"]),
      el("th",{},["Anker"]),
      el("th",{},["Lag (Tage)"]),
      el("th",{},["Datum"]),
      el("th",{},["Betrag (€)"]),
      el("th",{},[""])
    ])]),
    el("tbody",{}, (po.milestones||[]).map((m,i)=>{
      const goods = parseDE(po.goodsEur);
      const pct = clampPct(m.percent);
      const base = anchorDate(po, m.anchor||"ORDER_DATE");
      const due  = addDays(base, Number(m.lagDays||0));
      const amount = goods * (pct/100);

      return el("tr",{},[
        el("td",{},[
          el("input",{value:m.label||"", oninput:(e)=>{ m.label = e.target.value; onChange(); }})
        ]),
        el("td",{},[
          el("input",{type:"text", value:String(m.percent ?? 0), oninput:(e)=>{ m.percent = e.target.value; onChange(); }})
        ]),
        el("td",{},[
          (()=>{
            const s = el("select",{ onchange:(e)=>{ m.anchor = e.target.value; onChange(); }},[
              el("option",{value:"ORDER_DATE"},["ORDER_DATE"]),
              el("option",{value:"PROD_DONE"},["PROD_DONE"]),
              el("option",{value:"ETD"},["ETD"]),
              el("option",{value:"ETA"},["ETA"]),
            ]);
            s.value = m.anchor || "ORDER_DATE";
            return s;
          })()
        ]),
        el("td",{},[
          el("input",{type:"number", value:String(m.lagDays||0), oninput:(e)=>{ m.lagDays = Number(e.target.value||0); onChange(); }})
        ]),
        el("td",{},[ due.toISOString().slice(0,10) ]),
        el("td",{},[ fmtEUR(amount) ]),
        el("td",{},[
          el("button",{class:"btn danger", onclick:()=>{ po.milestones.splice(i,1); onChange(); }},["Entfernen"])
        ])
      ]);
    }))
  ]);
  container.append(tbl);

  const addBtn = el("button",{class:"btn", style:"margin-top:8px", onclick:()=>{
    const nextN = (po.milestones||[]).length;
    po.milestones.push({ id: Math.random().toString(36).slice(2,9), label:`Balance ${nextN}`, percent:0, anchor:"ETA", lagDays:0 });
    onChange();
  }},["+ Zahlung hinzufügen"]);
  container.append(addBtn);

  const sum = msSum100(po.milestones);
  const warn = sum !== 100;
  const note = el("div",{style:`margin-top:8px;font-weight:600;${warn?'color:#c23636':'color:#0f9960'}`},[
    warn ? `Summe: ${sum}% — Bitte auf 100% anpassen.` : `Summe: 100% ✓`
  ]);
  container.append(note);
}

export async function render(root){
  const state = loadState();
  if (!Array.isArray(state.pos)) state.pos = [];

  // Layout
  root.innerHTML = `
    <section class="card">
      <h2>Purchase Orders</h2>
      <div id="po-list"></div>
    </section>
    <section class="card">
      <h3>PO bearbeiten/anlegen</h3>
      <div class="grid two">
        <div>
          <label>PO-Nummer</label>
          <input id="poNo" placeholder="z. B. 25007" />
        </div>
        <div>
          <label>Bestelldatum</label>
          <input id="orderDate" type="date" />
        </div>
        <div>
          <label>Warenwert (€)</label>
          <input id="goods" placeholder="z. B. 8.000,00" />
        </div>
        <div>
          <label>Produktionstage</label>
          <input id="prod" type="number" value="60"/>
        </div>
        <div>
          <label>Transport</label>
          <select id="transport">
            <option value="sea">Sea</option>
            <option value="rail">Rail</option>
            <option value="air">Air</option>
          </select>
        </div>
        <div>
          <label>Transit-Tage</label>
          <input id="transit" type="number" value="60"/>
        </div>
      </div>
      <div id="ms-zone" style="margin-top:10px"></div>
      <div style="display:flex; gap:8px; margin-top:10px">
        <button class="btn" id="save">Speichern</button>
        <button class="btn" id="new">Neue PO</button>
        <button class="btn danger" id="delete">Löschen</button>
      </div>
      <div id="preview" class="muted" style="margin-top:6px"></div>
    </section>
  `;

  const listZone = $("#po-list", root);
  const poNo = $("#poNo", root);
  const orderDate = $("#orderDate", root);
  const goods = $("#goods", root);
  const prod = $("#prod", root);
  const transport = $("#transport", root);
  const transit = $("#transit", root);
  const msZone = $("#ms-zone", root);
  const btnSave = $("#save", root);
  const btnNew = $("#new", root);
  const btnDel = $("#delete", root);
  const preview = $("#preview", root);

  let editing = defaultPO();

  function loadForm(p){
    editing = JSON.parse(JSON.stringify(p));
    poNo.value = editing.poNo || "";
    orderDate.value = editing.orderDate || new Date().toISOString().slice(0,10);
    goods.value = String(editing.goodsEur ?? "0,00");
    prod.value = String(editing.prodDays ?? 60);
    transport.value = editing.transport || "sea";
    transit.value = String(editing.transitDays ?? (editing.transport==="air"?10: editing.transport==="rail"?30:60));
    renderMsTable(msZone, editing, onAnyChange);
    updatePreview();
    updateSaveEnabled();
  }

  function onAnyChange(){
    if (!transit.value) {
      transit.value = editing.transport==="air"? "10" : (editing.transport==="rail"?"30":"60");
    }
    updatePreview();
    updateSaveEnabled();
  }

  function updatePreview(){
    const goodsV = parseDE(goods.value);
    const rows = (editing.milestones||[]).map(m=>{
      const pct = clampPct(m.percent);
      const base = anchorDate({
        orderDate: orderDate.value,
        prodDays: Number(prod.value||0),
        transport: transport.value,
        transitDays: Number(transit.value||0)
      }, m.anchor||"ORDER_DATE");
      const due  = addDays(base, Number(m.lagDays||0));
      return `${due.toISOString().slice(0,10)} · ${m.label||"Zahlung"} — ${fmtEUR(goodsV*(pct/100))}`;
    });
    preview.textContent = rows.length ? rows.join(" | ") : "Keine Zahlungen definiert.";
  }

  function updateSaveEnabled(){
    const sum = (editing.milestones||[]).reduce((a,b)=> a + clampPct(b.percent||0), 0);
    const ok = (Math.round(sum*10)/10 === 100)
      && (poNo.value.trim()!=="")
      && (parseDE(goods.value)>0)
      && !!orderDate.value;
    btnSave.disabled = !ok;
  }

  function save(){
    editing.poNo = poNo.value.trim();
    editing.orderDate = orderDate.value;
    editing.goodsEur = goods.value;
    editing.prodDays = Number(prod.value||0);
    editing.transport = transport.value;
    editing.transitDays = Number(transit.value||0);

    const st = loadState();
    const arr = Array.isArray(st.pos) ? st.pos : [];
    const idx = arr.findIndex(x => (x.id && x.id===editing.id) || (x.poNo && x.poNo===editing.poNo));
    if (idx >= 0) arr[idx] = editing; else arr.push(editing);
    st.pos = arr;
    saveState(st);
    renderList(listZone, st.pos, onEdit, onDelete);
  }

  function onEdit(p){ loadForm(p); }
  function onDelete(p){
    const st = loadState();
    st.pos = (st.pos||[]).filter(x => x !== p);
    saveState(st);
    renderList(listZone, st.pos, onEdit, onDelete);
    loadForm(defaultPO());
  }

  goods.addEventListener("input", onAnyChange);
  prod.addEventListener("input", e=>{ editing.prodDays = Number(e.target.value||0); onAnyChange(); });
  transport.addEventListener("change", e=>{
    editing.transport = e.target.value;
    if (editing.transport==="air") editing.transitDays = 10;
    if (editing.transport==="rail") editing.transitDays = 30;
    if (editing.transport==="sea") editing.transitDays = 60;
    transit.value = String(editing.transitDays);
    onAnyChange();
  });
  transit.addEventListener("input", e=>{ editing.transitDays = Number(e.target.value||0); onAnyChange(); });
  poNo.addEventListener("input", onAnyChange);
  orderDate.addEventListener("input", onAnyChange);

  $("#save", root).addEventListener("click", save);
  $("#new", root).addEventListener("click", ()=> loadForm(defaultPO()));
  $("#delete", root).addEventListener("click", ()=> onDelete(editing));

  renderList($("#po-list", root), state.pos, onEdit, onDelete);
  loadForm(defaultPO());
}

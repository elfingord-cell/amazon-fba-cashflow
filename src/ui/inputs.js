
export function InputsView(state, save) {
  const el = document.createElement("section");

  // Settings
  const s = state.settings;
  const settings = document.createElement("div");
  settings.className = "card";
  settings.innerHTML = `
    <h3>Einstellungen</h3>
    <div class="grid three">
      <div><label>Startmonat (YYYY-MM)</label><input id="s-start" value="${s.startMonth}" /></div>
      <div><label>Horizont (Monate)</label><input id="s-horiz" type="number" min="1" max="60" value="${s.horizonMonths}" /></div>
      <div><label>Opening Balance (€)</label><input id="s-open" value="${s.openingBalance}" /></div>
    </div>
  `;
  settings.querySelector("#s-start").addEventListener("input", e => save({ ...state, settings: { ...s, startMonth: e.target.value }}));
  settings.querySelector("#s-horiz").addEventListener("input", e => save({ ...state, settings: { ...s, horizonMonths: Math.max(1, parseInt(e.target.value||"1")) }}));
  settings.querySelector("#s-open").addEventListener("input", e => save({ ...state, settings: { ...s, openingBalance: e.target.value }}));

  // Incomings
  const inc = document.createElement("div");
  inc.className = "card";
  inc.innerHTML = `
    <h3>Einnahmen (Umsatz + Auszahlungsquote)</h3>
    <table>
      <thead><tr><th>Monat (YYYY-MM)</th><th>Umsatz €</th><th>Auszahlungsquote</th><th></th></tr></thead>
      <tbody id="inc-body"></tbody>
    </table>
    <button class="btn" id="inc-add">Zeile hinzufügen</button>
  `;
  const incBody = inc.querySelector("#inc-body");
  function renderInc(){
    incBody.innerHTML = "";
    state.incomings.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input value="${r.month}" aria-label="Monat" /></td>
        <td><input value="${r.revenueEur}" aria-label="Umsatz in EUR" /></td>
        <td><input value="${r.payoutRate}" aria-label="Auszahlungsquote (z.B. 0,86 oder 86)" /></td>
        <td><button class="btn danger" aria-label="Zeile löschen">Löschen</button></td>
      `;
      const [m, rev, pr, del] = tr.querySelectorAll("input,button");
      m.addEventListener("input", e => { const a=[...state.incomings]; a[idx]={...a[idx], month:e.target.value}; save({ ...state, incomings:a }); });
      rev.addEventListener("input", e => { const a=[...state.incomings]; a[idx]={...a[idx], revenueEur:e.target.value}; save({ ...state, incomings:a }); });
      pr.addEventListener("input", e => { const a=[...state.incomings]; a[idx]={...a[idx], payoutRate:e.target.value}; save({ ...state, incomings:a }); });
      del.addEventListener("click", () => { const a=[...state.incomings]; a.splice(idx,1); save({ ...state, incomings:a }); });
      incBody.appendChild(tr);
    });
  }
  inc.querySelector("#inc-add").addEventListener("click", () => {
    const a=[...state.incomings, { month: state.settings.startMonth, revenueEur: "0,00", payoutRate: "0,85" }];
    save({ ...state, incomings: a });
  });
  renderInc();

  // Extras
  const ex = document.createElement("div");
  ex.className = "card";
  ex.innerHTML = `
    <h3>Zusätzliche Inflows</h3>
    <table>
      <thead><tr><th>Monat (YYYY-MM)</th><th>Label</th><th>Betrag €</th><th></th></tr></thead>
      <tbody id="ex-body"></tbody>
    </table>
    <button class="btn" id="ex-add">Zeile hinzufügen</button>
  `;
  const exBody = ex.querySelector("#ex-body");
  function renderEx(){
    exBody.innerHTML = "";
    state.extras.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input value="${r.month}" /></td>
        <td><input value="${r.label||""}" /></td>
        <td><input value="${r.amountEur}" /></td>
        <td><button class="btn danger">Löschen</button></td>
      `;
      const [m, lb, am, del] = tr.querySelectorAll("input,button");
      m.addEventListener("input", e => { const a=[...state.extras]; a[idx]={...a[idx], month:e.target.value}; save({ ...state, extras:a }); });
      lb.addEventListener("input", e => { const a=[...state.extras]; a[idx]={...a[idx], label:e.target.value}; save({ ...state, extras:a }); });
      am.addEventListener("input", e => { const a=[...state.extras]; a[idx]={...a[idx], amountEur:e.target.value}; save({ ...state, extras:a }); });
      del.addEventListener("click", () => { const a=[...state.extras]; a.splice(idx,1); save({ ...state, extras:a }); });
      exBody.appendChild(tr);
    });
  }
  ex.querySelector("#ex-add").addEventListener("click", () => {
    const a=[...state.extras, { month: state.settings.startMonth, label:"", amountEur:"0,00" }];
    save({ ...state, extras: a });
  });
  renderEx();

  // Outgoings
  const out = document.createElement("div");
  out.className = "card";
  out.innerHTML = `
    <h3>Ausgaben</h3>
    <table>
      <thead><tr><th>Monat (YYYY-MM)</th><th>Label</th><th>Betrag €</th><th></th></tr></thead>
      <tbody id="out-body"></tbody>
    </table>
    <button class="btn" id="out-add">Zeile hinzufügen</button>
  `;
  const outBody = out.querySelector("#out-body");
  function renderOut(){
    outBody.innerHTML = "";
    state.outgoings.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input value="${r.month}" /></td>
        <td><input value="${r.label||""}" /></td>
        <td><input value="${r.amountEur}" /></td>
        <td><button class="btn danger">Löschen</button></td>
      `;
      const [m, lb, am, del] = tr.querySelectorAll("input,button");
      m.addEventListener("input", e => { const a=[...state.outgoings]; a[idx]={...a[idx], month:e.target.value}; save({ ...state, outgoings:a }); });
      lb.addEventListener("input", e => { const a=[...state.outgoings]; a[idx]={...a[idx], label:e.target.value}; save({ ...state, outgoings:a }); });
      am.addEventListener("input", e => { const a=[...state.outgoings]; a[idx]={...a[idx], amountEur:e.target.value}; save({ ...state, outgoings:a }); });
      del.addEventListener("click", () => { const a=[...state.outgoings]; a.splice(idx,1); save({ ...state, outgoings:a }); });
      outBody.appendChild(tr);
    });
  }
  out.querySelector("#out-add").addEventListener("click", () => {
    const a=[...state.outgoings, { month: state.settings.startMonth, label:"", amountEur:"0,00" }];
    save({ ...state, outgoings: a });
  });
  renderOut();

  el.appendChild(settings);
  el.appendChild(inc);
  el.appendChild(ex);
  el.appendChild(out);
  return el;
}

// FBA-CF-0011 — Zeilenbasierte Eingaben (kompakt)
// - Umsatz × Payout: je Monat 1 Zeile (Monat / Umsatz / Quote)
// - Ausgaben: je Eintrag 1 Zeile (Monat / Label / Betrag / Löschen)
// - Extras bleibt wie zuvor, ebenfalls zeilenbasiert
// - DE-Formatierung beim Verlassen (blur/change); kein Cursor-Sprung

import { loadState, saveState } from "../data/storageLocal.js";

const $  = (sel, r=document)=> r.querySelector(sel);
const esc = (s)=> String(s??"").replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// Zahlen-Helper (deutsch)
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtDE(n){ return (Number(n)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function pctToDisplay(p){ // 0.85 -> "0,85"
  const v = Number(p)||0;
  return String(v).replace(".", ",");
}
function monthSeq(startYm="2025-02", n=18){
  const [y,m] = startYm.split("-").map(Number);
  const out=[]; for(let i=0;i<n;i++){ const d=new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

export async function render(root){
  let s = loadState();
  // Guard: Felder sicherstellen
  s.settings  = s.settings  || { startMonth:"2025-02", horizonMonths:18, openingBalance:"50.000,00" };
  s.incomings = Array.isArray(s.incomings) ? s.incomings : [];
  s.extras    = Array.isArray(s.extras)    ? s.extras    : [];
  s.outgoings = Array.isArray(s.outgoings) ? s.outgoings : [];

  // UI
  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>

      <!-- Kopf: Opening + Zeitraum -->
      <div class="grid two" style="gap:12px">
        <div class="card soft">
          <label class="muted">Opening (EUR)</label>
          <div class="row" style="gap:8px;align-items:center">
            <input id="inp-opening" class="in" type="text" style="max-width:180px" value="${esc(s.openingEur)}" />
            <span class="muted" style="font-size:.9rem">z. B. 50.000,00</span>
          </div>
        </div>
        <div class="card soft">
          <label class="muted">Zeitraum</label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <span class="muted">Start</span>
            <input id="inp-start" class="in" type="month" style="max-width:150px" value="${esc(s?.settings?.startMonth || "2025-02")}" />
            <span class="muted">Monate</span>
            <input id="inp-hor" class="in" type="number" min="1" max="36" style="max-width:110px" value="${esc(s?.settings?.horizonMonths || 18)}" />
          </div>
        </div>
      </div>

      <!-- Umsatz × Payout -->
      <section class="card soft" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 class="muted" style="margin:0">Umsatz × Payout (je Monat 1 Zeile)</h3>
          <span class="muted" style="font-size:.9rem">Umsatz: 1.234,56 · Quote: 0,85 oder 85</span>
        </div>
        <div class="table compact">
          <div class="tr th" style="display:grid;grid-template-columns:140px 170px 110px;gap:8px">
            <div>Monat</div><div>Umsatz (EUR)</div><div>Quote</div>
          </div>
          <div id="inc-rows"></div>
        </div>
      </section>

      <!-- Ausgaben -->
      <section class="card soft" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 class="muted" style="margin:0">Ausgaben (Fixkosten, Tools, etc.)</h3>
          <button id="btn-add-out" class="btn">+ Zeile</button>
        </div>
        <div class="table compact">
          <div class="tr th" style="display:grid;grid-template-columns:140px 260px 140px 32px;gap:8px">
            <div>Monat</div><div>Label</div><div>Betrag (EUR)</div><div></div>
          </div>
          <div id="out-rows"></div>
        </div>
      </section>

      <!-- Extras -->
      <section class="card soft" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 class="muted" style="margin:0">Extras (Ein-/Auszahlungen)</h3>
          <button id="btn-add-extra" class="btn">+ Zeile</button>
        </div>
        <div class="table compact">
          <div class="tr th" style="display:grid;grid-template-columns:140px 260px 140px 32px;gap:8px">
            <div>Monat</div><div>Label</div><div>Betrag (EUR)</div><div></div>
          </div>
          <div id="ex-rows"></div>
        </div>
      </section>
    </section>
  `;

  // Opening
  const inpOpening = $("#inp-opening");
  inpOpening.addEventListener("change", () => {
    s.openingEur = fmtDE(parseDE(inpOpening.value));
    inpOpening.value = s.openingEur;
    saveState(s);
  });
  inpOpening.addEventListener("blur", ()=> inpOpening.dispatchEvent(new Event("change")));

  // Zeitraum -> Monatszeilen synchronisieren
  $("#inp-start").addEventListener("change", (e)=>{
    s.settings.startMonth = e.target.value || s.settings.startMonth;
    reseedIncomings(); drawIncomings(); saveState(s);
  });
  $("#inp-hor").addEventListener("change", (e)=>{
    const n = Math.max(1, Math.min(36, Number(e.target.value)||18));
    s.settings.horizonMonths = n;
    reseedIncomings(); drawIncomings(); saveState(s);
  });

  function reseedIncomings(){
    const months = monthSeq(s?.settings?.startMonth||"2025-02", Number(s?.settings?.horizonMonths||18));
    const prev = new Map((s.incomings||[]).map(r=>[r.month,r]));
    s.incomings = months.map(m=>{
      const ref = prev.get(m) || { revenueEur:"0,00", payoutPct:0.85 };
      return { month:m, revenueEur: ref.revenueEur, payoutPct: ref.payoutPct };
    });
  }

  // Zeichnen: Umsatz × Payout
  function drawIncomings(){
    const box = $("#inc-rows");
    box.innerHTML = s.incomings.map((r,i)=>`
      <div class="tr" style="display:grid;grid-template-columns:140px 170px 110px;gap:8px;align-items:center">
        <input class="in" type="month"  data-i="${i}" data-f="m"   style="max-width:140px" value="${esc(r.month)}"/>
        <input class="in" type="text"   data-i="${i}" data-f="rev" style="max-width:170px" value="${esc(r.revenueEur)}" placeholder="1.234,56"/>
        <input class="in" type="text"   data-i="${i}" data-f="pct" style="max-width:110px" value="${esc(pctToDisplay(r.payoutPct))}" placeholder="0,85"/>
      </div>
    `).join("");

    box.querySelectorAll("input").forEach(inp=>{
      const i = Number(inp.getAttribute("data-i"));
      const f = inp.getAttribute("data-f");

      if (f === "m") {
        inp.addEventListener("change", ()=>{ s.incomings[i].month = inp.value; saveState(s); });
      }
      if (f === "rev") {
        inp.addEventListener("change", ()=>{
          const pretty = fmtDE(parseDE(inp.value));
          s.incomings[i].revenueEur = pretty; inp.value = pretty; saveState(s);
        });
        inp.addEventListener("blur", ()=> inp.dispatchEvent(new Event("change")));
      }
      if (f === "pct") {
        inp.addEventListener("change", ()=>{
          const raw = parseDE(inp.value);
          const pct = raw > 1 ? raw/100 : raw;
          s.incomings[i].payoutPct = Number.isFinite(pct) ? Number(pct) : 0.85;
          inp.value = pctToDisplay(s.incomings[i].payoutPct);
          saveState(s);
        });
        inp.addEventListener("blur", ()=> inp.dispatchEvent(new Event("change")));
      }
    });
  }

  // Zeichnen: Ausgaben
  function drawOutgoings(){
    const box = $("#out-rows");
    box.innerHTML = s.outgoings.map((r,i)=>`
      <div class="tr" style="display:grid;grid-template-columns:140px 260px 140px 32px;gap:8px;align-items:center">
        <input  class="in" type="month" value="${esc(r.month||"")}" data-i="${i}" data-f="m"   style="max-width:140px" />
        <input  class="in" type="text"  value="${esc(r.label||"")}" data-i="${i}" data-f="l"   style="max-width:260px" placeholder="z. B. Fixkosten"/>
        <input  class="in" type="text"  value="${esc(r.amountEur||"0,00")}" data-i="${i}" data-f="a"   style="max-width:140px" placeholder="1.234,56"/>
        <button class="btn danger" data-i="${i}" data-f="x" title="Zeile löschen">✕</button>
      </div>
    `).join("");

    box.querySelectorAll(".tr").forEach(row=>{
      const i = Number(row.querySelector("[data-i]")?.getAttribute("data-i"));
      row.querySelectorAll("input,button").forEach(el=>{
        const f = el.getAttribute("data-f");
        if (f === "m") el.addEventListener("change", ()=>{ s.outgoings[i].month = el.value; saveState(s); });
        if (f === "l") el.addEventListener("change", ()=>{ s.outgoings[i].label = el.value; saveState(s); });
        if (f === "a") {
          el.addEventListener("change", ()=>{
            const pretty = fmtDE(parseDE(el.value));
            s.outgoings[i].amountEur = pretty; el.value = pretty; saveState(s);
          });
          el.addEventListener("blur", ()=> el.dispatchEvent(new Event("change")));
        }
        if (f === "x") el.addEventListener("click", ()=>{ s.outgoings.splice(i,1); saveState(s); drawOutgoings(); });
      });
    });
  }

  // Zeichnen: Extras (unverändert, aber in einer Zeile)
  function drawExtras(){
    const box = $("#ex-rows");
    box.innerHTML = s.extras.map((r,i)=>`
      <div class="tr" style="display:grid;grid-template-columns:140px 260px 140px 32px;gap:8px;align-items:center">
        <input  class="in" type="month" value="${esc(r.month||"")}" data-i="${i}" data-f="m"   style="max-width:140px" />
        <input  class="in" type="text"  value="${esc(r.label||"")}" data-i="${i}" data-f="l"   style="max-width:260px" placeholder="z. B. USt-Erstattung"/>
        <input  class="in" type="text"  value="${esc(r.amountEur||"0,00")}" data-i="${i}" data-f="a"   style="max-width:140px" placeholder="1.234,56"/>
        <button class="btn danger" data-i="${i}" data-f="x" title="Zeile löschen">✕</button>
      </div>
    `).join("");

    box.querySelectorAll(".tr").forEach(row=>{
      const i = Number(row.querySelector("[data-i]")?.getAttribute("data-i"));
      row.querySelectorAll("input,button").forEach(el=>{
        const f = el.getAttribute("data-f");
        if (f === "m") el.addEventListener("change", ()=>{ s.extras[i].month = el.value; saveState(s); });
        if (f === "l") el.addEventListener("change", ()=>{ s.extras[i].label = el.value; saveState(s); });
        if (f === "a") {
          el.addEventListener("change", ()=>{
            const pretty = fmtDE(parseDE(el.value));
            s.extras[i].amountEur = pretty; el.value = pretty; saveState(s);
          });
          el.addEventListener("blur", ()=> el.dispatchEvent(new Event("change")));
        }
        if (f === "x") el.addEventListener("click", ()=>{ s.extras.splice(i,1); saveState(s); drawExtras(); });
      });
    });
  }

  // Buttons: Zeilen hinzufügen
  $("#btn-add-out").addEventListener("click", ()=>{
    const m0 = s?.incomings?.[0]?.month || s?.settings?.startMonth || "2025-02";
    s.outgoings.push({ month:m0, label:"", amountEur:"0,00" });
    saveState(s); drawOutgoings();
  });
  $("#btn-add-extra").addEventListener("click", ()=>{
    const m0 = s?.incomings?.[0]?.month || s?.settings?.startMonth || "2025-02";
    s.extras.push({ month:m0, label:"", amountEur:"0,00" });
    saveState(s); drawExtras();
  });

  // Initial zeichnen
  if (s.incomings.length === 0) reseedIncomings();
  drawIncomings(); drawOutgoings(); drawExtras();
}

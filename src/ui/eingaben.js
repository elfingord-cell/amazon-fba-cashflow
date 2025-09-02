// FBA-CF-0009 — Eingaben: Monats-Umsatz & Payout, Extras-Editor
import { loadState, saveState } from "../data/storageLocal.js";

const $ = (sel, r=document)=> r.querySelector(sel);
const esc = (s)=> String(s??"").replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtDE(n){ return (Number(n)||0).toLocaleString("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}); }

export async function render(root){
  let s = loadState();
  const months = s.incomings.map(r=>r.month);

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>

      <div class="grid two">
        <div class="card soft">
          <label class="muted">Opening (EUR)</label>
          <input id="inp-opening" class="in" type="text" value="${esc(s.openingEur)}" />
          <p class="muted">deutsches Zahlenformat · beim Verlassen wird formatiert</p>
        </div>

        <div class="card soft">
          <h3 class="muted">Zeitraum</h3>
          <div class="row" style="gap:8px">
            <label class="muted">Start</label>
            <input id="inp-start" class="in" type="month" value="${esc(s?.settings?.startMonth || "2025-02")}" />
            <label class="muted">Monate</label>
            <input id="inp-hor" class="in" type="number" min="1" max="36" value="${esc(s?.settings?.horizonMonths || 18)}" style="max-width:110px"/>
          </div>
          <p class="muted">Änderung erzeugt neu berechnete Monatszeilen (Umsatz/Quote werden aus bestehenden Werten kopiert).</p>
        </div>
      </div>

      <section class="card soft" style="margin-top:12px">
        <h3 class="muted">Umsatz × Payout je Monat</h3>
        <div class="table">
          <div class="tr th">
            <div>Monat</div><div>Umsatz (EUR)</div><div>Payout-Quote</div>
          </div>
          <div id="rows"></div>
        </div>
      </section>

      <section class="card soft" style="margin-top:12px">
        <h3 class="muted">Extras (Einzahlungen/Auszahlungen)</h3>
        <div id="extras"></div>
        <button id="btn-add-extra" class="btn" style="margin-top:8px">+ Zeile</button>
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
  inpOpening.addEventListener("blur", () => inpOpening.dispatchEvent(new Event("change")));

  // Zeitraum
  $("#inp-start").addEventListener("change", (e)=>{
    s.settings.startMonth = e.target.value || s.settings.startMonth;
    reseedIncomings();
    drawRows(); saveState(s);
  });
  $("#inp-hor").addEventListener("change", (e)=>{
    const n = Math.max(1, Math.min(36, Number(e.target.value)||18));
    s.settings.horizonMonths = n;
    reseedIncomings();
    drawRows(); saveState(s);
  });

  // Rows
  function drawRows(){
    const box = $("#rows");
    box.innerHTML = s.incomings.map((r,i)=>`
      <div class="tr">
        <div><input class="in" type="month" data-i="${i}" data-f="m" value="${esc(r.month)}"/></div>
        <div><input class="in" type="text"  data-i="${i}" data-f="rev" value="${esc(r.revenueEur)}" placeholder="1.234,56"/></div>
        <div><input class="in" type="text"  data-i="${i}" data-f="pct" value="${esc(r.payoutPct)}" placeholder="0,85 oder 85"/></div>
      </div>
    `).join("");

    box.querySelectorAll("input").forEach(inp=>{
      const i = Number(inp.getAttribute("data-i"));
      const f = inp.getAttribute("data-f");

      if (f === "m") {
        inp.addEventListener("change", ()=>{
          s.incomings[i].month = inp.value;
          saveState(s);
        });
      } else if (f === "rev") {
        inp.addEventListener("change", ()=>{
          const pretty = fmtDE(parseDE(inp.value));
          s.incomings[i].revenueEur = pretty;
          inp.value = pretty;
          saveState(s);
        });
        inp.addEventListener("blur", ()=> inp.dispatchEvent(new Event("change")));
      } else if (f === "pct") {
        inp.addEventListener("change", ()=>{
          // erlaubt 0,85 oder 85
          const raw = parseDE(inp.value);
          const pct = raw > 1 ? raw/100 : raw;
          s.incomings[i].payoutPct = Number.isFinite(pct) ? Number(pct) : 0.85;
          inp.value = String(s.incomings[i].payoutPct);
          saveState(s);
        });
        inp.addEventListener("blur", ()=> inp.dispatchEvent(new Event("change")));
      }
    });
  }

  // Extras
  function drawExtras(){
    const box = $("#extras");
    const rows = Array.isArray(s.extras) ? s.extras : [];
    box.innerHTML = rows.map((r,i)=>`
      <div class="row" style="gap:8px;align-items:center;margin-bottom:6px">
        <input class="in" type="month" value="${esc(r.month||"")}" data-i="${i}" data-f="m"/>
        <input class="in" type="text"  value="${esc(r.label||"")}" data-i="${i}" data-f="l" placeholder="Label"/>
        <input class="in" type="text"  value="${esc(r.amountEur||"0,00")}" data-i="${i}" data-f="a" placeholder="1.234,56" style="max-width:160px"/>
        <button class="btn danger" data-i="${i}" data-f="x">✕</button>
      </div>
    `).join("");

    box.querySelectorAll(".row").forEach(row=>{
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
  $("#btn-add-extra").addEventListener("click", ()=>{
    s.extras = Array.isArray(s.extras) ? s.extras : [];
    s.extras.push({ month: months[0] || "2025-02", label: "", amountEur: "0,00" });
    saveState(s); drawExtras();
  });

  function reseedIncomings(){
    const months = (()=> {
      const [y,m] = (s?.settings?.startMonth||"2025-02").split("-").map(Number);
      const n = Number(s?.settings?.horizonMonths||18);
      const out=[]; for(let i=0;i<n;i++){ const d=new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
      return out;
    })();
    const prev = new Map((s.incomings||[]).map(r=>[r.month,r]));
    s.incomings = months.map(m=>{
      const ref = prev.get(m) || prev.values().next().value || { revenueEur:"0,00", payoutPct:0.85 };
      return { month:m, revenueEur: ref.revenueEur, payoutPct: ref.payoutPct };
    });
  }

  // initial draw
  drawRows();
  drawExtras();
}

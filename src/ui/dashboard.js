// FBA-CF-0009 — Dashboard: Netto je Monat aus incomings + extras – outgoings
import { loadState, addStateListener } from "../data/storageLocal.js";
const $ = (sel, r=document)=> r.querySelector(sel);

function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function monthSeq(startYm="2025-02", n=18){
  const [y,m] = startYm.split("-").map(Number);
  const out=[]; for(let i=0;i<n;i++){ const d=new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

export async function render(root){
  const s = loadState();
  const months = monthSeq(s?.settings?.startMonth || "2025-02", Number(s?.settings?.horizonMonths||18));

  const byMonth = new Map(months.map(m=>[m,{inflow:0, extras:0, out:0}]));
  (s.incomings||[]).forEach(r=>{
    const m = r.month;
    if (!byMonth.has(m)) return;
    const rev = parseDE(r.revenueEur);
    const pct = Number(r.payoutPct||0);
    byMonth.get(m).inflow += rev * (pct > 1 ? pct/100 : pct);
  });
  (s.extras||[]).forEach(r=>{
    const m = r.month; if (!byMonth.has(m)) return;
    byMonth.get(m).extras += parseDE(r.amountEur);
  });
  (s.outgoings||[]).forEach(r=>{
    const m = r.month; if (!byMonth.has(m)) return;
    byMonth.get(m).out += parseDE(r.amountEur);
  });

  const net = months.map(m=>{
    const row = byMonth.get(m);
    return (row.inflow + row.extras) - row.out;
  });

  const maxVal = Math.max(1, ...net);
  const step = 5000;
  const top = Math.max(step, Math.ceil(maxVal/step)*step);
  const ticks = []; for (let v=0; v<=top; v+=step) ticks.push(v);

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="vchart" style="--cols:${months.length}">
        <div class="vchart-grid">${ticks.map(()=>`<div class="yline"></div>`).join("")}</div>
        <div class="vchart-y">${ticks.slice().reverse().map(v=>`<div class="ytick">${Math.round(v/1000)}k</div>`).join("")}</div>
        <div class="vchart-bars">
          ${net.map(v=>{
            const h = Math.max(0, Math.min(100, (v/top)*100));
            return `<div class="vbar-wrap"><div class="vbar" style="--h:${h}%"></div></div>`;
          }).join("")}
        </div>
        <div class="vchart-x" style="margin-top:12px">
          ${months.map(m=>`<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>
    </section>
  `;

  // Live-Refresh für spätere Änderungen ohne erneutes Navigieren
  const off = addStateListener(()=>{
    const r = document.getElementById("app");
    if (!r) { off(); return; }
    if (location.hash.replace("#","") === "dashboard") render(r);
  });
}

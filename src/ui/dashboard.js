// FBA-CF-0008 — Dashboard: 5k-Y-Ticks, schräge X-Labels, Balken nur oben rund

import { loadState } from "../data/storageLocal.js";

const $ = (sel, r=document) => r.querySelector(sel);

// Hilfen
function parseDE(s){ return Number(String(s??0).replace(/\./g,"").replace(",", ".")) || 0; }
function monthSeq(startYm, n){
  const [y0,m0] = (startYm||"2025-02").split("-").map(Number);
  const out=[];
  for(let i=0;i<n;i++){
    const d=new Date(y0, (m0-1)+i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  }
  return out;
}

export async function render(root){
  const s = loadState();

  // simple Netto: (Monatsumsatz × Payout) + ExtrasΣ − AusgabenΣ
  const revenue = parseDE(s.monthlyAmazonEur ?? 0);
  const payout  = Number(s.payoutPct ?? 0.85) || 0;
  const inflow  = revenue * payout;
  const extraΣ  = (s.extras||[]).reduce((a,r)=> a + parseDE(r.amountEur), 0);
  const outΣ    = (s.outgoings||[]).reduce((a,r)=> a + parseDE(r.amountEur), 0);
  const netBase = inflow + extraΣ - outΣ;

  const months = monthSeq(s?.settings?.startMonth ?? "2025-02", Number(s?.settings?.horizonMonths ?? 18));
  const net = months.map(() => netBase); // bis FO/PO kommt, gleichmäßig

  // Y-Skala in 5k-Schritten
  const maxVal = Math.max(0, ...net);
  const step = 5000;
  const top = Math.ceil(maxVal/step)*step || step;
  const ticks = [0, step, step*2, step*3, step*4, step*5].filter(v=>v<=top);
  const tickPct = v => (v/top)*100;

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>

      <div class="vchart" style="--cols:${months.length}">
        <div class="vchart-grid">
          ${ticks.map(()=>`<div class="yline"></div>`).join("")}
        </div>
        <div class="vchart-y">
          ${ticks.slice().reverse().map(v=>`<div class="ytick">${Math.round(v/1000)}k</div>`).join("")}
        </div>

        <div class="vchart-bars">
          ${net.map(v=>{
            const h = Math.max(0, Math.min(100, (v/top)*100));
            const neg = v<0 ? "neg" : "";
            return `<div class="vbar-wrap"><div class="vbar ${neg}" style="--h:${h}%"></div></div>`;
          }).join("")}
        </div>

        <div class="vchart-x" style="margin-top:12px">
          ${months.map(m=>`<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>
    </section>
  `;

  // leichte Schräge für Labels (nur einmalig)
  const style = document.createElement("style");
  style.textContent = `
    .vchart-x .xlabel { transform: rotate(-30deg); transform-origin: right top; height: 24px; }
  `;
  root.appendChild(style);
}

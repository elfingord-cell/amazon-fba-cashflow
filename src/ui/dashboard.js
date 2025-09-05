// src/ui/dashboard.js
import { loadState } from "../data/storageLocal.js";
import { computeSeries } from "../domain/cashflow.js";

const $ = (s,r=document)=>r.querySelector(s);
const fmtEUR = n => n.toLocaleString("de-DE",{ style:"currency", currency:"EUR", maximumFractionDigits:2 });

export async function render(root){
  const s = loadState();
  const { months, series } = computeSeries(s);

  // Y-Skala: positiv, in „runde“ 5-k Schritte
  const maxNet = Math.max(1, ...series.map(r=> r.net));
  const step = Math.max(5000, Math.ceil(maxNet/5/1000)*1000);
  const top  = Math.ceil(maxNet/step)*step || step;
  const ticks = [0, step, step*2, step*3, step*4, top].filter((v,i,a)=>a.indexOf(v)===i);

  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>
      <div class="grid three">
        <div class="kpi"><div class="kpi-label">Opening heute</div><div class="kpi-value">${fmtEUR(Number(s.openingEur||0))}</div></div>
        <div class="kpi"><div class="kpi-label">Sales × Payout (Monat)</div><div class="kpi-value">${fmtEUR(Number(s.monthlyAmazonEur||0) * (Number(s.payoutPct||0) > 1 ? Number(s.payoutPct)/100 : Number(s.payoutPct||0)))}</div></div>
        <div class="kpi"><div class="kpi-label">Erster negativer Monat</div><div class="kpi-value">—</div></div>
      </div>

      <div class="vchart" style="--cols:${months.length}">
        <div class="vchart-grid">${ticks.map(()=>`<div class="yline"></div>`).join("")}</div>
        <div class="vchart-y">${ticks.slice().reverse().map(v=>`<div class="ytick">${v>=1000?Math.round(v/1000)+'k':v}</div>`).join("")}</div>
        <div class="vchart-bars">
          ${series.map(r=>{
            const v = Math.max(0, r.net);                     // negative Netze derzeit auf 0 kappen (später 2-seitig)
            const h = Math.min(100, (v/top)*100);
            const cls = r.net >= 0 ? "pos" : "neg";
            return `<div class="vbar-wrap"><div class="vbar ${cls}" style="--h:${h}%"></div></div>`;
          }).join("")}
        </div>
        <div class="vchart-x">
          ${months.map(m=>`<div class="xlabel">${m}</div>`).join("")}
        </div>
      </div>
    </section>
  `;
}

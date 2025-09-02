// FBA-CF-0006a — Dashboard Hotfix
// - Helper (monthsFrom/toNum/toMonth/fmtEUR) stehen VOR jeder Nutzung
// - Vertikale Monatsbalken, helle KPI-Karten

// ---------- Helper ----------
function monthsFrom(startYYYYMM, n){
  const [y0,m0] = String(startYYYYMM||"").split("-").map(Number);
  if(!y0||!m0) return [];
  const out=[];
  for(let i=0;i<Math.max(0,Number(n||0));i++){
    const d=new Date(y0,(m0-1)+i,1);
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  }
  return out;
}
function toNum(x){ if(typeof x==="number") return x; return Number(String(x||"").replace(/\./g,"").replace(",", "."))||0; }
function toMonth(r){
  if (r?.month && /^\d{4}-\d{2}$/.test(r.month)) return r.month;
  if (r?.date) { const d=new Date(r.date); if(!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
  return null;
}
function fmtEUR(n){
  if (n==null || isNaN(n)) return "–";
  const v = Math.round(Number(n)*100)/100;
  const s = v.toLocaleString("de-DE", { minimumFractionDigits:2, maximumFractionDigits:2 });
  return `${s} €`;
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- State API (nur die Funktionen, die wir brauchen) ----------
import { loadState, addStateListener } from "../data/storageLocal.js";

// ---------- View ----------
export async function render(root) {
  root.innerHTML = `
    <section class="card">
      <h2>Dashboard</h2>

      <div id="kpis" class="grid three" style="gap:12px"></div>

      <div class="row" style="align-items:center;margin-top:10px;margin-bottom:8px">
        <h3 style="margin:0">Monatsübersicht</h3>
        <div id="range" class="muted" style="margin-left:8px"></div>
        <div style="flex:1"></div>
        <small class="muted">grün = Netto+</small>
        <small class="muted" style="margin-left:8px">rot = Netto−</small>
      </div>

      <div id="vchart" class="vchart">
        <div class="vchart-y" id="vchart-y"></div>
        <div class="vchart-grid" id="vchart-grid"></div>
        <div class="vchart-bars" id="vchart-bars"></div>
        <div class="vchart-x" id="vchart-x"></div>
      </div>
    </section>
  `;

  const elKPIs   = root.querySelector("#kpis");
  const elRange  = root.querySelector("#range");
  const elY      = root.querySelector("#vchart-y");
  const elGrid   = root.querySelector("#vchart-grid");
  const elBars   = root.querySelector("#vchart-bars");
  const elX      = root.querySelector("#vchart-x");

  const off = addStateListener(() => { if (location.hash === "#dashboard" || location.hash === "") redraw(); });
  await redraw();
  root._cleanup = () => { try { off && off(); } catch {} };

  function aggregate(s) {
    const startMonth   = s?.settings?.startMonth || "2025-02";
    const horizon      = Number(s?.settings?.horizonMonths || 18);
    const opening      = Number(s?.openingEur || 0);
    const monthlySales = Number(s?.monthlyAmazonEur || 0);
    const payoutPct    = Number(s?.payoutPct ?? 0.85);
    const extras       = Array.isArray(s?.extras) ? s.extras : [];
    const outs         = Array.isArray(s?.outgoings) ? s.outgoings : [];

    const months = monthsFrom(startMonth, horizon);
    const idx = new Map(months.map((m,i)=>[m,i]));
    const rows = months.map(m => ({ month:m, inflow: monthlySales*payoutPct, extras:0, out:0, net:0 }));

    for (const e of extras) {
      const m = toMonth(e); if(!m||!idx.has(m)) continue;
      rows[idx.get(m)].extras += toNum(e.amountEur);
    }
    for (const o of outs) {
      const m = toMonth(o); if(!m||!idx.has(m)) continue;
      rows[idx.get(m)].out += Math.abs(toNum(o.amountEur));
    }
    for (const r of rows) r.net = (r.inflow + r.extras) - r.out;

    return { months, rows, opening };
  }

  function kpi(label, value){
    return `<div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
    </div>`;
  }

  function redraw(){
    const s = loadState();
    const { months, rows, opening } = aggregate(s);

    // KPIs
    const sumExtras = rows.reduce((a,m)=>a+m.extras,0);
    const sumOuts   = rows.reduce((a,m)=>a+m.out,0);
    const avgNet    = rows.reduce((a,m)=>a+m.net,0) / (months.length||1);
    const firstNeg  = (()=>{ let bal=opening; for(const r of rows){ bal+=r.net; if (bal<0) return r.month; } return null; })();

    elKPIs.innerHTML = `
      ${kpi("Opening", fmtEUR(opening))}
      ${kpi("Extras (Σ)", fmtEUR(sumExtras))}
      ${kpi("Ausgaben (Σ)", fmtEUR(sumOuts))}
      ${kpi("Ø Netto/Monat", fmtEUR(avgNet))}
      ${kpi("Erster negativer Monat", firstNeg || "—")}
      ${kpi("Sales × Payout", fmtEUR((toNum(s?.monthlyAmazonEur)||0)*(toNum(s?.payoutPct??0.85))))}
    `;
    elRange.textContent = `${months[0]||"—"} … ${months[months.length-1]||"—"}`;

    // Vertikale Balken
    const maxAbs = Math.max(1, ...rows.map(r=>Math.abs(r.net)));
    const ticks = [0.25,0.5,0.75,1].map(p=>Math.round(p*maxAbs));

    elY.innerHTML = `
      <div class="ytick">${fmtEUR(ticks[3])}</div>
      <div class="ytick">${fmtEUR(ticks[2])}</div>
      <div class="ytick">${fmtEUR(ticks[1])}</div>
      <div class="ytick">${fmtEUR(ticks[0])}</div>
      <div class="ytick">0</div>
    `;
    elGrid.innerHTML = `<div class="yline"></div><div class="yline"></div><div class="yline"></div><div class="yline"></div><div class="yline"></div>`;

    elBars.style.setProperty("--cols", String(months.length));
    elBars.innerHTML = rows.map(r=>{
      const h = Math.min(100, Math.round((Math.abs(r.net)/maxAbs)*100));
      const cls = (r.net>=0) ? "vbar pos" : "vbar neg";
      const tip = [
        `${r.month}`,
        `Netto: ${fmtEUR(r.net)}`,
        `Inflow (Sales×Payout): ${fmtEUR(r.inflow)}`,
        `Extras: ${fmtEUR(r.extras)}`,
        `Ausgaben: ${fmtEUR(r.out)}`
      ].join("\n");
      return `<div class="vbar-wrap" title="${escapeHtml(tip)}">
        <div class="${cls}" style="--h:${h}%"></div>
      </div>`;
    }).join("");

    elX.style.setProperty("--cols", String(months.length));
    elX.innerHTML = months.map(m=>`<div class="xlabel">${escapeHtml(m)}</div>`).join("");
  }
}

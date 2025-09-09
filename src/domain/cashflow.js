// src/domain/cashflow.js
// Cashflow-Aggregation (Monats-Netto) inkl. PO-Events

import { expandAllPOEvents, fmtEUR } from "./po.js";

// --- helpers ---
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function clamp01(x){ const n=Number(x||0); return n>1 ? n/100 : n; }

function monthSeq(startYm="2025-02", n=18){
  const [y,m] = (startYm||"2025-02").split("-").map(Number);
  const out=[]; for(let i=0;i<n;i++){ const d=new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

// --- main API ---
export function computeSeries(state){
  const settings = state?.settings || {};
  const months   = monthSeq(settings.startMonth || "2025-02", Number(settings.horizonMonths||18));

  // Basismap: inflow / out
  const map = new Map(months.map(m => [m, { inflow:0, out:0 }]));

  // a) Incomings (Sales×Payout pro Monat)
  const incomings = Array.isArray(state?.incomings) ? state.incomings : [];
  incomings.forEach(r => {
    const m = r?.month; if (!map.has(m)) return;
    const rev = parseDE(r?.revenueEur);
    const pct = clamp01(r?.payoutPct ?? state?.payoutPct ?? 0.85);
    map.get(m).inflow += rev * pct;
  });

  // b) Extras (positive oder negative Einmalbeträge)
  const extras = Array.isArray(state?.extras) ? state.extras : [];
  extras.forEach(r => {
    const m = r?.month; if (!map.has(m)) return;
    map.get(m).inflow += parseDE(r?.amountEur);
  });

  // c) Outgoings (Fixkosten etc.)
  const outs = Array.isArray(state?.outgoings) ? state.outgoings : [];
  outs.forEach(r => {
    const m = r?.month; if (!map.has(m)) return;
    map.get(m).out += Math.abs(parseDE(r?.amountEur));
  });

  // d) PO-Events (in Datum → Monat bucketen)
  const poEvents = expandAllPOEvents(state);
  poEvents.forEach(ev => {
    const m = ev.date.slice(0,7);
    if (!map.has(m)) return;
    if (ev.amount >= 0) map.get(m).inflow += ev.amount;
    else map.get(m).out   += Math.abs(ev.amount);
  });

  // Netto & KPIs
  const series = months.map(m => {
    const { inflow, out } = map.get(m);
    const net = inflow - out;
    return { month:m, inflow, out, net };
  });

  // KPI: Ø Sales×Payout nur über aktive Monate
  const inflowOnly   = series.map(r=>r.inflow).filter(v=>v>0);
  const salesPayoutAvg = inflowOnly.length ? Math.round(inflowOnly.reduce((a,b)=>a+b,0)/inflowOnly.length) : 0;

  // Opening heute (direkt aus state)
  const opening = parseDE(state?.openingEur);

  // Erster negativer Monat (nach Netto)
  const firstNegative = series.find(r => r.net < 0)?.month;

  return {
    months,
    series,            // [{month, inflow, out, net}]
    kpis: {
      opening,
      salesPayoutAvg,
      firstNegativeMonth: firstNegative || null
    },
    fmtEUR
  };
}

export { fmtEUR };

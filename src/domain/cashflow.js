// src/domain/cashflow.js
// Gesamt-Netto je Monat: (Sales×Payout + Extras) – Ausgaben – PO/FO Events

import { expandOrders, byMonthSum } from "./orders.js";

function parseDE(x){ return Number(String(x ?? 0).replace(/\./g,"").replace(",", ".")) || 0; }
function monthSeq(startYm="2025-02", n=18){
  const [y,m] = startYm.split("-").map(Number);
  const out=[]; for(let i=0;i<n;i++){ const d=new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

export function computeSeries(state){
  const start = state?.settings?.startMonth || "2025-02";
  const months = monthSeq(start, Number(state?.settings?.horizonMonths||18));
  const map = new Map(months.map(m=>[m,{ inflow:0, out:0 }]));

  // Sales × Payout
  const rev = parseDE(state.monthlyAmazonEur);
  const pct = Number(state.payoutPct||0);
  months.forEach(m=>{
    map.get(m).inflow += rev * (pct>1 ? pct/100 : pct);
  });

  // Extras
  (state.extras||[]).forEach(r=>{
    if (map.has(r.month)) map.get(r.month).inflow += parseDE(r.amountEur);
  });

  // Outgoings (fixe)
  (state.outgoings||[]).forEach(r=>{
    if (map.has(r.month)) map.get(r.month).out += parseDE(r.amountEur);
  });

  // PO/FO Events
  const pofoEvents = expandOrders(state.orders||{});
  const pofoByM = byMonthSum(pofoEvents);
  months.forEach(m=>{
    const add = pofoByM.get(m)||0;
    if (add>=0) map.get(m).inflow += add; else map.get(m).out += Math.abs(add);
  });

  const series = months.map(m=>{
    const row = map.get(m);
    return { month:m, inflow: row.inflow, out: row.out, net: row.inflow - row.out };
  });
  return { months, series };
}

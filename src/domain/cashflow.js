// src/domain/cashflow.js
// Cashflow-Aggregation (Monats-Netto) inkl. PO-Events – robuste ES-Fassung

import { expandAllPOEvents, fmtEUR } from "./po.js";

function parseDE(x){
  var s = (x === undefined || x === null) ? "0" : String(x);
  return Number(s.replace(/\./g,"").replace(",", ".")) || 0;
}
function clamp01(x){ var n=Number(x||0); return n>1 ? n/100 : n; }

function monthSeq(startYm, n){
  startYm = startYm || "2025-02";
  n = Number(n || 18);
  var parts = startYm.split("-");
  var y = Number(parts[0]||2025), m = Number(parts[1]||2);
  var out = [];
  for (var i=0;i<n;i++){
    var d = new Date(y, (m-1)+i, 1);
    out.push(d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"));
  }
  return out;
}

export function computeSeries(state){
  state = state || {};
  var settings = state.settings || {};
  var months   = monthSeq(settings.startMonth, settings.horizonMonths);

  var map = new Map();
  for (var i=0;i<months.length;i++) map.set(months[i], { inflow:0, out:0 });

  // a) incomings
  var incomings = Array.isArray(state.incomings) ? state.incomings : [];
  incomings.forEach(function(r){
    var m = r && r.month; if (!map.has(m)) return;
    var rev = parseDE(r && r.revenueEur);
    var pct = clamp01((r && r.payoutPct)!=null ? r.payoutPct : state.payoutPct || 0.85);
    map.get(m).inflow += rev * pct;
  });

  // b) extras
  var extras = Array.isArray(state.extras) ? state.extras : [];
  extras.forEach(function(r){
    var m = r && r.month; if (!map.has(m)) return;
    map.get(m).inflow += parseDE(r && r.amountEur);
  });

  // c) outgoings
  var outs = Array.isArray(state.outgoings) ? state.outgoings : [];
  outs.forEach(function(r){
    var m = r && r.month; if (!map.has(m)) return;
    map.get(m).out += Math.abs(parseDE(r && r.amountEur));
  });

  // d) PO-Events
  var poEvents = expandAllPOEvents(state);
  poEvents.forEach(function(ev){
    var m = (ev.date || "").slice(0,7);
    if (!map.has(m)) return;
    if (ev.amount >= 0) map.get(m).inflow += ev.amount;
    else map.get(m).out += Math.abs(ev.amount);
  });

  var series = months.map(function(m){
    var v = map.get(m);
    var net = v.inflow - v.out;
    return { month:m, inflow:v.inflow, out:v.out, net:net };
  });

  var inflowOnly = series.map(function(r){return r.inflow;}).filter(function(v){return v>0;});
  var salesPayoutAvg = inflowOnly.length ? Math.round(inflowOnly.reduce(function(a,b){return a+b;},0)/inflowOnly.length) : 0;

  var opening = parseDE(state.openingEur);
  var firstNeg = null;
  for (var j=0;j<series.length;j++){ if (series[j].net < 0){ firstNeg = series[j].month; break; } }

  return {
    months: months,
    series: series,
    kpis: {
      opening: opening,
      salesPayoutAvg: salesPayoutAvg,
      firstNegativeMonth: firstNeg
    },
    fmtEUR: fmtEUR
  };
}

export { fmtEUR };

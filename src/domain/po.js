// src/domain/po.js
// FBA-CF-0023 — Purchase Orders: Domain + Event expansion (robuste ES-Fassung)

// --- Helpers ---
function clamp01(x){
  var n = Number(x || 0);
  return n > 1 ? n / 100 : n;
}
function parseDE(x){
  var s = (x === undefined || x === null) ? "0" : String(x);
  return Number(s.replace(/\./g,"").replace(",", ".")) || 0;
}
export function fmtEUR(n){
  try{
    return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n || 0);
  }catch(e){
    // Fallback
    return (Math.round((n||0)*100)/100).toFixed(2) + " €";
  }
}
function addDays(dateStr, days){
  var d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0,10);
}
function addMonths(dateStr, months){
  var d = new Date(dateStr);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d.toISOString().slice(0,10);
}
function rid(){ return "po-" + Math.random().toString(36).slice(2,10); }

// Transport-Defaults
var TRANSPORT_DAYS = { sea: 60, rail: 30, air: 10 };

// --- Expand one PO into cash events (EUR, signed) ---
export function expandPO(po, settings){
  settings = settings || {};
  po = po || {};

  var num   = (po.number || "").trim() || "(ohne Nr.)";
  var date0 = po.orderDate || new Date().toISOString().slice(0,10);
  var goods = parseDE(po.goodsEur);
  var dep   = clamp01(po.depositPct != null ? po.depositPct : 0.30);
  var bal   = clamp01(po.balancePct  != null ? po.balancePct  : 0.70);

  var prodDays   = Number(po.productionDays != null ? po.productionDays : 30);
  var mode       = po.transportMode || "sea";
  var transpDays = Number(po.transportDays != null ? po.transportDays : (TRANSPORT_DAYS[mode] || 60));

  var freight    = parseDE(po.freightEur);
  var dutyPct    = clamp01(po.dutyPct != null ? po.dutyPct : 0.06);
  var vatPct     = clamp01(po.vatPct  != null ? po.vatPct  : 0.19);

  var vatRefund  = !!(po.vatRefund !== false); // default true
  var vatLagM    = Number(po.vatLagMonths != null ? po.vatLagMonths : 2);

  // timeline
  var tOrder   = date0;
  var tProdEnd = addDays(date0, prodDays);
  var tShip    = tProdEnd;
  var tArrive  = addDays(tShip, transpDays);
  var tVatBack = addMonths(tArrive, vatLagM);

  var ev = [];

  // 1) Deposit am Bestelltag
  ev.push({
    date: tOrder,
    type: "PO_MS",
    label: num + " · Deposit " + Math.round(dep*100) + "%",
    amount: -(goods * dep)
  });

  // 2) Balance bei Produktionsende
  ev.push({
    date: tProdEnd,
    type: "PO_MS",
    label: num + " · Balance " + Math.round(bal*100) + "%",
    amount: -(goods * bal)
  });

  // 3) Freight bei Ankunft
  if (freight){
    ev.push({ date:tArrive, type:"FREIGHT", label: num + " · Freight", amount: -Math.abs(freight) });
  }

  // 4) Zoll (Duty) bei Ankunft
  var duty = goods * dutyPct;
  if (duty){
    ev.push({ date:tArrive, type:"DUTY", label: num + " · Zoll", amount: -Math.abs(duty) });
  }

  // 5) EUSt und (optional) Erstattung
  var eust = goods * vatPct;
  if (eust){
    ev.push({ date:tArrive, type:"EUST", label: num + " · EUSt", amount: -Math.abs(eust) });
    if (vatRefund){
      ev.push({ date:tVatBack, type:"VAT_REFUND", label: num + " · USt-Erstattung", amount: Math.abs(eust) });
    }
  }

  ev.sort(function(a,b){ return a.date.localeCompare(b.date); });
  return ev;
}

// --- Expand all POs from state ---
export function expandAllPOEvents(state){
  state = state || {};
  var list = Array.isArray(state.pos) ? state.pos : [];
  var out = [];
  for (var i=0;i<list.length;i++){
    var one = expandPO(list[i], state.settings || {});
    Array.prototype.push.apply(out, one);
  }
  return out;
}

// --- PO factory (default template) ---
export function newPO(){
  var today = new Date().toISOString().slice(0,10);
  return {
    id: rid(),
    number: "",
    orderDate: today,
    goodsEur: "0,00",
    depositPct: 0.30,
    balancePct: 0.70,
    productionDays: 30,
    transportMode: "sea",
    transportDays: TRANSPORT_DAYS.sea,
    freightEur: "0,00",
    dutyPct: 0.06,
    vatPct: 0.19,
    vatRefund: true,
    vatLagMonths: 2
  };
}

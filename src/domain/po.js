// src/domain/po.js
// FBA-CF-0026 — Robust: Prozent-/Zahl-Parsing für „6,5%“, „85 %“, „0,85“, inkl. NBSP/Thin-Space
// Exportiert: expandPO, expandAllPOEvents, newPO, fmtEUR

function toNumberDE(x){
  // Erlaubt: 8.000,00  |  6,5%  |  6.5 %  |  "  6,5 %" (NBSP/Thin-space)
  var s = (x == null) ? "0" : String(x);
  // Normalisiere Sonder-Leerzeichen
  s = s.replace(/\u00A0|\u202F/g, ""); // NBSP + NARROW NBSP entfernen
  // alles außer Ziffern, Komma, Punkt, Minus entfernen (Prozentzeichen etc. fliegen raus)
  s = s.replace(/[^0-9.,-]/g, "");
  // deutsche Schreibweise nach JS-Number
  s = s.replace(/\./g, "").replace(",", ".");
  var v = Number(s);
  return isFinite(v) ? v : 0;
}
function toPercent(x){
  // Zulässig: 6,5% → 0.065; 6,5 → 0.065; 85 → 0.85; 0,85 → 0.85
  var v = toNumberDE(x);
  return (v <= 1) ? v : (v/100);
}
export function fmtEUR(n){
  try{
    return new Intl.NumberFormat("de-DE",{ style:"currency", currency:"EUR" }).format(n || 0);
  }catch(_){
    var v = Math.round((n||0)*100)/100;
    return v.toFixed(2).replace(".", ",") + " €";
  }
}
function addDays(dateStr, days){
  var d = new Date(dateStr || new Date().toISOString().slice(0,10));
  d.setDate(d.getDate() + Number(days||0));
  return d.toISOString().slice(0,10);
}
function addMonths(dateStr, months){
  var d = new Date(dateStr || new Date().toISOString().slice(0,10));
  d.setMonth(d.getMonth() + Number(months||0));
  return d.toISOString().slice(0,10);
}
function rid(){ return "po-" + Math.random().toString(36).slice(2,10); }

var TRANSPORT_DAYS = { sea:60, rail:30, air:10 };

// Nur fürs Label (anzeige „6,5 %“) – robust gegen „%“
function pctLabelRaw(x){
  var v = toNumberDE(x);
  if (v <= 1) v = v * 100;
  try { return v.toLocaleString("de-DE",{ maximumFractionDigits: 1 }) + " %"; }
  catch(_){ return (Math.round(v*10)/10) + " %"; }
}

// Hauptfunktion: Eine PO in Cash-Events umwandeln
export function expandPO(po, settings){
  settings = settings || {};
  po = po || {};

  var num   = (po.number || "").trim() || "(ohne Nr.)";
  var date0 = po.orderDate || new Date().toISOString().slice(0,10);
  var goods = toNumberDE(po.goodsEur);

  // Prozentfelder IMMER über toPercent (robust)
  var depPctVal = (po.depositPct != null ? po.depositPct : 30);
  var balPctVal = (po.balancePct  != null ? po.balancePct  : 70);
  var dep = toPercent(depPctVal);
  var bal = toPercent(balPctVal);

  var prodDays   = Number(po.productionDays != null ? po.productionDays : 30);
  var mode       = po.transportMode || "sea";
  var transpDays = Number(po.transportDays != null ? po.transportDays : (TRANSPORT_DAYS[mode] || 60));

  var freight    = toNumberDE(po.freightEur);
  var dutyPctVal = (po.dutyPct != null ? po.dutyPct : 6);   // „6,5%“ ok
  var vatPctVal  = (po.vatPct  != null ? po.vatPct  : 19);  // „19%“ ok
  var dutyPct    = toPercent(dutyPctVal);
  var vatPct     = toPercent(vatPctVal);

  var vatRefund  = (po.vatRefund !== false);
  var vatLagM    = Number(po.vatLagMonths != null ? po.vatLagMonths : 2);

  var tOrder   = date0;
  var tProdEnd = addDays(date0, prodDays);
  var tShip    = tProdEnd;
  var tArrive  = addDays(tShip, transpDays);
  var tVatBack = addMonths(tArrive, vatLagM);

  var ev = [];

  // Meilensteine
  ev.push({ date:tOrder,   type:"PO_MS", label: num + " · Deposit " + pctLabelRaw(depPctVal),   amount: -(goods * dep) });
  ev.push({ date:tProdEnd, type:"PO_MS", label: num + " · Balance " + pctLabelRaw(balPctVal),  amount: -(goods * bal) });

  if (freight){
    ev.push({ date:tArrive, type:"FREIGHT", label: num + " · Freight", amount: -Math.abs(freight) });
  }

  // Zoll – robust: selbst wenn 6,5% mit Komma/Prozent eingegeben wird
  var duty = goods * dutyPct;   // z.B. 8.000 * 0.065 = 520
  if (Math.abs(duty) > 0){
    ev.push({ date:tArrive, type:"DUTY", label: num + " · Zoll " + pctLabelRaw(dutyPctVal), amount: -Math.abs(duty) });
  }

  var eust = goods * vatPct;
  if (Math.abs(eust) > 0){
    ev.push({ date:tArrive, type:"EUST", label: num + " · EUSt " + pctLabelRaw(vatPctVal), amount: -Math.abs(eust) });
    if (vatRefund){
      ev.push({ date:tVatBack, type:"VAT_REFUND", label: num + " · USt-Erstattung", amount: Math.abs(eust) });
    }
  }

  ev.sort(function(a,b){ return a.date.localeCompare(b.date); });
  return ev;
}

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

export function newPO(){
  var today = new Date().toISOString().slice(0,10);
  return {
    id: rid(),
    number: "",
    orderDate: today,
    goodsEur: "0,00",
    depositPct: 30,     // Prozent (0–100)
    balancePct: 70,     // Prozent
    productionDays: 30,
    transportMode: "sea",
    transportDays: TRANSPORT_DAYS.sea,
    freightEur: "0,00",
    dutyPct: 6,         // Prozent
    vatPct: 19,         // Prozent
    vatRefund: true,
    vatLagMonths: 2
  };
}

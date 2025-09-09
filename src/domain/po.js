// src/domain/po.js
// FBA-CF-0025 — Prozent-Parser akzeptiert „6,5“, „6,5%“, „70“, „0,85“ (Legacy)

function toNumberDE(x){
  var s = (x == null) ? "0" : String(x);
  // alles außer Ziffern, Punkt, Komma, Minus entfernen (z.B. "%", Leerzeichen, Buchstaben)
  s = s.replace(/[^0-9.,-]/g, "");
  // deutsche Schreibweise: Tausenderpunkte raus, Komma => Dezimalpunkt
  s = s.replace(/\./g, "").replace(",", ".");
  var v = Number(s);
  return isFinite(v) ? v : 0;
}
function toPercent(x){
  var v = toNumberDE(x);        // z.B. "6,5%" -> 6.5
  return v <= 1 ? v : v/100;    // Legacy (0,85) bleibt gültig; 6.5 => 0.065
}
export function fmtEUR(n){
  try{
    return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n || 0);
  }catch(e){
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

var TRANSPORT_DAYS = { sea: 60, rail: 30, air: 10 };

function pctLabelRaw(x){
  var v = toNumberDE(x);
  if (v <= 1) v = v * 100;
  try { return v.toLocaleString("de-DE",{ maximumFractionDigits: 1 }) + " %"; }
  catch(e){ return (Math.round(v*10)/10) + " %"; }
}

// --- Expand one PO into cash events (EUR) ---
export function expandPO(po, settings){
  settings = settings || {};
  po = po || {};

  var num   = (po.number || "").trim() || "(ohne Nr.)";
  var date0 = po.orderDate || new Date().toISOString().slice(0,10);
  var goods = toNumberDE(po.goodsEur);

  var depPctVal = (po.depositPct != null ? po.depositPct : 30);
  var balPctVal = (po.balancePct  != null ? po.balancePct  : 70);
  var dep = toPercent(depPctVal);
  var bal = toPercent(balPctVal);

  var prodDays   = Number(po.productionDays != null ? po.productionDays : 30);
  var mode       = po.transportMode || "sea";
  var transpDays = Number(po.transportDays != null ? po.transportDays : (TRANSPORT_DAYS[mode] || 60));

  var freight    = toNumberDE(po.freightEur);
  var dutyPctVal = (po.dutyPct != null ? po.dutyPct : 6);   // % Eingabe (z.B. 6,5 oder „6,5%“)
  var vatPctVal  = (po.vatPct  != null ? po.vatPct  : 19);  // % Eingabe
  var dutyPct    = toPercent(dutyPctVal);
  var vatPct     = toPercent(vatPctVal);

  var vatRefund  = !!(po.vatRefund !== false);
  var vatLagM    = Number(po.vatLagMonths != null ? po.vatLagMonths : 2);

  var tOrder   = date0;
  var tProdEnd = addDays(date0, prodDays);
  var tShip    = tProdEnd;
  var tArrive  = addDays(tShip, transpDays);
  var tVatBack = addMonths(tArrive, vatLagM);

  var ev = [];

  ev.push({
    date: tOrder,
    type: "PO_MS",
    label: num + " · Deposit " + pctLabelRaw(depPctVal),
    amount: -(goods * dep)
  });

  ev.push({
    date: tProdEnd,
    type: "PO_MS",
    label: num + " · Balance " + pctLabelRaw(balPctVal),
    amount: -(goods * bal)
  });

  if (freight){
    ev.push({ date:tArrive, type:"FREIGHT", label: num + " · Freight", amount: -Math.abs(freight) });
  }

  var duty = goods * dutyPct;  // z.B. 8000 * 0.065 = 520
  if (duty){
    ev.push({ date:tArrive, type:"DUTY", label: num + " · Zoll " + pctLabelRaw(dutyPctVal), amount: -Math.abs(duty) });
  }

  var eust = goods * vatPct;
  if (eust){
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

// src/domain/orders.js
// PO/FO Engine (lokal, EUR-basiert) – erzeugt Cash-Events + Monatsaggregation

function parseDE(x){ return Number(String(x ?? 0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtYYYYMM(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

const DEFAULTS = {
  vatPct: 0.19,
  seaDays: 60, railDays: 30, airDays: 10,
  freightLagDays: 14, vatLagMonths: 2, autoVatRefund: true,
};

export function expandPO(po, settings={}){
  const S = { ...DEFAULTS, ...settings };
  const out = [];
  const order = new Date(po.orderDate);

  const prodDone = addDays(order, Number(po.prodDays||0));
  const transit = po.mode==="air" ? S.airDays : po.mode==="rail" ? S.railDays : S.seaDays;
  const etd = prodDone;
  const eta = addDays(etd, transit);

  // Meilensteine (in EUR, negativ = Zahlung)
  (po.milestones||[]).forEach((ms, i)=>{
    const base =
      ms.anchor === "ORDER_DATE" ? order :
      ms.anchor === "PROD_DONE"   ? prodDone :
      ms.anchor === "ETD"         ? etd : eta;
    const dt = addDays(base, Number(ms.lagDays||0));
    let val = 0;
    if (typeof ms.percent === "number"){
      val = -parseDE(po.goodsEur) * (ms.percent/100);
    } else {
      val = -parseDE(ms.valueEur);
    }
    out.push({ date: dt, amountEur: val, type:"PO_MS", label:`${po.poNo} · ${ms.label||("MS "+(i+1))}` });
  });

  // Freight (bei Nicht-DDP) – Fälligkeit ETA + Lag
  if (!po.ddp && parseDE(po.freightEur) !== 0){
    out.push({ date: addDays(eta, S.freightLagDays), amountEur: -parseDE(po.freightEur), type:"FREIGHT", label:`${po.poNo} · Freight` });
  }

  // Zoll (Duty) + EUSt (bei Nicht-DDP)
  if (!po.ddp){
    const baseForDuty = parseDE(po.goodsEur) + (po.dutyIncludeFreight ? parseDE(po.freightEur) : 0);
    const duty = (po.dutyOverrideEur!=null && po.dutyOverrideEur!=="") ? -parseDE(po.dutyOverrideEur) : -(baseForDuty * (Number(po.dutyPct||0)));
    if (duty !== 0) out.push({ date: eta, amountEur: duty, type:"DUTY", label:`${po.poNo} · Zoll` });

    const eustBase = parseDE(po.goodsEur) + parseDE(po.freightEur||0) + Math.abs(duty||0);
    const eust = (po.eustOverrideEur!=null && po.eustOverrideEur!=="") ? -parseDE(po.eustOverrideEur) : -(eustBase * S.vatPct);
    if (eust !== 0){
      out.push({ date: eta, amountEur: eust, type:"EUST", label:`${po.poNo} · EUSt` });
      if (S.autoVatRefund){
        const refundMonthEnd = new Date(eta.getFullYear(), eta.getMonth()+S.vatLagMonths+1, 0);
        out.push({ date: refundMonthEnd, amountEur: +Math.abs(eust), type:"VAT_REFUND", label:`${po.poNo} · USt-Erstattung` });
      }
    }
  }

  return out;
}

export function expandFO(fo){
  // FO: einfache Ausgabe zu Datum (negativ)
  return [{ date: new Date(fo.date), amountEur: -parseDE(fo.amountEur), type:"FO", label: fo.label || "Freight/Other" }];
}

export function expandOrders(orders = {}, settings = {}){
  const events = [];
  (orders.pos||[]).forEach(po => events.push(...expandPO(po, settings)));
  (orders.fos||[]).forEach(fo => events.push(...expandFO(fo)));
  // sort
  events.sort((a,b)=>a.date - b.date);
  return events;
}

export function byMonthSum(events){
  const m = new Map();
  events.forEach(ev=>{
    const ym = fmtYYYYMM(ev.date);
    m.set(ym, (m.get(ym)||0) + Number(ev.amountEur||0));
  });
  return m; // Map("YYYY-MM" -> sum EUR)
}

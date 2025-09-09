// src/domain/po.js
// FBA-CF-0023 — Purchase Orders: Domain + Event expansion

// --- Helpers ---
function clamp01(x){ const n=Number(x||0); return n>1 ? n/100 : n; }
function parseDE(x){ return Number(String(x??0).replace(/\./g,"").replace(",", ".")) || 0; }
function fmtEUR(n){
  return new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n||0);
}
function addDays(dateStr, days){
  const d = new Date(dateStr); d.setDate(d.getDate() + Number(days||0)); return d.toISOString().slice(0,10);
}
function addMonths(dateStr, months){
  const d = new Date(dateStr); d.setMonth(d.getMonth() + Number(months||0)); return d.toISOString().slice(0,10);
}

// transport defaults
const TRANSPORT_DAYS = { sea: 60, rail: 30, air: 10 };

// --- Expand one PO into cash events (EUR, signed) ---
export function expandPO(po, settings={}){
  // defaults + parsing
  const num   = (po?.number ?? "").trim() || "(ohne Nr.)";
  const date0 = po?.orderDate || new Date().toISOString().slice(0,10);
  const goods = parseDE(po?.goodsEur);
  const dep   = clamp01(po?.depositPct ?? 0.30);
  const bal   = clamp01(po?.balancePct ?? 0.70);

  const prodDays   = Number(po?.productionDays ?? 30);
  const mode       = (po?.transportMode || "sea");
  const transpDays = Number(po?.transportDays ?? TRANSPORT_DAYS[mode] || 60);

  const freight    = parseDE(po?.freightEur);
  const dutyPct    = clamp01(po?.dutyPct ?? 0.06);
  const vatPct     = clamp01(po?.vatPct ?? 0.19);

  const vatRefund  = !!(po?.vatRefund ?? true);
  const vatLagM    = Number(po?.vatLagMonths ?? 2);

  // timeline
  const tOrder   = date0;
  const tProdEnd = addDays(date0, prodDays);
  const tShip    = tProdEnd;
  const tArrive  = addDays(tShip, transpDays);
  const tVatBack = addMonths(tArrive, vatLagM);

  // amounts (negativ = outflow)
  const ev = [];

  // 1) Deposit am Bestelltag
  ev.push({ date: tOrder, type:"PO_MS",  label:`${num} · Deposit ${Math.round(dep*100)}%`, amount: -(goods*dep) });

  // 2) Balance bei Produktionsende
  ev.push({ date: tProdEnd, type:"PO_MS", label:`${num} · Balance ${Math.round(bal*100)}%`, amount: -(goods*bal) });

  // 3) Freight bei Ankunft
  if (freight) ev.push({ date:tArrive, type:"FREIGHT", label:`${num} · Freight`, amount: -Math.abs(freight) });

  // 4) Zoll (Duty) bei Ankunft
  const duty = goods * dutyPct;
  if (duty) ev.push({ date:tArrive, type:"DUTY", label:`${num} · Zoll`, amount: -Math.abs(duty) });

  // 5) EUSt (Vorsteuer) bei Ankunft und (optional) Erstattung verzögert
  const eust = goods * vatPct;
  if (eust){
    ev.push({ date:tArrive, type:"EUST", label:`${num} · EUSt`, amount: -Math.abs(eust) });
    if (vatRefund) ev.push({ date:tVatBack, type:"VAT_REFUND", label:`${num} · USt-Erstattung`, amount: Math.abs(eust) });
  }

  // Rückgabe inkl. Debug
  return ev.sort((a,b)=> a.date.localeCompare(b.date));
}

// --- Expand all POs from state ---
export function expandAllPOEvents(state){
  const settings = state?.settings || {};
  const list = Array.isArray(state?.pos) ? state.pos : [];
  return list.flatMap(po => expandPO(po, settings));
}

// --- PO factory (default template) ---
export function newPO(){
  const today = new Date().toISOString().slice(0,10);
  return {
    id: crypto.randomUUID(),
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

export { fmtEUR };

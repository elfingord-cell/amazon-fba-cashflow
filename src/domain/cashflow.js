// FBA-CF-0027 — Cashflow-Domain: Serienberechnung + PO-Milestone-Expansion
// Exporte: computeSeries, fmtEUR

// ---------- Utils ----------
function parseDE(x) {
  if (x == null) return 0;
  const s = String(x).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function fmtEUR(n) {
  const v = Number(n || 0);
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function ym(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function monthSeq(startYm = "2025-02", n = 18) {
  const [y, m] = startYm.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(y, (m - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
function clampPct(x) {
  const v = parseDE(x);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

// ---------- PO Expansion (Milestones nur; Freight/Zoll/EUSt bleiben separat in eigenem Inkrement) ----------
/*
  PO minimal:
  {
    id: string, poNo: string,
    orderDate: "YYYY-MM-DD",
    goodsEur: string|number,
    prodDays: number,                // z.B. 60
    transport: "sea"|"rail"|"air",
    transitDays: number,             // z.B. 60/30/10 (kann überschrieben werden)
    milestones: [
      { id, label, percent, anchor:"ORDER_DATE"|"PROD_DONE"|"ETD"|"ETA", lagDays }
    ]
  }
*/
function anchorDate(po, anchor) {
  const order = new Date(po.orderDate);
  const prodDone = addDays(order, Number(po.prodDays || 0));
  const etd = prodDone;
  const eta = addDays(etd, Number(po.transitDays || 0));
  if (anchor === "ORDER_DATE") return order;
  if (anchor === "PROD_DONE") return prodDone;
  if (anchor === "ETD") return etd;
  return eta; // "ETA"
}
function migrateLegacyMilestones(po) {
  if (Array.isArray(po.milestones) && po.milestones.length > 0) return po;
  const m = [];
  const dep = po.depositPct != null ? clampPct(po.depositPct) : null;
  const bal = po.balancePct != null ? clampPct(po.balancePct) : null;
  if (dep != null || bal != null) {
    if (dep && dep > 0) m.push({ id: cryptoId(), label: "Deposit", percent: dep, anchor: "ORDER_DATE", lagDays: 0 });
    if (bal && bal > 0) m.push({ id: cryptoId(), label: "Balance", percent: bal, anchor: "PROD_DONE", lagDays: 0 });
  }
  po.milestones = m.length ? m : [
    { id: cryptoId(), label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
    { id: cryptoId(), label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 }
  ];
  return po;
}
function cryptoId() {
  // kurze ID für UI; falls Crypto nicht verfügbar, Fallback
  try { return Math.random().toString(36).slice(2, 9); } catch { return Date.now().toString(36); }
}
function expandPOMilestones(po) {
  const p = migrateLegacyMilestones({ ...po });
  const goods = parseDE(p.goodsEur);
  const ms = Array.isArray(p.milestones) ? p.milestones : [];
  const events = [];
  for (const m of ms) {
    const pct = clampPct(m.percent);
    if (pct <= 0) continue;
    const baseDate = anchorDate(p, m.anchor || "ORDER_DATE");
    const due = addDays(baseDate, Number(m.lagDays || 0));
    const amount = -(goods * (pct / 100)); // Auszahlung (negativ)
    events.push({
      type: "PO_MS",
      poNo: p.poNo || p.id || "",
      label: (m.label || "Zahlung"),
      date: endOfMonth(due), // Monatsende als Buchungstag (wie besprochen)
      amountEur: amount
    });
  }
  return events;
}

// ---------- Serienberechnung ----------
export function computeSeries(state) {
  const settings = state?.settings || {};
  const startMonth = settings.startMonth || "2025-02";
  const horizon = Number(settings.horizonMonths || 18);
  const opening = parseDE(settings.openingBalance ?? settings.openingEur ?? "0");
  const months = monthSeq(startMonth, horizon);

  // Grundgerüst je Monat
  const byMonth = new Map(months.map(m => [m, { inflow: 0, out: 0, partsIn: [], partsOut: [] }]));

  // Inflows: Sales × Payout + Extras
  const incomings = Array.isArray(state?.incomings) ? state.incomings : [];
  for (const r of incomings) {
    const m = r.month;
    if (!byMonth.has(m)) continue;
    const rev = parseDE(r.revenueEur);
    let p = String(r.payoutPct ?? r.payoutRate ?? "0").trim();
    p = p.replace("%", "");
    let pct = parseDE(p);
    pct = pct > 1 ? pct / 100 : pct; // 85 → 0.85; 0,85 bleibt 0.85
    const val = rev * pct;
    const row = byMonth.get(m);
    row.inflow += val;
    row.partsIn.push({ label: "Sales×Payout", val });
  }

  const extras = Array.isArray(state?.extras) ? state.extras : [];
  for (const r of extras) {
    const m = r.month;
    if (!byMonth.has(m)) continue;
    const val = parseDE(r.amountEur);
    const row = byMonth.get(m);
    row.inflow += val;
    row.partsIn.push({ label: r.label || "Extra", val });
  }

  // Outflows: Outgoings (fixe Kosten o. ä.)
  const outgo = Array.isArray(state?.outgoings) ? state.outgoings : [];
  for (const r of outgo) {
    const m = r.month;
    if (!byMonth.has(m)) continue;
    const val = parseDE(r.amountEur);
    const row = byMonth.get(m);
    row.out += Math.abs(val);
    row.partsOut.push({ label: r.label || "Ausgabe", val: Math.abs(val) });
  }

  // PO-Milestones → Outflow-Events
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  for (const po of pos) {
    const evs = expandPOMilestones(po);
    for (const e of evs) {
      const m = ym(e.date);
      if (!byMonth.has(m)) continue;
      const row = byMonth.get(m);
      const v = Math.abs(parseDE(e.amountEur));
      row.out += v;
      row.partsOut.push({ label: `${e.poNo} · ${e.label}`, val: v });
    }
  }

  // Serie/net/closing
  const series = [];
  let running = opening;
  for (const m of months) {
    const r = byMonth.get(m);
    const net = (r.inflow || 0) - (r.out || 0);
    running += net;
    series.push({
      month: m,
      inflow: r.inflow || 0,
      outflow: r.out || 0,
      net,
      closing: running,
      partsIn: r.partsIn,
      partsOut: r.partsOut
    });
  }

  // KPIs
  const firstNeg = series.find(x => x.closing < 0)?.month || null;
  const salesVals = incomings.map(r => parseDE(r.revenueEur) * ((parseDE(String(r.payoutPct).replace("%","")) > 1 ? parseDE(String(r.payoutPct).replace("%",""))/100 : parseDE(String(r.payoutPct).replace("%","")) ) || 0));
  const salesAvg = salesVals.length ? (salesVals.reduce((a,b)=>a+b,0) / salesVals.length) : 0;

  return {
    months,
    series,
    kpis: {
      opening,
      salesPayoutAvg: salesAvg,
      firstNegativeMonth: firstNeg
    },
    fmtEUR
  };
}

export { fmtEUR };

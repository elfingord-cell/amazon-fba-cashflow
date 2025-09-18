// src/domain/cashflow.js
// computeSeries: Monatsaggregation (Sales×Payout + Extras – Outgoings – PO – FO)

const STATE_KEY = 'amazon_fba_cashflow_v1';

function parseEuro(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function parsePct(p) {
  if (p === '' || p === null || p === undefined) return 0;
  const n = Number(String(p).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function addMonths(yyyymm, delta) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}
function monthRange(startMonth, n) { const out = []; for (let i = 0; i < n; i++) out.push(addMonths(startMonth, i)); return out; }
function toMonthKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function addDays(date, days) { const d = new Date(date.getTime()); d.setDate(d.getDate() + (days || 0)); return d; }
function anchorsFor(row) {
  const od = row.orderDate ? new Date(row.orderDate) : new Date();
  const prodDone = addDays(od, Number(row.prodDays || 0));
  const etd = prodDone; // simple convention
  const eta = addDays(etd, Number(row.transitDays || 0));
  return { ORDER_DATE: od, PROD_DONE: prodDone, ETD: etd, ETA: eta };
}
function expandMilestones(row) {
  const base = anchorsFor(row);
  const goods = parseEuro(row.goodsEur);
  const ms = Array.isArray(row.milestones) ? row.milestones : [];
  return ms.map(m => {
    const pct = parsePct(m.percent);
    const amount = goods * (pct / 100);
    const d0 = base[m.anchor || 'ORDER_DATE'] || base.ORDER_DATE;
    const due = addDays(d0, Number(m.lagDays || 0));
    return {
      label: m.label || '',
      amount,
      due,
      month: toMonthKey(due),
      anchor: m.anchor || 'ORDER_DATE',
      lagDays: Number(m.lagDays || 0),
    };
  });
}

export function computeSeries(state) {
  const s = state || {};
  const startMonth = (s.settings && s.settings.startMonth) || '2025-01';
  const horizon = Number((s.settings && s.settings.horizonMonths) || 12);
  const months = monthRange(startMonth, horizon);

  // buckets
  const bucket = {};
  months.forEach(m => { bucket[m] = { inflow: 0, outflow: 0, itemsIn: [], itemsOut: [] }; });

  // Sales × Payout
  (Array.isArray(s.incomings) ? s.incomings : []).forEach(row => {
    const m = row.month;
    if (!bucket[m]) return;
    const rev = parseEuro(row.revenueEur);
    const pct = parsePct(row.payoutPct);
    const amt = rev * (pct / 100);
    bucket[m].inflow += amt;
    bucket[m].itemsIn.push({ kind: 'sales-payout', label: 'Sales×Payout', amount: amt });
  });

  // Extras (positiv)
  (Array.isArray(s.extras) ? s.extras : []).forEach(row => {
    const m = row.month;
    if (!bucket[m]) return;
    const amt = parseEuro(row.amountEur);
    bucket[m].inflow += amt;
    bucket[m].itemsIn.push({ kind: 'extra', label: row.label || 'Extra', amount: amt });
  });

  // Outgoings (Fixkosten etc.)
  (Array.isArray(s.outgoings) ? s.outgoings : []).forEach(row => {
    const m = row.month;
    if (!bucket[m]) return;
    const amt = parseEuro(row.amountEur);
    bucket[m].outflow += amt;
    bucket[m].itemsOut.push({ kind: 'outgoing', label: row.label || 'Kosten', amount: amt });
  });

  // PO-Milestones (Outflow)
  (Array.isArray(s.pos) ? s.pos : []).forEach(po => {
    expandMilestones(po).forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      bucket[m].outflow += ev.amount;
      bucket[m].itemsOut.push({ kind: 'po', label: (po.poNo ? `PO ${po.poNo}` : 'PO') + (ev.label ? ` – ${ev.label}` : ''), amount: ev.amount });
    });
  });

  // FO-Milestones (Outflow) — NEU
  (Array.isArray(s.fos) ? s.fos : []).forEach(fo => {
    expandMilestones(fo).forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      bucket[m].outflow += ev.amount;
      bucket[m].itemsOut.push({ kind: 'fo', label: (fo.foNo ? `FO ${fo.foNo}` : 'FO') + (ev.label ? ` – ${ev.label}` : ''), amount: ev.amount });
    });
  });

  // series
  const series = months.map(m => {
    const b = bucket[m];
    const net = b.inflow - b.outflow;
    return { month: m, inflow: b.inflow, outflow: b.outflow, net, itemsIn: b.itemsIn, itemsOut: b.itemsOut };
  });

  // KPIs (leichtgewichtig)
  const opening = parseEuro(s.settings && s.settings.openingBalance);
  const firstNeg = months.find(m => {
    const idx = months.indexOf(m);
    let bal = opening;
    for (let i = 0; i <= idx; i++) bal += series[i].net;
    return bal < 0;
  }) || null;

  const salesIn = series.map(x => x.itemsIn.filter(i => i.kind === 'sales-payout').reduce((a, b) => a + b.amount, 0));
  const avgSalesPayout = salesIn.length ? (salesIn.reduce((a, b) => a + b, 0) / (salesIn.filter(v => v > 0).length || 1)) : 0;

  return {
    startMonth,
    horizon,
    months,
    series,
    kpis: {
      openingToday: opening,
      avgSalesPayout,
      firstNegativeMonth: firstNeg,
    },
  };
}

export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}

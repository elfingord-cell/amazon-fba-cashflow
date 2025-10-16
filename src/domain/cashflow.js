// src/domain/cashflow.js
// Monatsaggregation (Sales×Payout + Extras – Outgoings – PO – FO)
// + Utils als Named Exports: fmtEUR, fmtPct, parseEuro, parsePct

const STATE_KEY = 'amazon_fba_cashflow_v1';

// ---------- Utils (exportiert) ----------
function _num(n) { return Number.isFinite(n) ? n : 0; }

export function parseEuro(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parsePct(p) {
  if (p === '' || p === null || p === undefined) return 0;
  const n = Number(String(p).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function fmtEUR(val) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
    .format(_num(Number(val)));
}

export function fmtPct(val) {
  const n = parsePct(val);
  return `${String(n).replace('.', ',')}%`;
}

// ---------- interne Helper ----------
function addMonths(yyyymm, delta) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthRange(startMonth, n) { const out = []; for (let i = 0; i < n; i++) out.push(addMonths(startMonth, i)); return out; }
function toMonthKey(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function addDays(date, days) { const d = new Date(date.getTime()); d.setDate(d.getDate() + (days || 0)); return d; }
function anchorsFor(row) {
  const od = row.orderDate ? new Date(row.orderDate) : new Date();
  const prodDone = addDays(od, Number(row.prodDays || 0));
  const etd = prodDone; // einfache Konvention
  const eta = addDays(etd, Number(row.transitDays || 0));
  return { ORDER_DATE: od, PROD_DONE: prodDone, ETD: etd, ETA: eta };
}
function addMonthsDate(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthEndDate(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function normaliseSettings(raw) {
  const settings = raw || {};
  return {
    dutyRatePct: parsePct(settings.dutyRatePct ?? 0),
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: parsePct(settings.eustRatePct ?? 0),
    vatRefundLagMonths: Number(settings.vatRefundLagMonths ?? 0) || 0,
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    freightLagDays: Number(settings.freightLagDays ?? 0) || 0,
    fxFeePct: parsePct(settings.fxFeePct ?? 0),
  };
}

function normaliseAutoEvents(row, settings, manual) {
  const order = ['duty', 'eust', 'vat_refund', 'fx_fee'];
  const clones = Array.isArray(row.autoEvents)
    ? row.autoEvents.filter(Boolean).map(evt => ({ ...evt }))
    : [];
  const map = new Map();
  for (const evt of clones) {
    if (!evt || !evt.type) continue;
    if (!evt.id) evt.id = `auto-${evt.type}`;
    map.set(evt.type, evt);
  }

  const firstManual = (manual || [])[0] || null;

  function ensure(type, defaults) {
    if (!map.has(type)) {
      const created = { id: `auto-${type}`, type, ...defaults };
      clones.push(created);
      map.set(type, created);
      return created;
    }
    const existing = map.get(type);
    if (!existing.id) existing.id = `auto-${type}`;
    for (const [key, value] of Object.entries(defaults)) {
      if (existing[key] === undefined) existing[key] = value;
    }
    return existing;
  }

  ensure('duty', {
    label: 'Zoll',
    percent: settings.dutyRatePct,
    anchor: 'ETA',
    lagDays: settings.freightLagDays,
  });
  ensure('eust', {
    label: 'EUSt',
    percent: settings.eustRatePct,
    anchor: 'ETA',
    lagDays: settings.freightLagDays,
  });
  ensure('vat_refund', {
    label: 'EUSt-Erstattung',
    percent: 100,
    anchor: 'ETA',
    lagMonths: settings.vatRefundLagMonths,
    enabled: settings.vatRefundEnabled,
  });
  ensure('fx_fee', {
    label: 'FX-Gebühr',
    percent: settings.fxFeePct,
    anchor: (firstManual && firstManual.anchor) || 'ORDER_DATE',
    lagDays: (firstManual && Number(firstManual.lagDays || 0)) || 0,
  });

  clones.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  if (row.ddp) {
    for (const evt of clones) {
      if (evt.type === 'duty' || evt.type === 'eust' || evt.type === 'vat_refund') {
        evt.enabled = false;
      }
    }
  }

  return clones;
}

function expandOrderEvents(row, settings, entityLabel, numberField) {
  if (!row) return [];
  const goods = parseEuro(row.goodsEur);
  const freight = parseEuro(row.freightEur);
  const anchors = anchorsFor(row);
  const manual = Array.isArray(row.milestones) ? row.milestones : [];
  const autoEvents = normaliseAutoEvents(row, settings, manual);
  const prefixBase = entityLabel || 'PO';
  const ref = row[numberField];
  const prefix = ref ? `${prefixBase} ${ref}` : prefixBase;
  const events = [];

  for (const ms of manual) {
    const pct = parsePct(ms.percent);
    const baseDate = anchors[ms.anchor || 'ORDER_DATE'] || anchors.ORDER_DATE;
    const due = addDays(baseDate, Number(ms.lagDays || 0));
    events.push({
      label: `${prefix}${ms.label ? ` – ${ms.label}` : ''}`,
      amount: goods * (pct / 100),
      due,
      month: toMonthKey(due),
      direction: 'out',
      type: 'manual',
    });
  }

  const dutyIncludeFreight = row.dutyIncludeFreight !== false;
  const dutyRate = parsePct(row.dutyRatePct ?? settings.dutyRatePct ?? 0);
  const eustRate = parsePct(row.eustRatePct ?? settings.eustRatePct ?? 0);
  const fxFeePct = parsePct(row.fxFeePct ?? settings.fxFeePct ?? 0);
  const vatLagMonths = Number(row.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0);
  const vatEnabled = row.vatRefundEnabled !== false;

  const autoResults = {};
  for (const auto of autoEvents) {
    if (!auto || auto.enabled === false) continue;
    const anchor = auto.anchor || 'ETA';
    const baseDate = anchors[anchor] || anchors.ETA;
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) continue;

    if (auto.type === 'duty') {
      const percent = parsePct(auto.percent ?? dutyRate);
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      const baseValue = goods + (dutyIncludeFreight ? freight : 0);
      const amount = baseValue * (percent / 100);
      autoResults.duty = { amount, due };
      events.push({
        label: `${prefix} – ${auto.label || 'Zoll'}`,
        amount,
        due,
        month: toMonthKey(due),
        direction: 'out',
        type: 'duty',
      });
      continue;
    }

    if (auto.type === 'eust') {
      const percent = parsePct(auto.percent ?? eustRate);
      const dutyAbs = Math.abs(autoResults.duty?.amount || 0);
      const baseValue = goods + freight + dutyAbs;
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      const amount = baseValue * (percent / 100);
      autoResults.eust = { amount, due };
      events.push({
        label: `${prefix} – ${auto.label || 'EUSt'}`,
        amount,
        due,
        month: toMonthKey(due),
        direction: 'out',
        type: 'eust',
      });
      continue;
    }

    if (auto.type === 'vat_refund') {
      const eust = autoResults.eust;
      if (!vatEnabled || !eust || eust.amount === 0) continue;
      const percent = parsePct(auto.percent ?? 100);
      const months = Number((auto.lagMonths ?? vatLagMonths) || 0);
      const baseDay = addDays(eust.due || baseDate, Number(auto.lagDays || 0));
      const due = monthEndDate(addMonthsDate(baseDay, months));
      const amount = Math.abs(eust.amount) * (percent / 100);
      events.push({
        label: `${prefix} – ${auto.label || 'EUSt-Erstattung'}`,
        amount,
        due,
        month: toMonthKey(due),
        direction: 'in',
        type: 'vat_refund',
      });
      continue;
    }

    if (auto.type === 'fx_fee') {
      const percent = parsePct(auto.percent ?? fxFeePct);
      if (!percent) continue;
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      const amount = goods * (percent / 100);
      events.push({
        label: `${prefix} – ${auto.label || 'FX-Gebühr'}`,
        amount,
        due,
        month: toMonthKey(due),
        direction: 'out',
        type: 'fx_fee',
      });
    }
  }

  return events;
}

// ---------- Aggregation ----------
export function computeSeries(state) {
  const s = state || {};
  const startMonth = (s.settings && s.settings.startMonth) || '2025-01';
  const horizon = Number((s.settings && s.settings.horizonMonths) || 12);
  const months = monthRange(startMonth, horizon);

  const bucket = {};
  months.forEach(m => { bucket[m] = { inflow: 0, outflow: 0, itemsIn: [], itemsOut: [] }; });

  // Inflows
  (Array.isArray(s.incomings) ? s.incomings : []).forEach(row => {
    const m = row.month; if (!bucket[m]) return;
    const amt = parseEuro(row.revenueEur) * (parsePct(row.payoutPct) / 100);
    bucket[m].inflow += amt;
    bucket[m].itemsIn.push({ kind: 'sales-payout', label: 'Sales×Payout', amount: amt });
  });

  (Array.isArray(s.extras) ? s.extras : []).forEach(row => {
    const m = row.month; if (!bucket[m]) return;
    const amt = parseEuro(row.amountEur);
    bucket[m].inflow += amt;
    bucket[m].itemsIn.push({ kind: 'extra', label: row.label || 'Extra', amount: amt });
  });

  // Outflows (fixe Kosten)
  (Array.isArray(s.outgoings) ? s.outgoings : []).forEach(row => {
    const m = row.month; if (!bucket[m]) return;
    const amt = parseEuro(row.amountEur);
    bucket[m].outflow += amt;
    bucket[m].itemsOut.push({ kind: 'outgoing', label: row.label || 'Kosten', amount: amt });
  });

  (Array.isArray(s.dividends) ? s.dividends : []).forEach(row => {
    const month = row.month || (row.date ? toMonthKey(row.date) : null);
    if (!month || !bucket[month]) return;
    const amt = parseEuro(row.amountEur);
    bucket[month].outflow += amt;
    bucket[month].itemsOut.push({ kind: 'dividend', label: row.label || 'Dividende', amount: amt });
  });

  const settingsNorm = normaliseSettings(s.settings);

  // PO-Events (Milestones & Importkosten)
  (Array.isArray(s.pos) ? s.pos : []).forEach(po => {
    expandOrderEvents(po, settingsNorm, 'PO', 'poNo').forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      if (ev.direction === 'in') {
        bucket[m].inflow += ev.amount;
        bucket[m].itemsIn.push({ kind: ev.type === 'vat_refund' ? 'po-refund' : 'po', label: ev.label, amount: ev.amount });
      } else {
        bucket[m].outflow += ev.amount;
        const kind = ev.type === 'manual' ? 'po' : 'po-import';
        bucket[m].itemsOut.push({ kind, label: ev.label, amount: ev.amount });
      }
    });
  });

  // FO-Events (Milestones & Importkosten)
  (Array.isArray(s.fos) ? s.fos : []).forEach(fo => {
    expandOrderEvents(fo, settingsNorm, 'FO', 'foNo').forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      if (ev.direction === 'in') {
        bucket[m].inflow += ev.amount;
        bucket[m].itemsIn.push({ kind: ev.type === 'vat_refund' ? 'fo-refund' : 'fo', label: ev.label, amount: ev.amount });
      } else {
        bucket[m].outflow += ev.amount;
        const kind = ev.type === 'manual' ? 'fo' : 'fo-import';
        bucket[m].itemsOut.push({ kind, label: ev.label, amount: ev.amount });
      }
    });
  });

  const series = months.map(m => {
    const b = bucket[m];
    return { month: m, inflow: b.inflow, outflow: b.outflow, net: b.inflow - b.outflow, itemsIn: b.itemsIn, itemsOut: b.itemsOut };
  });

  // KPIs
  const opening = parseEuro(s.settings && s.settings.openingBalance);
  const firstNeg = months.find(m => {
    const idx = months.indexOf(m);
    let bal = opening;
    for (let i = 0; i <= idx; i++) bal += series[i].net;
    return bal < 0;
  }) || null;

  const salesIn = series.map(x => x.itemsIn.filter(i => i.kind === 'sales-payout').reduce((a, b) => a + b.amount, 0));
  const avgSalesPayout = salesIn.length ? (salesIn.reduce((a, b) => a + b, 0) / (salesIn.filter(v => v > 0).length || 1)) : 0;

  const kpis = {
    opening,
    openingToday: opening,
    salesPayoutAvg: avgSalesPayout,
    avgSalesPayout,
    firstNegativeMonth: firstNeg,
  };

  return { startMonth, horizon, months, series, kpis };
}

// ---------- State ----------
export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}

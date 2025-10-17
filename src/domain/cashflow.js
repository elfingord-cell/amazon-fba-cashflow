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
function isoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function monthEndFromKey(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0);
}
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

  for (const [idx, ms] of manual.entries()) {
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
      anchor: ms.anchor || 'ORDER_DATE',
      lagDays: Number(ms.lagDays || 0) || 0,
      percent: pct,
      sourceType: prefixBase,
      sourceNumber: ref,
      sourceId: row.id,
      id: `${row.id || prefixBase}-${idx}-${ms.id || 'manual'}`,
      tooltip: `Fälligkeit: ${ms.anchor || 'ORDER_DATE'} + ${Number(ms.lagDays || 0)} Tage`,
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
        anchor: auto.anchor || 'ETA',
        lagDays: Number(auto.lagDays || 0) || 0,
        percent,
        sourceType: prefixBase,
        sourceNumber: ref,
        sourceId: row.id,
        id: `${row.id || prefixBase}-auto-duty`,
        tooltip: `Zoll = ${percent}% × (Warenwert${dutyIncludeFreight ? ' + Fracht' : ''})`,
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
        anchor: auto.anchor || 'ETA',
        lagDays: Number(auto.lagDays || 0) || 0,
        percent,
        sourceType: prefixBase,
        sourceNumber: ref,
        sourceId: row.id,
        id: `${row.id || prefixBase}-auto-eust`,
        tooltip: `EUSt = ${percent}% × (Warenwert + Fracht + Zoll)`,
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
        anchor: auto.anchor || 'ETA',
        lagMonths: months,
        percent,
        sourceType: prefixBase,
        sourceNumber: ref,
        sourceId: row.id,
        id: `${row.id || prefixBase}-auto-vat`,
        tooltip: `Erstattung am Monatsende nach ${months} Monaten`,
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
        anchor: auto.anchor || 'ORDER_DATE',
        lagDays: Number(auto.lagDays || 0) || 0,
        percent,
        sourceType: prefixBase,
        sourceNumber: ref,
        sourceId: row.id,
        id: `${row.id || prefixBase}-auto-fx`,
        tooltip: `FX-Gebühr = ${percent}% × Warenwert`,
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

  const statusState = (s.status && typeof s.status === 'object') ? s.status : {};
  const statusEvents = (statusState.events && typeof statusState.events === 'object') ? statusState.events : {};
  const autoManualCheck = statusState.autoManualCheck === true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();

  const bucket = {};
  months.forEach(m => { bucket[m] = { entries: [] }; });

  function pushEntry(month, entry) {
    if (!bucket[month]) return;
    bucket[month].entries.push(entry);
  }

  function baseEntry(overrides, meta = {}) {
    const baseId = overrides.id || `${overrides.month || ''}-${overrides.label || ''}-${overrides.date || ''}`;
    const statusRecord = statusEvents[baseId];
    const manual = typeof statusRecord?.manual === 'boolean' ? statusRecord.manual : undefined;
    const entryDate = overrides.date ? new Date(overrides.date) : null;
    const entryTime = entryDate && Number.isFinite(entryDate.getTime()) ? new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime() : null;
    const isAuto = meta.auto === true;
    const autoEligible = isAuto && meta.autoEligible !== false;
    const defaultPaid = typeof overrides.paid === 'boolean' ? overrides.paid : Boolean(meta.defaultPaid);
    let paid = false;
    let autoApplied = false;

    if (typeof manual === 'boolean') {
      paid = manual;
    } else if (autoEligible && !autoManualCheck && entryTime != null && entryTime <= todayTime) {
      paid = true;
      autoApplied = true;
    } else {
      paid = defaultPaid;
    }

    const autoSuppressed = autoEligible && autoManualCheck && !autoApplied;
    const autoTooltip = (() => {
      if (!autoEligible) return null;
      if (autoApplied) return 'Automatisch bezahlt am Fälligkeitstag';
      if (autoManualCheck) return 'Automatische Zahlung – manuelle Prüfung aktiv';
      return 'Automatische Zahlung';
    })();

    return {
      id: baseId,
      direction: overrides.direction || 'in',
      amount: Math.abs(overrides.amount || 0),
      label: overrides.label || '',
      month: overrides.month,
      date: overrides.date,
      kind: overrides.kind,
      group: overrides.group,
      paid,
      source: overrides.source || null,
      anchor: overrides.anchor,
      lagDays: overrides.lagDays,
      lagMonths: overrides.lagMonths,
      percent: overrides.percent,
      scenarioDelta: overrides.scenarioDelta || 0,
      scenarioAmount: overrides.scenarioAmount || overrides.amount || 0,
      meta: overrides.meta || {},
      tooltip: overrides.tooltip,
      sourceTab: overrides.sourceTab,
      sourceNumber: overrides.sourceNumber,
      statusId: baseId,
      auto: isAuto,
      autoEligible,
      autoApplied,
      autoManualCheck,
      manualOverride: typeof manual === 'boolean',
      autoSuppressed,
      autoTooltip,
    };
  }

  // Inflows
  (Array.isArray(s.incomings) ? s.incomings : []).forEach(row => {
    const m = row.month; if (!bucket[m]) return;
    const amt = parseEuro(row.revenueEur) * (parsePct(row.payoutPct) / 100);
    const date = monthEndFromKey(m);
    pushEntry(m, baseEntry({
      id: `sales-${m}`,
      direction: amt >= 0 ? 'in' : 'out',
      amount: Math.abs(amt),
      label: 'Amazon Payout',
      month: m,
      date: isoDate(date),
      kind: 'sales-payout',
      group: amt >= 0 ? 'Sales × Payout' : 'Extras (Out)',
      source: 'sales',
      sourceTab: '#eingaben',
    }, { auto: false }));
  });

  (Array.isArray(s.extras) ? s.extras : []).forEach(row => {
    const month = row.month || (row.date ? toMonthKey(row.date) : null);
    if (!month || !bucket[month]) return;
    const amt = parseEuro(row.amountEur);
    const direction = amt >= 0 ? 'in' : 'out';
    const entryMonth = month;
    const dateSource = row.date ? new Date(row.date) : monthEndFromKey(entryMonth);
    pushEntry(entryMonth, baseEntry({
      id: `extra-${row.id || row.label || entryMonth}-${row.date || ''}`,
      direction,
      amount: Math.abs(amt),
      label: row.label || 'Extra',
      month: entryMonth,
      date: isoDate(dateSource),
      kind: 'extra',
      group: direction === 'in' ? 'Extras (In)' : 'Extras (Out)',
      source: 'extras',
      sourceTab: '#eingaben',
    }, { auto: row.autoPaid === true, autoEligible: row.autoPaid === true }));
  });

  // Outflows (fixe Kosten)
  (Array.isArray(s.outgoings) ? s.outgoings : []).forEach(row => {
    const m = row.month; if (!bucket[m]) return;
    const amt = parseEuro(row.amountEur);
    const date = row.date ? new Date(row.date) : monthEndFromKey(m);
    pushEntry(m, baseEntry({
      id: `fix-${row.id || row.label || m}`,
      direction: 'out',
      amount: Math.abs(amt),
      label: row.label || 'Kosten',
      month: m,
      date: isoDate(date),
      kind: 'outgoing',
      group: 'Fixkosten',
      source: 'outgoings',
      sourceTab: '#eingaben',
    }, { auto: row.autoPaid !== false, autoEligible: row.autoPaid !== false }));
  });

  (Array.isArray(s.dividends) ? s.dividends : []).forEach(row => {
    const month = row.month || (row.date ? toMonthKey(row.date) : null);
    if (!month || !bucket[month]) return;
    const amt = parseEuro(row.amountEur);
    const date = row.date ? new Date(row.date) : monthEndFromKey(month);
    pushEntry(month, baseEntry({
      id: `div-${row.id || row.label || month}`,
      direction: amt >= 0 ? 'out' : 'in',
      amount: Math.abs(amt),
      label: row.label || 'Dividende',
      month,
      date: isoDate(date),
      kind: 'dividend',
      group: 'Dividende & KapESt',
      source: 'dividends',
      sourceTab: '#eingaben',
    }, { auto: false }));
  });

  const settingsNorm = normaliseSettings(s.settings);

  // PO-Events (Milestones & Importkosten)
  (Array.isArray(s.pos) ? s.pos : []).forEach(po => {
    expandOrderEvents(po, settingsNorm, 'PO', 'poNo').forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      const kind = ev.type === 'manual' ? 'po' : (ev.type === 'vat_refund' ? 'po-refund' : 'po-import');
      const group =
        kind === 'po'
          ? 'PO/FO-Zahlungen'
          : kind === 'po-refund'
          ? 'Importkosten'
          : 'Importkosten';
      pushEntry(m, baseEntry({
        id: ev.id || `po-${po.id || ''}-${ev.type}-${ev.month}`,
        direction: ev.direction === 'in' ? 'in' : 'out',
        amount: Math.abs(ev.amount || 0),
        label: ev.label,
        month: m,
        date: isoDate(ev.due),
        kind,
        group,
        source: 'po',
        sourceTab: '#po',
        anchor: ev.anchor,
        lagDays: ev.lagDays,
        lagMonths: ev.lagMonths,
        percent: ev.percent,
        sourceNumber: ev.sourceNumber || po.poNo,
        tooltip: ev.tooltip,
      }, { auto: ev.type !== 'manual', autoEligible: ev.type !== 'manual' }));
    });
  });

  // FO-Events (Milestones & Importkosten)
  (Array.isArray(s.fos) ? s.fos : []).forEach(fo => {
    expandOrderEvents(fo, settingsNorm, 'FO', 'foNo').forEach(ev => {
      const m = ev.month; if (!bucket[m]) return;
      const kind = ev.type === 'manual' ? 'fo' : (ev.type === 'vat_refund' ? 'fo-refund' : 'fo-import');
      const group =
        kind === 'fo'
          ? 'PO/FO-Zahlungen'
          : kind === 'fo-refund'
          ? 'Importkosten'
          : 'Importkosten';
      pushEntry(m, baseEntry({
        id: ev.id || `fo-${fo.id || ''}-${ev.type}-${ev.month}`,
        direction: ev.direction === 'in' ? 'in' : 'out',
        amount: Math.abs(ev.amount || 0),
        label: ev.label,
        month: m,
        date: isoDate(ev.due),
        kind,
        group,
        source: 'fo',
        sourceTab: '#fo',
        anchor: ev.anchor,
        lagDays: ev.lagDays,
        lagMonths: ev.lagMonths,
        percent: ev.percent,
        sourceNumber: ev.sourceNumber || fo.foNo,
        tooltip: ev.tooltip,
      }, { auto: ev.type !== 'manual', autoEligible: ev.type !== 'manual' }));
    });
  });

  const series = months.map(m => {
    const b = bucket[m];
    const entries = b.entries || [];
    const inflowEntries = entries.filter(e => e.direction === 'in');
    const outflowEntries = entries.filter(e => e.direction === 'out');
    const inflow = inflowEntries.reduce((sum, item) => sum + (item.amount || 0), 0);
    const outflow = outflowEntries.reduce((sum, item) => sum + (item.amount || 0), 0);
    const inflowPaid = inflowEntries
      .filter(item => item.paid)
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    const outflowPaid = outflowEntries
      .filter(item => item.paid)
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    const inflowOpen = Math.max(0, inflow - inflowPaid);
    const outflowOpen = Math.max(0, outflow - outflowPaid);
    const netTotal = inflow - outflow;
    const netPaid = inflowPaid - outflowPaid;
    const netOpen = netTotal - netPaid;
    return {
      month: m,
      inflow: { total: inflow, paid: inflowPaid, open: inflowOpen },
      outflow: { total: outflow, paid: outflowPaid, open: outflowOpen },
      net: { total: netTotal, paid: netPaid, open: netOpen },
      itemsIn: inflowEntries.map(item => ({ kind: item.kind, label: item.label, amount: item.amount })),
      itemsOut: outflowEntries.map(item => ({ kind: item.kind, label: item.label, amount: item.amount })),
      entries,
    };
  });

  // KPIs
  const opening = parseEuro(s.settings && s.settings.openingBalance);
  const firstNeg = months.find(m => {
    const idx = months.indexOf(m);
    let bal = opening;
    for (let i = 0; i <= idx; i++) bal += series[i].net.total;
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

  let running = opening;
  const breakdown = months.map((m, idx) => {
    const row = series[idx];
    const openingBalance = running;
    running += row.net.total;
    return {
      month: m,
      opening: openingBalance,
      closing: running,
      inflow: row.inflow.total,
      outflow: row.outflow.total,
      net: row.net.total,
      entries: row.entries,
    };
  });

  return { startMonth, horizon, months, series, kpis, breakdown };
}

// ---------- State ----------
export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}

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

function parseISODate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function monthEndFromKey(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0);
}
function getCnyWindow(settings, year) {
  const direct = settings?.cny;
  if (direct?.start && direct?.end) {
    const start = parseISODate(direct.start);
    const end = parseISODate(direct.end);
    if (start && end && end >= start) return { start, end };
  }
  const entry = settings?.cnyBlackoutByYear?.[String(year)];
  if (!entry) return null;
  const start = parseISODate(entry.start);
  const end = parseISODate(entry.end);
  if (!start || !end) return null;
  if (end < start) return null;
  return { start, end };
}

function applyCnyBlackout(orderDate, prodDays, settings) {
  if (!(orderDate instanceof Date) || Number.isNaN(orderDate.getTime())) {
    return { prodDone: orderDate, adjustmentDays: 0 };
  }
  const baseDays = Math.max(0, Number(prodDays || 0));
  const prodEnd = addDays(orderDate, baseDays);
  if (!settings || baseDays === 0) {
    return { prodDone: prodEnd, adjustmentDays: 0 };
  }
  let adjustmentDays = 0;
  const startYear = orderDate.getUTCFullYear();
  const endYear = prodEnd.getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    const window = getCnyWindow(settings, year);
    if (!window) continue;
    const overlapStart = window.start > orderDate ? window.start : orderDate;
    const overlapEnd = window.end < prodEnd ? window.end : prodEnd;
    if (overlapEnd < overlapStart) continue;
    const overlap = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    adjustmentDays += Math.max(0, overlap);
  }
  const prodDone = adjustmentDays ? addDays(prodEnd, adjustmentDays) : prodEnd;
  return { prodDone, adjustmentDays };
}

function anchorsFor(row, settings) {
  const od = parseISODate(row.orderDate) || new Date();
  const prodDays = Number(row.productionLeadTimeDays ?? row.prodDays ?? 0);
  const transitDays = Number(row.logisticsLeadTimeDays ?? row.transitDays ?? 0);
  const cnyAdjusted = applyCnyBlackout(od, prodDays, settings);
  const prodDone = cnyAdjusted.prodDone ?? addDays(od, prodDays);
  const etdComputed = prodDone;
  const etaComputed = addDays(etdComputed, transitDays);
  const etdManual = parseISODate(row.etdManual);
  const etaManual = parseISODate(row.etaManual);
  const etd = etdManual || etdComputed; // einfache Konvention
  const eta = etaManual || etaComputed;
  return {
    ORDER_DATE: od,
    PROD_DONE: prodDone,
    PRODUCTION_END: prodDone,
    ETD: etd,
    ETA: eta,
  };
}
function addMonthsDate(date, months) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function monthEndDate(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return null;
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

function computeGoodsTotals(row, settings) {
  const items = Array.isArray(row?.items) ? row.items : [];
  let totalUsd = 0;
  let totalUnits = 0;
  if (items.length) {
    items.forEach(item => {
      const units = parseEuro(item?.units ?? 0);
      const unitCostUsd = parseEuro(item?.unitCostUsd ?? 0);
      const unitExtraUsd = parseEuro(item?.unitExtraUsd ?? 0);
      const extraFlatUsd = parseEuro(item?.extraFlatUsd ?? 0);
      const rawUsd = (unitCostUsd + unitExtraUsd) * units + extraFlatUsd;
      const subtotal = Math.max(0, Math.round(rawUsd * 100) / 100);
      if (Number.isFinite(subtotal)) totalUsd += subtotal;
      if (Number.isFinite(units)) totalUnits += units;
    });
  } else {
    const units = parseEuro(row?.units ?? 0);
    const unitCostUsd = parseEuro(row?.unitCostUsd ?? 0);
    const unitExtraUsd = parseEuro(row?.unitExtraUsd ?? 0);
    const extraFlatUsd = parseEuro(row?.extraFlatUsd ?? 0);
    const rawUsd = (unitCostUsd + unitExtraUsd) * units + extraFlatUsd;
    totalUsd = Math.max(0, Math.round(rawUsd * 100) / 100);
    if (Number.isFinite(units)) totalUnits = units;
  }
  const override = parseEuro(row?.fxOverride ?? 0);
  const fxRate = (Number.isFinite(override) && override > 0)
    ? override
    : (parseEuro(settings?.fxRate ?? 0) || 0);
  const derivedEur = fxRate > 0 ? Math.round((totalUsd / fxRate) * 100) / 100 : 0;
  const fallbackEur = parseEuro(row?.goodsEur ?? 0);
  return {
    usd: totalUsd,
    eur: derivedEur > 0 ? derivedEur : fallbackEur,
    units: totalUnits,
  };
}

function computeFreightTotal(row, totals) {
  const mode = row?.freightMode === 'per_unit' ? 'per_unit' : 'total';
  if (mode === 'per_unit') {
    const perUnit = parseEuro(row?.freightPerUnitEur ?? 0);
    const units = Number(totals?.units ?? 0) || 0;
    const total = perUnit * units;
    return Math.round(total * 100) / 100;
  }
  return parseEuro(row?.freightEur ?? 0);
}

export function computeOutflowStack(entries = []) {
  const stack = {
    fixedCosts: 0,
    poPaid: 0,
    poOpen: 0,
    otherExpenses: 0,
    foPlanned: 0,
    total: 0,
  };
  for (const entry of entries || []) {
    if (!entry || entry.direction !== 'out') continue;
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (entry.group === 'Fixkosten') {
      stack.fixedCosts += amount;
      continue;
    }
    if (entry.source === 'po' && entry.kind === 'po') {
      if (entry.paid) stack.poPaid += amount;
      else stack.poOpen += amount;
      continue;
    }
    if (entry.source === 'fo' && entry.kind === 'fo') {
      stack.foPlanned += amount;
      continue;
    }
    stack.otherExpenses += amount;
  }
  stack.total =
    stack.fixedCosts
    + stack.poPaid
    + stack.poOpen
    + stack.otherExpenses
    + stack.foPlanned;
  return stack;
}

function clampDay(year, monthIndexValue, day) {
  const max = new Date(year, monthIndexValue + 1, 0).getDate();
  const safeDay = Math.min(Math.max(1, day), max);
  return new Date(year, monthIndexValue, safeDay);
}

function dueDateFromAnchor(monthKey, anchor) {
  const idx = monthIndex(monthKey);
  if (idx == null) return null;
  const year = Math.floor(idx / 12);
  const monthZero = idx % 12;
  if (!anchor || anchor === 'LAST' || anchor === 'Letzter Tag' || anchor === 'EOM') {
    return new Date(year, monthZero + 1, 0);
  }
  const numeric = Number(anchor);
  if (Number.isFinite(numeric)) {
    return clampDay(year, monthZero, numeric);
  }
  return new Date(year, monthZero + 1, 0);
}

// Daily proration multiplies the share of active days in the start and end
// months. When a contract begins or ends within the target month we scale the
// base amount by the remaining/elapsed days, keeping mid-term months at 100 %.
function applyProrationDaily(baseAmount, master, monthKey, dueDate) {
  if (!master || !master.proration || master.proration.enabled !== true) {
    return { amount: baseAmount, applied: false };
  }
  if (master.proration.method !== 'daily') {
    return { amount: baseAmount, applied: false };
  }
  const idx = monthIndex(monthKey);
  if (idx == null) return { amount: baseAmount, applied: false };
  const year = Math.floor(idx / 12);
  const monthZero = idx % 12;
  const totalDays = new Date(year, monthZero + 1, 0).getDate();
  const due = (dueDate instanceof Date && !Number.isNaN(dueDate.getTime())) ? dueDate : dueDateFromAnchor(monthKey, master.anchor);
  const dueDay = due instanceof Date ? due.getDate() : totalDays;
  let ratio = 1;
  if (master.startMonth && master.startMonth === monthKey) {
    ratio *= Math.max(0, totalDays - dueDay + 1) / totalDays;
  }
  if (master.endMonth && master.endMonth === monthKey) {
    ratio *= Math.max(0, dueDay) / totalDays;
  }
  const amount = Math.round((baseAmount * ratio) * 100) / 100;
  if (!Number.isFinite(amount) || amount === baseAmount) {
    return { amount: baseAmount, applied: false };
  }
  return { amount, applied: true };
}

function evaluatePaidState({ statusRecord, autoEligible, autoManualCheck, entryTime, todayTime, defaultPaid }) {
  const manual = typeof statusRecord?.manual === 'boolean' ? statusRecord.manual : undefined;
  let paid = false;
  let autoApplied = false;
  if (typeof manual === 'boolean') {
    paid = manual;
  } else if (autoEligible && !autoManualCheck && entryTime != null && entryTime <= todayTime) {
    paid = true;
    autoApplied = true;
  } else {
    paid = Boolean(defaultPaid);
  }
  const autoSuppressed = autoEligible && autoManualCheck && !autoApplied;
  let autoTooltip = null;
  if (autoEligible) {
    if (autoApplied) autoTooltip = 'Automatisch bezahlt am Fälligkeitstag';
    else if (autoManualCheck) autoTooltip = 'Automatische Zahlung – manuelle Prüfung aktiv';
    else autoTooltip = 'Automatische Zahlung';
  }
  return {
    paid,
    autoApplied,
    manualOverride: typeof manual === 'boolean',
    autoSuppressed,
    autoTooltip,
  };
}

export function expandFixcostInstances(state, opts = {}) {
  const s = state || {};
  const startMonth = opts.startMonth || (s.settings && s.settings.startMonth) || '2025-01';
  const horizon = Number(opts.horizon || (s.settings && s.settings.horizonMonths) || 12);
  const months = Array.isArray(opts.months) && opts.months.length ? opts.months : monthRange(startMonth, horizon);
  const fixcosts = Array.isArray(s.fixcosts) ? s.fixcosts : [];
  const overridesRaw = (s.fixcostOverrides && typeof s.fixcostOverrides === 'object') ? s.fixcostOverrides : {};
  const statusState = (opts.status && typeof opts.status === 'object') ? opts.status : (s.status || {});
  const statusEvents = (opts.statusEvents && typeof opts.statusEvents === 'object') ? opts.statusEvents : (statusState.events || {});
  const autoManualCheck = opts.autoManualCheck != null ? opts.autoManualCheck === true : statusState.autoManualCheck === true;
  const today = opts.today ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();
  const results = [];

  const monthSet = new Set(months);

  fixcosts.forEach((master, idx) => {
    if (!master) return;
    const fcId = master.id || `fix-${idx}`;
    const start = master.startMonth || startMonth;
    const startIdx = monthIndex(start);
    if (startIdx == null) return;
    const end = master.endMonth || null;
    const endIdx = end ? monthIndex(end) : null;
    const freq = (master.frequency || 'monthly').toLowerCase();
    let interval = 1;
    if (freq === 'quarterly') interval = 3;
    else if (freq === 'semiannual' || freq === 'halbjährlich') interval = 6;
    else if (freq === 'annual' || freq === 'jährlich' || freq === 'yearly') interval = 12;
    else if (freq === 'custom' || freq === 'benutzerdefiniert') {
      interval = Number(master.intervalMonths || master.everyMonths || 1) || 1;
    }
    if (interval < 1) interval = 1;

    const anchorRaw = master.anchor;
    const anchor = (!anchorRaw || anchorRaw === 'Letzter Tag') ? 'LAST' : String(anchorRaw);
    const overrideMap = (overridesRaw[fcId] && typeof overridesRaw[fcId] === 'object') ? overridesRaw[fcId] : {};
    const name = master.name || 'Fixkosten';
    const category = master.category || 'Sonstiges';
    const baseAmount = Math.abs(parseEuro(master.amount));
    const notes = master.notes || '';
    const autoPaid = master.autoPaid === true;

    months.forEach(monthKey => {
      if (!monthSet.has(monthKey)) return;
      const currentIdx = monthIndex(monthKey);
      if (currentIdx == null) return;
      if (currentIdx < startIdx) return;
      if (endIdx != null && currentIdx > endIdx) return;
      const diff = currentIdx - startIdx;
      if (diff % interval !== 0) return;

      const baseDue = dueDateFromAnchor(monthKey, anchor);
      const override = (overrideMap[monthKey] && typeof overrideMap[monthKey] === 'object') ? overrideMap[monthKey] : {};
      let due = baseDue;
      if (override.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(override.dueDate)) {
        const od = new Date(override.dueDate);
        if (!Number.isNaN(od.getTime())) {
          due = od;
        }
      }

      let amount = baseAmount;
      let overrideApplied = false;
      if (override.amount != null && String(override.amount).trim() !== '') {
        amount = Math.abs(parseEuro(override.amount));
        overrideApplied = true;
      }

      let prorationApplied = false;
      if (!overrideApplied) {
        const proration = applyProrationDaily(baseAmount, master, monthKey, due);
        amount = proration.amount;
        prorationApplied = proration.applied;
      }

      const eventId = `fix-${fcId}-${monthKey}`;
      const dueTime = due instanceof Date && !Number.isNaN(due.getTime()) ? due.getTime() : null;
      const statusRecord = statusEvents[eventId];
      const paidMeta = evaluatePaidState({
        statusRecord,
        autoEligible: autoPaid,
        autoManualCheck,
        entryTime: dueTime,
        todayTime,
        defaultPaid: false,
      });

      const dueIso = due instanceof Date && !Number.isNaN(due.getTime()) ? isoDate(due) : null;
      const overrideNote = override.note || '';
      const tooltipParts = [name];
      if (overrideApplied) tooltipParts.push('Override aktiv');
      if (prorationApplied) tooltipParts.push('Proratiert');
      const tooltip = tooltipParts.length > 1 ? tooltipParts.join(' · ') : null;

      results.push({
        id: eventId,
        month: monthKey,
        amount,
        baseAmount,
        label: name,
        category,
        dueDate: due,
        dueDateIso: dueIso,
        fixedCostId: fcId,
        autoPaid,
        notes,
        override: {
          amount: override.amount || '',
          dueDate: override.dueDate || '',
          note: overrideNote,
        },
        overrideActive: overrideApplied || Boolean(override.dueDate) || Boolean(overrideNote),
        prorationApplied,
        paid: paidMeta.paid,
        autoApplied: paidMeta.autoApplied,
        manualOverride: paidMeta.manualOverride,
        autoTooltip: paidMeta.autoTooltip,
        autoSuppressed: paidMeta.autoSuppressed,
        anchor,
        frequency: freq,
        tooltip,
      });
    });
  });

  results.sort((a, b) => {
    if (a.month === b.month) {
      const at = a.dueDate instanceof Date ? a.dueDate.getTime() : 0;
      const bt = b.dueDate instanceof Date ? b.dueDate.getTime() : 0;
      return at - bt;
    }
    return monthIndex(a.month) - monthIndex(b.month);
  });

  return results;
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
  const order = ['freight', 'duty', 'eust', 'vat_refund', 'fx_fee'];
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

  ensure('freight', {
    label: 'Fracht',
    anchor: 'ETA',
    lagDays: settings.freightLagDays,
    enabled: true,
  });

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
      if (evt.type === 'freight' || evt.type === 'duty' || evt.type === 'eust' || evt.type === 'vat_refund') {
        evt.enabled = false;
      }
    }
  }

  return clones;
}

function expandOrderEvents(row, settings, entityLabel, numberField) {
  if (!row) return [];
  const prefixBase = entityLabel || 'PO';
  const ref = row[numberField];
  const prefix = ref ? `${prefixBase} ${ref}` : prefixBase;
  if (Array.isArray(row.payments) && row.payments.length) {
    const anchors = anchorsFor(row, settings);
    return row.payments
      .filter(Boolean)
      .map((payment, idx) => {
        const trigger = payment.triggerEvent || 'ORDER_DATE';
        const anchorKey = trigger === 'PROD_DONE' ? 'PROD_DONE' : trigger;
        const baseDate = anchors[anchorKey] || anchors.ORDER_DATE;
        const due = payment.dueDate ? new Date(payment.dueDate) : addDays(baseDate, Number(payment.offsetDays || 0));
        const amountRaw = Number(payment.amount || 0);
        const direction = amountRaw >= 0 ? 'out' : 'in';
        const amount = Math.abs(amountRaw);
        return {
          label: `${prefix}${payment.label ? ` – ${payment.label}` : ''}`,
          amount,
          due,
          month: toMonthKey(due),
          direction,
          type: 'manual',
          anchor: anchorKey,
          lagDays: Number(payment.offsetDays || 0) || 0,
          percent: Number(payment.percent || 0),
          sourceType: prefixBase,
          sourceNumber: ref,
          sourceId: row.id,
          id: payment.id || `${row.id || prefixBase}-pay-${idx}`,
          tooltip: `Fälligkeit: ${anchorKey} + ${Number(payment.offsetDays || 0)} Tage`,
        };
      });
  }
  const totals = computeGoodsTotals(row, settings);
  const goods = totals.eur;
  const freight = computeFreightTotal(row, totals);
  const anchors = anchorsFor(row, settings);
  const manual = Array.isArray(row.milestones) ? row.milestones : [];
  const autoEvents = normaliseAutoEvents(row, settings, manual);
  const events = [];

  for (const [idx, ms] of manual.entries()) {
    const pct = parsePct(ms.percent);
    const baseDate = anchors[ms.anchor || 'ORDER_DATE'] || anchors.ORDER_DATE;
    const due = addDays(baseDate, Number(ms.lagDays || 0));
    const manualId = ms.id || `${row.id || prefixBase}-${idx}-${ms.id || 'manual'}`;
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
      id: manualId,
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

    if (auto.type === 'freight') {
      const amount = computeFreightTotal(row, totals);
      if (!amount) continue;
      const freightId = auto.id || `${row.id || prefixBase}-auto-freight`;
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      events.push({
        label: `${prefix} – ${auto.label || 'Fracht'}`,
        amount,
        due,
        month: toMonthKey(due),
        direction: 'out',
        type: 'freight',
        anchor: auto.anchor || 'ETA',
        lagDays: Number(auto.lagDays || 0) || 0,
        sourceType: prefixBase,
        sourceNumber: ref,
        sourceId: row.id,
        id: freightId,
        tooltip: 'Frachtkosten laut Eingabe',
      });
      continue;
    }

    if (auto.type === 'duty') {
      const percent = parsePct(auto.percent ?? dutyRate);
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      const baseValue = goods + (dutyIncludeFreight ? freight : 0);
      const amount = baseValue * (percent / 100);
      const dutyId = auto.id || `${row.id || prefixBase}-auto-duty`;
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
        id: dutyId,
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
      const eustId = auto.id || `${row.id || prefixBase}-auto-eust`;
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
        id: eustId,
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
      const vatId = auto.id || `${row.id || prefixBase}-auto-vat`;
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
        id: vatId,
        tooltip: `Erstattung am Monatsende nach ${months} Monaten`,
      });
      continue;
    }

    if (auto.type === 'fx_fee') {
      const percent = parsePct(auto.percent ?? fxFeePct);
      if (!percent) continue;
      const due = addDays(baseDate, Number(auto.lagDays || 0));
      const amount = goods * (percent / 100);
      const fxId = auto.id || `${row.id || prefixBase}-auto-fx`;
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
        id: fxId,
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
    const entryDate = overrides.date ? new Date(overrides.date) : null;
    const entryTime = entryDate && Number.isFinite(entryDate.getTime()) ? new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime() : null;
    const isAuto = meta.auto === true;
    const autoEligible = isAuto && meta.autoEligible !== false;
    const defaultPaid = typeof overrides.paid === 'boolean' ? overrides.paid : Boolean(meta.defaultPaid);
    const paidMeta = evaluatePaidState({
      statusRecord,
      autoEligible,
      autoManualCheck,
      entryTime,
      todayTime,
      defaultPaid,
    });

    return {
      id: baseId,
      direction: overrides.direction || 'in',
      amount: Math.abs(overrides.amount || 0),
      label: overrides.label || '',
      month: overrides.month,
      date: overrides.date,
      kind: overrides.kind,
      group: overrides.group,
      paid: paidMeta.paid,
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
      autoApplied: paidMeta.autoApplied,
      autoManualCheck,
      manualOverride: paidMeta.manualOverride,
      autoSuppressed: paidMeta.autoSuppressed,
      autoTooltip: paidMeta.autoTooltip,
    };
  }

  const fixcostEntries = expandFixcostInstances(s, { months, statusEvents, autoManualCheck, today }).map(inst => ({
    id: inst.id,
    direction: 'out',
    amount: inst.amount,
    label: inst.label,
    month: inst.month,
    date: inst.dueDateIso,
    kind: 'fixcost',
    group: 'Fixkosten',
    source: 'fixcosts',
    sourceTab: '#fixkosten',
    meta: {
      fixedCostId: inst.fixedCostId,
      category: inst.category,
      override: inst.overrideActive,
      overrideAmount: inst.override.amount,
      overrideDueDate: inst.override.dueDate,
      overrideNote: inst.override.note,
      notes: inst.notes,
      baseAmount: inst.baseAmount,
      prorationApplied: inst.prorationApplied,
    },
    tooltip: inst.tooltip,
    auto: inst.autoPaid,
    autoEligible: inst.autoPaid,
  }));

  fixcostEntries.forEach(entry => {
    pushEntry(entry.month, baseEntry(entry, { auto: entry.auto, autoEligible: entry.autoEligible }));
  });

  const forecastEnabled = Boolean(s?.forecast?.settings?.useForecast);
  const forecastMap = {};
  if (forecastEnabled) {
    if (s?.forecast?.forecastImport && typeof s.forecast.forecastImport === "object") {
      Object.values(s.forecast.forecastImport).forEach(monthMap => {
        Object.entries(monthMap || {}).forEach(([month, entry]) => {
          if (!month || !bucket[month]) return;
          const revenue = parseEuro(entry?.revenueEur ?? entry?.revenue ?? null);
          if (!Number.isFinite(revenue)) return;
          forecastMap[month] = (forecastMap[month] || 0) + revenue;
        });
      });
    } else if (Array.isArray(s?.forecast?.items)) {
      s.forecast.items.forEach(item => {
        if (!item || !item.month || !item.sku) return;
        const month = item.month;
        if (!bucket[month]) return;
        const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
        const price = parseEuro(item.priceEur ?? item.price ?? 0);
        const revenue = qty * price;
        forecastMap[month] = (forecastMap[month] || 0) + revenue;
      });
    }
  }

  const payoutPctMap = {};
  (Array.isArray(s.incomings) ? s.incomings : []).forEach(row => {
    if (!row || !row.month) return;
    payoutPctMap[row.month] = row.payoutPct;
  });

  const manualRevenue = {};
  (Array.isArray(s.incomings) ? s.incomings : []).forEach(row => {
    if (!row || !row.month) return;
    manualRevenue[row.month] = parseEuro(row.revenueEur);
  });

  Object.keys(bucket).forEach(m => {
    const revenue = forecastEnabled ? (forecastMap[m] || 0) : manualRevenue[m];
    if (typeof revenue === 'undefined') return;
    const payoutPct = parsePct(payoutPctMap[m] || 0);
    const amt = revenue * (payoutPct / 100);
    const date = monthEndFromKey(m);
    pushEntry(m, baseEntry({
      id: `sales-${m}`,
      direction: amt >= 0 ? 'in' : 'out',
      amount: Math.abs(amt),
      label: forecastEnabled ? 'Amazon Payout (Prognose)' : 'Amazon Payout',
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
    if (String(fo?.status || "").toUpperCase() === "CONVERTED") return;
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
    const fixcostEntries = outflowEntries.filter(e => e.group === 'Fixkosten');
    const fixcostTotal = fixcostEntries.reduce((sum, item) => sum + (item.amount || 0), 0);
    const fixcostPaid = fixcostEntries
      .filter(item => item.paid)
      .reduce((sum, item) => sum + (item.amount || 0), 0);
    const fixcostOpen = Math.max(0, fixcostTotal - fixcostPaid);
    const fixcostTop = fixcostEntries
      .slice()
      .sort((a, b) => (b.amount || 0) - (a.amount || 0))
      .slice(0, 3)
      .map(item => ({
        label: item.label,
        amount: item.amount,
        paid: item.paid,
        category: item.meta && item.meta.category ? item.meta.category : null,
      }));
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
      fixcost: { total: fixcostTotal, paid: fixcostPaid, open: fixcostOpen, top: fixcostTop },
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

  const plannedRevenueByMonth = {};
  const plannedPayoutByMonth = {};
  Object.keys(bucket).forEach(m => {
    const revenue = forecastEnabled ? (forecastMap[m] || 0) : manualRevenue[m];
    const payoutPct = parsePct(payoutPctMap[m] || 0);
    plannedRevenueByMonth[m] = revenue;
    plannedPayoutByMonth[m] = revenue * (payoutPct / 100);
  });

  const kpis = {
    opening,
    openingToday: opening,
    salesPayoutAvg: avgSalesPayout,
    avgSalesPayout,
    firstNegativeMonth: firstNeg,
    actuals: {},
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

  const actualMap = new Map();
  const monthlyActuals = s?.monthlyActuals && typeof s.monthlyActuals === "object" ? s.monthlyActuals : {};
  const monthlyActualsEntries = Object.entries(monthlyActuals);
  if (monthlyActualsEntries.length) {
    monthlyActualsEntries.forEach(([month, entry]) => {
      if (!month) return;
      const revenue = Number(entry?.realRevenueEUR);
      const payoutRate = Number(entry?.realPayoutRatePct);
      const closing = Number(entry?.realClosingBalanceEUR);
      const actual = {};
      if (Number.isFinite(revenue)) actual.revenue = revenue;
      if (Number.isFinite(revenue) && Number.isFinite(payoutRate)) {
        actual.payout = revenue * (payoutRate / 100);
      }
      if (Number.isFinite(closing)) actual.closing = closing;
      if (Object.keys(actual).length) actualMap.set(month, actual);
    });
  } else {
    const actuals = Array.isArray(s.actuals) ? s.actuals : [];
    actuals.forEach(entry => {
      if (!entry || !entry.month) return;
      const month = entry.month;
      actualMap.set(month, {
        revenue: parseEuro(entry.revenueEur),
        payout: parseEuro(entry.payoutEur),
        closing: parseEuro(entry.closingBalanceEur),
      });
    });
  }

  const actualComparisons = [];
  actualMap.forEach((values, month) => {
    const idx = months.indexOf(month);
    if (idx === -1) return;
    const plannedBreakdown = idx >= 0 && idx < breakdown.length ? breakdown[idx] : null;
    const plannedClosingBalance = plannedBreakdown ? plannedBreakdown.closing : null;
    const plannedRevenue = plannedRevenueByMonth[month] ?? null;
    const plannedPayout = plannedPayoutByMonth[month] ?? null;
    actualComparisons.push({
      month,
      plannedRevenue,
      actualRevenue: values.revenue,
      revenueDelta: (values.revenue ?? 0) - (plannedRevenue ?? 0),
      revenueDeltaPct: plannedRevenue ? (((values.revenue ?? 0) - plannedRevenue) / plannedRevenue) * 100 : null,
      plannedPayout,
      actualPayout: values.payout,
      payoutDelta: (values.payout ?? 0) - (plannedPayout ?? 0),
      payoutDeltaPct: plannedPayout ? (((values.payout ?? 0) - plannedPayout) / plannedPayout) * 100 : null,
      plannedClosing: plannedClosingBalance,
      actualClosing: values.closing,
      closingDelta: (values.closing ?? 0) - (plannedClosingBalance ?? 0),
    });
  });
  actualComparisons.sort((a, b) => (a.month || '').localeCompare(b.month || ''));

  const lastActual = actualComparisons[actualComparisons.length - 1] || null;
  const revenueDeltaList = actualComparisons
    .map(entry => entry.revenueDeltaPct)
    .filter(v => Number.isFinite(v));
  const payoutDeltaList = actualComparisons
    .map(entry => entry.payoutDeltaPct)
    .filter(v => Number.isFinite(v));
  const avgRevenueDeltaPct = revenueDeltaList.length
    ? revenueDeltaList.reduce((a, b) => a + b, 0) / revenueDeltaList.length
    : null;
  const avgPayoutDeltaPct = payoutDeltaList.length
    ? payoutDeltaList.reduce((a, b) => a + b, 0) / payoutDeltaList.length
    : null;

  kpis.actuals = {
    count: actualComparisons.length,
    lastMonth: lastActual ? lastActual.month : null,
    lastClosing: lastActual ? lastActual.actualClosing : null,
    closingDelta: lastActual ? lastActual.closingDelta : null,
    revenueDeltaPct: lastActual ? lastActual.revenueDeltaPct : null,
    payoutDeltaPct: lastActual ? lastActual.payoutDeltaPct : null,
    avgRevenueDeltaPct,
    avgPayoutDeltaPct,
  };

  return { startMonth, horizon, months, series, kpis, breakdown, actualComparisons };
}

// ---------- State ----------
export function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}

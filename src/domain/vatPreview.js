import { computeSeries, expandFixcostInstances, parseEuro } from "./cashflow.js";

const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return monthLong.format(d);
}

function addMonths(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(start, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(addMonths(start, i));
  return out;
}

function toRate(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function toRateFraction(value, fallback = 0) {
  const raw = toRate(value, fallback);
  if (!Number.isFinite(raw)) return fallback;
  return raw > 1 ? raw / 100 : raw;
}

function getMonthConfig(month, state) {
  const cfg = state?.settings?.vatPreview || {};
  const monthCfg = state?.vatPreviewMonths?.[month] || {};
  return {
    deShare: toRate(monthCfg.deShare, cfg.deShareDefault ?? 0.8),
    feeRateOfGross: toRate(monthCfg.feeRateOfGross, cfg.feeRateDefault ?? 0.38),
    fixInputVatOverride: monthCfg.fixInputVatOverride,
    fixInputVat: parseEuro(monthCfg.fixInputVat ?? cfg.fixInputDefault ?? 0),
  };
}

function computeFixVatCredits(state, months) {
  const cfg = state?.settings?.vatPreview || {};
  const lag = Number(cfg.fixVatLagMonths ?? 0) || 0;
  const startMonth = state?.settings?.startMonth || months?.[0] || "2025-01";
  const horizon = Number(state?.settings?.horizonMonths || months?.length || 12);
  const extended = monthRange(startMonth, horizon + Math.max(lag, 0) + 2);
  const inst = expandFixcostInstances(state, { months: extended });
  const map = {};
  const drivers = {};
  inst.forEach(entry => {
    const rate = toRateFraction(entry.vatRate ?? 0, 0);
    const amount = Number(entry.amount) || 0;
    let fixVat = entry.isGross ? amount * (rate / (1 + rate)) : amount * rate;
    fixVat = Math.round(fixVat * 100) / 100;
    const creditMonth = addMonths(entry.month, lag);
    map[creditMonth] = (map[creditMonth] || 0) + fixVat;
    if (!drivers[creditMonth]) drivers[creditMonth] = [];
    drivers[creditMonth].push({
      name: entry.label,
      amount,
      vatRate: rate,
      isGross: entry.isGross,
      fixVat,
    });
  });
  return { map, drivers };
}

function sumRefund(entries) {
  return entries
    .filter(e => e && (e.type === "vat_refund" || (e.label || "").toLowerCase().includes("eust-erstatt")))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function computeVatPreview(state) {
  const series = computeSeries(state || {});
  const months = series.months;
  const { map: fixVatMap, drivers: fixDrivers } = computeFixVatCredits(state, months);

  const rows = months.map((m, idx) => {
    const cfg = getMonthConfig(m, state);
    const revRow = (state?.incomings || []).find(r => r.month === m);
    const grossTotal = parseEuro(revRow?.revenueEur);
    const grossDe = grossTotal * cfg.deShare;
    const outVat = grossDe / 1.19 * 0.19;
    const feeInputVat = (grossTotal * cfg.feeRateOfGross) / 1.19 * 0.19;
    const autoFix = fixVatMap[m] || 0;
    const fixInputVat = cfg.fixInputVatOverride != null ? Number(cfg.fixInputVatOverride) : autoFix;
    const entries = series.breakdown[idx]?.entries || [];
    const eustRefund = sumRefund(entries);
    const payable = outVat - feeInputVat - fixInputVat - eustRefund;

    return {
      month: m,
      monthLabel: monthLabel(m),
      grossTotal,
      grossDe,
      outVat,
      feeInputVat,
      fixInputVat,
      eustRefund,
      payable,
      fixDrivers: fixDrivers[m] || [],
      fixOverride: cfg.fixInputVatOverride != null,
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.grossTotal += row.grossTotal;
    acc.grossDe += row.grossDe;
    acc.outVat += row.outVat;
    acc.feeInputVat += row.feeInputVat;
    acc.fixInputVat += row.fixInputVat;
    acc.eustRefund += row.eustRefund;
    acc.payable += row.payable;
    return acc;
  }, { grossTotal: 0, grossDe: 0, outVat: 0, feeInputVat: 0, fixInputVat: 0, eustRefund: 0, payable: 0 });

  return { months, rows, totals };
}

export default computeVatPreview;

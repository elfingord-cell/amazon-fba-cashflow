import { computeSeries, parseEuro } from "./cashflow.js";

const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return monthLong.format(d);
}

function toRate(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function getMonthConfig(month, state) {
  const cfg = state?.settings?.vatPreview || {};
  const monthCfg = state?.vatPreviewMonths?.[month] || {};
  return {
    deShare: toRate(monthCfg.deShare, cfg.deShareDefault ?? 0.8),
    feeRateOfGross: toRate(monthCfg.feeRateOfGross, cfg.feeRateDefault ?? 0.38),
    fixInputVat: parseEuro(monthCfg.fixInputVat ?? cfg.fixInputDefault ?? 0),
  };
}

function sumRefund(entries) {
  return entries
    .filter(e => e && (e.type === "vat_refund" || (e.label || "").toLowerCase().includes("eust-erstatt")))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

export function computeVatPreview(state) {
  const series = computeSeries(state || {});
  const months = series.months;

  const rows = months.map((m, idx) => {
    const cfg = getMonthConfig(m, state);
    const revRow = (state?.incomings || []).find(r => r.month === m);
    const grossTotal = parseEuro(revRow?.revenueEur);
    const grossDe = grossTotal * cfg.deShare;
    const outVat = grossDe / 1.19 * 0.19;
    const feeInputVat = (grossTotal * cfg.feeRateOfGross) / 1.19 * 0.19;
    const fixInputVat = cfg.fixInputVat || 0;
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

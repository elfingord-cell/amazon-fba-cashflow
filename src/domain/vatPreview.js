import { computeSeries, parseEuro } from "./cashflow.js";

const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return monthLong.format(d);
}

function safeRate(val, delta = 0) {
  const n = Number(String(val ?? 0).replace(",", "."));
  const rate = Number.isFinite(n) ? n : 0;
  return Math.max(0, rate + delta);
}

function normaliseAlpha(alpha) {
  if (!Array.isArray(alpha) || !alpha.length) return [1];
  const nums = alpha.map(n => Number(n) || 0);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!sum) return [1];
  return nums.map(n => n / sum);
}

function clampDelta(prev, next, maxStep = 3) {
  const diff = next - prev;
  const clamped = Math.max(-maxStep, Math.min(maxStep, diff));
  return prev + 0.3 * clamped;
}

export function computeVatPreview(state) {
  const series = computeSeries(state || {});
  const months = series.months;
  const vatConfig = (state?.settings && state.settings.vatPreview) || {};
  const costRules = Array.isArray(state?.vatCostRules) ? state.vatCostRules : [];
  const alpha = normaliseAlpha(vatConfig.timingAlpha || [1]);
  const rcNetting = vatConfig.rcNetting !== false;
  const returnsDelta = Number(vatConfig.returnsDelta || 0);
  const vatRateDelta = Number(vatConfig.vatRateDelta || 0);
  const products = Array.isArray(state?.products) ? state.products.filter(p => p?.status !== "inactive") : [];
  const weights = products.map(prod => ({
    key: prod.sku,
    label: prod.alias || prod.sku,
    weight: Number(prod.stats?.lastQty) || 1,
    vatRate: safeRate(prod.vatRate ?? 19, vatRateDelta),
    returnsRate: safeRate(prod.returnsRate ?? 0, returnsDelta),
    vatExempt: prod.vatExempt === true,
  }));
  const defaultWeight = { key: "default", label: "Umsatz", weight: 1, vatRate: safeRate(19, vatRateDelta), returnsRate: safeRate(0, returnsDelta), vatExempt: false };
  const weightTotal = weights.reduce((sum, w) => sum + (w.weight || 0), 0) || defaultWeight.weight;
  const baselineWeights = weightTotal ? weights : [defaultWeight];

  const outputPerMonth = months.map(() => 0);
  const outputContribs = months.map(() => new Map());
  const prevReturns = new Map();

  months.forEach((m, idx) => {
    const revRow = (state?.incomings || []).find(r => r.month === m);
    const gross = parseEuro(revRow?.revenueEur);
    baselineWeights.forEach(w => {
      const share = gross * ((w.weight || 0) / weightTotal);
      const prev = prevReturns.get(w.key) ?? w.returnsRate;
      const smoothedReturns = clampDelta(prev, w.returnsRate);
      prevReturns.set(w.key, smoothedReturns);
      const ratePct = w.vatExempt ? 0 : w.vatRate;
      const base = ratePct ? share / (1 + ratePct / 100) : 0;
      const returnsBase = ratePct ? (share * (smoothedReturns / 100)) / (1 + ratePct / 100) : 0;
      const vat = ratePct ? base * (ratePct / 100) : 0;
      const returnsVat = ratePct ? returnsBase * (ratePct / 100) : 0;
      const netVat = Math.max(0, vat - returnsVat);
      alpha.forEach((a, offset) => {
        const targetIdx = idx + offset;
        if (months[targetIdx]) {
          outputPerMonth[targetIdx] += netVat * a;
          const bucket = outputContribs[targetIdx];
          bucket.set(w.label, (bucket.get(w.label) || 0) + netVat * a);
        }
      });
    });
  });

  const rows = months.map((m, idx) => {
    const monthEntries = series.breakdown[idx]?.entries || [];
    let inputVat = 0;
    let eustRefund = 0;
    let rcVat = 0;
    let rcInput = 0;
    const inputContrib = new Map();
    const eustContrib = new Map();

    monthEntries.forEach(entry => {
      const amount = Number(entry.amount || 0);
      if (!Number.isFinite(amount) || amount === 0) return;
      const label = (entry.label || "").toLowerCase();
      if (label.includes("eust-erstatt")) {
        eustRefund += amount;
        inputVat -= amount;
        eustContrib.set(entry.label, (eustContrib.get(entry.label) || 0) + amount);
        return;
      }
      if (label.includes("eust")) {
        inputVat += amount;
        eustContrib.set(entry.label, (eustContrib.get(entry.label) || 0) + amount);
        return;
      }
      if (entry.direction !== "out") return;
      const category = (entry.meta?.category || entry.group || "Sonstiges").toLowerCase();
      const rule = costRules.find(r => (r.name || "").toLowerCase() === category || category.includes((r.name || "").toLowerCase()));
      const vatRate = safeRate(rule?.vatRate ?? 0);
      const isGross = rule?.isGrossInput !== false;
      const reverseCharge = rule?.reverseCharge === true;
      const base = Math.abs(amount);
      const vatComponent = vatRate ? (isGross ? base - base / (1 + vatRate / 100) : base * (vatRate / 100)) : 0;
      if (reverseCharge) {
        rcVat += vatComponent;
        if (rcNetting) rcInput += vatComponent;
      } else {
        inputVat += vatComponent;
        const key = rule?.name || entry.label || category;
        inputContrib.set(key, (inputContrib.get(key) || 0) + vatComponent);
      }
    });

    const outputVat = outputPerMonth[idx];
    const payable = outputVat - inputVat + rcVat - rcInput;

    return {
      month: m,
      monthLabel: monthLabel(m),
      outputVat,
      inputVat,
      eustRefund,
      rcVat,
      rcInput,
      payable,
      outputTop: Array.from(outputContribs[idx].entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, value]) => ({ label, value })),
      inputTop: Array.from(inputContrib.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, value]) => ({ label, value })),
      eustTop: Array.from(eustContrib.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, value]) => ({ label, value })),
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.outputVat += row.outputVat;
    acc.inputVat += row.inputVat;
    acc.eustRefund += row.eustRefund;
    acc.rcVat += row.rcVat;
    acc.rcInput += row.rcInput;
    acc.payable += row.payable;
    return acc;
  }, { outputVat: 0, inputVat: 0, eustRefund: 0, rcVat: 0, rcInput: 0, payable: 0 });

  return { months, rows, totals };
}

export default computeVatPreview;

// src/domain/cashflow.js
// Monatsaggregation (Sales×Payout + Extras – Outgoings – PO – FO)
// + Utils als Named Exports: fmtEUR, fmtPct, parseEuro, parsePct
import { buildPlanProductRevenueByMonthAndBucket } from "./planProducts.js";
import {
  buildProductProfileIndex,
  normalizeIncludeInForecast,
  normalizeLaunchCosts,
  normalizePortfolioBucket,
  normalizeSkuKey,
  PORTFOLIO_BUCKET,
  PORTFOLIO_BUCKET_VALUES,
  resolveEffectivePortfolioBucket,
} from "./portfolioBuckets.js";
import {
  CASH_IN_QUOTE_MAX_PCT,
  CASH_IN_QUOTE_MIN_PCT,
  buildCalibrationProfile,
  buildPayoutRecommendation,
  clampPct,
  normalizeRevenueCalibrationMode,
  parsePayoutPctInput,
} from "./cashInRules.js";

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

function readOptionalNumber(value, parser = parseEuro) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = parser(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCashInMode(value) {
  return String(value || '').trim().toLowerCase() === 'conservative' ? 'conservative' : 'basis';
}

function formatTooltipCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0 €';
  return numeric.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatTooltipPercent(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return numeric.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatTooltipFactor(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function normalizeRecommendationMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ist') return 'ist';
  if (normalized === 'manual') return 'manual';
  if (normalized === 'plan' || normalized === 'basis' || normalized === 'conservative') {
    return 'plan';
  }
  return 'plan';
}

function recommendationModeLabel(value) {
  const mode = normalizeRecommendationMode(value);
  if (mode === 'ist') return 'IST';
  if (mode === 'manual') return 'Manuell';
  return 'Empfohlen (Plan)';
}

function seasonalitySourceLabel(tag) {
  const normalized = String(tag || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'ist_month') return 'Ist-Daten (Kalendermonat)';
  if (normalized === 'history_month') return 'Historie (Kalendermonat)';
  if (normalized === 'no_data') return 'Keine Historie';
  if (normalized === 'disabled') return 'Aus';
  return normalized;
}

function buildRecommendationBreakdown(meta = {}) {
  const levelPct = Number(meta.recommendationLevelPct);
  const levelAvg3Pct = Number(meta.recommendationLevelAvg3Pct);
  const levelAvg12Pct = Number(meta.recommendationLevelAvg12Pct);
  const seasonalityPct = Number(meta.recommendationSeasonalityPct);
  const seasonalityMonthMeanPct = Number(meta.recommendationSeasonalityMonthMeanPct);
  const seasonalityOverallMeanPct = Number(meta.recommendationSeasonalityOverallMeanPct);
  const safetyMarginPct = Number(meta.recommendationSafetyMarginPct);
  const riskAdjustmentPct = Number(meta.recommendationRiskAdjustmentPct);
  const monthSamples = Math.max(0, Math.round(Number(meta.recommendationSeasonalitySampleCount || 0)));
  const seasonalitySourceTag = seasonalitySourceLabel(meta.recommendationSeasonalitySourceTag);
  const capsApplied = Array.isArray(meta.recommendationCapsApplied)
    ? meta.recommendationCapsApplied.filter(Boolean)
    : [];
  const parts = [];
  if (Number.isFinite(levelPct) || Number.isFinite(seasonalityPct)) {
    const lText = Number.isFinite(levelPct) ? formatTooltipPercent(levelPct, 1) : '—';
    const sText = Number.isFinite(seasonalityPct) ? formatTooltipPercent(seasonalityPct, 1) : '—';
    parts.push(`L: ${lText}% · S: ${sText}%`);
  }
  if (Number.isFinite(levelAvg3Pct) || Number.isFinite(levelAvg12Pct)) {
    const avg3Text = Number.isFinite(levelAvg3Pct) ? formatTooltipPercent(levelAvg3Pct, 1) : '—';
    const avg12Text = Number.isFinite(levelAvg12Pct) ? formatTooltipPercent(levelAvg12Pct, 1) : '—';
    parts.push(`Level: Ø3M ${avg3Text}% · Ø12M ${avg12Text}%`);
  }
  if (Number.isFinite(safetyMarginPct) || Number.isFinite(riskAdjustmentPct)) {
    const safetyText = Number.isFinite(safetyMarginPct) ? formatTooltipPercent(safetyMarginPct, 1) : '0,0';
    const adjText = Number.isFinite(riskAdjustmentPct) ? formatTooltipPercent(riskAdjustmentPct, 1) : '0,0';
    parts.push(`Sicherheitsmarge: ${safetyText}pp · Gesamtabschlag: ${adjText}pp`);
  }
  if (Number.isFinite(seasonalityMonthMeanPct) || Number.isFinite(seasonalityOverallMeanPct)) {
    const monthText = Number.isFinite(seasonalityMonthMeanPct)
      ? formatTooltipPercent(seasonalityMonthMeanPct, 1)
      : '—';
    const overallText = Number.isFinite(seasonalityOverallMeanPct)
      ? formatTooltipPercent(seasonalityOverallMeanPct, 1)
      : '—';
    parts.push(`Saison: Monat ${monthText}% · Gesamt ${overallText}%`);
  } else if (monthSamples > 0) {
    parts.push(`Saison-Samples: ${monthSamples}`);
  }
  if (seasonalitySourceTag) {
    parts.push(`Saisonquelle: ${seasonalitySourceTag}`);
  }
  if (meta.recommendationLiveSignalUsed === true) {
    const weightText = Number.isFinite(Number(meta.recommendationLiveSignalWeight))
      ? formatTooltipPercent(Number(meta.recommendationLiveSignalWeight) * 100, 0)
      : '0';
    parts.push(`Live-Signal aktiv (${weightText}% Gewicht)`);
  }
  if (capsApplied.length) {
    parts.push('Grenzwert angewendet');
  }
  return parts;
}

function buildCashInTooltip({
  forecastRevenue,
  calibrationFactorApplied,
  planRevenue,
  payoutPct,
  payoutAmount,
  quoteSource,
  recommendationSourceTag,
  recommendationExplanation,
  cashInMeta,
}) {
  const mode = normalizeRecommendationMode(cashInMeta?.mode);
  const quoteSourceLabel = quoteSource === 'manual'
    ? 'Manuell'
    : recommendationModeLabel(mode);
  const recommendationLabel = recommendationSourceTag === 'IST'
    ? 'IST'
    : recommendationSourceTag === 'RECOMMENDED_PLAN'
      ? 'Empfohlen (Plan)'
    : recommendationSourceTag === 'RECOMMENDED_BASIS'
      ? 'Empfohlen (Plan)'
    : recommendationSourceTag === 'RECOMMENDED_CONSERVATIVE'
        ? 'Empfohlen (Plan)'
        : recommendationSourceTag === 'PROGNOSE'
          ? 'Live-Signal'
          : 'Empfehlung';
  const calibrationMode = normalizeRevenueCalibrationMode(cashInMeta?.calibrationMode);
  const calibrationModeLabel = calibrationMode === 'conservative' ? 'Konservativ' : 'Basis';
  const calibrationText = Number.isFinite(calibrationFactorApplied) && Math.abs(Number(calibrationFactorApplied) - 1) > 0.000001
    ? Number(calibrationFactorApplied).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const parts = [
    `Forecast-Umsatz: ${formatTooltipCurrency(forecastRevenue)}`,
    `Kalibrierfaktor K (${calibrationModeLabel}): ${calibrationText || '1,00'}`,
    `Plan-Umsatz: ${formatTooltipCurrency(planRevenue)}`,
    `Quote: ${formatTooltipPercent(payoutPct)}% (${quoteSourceLabel}${quoteSource !== 'manual' ? `, ${recommendationLabel}` : ''})`,
    `Auszahlung: ${formatTooltipCurrency(payoutAmount)}`,
  ];
  if (cashInMeta?.calibrationEnabled !== false) {
    const factorBasis = Number(cashInMeta?.calibrationFactorBasis);
    const factorConservative = Number(cashInMeta?.calibrationFactorConservative);
    if (Number.isFinite(factorBasis) || Number.isFinite(factorConservative)) {
      parts.push(`K_basis: ${formatTooltipFactor(factorBasis, 3)} · K_cons: ${formatTooltipFactor(factorConservative, 3)}`);
    }
    const biasB = Number(cashInMeta?.calibrationBiasB);
    const riskR = Number(cashInMeta?.calibrationRiskR);
    if (Number.isFinite(biasB) || Number.isFinite(riskR)) {
      parts.push(`B: ${formatTooltipFactor(biasB, 3)} · R: ${formatTooltipFactor(riskR, 3)}`);
    }
    const cLive = Number(cashInMeta?.calibrationLiveFactorClamped);
    const wTime = Number(cashInMeta?.calibrationWeightTime);
    const wH = Number(cashInMeta?.calibrationWeightH);
    const wEff = Number(cashInMeta?.calibrationWeightEffective);
    const dayOfMonth = Math.max(1, Math.round(Number(cashInMeta?.calibrationDayOfMonth || 1)));
    parts.push(
      `C_live: ${formatTooltipFactor(cLive, 3)} · W_time: ${formatTooltipFactor(wTime, 3)} · W_h: ${formatTooltipFactor(wH, 3)} · W_eff: ${formatTooltipFactor(wEff, 3)} · d: ${dayOfMonth}`,
    );
    if (cashInMeta?.calibrationLiveAnchorEnabled === true && Number.isFinite(wEff) && wEff > 0) {
      parts.push(`Kalibrierung mit Tagesgewicht aktiv (Tag ${dayOfMonth}, h=${Math.max(0, Math.round(Number(cashInMeta?.calibrationHorizonOffset || 0)))}, Gewicht ${formatTooltipFactor(wEff, 3)}).`);
    } else {
      parts.push("Kein zusätzlicher Tagesfaktor aktiv; Kalibrierung folgt dem gelernten Profil.");
    }
  } else {
    parts.push('Kalibrierung deaktiviert (K = 1,00).');
  }
  if (recommendationExplanation && quoteSource !== 'manual') {
    parts.push(`Warum: ${recommendationExplanation}`);
  }
  const recommendationBreakdown = buildRecommendationBreakdown(cashInMeta);
  if (quoteSource !== 'manual' && recommendationBreakdown.length) {
    parts.push(...recommendationBreakdown);
  }
  return parts.join(' · ');
}

function buildActualMap(state) {
  const s = state || {};
  const actualMap = new Map();
  const monthlyActuals = s?.monthlyActuals && typeof s.monthlyActuals === 'object' ? s.monthlyActuals : {};

  Object.entries(monthlyActuals).forEach(([month, entry]) => {
    if (!month) return;
    const revenue = readOptionalNumber(entry?.realRevenueEUR, parseEuro);
    const payoutEur = readOptionalNumber(entry?.realPayoutEur, parseEuro);
    const payoutRatePct = readOptionalNumber(entry?.realPayoutRatePct, parsePct);
    const closing = readOptionalNumber(entry?.realClosingBalanceEUR, parseEuro);
    const actual = {};
    if (Number.isFinite(revenue)) actual.revenue = revenue;
    if (Number.isFinite(payoutEur)) actual.payout = payoutEur;
    if (Number.isFinite(payoutRatePct)) actual.payoutRatePct = payoutRatePct;
    if (!Number.isFinite(actual.payout) && Number.isFinite(revenue) && Number.isFinite(payoutRatePct)) {
      actual.payout = revenue * (payoutRatePct / 100);
    }
    if (!Number.isFinite(actual.payoutRatePct) && Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(payoutEur)) {
      actual.payoutRatePct = (payoutEur / revenue) * 100;
    }
    if (Number.isFinite(closing)) actual.closing = closing;
    if (Object.keys(actual).length) actualMap.set(month, actual);
  });

  const actuals = Array.isArray(s.actuals) ? s.actuals : [];
  actuals.forEach(entry => {
    if (!entry || !entry.month) return;
    const month = entry.month;
    const revenue = readOptionalNumber(entry.revenueEur, parseEuro);
    const payout = readOptionalNumber(entry.payoutEur, parseEuro);
    const closing = readOptionalNumber(entry.closingBalanceEur, parseEuro);
    const current = actualMap.get(month) || {};
    if (!Number.isFinite(current.revenue) && Number.isFinite(revenue)) current.revenue = revenue;
    if (!Number.isFinite(current.payout) && Number.isFinite(payout)) current.payout = payout;
    if (!Number.isFinite(current.closing) && Number.isFinite(closing)) current.closing = closing;
    if (!Number.isFinite(current.payoutRatePct) && Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(payout)) {
      current.payoutRatePct = (payout / revenue) * 100;
    }
    if (Object.keys(current).length) actualMap.set(month, current);
  });

  return actualMap;
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

function extractOrderItemsForBucketing(row) {
  if (Array.isArray(row?.items) && row.items.length) {
    return row.items
      .map((item) => {
        const sku = String(item?.sku || "").trim();
        if (!sku) return null;
        const unitsRaw = item?.units ?? item?.qty ?? item?.quantity ?? 0;
        const units = Math.max(0, parseEuro(unitsRaw));
        return {
          ...item,
          sku,
          units,
        };
      })
      .filter(Boolean);
  }
  const sku = String(row?.sku || "").trim();
  if (!sku) return [];
  const unitsRaw = row?.units ?? 0;
  const units = Math.max(0, parseEuro(unitsRaw));
  return [{
    sku,
    units,
    unitCostUsd: row?.unitCostUsd,
    unitExtraUsd: row?.unitExtraUsd,
    extraFlatUsd: row?.extraFlatUsd,
    prodDays: row?.prodDays,
    transitDays: row?.transitDays,
    freightEur: row?.freightEur,
  }];
}

function buildOrderBucketSegments(input) {
  const order = input?.order || {};
  const profileBySku = input?.profileBySku instanceof Map ? input.profileBySku : new Map();
  const poSkuSet = input?.poSkuSet instanceof Set ? input.poSkuSet : new Set();
  const fallbackBucket = input?.fallbackBucket || PORTFOLIO_BUCKET.CORE;
  const items = extractOrderItemsForBucketing(order);
  if (!items.length) {
    return [{
      bucket: fallbackBucket,
      share: 1,
      row: {
        ...order,
        payments: Array.isArray(order?.payments)
          ? order.payments.filter(Boolean).map((payment) => ({ ...payment }))
          : order?.payments,
      },
    }];
  }

  const groups = new Map();
  let totalWeight = 0;
  items.forEach((item) => {
    const sku = String(item?.sku || "").trim();
    if (!sku) return;
    const key = normalizeSkuKey(sku);
    const profile = profileBySku.get(key);
    const includeInForecast = profile
      ? profile.includeInForecast
      : normalizeIncludeInForecast(undefined, true);
    if (!includeInForecast) return;
    const bucket = profile
      ? profile.effectivePortfolioBucket
      : resolveEffectivePortfolioBucket({ sku, poSkuSet, fallbackBucket });
    const weightUnits = parseEuro(item?.units ?? 0);
    const weight = Number.isFinite(weightUnits) && weightUnits > 0 ? weightUnits : 1;
    totalWeight += weight;
    if (!groups.has(bucket)) {
      groups.set(bucket, { bucket, items: [], weight: 0 });
    }
    const target = groups.get(bucket);
    target.items.push(item);
    target.weight += weight;
  });

  if (!groups.size) return [];

  return Array.from(groups.values()).map((group, index, all) => {
    const share = totalWeight > 0
      ? (group.weight / totalWeight)
      : (all.length ? (1 / all.length) : 1);
    const scaledPayments = Array.isArray(order?.payments)
      ? order.payments
        .filter(Boolean)
        .map((payment) => {
          const amount = Number(payment?.amount);
          if (!Number.isFinite(amount)) return { ...payment };
          return {
            ...payment,
            amount: Math.round((amount * share) * 100) / 100,
          };
        })
      : undefined;
    const freightMode = order?.freightMode === 'per_unit' ? 'per_unit' : 'total';
    const freightTotal = parseEuro(order?.freightEur ?? 0);
    const rowClone = {
      ...order,
      items: group.items.map((item) => ({ ...item })),
      payments: scaledPayments,
      freightMode,
      freightEur: freightMode === 'total'
        ? Math.round((freightTotal * share) * 100) / 100
        : order?.freightEur,
    };
    return {
      bucket: group.bucket,
      share,
      row: rowClone,
    };
  });
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

function normalizeFoStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'DRAFT';
  if (raw === 'PLANNED') return 'ACTIVE';
  if (raw === 'CANCELLED') return 'ARCHIVED';
  return raw;
}

function isActiveFoStatus(value) {
  const status = normalizeFoStatus(value);
  return status === 'DRAFT' || status === 'ACTIVE';
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

  const { map: productProfileBySku, poSkuSet } = buildProductProfileIndex(s);

  function profileForSku(sku) {
    const key = normalizeSkuKey(sku);
    if (!key) {
      return {
        includeInForecast: true,
        effectivePortfolioBucket: PORTFOLIO_BUCKET.CORE,
      };
    }
    return productProfileBySku.get(key) || {
      includeInForecast: true,
      effectivePortfolioBucket: resolveEffectivePortfolioBucket({
        sku,
        poSkuSet,
        fallbackBucket: PORTFOLIO_BUCKET.CORE,
      }),
    };
  }

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

    const entryMeta = {
      ...((overrides.meta && typeof overrides.meta === 'object') ? overrides.meta : {}),
    };
    const portfolioBucket = overrides.portfolioBucket
      ? normalizePortfolioBucket(overrides.portfolioBucket, PORTFOLIO_BUCKET.CORE)
      : null;
    if (portfolioBucket) {
      entryMeta.portfolioBucket = portfolioBucket;
    }
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
      meta: entryMeta,
      portfolioBucket,
      tooltip: overrides.tooltip,
      sourceTab: overrides.sourceTab,
      sourceNumber: overrides.sourceNumber,
      sourceId: overrides.sourceId,
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
  const forecastMapLive = {};
  const forecastMapPlan = {};
  const forecastMap = {};
  const forecastMapLiveByBucket = PORTFOLIO_BUCKET_VALUES.reduce((acc, bucketName) => {
    acc[bucketName] = {};
    return acc;
  }, {});
  const forecastMapPlanByBucket = PORTFOLIO_BUCKET_VALUES.reduce((acc, bucketName) => {
    acc[bucketName] = {};
    return acc;
  }, {});

  months.forEach((month) => {
    forecastMapLive[month] = 0;
    forecastMapPlan[month] = 0;
    forecastMap[month] = 0;
    PORTFOLIO_BUCKET_VALUES.forEach((bucketName) => {
      forecastMapLiveByBucket[bucketName][month] = 0;
      forecastMapPlanByBucket[bucketName][month] = 0;
    });
  });

  if (forecastEnabled) {
    if (s?.forecast?.forecastImport && typeof s.forecast.forecastImport === "object") {
      Object.entries(s.forecast.forecastImport).forEach(([sku, monthMap]) => {
        const profile = profileForSku(sku);
        if (!profile.includeInForecast) return;
        const bucketName = normalizePortfolioBucket(
          profile.effectivePortfolioBucket,
          PORTFOLIO_BUCKET.CORE,
        );
        Object.entries(monthMap || {}).forEach(([month, entry]) => {
          if (!month || !bucket[month]) return;
          const revenue = parseEuro(entry?.revenueEur ?? entry?.revenue ?? null);
          if (!Number.isFinite(revenue)) return;
          forecastMapLive[month] = (forecastMapLive[month] || 0) + revenue;
          forecastMapLiveByBucket[bucketName][month] = (forecastMapLiveByBucket[bucketName][month] || 0) + revenue;
        });
      });
    } else if (Array.isArray(s?.forecast?.items)) {
      s.forecast.items.forEach(item => {
        if (!item || !item.month || !item.sku) return;
        const profile = profileForSku(item.sku);
        if (!profile.includeInForecast) return;
        const bucketName = normalizePortfolioBucket(
          profile.effectivePortfolioBucket,
          PORTFOLIO_BUCKET.CORE,
        );
        const month = item.month;
        if (!bucket[month]) return;
        const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
        const price = parseEuro(item.priceEur ?? item.price ?? 0);
        const revenue = qty * price;
        forecastMapLive[month] = (forecastMapLive[month] || 0) + revenue;
        forecastMapLiveByBucket[bucketName][month] = (forecastMapLiveByBucket[bucketName][month] || 0) + revenue;
      });
    }

    const planRevenueByMonth = buildPlanProductRevenueByMonthAndBucket({
      state: s,
      months,
    });
    Object.entries(planRevenueByMonth?.byBucket || {}).forEach(([bucketNameRaw, monthMap]) => {
      const bucketName = normalizePortfolioBucket(bucketNameRaw, PORTFOLIO_BUCKET.PLAN);
      Object.entries(monthMap || {}).forEach(([month, revenueRaw]) => {
        if (!bucket[month]) return;
        const revenue = parseEuro(revenueRaw);
        if (!Number.isFinite(revenue)) return;
        forecastMapPlan[month] = (forecastMapPlan[month] || 0) + revenue;
        forecastMapPlanByBucket[bucketName][month] = (forecastMapPlanByBucket[bucketName][month] || 0) + revenue;
      });
    });

    Object.keys(bucket).forEach((month) => {
      forecastMap[month] = (forecastMapLive[month] || 0) + (forecastMapPlan[month] || 0);
    });
  }

  const incomings = Array.isArray(s.incomings) ? s.incomings : [];
  const incomingByMonth = new Map();
  incomings.forEach((row) => {
    if (!row || !row.month) return;
    const month = String(row.month || '').trim();
    if (!month) return;
    incomingByMonth.set(month, row);
  });

  const currentMonth = toMonthKey(today);
  const currentMonthIdx = monthIndex(currentMonth);
  const cashInMode = normalizeCashInMode(s?.settings?.cashInMode);
  const legacyIgnoreQ4 = s?.settings?.cashInRecommendationIgnoreQ4 === true;
  const cashInSeasonalityEnabled = s?.settings?.cashInRecommendationSeasonalityEnabled == null
    ? !legacyIgnoreQ4
    : s?.settings?.cashInRecommendationSeasonalityEnabled !== false;
  const cashInQuoteMinPct = CASH_IN_QUOTE_MIN_PCT;
  const cashInQuoteMaxPct = CASH_IN_QUOTE_MAX_PCT;
  const actualMap = buildActualMap(s);
  const payoutRecommendation = buildPayoutRecommendation({
    months: Object.keys(bucket),
    incomings,
    monthlyActuals: s?.monthlyActuals,
    currentMonth,
    mode: cashInMode,
    seasonalityEnabled: cashInSeasonalityEnabled,
    ignoreQ4: !cashInSeasonalityEnabled,
    maxMonth: currentMonth,
    baselineNormalPct: s?.settings?.cashInRecommendationBaselineNormalPct,
    learningState: s?.settings?.cashInLearning,
    now: today instanceof Date ? today : new Date(today),
    nowIso: today instanceof Date && !Number.isNaN(today.getTime())
      ? today.toISOString()
      : new Date().toISOString(),
    minSamples: 4,
  });
  const recommendationMedianRaw = parsePayoutPctInput(payoutRecommendation.observedNormalMedianPct);
  const recommendationMedianPct = Number.isFinite(recommendationMedianRaw)
    ? clampPct(recommendationMedianRaw, cashInQuoteMinPct, cashInQuoteMaxPct)
    : null;
  const recommendationBaselineNormalRaw = parsePayoutPctInput(payoutRecommendation.baselineNormalPct);
  const recommendationBaselineNormalPct = Number.isFinite(recommendationBaselineNormalRaw)
    ? clampPct(recommendationBaselineNormalRaw, cashInQuoteMinPct, cashInQuoteMaxPct)
    : 51;
  const recommendationLearningState = payoutRecommendation.learningStateNext
    || payoutRecommendation.learningState
    || null;
  const cashInFallbackUsed = 'learning_model';
  const cashInCalibrationEnabled = s?.settings?.cashInCalibrationEnabled !== false;
  const cashInCalibrationMode = normalizeRevenueCalibrationMode(s?.settings?.cashInCalibrationMode);
  const calibrationProfile = buildCalibrationProfile({
    incomings,
    months: Object.keys(bucket),
    forecastRevenueByMonth: forecastMap,
    mode: cashInCalibrationMode,
    currentMonth,
    now: today,
    monthlyActuals: s?.monthlyActuals,
    learningState: s?.settings?.revenueCalibration,
    sourceForecastVersionId: s?.forecast?.activeVersionId || null,
  });
  const cashInCalibrationHorizonMonths = Math.max(
    1,
    Math.round(Number(calibrationProfile.horizonMonths || 3)),
  );
  const calibrationEvaluations = Array.isArray(calibrationProfile.evaluations)
    ? calibrationProfile.evaluations
    : [];
  const calibrationCandidates = Array.isArray(calibrationProfile.candidates)
    ? calibrationProfile.candidates
    : [];
  const calibrationLatestCandidate = calibrationCandidates.length
    ? calibrationCandidates[calibrationCandidates.length - 1]
    : null;
  const calibrationReasonCounts = calibrationEvaluations.reduce((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc;
    const reason = String(entry.reason || '').trim() || 'unknown';
    acc[reason] = Number(acc[reason] || 0) + 1;
    return acc;
  }, {});
  const calibrationNonDefaultFactorMonthCount = Object.values(calibrationProfile.byMonth || {})
    .filter((entry) => {
      const factor = Number(entry?.factor || 1);
      return Number.isFinite(factor) && Math.abs(factor - 1) > 0.000001;
    })
    .length;
  const calibrationApplied = cashInCalibrationEnabled && calibrationNonDefaultFactorMonthCount > 0;
  const appliedPayoutPctByMonth = {};
  const cashInMetaByMonth = {};

  Object.keys(bucket).forEach(m => {
    const incoming = incomingByMonth.get(m) || null;
    const incomingSource = String(incoming?.source || '').trim().toLowerCase();
    const hasManualRevenueInput = incoming?.revenueEur != null && String(incoming.revenueEur).trim() !== '';
    const manualRevenue = hasManualRevenueInput ? parseEuro(incoming.revenueEur) : null;
    const hasManualRevenueOverride = forecastEnabled && incomingSource === 'manual' && Number.isFinite(manualRevenue);
    const hasManualPayoutInput = incoming?.payoutPct != null && String(incoming.payoutPct).trim() !== '';
    const manualPayoutPct = hasManualPayoutInput
      ? parsePayoutPctInput(incoming.payoutPct)
      : null;
    const recommendationByMonth = payoutRecommendation.byMonth?.[m] || null;
    const recommendationMode = normalizeRecommendationMode(recommendationByMonth?.mode || cashInMode);
    const recommendationSourceTag = String(
      recommendationByMonth?.sourceTag
      || 'RECOMMENDED_PLAN',
    );
    const recommendationExplanation = String(recommendationByMonth?.explanation || '').trim() || null;
    const recommendationQuoteRaw = parsePayoutPctInput(recommendationByMonth?.quotePct);
    const recommendationQuotePct = Number.isFinite(recommendationQuoteRaw)
      ? clampPct(recommendationQuoteRaw, cashInQuoteMinPct, cashInQuoteMaxPct)
      : recommendationBaselineNormalPct;
    const quoteSource = hasManualPayoutInput ? 'manual' : 'recommendation';
    const basePayoutPctRaw = hasManualPayoutInput ? manualPayoutPct : recommendationQuotePct;
    const basePayoutPct = clampPct(basePayoutPctRaw, cashInQuoteMinPct, cashInQuoteMaxPct);
    const calibration = calibrationProfile.byMonth?.[m] || {
      factor: 1,
      factorBasis: 1,
      factorConservative: 1,
      active: false,
      sourceMonth: null,
      method: null,
      horizonOffset: 0,
      signal: null,
      biasB: Number(calibrationProfile.biasB || 1),
      riskR: Number(calibrationProfile.riskR || 0),
      cLiveRaw: null,
      cLive: null,
      wTime: 0,
      wH: 0,
      wEff: 0,
      dayOfMonth: today.getDate(),
      liveAnchorEnabled: false,
    };
    const forecastRevenueRaw = Number(forecastMap[m] || 0);
    const calibrationFactorBasis = Number(calibration.factorBasis || 1);
    const calibrationFactorConservative = Number(calibration.factorConservative || 1);
    const calibrationFactorRaw = Number(
      calibration.factor
      || (cashInCalibrationMode === 'conservative' ? calibrationFactorConservative : calibrationFactorBasis),
    );
    const calibrationFactorApplied = cashInCalibrationEnabled && Number.isFinite(calibrationFactorRaw)
      ? Number(calibrationFactorRaw)
      : 1;
    const calibratedPlanRevenue = forecastRevenueRaw * calibrationFactorApplied;
    const calibratedPlanRevenueBasis = forecastRevenueRaw * calibrationFactorBasis;
    const calibratedPlanRevenueConservative = forecastRevenueRaw * calibrationFactorConservative;

    let revenue = null;
    let revenueSource = null;
    if (!forecastEnabled) {
      if (!Number.isFinite(manualRevenue)) return;
      revenue = Number(manualRevenue);
      revenueSource = 'manual_no_forecast';
    } else if (hasManualRevenueOverride) {
      revenue = Number(manualRevenue);
      revenueSource = 'manual_override';
    } else {
      revenue = Number(cashInCalibrationEnabled ? calibratedPlanRevenue : forecastRevenueRaw);
      revenueSource = cashInCalibrationEnabled ? 'forecast_calibrated' : 'forecast_raw';
    }
    if (!Number.isFinite(revenue)) return;

    const monthIdx = monthIndex(m);
    const horizonFromCurrentMonth = (monthIdx != null && currentMonthIdx != null) ? (monthIdx - currentMonthIdx) : 0;
    const isFutureMonth = horizonFromCurrentMonth > 0;
    const payoutPct = clampPct(basePayoutPct, cashInQuoteMinPct, cashInQuoteMaxPct);
    const planRevenueAfterCalibration = forecastEnabled
      ? (cashInCalibrationEnabled ? calibratedPlanRevenue : forecastRevenueRaw)
      : revenue;
    const forecastRevenueForTooltip = forecastEnabled ? forecastRevenueRaw : revenue;
    const recommendationCapsApplied = Array.isArray(recommendationByMonth?.capsApplied)
      ? recommendationByMonth.capsApplied.filter(Boolean)
      : [];
    const quoteLabel = quoteSource === 'manual'
      ? 'Manuell'
      : recommendationModeLabel(recommendationMode);
    appliedPayoutPctByMonth[m] = payoutPct;
    cashInMetaByMonth[m] = {
      mode: recommendationMode,
      calibrationEnabled: cashInCalibrationEnabled,
      isFutureMonth,
      horizonFromCurrentMonth,
      recommendationQuotePct,
      recommendationSourceTag,
      recommendationExplanation,
      recommendationLevelPct: Number(recommendationByMonth?.levelPct),
      recommendationLevelAvg3Pct: Number(recommendationByMonth?.levelAvg3Pct),
      recommendationLevelAvg12Pct: Number(recommendationByMonth?.levelAvg12Pct),
      recommendationLevelRecentMonths: Array.isArray(recommendationByMonth?.levelRecentMonths)
        ? recommendationByMonth.levelRecentMonths
        : [],
      recommendationLevelWindowMonths: Array.isArray(recommendationByMonth?.levelWindowMonths)
        ? recommendationByMonth.levelWindowMonths
        : [],
      recommendationSeasonalityPct: Number(recommendationByMonth?.seasonalityPct),
      recommendationSeasonalityRawPct: Number(recommendationByMonth?.seasonalityRawPct),
      recommendationSeasonalityPriorPct: Number(recommendationByMonth?.seasonalityPriorPct),
      recommendationSeasonalityWeight: Number(recommendationByMonth?.seasonalityWeight),
      recommendationSeasonalitySampleCount: Number(recommendationByMonth?.seasonalitySampleCount),
      recommendationSeasonalitySourceTag: String(recommendationByMonth?.seasonalitySourceTag || ''),
      recommendationSeasonalityMonthMeanPct: Number(recommendationByMonth?.seasonalityMonthMeanPct),
      recommendationSeasonalityOverallMeanPct: Number(recommendationByMonth?.seasonalityOverallMeanPct),
      recommendationShrinkageActive: recommendationByMonth?.shrinkageActive === true,
      recommendationRiskBasePct: Number(recommendationByMonth?.riskBasePct),
      recommendationRiskAdjustmentPct: Number(recommendationByMonth?.riskAdjustmentPct),
      recommendationSafetyMarginPct: Number(recommendationByMonth?.safetyMarginPct),
      recommendationRiskExtraPct: Number(recommendationByMonth?.riskExtraPct),
      recommendationHorizonMonths: Number(recommendationByMonth?.horizonMonths),
      recommendationCapsApplied,
      recommendationCapApplied: recommendationByMonth?.capApplied === true || recommendationCapsApplied.length > 0,
      recommendationLiveSignalUsed: recommendationByMonth?.liveSignalUsed === true,
      recommendationLiveSignalWeight: Number(recommendationByMonth?.liveSignalWeight),
      recommendationLiveSignalQuotePct: Number(recommendationByMonth?.liveSignalQuotePct),
      recommendationSeasonalityEnabled: recommendationByMonth?.seasonalityEnabled !== false && cashInSeasonalityEnabled,
      payoutPct,
      manualPayoutPct,
      quoteSource,
      quoteLabel,
      revenueSource,
      appliedRevenue: revenue,
      forecastRevenueRaw,
      calibrationMode: cashInCalibrationMode,
      calibrationFactorApplied,
      calibrationFactorBasis,
      calibrationFactorConservative,
      calibrationSignal: Number(calibration.signal),
      calibrationBiasB: Number(calibration.biasB),
      calibrationRiskR: Number(calibration.riskR),
      calibrationLiveFactorRaw: Number(calibration.cLiveRaw),
      calibrationLiveFactorClamped: Number(calibration.cLive),
      calibrationWeightTime: Number(calibration.wTime),
      calibrationWeightH: Number(calibration.wH),
      calibrationWeightEffective: Number(calibration.wEff),
      calibrationDayOfMonth: Number(calibration.dayOfMonth),
      calibrationHorizonOffset: Number(calibration.horizonOffset),
      calibrationLiveAnchorEnabled: calibration.liveAnchorEnabled === true,
      calibrationSourceMonth: calibration.sourceMonth || null,
      calibrationMethod: calibration.method || null,
      planRevenueAfterCalibration,
      calibratedRevenueBasis: calibratedPlanRevenueBasis,
      calibratedRevenueConservative: calibratedPlanRevenueConservative,
      fallbackUsed: cashInFallbackUsed,
      quoteMinPct: cashInQuoteMinPct,
      quoteMaxPct: cashInQuoteMaxPct,
    };
    const date = monthEndFromKey(m);
    if (!forecastEnabled || hasManualRevenueOverride) {
      const amt = revenue * (payoutPct / 100);
      const tooltip = buildCashInTooltip({
        forecastRevenue: forecastRevenueForTooltip,
        calibrationFactorApplied,
        planRevenue: planRevenueAfterCalibration,
        payoutPct,
        payoutAmount: amt,
        quoteSource,
        recommendationSourceTag,
        recommendationExplanation,
        cashInMeta: cashInMetaByMonth[m],
      });
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
        tooltip,
        portfolioBucket: null,
        meta: {
          cashIn: {
            ...cashInMetaByMonth[m],
            revenue,
            payoutAmount: amt,
          },
        },
      }, { auto: false }));
      return;
    }

    PORTFOLIO_BUCKET_VALUES.forEach((bucketName) => {
      const liveRevenueRaw = forecastMapLiveByBucket[bucketName]?.[m] || 0;
      const liveRevenue = liveRevenueRaw * calibrationFactorApplied;
      const liveAmt = liveRevenue * (payoutPct / 100);
      if (Math.abs(liveAmt) > 0.000001) {
        const tooltip = buildCashInTooltip({
          forecastRevenue: forecastRevenueForTooltip,
          calibrationFactorApplied,
          planRevenue: planRevenueAfterCalibration,
          payoutPct,
          payoutAmount: liveAmt,
          quoteSource,
          recommendationSourceTag,
          recommendationExplanation,
          cashInMeta: cashInMetaByMonth[m],
        });
        pushEntry(m, baseEntry({
          id: `sales-live-${bucketName}-${m}`,
          direction: liveAmt >= 0 ? 'in' : 'out',
          amount: Math.abs(liveAmt),
          label: `Amazon Payout (Prognose - Live/CSV · ${bucketName})`,
          month: m,
          date: isoDate(date),
          kind: 'sales-payout',
          group: liveAmt >= 0 ? 'Sales × Payout' : 'Extras (Out)',
          source: 'sales',
          sourceTab: '#forecast',
          tooltip,
          portfolioBucket: bucketName,
          meta: {
            cashIn: {
              ...cashInMetaByMonth[m],
              revenue: liveRevenue,
              payoutAmount: liveAmt,
              component: 'live',
              componentRevenueRaw: liveRevenueRaw,
              portfolioBucket: bucketName,
            },
          },
        }, { auto: false }));
      }
    });

    PORTFOLIO_BUCKET_VALUES.forEach((bucketName) => {
      const planRevenueRaw = forecastMapPlanByBucket[bucketName]?.[m] || 0;
      const planRevenue = planRevenueRaw * calibrationFactorApplied;
      const planAmt = planRevenue * (payoutPct / 100);
      if (Math.abs(planAmt) > 0.000001) {
        const tooltip = buildCashInTooltip({
          forecastRevenue: forecastRevenueForTooltip,
          calibrationFactorApplied,
          planRevenue: planRevenueAfterCalibration,
          payoutPct,
          payoutAmount: planAmt,
          quoteSource,
          recommendationSourceTag,
          recommendationExplanation,
          cashInMeta: cashInMetaByMonth[m],
        });
        pushEntry(m, baseEntry({
          id: `sales-plan-${bucketName}-${m}`,
          direction: planAmt >= 0 ? 'in' : 'out',
          amount: Math.abs(planAmt),
          label: `Amazon Payout (Prognose - Plan · ${bucketName})`,
          month: m,
          date: isoDate(date),
          kind: 'sales-payout',
          group: planAmt >= 0 ? 'Sales × Payout' : 'Extras (Out)',
          source: 'sales-plan',
          sourceTab: '#forecast',
          tooltip,
          portfolioBucket: bucketName,
          meta: {
            cashIn: {
              ...cashInMetaByMonth[m],
              revenue: planRevenue,
              payoutAmount: planAmt,
              component: 'plan',
              componentRevenueRaw: planRevenueRaw,
              portfolioBucket: bucketName,
            },
          },
        }, { auto: false }));
      }
    });
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

  (Array.isArray(s.products) ? s.products : []).forEach((entry, productIndex) => {
    const product = entry && typeof entry === 'object' ? entry : {};
    const sku = String(product.sku || '').trim();
    if (!sku) return;
    const profile = profileForSku(sku);
    if (!profile.includeInForecast) return;
    const bucketName = normalizePortfolioBucket(
      profile.effectivePortfolioBucket,
      PORTFOLIO_BUCKET.CORE,
    );
    const alias = String(product.alias || sku).trim() || sku;
    const launchCosts = normalizeLaunchCosts(product.launchCosts, `prod-${productIndex + 1}-lc`);
    launchCosts.forEach((cost, index) => {
      const month = String(cost.date || '').slice(0, 7);
      if (!month || !bucket[month]) return;
      pushEntry(month, baseEntry({
        id: `launch-product-${normalizeSkuKey(sku)}-${cost.id || index + 1}`,
        direction: 'out',
        amount: Math.abs(parseEuro(cost.amountEur)),
        label: `${alias} · Launch-Kosten (${cost.type || 'Sonstiges'})`,
        month,
        date: cost.date,
        kind: 'launch-cost',
        group: 'Launch-Kosten',
        source: 'launch-costs',
        sourceTab: '#products',
        portfolioBucket: bucketName,
        meta: {
          sku,
          alias,
          type: cost.type || 'Sonstiges',
          note: cost.note || '',
          currency: cost.currency || 'EUR',
        },
      }, { auto: false }));
    });
  });

  (Array.isArray(s.planProducts) ? s.planProducts : []).forEach((entry, planIndex) => {
    const row = entry && typeof entry === 'object' ? entry : {};
    const status = String(row.status || 'active').trim().toLowerCase();
    if (status !== 'active') return;
    const includeInForecast = normalizeIncludeInForecast(row.includeInForecast, true);
    if (!includeInForecast) return;
    const planSku = String(row.plannedSku || row.mappedSku || '').trim();
    const bucketName = resolveEffectivePortfolioBucket({
      product: row,
      sku: planSku,
      poSkuSet,
      fallbackBucket: PORTFOLIO_BUCKET.PLAN,
    });
    const alias = String(row.alias || planSku || `Planprodukt ${planIndex + 1}`).trim();
    const launchCosts = normalizeLaunchCosts(row.launchCosts, `plan-${planIndex + 1}-lc`);
    launchCosts.forEach((cost, index) => {
      const month = String(cost.date || '').slice(0, 7);
      if (!month || !bucket[month]) return;
      pushEntry(month, baseEntry({
        id: `launch-plan-${normalizeSkuKey(planSku || alias)}-${cost.id || index + 1}`,
        direction: 'out',
        amount: Math.abs(parseEuro(cost.amountEur)),
        label: `${alias} · Launch-Kosten (${cost.type || 'Sonstiges'})`,
        month,
        date: cost.date,
        kind: 'launch-cost',
        group: 'Launch-Kosten',
        source: 'launch-costs',
        sourceTab: '#plan-products',
        portfolioBucket: bucketName,
        meta: {
          sku: planSku || null,
          alias,
          type: cost.type || 'Sonstiges',
          note: cost.note || '',
          currency: cost.currency || 'EUR',
          source: 'plan-product',
        },
      }, { auto: false }));
    });
  });

  const settingsNorm = normaliseSettings(s.settings);

  // PO-Events (Milestones & Importkosten)
  (Array.isArray(s.pos) ? s.pos : []).forEach(po => {
    const segments = buildOrderBucketSegments({
      order: po,
      profileBySku: productProfileBySku,
      poSkuSet,
      fallbackBucket: PORTFOLIO_BUCKET.CORE,
    });
    const splitByBucket = segments.length > 1;
    segments.forEach((segment) => {
      expandOrderEvents(segment.row, settingsNorm, 'PO', 'poNo').forEach(ev => {
        const m = ev.month; if (!bucket[m]) return;
        const kind = ev.type === 'manual' ? 'po' : (ev.type === 'vat_refund' ? 'po-refund' : 'po-import');
        const group =
          kind === 'po'
            ? 'PO/FO-Zahlungen'
            : kind === 'po-refund'
              ? 'Importkosten'
              : 'Importkosten';
        pushEntry(m, baseEntry({
          id: splitByBucket
            ? `${ev.id || `po-${po.id || ''}-${ev.type}-${ev.month}`}-${normalizeSkuKey(segment.bucket)}`
            : (ev.id || `po-${po.id || ''}-${ev.type}-${ev.month}`),
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
          sourceNumber: ev.sourceNumber || po.poNo || po.id,
          sourceId: po.id || po.poNo || null,
          tooltip: ev.tooltip,
          portfolioBucket: segment.bucket,
          meta: {
            skuBucketShare: segment.share,
          },
        }, { auto: ev.type !== 'manual', autoEligible: ev.type !== 'manual' }));
      });
    });
  });

  // FO-Events (Milestones & Importkosten)
  (Array.isArray(s.fos) ? s.fos : []).forEach(fo => {
    if (!isActiveFoStatus(fo?.status)) return;
    const segments = buildOrderBucketSegments({
      order: fo,
      profileBySku: productProfileBySku,
      poSkuSet,
      fallbackBucket: PORTFOLIO_BUCKET.CORE,
    });
    const splitByBucket = segments.length > 1;
    segments.forEach((segment) => {
      expandOrderEvents(segment.row, settingsNorm, 'FO', 'foNo').forEach(ev => {
        const m = ev.month; if (!bucket[m]) return;
        const kind = ev.type === 'manual' ? 'fo' : (ev.type === 'vat_refund' ? 'fo-refund' : 'fo-import');
        const group =
          kind === 'fo'
            ? 'PO/FO-Zahlungen'
            : kind === 'fo-refund'
              ? 'Importkosten'
              : 'Importkosten';
        pushEntry(m, baseEntry({
          id: splitByBucket
            ? `${ev.id || `fo-${fo.id || ''}-${ev.type}-${ev.month}`}-${normalizeSkuKey(segment.bucket)}`
            : (ev.id || `fo-${fo.id || ''}-${ev.type}-${ev.month}`),
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
          sourceNumber: ev.sourceNumber || fo.foNo || fo.foNumber || fo.id,
          sourceId: fo.id || fo.foNo || fo.foNumber || null,
          tooltip: ev.tooltip,
          portfolioBucket: segment.bucket,
          meta: {
            skuBucketShare: segment.share,
          },
        }, { auto: false, autoEligible: false, defaultPaid: false }));
      });
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
    const inflowByBucket = {};
    const outflowByBucket = {};
    PORTFOLIO_BUCKET_VALUES.forEach((bucketName) => {
      inflowByBucket[bucketName] = 0;
      outflowByBucket[bucketName] = 0;
    });
    entries.forEach((entry) => {
      const bucketName = normalizePortfolioBucket(
        entry?.portfolioBucket || entry?.meta?.portfolioBucket,
        "",
      );
      if (!bucketName || !PORTFOLIO_BUCKET_VALUES.includes(bucketName)) return;
      if (entry.direction === 'in') {
        inflowByBucket[bucketName] += Math.abs(Number(entry.amount || 0));
      } else if (entry.direction === 'out') {
        outflowByBucket[bucketName] += Math.abs(Number(entry.amount || 0));
      }
    });
    const netTotal = inflow - outflow;
    const netPaid = inflowPaid - outflowPaid;
    const netOpen = netTotal - netPaid;
    return {
      month: m,
      inflow: { total: inflow, paid: inflowPaid, open: inflowOpen },
      outflow: { total: outflow, paid: outflowPaid, open: outflowOpen },
      bucketBreakdown: {
        inflow: inflowByBucket,
        outflow: outflowByBucket,
      },
      net: { total: netTotal, paid: netPaid, open: netOpen },
      fixcost: { total: fixcostTotal, paid: fixcostPaid, open: fixcostOpen, top: fixcostTop },
      itemsIn: inflowEntries.map(item => ({ kind: item.kind, label: item.label, amount: item.amount })),
      itemsOut: outflowEntries.map(item => ({ kind: item.kind, label: item.label, amount: item.amount })),
      entries,
    };
  });

  // KPIs
  const opening = parseEuro(s.settings && s.settings.openingBalance);

  const salesIn = series.map(x => x.itemsIn.filter(i => i.kind === 'sales-payout').reduce((a, b) => a + b.amount, 0));
  const avgSalesPayout = salesIn.length ? (salesIn.reduce((a, b) => a + b, 0) / (salesIn.filter(v => v > 0).length || 1)) : 0;

  const plannedRevenueByMonth = {};
  const plannedPayoutByMonth = {};
  Object.keys(bucket).forEach(m => {
    const cashInMeta = cashInMetaByMonth[m];
    if (!cashInMeta) return;
    const revenue = Number(cashInMeta.appliedRevenue || 0);
    const payoutPct = Number.isFinite(appliedPayoutPctByMonth[m])
      ? Number(appliedPayoutPctByMonth[m])
      : recommendationBaselineNormalPct;
    plannedRevenueByMonth[m] = revenue;
    plannedPayoutByMonth[m] = revenue * (payoutPct / 100);
  });

  const kpis = {
    opening,
    openingToday: opening,
    salesPayoutAvg: avgSalesPayout,
    avgSalesPayout,
    firstNegativeMonth: null,
    actuals: {},
    cashIn: {
      mode: payoutRecommendation.mode || 'plan',
      basisMethod: 'learning',
      basisQuotePct: recommendationBaselineNormalPct,
      istMonthsCount: payoutRecommendation.sampleCount,
      hasIstData: payoutRecommendation.sampleCount > 0,
      fallbackUsed: cashInFallbackUsed,
      quoteMinPct: cashInQuoteMinPct,
      quoteMaxPct: cashInQuoteMaxPct,
      recommendationMode: payoutRecommendation.mode || 'plan',
      recommendationSeasonalityEnabled: payoutRecommendation.seasonalityEnabled !== false,
      recommendationMedianPct,
      recommendationSampleCount: payoutRecommendation.sampleCount,
      recommendationUsedMonths: payoutRecommendation.usedMonths,
      recommendationUncertain: payoutRecommendation.uncertain,
      recommendationIgnoreQ4: payoutRecommendation.ignoreQ4,
      recommendationBaselineNormalPct,
      recommendationObservedNormalMedianPct: payoutRecommendation.observedNormalMedianPct,
      recommendationObservedNormalAveragePct: payoutRecommendation.observedNormalAveragePct,
      recommendationObservedNormalSampleCount: payoutRecommendation.observedNormalSampleCount,
      recommendationObservedNormalWithForecastMedianPct: payoutRecommendation.observedNormalWithForecastMedianPct,
      recommendationObservedNormalWithForecastAveragePct: payoutRecommendation.observedNormalWithForecastAveragePct,
      recommendationObservedNormalWithForecastSampleCount: payoutRecommendation.observedNormalWithForecastSampleCount,
      recommendationCurrentMonthForecastQuotePct: payoutRecommendation.currentMonthForecastQuotePct,
      recommendationCurrentMonth: payoutRecommendation.currentMonth,
      recommendationRiskBasePct: Number(payoutRecommendation.riskBasePct || 0),
      recommendationLevelPct: Number(payoutRecommendation.levelPct || recommendationBaselineNormalPct),
      recommendationLearningState,
      calibrationEnabled: cashInCalibrationEnabled,
      calibrationMode: cashInCalibrationMode,
      calibrationApplied,
      calibrationHorizonMonths: cashInCalibrationHorizonMonths,
      calibrationCandidateCount: calibrationCandidates.length,
      calibrationLatestCandidateMonth: calibrationLatestCandidate?.month || null,
      calibrationLatestRawFactor: Number.isFinite(Number(calibrationLatestCandidate?.rawFactor))
        ? Number(calibrationLatestCandidate?.rawFactor)
        : null,
      calibrationNonDefaultFactorMonthCount,
      calibrationReasonCounts,
      calibrationBiasB: Number(calibrationProfile.biasB),
      calibrationRiskR: Number(calibrationProfile.riskR),
      calibrationLiveFactorRaw: Number(calibrationProfile.liveAnchor?.cLiveRaw),
      calibrationLiveFactorClamped: Number(calibrationProfile.liveAnchor?.cLive),
      calibrationLearningState: calibrationProfile.learningStateNext || null,
      calibrationLockAddedMonths: Array.isArray(calibrationProfile.learning?.lockAddedMonths)
        ? calibrationProfile.learning.lockAddedMonths
        : [],
    },
  };

  let plannedRunning = opening;
  const plannedBreakdown = months.map((m, idx) => {
    const row = series[idx];
    const openingBalance = plannedRunning;
    plannedRunning += row.net.total;
    return {
      month: m,
      opening: openingBalance,
      closing: plannedRunning,
      inflow: row.inflow.total,
      outflow: row.outflow.total,
      net: row.net.total,
      entries: row.entries,
    };
  });

  // Sobald ein realer Monatsend-Kontostand gepflegt ist, wird er zur neuen Baseline.
  let rebasedRunning = opening;
  const breakdown = months.map((m, idx) => {
    const row = series[idx];
    const openingBalance = rebasedRunning;
    const plannedClosing = openingBalance + row.net.total;
    const actualClosing = actualMap.get(m)?.closing;
    const hasActualClosing = Number.isFinite(actualClosing);
    const closing = hasActualClosing ? Number(actualClosing) : plannedClosing;
    rebasedRunning = closing;
    return {
      month: m,
      opening: openingBalance,
      closing,
      inflow: row.inflow.total,
      outflow: row.outflow.total,
      net: row.net.total,
      entries: row.entries,
      plannedClosing,
      hasActualClosing,
      actualClosing: hasActualClosing ? Number(actualClosing) : null,
    };
  });

  const firstNegEntry = breakdown.find(entry => Number(entry.closing || 0) < 0);
  kpis.firstNegativeMonth = firstNegEntry ? firstNegEntry.month : null;

  const actualComparisons = [];
  actualMap.forEach((values, month) => {
    const idx = months.indexOf(month);
    if (idx === -1) return;
    const plannedBreakdownRow = idx >= 0 && idx < plannedBreakdown.length ? plannedBreakdown[idx] : null;
    const plannedClosingBalance = plannedBreakdownRow ? plannedBreakdownRow.closing : null;
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

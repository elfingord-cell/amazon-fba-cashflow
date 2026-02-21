const CASH_IN_CALIBRATION_HORIZON_OPTIONS = [3, 6, 12];

export const CASH_IN_QUOTE_MIN_PCT = 40;
export const CASH_IN_QUOTE_MAX_PCT = 60;
export const CASH_IN_BASELINE_NORMAL_DEFAULT_PCT = 51;

function asFiniteNumber(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(String(value || "").trim());
}

export function monthIndex(month) {
  if (!isMonthKey(month)) return null;
  const [year, monthNumber] = String(month).split("-").map(Number);
  return year * 12 + (monthNumber - 1);
}

export function normalizeCalibrationHorizonMonths(value, fallback = 6) {
  const numeric = Math.round(Number(value || 0));
  if (CASH_IN_CALIBRATION_HORIZON_OPTIONS.includes(numeric)) return numeric;
  if (CASH_IN_CALIBRATION_HORIZON_OPTIONS.includes(Math.round(Number(fallback || 0)))) {
    return Math.round(Number(fallback || 0));
  }
  return 6;
}

export function computeCalibrationFactor(rawFactor, horizonMonths, offsetMonths) {
  const raw = Number(rawFactor);
  if (!(Number.isFinite(raw) && raw > 0)) return 1;
  const horizon = Math.max(1, Math.round(Number(horizonMonths || 1)));
  const offset = Math.max(0, Math.round(Number(offsetMonths || 0)));

  if (horizon <= 1) return offset === 0 ? raw : 1;
  if (offset >= horizon) return 1;

  const progress = offset / (horizon - 1);
  const factor = raw + (1 - raw) * progress;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function clampPct(value, minPct = CASH_IN_QUOTE_MIN_PCT, maxPct = CASH_IN_QUOTE_MAX_PCT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minPct;
  return Math.min(maxPct, Math.max(minPct, numeric));
}

export function parsePayoutPctInput(value) {
  if (value == null || String(value).trim() === "") return null;
  let numeric = Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 0 && numeric <= 1) numeric *= 100;
  return numeric;
}

function computeMedian(values) {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numeric.length) return null;
  const middle = Math.floor(numeric.length / 2);
  if (numeric.length % 2 === 1) return numeric[middle];
  return (numeric[middle - 1] + numeric[middle]) / 2;
}

function computeAverage(values) {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function isQ4Month(month) {
  if (!isMonthKey(month)) return false;
  const monthNumber = Number(String(month).slice(5, 7));
  return monthNumber >= 10 && monthNumber <= 12;
}

function daysInMonth(month) {
  if (!isMonthKey(month)) return null;
  const [year, monthNumber] = String(month).split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function parseDayOfMonthFromIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())) return null;
  const [yearRaw, monthRaw, dayRaw] = String(value).split("-").map(Number);
  const date = new Date(yearRaw, monthRaw - 1, dayRaw);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== yearRaw) return null;
  if (date.getMonth() + 1 !== monthRaw) return null;
  if (date.getDate() !== dayRaw) return null;
  return dayRaw;
}

function sameMonth(dateIso, month) {
  return String(dateIso || "").slice(0, 7) === String(month || "");
}

function computeActualQuotePct(row) {
  const source = row && typeof row === "object" ? row : {};
  const revenue = asFiniteNumber(source.realRevenueEUR);
  const payoutRatePct = parsePayoutPctInput(source.realPayoutRatePct);
  if (Number.isFinite(revenue) && revenue > 0 && Number.isFinite(payoutRatePct)) {
    return Number(payoutRatePct);
  }
  const payoutEur = asFiniteNumber(source.realPayoutEUR ?? source.realPayoutEur);
  if (Number.isFinite(revenue) && revenue > 0 && Number.isFinite(payoutEur) && payoutEur >= 0) {
    return (Number(payoutEur) / Number(revenue)) * 100;
  }
  return null;
}

function normalizeRecommendationMonths(input = {}) {
  const result = new Set();
  const sourceMonths = Array.isArray(input.months) ? input.months : [];
  sourceMonths.forEach((month) => {
    if (isMonthKey(month)) result.add(String(month));
  });
  const incomings = Array.isArray(input.incomings) ? input.incomings : [];
  incomings.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const month = String(row.month || "").trim();
    if (isMonthKey(month)) result.add(month);
  });
  const monthlyActuals = input.monthlyActuals && typeof input.monthlyActuals === "object"
    ? input.monthlyActuals
    : {};
  Object.keys(monthlyActuals).forEach((month) => {
    if (isMonthKey(month)) result.add(month);
  });
  return Array.from(result).sort((left, right) => left.localeCompare(right));
}

export function buildPayoutRecommendation(input = {}) {
  const monthlyActuals = input.monthlyActuals && typeof input.monthlyActuals === "object"
    ? input.monthlyActuals
    : {};
  const incomings = Array.isArray(input.incomings) ? input.incomings : [];
  const ignoreQ4 = input.ignoreQ4 === true;
  const maxMonth = isMonthKey(input.maxMonth)
    ? input.maxMonth
    : (isMonthKey(input.currentMonth) ? input.currentMonth : null);
  const currentMonth = isMonthKey(input.currentMonth) ? input.currentMonth : maxMonth;
  const minSamples = Math.max(1, Math.round(Number(input.minSamples || 4)));
  const baselineNormalRaw = parsePayoutPctInput(input.baselineNormalPct);
  const baselineNormalPct = clampPct(
    Number.isFinite(baselineNormalRaw) ? Number(baselineNormalRaw) : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
    CASH_IN_QUOTE_MIN_PCT,
    CASH_IN_QUOTE_MAX_PCT,
  );

  const istPoints = Object.entries(monthlyActuals)
    .map(([month, row]) => {
      if (!isMonthKey(month)) return null;
      if (maxMonth && month > maxMonth) return null;
      const source = row && typeof row === "object" ? row : {};
      const quotePctRaw = computeActualQuotePct(source);
      if (!Number.isFinite(quotePctRaw)) return null;
      return {
        month,
        quotePct: clampPct(Number(quotePctRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
        realRevenueEUR: asFiniteNumber(source.realRevenueEUR),
        realPayoutRatePct: parsePayoutPctInput(source.realPayoutRatePct),
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.month).localeCompare(String(right.month)));

  const istByMonth = new Map(istPoints.map((point) => [String(point.month), point]));
  const normalIstPoints = istPoints.filter((point) => !isQ4Month(point.month));
  const normalObservedMedianRaw = computeMedian(normalIstPoints.map((point) => point.quotePct));
  const normalObservedAverageRaw = computeAverage(normalIstPoints.map((point) => point.quotePct));

  const decemberIstPoints = istPoints
    .filter((point) => String(point.month).slice(5, 7) === "12")
    .sort((left, right) => String(left.month).localeCompare(String(right.month)));
  const decemberPoint = decemberIstPoints.length ? decemberIstPoints[decemberIstPoints.length - 1] : null;
  const decemberQuotePct = Number.isFinite(decemberPoint?.quotePct)
    ? clampPct(Number(decemberPoint.quotePct), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;
  const baselineQ4SuggestedRaw = Number.isFinite(decemberQuotePct)
    ? baselineNormalPct + 0.5 * (Number(decemberQuotePct) - baselineNormalPct)
    : baselineNormalPct;
  const baselineQ4SuggestedPct = clampPct(
    baselineQ4SuggestedRaw,
    CASH_IN_QUOTE_MIN_PCT,
    CASH_IN_QUOTE_MAX_PCT,
  );
  const baselineQ4Raw = parsePayoutPctInput(input.baselineQ4Pct);
  const baselineQ4Pct = clampPct(
    Number.isFinite(baselineQ4Raw) ? Number(baselineQ4Raw) : baselineQ4SuggestedPct,
    CASH_IN_QUOTE_MIN_PCT,
    CASH_IN_QUOTE_MAX_PCT,
  );
  const baselineQ4Source = Number.isFinite(baselineQ4Raw) ? "manual" : "suggested";

  const currentMonthIncoming = currentMonth
    ? incomings.find((row) => String(row?.month || "") === currentMonth) || null
    : null;
  const currentMonthRevenueForecast = asFiniteNumber(currentMonthIncoming?.calibrationSellerboardMonthEndEur);
  const currentMonthPayoutForecast = asFiniteNumber(currentMonthIncoming?.calibrationPayoutRateToDatePct);
  const currentMonthForecastQuoteRaw = Number.isFinite(currentMonthRevenueForecast)
    && currentMonthRevenueForecast > 0
    && Number.isFinite(currentMonthPayoutForecast)
    && currentMonthPayoutForecast >= 0
    ? (Number(currentMonthPayoutForecast) / Number(currentMonthRevenueForecast)) * 100
    : null;
  const currentMonthForecastQuotePct = Number.isFinite(currentMonthForecastQuoteRaw)
    ? clampPct(currentMonthForecastQuoteRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;

  const useForecastPointInNormalObserved = Boolean(
    currentMonth
    && Number.isFinite(currentMonthForecastQuotePct)
    && (!isQ4Month(currentMonth) || ignoreQ4),
  );
  const normalObservedWithForecastQuotes = useForecastPointInNormalObserved
    ? [...normalIstPoints.map((point) => point.quotePct), Number(currentMonthForecastQuotePct)]
    : normalIstPoints.map((point) => point.quotePct);
  const normalObservedWithForecastMedianRaw = computeMedian(normalObservedWithForecastQuotes);
  const normalObservedWithForecastAverageRaw = computeAverage(normalObservedWithForecastQuotes);

  const months = normalizeRecommendationMonths({
    months: input.months,
    incomings,
    monthlyActuals,
  });
  const byMonth = {};
  months.forEach((month) => {
    const istPoint = istByMonth.get(month);
    if (istPoint) {
      byMonth[month] = {
        month,
        quotePct: clampPct(istPoint.quotePct, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
        sourceTag: "IST",
        explanation: "IST: Auszahlungsquote aus Monats-Istwerten.",
      };
      return;
    }
    if (currentMonth && month === currentMonth && Number.isFinite(currentMonthForecastQuotePct)) {
      byMonth[month] = {
        month,
        quotePct: Number(currentMonthForecastQuotePct),
        sourceTag: "PROGNOSE",
        explanation: "PROGNOSE: Auszahlung Monatsende / Umsatzprognose Monatsende.",
      };
      return;
    }
    const useQ4Baseline = isQ4Month(month) && !ignoreQ4;
    const baselineQuote = useQ4Baseline ? baselineQ4Pct : baselineNormalPct;
    const sourceTag = useQ4Baseline ? "BASELINE_Q4" : "BASELINE_NORMAL";
    const explanation = useQ4Baseline
      ? "Baseline Q4: Q4 = Normal + 0,5 * (Dez - Normal) (manuell ueberschreibbar)."
      : "Baseline Normal: manuell gesetzter Referenzwert.";
    byMonth[month] = {
      month,
      quotePct: baselineQuote,
      sourceTag,
      explanation,
    };
  });

  const normalObservedMedianPct = Number.isFinite(normalObservedMedianRaw)
    ? clampPct(normalObservedMedianRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;
  const normalObservedAveragePct = Number.isFinite(normalObservedAverageRaw)
    ? clampPct(normalObservedAverageRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;
  const normalObservedWithForecastMedianPct = Number.isFinite(normalObservedWithForecastMedianRaw)
    ? clampPct(normalObservedWithForecastMedianRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;
  const normalObservedWithForecastAveragePct = Number.isFinite(normalObservedWithForecastAverageRaw)
    ? clampPct(normalObservedWithForecastAverageRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;

  return {
    // Compatibility fields used by existing callers.
    medianPct: baselineNormalPct,
    sampleCount: istPoints.length,
    usedMonths: istPoints.map((point) => point.month),
    uncertain: istPoints.length < minSamples,
    ignoreQ4,
    minSamples,
    points: istPoints,
    byMonth,
    baselineNormalPct,
    baselineQ4Pct,
    baselineQ4SuggestedPct,
    baselineQ4Source,
    decemberQuotePct,
    currentMonth,
    currentMonthForecastQuotePct,
    currentMonthForecastPointUsed: useForecastPointInNormalObserved,
    observedNormalMedianPct: normalObservedMedianPct,
    observedNormalAveragePct: normalObservedAveragePct,
    observedNormalSampleCount: normalIstPoints.length,
    observedNormalUsedMonths: normalIstPoints.map((point) => point.month),
    observedNormalWithForecastMedianPct: normalObservedWithForecastMedianPct,
    observedNormalWithForecastAveragePct: normalObservedWithForecastAveragePct,
    observedNormalWithForecastSampleCount: normalObservedWithForecastQuotes.length,
  };
}

function normalizeIncomingRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => {
      const row = entry && typeof entry === "object" ? entry : {};
      const month = isMonthKey(row.month) ? String(row.month) : null;
      if (!month) return null;
      const cutoffDate = row.calibrationCutoffDate ? String(row.calibrationCutoffDate) : "";
      const revenueToDate = asFiniteNumber(row.calibrationRevenueToDateEur);
      const sellerboardMonthEnd = asFiniteNumber(row.calibrationSellerboardMonthEndEur);
      return {
        month,
        cutoffDate,
        revenueToDate,
        sellerboardMonthEnd,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.month.localeCompare(right.month));
}

function resolveCalibrationCandidate(row, forecastRevenueByMonth) {
  const month = row.month;
  const cutoffDate = row.cutoffDate;
  const revenueToDate = row.revenueToDate;
  const sellerboardMonthEnd = row.sellerboardMonthEnd;
  const hasCutoff = Boolean(cutoffDate);
  const hasRevenueToDate = Number.isFinite(revenueToDate) && revenueToDate >= 0;
  const hasSellerboardMonthEnd = Number.isFinite(sellerboardMonthEnd) && sellerboardMonthEnd >= 0;
  if (!hasCutoff && !hasRevenueToDate && !hasSellerboardMonthEnd) {
    return {
      month,
      active: false,
      reason: "no_input",
      rawForecastRevenue: Number(forecastRevenueByMonth?.[month] || 0),
    };
  }
  const rawForecastRevenue = Number(forecastRevenueByMonth?.[month] || 0);

  if (!(rawForecastRevenue > 0)) {
    return {
      month,
      active: false,
      reason: "missing_forecast_revenue",
      rawForecastRevenue,
    };
  }

  let expectedRevenue = null;
  let method = null;

  if (hasSellerboardMonthEnd) {
    expectedRevenue = Number(sellerboardMonthEnd);
    method = "sellerboard";
  } else {
    if (!Number.isFinite(revenueToDate)) {
      return {
        month,
        active: false,
        reason: "missing_inputs",
        rawForecastRevenue,
      };
    }
    if (!hasCutoff || !hasRevenueToDate) {
      return {
        month,
        active: false,
        reason: "missing_inputs",
        rawForecastRevenue,
      };
    }
    const dayOfMonth = parseDayOfMonthFromIso(cutoffDate);
    const monthDays = daysInMonth(month);
    if (!dayOfMonth || !monthDays || !sameMonth(cutoffDate, month)) {
      return {
        month,
        active: false,
        reason: "invalid_cutoff_date",
        rawForecastRevenue,
      };
    }
    expectedRevenue = Number(revenueToDate) * (monthDays / dayOfMonth);
    method = "linear";
  }

  if (!(Number.isFinite(expectedRevenue) && expectedRevenue >= 0)) {
    return {
      month,
      active: false,
      reason: "invalid_expected_revenue",
      rawForecastRevenue,
    };
  }

  const rawFactor = expectedRevenue / rawForecastRevenue;
  if (!Number.isFinite(rawFactor) || rawFactor <= 0) {
    return {
      month,
      active: false,
      reason: "invalid_factor",
      rawForecastRevenue,
    };
  }

  return {
    month,
    active: true,
    reason: "ok",
    method,
    rawFactor,
    rawForecastRevenue,
    expectedRevenue,
  };
}

export function buildCalibrationProfile(input = {}) {
  const months = Array.isArray(input.months) ? input.months.filter(isMonthKey) : [];
  const normalizedMonths = months.slice().sort((left, right) => left.localeCompare(right));
  const forecastRevenueByMonth = input.forecastRevenueByMonth && typeof input.forecastRevenueByMonth === "object"
    ? input.forecastRevenueByMonth
    : {};
  const horizonMonths = normalizeCalibrationHorizonMonths(input.horizonMonths, 6);
  const rows = normalizeIncomingRows(input.incomings);

  const evaluations = rows
    .map((row) => resolveCalibrationCandidate(row, forecastRevenueByMonth));
  const candidates = evaluations
    .filter((entry) => entry.active)
    .sort((left, right) => left.month.localeCompare(right.month));

  const byMonth = {};

  normalizedMonths.forEach((month) => {
    const monthIdx = monthIndex(month);
    if (monthIdx == null) {
      byMonth[month] = {
        month,
        active: false,
        factor: 1,
        sourceMonth: null,
        method: null,
        rawFactor: null,
        rawForecastRevenue: Number(forecastRevenueByMonth?.[month] || 0),
        expectedRevenue: null,
        horizonOffset: null,
      };
      return;
    }

    const eligible = candidates
      .filter((candidate) => {
        const sourceIdx = monthIndex(candidate.month);
        if (sourceIdx == null || sourceIdx > monthIdx) return false;
        const offset = monthIdx - sourceIdx;
        if (horizonMonths <= 1) return offset === 0;
        return offset < horizonMonths;
      })
      .sort((left, right) => left.month.localeCompare(right.month));

    const latest = eligible.length ? eligible[eligible.length - 1] : null;
    if (!latest) {
      byMonth[month] = {
        month,
        active: false,
        factor: 1,
        sourceMonth: null,
        method: null,
        rawFactor: null,
        rawForecastRevenue: Number(forecastRevenueByMonth?.[month] || 0),
        expectedRevenue: null,
        horizonOffset: null,
      };
      return;
    }

    const sourceIdx = monthIndex(latest.month);
    const offset = monthIdx - sourceIdx;
    const factor = computeCalibrationFactor(latest.rawFactor, horizonMonths, offset);

    byMonth[month] = {
      month,
      active: true,
      factor: Number.isFinite(factor) && factor > 0 ? factor : 1,
      sourceMonth: latest.month,
      method: latest.method || null,
      rawFactor: Number(latest.rawFactor),
      rawForecastRevenue: Number(forecastRevenueByMonth?.[month] || 0),
      expectedRevenue: Number(latest.expectedRevenue),
      horizonOffset: offset,
    };
  });

  return {
    horizonMonths,
    candidates,
    evaluations,
    byMonth,
  };
}

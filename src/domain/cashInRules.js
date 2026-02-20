const CASH_IN_CALIBRATION_HORIZON_OPTIONS = [3, 6, 9];

export const CASH_IN_QUOTE_MIN_PCT = 40;
export const CASH_IN_QUOTE_MAX_PCT = 60;

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

export function buildPayoutRecommendation(input = {}) {
  const monthlyActuals = input.monthlyActuals && typeof input.monthlyActuals === "object"
    ? input.monthlyActuals
    : {};
  const ignoreQ4 = input.ignoreQ4 === true;
  const maxMonth = isMonthKey(input.maxMonth) ? input.maxMonth : null;
  const minSamples = Math.max(1, Math.round(Number(input.minSamples || 4)));

  const points = Object.entries(monthlyActuals)
    .map(([month, row]) => {
      if (!isMonthKey(month)) return null;
      if (maxMonth && month > maxMonth) return null;
      if (ignoreQ4 && isQ4Month(month)) return null;
      const source = row && typeof row === "object" ? row : {};
      const quotePct = parsePayoutPctInput(source.realPayoutRatePct);
      if (!Number.isFinite(quotePct)) return null;
      return { month, quotePct: Number(quotePct) };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.month).localeCompare(String(right.month)));

  const medianPctRaw = computeMedian(points.map((point) => point.quotePct));
  const medianPct = Number.isFinite(medianPctRaw)
    ? clampPct(medianPctRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;

  return {
    medianPct,
    sampleCount: points.length,
    usedMonths: points.map((point) => point.month),
    uncertain: points.length < minSamples,
    ignoreQ4,
    minSamples,
    points,
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
  const rawForecastRevenue = Number(forecastRevenueByMonth?.[month] || 0);

  if (!Number.isFinite(revenueToDate)) {
    return {
      month,
      active: false,
      reason: "missing_inputs",
      rawForecastRevenue,
    };
  }

  const hasCutoff = Boolean(cutoffDate);
  const hasRevenueToDate = Number.isFinite(revenueToDate) && revenueToDate >= 0;
  if (!hasCutoff || !hasRevenueToDate) {
    return {
      month,
      active: false,
      reason: "missing_inputs",
      rawForecastRevenue,
    };
  }

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

  if (Number.isFinite(sellerboardMonthEnd) && sellerboardMonthEnd >= 0) {
    expectedRevenue = Number(sellerboardMonthEnd);
    method = "sellerboard";
  } else {
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

  const candidates = rows
    .map((row) => resolveCalibrationCandidate(row, forecastRevenueByMonth))
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
        return offset <= horizonMonths;
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
    const decayRatio = Math.max(0, (horizonMonths - offset) / horizonMonths);
    const factor = 1 + (Number(latest.rawFactor) - 1) * decayRatio;

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
    byMonth,
  };
}

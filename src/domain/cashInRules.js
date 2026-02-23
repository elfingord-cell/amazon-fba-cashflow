const CASH_IN_CALIBRATION_HORIZON_OPTIONS = [3, 6, 12];

export const CASH_IN_QUOTE_MIN_PCT = 40;
export const CASH_IN_QUOTE_MAX_PCT = 60;
export const CASH_IN_BASELINE_NORMAL_DEFAULT_PCT = 51;
export const CASH_IN_SEASONALITY_CAP_PCT = 4;
export const CASH_IN_RISK_CAP_PCT = 6;
export const CASH_IN_SHRINKAGE_MIN_SAMPLES = 3;
export const CASH_IN_PLAN_SAFETY_MARGIN_PCT = 0.5;
export const CASH_IN_PLAN_EXTRA_RISK_CAP_PCT = 0.5;

const CASH_IN_LEVEL_ALPHA = 0.22;
const CASH_IN_SEASONALITY_ALPHA = 0.18;
const CASH_IN_RISK_ALPHA = 0.30;
const CASH_IN_MAX_RISK_HORIZON_MONTHS = 6;
const CASH_IN_LEVEL_WINDOW_MONTHS = 12;
const CASH_IN_LEVEL_RECENT_STRONG_MONTHS = 3;
const CASH_IN_LEVEL_RECENT_WEIGHT = 1.0;
const CASH_IN_LEVEL_OLDER_BASE_WEIGHT = 0.32;
const CASH_IN_LEVEL_OLDER_DECAY = 0.92;
const CASH_IN_LIVE_SIGNAL_START_DAY = 10;
const CASH_IN_LIVE_SIGNAL_MIN_WEIGHT = 0.03;
const CASH_IN_LIVE_SIGNAL_MAX_WEIGHT = 0.15;

export const REVENUE_CALIBRATION_ALPHA = 0.20;
export const REVENUE_CALIBRATION_GAMMA = 0.25;
export const REVENUE_CALIBRATION_BIAS_MIN = 0.75;
export const REVENUE_CALIBRATION_BIAS_MAX = 1.05;
export const REVENUE_CALIBRATION_CONSERVATIVE_MIN = 0.70;
export const REVENUE_CALIBRATION_CONSERVATIVE_MAX = 1.00;
export const REVENUE_CALIBRATION_RISK_MAX = 0.10;
export const REVENUE_CALIBRATION_DEFAULT_BIAS = 1.00;
export const REVENUE_CALIBRATION_DEFAULT_RISK = 0.05;
export const REVENUE_CALIBRATION_LIVE_FACTOR_MIN = 0.60;
export const REVENUE_CALIBRATION_LIVE_FACTOR_MAX = 1.20;
export const REVENUE_CALIBRATION_LIVE_HORIZON_MONTHS = 3;

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

function monthKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

export function normalizeRevenueCalibrationMode(value) {
  return String(value || "").trim().toLowerCase() === "conservative"
    ? "conservative"
    : "basis";
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
  const normalized = String(value)
    .trim()
    .replace(/%/g, "")
    .replace(",", ".");
  let numeric = Number(normalized);
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

function computeQuantile(values, quantile) {
  const numeric = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!numeric.length) return null;
  const q = Math.min(1, Math.max(0, Number(quantile)));
  if (numeric.length === 1) return numeric[0];
  const position = (numeric.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return numeric[lower];
  const weight = position - lower;
  return numeric[lower] * (1 - weight) + numeric[upper] * weight;
}

function normalizeMonthSlot(input) {
  const slot = Math.round(Number(input || 0));
  if (!(slot >= 1 && slot <= 12)) return null;
  return slot;
}

function monthSlotFromKey(month) {
  if (!isMonthKey(month)) return null;
  return normalizeMonthSlot(String(month).slice(5, 7));
}

function toMonthSlotIndex(monthOrSlot) {
  const slot = typeof monthOrSlot === "string" && isMonthKey(monthOrSlot)
    ? monthSlotFromKey(monthOrSlot)
    : normalizeMonthSlot(monthOrSlot);
  return slot ? (slot - 1) : null;
}

function clampSeasonalityPct(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(CASH_IN_SEASONALITY_CAP_PCT, Math.max(-CASH_IN_SEASONALITY_CAP_PCT, numeric));
}

function buildMonthMapFromArray(values, transform = (value) => value) {
  const out = {};
  for (let idx = 0; idx < 12; idx += 1) {
    out[String(idx + 1)] = transform(values[idx], idx);
  }
  return out;
}

function toSeasonalityArray(raw, fallback = 0) {
  const out = Array.from({ length: 12 }, () => clampSeasonalityPct(fallback));
  if (Array.isArray(raw)) {
    raw.forEach((value, index) => {
      if (index < 0 || index >= 12) return;
      out[index] = clampSeasonalityPct(value);
    });
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([key, value]) => {
    const slot = normalizeMonthSlot(key);
    if (!slot) return;
    out[slot - 1] = clampSeasonalityPct(value);
  });
  return out;
}

function toCountArray(raw, fallback = 0) {
  const out = Array.from({ length: 12 }, () => Math.max(0, Math.round(Number(fallback || 0))));
  if (Array.isArray(raw)) {
    raw.forEach((value, index) => {
      if (index < 0 || index >= 12) return;
      out[index] = Math.max(0, Math.round(Number(value || 0)));
    });
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([key, value]) => {
    const slot = normalizeMonthSlot(key);
    if (!slot) return;
    out[slot - 1] = Math.max(0, Math.round(Number(value || 0)));
  });
  return out;
}

function normalizePredictionSnapshotMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([month, value]) => {
    if (!isMonthKey(month)) return;
    if (Number.isFinite(Number(value))) {
      out[month] = {
        quotePct: clampPct(Number(value), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
        mode: "legacy",
        source: "legacy",
        createdAt: null,
      };
      return;
    }
    if (!value || typeof value !== "object") return;
    const quoteRaw = parsePayoutPctInput(value.quotePct ?? value.payoutPct ?? value.quote);
    if (!Number.isFinite(quoteRaw)) return;
    out[month] = {
      quotePct: clampPct(Number(quoteRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
      mode: String(value.mode || "").trim().toLowerCase() || "unknown",
      source: String(value.source || "").trim().toLowerCase() || "unknown",
      createdAt: value.createdAt ? String(value.createdAt) : null,
    };
  });
  return out;
}

function normalizeHistoricalImport(raw) {
  if (!raw || typeof raw !== "object") return null;
  const levelRaw = parsePayoutPctInput(raw.levelPct ?? raw.baselineNormalPct);
  const levelPct = Number.isFinite(levelRaw)
    ? clampPct(Number(levelRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : null;
  const seasonalityPriorByMonth = toSeasonalityArray(
    raw.seasonalityPriorByMonth ?? raw.seasonalityByMonth,
    0,
  );
  const monthSampleCountByMonth = toCountArray(raw.monthSampleCountByMonth, 0);
  return {
    startMonth: isMonthKey(raw.startMonth) ? String(raw.startMonth) : null,
    sampleCount: Math.max(0, Math.round(Number(raw.sampleCount || 0))),
    usedCount: Math.max(0, Math.round(Number(raw.usedCount || 0))),
    droppedCount: Math.max(0, Math.round(Number(raw.droppedCount || 0))),
    levelPct,
    seasonalityPriorByMonth,
    monthSampleCountByMonth,
    createdAt: raw.createdAt ? String(raw.createdAt) : null,
  };
}

function normalizeLearningState(raw, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallbackLevelRaw = parsePayoutPctInput(
    options.fallbackLevelPct ?? source.baselineNormalPct ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  );
  const fallbackLevelPct = Number.isFinite(fallbackLevelRaw)
    ? clampPct(Number(fallbackLevelRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
  const importedProfile = normalizeHistoricalImport(source.historicalImport || source.importProfile);
  const priorFromImport = importedProfile
    ? importedProfile.seasonalityPriorByMonth
    : Array.from({ length: 12 }, () => 0);
  const seasonalityPriorByMonth = toSeasonalityArray(
    source.seasonalityPriorByMonth,
    0,
  ).map((value, index) => (
    Number.isFinite(Number(value))
      ? clampSeasonalityPct(value)
      : clampSeasonalityPct(priorFromImport[index] || 0)
  ));
  const seasonalityByMonth = toSeasonalityArray(
    source.seasonalityByMonth,
    0,
  ).map((value, index) => (
    Number.isFinite(Number(value))
      ? clampSeasonalityPct(value)
      : clampSeasonalityPct(seasonalityPriorByMonth[index] || 0)
  ));
  const seasonalitySampleCountByMonth = toCountArray(source.seasonalitySampleCountByMonth, 0);
  const levelRaw = parsePayoutPctInput(source.levelPct ?? importedProfile?.levelPct ?? fallbackLevelPct);
  const levelPct = Number.isFinite(levelRaw)
    ? clampPct(Number(levelRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : fallbackLevelPct;
  const riskBaseRaw = parsePayoutPctInput(source.riskBasePct);
  const riskBasePct = Number.isFinite(riskBaseRaw)
    ? Math.min(CASH_IN_RISK_CAP_PCT, Math.max(0, Number(riskBaseRaw)))
    : 0;
  return {
    levelPct,
    seasonalityByMonth,
    seasonalityPriorByMonth,
    seasonalitySampleCountByMonth,
    riskBasePct,
    positiveErrorCount: Math.max(0, Math.round(Number(source.positiveErrorCount || 0))),
    predictionSnapshotByMonth: normalizePredictionSnapshotMap(
      source.predictionSnapshotByMonth || source.recommendationSnapshotByMonth,
    ),
    importedProfile,
  };
}

function serializeLearningState(state, input = {}) {
  const nowIso = input.nowIso || new Date().toISOString();
  const predictionSnapshotByMonth = {};
  Object.entries(state.predictionSnapshotByMonth || {}).forEach(([month, entry]) => {
    if (!isMonthKey(month) || !entry || typeof entry !== "object") return;
    const quoteRaw = parsePayoutPctInput(entry.quotePct);
    if (!Number.isFinite(quoteRaw)) return;
    predictionSnapshotByMonth[month] = {
      quotePct: clampPct(Number(quoteRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
      mode: String(entry.mode || "").trim().toLowerCase() || "unknown",
      source: String(entry.source || "").trim().toLowerCase() || "unknown",
      createdAt: entry.createdAt ? String(entry.createdAt) : null,
    };
  });
  return {
    version: 1,
    levelPct: clampPct(Number(state.levelPct || CASH_IN_BASELINE_NORMAL_DEFAULT_PCT)),
    seasonalityByMonth: buildMonthMapFromArray(state.seasonalityByMonth, (value) => clampSeasonalityPct(value)),
    seasonalityPriorByMonth: buildMonthMapFromArray(state.seasonalityPriorByMonth, (value) => clampSeasonalityPct(value)),
    seasonalitySampleCountByMonth: buildMonthMapFromArray(state.seasonalitySampleCountByMonth, (value) => (
      Math.max(0, Math.round(Number(value || 0)))
    )),
    riskBasePct: Math.min(CASH_IN_RISK_CAP_PCT, Math.max(0, Number(state.riskBasePct || 0))),
    positiveErrorCount: Math.max(0, Math.round(Number(state.positiveErrorCount || 0))),
    predictionSnapshotByMonth,
    historicalImport: state.importedProfile
      ? {
        startMonth: state.importedProfile.startMonth || null,
        sampleCount: Math.max(0, Math.round(Number(state.importedProfile.sampleCount || 0))),
        usedCount: Math.max(0, Math.round(Number(state.importedProfile.usedCount || 0))),
        droppedCount: Math.max(0, Math.round(Number(state.importedProfile.droppedCount || 0))),
        levelPct: Number.isFinite(Number(state.importedProfile.levelPct))
          ? clampPct(Number(state.importedProfile.levelPct))
          : null,
        seasonalityPriorByMonth: buildMonthMapFromArray(
          state.importedProfile.seasonalityPriorByMonth,
          (value) => clampSeasonalityPct(value),
        ),
        monthSampleCountByMonth: buildMonthMapFromArray(
          state.importedProfile.monthSampleCountByMonth,
          (value) => Math.max(0, Math.round(Number(value || 0))),
        ),
        createdAt: state.importedProfile.createdAt || null,
      }
      : null,
    config: {
      levelAlpha: CASH_IN_LEVEL_ALPHA,
      seasonalityAlpha: CASH_IN_SEASONALITY_ALPHA,
      riskAlpha: CASH_IN_RISK_ALPHA,
      riskCapPct: CASH_IN_RISK_CAP_PCT,
      seasonalityCapPct: CASH_IN_SEASONALITY_CAP_PCT,
      shrinkageMinSamples: CASH_IN_SHRINKAGE_MIN_SAMPLES,
      maxRiskHorizonMonths: CASH_IN_MAX_RISK_HORIZON_MONTHS,
      liveSignalStartDay: CASH_IN_LIVE_SIGNAL_START_DAY,
      liveSignalMaxWeight: CASH_IN_LIVE_SIGNAL_MAX_WEIGHT,
      liveSignalMinWeight: CASH_IN_LIVE_SIGNAL_MIN_WEIGHT,
    },
    updatedAt: nowIso,
  };
}

function computeMonthRiskAdjustmentPct(riskBasePct, horizonMonths) {
  const base = Math.max(0, Number(riskBasePct || 0));
  const horizon = Math.max(0, Math.round(Number(horizonMonths || 0)));
  const scaled = base * (1 + (Math.min(CASH_IN_MAX_RISK_HORIZON_MONTHS, horizon) * 0.1));
  return Math.min(CASH_IN_RISK_CAP_PCT, scaled);
}

function computeSeasonalityWithShrinkage({
  slotIndex,
  seasonalityByMonth,
  seasonalityPriorByMonth,
  seasonalitySampleCountByMonth,
  enabled,
}) {
  if (!enabled) {
    return {
      valuePct: 0,
      sampleCount: Number(seasonalitySampleCountByMonth[slotIndex] || 0),
      weight: 0,
      priorPct: Number(seasonalityPriorByMonth[slotIndex] || 0),
      rawPct: Number(seasonalityByMonth[slotIndex] || 0),
      shrinkageActive: false,
    };
  }
  const rawPct = clampSeasonalityPct(seasonalityByMonth[slotIndex] || 0);
  const priorPct = clampSeasonalityPct(seasonalityPriorByMonth[slotIndex] || 0);
  const sampleCount = Math.max(0, Math.round(Number(seasonalitySampleCountByMonth[slotIndex] || 0)));
  const weight = Math.min(1, sampleCount / CASH_IN_SHRINKAGE_MIN_SAMPLES);
  const valuePct = priorPct + ((rawPct - priorPct) * weight);
  return {
    valuePct,
    sampleCount,
    weight,
    priorPct,
    rawPct,
    shrinkageActive: weight < 1,
  };
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

function normalizeHistoricalPriorMonths(values, startMonth) {
  if (!Array.isArray(values)) return [];
  if (!isMonthKey(startMonth)) return [];
  const baseMonthIndex = monthIndex(startMonth);
  return values
    .map((value, offset) => {
      const quoteRaw = parsePayoutPctInput(value);
      if (!Number.isFinite(quoteRaw)) return null;
      const month = monthIndex(startMonth) == null
        ? null
        : (() => {
          const absoluteIndex = baseMonthIndex + offset;
          const year = Math.floor(absoluteIndex / 12);
          const monthNumber = (absoluteIndex % 12) + 1;
          return `${year}-${String(monthNumber).padStart(2, "0")}`;
        })();
      if (!isMonthKey(month)) return null;
      return {
        month,
        quotePct: clampPct(Number(quoteRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
      };
    })
    .filter(Boolean);
}

export function buildHistoricalPayoutPrior(input = {}) {
  const startMonthCandidate = isMonthKey(input.startMonth)
    ? String(input.startMonth)
    : null;
  const valuesSource = Array.isArray(input.values)
    ? input.values
    : String(input.values || "")
      .split(/[\n,; ]+/)
      .map((value) => value.trim())
      .filter(Boolean);

  const normalizedValues = valuesSource
    .map((value) => parsePayoutPctInput(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => clampPct(Number(value), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT));

  if (!startMonthCandidate || !normalizedValues.length) {
    return {
      ok: false,
      error: "Startmonat oder Werte fehlen.",
      sampleCount: normalizedValues.length,
    };
  }

  const q1 = computeQuantile(normalizedValues, 0.25);
  const q3 = computeQuantile(normalizedValues, 0.75);
  const iqr = Number.isFinite(q1) && Number.isFinite(q3) ? (q3 - q1) : 0;
  const outlierLow = Number.isFinite(q1) ? q1 - (1.5 * iqr) : null;
  const outlierHigh = Number.isFinite(q3) ? q3 + (1.5 * iqr) : null;

  const robustValues = normalizedValues.filter((value) => {
    if (!(Number.isFinite(outlierLow) && Number.isFinite(outlierHigh))) return true;
    return value >= outlierLow && value <= outlierHigh;
  });
  const usedValues = robustValues.length >= Math.max(3, Math.round(normalizedValues.length * 0.5))
    ? robustValues
    : normalizedValues;
  const levelMedian = computeMedian(usedValues);
  const levelPct = Number.isFinite(levelMedian)
    ? clampPct(Number(levelMedian), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;

  const monthlyResiduals = Array.from({ length: 12 }, () => []);
  const monthlySampleCount = Array.from({ length: 12 }, () => 0);
  const points = normalizeHistoricalPriorMonths(usedValues, startMonthCandidate);
  points.forEach((point) => {
    const slotIndex = toMonthSlotIndex(point.month);
    if (slotIndex == null) return;
    monthlyResiduals[slotIndex].push(Number(point.quotePct) - levelPct);
    monthlySampleCount[slotIndex] += 1;
  });
  const seasonalityPriorByMonth = monthlyResiduals.map((residuals) => {
    const residualMedian = computeMedian(residuals);
    if (!Number.isFinite(residualMedian)) return 0;
    return clampSeasonalityPct(residualMedian);
  });

  return {
    ok: true,
    startMonth: startMonthCandidate,
    sampleCount: normalizedValues.length,
    usedCount: usedValues.length,
    droppedCount: Math.max(0, normalizedValues.length - usedValues.length),
    levelPct,
    seasonalityPriorByMonth: buildMonthMapFromArray(seasonalityPriorByMonth, (value) => value),
    monthSampleCountByMonth: buildMonthMapFromArray(monthlySampleCount, (value) => value),
  };
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

function resolveLiveSignal(input = {}) {
  const currentMonth = isMonthKey(input.currentMonth) ? String(input.currentMonth) : null;
  if (!currentMonth) return null;
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime())
    ? input.now
    : new Date();
  const dayOfMonth = Number(now.getDate());
  if (!(dayOfMonth >= CASH_IN_LIVE_SIGNAL_START_DAY)) return null;
  const incomings = Array.isArray(input.incomings) ? input.incomings : [];
  const currentIncoming = incomings.find((row) => String(row?.month || "") === currentMonth) || null;
  const revenueForecast = asFiniteNumber(currentIncoming?.calibrationSellerboardMonthEndEur);
  const payoutForecast = asFiniteNumber(currentIncoming?.calibrationPayoutRateToDatePct);
  if (!(Number.isFinite(revenueForecast) && revenueForecast > 0 && Number.isFinite(payoutForecast) && payoutForecast >= 0)) {
    return null;
  }
  const quoteRaw = (Number(payoutForecast) / Number(revenueForecast)) * 100;
  if (!Number.isFinite(quoteRaw)) return null;
  const quotePct = clampPct(quoteRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const denominator = Math.max(1, daysInMonth - CASH_IN_LIVE_SIGNAL_START_DAY);
  const dayProgress = Math.min(1, Math.max(0, (dayOfMonth - CASH_IN_LIVE_SIGNAL_START_DAY) / denominator));
  const weight = CASH_IN_LIVE_SIGNAL_MIN_WEIGHT
    + ((CASH_IN_LIVE_SIGNAL_MAX_WEIGHT - CASH_IN_LIVE_SIGNAL_MIN_WEIGHT) * dayProgress);
  return {
    quotePct,
    weight,
    dayOfMonth,
  };
}

function recencyWeightForLevel(ageMonths) {
  const age = Math.max(0, Math.round(Number(ageMonths || 0)));
  if (age < CASH_IN_LEVEL_RECENT_STRONG_MONTHS) {
    return CASH_IN_LEVEL_RECENT_WEIGHT;
  }
  if (age >= CASH_IN_LEVEL_WINDOW_MONTHS) {
    return 0;
  }
  return CASH_IN_LEVEL_OLDER_BASE_WEIGHT * Math.pow(CASH_IN_LEVEL_OLDER_DECAY, age - CASH_IN_LEVEL_RECENT_STRONG_MONTHS);
}

function computeWeightedLevelForMonth({
  points,
  referenceMonth,
  fallbackLevelPct,
}) {
  const fallback = clampPct(
    Number.isFinite(Number(fallbackLevelPct))
      ? Number(fallbackLevelPct)
      : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
    CASH_IN_QUOTE_MIN_PCT,
    CASH_IN_QUOTE_MAX_PCT,
  );
  const refMonthIndex = monthIndex(referenceMonth);
  if (refMonthIndex == null) {
    return {
      levelPct: fallback,
      sampleCount: 0,
      recentSampleCount: 0,
      sourceTag: "fallback",
    };
  }

  const samples = [];
  (Array.isArray(points) ? points : []).forEach((point) => {
    const pointMonthIndex = monthIndex(point?.month);
    if (pointMonthIndex == null) return;
    const ageMonths = refMonthIndex - pointMonthIndex;
    if (ageMonths < 0 || ageMonths >= CASH_IN_LEVEL_WINDOW_MONTHS) return;
    const quotePct = Number(point?.quotePct);
    if (!Number.isFinite(quotePct)) return;
    const weight = recencyWeightForLevel(ageMonths);
    if (!(weight > 0)) return;
    samples.push({
      ageMonths,
      weight,
      quotePct: clampPct(quotePct, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
    });
  });

  if (!samples.length) {
    return {
      levelPct: fallback,
      sampleCount: 0,
      recentSampleCount: 0,
      sourceTag: "fallback",
    };
  }

  const rawMedian = computeMedian(samples.map((sample) => sample.quotePct));
  const median = Number.isFinite(rawMedian) ? Number(rawMedian) : fallback;
  const robustLow = Math.max(CASH_IN_QUOTE_MIN_PCT, median - 5);
  const robustHigh = Math.min(CASH_IN_QUOTE_MAX_PCT, median + 5);

  let weightedSum = 0;
  let weightSum = 0;
  samples.forEach((sample) => {
    const robustQuote = Math.min(robustHigh, Math.max(robustLow, sample.quotePct));
    weightedSum += robustQuote * sample.weight;
    weightSum += sample.weight;
  });

  const weightedLevel = weightSum > 0 ? (weightedSum / weightSum) : fallback;
  const confidence = Math.min(1, samples.length / 4);
  const levelPct = clampPct(
    (weightedLevel * confidence) + (fallback * (1 - confidence)),
    CASH_IN_QUOTE_MIN_PCT,
    CASH_IN_QUOTE_MAX_PCT,
  );

  const recentSampleCount = samples.filter((sample) => sample.ageMonths < CASH_IN_LEVEL_RECENT_STRONG_MONTHS).length;
  return {
    levelPct,
    sampleCount: samples.length,
    recentSampleCount,
    sourceTag: recentSampleCount >= 2 ? "recent_12m" : "stabilized_12m",
  };
}

function yearRecencyWeight(ageMonths) {
  const yearAge = Math.max(0, Math.floor(Math.max(0, Number(ageMonths || 0)) / 12));
  if (yearAge <= 0) return 1;
  if (yearAge === 1) return 0.55;
  if (yearAge === 2) return 0.30;
  return 0.18;
}

function centerSeasonalityOffsets(values) {
  const offsets = Array.isArray(values)
    ? values.map((value) => clampSeasonalityPct(value))
    : Array.from({ length: 12 }, () => 0);
  const mean = offsets.length
    ? offsets.reduce((sum, value) => sum + Number(value || 0), 0) / offsets.length
    : 0;
  return offsets.map((value) => clampSeasonalityPct(Number(value || 0) - mean));
}

function computeSeasonalityProfile({
  points,
  currentMonth,
  enabled,
  levelAnchorPct,
  priorOffsets,
  priorSampleCounts,
}) {
  const fallbackOffsets = Array.from({ length: 12 }, () => 0);
  const fallbackCounts = Array.from({ length: 12 }, () => 0);
  const normalizedPriorOffsets = Array.isArray(priorOffsets)
    ? priorOffsets.map((value) => clampSeasonalityPct(value))
    : fallbackOffsets.slice();
  const normalizedPriorCounts = Array.isArray(priorSampleCounts)
    ? priorSampleCounts.map((value) => Math.max(0, Math.round(Number(value || 0))))
    : fallbackCounts.slice();

  if (!enabled) {
    return {
      offsets: fallbackOffsets,
      rawOffsets: fallbackOffsets,
      priorOffsets: normalizedPriorOffsets,
      sampleCounts: normalizedPriorCounts,
      shrinkWeights: fallbackOffsets,
      sourceTags: Array.from({ length: 12 }, () => "disabled"),
    };
  }

  const anchorMonth = isMonthKey(currentMonth)
    ? currentMonth
    : ((Array.isArray(points) && points.length) ? points[points.length - 1].month : null);
  const anchorMonthIndex = monthIndex(anchorMonth);
  if (anchorMonthIndex == null) {
    return {
      offsets: centerSeasonalityOffsets(normalizedPriorOffsets),
      rawOffsets: centerSeasonalityOffsets(normalizedPriorOffsets),
      priorOffsets: normalizedPriorOffsets,
      sampleCounts: normalizedPriorCounts,
      shrinkWeights: fallbackOffsets,
      sourceTags: Array.from({ length: 12 }, () => "prior_only"),
    };
  }

  const centerLevel = Number.isFinite(Number(levelAnchorPct))
    ? Number(levelAnchorPct)
    : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;

  const weightedResidualSumBySlot = Array.from({ length: 12 }, () => 0);
  const weightSumBySlot = Array.from({ length: 12 }, () => 0);
  const latestYearWeightBySlot = Array.from({ length: 12 }, () => 0);
  const sampleCountBySlot = Array.from({ length: 12 }, () => 0);

  (Array.isArray(points) ? points : []).forEach((point) => {
    const pointMonthIndex = monthIndex(point?.month);
    const slotIndex = toMonthSlotIndex(point?.month);
    if (pointMonthIndex == null || slotIndex == null || pointMonthIndex > anchorMonthIndex) return;
    const quotePct = Number(point?.quotePct);
    if (!Number.isFinite(quotePct)) return;
    const ageMonths = anchorMonthIndex - pointMonthIndex;
    const weight = yearRecencyWeight(ageMonths);
    const residual = clampPct(quotePct, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT) - centerLevel;
    weightedResidualSumBySlot[slotIndex] += residual * weight;
    weightSumBySlot[slotIndex] += weight;
    sampleCountBySlot[slotIndex] += 1;
    if (ageMonths < 12) {
      latestYearWeightBySlot[slotIndex] += weight;
    }
  });

  const rawOffsets = Array.from({ length: 12 }, (_, slotIndex) => {
    if (weightSumBySlot[slotIndex] <= 0) return 0;
    return weightedResidualSumBySlot[slotIndex] / weightSumBySlot[slotIndex];
  });

  const blendedOffsets = Array.from({ length: 12 }, (_, slotIndex) => {
    const sampleCount = sampleCountBySlot[slotIndex];
    const rawOffset = rawOffsets[slotIndex];
    const priorOffset = Number(normalizedPriorOffsets[slotIndex] || 0);
    const shrinkWeight = Math.min(1, sampleCount / 2);
    if (sampleCount <= 0) {
      return priorOffset * 0.35;
    }
    return (rawOffset * shrinkWeight) + (priorOffset * (1 - shrinkWeight) * 0.35);
  });

  const centeredOffsets = centerSeasonalityOffsets(blendedOffsets);
  const centeredRawOffsets = centerSeasonalityOffsets(rawOffsets);
  const shrinkWeights = Array.from({ length: 12 }, (_, slotIndex) => (
    Math.min(1, sampleCountBySlot[slotIndex] / 2)
  ));
  const sourceTags = Array.from({ length: 12 }, (_, slotIndex) => {
    const sampleCount = sampleCountBySlot[slotIndex];
    const priorOffset = Number(normalizedPriorOffsets[slotIndex] || 0);
    if (sampleCount <= 0) {
      return Math.abs(priorOffset) > 0.001 ? "stabilized_prior" : "no_data";
    }
    const totalWeight = weightSumBySlot[slotIndex];
    const latestShare = totalWeight > 0 ? (latestYearWeightBySlot[slotIndex] / totalWeight) : 0;
    if (latestShare >= 0.6) return "recent_dominant";
    return "stabilized_history";
  });

  return {
    offsets: centeredOffsets,
    rawOffsets: centeredRawOffsets,
    priorOffsets: normalizedPriorOffsets,
    sampleCounts: sampleCountBySlot,
    shrinkWeights,
    sourceTags,
  };
}

export function buildPayoutRecommendation(input = {}) {
  const monthlyActuals = input.monthlyActuals && typeof input.monthlyActuals === "object"
    ? input.monthlyActuals
    : {};
  const incomings = Array.isArray(input.incomings) ? input.incomings : [];
  const maxMonth = isMonthKey(input.maxMonth)
    ? input.maxMonth
    : (isMonthKey(input.currentMonth) ? input.currentMonth : null);
  const currentMonth = isMonthKey(input.currentMonth) ? input.currentMonth : maxMonth;
  const minSamples = Math.max(1, Math.round(Number(input.minSamples || 4)));
  const seasonalityEnabled = input.seasonalityEnabled !== false && input.ignoreQ4 !== true;
  const baselineFallbackRaw = parsePayoutPctInput(input.baselineNormalPct);
  const learningState = normalizeLearningState(input.learningState, {
    fallbackLevelPct: Number.isFinite(baselineFallbackRaw)
      ? Number(baselineFallbackRaw)
      : CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  });

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

  const fallbackLevelPct = Number.isFinite(baselineFallbackRaw)
    ? clampPct(Number(baselineFallbackRaw), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
    : clampPct(Number(learningState.levelPct || CASH_IN_BASELINE_NORMAL_DEFAULT_PCT));
  const seasonalityProfile = computeSeasonalityProfile({
    points: istPoints,
    currentMonth,
    enabled: seasonalityEnabled,
    levelAnchorPct: computeWeightedLevelForMonth({
      points: istPoints,
      referenceMonth: currentMonth,
      fallbackLevelPct,
    }).levelPct,
    priorOffsets: learningState.seasonalityPriorByMonth,
    priorSampleCounts: learningState.seasonalitySampleCountByMonth,
  });
  const liveSignal = resolveLiveSignal({
    currentMonth,
    incomings,
    now: input.now,
  });

  const months = normalizeRecommendationMonths({
    months: input.months,
    incomings,
    monthlyActuals,
  });
  const byMonth = {};
  const appliedModelPoints = [];
  const currentMonthIndex = monthIndex(currentMonth);
  const levelByReferenceMonth = new Map();
  const dynamicRiskExtraPct = Number(learningState.positiveErrorCount || 0) > 0
    ? Math.min(
      CASH_IN_PLAN_EXTRA_RISK_CAP_PCT,
      Math.max(0, Number(learningState.riskBasePct || 0)) * 0.1,
    )
    : 0;
  const fixedSafetyMarginPct = CASH_IN_PLAN_SAFETY_MARGIN_PCT;

  function getLevelForReferenceMonth(referenceMonth) {
    const key = isMonthKey(referenceMonth) ? referenceMonth : "__fallback__";
    const cached = levelByReferenceMonth.get(key);
    if (cached) return cached;
    const levelInfo = computeWeightedLevelForMonth({
      points: istPoints,
      referenceMonth: isMonthKey(referenceMonth) ? referenceMonth : currentMonth,
      fallbackLevelPct,
    });
    levelByReferenceMonth.set(key, levelInfo);
    return levelInfo;
  }

  months.forEach((month) => {
    const monthSlotIndex = toMonthSlotIndex(month);
    const monthKeyIndex = monthIndex(month);
    const horizonMonths = (monthKeyIndex != null && currentMonthIndex != null)
      ? Math.max(0, monthKeyIndex - currentMonthIndex)
      : 0;
    const referenceMonth = (monthKeyIndex != null && currentMonthIndex != null && monthKeyIndex > currentMonthIndex)
      ? currentMonth
      : month;
    const levelInfo = getLevelForReferenceMonth(referenceMonth);
    const istPoint = istByMonth.get(month);
    if (istPoint) {
      byMonth[month] = {
        month,
        quotePct: clampPct(istPoint.quotePct, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT),
        sourceTag: "IST",
        explanation: "IST: Auszahlungsquote aus Monats-Istwerten.",
        mode: "ist",
        levelPct: levelInfo.levelPct,
        riskBasePct: dynamicRiskExtraPct,
        riskAdjustmentPct: 0,
        safetyMarginPct: 0,
        horizonMonths,
        seasonalityPct: 0,
        seasonalityRawPct: monthSlotIndex != null ? Number(seasonalityProfile.rawOffsets[monthSlotIndex] || 0) : 0,
        seasonalityPriorPct: monthSlotIndex != null ? Number(seasonalityProfile.priorOffsets[monthSlotIndex] || 0) : 0,
        seasonalityWeight: monthSlotIndex != null ? Number(seasonalityProfile.shrinkWeights[monthSlotIndex] || 0) : 0,
        seasonalitySampleCount: monthSlotIndex != null ? Number(seasonalityProfile.sampleCounts[monthSlotIndex] || 0) : 0,
        seasonalitySourceTag: monthSlotIndex != null ? String(seasonalityProfile.sourceTags[monthSlotIndex] || "") : "no_data",
        shrinkageActive: false,
        capsApplied: [],
        capApplied: false,
        liveSignalUsed: false,
        liveSignalWeight: 0,
        liveSignalQuotePct: null,
        seasonalityEnabled,
      };
      return;
    }

    const seasonalityPct = monthSlotIndex != null && seasonalityEnabled
      ? Number(seasonalityProfile.offsets[monthSlotIndex] || 0)
      : 0;
    const seasonalityRawPct = monthSlotIndex != null && seasonalityEnabled
      ? Number(seasonalityProfile.rawOffsets[monthSlotIndex] || 0)
      : 0;
    const seasonalityPriorPct = monthSlotIndex != null
      ? Number(seasonalityProfile.priorOffsets[monthSlotIndex] || 0)
      : 0;
    const seasonalityWeight = monthSlotIndex != null
      ? Number(seasonalityProfile.shrinkWeights[monthSlotIndex] || 0)
      : 0;
    const seasonalitySampleCount = monthSlotIndex != null
      ? Number(seasonalityProfile.sampleCounts[monthSlotIndex] || 0)
      : 0;
    const seasonalitySourceTag = monthSlotIndex != null
      ? String(seasonalityProfile.sourceTags[monthSlotIndex] || "")
      : "no_data";
    const riskAdjustmentPct = fixedSafetyMarginPct + dynamicRiskExtraPct;
    const baseRawPct = Number(levelInfo.levelPct || fallbackLevelPct) + seasonalityPct;
    let quoteBeforeClampPct = baseRawPct - riskAdjustmentPct;

    let liveSignalUsed = false;
    let liveSignalWeight = 0;
    let liveSignalQuotePct = null;
    if (liveSignal && month === currentMonth) {
      liveSignalUsed = true;
      liveSignalQuotePct = Number(liveSignal.quotePct);
      liveSignalWeight = Number(liveSignal.weight);
      quoteBeforeClampPct = (quoteBeforeClampPct * (1 - liveSignalWeight))
        + (liveSignalQuotePct * liveSignalWeight);
    }

    const quotePct = clampPct(
      quoteBeforeClampPct,
      CASH_IN_QUOTE_MIN_PCT,
      CASH_IN_QUOTE_MAX_PCT,
    );
    appliedModelPoints.push({ month, quotePct });
    const capsApplied = [];
    if (Math.abs(quoteBeforeClampPct - quotePct) > 0.000001) {
      capsApplied.push("quote_band_40_60");
    }
    if (Math.abs(seasonalityRawPct) >= CASH_IN_SEASONALITY_CAP_PCT - 0.000001) {
      capsApplied.push("seasonality_cap_4pp");
    }
    const explanationBase = "Empfohlen (Plan): aktuelles Niveau + Saisonmuster - Sicherheitsmarge.";
    const explanation = liveSignalUsed
      ? `${explanationBase} Live-Signal wird schwach beigemischt.`
      : explanationBase;

    byMonth[month] = {
      month,
      quotePct,
      sourceTag: liveSignalUsed ? "PROGNOSE" : "RECOMMENDED_PLAN",
      explanation,
      mode: "plan",
      levelPct: levelInfo.levelPct,
      levelSampleCount: levelInfo.sampleCount,
      levelRecentSampleCount: levelInfo.recentSampleCount,
      levelSourceTag: levelInfo.sourceTag,
      riskBasePct: dynamicRiskExtraPct,
      riskAdjustmentPct,
      safetyMarginPct: fixedSafetyMarginPct,
      riskExtraPct: dynamicRiskExtraPct,
      horizonMonths,
      seasonalityPct,
      seasonalityRawPct,
      seasonalityPriorPct,
      seasonalityWeight,
      seasonalitySampleCount,
      seasonalitySourceTag,
      shrinkageActive: seasonalityWeight < 1,
      capsApplied,
      capApplied: capsApplied.length > 0,
      liveSignalUsed,
      liveSignalWeight,
      liveSignalQuotePct,
      seasonalityEnabled,
    };
  });

  const normalObservedMedianRaw = computeMedian(istPoints.map((point) => point.quotePct));
  const normalObservedAverageRaw = computeAverage(istPoints.map((point) => point.quotePct));
  const modelObservedMedianRaw = computeMedian(appliedModelPoints.map((point) => point.quotePct));
  const modelObservedAverageRaw = computeAverage(appliedModelPoints.map((point) => point.quotePct));
  const currentLevelInfo = getLevelForReferenceMonth(currentMonth || maxMonth || null);

  const learningStateNext = serializeLearningState({
    ...learningState,
    levelPct: currentLevelInfo.levelPct,
    seasonalityByMonth: seasonalityProfile.offsets.slice(),
    seasonalityPriorByMonth: seasonalityProfile.offsets.slice(),
    seasonalitySampleCountByMonth: seasonalityProfile.sampleCounts.slice(),
    riskBasePct: Number(learningState.riskBasePct || 0),
  }, { nowIso: input.nowIso });
  return {
    medianPct: currentLevelInfo.levelPct,
    sampleCount: istPoints.length,
    usedMonths: istPoints.map((point) => point.month),
    uncertain: istPoints.length < minSamples,
    ignoreQ4: !seasonalityEnabled,
    minSamples,
    points: istPoints,
    byMonth,
    mode: "plan",
    seasonalityEnabled,
    safetyMarginPct: fixedSafetyMarginPct,
    riskExtraPct: dynamicRiskExtraPct,
    baselineNormalPct: currentLevelInfo.levelPct,
    baselineQ4Pct: currentLevelInfo.levelPct,
    baselineQ4SuggestedPct: currentLevelInfo.levelPct,
    baselineQ4Source: "seasonal_profile",
    decemberQuotePct: null,
    currentMonth,
    currentMonthForecastQuotePct: liveSignal ? liveSignal.quotePct : null,
    currentMonthForecastPointUsed: liveSignal != null,
    observedNormalMedianPct: Number.isFinite(normalObservedMedianRaw)
      ? clampPct(normalObservedMedianRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
      : null,
    observedNormalAveragePct: Number.isFinite(normalObservedAverageRaw)
      ? clampPct(normalObservedAverageRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
      : null,
    observedNormalSampleCount: istPoints.length,
    observedNormalUsedMonths: istPoints.map((point) => point.month),
    observedNormalWithForecastMedianPct: Number.isFinite(modelObservedMedianRaw)
      ? clampPct(modelObservedMedianRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
      : null,
    observedNormalWithForecastAveragePct: Number.isFinite(modelObservedAverageRaw)
      ? clampPct(modelObservedAverageRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
      : null,
    observedNormalWithForecastSampleCount: appliedModelPoints.length,
    riskBasePct: dynamicRiskExtraPct,
    levelPct: currentLevelInfo.levelPct,
    seasonalityByMonth: buildMonthMapFromArray(seasonalityProfile.offsets, (value) => value),
    seasonalityPriorByMonth: buildMonthMapFromArray(seasonalityProfile.priorOffsets, (value) => value),
    seasonalitySampleCountByMonth: buildMonthMapFromArray(
      seasonalityProfile.sampleCounts,
      (value) => value,
    ),
    learningState: learningStateNext,
    learningStateNext,
  };
}

function normalizeIncomingRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => {
      const row = entry && typeof entry === "object" ? entry : {};
      const month = isMonthKey(row.month) ? String(row.month) : null;
      if (!month) return null;
      const sellerboardMonthEnd = asFiniteNumber(row.calibrationSellerboardMonthEndEur);
      return {
        month,
        sellerboardMonthEnd,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.month.localeCompare(right.month));
}

function normalizeForecastRevenueByMonth(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([month, value]) => {
    if (!isMonthKey(month)) return;
    const revenue = Number(value);
    out[month] = Number.isFinite(revenue) ? Number(revenue) : 0;
  });
  return out;
}

function normalizeMonthlyActualRevenueByMonth(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([month, entry]) => {
    if (!isMonthKey(month)) return;
    const row = entry && typeof entry === "object" ? entry : {};
    const revenue = Number(row.realRevenueEUR);
    if (!Number.isFinite(revenue)) return;
    out[month] = Number(revenue);
  });
  return out;
}

function normalizeRevenueCalibrationForecastLock(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([month, lockRaw]) => {
    if (!isMonthKey(month)) return;
    const lock = lockRaw && typeof lockRaw === "object" ? lockRaw : {};
    const forecastRevenueLockedEUR = Number(lock.forecastRevenueLockedEUR);
    if (!Number.isFinite(forecastRevenueLockedEUR)) return;
    out[month] = {
      forecastRevenueLockedEUR: Math.max(0, Number(forecastRevenueLockedEUR)),
      lockedAt: lock.lockedAt ? String(lock.lockedAt) : null,
      sourceForecastVersionId: lock.sourceForecastVersionId == null
        ? null
        : String(lock.sourceForecastVersionId || "").trim() || null,
    };
  });
  return out;
}

export function normalizeRevenueCalibrationState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    biasB: clampNumber(
      source.biasB,
      REVENUE_CALIBRATION_BIAS_MIN,
      REVENUE_CALIBRATION_BIAS_MAX,
      REVENUE_CALIBRATION_DEFAULT_BIAS,
    ),
    riskR: clampNumber(
      source.riskR,
      0,
      REVENUE_CALIBRATION_RISK_MAX,
      REVENUE_CALIBRATION_DEFAULT_RISK,
    ),
    lastUpdatedAt: source.lastUpdatedAt ? String(source.lastUpdatedAt) : null,
    forecastLock: normalizeRevenueCalibrationForecastLock(source.forecastLock),
  };
}

function computeTimeWeight(dayOfMonth) {
  const day = Math.max(1, Math.min(31, Math.round(Number(dayOfMonth || 1))));
  if (day < 10) return 0;
  if (day <= 20) return (day - 10) / 10;
  return 1;
}

function computeLiveAnchor({ incomings, currentMonth, forecastRevenueByMonth }) {
  const currentForecastRevenue = Number(forecastRevenueByMonth?.[currentMonth] || 0);
  if (!(Number.isFinite(currentForecastRevenue) && currentForecastRevenue > 0)) {
    return {
      enabled: false,
      reason: "missing_forecast_revenue",
      f0: currentForecastRevenue,
      pLive: null,
      cLiveRaw: null,
      cLive: null,
    };
  }
  const currentRow = incomings.find((row) => row.month === currentMonth) || null;
  const pLive = Number(currentRow?.sellerboardMonthEnd);
  if (!(Number.isFinite(pLive) && pLive > 0)) {
    return {
      enabled: false,
      reason: "missing_inputs",
      f0: currentForecastRevenue,
      pLive: null,
      cLiveRaw: null,
      cLive: null,
    };
  }
  const cLiveRaw = Number(pLive) / Number(currentForecastRevenue);
  const cLive = clampNumber(
    cLiveRaw,
    REVENUE_CALIBRATION_LIVE_FACTOR_MIN,
    REVENUE_CALIBRATION_LIVE_FACTOR_MAX,
    REVENUE_CALIBRATION_DEFAULT_BIAS,
  );
  return {
    enabled: true,
    reason: "ok",
    f0: currentForecastRevenue,
    pLive: Number(pLive),
    cLiveRaw,
    cLive,
  };
}

function isPastMonth(month, currentMonth) {
  if (!isMonthKey(month) || !isMonthKey(currentMonth)) return false;
  return month < currentMonth;
}

export function learnRevenueCalibrationState(input = {}) {
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime())
    ? input.now
    : new Date();
  const nowIso = input.nowIso && String(input.nowIso).trim()
    ? String(input.nowIso)
    : now.toISOString();
  const currentMonth = isMonthKey(input.currentMonth)
    ? String(input.currentMonth)
    : (monthKeyFromDate(now) || "1970-01");
  const actualRevenueByMonth = normalizeMonthlyActualRevenueByMonth(input.monthlyActuals);
  const forecastRevenueByMonth = normalizeForecastRevenueByMonth(input.forecastRevenueByMonth);
  const normalizedState = normalizeRevenueCalibrationState(input.learningState);
  const nextForecastLock = {
    ...(normalizedState.forecastLock || {}),
  };
  const sourceForecastVersionId = input.sourceForecastVersionId == null
    ? null
    : String(input.sourceForecastVersionId || "").trim() || null;

  const lockAddedMonths = [];
  Object.keys(actualRevenueByMonth)
    .filter((month) => isPastMonth(month, currentMonth))
    .sort((left, right) => left.localeCompare(right))
    .forEach((month) => {
      if (nextForecastLock[month]) return;
      const lockedRevenueRaw = Number(forecastRevenueByMonth?.[month] || 0);
      const lockedRevenue = Number.isFinite(lockedRevenueRaw) ? Math.max(0, lockedRevenueRaw) : 0;
      nextForecastLock[month] = {
        forecastRevenueLockedEUR: lockedRevenue,
        lockedAt: nowIso,
        sourceForecastVersionId,
      };
      lockAddedMonths.push(month);
    });

  const learnablePoints = Object.keys(actualRevenueByMonth)
    .filter((month) => isPastMonth(month, currentMonth))
    .sort((left, right) => left.localeCompare(right))
    .map((month) => {
      const actualRevenue = Number(actualRevenueByMonth[month]);
      const lockedRevenue = Number(nextForecastLock?.[month]?.forecastRevenueLockedEUR);
      if (!(Number.isFinite(actualRevenue) && Number.isFinite(lockedRevenue) && lockedRevenue > 0)) {
        return null;
      }
      return {
        month,
        actualRevenue,
        lockedRevenue,
      };
    })
    .filter(Boolean);

  let biasB = normalizedState.biasB;
  let riskR = normalizedState.riskR;
  const replay = [];
  if (learnablePoints.length) {
    biasB = REVENUE_CALIBRATION_DEFAULT_BIAS;
    riskR = REVENUE_CALIBRATION_DEFAULT_RISK;
    learnablePoints.forEach((point) => {
      const accuracy = Number(point.actualRevenue) / Number(point.lockedRevenue);
      const biasBefore = biasB;
      const biasAfter = clampNumber(
        ((1 - REVENUE_CALIBRATION_ALPHA) * biasBefore) + (REVENUE_CALIBRATION_ALPHA * accuracy),
        REVENUE_CALIBRATION_BIAS_MIN,
        REVENUE_CALIBRATION_BIAS_MAX,
        biasBefore,
      );
      const optimismGap = Math.max(0, biasBefore - accuracy);
      const riskAfterRaw = ((1 - REVENUE_CALIBRATION_GAMMA) * riskR) + (REVENUE_CALIBRATION_GAMMA * optimismGap);
      const riskAfter = clampNumber(
        riskAfterRaw,
        0,
        REVENUE_CALIBRATION_RISK_MAX,
        riskR,
      );
      replay.push({
        month: point.month,
        actualRevenue: point.actualRevenue,
        lockedRevenue: point.lockedRevenue,
        accuracy,
        biasBefore,
        biasAfter,
        optimismGap,
        riskBefore: riskR,
        riskAfter,
      });
      biasB = biasAfter;
      riskR = riskAfter;
    });
  }

  const stateNext = {
    biasB,
    riskR,
    lastUpdatedAt: learnablePoints.length ? nowIso : normalizedState.lastUpdatedAt,
    forecastLock: nextForecastLock,
  };
  return {
    state: stateNext,
    stateNext,
    lockAddedMonths,
    learnableMonthCount: learnablePoints.length,
    learnableMonths: learnablePoints.map((entry) => entry.month),
    replay,
  };
}

export function buildCalibrationProfile(input = {}) {
  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime())
    ? input.now
    : new Date();
  const dayOfMonth = Math.max(1, Math.min(31, Math.round(Number(now.getDate() || 1))));
  const months = Array.isArray(input.months) ? input.months.filter(isMonthKey) : [];
  const normalizedMonths = months.slice().sort((left, right) => left.localeCompare(right));
  const currentMonth = isMonthKey(input.currentMonth)
    ? String(input.currentMonth)
    : (monthKeyFromDate(now) || normalizedMonths[0] || "1970-01");
  const mode = normalizeRevenueCalibrationMode(input.mode);
  const forecastRevenueByMonth = normalizeForecastRevenueByMonth(input.forecastRevenueByMonth);
  const incomings = normalizeIncomingRows(input.incomings);

  const learning = learnRevenueCalibrationState({
    learningState: input.learningState,
    forecastRevenueByMonth,
    monthlyActuals: input.monthlyActuals,
    currentMonth,
    sourceForecastVersionId: input.sourceForecastVersionId,
    now,
    nowIso: input.nowIso,
  });
  const biasB = Number(learning.state?.biasB ?? REVENUE_CALIBRATION_DEFAULT_BIAS);
  const riskR = Number(learning.state?.riskR ?? REVENUE_CALIBRATION_DEFAULT_RISK);
  const wTime = computeTimeWeight(dayOfMonth);
  const liveAnchor = computeLiveAnchor({
    incomings,
    currentMonth,
    forecastRevenueByMonth,
  });
  const candidates = liveAnchor.enabled
    ? [{
      month: currentMonth,
      active: true,
      reason: "ok",
      method: "live_anchor",
      rawFactor: liveAnchor.cLiveRaw,
      rawForecastRevenue: liveAnchor.f0,
      expectedRevenue: liveAnchor.pLive,
    }]
    : [];
  const evaluations = [{
    month: currentMonth,
    active: liveAnchor.enabled,
    reason: liveAnchor.reason,
    method: liveAnchor.enabled ? "live_anchor" : null,
    rawFactor: liveAnchor.cLiveRaw,
    clampedFactor: liveAnchor.cLive,
    rawForecastRevenue: liveAnchor.f0,
    expectedRevenue: liveAnchor.pLive,
  }];

  const currentMonthIdx = monthIndex(currentMonth);
  const byMonth = {};
  normalizedMonths.forEach((month) => {
    const forecastRevenue = Number(forecastRevenueByMonth?.[month] || 0);
    const monthIdx = monthIndex(month);
    const horizonOffsetRaw = (monthIdx != null && currentMonthIdx != null)
      ? (monthIdx - currentMonthIdx)
      : 0;
    const horizonOffset = Math.max(0, horizonOffsetRaw);
    const wH = horizonOffsetRaw < 0
      ? 0
      : Math.max(0, 1 - (horizonOffset / REVENUE_CALIBRATION_LIVE_HORIZON_MONTHS));
    const wEff = liveAnchor.enabled ? (wTime * wH) : 0;
    const signal = (wEff * Number(liveAnchor.cLive ?? biasB)) + ((1 - wEff) * biasB);
    const factorBasis = clampNumber(
      signal,
      REVENUE_CALIBRATION_BIAS_MIN,
      REVENUE_CALIBRATION_BIAS_MAX,
      1,
    );
    const riskScale = 1 + (0.1 * Math.min(horizonOffset, 4));
    const factorConservative = clampNumber(
      signal - (riskR * riskScale),
      REVENUE_CALIBRATION_CONSERVATIVE_MIN,
      REVENUE_CALIBRATION_CONSERVATIVE_MAX,
      1,
    );
    const factorSelected = mode === "conservative" ? factorConservative : factorBasis;
    const calibratedRevenueBasis = forecastRevenue > 0 ? forecastRevenue * factorBasis : 0;
    const calibratedRevenueConservative = forecastRevenue > 0 ? forecastRevenue * factorConservative : 0;
    byMonth[month] = {
      month,
      active: Math.abs(factorSelected - 1) > 0.000001,
      factor: factorSelected,
      factorBasis,
      factorConservative,
      sourceMonth: liveAnchor.enabled ? currentMonth : null,
      method: liveAnchor.enabled && wEff > 0 ? "live_anchor" : "bias_only",
      rawFactor: liveAnchor.cLiveRaw,
      rawForecastRevenue: forecastRevenue,
      expectedRevenue: liveAnchor.pLive,
      horizonOffset,
      dayOfMonth,
      biasB,
      riskR,
      cLiveRaw: liveAnchor.cLiveRaw,
      cLive: liveAnchor.cLive,
      wTime,
      wH,
      wEff,
      signal,
      calibratedRevenueBasis,
      calibratedRevenueConservative,
      liveAnchorEnabled: liveAnchor.enabled,
    };
  });

  return {
    mode,
    horizonMonths: REVENUE_CALIBRATION_LIVE_HORIZON_MONTHS,
    currentMonth,
    dayOfMonth,
    biasB,
    riskR,
    learning,
    learningStateNext: learning.stateNext,
    liveAnchor,
    candidates,
    evaluations,
    byMonth,
  };
}

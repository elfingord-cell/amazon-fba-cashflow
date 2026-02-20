import { parseDeNumber } from "../lib/dataHealth.js";
import {
  collectPoSkuSet,
  normalizeIncludeInForecast,
  normalizeLaunchCosts,
  normalizePortfolioBucket,
  PORTFOLIO_BUCKET,
  PORTFOLIO_BUCKET_VALUES,
  resolveEffectivePortfolioBucket,
} from "./portfolioBuckets.js";

export const PLAN_RELATION_TYPES = ["standalone", "variant_of_existing", "category_adjacent"];

const CALENDAR_MONTHS = ["Jan", "Feb", "Maerz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asMonthNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 12) return null;
  return rounded;
}

function normalizeMonthKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const mmYYYY = raw.match(/^(\d{2})-(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1]}`;
  return null;
}

function monthIndex(month) {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  return year * 12 + (monthNumber - 1);
}

function addMonths(month, offset) {
  const idx = monthIndex(month);
  if (idx == null) return month;
  const next = idx + Number(offset || 0);
  const year = Math.floor(next / 12);
  const monthNumber = (next % 12) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function monthRange(startMonth, months) {
  const normalized = normalizeMonthKey(startMonth);
  const count = Number.isFinite(months) ? Math.max(0, Math.round(months)) : 0;
  if (!normalized || !count) return [];
  return Array.from({ length: count }, (_, index) => addMonths(normalized, index));
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function asPositiveInt(value) {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded <= 0) return null;
  return rounded;
}

function normalizeRelationType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (PLAN_RELATION_TYPES.includes(raw)) return raw;
  return "standalone";
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "archived") return "archived";
  if (raw === "draft") return "draft";
  return "active";
}

function sanitizeKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSku(value) {
  return String(value || "").trim();
}

export function normalizeIsoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, monthNumber, day] = raw.split("-").map(Number);
    const probe = new Date(Date.UTC(year, monthNumber - 1, day));
    const valid = (
      probe.getUTCFullYear() === year
      && probe.getUTCMonth() === (monthNumber - 1)
      && probe.getUTCDate() === day
    );
    if (valid) return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function parseIsoDateUtc(value) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) return null;
  const [year, monthNumber, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, day));
}

function monthKeyFromDateUtc(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month) {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function monthStartDateUtc(month) {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  const [year, monthNumber] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

function normalizeMonthValueMap(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  Object.entries(input).forEach(([monthRaw, value]) => {
    const month = normalizeMonthKey(monthRaw);
    const parsed = asNumber(value);
    if (!month || !Number.isFinite(parsed)) return;
    out[month] = Number(parsed);
  });
  return out;
}

export function buildPlanProductKey(input, fallbackIndex = 0) {
  const idPart = sanitizeKeyPart(input?.id);
  if (idPart) return `plan:${idPart}`;
  const aliasPart = sanitizeKeyPart(input?.alias);
  if (aliasPart) return `plan:${aliasPart}`;
  return `plan:row-${fallbackIndex + 1}`;
}

export function normalizePlanProductRecord(raw, fallbackIndex = 0) {
  const row = raw && typeof raw === "object" ? raw : {};
  const alias = String(row.alias || "").trim();
  const id = String(row.id || "");
  const relationType = normalizeRelationType(row.relationType);
  const baselineReferenceMonth = asMonthNumber(row.baselineReferenceMonth);
  const baselineUnitsInReferenceMonth = asNumber(row.baselineUnitsInReferenceMonth);
  const avgSellingPriceGrossEUR = asNumber(row.avgSellingPriceGrossEUR);
  const sellerboardMarginPct = asNumber(row.sellerboardMarginPct);
  const launchDate = normalizeIsoDate(row.launchDate);
  const rampUpWeeks = asPositiveInt(row.rampUpWeeks);
  const softLaunchStartSharePctRaw = asNumber(row.softLaunchStartSharePct);
  const softLaunchStartSharePct = (
    Number.isFinite(softLaunchStartSharePctRaw)
      ? clamp(Number(softLaunchStartSharePctRaw), 0, 100)
      : 0
  );
  const normalizedStatus = normalizeStatus(row.status);
  const includeInForecast = normalizeIncludeInForecast(row.includeInForecast, normalizedStatus === "active");
  return {
    id: id || `plan-${fallbackIndex + 1}`,
    key: buildPlanProductKey({ id, alias }, fallbackIndex),
    alias,
    plannedSku: normalizeSku(row.plannedSku),
    relationType,
    categoryId: row.categoryId ? String(row.categoryId) : null,
    status: normalizedStatus,
    portfolioBucket: normalizePortfolioBucket(row.portfolioBucket, PORTFOLIO_BUCKET.PLAN),
    includeInForecast,
    launchCosts: normalizeLaunchCosts(row.launchCosts, `plan-lc-${fallbackIndex + 1}`),
    seasonalityReferenceSku: normalizeSku(row.seasonalityReferenceSku),
    baselineReferenceMonth,
    baselineUnitsInReferenceMonth,
    baselineReferenceSku: normalizeSku(row.baselineReferenceSku),
    avgSellingPriceGrossEUR,
    sellerboardMarginPct,
    launchDate,
    rampUpWeeks,
    softLaunchStartSharePct,
    mappedSku: normalizeSku(row.mappedSku || row.liveSku),
    mappedAt: row.mappedAt ? String(row.mappedAt) : null,
    archivedAt: row.archivedAt ? String(row.archivedAt) : null,
    createdAt: row.createdAt ? String(row.createdAt) : null,
    updatedAt: row.updatedAt ? String(row.updatedAt) : null,
    raw: row,
  };
}

export function normalizePlanProductMappingRecord(raw, fallbackIndex = 0) {
  const row = raw && typeof raw === "object" ? raw : {};
  const planUnitsByMonth = normalizeMonthValueMap(row.planUnitsByMonth);
  const months = Array.isArray(row.months)
    ? row.months.map((month) => normalizeMonthKey(month)).filter(Boolean)
    : Object.keys(planUnitsByMonth);
  return {
    id: String(row.id || `plan-map-${fallbackIndex + 1}`),
    planProductId: String(row.planProductId || ""),
    planProductAlias: String(row.planProductAlias || ""),
    sku: normalizeSku(row.sku),
    plannedSku: normalizeSku(row.plannedSku),
    mappedAt: row.mappedAt ? String(row.mappedAt) : null,
    launchDate: normalizeIsoDate(row.launchDate),
    rampUpWeeks: asPositiveInt(row.rampUpWeeks),
    softLaunchStartSharePct: clamp(Number(asNumber(row.softLaunchStartSharePct) || 0), 0, 100),
    baselineReferenceMonth: asMonthNumber(row.baselineReferenceMonth),
    baselineUnitsInReferenceMonth: asNumber(row.baselineUnitsInReferenceMonth),
    seasonalityReferenceSku: normalizeSku(row.seasonalityReferenceSku),
    months: months.filter((month) => Boolean(month)).sort(),
    planUnitsByMonth,
    planRevenueByMonth: normalizeMonthValueMap(row.planRevenueByMonth),
    raw: row,
  };
}

function resolveForecastSkuMap(forecastImport, sku) {
  if (!sku || !forecastImport || typeof forecastImport !== "object") return null;
  const direct = forecastImport[sku];
  if (direct && typeof direct === "object") return direct;
  const lower = String(sku).toLowerCase();
  const matchKey = Object.keys(forecastImport).find((key) => key.toLowerCase() === lower);
  if (!matchKey) return null;
  const matched = forecastImport[matchKey];
  return matched && typeof matched === "object" ? matched : null;
}

export function computeSeasonalityFromForecastImport(forecastImport, sku) {
  const monthMap = resolveForecastSkuMap(forecastImport, sku);
  if (!monthMap) return null;
  const points = Object.entries(monthMap)
    .map(([monthRaw, payload]) => {
      const month = normalizeMonthKey(monthRaw);
      if (!month) return null;
      const monthNumber = asMonthNumber(month.slice(5, 7));
      if (monthNumber == null) return null;
      const units = payload && typeof payload === "object"
        ? parseDeNumber(payload.units)
        : parseDeNumber(payload);
      if (!Number.isFinite(units)) return null;
      return { month, monthNumber, units: Number(units) };
    })
    .filter(Boolean)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!points.length) return null;

  const grouped = Array.from({ length: 12 }, () => []);
  points.forEach((point) => {
    grouped[point.monthNumber - 1].push(point.units);
  });

  const monthlyAverages = grouped.map((values) => {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const available = monthlyAverages.filter((value) => Number.isFinite(value));
  const overallAverage = available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;

  const factorsByMonthNumber = {};
  const averagesByMonthNumber = {};
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const average = monthlyAverages[monthNumber - 1];
    averagesByMonthNumber[monthNumber] = Number.isFinite(average) ? Number(average) : null;
    factorsByMonthNumber[monthNumber] = (
      Number.isFinite(average)
      && Number.isFinite(overallAverage)
      && overallAverage > 0
    )
      ? Number(average) / Number(overallAverage)
      : null;
  }

  return {
    sku: String(sku || "").trim(),
    startMonth: points[0].month,
    endMonth: points[points.length - 1].month,
    sampleMonthCount: points.length,
    coveredMonthTypes: Object.values(averagesByMonthNumber).filter((value) => Number.isFinite(value)).length,
    overallAverage: Number.isFinite(overallAverage) ? Number(overallAverage) : null,
    factorsByMonthNumber,
    averagesByMonthNumber,
  };
}

function projectPlanBaseUnitsForMonth(input) {
  const baseline = asNumber(input.baselineUnitsInReferenceMonth);
  const refMonth = asMonthNumber(input.baselineReferenceMonth);
  const targetMonth = asMonthNumber(input.targetMonthNumber);
  const factors = input.factorsByMonthNumber || {};
  if (baseline == null || baseline < 0 || refMonth == null || targetMonth == null) return null;
  const factorRef = asNumber(factors[refMonth]);
  const factorTarget = asNumber(factors[targetMonth]);
  if (!Number.isFinite(factorRef) || !Number.isFinite(factorTarget) || factorRef <= 0) return null;
  const rawUnits = Number(baseline) * (Number(factorTarget) / Number(factorRef));
  if (!Number.isFinite(rawUnits)) return null;
  return Math.max(0, Number(rawUnits));
}

function buildRampWindow(input) {
  const launchDate = parseIsoDateUtc(input?.launchDate);
  const rampUpWeeks = asPositiveInt(input?.rampUpWeeks);
  if (!launchDate || !rampUpWeeks) {
    return {
      launchDate,
      rampEndDate: null,
      rampDurationDays: null,
    };
  }
  const rampDurationDays = Math.max(1, Math.round(rampUpWeeks * 7));
  const rampEndDate = new Date(launchDate.getTime() + (rampDurationDays * DAY_MS));
  return {
    launchDate,
    rampEndDate,
    rampDurationDays,
  };
}

function rampFactorForDate(input) {
  const date = input?.date;
  const launchDate = input?.launchDate;
  const rampEndDate = input?.rampEndDate;
  const softStartShare = clamp(Number(input?.softStartShare || 0), 0, 1);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 1;
  if (!(launchDate instanceof Date) || Number.isNaN(launchDate.getTime())) return 1;
  if (date < launchDate) return 0;
  if (!(rampEndDate instanceof Date) || Number.isNaN(rampEndDate.getTime())) return 1;
  if (date > rampEndDate) return 1;
  const total = rampEndDate.getTime() - launchDate.getTime();
  if (total <= 0) return 1;
  const elapsed = date.getTime() - launchDate.getTime();
  const progress = clamp(elapsed / total, 0, 1);
  return clamp(softStartShare + ((1 - softStartShare) * progress), softStartShare, 1);
}

function applyLaunchRampToMonth(input) {
  const month = normalizeMonthKey(input?.month);
  const baseUnits = asNumber(input?.baseUnits);
  const monthStart = monthStartDateUtc(month);
  const totalDays = daysInMonth(month);
  if (!monthStart || !Number.isFinite(baseUnits) || !Number.isFinite(totalDays) || totalDays <= 0) {
    return {
      units: null,
      unitsRaw: null,
      rampFactor: null,
      weightedDays: 0,
      activeDays: 0,
      daysInMonth: Number.isFinite(totalDays) ? totalDays : null,
    };
  }
  const softStartShare = clamp(Number(asNumber(input?.softLaunchStartSharePct) || 0) / 100, 0, 1);
  const rampWindow = buildRampWindow({
    launchDate: input?.launchDate,
    rampUpWeeks: input?.rampUpWeeks,
  });
  const dailyBase = Number(baseUnits) / Number(totalDays);
  let weightedDays = 0;
  let activeDays = 0;
  for (let day = 0; day < totalDays; day += 1) {
    const date = new Date(monthStart.getTime() + (day * DAY_MS));
    const factor = rampFactorForDate({
      date,
      launchDate: rampWindow.launchDate,
      rampEndDate: rampWindow.rampEndDate,
      softStartShare,
    });
    weightedDays += factor;
    if (factor > 0) activeDays += 1;
  }
  const unitsRaw = dailyBase * weightedDays;
  const units = Number.isFinite(unitsRaw) ? Math.max(0, Math.round(unitsRaw)) : null;
  const rampFactor = (Number(baseUnits) > 0 && Number.isFinite(unitsRaw))
    ? Number(unitsRaw) / Number(baseUnits)
    : (weightedDays > 0 ? 1 : 0);
  return {
    units,
    unitsRaw: Number.isFinite(unitsRaw) ? Number(unitsRaw) : null,
    rampFactor: Number.isFinite(rampFactor) ? Number(rampFactor) : null,
    weightedDays,
    activeDays,
    daysInMonth: Number(totalDays),
  };
}

function planningMonthsFromState(state) {
  const settings = state?.settings && typeof state.settings === "object" ? state.settings : {};
  const startMonth = normalizeMonthKey(settings.startMonth) || currentMonthKey();
  const horizon = asNumber(settings.horizonMonths);
  const count = Number.isFinite(horizon) && horizon > 0 ? Math.round(horizon) : 18;
  return monthRange(startMonth, count);
}

export function buildPlanProductForecastRow(input) {
  const normalized = normalizePlanProductRecord(input?.planProduct, input?.fallbackIndex || 0);
  const forecastImport = (input?.forecastImport && typeof input.forecastImport === "object")
    ? input.forecastImport
    : {};
  const months = Array.isArray(input?.months) && input.months.length
    ? input.months.filter((month) => normalizeMonthKey(month))
    : [];
  const seasonality = computeSeasonalityFromForecastImport(forecastImport, normalized.seasonalityReferenceSku);
  const unitsByMonth = {};
  const baseUnitsByMonth = {};
  const rampFactorByMonth = {};
  const rampMetaByMonth = {};
  const revenueByMonth = {};
  const softLaunchStartSharePct = clamp(Number(normalized.softLaunchStartSharePct || 0), 0, 100);
  months.forEach((month) => {
    const monthNumber = asMonthNumber(String(month).slice(5, 7));
    const baseUnits = projectPlanBaseUnitsForMonth({
      baselineUnitsInReferenceMonth: normalized.baselineUnitsInReferenceMonth,
      baselineReferenceMonth: normalized.baselineReferenceMonth,
      targetMonthNumber: monthNumber,
      factorsByMonthNumber: seasonality?.factorsByMonthNumber || {},
    });
    const ramp = applyLaunchRampToMonth({
      month,
      baseUnits,
      launchDate: normalized.launchDate,
      rampUpWeeks: normalized.rampUpWeeks,
      softLaunchStartSharePct,
    });
    const units = Number.isFinite(ramp.units) ? Number(ramp.units) : null;
    baseUnitsByMonth[month] = Number.isFinite(baseUnits) ? Number(baseUnits) : null;
    unitsByMonth[month] = units;
    rampFactorByMonth[month] = Number.isFinite(ramp.rampFactor) ? Number(ramp.rampFactor) : null;
    rampMetaByMonth[month] = {
      weightedDays: Number.isFinite(ramp.weightedDays) ? Number(ramp.weightedDays) : 0,
      activeDays: Number.isFinite(ramp.activeDays) ? Number(ramp.activeDays) : 0,
      daysInMonth: Number.isFinite(ramp.daysInMonth) ? Number(ramp.daysInMonth) : 0,
      unitsRaw: Number.isFinite(ramp.unitsRaw) ? Number(ramp.unitsRaw) : null,
    };
    const price = asNumber(normalized.avgSellingPriceGrossEUR);
    revenueByMonth[month] = (
      Number.isFinite(price)
      && Number.isFinite(units)
    )
      ? Math.round((Number(price) * Number(units)) * 100) / 100
      : null;
  });

  return {
    ...normalized,
    seasonality,
    months,
    baseUnitsByMonth,
    rampFactorByMonth,
    rampMetaByMonth,
    unitsByMonth,
    revenueByMonth,
  };
}

export function buildPlanProductForecastRows(input) {
  const state = input?.state && typeof input.state === "object" ? input.state : {};
  const planProducts = Array.isArray(state.planProducts) ? state.planProducts : [];
  const forecast = state.forecast && typeof state.forecast === "object" ? state.forecast : {};
  const forecastImport = (forecast.forecastImport && typeof forecast.forecastImport === "object")
    ? forecast.forecastImport
    : {};
  const months = Array.isArray(input?.months) && input.months.length
    ? input.months
    : planningMonthsFromState(state);
  return planProducts
    .map((entry, index) => buildPlanProductForecastRow({
      planProduct: entry,
      forecastImport,
      months,
      fallbackIndex: index,
    }))
    .filter((row) => row.alias);
}

export function buildPlanProductRevenueByMonth(input) {
  return buildPlanProductRevenueByMonthAndBucket(input).totalsByMonth;
}

export function buildPlanProductRevenueByMonthAndBucket(input) {
  const months = Array.isArray(input?.months) && input.months.length ? input.months : [];
  const poSkuSet = collectPoSkuSet(input?.state || {});
  const rows = buildPlanProductForecastRows({
    state: input?.state || {},
    months,
  });
  const totalsByMonth = {};
  const byBucket = PORTFOLIO_BUCKET_VALUES.reduce((acc, bucket) => {
    acc[bucket] = {};
    return acc;
  }, {});
  months.forEach((month) => {
    totalsByMonth[month] = 0;
    PORTFOLIO_BUCKET_VALUES.forEach((bucket) => {
      byBucket[bucket][month] = 0;
    });
  });
  rows.forEach((row) => {
    if (row.status !== "active") return;
    if (!normalizeIncludeInForecast(row.includeInForecast, true)) return;
    const bucket = resolveEffectivePortfolioBucket({
      product: row,
      sku: row.plannedSku || row.mappedSku || row.seasonalityReferenceSku || row.alias,
      poSkuSet,
      fallbackBucket: PORTFOLIO_BUCKET.PLAN,
    });
    months.forEach((month) => {
      const revenue = asNumber(row.revenueByMonth?.[month]);
      if (!Number.isFinite(revenue)) return;
      totalsByMonth[month] = (totalsByMonth[month] || 0) + Number(revenue);
      byBucket[bucket][month] = (byBucket[bucket][month] || 0) + Number(revenue);
    });
  });
  return {
    totalsByMonth,
    byBucket,
  };
}

export function buildPlanVsLiveComparisonRows(input) {
  const mapping = normalizePlanProductMappingRecord(input?.mapping || {}, 0);
  const sku = normalizeSku(mapping.sku);
  if (!sku) return [];
  const liveMap = resolveForecastSkuMap(input?.forecastImport, sku) || {};
  const liveUnitsByMonth = {};
  Object.entries(liveMap).forEach(([monthRaw, payload]) => {
    const month = normalizeMonthKey(monthRaw);
    if (!month) return;
    const units = payload && typeof payload === "object"
      ? parseDeNumber(payload.units)
      : parseDeNumber(payload);
    if (!Number.isFinite(units)) return;
    liveUnitsByMonth[month] = Number(units);
  });
  const requestedMonths = Array.isArray(input?.months)
    ? input.months.map((month) => normalizeMonthKey(month)).filter(Boolean)
    : [];
  const unionMonths = requestedMonths.length
    ? requestedMonths
    : Array.from(new Set([
      ...Object.keys(mapping.planUnitsByMonth || {}),
      ...Object.keys(liveUnitsByMonth),
      ...(mapping.months || []),
    ])).sort();
  const launchMonth = normalizeMonthKey(input?.launchMonth || monthKeyFromDateUtc(parseIsoDateUtc(mapping.launchDate)));
  const maxMonths = asPositiveInt(input?.maxMonths);
  const filteredMonths = unionMonths
    .filter((month) => {
      if (!month) return false;
      if (!launchMonth) return true;
      return month >= launchMonth;
    })
    .sort()
    .slice(0, maxMonths || unionMonths.length);
  return filteredMonths
    .map((month) => {
      const planUnits = asNumber(mapping.planUnitsByMonth?.[month]);
      const liveUnits = asNumber(liveUnitsByMonth?.[month]);
      const deltaUnits = (
        Number.isFinite(planUnits)
        && Number.isFinite(liveUnits)
      ) ? Number(liveUnits) - Number(planUnits) : null;
      const deltaPct = (
        Number.isFinite(deltaUnits)
        && Number.isFinite(planUnits)
        && Number(planUnits) > 0
      ) ? (Number(deltaUnits) / Number(planUnits)) * 100 : null;
      return {
        month,
        planUnits: Number.isFinite(planUnits) ? Number(planUnits) : null,
        liveUnits: Number.isFinite(liveUnits) ? Number(liveUnits) : null,
        deltaUnits: Number.isFinite(deltaUnits) ? Number(deltaUnits) : null,
        deltaPct: Number.isFinite(deltaPct) ? Number(deltaPct) : null,
      };
    })
    .filter((row) => Number.isFinite(row.planUnits) || Number.isFinite(row.liveUnits));
}

export function monthNumberToLabel(monthNumber) {
  const numeric = asMonthNumber(monthNumber);
  if (numeric == null) return "—";
  return CALENDAR_MONTHS[numeric - 1];
}

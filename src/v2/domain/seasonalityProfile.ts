import { parseDeNumber } from "../../lib/dataHealth.js";
import { normalizeMonthKey } from "./months";

export interface SeasonalityMonthFactor {
  monthNumber: number;
  monthLabel: string;
  averageUnits: number | null;
  factor: number | null;
  sampleCount: number;
  classification: "unterdurchschnittlich" | "durchschnittlich" | "ueberdurchschnittlich" | "keine_daten";
}

export interface SeasonalityProfileResult {
  sku: string;
  startMonth: string;
  endMonth: string;
  sampleMonthCount: number;
  coveredMonthTypes: number;
  overallAverage: number | null;
  months: SeasonalityMonthFactor[];
}

const CALENDAR_MONTHS = [
  "Jan",
  "Feb",
  "Maerz",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

interface ForecastMonthPoint {
  month: string;
  monthNumber: number;
  units: number;
}

function resolveSkuMap(
  forecastImport: Record<string, unknown>,
  sku: string,
): Record<string, unknown> | null {
  if (!sku) return null;
  const direct = forecastImport?.[sku];
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }
  const lowerSku = sku.toLowerCase();
  const matchKey = Object.keys(forecastImport || {}).find((key) => key.toLowerCase() === lowerSku);
  if (!matchKey) return null;
  const matched = forecastImport?.[matchKey];
  return matched && typeof matched === "object" ? matched as Record<string, unknown> : null;
}

function parseForecastPoints(monthMap: Record<string, unknown>): ForecastMonthPoint[] {
  return Object.entries(monthMap || {})
    .map(([monthRaw, value]) => {
      const month = normalizeMonthKey(monthRaw);
      if (!month) return null;
      const monthNumber = Number(month.slice(5, 7));
      if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
      const units = (value && typeof value === "object")
        ? parseDeNumber((value as Record<string, unknown>).units)
        : parseDeNumber(value);
      if (!Number.isFinite(units as number)) return null;
      return {
        month,
        monthNumber,
        units: Number(units),
      } satisfies ForecastMonthPoint;
    })
    .filter((entry): entry is ForecastMonthPoint => Boolean(entry))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function classifyFactor(factor: number | null): SeasonalityMonthFactor["classification"] {
  if (!Number.isFinite(factor as number)) return "keine_daten";
  if (Number(factor) < 0.9) return "unterdurchschnittlich";
  if (Number(factor) > 1.1) return "ueberdurchschnittlich";
  return "durchschnittlich";
}

export function computeSeasonalityProfileFromForecastImport(input: {
  forecastImport: Record<string, unknown>;
  sku: string;
}): SeasonalityProfileResult | null {
  const sku = String(input.sku || "").trim();
  if (!sku) return null;
  const monthMap = resolveSkuMap(input.forecastImport || {}, sku);
  if (!monthMap) return null;
  const points = parseForecastPoints(monthMap);
  if (!points.length) return null;

  const grouped = Array.from({ length: 12 }, () => [] as number[]);
  points.forEach((point) => {
    grouped[point.monthNumber - 1].push(point.units);
  });

  const monthlyAverages = grouped.map((values) => {
    if (!values.length) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
  });
  const availableAverages = monthlyAverages.filter((value): value is number => Number.isFinite(value));
  const overallAverage = availableAverages.length
    ? (availableAverages.reduce((acc, value) => acc + value, 0) / availableAverages.length)
    : null;

  const months = monthlyAverages.map((averageUnits, index) => {
    const factor = (
      Number.isFinite(averageUnits as number)
      && Number.isFinite(overallAverage as number)
      && Number(overallAverage) > 0
    )
      ? Number(averageUnits) / Number(overallAverage)
      : null;
    return {
      monthNumber: index + 1,
      monthLabel: CALENDAR_MONTHS[index],
      averageUnits: Number.isFinite(averageUnits as number) ? Number(averageUnits) : null,
      factor: Number.isFinite(factor as number) ? Number(factor) : null,
      sampleCount: grouped[index].length,
      classification: classifyFactor(factor),
    } satisfies SeasonalityMonthFactor;
  });

  return {
    sku,
    startMonth: points[0].month,
    endMonth: points[points.length - 1].month,
    sampleMonthCount: points.length,
    coveredMonthTypes: months.filter((entry) => entry.sampleCount > 0).length,
    overallAverage,
    months,
  } satisfies SeasonalityProfileResult;
}

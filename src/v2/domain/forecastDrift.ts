import { parseDeNumber } from "../../lib/dataHealth.js";

type DriftProfile = "medium";

interface ForecastImportRow {
  units?: unknown;
  revenueEur?: unknown;
}

type ForecastImportMap = Record<string, Record<string, ForecastImportRow>>;

export interface ForecastDriftTopItem {
  sku: string;
  month: string;
  abcClass: "A" | "B" | "C";
  prevUnits: number;
  nextUnits: number;
  deltaUnits: number;
  deltaPct: number;
  prevRevenue: number;
  nextRevenue: number;
  deltaRevenue: number;
}

export interface ForecastDriftSummary {
  comparedAt: string;
  thresholdProfile: DriftProfile;
  flaggedSkuCount: number;
  flaggedABCount: number;
  flaggedMonthCount: number;
  topItems: ForecastDriftTopItem[];
}

interface ForecastDriftInput {
  previousImport: Record<string, unknown>;
  nextImport: Record<string, unknown>;
  products: Array<Record<string, unknown>>;
  abcBySku?: Map<string, { abcClass?: string }>;
  comparedAt?: string;
  profile?: DriftProfile;
  topN?: number;
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSkuKey(value: unknown): string {
  return normalizeSku(value).toLowerCase();
}

function isMonthKey(value: unknown): boolean {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function toNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function parseImportMap(input: Record<string, unknown>): ForecastImportMap {
  const map: ForecastImportMap = {};
  Object.entries(input || {}).forEach(([skuRaw, monthMap]) => {
    const sku = normalizeSku(skuRaw);
    if (!sku || !monthMap || typeof monthMap !== "object") return;
    const normalizedMonthMap: Record<string, ForecastImportRow> = {};
    Object.entries(monthMap as Record<string, unknown>).forEach(([month, row]) => {
      if (!isMonthKey(month) || !row || typeof row !== "object") return;
      normalizedMonthMap[month] = row as ForecastImportRow;
    });
    if (Object.keys(normalizedMonthMap).length) map[sku] = normalizedMonthMap;
  });
  return map;
}

function buildPriceBySku(products: Array<Record<string, unknown>>): Map<string, number> {
  const map = new Map<string, number>();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const sku = normalizeSku(product?.sku);
    if (!sku) return;
    const price = toNumber(product?.avgSellingPriceGrossEUR);
    if (!Number.isFinite(price as number) || Number(price) <= 0) return;
    map.set(sku, Number(price));
    map.set(normalizeSkuKey(sku), Number(price));
  });
  return map;
}

function resolveAbcClass(
  abcBySku: Map<string, { abcClass?: string }> | undefined,
  sku: string,
): "A" | "B" | "C" {
  if (!abcBySku) return "C";
  const direct = abcBySku.get(sku);
  const normalized = abcBySku.get(normalizeSkuKey(sku));
  const candidate = String(direct?.abcClass || normalized?.abcClass || "C").toUpperCase();
  if (candidate === "A" || candidate === "B" || candidate === "C") return candidate;
  return "C";
}

function readUnits(row: ForecastImportRow | undefined): number {
  const parsed = toNumber(row?.units);
  return Number.isFinite(parsed as number) ? Number(parsed) : 0;
}

function readRevenue(row: ForecastImportRow | undefined, fallbackPrice: number | null, units: number): number {
  const parsed = toNumber(row?.revenueEur);
  if (Number.isFinite(parsed as number)) return Number(parsed);
  if (Number.isFinite(fallbackPrice as number) && Number(fallbackPrice) > 0) {
    return units * Number(fallbackPrice);
  }
  return 0;
}

function shouldFlagMedium(input: {
  abcClass: "A" | "B" | "C";
  deltaPct: number;
  deltaUnits: number;
  deltaRevenue: number;
}): boolean {
  if (input.abcClass !== "A" && input.abcClass !== "B") return false;
  const pctAndUnits = Math.abs(input.deltaPct) >= 20 && Math.abs(input.deltaUnits) >= 30;
  const revenueGate = Math.abs(input.deltaRevenue) >= 1500;
  return pctAndUnits || revenueGate;
}

export function computeForecastDriftSummary(input: ForecastDriftInput): ForecastDriftSummary {
  const profile: DriftProfile = input.profile || "medium";
  const comparedAt = input.comparedAt || new Date().toISOString();
  const topN = Math.max(1, Math.round(Number(input.topN || 20)));
  const previousImport = parseImportMap(input.previousImport || {});
  const nextImport = parseImportMap(input.nextImport || {});
  const priceBySku = buildPriceBySku(input.products || []);

  const skuSet = new Set<string>([
    ...Object.keys(previousImport),
    ...Object.keys(nextImport),
  ]);
  const flagged: ForecastDriftTopItem[] = [];

  skuSet.forEach((sku) => {
    const monthSet = new Set<string>([
      ...Object.keys(previousImport[sku] || {}),
      ...Object.keys(nextImport[sku] || {}),
    ]);
    const abcClass = resolveAbcClass(input.abcBySku, sku);
    monthSet.forEach((month) => {
      const prevRow = previousImport[sku]?.[month];
      const nextRow = nextImport[sku]?.[month];
      if (!prevRow && !nextRow) return;

      const prevUnits = readUnits(prevRow);
      const nextUnits = readUnits(nextRow);
      const deltaUnits = nextUnits - prevUnits;
      const deltaPct = prevUnits === 0
        ? (nextUnits === 0 ? 0 : 100)
        : (deltaUnits / Math.abs(prevUnits)) * 100;
      const fallbackPrice = priceBySku.get(sku) ?? priceBySku.get(normalizeSkuKey(sku)) ?? null;
      const prevRevenue = readRevenue(prevRow, fallbackPrice, prevUnits);
      const nextRevenue = readRevenue(nextRow, fallbackPrice, nextUnits);
      const deltaRevenue = nextRevenue - prevRevenue;

      const shouldFlag = profile === "medium"
        ? shouldFlagMedium({ abcClass, deltaPct, deltaUnits, deltaRevenue })
        : false;
      if (!shouldFlag) return;
      flagged.push({
        sku,
        month,
        abcClass,
        prevUnits,
        nextUnits,
        deltaUnits,
        deltaPct,
        prevRevenue,
        nextRevenue,
        deltaRevenue,
      });
    });
  });

  flagged.sort((a, b) => {
    const revenue = Math.abs(b.deltaRevenue) - Math.abs(a.deltaRevenue);
    if (revenue !== 0) return revenue;
    const units = Math.abs(b.deltaUnits) - Math.abs(a.deltaUnits);
    if (units !== 0) return units;
    const pct = Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
    if (pct !== 0) return pct;
    if (a.sku !== b.sku) return a.sku.localeCompare(b.sku);
    return a.month.localeCompare(b.month);
  });

  const flaggedSkuSet = new Set(flagged.map((entry) => normalizeSkuKey(entry.sku)));
  const flaggedABSet = new Set(
    flagged
      .filter((entry) => entry.abcClass === "A" || entry.abcClass === "B")
      .map((entry) => normalizeSkuKey(entry.sku)),
  );

  return {
    comparedAt,
    thresholdProfile: profile,
    flaggedSkuCount: flaggedSkuSet.size,
    flaggedABCount: flaggedABSet.size,
    flaggedMonthCount: flagged.length,
    topItems: flagged.slice(0, topN),
  };
}

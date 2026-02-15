import { InfoCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { computeSeries, expandFixcostInstances } from "../../../domain/cashflow.js";
import {
  buildCategoryLabelMap,
  buildForecastProducts,
  deriveForecastValue,
  getEffectiveUnits,
  normalizeManualMap,
} from "../../domain/tableModels";
import { formatMonthLabel, monthRange, normalizeMonthKey } from "../../domain/months";
import { DeNumberInput } from "../../components/DeNumberInput";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

type TaxMode = "effective" | "split";
type BufferMode = "absolute" | "percent_revenue";
type PayoutTargetMode = "ratio" | "amount";
type ReadinessSeverity = "critical" | "major" | "minor";
type ReadinessLevel = "green" | "yellow" | "orange" | "red";

interface YearAssumptions {
  reserveReleaseAvailableEur: number;
  reserveReleaseUseEur: number;
  taxMode: TaxMode;
  effectiveTaxRatePct: number;
  corporateTaxRatePct: number;
  tradeTaxRatePct: number;
  otherCostsManualEur: number;
  bufferMode: BufferMode;
  bufferValue: number;
  payoutTargetMode: PayoutTargetMode;
  payoutRatioPct: number;
  desiredDividendEur: number;
}

interface CalibrationRowDraft {
  id: string;
  year: number;
  revenueEur: number | null;
  netIncomeEur: number | null;
}

interface ReadinessIssue {
  id: string;
  severity: ReadinessSeverity;
  message: string;
  route: string;
  routeLabel: string;
}

interface ProductYearMetrics {
  sku: string;
  alias: string;
  revenue: number;
  units: number;
  cogs: number;
  missingForecastMonths: string[];
  hasPrice: boolean;
  hasMargin: boolean;
  hasCostBasis: boolean;
}

interface ScenarioResult {
  taxRatePct: number;
  taxAmount: number;
  netIncome: number;
  buffer: number;
  calibrationFactor: number;
  distributable: number;
}

const TAX_MODE_OPTIONS = [
  { label: "Effektive Quote", value: "effective" },
  { label: "KSt + GewSt", value: "split" },
];

const BUFFER_MODE_OPTIONS = [
  { label: "EUR", value: "absolute" },
  { label: "% Umsatz", value: "percent_revenue" },
];

const PAYOUT_TARGET_OPTIONS = [
  { label: "Ausschüttungsquote %", value: "ratio" },
  { label: "Gewünschte Dividende EUR", value: "amount" },
];

const DEFAULT_ASSUMPTIONS: YearAssumptions = {
  reserveReleaseAvailableEur: 0,
  reserveReleaseUseEur: 0,
  taxMode: "effective",
  effectiveTaxRatePct: 30,
  corporateTaxRatePct: 15,
  tradeTaxRatePct: 14,
  otherCostsManualEur: 0,
  bufferMode: "absolute",
  bufferValue: 0,
  payoutTargetMode: "ratio",
  payoutRatioPct: 50,
  desiredDividendEur: 0,
};

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRate(value: unknown): number {
  const parsed = Number(toNumber(value) || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeMoney(value: unknown): number {
  const parsed = Number(toNumber(value) || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function fmtCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPercent(value: unknown, digits = 1): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function normalizeAssumptionRecord(input: unknown): YearAssumptions {
  const raw = (input && typeof input === "object") ? input as Record<string, unknown> : {};
  const taxMode = String(raw.taxMode || DEFAULT_ASSUMPTIONS.taxMode) === "split" ? "split" : "effective";
  const bufferMode = String(raw.bufferMode || DEFAULT_ASSUMPTIONS.bufferMode) === "percent_revenue"
    ? "percent_revenue"
    : "absolute";
  const payoutTargetMode = String(raw.payoutTargetMode || DEFAULT_ASSUMPTIONS.payoutTargetMode) === "amount"
    ? "amount"
    : "ratio";
  return {
    reserveReleaseAvailableEur: normalizeMoney(raw.reserveReleaseAvailableEur),
    reserveReleaseUseEur: normalizeMoney(raw.reserveReleaseUseEur),
    taxMode,
    effectiveTaxRatePct: normalizeRate(raw.effectiveTaxRatePct ?? DEFAULT_ASSUMPTIONS.effectiveTaxRatePct),
    corporateTaxRatePct: normalizeRate(raw.corporateTaxRatePct ?? DEFAULT_ASSUMPTIONS.corporateTaxRatePct),
    tradeTaxRatePct: normalizeRate(raw.tradeTaxRatePct ?? DEFAULT_ASSUMPTIONS.tradeTaxRatePct),
    otherCostsManualEur: normalizeMoney(raw.otherCostsManualEur),
    bufferMode,
    bufferValue: normalizeMoney(raw.bufferValue),
    payoutTargetMode,
    payoutRatioPct: normalizeRate(raw.payoutRatioPct ?? DEFAULT_ASSUMPTIONS.payoutRatioPct),
    desiredDividendEur: normalizeMoney(raw.desiredDividendEur),
  };
}

function normalizeAssumptionsByYear(input: unknown): Record<string, YearAssumptions> {
  if (!input || typeof input !== "object") return {};
  return Object.entries(input as Record<string, unknown>).reduce((acc, [year, raw]) => {
    if (!/^\d{4}$/.test(String(year || ""))) return acc;
    acc[year] = normalizeAssumptionRecord(raw);
    return acc;
  }, {} as Record<string, YearAssumptions>);
}

function normalizeCalibrationRows(input: unknown): CalibrationRowDraft[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry, index) => {
      const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
      const rawYear = Number(row.year);
      return {
        id: String(row.id || randomId(`cal-${index}`)),
        year: Number.isFinite(rawYear) ? Math.max(2000, Math.round(rawYear)) : new Date().getFullYear() - 1,
        revenueEur: toNumber(row.revenueEur),
        netIncomeEur: toNumber(row.netIncomeEur),
      } satisfies CalibrationRowDraft;
    })
    .sort((a, b) => b.year - a.year);
}

function serializeAssumptionsByYear(input: Record<string, YearAssumptions>): Record<string, YearAssumptions> {
  return Object.entries(input || {}).reduce((acc, [year, assumptions]) => {
    if (!/^\d{4}$/.test(String(year || ""))) return acc;
    acc[year] = normalizeAssumptionRecord(assumptions);
    return acc;
  }, {} as Record<string, YearAssumptions>);
}

function serializeCalibrationRows(rows: CalibrationRowDraft[]): CalibrationRowDraft[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row.id || randomId("cal")),
      year: Math.max(2000, Math.round(Number(row.year || new Date().getFullYear() - 1))),
      revenueEur: toNumber(row.revenueEur),
      netIncomeEur: toNumber(row.netIncomeEur),
    }))
    .sort((a, b) => b.year - a.year);
}

function snapshotHash(input: {
  selectedYear: number;
  assumptionsByYear: Record<string, YearAssumptions>;
  calibrationRows: CalibrationRowDraft[];
}): string {
  const assumptionsByYear = Object.fromEntries(
    Object.entries(input.assumptionsByYear || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, assumptions]) => [year, normalizeAssumptionRecord(assumptions)]),
  );
  const calibrationRows = serializeCalibrationRows(input.calibrationRows || []);
  return JSON.stringify({
    selectedYear: Math.round(Number(input.selectedYear || new Date().getFullYear())),
    assumptionsByYear,
    calibrationRows,
  });
}

function collectYearOptions(input: {
  stateObj: Record<string, unknown>;
  assumptionsByYear: Record<string, YearAssumptions>;
  calibrationRows: CalibrationRowDraft[];
}): number[] {
  const years = new Set<number>();
  const now = new Date();
  const currentYear = now.getFullYear();

  [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear, currentYear + 1].forEach((year) => {
    years.add(year);
  });

  const addMonthYear = (value: unknown): void => {
    const month = normalizeMonthKey(value);
    if (!month) return;
    years.add(Number(month.slice(0, 4)));
  };

  Object.keys(input.assumptionsByYear || {}).forEach((year) => {
    if (/^\d{4}$/.test(year)) years.add(Number(year));
  });
  (input.calibrationRows || []).forEach((row) => {
    if (Number.isFinite(row.year)) years.add(Number(row.year));
  });

  const forecast = (input.stateObj.forecast && typeof input.stateObj.forecast === "object")
    ? input.stateObj.forecast as Record<string, unknown>
    : {};
  const forecastManual = (forecast.forecastManual && typeof forecast.forecastManual === "object")
    ? forecast.forecastManual as Record<string, unknown>
    : {};
  const forecastImport = (forecast.forecastImport && typeof forecast.forecastImport === "object")
    ? forecast.forecastImport as Record<string, unknown>
    : {};

  Object.values(forecastManual).forEach((monthMap) => {
    if (!monthMap || typeof monthMap !== "object") return;
    Object.keys(monthMap as Record<string, unknown>).forEach(addMonthYear);
  });
  Object.values(forecastImport).forEach((monthMap) => {
    if (!monthMap || typeof monthMap !== "object") return;
    Object.keys(monthMap as Record<string, unknown>).forEach(addMonthYear);
  });

  (Array.isArray(input.stateObj.incomings) ? input.stateObj.incomings : []).forEach((row) => {
    const entry = row as Record<string, unknown>;
    addMonthYear(entry.month);
  });
  (Array.isArray(input.stateObj.extras) ? input.stateObj.extras : []).forEach((row) => {
    const entry = row as Record<string, unknown>;
    addMonthYear(entry.month);
    addMonthYear(String(entry.date || "").slice(0, 7));
  });
  (Array.isArray(input.stateObj.dividends) ? input.stateObj.dividends : []).forEach((row) => {
    const entry = row as Record<string, unknown>;
    addMonthYear(entry.month);
    addMonthYear(String(entry.date || "").slice(0, 7));
  });
  Object.keys((input.stateObj.monthlyActuals && typeof input.stateObj.monthlyActuals === "object")
    ? input.stateObj.monthlyActuals as Record<string, unknown>
    : {}).forEach(addMonthYear);

  (Array.isArray(input.stateObj.fixcosts) ? input.stateObj.fixcosts : []).forEach((row) => {
    const entry = row as Record<string, unknown>;
    addMonthYear(entry.startMonth);
    addMonthYear(entry.endMonth);
  });

  return Array.from(years)
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a);
}

function routeLabel(route: string): string {
  if (route.startsWith("/v2/forecast")) return "Absatzprognose";
  if (route.startsWith("/v2/products")) return "Produkte";
  if (route.startsWith("/v2/abschluss/fixkosten")) return "Fixkosten";
  if (route.startsWith("/v2/settings")) return "Settings";
  if (route.startsWith("/v2/abschluss/dividendenplanung")) return "Dividendenplanung";
  return "Modul";
}

function calculateScenario(input: {
  ebt: number;
  reserveUse: number;
  baseTaxRatePct: number;
  baseBuffer: number;
  calibrationFactor: number;
  calibrationAvailable: boolean;
  taxDeltaPct: number;
  bufferMultiplier: number;
  calibrationShiftPct: number;
}): ScenarioResult {
  const taxRatePct = Math.max(0, Math.min(60, input.baseTaxRatePct + input.taxDeltaPct));
  const taxAmount = input.ebt > 0 ? input.ebt * (taxRatePct / 100) : 0;
  const netIncome = input.ebt - taxAmount;
  const buffer = Math.max(0, input.baseBuffer * input.bufferMultiplier);
  const factor = input.calibrationAvailable
    ? Math.max(0, input.calibrationFactor * (1 + (input.calibrationShiftPct / 100)))
    : 1;
  const distributable = (netIncome + input.reserveUse - buffer) * factor;
  return {
    taxRatePct,
    taxAmount,
    netIncome,
    buffer,
    calibrationFactor: factor,
    distributable,
  };
}

function readinessColor(level: ReadinessLevel): string {
  if (level === "green") return "green";
  if (level === "yellow") return "gold";
  if (level === "orange") return "orange";
  return "red";
}

function readinessLabel(level: ReadinessLevel): string {
  if (level === "green") return "Grün";
  if (level === "yellow") return "Gelb";
  if (level === "orange") return "Orange";
  return "Rot";
}

export default function DividendPlanningModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const navigate = useNavigate();
  const stateObj = state as unknown as Record<string, unknown>;

  const now = new Date();
  const currentYear = now.getFullYear();

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [assumptionsByYear, setAssumptionsByYear] = useState<Record<string, YearAssumptions>>({
    [String(currentYear)]: { ...DEFAULT_ASSUMPTIONS },
  });
  const [calibrationRows, setCalibrationRows] = useState<CalibrationRowDraft[]>([]);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [autoSaveHint, setAutoSaveHint] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(false);

  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef("");
  const skipNextAutoSaveRef = useRef(true);

  const yearOptions = useMemo(
    () => collectYearOptions({ stateObj, assumptionsByYear, calibrationRows }),
    [assumptionsByYear, calibrationRows, stateObj],
  );

  useEffect(() => {
    const raw = (stateObj.dividendPlanning && typeof stateObj.dividendPlanning === "object")
      ? stateObj.dividendPlanning as Record<string, unknown>
      : {};
    const nextAssumptions = normalizeAssumptionsByYear(raw.assumptionsByYear);
    const nextRows = normalizeCalibrationRows(raw.calibrationRows);
    const sourceYears = collectYearOptions({
      stateObj,
      assumptionsByYear: nextAssumptions,
      calibrationRows: nextRows,
    });
    const rawSelectedYear = Number(raw.selectedYear);
    const fallbackYear = sourceYears.includes(currentYear) ? currentYear : (sourceYears[0] || currentYear);
    const nextSelectedYear = Number.isFinite(rawSelectedYear)
      ? Math.round(rawSelectedYear)
      : fallbackYear;
    if (!nextAssumptions[String(nextSelectedYear)]) {
      nextAssumptions[String(nextSelectedYear)] = { ...DEFAULT_ASSUMPTIONS };
    }

    skipNextAutoSaveRef.current = true;
    setSelectedYear(nextSelectedYear);
    setAssumptionsByYear(nextAssumptions);
    setCalibrationRows(nextRows);
    lastSavedHashRef.current = snapshotHash({
      selectedYear: nextSelectedYear,
      assumptionsByYear: nextAssumptions,
      calibrationRows: nextRows,
    });
    setHasPendingChanges(false);
    setAutoSaveHint("");
  }, [currentYear, stateObj.dividendPlanning]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const assumptionsForYear = useMemo(() => {
    const key = String(selectedYear);
    return assumptionsByYear[key] || { ...DEFAULT_ASSUMPTIONS };
  }, [assumptionsByYear, selectedYear]);

  const yearMonths = useMemo(() => monthRange(`${selectedYear}-01`, 12), [selectedYear]);

  const calculations = useMemo(() => {
    const activeAssumptions = assumptionsForYear;
    const categoriesById = buildCategoryLabelMap(stateObj);
    const forecast = (stateObj.forecast && typeof stateObj.forecast === "object")
      ? stateObj.forecast as Record<string, unknown>
      : {};
    const forecastImport = (forecast.forecastImport && typeof forecast.forecastImport === "object")
      ? forecast.forecastImport as Record<string, unknown>
      : {};
    const forecastManual = normalizeManualMap((forecast.forecastManual && typeof forecast.forecastManual === "object")
      ? forecast.forecastManual as Record<string, unknown>
      : {});
    const products = buildForecastProducts(stateObj, categoriesById).filter((product) => product.isActive);

    const liveProductBySku = new Map<string, Record<string, unknown>>();
    (Array.isArray(stateObj.products) ? stateObj.products : []).forEach((entry) => {
      const row = (entry || {}) as Record<string, unknown>;
      const sku = String(row.sku || "").trim().toLowerCase();
      if (!sku) return;
      liveProductBySku.set(sku, row);
    });

    const metrics: ProductYearMetrics[] = [];
    let revenue = 0;
    let cogs = 0;

    products.forEach((product) => {
      const sku = String(product.sku || "").trim();
      if (!sku) return;
      const alias = String(product.alias || sku).trim();
      const liveProduct = liveProductBySku.get(sku.toLowerCase()) || null;
      const price = Number(product.avgSellingPriceGrossEUR);
      const margin = Number(product.sellerboardMarginPct);
      const landedCost = Number(liveProduct?.landedUnitCostEur);

      const hasPrice = Number.isFinite(price) && price > 0;
      const hasMargin = Number.isFinite(margin) && margin > 0 && margin <= 100;
      let hasCostBasis = false;

      const missingForecastMonths: string[] = [];
      let productRevenue = 0;
      let productUnits = 0;
      let productCogs = 0;

      yearMonths.forEach((month) => {
        const unitsRaw = getEffectiveUnits(
          forecastManual,
          forecastImport,
          sku,
          month,
          product.plannedUnitsByMonth,
        );
        if (!Number.isFinite(unitsRaw as number)) {
          missingForecastMonths.push(month);
          return;
        }
        const units = Number(unitsRaw);
        productUnits += units;

        const revenueValue = deriveForecastValue("revenue", units, product);
        if (Number.isFinite(revenueValue as number)) {
          const revenueForMonth = Number(revenueValue);
          productRevenue += revenueForMonth;
          if (hasMargin) {
            const grossProfit = revenueForMonth * (margin / 100);
            productCogs += (revenueForMonth - grossProfit);
            hasCostBasis = true;
            return;
          }
        }

        if (Number.isFinite(landedCost) && landedCost > 0) {
          productCogs += units * landedCost;
          hasCostBasis = true;
          return;
        }
      });

      revenue += productRevenue;
      cogs += productCogs;
      metrics.push({
        sku,
        alias,
        revenue: productRevenue,
        units: productUnits,
        cogs: productCogs,
        missingForecastMonths,
        hasPrice,
        hasMargin,
        hasCostBasis,
      });
    });

    const extrasOutflow = (Array.isArray(stateObj.extras) ? stateObj.extras : []).reduce((sum, entry) => {
      const row = entry as Record<string, unknown>;
      const month = normalizeMonthKey(row.month || String(row.date || "").slice(0, 7));
      if (!month || !month.startsWith(`${selectedYear}-`)) return sum;
      const amount = Number(toNumber(row.amountEur) || 0);
      if (amount >= 0) return sum;
      return sum + Math.abs(amount);
    }, 0);

    const manualOtherCosts = normalizeMoney(activeAssumptions.otherCostsManualEur);
    const otherCosts = extrasOutflow + manualOtherCosts;

    const fixcostInstances = expandFixcostInstances(stateObj, { months: yearMonths, today: new Date() }) as Array<{ amount?: number }>;
    const fixcost = fixcostInstances.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

    const ebt = revenue - cogs - fixcost - otherCosts;
    const baseTaxRate = activeAssumptions.taxMode === "effective"
      ? normalizeRate(activeAssumptions.effectiveTaxRatePct)
      : normalizeRate(activeAssumptions.corporateTaxRatePct) + normalizeRate(activeAssumptions.tradeTaxRatePct);
    const taxes = ebt > 0 ? ebt * (baseTaxRate / 100) : 0;
    const netIncome = ebt - taxes;

    const reserveAvailable = normalizeMoney(activeAssumptions.reserveReleaseAvailableEur);
    const reserveUseRequested = normalizeMoney(activeAssumptions.reserveReleaseUseEur);
    const reserveUse = Math.min(reserveAvailable, reserveUseRequested);

    const baseBuffer = activeAssumptions.bufferMode === "percent_revenue"
      ? revenue * (normalizeRate(activeAssumptions.bufferValue) / 100)
      : normalizeMoney(activeAssumptions.bufferValue);

    const distributableBase = netIncome + reserveUse - baseBuffer;

    const validCalibrationRows = calibrationRows.filter((row) => {
      const yearValid = Number.isFinite(row.year) && row.year >= 2000;
      const revenueValid = Number.isFinite(row.revenueEur as number) && Number(row.revenueEur) > 0;
      const netIncomeValid = Number.isFinite(row.netIncomeEur as number);
      return yearValid && revenueValid && netIncomeValid;
    });
    const calibrationRevenue = validCalibrationRows.reduce((sum, row) => sum + Number(row.revenueEur || 0), 0);
    const calibrationNetIncome = validCalibrationRows.reduce((sum, row) => sum + Number(row.netIncomeEur || 0), 0);
    const historicalMargin = calibrationRevenue > 0 ? calibrationNetIncome / calibrationRevenue : null;
    const planMargin = revenue > 0 ? netIncome / revenue : null;
    const calibrationAvailable = Number.isFinite(historicalMargin as number) && Number.isFinite(planMargin as number) && Math.abs(Number(planMargin)) > 0.00001;
    const calibrationFactor = calibrationAvailable
      ? Math.max(0.5, Math.min(1.5, Number(historicalMargin) / Number(planMargin)))
      : 1;

    const conservativeScenario = calculateScenario({
      ebt,
      reserveUse,
      baseTaxRatePct: baseTaxRate,
      baseBuffer,
      calibrationFactor,
      calibrationAvailable,
      taxDeltaPct: 3,
      bufferMultiplier: 1.2,
      calibrationShiftPct: -8,
    });
    const realisticScenario = calculateScenario({
      ebt,
      reserveUse,
      baseTaxRatePct: baseTaxRate,
      baseBuffer,
      calibrationFactor,
      calibrationAvailable,
      taxDeltaPct: 0,
      bufferMultiplier: 1,
      calibrationShiftPct: 0,
    });
    const aggressiveScenario = calculateScenario({
      ebt,
      reserveUse,
      baseTaxRatePct: baseTaxRate,
      baseBuffer,
      calibrationFactor,
      calibrationAvailable,
      taxDeltaPct: -2,
      bufferMultiplier: 0.8,
      calibrationShiftPct: 8,
    });

    const sortedByRevenue = metrics
      .slice()
      .sort((a, b) => b.revenue - a.revenue);
    const totalRevenueForAbc = sortedByRevenue.reduce((sum, row) => sum + row.revenue, 0);
    const relevantSkuSet = new Set<string>();
    if (totalRevenueForAbc > 0) {
      let cumulative = 0;
      sortedByRevenue.forEach((row, index) => {
        if (row.revenue <= 0) return;
        cumulative += row.revenue;
        const share = cumulative / totalRevenueForAbc;
        if (share <= 0.8 || index === 0) {
          relevantSkuSet.add(row.sku.toLowerCase());
        }
      });
    }
    if (!relevantSkuSet.size) {
      sortedByRevenue.forEach((row) => relevantSkuSet.add(row.sku.toLowerCase()));
    }

    const relevantMetrics = metrics.filter((row) => relevantSkuSet.has(row.sku.toLowerCase()));
    const forecastMissingDetail = relevantMetrics.flatMap((row) =>
      row.missingForecastMonths.map((month) => ({ sku: row.sku, month })),
    );
    const missingPrice = metrics.filter((row) => !row.hasPrice);
    const missingMargin = metrics.filter((row) => !row.hasMargin);
    const missingCostBasis = metrics.filter((row) => !row.hasCostBasis && row.units > 0);

    const fixcostRows = Array.isArray(stateObj.fixcosts) ? stateObj.fixcosts as Record<string, unknown>[] : [];
    const yearEndMonth = `${selectedYear}-12`;
    const hasFixcostRows = fixcostRows.length > 0;
    const fixcostCoversYearEnd = hasFixcostRows && fixcostRows.some((row) => {
      const startMonth = normalizeMonthKey(row.startMonth) || yearEndMonth;
      const endMonth = normalizeMonthKey(row.endMonth);
      const amount = Number(toNumber(row.amount) || 0);
      if (!(amount > 0)) return false;
      if (startMonth > yearEndMonth) return false;
      if (endMonth && endMonth < yearEndMonth) return false;
      return true;
    });

    const taxAssumptionSet = activeAssumptions.taxMode === "effective"
      ? Number.isFinite(activeAssumptions.effectiveTaxRatePct)
      : (Number.isFinite(activeAssumptions.corporateTaxRatePct) && Number.isFinite(activeAssumptions.tradeTaxRatePct));

    const readinessIssues: ReadinessIssue[] = [];
    const pushIssue = (issue: Omit<ReadinessIssue, "routeLabel">): void => {
      readinessIssues.push({
        ...issue,
        routeLabel: routeLabel(issue.route),
      });
    };

    if (!metrics.length) {
      pushIssue({
        id: "no-active-products",
        severity: "critical",
        message: "Keine aktiven Produkte mit Forecast-Basis vorhanden.",
        route: "/v2/products",
      });
    }

    if (revenue <= 0) {
      pushIssue({
        id: "no-revenue-basis",
        severity: "critical",
        message: `Keine Umsatzbasis für ${selectedYear}. Forecast oder VK-Preise fehlen.`,
        route: "/v2/forecast",
      });
    }

    if (forecastMissingDetail.length > 0 && relevantMetrics.length > 0) {
      const totalPoints = relevantMetrics.length * yearMonths.length;
      const ratio = totalPoints > 0 ? forecastMissingDetail.length / totalPoints : 0;
      const severity: ReadinessSeverity = ratio >= 0.5 ? "critical" : ratio >= 0.2 ? "major" : "minor";
      const sample = forecastMissingDetail
        .slice(0, 3)
        .map((entry) => `${entry.sku} ${formatMonthLabel(entry.month)}`)
        .join(", ");
      pushIssue({
        id: "forecast-gaps",
        severity,
        message: `${forecastMissingDetail.length}/${totalPoints} Forecast-Werte fehlen (${sample || "Details"}).`,
        route: "/v2/forecast",
      });
    }

    if (missingPrice.length > 0) {
      const severity: ReadinessSeverity = missingPrice.length >= Math.max(1, Math.round(metrics.length * 0.5))
        ? "critical"
        : "major";
      const sample = missingPrice.slice(0, 4).map((row) => row.sku).join(", ");
      pushIssue({
        id: "missing-price",
        severity,
        message: `VK-Preis fehlt für ${missingPrice.length} SKU(s): ${sample}${missingPrice.length > 4 ? " ..." : ""}`,
        route: "/v2/products?issues=revenue&expand=all",
      });
    }

    if (missingMargin.length > 0) {
      const severity: ReadinessSeverity = missingMargin.length >= Math.max(1, Math.round(metrics.length * 0.5))
        ? "major"
        : "minor";
      const sample = missingMargin.slice(0, 4).map((row) => row.sku).join(", ");
      pushIssue({
        id: "missing-margin",
        severity,
        message: `Marge fehlt für ${missingMargin.length} SKU(s): ${sample}${missingMargin.length > 4 ? " ..." : ""}`,
        route: "/v2/products?issues=revenue&expand=all",
      });
    }

    if (missingCostBasis.length > 0) {
      const sample = missingCostBasis.slice(0, 4).map((row) => row.sku).join(", ");
      pushIssue({
        id: "missing-cost-basis",
        severity: "major",
        message: `COGS-Basis fehlt für ${missingCostBasis.length} SKU(s): ${sample}${missingCostBasis.length > 4 ? " ..." : ""}`,
        route: "/v2/products?issues=needs_fix&expand=all",
      });
    }

    if (!hasFixcostRows) {
      pushIssue({
        id: "no-fixcosts",
        severity: "critical",
        message: "Keine Fixkostenbasis vorhanden.",
        route: "/v2/abschluss/fixkosten",
      });
    } else if (!fixcostCoversYearEnd) {
      pushIssue({
        id: "fixcost-range",
        severity: "major",
        message: `Fixkosten sind nicht bis Jahresende ${selectedYear} hinterlegt.`,
        route: "/v2/abschluss/fixkosten",
      });
    }

    if (!taxAssumptionSet) {
      pushIssue({
        id: "missing-tax-assumption",
        severity: "critical",
        message: "Steuerannahme ist nicht vollständig gesetzt.",
        route: "/v2/settings",
      });
    }

    if (baseBuffer <= 0 && validCalibrationRows.length === 0) {
      pushIssue({
        id: "buffer-or-calibration",
        severity: "major",
        message: "Weder Puffer noch Kalibrierung vorhanden.",
        route: "/v2/abschluss/dividendenplanung",
      });
    } else if (validCalibrationRows.length === 0) {
      pushIssue({
        id: "no-calibration",
        severity: "minor",
        message: "Kalibrierung fehlt (optional, verbessert Realismus).",
        route: "/v2/abschluss/dividendenplanung",
      });
    }

    const criticalCount = readinessIssues.filter((issue) => issue.severity === "critical").length;
    const majorCount = readinessIssues.filter((issue) => issue.severity === "major").length;
    const minorCount = readinessIssues.filter((issue) => issue.severity === "minor").length;

    let readinessLevel: ReadinessLevel = "green";
    if (criticalCount > 0) readinessLevel = "red";
    else if (majorCount >= 2) readinessLevel = "orange";
    else if (majorCount > 0 || minorCount > 0) readinessLevel = "yellow";

    const liquidityBreakdown = (() => {
      try {
        const result = computeSeries(stateObj) as { breakdown?: Array<{ month?: string; closing?: number }> };
        return Array.isArray(result?.breakdown) ? result.breakdown : [];
      } catch {
        return [];
      }
    })();

    const liquidityRows = liquidityBreakdown
      .filter((row) => String(row.month || "").startsWith(`${selectedYear}-`))
      .sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));
    const latestLiquidityRow = liquidityRows.length ? liquidityRows[liquidityRows.length - 1] : null;
    const latestLiquidityClosing = latestLiquidityRow ? Number(latestLiquidityRow.closing || 0) : null;

    return {
      metrics,
      revenue,
      cogs,
      fixcost,
      extrasOutflow,
      manualOtherCosts,
      otherCosts,
      ebt,
      taxes,
      netIncome,
      reserveUse,
      reserveAvailable,
      baseTaxRate,
      baseBuffer,
      distributableBase,
      validCalibrationRows,
      historicalMargin,
      planMargin,
      calibrationAvailable,
      calibrationFactor,
      conservativeScenario,
      realisticScenario,
      aggressiveScenario,
      readinessIssues,
      readinessLevel,
      latestLiquidityRow,
      latestLiquidityClosing,
    };
  }, [assumptionsForYear, calibrationRows, selectedYear, stateObj, yearMonths]);

  const band = useMemo(() => ({
    conservative: Math.max(0, calculations.conservativeScenario.distributable),
    realistic: Math.max(0, calculations.realisticScenario.distributable),
    aggressive: Math.max(0, calculations.aggressiveScenario.distributable),
  }), [calculations]);

  const targetDividend = useMemo(() => {
    if (assumptionsForYear.payoutTargetMode === "amount") {
      return normalizeMoney(assumptionsForYear.desiredDividendEur);
    }
    return band.realistic * (normalizeRate(assumptionsForYear.payoutRatioPct) / 100);
  }, [assumptionsForYear.desiredDividendEur, assumptionsForYear.payoutRatioPct, assumptionsForYear.payoutTargetMode, band.realistic]);

  const payoutFeasible = targetDividend <= band.realistic;
  const retainedInCompany = band.realistic - targetDividend;

  async function saveDraft(source: string): Promise<void> {
    const assumptions = serializeAssumptionsByYear(assumptionsByYear);
    if (!assumptions[String(selectedYear)]) {
      assumptions[String(selectedYear)] = { ...DEFAULT_ASSUMPTIONS };
    }
    const rows = serializeCalibrationRows(calibrationRows);
    const hash = snapshotHash({
      selectedYear,
      assumptionsByYear: assumptions,
      calibrationRows: rows,
    });
    if (hash === lastSavedHashRef.current) {
      setHasPendingChanges(false);
      return;
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const target = next as unknown as Record<string, unknown>;
      target.dividendPlanning = {
        selectedYear,
        assumptionsByYear: assumptions,
        calibrationRows: rows,
      };
      return next;
    }, source);
    lastSavedHashRef.current = hash;
    setHasPendingChanges(false);
    setAutoSaveHint(`Gespeichert: ${new Date().toLocaleTimeString("de-DE")}`);
  }

  function scheduleAutoSave(delayMs = 420): void {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (saving) {
        scheduleAutoSave(180);
        return;
      }
      void saveDraft("v2:dividend-planning:auto");
    }, Math.max(120, Number(delayMs) || 420));
  }

  useEffect(() => {
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }
    const hash = snapshotHash({
      selectedYear,
      assumptionsByYear,
      calibrationRows,
    });
    const pending = hash !== lastSavedHashRef.current;
    setHasPendingChanges(pending);
    if (!pending) return;
    setAutoSaveHint("Ungespeicherte Aenderungen");
    scheduleAutoSave(420);
  }, [assumptionsByYear, calibrationRows, selectedYear]);

  function updateAssumption<K extends keyof YearAssumptions>(key: K, value: YearAssumptions[K]): void {
    setAssumptionsByYear((prev) => {
      const yearKey = String(selectedYear);
      const current = prev[yearKey] || { ...DEFAULT_ASSUMPTIONS };
      return {
        ...prev,
        [yearKey]: {
          ...current,
          [key]: value,
        },
      };
    });
  }

  const guvRows = [
    { key: "revenue", label: "Umsatz (Plan, brutto)", value: calculations.revenue },
    { key: "cogs", label: "Wareneinsatz / COGS (Plan)", value: -calculations.cogs },
    { key: "fixcost", label: "Fixkosten (Plan)", value: -calculations.fixcost },
    { key: "other", label: "Sonstige Kosten (Plan)", value: -calculations.otherCosts },
    { key: "ebt", label: "Ergebnis vor Steuern (EBT)", value: calculations.ebt, strong: true },
    { key: "tax", label: "Ertragsteuern (Plan)", value: -calculations.taxes },
    { key: "net", label: "Jahresüberschuss (Plan)", value: calculations.netIncome, strong: true },
  ];

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Dividendenplanung</Title>
            <Paragraph>
              Planung für ein Geschäftsjahr mit Plan-GuV, ausschüttungsfähigem Betrag, Bandbreite und Reifegrad-Ampel.
            </Paragraph>
          </div>
          <Space wrap align="start">
            <div className="v2-toolbar-field">
              <Text strong>Jahr</Text>
              <Select
                value={selectedYear}
                onChange={(value) => setSelectedYear(Number(value))}
                options={yearOptions.map((year) => ({ value: year, label: String(year) }))}
                style={{ minWidth: 120 }}
              />
            </div>
            <Button
              className={`v2-dividend-traffic v2-dividend-traffic--${calculations.readinessLevel}`}
              onClick={() => setReadinessOpen(true)}
            >
              Ampel: {readinessLabel(calculations.readinessLevel)}
            </Button>
          </Space>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="blue">Planung für Jahr {selectedYear}</Tag>
            <Tag color={readinessColor(calculations.readinessLevel)}>
              Reifegrad: {readinessLabel(calculations.readinessLevel)}
            </Tag>
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {hasPendingChanges ? <Tag color="gold">Ungespeicherte Aenderungen</Tag> : <Tag color="green">Synchron</Tag>}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
            {autoSaveHint ? <Tag color={hasPendingChanges ? "gold" : "blue"}>{autoSaveHint}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <div className="v2-dividend-kpi-grid">
        <Card>
          <Statistic title="Jahresüberschuss (Plan)" value={calculations.netIncome} precision={2} formatter={(value) => fmtCurrency(value)} />
        </Card>
        <Card>
          <Statistic
            title="Ausschüttungsfähiger Betrag (Plan)"
            value={calculations.distributableBase}
            precision={2}
            formatter={(value) => fmtCurrency(value)}
          />
          <Text type="secondary">
            Formel: Jahresüberschuss + Rücklagennutzung − Puffer
          </Text>
        </Card>
        <Card>
          <div className="v2-dividend-band-head">
            <Text strong>Dividenden-Bandbreite</Text>
            <Tooltip title="Konservativ: höhere Steuerquote + größerer Puffer. Realistisch: Basiswerte (inkl. optionaler Kalibrierung). Aggressiv: niedrigere Steuerquote + kleinerer Puffer.">
              <InfoCircleOutlined />
            </Tooltip>
          </div>
          <div className="v2-dividend-band-grid">
            <div>
              <Text type="secondary">Konservativ</Text>
              <div>{fmtCurrency(band.conservative)}</div>
            </div>
            <div>
              <Text type="secondary">Realistisch</Text>
              <div>{fmtCurrency(band.realistic)}</div>
            </div>
            <div>
              <Text type="secondary">Aggressiv</Text>
              <div>{fmtCurrency(band.aggressive)}</div>
            </div>
          </div>
        </Card>
      </div>

      {calculations.latestLiquidityRow ? (
        calculations.latestLiquidityClosing != null && calculations.latestLiquidityClosing < 0 ? (
          <Alert
            type="warning"
            showIcon
            message={`Liquiditätswarnung: Kontostand zum ${String(calculations.latestLiquidityRow.month)} voraussichtlich negativ (${fmtCurrency(calculations.latestLiquidityClosing)}).`}
          />
        ) : (
          <Alert
            type="success"
            showIcon
            message={`Liquidität ok: letzter geplanter Kontostand in ${selectedYear} (${String(calculations.latestLiquidityRow.month)}) ist ${fmtCurrency(calculations.latestLiquidityClosing)}.`}
          />
        )
      ) : (
        <Alert
          type="info"
          showIcon
          message={`Für ${selectedYear} liegt im Cashflow-Horizont aktuell kein Monatsabschluss vor. Liquiditätsprüfung daher nur eingeschränkt möglich.`}
        />
      )}

      <Card>
        <Title level={5}>Plan-GuV ({selectedYear})</Title>
        <Text type="secondary">
          Umsatzbasis = Forecast-Units × Ø VK-Preis (brutto). COGS werden primär über Brutto-Marge je Produkt abgeleitet.
        </Text>
        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Position</th>
                <th style={{ textAlign: "right" }}>Wert</th>
              </tr>
            </thead>
            <tbody>
              {guvRows.map((row) => (
                <tr key={row.key}>
                  <td>{row.strong ? <Text strong>{row.label}</Text> : row.label}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.strong ? <Text strong>{fmtCurrency(row.value)}</Text> : fmtCurrency(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card>
            <Title level={5}>Annahmen / Ergänzungen</Title>
            <Space direction="vertical" style={{ width: "100%" }} size={14}>
              <div className="v2-dividend-field">
                <Text>Auflösbare Rücklagen aus UG→GmbH (EUR)</Text>
                <DeNumberInput
                  mode="decimal"
                  min={0}
                  value={assumptionsForYear.reserveReleaseAvailableEur}
                  onChange={(value) => updateAssumption("reserveReleaseAvailableEur", normalizeMoney(value))}
                />
              </div>
              <div className="v2-dividend-field">
                <Text>Davon in diesem Jahr nutzen (EUR)</Text>
                <DeNumberInput
                  mode="decimal"
                  min={0}
                  value={assumptionsForYear.reserveReleaseUseEur}
                  onChange={(value) => updateAssumption("reserveReleaseUseEur", normalizeMoney(value))}
                />
                {assumptionsForYear.reserveReleaseUseEur > assumptionsForYear.reserveReleaseAvailableEur ? (
                  <Text type="warning">Nutzung wird auf die verfügbaren Rücklagen begrenzt.</Text>
                ) : null}
              </div>

              <div className="v2-dividend-field">
                <Text strong>Steuerannahme (Näherung)</Text>
                <Segmented
                  value={assumptionsForYear.taxMode}
                  options={TAX_MODE_OPTIONS}
                  onChange={(value) => updateAssumption("taxMode", String(value) === "split" ? "split" : "effective")}
                />
                {assumptionsForYear.taxMode === "effective" ? (
                  <div>
                    <Text>Effektive Steuerquote auf EBT (%)</Text>
                    <DeNumberInput
                      mode="percent"
                      min={0}
                      max={100}
                      value={assumptionsForYear.effectiveTaxRatePct}
                      onChange={(value) => updateAssumption("effectiveTaxRatePct", normalizeRate(value))}
                    />
                  </div>
                ) : (
                  <Row gutter={[10, 10]}>
                    <Col xs={24} md={12}>
                      <Text>KSt (%)</Text>
                      <DeNumberInput
                        mode="percent"
                        min={0}
                        max={100}
                        value={assumptionsForYear.corporateTaxRatePct}
                        onChange={(value) => updateAssumption("corporateTaxRatePct", normalizeRate(value))}
                      />
                    </Col>
                    <Col xs={24} md={12}>
                      <Text>GewSt (%)</Text>
                      <DeNumberInput
                        mode="percent"
                        min={0}
                        max={100}
                        value={assumptionsForYear.tradeTaxRatePct}
                        onChange={(value) => updateAssumption("tradeTaxRatePct", normalizeRate(value))}
                      />
                    </Col>
                  </Row>
                )}
                <Text type="secondary">Näherung, ersetzt keine Steuerberatung.</Text>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card>
            <Title level={5}>Puffer, Zieldividende, Machbarkeit</Title>
            <Space direction="vertical" style={{ width: "100%" }} size={14}>
              <div className="v2-dividend-field">
                <Text>Zusätzliche sonstige Kosten (EUR)</Text>
                <DeNumberInput
                  mode="decimal"
                  min={0}
                  value={assumptionsForYear.otherCostsManualEur}
                  onChange={(value) => updateAssumption("otherCostsManualEur", normalizeMoney(value))}
                />
                <Text type="secondary">
                  Abgeleitete Extras (Out) in {selectedYear}: {fmtCurrency(calculations.extrasOutflow)}
                </Text>
              </div>

              <div className="v2-dividend-field">
                <Text>Sonstige Kosten-Puffer</Text>
                <Segmented
                  value={assumptionsForYear.bufferMode}
                  options={BUFFER_MODE_OPTIONS}
                  onChange={(value) => updateAssumption("bufferMode", String(value) === "percent_revenue" ? "percent_revenue" : "absolute")}
                />
                <DeNumberInput
                  mode={assumptionsForYear.bufferMode === "percent_revenue" ? "percent" : "decimal"}
                  min={0}
                  value={assumptionsForYear.bufferValue}
                  onChange={(value) => updateAssumption("bufferValue", normalizeMoney(value))}
                />
                <Text type="secondary">Wirkt im Ausschüttungsbetrag als Sicherheitsabzug: {fmtCurrency(calculations.baseBuffer)}</Text>
              </div>

              <div className="v2-dividend-field">
                <Text>Ausschüttungsziel</Text>
                <Segmented
                  value={assumptionsForYear.payoutTargetMode}
                  options={PAYOUT_TARGET_OPTIONS}
                  onChange={(value) => updateAssumption("payoutTargetMode", String(value) === "amount" ? "amount" : "ratio")}
                />
                {assumptionsForYear.payoutTargetMode === "ratio" ? (
                  <DeNumberInput
                    mode="percent"
                    min={0}
                    max={100}
                    value={assumptionsForYear.payoutRatioPct}
                    onChange={(value) => updateAssumption("payoutRatioPct", normalizeRate(value))}
                  />
                ) : (
                  <DeNumberInput
                    mode="decimal"
                    min={0}
                    value={assumptionsForYear.desiredDividendEur}
                    onChange={(value) => updateAssumption("desiredDividendEur", normalizeMoney(value))}
                  />
                )}
                <div className="v2-dividend-feasibility">
                  <Tag color={payoutFeasible ? "green" : "red"}>
                    Machbarkeit: {payoutFeasible ? "Ja (Plan)" : "Nein (Plan)"}
                  </Tag>
                  <Tag color={retainedInCompany >= 0 ? "blue" : "red"}>
                    Rest im Unternehmen: {fmtCurrency(retainedInCompany)}
                  </Tag>
                </div>
                <Text type="secondary">Gewünschte Dividende: {fmtCurrency(targetDividend)}</Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card>
        <div className="v2-dividend-calibration-head">
          <div>
            <Title level={5}>Kalibrierung (Vorjahre)</Title>
            <Text type="secondary">Jahr | Umsatz (Abschluss) | Jahresüberschuss (Abschluss)</Text>
          </div>
          <Button
            onClick={() => {
              setCalibrationRows((prev) => [
                ...prev,
                {
                  id: randomId("cal"),
                  year: selectedYear - 1,
                  revenueEur: null,
                  netIncomeEur: null,
                },
              ]);
            }}
          >
            Vorjahr hinzufügen
          </Button>
        </div>

        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Jahr</th>
                <th>Umsatz (Abschluss)</th>
                <th>Jahresüberschuss (Abschluss)</th>
                <th>JÜ-Quote</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {calibrationRows.length ? calibrationRows.map((row) => {
                const quote = Number(row.revenueEur) > 0 && Number.isFinite(row.netIncomeEur as number)
                  ? (Number(row.netIncomeEur) / Number(row.revenueEur)) * 100
                  : null;
                return (
                  <tr key={row.id}>
                    <td style={{ width: 120 }}>
                      <DeNumberInput
                        mode="int"
                        min={2000}
                        max={2100}
                        value={row.year}
                        onChange={(value) => {
                          setCalibrationRows((prev) => prev.map((entry) => entry.id === row.id
                            ? { ...entry, year: Math.max(2000, Math.round(Number(value || row.year))) }
                            : entry));
                        }}
                      />
                    </td>
                    <td style={{ width: 220 }}>
                      <DeNumberInput
                        mode="decimal"
                        min={0}
                        value={row.revenueEur ?? undefined}
                        onChange={(value) => {
                          setCalibrationRows((prev) => prev.map((entry) => entry.id === row.id
                            ? { ...entry, revenueEur: toNumber(value) }
                            : entry));
                        }}
                      />
                    </td>
                    <td style={{ width: 220 }}>
                      <DeNumberInput
                        mode="decimal"
                        value={row.netIncomeEur ?? undefined}
                        onChange={(value) => {
                          setCalibrationRows((prev) => prev.map((entry) => entry.id === row.id
                            ? { ...entry, netIncomeEur: toNumber(value) }
                            : entry));
                        }}
                      />
                    </td>
                    <td style={{ width: 140 }}>{fmtPercent(quote, 2)}</td>
                    <td style={{ width: 110 }}>
                      <Button
                        danger
                        onClick={() => {
                          setCalibrationRows((prev) => prev.filter((entry) => entry.id !== row.id));
                        }}
                      >
                        Entfernen
                      </Button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5}>
                    <Text type="secondary">Kalibrierung fehlt. Die Planung funktioniert trotzdem.</Text>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="v2-dividend-calibration-meta">
          <Tag color={calculations.calibrationAvailable ? "green" : "gold"}>
            Kalibrierung {calculations.calibrationAvailable ? "aktiv" : "nicht aktiv"}
          </Tag>
          <Tag>
            Faktor (realistisch): {calculations.calibrationFactor.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Tag>
          <Tag>
            Historische JÜ-Quote: {fmtPercent(
              Number.isFinite(calculations.historicalMargin as number) ? Number(calculations.historicalMargin) * 100 : null,
              2,
            )}
          </Tag>
          <Tag>
            Plan JÜ-Quote: {fmtPercent(
              Number.isFinite(calculations.planMargin as number) ? Number(calculations.planMargin) * 100 : null,
              2,
            )}
          </Tag>
        </div>
      </Card>

      <Modal
        title={`Reifegrad-Ampel (${readinessLabel(calculations.readinessLevel)})`}
        open={readinessOpen}
        onCancel={() => setReadinessOpen(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {calculations.readinessIssues.length === 0 ? (
            <Alert
              type="success"
              showIcon
              message="Keine offenen Punkte. Die Schätzung ist für die Planung belastbar."
            />
          ) : (
            calculations.readinessIssues.map((issue) => (
              <div key={issue.id} className="v2-dividend-issue-row">
                <Space wrap>
                  <Tag color={issue.severity === "critical" ? "red" : issue.severity === "major" ? "orange" : "gold"}>
                    {issue.severity === "critical" ? "Kritisch" : issue.severity === "major" ? "Relevant" : "Hinweis"}
                  </Tag>
                  <Text>{issue.message}</Text>
                </Space>
                <Button
                  size="small"
                  onClick={() => {
                    setReadinessOpen(false);
                    navigate(issue.route);
                  }}
                >
                  Zu {issue.routeLabel}
                </Button>
              </div>
            ))
          )}
        </Space>
      </Modal>
    </div>
  );
}

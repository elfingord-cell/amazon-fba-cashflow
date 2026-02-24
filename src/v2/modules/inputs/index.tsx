import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Modal,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { parseDeNumber } from "../../../lib/dataHealth.js";
import {
  CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  CASH_IN_QUOTE_MAX_PCT,
  CASH_IN_QUOTE_MIN_PCT,
  buildCalibrationProfile,
  buildHistoricalPayoutPrior,
  buildPayoutRecommendation,
  clampPct,
  normalizeCalibrationHorizonMonths,
  normalizeRevenueCalibrationMode,
  parsePayoutPctInput,
} from "../../../domain/cashInRules.js";
import { buildEffectiveCashInByMonth } from "../../../domain/cashflow.js";
import { addMonths, currentMonthKey, formatMonthLabel, monthRange } from "../../domain/months";
import {
  buildCategoryLabelMap,
  buildForecastProducts,
  buildForecastRevenueByMonth,
  normalizeManualMap,
} from "../../domain/tableModels";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { randomId } from "../../domain/orderUtils";
import { DeNumberInput } from "../../components/DeNumberInput";
import { StatsTableShell } from "../../components/StatsTableShell";

const { Paragraph, Text, Title } = Typography;

const PAYOUT_DELTA_WARNING_PCT = 3;

interface IncomingDraft {
  id: string;
  month: string;
  revenueEur: number | null;
  payoutPct: number | null;
  source: "manual" | "forecast";
  calibrationCutoffDate: string | null;
  calibrationRevenueToDateEur: number | null;
  calibrationPayoutRateToDatePct: number | null;
  calibrationSellerboardMonthEndEur: number | null;
}

interface ExtraDraft {
  id: string;
  date: string;
  label: string;
  amountEur: number | null;
}

interface DividendDraft {
  id: string;
  month: string;
  label: string;
  amountEur: number | null;
}

interface MonthlyActualDraft {
  month: string;
  realRevenueEUR: number | null;
  realPayoutRatePct: number | null;
  realClosingBalanceEUR: number | null;
}

interface InputsDraftSnapshot {
  openingBalance: number;
  startMonth: string;
  horizonMonths: number;
  cashInCalibrationEnabled: boolean;
  cashInCalibrationHorizonMonths: number;
  cashInCalibrationMode: "basis" | "conservative";
  cashInRecommendationIgnoreQ4: boolean;
  cashInRecommendationBaselineNormalPct: number;
  cashInRecommendationBaselineQ4Pct: number | null;
  cashInLearning: Record<string, unknown> | null;
  incomings: IncomingDraft[];
  extras: ExtraDraft[];
  dividends: DividendDraft[];
  monthlyActuals: MonthlyActualDraft[];
}

interface RecommendationByMonthEntry {
  quotePct: number;
  sourceTag: "IST" | "RECOMMENDED_PLAN" | "RECOMMENDED_BASIS" | "RECOMMENDED_CONSERVATIVE" | "PROGNOSE" | string;
  explanation?: string;
  mode?: "plan" | "basis" | "conservative" | "ist" | string;
  levelPct?: number;
  seasonalityPct?: number;
  seasonalityRawPct?: number;
  seasonalityPriorPct?: number;
  seasonalityWeight?: number;
  seasonalitySampleCount?: number;
  shrinkageActive?: boolean;
  riskBasePct?: number;
  riskAdjustmentPct?: number;
  horizonMonths?: number;
  capApplied?: boolean;
  capsApplied?: string[];
  liveSignalUsed?: boolean;
  liveSignalWeight?: number;
  liveSignalQuotePct?: number;
  seasonalityEnabled?: boolean;
}

type CashInQuoteMode = "manual" | "recommendation";
type CashInRevenueBasisMode = "hybrid" | "forecast_direct";
type CashInTableFocus = "revenue" | "payout";

interface CashInMonthMatrixRow {
  rowId: string;
  month: string;
  monthLabel: string;
  forecastRevenue: number;
  calibratedRevenue: number;
  manualRevenue: number | null;
  hasManualRevenue: boolean;
  manualQuote: number | null;
  recommendedQuote: number | null;
  recommendationSourceLabel: string;
  recommendationTooltip: string;
  usedRevenue: number | null;
  usedRevenueSource: string | null;
  usedQuote: number | null;
  usedQuoteSource: string | null;
  usedPayout: number;
}

function isEditableNode(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches("input:not([type='hidden']), textarea, [contenteditable='true']")) return true;
  if (target.closest(".ant-select, .ant-picker, .ant-input-number")) return true;
  return false;
}

function isMonthKey(value: unknown): boolean {
  return /^\d{4}-\d{2}$/.test(String(value || "").trim());
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function normalizeMonth(value: unknown, fallback = currentMonthKey()): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return fallback;
}

function normalizeIncomingRow(entry: Record<string, unknown>, fallbackMonth: string): IncomingDraft {
  const rawCutoffDate = String(entry.calibrationCutoffDate || "").trim();
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(rawCutoffDate) ? rawCutoffDate : null;
  return {
    id: String(entry.id || randomId("inc")),
    month: normalizeMonth(entry.month, fallbackMonth),
    revenueEur: toNumber(entry.revenueEur),
    payoutPct: toNumber(entry.payoutPct),
    source: String(entry.source || "manual") === "forecast" ? "forecast" : "manual",
    calibrationCutoffDate: cutoffDate,
    calibrationRevenueToDateEur: toNumber(entry.calibrationRevenueToDateEur),
    calibrationPayoutRateToDatePct: toNumber(entry.calibrationPayoutRateToDatePct),
    calibrationSellerboardMonthEndEur: toNumber(entry.calibrationSellerboardMonthEndEur),
  };
}

function createIncomingRow(month: string): IncomingDraft {
  return {
    id: randomId("inc"),
    month,
    revenueEur: null,
    payoutPct: null,
    source: "forecast",
    calibrationCutoffDate: null,
    calibrationRevenueToDateEur: null,
    calibrationPayoutRateToDatePct: null,
    calibrationSellerboardMonthEndEur: null,
  };
}

function sortIncomings(rows: IncomingDraft[]): IncomingDraft[] {
  return rows
    .slice()
    .sort((a, b) => (a.month === b.month ? a.id.localeCompare(b.id) : a.month.localeCompare(b.month)));
}

function syncIncomingsToWindow(rows: IncomingDraft[], startMonth: string, horizonMonths: number): IncomingDraft[] {
  const months = monthRange(startMonth, Math.max(1, Math.round(horizonMonths || 1)));
  const monthSet = new Set(months);
  const byMonth = new Map<string, IncomingDraft>();

  sortIncomings(rows).forEach((row) => {
    if (!monthSet.has(row.month)) return;
    byMonth.set(row.month, {
      ...row,
      id: row.id || randomId("inc"),
      source: row.source === "forecast" ? "forecast" : "manual",
      revenueEur: toNumber(row.revenueEur),
      payoutPct: toNumber(row.payoutPct),
      calibrationCutoffDate: row.calibrationCutoffDate ? String(row.calibrationCutoffDate) : null,
      calibrationRevenueToDateEur: toNumber(row.calibrationRevenueToDateEur),
      calibrationPayoutRateToDatePct: toNumber(row.calibrationPayoutRateToDatePct),
      calibrationSellerboardMonthEndEur: toNumber(row.calibrationSellerboardMonthEndEur),
    });
  });

  const filledRows = months.map((month) => {
    return byMonth.get(month) || createIncomingRow(month);
  });
  return sortIncomings(filledRows);
}

function formatNumber(value: unknown, digits = 2): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatFactor(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizePayoutInput(value: unknown): number | null {
  const parsed = parsePayoutPctInput(value);
  if (!Number.isFinite(parsed as number)) return null;
  return clampPct(Number(parsed), CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
}

function normalizeCashInQuoteMode(value: unknown): CashInQuoteMode {
  return String(value || "").trim().toLowerCase() === "recommendation"
    ? "recommendation"
    : "manual";
}

function normalizeCashInRevenueBasisMode(value: unknown): CashInRevenueBasisMode {
  return String(value || "").trim().toLowerCase() === "forecast_direct"
    ? "forecast_direct"
    : "hybrid";
}

function recommendationSourceLabel(sourceTag: string): string {
  if (sourceTag === "IST") return "IST";
  if (sourceTag === "RECOMMENDED_PLAN") return "Empfohlen (Plan)";
  if (sourceTag === "RECOMMENDED_BASIS") return "Empfohlen (Plan)";
  if (sourceTag === "RECOMMENDED_CONSERVATIVE") return "Empfohlen (Plan)";
  if (sourceTag === "PROGNOSE") return "Signal";
  return "Empfehlung";
}

function usedRevenueSourceLabel(source: string | null): string {
  if (source === "manual_override") return "MANUELL";
  if (source === "manual_no_forecast") return "MANUELL";
  if (source === "forecast_calibrated") return "KALIBRIERT";
  if (source === "forecast_raw") return "FORECAST";
  return "—";
}

function usedQuoteSourceLabel(source: string | null): string {
  if (source === "manual") return "MANUELL";
  if (source === "recommendation") return "EMPFOHLEN";
  return "—";
}

function normalizeNonNegativeInput(value: unknown): number | null {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Math.max(0, Number(parsed));
}

function buildCalibrationMonthTooltip(
  entry: Record<string, unknown> | null | undefined,
  mode: "basis" | "conservative",
): string {
  const month = String(entry?.month || "");
  const h = Math.max(0, Math.round(Number(entry?.horizonOffset || 0)));
  const d = Math.max(1, Math.round(Number(entry?.dayOfMonth || 1)));
  const wEff = Number(entry?.wEff || 0);
  const explanation = entry?.liveAnchorEnabled === true && wEff > 0
    ? `Kalibrierung mit Tagesgewicht aktiv (Tag ${d}, h=${h}, Gewicht ${formatFactor(wEff)}).`
    : "Kalibrierung nutzt aktuell nur das gelernte Profil.";
  const selectedFactor = mode === "conservative"
    ? Number(entry?.factorConservative || 1)
    : Number(entry?.factorBasis || 1);
  return [
    month ? `Monat: ${formatMonthLabel(month)}` : null,
    `F_h: ${formatNumber(entry?.rawForecastRevenue, 2)} EUR`,
    `K (${mode === "conservative" ? "Konservativ" : "Basis"}): ${formatFactor(selectedFactor)}`,
    `K_basis: ${formatFactor(entry?.factorBasis)}`,
    `K_cons: ${formatFactor(entry?.factorConservative)}`,
    `B: ${formatFactor(entry?.biasB)}`,
    `R: ${formatFactor(entry?.riskR)}`,
    `C_live: ${formatFactor(entry?.cLive)}`,
    `W_time: ${formatFactor(entry?.wTime)}`,
    `W_h: ${formatFactor(entry?.wH)}`,
    `W_eff: ${formatFactor(wEff)}`,
    `d: ${d}`,
    explanation,
  ].filter(Boolean).join(" | ");
}

function formatSignedDelta(value: number): string {
  if (!Number.isFinite(value)) return "";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function formatSignedCurrencyDelta(value: number): string {
  if (!Number.isFinite(value)) return "0,00 EUR";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, 2)} EUR`;
}

function normalizeLearningPayload(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  return JSON.parse(JSON.stringify(input));
}

function normalizeSnapshot(snapshot: InputsDraftSnapshot): string {
  const normalizedBaselineNormal = normalizePayoutInput(snapshot.cashInRecommendationBaselineNormalPct)
    ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
  const normalizedBaselineQ4 = normalizePayoutInput(snapshot.cashInRecommendationBaselineQ4Pct);
  return JSON.stringify({
    openingBalance: Number(snapshot.openingBalance || 0),
    startMonth: String(snapshot.startMonth || ""),
    horizonMonths: Math.max(1, Math.round(Number(snapshot.horizonMonths || 1))),
    cashInCalibrationEnabled: snapshot.cashInCalibrationEnabled !== false,
    cashInCalibrationHorizonMonths: normalizeCalibrationHorizonMonths(snapshot.cashInCalibrationHorizonMonths, 6),
    cashInCalibrationMode: normalizeRevenueCalibrationMode(snapshot.cashInCalibrationMode),
    cashInRecommendationIgnoreQ4: snapshot.cashInRecommendationIgnoreQ4 === true,
    cashInRecommendationBaselineNormalPct: normalizedBaselineNormal,
    cashInRecommendationBaselineQ4Pct: normalizedBaselineQ4,
    cashInLearning: normalizeLearningPayload(snapshot.cashInLearning),
    incomings: sortIncomings(snapshot.incomings).map((row) => ({
      id: String(row.id || ""),
      month: String(row.month || ""),
      revenueEur: toNumber(row.revenueEur),
      payoutPct: toNumber(row.payoutPct),
      source: row.source === "forecast" ? "forecast" : "manual",
      calibrationCutoffDate: row.calibrationCutoffDate ? String(row.calibrationCutoffDate) : null,
      calibrationRevenueToDateEur: toNumber(row.calibrationRevenueToDateEur),
      calibrationPayoutRateToDatePct: toNumber(row.calibrationPayoutRateToDatePct),
      calibrationSellerboardMonthEndEur: toNumber(row.calibrationSellerboardMonthEndEur),
    })),
    extras: snapshot.extras
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({
        id: String(row.id || ""),
        date: String(row.date || ""),
        label: String(row.label || ""),
        amountEur: toNumber(row.amountEur),
      })),
    dividends: snapshot.dividends
      .slice()
      .sort((a, b) => (a.month === b.month ? a.id.localeCompare(b.id) : a.month.localeCompare(b.month)))
      .map((row) => ({
        id: String(row.id || ""),
        month: String(row.month || ""),
        label: String(row.label || ""),
        amountEur: toNumber(row.amountEur),
      })),
    monthlyActuals: snapshot.monthlyActuals
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => ({
        month: String(row.month || ""),
        realRevenueEUR: toNumber(row.realRevenueEUR),
        realPayoutRatePct: toNumber(row.realPayoutRatePct),
        realClosingBalanceEUR: toNumber(row.realClosingBalanceEUR),
      })),
  });
}

export default function InputsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();

  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [startMonth, setStartMonth] = useState<string>(currentMonthKey());
  const [horizonMonths, setHorizonMonths] = useState<number>(18);
  const [cashInCalibrationEnabled, setCashInCalibrationEnabled] = useState<boolean>(true);
  const [cashInCalibrationHorizonMonths, setCashInCalibrationHorizonMonths] = useState<number>(6);
  const [cashInCalibrationMode, setCashInCalibrationMode] = useState<"basis" | "conservative">("basis");
  const [cashInRecommendationIgnoreQ4, setCashInRecommendationIgnoreQ4] = useState<boolean>(false);
  const [cashInRecommendationBaselineNormalPct, setCashInRecommendationBaselineNormalPct] = useState<number>(
    CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
  );
  const [cashInRecommendationBaselineQ4Pct, setCashInRecommendationBaselineQ4Pct] = useState<number | null>(null);
  const [cashInLearningState, setCashInLearningState] = useState<Record<string, unknown> | null>(null);
  const [incomings, setIncomings] = useState<IncomingDraft[]>([]);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [dividends, setDividends] = useState<DividendDraft[]>([]);
  const [monthlyActuals, setMonthlyActuals] = useState<MonthlyActualDraft[]>([]);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [autoSaveHint, setAutoSaveHint] = useState("");
  const [historicalImportOpen, setHistoricalImportOpen] = useState(false);
  const [historicalImportStartMonth, setHistoricalImportStartMonth] = useState<string>(currentMonthKey());
  const [historicalImportValues, setHistoricalImportValues] = useState<string>("");
  const [historicalImportError, setHistoricalImportError] = useState<string | null>(null);
  const [tableFocus, setTableFocus] = useState<CashInTableFocus>("revenue");

  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef("");
  const skipNextAutoSaveRef = useRef(true);

  const planningMonths = useMemo(
    () => monthRange(startMonth, Math.max(1, Math.round(horizonMonths || 1))),
    [horizonMonths, startMonth],
  );
  const settingsState = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const globalQuoteMode = normalizeCashInQuoteMode(settingsState.cashInQuoteMode);
  const globalRevenueBasisMode = normalizeCashInRevenueBasisMode(settingsState.cashInRevenueBasisMode);
  const globalCalibrationEnabled = settingsState.cashInCalibrationEnabled !== false;
  const forecastState = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastRevenueByMonth = useMemo(() => {
    const stateObject = state as unknown as Record<string, unknown>;
    const categoriesById = buildCategoryLabelMap(stateObject);
    const products = buildForecastProducts(stateObject, categoriesById);
    const forecast = (state.forecast || {}) as Record<string, unknown>;
    const forecastImport = (forecast.forecastImport || {}) as Record<string, unknown>;
    const manualDraft = normalizeManualMap((forecast.forecastManual || {}) as Record<string, unknown>);
    return buildForecastRevenueByMonth({
      allMonths: planningMonths,
      products,
      manualDraft,
      forecastImport,
    });
  }, [planningMonths, state]);

  useEffect(() => {
    const settings = (state.settings || {}) as Record<string, unknown>;
    const nextOpeningBalance = Number(toNumber(settings.openingBalance) || 0);
    const nextStartMonth = normalizeMonth(settings.startMonth, currentMonthKey());
    const nextHorizonMonths = Math.max(1, Math.round(Number(settings.horizonMonths || 18) || 18));
    const nextCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
    const nextCalibrationHorizon = normalizeCalibrationHorizonMonths(settings.cashInCalibrationHorizonMonths, 6);
    const nextCalibrationMode = normalizeRevenueCalibrationMode(settings.cashInCalibrationMode) as "basis" | "conservative";
    const nextSeasonalityEnabled = settings.cashInRecommendationSeasonalityEnabled == null
      ? settings.cashInRecommendationIgnoreQ4 !== true
      : settings.cashInRecommendationSeasonalityEnabled !== false;
    const nextIgnoreQ4 = !nextSeasonalityEnabled;
    const nextBaselineNormal = normalizePayoutInput(settings.cashInRecommendationBaselineNormalPct)
      ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
    const nextBaselineQ4 = normalizePayoutInput(settings.cashInRecommendationBaselineQ4Pct);
    const nextLearningState = normalizeLearningPayload(settings.cashInLearning);

    const nextIncomingsRaw = (Array.isArray(state.incomings) ? state.incomings : [])
      .map((entry) => normalizeIncomingRow(entry as Record<string, unknown>, nextStartMonth));
    const nextIncomings = syncIncomingsToWindow(nextIncomingsRaw, nextStartMonth, nextHorizonMonths);

    const nextExtras = (Array.isArray(state.extras) ? state.extras : [])
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          id: String(row.id || randomId("extra")),
          date: String(row.date || ""),
          label: String(row.label || "Extra"),
          amountEur: toNumber(row.amountEur),
        } satisfies ExtraDraft;
      });

    const nextDividends = (Array.isArray(state.dividends) ? state.dividends : [])
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          id: String(row.id || randomId("div")),
          month: normalizeMonth(row.month, nextStartMonth),
          label: String(row.label || "Dividende"),
          amountEur: toNumber(row.amountEur),
        } satisfies DividendDraft;
      });

    const monthlyRaw = (state.monthlyActuals && typeof state.monthlyActuals === "object")
      ? state.monthlyActuals as Record<string, Record<string, unknown>>
      : {};
    const nextMonthlyActuals = Object.entries(monthlyRaw)
      .map(([month, row]) => ({
        month: normalizeMonth(month, currentMonthKey()),
        realRevenueEUR: toNumber(row.realRevenueEUR),
        realPayoutRatePct: toNumber(row.realPayoutRatePct),
        realClosingBalanceEUR: toNumber(row.realClosingBalanceEUR),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    skipNextAutoSaveRef.current = true;
    setOpeningBalance(nextOpeningBalance);
    setStartMonth(nextStartMonth);
    setHorizonMonths(nextHorizonMonths);
    setCashInCalibrationEnabled(nextCalibrationEnabled);
    setCashInCalibrationHorizonMonths(nextCalibrationHorizon);
    setCashInCalibrationMode(nextCalibrationMode);
    setCashInRecommendationIgnoreQ4(nextIgnoreQ4);
    setCashInRecommendationBaselineNormalPct(nextBaselineNormal);
    setCashInRecommendationBaselineQ4Pct(nextBaselineQ4);
    setCashInLearningState(nextLearningState);
    setIncomings(nextIncomings);
    setExtras(nextExtras);
    setDividends(nextDividends);
    setMonthlyActuals(nextMonthlyActuals);
    setHistoricalImportStartMonth(nextStartMonth);

    lastSavedHashRef.current = normalizeSnapshot({
      openingBalance: nextOpeningBalance,
      startMonth: nextStartMonth,
      horizonMonths: nextHorizonMonths,
      cashInCalibrationEnabled: nextCalibrationEnabled,
      cashInCalibrationHorizonMonths: nextCalibrationHorizon,
      cashInCalibrationMode: nextCalibrationMode,
      cashInRecommendationIgnoreQ4: nextIgnoreQ4,
      cashInRecommendationBaselineNormalPct: nextBaselineNormal,
      cashInRecommendationBaselineQ4Pct: nextBaselineQ4,
      cashInLearning: nextLearningState,
      incomings: nextIncomings,
      extras: nextExtras,
      dividends: nextDividends,
      monthlyActuals: nextMonthlyActuals,
    });
    setHasPendingChanges(false);
    setAutoSaveHint("");
  }, [state.dividends, state.extras, state.incomings, state.monthlyActuals, state.settings]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const forecastRevenueByMonthObject = useMemo(() => {
    const object: Record<string, number> = {};
    planningMonths.forEach((month) => {
      object[month] = Number(forecastRevenueByMonth.get(month) || 0);
    });
    return object;
  }, [forecastRevenueByMonth, planningMonths]);

  const monthlyActualsMap = useMemo(() => {
    const map: Record<string, { realRevenueEUR?: number; realPayoutRatePct?: number }> = {};
    monthlyActuals.forEach((row) => {
      if (!isMonthKey(row.month)) return;
      const revenue = toNumber(row.realRevenueEUR);
      const payoutPct = toNumber(row.realPayoutRatePct);
      const monthlyEntry: { realRevenueEUR?: number; realPayoutRatePct?: number } = {};
      if (Number.isFinite(revenue as number)) monthlyEntry.realRevenueEUR = Number(revenue);
      if (Number.isFinite(payoutPct as number)) monthlyEntry.realPayoutRatePct = Number(payoutPct);
      if (!Object.keys(monthlyEntry).length) return;
      map[row.month] = monthlyEntry;
    });
    return map;
  }, [monthlyActuals]);

  const payoutRecommendation = useMemo(() => {
    return buildPayoutRecommendation({
      months: planningMonths,
      incomings,
      monthlyActuals: monthlyActualsMap,
      currentMonth: currentMonthKey(),
      mode: "plan",
      seasonalityEnabled: !cashInRecommendationIgnoreQ4,
      ignoreQ4: cashInRecommendationIgnoreQ4,
      maxMonth: currentMonthKey(),
      baselineNormalPct: cashInRecommendationBaselineNormalPct,
      baselineQ4Pct: cashInRecommendationBaselineQ4Pct,
      learningState: cashInLearningState,
      now: new Date(),
      minSamples: 4,
    });
  }, [
    cashInRecommendationBaselineNormalPct,
    cashInRecommendationBaselineQ4Pct,
    cashInRecommendationIgnoreQ4,
    cashInLearningState,
    incomings,
    monthlyActualsMap,
    planningMonths,
  ]);

  const payoutRecommendationByMonth = useMemo(() => {
    const recommendationMap = new Map<string, RecommendationByMonthEntry>();
    incomings.forEach((incoming) => {
      const entry = payoutRecommendation.byMonth?.[incoming.month];
      if (!entry || !Number.isFinite(Number(entry.quotePct))) return;
      recommendationMap.set(incoming.month, entry as RecommendationByMonthEntry);
    });
    return recommendationMap;
  }, [incomings, payoutRecommendation.byMonth]);

  const recommendationBaselineNormalPct = normalizePayoutInput(payoutRecommendation.baselineNormalPct)
    ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
  const recommendationLevelPct = normalizePayoutInput(payoutRecommendation.levelPct)
    ?? recommendationBaselineNormalPct;
  const recommendationRiskBasePct = Number.isFinite(Number(payoutRecommendation.riskBasePct))
    ? Number(payoutRecommendation.riskBasePct)
    : 0;
  const recommendationCurrentMonthForecastQuotePct = normalizePayoutInput(payoutRecommendation.currentMonthForecastQuotePct);
  const recommendationObservedNormalSampleCount = Math.max(0, Math.round(Number(payoutRecommendation.observedNormalSampleCount || 0)));
  const recommendationObservedNormalMedianPct = normalizePayoutInput(payoutRecommendation.observedNormalMedianPct);
  const recommendationObservedNormalAveragePct = normalizePayoutInput(payoutRecommendation.observedNormalAveragePct);
  const recommendationObservedNormalWithForecastSampleCount = Math.max(0, Math.round(Number(
    payoutRecommendation.observedNormalWithForecastSampleCount || 0,
  )));
  const recommendationObservedNormalWithForecastMedianPct = normalizePayoutInput(
    payoutRecommendation.observedNormalWithForecastMedianPct,
  );
  const recommendationObservedNormalWithForecastAveragePct = normalizePayoutInput(
    payoutRecommendation.observedNormalWithForecastAveragePct,
  );
  const recommendationUsedMonths = Array.isArray(payoutRecommendation.usedMonths)
    ? payoutRecommendation.usedMonths
    : [];
  const recommendationUsedMonthsText = recommendationUsedMonths.length
    ? recommendationUsedMonths.map((month) => formatMonthLabel(month)).join(", ")
    : "keine";
  const recommendationInfoTooltip = [
    `Level L: ${formatNumber(recommendationLevelPct, 1)}%`,
    `RiskBase: ${formatNumber(recommendationRiskBasePct, 2)}pp`,
    `Observed IST (n=${recommendationObservedNormalSampleCount}): Median ${formatNumber(recommendationObservedNormalMedianPct, 1)}%, Ø ${formatNumber(recommendationObservedNormalAveragePct, 1)}%`,
    `Modellpunkte (n=${recommendationObservedNormalWithForecastSampleCount}): Median ${formatNumber(recommendationObservedNormalWithForecastMedianPct, 1)}%, Ø ${formatNumber(recommendationObservedNormalWithForecastAveragePct, 1)}%`,
    `Genutzte IST-Monate: ${recommendationUsedMonthsText}`,
    `Saisonalität: ${cashInRecommendationIgnoreQ4 ? "aus" : "an"}`,
  ].join(" | ");
  const historicalImportSampleCount = (
    cashInLearningState
    && typeof cashInLearningState === "object"
    && cashInLearningState.historicalImport
    && typeof cashInLearningState.historicalImport === "object"
  )
    ? Math.max(0, Math.round(Number((cashInLearningState.historicalImport as Record<string, unknown>).sampleCount || 0)))
    : 0;

  const currentMonthValue = currentMonthKey();
  const currentMonthInPlanning = planningMonths.includes(currentMonthValue);
  const currentMonthForecastRevenue = Number(forecastRevenueByMonth.get(currentMonthValue) || 0);

  const currentMonthIncoming = useMemo(
    () => sortIncomings(incomings).find((row) => row.month === currentMonthValue) || null,
    [currentMonthValue, incomings],
  );

  const currentCalibrationRevenueForecast = toNumber(currentMonthIncoming?.calibrationSellerboardMonthEndEur);
  const currentCalibrationPayoutForecast = toNumber(currentMonthIncoming?.calibrationPayoutRateToDatePct);

  const revenueCalibrationProfile = useMemo(() => {
    return buildCalibrationProfile({
      incomings,
      months: planningMonths,
      forecastRevenueByMonth: forecastRevenueByMonthObject,
      mode: cashInCalibrationMode,
      currentMonth: currentMonthValue,
      now: new Date(),
      monthlyActuals: monthlyActualsMap,
      learningState: settingsState.revenueCalibration,
      sourceForecastVersionId: forecastState.activeVersionId,
    });
  }, [
    cashInCalibrationMode,
    currentMonthValue,
    forecastRevenueByMonthObject,
    forecastState.activeVersionId,
    incomings,
    monthlyActualsMap,
    planningMonths,
    settingsState.revenueCalibration,
  ]);
  const currentMonthCalibrationCandidate = revenueCalibrationProfile.candidates.find(
    (candidate) => candidate.month === currentMonthValue,
  ) || null;
  const currentMonthCalibrationRawFactor = Number(
    currentMonthCalibrationCandidate?.rawFactor
    ?? revenueCalibrationProfile.byMonth?.[currentMonthValue]?.cLiveRaw,
  );
  const currentMonthCalibrationEntry = revenueCalibrationProfile.byMonth?.[currentMonthValue] as Record<string, unknown> | undefined;
  const currentMonthAppliedFactor = globalCalibrationEnabled
    ? Number(currentMonthCalibrationEntry?.factor || 1)
    : 1;
  const currentMonthFactorBasis = Number(currentMonthCalibrationEntry?.factorBasis || 1);
  const currentMonthFactorConservative = Number(currentMonthCalibrationEntry?.factorConservative || 1);
  const currentMonthCalibratedRevenue = currentMonthForecastRevenue
    * (Number.isFinite(currentMonthAppliedFactor) ? currentMonthAppliedFactor : 1);
  const currentMonthPayoutPct = useMemo(() => {
    const manualPayoutPct = normalizePayoutInput(currentMonthIncoming?.payoutPct);
    if (Number.isFinite(manualPayoutPct as number)) return Number(manualPayoutPct);
    const recommendation = payoutRecommendationByMonth.get(currentMonthValue);
    const recommendationQuote = Number(recommendation?.quotePct);
    if (!Number.isFinite(recommendationQuote)) return null;
    return clampPct(recommendationQuote, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT);
  }, [currentMonthIncoming?.payoutPct, currentMonthValue, payoutRecommendationByMonth]);
  const currentMonthCalibratedPayout = Number.isFinite(currentMonthPayoutPct as number)
    ? currentMonthCalibratedRevenue * (Number(currentMonthPayoutPct) / 100)
    : null;
  const currentMonthCalibrationUnusual = Number.isFinite(currentMonthCalibrationRawFactor)
    && (currentMonthCalibrationRawFactor > 1.25 || currentMonthCalibrationRawFactor < 0.5);
  const currentMonthCalibrationTooltip = currentMonthCalibrationEntry && globalCalibrationEnabled
    ? buildCalibrationMonthTooltip(currentMonthCalibrationEntry, cashInCalibrationMode)
    : globalCalibrationEnabled
      ? "Kalibrierfaktor wird berechnet, sobald die Umsatzprognose bis Monatsende im aktuellen Monat gesetzt ist und Forecast-Umsatz > 0 ist."
      : "Kalibrierung ist deaktiviert.";
  const currentMonthProjectedQuotePct = useMemo(() => {
    const projectedRevenue = Number(currentCalibrationRevenueForecast);
    const projectedPayout = Number(currentCalibrationPayoutForecast);
    if (!(Number.isFinite(projectedRevenue) && projectedRevenue > 0)) return null;
    if (!(Number.isFinite(projectedPayout) && projectedPayout >= 0)) return null;
    return (projectedPayout / projectedRevenue) * 100;
  }, [currentCalibrationPayoutForecast, currentCalibrationRevenueForecast]);
  const currentMonthProjectedRevenueDelta = Number.isFinite(currentCalibrationRevenueForecast)
    ? Number(currentCalibrationRevenueForecast) - Number(currentMonthForecastRevenue || 0)
    : null;
  const currentMonthProjectedRevenueDeltaPct = (
    Number.isFinite(currentMonthProjectedRevenueDelta)
    && Number.isFinite(currentMonthForecastRevenue)
    && Number(currentMonthForecastRevenue) > 0
  )
    ? (Number(currentMonthProjectedRevenueDelta) / Number(currentMonthForecastRevenue)) * 100
    : null;
  const currentMonthProjectedPayoutDelta = (
    Number.isFinite(currentCalibrationPayoutForecast)
    && Number.isFinite(currentMonthCalibratedPayout as number)
  )
    ? Number(currentCalibrationPayoutForecast) - Number(currentMonthCalibratedPayout)
    : null;

  const calibrationImpact = useMemo(() => {
    let baseRevenueTotal = 0;
    let calibratedRevenueTotal = 0;
    let basePayoutTotal = 0;
    let calibratedPayoutTotal = 0;
    let affectedMonths = 0;

    sortIncomings(incomings).forEach((row) => {
      const month = String(row.month || "");
      const forecastRevenue = Number(forecastRevenueByMonth.get(month) || 0);
      const factor = globalCalibrationEnabled
        ? Number(revenueCalibrationProfile.byMonth?.[month]?.factor || 1)
        : 1;
      const factorApplied = Number.isFinite(factor) ? factor : 1;

      const manualRevenue = toNumber(row.revenueEur);
      const isManualRevenueOverride = row.source === "manual" && Number.isFinite(forecastRevenue) && forecastRevenue > 0;
      const baseRevenue = isManualRevenueOverride ? Number(manualRevenue || 0) : forecastRevenue;
      const revenueWithCalibration = isManualRevenueOverride ? baseRevenue : (forecastRevenue * factorApplied);
      baseRevenueTotal += Number(baseRevenue || 0);
      calibratedRevenueTotal += Number(revenueWithCalibration || 0);
      if (!isManualRevenueOverride && Math.abs(factorApplied - 1) > 0.000001) affectedMonths += 1;

      const manualPayoutPct = normalizePayoutInput(row.payoutPct);
      const recommendation = payoutRecommendationByMonth.get(month);
      const recommendationQuote = Number(recommendation?.quotePct);
      const payoutPct = Number.isFinite(manualPayoutPct as number)
        ? Number(manualPayoutPct)
        : (Number.isFinite(recommendationQuote)
          ? clampPct(recommendationQuote, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
          : null);
      if (!Number.isFinite(payoutPct as number)) return;

      basePayoutTotal += Number(baseRevenue || 0) * (Number(payoutPct) / 100);
      calibratedPayoutTotal += Number(revenueWithCalibration || 0) * (Number(payoutPct) / 100);
    });

    const revenueDelta = globalCalibrationEnabled ? (calibratedRevenueTotal - baseRevenueTotal) : 0;
    const payoutDelta = globalCalibrationEnabled ? (calibratedPayoutTotal - basePayoutTotal) : 0;
    return {
      revenueDelta,
      payoutDelta,
      affectedMonths,
    };
  }, [
    globalCalibrationEnabled,
    revenueCalibrationProfile.byMonth,
    forecastRevenueByMonth,
    incomings,
    payoutRecommendationByMonth,
  ]);

  function setCurrentMonthCalibrationPatch(patch: Partial<IncomingDraft>): void {
    setIncomings((prev) => {
      const index = prev.findIndex((row) => row.month === currentMonthValue);
      if (index >= 0) {
        const next = [...prev];
        next[index] = {
          ...next[index],
          ...patch,
        };
        return sortIncomings(next);
      }
      if (!currentMonthInPlanning) return prev;
      const nextRow: IncomingDraft = {
        id: randomId("inc"),
        month: currentMonthValue,
        revenueEur: Number.isFinite(currentMonthForecastRevenue) ? currentMonthForecastRevenue : 0,
        payoutPct: normalizePayoutInput(payoutRecommendation.byMonth?.[currentMonthValue]?.quotePct),
        source: currentMonthForecastRevenue > 0 ? "forecast" : "manual",
        calibrationCutoffDate: null,
        calibrationRevenueToDateEur: null,
        calibrationPayoutRateToDatePct: null,
        calibrationSellerboardMonthEndEur: null,
        ...patch,
      };
      return sortIncomings([...prev, nextRow]);
    });
  }

  function applyHistoricalPriorImport(): void {
    const prior = buildHistoricalPayoutPrior({
      startMonth: historicalImportStartMonth,
      values: historicalImportValues,
    });
    if (!prior.ok) {
      setHistoricalImportError(prior.error || "Historische Quoten konnten nicht importiert werden.");
      return;
    }
    const zeroedMonthCounts: Record<string, number> = {};
    for (let slot = 1; slot <= 12; slot += 1) {
      zeroedMonthCounts[String(slot)] = 0;
    }
    const nextLearningState = {
      version: 1,
      levelPct: Number(prior.levelPct || CASH_IN_BASELINE_NORMAL_DEFAULT_PCT),
      seasonalityByMonth: prior.seasonalityPriorByMonth,
      seasonalityPriorByMonth: prior.seasonalityPriorByMonth,
      seasonalitySampleCountByMonth: zeroedMonthCounts,
      riskBasePct: 0,
      positiveErrorCount: 0,
      predictionSnapshotByMonth: {},
      historicalImport: {
        ...prior,
        createdAt: new Date().toISOString(),
      },
    } as Record<string, unknown>;
    setCashInLearningState(normalizeLearningPayload(nextLearningState));
    setCashInRecommendationBaselineNormalPct(Number(prior.levelPct || CASH_IN_BASELINE_NORMAL_DEFAULT_PCT));
    setCashInRecommendationBaselineQ4Pct(null);
    setHistoricalImportError(null);
    setHistoricalImportOpen(false);
    setAutoSaveHint("Historisches Startprofil übernommen");
  }

  async function saveDraft(source: string): Promise<void> {
    const normalizedIncomings = syncIncomingsToWindow(incomings, startMonth, horizonMonths);
    const learningStateForSave = normalizeLearningPayload(
      payoutRecommendation.learningStateNext
      || payoutRecommendation.learningState
      || cashInLearningState,
    );
    const revenueCalibrationStateForSave = (
      revenueCalibrationProfile.learningStateNext
      && typeof revenueCalibrationProfile.learningStateNext === "object"
    )
      ? JSON.parse(JSON.stringify(revenueCalibrationProfile.learningStateNext))
      : (
        settingsState.revenueCalibration
        && typeof settingsState.revenueCalibration === "object"
      )
        ? JSON.parse(JSON.stringify(settingsState.revenueCalibration))
        : null;
    const snapshot: InputsDraftSnapshot = {
      openingBalance,
      startMonth,
      horizonMonths,
      cashInCalibrationEnabled,
      cashInCalibrationHorizonMonths,
      cashInCalibrationMode,
      cashInRecommendationIgnoreQ4,
      cashInRecommendationBaselineNormalPct,
      cashInRecommendationBaselineQ4Pct,
      cashInLearning: learningStateForSave,
      incomings: normalizedIncomings,
      extras,
      dividends,
      monthlyActuals,
    };
    const hash = normalizeSnapshot(snapshot);
    if (hash === lastSavedHashRef.current) {
      setHasPendingChanges(false);
      return;
    }

    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const settings = (next.settings || {}) as Record<string, unknown>;
      next.settings = {
        ...settings,
        openingBalance: Number(snapshot.openingBalance || 0),
        startMonth: snapshot.startMonth,
        horizonMonths: Math.max(1, Math.round(snapshot.horizonMonths || 1)),
        cashInCalibrationHorizonMonths: normalizeCalibrationHorizonMonths(snapshot.cashInCalibrationHorizonMonths, 6),
        cashInCalibrationMode: normalizeRevenueCalibrationMode(snapshot.cashInCalibrationMode),
        cashInRecommendationIgnoreQ4: snapshot.cashInRecommendationIgnoreQ4 === true,
        cashInRecommendationSeasonalityEnabled: snapshot.cashInRecommendationIgnoreQ4 !== true,
        cashInRecommendationBaselineNormalPct: normalizePayoutInput(snapshot.cashInRecommendationBaselineNormalPct)
          ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT,
        cashInRecommendationBaselineQ4Pct: normalizePayoutInput(snapshot.cashInRecommendationBaselineQ4Pct),
        cashInLearning: normalizeLearningPayload(snapshot.cashInLearning),
        revenueCalibration: revenueCalibrationStateForSave,
        lastUpdatedAt: new Date().toISOString(),
      };

      next.incomings = sortIncomings(snapshot.incomings).map((row) => ({
        id: row.id,
        month: row.month,
        revenueEur: toNumber(row.revenueEur),
        payoutPct: normalizePayoutInput(row.payoutPct),
        source: row.source,
        calibrationCutoffDate: row.calibrationCutoffDate || null,
        calibrationRevenueToDateEur: toNumber(row.calibrationRevenueToDateEur),
        calibrationPayoutRateToDatePct: normalizeNonNegativeInput(row.calibrationPayoutRateToDatePct),
        calibrationSellerboardMonthEndEur: normalizeNonNegativeInput(row.calibrationSellerboardMonthEndEur),
      }));

      next.extras = snapshot.extras.map((row) => ({
        id: row.id,
        date: row.date || null,
        month: row.date ? row.date.slice(0, 7) : null,
        label: row.label,
        amountEur: Number(row.amountEur || 0),
      }));

      next.dividends = snapshot.dividends.map((row) => ({
        id: row.id,
        month: row.month,
        date: `${row.month}-28`,
        label: row.label,
        amountEur: Number(row.amountEur || 0),
      }));

      const existingMonthly = (next.monthlyActuals && typeof next.monthlyActuals === "object")
        ? next.monthlyActuals as Record<string, Record<string, unknown>>
        : {};
      const monthlyObject: Record<string, Record<string, unknown>> = {};
      snapshot.monthlyActuals.forEach((row) => {
        if (!isMonthKey(row.month)) return;
        const nextMonthly: Record<string, unknown> = (
          existingMonthly[row.month] && typeof existingMonthly[row.month] === "object"
            ? { ...existingMonthly[row.month] }
            : {}
        );
        const realRevenue = toNumber(row.realRevenueEUR);
        const realPayoutRate = toNumber(row.realPayoutRatePct);
        const realClosing = toNumber(row.realClosingBalanceEUR);
        if (Number.isFinite(realRevenue as number)) nextMonthly.realRevenueEUR = Number(realRevenue);
        else delete nextMonthly.realRevenueEUR;
        if (Number.isFinite(realPayoutRate as number)) nextMonthly.realPayoutRatePct = Number(realPayoutRate);
        else delete nextMonthly.realPayoutRatePct;
        if (Number.isFinite(realClosing as number)) nextMonthly.realClosingBalanceEUR = Number(realClosing);
        else delete nextMonthly.realClosingBalanceEUR;
        if (Object.keys(nextMonthly).length) {
          monthlyObject[row.month] = nextMonthly;
        }
      });
      next.monthlyActuals = monthlyObject;
      return next;
    }, source);

    setCashInLearningState(learningStateForSave);
    lastSavedHashRef.current = hash;
    setHasPendingChanges(false);
    setAutoSaveHint(`Gespeichert: ${new Date().toLocaleTimeString("de-DE")}`);
  }

  function scheduleAutoSave(delayMs = 380): void {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (saving) {
        scheduleAutoSave(220);
        return;
      }
      void saveDraft("v2:inputs:auto");
    }, Math.max(80, Number(delayMs) || 380));
  }

  useEffect(() => {
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    const hash = normalizeSnapshot({
      openingBalance,
      startMonth,
      horizonMonths,
      cashInCalibrationEnabled,
      cashInCalibrationHorizonMonths,
      cashInCalibrationMode,
      cashInRecommendationIgnoreQ4,
      cashInRecommendationBaselineNormalPct,
      cashInRecommendationBaselineQ4Pct,
      cashInLearning: cashInLearningState,
      incomings,
      extras,
      dividends,
      monthlyActuals,
    });
    const pending = hash !== lastSavedHashRef.current;
    setHasPendingChanges(pending);
    if (!pending) return;
    setAutoSaveHint("Ungespeicherte Aenderungen");
    scheduleAutoSave(380);
  }, [
    openingBalance,
    startMonth,
    horizonMonths,
    cashInCalibrationEnabled,
    cashInCalibrationHorizonMonths,
    cashInCalibrationMode,
    cashInRecommendationIgnoreQ4,
    cashInRecommendationBaselineNormalPct,
    cashInRecommendationBaselineQ4Pct,
    cashInLearningState,
    incomings,
    extras,
    dividends,
    monthlyActuals,
  ]);

  const monthlyMatrixRows = useMemo<CashInMonthMatrixRow[]>(() => {
    const normalizedIncomings = syncIncomingsToWindow(incomings, startMonth, horizonMonths);
    const nextState = structuredClone(state as unknown as Record<string, unknown>);
    if (!nextState.settings || typeof nextState.settings !== "object") {
      nextState.settings = {};
    }
    const nextSettings = nextState.settings as Record<string, unknown>;
    nextSettings.openingBalance = Number(openingBalance || 0);
    nextSettings.startMonth = startMonth;
    nextSettings.horizonMonths = Math.max(1, Math.round(horizonMonths || 1));
    nextSettings.cashInCalibrationHorizonMonths = normalizeCalibrationHorizonMonths(cashInCalibrationHorizonMonths, 6);
    nextSettings.cashInCalibrationMode = normalizeRevenueCalibrationMode(cashInCalibrationMode);
    nextSettings.cashInRecommendationIgnoreQ4 = cashInRecommendationIgnoreQ4 === true;
    nextSettings.cashInRecommendationSeasonalityEnabled = cashInRecommendationIgnoreQ4 !== true;
    nextSettings.cashInRecommendationBaselineNormalPct = normalizePayoutInput(cashInRecommendationBaselineNormalPct)
      ?? CASH_IN_BASELINE_NORMAL_DEFAULT_PCT;
    nextSettings.cashInRecommendationBaselineQ4Pct = normalizePayoutInput(cashInRecommendationBaselineQ4Pct);
    nextSettings.cashInLearning = normalizeLearningPayload(cashInLearningState);

    nextState.incomings = sortIncomings(normalizedIncomings).map((row) => ({
      id: row.id,
      month: row.month,
      revenueEur: toNumber(row.revenueEur),
      payoutPct: normalizePayoutInput(row.payoutPct),
      source: row.source,
      calibrationCutoffDate: row.calibrationCutoffDate || null,
      calibrationRevenueToDateEur: toNumber(row.calibrationRevenueToDateEur),
      calibrationPayoutRateToDatePct: normalizeNonNegativeInput(row.calibrationPayoutRateToDatePct),
      calibrationSellerboardMonthEndEur: normalizeNonNegativeInput(row.calibrationSellerboardMonthEndEur),
    }));

    const existingMonthly = (
      nextState.monthlyActuals
      && typeof nextState.monthlyActuals === "object"
    ) ? nextState.monthlyActuals as Record<string, Record<string, unknown>> : {};
    const monthlyObject: Record<string, Record<string, unknown>> = {};
    monthlyActuals.forEach((row) => {
      if (!isMonthKey(row.month)) return;
      const nextMonthly: Record<string, unknown> = (
        existingMonthly[row.month] && typeof existingMonthly[row.month] === "object"
          ? { ...existingMonthly[row.month] }
          : {}
      );
      const realRevenue = toNumber(row.realRevenueEUR);
      const realPayoutRate = toNumber(row.realPayoutRatePct);
      const realClosing = toNumber(row.realClosingBalanceEUR);
      if (Number.isFinite(realRevenue as number)) nextMonthly.realRevenueEUR = Number(realRevenue);
      else delete nextMonthly.realRevenueEUR;
      if (Number.isFinite(realPayoutRate as number)) nextMonthly.realPayoutRatePct = Number(realPayoutRate);
      else delete nextMonthly.realPayoutRatePct;
      if (Number.isFinite(realClosing as number)) nextMonthly.realClosingBalanceEUR = Number(realClosing);
      else delete nextMonthly.realClosingBalanceEUR;
      if (Object.keys(nextMonthly).length) {
        monthlyObject[row.month] = nextMonthly;
      }
    });
    nextState.monthlyActuals = monthlyObject;

    const usedByMonth = buildEffectiveCashInByMonth(
      normalizedIncomings.map((row) => row.month),
      nextState,
      null,
    );

    return normalizedIncomings.map((row) => {
      const recommendationEntry = payoutRecommendationByMonth.get(row.month) || null;
      const recommendationQuoteRaw = Number(recommendationEntry?.quotePct);
      const recommendedQuote = Number.isFinite(recommendationQuoteRaw)
        ? clampPct(recommendationQuoteRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
        : null;
      const recommendationSourceTag = String(
        recommendationEntry?.sourceTag
        || "RECOMMENDED_PLAN",
      );
      const recommendationSource = recommendationSourceLabel(recommendationSourceTag);
      const recommendationTooltip = [
        `Quelle: ${recommendationSource}`,
        recommendationEntry?.explanation ? String(recommendationEntry.explanation) : null,
        `Saisonalität: ${recommendationEntry?.seasonalityEnabled === false ? "aus" : "an"}`,
      ].filter(Boolean).join(" | ");

      const forecastRevenue = Number(forecastRevenueByMonth.get(row.month) || 0);
      const calibrationByMonth = (revenueCalibrationProfile.byMonth?.[row.month] || null) as Record<string, unknown> | null;
      const factorBasis = Number(calibrationByMonth?.factorBasis || 1);
      const factorConservative = Number(calibrationByMonth?.factorConservative || 1);
      const selectedFactorRaw = cashInCalibrationMode === "conservative" ? factorConservative : factorBasis;
      const factorApplied = globalCalibrationEnabled && Number.isFinite(selectedFactorRaw)
        ? selectedFactorRaw
        : 1;
      const calibratedRevenue = forecastRevenue * factorApplied;

      const manualRevenue = toNumber(row.revenueEur);
      const hasManualRevenue = row.source === "manual" && Number.isFinite(manualRevenue as number);
      const manualQuote = normalizePayoutInput(row.payoutPct);

      const used = (usedByMonth && typeof usedByMonth === "object")
        ? usedByMonth[row.month] as Record<string, unknown> | undefined
        : undefined;
      let usedRevenue = Number.isFinite(Number(used?.revenueUsedEUR))
        ? Number(used?.revenueUsedEUR)
        : null;
      let usedRevenueSource = used?.revenueSource ? String(used.revenueSource) : null;
      let usedQuote = Number.isFinite(Number(used?.payoutPctUsed))
        ? Number(used?.payoutPctUsed)
        : null;
      let usedQuoteSource = used?.payoutSource ? String(used.payoutSource) : null;
      let usedPayout = Number.isFinite(Number(used?.payoutEUR))
        ? Number(used?.payoutEUR)
        : 0;

      if (!Number.isFinite(usedRevenue as number)) {
        if (globalRevenueBasisMode === "forecast_direct") {
          usedRevenue = globalCalibrationEnabled ? calibratedRevenue : forecastRevenue;
          usedRevenueSource = globalCalibrationEnabled ? "forecast_calibrated" : "forecast_raw";
        } else if (hasManualRevenue) {
          usedRevenue = Number(manualRevenue);
          usedRevenueSource = "manual_override";
        } else {
          usedRevenue = globalCalibrationEnabled ? calibratedRevenue : forecastRevenue;
          usedRevenueSource = globalCalibrationEnabled ? "forecast_calibrated" : "forecast_raw";
        }
      }

      if (!Number.isFinite(usedQuote as number)) {
        if (globalQuoteMode === "recommendation") {
          usedQuote = Number.isFinite(recommendedQuote as number) ? Number(recommendedQuote) : null;
          usedQuoteSource = "recommendation";
        } else if (Number.isFinite(manualQuote as number)) {
          usedQuote = Number(manualQuote);
          usedQuoteSource = "manual";
        } else {
          usedQuote = Number.isFinite(recommendedQuote as number) ? Number(recommendedQuote) : null;
          usedQuoteSource = "recommendation";
        }
      }

      if (!Number.isFinite(usedPayout as number)) {
        usedPayout = (
          Number.isFinite(usedRevenue as number)
          && Number.isFinite(usedQuote as number)
        ) ? Number(usedRevenue) * (Number(usedQuote) / 100) : 0;
      }

      return {
        rowId: row.id,
        month: row.month,
        monthLabel: formatMonthLabel(row.month),
        forecastRevenue,
        calibratedRevenue,
        manualRevenue: hasManualRevenue ? Number(manualRevenue) : null,
        hasManualRevenue,
        manualQuote: Number.isFinite(manualQuote as number) ? Number(manualQuote) : null,
        recommendedQuote: Number.isFinite(recommendedQuote as number) ? Number(recommendedQuote) : null,
        recommendationSourceLabel: recommendationSource,
        recommendationTooltip,
        usedRevenue,
        usedRevenueSource,
        usedQuote,
        usedQuoteSource,
        usedPayout: Number(usedPayout || 0),
      };
    });
  }, [
    cashInCalibrationHorizonMonths,
    cashInCalibrationMode,
    cashInLearningState,
    cashInRecommendationBaselineNormalPct,
    cashInRecommendationBaselineQ4Pct,
    cashInRecommendationIgnoreQ4,
    forecastRevenueByMonth,
    globalCalibrationEnabled,
    globalQuoteMode,
    globalRevenueBasisMode,
    horizonMonths,
    incomings,
    monthlyActuals,
    openingBalance,
    payoutRecommendationByMonth,
    revenueCalibrationProfile.byMonth,
    startMonth,
    state,
  ]);

  function hasManualRevenueOverride(row: IncomingDraft): boolean {
    const manualRevenue = toNumber(row.revenueEur);
    return row.source === "manual" && Number.isFinite(manualRevenue as number);
  }

  function updateIncomingMonth(month: string, updater: (row: IncomingDraft) => IncomingDraft): void {
    setIncomings((prev) => {
      const rows = syncIncomingsToWindow(prev, startMonth, horizonMonths);
      const index = rows.findIndex((row) => row.month === month);
      if (index >= 0) {
        rows[index] = updater({ ...rows[index] });
      } else {
        rows.push(updater(createIncomingRow(month)));
      }
      return sortIncomings(rows);
    });
  }

  function resetRevenueOverrideForMonth(month: string): void {
    updateIncomingMonth(month, (row) => ({
      ...row,
      source: "forecast",
      revenueEur: null,
    }));
  }

  function applyForecastToAutoMonths(): void {
    setIncomings((prev) => {
      const rows = syncIncomingsToWindow(prev, startMonth, horizonMonths);
      return sortIncomings(rows.map((row) => (
        hasManualRevenueOverride(row)
          ? row
          : {
            ...row,
            source: "forecast",
            revenueEur: null,
          }
      )));
    });
    setAutoSaveHint("Forecast in AUTO-Monate übernommen");
  }

  function resetAllRevenueOverrides(): void {
    Modal.confirm({
      title: "Alle Umsatz-Overrides zurücksetzen?",
      content: "Bist du sicher? Alle MANUELL-Monate werden auf AUTO zurückgesetzt.",
      okText: "Zurücksetzen",
      cancelText: "Abbrechen",
      onOk: () => {
        setIncomings((prev) => {
          const rows = syncIncomingsToWindow(prev, startMonth, horizonMonths);
          return sortIncomings(rows.map((row) => ({
            ...row,
            source: "forecast",
            revenueEur: null,
          })));
        });
        setAutoSaveHint("Alle Umsatz-Overrides zurückgesetzt");
      },
    });
  }

  return (
    <div
      className="v2-page"
      onBlurCapture={(event) => {
        if (!isEditableNode(event.target)) return;
        if (!hasPendingChanges) return;
        scheduleAutoSave(120);
      }}
    >
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Cash-in Setup</Title>
            <Paragraph>
              Transparenz für Forecast, manuelle Eingaben und die global verwendeten Cash-in-Werte aus dem Dashboard.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {hasPendingChanges ? <Tag color="gold">Ungespeicherte Aenderungen</Tag> : <Tag color="green">Synchron</Tag>}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
            {autoSaveHint ? <Tag color={hasPendingChanges ? "gold" : "blue"}>{autoSaveHint}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={5} style={{ margin: 0 }}>Monatsende-Projektion (aktueller Monat)</Title>
          <Tag color="blue">{formatMonthLabel(currentMonthValue)} ({currentMonthValue})</Tag>
        </Space>
        {!currentMonthInPlanning ? (
          <Alert
            style={{ marginTop: 10 }}
            type="info"
            showIcon
            message="Aktueller Monat liegt nicht im Planungsfenster."
            description="Bitte Startmonat/Horizon anpassen, damit die Monatsende-Projektion gepflegt werden kann."
          />
        ) : (
          <Space direction="vertical" size={10} style={{ width: "100%", marginTop: 10 }}>
            <Text type="secondary">
              Diese Werte kannst du täglich aktualisieren. Sie helfen bei der Kalibrierung (Umsatz) und als Signal für die Quote.
            </Text>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 10,
              }}
            >
              <div>
                <Text type="secondary">Prognose Umsatz zum Monatsende (EUR)</Text>
                <div data-field-key={`inputs.incomings.${currentMonthIncoming?.id || "current"}.calibrationSellerboardMonthEndEur`}>
                  <DeNumberInput
                    value={currentCalibrationRevenueForecast ?? undefined}
                    mode="decimal"
                    min={0}
                    step={100}
                    style={{ width: "100%" }}
                    onChange={(value) => {
                      setCurrentMonthCalibrationPatch({
                        calibrationSellerboardMonthEndEur: normalizeNonNegativeInput(value),
                      });
                    }}
                  />
                </div>
                <Text type="secondary">
                  Forecast roh: {formatNumber(currentMonthForecastRevenue, 2)} EUR
                </Text>
              </div>
              <div>
                <Text type="secondary">Prognose Auszahlung zum Monatsende (EUR)</Text>
                <div data-field-key={`inputs.incomings.${currentMonthIncoming?.id || "current"}.calibrationPayoutRateToDatePct`}>
                  <DeNumberInput
                    value={currentCalibrationPayoutForecast ?? undefined}
                    mode="decimal"
                    min={0}
                    step={100}
                    style={{ width: "100%" }}
                    onChange={(value) => {
                      setCurrentMonthCalibrationPatch({
                        calibrationPayoutRateToDatePct: normalizeNonNegativeInput(value),
                      });
                    }}
                  />
                </div>
                <Text type="secondary">
                  Abgeleitete Quote: {Number.isFinite(currentMonthProjectedQuotePct as number) ? `${formatNumber(currentMonthProjectedQuotePct, 2)} %` : "—"}
                </Text>
              </div>
              <div>
                <Text type="secondary">Kalibrierfaktor (Preview)</Text>
                <div><Text strong>Angewendet: {formatFactor(currentMonthAppliedFactor)}</Text></div>
                <div><Text type="secondary">Basis: {formatFactor(currentMonthFactorBasis)} · Konservativ: {formatFactor(currentMonthFactorConservative)}</Text></div>
                <div><Text type="secondary">Forecast kalibriert: {formatNumber(currentMonthCalibratedRevenue, 2)} EUR</Text></div>
              </div>
            </div>
            <Space wrap>
              <Tag color="default" title="Differenz Monatsende-Projektion Umsatz minus Forecast-Umsatz">
                Delta Umsatz: {formatSignedCurrencyDelta(Number(currentMonthProjectedRevenueDelta || 0))}
              </Tag>
              <Tag color="default">
                Delta Umsatz (%): {Number.isFinite(currentMonthProjectedRevenueDeltaPct as number) ? `${formatSignedDelta(Number(currentMonthProjectedRevenueDeltaPct))}%` : "—"}
              </Tag>
              <Tag color="default" title="Differenz Projektion Auszahlung minus Auszahlung aus kalibriertem Umsatz x verwendeter Quote">
                Delta Auszahlung: {Number.isFinite(currentMonthProjectedPayoutDelta as number) ? formatSignedCurrencyDelta(Number(currentMonthProjectedPayoutDelta)) : "—"}
              </Tag>
              {currentMonthCalibrationUnusual ? <Tag color="warning">Auffälliger Kalibrierfaktor</Tag> : null}
              <Tooltip title={currentMonthCalibrationTooltip}>
                <Tag color="blue">Kalibrier-Details</Tag>
              </Tooltip>
              <Button
                size="small"
                onClick={() => {
                  setCurrentMonthCalibrationPatch({
                    calibrationSellerboardMonthEndEur: null,
                    calibrationPayoutRateToDatePct: null,
                  });
                }}
              >
                Projektion leeren
              </Button>
            </Space>
          </Space>
        )}
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={5} style={{ margin: 0 }}>Monatstabelle: Umsatz / Auszahlung / Quote</Title>
          <Space wrap>
            <Tooltip title="Füllt nur Monate ohne Umsatz-Override (AUTO).">
              <Button size="small" onClick={applyForecastToAutoMonths}>
                Forecast in leere Monate übernehmen
              </Button>
            </Tooltip>
            <Button size="small" danger onClick={resetAllRevenueOverrides}>
              Alle Monats-Overrides zurücksetzen
            </Button>
          </Space>
        </Space>
        <Space style={{ marginTop: 10, marginBottom: 8 }} wrap>
          <Text strong>Globale Steuerung (Dashboard)</Text>
          <Tag color="blue">
            Umsatzbasis: {globalRevenueBasisMode === "forecast_direct" ? "Forecast-Umsatz (direkt)" : "Plan-Umsatz (Hybrid)"}
          </Tag>
          <Tag color={globalCalibrationEnabled ? "green" : "default"}>
            Kalibrierung: {globalCalibrationEnabled ? "AN" : "AUS"}
          </Tag>
          <Tag color={globalQuoteMode === "recommendation" ? "green" : "orange"}>
            Auszahlungsquote: {globalQuoteMode === "recommendation" ? "Empfohlen (Plan)" : "Manuell"}
          </Tag>
          <Text type="secondary">Read-only in Cash-in. Ändern im Dashboard.</Text>
        </Space>
        <Segmented
          style={{ marginBottom: 12 }}
          value={tableFocus}
          onChange={(value) => {
            setTableFocus(String(value) === "payout" ? "payout" : "revenue");
          }}
          options={[
            { label: "Umsatz", value: "revenue" },
            { label: "Auszahlungsquote", value: "payout" },
          ]}
        />
        <StatsTableShell>
          <table className="v2-stats-table" data-layout="fixed" style={{ minWidth: tableFocus === "revenue" ? 1520 : 1320 }}>
            <thead>
              {tableFocus === "revenue" ? (
                <tr>
                  <th style={{ width: 130 }}>Monat</th>
                  <th style={{ width: 190 }}>Umsatz Forecast (EUR)</th>
                  <th style={{ width: 280 }}>Umsatz Manuell (EUR)</th>
                  <th style={{ width: 190 }}>Umsatz Kalibriert (EUR)</th>
                  <th style={{ width: 250 }}>Umsatz verwendet (EUR)</th>
                  <th style={{ width: 210 }}>Einzahlungen (EUR)</th>
                  <th style={{ width: 130 }}>Aktion</th>
                </tr>
              ) : (
                <tr>
                  <th style={{ width: 130 }}>Monat</th>
                  <th style={{ width: 280 }}>Manuelle Quote (%)</th>
                  <th style={{ width: 250 }}>Empfohlene Quote (%)</th>
                  <th style={{ width: 260 }}>Auszahlungsquote verwendet (%)</th>
                  <th style={{ width: 220 }}>Einzahlungen (EUR)</th>
                </tr>
              )}
            </thead>
            <tbody>
              {monthlyMatrixRows.map((row) => (
                <tr key={row.month}>
                  <td>
                    <Text strong>{row.monthLabel}</Text>
                    <div><Text type="secondary">{row.month}</Text></div>
                  </td>
                  {tableFocus === "revenue" ? (
                    <>
                      <td>
                        <Text>{formatNumber(row.forecastRevenue, 2)}</Text>
                      </td>
                      <td>
                        <div data-field-key={`inputs.incomings.${row.rowId}.revenueEur`}>
                          <DeNumberInput
                            value={row.manualRevenue ?? undefined}
                            mode="decimal"
                            min={0}
                            step={100}
                            style={{ width: "100%" }}
                            onChange={(value) => {
                              const parsed = toNumber(value);
                              updateIncomingMonth(row.month, (current) => ({
                                ...current,
                                revenueEur: Number.isFinite(parsed as number) ? Number(parsed) : null,
                                source: Number.isFinite(parsed as number) ? "manual" : "forecast",
                              }));
                            }}
                          />
                          <div style={{ marginTop: 6 }}>
                            {row.hasManualRevenue ? (
                              <Tag color="orange" style={{ marginRight: 0 }}>
                                MANUELL
                              </Tag>
                            ) : (
                              <Text type="secondary">Leer = automatisch (Forecast/Kalibrierung)</Text>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <Text>{formatNumber(row.calibratedRevenue, 2)}</Text>
                      </td>
                      <td>
                        <Space direction="vertical" size={4}>
                          <Text strong>{formatNumber(row.usedRevenue, 2)}</Text>
                          <Tag style={{ marginRight: 0 }}>{usedRevenueSourceLabel(row.usedRevenueSource)}</Tag>
                        </Space>
                      </td>
                      <td>
                        <Text strong>{formatNumber(row.usedPayout, 2)}</Text>
                      </td>
                      <td>
                        <Button
                          size="small"
                          type="text"
                          disabled={!row.hasManualRevenue}
                          onClick={() => resetRevenueOverrideForMonth(row.month)}
                        >
                          ↺ Reset
                        </Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <div data-field-key={`inputs.incomings.${row.rowId}.payoutPct`}>
                          <DeNumberInput
                            value={row.manualQuote ?? undefined}
                            mode="percent"
                            min={CASH_IN_QUOTE_MIN_PCT}
                            max={CASH_IN_QUOTE_MAX_PCT}
                            step={0.1}
                            style={{ width: "100%" }}
                            onChange={(value) => {
                              updateIncomingMonth(row.month, (current) => ({
                                ...current,
                                payoutPct: normalizePayoutInput(value),
                              }));
                            }}
                          />
                          <div style={{ marginTop: 6 }}>
                            <Tag color={Number.isFinite(row.manualQuote as number) ? "orange" : "default"} style={{ marginRight: 0 }}>
                              {Number.isFinite(row.manualQuote as number) ? "MANUELL" : "AUTO"}
                            </Tag>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Space direction="vertical" size={4}>
                          <Text>{formatNumber(row.recommendedQuote, 2)}</Text>
                          <Tooltip title={row.recommendationTooltip}>
                            <Tag color="blue" style={{ marginRight: 0 }}>{row.recommendationSourceLabel}</Tag>
                          </Tooltip>
                        </Space>
                      </td>
                      <td>
                        <Space direction="vertical" size={4}>
                          <Text strong>{formatNumber(row.usedQuote, 2)}</Text>
                          <Tag style={{ marginRight: 0 }}>{usedQuoteSourceLabel(row.usedQuoteSource)}</Tag>
                        </Space>
                      </td>
                      <td>
                        <Text strong>{formatNumber(row.usedPayout, 2)}</Text>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>
    </div>
  );
}

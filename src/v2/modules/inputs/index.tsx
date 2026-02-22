import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useNavigate } from "react-router-dom";
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
  sourceTag: "IST" | "RECOMMENDED_BASIS" | "RECOMMENDED_CONSERVATIVE" | "PROGNOSE" | string;
  explanation?: string;
  mode?: "basis" | "conservative" | string;
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

  return sortIncomings(Array.from(byMonth.values()));
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
    ? `Live-Anker wirkt wegen Tag ${d} und Horizont h=${h} mit Gewicht ${formatFactor(wEff)}.`
    : "Kein aktiver Live-Anker; Faktor folgt dem gelernten Bias.";
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
  const navigate = useNavigate();

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
  const forecastState = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastSettings = (forecastState.settings && typeof forecastState.settings === "object")
    ? forecastState.settings as Record<string, unknown>
    : {};
  const methodikUseForecast = forecastSettings.useForecast === true;
  const methodikCashInMode = String(settingsState.cashInMode || "").trim().toLowerCase() === "basis" ? "basis" : "conservative";

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
      mode: methodikCashInMode,
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
    methodikCashInMode,
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
  const currentMonthAppliedFactor = cashInCalibrationEnabled
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
  const currentMonthCalibrationTooltip = currentMonthCalibrationEntry && cashInCalibrationEnabled
    ? buildCalibrationMonthTooltip(currentMonthCalibrationEntry, cashInCalibrationMode)
    : cashInCalibrationEnabled
      ? "Kalibrierfaktor wird berechnet, sobald die Umsatzprognose bis Monatsende im aktuellen Monat gesetzt ist und Forecast-Umsatz > 0 ist."
      : "Kalibrierung ist deaktiviert.";

  const calibrationImpact = useMemo(() => {
    let baseRevenueTotal = 0;
    let calibratedRevenueTotal = 0;
    let basePayoutTotal = 0;
    let calibratedPayoutTotal = 0;
    let affectedMonths = 0;

    sortIncomings(incomings).forEach((row) => {
      const month = String(row.month || "");
      const forecastRevenue = Number(forecastRevenueByMonth.get(month) || 0);
      const factor = cashInCalibrationEnabled
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

    const revenueDelta = cashInCalibrationEnabled ? (calibratedRevenueTotal - baseRevenueTotal) : 0;
    const payoutDelta = cashInCalibrationEnabled ? (calibratedPayoutTotal - basePayoutTotal) : 0;
    return {
      revenueDelta,
      payoutDelta,
      affectedMonths,
    };
  }, [
    cashInCalibrationEnabled,
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
        cashInCalibrationEnabled: snapshot.cashInCalibrationEnabled !== false,
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

      const monthlyObject: Record<string, Record<string, number>> = {};
      snapshot.monthlyActuals.forEach((row) => {
        if (!isMonthKey(row.month)) return;
        const nextMonthly: Record<string, number> = {};
        const realRevenue = toNumber(row.realRevenueEUR);
        const realPayoutRate = toNumber(row.realPayoutRatePct);
        const realClosing = toNumber(row.realClosingBalanceEUR);
        if (Number.isFinite(realRevenue as number)) nextMonthly.realRevenueEUR = Number(realRevenue);
        if (Number.isFinite(realPayoutRate as number)) nextMonthly.realPayoutRatePct = Number(realPayoutRate);
        if (Number.isFinite(realClosing as number)) nextMonthly.realClosingBalanceEUR = Number(realClosing);
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
            <Title level={3}>Eingaben</Title>
            <Paragraph>
              Opening Balance, Monats-Horizont, Umsaetze, Extras, Dividenden und Monats-Istwerte.
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

      <Card>
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Space wrap>
            <Text strong>Methodik (global)</Text>
            <Tag color="blue">GLOBAL</Tag>
          </Space>
          <Space wrap>
            <Tag>Forecast im Cashflow: {methodikUseForecast ? "Ja" : "Nein"}</Tag>
            <Tag>Cash-In Modus: {methodikCashInMode === "basis" ? "Basis" : "Konservativ"}</Tag>
            <Tag>Kalibrierung: {cashInCalibrationEnabled ? "An" : "Aus"}</Tag>
            <Tag>Kalibrier-Modus: {cashInCalibrationMode === "basis" ? "Basis" : "Konservativ"}</Tag>
            <Tag>Live-Einfluss: h ≤ 3</Tag>
            <Tag>Saisonalität: {cashInRecommendationIgnoreQ4 ? "Aus" : "An"}</Tag>
          </Space>
          <Button size="small" onClick={() => navigate("/v2/methodik")}>
            In Methodik &amp; Regeln bearbeiten
          </Button>
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={5}>Umsatz-Kalibrierung</Title>
        <div
          style={{
            padding: 12,
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            background: "#fafafa",
          }}
        >
          <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }} wrap>
            <Title level={5} style={{ margin: 0 }}>
              Aktueller Monat: {formatMonthLabel(currentMonthValue)}
            </Title>
            {!currentMonthInPlanning ? <Tag color="orange">Aktueller Monat liegt ausserhalb des Planungshorizonts</Tag> : null}
          </Space>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color={cashInCalibrationEnabled ? "green" : "default"}>
              Umsatzkalibrierung {cashInCalibrationEnabled ? "aktiv" : "aus"}
            </Tag>
            <Tag>Modus: {cashInCalibrationMode === "basis" ? "Basis" : "Konservativ"}</Tag>
            <Tag>Live-Einfluss: h ≤ 3</Tag>
            <Select
              value={cashInCalibrationMode}
              style={{ width: 210 }}
              options={[
                { value: "basis", label: "Kalibriert (Basis)" },
                { value: "conservative", label: "Kalibriert (Konservativ)" },
              ]}
              onChange={(value) => {
                setCashInCalibrationMode(
                  normalizeRevenueCalibrationMode(value) as "basis" | "conservative",
                );
              }}
            />
            <Button size="small" onClick={() => navigate("/v2/methodik")}>
              Methodik (global) ändern
            </Button>
            <Tooltip title="Live-Anker: Umsatzprognose bis Monatsende / Forecast-Umsatz. Wirkung ab Tag 10, bis Tag 20 linear steigend, nach h=3 auslaufend.">
              <Tag>Info</Tag>
            </Tooltip>
          </Space>
          <Text type="secondary">
            Bias B und Risk R lernen monatlich aus IST vs. Forecast-Lock; der Live-Anker steuert untermonatlich.
          </Text>
          <Space wrap align="start" style={{ marginTop: 8 }}>
            <div>
              <Text>Umsatzprognose bis Monatsende (EUR)</Text>
              <DeNumberInput
                value={currentCalibrationRevenueForecast ?? undefined}
                mode="decimal"
                min={0}
                step={100}
                style={{ width: 240 }}
                onChange={(value) => {
                  const parsed = normalizeNonNegativeInput(value);
                  if (parsed == null && value != null && String(value).trim() !== "") return;
                  setCurrentMonthCalibrationPatch({
                    calibrationSellerboardMonthEndEur: parsed,
                  });
                }}
                disabled={!currentMonthInPlanning}
              />
            </div>
            <div>
              <Text>Auszahlung bis Monatsende Prognose (EUR)</Text>
              <DeNumberInput
                value={currentCalibrationPayoutForecast ?? undefined}
                mode="decimal"
                min={0}
                step={100}
                style={{ width: 260 }}
                onChange={(value) => {
                  const parsed = normalizeNonNegativeInput(value);
                  if (parsed == null && value != null && String(value).trim() !== "") return;
                  setCurrentMonthCalibrationPatch({
                    calibrationPayoutRateToDatePct: parsed,
                  });
                }}
                disabled={!currentMonthInPlanning}
              />
            </div>
            <div>
              <Text>Kalibrierfaktor {formatMonthLabel(currentMonthValue)}</Text>
              <div style={{ minWidth: 180, paddingTop: 6 }}>
                <Tooltip title={currentMonthCalibrationTooltip}>
                  <Text strong>{formatFactor(currentMonthAppliedFactor)}</Text>
                </Tooltip>
              </div>
            </div>
          </Space>
          <div style={{ marginTop: 8 }}>
            <Text>
              Kalibrierfaktor aktueller Monat ({formatMonthLabel(currentMonthValue)}):{" "}
              <Text strong>{formatFactor(currentMonthAppliedFactor)}</Text>
            </Text>
            <div>
              <Text type="secondary">
                K_basis: {formatFactor(currentMonthFactorBasis)} · K_cons: {formatFactor(currentMonthFactorConservative)}
              </Text>
            </div>
            <div>
              <Text type="secondary">
                Forecast Umsatz ({formatMonthLabel(currentMonthValue)}): {formatNumber(currentMonthForecastRevenue, 2)} EUR
              </Text>
            </div>
            <div>
              <Text type="secondary">
                Kalibrierter Umsatz: {formatNumber(currentMonthCalibratedRevenue, 2)} EUR
              </Text>
            </div>
            <div>
              <Text type="secondary">
                Kalibrierter Payout (aus Quote): {formatNumber(currentMonthCalibratedPayout, 2)} EUR
              </Text>
            </div>
            <div>
              <Text type="secondary">
                Auszahlung Monatsende Prognose (manuell): {formatNumber(currentCalibrationPayoutForecast, 2)} EUR
              </Text>
            </div>
            {Number.isFinite(recommendationCurrentMonthForecastQuotePct as number) ? (
              <div>
                <Text type="secondary">
                  Prognose-Quote aktueller Monat: {formatNumber(recommendationCurrentMonthForecastQuotePct, 1)}%
                  {" "}(schwaches Live-Signal ab Tag 10)
                </Text>
              </div>
            ) : null}
            {currentMonthCalibrationUnusual ? (
              <Tag color="warning" style={{ marginTop: 6 }}>
                Ungewoehnlicher Faktor ({formatFactor(currentMonthCalibrationRawFactor)})
              </Tag>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={5} style={{ margin: 0 }}>Umsaetze x Payout</Title>
          <Space wrap>
            <Tag>Level L: {formatNumber(recommendationLevelPct, 1)}%</Tag>
            <Tag>RiskBase: {formatNumber(recommendationRiskBasePct, 2)}pp</Tag>
            <Tag>Saisonalität: {cashInRecommendationIgnoreQ4 ? "Aus" : "An"}</Tag>
            {historicalImportSampleCount > 0 ? (
              <Tag color="blue">Historisches Startprofil: n={historicalImportSampleCount}</Tag>
            ) : null}
            <Tooltip title="Einmal-Import historischer Monatsquoten als robustes Startprofil für L und Saisonalität.">
              <Button size="small" onClick={() => setHistoricalImportOpen(true)}>
                Historische Quoten importieren
              </Button>
            </Tooltip>
            <Button size="small" onClick={() => navigate("/v2/methodik")}>
              Methodik (global) ändern
            </Button>
            <Button
              onClick={() => {
                setIncomings((prev) => {
                  const sorted = sortIncomings(prev);
                  const lastMonth = sorted.length
                    ? sorted[sorted.length - 1].month
                    : addMonths(startMonth || currentMonthKey(), Math.max(0, Math.round(horizonMonths || 1) - 1));
                  const nextMonth = addMonths(lastMonth, 1);
                  if (sorted.some((entry) => entry.month === nextMonth)) return sorted;
                  const lastPayout = sorted
                    .slice()
                    .reverse()
                    .find((entry) => Number.isFinite(normalizePayoutInput(entry.payoutPct) as number))
                    ?.payoutPct;
                  const recommendedPayout = normalizePayoutInput(
                    payoutRecommendation.byMonth?.[nextMonth]?.quotePct,
                  );
                  return sortIncomings([
                    ...sorted,
                    {
                      id: randomId("inc"),
                      month: nextMonth,
                      revenueEur: 0,
                      payoutPct: Number.isFinite(recommendedPayout as number)
                        ? recommendedPayout
                        : (normalizePayoutInput(lastPayout) ?? null),
                      source: "manual",
                      calibrationCutoffDate: null,
                      calibrationRevenueToDateEur: null,
                      calibrationPayoutRateToDatePct: null,
                      calibrationSellerboardMonthEndEur: null,
                    },
                  ]);
                });
                setHorizonMonths((prev) => Math.max(1, Math.round(Number(prev || 1))) + 1);
              }}
            >
              Naechsten Monat anhaengen
            </Button>
          </Space>
        </Space>
        <Space style={{ marginBottom: 8 }} wrap>
          <Text type="secondary">
            Die Umsatzzeilen sind strikt auf den Planungszeitraum ({startMonth} + {horizonMonths} Monate) synchronisiert.
          </Text>
          <Tag color={cashInCalibrationEnabled ? "green" : "default"}>
            {cashInCalibrationEnabled ? "Umsatzkalibrierung aktiv" : "Umsatzkalibrierung aus"}
          </Tag>
          <Tag>Modus: {cashInCalibrationMode === "basis" ? "Basis" : "Konservativ"}</Tag>
          <Tag>Live-Einfluss: h ≤ 3</Tag>
          <Tooltip title="Vergleich über den gesamten Planungshorizont: Kalibrierung aktiv vs. neutral (Faktor 1,00).">
            <Tag color={calibrationImpact.revenueDelta <= 0 ? "orange" : "green"}>
              Impact Umsatz: {formatSignedCurrencyDelta(calibrationImpact.revenueDelta)}
            </Tag>
          </Tooltip>
          <Tooltip title="Vergleich über den gesamten Planungshorizont: Kalibrierung aktiv vs. neutral (Faktor 1,00).">
            <Tag color={calibrationImpact.payoutDelta <= 0 ? "orange" : "green"}>
              Impact Auszahlung: {formatSignedCurrencyDelta(calibrationImpact.payoutDelta)}
            </Tag>
          </Tooltip>
          <Tooltip title={recommendationInfoTooltip}>
            <Tag>
              Empfehlung: L {formatNumber(recommendationLevelPct, 1)}% · RiskBase {formatNumber(recommendationRiskBasePct, 2)}pp
            </Tag>
          </Tooltip>
          {Number.isFinite(recommendationCurrentMonthForecastQuotePct as number) ? (
            <Tag color="blue">
              Prognose-Quote aktuell: {formatNumber(recommendationCurrentMonthForecastQuotePct, 1)}%
            </Tag>
          ) : null}
          <Tag>Aktive Kalibrier-Monate: {calibrationImpact.affectedMonths}</Tag>
          {payoutRecommendation.uncertain ? (
            <Tag color="orange">
              Empfehlung unsicher ({payoutRecommendation.sampleCount} Ist-Monate)
            </Tag>
          ) : null}
        </Space>
        <StatsTableShell>
          <table className="v2-stats-table" data-layout="fixed" style={{ minWidth: 1720 }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Monat</th>
                <th style={{ width: 220 }}>Forecast Umsatz (roh) / Manuell</th>
                <th style={{ width: 90 }}>Faktor</th>
                <th style={{ width: 210 }}>
                  {cashInCalibrationMode === "conservative"
                    ? "Kalibrierter Umsatz (Konservativ)"
                    : "Kalibrierter Umsatz (Basis)"}
                  {" "}EUR
                </th>
                <th style={{ width: 180 }}>Auszahlungsquote (manuell) %</th>
                <th style={{ width: 220 }}>Verwendete Quote %</th>
                <th style={{ width: 190 }}>Payout EUR (aktiv)</th>
                <th style={{ width: 190 }}>Payout kalibriert (EUR)</th>
                <th style={{ width: 240 }}>Status</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {sortIncomings(incomings).map((row) => {
                const recommendationEntry = payoutRecommendationByMonth.get(row.month) || null;
                const recommendationSourceTag = String(
                  recommendationEntry?.sourceTag
                  || (methodikCashInMode === "basis" ? "RECOMMENDED_BASIS" : "RECOMMENDED_CONSERVATIVE"),
                );
                const recommendationMode = String(recommendationEntry?.mode || methodikCashInMode).trim().toLowerCase() === "basis"
                  ? "basis"
                  : "conservative";
                const recommendationQuoteRaw = Number(recommendationEntry?.quotePct);
                const recommendation = Number.isFinite(recommendationQuoteRaw)
                  ? clampPct(recommendationQuoteRaw, CASH_IN_QUOTE_MIN_PCT, CASH_IN_QUOTE_MAX_PCT)
                  : null;
                const recommendationSourceLabel = recommendationSourceTag === "IST"
                  ? "IST"
                  : recommendationSourceTag === "RECOMMENDED_BASIS"
                    ? "Empfohlen (Basis)"
                    : recommendationSourceTag === "RECOMMENDED_CONSERVATIVE"
                      ? "Empfohlen (Konservativ)"
                      : recommendationSourceTag === "PROGNOSE"
                        ? "Live-Signal"
                        : "Empfehlung";
                const recommendationBadgeColor = recommendationSourceTag === "IST"
                  ? "green"
                  : recommendationMode === "conservative"
                    ? "volcano"
                    : "blue";
                const recommendationCapsApplied = Array.isArray(recommendationEntry?.capsApplied)
                  ? recommendationEntry?.capsApplied.filter(Boolean)
                  : [];
                const recommendationTooltip = [
                  `Quelle: ${recommendationSourceLabel}`,
                  recommendationEntry?.explanation ? String(recommendationEntry.explanation) : null,
                  Number.isFinite(Number(recommendationEntry?.levelPct))
                    ? `L: ${formatNumber(recommendationEntry?.levelPct, 1)}%`
                    : null,
                  Number.isFinite(Number(recommendationEntry?.seasonalityPct))
                    ? `S: ${formatNumber(recommendationEntry?.seasonalityPct, 1)}% (n=${Math.max(0, Math.round(Number(recommendationEntry?.seasonalitySampleCount || 0)))})`
                    : null,
                  recommendationMode === "conservative"
                    ? `RiskBase: ${formatNumber(recommendationEntry?.riskBasePct, 2)}pp · R(h=${Math.max(0, Math.round(Number(recommendationEntry?.horizonMonths || 0)))}): ${formatNumber(recommendationEntry?.riskAdjustmentPct, 2)}pp`
                    : null,
                  recommendationEntry?.shrinkageActive === true ? "Shrinkage aktiv" : null,
                  recommendationEntry?.liveSignalUsed === true
                    ? `Live-Signal: ${formatNumber(Number(recommendationEntry?.liveSignalWeight || 0) * 100, 0)}% Gewicht`
                    : null,
                  recommendationCapsApplied.length ? "Grenzwert angewendet" : null,
                  `Saisonalität: ${cashInRecommendationIgnoreQ4 ? "aus" : "an"}`,
                ]
                  .filter(Boolean)
                  .join(" | ");
                const manualPayout = normalizePayoutInput(row.payoutPct);
                const hasManualPayout = Number.isFinite(manualPayout as number);
                const payoutPctForCalc = Number.isFinite(manualPayout as number)
                  ? Number(manualPayout)
                  : (Number.isFinite(recommendation as number) ? Number(recommendation) : null);
                const payoutDelta = Number.isFinite(recommendation)
                  && hasManualPayout
                  ? Number(manualPayout) - Number(recommendation)
                  : null;
                const shouldWarnDelta = Number.isFinite(payoutDelta as number) && Math.abs(Number(payoutDelta)) >= PAYOUT_DELTA_WARNING_PCT;
                const effectiveQuoteLabel = hasManualPayout
                  ? "Manuell"
                  : recommendationMode === "basis"
                    ? "Empfohlen (Basis)"
                    : "Empfohlen (Konservativ)";
                const effectiveQuoteColor = hasManualPayout
                  ? "blue"
                  : recommendationMode === "basis"
                    ? "green"
                    : "volcano";
                const effectiveQuoteTooltip = hasManualPayout
                  ? "Manuell gesetzte Monatsquote ist führend."
                  : recommendationTooltip;
                const forecastRevenue = Number(forecastRevenueByMonth.get(row.month) || 0);
                const calibrationByMonth = (revenueCalibrationProfile.byMonth?.[row.month] || null) as Record<string, unknown> | null;
                const factorBasis = Number(calibrationByMonth?.factorBasis || 1);
                const factorConservative = Number(calibrationByMonth?.factorConservative || 1);
                const selectedFactorRaw = cashInCalibrationMode === "conservative" ? factorConservative : factorBasis;
                const factorApplied = cashInCalibrationEnabled && Number.isFinite(selectedFactorRaw)
                  ? selectedFactorRaw
                  : 1;
                const calibratedRevenueBasis = forecastRevenue * (Number.isFinite(factorBasis) ? factorBasis : 1);
                const calibratedRevenueConservative = forecastRevenue * (Number.isFinite(factorConservative) ? factorConservative : 1);
                const calibratedRevenue = cashInCalibrationMode === "conservative"
                  ? calibratedRevenueConservative
                  : calibratedRevenueBasis;
                const calibrationActiveForRow = cashInCalibrationEnabled && Math.abs(factorApplied - 1) > 0.000001;
                const forecastMissing = row.source === "forecast" && (!Number.isFinite(forecastRevenue) || forecastRevenue <= 0);
                const manualRevenue = toNumber(row.revenueEur);
                const isManualRevenueOverride = row.source === "manual" && Number.isFinite(forecastRevenue) && forecastRevenue > 0;
                const manualPayoutEur = Number.isFinite(payoutPctForCalc as number) && Number.isFinite(manualRevenue as number)
                  ? Number(manualRevenue) * (Number(payoutPctForCalc) / 100)
                  : null;
                const forecastPayout = Number.isFinite(payoutPctForCalc as number)
                  ? forecastRevenue * (Number(payoutPctForCalc) / 100)
                  : null;
                const calibratedPayout = Number.isFinite(payoutPctForCalc as number)
                  ? calibratedRevenue * (Number(payoutPctForCalc) / 100)
                  : null;
                const effectivePayout = isManualRevenueOverride
                  ? manualPayoutEur
                  : (cashInCalibrationEnabled ? calibratedPayout : forecastPayout);
                const factorTooltip = !cashInCalibrationEnabled
                  ? "Kalibrierung ist deaktiviert. Faktor = 1,00."
                  : calibrationByMonth
                    ? buildCalibrationMonthTooltip(calibrationByMonth, cashInCalibrationMode)
                    : "Keine Kalibrierdaten für diesen Monat verfügbar.";

                return (
                  <tr key={row.id}>
                    <td>
                      <Text strong>{formatMonthLabel(row.month)}</Text>
                      <div><Text type="secondary">{row.month}</Text></div>
                    </td>
                    <td>
                      <div
                        data-field-key={`inputs.incomings.${row.id}.revenueEur`}
                        style={isManualRevenueOverride ? {
                          border: "1px solid #faad14",
                          borderRadius: 8,
                          padding: 6,
                        } : undefined}
                      >
                        <DeNumberInput
                          value={row.revenueEur ?? undefined}
                          mode="decimal"
                          min={0}
                          step={100}
                          style={{ width: "100%" }}
                          onChange={(value) => {
                            setIncomings((prev) => prev.map((entry) => {
                              if (entry.id !== row.id) return entry;
                              return {
                                ...entry,
                                revenueEur: toNumber(value),
                                source: "manual",
                              };
                            }));
                          }}
                        />
                        {isManualRevenueOverride ? <Text type="warning">manuell ueberschrieben</Text> : null}
                        <div><Text type="secondary">Forecast: {formatNumber(forecastRevenue, 2)} EUR</Text></div>
                      </div>
                    </td>
                    <td>
                      <Tooltip title={factorTooltip}>
                        <Text strong>{formatFactor(factorApplied)}</Text>
                      </Tooltip>
                    </td>
                    <td>{formatNumber(calibratedRevenue, 2)}</td>
                    <td>
                      <div data-field-key={`inputs.incomings.${row.id}.payoutPct`}>
                        <DeNumberInput
                          value={row.payoutPct ?? undefined}
                          mode="percent"
                          min={CASH_IN_QUOTE_MIN_PCT}
                          max={CASH_IN_QUOTE_MAX_PCT}
                          step={0.1}
                          style={{ width: "100%" }}
                          onChange={(value) => {
                            setIncomings((prev) => prev.map((entry) => (
                              entry.id === row.id
                                ? { ...entry, payoutPct: normalizePayoutInput(value) }
                                : entry
                            )));
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      {Number.isFinite(payoutPctForCalc as number)
                        ? (
                          <div>
                            <Tooltip title={effectiveQuoteTooltip}>
                              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <span>{formatNumber(payoutPctForCalc, 2)}</span>
                                <Tag color={effectiveQuoteColor} style={{ marginRight: 0 }}>
                                  {effectiveQuoteLabel}
                                </Tag>
                                {!hasManualPayout && Number.isFinite(recommendation as number) ? (
                                  <Tag color={recommendationBadgeColor} style={{ marginRight: 0 }}>
                                    {recommendationSourceLabel}
                                  </Tag>
                                ) : null}
                              </div>
                            </Tooltip>
                            {shouldWarnDelta ? <Tag color="orange">Delta {formatSignedDelta(Number(payoutDelta))}</Tag> : null}
                          </div>
                        )
                        : <Text type="secondary">—</Text>}
                    </td>
                    <td>
                      <div>
                        <Text strong>{formatNumber(effectivePayout, 2)}</Text>
                        {isManualRevenueOverride ? (
                          <div><Text type="secondary">Forecast kalibriert: {formatNumber(calibratedPayout, 2)} EUR</Text></div>
                        ) : cashInCalibrationEnabled ? (
                          <div><Text type="secondary">Forecast: {formatNumber(forecastPayout, 2)} EUR</Text></div>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatNumber(calibratedPayout, 2)}</td>
                    <td>
                      <div style={{ minWidth: 170 }}>
                        {cashInCalibrationEnabled ? (
                          <Tag color={cashInCalibrationMode === "conservative" ? "volcano" : "green"}>
                            {cashInCalibrationMode === "basis" ? "Modus Basis" : "Modus Konservativ"}
                          </Tag>
                        ) : null}
                        {row.source === "forecast" ? <Tag color="blue">Forecast übertragen</Tag> : null}
                        {isManualRevenueOverride ? <Tag color="orange">Manuell ueberschrieben</Tag> : null}
                        {calibrationActiveForRow ? <Tag color="orange">Kalibriert</Tag> : null}
                        {forecastMissing ? <div><Text type="warning">Kein Forecast-Umsatz vorhanden</Text></div> : null}
                      </div>
                    </td>
                    <td>
                      <Button
                        danger
                        onClick={() => {
                          setIncomings((prev) => prev.filter((entry) => entry.id !== row.id));
                        }}
                      >
                        X
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Extras</Title>
          <Button
            onClick={() => {
              setExtras((prev) => [...prev, {
                id: randomId("extra"),
                date: `${currentMonthKey()}-15`,
                label: "Extra",
                amountEur: 0,
              }]);
            }}
          >
            Extra
          </Button>
        </Space>
        <StatsTableShell>
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Label</th>
                <th>Betrag EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {extras.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div data-field-key={`inputs.extras.${row.id}.date`}>
                      <Input
                        type="date"
                        value={row.date}
                        onChange={(event) => {
                          setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, date: event.target.value } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.extras.${row.id}.label`}>
                      <Input
                        value={row.label}
                        onChange={(event) => {
                          setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, label: event.target.value } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.extras.${row.id}.amountEur`}>
                      <DeNumberInput
                        value={row.amountEur ?? undefined}
                        mode="decimal"
                        style={{ width: "100%" }}
                        step={10}
                        onChange={(value) => {
                          setExtras((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, amountEur: toNumber(value) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setExtras((prev) => prev.filter((entry) => entry.id !== row.id));
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Dividenden</Title>
          <Button
            onClick={() => {
              setDividends((prev) => [...prev, {
                id: randomId("div"),
                month: currentMonthKey(),
                label: "Dividende",
                amountEur: 0,
              }]);
            }}
          >
            Dividende
          </Button>
        </Space>
        <StatsTableShell>
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Label</th>
                <th>Betrag EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dividends.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div data-field-key={`inputs.dividends.${row.id}.month`}>
                      <Input
                        type="month"
                        value={row.month}
                        onChange={(event) => {
                          setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, month: normalizeMonth(event.target.value, row.month) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.dividends.${row.id}.label`}>
                      <Input
                        value={row.label}
                        onChange={(event) => {
                          setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, label: event.target.value } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.dividends.${row.id}.amountEur`}>
                      <DeNumberInput
                        value={row.amountEur ?? undefined}
                        mode="decimal"
                        style={{ width: "100%" }}
                        step={10}
                        onChange={(value) => {
                          setDividends((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, amountEur: toNumber(value) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setDividends((prev) => prev.filter((entry) => entry.id !== row.id));
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }}>
          <Title level={5} style={{ margin: 0 }}>Monats-Istwerte (Monatsende)</Title>
          <Button
            onClick={() => {
              setMonthlyActuals((prev) => [
                ...prev,
                {
                  month: currentMonthKey(),
                  realRevenueEUR: 0,
                  realPayoutRatePct: 0,
                  realClosingBalanceEUR: 0,
                },
              ]);
            }}
          >
            Ist-Monat
          </Button>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 12 }}>
          Diese Werte gelten je Monat zum Monatsende und setzen den Kontostand ab diesem Monat als neue Baseline.
        </Paragraph>
        <StatsTableShell>
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Realer Umsatz EUR</th>
                <th>Reale Auszahlungsquote %</th>
                <th>Realer Kontostand Monatsende EUR</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {monthlyActuals.map((row, index) => (
                <tr key={`${row.month}-${index}`}>
                  <td>
                    <div data-field-key={`inputs.monthlyActuals.${index}.month`}>
                      <Input
                        type="month"
                        value={row.month}
                        onChange={(event) => {
                          const value = normalizeMonth(event.target.value, row.month);
                          setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, month: value } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.monthlyActuals.${index}.realRevenueEUR`}>
                      <DeNumberInput
                        value={row.realRevenueEUR ?? undefined}
                        mode="decimal"
                        style={{ width: "100%" }}
                        onChange={(value) => {
                          setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realRevenueEUR: toNumber(value) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.monthlyActuals.${index}.realPayoutRatePct`}>
                      <DeNumberInput
                        value={row.realPayoutRatePct ?? undefined}
                        mode="percent"
                        style={{ width: "100%" }}
                        onChange={(value) => {
                          setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realPayoutRatePct: toNumber(value) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <div data-field-key={`inputs.monthlyActuals.${index}.realClosingBalanceEUR`}>
                      <DeNumberInput
                        value={row.realClosingBalanceEUR ?? undefined}
                        mode="decimal"
                        style={{ width: "100%" }}
                        onChange={(value) => {
                          setMonthlyActuals((prev) => prev.map((entry, idx) => idx === index ? { ...entry, realClosingBalanceEUR: toNumber(value) } : entry));
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <Button
                      danger
                      onClick={() => {
                        setMonthlyActuals((prev) => prev.filter((_, idx) => idx !== index));
                      }}
                    >
                      X
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatsTableShell>
      </Card>

      <Card>
        <Title level={5}>Basis-Parameter</Title>
        <Space wrap align="start">
          <div>
            <Text>Opening Balance (EUR)</Text>
            <div data-field-key="inputs.openingBalance">
              <DeNumberInput
                value={openingBalance}
                onChange={(value) => {
                  setOpeningBalance(Number(toNumber(value) || 0));
                }}
                style={{ width: 190 }}
                mode="decimal"
                min={0}
                step={100}
              />
            </div>
          </div>
          <div>
            <Text>Startmonat</Text>
            <div data-field-key="inputs.startMonth">
              <Input
                type="month"
                value={startMonth}
                onChange={(event) => {
                  const nextStartMonth = normalizeMonth(event.target.value, startMonth);
                  setStartMonth(nextStartMonth);
                  setIncomings((prev) => syncIncomingsToWindow(prev, nextStartMonth, horizonMonths));
                }}
                style={{ width: 170 }}
              />
            </div>
          </div>
          <div>
            <Text>Horizont (Monate)</Text>
            <div data-field-key="inputs.horizonMonths">
              <DeNumberInput
                value={horizonMonths}
                onChange={(value) => {
                  const nextHorizon = Math.max(1, Number(toNumber(value) || 1));
                  setHorizonMonths(nextHorizon);
                  setIncomings((prev) => syncIncomingsToWindow(prev, startMonth, nextHorizon));
                }}
                mode="int"
                min={1}
                max={48}
                style={{ width: 160 }}
              />
            </div>
          </div>
        </Space>
      </Card>

      <Modal
        open={historicalImportOpen}
        title="Historische Auszahlungsquoten importieren"
        okText="Startprofil übernehmen"
        onOk={applyHistoricalPriorImport}
        onCancel={() => {
          setHistoricalImportOpen(false);
          setHistoricalImportError(null);
        }}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Text type="secondary">
            Einmaliger Import als Startprofil. Echte IST-Monate überschreiben das Profil schrittweise.
          </Text>
          <div>
            <Text>Startmonat</Text>
            <Input
              type="month"
              value={historicalImportStartMonth}
              onChange={(event) => setHistoricalImportStartMonth(normalizeMonth(event.target.value, currentMonthKey()))}
            />
          </div>
          <div>
            <Text>Monatsquoten (%)</Text>
            <Input.TextArea
              rows={8}
              value={historicalImportValues}
              onChange={(event) => setHistoricalImportValues(event.target.value)}
              placeholder={"z. B.\n50,8\n51,2\n49,9\n..."}
            />
          </div>
          {historicalImportError ? <Alert type="error" showIcon message={historicalImportError} /> : null}
        </Space>
      </Modal>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { parseDeNumber } from "../../../lib/dataHealth.js";
import {
  CASH_IN_QUOTE_MAX_PCT,
  CASH_IN_QUOTE_MIN_PCT,
  buildCalibrationProfile,
  buildPayoutRecommendation,
  clampPct,
  normalizeCalibrationHorizonMonths,
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
  cashInCalibrationHorizonMonths: number;
  cashInRecommendationIgnoreQ4: boolean;
  incomings: IncomingDraft[];
  extras: ExtraDraft[];
  dividends: DividendDraft[];
  monthlyActuals: MonthlyActualDraft[];
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

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysInMonth(month: string): number | null {
  if (!isMonthKey(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber)) return null;
  return new Date(year, monthNumber, 0).getDate();
}

function parseDayFromIsoDate(value: unknown): number | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() + 1 !== month
    || date.getDate() !== day
  ) {
    return null;
  }
  return day;
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

function normalizePercentInput(value: unknown): number | null {
  const parsed = parsePayoutPctInput(value);
  if (!Number.isFinite(parsed as number)) return null;
  return Math.max(0, Math.min(100, Number(parsed)));
}

function buildCalibrationDecayTooltip(sourceMonth: string, rawFactor: number, horizonMonths: number): string {
  const segments: string[] = [];
  for (let offset = 0; offset <= horizonMonths; offset += 1) {
    const month = addMonths(sourceMonth, offset);
    const ratio = Math.max(0, (horizonMonths - offset) / horizonMonths);
    const factor = 1 + (rawFactor - 1) * ratio;
    segments.push(`${formatMonthLabel(month)}: ${formatFactor(factor)}`);
  }
  return segments.join(" · ");
}

function formatSignedDelta(value: number): string {
  if (!Number.isFinite(value)) return "";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function normalizeSnapshot(snapshot: InputsDraftSnapshot): string {
  return JSON.stringify({
    openingBalance: Number(snapshot.openingBalance || 0),
    startMonth: String(snapshot.startMonth || ""),
    horizonMonths: Math.max(1, Math.round(Number(snapshot.horizonMonths || 1))),
    cashInCalibrationHorizonMonths: normalizeCalibrationHorizonMonths(snapshot.cashInCalibrationHorizonMonths, 6),
    cashInRecommendationIgnoreQ4: snapshot.cashInRecommendationIgnoreQ4 === true,
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
  const [cashInCalibrationHorizonMonths, setCashInCalibrationHorizonMonths] = useState<number>(6);
  const [cashInRecommendationIgnoreQ4, setCashInRecommendationIgnoreQ4] = useState<boolean>(false);
  const [incomings, setIncomings] = useState<IncomingDraft[]>([]);
  const [extras, setExtras] = useState<ExtraDraft[]>([]);
  const [dividends, setDividends] = useState<DividendDraft[]>([]);
  const [monthlyActuals, setMonthlyActuals] = useState<MonthlyActualDraft[]>([]);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [autoSaveHint, setAutoSaveHint] = useState("");

  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef("");
  const skipNextAutoSaveRef = useRef(true);

  const planningMonths = useMemo(
    () => monthRange(startMonth, Math.max(1, Math.round(horizonMonths || 1))),
    [horizonMonths, startMonth],
  );

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
    const nextCalibrationHorizon = normalizeCalibrationHorizonMonths(settings.cashInCalibrationHorizonMonths, 6);
    const nextIgnoreQ4 = settings.cashInRecommendationIgnoreQ4 === true;

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
    setCashInCalibrationHorizonMonths(nextCalibrationHorizon);
    setCashInRecommendationIgnoreQ4(nextIgnoreQ4);
    setIncomings(nextIncomings);
    setExtras(nextExtras);
    setDividends(nextDividends);
    setMonthlyActuals(nextMonthlyActuals);

    lastSavedHashRef.current = normalizeSnapshot({
      openingBalance: nextOpeningBalance,
      startMonth: nextStartMonth,
      horizonMonths: nextHorizonMonths,
      cashInCalibrationHorizonMonths: nextCalibrationHorizon,
      cashInRecommendationIgnoreQ4: nextIgnoreQ4,
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

  const payoutByMonth = useMemo(() => {
    const map = new Map<string, number>();
    incomings.forEach((row) => {
      const revenue = Number(row.revenueEur || 0);
      const payoutPct = normalizePayoutInput(row.payoutPct) ?? 0;
      map.set(row.month, revenue * (payoutPct / 100));
    });
    return map;
  }, [incomings]);

  const forecastRevenueByMonthObject = useMemo(() => {
    const object: Record<string, number> = {};
    planningMonths.forEach((month) => {
      object[month] = Number(forecastRevenueByMonth.get(month) || 0);
    });
    return object;
  }, [forecastRevenueByMonth, planningMonths]);

  const payoutRecommendation = useMemo(() => {
    const monthlyActualsMap: Record<string, { realPayoutRatePct?: number }> = {};
    monthlyActuals.forEach((row) => {
      if (!isMonthKey(row.month)) return;
      const payoutPct = toNumber(row.realPayoutRatePct);
      if (!Number.isFinite(payoutPct as number)) return;
      monthlyActualsMap[row.month] = { realPayoutRatePct: Number(payoutPct) };
    });
    return buildPayoutRecommendation({
      monthlyActuals: monthlyActualsMap,
      ignoreQ4: cashInRecommendationIgnoreQ4,
      maxMonth: currentMonthKey(),
      minSamples: 4,
    });
  }, [cashInRecommendationIgnoreQ4, monthlyActuals]);

  const recommendationTooltip = useMemo(() => {
    const usedMonthsText = payoutRecommendation.usedMonths.length
      ? payoutRecommendation.usedMonths.map((month) => formatMonthLabel(month)).join(", ")
      : "keine";
    const medianText = Number.isFinite(payoutRecommendation.medianPct as number)
      ? `${formatNumber(payoutRecommendation.medianPct, 2)} %`
      : "nicht verfügbar";
    const uncertaintyText = payoutRecommendation.uncertain
      ? `Hinweis: nur ${payoutRecommendation.sampleCount} verwendbare Ist-Monate (< ${payoutRecommendation.minSamples}) - Empfehlung unsicher.`
      : "Stichprobe ausreichend.";
    return [
      `Genutzte Monate: ${usedMonthsText}`,
      `Q4 ausgeschlossen: ${payoutRecommendation.ignoreQ4 ? "ja" : "nein"}`,
      `Median: ${medianText}`,
      uncertaintyText,
    ].join(" | ");
  }, [payoutRecommendation]);

  const payoutRecommendationByMonth = useMemo(() => {
    const recommendationMap = new Map<string, number>();
    const median = Number(payoutRecommendation.medianPct);
    if (!Number.isFinite(median)) return recommendationMap;
    incomings.forEach((incoming) => {
      recommendationMap.set(incoming.month, median);
    });
    return recommendationMap;
  }, [incomings, payoutRecommendation.medianPct]);

  const currentMonthValue = currentMonthKey();
  const currentMonthInPlanning = planningMonths.includes(currentMonthValue);
  const currentMonthForecastRevenue = Number(forecastRevenueByMonth.get(currentMonthValue) || 0);

  const currentMonthIncoming = useMemo(
    () => sortIncomings(incomings).find((row) => row.month === currentMonthValue) || null,
    [currentMonthValue, incomings],
  );

  const currentCalibrationCutoffDate = String(currentMonthIncoming?.calibrationCutoffDate || todayIsoDate());
  const currentCalibrationRevenueToDate = toNumber(currentMonthIncoming?.calibrationRevenueToDateEur);
  const currentCalibrationPayoutRateToDate = toNumber(currentMonthIncoming?.calibrationPayoutRateToDatePct);
  const currentCalibrationProjection = useMemo(() => {
    const revenueToDate = Number(currentCalibrationRevenueToDate);
    if (!(Number.isFinite(revenueToDate) && revenueToDate >= 0)) return null;
    if (String(currentCalibrationCutoffDate || "").slice(0, 7) !== currentMonthValue) return null;
    const dayOfMonth = parseDayFromIsoDate(currentCalibrationCutoffDate);
    const monthDays = daysInMonth(currentMonthValue);
    if (!dayOfMonth || !monthDays) return null;
    return revenueToDate * (monthDays / dayOfMonth);
  }, [currentCalibrationCutoffDate, currentCalibrationRevenueToDate, currentMonthValue]);

  const currentMonthCalibrationProfile = useMemo(() => {
    const calibrationRow = currentMonthIncoming
      ? [{
        ...currentMonthIncoming,
        calibrationCutoffDate: currentCalibrationCutoffDate,
        calibrationSellerboardMonthEndEur: null,
      }]
      : [];
    return buildCalibrationProfile({
      incomings: calibrationRow,
      months: planningMonths,
      forecastRevenueByMonth: forecastRevenueByMonthObject,
      horizonMonths: cashInCalibrationHorizonMonths,
    });
  }, [
    cashInCalibrationHorizonMonths,
    currentCalibrationCutoffDate,
    currentMonthIncoming,
    forecastRevenueByMonthObject,
    planningMonths,
  ]);
  const currentMonthCalibrationCandidate = currentMonthCalibrationProfile.candidates.find(
    (candidate) => candidate.month === currentMonthValue,
  ) || null;
  const currentMonthCalibrationFactor = Number(currentMonthCalibrationCandidate?.rawFactor);
  const currentMonthCalibrationTooltip = Number.isFinite(currentMonthCalibrationFactor)
    ? [
      "Linearer Forecast aus Umsatz bis Stichtag.",
      `Startfaktor ${currentMonthValue}: ${formatFactor(currentMonthCalibrationFactor)}`,
      `Decay über ${cashInCalibrationHorizonMonths} Monate: ${buildCalibrationDecayTooltip(currentMonthValue, currentMonthCalibrationFactor, cashInCalibrationHorizonMonths)}`,
    ].join(" | ")
    : "Kalibrierfaktor wird berechnet, sobald Stichtag und Umsatz bis Stichtag im aktuellen Monat gesetzt sind und Forecast-Umsatz > 0 ist.";

  function setCurrentMonthCalibrationPatch(patch: Partial<IncomingDraft>): void {
    setIncomings((prev) => {
      const index = prev.findIndex((row) => row.month === currentMonthValue);
      if (index >= 0) {
        const next = [...prev];
        next[index] = {
          ...next[index],
          ...patch,
          calibrationSellerboardMonthEndEur: null,
        };
        return sortIncomings(next);
      }
      if (!currentMonthInPlanning) return prev;
      const nextRow: IncomingDraft = {
        id: randomId("inc"),
        month: currentMonthValue,
        revenueEur: Number.isFinite(currentMonthForecastRevenue) ? currentMonthForecastRevenue : 0,
        payoutPct: normalizePayoutInput(payoutRecommendation.medianPct),
        source: currentMonthForecastRevenue > 0 ? "forecast" : "manual",
        calibrationCutoffDate: todayIsoDate(),
        calibrationRevenueToDateEur: null,
        calibrationPayoutRateToDatePct: null,
        calibrationSellerboardMonthEndEur: null,
        ...patch,
      };
      return sortIncomings([...prev, nextRow]);
    });
  }

  async function saveDraft(source: string): Promise<void> {
    const normalizedIncomings = syncIncomingsToWindow(incomings, startMonth, horizonMonths);
    const snapshot: InputsDraftSnapshot = {
      openingBalance,
      startMonth,
      horizonMonths,
      cashInCalibrationHorizonMonths,
      cashInRecommendationIgnoreQ4,
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
        cashInRecommendationIgnoreQ4: snapshot.cashInRecommendationIgnoreQ4 === true,
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
        calibrationPayoutRateToDatePct: normalizePercentInput(row.calibrationPayoutRateToDatePct),
        calibrationSellerboardMonthEndEur: null,
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
      cashInCalibrationHorizonMonths,
      cashInRecommendationIgnoreQ4,
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
    cashInCalibrationHorizonMonths,
    cashInRecommendationIgnoreQ4,
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

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={5}>Basis-Parameter</Title>
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            alignItems: "start",
          }}
        >
          <div
            style={{
              padding: 12,
              border: "1px solid #d9d9d9",
              borderRadius: 8,
            }}
          >
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
          </div>
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
                Umsatz-Kalibrierung (aktueller Monat: {formatMonthLabel(currentMonthValue)})
              </Title>
              {!currentMonthInPlanning ? <Tag color="orange">Aktueller Monat liegt ausserhalb des Planungshorizonts</Tag> : null}
            </Space>
            <Space wrap align="start">
              <div>
                <Text>Stichtag</Text>
                <Input
                  type="date"
                  value={currentCalibrationCutoffDate}
                  onChange={(event) => {
                    const value = String(event.target.value || "").trim() || todayIsoDate();
                    setCurrentMonthCalibrationPatch({ calibrationCutoffDate: value });
                  }}
                  style={{ width: 170 }}
                  disabled={!currentMonthInPlanning}
                />
              </div>
              <div>
                <Text>Umsatz bis Stichtag (EUR)</Text>
                <DeNumberInput
                  value={currentCalibrationRevenueToDate ?? undefined}
                  mode="decimal"
                  min={0}
                  step={100}
                  style={{ width: 190 }}
                  onChange={(value) => {
                    setCurrentMonthCalibrationPatch({
                      calibrationRevenueToDateEur: toNumber(value),
                      calibrationCutoffDate: currentCalibrationCutoffDate || todayIsoDate(),
                    });
                  }}
                  disabled={!currentMonthInPlanning}
                />
              </div>
              <div>
                <Text>Auszahlungsquote bis Stichtag (%)</Text>
                <DeNumberInput
                  value={currentCalibrationPayoutRateToDate ?? undefined}
                  mode="percent"
                  min={0}
                  max={100}
                  step={0.1}
                  style={{ width: 210 }}
                  onChange={(value) => {
                    setCurrentMonthCalibrationPatch({
                      calibrationPayoutRateToDatePct: normalizePercentInput(value),
                    });
                  }}
                  disabled={!currentMonthInPlanning}
                />
              </div>
              <div>
                <Text>Prognostizierter Umsatz Monatsende (EUR)</Text>
                <div style={{ minWidth: 240, paddingTop: 6 }}>
                  <Text strong>{formatNumber(currentCalibrationProjection, 2)}</Text>
                </div>
              </div>
              <div>
                <Text>Kalibrierfaktor {formatMonthLabel(currentMonthValue)}</Text>
                <div style={{ minWidth: 180, paddingTop: 6 }}>
                  <Tooltip title={currentMonthCalibrationTooltip}>
                    <Text strong>{formatFactor(currentMonthCalibrationFactor)}</Text>
                  </Tooltip>
                </div>
              </div>
            </Space>
            <Text type="secondary">
              Forecast {formatMonthLabel(currentMonthValue)}: {formatNumber(currentMonthForecastRevenue, 2)} EUR
            </Text>
          </div>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={5} style={{ margin: 0 }}>Umsaetze x Payout</Title>
          <Space wrap>
            <Space size={4}>
              <Text>Kalibrierung wirkt über</Text>
              <div data-field-key="inputs.cashInCalibrationHorizonMonths">
                <Select
                  value={cashInCalibrationHorizonMonths}
                  style={{ width: 92 }}
                  options={[
                    { value: 3, label: "3 Mon." },
                    { value: 6, label: "6 Mon." },
                    { value: 9, label: "9 Mon." },
                  ]}
                  onChange={(value) => {
                    setCashInCalibrationHorizonMonths(normalizeCalibrationHorizonMonths(value, 6));
                  }}
                />
              </div>
            </Space>
            <Checkbox
              checked={cashInRecommendationIgnoreQ4}
              onChange={(event) => setCashInRecommendationIgnoreQ4(event.target.checked)}
            >
              Q4 bei Empfehlung ignorieren
            </Checkbox>
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
                  const recommendedPayout = Number(payoutRecommendation.medianPct);
                  return sortIncomings([
                    ...sorted,
                    {
                      id: randomId("inc"),
                      month: nextMonth,
                      revenueEur: 0,
                      payoutPct: Number.isFinite(recommendedPayout)
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
          {payoutRecommendation.uncertain ? (
            <Tag color="orange">
              Empfehlung unsicher ({payoutRecommendation.sampleCount} Ist-Monate)
            </Tag>
          ) : null}
        </Space>
        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Umsatz EUR</th>
                <th>Auszahlungsquote (manuell) %</th>
                <th>Empfehlung %</th>
                <th>Payout EUR</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortIncomings(incomings).map((row) => {
                const recommendation = payoutRecommendationByMonth.get(row.month);
                const manualPayout = normalizePayoutInput(row.payoutPct);
                const payoutDelta = Number.isFinite(recommendation)
                  && Number.isFinite(manualPayout as number)
                  ? Number(manualPayout) - Number(recommendation)
                  : null;
                const shouldWarnDelta = Number.isFinite(payoutDelta as number) && Math.abs(Number(payoutDelta)) >= PAYOUT_DELTA_WARNING_PCT;
                const forecastRevenue = Number(forecastRevenueByMonth.get(row.month) || 0);
                const forecastMissing = row.source === "forecast" && (!Number.isFinite(forecastRevenue) || forecastRevenue <= 0);
                const isManualRevenueOverride = row.source === "manual" && Number.isFinite(forecastRevenue) && forecastRevenue > 0;

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
                      </div>
                    </td>
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
                      {Number.isFinite(recommendation)
                        ? (
                          <div>
                            <Tooltip title={recommendationTooltip}>
                              <div>{formatNumber(recommendation, 2)}</div>
                            </Tooltip>
                            {shouldWarnDelta ? <Tag color="orange">Delta {formatSignedDelta(Number(payoutDelta))}</Tag> : null}
                          </div>
                        )
                        : <Text type="secondary">—</Text>}
                    </td>
                    <td>{formatNumber(payoutByMonth.get(row.month) || 0, 2)}</td>
                    <td>
                      <div style={{ minWidth: 170 }}>
                        {row.source === "forecast" ? <Tag color="blue">Forecast übertragen</Tag> : null}
                        {isManualRevenueOverride ? <Tag color="orange">Manuell ueberschrieben</Tag> : null}
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
        </div>
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
        <div className="v2-stats-table-wrap">
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
        </div>
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
        <div className="v2-stats-table-wrap">
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
        </div>
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
        <div className="v2-stats-table-wrap">
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
        </div>
      </Card>
    </div>
  );
}

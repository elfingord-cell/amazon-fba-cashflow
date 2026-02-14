import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { parseDeNumber } from "../../../lib/dataHealth.js";
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
  return {
    id: String(entry.id || randomId("inc")),
    month: normalizeMonth(entry.month, fallbackMonth),
    revenueEur: toNumber(entry.revenueEur),
    payoutPct: toNumber(entry.payoutPct),
    source: String(entry.source || "manual") === "forecast" ? "forecast" : "manual",
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

function monthNumberFromKey(month: string): number | null {
  if (!isMonthKey(month)) return null;
  const monthNumber = Number(month.slice(5, 7));
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  return monthNumber;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
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
    incomings: sortIncomings(snapshot.incomings).map((row) => ({
      id: String(row.id || ""),
      month: String(row.month || ""),
      revenueEur: toNumber(row.revenueEur),
      payoutPct: toNumber(row.payoutPct),
      source: row.source === "forecast" ? "forecast" : "manual",
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
    setIncomings(nextIncomings);
    setExtras(nextExtras);
    setDividends(nextDividends);
    setMonthlyActuals(nextMonthlyActuals);

    lastSavedHashRef.current = normalizeSnapshot({
      openingBalance: nextOpeningBalance,
      startMonth: nextStartMonth,
      horizonMonths: nextHorizonMonths,
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
      const payoutPct = Number(row.payoutPct || 0);
      map.set(row.month, revenue * (payoutPct / 100));
    });
    return map;
  }, [incomings]);

  const payoutRecommendationByMonth = useMemo(() => {
    const points = monthlyActuals
      .map((row) => ({
        month: normalizeMonth(row.month, ""),
        payoutPct: toNumber(row.realPayoutRatePct),
      }))
      .filter((row) => isMonthKey(row.month) && Number.isFinite(row.payoutPct as number))
      .sort((a, b) => a.month.localeCompare(b.month));

    const recommendationMap = new Map<string, number>();
    if (!points.length) return recommendationMap;

    incomings.forEach((incoming) => {
      const targetMonthNumber = monthNumberFromKey(incoming.month);
      if (!targetMonthNumber) return;
      let weightedSum = 0;
      let totalWeight = 0;

      points.forEach((point, index) => {
        const value = Number(point.payoutPct);
        if (!Number.isFinite(value)) return;
        const pointMonthNumber = monthNumberFromKey(point.month);
        const recencyWeight = 0.5 + ((index + 1) / points.length) * 0.9;
        const seasonalWeight = pointMonthNumber === targetMonthNumber ? 1.35 : 1;
        const weight = recencyWeight * seasonalWeight;
        weightedSum += value * weight;
        totalWeight += weight;
      });

      if (!Number.isFinite(totalWeight) || totalWeight <= 0) return;
      recommendationMap.set(incoming.month, clampPercent(weightedSum / totalWeight));
    });

    return recommendationMap;
  }, [incomings, monthlyActuals]);

  const hasAnyRecommendation = useMemo(
    () => Array.from(payoutRecommendationByMonth.values()).some((value) => Number.isFinite(value)),
    [payoutRecommendationByMonth],
  );

  async function saveDraft(source: string): Promise<void> {
    const normalizedIncomings = syncIncomingsToWindow(incomings, startMonth, horizonMonths);
    const snapshot: InputsDraftSnapshot = {
      openingBalance,
      startMonth,
      horizonMonths,
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
        lastUpdatedAt: new Date().toISOString(),
      };

      next.incomings = sortIncomings(snapshot.incomings).map((row) => ({
        id: row.id,
        month: row.month,
        revenueEur: Number(row.revenueEur || 0),
        payoutPct: Number(row.payoutPct || 0),
        source: row.source,
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
  }, [openingBalance, startMonth, horizonMonths, incomings, extras, dividends, monthlyActuals]);

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

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Title level={5} style={{ margin: 0 }}>Umsaetze x Payout</Title>
          <Space wrap>
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
                    .find((entry) => Number.isFinite(entry.payoutPct as number))
                    ?.payoutPct;
                  return sortIncomings([
                    ...sorted,
                    {
                      id: randomId("inc"),
                      month: nextMonth,
                      revenueEur: 0,
                      payoutPct: Number.isFinite(lastPayout as number) ? Number(lastPayout) : 0,
                      source: "manual",
                    },
                  ]);
                });
                setHorizonMonths((prev) => Math.max(1, Math.round(Number(prev || 1))) + 1);
              }}
            >
              Naechsten Monat anhaengen
            </Button>
            <Button
              onClick={() => {
                setIncomings((prev) => prev.map((entry) => {
                  const recommendation = payoutRecommendationByMonth.get(entry.month);
                  if (!Number.isFinite(recommendation)) return entry;
                  return {
                    ...entry,
                    payoutPct: Number(Number(recommendation).toFixed(2)),
                  };
                }));
              }}
              disabled={!hasAnyRecommendation}
            >
              Empfehlung fuer alle Monate uebernehmen
            </Button>
          </Space>
        </Space>
        <Text type="secondary">
          Die Umsatzzeilen sind strikt auf den Planungszeitraum ({startMonth} + {horizonMonths} Monate) synchronisiert.
        </Text>
        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Umsatz EUR</th>
                <th>Payout %</th>
                <th>Empfohlen %</th>
                <th>Payout EUR</th>
                <th>Quelle</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sortIncomings(incomings).map((row) => {
                const recommendation = payoutRecommendationByMonth.get(row.month);
                const payoutDelta = Number.isFinite(recommendation)
                  && Number.isFinite(row.payoutPct as number)
                  ? Number(row.payoutPct) - Number(recommendation)
                  : null;
                const shouldWarnDelta = Number.isFinite(payoutDelta as number) && Math.abs(Number(payoutDelta)) >= PAYOUT_DELTA_WARNING_PCT;
                const forecastRevenue = Number(forecastRevenueByMonth.get(row.month) || 0);
                const forecastMissing = row.source === "forecast" && (!Number.isFinite(forecastRevenue) || forecastRevenue <= 0);

                return (
                  <tr key={row.id}>
                    <td>
                      <Text strong>{formatMonthLabel(row.month)}</Text>
                      <div><Text type="secondary">{row.month}</Text></div>
                    </td>
                    <td>
                      <div data-field-key={`inputs.incomings.${row.id}.revenueEur`}>
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
                      </div>
                    </td>
                    <td>
                      <div data-field-key={`inputs.incomings.${row.id}.payoutPct`}>
                        <DeNumberInput
                          value={row.payoutPct ?? undefined}
                          mode="percent"
                          min={0}
                          max={100}
                          step={0.1}
                          style={{ width: "100%" }}
                          onChange={(value) => {
                            setIncomings((prev) => prev.map((entry) => entry.id === row.id ? { ...entry, payoutPct: toNumber(value) } : entry));
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      {Number.isFinite(recommendation)
                        ? (
                          <div>
                            <div>{formatNumber(recommendation, 1)}</div>
                            {shouldWarnDelta ? <Tag color="orange">Delta {formatSignedDelta(Number(payoutDelta))}</Tag> : null}
                          </div>
                        )
                        : <Text type="secondary">—</Text>}
                    </td>
                    <td>{formatNumber(payoutByMonth.get(row.month) || 0, 2)}</td>
                    <td>
                      <div>
                        <div data-field-key={`inputs.incomings.${row.id}.source`}>
                          <Select
                            value={row.source}
                            options={[
                              { value: "manual", label: "Manuell" },
                              { value: "forecast", label: "Forecast" },
                            ]}
                            onChange={(value) => {
                              setIncomings((prev) => prev.map((entry) => {
                                if (entry.id !== row.id) return entry;
                                if (value === "forecast") {
                                  const nextRevenue = Number(forecastRevenueByMonth.get(entry.month) || 0);
                                  return {
                                    ...entry,
                                    source: "forecast",
                                    revenueEur: Number.isFinite(nextRevenue) ? nextRevenue : entry.revenueEur,
                                  };
                                }
                                return { ...entry, source: "manual" };
                              }));
                            }}
                            style={{ width: 120 }}
                          />
                        </div>
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
          <Title level={5} style={{ margin: 0 }}>Monats-Istwerte</Title>
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
        <div className="v2-stats-table-wrap">
          <table className="v2-stats-table">
            <thead>
              <tr>
                <th>Monat</th>
                <th>Realer Umsatz EUR</th>
                <th>Reale Auszahlungsquote %</th>
                <th>Realer Kontostand EUR</th>
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

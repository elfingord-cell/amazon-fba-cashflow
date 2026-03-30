import { useEffect, useMemo, useState } from "react";
import { LockFilled } from "@ant-design/icons";
import { Alert, Button, Card, Col, Modal, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { PORTFOLIO_BUCKET } from "../../../domain/portfolioBuckets.js";
import { buildSharedPlanProductProjection } from "../../../domain/planProducts.js";
import { DataTable } from "../../components/DataTable";
import {
  buildDashboardPnlRowsByMonth,
  buildScopedActualComparisons,
  type DashboardActualComparisonRow,
  type DashboardBreakdownRow,
  type DashboardPnlRow,
} from "../../domain/dashboardMaturity";
import {
  applyDashboardBucketScopeToBreakdown,
  DEFAULT_V2_BUCKET_SCOPE,
} from "../../domain/dashboardCashflow";
import { currentMonthKey, formatMonthLabel, monthIndex } from "../../domain/months";
import {
  buildFixcostComparisonSnapshot,
  normalizeFixcostActualInputValue,
  buildPlannedFixcostByMonth,
  hasFixcostActualValue,
  readFixcostActualValue,
  sameFixcostActualValue,
} from "../../domain/sollIstFixcost";
import { useWorkspaceState } from "../../state/workspace";
import { v2SollIstChartColors } from "../../app/chartPalette";
import { DeNumberInput } from "../../components/DeNumberInput";
import { StatsTableShell } from "../../components/StatsTableShell";
import { ensureAppStateV2 } from "../../state/appState";

const { Paragraph, Text, Title } = Typography;

type SollIstRange = "last6" | "last12" | "all";

interface ActualComparisonRow {
  month: string;
  plannedRevenue: number | null;
  actualRevenue: number | null;
  revenueDelta: number;
  revenueDeltaPct: number | null;
  plannedPayout: number | null;
  actualPayout: number | null;
  payoutDelta: number;
  payoutDeltaPct: number | null;
  plannedClosing: number | null;
  actualClosing: number | null;
  closingDelta: number;
}

interface SeriesResult {
  actualComparisons: ActualComparisonRow[];
  breakdown: DashboardBreakdownRow[];
}

interface SollIstRow extends ActualComparisonRow {
  provisional: boolean;
  plannedPayoutRatePct: number | null;
  actualPayoutRatePct: number | null;
  closingDeltaPct: number | null;
}

interface AccuracyResult {
  accuracyPct: number | null;
  mapePct: number | null;
  sampleCount: number;
}

interface DriverRow {
  key: string;
  label: string;
  amount: number;
  kind: "component" | "total";
}

interface SellerboardActualRow {
  month: string;
  realClosingBalanceEur: number | null;
  realRevenueEur: number | null;
  realPayoutEur: number | null;
  payoutQuotePct: number | null;
}

interface FixcostInputRow {
  month: string;
  planned: number;
  savedActual: number | null;
  draftActual: number | null;
  status: "offen" | "erfasst";
  dirty: boolean;
}

const RANGE_OPTIONS: Array<{ value: SollIstRange; label: string; count: number | null }> = [
  { value: "last6", label: "Letzte 6 Monate", count: 6 },
  { value: "last12", label: "Letzte 12 Monate", count: 12 },
  { value: "all", label: "Alle Monate", count: null },
];
const SOLL_IST_BUCKET_OPTIONS = [
  { value: PORTFOLIO_BUCKET.CORE, label: "Kernportfolio" },
  { value: PORTFOLIO_BUCKET.PLAN, label: "Planprodukte" },
  { value: PORTFOLIO_BUCKET.IDEAS, label: "Ideenprodukte" },
];

const PLAN_GROUP_LABEL: Record<DashboardPnlRow["group"], string> = {
  inflow: "Einzahlungen",
  po_fo: "PO/FO",
  fixcost: "Fixkosten",
  tax: "Steuern & Import",
  outflow: "Auszahlungen",
  other: "Sonstige",
};

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toFiniteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function buildPayoutQuotePct(revenue: unknown, payout: unknown): number | null {
  const revenueNumber = Number(revenue);
  const payoutNumber = Number(payout);
  if (!Number.isFinite(revenueNumber) || revenueNumber <= 0) return null;
  if (!Number.isFinite(payoutNumber)) return null;
  return (payoutNumber / revenueNumber) * 100;
}

function isMonthClosed(entry: Record<string, unknown> | undefined): boolean {
  const revenue = toFiniteOrNull(entry?.realRevenueEUR);
  const payoutRatePct = toFiniteOrNull(entry?.realPayoutRatePct);
  const payoutEur = toFiniteOrNull(entry?.realPayoutEur);
  const closing = toFiniteOrNull(entry?.realClosingBalanceEUR);
  return Number.isFinite(revenue as number)
    && Number.isFinite(closing as number)
    && (Number.isFinite(payoutEur as number) || Number.isFinite(payoutRatePct as number));
}

function formatCurrency(value: unknown): string {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedCurrency(value: unknown): string {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number < 0) return `−${formatCurrency(Math.abs(number))}`;
  return formatCurrency(number);
}

function formatPercent(value: unknown): string {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function deriveRatePct(numerator: number | null, denominator: number | null): number | null {
  if (!Number.isFinite(numerator as number)) return null;
  if (!Number.isFinite(denominator as number) || Number(denominator) === 0) return null;
  return (Number(numerator) / Number(denominator)) * 100;
}

function deriveAccuracy(
  rows: SollIstRow[],
  getPlanned: (row: SollIstRow) => number | null,
  getActual: (row: SollIstRow) => number | null,
): AccuracyResult {
  const apes = rows
    .filter((row) => !row.provisional)
    .map((row) => {
      const planned = getPlanned(row);
      const actual = getActual(row);
      if (!Number.isFinite(planned as number) || !Number.isFinite(actual as number)) return null;
      if (!planned) return null;
      return Math.abs((Number(actual) - Number(planned)) / Number(planned)) * 100;
    })
    .filter((value): value is number => Number.isFinite(value));

  if (!apes.length) {
    return { accuracyPct: null, mapePct: null, sampleCount: 0 };
  }
  const mapePct = apes.reduce((sum, value) => sum + value, 0) / apes.length;
  return {
    accuracyPct: Math.max(0, 100 - mapePct),
    mapePct,
    sampleCount: apes.length,
  };
}

function deriveMonthDrivers(current: SollIstRow, previous: SollIstRow | null): DriverRow[] {
  const plannedRevenue = asNumber(current.plannedRevenue) || 0;
  const actualRevenue = asNumber(current.actualRevenue) || 0;
  const payoutDelta = asNumber(current.payoutDelta) || 0;
  const currentClosingDelta = asNumber(current.closingDelta) || 0;
  const previousClosingDelta = asNumber(previous?.closingDelta) || 0;
  const closingDeltaChange = currentClosingDelta - previousClosingDelta;

  const plannedRate = (asNumber(current.plannedPayoutRatePct) || 0) / 100;
  const actualRate = (asNumber(current.actualPayoutRatePct) || 0) / 100;

  let revenueEffect = payoutDelta;
  let payoutRateEffect = 0;
  if (
    Number.isFinite(plannedRevenue)
    && Number.isFinite(actualRevenue)
    && Number.isFinite(plannedRate)
    && Number.isFinite(actualRate)
  ) {
    revenueEffect = (actualRevenue - plannedRevenue) * plannedRate;
    payoutRateEffect = actualRevenue * (actualRate - plannedRate);
  }

  const residual = closingDeltaChange - payoutDelta;

  return [
    { key: "rev_effect", label: "Umsatz-Effekt (auf Payout)", amount: round2(revenueEffect), kind: "component" },
    { key: "payout_effect", label: "Payout-Quote-Effekt", amount: round2(payoutRateEffect), kind: "component" },
    { key: "residual", label: "Sonstige Effekte (Kosten/Timing)", amount: round2(residual), kind: "component" },
    { key: "total", label: "Delta Kontostand (Monats-Effekt)", amount: round2(closingDeltaChange), kind: "total" },
  ];
}

export default function SollIstModule(): JSX.Element {
  const { state, loading, error, saving, saveWith } = useWorkspaceState();
  const [range, setRange] = useState<SollIstRange>("last12");
  const [bucketScopeValues, setBucketScopeValues] = useState<string[]>(() => DEFAULT_V2_BUCKET_SCOPE.slice());
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedFixcostMonth, setSelectedFixcostMonth] = useState<string>("");
  const [closeMonthModalMonth, setCloseMonthModalMonth] = useState<string | null>(null);
  const [closeMonthRevenueEur, setCloseMonthRevenueEur] = useState<number | null>(null);
  const [closeMonthPayoutEur, setCloseMonthPayoutEur] = useState<number | null>(null);
  const [closeMonthClosingBalanceEur, setCloseMonthClosingBalanceEur] = useState<number | null>(null);
  const [fixcostRealDraftByMonth, setFixcostRealDraftByMonth] = useState<Record<string, number | null>>({});
  const [closingMonthSavePending, setClosingMonthSavePending] = useState(false);
  const [savingFixcostMonth, setSavingFixcostMonth] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const stateObject = state as unknown as Record<string, unknown>;
  const sharedPlanProjection = useMemo(
    () => buildSharedPlanProductProjection({ state: stateObject }),
    [stateObject],
  );
  const planningState = useMemo(
    () => (sharedPlanProjection?.planningState || stateObject) as Record<string, unknown>,
    [sharedPlanProjection, stateObject],
  );
  const report = useMemo(() => computeSeries(planningState) as SeriesResult, [planningState]);
  const bucketScopeSet = useMemo(() => new Set(bucketScopeValues), [bucketScopeValues]);
  const scopedBreakdown = useMemo(
    () => applyDashboardBucketScopeToBreakdown(Array.isArray(report.breakdown) ? report.breakdown : [], bucketScopeSet),
    [bucketScopeSet, report.breakdown],
  );
  const scopedActualComparisons = useMemo(
    () => buildScopedActualComparisons({
      breakdown: scopedBreakdown,
      actualComparisons: Array.isArray(report.actualComparisons)
        ? report.actualComparisons as DashboardActualComparisonRow[]
        : [],
    }),
    [report.actualComparisons, scopedBreakdown],
  );

  const currentMonth = currentMonthKey();
  const currentMonthIdx = monthIndex(currentMonth);

  const rows = useMemo<SollIstRow[]>(() => {
    return scopedActualComparisons
      .map((row) => {
        const month = String(row.month || "").trim();
        const rowMonthIdx = monthIndex(month);
        const provisional = rowMonthIdx != null
          && currentMonthIdx != null
          && rowMonthIdx >= currentMonthIdx;
        const plannedPayoutRatePct = deriveRatePct(asNumber(row.plannedPayout), asNumber(row.plannedRevenue));
        const actualPayoutRatePct = deriveRatePct(asNumber(row.actualPayout), asNumber(row.actualRevenue));
        const plannedClosing = asNumber(row.plannedClosing);
        const actualClosing = asNumber(row.actualClosing);
        const closingDeltaPct = (
          Number.isFinite(plannedClosing as number)
          && plannedClosing
          && Number.isFinite(actualClosing as number)
        )
          ? ((Number(actualClosing) - Number(plannedClosing)) / Number(plannedClosing)) * 100
          : null;
        return {
          ...row,
          month,
          provisional,
          plannedPayoutRatePct,
          actualPayoutRatePct,
          closingDeltaPct,
        };
      })
      .filter((row) => row.month)
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [currentMonthIdx, scopedActualComparisons]);

  const monthlyActualRaw = useMemo<Record<string, Record<string, unknown>>>(() => {
    return (stateObject.monthlyActuals && typeof stateObject.monthlyActuals === "object")
      ? stateObject.monthlyActuals as Record<string, Record<string, unknown>>
      : {};
  }, [stateObject]);

  const closableWindowMonths = useMemo(() => {
    if (currentMonthIdx == null) return [currentMonth];

    const settings = (stateObject.settings && typeof stateObject.settings === "object")
      ? stateObject.settings as Record<string, unknown>
      : {};
    const configuredStartMonth = String(settings.startMonth || "").trim();
    const configuredStartIndex = monthIndex(configuredStartMonth);

    const knownMonths = [
      ...rows.map((row) => String(row.month || "").trim()),
      ...Object.keys(monthlyActualRaw),
    ]
      .map((month) => ({ month, index: monthIndex(month) }))
      .filter((entry): entry is { month: string; index: number } => Boolean(entry.month) && entry.index != null)
      .sort((left, right) => left.index - right.index);

    const fallbackStartIndex = knownMonths.length ? knownMonths[0].index : currentMonthIdx;
    const startIndex = Math.min(configuredStartIndex ?? fallbackStartIndex, currentMonthIdx);

    const out: string[] = [];
    for (let index = startIndex; index <= currentMonthIdx; index += 1) {
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      out.push(`${year}-${String(month).padStart(2, "0")}`);
    }
    return out.reverse();
  }, [currentMonth, currentMonthIdx, monthlyActualRaw, rows, stateObject.settings]);

  const monthlyActualByMonth = useMemo<Record<string, SellerboardActualRow>>(() => {
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const out: Record<string, SellerboardActualRow> = {};
    closableWindowMonths.forEach((month) => {
      const row = byMonth.get(month) || null;
      const source = (monthlyActualRaw[month] && typeof monthlyActualRaw[month] === "object")
        ? monthlyActualRaw[month]
        : {};
      const realRevenueEur = toFiniteOrNull(source.realRevenueEUR ?? row?.actualRevenue);
      const realPayoutEur = toFiniteOrNull(source.realPayoutEur ?? row?.actualPayout);
      const payoutQuotePct = buildPayoutQuotePct(realRevenueEur, realPayoutEur)
        ?? toFiniteOrNull(source.realPayoutRatePct ?? row?.actualPayoutRatePct);
      out[month] = {
        month,
        realClosingBalanceEur: toFiniteOrNull(source.realClosingBalanceEUR ?? row?.actualClosing),
        realRevenueEur,
        realPayoutEur,
        payoutQuotePct: Number.isFinite(payoutQuotePct as number) ? round4(Number(payoutQuotePct)) : null,
      };
    });
    return out;
  }, [closableWindowMonths, monthlyActualRaw, rows]);

  const monthCloseStatusByMonth = useMemo(() => {
    const out = new Map<string, { canClose: boolean; closed: boolean }>();
    closableWindowMonths.forEach((month) => {
      const index = monthIndex(month);
      const canClose = index != null && currentMonthIdx != null && index <= currentMonthIdx;
      const source = (monthlyActualRaw[month] && typeof monthlyActualRaw[month] === "object")
        ? monthlyActualRaw[month]
        : undefined;
      out.set(month, { canClose, closed: isMonthClosed(source) });
    });
    return out;
  }, [closableWindowMonths, currentMonthIdx, monthlyActualRaw]);

  const closedMonthCount = useMemo(
    () => Array.from(monthCloseStatusByMonth.values()).filter((entry) => entry.closed).length,
    [monthCloseStatusByMonth],
  );
  const closableMonthCount = useMemo(
    () => Array.from(monthCloseStatusByMonth.values()).filter((entry) => entry.canClose && !entry.closed).length,
    [monthCloseStatusByMonth],
  );
  const closeModalQuotePct = useMemo(
    () => buildPayoutQuotePct(closeMonthRevenueEur, closeMonthPayoutEur),
    [closeMonthPayoutEur, closeMonthRevenueEur],
  );
  const closeModalCanSave = useMemo(() => {
    const revenue = toFiniteOrNull(closeMonthRevenueEur);
    const payout = toFiniteOrNull(closeMonthPayoutEur);
    const closing = toFiniteOrNull(closeMonthClosingBalanceEur);
    const quote = buildPayoutQuotePct(revenue, payout);
    return Number.isFinite(revenue as number)
      && Number(revenue) > 0
      && Number.isFinite(payout as number)
      && Number.isFinite(closing as number)
      && Number.isFinite(quote as number);
  }, [closeMonthClosingBalanceEur, closeMonthPayoutEur, closeMonthRevenueEur]);

  const openCloseMonthModal = (month: string): void => {
    const status = monthCloseStatusByMonth.get(month);
    if (!status?.canClose || status.closed) return;
    const seed = monthlyActualByMonth[month];
    setCloseMonthModalMonth(month);
    setCloseMonthRevenueEur(toFiniteOrNull(seed?.realRevenueEur));
    setCloseMonthPayoutEur(toFiniteOrNull(seed?.realPayoutEur));
    setCloseMonthClosingBalanceEur(toFiniteOrNull(seed?.realClosingBalanceEur));
  };

  const closeCloseMonthModal = (): void => {
    if (closingMonthSavePending) return;
    setCloseMonthModalMonth(null);
    setCloseMonthRevenueEur(null);
    setCloseMonthPayoutEur(null);
    setCloseMonthClosingBalanceEur(null);
  };

  async function saveClosedMonth(): Promise<void> {
    if (!closeMonthModalMonth || !closeModalCanSave) return;
    const month = closeMonthModalMonth;
    const realRevenueEUR = round2(Number(closeMonthRevenueEur));
    const realPayoutEur = round2(Number(closeMonthPayoutEur));
    const realClosingBalanceEUR = round2(Number(closeMonthClosingBalanceEur));
    const realPayoutRatePct = round4(Number(buildPayoutQuotePct(realRevenueEUR, realPayoutEur)));
    setClosingMonthSavePending(true);
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const existing = (next.monthlyActuals && typeof next.monthlyActuals === "object")
          ? next.monthlyActuals as Record<string, Record<string, unknown>>
          : {};
        const monthEntry = (existing[month] && typeof existing[month] === "object")
          ? { ...existing[month] }
          : {};
        monthEntry.realRevenueEUR = realRevenueEUR;
        monthEntry.realPayoutEur = realPayoutEur;
        monthEntry.realPayoutRatePct = realPayoutRatePct;
        monthEntry.realClosingBalanceEUR = realClosingBalanceEUR;
        next.monthlyActuals = {
          ...existing,
          [month]: monthEntry,
        };
        return next;
      }, "v2:soll-ist:actuals");
      closeCloseMonthModal();
      messageApi.success("Ist-Werte gespeichert.");
    } catch (saveError) {
      console.error(saveError);
      messageApi.error(saveError instanceof Error ? saveError.message : "Ist-Werte konnten nicht gespeichert werden.");
    } finally {
      setClosingMonthSavePending(false);
    }
  }

  async function saveFixcostActualMonth(month: string): Promise<void> {
    const draftValue = fixcostRealDraftByMonth[month];
    const nextValue = Number.isFinite(draftValue as number) ? round2(Number(draftValue)) : null;
    setSavingFixcostMonth(month);
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const existing = (next.monthlyActuals && typeof next.monthlyActuals === "object")
          ? next.monthlyActuals as Record<string, Record<string, unknown>>
          : {};
        const nextMonthlyActuals = { ...existing };
        const monthEntry = (nextMonthlyActuals[month] && typeof nextMonthlyActuals[month] === "object")
          ? { ...nextMonthlyActuals[month] }
          : {};
        if (nextValue == null) delete monthEntry.realFixkostenEUR;
        else monthEntry.realFixkostenEUR = nextValue;
        if (Object.keys(monthEntry).length) nextMonthlyActuals[month] = monthEntry;
        else delete nextMonthlyActuals[month];
        next.monthlyActuals = nextMonthlyActuals;
        return next;
      }, "v2:soll-ist:fixcost-real");
      messageApi.success(nextValue == null ? "Fixkosten real geleert." : "Fixkosten real gespeichert.");
    } catch (saveError) {
      console.error(saveError);
      messageApi.error(saveError instanceof Error ? saveError.message : "Fixkosten real konnten nicht gespeichert werden.");
    } finally {
      setSavingFixcostMonth(null);
    }
  }

  function setBucketScopeEnabled(bucket: string, enabled: boolean): void {
    setBucketScopeValues((current) => {
      const normalized = Array.from(new Set((current || []).filter((entry) => SOLL_IST_BUCKET_OPTIONS.some((option) => option.value === entry))));
      const isSelected = normalized.includes(bucket);
      if (enabled && !isSelected) return [...normalized, bucket];
      if (!enabled && isSelected) {
        const filtered = normalized.filter((entry) => entry !== bucket);
        return filtered.length ? filtered : normalized;
      }
      return normalized;
    });
  }

  const visibleRows = useMemo(() => {
    const option = RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return rows;
    return rows.slice(-option.count);
  }, [range, rows]);

  useEffect(() => {
    if (!visibleRows.length) {
      setSelectedMonth("");
      return;
    }
    const available = new Set(visibleRows.map((row) => row.month));
    if (!selectedMonth || !available.has(selectedMonth)) {
      setSelectedMonth(visibleRows[visibleRows.length - 1].month);
    }
  }, [selectedMonth, visibleRows]);

  useEffect(() => {
    const nextDrafts: Record<string, number | null> = {};
    closableWindowMonths.forEach((month) => {
      nextDrafts[month] = readFixcostActualValue(monthlyActualRaw[month]);
    });
    setFixcostRealDraftByMonth(nextDrafts);
  }, [closableWindowMonths, monthlyActualRaw]);

  useEffect(() => {
    if (selectedMonth && closableWindowMonths.includes(selectedMonth)) {
      setSelectedFixcostMonth(selectedMonth);
      return;
    }
    if (!closableWindowMonths.length) {
      setSelectedFixcostMonth("");
      return;
    }
    if (!selectedFixcostMonth || !closableWindowMonths.includes(selectedFixcostMonth)) {
      setSelectedFixcostMonth(closableWindowMonths[0]);
    }
  }, [closableWindowMonths, selectedFixcostMonth, selectedMonth]);

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.month === selectedMonth) || visibleRows[visibleRows.length - 1] || null,
    [selectedMonth, visibleRows],
  );

  const previousSelectedRow = useMemo(() => {
    if (!selectedRow) return null;
    const index = rows.findIndex((row) => row.month === selectedRow.month);
    if (index <= 0) return null;
    return rows[index - 1] || null;
  }, [rows, selectedRow]);

  const completedRows = useMemo(
    () => visibleRows.filter((row) => !row.provisional),
    [visibleRows],
  );

  const closingAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedClosing), (row) => asNumber(row.actualClosing)),
    [completedRows],
  );
  const revenueAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedRevenue), (row) => asNumber(row.actualRevenue)),
    [completedRows],
  );
  const payoutAccuracy = useMemo(
    () => deriveAccuracy(completedRows, (row) => asNumber(row.plannedPayout), (row) => asNumber(row.actualPayout)),
    [completedRows],
  );

  const selectedDrivers = useMemo(
    () => (selectedRow ? deriveMonthDrivers(selectedRow, previousSelectedRow) : []),
    [previousSelectedRow, selectedRow],
  );

  const pnlRowsByMonth = useMemo(
    () => buildDashboardPnlRowsByMonth({ breakdown: scopedBreakdown, state: stateObject }),
    [scopedBreakdown, stateObject],
  );

  const selectedPlanGroupRows = useMemo(() => {
    if (!selectedRow) return [];
    const rowsForMonth = pnlRowsByMonth.get(selectedRow.month) || [];
    const grouped = new Map<DashboardPnlRow["group"], number>();
    rowsForMonth.forEach((entry) => {
      grouped.set(entry.group, (grouped.get(entry.group) || 0) + Number(entry.amount || 0));
    });
    return Array.from(grouped.entries())
      .map(([group, amount]) => ({
        key: group,
        label: PLAN_GROUP_LABEL[group] || group,
        amount: round2(amount),
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [pnlRowsByMonth, selectedRow]);

  const plannedFixcostByMonth = useMemo(
    () => buildPlannedFixcostByMonth(pnlRowsByMonth),
    [pnlRowsByMonth],
  );

  const fixcostComparison = useMemo(
    () => buildFixcostComparisonSnapshot({
      months: closableWindowMonths,
      plannedByMonth: plannedFixcostByMonth,
      monthlyActuals: monthlyActualRaw,
      selectedMonth: selectedFixcostMonth,
    }),
    [closableWindowMonths, monthlyActualRaw, plannedFixcostByMonth, selectedFixcostMonth],
  );

  const fixcostInputRows = useMemo<FixcostInputRow[]>(() => {
    return closableWindowMonths.map((month) => {
      const savedActual = readFixcostActualValue(monthlyActualRaw[month]);
      const hasDraft = Object.prototype.hasOwnProperty.call(fixcostRealDraftByMonth, month);
      const draftActual = hasDraft ? fixcostRealDraftByMonth[month] : savedActual;
      return {
        month,
        planned: round2(Number(plannedFixcostByMonth[month] || 0)),
        savedActual,
        draftActual,
        status: hasFixcostActualValue(savedActual) ? "erfasst" : "offen",
        dirty: !sameFixcostActualValue(savedActual, draftActual ?? null),
      };
    });
  }, [closableWindowMonths, fixcostRealDraftByMonth, monthlyActualRaw, plannedFixcostByMonth]);

  const fixcostYtdChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: number) => formatCurrency(value),
      },
      legend: { top: 0 },
      grid: { left: 54, right: 20, top: 36, bottom: 24 },
      xAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
      yAxis: {
        type: "category",
        data: ["YTD"],
      },
      series: [
        {
          name: "Fixkosten Soll YTD",
          type: "bar",
          data: [fixcostComparison.ytd.planned],
          itemStyle: { color: v2SollIstChartColors.plannedClosing },
        },
        {
          name: "Fixkosten Ist YTD",
          type: "bar",
          data: [fixcostComparison.ytd.actual],
          itemStyle: { color: v2SollIstChartColors.negative },
        },
      ],
    };
  }, [fixcostComparison.ytd.actual, fixcostComparison.ytd.planned]);

  const closingChartOption = useMemo(() => {
    const firstProvisionalIndex = visibleRows.findIndex((row) => row.provisional);
    const xAxisLabels = visibleRows.map((row) => formatMonthLabel(row.month));
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: number) => formatCurrency(value),
      },
      legend: { top: 0 },
      grid: { left: 54, right: 26, top: 44, bottom: 26 },
      xAxis: {
        type: "category",
        data: xAxisLabels,
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
      series: [
        {
          name: "Delta Kontostand",
          type: "bar",
          data: visibleRows.map((row) => Number(row.closingDelta || 0)),
          itemStyle: {
            color: (params: { dataIndex: number; value: number }) => {
              const isProvisional = firstProvisionalIndex >= 0 && params.dataIndex >= firstProvisionalIndex;
              if (isProvisional) return v2SollIstChartColors.provisionalOverlay;
              return params.value < 0 ? v2SollIstChartColors.negative : v2SollIstChartColors.positive;
            },
          },
        },
        {
          name: "Kontostand Soll",
          type: "line",
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.plannedClosing)),
          lineStyle: { width: 2, type: "dashed", color: v2SollIstChartColors.plannedClosing },
          itemStyle: { color: v2SollIstChartColors.plannedClosing },
        },
        {
          name: "Kontostand-IST",
          type: "line",
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.actualClosing)),
          lineStyle: { width: 2, color: v2SollIstChartColors.actualClosing },
          itemStyle: { color: v2SollIstChartColors.actualClosing },
          markArea: firstProvisionalIndex >= 0
            ? {
              itemStyle: { color: v2SollIstChartColors.provisionalArea },
              data: [[
                { xAxis: xAxisLabels[firstProvisionalIndex] },
                { xAxis: xAxisLabels[xAxisLabels.length - 1] },
              ]],
            }
            : undefined,
        },
      ],
    };
  }, [visibleRows]);

  const revenuePayoutChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "axis",
      },
      legend: { top: 0 },
      grid: { left: 54, right: 52, top: 44, bottom: 26 },
      xAxis: {
        type: "category",
        data: visibleRows.map((row) => formatMonthLabel(row.month)),
      },
      yAxis: [
        {
          type: "value",
          name: "EUR",
          axisLabel: {
            formatter: (value: number) => formatCurrency(value),
          },
        },
        {
          type: "value",
          name: "%",
          min: 0,
          max: 100,
          axisLabel: {
            formatter: (value: number) => `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} %`,
          },
        },
      ],
      series: [
        {
          name: "Umsatz Soll",
          type: "bar",
          data: visibleRows.map((row) => asNumber(row.plannedRevenue)),
          itemStyle: { color: v2SollIstChartColors.plannedRevenue },
        },
        {
          name: "Umsatz Ist",
          type: "bar",
          data: visibleRows.map((row) => asNumber(row.actualRevenue)),
          itemStyle: { color: v2SollIstChartColors.actualRevenue },
        },
        {
          name: "Payout-Quote Soll",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.plannedPayoutRatePct)),
          lineStyle: { width: 2, type: "dashed", color: v2SollIstChartColors.plannedPayoutRate },
          itemStyle: { color: v2SollIstChartColors.plannedPayoutRate },
        },
        {
          name: "Payout-Quote Ist",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: visibleRows.map((row) => asNumber(row.actualPayoutRatePct)),
          lineStyle: { width: 2, color: v2SollIstChartColors.actualPayoutRate },
          itemStyle: { color: v2SollIstChartColors.actualPayoutRate },
        },
      ],
    };
  }, [visibleRows]);

  const driversChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value: number) => formatCurrency(value),
      },
      grid: { left: 54, right: 20, top: 18, bottom: 48 },
      xAxis: {
        type: "category",
        data: selectedDrivers.map((entry) => entry.label),
        axisLabel: {
          interval: 0,
          rotate: 20,
        },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => formatCurrency(value),
        },
      },
      series: [
        {
          type: "bar",
          data: selectedDrivers.map((entry) => entry.amount),
          itemStyle: {
            color: (params: { dataIndex: number; value: number }) => {
              const item = selectedDrivers[params.dataIndex];
              if (item?.kind === "total") return v2SollIstChartColors.totalDriver;
              return params.value < 0 ? v2SollIstChartColors.negative : v2SollIstChartColors.positive;
            },
          },
        },
      ],
    };
  }, [selectedDrivers]);

  const comparisonColumns = useMemo<ColumnDef<SollIstRow>[]>(() => [
    {
      header: "Monat",
      accessorKey: "month",
      meta: { minWidth: 270 },
      cell: ({ row }) => (
        <Space size={6}>
          <Button size="small" type={selectedMonth === row.original.month ? "primary" : "default"} onClick={() => setSelectedMonth(row.original.month)}>
            {formatMonthLabel(row.original.month)}
          </Button>
          {row.original.provisional ? <Tag color="gold">Vorlaeufig</Tag> : <Tag color="green">Abgeschlossen</Tag>}
          {monthCloseStatusByMonth.get(row.original.month)?.closed ? (
            <Tag icon={<LockFilled />} color="blue">Gelockt</Tag>
          ) : null}
          {monthCloseStatusByMonth.get(row.original.month)?.canClose && !monthCloseStatusByMonth.get(row.original.month)?.closed ? (
            <Button size="small" onClick={() => openCloseMonthModal(row.original.month)}>
              Monat abschließen
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      header: "Kontostand Soll",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => formatCurrency(row.original.plannedClosing),
    },
    {
      header: "Kontostand-IST",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => formatCurrency(row.original.actualClosing),
    },
    {
      header: "Delta Kontostand",
      meta: { align: "right", width: 150 },
      cell: ({ row }) => (
        <span className={Number(row.original.closingDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatSignedCurrency(row.original.closingDelta)}
        </span>
      ),
    },
    {
      header: "Umsatz Soll",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.plannedRevenue),
    },
    {
      header: "Umsatz Ist",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.actualRevenue),
    },
    {
      header: "Payout Soll",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.plannedPayout),
    },
    {
      header: "Payout Ist",
      meta: { align: "right", width: 140 },
      cell: ({ row }) => formatCurrency(row.original.actualPayout),
    },
  ], [monthCloseStatusByMonth, openCloseMonthModal, selectedMonth]);

  if (loading) {
    return (
      <div className="v2-page">
        <Alert type="info" showIcon message="Workspace wird geladen..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="v2-page">
        <Alert type="error" showIcon message={error} />
      </div>
    );
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Soll vs. Ist</Title>
            <Paragraph>
              Wie gut war die Planung gegen die real eingetretenen Werte. Fokus: Kontostand, Umsatz und Payout.
            </Paragraph>
          </div>
          <div className="v2-toolbar-field">
            <Text>Zeitraum</Text>
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 220, maxWidth: "100%" }}
            />
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Tag color="green">Monate mit Istwerten: {rows.length}</Tag>
            <Tag color="blue">Im Vergleich (abgeschlossen): {completedRows.length}</Tag>
            <Tag color="gold">Laufender Monat wird als "vorlaeufig" markiert</Tag>
          </div>
        </div>
        <div className="v2-toolbar" style={{ marginTop: 12 }}>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div>
              <Text strong>Portfolio-Scope</Text>
              <div><Text type="secondary">Wirkt auf Soll/P&amp;L und Plan-Details. IST bleibt Gesamt-Ist.</Text></div>
            </div>
            <div className="v2-calc-cockpit-toggle-list">
              {SOLL_IST_BUCKET_OPTIONS.map((option) => {
                const selected = bucketScopeValues.includes(option.value);
                const disableOff = selected && bucketScopeValues.length <= 1;
                return (
                  <div key={option.value} className="v2-calc-cockpit-toggle-row">
                    <Text>{option.label}</Text>
                    <Segmented
                      size="small"
                      value={selected ? "on" : "off"}
                      onChange={(value) => setBucketScopeEnabled(option.value, String(value) === "on")}
                      options={[
                        { label: "An", value: "on" },
                        { label: "Aus", value: "off", disabled: disableOff },
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          </Space>
        </div>
      </Card>

      <Alert
        type="info"
        showIcon
        message="Portfolio-Scope filtert in Soll-Ist nur die Plan-Seite"
        description="Sellerboard-IST-Werte für Umsatz, Auszahlung und Kontostand bleiben Gesamt-Ist und werden nicht nach Produktgruppen aufgeteilt."
      />

      {!rows.length ? (
        <Alert
          type="warning"
          showIcon
          message="Noch keine Vergleichsdaten vorhanden"
          description="Du kannst unten trotzdem Monats-Istwerte erfassen; die Analyse füllt sich danach."
        />
      ) : null}

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Title level={4} style={{ marginBottom: 0 }}>Ist-Werte Monatsende (Sellerboard)</Title>
            <Text type="secondary">
              Monatsabschluss erfolgt hier pro Monat bis inklusive aktuellem Monat.
              Erfasst werden Umsatz, Auszahlung und Kontostand; die Auszahlungsquote wird automatisch aus Auszahlung/Umsatz berechnet.
            </Text>
          </div>
          <Space wrap>
            <Tag color="blue">Monate ({'<='} aktuell): {closableWindowMonths.length}</Tag>
            <Tag color="green">Gelockt: {closedMonthCount}</Tag>
            <Tag color={closableMonthCount > 0 ? "gold" : "green"}>
              Offen: {closableMonthCount}
            </Tag>
          </Space>
        </Space>
        <div style={{ marginTop: 12 }}>
          <StatsTableShell>
            <table className="v2-stats-table" data-layout="fixed" style={{ minWidth: 1120 }}>
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Monat</th>
                  <th style={{ width: 190 }}>Umsatz IST (EUR)</th>
                  <th style={{ width: 190 }}>Auszahlung IST (EUR)</th>
                  <th style={{ width: 210 }}>Kontostand-IST (EUR)</th>
                  <th style={{ width: 170 }}>Auszahlungsquote (%)</th>
                  <th style={{ width: 180 }}>Status</th>
                  <th style={{ width: 170 }}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {closableWindowMonths.map((month) => {
                  const row = monthlyActualByMonth[month];
                  const status = monthCloseStatusByMonth.get(month) || { canClose: false, closed: false };
                  return (
                  <tr key={row.month}>
                    <td>
                      <Text strong>{formatMonthLabel(row.month)}</Text>
                      <div><Text type="secondary">{row.month}</Text></div>
                    </td>
                    <td>
                      <Text>{formatCurrency(row.realRevenueEur)}</Text>
                    </td>
                    <td>
                      <Text>{formatCurrency(row.realPayoutEur)}</Text>
                    </td>
                    <td>
                      <Text>{formatCurrency(row.realClosingBalanceEur)}</Text>
                    </td>
                    <td>
                      <Text strong>{formatPercent(row.payoutQuotePct)}</Text>
                    </td>
                    <td>
                      {status.closed ? (
                        <Tag icon={<LockFilled />} color="blue">Abgeschlossen</Tag>
                      ) : (
                        <Tag color={status.canClose ? "gold" : "default"}>
                          {status.canClose ? "Offen" : "Nicht verfügbar"}
                        </Tag>
                      )}
                    </td>
                    <td>
                      {status.canClose && !status.closed ? (
                        <Button
                          size="small"
                          onClick={() => openCloseMonthModal(row.month)}
                        >
                          Monat abschließen
                        </Button>
                      ) : (
                        <Text type="secondary">—</Text>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </StatsTableShell>
        </div>
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Title level={4} style={{ marginBottom: 0 }}>Fixkosten real</Title>
            <Text type="secondary">
              Soll kommt unverändert aus dem Fixkosten-Tab. Ist kommt hier ausschliesslich aus dem Monatsfeld <strong>Fixkosten real</strong>.
              Delta wird als Soll minus Ist berechnet.
            </Text>
          </div>
          <Space wrap>
            <Tag color="blue">
              Monat: {fixcostComparison.selectedMonth ? formatMonthLabel(fixcostComparison.selectedMonth) : "—"}
            </Tag>
            <Tag color={fixcostComparison.currentMonth?.status === "erfasst" ? "green" : "gold"}>
              {fixcostComparison.currentMonth?.status || "offen"}
            </Tag>
          </Space>
        </Space>
        <div style={{ marginTop: 12 }}>
          <StatsTableShell>
            <table className="v2-stats-table" data-layout="fixed" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Monat</th>
                  <th style={{ width: 170 }}>Fixkosten Soll</th>
                  <th style={{ width: 220 }}>Fixkosten real</th>
                  <th style={{ width: 160 }}>Status</th>
                  <th style={{ width: 170 }}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {fixcostInputRows.map((row) => (
                  <tr key={row.month}>
                    <td>
                      <Button
                        size="small"
                        type={selectedFixcostMonth === row.month ? "primary" : "default"}
                        onClick={() => setSelectedFixcostMonth(row.month)}
                      >
                        {formatMonthLabel(row.month)}
                      </Button>
                      <div><Text type="secondary">{row.month}</Text></div>
                    </td>
                    <td>
                      <Text>{formatCurrency(row.planned)}</Text>
                    </td>
                    <td>
                      <div data-field-key={`soll-ist.fixcost-real.${row.month}`}>
                        <DeNumberInput
                          value={row.draftActual ?? undefined}
                          mode="decimal"
                          min={0}
                          step={100}
                          aria-label={`Fixkosten real ${row.month}`}
                          onChange={(value) => {
                            setFixcostRealDraftByMonth((current) => ({
                              ...current,
                              [row.month]: normalizeFixcostActualInputValue(value),
                            }));
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <Tag color={row.status === "erfasst" ? "green" : "gold"}>
                        {row.status}
                      </Tag>
                    </td>
                    <td>
                      <Button
                        size="small"
                        type={row.dirty ? "primary" : "default"}
                        disabled={!row.dirty}
                        loading={savingFixcostMonth === row.month}
                        onClick={() => { void saveFixcostActualMonth(row.month); }}
                      >
                        Speichern
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StatsTableShell>
        </div>

        <Row gutter={[12, 12]} style={{ marginTop: 18 }}>
          <Col xs={24} xl={14}>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Fixkosten Soll"
                    value={formatCurrency(fixcostComparison.currentMonth?.planned)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Fixkosten Ist"
                    value={formatCurrency(fixcostComparison.currentMonth?.actual)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Delta"
                    value={formatSignedCurrency(fixcostComparison.currentMonth?.delta)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Delta %"
                    value={formatPercent(fixcostComparison.currentMonth?.deltaPct)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Fixkosten Soll YTD"
                    value={formatCurrency(fixcostComparison.ytd.planned)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Fixkosten Ist YTD"
                    value={formatCurrency(fixcostComparison.ytd.actual)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Delta YTD"
                    value={formatSignedCurrency(fixcostComparison.ytd.delta)}
                  />
                </Card>
              </Col>
              <Col xs={12} md={6}>
                <Card size="small">
                  <Statistic
                    title="Delta YTD %"
                    value={formatPercent(fixcostComparison.ytd.deltaPct)}
                  />
                </Card>
              </Col>
            </Row>
          </Col>

          <Col xs={24} xl={10}>
            <Card size="small">
              <Title level={5}>YTD Vergleich Soll vs Ist</Title>
              <Paragraph type="secondary">
                Einfache Balkenansicht fuer den kumulierten Vergleich bis {fixcostComparison.selectedMonth ? formatMonthLabel(fixcostComparison.selectedMonth) : "—"}.
              </Paragraph>
              <ReactECharts style={{ height: 220 }} option={fixcostYtdChartOption} />
              <Text type="secondary">
                Erfasst YTD: {fixcostComparison.ytd.capturedMonthCount} · offen YTD: {fixcostComparison.ytd.openMonthCount}
              </Text>
            </Card>
          </Col>
        </Row>
      </Card>

      <Modal
        title={closeMonthModalMonth ? `Monat abschließen: ${formatMonthLabel(closeMonthModalMonth)}` : "Monat abschließen"}
        open={Boolean(closeMonthModalMonth)}
        onCancel={closeCloseMonthModal}
        onOk={() => { void saveClosedMonth(); }}
        okText="Speichern"
        cancelText="Abbrechen"
        okButtonProps={{ disabled: !closeModalCanSave, loading: closingMonthSavePending || saving }}
        maskClosable={!closingMonthSavePending && !saving}
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <div className="v2-toolbar-field">
            <Text>IST-Umsatz (EUR)</Text>
            <DeNumberInput
              value={closeMonthRevenueEur ?? undefined}
              mode="decimal"
              min={0}
              step={100}
              style={{ width: "100%" }}
              onChange={(value) => setCloseMonthRevenueEur(toFiniteOrNull(value))}
            />
          </div>
          <div className="v2-toolbar-field">
            <Text>IST-Auszahlung (EUR)</Text>
            <DeNumberInput
              value={closeMonthPayoutEur ?? undefined}
              mode="decimal"
              min={0}
              step={100}
              style={{ width: "100%" }}
              onChange={(value) => setCloseMonthPayoutEur(toFiniteOrNull(value))}
            />
          </div>
          <div className="v2-toolbar-field">
            <Text>IST-Kontostand zum Monatsende (EUR)</Text>
            <DeNumberInput
              value={closeMonthClosingBalanceEur ?? undefined}
              mode="decimal"
              step={100}
              style={{ width: "100%" }}
              onChange={(value) => setCloseMonthClosingBalanceEur(toFiniteOrNull(value))}
            />
          </div>
          <div className="v2-toolbar-field">
            <Text>IST-Auszahlungsquote (%)</Text>
            {Number.isFinite(closeModalQuotePct as number) ? (
              <Text strong>{formatPercent(closeModalQuotePct)}</Text>
            ) : (
              <Text type="warning">Quote nicht berechenbar</Text>
            )}
          </div>
        </Space>
      </Modal>

      <div className="v2-svi-kpi-grid">
        <Card>
          <Statistic
            title="Treffsicherheit Kontostand-IST"
            value={closingAccuracy.accuracyPct != null ? `${closingAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(closingAccuracy.mapePct)} · n={closingAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Treffsicherheit Umsatz"
            value={revenueAccuracy.accuracyPct != null ? `${revenueAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(revenueAccuracy.mapePct)} · n={revenueAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Treffsicherheit Payout"
            value={payoutAccuracy.accuracyPct != null ? `${payoutAccuracy.accuracyPct.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "—"}
          />
          <Text type="secondary">MAPE: {formatPercent(payoutAccuracy.mapePct)} · n={payoutAccuracy.sampleCount}</Text>
        </Card>
        <Card>
          <Statistic
            title="Aktueller Delta-Kontostand"
            value={selectedRow ? formatSignedCurrency(selectedRow.closingDelta) : "—"}
          />
          <Text type="secondary">
            {selectedRow ? `${formatMonthLabel(selectedRow.month)} ${selectedRow.provisional ? "(vorlaeufig)" : "(abgeschlossen)"}` : "Kein Monat gewählt"}
          </Text>
        </Card>
      </div>

      <Card>
        <Title level={4}>Kontostand-IST vs Soll</Title>
        <Paragraph type="secondary">
          Linien zeigen Kontostand-IST und Kontostand Soll, Balken darunter die Abweichung (IST minus Soll) pro Monat.
        </Paragraph>
        <ReactECharts style={{ height: 380 }} option={closingChartOption} />
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card>
            <Title level={4}>Umsatz & Payout-Quote</Title>
            <Paragraph type="secondary">
              Umsatz in EUR als Balken, Payout-Quote als Linien (Soll vs. Ist).
            </Paragraph>
            <ReactECharts style={{ height: 340 }} option={revenuePayoutChartOption} />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card>
            <Title level={4}>Treiber Monat {selectedRow ? formatMonthLabel(selectedRow.month) : "—"}</Title>
            <Paragraph type="secondary">
              Zerlegung des Monats-Effekts auf den Kontostand in Umsatz-/Payout-Effekt und Residuum.
            </Paragraph>
            <ReactECharts style={{ height: 260 }} option={driversChartOption} />
            <div className="v2-svi-driver-list">
              {selectedDrivers.map((entry) => (
                <div key={entry.key} className={`v2-svi-driver-row ${entry.kind === "total" ? "is-total" : ""}`}>
                  <Text>{entry.label}</Text>
                  <Text className={entry.amount < 0 ? "v2-negative" : undefined}>
                    {formatSignedCurrency(entry.amount)}
                  </Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Card>
        <Title level={4}>Monatsvergleich</Title>
        <Paragraph type="secondary">
          Monat anklicken, um den Treiber- und Detailbereich zu aktualisieren.
        </Paragraph>
        <DataTable
          data={visibleRows}
          columns={comparisonColumns}
          minTableWidth={1240}
          tableLayout="auto"
        />
      </Card>

      <Card>
        <Title level={4}>Plan-Detail (Auszahlungen) für {selectedRow ? formatMonthLabel(selectedRow.month) : "—"}</Title>
        <Paragraph type="secondary">
          Geplante Auszahlungsstruktur im ausgewählten Monat als Kontext für die Soll-vs-Ist-Differenz.
        </Paragraph>
        <Table
          className="v2-ant-table"
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={selectedPlanGroupRows}
          columns={[
            {
              title: "Gruppe",
              dataIndex: "label",
              key: "label",
              sorter: (a, b) => String(a.label || "").localeCompare(String(b.label || ""), "de-DE"),
            },
            {
              title: "Planbetrag",
              dataIndex: "amount",
              key: "amount",
              align: "right" as const,
              sorter: (a, b) => Number(a.amount || 0) - Number(b.amount || 0),
              render: (value: number) => (
                <span className={value < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(value)}</span>
              ),
            },
          ]}
          locale={{ emptyText: "Keine geplanten Positionen im ausgewählten Monat." }}
        />
      </Card>
    </div>
  );
}

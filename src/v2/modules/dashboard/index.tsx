import { InfoCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Col,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { VisTimeline } from "../../components/VisTimeline";
import {
  buildDashboardPnlRowsByMonth,
  type DashboardBreakdownRow,
  type DashboardEntry,
  type DashboardPnlRow,
} from "../../domain/dashboardMaturity";
import { buildDashboardOrderTimeline } from "../../domain/dashboardOrderTimeline";
import {
  buildDashboardRobustness,
  type CoverageStatusKey,
  type DashboardRobustMonth,
  type RobustnessCoverageOrderDutyIssue,
  type RobustnessCoverageStockIssue,
  type RobustnessCheckResult,
} from "../../domain/dashboardRobustness";
import {
  buildPhantomFoSuggestions,
  buildStateWithPhantomFos,
  resolvePlanningMonthsFromState,
  type PhantomFoSuggestion,
} from "../../domain/phantomFo";
import { ensureForecastVersioningContainers, getActiveForecastLabel } from "../../domain/forecastVersioning";
import { buildReadinessGate } from "../../domain/readinessGate";
import { currentMonthKey, formatMonthLabel, monthIndex } from "../../domain/months";
import { buildPoArrivalTasks, type PoArrivalTask } from "../../domain/poArrivalTasks";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { getModuleExpandedCategoryKeys, hasModuleExpandedCategoryKeys, setModuleExpandedCategoryKeys } from "../../state/uiPrefs";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

type DashboardRange = "next6" | "next12" | "next18" | "all";

type SimulationType = "dividend" | "capex";
type InventoryRiskFilterParam = "all" | "oos" | "under_safety";
type InventoryAbcFilterParam = "all" | "a" | "b" | "ab" | "abc";
type ProductIssueFilterParam = "all" | "needs_fix" | "revenue" | "blocked";

interface DashboardSeriesRow {
  month: string;
  inflow: { total: number; paid: number; open: number };
  outflow: { total: number; paid: number; open: number };
  net: { total: number; paid: number; open: number };
}

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
  months: string[];
  series: DashboardSeriesRow[];
  breakdown: DashboardBreakdownRow[];
  actualComparisons: ActualComparisonRow[];
  kpis: {
    opening?: number;
    salesPayoutAvg?: number;
    firstNegativeMonth?: string | null;
    actuals?: {
      count?: number;
      lastMonth?: string | null;
      lastClosing?: number | null;
      closingDelta?: number | null;
      revenueDeltaPct?: number | null;
      payoutDeltaPct?: number | null;
      avgRevenueDeltaPct?: number | null;
      avgPayoutDeltaPct?: number | null;
    };
  };
}

interface RuntimeRouteErrorMeta {
  errorAt: string | null;
  routeKey: string | null;
  routePath: string | null;
  routeLabel: string | null;
  message: string | null;
}

const ROUTE_ERROR_STORAGE_KEY = "v2:last-route-error";

function nowIso(): string {
  return new Date().toISOString();
}

function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface SimulatedBreakdownRow extends DashboardBreakdownRow {
  simApplied?: boolean;
}

interface SimulationEventDraft {
  month: string;
  amount: number;
  label: string;
  type: SimulationType;
}

const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6 Monate", count: 6 },
  { value: "next12", label: "Nächste 12 Monate", count: 12 },
  { value: "next18", label: "Nächste 18 Monate", count: 18 },
  { value: "all", label: "Alle Monate", count: null },
];

const PNL_GROUP_ORDER: Array<{ key: DashboardPnlRow["group"]; label: string }> = [
  { key: "inflow", label: "Einzahlungen" },
  { key: "po_fo", label: "PO/FO Zahlungen" },
  { key: "fixcost", label: "Fixkosten" },
  { key: "tax", label: "Steuern & Importkosten" },
  { key: "outflow", label: "Sonstige Auszahlungen" },
  { key: "other", label: "Sonstige" },
];

const DASHBOARD_SECTION_KEYS = new Set([
  "signals",
  "cashflow",
  "actions",
  "robustness",
  "simulation",
  "pnl",
  "actuals",
  "kpis",
]);

const DEFAULT_DASHBOARD_OPEN_SECTIONS = ["signals", "cashflow"];

const COVERAGE_STATUS_UI_META: Record<CoverageStatusKey, {
  label: string;
  color: string;
  className: string;
}> = {
  full: { label: "Vollständig", color: "green", className: "is-full" },
  wide: { label: "Weitgehend", color: "lime", className: "is-wide" },
  partial: { label: "Teilweise", color: "orange", className: "is-partial" },
  insufficient: { label: "Unzureichend", color: "red", className: "is-insufficient" },
};

function normalizeDashboardSectionKeys(value: readonly string[]): string[] {
  const next = new Set<string>();
  value.forEach((entry) => {
    const key = String(entry || "").trim();
    if (DASHBOARD_SECTION_KEYS.has(key)) {
      next.add(key);
    }
  });
  return Array.from(next);
}

function toActiveKeys(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedCurrency(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value < 0) return `−${formatCurrency(Math.abs(value))}`;
  return formatCurrency(value);
}

function formatNumber(value: unknown, digits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

function statusTag(status: RobustnessCheckResult["status"]): JSX.Element {
  return status === "ok" ? <Tag color="green">OK</Tag> : <Tag color="red">Offen</Tag>;
}

function coverageStatusMeta(statusKey: CoverageStatusKey): {
  label: string;
  color: string;
  className: string;
} {
  return COVERAGE_STATUS_UI_META[statusKey] || COVERAGE_STATUS_UI_META.insufficient;
}

function coverageStatusTag(statusKey: CoverageStatusKey): JSX.Element {
  const meta = coverageStatusMeta(statusKey);
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function stockIssueLabel(issue: RobustnessCoverageStockIssue): string {
  if (issue.issueType === "forecast_missing") return "Forecast fehlt";
  if (issue.issueType === "stock_oos") return "Out-of-Stock";
  return "Unter Safety";
}

function sumRows(rows: DashboardPnlRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function simulationDefaultLabel(type: SimulationType): string {
  return type === "dividend" ? "Dividende (Simulation)" : "CAPEX (Simulation)";
}

function signalTitle(label: string, tooltip: string): JSX.Element {
  return (
    <span className="v2-dashboard-signal-title">
      {label}
      <Tooltip title={tooltip}>
        <InfoCircleOutlined />
      </Tooltip>
    </span>
  );
}

function appendRouteQuery(route: string, params: Record<string, string | null | undefined>): string {
  const [pathname, rawQuery = ""] = String(route || "").split("?");
  const query = new URLSearchParams(rawQuery);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") {
      query.delete(key);
      return;
    }
    query.set(key, value);
  });
  const nextQuery = query.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function buildInventoryDashboardRoute(input: {
  risk?: InventoryRiskFilterParam;
  abc?: InventoryAbcFilterParam;
  month?: string | null;
  sku?: string | null;
  mode?: "units" | "doh" | null;
}): string {
  return appendRouteQuery("/v2/inventory/projektion", {
    source: "dashboard",
    risk: input.risk || "under_safety",
    abc: input.abc || "ab",
    month: input.month || null,
    sku: input.sku || null,
    mode: input.mode || null,
    expand: "all",
  });
}

function buildProductsDashboardRoute(input: {
  issues?: ProductIssueFilterParam;
  sku?: string | null;
}): string {
  return appendRouteQuery("/v2/products", {
    source: "dashboard",
    issues: input.issues || "needs_fix",
    sku: input.sku || null,
    expand: "all",
  });
}

function buildForecastDashboardRoute(input: {
  sku?: string | null;
  month?: string | null;
}): string {
  return appendRouteQuery("/v2/forecast", {
    source: "dashboard",
    sku: input.sku || null,
    month: input.month || null,
  });
}

function buildFoDashboardRoute(input: {
  sku: string;
  month?: string | null;
  suggestedUnits?: number | null;
  requiredArrivalDate?: string | null;
  recommendedOrderDate?: string | null;
  source?: "inventory_projection" | "phantom_fo";
  phantomId?: string | null;
  firstRiskMonth?: string | null;
  orderMonth?: string | null;
  leadTimeDays?: number | null;
  returnTo?: string | null;
}): string {
  return appendRouteQuery("/v2/orders/fo", {
    source: input.source || "inventory_projection",
    sku: input.sku || null,
    month: input.month || null,
    suggestedUnits: Number.isFinite(Number(input.suggestedUnits))
      ? String(Math.max(0, Math.round(Number(input.suggestedUnits))))
      : "0",
    requiredArrivalDate: input.requiredArrivalDate || null,
    recommendedOrderDate: input.recommendedOrderDate || null,
    phantomId: input.phantomId || null,
    firstRiskMonth: input.firstRiskMonth || null,
    orderMonth: input.orderMonth || null,
    leadTimeDays: Number.isFinite(Number(input.leadTimeDays))
      ? String(Math.max(0, Math.round(Number(input.leadTimeDays))))
      : null,
    returnTo: input.returnTo || "/v2/dashboard",
  });
}

function buildPoDashboardRoute(input: {
  sku: string;
  suggestedUnits?: number | null;
  requiredArrivalDate?: string | null;
  recommendedOrderDate?: string | null;
}): string {
  return appendRouteQuery("/v2/orders/po", {
    source: "inventory_projection",
    sku: input.sku || null,
    suggestedUnits: Number.isFinite(Number(input.suggestedUnits))
      ? String(Math.max(0, Math.round(Number(input.suggestedUnits))))
      : "0",
    requiredArrivalDate: input.requiredArrivalDate || null,
    recommendedOrderDate: input.recommendedOrderDate || null,
  });
}

function resolveDashboardRoute(input: {
  route: string;
  actionId?: string;
  checkKey?: RobustnessCheckResult["key"];
  month?: string | null;
  sku?: string | null;
  mode?: "units" | "doh" | null;
}): string {
  const route = String(input.route || "");
  if (route.startsWith("/v2/forecast")) {
    return buildForecastDashboardRoute({
      sku: input.sku || null,
      month: input.month || null,
    });
  }
  if (route.startsWith("/v2/inventory/projektion")) {
    const risk = input.actionId === "inventory_safety" || input.checkKey === "sku_coverage"
      ? "under_safety"
      : "all";
    const abc = input.sku
      ? "all"
      : (input.actionId === "inventory_safety" || input.checkKey === "sku_coverage"
        ? "ab"
        : "all");
    return buildInventoryDashboardRoute({
      risk,
      abc,
      month: input.month || null,
      sku: input.sku || null,
      mode: input.mode || null,
    });
  }
  if (route.startsWith("/v2/products")) {
    const issues = input.actionId === "revenue_inputs" || input.checkKey === "revenue_inputs"
      ? "revenue"
      : "needs_fix";
    return buildProductsDashboardRoute({
      issues,
      sku: input.sku || null,
    });
  }
  return route;
}

function getFixcostAverageFromBreakdown(rows: DashboardBreakdownRow[]): number {
  const monthlyFixcosts = rows
    .map((row) => {
      const entries = Array.isArray(row.entries) ? row.entries : [];
      const total = entries
        .filter((entry) => String(entry.direction || "").toLowerCase() === "out" && String(entry.group || "") === "Fixkosten")
        .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
      return total;
    })
    .filter((value) => value > 0);
  if (!monthlyFixcosts.length) return 0;
  return monthlyFixcosts.reduce((sum, value) => sum + value, 0) / monthlyFixcosts.length;
}

function splitOutflowEntriesByType(
  entries: DashboardEntry[],
  provisionalFoIds?: Set<string>,
): {
  fixcost: number;
  po: number;
  fo: number;
  phantomFo: number;
} {
  const totals = {
    fixcost: 0,
    po: 0,
    fo: 0,
    phantomFo: 0,
  };

  entries.forEach((entryRaw) => {
    if (!entryRaw || typeof entryRaw !== "object") return;
    const entry = entryRaw as DashboardEntry;
    if (String(entry.direction || "").toLowerCase() !== "out") return;
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) return;

    const source = String(entry.source || "").toLowerCase();
    if (source === "po") {
      totals.po += amount;
      return;
    }
    if (source === "fo") {
      const sourceId = String(entry.sourceId || "").trim();
      const meta = (entry.meta && typeof entry.meta === "object")
        ? entry.meta as Record<string, unknown>
        : {};
      const isPhantom = entry.provisional === true
        || meta.phantom === true
        || (sourceId ? provisionalFoIds?.has(sourceId) === true : false);
      if (isPhantom) totals.phantomFo += amount;
      else totals.fo += amount;
      return;
    }

    const group = String(entry.group || "").toLowerCase();
    if (source === "fixcosts" || group === "fixkosten") {
      totals.fixcost += amount;
    }
  });

  return totals;
}

function applySimulationToBreakdown(
  rows: DashboardBreakdownRow[],
  simulation: SimulationEventDraft | null,
): SimulatedBreakdownRow[] {
  if (!simulation || !Number.isFinite(simulation.amount) || simulation.amount <= 0) {
    return rows.map((row) => ({ ...row }));
  }

  let running = Number(rows[0]?.opening || 0);
  return rows.map((row, index) => {
    const opening = index === 0 ? Number(row.opening || 0) : running;
    const isTargetMonth = row.month === simulation.month;
    const extraOutflow = isTargetMonth ? Math.abs(Number(simulation.amount || 0)) : 0;
    const inflow = Number(row.inflow || 0);
    const outflow = Number(row.outflow || 0) + extraOutflow;
    const net = inflow - outflow;
    const closing = opening + net;
    running = closing;

    const simulationEntry = isTargetMonth
      ? [{
        id: `sim-${simulation.type}-${simulation.month}`,
        direction: "out",
        amount: extraOutflow,
        label: simulation.label || simulationDefaultLabel(simulation.type),
        month: simulation.month,
        kind: simulation.type === "dividend" ? "dividend" : "capex",
        group: simulation.type === "dividend" ? "Dividende & KapESt" : "Extras (Out)",
        source: "simulation",
      }]
      : [];

    return {
      ...row,
      opening,
      inflow,
      outflow,
      net,
      closing,
      entries: [...(Array.isArray(row.entries) ? row.entries : []), ...simulationEntry],
      simApplied: isTargetMonth,
    };
  });
}

function computeFirstNegativeRobustMonth(
  rows: SimulatedBreakdownRow[],
  robustMonthMap: Map<string, DashboardRobustMonth>,
): string | null {
  for (let i = 0; i < rows.length; i += 1) {
    const month = rows[i].month;
    const robust = robustMonthMap.get(month)?.robust;
    if (!robust) continue;
    if (Number(rows[i].closing || 0) < 0) return month;
  }
  return null;
}

function normalizeForecastDriftSummary(value: unknown): {
  comparedAt: string | null;
  thresholdProfile: string;
  flaggedSkuCount: number;
  flaggedABCount: number;
  flaggedMonthCount: number;
  topItems: Array<{
    sku: string;
    month: string;
    abcClass: string;
    deltaPct: number;
    deltaUnits: number;
    deltaRevenue: number;
  }>;
} {
  if (!value || typeof value !== "object") {
    return {
      comparedAt: null,
      thresholdProfile: "medium",
      flaggedSkuCount: 0,
      flaggedABCount: 0,
      flaggedMonthCount: 0,
      topItems: [],
    };
  }
  const raw = value as Record<string, unknown>;
  const topItemsRaw = Array.isArray(raw.topItems) ? raw.topItems : [];
  return {
    comparedAt: typeof raw.comparedAt === "string" ? raw.comparedAt : null,
    thresholdProfile: String(raw.thresholdProfile || "medium"),
    flaggedSkuCount: Number(raw.flaggedSkuCount || 0),
    flaggedABCount: Number(raw.flaggedABCount || 0),
    flaggedMonthCount: Number(raw.flaggedMonthCount || 0),
    topItems: topItemsRaw
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          sku: String(row.sku || ""),
          month: String(row.month || ""),
          abcClass: String(row.abcClass || "C"),
          deltaPct: Number(row.deltaPct || 0),
          deltaUnits: Number(row.deltaUnits || 0),
          deltaRevenue: Number(row.deltaRevenue || 0),
        };
      })
      .filter((entry) => entry.sku && entry.month),
  };
}

function normalizeForecastImpactSummary(value: unknown): {
  toVersionId: string | null;
  foConflictsOpen: number;
} {
  if (!value || typeof value !== "object") {
    return {
      toVersionId: null,
      foConflictsOpen: 0,
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    toVersionId: raw.toVersionId == null ? null : String(raw.toVersionId || "").trim() || null,
    foConflictsOpen: Math.max(0, Math.round(Number(raw.foConflictsOpen || 0))),
  };
}

function readRuntimeRouteErrorMeta(): RuntimeRouteErrorMeta {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return {
      errorAt: null,
      routeKey: null,
      routePath: null,
      routeLabel: null,
      message: null,
    };
  }
  try {
    const raw = window.sessionStorage.getItem(ROUTE_ERROR_STORAGE_KEY);
    if (!raw) {
      return {
        errorAt: null,
        routeKey: null,
        routePath: null,
        routeLabel: null,
        message: null,
      };
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      errorAt: typeof parsed.errorAt === "string" ? parsed.errorAt : null,
      routeKey: typeof parsed.routeKey === "string" ? parsed.routeKey : null,
      routePath: typeof parsed.routePath === "string" ? parsed.routePath : null,
      routeLabel: typeof parsed.routeLabel === "string" ? parsed.routeLabel : null,
      message: typeof parsed.message === "string" ? parsed.message : null,
    };
  } catch {
    return {
      errorAt: null,
      routeKey: null,
      routePath: null,
      routeLabel: null,
      message: null,
    };
  }
}

export default function DashboardModule(): JSX.Element {
  const { state, loading, error, saving, saveWith } = useWorkspaceState();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const hasStoredDashboardSections = hasModuleExpandedCategoryKeys("dashboard");
  const [range, setRange] = useState<DashboardRange>("next12");
  const [phantomTargetMonth, setPhantomTargetMonth] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [openPnlMonths, setOpenPnlMonths] = useState<string[]>([]);
  const [simType, setSimType] = useState<SimulationType>("dividend");
  const [simMonth, setSimMonth] = useState<string>("");
  const [simAmount, setSimAmount] = useState<number | null>(null);
  const [simLabel, setSimLabel] = useState<string>("");
  const [poArrivalDrafts, setPoArrivalDrafts] = useState<Record<string, string>>({});
  const [runtimeRouteError, setRuntimeRouteError] = useState<RuntimeRouteErrorMeta>(() => readRuntimeRouteErrorMeta());
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const stored = getModuleExpandedCategoryKeys("dashboard");
    if (!hasStoredDashboardSections) return DEFAULT_DASHBOARD_OPEN_SECTIONS.slice();
    return normalizeDashboardSectionKeys(stored);
  });

  const stateObject = state as unknown as Record<string, unknown>;
  const planningMonths = useMemo(
    () => resolvePlanningMonthsFromState(stateObject, 18),
    [state.settings],
  );
  const resolvedPhantomTargetMonth = useMemo(() => {
    if (phantomTargetMonth && planningMonths.includes(phantomTargetMonth)) return phantomTargetMonth;
    return planningMonths[planningMonths.length - 1] || "";
  }, [phantomTargetMonth, planningMonths]);
  const phantomFoSuggestions = useMemo<PhantomFoSuggestion[]>(
    () => buildPhantomFoSuggestions({
      state: stateObject,
      months: planningMonths,
      targetMonth: resolvedPhantomTargetMonth || null,
    }),
    [planningMonths, resolvedPhantomTargetMonth, stateObject],
  );
  const phantomFoById = useMemo(
    () => new Map(phantomFoSuggestions.map((entry) => [entry.id, entry])),
    [phantomFoSuggestions],
  );
  const phantomFoByIssueKey = useMemo(() => {
    const map = new Map<string, PhantomFoSuggestion>();
    phantomFoSuggestions.forEach((entry) => {
      const skuKey = String(entry.sku || "").trim().toLowerCase();
      const firstRiskMonth = String(entry.firstRiskMonth || "").trim();
      const orderMonth = String(entry.orderMonth || "").trim();
      if (!skuKey || !firstRiskMonth || !orderMonth) return;
      const issueKey = `${skuKey}|${firstRiskMonth}|${orderMonth}`;
      if (!map.has(issueKey)) map.set(issueKey, entry);
    });
    return map;
  }, [phantomFoSuggestions]);
  const phantomFoBySkuKey = useMemo(() => {
    const map = new Map<string, PhantomFoSuggestion>();
    phantomFoSuggestions.forEach((entry) => {
      const key = String(entry.sku || "").trim().toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, entry);
    });
    return map;
  }, [phantomFoSuggestions]);
  const phantomFoIdSet = useMemo(
    () => new Set(phantomFoSuggestions.map((entry) => entry.id)),
    [phantomFoSuggestions],
  );
  const planningState = useMemo(
    () => buildStateWithPhantomFos({ state: stateObject, suggestions: phantomFoSuggestions }),
    [phantomFoSuggestions, stateObject],
  );
  const report = useMemo(() => computeSeries(planningState) as SeriesResult, [planningState]);
  const months = report.months || [];
  const breakdown = report.breakdown || [];
  const actualComparisons = report.actualComparisons || [];

  const visibleMonths = useMemo(() => {
    const option = DASHBOARD_RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return months;
    return months.slice(0, option.count);
  }, [months, range]);

  const visibleMonthSet = useMemo(() => new Set(visibleMonths), [visibleMonths]);

  const visibleBreakdown = useMemo(
    () => breakdown.filter((row) => visibleMonthSet.has(row.month)),
    [breakdown, visibleMonthSet],
  );
  const visibleActualComparisons = useMemo(
    () => actualComparisons.filter((row) => visibleMonthSet.has(row.month)),
    [actualComparisons, visibleMonthSet],
  );

  const robustness = useMemo(() => {
    return buildDashboardRobustness({
      state: stateObject,
      months: visibleMonths,
    });
  }, [stateObject, visibleMonths]);

  const readiness = useMemo(() => {
    return buildReadinessGate({
      state: stateObject,
      horizonMonths: 12,
      runtimeErrorAt: runtimeRouteError.errorAt,
      runtimeErrorRoute: runtimeRouteError.routePath,
    });
  }, [runtimeRouteError.errorAt, runtimeRouteError.routePath, stateObject]);

  useEffect(() => {
    if (!planningMonths.length) {
      setPhantomTargetMonth("");
      return;
    }
    setPhantomTargetMonth((current) => (
      current && planningMonths.includes(current)
        ? current
        : planningMonths[planningMonths.length - 1]
    ));
  }, [planningMonths]);

  useEffect(() => {
    if (!robustness.months.length) {
      setSelectedMonth("");
      return;
    }
    if (!selectedMonth || !robustness.monthMap.has(selectedMonth)) {
      const firstOpen = robustness.months.find((entry) => !entry.robust)?.month || robustness.months[0].month;
      setSelectedMonth(firstOpen);
    }
  }, [robustness, selectedMonth]);

  useEffect(() => {
    if (!visibleBreakdown.length) {
      setOpenPnlMonths([]);
      return;
    }
    setOpenPnlMonths((current) => {
      const valid = new Set(visibleBreakdown.map((entry) => entry.month));
      const kept = current.filter((month) => valid.has(month));
      if (kept.length) return kept;
      return [visibleBreakdown[0].month];
    });
  }, [visibleBreakdown]);

  useEffect(() => {
    if (!visibleMonths.length) {
      setSimMonth("");
      return;
    }
    if (!simMonth || !visibleMonths.includes(simMonth)) {
      setSimMonth(visibleMonths[0]);
    }
  }, [simMonth, visibleMonths]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("dashboard", openSections);
  }, [openSections]);

  const handleDashboardSectionsChange = (value: string | string[]) => {
    setOpenSections(normalizeDashboardSectionKeys(toActiveKeys(value)));
  };

  const simulationDraft = useMemo<SimulationEventDraft | null>(() => {
    if (!simMonth || !Number.isFinite(simAmount as number) || Number(simAmount) <= 0) return null;
    return {
      month: simMonth,
      amount: Math.abs(Number(simAmount)),
      type: simType,
      label: simLabel.trim() || simulationDefaultLabel(simType),
    };
  }, [simAmount, simLabel, simMonth, simType]);

  const simulatedBreakdown = useMemo(
    () => applySimulationToBreakdown(visibleBreakdown, simulationDraft),
    [simulationDraft, visibleBreakdown],
  );

  const simulatedBreakdownMap = useMemo(() => {
    const map = new Map<string, SimulatedBreakdownRow>();
    simulatedBreakdown.forEach((row) => map.set(row.month, row));
    return map;
  }, [simulatedBreakdown]);

  const latestSimulatedBreakdown = simulatedBreakdown[simulatedBreakdown.length - 1] || null;
  const totalInflow = simulatedBreakdown.reduce((sum, row) => sum + Number(row.inflow || 0), 0);
  const totalOutflow = simulatedBreakdown.reduce((sum, row) => sum + Number(row.outflow || 0), 0);
  const totalNet = simulatedBreakdown.reduce((sum, row) => sum + Number(row.net || 0), 0);

  const fixcostAverage = useMemo(() => getFixcostAverageFromBreakdown(visibleBreakdown), [visibleBreakdown]);
  const bufferFloor = fixcostAverage * 2;

  const robustClosings = useMemo(
    () => simulatedBreakdown
      .filter((row) => robustness.monthMap.get(row.month)?.robust)
      .map((row) => Number(row.closing || 0)),
    [robustness.monthMap, simulatedBreakdown],
  );

  const freeCashAfterBuffer = useMemo(() => {
    if (!robustClosings.length || bufferFloor <= 0) return null;
    const minClosing = Math.min(...robustClosings);
    return minClosing - bufferFloor;
  }, [bufferFloor, robustClosings]);

  const firstNegativeRobustMonth = useMemo(
    () => computeFirstNegativeRobustMonth(simulatedBreakdown, robustness.monthMap),
    [robustness.monthMap, simulatedBreakdown],
  );

  const simulationBreachMonth = useMemo(() => {
    if (!simulationDraft || bufferFloor <= 0) return null;
    return simulatedBreakdown.find((row) => {
      const idxRow = monthIndex(row.month);
      const idxSim = monthIndex(simulationDraft.month);
      if (idxRow == null || idxSim == null || idxRow < idxSim) return false;
      return Number(row.closing || 0) < bufferFloor;
    })?.month || null;
  }, [bufferFloor, simulatedBreakdown, simulationDraft]);

  const simulationSafe = Boolean(simulationDraft) && bufferFloor > 0 && !simulationBreachMonth;

  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastVersioningSnapshot = useMemo(() => {
    const clone = structuredClone(forecast || {});
    ensureForecastVersioningContainers(clone as Record<string, unknown>);
    return clone as Record<string, unknown>;
  }, [forecast]);
  const activeForecastLabel = useMemo(
    () => getActiveForecastLabel(forecastVersioningSnapshot as Record<string, unknown>),
    [forecastVersioningSnapshot],
  );
  const impactSummary = normalizeForecastImpactSummary(forecastVersioningSnapshot.lastImpactSummary);
  const activeVersionId = String(forecastVersioningSnapshot.activeVersionId || "").trim() || null;
  const openForecastFoConflicts = impactSummary.toVersionId && activeVersionId && impactSummary.toVersionId === activeVersionId
    ? impactSummary.foConflictsOpen
    : 0;
  const lastImportAt = typeof forecast.lastImportAt === "string" ? forecast.lastImportAt : null;
  const driftSummary = normalizeForecastDriftSummary(forecast.lastDriftSummary);
  const driftReviewedComparedAt = typeof forecast.lastDriftReviewedComparedAt === "string"
    ? forecast.lastDriftReviewedComparedAt
    : null;
  const driftReviewedAt = typeof forecast.lastDriftReviewedAt === "string"
    ? forecast.lastDriftReviewedAt
    : null;
  const driftReviewedForCurrent = Boolean(
    driftSummary.comparedAt
    && driftReviewedComparedAt
    && driftReviewedComparedAt === driftSummary.comparedAt
    && driftReviewedAt,
  );
  const importDate = lastImportAt ? new Date(lastImportAt) : null;
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceImport = importDate ? Math.floor((now.getTime() - importDate.getTime()) / msPerDay) : null;
  const forecastFreshnessStatus = !importDate
    ? "none"
    : daysSinceImport != null && daysSinceImport <= 35
      ? "fresh"
      : daysSinceImport != null && daysSinceImport <= 45
        ? "aging"
        : "stale";

  const forecastFreshnessLabel = !importDate
    ? "Kein Forecast-Import"
    : `${daysSinceImport} Tage seit Import`;

  const nextRecommendedImport = importDate
    ? addDays(importDate, 30)
    : null;

  const selectedMonthData = selectedMonth ? robustness.monthMap.get(selectedMonth) || null : null;
  const selectedStockIssues = selectedMonthData?.coverage.stockIssues || [];
  const selectedOrderDutyIssues = selectedMonthData?.coverage.orderDutyIssues || [];
  const selectedOptionalChecks = selectedMonthData
    ? selectedMonthData.checks.filter((entry) => entry.key !== "sku_coverage")
    : [];
  const selectedAdditionalBlockers = selectedMonthData
    ? selectedMonthData.blockers.filter((entry) => entry.checkKey !== "sku_coverage")
    : [];
  const selectedChecklist = useMemo(() => {
    if (!selectedMonthData) return [] as Array<{ key: string; label: string; passed: boolean; description: string }>;
    const coverageMode = selectedMonthData.coverage.projectionMode === "doh" ? "DOH" : "Units";
    const stockIssueCount = selectedMonthData.coverage.stockIssueCount;
    const orderDutyIssueCount = selectedMonthData.coverage.orderDutyIssueCount;
    const base = [
      {
        key: "stock",
        label: "Bestands-Check ok?",
        passed: stockIssueCount === 0,
        description: stockIssueCount === 0
          ? `Alle aktiven SKUs im Monat ${formatMonthLabel(selectedMonthData.month)} über Safety (${coverageMode}).`
          : `${stockIssueCount} SKU(s) mit OOS/unter Safety oder fehlendem Forecast.`,
      },
      {
        key: "order_duty",
        label: "Bestellpflicht/Look-Ahead ok?",
        passed: orderDutyIssueCount === 0,
        description: orderDutyIssueCount === 0
          ? "Keine SKU benötigt spätestens in diesem Monat eine neue FO/PO."
          : `${orderDutyIssueCount} SKU(s) mit fälliger Bestellpflicht (inkl. Look-Ahead).`,
      },
    ];
    const optional = selectedOptionalChecks.map((check) => ({
      key: check.key,
      label: `${check.label} ok?`,
      passed: check.passed,
      description: check.detail,
    }));
    return [...base, ...optional];
  }, [selectedMonthData, selectedOptionalChecks]);
  const currentMonth = currentMonthKey();
  const todayIso = todayIsoDate();
  const currentMonthIdx = monthIndex(currentMonth);
  const actionFocusMonth = useMemo(() => {
    return robustness.months.find((entry) => !entry.robust)?.month || selectedMonth || visibleMonths[0] || null;
  }, [robustness.months, selectedMonth, visibleMonths]);
  const poArrivalTasks = useMemo<PoArrivalTask[]>(() => {
    return buildPoArrivalTasks({
      state: stateObject,
      month: currentMonth,
      todayIso,
    });
  }, [currentMonth, stateObject, todayIso]);

  useEffect(() => {
    const refreshRuntimeRouteError = () => setRuntimeRouteError(readRuntimeRouteErrorMeta());
    refreshRuntimeRouteError();
    window.addEventListener("v2:route-load-state", refreshRuntimeRouteError as EventListener);
    window.addEventListener("storage", refreshRuntimeRouteError);
    return () => {
      window.removeEventListener("v2:route-load-state", refreshRuntimeRouteError as EventListener);
      window.removeEventListener("storage", refreshRuntimeRouteError);
    };
  }, []);

  useEffect(() => {
    setPoArrivalDrafts((current) => {
      const validIds = new Set(poArrivalTasks.map((task) => task.id));
      let changed = false;
      const next: Record<string, string> = {};
      Object.entries(current).forEach(([id, value]) => {
        if (!validIds.has(id)) {
          changed = true;
          return;
        }
        next[id] = value;
      });
      poArrivalTasks.forEach((task) => {
        if (next[task.id]) return;
        next[task.id] = task.arrivalDate || todayIso;
        changed = true;
      });
      return changed ? next : current;
    });
  }, [poArrivalTasks, todayIso]);

  const pnlRowsByMonth = useMemo(
    () => buildDashboardPnlRowsByMonth({
      breakdown: visibleBreakdown,
      state: planningState,
      provisionalFoIds: phantomFoIdSet,
    }),
    [phantomFoIdSet, planningState, visibleBreakdown],
  );

  const chartOption = useMemo(() => {
    const monthLabels = visibleMonths.map((month) => formatMonthLabel(month));
    const baseClosing = visibleBreakdown.map((row) => Number(row.closing || 0));
    const robustMask = visibleBreakdown.map((row) => Boolean(robustness.monthMap.get(row.month)?.robust));
    const robustPositive = baseClosing.map((value, idx) => (robustMask[idx] && value >= 0 ? value : null));
    const robustNegative = baseClosing.map((value, idx) => (robustMask[idx] && value < 0 ? value : null));
    const softPositive = baseClosing.map((value, idx) => (!robustMask[idx] && value >= 0 ? value : null));
    const softNegative = baseClosing.map((value, idx) => (!robustMask[idx] && value < 0 ? value : null));
    const simulationSeries = simulationDraft
      ? visibleBreakdown.map((row) => Number(simulatedBreakdownMap.get(row.month)?.closing || 0))
      : [];
    const outflowSplitSeries = simulatedBreakdown.map((row) => splitOutflowEntriesByType(
      Array.isArray(row.entries) ? row.entries : [],
      phantomFoIdSet,
    ));
    const fixcostOutflowSeries = outflowSplitSeries.map((row) => -row.fixcost);
    const poOutflowSeries = outflowSplitSeries.map((row) => -row.po);
    const foOutflowSeries = outflowSplitSeries.map((row) => -row.fo);
    const phantomFoOutflowSeries = outflowSplitSeries.map((row) => -row.phantomFo);

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const first = rows[0] as { axisValueLabel?: string } | undefined;
          const lines = [`<div><strong>${first?.axisValueLabel || ""}</strong></div>`];
          rows.forEach((entryRaw) => {
            const entry = entryRaw as { marker?: string; seriesName?: string; value?: number | null };
            const value = Number(entry?.value);
            if (!Number.isFinite(value)) return;
            lines.push(`<div>${entry?.marker || ""}${entry?.seriesName || ""}: ${formatCurrency(value)}</div>`);
          });
          return lines.join("");
        },
      },
      legend: {
        top: 0,
      },
      grid: {
        left: 56,
        right: 70,
        top: 44,
        bottom: 32,
      },
      xAxis: {
        type: "category",
        data: monthLabels,
      },
      yAxis: [
        {
          type: "value",
          name: "Cashflow",
          axisLabel: {
            formatter: (value: number) => formatSignedCurrency(value),
          },
        },
        {
          type: "value",
          name: "Kontostand",
          position: "right",
          axisLabel: {
            formatter: (value: number) => formatCurrency(value),
          },
        },
      ],
      series: [
        {
          name: "Einzahlungen",
          type: "bar",
          stack: "cash",
          data: simulatedBreakdown.map((row) => Number(row.inflow || 0)),
          itemStyle: { color: "#27ae60" },
        },
        {
          name: "Fixkosten",
          type: "bar",
          stack: "cash",
          data: fixcostOutflowSeries,
          itemStyle: { color: "#7f1d1d" },
        },
        {
          name: "PO",
          type: "bar",
          stack: "cash",
          data: poOutflowSeries,
          itemStyle: { color: "#e74c3c" },
        },
        {
          name: "FO",
          type: "bar",
          stack: "cash",
          data: foOutflowSeries,
          itemStyle: { color: "#f97316" },
        },
        {
          name: "Phantom FO",
          type: "bar",
          stack: "cash",
          data: phantomFoOutflowSeries,
          itemStyle: { color: "#fbbf24" },
        },
        {
          name: "Netto",
          type: "line",
          smooth: true,
          data: simulatedBreakdown.map((row) => Number(row.net || 0)),
          itemStyle: { color: "#0f1b2d" },
          lineStyle: { width: 2 },
        },
        {
          name: "Kontostand belastbar",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: robustPositive,
          lineStyle: { width: 2, color: "#3bc2a7" },
          itemStyle: { color: "#3bc2a7" },
        },
        {
          name: "Kontostand belastbar (<0)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: robustNegative,
          lineStyle: { width: 2, color: "#b42318" },
          itemStyle: { color: "#b42318" },
        },
        {
          name: "Kontostand orientierend (nicht robust)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: softPositive,
          lineStyle: { width: 2, type: "dashed", color: "#94a3b8" },
          itemStyle: { color: "#94a3b8" },
        },
        {
          name: "Orientierend (<0)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: softNegative,
          lineStyle: { width: 2, type: "dashed", color: "#c2410c" },
          itemStyle: { color: "#c2410c" },
        },
        ...(simulationDraft ? [
          {
            name: "Simulation",
            type: "line",
            smooth: true,
            yAxisIndex: 1,
            connectNulls: false,
            data: simulationSeries,
            lineStyle: { width: 2, type: "dashed", color: "#f59e0b" },
            itemStyle: { color: "#f59e0b" },
          },
        ] : []),
      ],
    };
  }, [
    phantomFoIdSet,
    robustness.monthMap,
    simulatedBreakdown,
    simulatedBreakdownMap,
    simulationDraft,
    visibleBreakdown,
    visibleMonths,
  ]);

  const actualColumns = useMemo<ColumnDef<ActualComparisonRow>[]>(() => [
    { header: "Monat", accessorKey: "month" },
    {
      header: "Plan Umsatz",
      accessorKey: "plannedRevenue",
      cell: ({ row }) => formatCurrency(row.original.plannedRevenue),
    },
    {
      header: "Ist Umsatz",
      accessorKey: "actualRevenue",
      cell: ({ row }) => formatCurrency(row.original.actualRevenue),
    },
    {
      header: "Delta Umsatz",
      accessorKey: "revenueDelta",
      cell: ({ row }) => (
        <span className={Number(row.original.revenueDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatCurrency(row.original.revenueDelta)}
        </span>
      ),
    },
    {
      header: "Delta Umsatz %",
      accessorKey: "revenueDeltaPct",
      cell: ({ row }) => formatPercent(row.original.revenueDeltaPct),
    },
    {
      header: "Plan Kontostand",
      accessorKey: "plannedClosing",
      cell: ({ row }) => formatCurrency(row.original.plannedClosing),
    },
    {
      header: "Ist Kontostand",
      accessorKey: "actualClosing",
      cell: ({ row }) => formatCurrency(row.original.actualClosing),
    },
    {
      header: "Delta Kontostand",
      accessorKey: "closingDelta",
      cell: ({ row }) => (
        <span className={Number(row.original.closingDelta || 0) < 0 ? "v2-negative" : undefined}>
          {formatCurrency(row.original.closingDelta)}
        </span>
      ),
    },
  ], []);

  const checkColumns = useMemo(() => [
    {
      title: "Check",
      dataIndex: "label",
      key: "label",
      sorter: (a: RobustnessCheckResult, b: RobustnessCheckResult) => String(a.label || "").localeCompare(String(b.label || ""), "de-DE"),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      sorter: (a: RobustnessCheckResult, b: RobustnessCheckResult) => String(a.status || "").localeCompare(String(b.status || ""), "de-DE"),
      render: (status: RobustnessCheckResult["status"]) => statusTag(status),
    },
    {
      title: "Detail",
      dataIndex: "detail",
      key: "detail",
      width: 320,
      sorter: (a: RobustnessCheckResult, b: RobustnessCheckResult) => String(a.detail || "").localeCompare(String(b.detail || ""), "de-DE"),
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
    {
      title: "",
      key: "route",
      width: 132,
      render: (_: unknown, row: RobustnessCheckResult) => (
        <Button
          size="small"
          onClick={() => navigate(resolveDashboardRoute({
            route: row.route,
            checkKey: row.key,
            month: selectedMonthData?.month || null,
            mode: selectedMonthData?.coverage.projectionMode || null,
          }))}
        >
          Öffnen
        </Button>
      ),
    },
  ], [navigate, selectedMonthData?.coverage.projectionMode, selectedMonthData?.month]);

  const pnlItems = useMemo(() => {
    return visibleBreakdown.map((monthRow) => {
      const monthRows = pnlRowsByMonth.get(monthRow.month) || [];
      const provisionalRows = monthRows.filter((row) => row.provisional);
      const groupedRows = PNL_GROUP_ORDER
        .map((group) => ({
          ...group,
          rows: monthRows.filter((row) => row.group === group.key),
        }))
        .filter((group) => group.rows.length > 0);

      const inflowRows = monthRows.filter((row) => row.group === "inflow");
      const outflowRows = monthRows.filter((row) => row.amount < 0);
      const robust = robustness.monthMap.get(monthRow.month)?.robust || false;

      return {
        key: monthRow.month,
        label: (
          <div className="v2-dashboard-pnl-header">
            <Text strong>{formatMonthLabel(monthRow.month)}</Text>
            <Space wrap>
              <Tag color="green">Einzahlungen: {formatCurrency(sumRows(inflowRows))}</Tag>
              <Tag color="red">Auszahlungen: {formatCurrency(Math.abs(sumRows(outflowRows)))}</Tag>
              {provisionalRows.length ? (
                <Tag color="gold">Vorbehaltlich: {formatSignedCurrency(sumRows(provisionalRows))}</Tag>
              ) : null}
              <Tag color={monthRow.net >= 0 ? "green" : "red"}>Netto: {formatCurrency(monthRow.net)}</Tag>
              <Tag color={robust ? "green" : "red"}>Robust: {robust ? "ja" : "nein"}</Tag>
            </Space>
          </div>
        ),
        children: (
          <div className="v2-dashboard-pnl-month">
            {groupedRows.map((group) => {
              if (group.key === "po_fo") {
                const orderMap = new Map<string, {
                  source: "po" | "fo";
                  sourceId: string | null;
                  sourceNumber: string | null;
                  rows: DashboardPnlRow[];
                }>();
                group.rows.forEach((row) => {
                  const source = row.source === "fo" ? "fo" : "po";
                  const sourceId = row.sourceId ? String(row.sourceId) : null;
                  const sourceNumber = row.sourceNumber ? String(row.sourceNumber) : null;
                  const key = `${source}:${sourceId || sourceNumber || row.label}`;
                  const existing = orderMap.get(key);
                  if (existing) {
                    existing.rows.push(row);
                    if (!existing.sourceId && sourceId) existing.sourceId = sourceId;
                    if (!existing.sourceNumber && sourceNumber) existing.sourceNumber = sourceNumber;
                    return;
                  }
                  orderMap.set(key, {
                    source,
                    sourceId,
                    sourceNumber,
                    rows: [row],
                  });
                });

                const orderItems = Array.from(orderMap.entries()).map(([orderKey, order]) => {
                  const total = sumRows(order.rows);
                  const provisionalOrderRows = order.rows.filter((row) => row.provisional);
                  const provisionalOrderSourceId = provisionalOrderRows
                    .map((row) => String(row.sourceId || "").trim())
                    .find((id) => id && phantomFoIdSet.has(id))
                    || null;
                  const phantomFoId = order.source === "fo"
                    ? (
                      order.sourceId && phantomFoIdSet.has(order.sourceId)
                        ? order.sourceId
                        : provisionalOrderSourceId
                    )
                    : null;
                  const phantomSuggestion = phantomFoId ? (phantomFoById.get(phantomFoId) || null) : null;
                  const tooltipMeta = order.rows.find((row) => row.tooltipMeta)?.tooltipMeta;
                  const aliases = Array.from(new Set(
                    order.rows.flatMap((row) => row.tooltipMeta?.aliases || []).filter(Boolean),
                  ));
                  const aliasSummary = aliases.length > 3
                    ? `${aliases.slice(0, 3).join(", ")} +${aliases.length - 3}`
                    : aliases.join(", ");
                  const timeline = buildDashboardOrderTimeline({
                    state: planningState,
                    source: order.source,
                    sourceId: order.sourceId,
                    sourceNumber: order.sourceNumber,
                  });

                  return {
                    key: orderKey,
                    label: (
                      <div className="v2-dashboard-pnl-order-row">
                        <div className="v2-dashboard-pnl-order-row-main">
                          <Text strong>{String(order.source).toUpperCase()} {order.sourceNumber || order.sourceId || "—"}</Text>
                          {aliasSummary ? (
                            aliases.length > 3 ? (
                              <Tooltip title={aliases.join(", ")}>
                                <Text type="secondary">· {aliasSummary}</Text>
                              </Tooltip>
                            ) : (
                              <Text type="secondary">· {aliasSummary}</Text>
                            )
                          ) : null}
                        </div>
                        <Space size={6}>
                          <Tag color={total < 0 ? "red" : "green"}>{formatSignedCurrency(total)}</Tag>
                          {provisionalOrderRows.length ? <Tag color="gold">Vorbehaltlich</Tag> : null}
                          {phantomSuggestion ? <Tag color="orange">Phantom FO</Tag> : null}
                          {tooltipMeta?.units != null ? <Tag>Stück: {formatNumber(tooltipMeta.units, 0)}</Tag> : null}
                        </Space>
                      </div>
                    ),
                    children: (
                      <div className="v2-dashboard-pnl-order-detail">
                        {phantomSuggestion ? (
                          <div className="v2-dashboard-pnl-phantom-hint">
                            <Space wrap>
                              <Tag color="gold">Automatisch vorgeschlagen</Tag>
                              <Text type="secondary">
                                Risikomonat {formatMonthLabel(phantomSuggestion.firstRiskMonth)} · bestellen bis {formatIsoDate(phantomSuggestion.latestOrderDate)}
                              </Text>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => navigate(buildFoDashboardRoute({
                                  sku: phantomSuggestion.sku,
                                  month: monthRow.month,
                                  suggestedUnits: phantomSuggestion.suggestedUnits,
                                  requiredArrivalDate: phantomSuggestion.requiredArrivalDate,
                                  recommendedOrderDate: phantomSuggestion.recommendedOrderDate,
                                  source: "phantom_fo",
                                  phantomId: phantomSuggestion.id,
                                  firstRiskMonth: phantomSuggestion.firstRiskMonth,
                                  orderMonth: phantomSuggestion.orderMonth,
                                  leadTimeDays: phantomSuggestion.leadTimeDays,
                                  returnTo: "/v2/dashboard",
                                }))}
                              >
                                Prüfen & bestätigen
                              </Button>
                            </Space>
                          </div>
                        ) : null}
                        {timeline ? (
                          <div className="v2-dashboard-order-timeline-shell">
                            <VisTimeline
                              className="v2-dashboard-order-timeline"
                              items={timeline.items}
                              visibleStartMs={timeline.visibleStartMs}
                              visibleEndMs={timeline.visibleEndMs}
                              height={188}
                            />
                          </div>
                        ) : (
                          <Alert
                            type="info"
                            showIcon
                            message={`Keine Timeline-Daten für ${String(order.source).toUpperCase()} ${order.sourceNumber || order.sourceId || "—"} verfügbar.`}
                          />
                        )}
                        <div className="v2-table-shell v2-scroll-host">
                          <table className="v2-stats-table" data-layout="auto">
                            <thead>
                              <tr>
                                <th>Milestone</th>
                                <th>Betrag</th>
                                <th>Fällig</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.rows.map((row, index) => {
                                const tooltip = row.tooltipMeta ? (
                                  <div>
                                    <div><strong>{String(row.source).toUpperCase()} {row.sourceNumber || row.sourceId || "—"}</strong></div>
                                    <div>Alias: {row.tooltipMeta.aliases.join(", ") || "-"}</div>
                                    <div>Stückzahl: {row.tooltipMeta.units != null ? formatNumber(row.tooltipMeta.units, 0) : "-"}</div>
                                    <div>Fälligkeit: {formatIsoDate(row.tooltipMeta.dueDate)}</div>
                                  </div>
                                ) : null;
                                return (
                                  <tr key={`${orderKey}-${index}`}>
                                    <td>{tooltip ? <Tooltip title={tooltip}>{row.label}</Tooltip> : row.label}</td>
                                    <td className={row.amount < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(row.amount)}</td>
                                    <td>{formatIsoDate(row.tooltipMeta?.dueDate)}</td>
                                    <td>
                                      {row.provisional
                                        ? <Tag color="gold">Vorbehaltlich</Tag>
                                        : (row.paid == null
                                          ? <Tag>—</Tag>
                                          : row.paid
                                            ? <Tag color="green">Bezahlt</Tag>
                                            : <Tag color="gold">Offen</Tag>)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ),
                  };
                });

                return (
                  <div key={`${monthRow.month}-${group.key}`} className="v2-dashboard-pnl-group">
                    <div className="v2-dashboard-pnl-group-head">
                      <Text strong>{group.label}</Text>
                      <Tag color="blue">{formatSignedCurrency(sumRows(group.rows))}</Tag>
                    </div>
                    <Collapse size="small" items={orderItems} destroyInactivePanel />
                  </div>
                );
              }

              return (
                <div key={`${monthRow.month}-${group.key}`} className="v2-dashboard-pnl-group">
                  <div className="v2-dashboard-pnl-group-head">
                    <Text strong>{group.label}</Text>
                    <Tag color={sumRows(group.rows) < 0 ? "red" : "green"}>{formatSignedCurrency(sumRows(group.rows))}</Tag>
                  </div>
                  <div className="v2-table-shell v2-scroll-host">
                    <table className="v2-stats-table" data-layout="auto">
                      <thead>
                        <tr>
                          <th>Position</th>
                          <th>Betrag</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row, index) => (
                          <tr key={`${monthRow.month}-${group.key}-${index}`}>
                            <td>{row.label}</td>
                            <td className={row.amount < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(row.amount)}</td>
                            <td>
                              {row.paid == null ? <Tag>—</Tag> : row.paid ? <Tag color="green">Bezahlt</Tag> : <Tag color="gold">Offen</Tag>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ),
      };
    });
  }, [navigate, phantomFoById, phantomFoIdSet, planningState, pnlRowsByMonth, robustness.monthMap, visibleBreakdown]);

  async function commitSimulation(): Promise<void> {
    if (!simulationDraft) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const stateDraft = next as unknown as Record<string, unknown>;
      const label = simulationDraft.label || simulationDefaultLabel(simulationDraft.type);
      if (simulationDraft.type === "dividend") {
        const dividends = Array.isArray(stateDraft.dividends) ? [...(stateDraft.dividends as Record<string, unknown>[])] : [];
        dividends.push({
          id: `div-${Date.now()}`,
          month: simulationDraft.month,
          label,
          amountEur: Math.abs(simulationDraft.amount),
        });
        stateDraft.dividends = dividends;
      } else {
        const extras = Array.isArray(stateDraft.extras) ? [...(stateDraft.extras as Record<string, unknown>[])] : [];
        extras.push({
          id: `extra-${Date.now()}`,
          month: simulationDraft.month,
          label,
          amountEur: -Math.abs(simulationDraft.amount),
        });
        stateDraft.extras = extras;
      }
      return next;
    }, `v2:dashboard:simulation-commit:${simulationDraft.type}`);

    setSimAmount(null);
    setSimLabel("");
  }

  async function markDriftReviewed(): Promise<void> {
    if (!driftSummary.comparedAt) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const stateDraft = next as unknown as Record<string, unknown>;
      if (!stateDraft.forecast || typeof stateDraft.forecast !== "object") {
        stateDraft.forecast = {};
      }
      const forecastDraft = stateDraft.forecast as Record<string, unknown>;
      forecastDraft.lastDriftReviewedAt = nowIso();
      forecastDraft.lastDriftReviewedComparedAt = driftSummary.comparedAt;
      return next;
    }, "v2:dashboard:forecast-drift-reviewed");
  }

  async function savePoArrivalDate(poId: string, dateIso: string | null, source: string): Promise<void> {
    try {
      await saveWith((current) => {
        const next = ensureAppStateV2(current);
        const pos = Array.isArray(next.pos) ? next.pos : [];
        next.pos = pos.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const record = entry as Record<string, unknown>;
          const recordId = String(record.id || record.poNo || "").trim();
          if (recordId !== poId) return record;
          return {
            ...record,
            arrivalDate: dateIso || null,
          };
        });
        return next;
      }, source);
      messageApi.success(dateIso ? "Wareneingang gespeichert." : "Wareneingang zurückgesetzt.");
    } catch (saveError) {
      console.error(saveError);
      messageApi.error(saveError instanceof Error ? saveError.message : "Wareneingang konnte nicht gespeichert werden.");
    }
  }

  const executiveFlag = ((state.settings as Record<string, unknown> | undefined)?.featureFlags as Record<string, unknown> | undefined)?.executiveDashboardV2;
  const executiveEnabled = executiveFlag !== false;

  if (!executiveEnabled) {
    return (
      <div className="v2-page">
        <Alert
          type="info"
          showIcon
          message="Executive Dashboard ist per Feature-Flag deaktiviert (settings.featureFlags.executiveDashboardV2=false)."
        />
      </div>
    );
  }

  return (
    <div className="v2-page">
      {contextHolder}
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Dashboard</Title>
            <Paragraph>
              Executive-Cockpit für Kontostand, Robustheit und Maßnahmenpriorisierung. Nicht robuste Monate sind klar markiert.
            </Paragraph>
          </div>
          <div className="v2-toolbar-field">
            <Text>PFO bis</Text>
            <Select
              value={resolvedPhantomTargetMonth || undefined}
              onChange={(value) => setPhantomTargetMonth(String(value || ""))}
              options={planningMonths.map((month) => ({ value: month, label: formatMonthLabel(month) }))}
              style={{ width: 220, maxWidth: "100%" }}
              disabled={!planningMonths.length}
            />
          </div>
          <div className="v2-toolbar-field">
            <Text>Zeitraum</Text>
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={DASHBOARD_RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 220, maxWidth: "100%" }}
            />
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Button onClick={() => navigate("/v2/forecast")}>Zur Absatzprognose</Button>
            <Button onClick={() => navigate("/v2/inventory/projektion")}>Zur Bestandsprojektion</Button>
            <Button onClick={() => navigate("/v2/orders/po")}>Zu Bestellungen</Button>
            <Button onClick={() => navigate("/v2/abschluss/eingaben")}>Zum Abschluss</Button>
          </div>
          <Text type="secondary">
            Aktueller Betrachtungszeitraum: {visibleMonths.length} Monat(e). PFO-Ziel: {resolvedPhantomTargetMonth ? formatMonthLabel(resolvedPhantomTargetMonth) : "—"}.
          </Text>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}
      {openForecastFoConflicts > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`Forecast-Änderung: ${openForecastFoConflicts} FOs prüfen`}
          description={(
            <Button size="small" onClick={() => navigate("/v2/forecast?panel=conflicts")}>
              Zur Konfliktliste
            </Button>
          )}
        />
      ) : null}

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "signals",
          label: "Executive Signals",
          children: (
            <div className="v2-dashboard-signal-grid">
              <Card className="v2-dashboard-signal-card v2-dashboard-readiness-card">
                <Statistic
                  title={signalTitle(
                    "Readiness Gate",
                    "Go/No-Go vor großer Datenpflege. Alle Checks müssen grün sein.",
                  )}
                  value={readiness.ready ? "Bereit" : "Nicht bereit"}
                />
                <Space wrap>
                  <Tag color={readiness.ready ? "green" : "red"}>
                    {readiness.ready ? "Go" : "No-Go"}
                  </Tag>
                  <Tag color={readiness.ready ? "green" : "gold"}>
                    {readiness.robustMonthsCount}/{readiness.robustRequiredCount} robuste Monate
                  </Tag>
                </Space>
                {!readiness.ready && readiness.blockers.length ? (
                  <div className="v2-dashboard-readiness-blockers">
                    {readiness.blockers.slice(0, 2).map((blocker) => (
                      <div key={blocker.id} className="v2-dashboard-readiness-blocker-item">
                        <Text type="secondary">{blocker.label}: {blocker.message}</Text>
                        <Button size="small" onClick={() => navigate(blocker.route)}>Öffnen</Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text type="secondary">Alle Gate-Checks erfüllt.</Text>
                )}
              </Card>

              <Card className="v2-dashboard-signal-card">
                <Statistic
                  title={signalTitle(
                    "Robust bis",
                    "Letzter Monat, in dem alle Hard-Checks erfüllt sind. Danach ist der Kontostand nur Orientierung.",
                  )}
                  value={robustness.robustUntilMonth ? formatMonthLabel(robustness.robustUntilMonth) : "—"}
                />
                <Text type="secondary">{robustness.robustMonthsCount}/{robustness.totalMonths} Monate robust</Text>
              </Card>

              <Card className="v2-dashboard-signal-card">
                <Statistic
                  title={signalTitle(
                    "Erster negativer Monat (robust)",
                    "Erster belastbarer Monat mit negativem Kontostand. Nicht robuste Monate werden dafür ignoriert.",
                  )}
                  value={firstNegativeRobustMonth ? formatMonthLabel(firstNegativeRobustMonth) : "Keiner"}
                />
                <Text type="secondary">Simulation wird berücksichtigt</Text>
              </Card>

              <Card className="v2-dashboard-signal-card">
                <Statistic
                  title={signalTitle(
                    "Freier Cash nach Buffer",
                    "Minimaler belastbarer Kontostand minus Sicherheitsreserve aus 2 Monaten Fixkosten.",
                  )}
                  value={freeCashAfterBuffer != null ? formatCurrency(freeCashAfterBuffer) : "—"}
                />
                <Text type="secondary">Buffer (2M Fixkosten): {formatCurrency(bufferFloor)}</Text>
              </Card>

              <Card className="v2-dashboard-signal-card">
                <div className="v2-dashboard-forecast-status-head">
                  <Text strong>
                    Forecast Freshness
                    <Tooltip title="Ampel nach Importalter: Grün <=35 Tage, Gelb 36-45 Tage, Rot >45 Tage.">
                      <InfoCircleOutlined className="v2-dashboard-inline-info" />
                    </Tooltip>
                  </Text>
                  <Tag color={
                    forecastFreshnessStatus === "fresh"
                      ? "green"
                      : forecastFreshnessStatus === "aging"
                        ? "gold"
                        : forecastFreshnessStatus === "stale"
                          ? "red"
                          : "default"
                  }>
                    {forecastFreshnessStatus === "fresh"
                      ? "Grün"
                      : forecastFreshnessStatus === "aging"
                        ? "Gelb"
                        : forecastFreshnessStatus === "stale"
                          ? "Rot"
                          : "Keine Daten"}
                  </Tag>
                </div>
                <div className="v2-dashboard-forecast-status-meta">
                  <div>Baseline Forecast: {activeForecastLabel}</div>
                  <div>{forecastFreshnessLabel}</div>
                  <div>Letzter Import: {formatIsoDate(lastImportAt)}</div>
                  <div>Nächster Import empfohlen: {nextRecommendedImport ? nextRecommendedImport.toLocaleDateString("de-DE") : "—"}</div>
                  {openForecastFoConflicts > 0 ? (
                    <div>
                      <Button size="small" onClick={() => navigate("/v2/forecast?panel=conflicts")}>
                        Forecast-Änderung: {openForecastFoConflicts} FOs prüfen
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "cashflow",
          label: "Kontostand & Cashflow",
          children: (
            <Card className="v2-dashboard-chart-card">
              <Title level={4}>Kontostand & Cashflow</Title>
              <Space wrap>
                <Tag color="green">Einzahlungen: {formatCurrency(totalInflow)}</Tag>
                <Tag color="red">Auszahlungen: {formatCurrency(totalOutflow)}</Tag>
                <Tag color={totalNet >= 0 ? "green" : "red"}>Netto: {formatCurrency(totalNet)}</Tag>
                {phantomFoSuggestions.length ? (
                  <Tag color="gold">Phantom-FOs (vorbehaltlich): {phantomFoSuggestions.length}</Tag>
                ) : null}
                {resolvedPhantomTargetMonth ? <Tag color="gold">PFO bis: {formatMonthLabel(resolvedPhantomTargetMonth)}</Tag> : null}
                <Tag color={(simulationDraft ? "gold" : "default")}>Simulation: {simulationDraft ? "aktiv" : "aus"}</Tag>
              </Space>
              <div className="v2-dashboard-legend-help">
                <Tooltip title="Durchgezogene Linie: belastbarer Kontostand (alle Hard-Checks bestanden).">
                  <Tag className="v2-dashboard-legend-tag">Linie solid = belastbar</Tag>
                </Tooltip>
                <Tooltip title="Gestrichelte Linie: orientierend, weil mindestens ein Hard-Check fehlt.">
                  <Tag className="v2-dashboard-legend-tag">Linie gestrichelt = orientierend</Tag>
                </Tooltip>
                <Tooltip title="Rot markiert: Kontostand liegt unter 0 im jeweiligen Zustand.">
                  <Tag className="v2-dashboard-legend-tag">Rot = unter 0</Tag>
                </Tooltip>
              </div>
              <ReactECharts style={{ height: 380 }} option={chartOption} />
            </Card>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "actions",
          label: "Action Center & Forecast Ops",
          children: (
            <Row gutter={[12, 12]}>
              <Col xs={24} xl={14}>
                <Card>
                  <Title level={4}>Action Center</Title>
                  <Paragraph type="secondary">
                    Priorisierte Maßnahmen, damit der Kontostand wieder belastbar wird.
                  </Paragraph>
                  {!robustness.actions.length ? (
                    <Alert type="success" showIcon message="Keine offenen Hard-Blocker im gewählten Zeitraum." />
                  ) : (
                    <div className="v2-dashboard-actions">
                      {robustness.actions.map((action) => (
                        <div key={action.id} className={`v2-dashboard-action-card is-${action.severity}`}>
                          <div>
                            <Text strong>{action.title}</Text>
                            <div className="v2-dashboard-action-detail">{action.detail}</div>
                            <div className="v2-dashboard-action-impact">Impact: {action.impact}</div>
                          </div>
                          <div className="v2-dashboard-action-meta">
                            <Tag color={action.severity === "error" ? "red" : "gold"}>{action.count}</Tag>
                            <Button
                              size="small"
                              onClick={() => navigate(resolveDashboardRoute({
                                route: action.route,
                                actionId: action.id,
                                month: actionFocusMonth,
                                mode: actionFocusMonth ? (robustness.monthMap.get(actionFocusMonth)?.coverage.projectionMode || null) : null,
                              }))}
                            >
                              Öffnen
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={10}>
                <Card>
                  <Title level={4}>Forecast Ops</Title>
                  <Paragraph type="secondary">
                    Monatlicher Import mit Drift-Alarm (A/B Fokus, Profil: {driftSummary.thresholdProfile}).
                  </Paragraph>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Tag color={driftReviewedForCurrent ? "green" : "gold"}>
                      Drift-Review: {driftReviewedForCurrent ? "geprüft" : "offen"}
                    </Tag>
                    {driftReviewedAt ? (
                      <Tag>Geprüft am: {new Date(driftReviewedAt).toLocaleDateString("de-DE")}</Tag>
                    ) : null}
                    <Button
                      size="small"
                      onClick={() => { void markDriftReviewed(); }}
                      disabled={!driftSummary.comparedAt || driftReviewedForCurrent || saving}
                    >
                      Drift geprüft
                    </Button>
                  </Space>
                  <div className="v2-dashboard-forecast-ops">
                    <div>Flagged SKUs: <strong>{formatNumber(driftSummary.flaggedSkuCount, 0)}</strong></div>
                    <div>Flagged A/B: <strong>{formatNumber(driftSummary.flaggedABCount, 0)}</strong></div>
                    <div>Flagged SKU-Monate: <strong>{formatNumber(driftSummary.flaggedMonthCount, 0)}</strong></div>
                    <div>Verglichen am: <strong>{formatIsoDate(driftSummary.comparedAt)}</strong></div>
                  </div>
                  {driftSummary.topItems.length ? (
                    <div className="v2-dashboard-drift-list">
                      {driftSummary.topItems.slice(0, 5).map((item, index) => (
                        <div key={`${item.sku}-${item.month}-${index}`} className="v2-dashboard-drift-item">
                          <div>
                            <Text strong>{item.sku}</Text>
                            <Text type="secondary"> · {formatMonthLabel(item.month)} · {item.abcClass}</Text>
                          </div>
                          <div>
                            ΔUnits {formatNumber(item.deltaUnits, 0)} · ΔUmsatz {formatCurrency(item.deltaRevenue)} · Δ% {formatPercent(item.deltaPct)}
                          </div>
                        </div>
                      ))}
                      <Button size="small" onClick={() => navigate("/v2/forecast")}>Zur Forecast-Prüfung</Button>
                    </div>
                  ) : (
                    <Alert type="success" showIcon message="Keine kritischen Drift-Abweichungen im letzten Vergleich." />
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={24}>
                <Card>
                  <Title level={4}>PO Wareneingang bestätigen</Title>
                  <Paragraph type="secondary">
                    Sichtbar sind POs mit ETA im aktuellen Monat sowie überfällige ETA ohne bestätigten Wareneingang.
                  </Paragraph>
                  {!poArrivalTasks.length ? (
                    <Alert type="success" showIcon message="Keine offenen PO-Wareneingänge für den aktuellen Scope." />
                  ) : (
                    <div className="v2-table-shell v2-scroll-host">
                      <table className="v2-stats-table" data-layout="auto">
                        <thead>
                          <tr>
                            <th>PO</th>
                            <th>Supplier</th>
                            <th>Alias</th>
                            <th>Stückzahl</th>
                            <th>ETA</th>
                            <th>Status</th>
                            <th>Aktionen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poArrivalTasks.map((task) => {
                            const draftDate = poArrivalDrafts[task.id] || task.arrivalDate || todayIso;
                            const dateInputValid = /^\d{4}-\d{2}-\d{2}$/.test(draftDate);
                            return (
                              <tr key={task.id}>
                                <td>{task.poNumber || "PO"}</td>
                                <td>{task.supplier || "-"}</td>
                                <td>{task.skuAliases || "-"}</td>
                                <td>{formatNumber(task.units, 0)}</td>
                                <td>{formatIsoDate(task.etaDate)}</td>
                                <td>
                                  {task.arrivalDate ? (
                                    <Tag color="green">Angekommen am {formatIsoDate(task.arrivalDate)}</Tag>
                                  ) : task.isOverdue ? (
                                    <Tag color="red">Überfällig</Tag>
                                  ) : (
                                    <Tag color="gold">Offen</Tag>
                                  )}
                                </td>
                                <td>
                                  <Space wrap>
                                    <Button
                                      size="small"
                                      onClick={() => { void savePoArrivalDate(task.id, todayIso, "v2:dashboard:po-arrival-today"); }}
                                      disabled={saving}
                                    >
                                      Heute
                                    </Button>
                                    <Input
                                      type="date"
                                      value={draftDate}
                                      onChange={(event) => {
                                        const nextDate = event.target.value || "";
                                        setPoArrivalDrafts((current) => ({
                                          ...current,
                                          [task.id]: nextDate,
                                        }));
                                      }}
                                      style={{ width: 160 }}
                                    />
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        if (!dateInputValid) return;
                                        void savePoArrivalDate(task.id, draftDate, "v2:dashboard:po-arrival-date");
                                      }}
                                      disabled={saving || !dateInputValid || draftDate === task.arrivalDate}
                                    >
                                      Datum setzen
                                    </Button>
                                    {task.arrivalDate ? (
                                      <Button
                                        size="small"
                                        danger
                                        onClick={() => { void savePoArrivalDate(task.id, null, "v2:dashboard:po-arrival-clear"); }}
                                        disabled={saving}
                                      >
                                        Zurücksetzen
                                      </Button>
                                    ) : null}
                                  </Space>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </Col>
            </Row>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "robustness",
          label: "Robustheits-Matrix",
          children: (
            <Card>
              <Title level={4}>Robustheits-Matrix</Title>
              <Paragraph type="secondary">
                Ein Monat wird nur dann grün, wenn Bestands-Check und Look-Ahead-Bestellpflicht passen. Die Stufen folgen den Schwellen:
                Vollständig 100 %, Weitgehend ≥95 % ohne A/B-Blocker, Teilweise ≥80 %, sonst Unzureichend.
              </Paragraph>

              <div className="v2-dashboard-robust-legend">
                {(["full", "wide", "partial", "insufficient"] as CoverageStatusKey[]).map((statusKey) => {
                  const meta = coverageStatusMeta(statusKey);
                  return (
                    <div key={statusKey} className="v2-dashboard-robust-legend-item">
                      <span className={`v2-dashboard-robust-dot ${meta.className}`} />
                      <Text>{meta.label}</Text>
                    </div>
                  );
                })}
              </div>

              <div className="v2-dashboard-robust-grid">
                {robustness.months.map((month) => {
                  const monthIdx = monthIndex(month.month);
                  const isPast = monthIdx != null && currentMonthIdx != null && monthIdx < currentMonthIdx;
                  const statusMeta = coverageStatusMeta(month.coverage.statusKey);
                  return (
                    <button
                      key={month.month}
                      type="button"
                      className={[
                        "v2-dashboard-robust-item",
                        selectedMonth === month.month ? "is-selected" : "",
                        statusMeta.className,
                        isPast ? "is-past" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setSelectedMonth(month.month)}
                    >
                      <div className="v2-dashboard-robust-item-head">
                        <span>{formatMonthLabel(month.month)}</span>
                        <Space size={6}>
                          <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                          {isPast ? <Tag>Vergangen</Tag> : null}
                        </Space>
                      </div>
                      <div className="v2-dashboard-robust-item-meta">
                        Coverage: {formatPercent(month.coverage.ratio * 100)} ({month.coverage.coveredSkus}/{month.coverage.activeSkus})
                      </div>
                      <div className="v2-dashboard-robust-item-meta">
                        Blocker SKUs: {month.coverage.blockerCount} (A/B {month.coverage.blockerAbCount} · C {month.coverage.blockerCCount})
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedMonthData ? (
                <div className="v2-dashboard-robust-detail">
                  <div className="v2-dashboard-robust-detail-head">
                    <Text strong>{formatMonthLabel(selectedMonthData.month)}</Text>
                    <Space wrap>
                      {coverageStatusTag(selectedMonthData.coverage.statusKey)}
                      <Tag>Coverage: {formatPercent(selectedMonthData.coverage.ratio * 100)}</Tag>
                      <Tag>Blocker: {selectedMonthData.coverage.blockerCount}</Tag>
                      <Tag>A/B: {selectedMonthData.coverage.blockerAbCount} · C: {selectedMonthData.coverage.blockerCCount}</Tag>
                      {selectedMonthData.coverage.overdueOrderDutySkuCount > 0 ? (
                        <Tag color="red">Überfällig: {selectedMonthData.coverage.overdueOrderDutySkuCount}</Tag>
                      ) : null}
                    </Space>
                  </div>

                  <div className="v2-dashboard-robust-checklist">
                    {selectedChecklist.map((entry) => (
                      <div key={entry.key} className={`v2-dashboard-robust-checklist-item ${entry.passed ? "is-pass" : "is-fail"}`}>
                        <span className="v2-dashboard-robust-check-icon">{entry.passed ? "✅" : "❌"}</span>
                        <div>
                          <Text strong>{entry.label}</Text>
                          <div><Text type="secondary">{entry.description}</Text></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Table
                    size="small"
                    pagination={false}
                    rowKey="key"
                    columns={checkColumns}
                    dataSource={selectedMonthData.checks}
                  />

                  <div className="v2-dashboard-blockers">
                    <Text strong>Bestands-Probleme in {formatMonthLabel(selectedMonthData.month)}</Text>
                    {!selectedStockIssues.length ? (
                      <Text type="secondary">Keine Bestandsprobleme in diesem Monat.</Text>
                    ) : (
                      <div className="v2-table-shell v2-scroll-host">
                        <table className="v2-stats-table" data-layout="auto">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Alias</th>
                              <th>ABC</th>
                              <th>Problem</th>
                              <th>Aktionen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedStockIssues.map((issue) => (
                              <tr key={`${issue.sku}:${issue.issueType}`}>
                                <td>{issue.sku}</td>
                                <td>{issue.alias}</td>
                                <td>{issue.abcClass}</td>
                                <td>{stockIssueLabel(issue)}</td>
                                <td>
                                  <Space wrap>
                                    <Button
                                      size="small"
                                      onClick={() => navigate(resolveDashboardRoute({
                                        route: "/v2/inventory/projektion",
                                        checkKey: "sku_coverage",
                                        month: selectedMonthData.month,
                                        sku: issue.sku,
                                        mode: selectedMonthData.coverage.projectionMode,
                                      }))}
                                    >
                                      Zur Bestandsprojektion
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => navigate(buildProductsDashboardRoute({
                                        issues: "all",
                                        sku: issue.sku,
                                      }))}
                                    >
                                      Produkt öffnen
                                    </Button>
                                    {issue.issueType === "forecast_missing" ? (
                                      <Button
                                        size="small"
                                        onClick={() => navigate(buildForecastDashboardRoute({
                                          sku: issue.sku,
                                          month: selectedMonthData.month,
                                        }))}
                                      >
                                        Absatzprognose öffnen
                                      </Button>
                                    ) : null}
                                  </Space>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="v2-dashboard-blockers">
                    <Text strong>Bestellpflicht in {formatMonthLabel(selectedMonthData.month)}</Text>
                    {!selectedOrderDutyIssues.length ? (
                      <Text type="secondary">Keine fällige Bestellpflicht in diesem Monat.</Text>
                    ) : (
                      <div className="v2-table-shell v2-scroll-host">
                        <table className="v2-stats-table" data-layout="auto">
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Alias</th>
                              <th>ABC</th>
                              <th>Erster Risikomonat</th>
                              <th>Spätester Bestellzeitpunkt</th>
                              <th>Warum Blocker</th>
                              <th>Aktionen</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedOrderDutyIssues.map((issue: RobustnessCoverageOrderDutyIssue) => {
                              const skuKey = String(issue.sku || "").trim().toLowerCase();
                              const issueKey = `${skuKey}|${String(issue.firstRiskMonth || "").trim()}|${String(issue.orderMonth || "").trim()}`;
                              const phantomSuggestion = phantomFoByIssueKey.get(issueKey) || phantomFoBySkuKey.get(skuKey) || null;
                              return (
                                <tr key={`${issue.sku}:${issue.firstRiskMonth}:${issue.orderMonth}`}>
                                  <td>{issue.sku}</td>
                                  <td>{issue.alias}</td>
                                  <td>{issue.abcClass}</td>
                                  <td>{formatMonthLabel(issue.firstRiskMonth)}</td>
                                  <td>
                                    {formatIsoDate(issue.latestOrderDate)} ({formatMonthLabel(issue.orderMonth)})
                                    {issue.overdue ? <Tag color="red" style={{ marginInlineStart: 8 }}>Überfällig</Tag> : null}
                                  </td>
                                  <td>{issue.reason}</td>
                                  <td>
                                    <Space wrap>
                                      <Button
                                        size="small"
                                        onClick={() => navigate(resolveDashboardRoute({
                                          route: "/v2/inventory/projektion",
                                          checkKey: "sku_coverage",
                                          month: selectedMonthData.month,
                                          sku: issue.sku,
                                          mode: selectedMonthData.coverage.projectionMode,
                                        }))}
                                      >
                                        Zur Bestandsprojektion
                                      </Button>
                                      <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => navigate(buildFoDashboardRoute({
                                          sku: issue.sku,
                                          month: selectedMonthData.month,
                                          suggestedUnits: phantomSuggestion?.suggestedUnits ?? issue.shortageUnits,
                                          requiredArrivalDate: phantomSuggestion?.requiredArrivalDate ?? issue.requiredArrivalDate,
                                          recommendedOrderDate: phantomSuggestion?.recommendedOrderDate ?? issue.recommendedOrderDate,
                                          source: phantomSuggestion ? "phantom_fo" : "inventory_projection",
                                          phantomId: phantomSuggestion?.id || null,
                                          firstRiskMonth: phantomSuggestion?.firstRiskMonth ?? issue.firstRiskMonth,
                                          orderMonth: phantomSuggestion?.orderMonth ?? issue.orderMonth,
                                          leadTimeDays: phantomSuggestion?.leadTimeDays ?? issue.leadTimeDays,
                                          returnTo: "/v2/dashboard",
                                        }))}
                                      >
                                        FO anlegen
                                      </Button>
                                      <Button
                                        size="small"
                                        onClick={() => navigate(buildPoDashboardRoute({
                                          sku: issue.sku,
                                          suggestedUnits: issue.shortageUnits,
                                          requiredArrivalDate: issue.requiredArrivalDate,
                                          recommendedOrderDate: issue.recommendedOrderDate,
                                        }))}
                                      >
                                        PO öffnen
                                      </Button>
                                      <Button
                                        size="small"
                                        onClick={() => navigate(buildProductsDashboardRoute({
                                          issues: "all",
                                          sku: issue.sku,
                                        }))}
                                      >
                                        Produkt öffnen
                                      </Button>
                                    </Space>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="v2-dashboard-blockers">
                    <Text strong>Weitere Hard-Checks</Text>
                    {!selectedAdditionalBlockers.length ? (
                      <Text type="secondary">Keine weiteren Hard-Check-Blocker.</Text>
                    ) : (
                      <div className="v2-dashboard-blocker-list">
                        {selectedAdditionalBlockers.map((blocker) => (
                          <div key={blocker.id} className="v2-dashboard-blocker-item">
                            <div>
                              <Text>{blocker.message}</Text>
                              {blocker.sku ? <Text type="secondary"> · {blocker.sku}</Text> : null}
                            </div>
                            <Button
                              size="small"
                              onClick={() => navigate(resolveDashboardRoute({
                                route: blocker.route,
                                checkKey: blocker.checkKey,
                                month: blocker.month,
                                sku: blocker.sku || null,
                                mode: selectedMonthData.coverage.projectionMode,
                              }))}
                            >
                              Öffnen
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </Card>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "simulation",
          label: "Payout Planner (Simulation)",
          children: (
            <Card>
              <Title level={4}>Payout Planner (Simulation)</Title>
              <Paragraph type="secondary">
                Einmalige Dividenden oder CAPEX simulieren und optional als echten Eintrag übernehmen.
              </Paragraph>

              <div className="v2-dashboard-sim-grid">
                <div className="v2-dashboard-sim-field">
                  <Text>Typ</Text>
                  <Select
                    value={simType}
                    onChange={(value) => setSimType(value)}
                    options={[
                      { value: "dividend", label: "Dividende" },
                      { value: "capex", label: "CAPEX" },
                    ]}
                  />
                </div>

                <div className="v2-dashboard-sim-field">
                  <Text>Monat</Text>
                  <Select
                    value={simMonth}
                    onChange={(value) => setSimMonth(value)}
                    options={visibleMonths.map((month) => ({ value: month, label: formatMonthLabel(month) }))}
                  />
                </div>

                <div className="v2-dashboard-sim-field">
                  <Text>Betrag (EUR)</Text>
                  <InputNumber
                    value={Number.isFinite(simAmount as number) ? simAmount : null}
                    onChange={(value) => setSimAmount(typeof value === "number" ? value : null)}
                    min={0}
                    controls={false}
                    placeholder="0"
                  />
                </div>

                <div className="v2-dashboard-sim-field">
                  <Text>Label</Text>
                  <Input
                    value={simLabel}
                    onChange={(event) => setSimLabel(event.target.value)}
                    placeholder={simulationDefaultLabel(simType)}
                  />
                </div>
              </div>

              <div className="v2-dashboard-sim-status">
                <Tag color={simulationDraft ? "gold" : "default"}>{simulationDraft ? "Simulation aktiv" : "Keine Simulation"}</Tag>
                <Tag color={bufferFloor > 0 ? "blue" : "red"}>Buffer-Ziel: {formatCurrency(bufferFloor)}</Tag>
                {simulationDraft && bufferFloor <= 0 ? <Tag color="red">Fixkostenbasis fehlt</Tag> : null}
                {simulationDraft && bufferFloor > 0 ? (
                  <Tag color={simulationSafe ? "green" : "red"}>
                    {simulationSafe ? "Sicher" : `Kritisch ab ${simulationBreachMonth ? formatMonthLabel(simulationBreachMonth) : "sofort"}`}
                  </Tag>
                ) : null}
              </div>

              <Space>
                <Button onClick={() => { setSimAmount(null); setSimLabel(""); }}>Simulation zurücksetzen</Button>
                <Button
                  type="primary"
                  onClick={() => { void commitSimulation(); }}
                  disabled={!simulationDraft}
                  loading={saving}
                >
                  Als echten Eintrag übernehmen
                </Button>
              </Space>
            </Card>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "pnl",
          label: "Monatliche PnL (Drilldown)",
          children: (
            <Card>
              <Title level={4}>Monatliche PnL (Drilldown)</Title>
              <Paragraph type="secondary">
                Einzahlungen, PO/FO-Zahlungen, Fixkosten und Steuern je Monat. PO/FO-Positionen sind bis auf Milestone-Ebene aufklappbar.
              </Paragraph>
              <Collapse
                className="v2-dashboard-pnl-collapse"
                activeKey={openPnlMonths}
                onChange={(keys) => setOpenPnlMonths(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                items={pnlItems}
              />
            </Card>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "actuals",
          label: "Plan/Ist Drilldown",
          children: (
            <Card>
              <Title level={4}>Plan/Ist Drilldown</Title>
              <Paragraph type="secondary">
                Monatsvergleich zwischen geplantem und erfasstem Istwert aus den Monats-Ist-Daten.
              </Paragraph>
              <TanStackGrid
                data={visibleActualComparisons}
                columns={actualColumns}
                minTableWidth={980}
                tableLayout="auto"
              />
            </Card>
          ),
        }]}
      />

      <Collapse
        className="v2-dashboard-module-collapse"
        activeKey={openSections}
        onChange={handleDashboardSectionsChange}
        items={[{
          key: "kpis",
          label: "KPI-Übersicht",
          children: (
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12} xl={6}>
                <Card>
                  <Statistic title="Opening Balance" value={Number(report.kpis?.opening || 0)} formatter={(value) => formatCurrency(value)} />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Card>
                  <Statistic title="Sales Payout Ø" value={Number(report.kpis?.salesPayoutAvg || 0)} formatter={(value) => formatCurrency(value)} />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Card>
                  <Statistic title="Robuste Monate" value={`${robustness.robustMonthsCount}/${robustness.totalMonths}`} />
                </Card>
              </Col>
              <Col xs={24} md={12} xl={6}>
                <Card>
                  <Statistic title="Letzter Kontostand" value={Number(latestSimulatedBreakdown?.closing || 0)} formatter={(value) => formatCurrency(value)} />
                </Card>
              </Col>
            </Row>
          ),
        }]}
      />
    </div>
  );
}

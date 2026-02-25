import { InfoCircleOutlined, LockFilled } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
import {
  type DashboardBreakdownRow,
  type DashboardEntry,
} from "../../domain/dashboardMaturity";
import { buildHybridClosingBalanceSeries } from "../../domain/closingBalanceSeries";
import { buildCashInPayoutMirrorByMonth } from "../../domain/cashInPayoutMirror";
import {
  buildDashboardRobustness,
  type CoverageStatusKey,
  type DashboardRobustMonth,
} from "../../domain/dashboardRobustness";
import {
  buildPhantomFoSuggestions,
  buildStateWithPhantomFos,
  resolvePlanningMonthsFromState,
  type PhantomFoSuggestion,
} from "../../domain/phantomFo";
import { ensureForecastVersioningContainers } from "../../domain/forecastVersioning";
import { currentMonthKey, formatMonthLabel, monthIndex } from "../../domain/months";
import { PORTFOLIO_BUCKET, PORTFOLIO_BUCKET_VALUES } from "../../../domain/portfolioBuckets.js";
import { useWorkspaceState } from "../../state/workspace";
import { useNavigate } from "react-router-dom";
import { v2ChartPalette, v2DashboardChartColors } from "../../app/chartPalette";

const { Paragraph, Text, Title } = Typography;

type DashboardRange = "next6" | "next12" | "next18" | "all";

type RevenueBasisMode = "hybrid" | "forecast_direct";
type CashInQuoteMode = "manual" | "recommendation";
type InventoryRiskFilterParam = "all" | "oos" | "under_safety";
type InventoryAbcFilterParam = "all" | "a" | "b" | "ab" | "abc";
type ProductIssueFilterParam = "all" | "needs_fix" | "revenue" | "blocked";
type RobustMonthBlocker = DashboardRobustMonth["blockers"][number];

interface DashboardSeriesRow {
  month: string;
  inflow: { total: number; paid: number; open: number };
  outflow: { total: number; paid: number; open: number };
  net: { total: number; paid: number; open: number };
}

interface SeriesResult {
  months: string[];
  series: DashboardSeriesRow[];
  breakdown: DashboardBreakdownRow[];
  kpis: {
    opening?: number;
    salesPayoutAvg?: number;
    firstNegativeMonth?: string | null;
    cashIn?: {
      mode?: "basis" | "conservative" | string;
      basisMethod?: string;
      basisQuotePct?: number;
      istMonthsCount?: number;
      hasIstData?: boolean;
      fallbackUsed?: string;
      recommendationBaselineNormalPct?: number;
      recommendationBaselineQ4Pct?: number;
      recommendationBaselineQ4SuggestedPct?: number;
      recommendationObservedNormalMedianPct?: number;
      recommendationObservedNormalAveragePct?: number;
      recommendationObservedNormalSampleCount?: number;
      recommendationObservedNormalWithForecastMedianPct?: number;
      recommendationObservedNormalWithForecastAveragePct?: number;
      recommendationObservedNormalWithForecastSampleCount?: number;
      recommendationCurrentMonthForecastQuotePct?: number;
      recommendationCurrentMonth?: string;
      calibrationEnabled?: boolean;
      calibrationApplied?: boolean;
      calibrationHorizonMonths?: number;
      calibrationCandidateCount?: number;
      calibrationLatestCandidateMonth?: string | null;
      calibrationLatestRawFactor?: number | null;
      calibrationNonDefaultFactorMonthCount?: number;
      calibrationReasonCounts?: Record<string, number>;
    };
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

interface PnlMatrixRow {
  key: string;
  label: string;
  values: Record<string, number>;
  rowType?: "group" | "category" | "order" | "payment" | "total";
  orderType?: "po" | "fo" | "phantom";
  aliases?: string[];
  units?: number | null;
  paymentMix?: { paid: number; open: number; unknown: number };
  paymentStatus?: "paid" | "open" | "mixed" | "unknown";
  paymentDueDate?: string | null;
  children?: PnlMatrixRow[];
}

interface ScopedDashboardBreakdownRow extends DashboardBreakdownRow {
  hasActualClosing: boolean;
}

const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6 Monate", count: 6 },
  { value: "next12", label: "Nächste 12 Monate", count: 12 },
  { value: "next18", label: "Nächste 18 Monate", count: 18 },
  { value: "all", label: "Alle Monate", count: null },
];

const DASHBOARD_BUCKET_OPTIONS = [
  { value: PORTFOLIO_BUCKET.CORE, label: "Kernportfolio" },
  { value: PORTFOLIO_BUCKET.PLAN, label: "Planprodukte" },
  { value: PORTFOLIO_BUCKET.IDEAS, label: "Ideenprodukte" },
];
const DEFAULT_BUCKET_SCOPE = [PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN];

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

function normalizeCashInQuoteMode(value: unknown): CashInQuoteMode {
  return String(value || "").trim().toLowerCase() === "recommendation"
    ? "recommendation"
    : "manual";
}

function formatCurrency(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
  return `${number.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} %`;
}

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

function coverageStatusMeta(statusKey: CoverageStatusKey): {
  label: string;
  color: string;
  className: string;
} {
  return COVERAGE_STATUS_UI_META[statusKey] || COVERAGE_STATUS_UI_META.insufficient;
}

function criteriaStateSymbol(state: "ok" | "warn" | "fail"): string {
  if (state === "ok") return "✅";
  if (state === "warn") return "⚠️";
  return "❌";
}

function applyDashboardCalculationOverrides(
  sourceState: Record<string, unknown>,
  options: {
    quoteMode: CashInQuoteMode;
    revenueBasisMode: RevenueBasisMode;
    calibrationEnabled: boolean;
  },
): Record<string, unknown> {
  const next = structuredClone(sourceState || {});
  if (!next.settings || typeof next.settings !== "object") {
    next.settings = {};
  }
  const settings = next.settings as Record<string, unknown>;

  // Keep all other Cash-in settings unchanged so Dashboard uses the same basis as Cash-in tab.
  settings.cashInQuoteMode = options.quoteMode;
  settings.cashInCalibrationEnabled = options.calibrationEnabled;
  settings.cashInRevenueBasisMode = options.revenueBasisMode;
  return next;
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

function resolveDashboardRoute(input: {
  route: string;
  actionId?: string;
  checkKey?: string;
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

function resolveEntryBucket(entry: DashboardEntry): string | null {
  const direct = typeof entry.portfolioBucket === "string" ? entry.portfolioBucket : null;
  if (direct) return direct;
  const meta = (entry.meta && typeof entry.meta === "object") ? entry.meta as Record<string, unknown> : {};
  return typeof meta.portfolioBucket === "string" ? String(meta.portfolioBucket) : null;
}

function isEntryInBucketScope(entry: DashboardEntry, bucketScope: Set<string>): boolean {
  const bucket = resolveEntryBucket(entry);
  if (!bucket) return true;
  if (!PORTFOLIO_BUCKET_VALUES.includes(bucket)) return true;
  return bucketScope.has(bucket);
}

function applyBucketScopeToBreakdown(
  rows: DashboardBreakdownRow[],
  bucketScope: Set<string>,
): ScopedDashboardBreakdownRow[] {
  if (!rows.length) return [];
  const scopedRows = rows.map((row) => {
    const scopedEntries = (Array.isArray(row.entries) ? row.entries : [])
      .filter((entry) => isEntryInBucketScope(entry, bucketScope));
    const inflow = scopedEntries
      .filter((entry) => String(entry.direction || "").toLowerCase() === "in")
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
    const outflow = scopedEntries
      .filter((entry) => String(entry.direction || "").toLowerCase() === "out")
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
    const net = inflow - outflow;
    return {
      ...row,
      inflow,
      outflow,
      net,
      entries: scopedEntries,
    };
  });

  const firstOpening = Number(rows[0]?.opening || 0);
  const closingSeries = buildHybridClosingBalanceSeries({
    rows: scopedRows.map((row) => ({
      month: row.month,
      net: row.net,
      actualClosing: row.actualClosing,
    })),
    initialOpening: firstOpening,
  });

  return scopedRows.map((row, index) => {
    const derived = closingSeries[index];
    return {
      ...row,
      opening: Number(derived?.opening ?? row.opening ?? 0),
      closing: Number(derived?.closing ?? row.closing ?? 0),
      hasActualClosing: derived?.lockedActual === true,
    };
  });
}

function splitOutflowEntriesByType(
  entries: DashboardEntry[],
  provisionalFoIds?: Set<string>,
  bucketScope?: Set<string>,
): {
  fixcost: number;
  po: number;
  fo: number;
  phantomFo: number;
  other: number;
  total: number;
} {
  const totals = {
    fixcost: 0,
    po: 0,
    fo: 0,
    phantomFo: 0,
    other: 0,
    total: 0,
  };

  entries.forEach((entryRaw) => {
    if (!entryRaw || typeof entryRaw !== "object") return;
    const entry = entryRaw as DashboardEntry;
    if (bucketScope && !isEntryInBucketScope(entry, bucketScope)) return;
    if (String(entry.direction || "").toLowerCase() !== "out") return;
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) return;
    totals.total += amount;

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
      return;
    }
    totals.other += amount;
  });

  return totals;
}

function splitInflowEntriesByType(
  entries: DashboardEntry[],
  bucketScope?: Set<string>,
  cashInPayoutEur?: number | null,
): {
  amazon: number;
  amazonCore: number;
  amazonPlanned: number;
  amazonNew: number;
  other: number;
  total: number;
} {
  const totals = {
    amazon: 0,
    amazonCore: 0,
    amazonPlanned: 0,
    amazonNew: 0,
    other: 0,
    total: 0,
  };

  entries.forEach((entryRaw) => {
    if (!entryRaw || typeof entryRaw !== "object") return;
    const entry = entryRaw as DashboardEntry;
    if (bucketScope && !isEntryInBucketScope(entry, bucketScope)) return;
    if (String(entry.direction || "").toLowerCase() !== "in") return;
    const amount = Math.abs(Number(entry.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) return;

    const source = String(entry.source || "").toLowerCase();
    const kind = String(entry.kind || "").toLowerCase();
    const isAmazon = source === "sales" || source === "sales-plan" || kind === "sales-payout";
    if (isAmazon) {
      // Amazon inflow is taken 1:1 from Cash-in (Einzahlungen EUR), not recomputed in Dashboard.
      return;
    } else {
      totals.other += amount;
    }
    totals.total += amount;
  });

  const cashInPayout = Number(cashInPayoutEur);
  totals.amazon = Number.isFinite(cashInPayout) ? Math.max(0, cashInPayout) : 0;
  totals.amazonCore = totals.amazon;
  totals.amazonPlanned = 0;
  totals.amazonNew = 0;
  totals.total = totals.amazon + totals.other;

  return totals;
}

function createMonthValueRecord(months: string[]): Record<string, number> {
  const values: Record<string, number> = {};
  months.forEach((month) => {
    values[month] = 0;
  });
  return values;
}

function sumAbsoluteMonthValues(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + Math.abs(Number(value || 0)), 0);
}

function resolvePaymentStatus(input: { paid: number; open: number; unknown: number }): "paid" | "open" | "mixed" | "unknown" {
  const paid = Number(input.paid || 0);
  const open = Number(input.open || 0);
  const unknown = Number(input.unknown || 0);
  if (paid > 0 && open <= 0 && unknown <= 0) return "paid";
  if (open > 0 && paid <= 0 && unknown <= 0) return "open";
  if (unknown > 0 && paid <= 0 && open <= 0) return "unknown";
  return "mixed";
}

function collectExpandableRowKeys(rows: PnlMatrixRow[]): string[] {
  const keys: string[] = [];
  const walk = (items: PnlMatrixRow[]): void => {
    items.forEach((row) => {
      if (!Array.isArray(row.children) || row.children.length === 0) return;
      keys.push(row.key);
      walk(row.children);
    });
  };
  walk(rows);
  return keys;
}

function buildOrderMetaIndex(state: Record<string, unknown>): Map<string, { aliases: string[]; units: number | null }> {
  const aliasBySku = new Map<string, string>();
  const products = Array.isArray(state.products) ? state.products as Record<string, unknown>[] : [];
  products.forEach((product) => {
    const sku = String(product.sku || "").trim();
    if (!sku) return;
    const alias = String(product.alias || "").trim() || sku;
    aliasBySku.set(sku, alias);
  });

  const index = new Map<string, { aliases: string[]; units: number | null }>();

  const collect = (source: "po" | "fo", orderRaw: Record<string, unknown>): void => {
    const refs = (
      source === "po"
        ? [orderRaw.poNo, orderRaw.id]
        : [orderRaw.foNo, orderRaw.foNumber, orderRaw.id]
    )
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    if (!refs.length) return;

    const items = Array.isArray(orderRaw.items) && orderRaw.items.length
      ? orderRaw.items as Record<string, unknown>[]
      : [{ sku: orderRaw.sku, units: orderRaw.units }] as Record<string, unknown>[];

    const aliases = new Set<string>();
    let unitsTotal = 0;
    items.forEach((item) => {
      const sku = String(item.sku || "").trim();
      if (!sku) return;
      aliases.add(aliasBySku.get(sku) || sku);
      const units = Number(item.units ?? item.qty ?? item.quantity ?? 0);
      if (Number.isFinite(units)) unitsTotal += units;
    });

    const meta = {
      aliases: Array.from(aliases),
      units: Number.isFinite(unitsTotal) ? unitsTotal : null,
    };
    Array.from(new Set(refs)).forEach((ref) => {
      index.set(`${source}:${ref}`, meta);
    });
  };

  (Array.isArray(state.pos) ? state.pos as Record<string, unknown>[] : []).forEach((order) => collect("po", order));
  (Array.isArray(state.fos) ? state.fos as Record<string, unknown>[] : []).forEach((order) => collect("fo", order));

  return index;
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

export default function DashboardModule(): JSX.Element {
  const { state, loading, error, saveWith } = useWorkspaceState();
  const navigate = useNavigate();
  const [range, setRange] = useState<DashboardRange>("next6");
  const [bucketScopeValues, setBucketScopeValues] = useState<string[]>(() => DEFAULT_BUCKET_SCOPE.slice());
  const [phantomTargetMonth, setPhantomTargetMonth] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [monthDetailOpen, setMonthDetailOpen] = useState(false);
  const [expandedPnlRowKeys, setExpandedPnlRowKeys] = useState<string[]>(["inflows", "outflows"]);

  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const calibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const revenueBasisMode: RevenueBasisMode = String(settings.cashInRevenueBasisMode || "").trim().toLowerCase() === "forecast_direct"
    ? "forecast_direct"
    : "hybrid";
  const quoteMode = normalizeCashInQuoteMode(settings.cashInQuoteMode);
  const persistDashboardCashInSettings = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    await saveWith((current) => {
      const next = structuredClone(current);
      if (!next.settings || typeof next.settings !== "object") {
        next.settings = {};
      }
      const settingsState = next.settings as Record<string, unknown>;
      next.settings = {
        ...settingsState,
        ...patch,
        lastUpdatedAt: new Date().toISOString(),
      };
      return next;
    }, "v2:dashboard:cashin-cockpit");
  }, [saveWith]);
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
  const phantomFoIdSet = useMemo(
    () => new Set(phantomFoSuggestions.map((entry) => entry.id)),
    [phantomFoSuggestions],
  );
  const planningState = useMemo(
    () => buildStateWithPhantomFos({ state: stateObject, suggestions: phantomFoSuggestions }),
    [phantomFoSuggestions, stateObject],
  );
  const calculationState = useMemo(
    () => applyDashboardCalculationOverrides(planningState, {
      quoteMode,
      revenueBasisMode,
      calibrationEnabled,
    }),
    [calibrationEnabled, planningState, quoteMode, revenueBasisMode],
  );
  const report = useMemo(() => computeSeries(calculationState) as SeriesResult, [calculationState]);
  const months = report.months || [];
  const breakdown = report.breakdown || [];

  const visibleMonths = useMemo(() => {
    const option = DASHBOARD_RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return months;
    return months.slice(0, option.count);
  }, [months, range]);
  const visibleRangeLabel = useMemo(() => {
    const option = DASHBOARD_RANGE_OPTIONS.find((entry) => entry.value === range);
    return option?.label || "Alle Monate";
  }, [range]);

  const visibleMonthSet = useMemo(() => new Set(visibleMonths), [visibleMonths]);
  const bucketScopeSet = useMemo(() => new Set(bucketScopeValues), [bucketScopeValues]);

  const visibleBreakdown = useMemo(() => {
    const filteredByMonth = breakdown.filter((row) => visibleMonthSet.has(row.month));
    return applyBucketScopeToBreakdown(filteredByMonth, bucketScopeSet);
  }, [breakdown, bucketScopeSet, visibleMonthSet]);
  const robustness = useMemo(() => {
    return buildDashboardRobustness({
      state: stateObject,
      months: visibleMonths,
    });
  }, [stateObject, visibleMonths]);

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

  const setBucketScopeEnabled = useCallback((bucket: string, enabled: boolean) => {
    if (!PORTFOLIO_BUCKET_VALUES.includes(bucket)) return;
    setBucketScopeValues((current) => {
      const normalized = Array.from(new Set((current || []).filter((entry) => PORTFOLIO_BUCKET_VALUES.includes(entry))));
      const isSelected = normalized.includes(bucket);
      if (enabled && !isSelected) {
        return [...normalized, bucket];
      }
      if (!enabled && isSelected) {
        const filtered = normalized.filter((entry) => entry !== bucket);
        return filtered.length ? filtered : normalized;
      }
      return normalized;
    });
  }, []);
  const openMonthDetails = useCallback((month: string) => {
    if (!month) return;
    setSelectedMonth(month);
    setMonthDetailOpen(true);
  }, []);

  const simulatedBreakdown = useMemo(
    () => visibleBreakdown.map((row) => ({ ...row })),
    [visibleBreakdown],
  );
  const effectiveCashInByMonth = useMemo(() => {
    return buildCashInPayoutMirrorByMonth({
      months: visibleMonths,
      state: stateObject,
    }) as Record<string, number>;
  }, [stateObject, visibleMonths]);
  const monthHasActualClosing = useMemo(
    () => new Map(simulatedBreakdown.map((row) => [row.month, row.hasActualClosing === true])),
    [simulatedBreakdown],
  );

  const inflowSplitByMonth = useMemo(() => {
    const map = new Map<string, {
      amazon: number;
      amazonCore: number;
      amazonPlanned: number;
      amazonNew: number;
      other: number;
      total: number;
    }>();
    simulatedBreakdown.forEach((row) => {
      map.set(row.month, splitInflowEntriesByType(
        Array.isArray(row.entries) ? row.entries : [],
        bucketScopeSet,
        effectiveCashInByMonth[row.month] ?? null,
      ));
    });
    return map;
  }, [bucketScopeSet, effectiveCashInByMonth, simulatedBreakdown]);

  const inflowSplitSeries = useMemo(
    () => simulatedBreakdown.map((row) => inflowSplitByMonth.get(row.month) || {
      amazon: 0,
      amazonCore: 0,
      amazonPlanned: 0,
      amazonNew: 0,
      other: 0,
      total: 0,
    }),
    [inflowSplitByMonth, simulatedBreakdown],
  );
  const outflowSplitByMonth = useMemo(() => {
    const map = new Map<string, {
      fixcost: number;
      po: number;
      fo: number;
      phantomFo: number;
      other: number;
      total: number;
    }>();
    simulatedBreakdown.forEach((row) => {
      map.set(row.month, splitOutflowEntriesByType(
        Array.isArray(row.entries) ? row.entries : [],
        phantomFoIdSet,
        bucketScopeSet,
      ));
    });
    return map;
  }, [bucketScopeSet, phantomFoIdSet, simulatedBreakdown]);
  const outflowSplitSeries = useMemo(
    () => simulatedBreakdown.map((row) => outflowSplitByMonth.get(row.month) || {
      fixcost: 0,
      po: 0,
      fo: 0,
      phantomFo: 0,
      other: 0,
      total: 0,
    }),
    [outflowSplitByMonth, simulatedBreakdown],
  );
  const amazonCoreInflowSeries = useMemo(
    () => inflowSplitSeries.map((row) => row.amazonCore),
    [inflowSplitSeries],
  );
  const amazonPlannedInflowSeries = useMemo(
    () => inflowSplitSeries.map((row) => row.amazonPlanned),
    [inflowSplitSeries],
  );
  const amazonNewInflowSeries = useMemo(
    () => inflowSplitSeries.map((row) => row.amazonNew),
    [inflowSplitSeries],
  );

  const amazonInflowSeries = useMemo(
    () => inflowSplitSeries.map((row) => row.amazon),
    [inflowSplitSeries],
  );
  const otherInflowSeries = useMemo(
    () => inflowSplitSeries.map((row) => row.other),
    [inflowSplitSeries],
  );

  const totalInflow = amazonInflowSeries.reduce((sum, value) => sum + Number(value || 0), 0)
    + otherInflowSeries.reduce((sum, value) => sum + Number(value || 0), 0);
  const totalOutflow = simulatedBreakdown.reduce((sum, row) => sum + Number(row.outflow || 0), 0);
  const totalNet = simulatedBreakdown.reduce((sum, row) => sum + Number(row.net || 0), 0);
  const minClosing = useMemo(() => {
    if (!simulatedBreakdown.length) return null;
    return Math.min(...simulatedBreakdown.map((row) => Number(row.closing || 0)));
  }, [simulatedBreakdown]);
  const calibrationApplied = report.kpis?.cashIn?.calibrationApplied === true;
  const calibrationCandidateCount = Math.max(0, Math.round(Number(report.kpis?.cashIn?.calibrationCandidateCount || 0)));
  const calibrationNonDefaultFactorMonthCount = Math.max(
    0,
    Math.round(Number(report.kpis?.cashIn?.calibrationNonDefaultFactorMonthCount || 0)),
  );
  const calibrationLatestCandidateMonth = String(report.kpis?.cashIn?.calibrationLatestCandidateMonth || "").trim() || null;
  const calibrationLatestRawFactor = Number(report.kpis?.cashIn?.calibrationLatestRawFactor);
  const calibrationReasonCounts = (
    report.kpis?.cashIn?.calibrationReasonCounts
    && typeof report.kpis.cashIn.calibrationReasonCounts === "object"
  )
    ? report.kpis.cashIn.calibrationReasonCounts
    : {} as Record<string, number>;
  const calibrationDataMonthCount = useMemo(() => {
    const incomings = Array.isArray((calculationState as Record<string, unknown>).incomings)
      ? (calculationState as Record<string, unknown>).incomings as Record<string, unknown>[]
      : [];
    return incomings.reduce((count, rowRaw) => {
      const row = (rowRaw && typeof rowRaw === "object") ? rowRaw as Record<string, unknown> : {};
      const hasSellerboardForecast = Number(row.calibrationSellerboardMonthEndEur) > 0;
      const hasLinearData = Number(row.calibrationRevenueToDateEur) > 0
        && String(row.calibrationCutoffDate || "").trim().length > 0;
      return (hasSellerboardForecast || hasLinearData) ? count + 1 : count;
    }, 0);
  }, [calculationState]);
  const calibrationWarningMessage = useMemo(() => {
    if (!calibrationEnabled || calibrationApplied) return null;
    if (calibrationDataMonthCount <= 0) {
      return "Keine verwertbaren Kalibrierdaten gefunden. Das Diagramm entspricht aktuell dem Forecast-Umsatz.";
    }

    if (calibrationCandidateCount <= 0) {
      const missingForecastCount = Math.max(0, Math.round(Number(calibrationReasonCounts.missing_forecast_revenue || 0)));
      const missingInputsCount = Math.max(0, Math.round(Number(calibrationReasonCounts.missing_inputs || 0)));
      const invalidCutoffCount = Math.max(0, Math.round(Number(calibrationReasonCounts.invalid_cutoff_date || 0)));
      const invalidFactorCount = Math.max(0, Math.round(Number(calibrationReasonCounts.invalid_factor || 0)));
      const invalidExpectedRevenueCount = Math.max(0, Math.round(Number(calibrationReasonCounts.invalid_expected_revenue || 0)));
      const parts: string[] = [];
      if (missingForecastCount > 0) {
        parts.push(`Forecast-Umsatz fehlt/ist 0 in ${missingForecastCount} Kalibrier-Monat(en)`);
      }
      if (missingInputsCount > 0) {
        parts.push(`Kalibrierdaten unvollständig in ${missingInputsCount} Monat(en)`);
      }
      if (invalidCutoffCount > 0) {
        parts.push(`Cutoff-Datum ungültig in ${invalidCutoffCount} Monat(en)`);
      }
      if (invalidFactorCount > 0 || invalidExpectedRevenueCount > 0) {
        parts.push(`Faktor rechnerisch ungültig in ${invalidFactorCount + invalidExpectedRevenueCount} Monat(en)`);
      }
      if (!parts.length) {
        return "Kalibrierdaten sind vorhanden, aber aktuell im Planungsfenster nicht verwertbar. Das Diagramm bleibt beim Forecast-Umsatz.";
      }
      return `Kalibrierdaten sind vorhanden, aber aktuell nicht wirksam: ${parts.join(" · ")}.`;
    }

    if (calibrationNonDefaultFactorMonthCount <= 0) {
      if (Number.isFinite(calibrationLatestRawFactor)) {
        const factorText = Number(calibrationLatestRawFactor).toLocaleString("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        if (Math.abs(calibrationLatestRawFactor - 1) <= 0.000001) {
          const sourceText = calibrationLatestCandidateMonth ? ` (Quelle ${formatMonthLabel(calibrationLatestCandidateMonth)})` : "";
          return `Kalibrierung aktiv, aber ohne Effekt: Startfaktor ${factorText}${sourceText}. Das entspricht faktisch 1,00.`;
        }
        const sourceText = calibrationLatestCandidateMonth ? ` (${formatMonthLabel(calibrationLatestCandidateMonth)})` : "";
        return `Kalibrierdaten gefunden (Startfaktor ${factorText}${sourceText}), aber im aktuellen Planungsfenster wirkt der Fade-Out bereits auf ~1,00.`;
      }
      return "Kalibrierdaten sind vorhanden, aktuell aber ohne Effekt (Faktor ~1,00 im Planungsfenster).";
    }

    return "Kalibrierung aktiv, aber der Effekt ist im aktuellen Ausschnitt minimal.";
  }, [
    calibrationApplied,
    calibrationCandidateCount,
    calibrationDataMonthCount,
    calibrationLatestCandidateMonth,
    calibrationLatestRawFactor,
    calibrationNonDefaultFactorMonthCount,
    calibrationReasonCounts,
    calibrationEnabled,
  ]);

  const forecastVersioningSnapshot = useMemo(() => {
    const clone = structuredClone(forecast || {});
    ensureForecastVersioningContainers(clone as Record<string, unknown>);
    return clone as Record<string, unknown>;
  }, [forecast]);
  const impactSummary = normalizeForecastImpactSummary(forecastVersioningSnapshot.lastImpactSummary);
  const activeVersionId = String(forecastVersioningSnapshot.activeVersionId || "").trim() || null;
  const openForecastFoConflicts = impactSummary.toVersionId && activeVersionId && impactSummary.toVersionId === activeVersionId
    ? impactSummary.foConflictsOpen
    : 0;

  const selectedMonthData = selectedMonth ? robustness.monthMap.get(selectedMonth) || null : null;
  const selectedMonthStatusMeta = selectedMonthData
    ? coverageStatusMeta(selectedMonthData.coverage.statusKey)
    : null;
  const selectedMonthIsPast = useMemo(() => {
    if (!selectedMonthData) return false;
    const nowIdx = monthIndex(currentMonthKey());
    const selectedIdx = monthIndex(selectedMonthData.month);
    if (selectedIdx == null || nowIdx == null) return false;
    return selectedIdx < nowIdx;
  }, [selectedMonthData]);
  const selectedOptionalChecks = selectedMonthData
    ? selectedMonthData.checks.filter((entry) => entry.key !== "sku_coverage")
    : [];
  const selectedCoverageWarnings = useMemo(() => {
    if (!selectedMonthData || selectedMonthData.coverage.statusKey === "full") {
      return [] as Array<{ id: string; message: string; route: string }>;
    }
    const month = selectedMonthData.month;
    return [{
      id: `coverage-warning:${month}`,
      message: `Coverage ist ${selectedMonthData.coverage.statusLabel}: ${formatPercent(selectedMonthData.coverage.ratio * 100)} (${selectedMonthData.coverage.coveredSkus}/${selectedMonthData.coverage.activeSkus}).`,
      route: buildInventoryDashboardRoute({
        risk: "under_safety",
        abc: "ab",
        month,
        mode: selectedMonthData.coverage.projectionMode,
      }),
    }];
  }, [selectedMonthData]);
  const selectedCriteriaRows = useMemo(() => {
    if (!selectedMonthData) {
      return [] as Array<{ key: string; label: string; state: "ok" | "warn" | "fail"; description: string; route: string | null }>;
    }
    const rows: Array<{ key: string; label: string; state: "ok" | "warn" | "fail"; description: string; route: string | null }> = [];
    const stockIssueCount = selectedMonthData.coverage.stockIssueCount;
    const orderDutyIssueCount = selectedMonthData.coverage.orderDutyIssueCount;
    rows.push({
      key: "stock_lookahead",
      label: "Bestand robust (mit Lookahead)",
      state: stockIssueCount === 0 ? "ok" : "fail",
      description: stockIssueCount === 0
        ? "Alle aktiven SKUs bleiben im Lookahead-Fenster über Safety."
        : `${stockIssueCount} aktive SKU(s) unterschreiten Safety im Lookahead-Fenster.`,
      route: "/v2/inventory/projektion",
    });
    rows.push({
      key: "order_duty",
      label: "Bestellpflicht rechtzeitig",
      state: orderDutyIssueCount === 0
        ? "ok"
        : (selectedMonthData.coverage.overdueOrderDutySkuCount > 0 ? "fail" : "warn"),
      description: orderDutyIssueCount === 0
        ? "Keine fällige Bestellpflicht für PO/FO im Monat."
        : `${orderDutyIssueCount} SKU(s) mit fälliger Bestellpflicht.`,
      route: "/v2/orders/fo",
    });
    selectedOptionalChecks.forEach((check) => {
      rows.push({
        key: check.key,
        label: check.label,
        state: check.passed ? "ok" : "fail",
        description: check.detail,
        route: check.route || null,
      });
    });
    if (selectedMonthIsPast) {
      rows.push({
        key: "past-info",
        label: "Vergangen (Info)",
        state: "warn",
        description: "Vergangener Monat: Status dient zur Einordnung, nicht als offene To-Do-Pflicht.",
        route: null,
      });
    }
    return rows;
  }, [selectedMonthData, selectedMonthIsPast, selectedOptionalChecks]);
  const monthLabelToKey = useMemo(() => {
    const map = new Map<string, string>();
    visibleMonths.forEach((month) => {
      map.set(formatMonthLabel(month), month);
    });
    return map;
  }, [visibleMonths]);
  const handleChartClick = useCallback((paramsRaw: unknown) => {
    if (!paramsRaw || typeof paramsRaw !== "object") return;
    const params = paramsRaw as {
      dataIndex?: unknown;
      name?: unknown;
      axisValue?: unknown;
      value?: unknown;
    };

    let month: string | null = null;
    const dataIndex = Number(params.dataIndex);
    if (Number.isInteger(dataIndex) && dataIndex >= 0 && dataIndex < visibleMonths.length) {
      month = visibleMonths[dataIndex];
    }

    if (!month) {
      const candidates = [params.name, params.axisValue, params.value]
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean);
      for (let i = 0; i < candidates.length; i += 1) {
        const match = monthLabelToKey.get(candidates[i]);
        if (match) {
          month = match;
          break;
        }
      }
    }

    if (month) {
      openMonthDetails(month);
    }
  }, [monthLabelToKey, openMonthDetails, visibleMonths]);
  const chartEvents = useMemo(() => ({ click: handleChartClick }), [handleChartClick]);

  const chartOption = useMemo(() => {
    const amazonCoreSeriesName = "Amazon Kern";
    const amazonPlannedSeriesName = "Amazon Plan";
    const amazonNewSeriesName = "Amazon Neu";
    const amazonSeriesNames = new Set([amazonCoreSeriesName, amazonPlannedSeriesName, amazonNewSeriesName]);
    const monthLabels = visibleMonths.map((month) => formatMonthLabel(month));
    const closingSeries = visibleBreakdown.map((row) => Number(row.closing || 0));
    const fixcostOutflowSeries = outflowSplitSeries.map((row) => -row.fixcost);
    const poOutflowSeries = outflowSplitSeries.map((row) => -row.po);
    const foOutflowSeries = outflowSplitSeries.map((row) => -row.fo);
    const phantomFoOutflowSeries = outflowSplitSeries.map((row) => -row.phantomFo);
    const legendItems = [
      amazonCoreSeriesName,
      amazonPlannedSeriesName,
      amazonNewSeriesName,
      "Sonstige In",
      "Fixkosten",
      "PO",
      "FO",
      "Phantom FO",
      "Netto",
      "Kontostand",
    ];

    return {
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const first = rows[0] as { axisValueLabel?: string } | undefined;
          const lines = [`<div><strong>${first?.axisValueLabel || ""}</strong></div>`];
          let amazonSubtotal = 0;
          let hasAmazonBreakdown = false;
          rows.forEach((entryRaw) => {
            const entry = entryRaw as { marker?: string; seriesName?: string; value?: number | null };
            const value = Number(entry?.value);
            if (!Number.isFinite(value)) return;
            if (amazonSeriesNames.has(String(entry?.seriesName || ""))) {
              amazonSubtotal += value;
              hasAmazonBreakdown = true;
            }
            lines.push(`<div>${entry?.marker || ""}${entry?.seriesName || ""}: ${formatCurrency(value)}</div>`);
          });
          if (hasAmazonBreakdown) {
            lines.push(`<div><strong>Amazon gesamt: ${formatCurrency(amazonSubtotal)}</strong></div>`);
          }
          return lines.join("");
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        left: 0,
        right: 0,
        itemGap: 10,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: {
          fontSize: 12,
          color: v2ChartPalette.textStrong,
        },
        pageTextStyle: {
          fontSize: 11,
          color: v2ChartPalette.textMuted,
        },
        data: legendItems,
      },
      grid: {
        left: 54,
        right: 68,
        top: 54,
        bottom: 42,
      },
      xAxis: {
        type: "category",
        data: monthLabels,
        triggerEvent: true,
        axisLabel: {
          hideOverlap: true,
          fontSize: 12,
          color: v2ChartPalette.textMuted,
          margin: 12,
        },
        axisLine: {
          lineStyle: { color: v2ChartPalette.axisLine },
        },
      },
      yAxis: [
        {
          type: "value",
          name: "Cashflow",
          nameTextStyle: {
            fontSize: 12,
            color: v2ChartPalette.textMuted,
          },
          axisLabel: {
            formatter: (value: number) => formatSignedCurrency(value),
            fontSize: 12,
            color: v2ChartPalette.textMuted,
          },
          splitLine: {
            lineStyle: {
              color: v2ChartPalette.gridLine,
            },
          },
        },
        {
          type: "value",
          name: "Kontostand",
          position: "right",
          nameTextStyle: {
            fontSize: 12,
            color: v2ChartPalette.textMuted,
          },
          axisLabel: {
            formatter: (value: number) => formatCurrency(value),
            fontSize: 12,
            color: v2ChartPalette.textMuted,
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: amazonCoreSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonCoreInflowSeries,
          itemStyle: { color: v2DashboardChartColors.amazonCore },
        },
        {
          name: amazonPlannedSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonPlannedInflowSeries,
          itemStyle: { color: v2DashboardChartColors.amazonPlanned },
        },
        {
          name: amazonNewSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonNewInflowSeries,
          itemStyle: { color: v2DashboardChartColors.amazonNew },
        },
        {
          name: "Sonstige In",
          type: "bar",
          stack: "cash",
          data: otherInflowSeries,
          itemStyle: { color: v2DashboardChartColors.otherInflow },
        },
        {
          name: "Fixkosten",
          type: "bar",
          stack: "cash",
          data: fixcostOutflowSeries,
          itemStyle: { color: v2DashboardChartColors.fixcost },
        },
        {
          name: "PO",
          type: "bar",
          stack: "cash",
          data: poOutflowSeries,
          itemStyle: { color: v2DashboardChartColors.po },
        },
        {
          name: "FO",
          type: "bar",
          stack: "cash",
          data: foOutflowSeries,
          itemStyle: { color: v2DashboardChartColors.fo },
        },
        {
          name: "Phantom FO",
          type: "bar",
          stack: "cash",
          data: phantomFoOutflowSeries,
          itemStyle: { color: v2DashboardChartColors.phantomFo },
        },
        {
          name: "Netto",
          type: "line",
          smooth: true,
          showSymbol: true,
          showAllSymbol: true,
          symbol: "emptyCircle",
          symbolSize: 7,
          data: simulatedBreakdown.map((row) => Number(row.net || 0)),
          itemStyle: { color: v2DashboardChartColors.net },
          lineStyle: { width: 2, color: v2DashboardChartColors.net },
        },
        {
          name: "Kontostand",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: true,
          showSymbol: true,
          showAllSymbol: true,
          symbol: "emptyCircle",
          symbolSize: 7,
          data: closingSeries,
          lineStyle: { width: 2, color: v2DashboardChartColors.robustPositive },
          itemStyle: { color: v2DashboardChartColors.robustPositive },
        },
      ],
    };
  }, [
    amazonCoreInflowSeries,
    amazonNewInflowSeries,
    amazonPlannedInflowSeries,
    otherInflowSeries,
    outflowSplitSeries,
    simulatedBreakdown,
    visibleBreakdown,
    visibleMonths,
  ]);
  const orderMetaByRef = useMemo(
    () => buildOrderMetaIndex(stateObject),
    [state.fos, state.pos, state.products, stateObject],
  );
  const outflowOrderRowsByCategory = useMemo(() => {
    type CategoryKey = "outflows-po" | "outflows-fo" | "outflows-phantom-fo";
    interface PaymentAggregate {
      key: string;
      label: string;
      values: Record<string, number>;
      paymentDueDate: string | null;
      paymentMix: { paid: number; open: number; unknown: number };
    }
    interface OrderAggregate {
      key: string;
      label: string;
      values: Record<string, number>;
      aliases: Set<string>;
      units: number | null;
      paymentMix: { paid: number; open: number; unknown: number };
      payments: Map<string, PaymentAggregate>;
    }

    const categories: Record<CategoryKey, Map<string, OrderAggregate>> = {
      "outflows-po": new Map(),
      "outflows-fo": new Map(),
      "outflows-phantom-fo": new Map(),
    };

    simulatedBreakdown.forEach((monthRow) => {
      const month = monthRow.month;
      const entries = Array.isArray(monthRow.entries) ? monthRow.entries : [];
      entries.forEach((entryRaw) => {
        if (!entryRaw || typeof entryRaw !== "object") return;
        const entry = entryRaw as DashboardEntry;
        if (!isEntryInBucketScope(entry, bucketScopeSet)) return;
        if (String(entry.direction || "").toLowerCase() !== "out") return;
        const amount = Math.abs(Number(entry.amount || 0));
        if (!Number.isFinite(amount) || amount <= 0) return;

        const source = String(entry.source || "").toLowerCase();
        if (source !== "po" && source !== "fo") return;

        const sourceNumber = String(entry.sourceNumber || "").trim();
        const sourceId = String(entry.sourceId || "").trim();
        const fallbackRef = String(entry.id || entry.label || "").trim();
        const reference = sourceNumber || sourceId || fallbackRef || "ohne-nummer";

        const meta = (entry.meta && typeof entry.meta === "object")
          ? entry.meta as Record<string, unknown>
          : {};
        const isPhantom = source === "fo" && (
          entry.provisional === true
          || meta.phantom === true
          || (sourceId ? phantomFoIdSet.has(sourceId) : false)
        );
        const categoryKey: CategoryKey = source === "po"
          ? "outflows-po"
          : (isPhantom ? "outflows-phantom-fo" : "outflows-fo");

        const orderMap = categories[categoryKey];
        const internalOrderKey = `${source}:${reference}`;
        let order = orderMap.get(internalOrderKey);
        if (!order) {
          const metaByRef = orderMetaByRef.get(`${source}:${reference}`)
            || (sourceNumber ? orderMetaByRef.get(`${source}:${sourceNumber}`) : undefined)
            || (sourceId ? orderMetaByRef.get(`${source}:${sourceId}`) : undefined);
          order = {
            key: `order:${categoryKey}:${source}:${reference}`,
            label: `${String(source).toUpperCase()} ${reference}`,
            values: createMonthValueRecord(visibleMonths),
            aliases: new Set(metaByRef?.aliases || []),
            units: metaByRef?.units ?? null,
            paymentMix: { paid: 0, open: 0, unknown: 0 },
            payments: new Map(),
          };
          orderMap.set(internalOrderKey, order);
        }

        order.values[month] += -amount;
        if (entry.paid === true) order.paymentMix.paid += amount;
        else if (entry.paid === false) order.paymentMix.open += amount;
        else order.paymentMix.unknown += amount;

        const aliasFromMeta = String(meta.alias || "").trim();
        if (aliasFromMeta) order.aliases.add(aliasFromMeta);
        const unitsFromMeta = Number(meta.units ?? meta.qty ?? meta.quantity);
        if (Number.isFinite(unitsFromMeta) && unitsFromMeta > 0) {
          const currentUnits = Number(order.units || 0);
          order.units = Number.isFinite(currentUnits) ? currentUnits + unitsFromMeta : unitsFromMeta;
        }

        const paymentLabel = String(entry.label || "").trim() || "Zahlung";
        const paymentDueDate = String(entry.date || "").trim() || null;
        const paymentState = entry.paid === true ? "paid" : entry.paid === false ? "open" : "unknown";
        const internalPaymentKey = `${paymentLabel}|${paymentDueDate || ""}|${paymentState}`;
        let payment = order.payments.get(internalPaymentKey);
        if (!payment) {
          payment = {
            key: `payment:${order.key}:${internalPaymentKey}`,
            label: paymentLabel,
            values: createMonthValueRecord(visibleMonths),
            paymentDueDate,
            paymentMix: { paid: 0, open: 0, unknown: 0 },
          };
          order.payments.set(internalPaymentKey, payment);
        }
        payment.values[month] += -amount;
        if (entry.paid === true) payment.paymentMix.paid += amount;
        else if (entry.paid === false) payment.paymentMix.open += amount;
        else payment.paymentMix.unknown += amount;
      });
    });

    const toRows = (map: Map<string, OrderAggregate>, orderType: "po" | "fo" | "phantom"): PnlMatrixRow[] => {
      return Array.from(map.values())
        .sort((left, right) => sumAbsoluteMonthValues(right.values) - sumAbsoluteMonthValues(left.values))
        .map((order) => {
          const paymentRows = Array.from(order.payments.values())
            .sort((left, right) => sumAbsoluteMonthValues(right.values) - sumAbsoluteMonthValues(left.values))
            .map((payment) => ({
              key: payment.key,
              label: payment.label,
              values: payment.values,
              rowType: "payment" as const,
              paymentStatus: resolvePaymentStatus(payment.paymentMix),
              paymentDueDate: payment.paymentDueDate,
            }));

          const units = Number(order.units);
          return {
            key: order.key,
            label: order.label,
            values: order.values,
            rowType: "order",
            orderType,
            aliases: Array.from(order.aliases),
            units: Number.isFinite(units) && units > 0 ? units : null,
            paymentMix: order.paymentMix,
            children: paymentRows.length ? paymentRows : undefined,
          };
        });
    };

    return {
      po: toRows(categories["outflows-po"], "po"),
      fo: toRows(categories["outflows-fo"], "fo"),
      phantom: toRows(categories["outflows-phantom-fo"], "phantom"),
    };
  }, [bucketScopeSet, orderMetaByRef, phantomFoIdSet, simulatedBreakdown, visibleMonths]);
  const pnlMatrixRows = useMemo<PnlMatrixRow[]>(() => {
    const byMonth = new Map(simulatedBreakdown.map((row) => [row.month, row]));
    const values = (resolve: (month: string) => number): Record<string, number> => {
      const next = createMonthValueRecord(visibleMonths);
      visibleMonths.forEach((month) => {
        next[month] = Number(resolve(month) || 0);
      });
      return next;
    };

    const rows: PnlMatrixRow[] = [
      {
        key: "inflows",
        label: "Einnahmen",
        rowType: "group",
        values: values((month) => inflowSplitByMonth.get(month)?.total || 0),
        children: [
          {
            key: "inflows-amazon-core",
            label: "Amazon Kernprodukte",
            rowType: "category",
            values: values((month) => inflowSplitByMonth.get(month)?.amazonCore || 0),
          },
          {
            key: "inflows-amazon-plan",
            label: "Amazon geplante Produkte",
            rowType: "category",
            values: values((month) => inflowSplitByMonth.get(month)?.amazonPlanned || 0),
          },
          {
            key: "inflows-amazon-new",
            label: "Amazon neue Produkte",
            rowType: "category",
            values: values((month) => inflowSplitByMonth.get(month)?.amazonNew || 0),
          },
          {
            key: "inflows-other",
            label: "Sonstige Einzahlungen",
            rowType: "category",
            values: values((month) => inflowSplitByMonth.get(month)?.other || 0),
          },
        ],
      },
      {
        key: "outflows",
        label: "Ausgaben",
        rowType: "group",
        values: values((month) => -(outflowSplitByMonth.get(month)?.total || 0)),
        children: [
          {
            key: "outflows-po",
            label: "PO",
            rowType: "category",
            values: values((month) => -(outflowSplitByMonth.get(month)?.po || 0)),
            children: outflowOrderRowsByCategory.po.length ? outflowOrderRowsByCategory.po : undefined,
          },
          {
            key: "outflows-fo",
            label: "FO",
            rowType: "category",
            values: values((month) => -(outflowSplitByMonth.get(month)?.fo || 0)),
            children: outflowOrderRowsByCategory.fo.length ? outflowOrderRowsByCategory.fo : undefined,
          },
          {
            key: "outflows-phantom-fo",
            label: "Phantom FO",
            rowType: "category",
            values: values((month) => -(outflowSplitByMonth.get(month)?.phantomFo || 0)),
            children: outflowOrderRowsByCategory.phantom.length ? outflowOrderRowsByCategory.phantom : undefined,
          },
          {
            key: "outflows-fixcost",
            label: "Fixkosten",
            rowType: "category",
            values: values((month) => -(outflowSplitByMonth.get(month)?.fixcost || 0)),
          },
          {
            key: "outflows-other",
            label: "Sonstige Auszahlungen",
            rowType: "category",
            values: values((month) => -(outflowSplitByMonth.get(month)?.other || 0)),
          },
        ],
      },
      {
        key: "net",
        label: "Netto Cashflow",
        rowType: "total",
        values: values((month) => Number(byMonth.get(month)?.net || 0)),
      },
      {
        key: "closing",
        label: "Kontostand",
        rowType: "total",
        values: values((month) => Number(byMonth.get(month)?.closing || 0)),
      },
    ];
    return rows;
  }, [inflowSplitByMonth, outflowOrderRowsByCategory, outflowSplitByMonth, simulatedBreakdown, visibleMonths]);
  const allExpandablePnlRowKeys = useMemo(
    () => collectExpandableRowKeys(pnlMatrixRows),
    [pnlMatrixRows],
  );
  useEffect(() => {
    const validKeys = new Set(allExpandablePnlRowKeys);
    setExpandedPnlRowKeys((current) => current.filter((key) => validKeys.has(key)));
  }, [allExpandablePnlRowKeys]);
  const pnlAllExpanded = useMemo(() => {
    if (!allExpandablePnlRowKeys.length) return false;
    const expandedSet = new Set(expandedPnlRowKeys);
    return allExpandablePnlRowKeys.every((key) => expandedSet.has(key));
  }, [allExpandablePnlRowKeys, expandedPnlRowKeys]);
  const togglePnlExpandAll = useCallback(() => {
    setExpandedPnlRowKeys((current) => {
      const expandedSet = new Set(current);
      const currentlyAllExpanded = allExpandablePnlRowKeys.length > 0
        && allExpandablePnlRowKeys.every((key) => expandedSet.has(key));
      return currentlyAllExpanded ? [] : allExpandablePnlRowKeys.slice();
    });
  }, [allExpandablePnlRowKeys]);
  const pnlMatrixColumns = useMemo<ColumnsType<PnlMatrixRow>>(() => {
    return [{
      title: "Position",
      key: "label",
      dataIndex: "label",
      fixed: "left",
      width: 380,
      render: (_value, row) => {
        if (row.rowType === "order") {
          const aliases = Array.isArray(row.aliases) ? row.aliases.filter(Boolean) : [];
          const aliasSummary = aliases.length > 2
            ? `${aliases.slice(0, 2).join(", ")} +${aliases.length - 2}`
            : aliases.join(", ");
          const mix = row.paymentMix || { paid: 0, open: 0, unknown: 0 };
          const total = mix.paid + mix.open + mix.unknown;
          const denominator = total > 0 ? total : 1;
          const paidWidth = `${Math.max(0, Math.min(100, (mix.paid / denominator) * 100))}%`;
          const openWidth = `${Math.max(0, Math.min(100, (mix.open / denominator) * 100))}%`;
          const unknownWidth = `${Math.max(0, Math.min(100, (mix.unknown / denominator) * 100))}%`;
          return (
            <div className="v2-dashboard-pnl-label-cell">
              <Space size={6} wrap>
                <Text strong>{row.label}</Text>
                {row.orderType === "phantom" ? <Tag color="gold">Phantom</Tag> : null}
                {aliasSummary ? <Text type="secondary">Alias: {aliasSummary}</Text> : null}
                {Number.isFinite(Number(row.units)) && Number(row.units) > 0 ? <Tag>Stk: {formatNumber(row.units, 0)}</Tag> : null}
              </Space>
              {total > 0 ? (
                <div className="v2-dashboard-pnl-paybar" title={`Bezahlt ${formatCurrency(mix.paid)} · Offen ${formatCurrency(mix.open)} · Unklar ${formatCurrency(mix.unknown)}`}>
                  <span className="is-paid" style={{ width: paidWidth }} />
                  <span className="is-open" style={{ width: openWidth }} />
                  <span className="is-unknown" style={{ width: unknownWidth }} />
                </div>
              ) : null}
            </div>
          );
        }
        if (row.rowType === "payment") {
          const statusLabel = row.paymentStatus === "paid"
            ? <Tag color="green">Bezahlt</Tag>
            : row.paymentStatus === "open"
              ? <Tag color="orange">Offen</Tag>
              : row.paymentStatus === "mixed"
                ? <Tag color="blue">Gemischt</Tag>
                : <Tag>Unklar</Tag>;
          return (
            <Space size={6} wrap>
              <Text>{row.label}</Text>
              {row.paymentDueDate ? <Text type="secondary">Fällig: {formatIsoDate(row.paymentDueDate)}</Text> : null}
              {statusLabel}
            </Space>
          );
        }
        const isTotal = row.key === "inflows"
          || row.key === "outflows"
          || row.key === "net"
          || row.key === "closing";
        return <Text strong={isTotal}>{row.label}</Text>;
      },
    }, ...visibleMonths.map((month) => ({
      title: formatMonthLabel(month),
      key: month,
      width: 132,
      align: "right" as const,
      render: (_value: unknown, row: PnlMatrixRow) => {
        const value = Number(row.values[month]);
        const hasFiniteValue = Number.isFinite(value);
        const isBalanceRow = row.key === "closing";
        const isNegative = !isBalanceRow && hasFiniteValue && value < 0;
        const displayValue = isBalanceRow
          ? (hasFiniteValue ? formatCurrency(value) : "-")
          : (hasFiniteValue ? formatSignedCurrency(value) : "-");
        const isLockedActual = isBalanceRow && monthHasActualClosing.get(month) === true;
        const showLock = isBalanceRow && isLockedActual;
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "flex-end",
            width: "100%",
            gap: 4,
          }}
          >
            <Text
              strong={row.key === "net" || row.key === "closing"}
              type={isNegative ? "danger" : undefined}
            >
              {displayValue}
            </Text>
            {showLock ? (
              <Tooltip title="IST-Kontostand Monatsende eingetragen. Dieser Wert ist fixiert und dient als Basis für Folgemonate.">
                <LockFilled style={{ fontSize: 12, color: "rgba(15, 23, 42, 0.62)" }} />
              </Tooltip>
            ) : null}
          </span>
        );
      },
    }))];
  }, [monthHasActualClosing, visibleMonths]);

  function resetCalculationCockpit(): void {
    setRange("next6");
    setBucketScopeValues(DEFAULT_BUCKET_SCOPE.slice());
    setRevenueBasisMode(methodikRevenueBasisMode);
    setCalibrationEnabled(methodikCalibrationEnabled);
    setQuoteMode("manual");
  }

  function openBlockerTarget(blocker: RobustMonthBlocker): void {
    if (!selectedMonthData) return;
    const targetMonth = blocker.month || selectedMonthData.month;
    if (blocker.checkKey === "cash_in") {
      navigate(appendRouteQuery("/v2/abschluss/eingaben", {
        source: "dashboard",
        month: targetMonth,
      }));
      return;
    }
    if (blocker.checkKey === "fixcost") {
      navigate(appendRouteQuery("/v2/abschluss/fixkosten", {
        source: "dashboard",
        month: targetMonth,
      }));
      return;
    }
    if (blocker.checkKey === "vat") {
      navigate(appendRouteQuery("/v2/abschluss/ust", {
        source: "dashboard",
        month: targetMonth,
      }));
      return;
    }
    if (blocker.checkKey === "revenue_inputs" && blocker.sku) {
      navigate(appendRouteQuery("/v2/products", {
        source: "dashboard",
        issues: "revenue",
        sku: blocker.sku,
      }));
      return;
    }
    if (blocker.issueType === "order_duty" && blocker.sku) {
      navigate(buildFoDashboardRoute({
        sku: blocker.sku,
        month: targetMonth,
        suggestedUnits: blocker.suggestedUnits ?? null,
        requiredArrivalDate: blocker.requiredArrivalDate || null,
        recommendedOrderDate: blocker.recommendedOrderDate || null,
        source: "inventory_projection",
        phantomId: null,
        firstRiskMonth: blocker.firstRiskMonth || null,
        orderMonth: blocker.orderMonth || null,
        leadTimeDays: blocker.leadTimeDays ?? null,
        returnTo: "/v2/dashboard",
      }));
      return;
    }
    if (blocker.issueType === "forecast_missing" && blocker.sku) {
      navigate(buildForecastDashboardRoute({
        sku: blocker.sku,
        month: targetMonth,
      }));
      return;
    }
    if ((blocker.issueType === "stock_oos" || blocker.issueType === "stock_under_safety") && blocker.sku) {
      navigate(buildInventoryDashboardRoute({
        risk: blocker.issueType === "stock_oos" ? "oos" : "under_safety",
        abc: blocker.abcClass && (blocker.abcClass === "A" || blocker.abcClass === "B") ? "ab" : "all",
        month: blocker.firstRiskMonth || targetMonth,
        sku: blocker.sku,
        mode: selectedMonthData.coverage.projectionMode || null,
      }));
      return;
    }
    navigate(resolveDashboardRoute({
      route: blocker.route,
      checkKey: blocker.checkKey,
      month: targetMonth,
      sku: blocker.sku || null,
      mode: selectedMonthData.coverage.projectionMode || null,
    }));
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
      <Card className="v2-intro-card">
        <Row gutter={[10, 10]} className="v2-page-head">
          <Col xs={24} xl={12}>
            <div>
              <Title level={3}>Dashboard</Title>
              <Paragraph>
                Berechnungs-Cockpit für Kontostand und Cashflow. Details öffnest du bei Bedarf in den Fach-Tabs.
              </Paragraph>
            </div>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <div className="v2-toolbar-field">
              <Text>Zeitraum</Text>
              <Select
                value={range}
                onChange={(value) => setRange(value)}
                options={DASHBOARD_RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
                style={{ width: 220, maxWidth: "100%" }}
              />
            </div>
          </Col>
          <Col xs={24} md={12} xl={6}>
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
          </Col>
        </Row>
        <div className="v2-toolbar">
          <Text type="secondary">
            Zeitraum: {visibleRangeLabel} ({visibleMonths.length} Monate) · PFO bis: {resolvedPhantomTargetMonth ? formatMonthLabel(resolvedPhantomTargetMonth) : "—"}
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

      <Drawer
        title={selectedMonthData ? `Monats-Check: ${formatMonthLabel(selectedMonthData.month)}` : "Monats-Check"}
        placement="right"
        width={520}
        open={monthDetailOpen && Boolean(selectedMonthData)}
        onClose={() => setMonthDetailOpen(false)}
        destroyOnClose={false}
      >
        {selectedMonthData ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color={selectedMonthStatusMeta?.color || "default"}>{selectedMonthData.coverage.statusLabel}</Tag>
              <Text>
                Coverage {formatPercent(selectedMonthData.coverage.ratio * 100)} ({selectedMonthData.coverage.coveredSkus}/{selectedMonthData.coverage.activeSkus}),
                {" "}Bestand {selectedMonthData.coverage.stockIssueCount},
                {" "}Bestellpflicht {selectedMonthData.coverage.orderDutyIssueCount},
                {" "}Blocker {selectedMonthData.coverage.blockerCount}
              </Text>
              {selectedMonthIsPast ? <Tag>Vergangen (Info)</Tag> : null}
            </Space>

            <Card size="small" title="A) Kriterien (transparent & nachvollziehbar)">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Space wrap>
                  <Tooltip title="Coverage zeigt den Anteil aktiver SKUs ohne Bestands- oder Bestellpflicht-Risiko im Monat.">
                    <Tag icon={<InfoCircleOutlined />}>Coverage</Tag>
                  </Tooltip>
                  <Tooltip title="Blocker sind harte Abweichungen, die den Monatsstatus verschlechtern und aktiv behoben werden sollten.">
                    <Tag icon={<InfoCircleOutlined />}>Blocker</Tag>
                  </Tooltip>
                </Space>
                {selectedCriteriaRows.map((criteria) => (
                  <div key={criteria.key} className="v2-dashboard-detail-card">
                    <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                      <Text strong>{criteriaStateSymbol(criteria.state)} {criteria.label}</Text>
                      {criteria.route ? (
                        <Button
                          size="small"
                          onClick={() => navigate(resolveDashboardRoute({
                            route: criteria.route,
                            month: selectedMonthData.month,
                            mode: selectedMonthData.coverage.projectionMode,
                          }))}
                        >
                          Öffnen
                        </Button>
                      ) : null}
                    </Space>
                    <Text type="secondary">{criteria.description}</Text>
                  </div>
                ))}
              </Space>
            </Card>

            <Card size="small" title="B) Konkrete Blocker & To-Dos">
              {selectedMonthData.coverage.statusKey === "full" ? (
                <Alert type="success" showIcon message="Status ist Vollständig. Es sind keine To-Dos offen." />
              ) : selectedMonthIsPast ? (
                <Alert
                  type="info"
                  showIcon
                  message="Vergangener Monat"
                  description="Zur Einordnung werden die Ursachen angezeigt, es besteht keine To-Do-Pflicht mehr."
                />
              ) : (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <div>
                    <Text strong>1) Blocker</Text>
                    {!selectedMonthData.blockers.length ? (
                      <div><Text type="secondary">Keine expliziten Blocker gelistet.</Text></div>
                    ) : (
                      <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
                        {selectedMonthData.blockers.map((blocker) => (
                          <div key={blocker.id} className="v2-dashboard-detail-card">
                            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                              <Tag color="red">Blocker</Tag>
                              <Button size="small" onClick={() => openBlockerTarget(blocker)}>
                                Öffnen
                              </Button>
                            </Space>
                            <Text>{blocker.message}</Text>
                          </div>
                        ))}
                      </Space>
                    )}
                  </div>
                  <div>
                    <Text strong>2) Warnungen</Text>
                    {!selectedCoverageWarnings.length ? (
                      <div><Text type="secondary">Keine Warnungen.</Text></div>
                    ) : (
                      <Space direction="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
                        {selectedCoverageWarnings.map((warning) => (
                          <div key={warning.id} className="v2-dashboard-detail-card">
                            <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
                              <Tag color="gold">Warnung</Tag>
                              <Button size="small" onClick={() => navigate(warning.route)}>
                                Öffnen
                              </Button>
                            </Space>
                            <Text>{warning.message}</Text>
                          </div>
                        ))}
                      </Space>
                    )}
                  </div>
                </Space>
              )}
            </Card>
          </Space>
        ) : (
          <Text type="secondary">Kein Monat gewählt.</Text>
        )}
      </Drawer>

      <div className="v2-calc-cockpit-shell">
        <div className="v2-calc-cockpit-status">
          <Space wrap>
            <Text type="secondary">Min. Kontostand: <strong>{formatCurrency(minClosing)}</strong></Text>
            <Text type="secondary">Summe Netto: <strong>{formatCurrency(totalNet)}</strong></Text>
          </Space>
          <Button size="small" onClick={resetCalculationCockpit}>Zurücksetzen</Button>
        </div>

        <div className="v2-calc-cockpit-modules" role="group" aria-label="Cockpit-Steuerung">
          <div className="v2-calc-cockpit-module">
            <Space size={6}>
              <Text strong>Portfolio-Scope</Text>
              <Tooltip title="Bestimmt, welche Produktgruppen in Umsatz, Cash-In, PnL und Kontostand einfließen. Stammdaten werden nicht verändert.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
            <div className="v2-calc-cockpit-toggle-list">
              {DASHBOARD_BUCKET_OPTIONS.map((option) => {
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
            <Text type="secondary">
              Bestimmt nur die aktuelle Berechnung im Dashboard. Mindestens eine Produktgruppe bleibt aktiv.
            </Text>
          </div>

          <div className="v2-calc-cockpit-module">
            <Space size={6}>
              <Text strong>Umsatzbasis</Text>
              <Tooltip title="Plan-Umsatz (Hybrid): MANUELL-Monate nutzen deine Overrides, AUTO-Monate kommen aus der Absatzprognose.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
            <Segmented
              block
              value={revenueBasisMode}
              onChange={(value) => {
                const nextMode = String(value) === "forecast_direct" ? "forecast_direct" : "hybrid";
                void persistDashboardCashInSettings({
                  cashInRevenueBasisMode: nextMode,
                }).catch(() => {});
              }}
              options={[
                { label: "Plan-Umsatz (Hybrid)", value: "hybrid" },
                { label: "Forecast-Umsatz (direkt)", value: "forecast_direct" },
              ]}
            />
            <Space size={8} align="center" wrap>
              <Text strong>Kalibrierung</Text>
              <Switch
                size="small"
                checked={calibrationEnabled}
                onChange={(checked) => {
                  void persistDashboardCashInSettings({
                    cashInCalibrationEnabled: checked,
                  }).catch(() => {});
                }}
              />
              <Tooltip title="Kalibrierung wirkt nur auf automatische Monate. Manuelle Monatswerte bleiben unverändert.">
                <InfoCircleOutlined />
              </Tooltip>
              <Button size="small" type="link" onClick={() => navigate("/v2/abschluss/eingaben")}>
                Cash-in Setup öffnen
              </Button>
            </Space>
            {revenueBasisMode === "forecast_direct" ? (
              <Text type="secondary">Referenzmodus: manuelle Umsatz-Overrides werden ignoriert.</Text>
            ) : null}
            {calibrationWarningMessage ? (
              <Text type="warning">
                {calibrationWarningMessage}
              </Text>
            ) : null}
          </div>

          <div className="v2-calc-cockpit-module">
            <Space size={6}>
              <Text strong>Amazon Auszahlungsquote</Text>
              <Tooltip title="Manuell nutzt deine Monatswerte. Empfohlen (Plan) berechnet die Quote aus Niveau, Saisonmuster und Sicherheitsmarge.">
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
            <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
            <Segmented
              block
              value={quoteMode}
              onChange={(value) => {
                const nextMode = String(value) === "recommendation" ? "recommendation" : "manual";
                void persistDashboardCashInSettings({
                  cashInQuoteMode: nextMode,
                }).catch(() => {});
              }}
              options={[
                { label: "Manuell", value: "manual" },
                { label: "Empfohlen (Plan)", value: "recommendation" },
              ]}
            />
            {quoteMode === "manual" ? (
              <Text type="secondary">
                Nutzt deine Monatswerte aus dem Tab Cash-in Setup.
              </Text>
            ) : (
              <Text type="secondary">
                Basiert auf aktuellem Niveau + Saisonmuster - Sicherheitsmarge.
              </Text>
            )}
            <Button size="small" type="link" onClick={() => navigate("/v2/sandbox")}>
              Sandbox öffnen
            </Button>
          </div>
        </div>
      </div>

      <Card className="v2-dashboard-chart-card">
        <Title level={4}>Kontostand & Cashflow</Title>
        <div className="v2-dashboard-chart-summary">
          <Tag color="green">Einzahlungen: {formatCurrency(totalInflow)}</Tag>
          <Tag color="red">Auszahlungen: {formatCurrency(totalOutflow)}</Tag>
          <Tag color={totalNet >= 0 ? "green" : "red"}>Netto: {formatCurrency(totalNet)}</Tag>
          {phantomFoSuggestions.length ? <Tag color="gold">PFO: {phantomFoSuggestions.length}</Tag> : null}
          {resolvedPhantomTargetMonth ? <Tag color="gold">bis {formatMonthLabel(resolvedPhantomTargetMonth)}</Tag> : null}
        </div>
        <Text type="secondary" className="v2-dashboard-chart-hint">
          Klick auf Monat oder Balken für Details. Legende ist scrollbar.
        </Text>
        <ReactECharts style={{ height: 430 }} option={chartOption} onEvents={chartEvents} />
      </Card>

      <Card>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <div>
            <Title level={4}>Monatliche PnL (Matrix)</Title>
            <Paragraph type="secondary">
              Zeilen = Einnahmen/Ausgaben-Struktur, Spalten = gewählter Zeitraum. Bei PO/FO/Phantom siehst du auf Wunsch die einzelnen Zahlungen.
            </Paragraph>
          </div>
          <Button size="small" onClick={togglePnlExpandAll}>
            {pnlAllExpanded ? "Alles zuklappen" : "Alles aufklappen"}
          </Button>
        </Space>
        <Table<PnlMatrixRow>
          className="v2-ant-table v2-dashboard-pnl-table"
          columns={pnlMatrixColumns}
          dataSource={pnlMatrixRows}
          pagination={false}
          size="small"
          rowKey="key"
          rowClassName={(row) => {
            if (row.rowType === "order") return "v2-dashboard-pnl-table-row-order";
            if (row.rowType === "payment") return "v2-dashboard-pnl-table-row-payment";
            if (row.key === "net" || row.key === "closing") return "v2-dashboard-pnl-table-row-total";
            if (Array.isArray(row.children) && row.children.length) return "v2-dashboard-pnl-table-row-group";
            return "v2-dashboard-pnl-table-row-detail";
          }}
          expandable={{
            expandedRowKeys: expandedPnlRowKeys,
            onExpandedRowsChange: (keys) => setExpandedPnlRowKeys(keys.map((key) => String(key))),
          }}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}

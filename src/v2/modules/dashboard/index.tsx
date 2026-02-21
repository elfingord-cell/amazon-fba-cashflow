import { InfoCircleOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Col,
  Drawer,
  Popover,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import ReactECharts from "echarts-for-react";
import { computeSeries } from "../../../domain/cashflow.js";
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
import { normalizePortfolioBucket, PORTFOLIO_BUCKET, PORTFOLIO_BUCKET_VALUES } from "../../../domain/portfolioBuckets.js";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";
import { getModuleExpandedCategoryKeys, hasModuleExpandedCategoryKeys, setModuleExpandedCategoryKeys } from "../../state/uiPrefs";
import { useNavigate } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;
const { CheckableTag } = Tag;

type DashboardRange = "next6" | "next12" | "next18" | "all";

type RevenueBasisMode = "forecast" | "calibrated";
type CashInQuoteMode = "manual" | "recommendation";
type CashInSafetyMode = "basis" | "conservative";
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
  "pnl",
]);

const DEFAULT_DASHBOARD_OPEN_SECTIONS = ["cashflow", "actions"];

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

function coverageStatusTag(statusKey: CoverageStatusKey): JSX.Element {
  const meta = coverageStatusMeta(statusKey);
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function criteriaStateSymbol(state: "ok" | "warn" | "fail"): string {
  if (state === "ok") return "✅";
  if (state === "warn") return "⚠️";
  return "❌";
}

function sumRows(rows: DashboardPnlRow[]): number {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function bucketLabel(value: string): string {
  const option = DASHBOARD_BUCKET_OPTIONS.find((entry) => entry.value === value);
  return option?.label || value;
}

function formatBucketScopeLabel(values: string[]): string {
  const normalized = Array.from(new Set((Array.isArray(values) ? values : [])
    .map((entry) => String(entry || ""))
    .filter((entry) => PORTFOLIO_BUCKET_VALUES.includes(entry))));
  const key = normalized.slice().sort().join("|");
  if (key === [PORTFOLIO_BUCKET.CORE].join("|")) return "Nur Kern";
  if (key === [PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN].sort().join("|")) return "Kern+Plan";
  if (normalized.length === PORTFOLIO_BUCKET_VALUES.length) return "Alles";
  return normalized.map((entry) => bucketLabel(entry)).join(", ");
}

function applyDashboardCalculationOverrides(
  sourceState: Record<string, unknown>,
  options: {
    quoteMode: CashInQuoteMode;
    safetyMode: CashInSafetyMode;
    revenueBasisMode: RevenueBasisMode;
    q4SeasonalityEnabled: boolean;
  },
): Record<string, unknown> {
  const next = structuredClone(sourceState || {});
  if (!next.settings || typeof next.settings !== "object") {
    next.settings = {};
  }
  const settings = next.settings as Record<string, unknown>;
  settings.cashInMode = options.safetyMode === "basis" ? "basis" : "conservative";
  settings.cashInCalibrationEnabled = options.revenueBasisMode === "calibrated";
  settings.cashInRecommendationIgnoreQ4 = !options.q4SeasonalityEnabled;
  if (options.quoteMode === "recommendation" && Array.isArray(next.incomings)) {
    next.incomings = (next.incomings as unknown[]).map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return {
        ...(entry as Record<string, unknown>),
        payoutPct: null,
      };
    });
  }
  return next;
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
): DashboardBreakdownRow[] {
  if (!rows.length) return [];
  const firstOpening = Number(rows[0]?.opening || 0);
  let running = firstOpening;
  return rows.map((row, index) => {
    const opening = index === 0 ? firstOpening : running;
    const scopedEntries = (Array.isArray(row.entries) ? row.entries : [])
      .filter((entry) => isEntryInBucketScope(entry, bucketScope));
    const inflow = scopedEntries
      .filter((entry) => String(entry.direction || "").toLowerCase() === "in")
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
    const outflow = scopedEntries
      .filter((entry) => String(entry.direction || "").toLowerCase() === "out")
      .reduce((sum, entry) => sum + Math.abs(Number(entry.amount || 0)), 0);
    const net = inflow - outflow;
    const closing = opening + net;
    running = closing;
    return {
      ...row,
      opening,
      inflow,
      outflow,
      net,
      closing,
      entries: scopedEntries,
    };
  });
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
  bucketScope?: Set<string>,
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
    if (bucketScope && !isEntryInBucketScope(entry, bucketScope)) return;
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

function splitInflowEntriesByType(
  entries: DashboardEntry[],
  bucketScope?: Set<string>,
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
      totals.amazon += amount;
      const entryMeta = (entry.meta && typeof entry.meta === "object")
        ? entry.meta as Record<string, unknown>
        : {};
      const cashInMeta = (entryMeta.cashIn && typeof entryMeta.cashIn === "object")
        ? entryMeta.cashIn as Record<string, unknown>
        : {};
      const component = String(cashInMeta.component || "").trim().toLowerCase();
      const bucketRaw = String(entry.portfolioBucket || entryMeta.portfolioBucket || "").trim();
      const bucket = normalizePortfolioBucket(bucketRaw, PORTFOLIO_BUCKET.CORE);
      if (source === "sales-plan" || component === "plan") {
        totals.amazonNew += amount;
      } else if (bucket === PORTFOLIO_BUCKET.CORE) {
        totals.amazonCore += amount;
      } else {
        totals.amazonPlanned += amount;
      }
    } else {
      totals.other += amount;
    }
    totals.total += amount;
  });

  return totals;
}

function buildCashInStatusTags(row: DashboardPnlRow): JSX.Element[] {
  if (row.source !== "sales") return [];
  const cashInMeta = row.cashInMeta;
  if (!cashInMeta) return [];
  const tags: JSX.Element[] = [];

  if (cashInMeta.component === "plan") {
    tags.push(<Tag key="component" color="geekblue">Plan-Produkt</Tag>);
  }

  if (cashInMeta.quoteSource === "manual") {
    tags.push(<Tag key="quote-source" color="gold">Quote manuell</Tag>);
  } else if (cashInMeta.quoteSource === "recommendation") {
    tags.push(<Tag key="quote-source" color="blue">Quote Empfehlung</Tag>);
  }

  if (cashInMeta.revenueSource === "manual_override") {
    tags.push(<Tag key="revenue-source" color="gold">Umsatz manuell</Tag>);
  } else if (cashInMeta.revenueSource === "forecast_calibrated") {
    const factor = Number(cashInMeta.calibrationFactorApplied);
    if (Number.isFinite(factor) && Math.abs(factor - 1) > 0.000001) {
      tags.push(
        <Tag key="revenue-source" color="orange">
          Kalibriert {factor.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Tag>,
      );
    } else {
      tags.push(<Tag key="revenue-source">Forecast</Tag>);
    }
  } else if (cashInMeta.revenueSource === "manual_no_forecast") {
    tags.push(<Tag key="revenue-source">Manuell (kein Forecast)</Tag>);
  }

  return tags;
}

function computeFirstNegativeRobustMonth(
  rows: DashboardBreakdownRow[],
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
  const hasStoredDashboardSections = hasModuleExpandedCategoryKeys("dashboard");
  const [range, setRange] = useState<DashboardRange>("next6");
  const [bucketScopeValues, setBucketScopeValues] = useState<string[]>(() => DEFAULT_BUCKET_SCOPE.slice());
  const [revenueBasisMode, setRevenueBasisMode] = useState<RevenueBasisMode>("forecast");
  const [quoteMode, setQuoteMode] = useState<CashInQuoteMode>("manual");
  const [safetyMode, setSafetyMode] = useState<CashInSafetyMode>("basis");
  const [q4SeasonalityEnabled, setQ4SeasonalityEnabled] = useState<boolean>(true);
  const [cockpitDetailsOpen, setCockpitDetailsOpen] = useState(false);
  const [cockpitDefaultsApplied, setCockpitDefaultsApplied] = useState(false);
  const [phantomTargetMonth, setPhantomTargetMonth] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [openPnlMonths, setOpenPnlMonths] = useState<string[]>([]);
  const [monthDetailOpen, setMonthDetailOpen] = useState(false);
  const [runtimeRouteError, setRuntimeRouteError] = useState<RuntimeRouteErrorMeta>(() => readRuntimeRouteErrorMeta());
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const stored = getModuleExpandedCategoryKeys("dashboard");
    if (!hasStoredDashboardSections) return DEFAULT_DASHBOARD_OPEN_SECTIONS.slice();
    return normalizeDashboardSectionKeys(stored);
  });

  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const methodikCalibrationEnabled = settings.cashInCalibrationEnabled !== false;
  const methodikCalibrationHorizonMonths = Math.max(1, Math.round(Number(settings.cashInCalibrationHorizonMonths || 6)));
  const methodikRecommendationIgnoreQ4 = settings.cashInRecommendationIgnoreQ4 === true;
  useEffect(() => {
    if (cockpitDefaultsApplied) return;
    setRevenueBasisMode(methodikCalibrationEnabled ? "calibrated" : "forecast");
    setQ4SeasonalityEnabled(!methodikRecommendationIgnoreQ4);
    setCockpitDefaultsApplied(true);
  }, [
    cockpitDefaultsApplied,
    methodikCalibrationEnabled,
    methodikRecommendationIgnoreQ4,
  ]);
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
      safetyMode,
      revenueBasisMode,
      q4SeasonalityEnabled,
    }),
    [planningState, q4SeasonalityEnabled, quoteMode, revenueBasisMode, safetyMode],
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
      return current.filter((month) => valid.has(month));
    });
  }, [visibleBreakdown]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("dashboard", openSections);
  }, [openSections]);

  const handleDashboardSectionsChange = (value: string | string[]) => {
    setOpenSections(normalizeDashboardSectionKeys(toActiveKeys(value)));
  };
  const openMonthDetails = useCallback((month: string) => {
    if (!month) return;
    setSelectedMonth(month);
    setMonthDetailOpen(true);
  }, []);

  const simulatedBreakdown = useMemo(
    () => visibleBreakdown.map((row) => ({ ...row })),
    [visibleBreakdown],
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
      ));
    });
    return map;
  }, [bucketScopeSet, simulatedBreakdown]);

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
  const bucketScopeLabel = useMemo(
    () => formatBucketScopeLabel(bucketScopeValues),
    [bucketScopeValues],
  );
  const revenueBasisLabel = revenueBasisMode === "calibrated" ? "Kalibrierter Umsatz" : "Forecast-Umsatz";
  const quoteModeLabel = quoteMode === "manual" ? "Manuell je Monat" : "Empfehlung";
  const safetyModeLabel = safetyMode === "basis" ? "Basis" : "Konservativ";
  const q4StatusLabel = q4SeasonalityEnabled ? "berücksichtigt" : "ignoriert";
  const q4ToggleVisible = quoteMode === "recommendation";

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

  const pnlRowsByMonth = useMemo(
    () => buildDashboardPnlRowsByMonth({
      breakdown: simulatedBreakdown,
      state: calculationState,
      provisionalFoIds: phantomFoIdSet,
    }),
    [calculationState, phantomFoIdSet, simulatedBreakdown],
  );

  const chartOption = useMemo(() => {
    const amazonCoreSeriesName = "Amazon: Kernprodukte";
    const amazonPlannedSeriesName = "Amazon: Geplante Produkte";
    const amazonNewSeriesName = "Amazon: Neue Produkte";
    const amazonSeriesNames = new Set([amazonCoreSeriesName, amazonPlannedSeriesName, amazonNewSeriesName]);
    const monthLabels = visibleMonths.map((month) => formatMonthLabel(month));
    const baseClosing = visibleBreakdown.map((row) => Number(row.closing || 0));
    const robustMask = visibleBreakdown.map((row) => Boolean(robustness.monthMap.get(row.month)?.robust));
    const robustPositive = baseClosing.map((value, idx) => (robustMask[idx] && value >= 0 ? value : null));
    const robustNegative = baseClosing.map((value, idx) => (robustMask[idx] && value < 0 ? value : null));
    const softPositive = baseClosing.map((value, idx) => (!robustMask[idx] && value >= 0 ? value : null));
    const softNegative = baseClosing.map((value, idx) => (!robustMask[idx] && value < 0 ? value : null));
    const outflowSplitSeries = simulatedBreakdown.map((row) => splitOutflowEntriesByType(
      Array.isArray(row.entries) ? row.entries : [],
      phantomFoIdSet,
      bucketScopeSet,
    ));
    const fixcostOutflowSeries = outflowSplitSeries.map((row) => -row.fixcost);
    const poOutflowSeries = outflowSplitSeries.map((row) => -row.po);
    const foOutflowSeries = outflowSplitSeries.map((row) => -row.fo);
    const phantomFoOutflowSeries = outflowSplitSeries.map((row) => -row.phantomFo);
    const cashflowLegendItems = [
      amazonCoreSeriesName,
      amazonPlannedSeriesName,
      amazonNewSeriesName,
      "Sonstige Einzahlungen",
      "Fixkosten",
      "PO",
      "FO",
      "Phantom FO",
      "Netto",
    ];
    const balanceLegendItems = [
      "Kontostand belastbar",
      "Kontostand belastbar (<0)",
      "Kontostand orientierend",
      "Kontostand orientierend (<0)",
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
      legend: [
        {
          top: 0,
          left: 0,
          itemGap: 12,
          data: cashflowLegendItems,
        },
        {
          top: 26,
          left: 0,
          itemGap: 12,
          data: balanceLegendItems,
        },
      ],
      grid: {
        left: 56,
        right: 70,
        top: 78,
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
          name: amazonCoreSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonCoreInflowSeries,
          itemStyle: { color: "#166534" },
        },
        {
          name: amazonPlannedSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonPlannedInflowSeries,
          itemStyle: { color: "#22c55e" },
        },
        {
          name: amazonNewSeriesName,
          type: "bar",
          stack: "cash",
          data: amazonNewInflowSeries,
          itemStyle: { color: "#86efac" },
        },
        {
          name: "Sonstige Einzahlungen",
          type: "bar",
          stack: "cash",
          data: otherInflowSeries,
          itemStyle: { color: "#6ee7b7" },
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
          name: "Kontostand orientierend",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: softPositive,
          lineStyle: { width: 2, type: "dashed", color: "#94a3b8" },
          itemStyle: { color: "#94a3b8" },
        },
        {
          name: "Kontostand orientierend (<0)",
          type: "line",
          smooth: true,
          yAxisIndex: 1,
          connectNulls: false,
          data: softNegative,
          lineStyle: { width: 2, type: "dashed", color: "#c2410c" },
          itemStyle: { color: "#c2410c" },
        },
      ],
    };
  }, [
    amazonCoreInflowSeries,
    amazonNewInflowSeries,
    amazonPlannedInflowSeries,
    bucketScopeSet,
    otherInflowSeries,
    phantomFoIdSet,
    robustness.monthMap,
    simulatedBreakdown,
    visibleBreakdown,
    visibleMonths,
  ]);

  const pnlItems = useMemo(() => {
    return simulatedBreakdown.map((monthRow) => {
      const monthRows = pnlRowsByMonth.get(monthRow.month) || [];
      const provisionalRows = monthRows.filter((row) => row.provisional);
      const groupedRows = PNL_GROUP_ORDER
        .map((group) => ({
          ...group,
          rows: monthRows.filter((row) => row.group === group.key),
        }))
        .filter((group) => group.rows.length > 0);

      const outflowRows = monthRows.filter((row) => row.amount < 0);
      const inflowSplit = inflowSplitByMonth.get(monthRow.month) || { amazon: 0, other: 0, total: 0 };
      const robust = robustness.monthMap.get(monthRow.month)?.robust || false;

      return {
        key: monthRow.month,
        label: (
          <div className="v2-dashboard-pnl-header">
            <Space size={6} align="center">
              <Text strong>{formatMonthLabel(monthRow.month)}</Text>
              <Button
                type="text"
                size="small"
                icon={<InfoCircleOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  openMonthDetails(monthRow.month);
                }}
              >
                Details
              </Button>
            </Space>
            <Space wrap>
              <Tag color="green">Einzahlungen: {formatCurrency(inflowSplit.total)}</Tag>
              <Tag color="green">Amazon: {formatCurrency(inflowSplit.amazon)}</Tag>
              <Tag color="lime">Sonstige: {formatCurrency(inflowSplit.other)}</Tag>
              <Tag color="red">Auszahlungen: {formatCurrency(Math.abs(sumRows(outflowRows)))}</Tag>
              {provisionalRows.length ? <Tag color="gold">Vorbehaltlich (enthalten): {formatSignedCurrency(sumRows(provisionalRows))}</Tag> : null}
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
                  const orderBuckets = Array.from(new Set(order.rows
                    .map((row) => row.portfolioBucket)
                    .filter((value): value is string => Boolean(value))));
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
                    state: calculationState,
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
                          {orderBuckets.map((bucket) => (
                            <Tag key={`${orderKey}-${bucket}`}>{bucket}</Tag>
                          ))}
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
                          <th>Bucket</th>
                          <th>Betrag</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row, index) => (
                          <tr key={`${monthRow.month}-${group.key}-${index}`}>
                            <td>{row.tooltip ? <Tooltip title={row.tooltip}>{row.label}</Tooltip> : row.label}</td>
                            <td>{row.portfolioBucket ? <Tag>{row.portfolioBucket}</Tag> : "—"}</td>
                            <td className={row.amount < 0 ? "v2-negative" : undefined}>{formatSignedCurrency(row.amount)}</td>
                            <td>
                              <Space size={6} wrap>
                                {buildCashInStatusTags(row)}
                                {row.paid == null ? <Tag>—</Tag> : row.paid ? <Tag color="green">Bezahlt</Tag> : <Tag color="gold">Offen</Tag>}
                              </Space>
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
  }, [calculationState, inflowSplitByMonth, navigate, openMonthDetails, phantomFoById, phantomFoIdSet, pnlRowsByMonth, robustness.monthMap, simulatedBreakdown]);

  function resetCalculationCockpit(): void {
    setRange("next6");
    setBucketScopeValues(DEFAULT_BUCKET_SCOPE.slice());
    setRevenueBasisMode(methodikCalibrationEnabled ? "calibrated" : "forecast");
    setQuoteMode("manual");
    setSafetyMode("basis");
    setQ4SeasonalityEnabled(true);
    setCockpitDetailsOpen(false);
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
        <div className="v2-page-head">
          <div>
            <Title level={3}>Dashboard</Title>
            <Paragraph>
              Berechnungs-Cockpit für Kontostand und Cashflow. Details öffnest du bei Bedarf in den Fach-Tabs.
            </Paragraph>
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
        </div>
        <div className="v2-toolbar">
          <Text type="secondary">
            Zeitraum: {visibleRangeLabel} ({visibleMonths.length} Monate) · PFO bis: {resolvedPhantomTargetMonth ? formatMonthLabel(resolvedPhantomTargetMonth) : "—"}
          </Text>
          <div className="v2-toolbar-row">
            <Button onClick={() => navigate("/v2/abschluss/eingaben")}>Eingaben</Button>
            <Button onClick={() => navigate("/v2/forecast")}>Forecast</Button>
            <Button onClick={() => navigate("/v2/products")}>Produkte</Button>
          </div>
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
                  <div key={criteria.key} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10 }}>
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
                          <div key={blocker.id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10 }}>
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
                          <div key={warning.id} style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10 }}>
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
                <Text type="secondary">Nur robuste Monate werden berücksichtigt</Text>
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
              <div className="v2-calc-cockpit-shell">
                <div className="v2-calc-cockpit-status">
                  <div>
                    <Text strong>Aktive Berechnung</Text>
                    <Space wrap style={{ marginTop: 6 }}>
                      <Tag>Scope: {bucketScopeLabel}</Tag>
                      <Tag>Umsatzbasis: {revenueBasisLabel}</Tag>
                      <Tag>Auszahlungsquote: {quoteModeLabel}</Tag>
                      <Tag>Sicherheitsmodus: {safetyModeLabel}</Tag>
                      {q4ToggleVisible ? <Tag>Q4: {q4StatusLabel}</Tag> : null}
                    </Space>
                  </div>
                  <div className="v2-calc-cockpit-status-right">
                    <Space wrap>
                      <Text type="secondary">Min. Kontostand: <strong>{formatCurrency(minClosing)}</strong></Text>
                      <Text type="secondary">Summe Netto: <strong>{formatCurrency(totalNet)}</strong></Text>
                    </Space>
                    <Space wrap>
                      <Popover
                        trigger="click"
                        open={cockpitDetailsOpen}
                        onOpenChange={setCockpitDetailsOpen}
                        placement="bottomRight"
                        content={(
                          <div className="v2-calc-cockpit-popover">
                            <Text strong>Aktive Einstellungen</Text>
                            <div>Scope: {bucketScopeLabel}</div>
                            <div>Umsatzbasis: {revenueBasisLabel}</div>
                            <div>Auszahlungsquote: {quoteModeLabel}</div>
                            <div>Sicherheitsmodus: {safetyModeLabel}</div>
                            {q4ToggleVisible ? <div>Q4: {q4StatusLabel}</div> : null}
                            <Text type="secondary">
                              Diese Auswahl wirkt direkt auf Umsatz, Cash-In, Netto und Kontostand im Chart.
                            </Text>
                            <Space wrap>
                              <Button size="small" type="link" onClick={() => navigate("/v2/abschluss/eingaben")}>Eingaben</Button>
                              <Button size="small" type="link" onClick={() => navigate("/v2/forecast")}>Forecast</Button>
                              <Button size="small" type="link" onClick={() => navigate("/v2/products")}>Produkte</Button>
                            </Space>
                          </div>
                        )}
                      >
                        <Button size="small">Details</Button>
                      </Popover>
                      <Button size="small" onClick={resetCalculationCockpit}>Zurücksetzen</Button>
                    </Space>
                  </div>
                </div>

                <div className="v2-calc-cockpit-modules">
                  <Card size="small" className="v2-calc-cockpit-module">
                    <Space size={6}>
                      <Text strong>Portfolio-Scope</Text>
                      <Tooltip title="Bestimmt, welche Produktgruppen in Umsatz, Cash-In, PnL und Kontostand einfließen. Stammdaten werden nicht verändert.">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Space>
                    <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
                    <div className="v2-calc-cockpit-chip-row">
                      {DASHBOARD_BUCKET_OPTIONS.map((option) => {
                        const checked = bucketScopeValues.includes(option.value);
                        return (
                          <CheckableTag
                            key={option.value}
                            checked={checked}
                            onChange={(nextChecked) => {
                              setBucketScopeValues((current) => {
                                const normalized = Array.from(new Set((current || []).filter((entry) => PORTFOLIO_BUCKET_VALUES.includes(entry))));
                                if (nextChecked) return Array.from(new Set([...normalized, option.value]));
                                const filtered = normalized.filter((entry) => entry !== option.value);
                                return filtered.length ? filtered : normalized;
                              });
                            }}
                          >
                            {option.label}
                          </CheckableTag>
                        );
                      })}
                    </div>
                    <Space wrap>
                      <Button
                        size="small"
                        type={bucketScopeValues.length === 1 && bucketScopeValues[0] === PORTFOLIO_BUCKET.CORE ? "primary" : "default"}
                        onClick={() => setBucketScopeValues([PORTFOLIO_BUCKET.CORE])}
                      >
                        Nur Kern
                      </Button>
                      <Button
                        size="small"
                        type={formatBucketScopeLabel(bucketScopeValues) === "Kern+Plan" ? "primary" : "default"}
                        onClick={() => setBucketScopeValues([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN])}
                      >
                        Kern+Plan
                      </Button>
                      <Button
                        size="small"
                        type={bucketScopeValues.length === PORTFOLIO_BUCKET_VALUES.length ? "primary" : "default"}
                        onClick={() => setBucketScopeValues(PORTFOLIO_BUCKET_VALUES.slice())}
                      >
                        Alles
                      </Button>
                    </Space>
                    <Text type="secondary">Bestimmt nur die aktuelle Berechnung im Dashboard.</Text>
                  </Card>

                  <Card size="small" className="v2-calc-cockpit-module">
                    <Space size={6}>
                      <Text strong>Umsatzbasis</Text>
                      <Tooltip title="Forecast-Umsatz = Absatzprognose × Verkaufspreis. Kalibrierter Umsatz = Forecast-Umsatz mit Kalibrierfaktor aus Eingaben.">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Space>
                    <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
                    <Segmented
                      block
                      value={revenueBasisMode}
                      onChange={(value) => setRevenueBasisMode(String(value) === "calibrated" ? "calibrated" : "forecast")}
                      options={[
                        { label: "Forecast-Umsatz", value: "forecast" },
                        { label: "Kalibrierter Umsatz", value: "calibrated" },
                      ]}
                    />
                    <Text type="secondary">
                      {revenueBasisMode === "calibrated"
                        ? `Kalibrierung aktiv (wirkt über ${methodikCalibrationHorizonMonths} Monate).`
                        : "Kalibrierung aus."}
                      {" "}
                      <Button size="small" type="link" onClick={() => navigate("/v2/abschluss/eingaben")}>
                        {revenueBasisMode === "calibrated" ? "Eingaben öffnen" : "In Eingaben aktivieren"}
                      </Button>
                    </Text>
                  </Card>

                  <Card size="small" className="v2-calc-cockpit-module">
                    <Space size={6}>
                      <Text strong>Amazon Auszahlung (Cash-In)</Text>
                      <Tooltip title="Manuell nutzt die Monatsquote aus Eingaben. Empfehlung berechnet die Quote automatisch als Vorschlag je Monat.">
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Space>
                    <div><Text type="secondary">Wirkt auf Kontostand &amp; PnL</Text></div>
                    <Segmented
                      block
                      value={quoteMode}
                      onChange={(value) => setQuoteMode(String(value) === "recommendation" ? "recommendation" : "manual")}
                      options={[
                        { label: "Manuell je Monat", value: "manual" },
                        { label: "Empfehlung", value: "recommendation" },
                      ]}
                    />
                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                      <Space size={6}>
                        <Text strong>Sicherheitsmodus</Text>
                        <Tooltip title="Basis: keine Sicherheitsmarge. Konservativ: reduziert die Quote in zukünftigen Monaten um 1pp pro Monat (max. 5pp).">
                          <InfoCircleOutlined />
                        </Tooltip>
                      </Space>
                      <Segmented
                        block
                        value={safetyMode}
                        onChange={(value) => setSafetyMode(String(value) === "conservative" ? "conservative" : "basis")}
                        options={[
                          { label: "Basis", value: "basis" },
                          { label: "Konservativ", value: "conservative" },
                        ]}
                      />
                    </Space>
                    {q4ToggleVisible ? (
                      <div className="v2-calc-cockpit-q4-row">
                        <Checkbox
                          checked={q4SeasonalityEnabled}
                          onChange={(event) => setQ4SeasonalityEnabled(event.target.checked)}
                        >
                          Saisonalität (Q4) berücksichtigen
                        </Checkbox>
                        <Tooltip title="Q4 berücksichtigt saisonale Besonderheiten für Oktober bis Dezember. Gilt nur für die Empfehlung.">
                          <InfoCircleOutlined />
                        </Tooltip>
                      </div>
                    ) : null}
                    <Text type="secondary">
                      {quoteMode === "manual"
                        ? "Verwendet die manuell gepflegte Auszahlungsquote je Monat."
                        : "Empfehlung wird je Monat automatisch berechnet und direkt im Chart angewendet."}
                    </Text>
                  </Card>
                </div>
              </div>

              <Title level={4} style={{ marginTop: 16 }}>Kontostand &amp; Cashflow</Title>
              <Space wrap>
                <Tag color="green">Einzahlungen: {formatCurrency(totalInflow)}</Tag>
                <Tag color="red">Auszahlungen: {formatCurrency(totalOutflow)}</Tag>
                <Tag color={totalNet >= 0 ? "green" : "red"}>Netto: {formatCurrency(totalNet)}</Tag>
                {phantomFoSuggestions.length ? <Tag color="gold">Phantom-FOs: {phantomFoSuggestions.length}</Tag> : null}
                {resolvedPhantomTargetMonth ? <Tag color="gold">PFO bis: {formatMonthLabel(resolvedPhantomTargetMonth)}</Tag> : null}
              </Space>
              <div className="v2-dashboard-legend-help">
                <Text type="secondary" className="v2-dashboard-legend-note">
                  Die Legende steuert nur die Sichtbarkeit von Serien. Die Berechnung bleibt unverändert.
                </Text>
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
                      {robustness.actions.slice(0, 5).map((action) => (
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
                      {robustness.actions.length > 5 ? (
                        <Button
                          size="small"
                          onClick={() => setOpenSections((current) => normalizeDashboardSectionKeys([...current, "robustness"]))}
                        >
                          Weitere Maßnahmen im Robustheits-Tab
                        </Button>
                      ) : null}
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} xl={10}>
                <Card>
                  <Title level={4}>Forecast Ops</Title>
                  <Paragraph type="secondary">
                    Kompakter Status für Forecast-Drift und operative Deeplinks.
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
                  <Space wrap>
                    <Button size="small" onClick={() => navigate("/v2/forecast")}>Forecast öffnen</Button>
                    <Button size="small" onClick={() => navigate("/v2/inventory/projektion")}>Bestandsprojektion</Button>
                    <Button size="small" onClick={() => navigate("/v2/orders/po")}>Bestellungen</Button>
                  </Space>
                </Card>
              </Col>

              <Col xs={24}>
                <Card>
                  <Title level={4}>Operative Hinweise</Title>
                  <Paragraph type="secondary">
                    Listenlastige Bearbeitung erfolgt in den Fach-Tabs. Hier siehst du nur den Schnellstatus.
                  </Paragraph>
                  <Space wrap>
                    <Tag color={poArrivalTasks.length ? "gold" : "green"}>
                      PO Wareneingang offen: {formatNumber(poArrivalTasks.length, 0)}
                    </Tag>
                    <Tag color={poArrivalTasks.some((task) => task.isOverdue) ? "red" : "green"}>
                      Überfällig: {formatNumber(poArrivalTasks.filter((task) => task.isOverdue).length, 0)}
                    </Tag>
                    <Button size="small" onClick={() => navigate("/v2/orders/po")}>PO-Tab öffnen</Button>
                    <Button size="small" onClick={() => navigate("/v2/abschluss/eingaben")}>Eingaben öffnen</Button>
                  </Space>
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
                      onClick={() => openMonthDetails(month.month)}
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
    </div>
  );
}

import { computeForecastImpact, type FoImpactConflictRow } from "./forecastImpact";
import {
  buildDashboardRobustness,
  type CoverageStatusKey,
  type DashboardRobustMonth,
  type ProjectionSafetyIssueType,
  type RobustnessBlocker,
  type RobustnessCheckResult,
  type RobustnessCheckStatus,
  type RobustnessCoverageOrderDutyIssue,
  type RobustnessCoverageStockIssue,
  type RobustnessSeverity,
} from "./dashboardRobustness";
import {
  ensureForecastVersioningContainers,
  getActiveForecastVersion,
  type ForecastVersionRecord,
} from "./forecastVersioning";
import {
  buildPhantomFoWorklist,
  type PhantomFoWorklistEntry,
} from "./phantomFo";
import { currentMonthKey, monthIndex, normalizeMonthKey } from "./months";
import {
  resolvePfoWorklistDecisionById,
  resolveShortageAcceptancesBySku,
  type PfoWorklistDecision,
  type ShortageAcceptanceOverride,
  type ShortageIssueType,
} from "./pfoShared";
import { buildForecastConflictSummary } from "./forecastConflictActions";

export type MonthPlanningCheckKey = RobustnessCheckResult["key"] | "forecast_conflicts";
export type MonthReviewItemType =
  | "inventory_order_required"
  | "inventory_risk_acceptance_required"
  | "overdue_order_decision"
  | "cash_in_missing"
  | "revenue_input_missing"
  | "fixcost_missing"
  | "vat_missing"
  | "forecast_conflict_relevant"
  | "master_data_blocking";
export type MonthReviewItemStatus = "open" | "accepted" | "converted";
export type MonthReviewActionKind = "inventory_order" | "inventory_risk" | "forecast_conflict" | "specialist";

export interface MonthPlanningCheckResult extends Omit<RobustnessCheckResult, "key"> {
  key: MonthPlanningCheckKey;
}

export interface MonthPlanningBlocker extends Omit<RobustnessBlocker, "checkKey"> {
  checkKey: MonthPlanningCheckKey;
  foId?: string;
  conflictTypes?: string[];
  sourceKind?: "forecast_missing" | "fo_conflict";
  currentUnits?: number;
  currentTargetDeliveryDate?: string;
  currentEtaDate?: string;
  recommendedArrivalDate?: string;
  recommendedUnits?: number;
}

export interface MonthReviewItem {
  id: string;
  type: MonthReviewItemType;
  status: MonthReviewItemStatus;
  severity: RobustnessSeverity;
  month: string;
  impactMonth: string;
  title: string;
  detail: string;
  route: string;
  sortDate: string;
  overdue: boolean;
  isOverdue: boolean;
  actionKind: MonthReviewActionKind;
  sku?: string;
  alias?: string;
  abcClass?: "A" | "B" | "C";
  issueType?: ProjectionSafetyIssueType | ShortageIssueType | "order_duty";
  latestOrderDate?: string;
  recommendedOrderDate?: string;
  requiredArrivalDate?: string;
  recommendedArrivalDate?: string;
  suggestedUnits?: number | null;
  foId?: string;
  conflictTypes?: string[];
  conflictSummary?: string;
  sourceKind?: "coverage" | "fo_conflict" | "acceptance" | "converted";
  currentUnits?: number | null;
  currentTargetDeliveryDate?: string | null;
  currentEtaDate?: string | null;
}

export interface MonthPlanningCard {
  key: "inventory" | "cash_in" | "fixcost_vat" | "forecast_conflicts" | "revenue_masterdata";
  label: string;
  status: "ok" | "warn" | "fail";
  count: number;
  detail: string;
}

export interface MonthPlanningMonth extends Omit<DashboardRobustMonth, "checks" | "blockers" | "blockerCount"> {
  checks: MonthPlanningCheckResult[];
  blockers: MonthPlanningBlocker[];
  blockerCount: number;
  reviewItems: MonthReviewItem[];
  progressDone: number;
  progressTotal: number;
  statusLabel: "Robust" | "Nicht robust";
  forecastConflictCount: number;
  cards: MonthPlanningCard[];
}

export interface MonthPlanningResult {
  months: MonthPlanningMonth[];
  monthMap: Map<string, MonthPlanningMonth>;
}

interface BuildMonthPlanningInput {
  state: Record<string, unknown>;
  months: string[];
}

interface ForecastImpactSummaryLike {
  fromVersionId: string | null;
  toVersionId: string | null;
}

interface OpenForecastConflict extends FoImpactConflictRow {
  actionMonth: string | null;
}

function normalizeImpactSummary(value: unknown): ForecastImpactSummaryLike | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const toVersionId = raw.toVersionId == null ? null : String(raw.toVersionId || "").trim() || null;
  if (!toVersionId) return null;
  return {
    fromVersionId: raw.fromVersionId == null ? null : String(raw.fromVersionId || "").trim() || null,
    toVersionId,
  };
}

function normalizeSkuKey(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function actionMonthFromConflict(conflict: FoImpactConflictRow): string | null {
  const orderMonth = normalizeMonthKey(String(conflict.recommendedOrderDate || "").slice(0, 7));
  if (orderMonth) return orderMonth;
  const requiredMonth = normalizeMonthKey(conflict.requiredArrivalMonth);
  if (requiredMonth) return requiredMonth;
  return normalizeMonthKey(conflict.recommendedArrivalMonth);
}

function buildOpenForecastConflicts(state: Record<string, unknown>): OpenForecastConflict[] {
  const forecastState = structuredClone(
    (state.forecast && typeof state.forecast === "object") ? state.forecast : {},
  ) as Record<string, unknown>;
  ensureForecastVersioningContainers(forecastState);

  const activeVersion = getActiveForecastVersion(forecastState as Record<string, unknown>) as ForecastVersionRecord | null;
  const summary = normalizeImpactSummary(forecastState.lastImpactSummary);
  if (!activeVersion || !summary || summary.toVersionId !== activeVersion.id) return [];

  const versions = Array.isArray(forecastState.versions)
    ? forecastState.versions as ForecastVersionRecord[]
    : [];
  const fromVersion = summary.fromVersionId
    ? (versions.find((entry) => entry.id === summary.fromVersionId) || null)
    : null;
  const impact = computeForecastImpact({
    state,
    fromVersion,
    toVersion: activeVersion,
    nowMonth: currentMonthKey(),
  });
  const allDecisions = (
    forecastState.foConflictDecisionsByVersion
    && typeof forecastState.foConflictDecisionsByVersion === "object"
  )
    ? forecastState.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
    : {};
  const decisionsForVersion = allDecisions[activeVersion.id] || {};

  return impact.foConflicts
    .filter((conflict) => {
      const raw = decisionsForVersion[conflict.foId];
      return !(raw && typeof raw === "object" && (raw as Record<string, unknown>).ignored === true);
    })
    .map((conflict) => ({
      ...conflict,
      actionMonth: actionMonthFromConflict(conflict),
    }));
}

function isMonthClosed(state: Record<string, unknown>, month: string): boolean {
  const monthlyActuals = (state.monthlyActuals && typeof state.monthlyActuals === "object")
    ? state.monthlyActuals as Record<string, Record<string, unknown>>
    : {};
  const entry = monthlyActuals[month];
  if (!entry || typeof entry !== "object") return false;
  return Number.isFinite(Number(entry.realRevenueEUR))
    && Number.isFinite(Number(entry.realPayoutRatePct))
    && Number.isFinite(Number(entry.realClosingBalanceEUR));
}

export function isMonthPlanningReadOnly(state: Record<string, unknown>, month: string): boolean {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return false;
  const currentIdx = monthIndex(currentMonthKey());
  const targetIdx = monthIndex(normalized);
  if (targetIdx != null && currentIdx != null && targetIdx < currentIdx) return true;
  return isMonthClosed(state, normalized);
}

function issueTypeToReviewType(issueType: ProjectionSafetyIssueType): MonthReviewItemType {
  if (issueType === "forecast_missing") return "forecast_conflict_relevant";
  return "inventory_risk_acceptance_required";
}

function formatForecastConflictLabel(conflict: OpenForecastConflict): string {
  const conflictLabel = buildForecastConflictSummary(conflict.conflictTypes) || "Forecast-Konflikt";
  return `${conflict.sku} (${conflict.alias}): ${conflictLabel}.`;
}

function buildForecastConflictBlockers(month: string, conflicts: OpenForecastConflict[]): MonthPlanningBlocker[] {
  return conflicts.map((conflict, index) => ({
    id: `forecast_conflicts:${month}:${conflict.foId}:${index}`,
    month,
    checkKey: "forecast_conflicts",
    severity: "error",
    message: formatForecastConflictLabel(conflict),
    sku: conflict.sku,
    alias: conflict.alias,
    abcClass: conflict.abcClass,
    issueType: "order_duty",
    latestOrderDate: conflict.recommendedOrderDate || undefined,
    recommendedOrderDate: conflict.recommendedOrderDate || undefined,
    requiredArrivalDate: conflict.requiredArrivalDate || conflict.recommendedArrivalDate || undefined,
    route: "/v2/forecast?panel=conflicts",
    foId: conflict.foId,
    conflictTypes: conflict.conflictTypes.slice(),
    sourceKind: "fo_conflict",
    currentUnits: conflict.currentUnits,
    currentTargetDeliveryDate: conflict.currentTargetDeliveryDate || undefined,
    currentEtaDate: conflict.currentEtaDate || undefined,
    recommendedArrivalDate: conflict.recommendedArrivalDate || undefined,
    recommendedUnits: conflict.recommendedUnits,
  }));
}

function resolveActionKind(type: MonthReviewItemType): MonthReviewActionKind {
  if (type === "inventory_order_required" || type === "overdue_order_decision") return "inventory_order";
  if (type === "inventory_risk_acceptance_required") return "inventory_risk";
  if (type === "forecast_conflict_relevant") return "forecast_conflict";
  return "specialist";
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildForecastConflictCheck(conflicts: OpenForecastConflict[]): MonthPlanningCheckResult {
  return {
    key: "forecast_conflicts",
    label: "Forecast-Konflikte",
    status: conflicts.length ? "error" : "ok",
    passed: conflicts.length === 0,
    detail: conflicts.length
      ? `${conflicts.length} offene FO-Konflikt(e) mit Handlungsbedarf im Review-Monat.`
      : "Keine offenen Forecast-Konflikte.",
    blockerCount: conflicts.length,
    route: "/v2/forecast?panel=conflicts",
  };
}

function buildOpenInventoryItems(input: {
  month: string;
  source: DashboardRobustMonth;
  worklist: PhantomFoWorklistEntry[];
}): MonthReviewItem[] {
  const seenRiskKeys = new Set(
    input.worklist.map((entry) => `${normalizeSkuKey(entry.sku)}::${entry.issueType}`),
  );
  const orderItems = input.worklist.map((entry) => buildWorklistReviewItem(input.month, entry));
  const stockItems = input.source.coverage.stockIssues
    .filter((entry) => {
      const riskKey = `${normalizeSkuKey(entry.sku)}::${entry.issueType === "stock_oos" ? "stock_oos" : "stock_under_safety"}`;
      if (entry.issueType !== "stock_oos" && entry.issueType !== "stock_under_safety" && entry.issueType !== "forecast_missing") {
        return false;
      }
      if (entry.firstBreachMonth && entry.firstBreachMonth !== input.month) return false;
      return !seenRiskKeys.has(riskKey) || entry.issueType === "forecast_missing";
    })
    .map((entry, index) => ({
      id: `stock:${input.month}:${entry.sku}:${entry.issueType}:${index}`,
      type: issueTypeToReviewType(entry.issueType),
      status: "open",
      severity: "error",
      month: input.month,
      impactMonth: entry.firstBreachMonth || input.month,
      title: `${entry.sku} (${entry.alias})`,
      detail: entry.issueType === "forecast_missing"
        ? "Forecast fehlt für den relevanten Monat."
        : `${entry.issueLabel} ab ${entry.firstBreachMonth || input.month}.`,
      route: entry.issueType === "forecast_missing"
        ? `/v2/forecast?sku=${encodeURIComponent(entry.sku)}&month=${encodeURIComponent(entry.firstBreachMonth || input.month)}`
        : `/v2/inventory/projektion?sku=${encodeURIComponent(entry.sku)}&month=${encodeURIComponent(entry.firstBreachMonth || input.month)}`,
      sortDate: `${entry.firstBreachMonth || input.month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: resolveActionKind(issueTypeToReviewType(entry.issueType)),
      sku: entry.sku,
      alias: entry.alias,
      abcClass: entry.abcClass,
      issueType: entry.issueType,
      sourceKind: "coverage",
    } satisfies MonthReviewItem));
  return [...orderItems, ...stockItems];
}

function buildWorklistReviewItem(month: string, entry: PhantomFoWorklistEntry): MonthReviewItem {
  return {
    id: entry.key,
    type: entry.overdue ? "overdue_order_decision" : "inventory_order_required",
    status: "open",
    severity: "error",
    month,
    impactMonth: entry.firstRiskMonth,
    title: `${entry.sku} (${entry.alias || entry.sku})`,
    detail: `Bestellpflicht ${entry.overdue ? "überfällig" : "fällig"} bis ${entry.latestOrderDate}.`,
    route: "/v2/orders/fo",
    sortDate: entry.orderDateIso || entry.latestOrderDate || entry.recommendedOrderDate || entry.requiredArrivalDate || `${entry.orderMonth}-01`,
    overdue: entry.overdue,
    isOverdue: entry.overdue,
    actionKind: resolveActionKind(entry.overdue ? "overdue_order_decision" : "inventory_order_required"),
    sku: entry.sku,
    alias: entry.alias,
    abcClass: entry.abcClass,
    issueType: entry.issueType,
    latestOrderDate: entry.latestOrderDate,
    recommendedOrderDate: entry.recommendedOrderDate,
    requiredArrivalDate: entry.requiredArrivalDate,
    suggestedUnits: entry.suggestedUnits,
    sourceKind: "coverage",
  };
}

function buildFinanceAndDataItems(month: string, blockers: MonthPlanningBlocker[]): MonthReviewItem[] {
  return blockers.flatMap((blocker, index) => {
    if (blocker.checkKey === "cash_in") {
      return [{
        id: `cash-in:${month}:${index}`,
        type: "cash_in_missing",
        status: "open",
        severity: blocker.severity,
        month,
        impactMonth: month,
        title: "Cash-in Setup fehlt",
        detail: blocker.message,
        route: blocker.route,
      sortDate: `${month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: "specialist",
    } satisfies MonthReviewItem];
    }
    if (blocker.checkKey === "fixcost") {
      return [{
        id: `fixcost:${month}:${index}`,
        type: "fixcost_missing",
        status: "open",
        severity: blocker.severity,
        month,
        impactMonth: month,
        title: "Fixkostenbasis fehlt",
        detail: blocker.message,
        route: blocker.route,
      sortDate: `${month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: "specialist",
    } satisfies MonthReviewItem];
    }
    if (blocker.checkKey === "vat") {
      return [{
        id: `vat:${month}:${index}`,
        type: "vat_missing",
        status: "open",
        severity: blocker.severity,
        month,
        impactMonth: month,
        title: "USt-/Tax-Basis fehlt",
        detail: blocker.message,
        route: blocker.route,
      sortDate: `${month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: "specialist",
    } satisfies MonthReviewItem];
    }
    if (blocker.checkKey === "revenue_inputs") {
      const type = blocker.message.includes("Stammdaten unvollständig")
        ? "master_data_blocking"
        : "revenue_input_missing";
      return [{
        id: `${type}:${month}:${blocker.sku || "global"}:${index}`,
        type,
        status: "open",
        severity: blocker.severity,
        month,
        impactMonth: month,
        title: blocker.sku ? `${blocker.sku} (${blocker.alias || blocker.sku})` : "Produktdaten prüfen",
        detail: blocker.message,
        route: blocker.route,
      sortDate: `${month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: "specialist",
      sku: blocker.sku,
      alias: blocker.alias,
      abcClass: blocker.abcClass,
      } satisfies MonthReviewItem];
    }
    if (blocker.checkKey === "forecast_conflicts") {
      const latestOrderDate = blocker.latestOrderDate;
      const isOverdue = Boolean(latestOrderDate && latestOrderDate < isoToday());
      return [{
        id: `forecast-conflict:${month}:${blocker.foId || index}`,
        type: "forecast_conflict_relevant",
        status: "open",
        severity: blocker.severity,
        month,
        impactMonth: month,
        title: blocker.sku ? `${blocker.sku} (${blocker.alias || blocker.sku})` : "Forecast-Konflikt",
        detail: `Bestehende FO passt nicht mehr zum Forecast. ${buildForecastConflictSummary(blocker.conflictTypes) || blocker.message}`,
        route: blocker.route,
        sortDate: blocker.recommendedOrderDate || blocker.latestOrderDate || blocker.requiredArrivalDate || `${month}-01`,
        overdue: isOverdue,
        isOverdue,
        actionKind: "forecast_conflict",
        sku: blocker.sku,
        alias: blocker.alias,
        abcClass: blocker.abcClass,
        latestOrderDate: blocker.latestOrderDate,
        recommendedOrderDate: blocker.recommendedOrderDate,
        requiredArrivalDate: blocker.requiredArrivalDate,
        recommendedArrivalDate: blocker.recommendedArrivalDate,
        foId: blocker.foId,
        conflictTypes: blocker.conflictTypes,
        conflictSummary: buildForecastConflictSummary(blocker.conflictTypes),
        sourceKind: blocker.sourceKind === "fo_conflict" ? "fo_conflict" : "coverage",
        suggestedUnits: blocker.recommendedUnits != null ? blocker.recommendedUnits : null,
        currentUnits: blocker.currentUnits ?? null,
        currentTargetDeliveryDate: blocker.currentTargetDeliveryDate || null,
        currentEtaDate: blocker.currentEtaDate || null,
      } satisfies MonthReviewItem];
    }
    return [];
  });
}

function buildAcceptedItems(month: string, acceptances: Map<string, ShortageAcceptanceOverride[]>): MonthReviewItem[] {
  const items: MonthReviewItem[] = [];
  const todayMonth = currentMonthKey();
  acceptances.forEach((entries) => {
    entries.forEach((entry, index) => {
      const showInCurrentReview = month === todayMonth && entry.acceptedFromMonth > month;
      if (!showInCurrentReview && (month < entry.acceptedFromMonth || month > entry.acceptedUntilMonth)) return;
      items.push({
        id: `accepted:${month}:${entry.sku}:${entry.reason}:${index}`,
        type: "inventory_risk_acceptance_required",
        status: "accepted",
        severity: "warning",
        month,
        impactMonth: month,
        title: `${entry.sku}: Risiko akzeptiert`,
        detail: `${entry.reason === "stock_oos" ? "OOS" : "Unter Safety"} akzeptiert bis ${entry.acceptedUntilMonth}.`,
        route: "/v2/sku-planung",
        sortDate: `${entry.acceptedFromMonth}-01`,
        overdue: false,
        isOverdue: false,
        actionKind: "inventory_risk",
        sku: entry.sku,
        issueType: entry.reason,
        sourceKind: "acceptance",
      });
    });
  });
  return items;
}

function buildConvertedItems(month: string, decisions: Map<string, PfoWorklistDecision>): MonthReviewItem[] {
  const items: MonthReviewItem[] = [];
  decisions.forEach((entry) => {
    if (entry.orderMonth !== month && entry.firstRiskMonth !== month) return;
    items.push({
      id: `converted:${month}:${entry.id}`,
      type: entry.orderMonth < month ? "overdue_order_decision" : "inventory_order_required",
      status: "converted",
      severity: "warning",
      month,
      impactMonth: entry.firstRiskMonth || month,
      title: `${entry.sku}: In FO übernommen`,
      detail: `Bestandsfall wurde bereits als FO übernommen.`,
      route: "/v2/orders/fo",
      sortDate: `${entry.orderMonth || month}-01`,
      overdue: false,
      isOverdue: false,
      actionKind: "inventory_order",
      sku: entry.sku,
      issueType: entry.issueType,
      sourceKind: "converted",
    });
  });
  return items;
}

function reviewSeverityWeight(value: RobustnessSeverity): number {
  return value === "error" ? 0 : 1;
}

function reviewStatusWeight(value: MonthReviewItemStatus): number {
  if (value === "open") return 0;
  if (value === "accepted") return 1;
  return 2;
}

function abcWeight(value: MonthReviewItem["abcClass"]): number {
  if (value === "A") return 0;
  if (value === "B") return 1;
  return 2;
}

function sortReviewItems(items: MonthReviewItem[]): MonthReviewItem[] {
  return items.slice().sort((left, right) => {
    const byStatus = reviewStatusWeight(left.status) - reviewStatusWeight(right.status);
    if (byStatus !== 0) return byStatus;
    const byOverdue = Number(right.overdue) - Number(left.overdue);
    if (byOverdue !== 0) return byOverdue;
    const bySortDate = String(left.sortDate || "").localeCompare(String(right.sortDate || ""));
    if (bySortDate !== 0) return bySortDate;
    const bySeverity = reviewSeverityWeight(left.severity) - reviewSeverityWeight(right.severity);
    if (bySeverity !== 0) return bySeverity;
    const byAbc = abcWeight(left.abcClass) - abcWeight(right.abcClass);
    if (byAbc !== 0) return byAbc;
    return String(left.sku || left.title).localeCompare(String(right.sku || right.title), "de-DE", { sensitivity: "base" });
  });
}

function buildCards(input: {
  month: MonthPlanningMonth;
}): MonthPlanningCard[] {
  const inventoryCount = input.month.reviewItems.filter((entry) => (
    entry.status === "open"
    && (
      entry.type === "inventory_order_required"
      || entry.type === "overdue_order_decision"
      || entry.type === "inventory_risk_acceptance_required"
    )
  )).length;
  const cashInCount = input.month.reviewItems.filter((entry) => entry.status === "open" && entry.type === "cash_in_missing").length;
  const fixcostVatCount = input.month.reviewItems.filter((entry) => (
    entry.status === "open"
    && (entry.type === "fixcost_missing" || entry.type === "vat_missing")
  )).length;
  const forecastCount = input.month.reviewItems.filter((entry) => entry.status === "open" && entry.type === "forecast_conflict_relevant").length;
  const revenueCount = input.month.reviewItems.filter((entry) => (
    entry.status === "open"
    && (entry.type === "revenue_input_missing" || entry.type === "master_data_blocking")
  )).length;
  return [
    {
      key: "inventory",
      label: "Inventory",
      status: inventoryCount === 0 ? "ok" : (input.month.coverage.overdueOrderDutySkuCount > 0 ? "fail" : "warn"),
      count: inventoryCount,
      detail: inventoryCount === 0 ? "Keine offenen Bestandsentscheidungen." : `${inventoryCount} offene Bestandsfälle.`,
    },
    {
      key: "cash_in",
      label: "Cash-in",
      status: cashInCount === 0 ? "ok" : "fail",
      count: cashInCount,
      detail: cashInCount === 0 ? "Cash-in Basis vorhanden." : `${cashInCount} offener Cash-in Blocker.`,
    },
    {
      key: "fixcost_vat",
      label: "Fixkosten / VAT",
      status: fixcostVatCount === 0 ? "ok" : "fail",
      count: fixcostVatCount,
      detail: fixcostVatCount === 0 ? "Fixkosten und VAT vorhanden." : `${fixcostVatCount} offene Finanzblocker.`,
    },
    {
      key: "forecast_conflicts",
      label: "Forecast-Konflikte",
      status: forecastCount === 0 ? "ok" : "fail",
      count: forecastCount,
      detail: forecastCount === 0 ? "Keine offenen Forecast-Konflikte." : `${forecastCount} Forecast-Thema mit Handlungsbedarf.`,
    },
    {
      key: "revenue_masterdata",
      label: "Revenue / Stammdaten",
      status: revenueCount === 0 ? "ok" : "fail",
      count: revenueCount,
      detail: revenueCount === 0 ? "Keine Produktdaten- oder Revenue-Blocker." : `${revenueCount} offene Produktdaten-/Revenue-Blocker.`,
    },
  ];
}

export function buildMonthPlanningResult(input: BuildMonthPlanningInput): MonthPlanningResult {
  const months = input.months.map((entry) => normalizeMonthKey(entry)).filter(Boolean) as string[];
  const todayMonth = currentMonthKey();
  const robustness = buildDashboardRobustness({ state: input.state, months });
  const acceptances = resolveShortageAcceptancesBySku(
    (input.state.settings && typeof input.state.settings === "object")
      ? input.state.settings as Record<string, unknown>
      : {},
  );
  const decisions = resolvePfoWorklistDecisionById(
    (input.state.settings && typeof input.state.settings === "object")
      ? input.state.settings as Record<string, unknown>
      : {},
  );
  const forecastConflicts = buildOpenForecastConflicts(input.state);
  const inventoryWorklistsByMonth = new Map<string, PhantomFoWorklistEntry[]>(
    months.map((month) => [month, buildPhantomFoWorklist({
      state: input.state,
      baseMonth: month,
      windowMonths: 1,
      months,
    })]),
  );

  const planningMonths = robustness.months.map((monthEntry) => {
    const monthForecastConflicts = forecastConflicts.filter((entry) => (
      entry.actionMonth === monthEntry.month
      || (
        entry.actionMonth
        && entry.actionMonth < todayMonth
        && monthEntry.month === todayMonth
      )
    ));
    const forecastBlockers = buildForecastConflictBlockers(monthEntry.month, monthForecastConflicts);
    const checks: MonthPlanningCheckResult[] = [
      ...(monthEntry.checks as MonthPlanningCheckResult[]),
      buildForecastConflictCheck(monthForecastConflicts),
    ];
    const blockers: MonthPlanningBlocker[] = [
      ...(monthEntry.blockers as MonthPlanningBlocker[]),
      ...forecastBlockers,
    ];
    const reviewItems = sortReviewItems([
      ...buildOpenInventoryItems({
        month: monthEntry.month,
        source: monthEntry,
        worklist: inventoryWorklistsByMonth.get(monthEntry.month) || [],
      }),
      ...buildFinanceAndDataItems(monthEntry.month, blockers),
      ...buildAcceptedItems(monthEntry.month, acceptances),
      ...buildConvertedItems(monthEntry.month, decisions),
    ]);
    const progressTotal = reviewItems.length;
    const progressDone = reviewItems.filter((entry) => entry.status === "accepted" || entry.status === "converted").length;
    const nextMonth: MonthPlanningMonth = {
      ...monthEntry,
      robust: monthEntry.robust && monthForecastConflicts.length === 0,
      checks,
      blockers,
      blockerCount: blockers.filter((entry) => entry.severity === "error").length,
      reviewItems,
      progressDone,
      progressTotal,
      statusLabel: monthEntry.robust && monthForecastConflicts.length === 0 ? "Robust" : "Nicht robust",
      forecastConflictCount: monthForecastConflicts.length,
      cards: [],
    };
    nextMonth.cards = buildCards({ month: nextMonth });
    return nextMonth;
  });
  return {
    months: planningMonths,
    monthMap: new Map(planningMonths.map((entry) => [entry.month, entry])),
  };
}

import { computeAbcClassification } from "../../domain/abcClassification.js";
import {
  computeInventoryProjection,
  getProjectionSafetyClass,
} from "../../domain/inventoryProjection.js";
import { parseDeNumber } from "../../lib/dataHealth.js";
import { normalizeIncludeInForecast } from "../../domain/portfolioBuckets.js";
import { resolveMasterDataHierarchy } from "./masterDataHierarchy";
import { addMonths, currentMonthKey } from "./months";
import { evaluateProductCompletenessV2 } from "./productCompletenessV2";

export type RobustnessSeverity = "error" | "warning";
export type RobustnessCheckStatus = "ok" | "error";
export type RobustnessCheckKey = "sku_coverage" | "cash_in" | "fixcost" | "vat" | "revenue_inputs";
export type CoverageStatusKey = "full" | "wide" | "partial" | "insufficient";
export type ProjectionSafetyIssueType = "forecast_missing" | "stock_oos" | "stock_under_safety";
export type ProjectionModeForCoverage = "units" | "doh";

const COVERAGE_THRESHOLDS = {
  wide: 0.95,
  partial: 0.8,
} as const;

const COVERAGE_STATUS_META: Record<CoverageStatusKey, {
  label: string;
  detail: string;
}> = {
  full: {
    label: "Vollständig",
    detail: "Coverage 100% und keine Blocker.",
  },
  wide: {
    label: "Weitgehend",
    detail: "Coverage ≥95% und keine A/B-Blocker.",
  },
  partial: {
    label: "Teilweise",
    detail: "Coverage ≥80%.",
  },
  insufficient: {
    label: "Unzureichend",
    detail: "Coverage <80% oder A/B-Blocker.",
  },
};

export interface RobustnessCheckResult {
  key: RobustnessCheckKey;
  label: string;
  status: RobustnessCheckStatus;
  passed: boolean;
  detail: string;
  blockerCount: number;
  route: string;
}

export interface RobustnessCoverageStockIssue {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  issueType: ProjectionSafetyIssueType;
  issueLabel: string;
  value: number | null;
  safetyValue: number | null;
  projectionMode: ProjectionModeForCoverage;
}

export interface RobustnessCoverageOrderDutyIssue {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  firstRiskMonth: string;
  latestOrderDate: string;
  orderMonth: string;
  leadTimeDays: number;
  overdue: boolean;
  requiredArrivalDate: string;
  recommendedOrderDate: string;
  shortageUnits: number | null;
  reason: string;
}

export interface RobustnessBlocker {
  id: string;
  month: string;
  checkKey: RobustnessCheckKey;
  severity: RobustnessSeverity;
  message: string;
  sku?: string;
  alias?: string;
  abcClass?: "A" | "B" | "C";
  issueType?: ProjectionSafetyIssueType | "order_duty";
  firstRiskMonth?: string;
  latestOrderDate?: string;
  orderMonth?: string;
  leadTimeDays?: number;
  overdue?: boolean;
  requiredArrivalDate?: string;
  recommendedOrderDate?: string;
  suggestedUnits?: number | null;
  route: string;
}

export interface DashboardRobustMonth {
  month: string;
  robust: boolean;
  checks: RobustnessCheckResult[];
  blockers: RobustnessBlocker[];
  blockerCount: number;
  coverage: {
    statusKey: CoverageStatusKey;
    statusLabel: string;
    statusDetail: string;
    projectionMode: ProjectionModeForCoverage;
    activeSkus: number;
    coveredSkus: number;
    ratio: number;
    blockerCount: number;
    blockerAbCount: number;
    blockerCCount: number;
    stockIssueCount: number;
    orderDutyIssueCount: number;
    overdueOrderDutySkuCount: number;
    missingForecastSkus: string[];
    safetyRiskSkus: string[];
    orderDutyRiskSkus: string[];
    stockIssues: RobustnessCoverageStockIssue[];
    orderDutyIssues: RobustnessCoverageOrderDutyIssue[];
    abRiskSkuCount: number;
  };
}

export interface DashboardActionItem {
  id: string;
  title: string;
  detail: string;
  severity: RobustnessSeverity;
  route: string;
  count: number;
  impact: string;
}

export interface DashboardRobustnessResult {
  months: DashboardRobustMonth[];
  monthMap: Map<string, DashboardRobustMonth>;
  actions: DashboardActionItem[];
  robustUntilMonth: string | null;
  robustMonthsCount: number;
  totalMonths: number;
  activeSkuCount: number;
}

interface BuildDashboardRobustnessInput {
  state: Record<string, unknown>;
  months: string[];
}

interface ProductRef {
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
}

interface VatConfigInfo {
  active: boolean;
  defaults: Record<string, unknown>;
  monthOverrides: Record<string, unknown>;
}

interface ProjectionMonthData {
  hasForecast?: boolean;
  isCovered?: boolean;
  endAvailable?: number | null;
  safetyUnits?: number | null;
  doh?: number | null;
  safetyDays?: number | null;
}

interface ProjectionCoverageLookup {
  perSkuMonth: Map<string, Map<string, ProjectionMonthData>>;
}

interface LeadTimeResolution {
  productionDays: number;
  transitDays: number;
  totalDays: number;
  transportMode: string;
  ddp: boolean;
}

interface OrderDutyProfile {
  sku: string;
  firstRiskMonth: string;
  latestOrderDate: string;
  orderMonth: string;
  leadTimeDays: number;
  overdue: boolean;
  requiredArrivalDate: string;
  recommendedOrderDate: string;
  shortageUnits: number | null;
}

type ProjectionRiskClass = "" | "safety-negative" | "safety-low";

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSkuKey(value: unknown): string {
  return normalizeSku(value).toLowerCase();
}

function isActiveProduct(product: Record<string, unknown>): boolean {
  if (!normalizeIncludeInForecast(product.includeInForecast, true)) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function isMonth(value: unknown): boolean {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function hasInput(value: unknown): boolean {
  return value != null && String(value).trim() !== "";
}

function toNumber(value: unknown): number | null {
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed as number)) return null;
  if (Number(parsed) <= 0) return null;
  return Math.round(Number(parsed));
}

function toMonthStartDate(month: string): Date | null {
  if (!isMonth(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return null;
  return new Date(Date.UTC(year, monthNumber - 1, 1));
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function resolveAbcClass(
  abcBySku: Map<string, { abcClass?: string }>,
  sku: string,
): "A" | "B" | "C" {
  const direct = abcBySku.get(sku);
  const normalized = abcBySku.get(normalizeSkuKey(sku));
  const candidate = String(direct?.abcClass || normalized?.abcClass || "C").toUpperCase();
  if (candidate === "A" || candidate === "B" || candidate === "C") return candidate;
  return "C";
}

function resolveProjectionModeForCoverage(state: Record<string, unknown>): ProjectionModeForCoverage {
  const inventory = (state.inventory && typeof state.inventory === "object")
    ? state.inventory as Record<string, unknown>
    : {};
  const inventorySettings = (inventory.settings && typeof inventory.settings === "object")
    ? inventory.settings as Record<string, unknown>
    : {};
  return String(inventorySettings.projectionMode || "").toLowerCase() === "doh" ? "doh" : "units";
}

function coveragePercentLabel(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0.0%";
  const value = Math.max(0, Math.min(100, ratio * 100));
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function projectionRiskClass(
  monthData: ProjectionMonthData | undefined,
  projectionMode: ProjectionModeForCoverage,
): ProjectionRiskClass {
  if (!monthData || !monthData.hasForecast) return "";
  return getProjectionSafetyClass({
    projectionMode,
    endAvailable: monthData.endAvailable,
    safetyUnits: monthData.safetyUnits,
    doh: monthData.doh,
    safetyDays: monthData.safetyDays,
  }) as ProjectionRiskClass;
}

function stockIssueType(
  monthData: ProjectionMonthData | undefined,
  riskClass: ProjectionRiskClass,
): ProjectionSafetyIssueType {
  if (!monthData?.hasForecast) return "forecast_missing";
  if (riskClass === "safety-negative") return "stock_oos";
  return "stock_under_safety";
}

function stockIssueLabel(issueType: ProjectionSafetyIssueType): string {
  if (issueType === "forecast_missing") return "Forecast fehlt";
  if (issueType === "stock_oos") return "Out-of-Stock";
  return "Unter Safety";
}

function isAbcCritical(abcClass: "A" | "B" | "C"): boolean {
  return abcClass === "A" || abcClass === "B";
}

function abcSortWeight(abcClass: "A" | "B" | "C"): number {
  if (abcClass === "A") return 0;
  if (abcClass === "B") return 1;
  return 2;
}

function stockIssueSortWeight(issueType: ProjectionSafetyIssueType): number {
  if (issueType === "stock_oos") return 0;
  if (issueType === "stock_under_safety") return 1;
  return 2;
}

function sortStockIssues(entries: RobustnessCoverageStockIssue[]): RobustnessCoverageStockIssue[] {
  return entries.slice().sort((left, right) => {
    const byAbc = abcSortWeight(left.abcClass) - abcSortWeight(right.abcClass);
    if (byAbc !== 0) return byAbc;
    const byIssue = stockIssueSortWeight(left.issueType) - stockIssueSortWeight(right.issueType);
    if (byIssue !== 0) return byIssue;
    return left.sku.localeCompare(right.sku, "de-DE");
  });
}

function sortOrderDutyIssues(entries: RobustnessCoverageOrderDutyIssue[]): RobustnessCoverageOrderDutyIssue[] {
  return entries.slice().sort((left, right) => {
    const overdueWeight = Number(right.overdue) - Number(left.overdue);
    if (overdueWeight !== 0) return overdueWeight;
    const byAbc = abcSortWeight(left.abcClass) - abcSortWeight(right.abcClass);
    if (byAbc !== 0) return byAbc;
    const byOrderMonth = left.orderMonth.localeCompare(right.orderMonth);
    if (byOrderMonth !== 0) return byOrderMonth;
    return left.sku.localeCompare(right.sku, "de-DE");
  });
}

function resolveCoverageStatus(input: {
  coverageRatio: number;
  blockerCount: number;
  blockerAbCount: number;
  hasOrderDutyBlocker: boolean;
  hasOverdueOrderDutyBlocker: boolean;
}): CoverageStatusKey {
  const {
    coverageRatio,
    blockerCount,
    blockerAbCount,
    hasOrderDutyBlocker,
    hasOverdueOrderDutyBlocker,
  } = input;
  if (coverageRatio >= 0.999999 && blockerCount === 0) return "full";
  if (blockerAbCount > 0) return "insufficient";
  if (coverageRatio >= COVERAGE_THRESHOLDS.wide) {
    return hasOrderDutyBlocker || hasOverdueOrderDutyBlocker ? "partial" : "wide";
  }
  if (coverageRatio >= COVERAGE_THRESHOLDS.partial) return "partial";
  return "insufficient";
}

function monthHasCashIn(state: Record<string, unknown>, month: string): boolean {
  const incomings = Array.isArray(state.incomings) ? state.incomings as Record<string, unknown>[] : [];
  const incoming = incomings.find((entry) => String(entry.month || "") === month);
  if (incoming) {
    const revenue = toNumber(incoming.revenueEur);
    const payout = toNumber(incoming.payoutPct);
    if (Number.isFinite(revenue as number) || Number.isFinite(payout as number)) return true;
  }

  const monthlyActuals = (state.monthlyActuals && typeof state.monthlyActuals === "object")
    ? state.monthlyActuals as Record<string, Record<string, unknown>>
    : {};
  const actual = monthlyActuals[month];
  if (!actual) return false;
  return Number.isFinite(toNumber(actual.realRevenueEUR) as number) || Number.isFinite(toNumber(actual.realPayoutRatePct) as number);
}

function resolveVatConfig(state: Record<string, unknown>): VatConfigInfo {
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const defaults = (settings.vatPreview && typeof settings.vatPreview === "object")
    ? settings.vatPreview as Record<string, unknown>
    : {};
  const monthOverrides = (state.vatPreviewMonths && typeof state.vatPreviewMonths === "object")
    ? state.vatPreviewMonths as Record<string, unknown>
    : {};
  const active = [
    defaults.deShareDefault,
    defaults.feeRateDefault,
    defaults.fixInputDefault,
    defaults.feeRateOfGrossDefault,
    defaults.fixInputVatDefault,
  ].some(hasInput);
  return {
    active,
    defaults,
    monthOverrides,
  };
}

function isVatConfiguredForMonth(vatInfo: VatConfigInfo, month: string): boolean {
  if (!vatInfo.active) return true;
  const monthEntry = (vatInfo.monthOverrides[month] && typeof vatInfo.monthOverrides[month] === "object")
    ? vatInfo.monthOverrides[month] as Record<string, unknown>
    : {};
  return [
    vatInfo.defaults.deShareDefault,
    vatInfo.defaults.feeRateDefault,
    vatInfo.defaults.fixInputDefault,
    vatInfo.defaults.feeRateOfGrossDefault,
    vatInfo.defaults.fixInputVatDefault,
    monthEntry.deShare,
    monthEntry.feeRateOfGross,
    monthEntry.fixInputVat,
  ].some(hasInput);
}

function buildRevenueInputIssues(state: Record<string, unknown>, products: Record<string, unknown>[]): {
  missingPrice: ProductRef[];
  blockedCompleteness: ProductRef[];
} {
  const abcBySku = computeAbcClassification(state).bySku;
  const missingPrice: ProductRef[] = [];
  const blockedCompleteness: ProductRef[] = [];

  products.forEach((product) => {
    const sku = normalizeSku(product.sku);
    if (!sku) return;
    const alias = String(product.alias || sku);
    const abcClass = resolveAbcClass(abcBySku, sku);
    const ref = { sku, alias, abcClass } satisfies ProductRef;
    const price = toNumber(product.avgSellingPriceGrossEUR);
    if (!Number.isFinite(price as number) || Number(price) <= 0) {
      missingPrice.push(ref);
    }
    const completeness = evaluateProductCompletenessV2({ product, state });
    if (completeness?.status === "blocked") {
      blockedCompleteness.push(ref);
    }
  });

  return {
    missingPrice,
    blockedCompleteness,
  };
}

function resolveLeadTimeForProduct(input: {
  state: Record<string, unknown>;
  product: Record<string, unknown>;
}): LeadTimeResolution {
  const { state, product } = input;
  const hierarchy = resolveMasterDataHierarchy({
    state,
    product,
    sku: String(product.sku || ""),
    supplierId: String(product.supplierId || ""),
    orderContext: "product",
  });
  const hierarchyFields = (hierarchy.fields && typeof hierarchy.fields === "object")
    ? hierarchy.fields as Record<string, unknown>
    : {};
  const hierarchyFieldValue = (fieldKey: string): unknown => {
    const field = hierarchyFields[fieldKey];
    if (!field || typeof field !== "object") return null;
    return (field as { value?: unknown }).value ?? null;
  };
  const resolvedTransport = String(hierarchyFieldValue("transportMode") || "").toUpperCase();
  const fallbackTransport = String((product.template && typeof product.template === "object"
    ? (product.template as Record<string, unknown>).transportMode
    : null) || "SEA").toUpperCase();
  const transportMode = resolvedTransport || fallbackTransport || "SEA";
  const ddp = hierarchyFieldValue("ddp") === true
    || String(product.incoterm || "").toUpperCase() === "DDP"
    || Boolean((product.template && typeof product.template === "object")
      ? (product.template as Record<string, unknown>).ddp === true
      : false);
  const fastMode = ddp || transportMode === "AIR";
  const defaultProduction = fastMode ? 14 : 45;
  const defaultTransit = fastMode ? 21 : 45;
  const productionDays = toPositiveInteger(hierarchyFieldValue("productionLeadTimeDays"))
    ?? toPositiveInteger(product.productionLeadTimeDaysDefault)
    ?? toPositiveInteger((product.template && typeof product.template === "object")
      ? (product.template as Record<string, unknown>).productionDays
      : null)
    ?? defaultProduction;
  const transitDays = toPositiveInteger(hierarchyFieldValue("transitDays"))
    ?? toPositiveInteger((product.template && typeof product.template === "object")
      ? (product.template as Record<string, unknown>).transitDays
      : null)
    ?? toPositiveInteger(product.transitDays)
    ?? defaultTransit;
  return {
    productionDays,
    transitDays,
    totalDays: Math.max(1, productionDays + transitDays),
    transportMode,
    ddp,
  };
}

function buildOrderDutyProfiles(input: {
  state: Record<string, unknown>;
  products: Record<string, unknown>[];
  months: string[];
  projection: ProjectionCoverageLookup;
  projectionMode: ProjectionModeForCoverage;
  nowMonth: string;
}): Map<string, OrderDutyProfile> {
  const profiles = new Map<string, OrderDutyProfile>();
  const futureMonths = input.months
    .filter((month) => month >= input.nowMonth)
    .sort((a, b) => a.localeCompare(b));
  if (!futureMonths.length) return profiles;

  input.products.forEach((product) => {
    const sku = normalizeSku(product.sku);
    if (!sku) return;
    const skuKey = normalizeSkuKey(sku);
    const skuProjection = input.projection.perSkuMonth.get(sku) || input.projection.perSkuMonth.get(skuKey);
    if (!skuProjection) return;
    let firstRiskMonth: string | null = null;
    let firstRiskData: ProjectionMonthData | null = null;

    for (let i = 0; i < futureMonths.length; i += 1) {
      const month = futureMonths[i];
      const monthData = skuProjection.get(month);
      const riskClass = projectionRiskClass(monthData, input.projectionMode);
      if (riskClass === "safety-negative" || riskClass === "safety-low") {
        firstRiskMonth = month;
        firstRiskData = monthData || null;
        break;
      }
    }
    if (!firstRiskMonth) return;

    const riskMonthStart = toMonthStartDate(firstRiskMonth);
    if (!(riskMonthStart instanceof Date) || Number.isNaN(riskMonthStart.getTime())) return;
    const leadTime = resolveLeadTimeForProduct({ state: input.state, product });
    const latestOrderDateRaw = addUtcDays(riskMonthStart, -leadTime.totalDays);
    const latestOrderDate = toIsoDate(latestOrderDateRaw);
    const orderMonth = toMonthKey(latestOrderDateRaw);
    const overdue = orderMonth < input.nowMonth;
    const safetyUnits = Number(firstRiskData?.safetyUnits);
    const endAvailable = Number(firstRiskData?.endAvailable);
    const shortageUnits = Number.isFinite(safetyUnits) && Number.isFinite(endAvailable)
      ? Math.max(0, Math.ceil(safetyUnits - endAvailable))
      : null;
    profiles.set(skuKey, {
      sku,
      firstRiskMonth,
      latestOrderDate,
      orderMonth,
      leadTimeDays: leadTime.totalDays,
      overdue,
      requiredArrivalDate: `${firstRiskMonth}-01`,
      recommendedOrderDate: latestOrderDate,
      shortageUnits,
    });
  });

  return profiles;
}

function buildActions(input: {
  months: DashboardRobustMonth[];
  hasFixcostBasis: boolean;
  vatActive: boolean;
  revenueIssueSkus: number;
}): DashboardActionItem[] {
  const missingForecastCount = input.months.reduce((sum, month) => {
    const count = month.coverage.stockIssues.filter((entry) => entry.issueType === "forecast_missing").length;
    return sum + count;
  }, 0);
  const safetyRiskCount = input.months.reduce((sum, month) => sum + month.coverage.safetyRiskSkus.length, 0);
  const orderDutyRiskCount = input.months.reduce((sum, month) => sum + month.coverage.orderDutyRiskSkus.length, 0);
  const overdueOrderDutyCount = input.months.reduce((sum, month) => sum + month.coverage.overdueOrderDutySkuCount, 0);
  const missingCashMonths = input.months.filter((month) => {
    const check = month.checks.find((entry) => entry.key === "cash_in");
    return check && !check.passed;
  }).length;
  const vatMissingMonths = input.months.filter((month) => {
    const check = month.checks.find((entry) => entry.key === "vat");
    return check && !check.passed;
  }).length;

  const actions: DashboardActionItem[] = [];
  if (missingForecastCount > 0) {
    actions.push({
      id: "forecast_missing",
      title: "Forecast vervollständigen",
      detail: `${missingForecastCount} SKU-Monat(e) ohne Forecast.`,
      severity: "error",
      route: "/v2/forecast",
      count: missingForecastCount,
      impact: "Kontostand nicht belastbar",
    });
  }
  if (safetyRiskCount > 0 || orderDutyRiskCount > 0) {
    const total = safetyRiskCount + orderDutyRiskCount;
    const overdueText = overdueOrderDutyCount > 0 ? ` · Überfällig ${overdueOrderDutyCount}` : "";
    actions.push({
      id: "inventory_safety",
      title: "Bestandsrisiken sichern (PO/FO)",
      detail: `${total} SKU-Monat(e) mit Safety-/Bestellpflicht-Risiko${overdueText}.`,
      severity: "error",
      route: "/v2/inventory/projektion",
      count: total,
      impact: "Stockout-Risiko in A/B möglich",
    });
  }
  if (missingCashMonths > 0) {
    actions.push({
      id: "cashin_basis",
      title: "Cash-In Basis pflegen",
      detail: `${missingCashMonths} Monat(e) ohne belastbare Incomings/Payout-Basis.`,
      severity: "error",
      route: "/v2/abschluss/eingaben",
      count: missingCashMonths,
      impact: "Kontostand-Projektion instabil",
    });
  }
  if (!input.hasFixcostBasis) {
    actions.push({
      id: "fixcost_basis",
      title: "Fixkostenbasis hinterlegen",
      detail: "Keine Fixkosten im Modell vorhanden.",
      severity: "error",
      route: "/v2/abschluss/fixkosten",
      count: input.months.length,
      impact: "Buffer-/Ausschüttungsentscheidung unzuverlässig",
    });
  }
  if (input.vatActive && vatMissingMonths > 0) {
    actions.push({
      id: "vat_basis",
      title: "USt-/Tax-Basis vervollständigen",
      detail: `${vatMissingMonths} Monat(e) ohne belastbare VAT-Konfiguration.`,
      severity: "error",
      route: "/v2/abschluss/ust",
      count: vatMissingMonths,
      impact: "Outflow-Bild unvollständig",
    });
  }
  if (input.revenueIssueSkus > 0) {
    actions.push({
      id: "revenue_inputs",
      title: "Umsatz-relevante Produktdaten korrigieren",
      detail: `${input.revenueIssueSkus} aktive SKU(s) mit fehlender Revenue-Basis.`,
      severity: "error",
      route: "/v2/products",
      count: input.revenueIssueSkus,
      impact: "Cash-In unterschätzt oder 0",
    });
  }

  const severityWeight = (severity: RobustnessSeverity): number => (severity === "error" ? 2 : 1);
  actions.sort((a, b) => {
    const severity = severityWeight(b.severity) - severityWeight(a.severity);
    if (severity !== 0) return severity;
    const count = b.count - a.count;
    if (count !== 0) return count;
    return a.title.localeCompare(b.title);
  });
  return actions.slice(0, 5);
}

export function buildDashboardRobustness(input: BuildDashboardRobustnessInput): DashboardRobustnessResult {
  const months = Array.from(new Set((Array.isArray(input.months) ? input.months : []).filter(isMonth))).sort();
  const state = input.state || {};
  const products = (Array.isArray(state.products) ? state.products : [])
    .map((entry) => (entry || {}) as Record<string, unknown>)
    .filter((entry) => normalizeSku(entry.sku));
  const activeProducts = products.filter(isActiveProduct);
  const activeSkuCount = activeProducts.length;
  const hasFixcostBasis = Array.isArray(state.fixcosts) && state.fixcosts.length > 0;
  const vatInfo = resolveVatConfig(state);
  const revenueIssues = buildRevenueInputIssues(state, activeProducts);
  const missingPriceSkuSet = new Set(revenueIssues.missingPrice.map((entry) => normalizeSkuKey(entry.sku)));
  const nowMonth = currentMonthKey();
  const projectionMode = resolveProjectionModeForCoverage(state);
  const pastMonths = months.filter((month) => month < nowMonth);
  const futureMonths = months.filter((month) => month >= nowMonth);
  const emptyProjection: ProjectionCoverageLookup = { perSkuMonth: new Map() };
  const pastProjection = pastMonths.length
    ? computeInventoryProjection({
      state,
      months: pastMonths,
      products: activeProducts,
      snapshot: null,
      snapshotMonth: pastMonths[0] || undefined,
      projectionMode,
    }) as ProjectionCoverageLookup
    : emptyProjection;
  const futureProjection = futureMonths.length
    ? computeInventoryProjection({
      state,
      months: futureMonths,
      products: activeProducts,
      snapshot: null,
      snapshotMonth: addMonths(nowMonth, -1),
      projectionMode,
    }) as ProjectionCoverageLookup
    : emptyProjection;
  const abcBySku = computeAbcClassification(state).bySku;
  const orderDutyBySku = buildOrderDutyProfiles({
    state,
    products: activeProducts,
    months,
    projection: futureProjection,
    projectionMode,
    nowMonth,
  });

  const monthResults: DashboardRobustMonth[] = months.map((month) => {
    const missingForecastSkuSet = new Set<string>();
    const safetyRiskSkuSet = new Set<string>();
    const orderDutyRiskSkuSet = new Set<string>();
    const blockerSkuSet = new Set<string>();
    const blockerAbSkuSet = new Set<string>();
    const blockerCSkuSet = new Set<string>();
    const overdueOrderDutySkuSet = new Set<string>();
    let coveredSkus = 0;

    const stockIssues: RobustnessCoverageStockIssue[] = [];
    const orderDutyIssues: RobustnessCoverageOrderDutyIssue[] = [];

    activeProducts.forEach((product) => {
      const sku = normalizeSku(product.sku);
      if (!sku) return;
      const skuKey = normalizeSkuKey(sku);
      const alias = String(product.alias || sku);
      const abcClass = resolveAbcClass(abcBySku, sku);
      const monthProjection = month < nowMonth ? pastProjection : futureProjection;
      const skuProjection = monthProjection.perSkuMonth.get(sku) || monthProjection.perSkuMonth.get(skuKey);
      const monthData = skuProjection?.get(month);
      const riskClass = projectionRiskClass(monthData, projectionMode);
      const stockOk = Boolean(monthData?.hasForecast) && !riskClass;

      if (!stockOk) {
        const issueType = stockIssueType(monthData, riskClass);
        const value = projectionMode === "doh"
          ? (Number.isFinite(Number(monthData?.doh)) ? Number(monthData?.doh) : null)
          : (Number.isFinite(Number(monthData?.endAvailable)) ? Number(monthData?.endAvailable) : null);
        const safetyValue = projectionMode === "doh"
          ? (Number.isFinite(Number(monthData?.safetyDays)) ? Number(monthData?.safetyDays) : null)
          : (Number.isFinite(Number(monthData?.safetyUnits)) ? Number(monthData?.safetyUnits) : null);
        stockIssues.push({
          sku,
          alias,
          abcClass,
          issueType,
          issueLabel: stockIssueLabel(issueType),
          value,
          safetyValue,
          projectionMode,
        });
        blockerSkuSet.add(skuKey);
        if (isAbcCritical(abcClass)) blockerAbSkuSet.add(skuKey);
        else blockerCSkuSet.add(skuKey);
        if (!monthData?.hasForecast) {
          missingForecastSkuSet.add(sku);
        } else {
          safetyRiskSkuSet.add(sku);
        }
      }

      const orderDuty = orderDutyBySku.get(skuKey) || null;
      const orderDutyTriggered = Boolean(orderDuty && orderDuty.orderMonth <= month);
      if (orderDuty && orderDutyTriggered) {
        orderDutyIssues.push({
          sku,
          alias,
          abcClass,
          firstRiskMonth: orderDuty.firstRiskMonth,
          latestOrderDate: orderDuty.latestOrderDate,
          orderMonth: orderDuty.orderMonth,
          leadTimeDays: orderDuty.leadTimeDays,
          overdue: orderDuty.overdue,
          requiredArrivalDate: orderDuty.requiredArrivalDate,
          recommendedOrderDate: orderDuty.recommendedOrderDate,
          shortageUnits: orderDuty.shortageUnits,
          reason: "Keine FO/PO vorhanden, die die Lücke schließt.",
        });
        orderDutyRiskSkuSet.add(sku);
        blockerSkuSet.add(skuKey);
        if (isAbcCritical(abcClass)) blockerAbSkuSet.add(skuKey);
        else blockerCSkuSet.add(skuKey);
        if (orderDuty.overdue) overdueOrderDutySkuSet.add(skuKey);
      }

      const orderDutyOk = !orderDutyTriggered;
      const covered = stockOk && orderDutyOk;
      if (covered) coveredSkus += 1;
    });

    const coverageRatio = activeSkuCount ? coveredSkus / activeSkuCount : 0;
    const blockerCount = blockerSkuSet.size;
    const blockerAbCount = blockerAbSkuSet.size;
    const blockerCCount = blockerCSkuSet.size;
    const hasOrderDutyBlocker = orderDutyIssues.length > 0;
    const hasOverdueOrderDutyBlocker = overdueOrderDutySkuSet.size > 0;
    const coverageStatusKey = resolveCoverageStatus({
      coverageRatio,
      blockerCount,
      blockerAbCount,
      hasOrderDutyBlocker,
      hasOverdueOrderDutyBlocker,
    });
    const coverageStatus = COVERAGE_STATUS_META[coverageStatusKey];
    const coveragePassed = coverageStatusKey === "full" || coverageStatusKey === "wide";
    const cashInPassed = monthHasCashIn(state, month);
    const fixcostPassed = hasFixcostBasis;
    const vatPassed = isVatConfiguredForMonth(vatInfo, month);
    const revenuePassed = revenueIssues.missingPrice.length === 0 && revenueIssues.blockedCompleteness.length === 0;

    const blockers: RobustnessBlocker[] = [];
    const addBlocker = (value: Omit<RobustnessBlocker, "id">): void => {
      blockers.push({
        id: `${value.checkKey}:${value.month}:${blockers.length}`,
        ...value,
      });
    };

    if (!coveragePassed) {
      if (activeSkuCount === 0) {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: "Keine aktiven SKUs vorhanden.",
          route: "/v2/products",
        });
      }
      const sortedStockIssues = sortStockIssues(stockIssues);
      sortedStockIssues.slice(0, 20).forEach((entry) => {
        const route = entry.issueType === "forecast_missing" ? "/v2/forecast" : "/v2/inventory/projektion";
        const issueText = entry.issueType === "forecast_missing"
          ? "Forecast fehlt"
          : (entry.issueType === "stock_oos" ? "Out-of-Stock" : "unter Safety");
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): ${issueText} (${entry.abcClass}).`,
          sku: entry.sku,
          alias: entry.alias,
          abcClass: entry.abcClass,
          issueType: entry.issueType,
          route,
        });
      });
      if (sortedStockIssues.length > 20) {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `+ ${sortedStockIssues.length - 20} weitere SKU(s) mit Bestandsproblemen.`,
          route: "/v2/inventory/projektion",
        });
      }

      const sortedOrderDutyIssues = sortOrderDutyIssues(orderDutyIssues);
      sortedOrderDutyIssues.slice(0, 20).forEach((entry) => {
        const overduePrefix = entry.overdue ? "überfällig" : "fällig";
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): Bestellpflicht ${overduePrefix} bis ${entry.latestOrderDate} (Risikomonat ${entry.firstRiskMonth}).`,
          sku: entry.sku,
          alias: entry.alias,
          abcClass: entry.abcClass,
          issueType: "order_duty",
          firstRiskMonth: entry.firstRiskMonth,
          latestOrderDate: entry.latestOrderDate,
          orderMonth: entry.orderMonth,
          leadTimeDays: entry.leadTimeDays,
          overdue: entry.overdue,
          requiredArrivalDate: entry.requiredArrivalDate,
          recommendedOrderDate: entry.recommendedOrderDate,
          suggestedUnits: entry.shortageUnits,
          route: "/v2/orders/fo",
        });
      });
      if (sortedOrderDutyIssues.length > 20) {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `+ ${sortedOrderDutyIssues.length - 20} weitere SKU(s) mit Bestellpflicht.`,
          route: "/v2/orders/fo",
        });
      }
    }

    if (!cashInPassed) {
      addBlocker({
        month,
        checkKey: "cash_in",
        severity: "error",
        message: "Cash-In Basis fehlt (Incomings/Payout).",
        route: "/v2/abschluss/eingaben",
      });
    }
    if (!fixcostPassed) {
      addBlocker({
        month,
        checkKey: "fixcost",
        severity: "error",
        message: "Fixkostenbasis fehlt.",
        route: "/v2/abschluss/fixkosten",
      });
    }
    if (!vatPassed) {
      addBlocker({
        month,
        checkKey: "vat",
        severity: "error",
        message: "USt-/Tax-Basis fehlt für den Monat.",
        route: "/v2/abschluss/ust",
      });
    }
    if (!revenuePassed) {
      revenueIssues.missingPrice.slice(0, 20).forEach((entry) => {
        addBlocker({
          month,
          checkKey: "revenue_inputs",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): Ø VK-Preis fehlt.`,
          sku: entry.sku,
          alias: entry.alias,
          abcClass: entry.abcClass,
          route: "/v2/products",
        });
      });
      const blockedWithoutPrice = revenueIssues.blockedCompleteness
        .filter((entry) => !missingPriceSkuSet.has(normalizeSkuKey(entry.sku)))
        .slice(0, 20);
      blockedWithoutPrice.forEach((entry) => {
        addBlocker({
          month,
          checkKey: "revenue_inputs",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): Stammdaten unvollständig.`,
          sku: entry.sku,
          alias: entry.alias,
          abcClass: entry.abcClass,
          route: "/v2/products",
        });
      });
    }

    const checks: RobustnessCheckResult[] = [
      {
        key: "sku_coverage",
        label: "Bestands- & Bestellpflicht-Coverage",
        status: coveragePassed ? "ok" : "error",
        passed: coveragePassed,
        detail: `${coverageStatus.label}: ${coveragePercentLabel(coverageRatio)} (${coveredSkus}/${activeSkuCount}) · Blocker ${blockerCount} (A/B ${blockerAbCount}, C ${blockerCCount}) · Bestand ${stockIssues.length} · Bestellpflicht ${orderDutyIssues.length}`,
        blockerCount: blockerCount + (activeSkuCount === 0 ? 1 : 0),
        route: missingForecastSkuSet.size > 0 ? "/v2/forecast" : "/v2/inventory/projektion",
      },
      {
        key: "cash_in",
        label: "Cash-In Basis",
        status: cashInPassed ? "ok" : "error",
        passed: cashInPassed,
        detail: cashInPassed ? "vorhanden" : "fehlend",
        blockerCount: cashInPassed ? 0 : 1,
        route: "/v2/abschluss/eingaben",
      },
      {
        key: "fixcost",
        label: "Fixkostenbasis",
        status: fixcostPassed ? "ok" : "error",
        passed: fixcostPassed,
        detail: fixcostPassed ? "vorhanden" : "fehlend",
        blockerCount: fixcostPassed ? 0 : 1,
        route: "/v2/abschluss/fixkosten",
      },
      {
        key: "vat",
        label: "Tax/VAT Basis",
        status: vatPassed ? "ok" : "error",
        passed: vatPassed,
        detail: vatInfo.active ? (vatPassed ? "vorhanden" : "fehlend") : "nicht aktiv",
        blockerCount: vatPassed ? 0 : 1,
        route: "/v2/abschluss/ust",
      },
      {
        key: "revenue_inputs",
        label: "Revenue-Berechenbarkeit",
        status: revenuePassed ? "ok" : "error",
        passed: revenuePassed,
        detail: revenuePassed
          ? "vollständig"
          : `${revenueIssues.missingPrice.length} ohne Preis · ${revenueIssues.blockedCompleteness.length} unvollständig`,
        blockerCount: revenuePassed ? 0 : (revenueIssues.missingPrice.length + revenueIssues.blockedCompleteness.length),
        route: "/v2/products",
      },
    ];

    const robust = checks.every((entry) => entry.passed);
    const sortedStockIssues = sortStockIssues(stockIssues);
    const sortedOrderDutyIssues = sortOrderDutyIssues(orderDutyIssues);

    return {
      month,
      robust,
      checks,
      blockers,
      blockerCount: blockers.length,
      coverage: {
        statusKey: coverageStatusKey,
        statusLabel: coverageStatus.label,
        statusDetail: coverageStatus.detail,
        projectionMode,
        activeSkus: activeSkuCount,
        coveredSkus,
        ratio: coverageRatio,
        blockerCount,
        blockerAbCount,
        blockerCCount,
        stockIssueCount: sortedStockIssues.length,
        orderDutyIssueCount: sortedOrderDutyIssues.length,
        overdueOrderDutySkuCount: overdueOrderDutySkuSet.size,
        missingForecastSkus: Array.from(missingForecastSkuSet).sort((a, b) => a.localeCompare(b, "de-DE")),
        safetyRiskSkus: Array.from(safetyRiskSkuSet).sort((a, b) => a.localeCompare(b, "de-DE")),
        orderDutyRiskSkus: Array.from(orderDutyRiskSkuSet).sort((a, b) => a.localeCompare(b, "de-DE")),
        stockIssues: sortedStockIssues,
        orderDutyIssues: sortedOrderDutyIssues,
        abRiskSkuCount: blockerAbCount,
      },
    };
  });

  const monthMap = new Map<string, DashboardRobustMonth>();
  monthResults.forEach((entry) => monthMap.set(entry.month, entry));
  const robustMonthsCount = monthResults.filter((entry) => entry.robust).length;

  let robustUntilMonth: string | null = null;
  for (let i = 0; i < monthResults.length; i += 1) {
    if (!monthResults[i].robust) break;
    robustUntilMonth = monthResults[i].month;
  }

  const revenueIssueSkus = new Set([
    ...revenueIssues.missingPrice.map((entry) => normalizeSkuKey(entry.sku)),
    ...revenueIssues.blockedCompleteness.map((entry) => normalizeSkuKey(entry.sku)),
  ]).size;

  return {
    months: monthResults,
    monthMap,
    actions: buildActions({
      months: monthResults,
      hasFixcostBasis,
      vatActive: vatInfo.active,
      revenueIssueSkus,
    }),
    robustUntilMonth,
    robustMonthsCount,
    totalMonths: monthResults.length,
    activeSkuCount,
  };
}

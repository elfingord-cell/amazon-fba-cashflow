import { parseDeNumber } from "../../lib/dataHealth.js";
import { resolveMasterDataHierarchy } from "./masterDataHierarchy";
import { addMonths, currentMonthKey, monthRange, normalizeMonthKey } from "./months";
import {
  buildFoPayments,
  buildFoRecommendationContext,
  computeFoRecommendationForSku,
  computeFoSchedule,
  extractSupplierTerms,
  type SupplierPaymentTermDraft,
} from "./orderUtils";
import {
  buildDashboardRobustness,
  type RobustnessCoverageOrderDutyIssue,
} from "./dashboardRobustness";
import { normalizeIncludeInForecast } from "../../domain/portfolioBuckets.js";
import { buildPlanProductForecastRows } from "../../domain/planProducts.js";

const PHANTOM_FO_SOURCE = "robustness_order_duty_v2";
const PHANTOM_FO_ROLLING_MONTHS = 12;
const PHANTOM_FO_MAX_SUGGESTIONS_PER_SKU = 12;

interface PhantomLeadTime {
  productionDays: number;
  transitDays: number;
  totalDays: number;
  transportMode: string;
  incoterm: string;
  dutyRatePct: number;
  eustRatePct: number;
}

interface ShortageAcceptanceOverride {
  sku: string;
  reason: "stock_oos" | "stock_under_safety";
  acceptedFromMonth: string;
  acceptedUntilMonth: string;
  durationMonths: number;
}

interface SuggestionBuildResult {
  suggestion: PhantomFoSuggestion | null;
  rejectedByPastOrderDate: boolean;
}

export interface PhantomFoSuggestion {
  id: string;
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
  issueType: "stock_oos" | "stock_under_safety";
  supplierId: string;
  orderMonth: string;
  firstRiskMonth: string;
  latestOrderDate: string;
  requiredArrivalDate: string;
  recommendedOrderDate: string;
  leadTimeDays: number;
  overdue: boolean;
  suggestedUnits: number;
  shortageUnits: number | null;
  recommendationStatus: string | null;
  recommendationUnits: number | null;
  foRecord: Record<string, unknown>;
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSkuKey(value: unknown): string {
  return normalizeSku(value).toLowerCase();
}

function normalizeIsoDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return text;
}

function resolveSuggestionOrderDateIso(input: {
  recommendedOrderDate?: unknown;
  latestOrderDate?: unknown;
  foRecord?: Record<string, unknown> | null;
}): string | null {
  return normalizeIsoDate(input.recommendedOrderDate)
    || normalizeIsoDate(input.latestOrderDate)
    || normalizeIsoDate(input.foRecord?.orderDate);
}

function isOrderDateBeforeLocalToday(orderDateIso: string | null, todayIso: string): boolean {
  if (!orderDateIso) return false;
  return orderDateIso < todayIso;
}

function monthStartIso(month: string): string | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  return `${normalized}-01`;
}

function localTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeShortageIssueType(value: unknown): "stock_oos" | "stock_under_safety" | null {
  const text = String(value || "").trim().toLowerCase();
  if (text === "stock_oos") return "stock_oos";
  if (text === "stock_under_safety") return "stock_under_safety";
  return null;
}

function buildShortageAcceptanceStorageKey(input: {
  sku: string;
  reason: "stock_oos" | "stock_under_safety";
  acceptedFromMonth: string;
}): string {
  return `${normalizeSkuKey(input.sku)}::${input.reason}::${input.acceptedFromMonth}`;
}

function resolveShortageAcceptancesBySku(settings: Record<string, unknown>): Map<string, ShortageAcceptanceOverride[]> {
  const rawBySku = (settings.phantomFoShortageAcceptBySku && typeof settings.phantomFoShortageAcceptBySku === "object")
    ? settings.phantomFoShortageAcceptBySku as Record<string, unknown>
    : {};
  const map = new Map<string, ShortageAcceptanceOverride[]>();
  Object.entries(rawBySku).forEach(([key, raw]) => {
    if (!raw || typeof raw !== "object") return;
    const entry = raw as Record<string, unknown>;
    const keySku = String(key || "").includes("::") ? String(key).split("::")[0] : key;
    const sku = normalizeSku(entry.sku || keySku);
    const skuKey = normalizeSkuKey(sku);
    if (!sku || !skuKey) return;
    const reason = normalizeShortageIssueType(entry.reason || entry.issueType);
    if (!reason) return;
    const acceptedFromMonth = normalizeMonthKey(entry.acceptedFromMonth || entry.startMonth || entry.firstRiskMonth);
    if (!acceptedFromMonth) return;
    const durationMonths = Math.max(1, Math.round(Number(entry.durationMonths || 1)));
    const acceptedUntilMonth = normalizeMonthKey(entry.acceptedUntilMonth || entry.untilMonth)
      || addMonths(acceptedFromMonth, durationMonths - 1);
    if (!acceptedUntilMonth) return;
    const list = map.get(skuKey) || [];
    const duplicateIndex = list.findIndex((current) => (
      current.reason === reason
      && current.acceptedFromMonth === acceptedFromMonth
    ));
    const nextEntry: ShortageAcceptanceOverride = {
      sku,
      reason,
      acceptedFromMonth,
      acceptedUntilMonth,
      durationMonths,
    };
    if (duplicateIndex >= 0) list[duplicateIndex] = nextEntry;
    else list.push(nextEntry);
    list.sort((left, right) => {
      const byStart = left.acceptedFromMonth.localeCompare(right.acceptedFromMonth);
      if (byStart !== 0) return byStart;
      const byEnd = left.acceptedUntilMonth.localeCompare(right.acceptedUntilMonth);
      if (byEnd !== 0) return byEnd;
      return left.reason.localeCompare(right.reason);
    });
    map.set(skuKey, list);
  });
  return map;
}

function hasActiveShortageAcceptance(input: {
  acceptanceBySku: Map<string, ShortageAcceptanceOverride[]>;
  sku: string;
  month: string;
  issueType: "stock_oos" | "stock_under_safety";
}): boolean {
  const skuKey = normalizeSkuKey(input.sku);
  if (!skuKey) return false;
  const acceptances = input.acceptanceBySku.get(skuKey) || [];
  return acceptances.some((acceptance) => {
    if (acceptance.reason !== input.issueType) return false;
    if (input.month < acceptance.acceptedFromMonth || input.month > acceptance.acceptedUntilMonth) return false;
    return true;
  });
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return fallback;
  return Number(parsed);
}

function asPositiveInt(value: unknown): number | null {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed));
}

function asPositiveNumber(value: unknown): number | null {
  const parsed = asNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function statusIsActive(product: Record<string, unknown>): boolean {
  if (!normalizeIncludeInForecast(product.includeInForecast, true)) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function sanitizeToken(value: unknown, fallback = "PH"): string {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return cleaned || fallback;
}

function normalizeSkuToken(value: unknown, fallback = "PLAN"): string {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function ensureUniqueSku(baseSku: string, usedSkuKeys: Set<string>): string {
  const base = normalizeSkuToken(baseSku, "PLAN");
  let candidate = base;
  let cursor = 2;
  while (usedSkuKeys.has(candidate.toLowerCase())) {
    candidate = `${base}-${cursor}`;
    cursor += 1;
  }
  return candidate;
}

function normalizeTransportMode(value: unknown): "SEA" | "RAIL" | "AIR" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "SEA" || raw === "RAIL" || raw === "AIR") return raw;
  return "SEA";
}

function resolveTransitDaysForMode(
  settings: Record<string, unknown>,
  transportMode: "SEA" | "RAIL" | "AIR",
): number | null {
  const leadTimes = (settings.transportLeadTimesDays || {}) as Record<string, unknown>;
  return asPositiveInt(leadTimes[transportMode.toLowerCase()])
    ?? asPositiveInt(leadTimes.sea)
    ?? null;
}

function buildPhantomFoId(issue: RobustnessCoverageOrderDutyIssue): string {
  const skuToken = sanitizeToken(issue.sku, "SKU").slice(0, 14);
  const orderMonthToken = sanitizeToken(issue.orderMonth, "OM");
  const riskMonthToken = sanitizeToken(issue.firstRiskMonth, "RM");
  return `phantom-fo-${skuToken}-${orderMonthToken}-${riskMonthToken}`;
}

function buildPhantomFoNumber(issue: RobustnessCoverageOrderDutyIssue): string {
  const monthToken = sanitizeToken(issue.orderMonth, "000000").slice(0, 6);
  const skuToken = sanitizeToken(issue.sku, "SKU").slice(0, 6);
  const riskMonthToken = sanitizeToken(issue.firstRiskMonth, "000000").slice(0, 6);
  return `PH-${monthToken}-${skuToken}-${riskMonthToken}`;
}

function toIssueMapBySku(issues: RobustnessCoverageOrderDutyIssue[]): Map<string, RobustnessCoverageOrderDutyIssue> {
  const map = new Map<string, RobustnessCoverageOrderDutyIssue>();
  issues.forEach((issue) => {
    const sku = normalizeSku(issue.sku);
    if (!sku) return;
    const key = normalizeSkuKey(sku);
    if (!map.has(key)) {
      map.set(key, issue);
    }
  });
  return map;
}

function collectOrderDutyIssues(state: Record<string, unknown>, months: string[]): RobustnessCoverageOrderDutyIssue[] {
  const robustness = buildDashboardRobustness({ state, months });
  const seenIssueKeys = new Set<string>();
  const orderedIssues: RobustnessCoverageOrderDutyIssue[] = [];
  robustness.months.forEach((monthRow) => {
    const issueMap = toIssueMapBySku(monthRow.coverage.orderDutyIssues);
    issueMap.forEach((issue) => {
      const selectionKey = issueSelectionKey(issue);
      if (!selectionKey || seenIssueKeys.has(selectionKey)) return;
      seenIssueKeys.add(selectionKey);
      orderedIssues.push(issue);
    });
  });
  orderedIssues.sort((left, right) => {
    const byOrderMonth = (normalizeMonthKey(left.orderMonth) || "").localeCompare(normalizeMonthKey(right.orderMonth) || "");
    if (byOrderMonth !== 0) return byOrderMonth;
    const byRiskMonth = (normalizeMonthKey(left.firstRiskMonth) || "").localeCompare(normalizeMonthKey(right.firstRiskMonth) || "");
    if (byRiskMonth !== 0) return byRiskMonth;
    return normalizeSku(left.sku).localeCompare(normalizeSku(right.sku), "de-DE");
  });
  return orderedIssues;
}

function buildScopedOrderDutyIssues(input: {
  state: Record<string, unknown>;
  months: string[];
  horizonEndMonth: string;
  todayMonth: string;
  shortageAcceptancesBySku: Map<string, ShortageAcceptanceOverride[]>;
}): RobustnessCoverageOrderDutyIssue[] {
  return collectOrderDutyIssues(input.state, input.months)
    .filter((issue) => {
      const orderMonth = normalizeMonthKey(issue.orderMonth);
      if (!orderMonth) return false;
      if (orderMonth > input.horizonEndMonth) return false;
      const firstRiskMonth = normalizeMonthKey(issue.firstRiskMonth) || input.todayMonth;
      const suppressedByActiveWindow = hasActiveShortageAcceptance({
        acceptanceBySku: input.shortageAcceptancesBySku,
        sku: issue.sku,
        month: input.todayMonth,
        issueType: issue.issueType,
      });
      if (suppressedByActiveWindow) return false;
      const suppressedByRiskMonth = hasActiveShortageAcceptance({
        acceptanceBySku: input.shortageAcceptancesBySku,
        sku: issue.sku,
        month: firstRiskMonth,
        issueType: issue.issueType,
      });
      return !suppressedByRiskMonth;
    });
}

function buildTemporaryAcceptanceState(input: {
  state: Record<string, unknown>;
  temporaryAcceptancesBySku: Map<string, ShortageAcceptanceOverride>;
}): Record<string, unknown> {
  if (!input.temporaryAcceptancesBySku.size) return input.state;
  const settings = (input.state.settings && typeof input.state.settings === "object")
    ? input.state.settings as Record<string, unknown>
    : {};
  const rawBySku = (settings.phantomFoShortageAcceptBySku && typeof settings.phantomFoShortageAcceptBySku === "object")
    ? settings.phantomFoShortageAcceptBySku as Record<string, unknown>
    : {};
  const mergedBySku: Record<string, unknown> = { ...rawBySku };
  input.temporaryAcceptancesBySku.forEach((entry) => {
    const acceptanceKey = `tmp::${buildShortageAcceptanceStorageKey({
      sku: entry.sku,
      reason: entry.reason,
      acceptedFromMonth: entry.acceptedFromMonth,
    })}`;
    const currentRaw = rawBySku[acceptanceKey];
    const current = (currentRaw && typeof currentRaw === "object")
      ? currentRaw as Record<string, unknown>
      : {};
    mergedBySku[acceptanceKey] = {
      ...current,
      sku: entry.sku,
      reason: entry.reason,
      acceptedFromMonth: entry.acceptedFromMonth,
      acceptedUntilMonth: entry.acceptedUntilMonth,
      durationMonths: entry.durationMonths,
    };
  });
  return {
    ...input.state,
    settings: {
      ...settings,
      phantomFoShortageAcceptBySku: mergedBySku,
    },
  };
}

function issueSelectionKey(issue: RobustnessCoverageOrderDutyIssue): string {
  const sku = normalizeSkuKey(issue.sku);
  const issueType = String(issue.issueType || "").trim().toLowerCase();
  const orderMonth = normalizeMonthKey(issue.orderMonth) || "";
  const firstRiskMonth = normalizeMonthKey(issue.firstRiskMonth) || "";
  return `${sku}|${issueType}|${orderMonth}|${firstRiskMonth}`;
}

function resolveProductTemplateFields(product: Record<string, unknown> | null): Record<string, unknown> {
  const template = (product?.template && typeof product.template === "object")
    ? product.template as Record<string, unknown>
    : {};
  const fields = (template.fields && typeof template.fields === "object")
    ? template.fields as Record<string, unknown>
    : template;
  return fields || {};
}

function resolveUnitPriceUsd(product: Record<string, unknown> | null): number {
  const template = resolveProductTemplateFields(product);
  return asPositiveNumber(template.unitPriceUsd)
    ?? asPositiveNumber(product?.unitPriceUsd)
    ?? asPositiveNumber(product?.unitPrice)
    ?? 0;
}

function resolveFreightPerUnitEur(product: Record<string, unknown> | null): number {
  const template = resolveProductTemplateFields(product);
  return asPositiveNumber(product?.logisticsPerUnitEur)
    ?? asPositiveNumber(product?.freightPerUnitEur)
    ?? asPositiveNumber(template.logisticsPerUnitEur)
    ?? asPositiveNumber(template.freightEur)
    ?? 0;
}

function resolveLeadTime(input: {
  state: Record<string, unknown>;
  product: Record<string, unknown> | null;
  supplierId: string;
  settings: Record<string, unknown>;
}): PhantomLeadTime {
  const product = input.product || {};
  const settings = input.settings || {};
  const templateFields = resolveProductTemplateFields(product);
  const hierarchy = resolveMasterDataHierarchy({
    state: input.state,
    product: product || undefined,
    sku: String(product.sku || ""),
    supplierId: input.supplierId || String(product.supplierId || ""),
    orderContext: "fo",
  });
  const hierarchyFields = (hierarchy.fields && typeof hierarchy.fields === "object")
    ? hierarchy.fields as Record<string, unknown>
    : {};
  const hierarchyFieldValue = (fieldKey: string): unknown => {
    const field = hierarchyFields[fieldKey];
    if (!field || typeof field !== "object") return null;
    return (field as { value?: unknown }).value ?? null;
  };
  const transportModeRaw = String(
    hierarchyFieldValue("transportMode")
    || templateFields.transportMode
    || product.transportMode
    || "SEA",
  )
    .trim()
    .toUpperCase();
  const transportMode = transportModeRaw === "AIR" || transportModeRaw === "SEA" || transportModeRaw === "RAIL"
    ? transportModeRaw
    : "SEA";
  const ddp = hierarchyFieldValue("ddp") === true || String(product.incoterm || "").toUpperCase() === "DDP";
  const fastMode = ddp || transportMode === "AIR";

  const productionDays = asPositiveInt(hierarchyFieldValue("productionLeadTimeDays"))
    ?? asPositiveInt(product.productionLeadTimeDaysDefault)
    ?? asPositiveInt(templateFields.productionDays)
    ?? asPositiveInt(settings.defaultProductionLeadTimeDays)
    ?? (fastMode ? 14 : 45);

  const transitDays = asPositiveInt(hierarchyFieldValue("transitDays"))
    ?? asPositiveInt(templateFields.transitDays)
    ?? asPositiveInt(product.transitDays)
    ?? (fastMode ? 21 : 45);

  const dutyRatePct = asNumber(hierarchyFieldValue("dutyRatePct"), asNumber(settings.dutyRatePct, 0));
  const eustRatePct = asNumber(hierarchyFieldValue("eustRatePct"), asNumber(settings.eustRatePct, 0));
  const incoterm = String(
    hierarchyFieldValue("incoterm")
    || product.incoterm
    || (ddp ? "DDP" : "EXW"),
  )
    .trim()
    .toUpperCase() || "EXW";

  return {
    productionDays,
    transitDays,
    totalDays: Math.max(1, productionDays + transitDays),
    transportMode,
    incoterm,
    dutyRatePct: Math.max(0, dutyRatePct),
    eustRatePct: Math.max(0, eustRatePct),
  };
}

function resolveMonthList(input: {
  state: Record<string, unknown>;
  months?: string[] | null;
}): string[] {
  const fromInput = Array.from(new Set((Array.isArray(input.months) ? input.months : []).map((month) => String(month || "").trim())))
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort((a, b) => a.localeCompare(b));
  if (fromInput.length) return fromInput;
  const settings = (input.state.settings && typeof input.state.settings === "object")
    ? input.state.settings as Record<string, unknown>
    : {};
  const horizonRaw = asPositiveInt(settings.skuPlanningHorizonMonths);
  const horizon = horizonRaw && [6, 12, 18].includes(horizonRaw)
    ? horizonRaw
    : PHANTOM_FO_ROLLING_MONTHS;
  return monthRange(currentMonthKey(), horizon);
}

function resolveMaxSuggestionsPerSku(settings: Record<string, unknown>): number {
  const configured = asPositiveInt(settings.skuPlanningMaxPhantomSuggestionsPerSku);
  if (configured != null) return configured;
  return PHANTOM_FO_MAX_SUGGESTIONS_PER_SKU;
}

function resolveSupplierTerms(supplier: Record<string, unknown> | null): SupplierPaymentTermDraft[] {
  return extractSupplierTerms([], supplier || undefined);
}

function recommendationUnitsToInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed));
}

function compareSuggestionPriority(left: PhantomFoSuggestion, right: PhantomFoSuggestion): number {
  const overdueWeight = Number(right.overdue) - Number(left.overdue);
  if (overdueWeight !== 0) return overdueWeight;
  const abcWeight = (value: "A" | "B" | "C"): number => {
    if (value === "A") return 0;
    if (value === "B") return 1;
    return 2;
  };
  const byAbc = abcWeight(left.abcClass) - abcWeight(right.abcClass);
  if (byAbc !== 0) return byAbc;
  const byOrderMonth = left.orderMonth.localeCompare(right.orderMonth);
  if (byOrderMonth !== 0) return byOrderMonth;
  const byRiskMonth = left.firstRiskMonth.localeCompare(right.firstRiskMonth);
  if (byRiskMonth !== 0) return byRiskMonth;
  return left.sku.localeCompare(right.sku, "de-DE");
}

function buildSuggestionForIssue(input: {
  state: Record<string, unknown>;
  issue: RobustnessCoverageOrderDutyIssue;
  productBySkuKey: Map<string, Record<string, unknown>>;
  supplierById: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  recommendationContext: ReturnType<typeof buildFoRecommendationContext>;
  horizonMonths: number;
  todayIso: string;
}): SuggestionBuildResult {
  const issue = input.issue;
  const sku = normalizeSku(issue.sku);
  if (!sku) {
    return { suggestion: null, rejectedByPastOrderDate: false };
  }
  const skuKey = normalizeSkuKey(sku);
  const product = input.productBySkuKey.get(skuKey) || null;
  const supplierId = String(product?.supplierId || "").trim();
  const supplier = input.supplierById.get(supplierId) || null;
  const leadTime = resolveLeadTime({
    state: input.state,
    product,
    supplierId,
    settings: input.settings,
  });
  const requiredArrivalDate = normalizeIsoDate(issue.requiredArrivalDate) || monthStartIso(issue.firstRiskMonth);
  if (!requiredArrivalDate) {
    return { suggestion: null, rejectedByPastOrderDate: false };
  }

  const recommendation = computeFoRecommendationForSku({
    context: input.recommendationContext,
    sku,
    leadTimeDays: leadTime.totalDays,
    product,
    settings: input.settings,
    horizonMonths: Math.max(6, Math.round(Number(input.horizonMonths) || 6)),
    requiredArrivalMonth: issue.firstRiskMonth,
  }) as Record<string, unknown> | null;

  const recommendationUnits = recommendationUnitsToInt(recommendation?.recommendedUnits);
  const shortageUnits = recommendationUnitsToInt(issue.shortageUnits);
  const suggestedUnits = Math.max(recommendationUnits || 0, shortageUnits || 0);
  if (!(suggestedUnits > 0)) {
    return { suggestion: null, rejectedByPastOrderDate: false };
  }

  const schedule = computeFoSchedule({
    targetDeliveryDate: requiredArrivalDate,
    productionLeadTimeDays: leadTime.productionDays,
    logisticsLeadTimeDays: leadTime.transitDays,
    bufferDays: 0,
  });
  const derivedOrderDate = resolveSuggestionOrderDateIso({
    recommendedOrderDate: schedule.orderDate,
    latestOrderDate: normalizeIsoDate(issue.recommendedOrderDate) || normalizeIsoDate(issue.latestOrderDate),
  });
  if (isOrderDateBeforeLocalToday(derivedOrderDate, input.todayIso)) {
    return { suggestion: null, rejectedByPastOrderDate: true };
  }

  const unitPrice = resolveUnitPriceUsd(product);
  const freightPerUnit = resolveFreightPerUnitEur(product);
  const freightTotal = round2(freightPerUnit * suggestedUnits);
  const fxRate = asPositiveNumber(input.settings.fxRate) ?? 0;
  const payments = buildFoPayments({
    supplierTerms: resolveSupplierTerms(supplier),
    schedule,
    unitPrice,
    units: suggestedUnits,
    currency: "USD",
    freight: freightTotal,
    freightCurrency: "EUR",
    dutyRatePct: leadTime.dutyRatePct,
    eustRatePct: leadTime.eustRatePct,
    fxRate,
    incoterm: leadTime.incoterm,
    vatRefundLagMonths: input.settings.vatRefundLagMonths,
    paymentDueDefaults: input.settings.paymentDueDefaults,
    existingPayments: [],
  });

  const id = buildPhantomFoId(issue);
  const foNumber = buildPhantomFoNumber(issue);

  return {
    suggestion: {
      id,
      sku,
      alias: String(issue.alias || product?.alias || sku),
      abcClass: issue.abcClass,
      issueType: issue.issueType,
      supplierId,
      orderMonth: String(issue.orderMonth || "").trim(),
      firstRiskMonth: String(issue.firstRiskMonth || "").trim(),
      latestOrderDate: normalizeIsoDate(issue.latestOrderDate) || (schedule.orderDate || ""),
      requiredArrivalDate,
      recommendedOrderDate: normalizeIsoDate(issue.recommendedOrderDate) || (schedule.orderDate || ""),
      leadTimeDays: leadTime.totalDays,
      overdue: issue.overdue === true,
      suggestedUnits,
      shortageUnits: shortageUnits != null ? shortageUnits : null,
      recommendationStatus: recommendation ? String(recommendation.status || "") : null,
      recommendationUnits: recommendationUnits != null ? recommendationUnits : null,
      foRecord: {
        id,
        foNo: foNumber,
        foNumber,
        sku,
        supplierId,
        targetDeliveryDate: requiredArrivalDate,
        units: suggestedUnits,
        transportMode: leadTime.transportMode,
        incoterm: leadTime.incoterm,
        unitPrice,
        currency: "USD",
        freight: freightTotal,
        freightCurrency: "EUR",
        dutyRatePct: leadTime.dutyRatePct,
        eustRatePct: leadTime.eustRatePct,
        fxRate,
        productionLeadTimeDays: leadTime.productionDays,
        logisticsLeadTimeDays: leadTime.transitDays,
        bufferDays: 0,
        orderDate: schedule.orderDate || null,
        productionEndDate: schedule.productionEndDate || null,
        etdDate: schedule.etdDate || null,
        etaDate: schedule.etaDate || requiredArrivalDate,
        deliveryDate: schedule.deliveryDate || requiredArrivalDate,
        payments,
        status: "ACTIVE",
        phantom: true,
        phantomSource: PHANTOM_FO_SOURCE,
        phantomStatus: "suggested",
        phantomGeneratedAt: new Date().toISOString(),
        phantomMeta: {
          firstRiskMonth: issue.firstRiskMonth,
          orderMonth: issue.orderMonth,
          latestOrderDate: issue.latestOrderDate,
          recommendedOrderDate: issue.recommendedOrderDate,
          leadTimeDays: leadTime.totalDays,
          abcClass: issue.abcClass,
          issueType: issue.issueType,
          shortageUnits: issue.shortageUnits,
          reason: issue.reason,
        },
      },
    },
    rejectedByPastOrderDate: false,
  };
}

export function isPhantomFoRecord(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const row = record as Record<string, unknown>;
  if (row.phantom === true) return true;
  return String(row.id || "").startsWith("phantom-fo-");
}

export function resolvePlanningMonthsFromState(
  state: Record<string, unknown>,
  fallbackHorizonMonths = 18,
): string[] {
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const startMonth = normalizeMonthKey(settings.startMonth) || currentMonthKey();
  const horizon = asPositiveInt(settings.horizonMonths) ?? Math.max(6, Math.round(Number(fallbackHorizonMonths) || 18));
  return monthRange(startMonth, horizon);
}

export function buildPhantomFoSuggestions(input: {
  state: Record<string, unknown>;
  months?: string[] | null;
  maxSuggestions?: number;
}): PhantomFoSuggestion[] {
  const state = input.state || {};
  const todayMonth = currentMonthKey();
  const months = resolveMonthList({ state, months: input.months });
  if (!months.length) return [];
  const horizonEndMonth = months[months.length - 1] || todayMonth;
  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const maxSuggestionsPerSku = resolveMaxSuggestionsPerSku(settings);
  const shortageAcceptancesBySku = resolveShortageAcceptancesBySku(settings);

  const liveProducts = (Array.isArray(state.products) ? state.products : [])
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => normalizeSku(entry.sku))
    .filter(statusIsActive);
  const usedSkuKeys = new Set(
    (Array.isArray(state.products) ? state.products : [])
      .map((entry) => normalizeSku((entry as Record<string, unknown>).sku).toLowerCase())
      .filter(Boolean),
  );
  const planRows = buildPlanProductForecastRows({
    state,
    months,
  }) as Record<string, unknown>[];
  const virtualPlanProducts: Record<string, unknown>[] = [];
  const virtualPlanForecastBySku: Record<string, Record<string, number>> = {};
  planRows.forEach((row, index) => {
    const include = normalizeIncludeInForecast(row.includeInForecast, true);
    if (!include) return;
    const status = String(row.status || "").trim().toLowerCase();
    if (status && status !== "active" && status !== "aktiv") return;
    const mappedSku = String(row.mappedSku || "").trim();
    if (mappedSku) return;
    const alias = String(row.alias || "").trim();
    if (!alias) return;

    const requestedSku = String(row.plannedSku || "").trim();
    const fallbackSku = `PLAN-${normalizeSkuToken(row.id || alias, String(index + 1))}`;
    const sku = ensureUniqueSku(requestedSku || fallbackSku, usedSkuKeys);
    usedSkuKeys.add(sku.toLowerCase());

    const transportMode = normalizeTransportMode(row.transportMode);
    const transitDays = asPositiveInt(row.transitDays)
      ?? resolveTransitDaysForMode(settings, transportMode);
    const productionLead = asPositiveInt(row.productionLeadTimeDaysDefault);
    const unitPriceUsd = asPositiveNumber(row.unitPriceUsd) ?? 0;
    const freightPerUnitRaw = asNumber(row.logisticsPerUnitEur ?? row.freightPerUnitEur, 0);
    const freightPerUnitEur = Number.isFinite(freightPerUnitRaw) ? Math.max(0, freightPerUnitRaw) : 0;
    const plannedUnitsByMonth: Record<string, number> = {};
    const unitsByMonth = row.unitsByMonth && typeof row.unitsByMonth === "object"
      ? row.unitsByMonth as Record<string, unknown>
      : {};
    Object.entries(unitsByMonth).forEach(([monthRaw, unitsRaw]) => {
      const month = normalizeMonthKey(monthRaw);
      const units = asNumber(unitsRaw, Number.NaN);
      if (!month || !Number.isFinite(units)) return;
      plannedUnitsByMonth[month] = Math.max(0, Math.round(units));
    });

    virtualPlanForecastBySku[sku] = plannedUnitsByMonth;
    virtualPlanProducts.push({
      ...row,
      id: `plan-virtual-${String(row.id || index + 1)}`,
      sku,
      alias,
      status: "active",
      includeInForecast: true,
      transportMode,
      transitDays,
      productionLeadTimeDaysDefault: productionLead,
      unitPriceUsd,
      logisticsPerUnitEur: freightPerUnitEur,
      freightPerUnitEur: freightPerUnitEur,
      template: {
        scope: "SKU",
        name: "Planprodukt",
        fields: {
          transportMode,
          transitDays,
          productionDays: productionLead,
          unitPriceUsd,
          freightEur: freightPerUnitEur,
        },
      },
      __planVirtual: true,
      __planProductId: String(row.id || ""),
    });
  });

  const products = [...liveProducts, ...virtualPlanProducts];
  const productBySkuKey = new Map<string, Record<string, unknown>>();
  products.forEach((product) => {
    productBySkuKey.set(normalizeSkuKey(product.sku), product);
  });

  const supplierById = new Map<string, Record<string, unknown>>();
  (Array.isArray(state.suppliers) ? state.suppliers : [])
    .map((entry) => entry as Record<string, unknown>)
    .forEach((supplier) => {
      const id = String(supplier.id || "").trim();
      if (!id) return;
      supplierById.set(id, supplier);
    });

  const forecastState = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const manualBase = (forecastState.forecastManual && typeof forecastState.forecastManual === "object")
    ? forecastState.forecastManual as Record<string, Record<string, unknown>>
    : {};
  const mergedForecastManual: Record<string, Record<string, unknown>> = { ...manualBase };
  Object.entries(virtualPlanForecastBySku).forEach(([sku, byMonth]) => {
    mergedForecastManual[sku] = {
      ...(mergedForecastManual[sku] || {}),
      ...byMonth,
    };
  });
  const planningState: Record<string, unknown> = (virtualPlanProducts.length || Object.keys(virtualPlanForecastBySku).length)
    ? {
      ...state,
      products: [...(Array.isArray(state.products) ? state.products : []), ...virtualPlanProducts],
      forecast: {
        ...forecastState,
        forecastManual: mergedForecastManual,
      },
    }
    : state;

  const suggestions: PhantomFoSuggestion[] = [];
  const seenSuggestionIds = new Set<string>();
  const suggestionCountBySku = new Map<string, number>();
  let workingState = planningState;
  const maxSuggestions = asPositiveInt(input.maxSuggestions);
  const maxIterations = Math.max(1, months.length * 2, maxSuggestionsPerSku + 2);
  const todayIso = localTodayIso();

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const recommendationContext = buildFoRecommendationContext(workingState);
    const existingFoIds = new Set(
      (Array.isArray(workingState.fos) ? workingState.fos : [])
        .map((entry) => String((entry as Record<string, unknown>)?.id || "").trim())
        .filter(Boolean),
    );

    const iterationSuggestions: PhantomFoSuggestion[] = [];
    const temporaryAcceptancesBySku = new Map<string, ShortageAcceptanceOverride>();
    const blockedSkuKeys = new Set<string>();
    const skippedIssueKeys = new Set<string>();
    const maxIssueSelectionRounds = Math.max(1, months.length);

    for (let issueRound = 0; issueRound < maxIssueSelectionRounds; issueRound += 1) {
      const issueState = buildTemporaryAcceptanceState({
        state: workingState,
        temporaryAcceptancesBySku,
      });
      const scopedIssues = buildScopedOrderDutyIssues({
        state: issueState,
        months,
        horizonEndMonth,
        todayMonth,
        shortageAcceptancesBySku,
      })
        .filter((issue) => {
          const skuKey = normalizeSkuKey(issue.sku);
          if (!skuKey) return false;
          if ((suggestionCountBySku.get(skuKey) || 0) >= maxSuggestionsPerSku) return false;
          if (blockedSkuKeys.has(skuKey)) return false;
          return !skippedIssueKeys.has(issueSelectionKey(issue));
        });
      if (!scopedIssues.length) break;

      let progressed = false;
      scopedIssues.forEach((issue) => {
        const skuKey = normalizeSkuKey(issue.sku);
        if (!skuKey || blockedSkuKeys.has(skuKey)) return;
        const selectionKey = issueSelectionKey(issue);
        if (skippedIssueKeys.has(selectionKey)) return;

        const attempt = buildSuggestionForIssue({
          state: workingState,
          issue,
          productBySkuKey,
          supplierById,
          settings,
          recommendationContext,
          horizonMonths: months.length,
          todayIso,
        });
        const suggestion = attempt.suggestion;
        if (suggestion && !seenSuggestionIds.has(suggestion.id) && !existingFoIds.has(suggestion.id)) {
          seenSuggestionIds.add(suggestion.id);
          suggestionCountBySku.set(skuKey, (suggestionCountBySku.get(skuKey) || 0) + 1);
          iterationSuggestions.push(suggestion);
          blockedSkuKeys.add(skuKey);
          progressed = true;
          return;
        }
        if (attempt.rejectedByPastOrderDate) {
          const firstRiskMonth = normalizeMonthKey(issue.firstRiskMonth);
          if (!firstRiskMonth) {
            blockedSkuKeys.add(skuKey);
            return;
          }
          const acceptedMonth = firstRiskMonth < todayMonth ? todayMonth : firstRiskMonth;
          const temporarySkuReasonKey = `${skuKey}::${issue.issueType}`;
          const existingTemporaryAcceptance = temporaryAcceptancesBySku.get(temporarySkuReasonKey);
          const sameReason = existingTemporaryAcceptance?.reason === issue.issueType;
          const acceptedFromMonth = sameReason
            ? (
              existingTemporaryAcceptance!.acceptedFromMonth < acceptedMonth
                ? existingTemporaryAcceptance!.acceptedFromMonth
                : acceptedMonth
            )
            : acceptedMonth;
          const acceptedUntilMonth = sameReason
            ? (
              existingTemporaryAcceptance!.acceptedUntilMonth > acceptedMonth
                ? existingTemporaryAcceptance!.acceptedUntilMonth
                : acceptedMonth
            )
            : acceptedMonth;
          const nextAcceptance: ShortageAcceptanceOverride = {
            sku: normalizeSku(issue.sku),
            reason: issue.issueType,
            acceptedFromMonth,
            acceptedUntilMonth,
            durationMonths: 1,
          };
          const hasChanged = !existingTemporaryAcceptance
            || existingTemporaryAcceptance.reason !== nextAcceptance.reason
            || existingTemporaryAcceptance.acceptedFromMonth !== nextAcceptance.acceptedFromMonth
            || existingTemporaryAcceptance.acceptedUntilMonth !== nextAcceptance.acceptedUntilMonth;
          if (hasChanged) {
            temporaryAcceptancesBySku.set(temporarySkuReasonKey, nextAcceptance);
            skippedIssueKeys.add(selectionKey);
            progressed = true;
            return;
          }
        }
        blockedSkuKeys.add(skuKey);
      });
      if (!progressed) break;
    }

    if (!iterationSuggestions.length) break;
    suggestions.push(...iterationSuggestions);
    if (maxSuggestions != null && suggestions.length >= maxSuggestions) break;
    workingState = buildStateWithPhantomFos({
      state: workingState,
      suggestions: iterationSuggestions,
    });
  }

  const gatedSuggestions = suggestions.filter((entry) => (
    !isOrderDateBeforeLocalToday(resolveSuggestionOrderDateIso({
      recommendedOrderDate: entry.recommendedOrderDate,
      latestOrderDate: entry.latestOrderDate,
      foRecord: entry.foRecord,
    }), todayIso)
  ));

  gatedSuggestions.sort(compareSuggestionPriority);
  if (maxSuggestions != null) {
    return gatedSuggestions.slice(0, maxSuggestions);
  }
  return gatedSuggestions;
}

export function buildStateWithPhantomFos(input: {
  state: Record<string, unknown>;
  suggestions: PhantomFoSuggestion[];
}): Record<string, unknown> {
  const state = input.state || {};
  const todayIso = localTodayIso();
  const baseFos = Array.isArray(state.fos) ? state.fos as Record<string, unknown>[] : [];
  const existingIds = new Set(
    baseFos
      .map((entry) => String((entry as Record<string, unknown>).id || "").trim())
      .filter(Boolean),
  );
  const phantomRecords = input.suggestions
    .filter((entry) => !isOrderDateBeforeLocalToday(resolveSuggestionOrderDateIso({
      recommendedOrderDate: entry.recommendedOrderDate,
      latestOrderDate: entry.latestOrderDate,
      foRecord: entry.foRecord,
    }), todayIso))
    .map((entry) => entry.foRecord)
    .filter((record) => {
      const id = String(record.id || "").trim();
      if (!id) return false;
      return !existingIds.has(id);
    });
  return {
    ...state,
    fos: [...baseFos, ...phantomRecords],
  };
}

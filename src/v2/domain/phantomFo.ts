import { parseDeNumber } from "../../lib/dataHealth.js";
import { resolveMasterDataHierarchy } from "./masterDataHierarchy";
import { currentMonthKey, monthRange, normalizeMonthKey } from "./months";
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

const PHANTOM_FO_SOURCE = "robustness_order_duty_v2";

interface PhantomLeadTime {
  productionDays: number;
  transitDays: number;
  totalDays: number;
  transportMode: string;
  incoterm: string;
  dutyRatePct: number;
  eustRatePct: number;
}

export interface PhantomFoSuggestion {
  id: string;
  sku: string;
  alias: string;
  abcClass: "A" | "B" | "C";
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

function monthStartIso(month: string): string | null {
  const normalized = normalizeMonthKey(month);
  if (!normalized) return null;
  return `${normalized}-01`;
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
  const dedup = new Map<string, RobustnessCoverageOrderDutyIssue>();
  robustness.months.forEach((monthRow) => {
    const issueMap = toIssueMapBySku(monthRow.coverage.orderDutyIssues);
    issueMap.forEach((issue, skuKey) => {
      if (dedup.has(skuKey)) return;
      dedup.set(skuKey, issue);
    });
  });
  return Array.from(dedup.values());
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
  return resolvePlanningMonthsFromState(input.state);
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

function resolvePhantomTargetMonth(months: string[], targetMonth?: string | null): string | null {
  if (!months.length) return null;
  const normalizedTarget = normalizeMonthKey(targetMonth);
  if (!normalizedTarget) return months[months.length - 1];
  let candidate: string | null = null;
  months.forEach((month) => {
    if (month <= normalizedTarget) {
      candidate = month;
    }
  });
  if (candidate) return candidate;
  return months[0];
}

function buildSuggestionForIssue(input: {
  state: Record<string, unknown>;
  issue: RobustnessCoverageOrderDutyIssue;
  productBySkuKey: Map<string, Record<string, unknown>>;
  supplierById: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  recommendationContext: ReturnType<typeof buildFoRecommendationContext>;
  horizonMonths: number;
}): PhantomFoSuggestion | null {
  const issue = input.issue;
  const sku = normalizeSku(issue.sku);
  if (!sku) return null;
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
  if (!requiredArrivalDate) return null;

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
  if (!(suggestedUnits > 0)) return null;

  const schedule = computeFoSchedule({
    targetDeliveryDate: requiredArrivalDate,
    productionLeadTimeDays: leadTime.productionDays,
    logisticsLeadTimeDays: leadTime.transitDays,
    bufferDays: 0,
  });

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
    id,
    sku,
    alias: String(issue.alias || product?.alias || sku),
    abcClass: issue.abcClass,
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
        shortageUnits: issue.shortageUnits,
        reason: issue.reason,
      },
    },
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
  targetMonth?: string | null;
  maxSuggestions?: number;
}): PhantomFoSuggestion[] {
  const state = input.state || {};
  const months = resolveMonthList({ state, months: input.months });
  if (!months.length) return [];
  const targetMonth = resolvePhantomTargetMonth(months, input.targetMonth);
  if (!targetMonth) return [];

  const products = (Array.isArray(state.products) ? state.products : [])
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => normalizeSku(entry.sku))
    .filter(statusIsActive);
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

  const settings = (state.settings && typeof state.settings === "object")
    ? state.settings as Record<string, unknown>
    : {};
  const suggestions: PhantomFoSuggestion[] = [];
  const seenSuggestionIds = new Set<string>();
  let workingState = state;
  const maxSuggestions = asPositiveInt(input.maxSuggestions);
  const maxIterations = Math.max(1, months.length * 2);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const recommendationContext = buildFoRecommendationContext(workingState);
    const scopedIssues = collectOrderDutyIssues(workingState, months)
      .filter((issue) => {
        const orderMonth = normalizeMonthKey(issue.orderMonth);
        if (!orderMonth) return false;
        return orderMonth <= targetMonth;
      });
    if (!scopedIssues.length) break;

    const existingFoIds = new Set(
      (Array.isArray(workingState.fos) ? workingState.fos : [])
        .map((entry) => String((entry as Record<string, unknown>)?.id || "").trim())
        .filter(Boolean),
    );

    const iterationSuggestions: PhantomFoSuggestion[] = [];
    scopedIssues.forEach((issue) => {
      const suggestion = buildSuggestionForIssue({
        state: workingState,
        issue,
        productBySkuKey,
        supplierById,
        settings,
        recommendationContext,
        horizonMonths: months.length,
      });
      if (!suggestion) return;
      if (seenSuggestionIds.has(suggestion.id) || existingFoIds.has(suggestion.id)) return;
      seenSuggestionIds.add(suggestion.id);
      iterationSuggestions.push(suggestion);
    });

    if (!iterationSuggestions.length) break;
    suggestions.push(...iterationSuggestions);
    if (maxSuggestions != null && suggestions.length >= maxSuggestions) break;
    workingState = buildStateWithPhantomFos({
      state: workingState,
      suggestions: iterationSuggestions,
    });
  }

  suggestions.sort(compareSuggestionPriority);
  if (maxSuggestions != null) {
    return suggestions.slice(0, maxSuggestions);
  }
  return suggestions;
}

export function buildStateWithPhantomFos(input: {
  state: Record<string, unknown>;
  suggestions: PhantomFoSuggestion[];
}): Record<string, unknown> {
  const state = input.state || {};
  const baseFos = Array.isArray(state.fos) ? state.fos as Record<string, unknown>[] : [];
  const existingIds = new Set(
    baseFos
      .map((entry) => String((entry as Record<string, unknown>).id || "").trim())
      .filter(Boolean),
  );
  const phantomRecords = input.suggestions
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

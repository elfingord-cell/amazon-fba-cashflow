import { computeAbcClassification } from "../../domain/abcClassification.js";
import { computeInventoryProjection } from "../../domain/inventoryProjection.js";
import { parseDeNumber } from "../../lib/dataHealth.js";
import { evaluateProductCompletenessV2 } from "./productCompletenessV2";

export type RobustnessSeverity = "error" | "warning";
export type RobustnessCheckStatus = "ok" | "error";
export type RobustnessCheckKey = "sku_coverage" | "cash_in" | "fixcost" | "vat" | "revenue_inputs";

export interface RobustnessCheckResult {
  key: RobustnessCheckKey;
  label: string;
  status: RobustnessCheckStatus;
  passed: boolean;
  detail: string;
  blockerCount: number;
  route: string;
}

export interface RobustnessBlocker {
  id: string;
  month: string;
  checkKey: RobustnessCheckKey;
  severity: RobustnessSeverity;
  message: string;
  sku?: string;
  alias?: string;
  route: string;
}

export interface DashboardRobustMonth {
  month: string;
  robust: boolean;
  checks: RobustnessCheckResult[];
  blockers: RobustnessBlocker[];
  blockerCount: number;
  coverage: {
    activeSkus: number;
    coveredSkus: number;
    ratio: number;
    missingForecastSkus: string[];
    safetyRiskSkus: string[];
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

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSkuKey(value: unknown): string {
  return normalizeSku(value).toLowerCase();
}

function isActiveProduct(product: Record<string, unknown>): boolean {
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

function buildActions(input: {
  months: DashboardRobustMonth[];
  hasFixcostBasis: boolean;
  vatActive: boolean;
  revenueIssueSkus: number;
}): DashboardActionItem[] {
  const missingForecastCount = input.months.reduce((sum, month) => sum + month.coverage.missingForecastSkus.length, 0);
  const safetyRiskCount = input.months.reduce((sum, month) => sum + month.coverage.safetyRiskSkus.length, 0);
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
  if (safetyRiskCount > 0) {
    actions.push({
      id: "inventory_safety",
      title: "Bestandsrisiken sichern (PO/FO)",
      detail: `${safetyRiskCount} SKU-Monat(e) unter Safety.`,
      severity: "error",
      route: "/v2/inventory/projektion",
      count: safetyRiskCount,
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
  const projection = computeInventoryProjection({
    state,
    months,
    products: activeProducts,
    snapshot: null,
    snapshotMonth: months[0] || undefined,
    projectionMode: "units",
  }) as {
    perSkuMonth: Map<string, Map<string, {
      hasForecast?: boolean;
      isCovered?: boolean;
    }>>;
  };
  const abcBySku = computeAbcClassification(state).bySku;

  const monthResults: DashboardRobustMonth[] = months.map((month) => {
    const missingForecast: ProductRef[] = [];
    const safetyRisk: ProductRef[] = [];
    let coveredSkus = 0;

    activeProducts.forEach((product) => {
      const sku = normalizeSku(product.sku);
      if (!sku) return;
      const alias = String(product.alias || sku);
      const abcClass = resolveAbcClass(abcBySku, sku);
      const skuProjection = projection.perSkuMonth.get(sku) || projection.perSkuMonth.get(normalizeSkuKey(sku));
      const monthData = skuProjection?.get(month);
      const hasForecast = Boolean(monthData?.hasForecast);
      const isCovered = hasForecast && Boolean(monthData?.isCovered);
      if (isCovered) {
        coveredSkus += 1;
        return;
      }
      const ref = { sku, alias, abcClass } satisfies ProductRef;
      if (!hasForecast) {
        missingForecast.push(ref);
        return;
      }
      safetyRisk.push(ref);
    });

    const coveragePassed = activeSkuCount > 0
      && missingForecast.length === 0
      && safetyRisk.length === 0
      && coveredSkus === activeSkuCount;
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
      missingForecast.slice(0, 20).forEach((entry) => {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): Forecast fehlt.`,
          sku: entry.sku,
          alias: entry.alias,
          route: "/v2/forecast",
        });
      });
      if (missingForecast.length > 20) {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `+ ${missingForecast.length - 20} weitere SKU(s) ohne Forecast.`,
          route: "/v2/forecast",
        });
      }
      safetyRisk.slice(0, 20).forEach((entry) => {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `${entry.sku} (${entry.alias}): unter Safety (${entry.abcClass}).`,
          sku: entry.sku,
          alias: entry.alias,
          route: "/v2/inventory/projektion",
        });
      });
      if (safetyRisk.length > 20) {
        addBlocker({
          month,
          checkKey: "sku_coverage",
          severity: "error",
          message: `+ ${safetyRisk.length - 20} weitere SKU(s) unter Safety.`,
          route: "/v2/inventory/projektion",
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
          route: "/v2/products",
        });
      });
    }

    const checks: RobustnessCheckResult[] = [
      {
        key: "sku_coverage",
        label: "SKU-Coverage 100%",
        status: coveragePassed ? "ok" : "error",
        passed: coveragePassed,
        detail: `${coveredSkus}/${activeSkuCount} abgedeckt · Forecast fehlt ${missingForecast.length} · Safety ${safetyRisk.length}`,
        blockerCount: missingForecast.length + safetyRisk.length + (activeSkuCount === 0 ? 1 : 0),
        route: missingForecast.length > 0 ? "/v2/forecast" : "/v2/inventory/projektion",
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
    const abRiskSkuSet = new Set(
      safetyRisk
        .filter((entry) => entry.abcClass === "A" || entry.abcClass === "B")
        .map((entry) => normalizeSkuKey(entry.sku)),
    );

    return {
      month,
      robust,
      checks,
      blockers,
      blockerCount: blockers.length,
      coverage: {
        activeSkus: activeSkuCount,
        coveredSkus,
        ratio: activeSkuCount ? coveredSkus / activeSkuCount : 0,
        missingForecastSkus: missingForecast.map((entry) => entry.sku),
        safetyRiskSkus: safetyRisk.map((entry) => entry.sku),
        abRiskSkuCount: abRiskSkuSet.size,
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

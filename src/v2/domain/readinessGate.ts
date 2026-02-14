import { computeInventoryProjection } from "../../domain/inventoryProjection.js";
import { buildDashboardRobustness } from "./dashboardRobustness";
import { addMonths, currentMonthKey, monthRange, normalizeMonthKey } from "./months";

export type ReadinessCheckKey =
  | "runtime_stable"
  | "robust_12m"
  | "anchor_history_complete"
  | "forecast_fresh"
  | "forecast_drift_reviewed";

export interface ReadinessCheckResult {
  key: ReadinessCheckKey;
  label: string;
  passed: boolean;
  status: "ok" | "error";
  detail: string;
  route: string;
  blockerCount: number;
}

export interface ReadinessBlocker {
  id: string;
  key: ReadinessCheckKey;
  severity: "error";
  label: string;
  message: string;
  route: string;
}

export interface ReadinessGateResult {
  ready: boolean;
  status: "ready" | "not_ready";
  horizonMonths: number;
  checks: ReadinessCheckResult[];
  blockers: ReadinessBlocker[];
  robustMonthsCount: number;
  robustRequiredCount: number;
  anchorMissingHistoryCount: number;
  anchorMissingHistorySkus: string[];
  forecastDaysSinceImport: number | null;
  driftComparedAt: string | null;
  driftReviewedAt: string | null;
  driftReviewedForComparedAt: string | null;
}

interface BuildReadinessGateInput {
  state: Record<string, unknown>;
  horizonMonths?: number;
  runtimeErrorAt?: string | null;
  runtimeErrorRoute?: string | null;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isActiveOrPrelaunch(product: Record<string, unknown>): boolean {
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active"
    || status === "aktiv"
    || status === "prelaunch"
    || status === "not_launched"
    || status === "planned";
}

function normalizeSku(value: unknown): string {
  return String(value || "").trim();
}

function buildProjectionProducts(state: Record<string, unknown>): Array<Record<string, unknown>> {
  const products = Array.isArray(state.products) ? state.products as Record<string, unknown>[] : [];
  return products
    .filter((product) => {
      const sku = normalizeSku(product.sku);
      if (!sku) return false;
      return isActiveOrPrelaunch(product);
    })
    .map((product) => ({
      sku: normalizeSku(product.sku),
      alias: String(product.alias || product.sku || ""),
      status: String(product.status || "active"),
      safetyStockDohOverride: product.safetyStockDohOverride,
      foCoverageDohOverride: product.foCoverageDohOverride,
    }));
}

function parseDriftComparedAt(forecast: Record<string, unknown>): string | null {
  const summary = (forecast.lastDriftSummary && typeof forecast.lastDriftSummary === "object")
    ? forecast.lastDriftSummary as Record<string, unknown>
    : {};
  const comparedAt = typeof summary.comparedAt === "string" ? summary.comparedAt : null;
  return comparedAt && asDate(comparedAt) ? comparedAt : null;
}

function buildBlockerFromCheck(check: ReadinessCheckResult): ReadinessBlocker {
  return {
    id: `gate:${check.key}`,
    key: check.key,
    severity: "error",
    label: check.label,
    message: check.detail,
    route: check.route,
  };
}

export function buildReadinessGate(input: BuildReadinessGateInput): ReadinessGateResult {
  const state = (input.state || {}) as Record<string, unknown>;
  const horizonMonths = Number.isFinite(input.horizonMonths as number)
    ? Math.max(1, Math.round(Number(input.horizonMonths)))
    : 12;
  const months = monthRange(currentMonthKey(), horizonMonths);
  const robustness = buildDashboardRobustness({ state, months });
  const robustPassed = robustness.robustMonthsCount >= months.length && months.length > 0;

  const projectionProducts = buildProjectionProducts(state);
  const projection = computeInventoryProjection({
    state,
    months,
    products: projectionProducts,
    snapshot: null,
    snapshotMonth: addMonths(currentMonthKey(), -1),
    projectionMode: "units",
  }) as Record<string, unknown>;
  const anchorMissingHistorySkus = Array.isArray(projection.anchorSkuMissingHistory)
    ? projection.anchorSkuMissingHistory
      .map((sku) => normalizeSku(sku))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "de-DE"))
    : [];
  const anchorHistoryPassed = anchorMissingHistorySkus.length === 0;

  const forecast = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const importAt = typeof forecast.lastImportAt === "string" ? forecast.lastImportAt : null;
  const importDate = asDate(importAt);
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const forecastDaysSinceImport = importDate
    ? Math.floor((now.getTime() - importDate.getTime()) / msPerDay)
    : null;
  const forecastFreshPassed = forecastDaysSinceImport != null && forecastDaysSinceImport <= 35;

  const driftComparedAt = parseDriftComparedAt(forecast);
  const driftReviewedForComparedAt = typeof forecast.lastDriftReviewedComparedAt === "string"
    ? forecast.lastDriftReviewedComparedAt
    : null;
  const driftReviewedAt = typeof forecast.lastDriftReviewedAt === "string"
    ? forecast.lastDriftReviewedAt
    : null;
  const driftReviewedPassed = Boolean(
    driftComparedAt
    && driftReviewedForComparedAt
    && normalizeMonthKey(String(driftComparedAt).slice(0, 7))
    && driftReviewedForComparedAt === driftComparedAt
    && asDate(driftReviewedAt),
  );

  const runtimeErrorAt = input.runtimeErrorAt && asDate(input.runtimeErrorAt)
    ? String(input.runtimeErrorAt)
    : null;
  const runtimeStablePassed = !runtimeErrorAt;

  const checks: ReadinessCheckResult[] = [
    {
      key: "runtime_stable",
      label: "Runtime stabil",
      passed: runtimeStablePassed,
      status: runtimeStablePassed ? "ok" : "error",
      detail: runtimeStablePassed
        ? "Keine offenen Tab-Ladefehler."
        : `Offener Tab-Ladefehler seit ${new Date(runtimeErrorAt as string).toLocaleString("de-DE")}${input.runtimeErrorRoute ? ` (${input.runtimeErrorRoute})` : ""}.`,
      route: "/v2/dashboard",
      blockerCount: runtimeStablePassed ? 0 : 1,
    },
    {
      key: "robust_12m",
      label: "Robustheit 12M",
      passed: robustPassed,
      status: robustPassed ? "ok" : "error",
      detail: robustPassed
        ? `${robustness.robustMonthsCount}/${months.length} Monate robust.`
        : `${robustness.robustMonthsCount}/${months.length} Monate robust (erforderlich: ${months.length}).`,
      route: "/v2/dashboard",
      blockerCount: robustPassed ? 0 : Math.max(0, months.length - robustness.robustMonthsCount),
    },
    {
      key: "anchor_history_complete",
      label: "Anchor-Historie vollständig",
      passed: anchorHistoryPassed,
      status: anchorHistoryPassed ? "ok" : "error",
      detail: anchorHistoryPassed
        ? "Alle aktiven/prelaunch SKUs haben Snapshot-Historie."
        : `${anchorMissingHistorySkus.length} SKU(s) ohne Snapshot-Historie (Anker=0).`,
      route: "/v2/inventory/projektion?source=dashboard&risk=under_safety&abc=ab&expand=all",
      blockerCount: anchorMissingHistorySkus.length,
    },
    {
      key: "forecast_fresh",
      label: "Forecast aktuell",
      passed: forecastFreshPassed,
      status: forecastFreshPassed ? "ok" : "error",
      detail: forecastFreshPassed
        ? `${forecastDaysSinceImport} Tage seit Import.`
        : (forecastDaysSinceImport == null
          ? "Kein Forecast-Import vorhanden."
          : `${forecastDaysSinceImport} Tage seit Import (erlaubt <= 35).`),
      route: "/v2/forecast",
      blockerCount: forecastFreshPassed ? 0 : 1,
    },
    {
      key: "forecast_drift_reviewed",
      label: "Drift geprüft",
      passed: driftReviewedPassed,
      status: driftReviewedPassed ? "ok" : "error",
      detail: driftReviewedPassed
        ? `Drift-Stand vom ${new Date(driftComparedAt as string).toLocaleDateString("de-DE")} geprüft.`
        : (driftComparedAt
          ? "Aktueller Drift-Stand ist noch nicht als geprüft markiert."
          : "Noch kein Driftvergleich verfügbar."),
      route: "/v2/forecast",
      blockerCount: driftReviewedPassed ? 0 : 1,
    },
  ];

  const blockers = checks
    .filter((check) => !check.passed)
    .map((check) => buildBlockerFromCheck(check));

  const ready = blockers.length === 0;
  return {
    ready,
    status: ready ? "ready" : "not_ready",
    horizonMonths,
    checks,
    blockers,
    robustMonthsCount: robustness.robustMonthsCount,
    robustRequiredCount: months.length,
    anchorMissingHistoryCount: anchorMissingHistorySkus.length,
    anchorMissingHistorySkus,
    forecastDaysSinceImport,
    driftComparedAt,
    driftReviewedAt,
    driftReviewedForComparedAt,
  };
}

import {
  buildSkuProjection,
  computeFoRecommendation,
  getLatestClosingSnapshotMonth,
} from "./foSuggestion.js";

/**
 * Example API handler for GET /api/fo/suggestion?sku=SKU123
 * Assumptions:
 * - Data access is synchronous for the example (swap with DB queries in production).
 * - ETA override takes precedence over lead time.
 * - This handler is framework-agnostic; adapt to Express/Fastify as needed.
 */
export function handleFoSuggestionRequest({ query, dataAccess, today = new Date() }) {
  const sku = query?.sku;
  if (!sku) {
    return { status: 400, body: { error: "Missing sku parameter." } };
  }

  const baselineMonth =
    dataAccess?.latestSnapshotMonth
    || getLatestClosingSnapshotMonth(dataAccess?.snapshots || []);
  const safetyDays = Number(dataAccess?.settings?.safetyStockDohDefault ?? 60);
  const coverageDays = Number(dataAccess?.settings?.foCoverageDohDefault ?? 90);
  const leadTimeDays = Number(dataAccess?.settings?.leadTimeDays ?? 0);
  const stock0 = dataAccess?.closingStockBySku?.[sku]?.[baselineMonth] ?? 0;
  const projection = baselineMonth
    ? buildSkuProjection({
        sku,
        baselineMonth,
        stock0,
        forecastByMonth: dataAccess?.plannedSalesBySku?.[sku] || {},
        inboundByMonth: dataAccess?.inboundBySku?.[sku] || {},
        horizonMonths: Number(dataAccess?.settings?.horizonMonths ?? 12),
      })
    : null;
  const suggestion = computeFoRecommendation({
    sku,
    baselineMonth,
    projection,
    safetyStockDays: safetyDays,
    coverageDays,
    leadTimeDays,
    cnyPeriod: dataAccess?.settings?.cny,
    inboundWithoutEtaCount: Number(dataAccess?.inboundWithoutEtaCount ?? 0),
  });

  return { status: 200, body: suggestion };
}

export const sampleFoSuggestionResponse = {
  sku: "SKU123",
  status: "ok",
  baselineMonth: "2026-01",
  criticalMonth: "2026-03",
  requiredArrivalDate: "2026-03-01",
  orderDate: "2026-01-01",
  orderDateAdjusted: "2025-12-20",
  overlapDays: 12,
  recommendedUnits: 500,
  stockAtArrival: 200,
  avgDailyDemand: 8,
  issues: [{ code: "MISSING_FORECAST", count: 2 }],
};

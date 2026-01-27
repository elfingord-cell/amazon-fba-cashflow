import { computeFoSuggestion } from "./foSuggestion.js";

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

  const operationalCoverageDays =
    query?.operationalCoverageDays != null
      ? Number(query.operationalCoverageDays)
      : undefined;
  const etaDate = query?.etaDate ?? undefined;

  const suggestion = computeFoSuggestion({
    sku,
    today,
    operationalCoverageDays: Number.isFinite(operationalCoverageDays)
      ? operationalCoverageDays
      : undefined,
    etaDate,
    policyOverrides: dataAccess.policyOverridesBySku,
    policyDefaults: dataAccess.policyDefaults,
    plannedSalesBySku: dataAccess.plannedSalesBySku,
    closingStockBySku: dataAccess.closingStockBySku,
  });

  return { status: 200, body: suggestion };
}

export const sampleFoSuggestionResponse = {
  sku: "SKU123",
  etaDate: "2025-05-12",
  suggestedUnits: 500,
  confidence: "high",
  rationale: {
    dailyRateToday: 10,
    dailyRateEta: 10,
    safetyStockDays: 60,
    leadTimeDays: 20,
    operationalCoverageDays: 120,
    targetCoverageTotalDays: 180,
    projectedInventoryAtEta: 250,
    demandUnits: 1200,
    dohToday: 55,
    dohEta: 25,
    dohEndOfMonth: 20,
    requiredUnits: 1200,
    netNeeded: 950,
  },
  warnings: [],
  orderNeededFlag: true,
};

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthKey(value) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) throw new Error(`Invalid month: ${value}`);
  return { year, month: month - 1 };
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MILLIS_PER_DAY);
}

function resolveSkuPolicy(sku, overrides = {}, defaults = {}) {
  const override = overrides?.[sku] ?? {};
  return {
    safetyStockDaysTotalDe: override.safetyStockDaysTotalDe ?? defaults.safetyStockDaysTotalDe ?? 60,
    minimumStockDaysTotalDe: override.minimumStockDaysTotalDe ?? defaults.minimumStockDaysTotalDe ?? null,
    leadTimeDaysTotal: override.leadTimeDaysTotal ?? defaults.leadTimeDaysTotal ?? 0,
    moqUnits: override.moqUnits ?? defaults.moqUnits ?? 0,
    operationalCoverageDaysDefault:
      override.operationalCoverageDaysOverride ?? defaults.operationalCoverageDaysDefault ?? 120,
  };
}

function getPlannedSalesForMonth(plansBySku, sku, month) {
  return plansBySku?.[sku]?.[month] ?? null;
}

function getClosingStockForMonth(snapshotsBySku, sku, month) {
  return snapshotsBySku?.[sku]?.[month] ?? null;
}

function getDailyRateForMonth({ plansBySku, sku, month, fallbackDailyRate, warnings }) {
  const plannedSalesUnits = getPlannedSalesForMonth(plansBySku, sku, month);
  const { year, month: monthIndex } = parseMonthKey(month);
  const days = daysInMonth(year, monthIndex);

  if (plannedSalesUnits == null) {
    if (fallbackDailyRate != null) {
      warnings.push(`Forecast missing for ${month}; using last available daily rate.`);
      return { dailyRate: fallbackDailyRate, days, missingForecast: true };
    }
    warnings.push(`Forecast missing for ${month}; daily rate assumed 0.`);
    return { dailyRate: 0, days, missingForecast: true };
  }

  if (plannedSalesUnits === 0) {
    warnings.push(`Forecast for ${month} is zero; demand treated as 0.`);
  }

  return { dailyRate: plannedSalesUnits / days, days, missingForecast: false };
}

function getDailyRateForDate({ plansBySku, sku, date, fallbackDailyRate, warnings }) {
  const month = monthKey(date);
  return getDailyRateForMonth({ plansBySku, sku, month, fallbackDailyRate, warnings }).dailyRate;
}

function estimateInventoryOnDate({ snapshotsBySku, plansBySku, sku, date, fallbackDailyRate, warnings }) {
  const month = monthKey(date);
  const closingStockUnits = getClosingStockForMonth(snapshotsBySku, sku, month);
  if (closingStockUnits == null) {
    warnings.push(`Closing stock snapshot missing for ${month}.`);
    return { inventoryUnits: null, missingSnapshot: true, missingForecast: false };
  }

  const plannedSalesUnits = getPlannedSalesForMonth(plansBySku, sku, month);
  const { year, month: monthIndex } = parseMonthKey(month);
  const days = daysInMonth(year, monthIndex);
  let plannedUnitsForMonth = plannedSalesUnits;
  let missingForecast = false;
  if (plannedUnitsForMonth == null) {
    missingForecast = true;
    if (fallbackDailyRate != null) {
      plannedUnitsForMonth = fallbackDailyRate * days;
      warnings.push(`Forecast missing for ${month}; inventory estimated using fallback rate.`);
    } else {
      plannedUnitsForMonth = 0;
      warnings.push(`Forecast missing for ${month}; inventory estimated without sales drawdown.`);
    }
  }
  const dailyRate = plannedUnitsForMonth / days;
  const bomStock = closingStockUnits + plannedUnitsForMonth;
  const dayIndex = date.getUTCDate() - 1;
  const inventoryUnits = bomStock - dayIndex * dailyRate;
  return { inventoryUnits, missingSnapshot: false, missingForecast };
}

function integrateDemand({ plansBySku, sku, startDate, endDate, warnings }) {
  let cursor = new Date(startDate.getTime());
  let total = 0;
  let fallbackDailyRate = null;
  let missingForecast = false;

  while (cursor < endDate) {
    const month = monthKey(cursor);
    const { year, month: monthIndex } = parseMonthKey(month);
    const daysInThisMonth = daysInMonth(year, monthIndex);
    const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1));
    const segmentEnd = nextMonthStart < endDate ? nextMonthStart : endDate;
    const segmentDays = Math.ceil((segmentEnd.getTime() - cursor.getTime()) / MILLIS_PER_DAY);
    const rateInfo = getDailyRateForMonth({ plansBySku, sku, month, fallbackDailyRate, warnings });
    total += rateInfo.dailyRate * segmentDays;
    if (!rateInfo.missingForecast) {
      fallbackDailyRate = rateInfo.dailyRate;
    } else {
      missingForecast = true;
    }
    cursor = segmentEnd;
    if (segmentDays >= daysInThisMonth && rateInfo.dailyRate != null) {
      fallbackDailyRate = rateInfo.dailyRate;
    }
  }

  return { demandUnits: total, missingForecast, fallbackDailyRate };
}

function computeDoh(inventoryUnits, dailyRate) {
  if (dailyRate === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(dailyRate) || dailyRate < 0) return null;
  return inventoryUnits / dailyRate;
}

function clampNonNegative(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function computeFoSuggestion({
  sku,
  today = new Date(),
  operationalCoverageDays,
  etaDate,
  policyOverrides,
  policyDefaults,
  plannedSalesBySku,
  closingStockBySku,
}) {
  // Assumptions per business rules:
  // - Inventory is interpolated linearly within each month (no intra-month inbound modeled).
  // - Monthly planned sales are evenly distributed by calendar days of that month.
  // - If data is missing, we fall back to last-known daily rate for demand or demand-only
  //   for the suggested units, and downgrade confidence accordingly.
  const warnings = [];
  const policy = resolveSkuPolicy(sku, policyOverrides, policyDefaults);
  const todayDate = parseIsoDate(today);
  const eta = etaDate ? parseIsoDate(etaDate) : addDays(todayDate, policy.leadTimeDaysTotal);
  const targetCoverageDays =
    operationalCoverageDays != null ? operationalCoverageDays : policy.operationalCoverageDaysDefault;

  const horizonEnd = addDays(eta, targetCoverageDays);
  const demandInfo = integrateDemand({
    plansBySku: plannedSalesBySku,
    sku,
    startDate: eta,
    endDate: horizonEnd,
    warnings,
  });

  let confidence = "high";
  if (demandInfo.missingForecast) {
    confidence = "medium";
  }

  const inventoryInfo = estimateInventoryOnDate({
    snapshotsBySku: closingStockBySku,
    plansBySku: plannedSalesBySku,
    sku,
    date: eta,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });

  if (inventoryInfo.missingSnapshot) {
    confidence = "low";
  }

  let projectedInventoryAtEta = inventoryInfo.inventoryUnits ?? 0;
  if (projectedInventoryAtEta < 0) {
    projectedInventoryAtEta = 0;
    warnings.push("Projected inventory at ETA was negative and has been clamped to 0.");
  }

  const demandUnits = demandInfo.demandUnits;
  const requiredUnits = demandUnits;
  let netNeeded = requiredUnits - projectedInventoryAtEta;
  if (inventoryInfo.missingSnapshot) {
    netNeeded = requiredUnits;
    warnings.push("Inventory snapshot missing; suggestion based on demand only.");
  }
  const rawSuggested = clampNonNegative(netNeeded);
  let suggestedUnits = rawSuggested;
  if (suggestedUnits > 0 && policy.moqUnits > 0 && suggestedUnits < policy.moqUnits) {
    suggestedUnits = policy.moqUnits;
    warnings.push(`MOQ applied; raised suggestion to ${policy.moqUnits} units.`);
  }

  const dailyRateToday = getDailyRateForDate({
    plansBySku: plannedSalesBySku,
    sku,
    date: todayDate,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });
  const dailyRateEta = getDailyRateForDate({
    plansBySku: plannedSalesBySku,
    sku,
    date: eta,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });

  const inventoryTodayInfo = estimateInventoryOnDate({
    snapshotsBySku: closingStockBySku,
    plansBySku: plannedSalesBySku,
    sku,
    date: todayDate,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });
  const inventoryToday = inventoryTodayInfo.inventoryUnits ?? 0;
  const dohToday = computeDoh(inventoryToday, dailyRateToday);
  const dohEta = computeDoh(projectedInventoryAtEta, dailyRateEta);

  const endOfMonth = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0));
  const dailyRateEom = getDailyRateForDate({
    plansBySku: plannedSalesBySku,
    sku,
    date: endOfMonth,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });
  const inventoryEomInfo = estimateInventoryOnDate({
    snapshotsBySku: closingStockBySku,
    plansBySku: plannedSalesBySku,
    sku,
    date: endOfMonth,
    fallbackDailyRate: demandInfo.fallbackDailyRate,
    warnings,
  });
  const inventoryEom = inventoryEomInfo.inventoryUnits ?? 0;
  const dohEom = computeDoh(inventoryEom, dailyRateEom);
  const orderNeededFlag =
    dohEom != null &&
    dohEom < policy.safetyStockDaysTotalDe + policy.leadTimeDaysTotal;

  if (policy.minimumStockDaysTotalDe != null) {
    if (dohToday != null && dohToday < policy.minimumStockDaysTotalDe) {
      warnings.push("Days-on-hand today is below minimum stock days.");
    }
    if (dohEta != null && dohEta < policy.minimumStockDaysTotalDe) {
      warnings.push("Days-on-hand at ETA is below minimum stock days.");
    }
  }

  return {
    sku,
    etaDate: formatIsoDate(eta),
    suggestedUnits,
    confidence,
    rationale: {
      dailyRateToday,
      dailyRateEta,
      safetyStockDays: policy.safetyStockDaysTotalDe,
      leadTimeDays: policy.leadTimeDaysTotal,
      operationalCoverageDays: targetCoverageDays,
      targetCoverageTotalDays: policy.safetyStockDaysTotalDe + targetCoverageDays,
      projectedInventoryAtEta,
      demandUnits,
      dohToday,
      dohEta,
      dohEndOfMonth: dohEom,
      requiredUnits,
      netNeeded: netNeeded,
    },
    warnings,
    orderNeededFlag,
    status: inventoryInfo.missingSnapshot
      ? "insufficient_inventory_snapshot"
      : demandInfo.missingForecast
        ? "insufficient_forecast"
        : "ok",
  };
}

export const foSuggestionUtils = {
  parseIsoDate,
  formatIsoDate,
  monthKey,
  daysInMonth,
  addDays,
  getDailyRateForDate,
  estimateInventoryOnDate,
  integrateDemand,
  resolveSkuPolicy,
};

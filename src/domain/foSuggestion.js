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

function compareMonthKeys(a, b) {
  const parsedA = parseMonthKey(a);
  const parsedB = parseMonthKey(b);
  const scoreA = parsedA.year * 12 + parsedA.month;
  const scoreB = parsedB.year * 12 + parsedB.month;
  return scoreA - scoreB;
}

function addMonthsToKey(monthKeyValue, offset) {
  const { year, month } = parseMonthKey(monthKeyValue);
  const date = new Date(Date.UTC(year, month, 1));
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthKey(date);
}

function monthKeyToDate(monthKeyValue) {
  const { year, month } = parseMonthKey(monthKeyValue);
  return new Date(Date.UTC(year, month, 1));
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
      return {
        dailyRate: fallbackDailyRate,
        days,
        missingForecast: true,
        usedFallback: true,
        forecastMonthUnits: null,
      };
    }
    warnings.push(`Forecast missing for ${month}; daily rate assumed 0.`);
    return {
      dailyRate: 0,
      days,
      missingForecast: true,
      usedFallback: false,
      forecastMonthUnits: null,
    };
  }

  if (plannedSalesUnits === 0) {
    warnings.push(`Forecast for ${month} is zero; demand treated as 0.`);
  }

  return {
    dailyRate: plannedSalesUnits / days,
    days,
    missingForecast: false,
    usedFallback: false,
    forecastMonthUnits: plannedSalesUnits,
  };
}

function getDailyRateForDate({ plansBySku, sku, date, fallbackDailyRate, warnings }) {
  const month = monthKey(date);
  return getDailyRateForMonth({ plansBySku, sku, month, fallbackDailyRate, warnings }).dailyRate;
}

function estimateInventoryOnDate({ snapshotsBySku, plansBySku, sku, date, fallbackDailyRate, warnings }) {
  const month = monthKey(date);
  const closingStockUnits = getClosingStockForMonth(snapshotsBySku, sku, month);
  if (closingStockUnits == null) {
    warnings.push("Latest closing stock snapshot missing.");
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
  const coverageDemandBreakdown = [];

  while (cursor < endDate) {
    const month = monthKey(cursor);
    const { year, month: monthIndex } = parseMonthKey(month);
    const daysInThisMonth = daysInMonth(year, monthIndex);
    const nextMonthStart = new Date(Date.UTC(year, monthIndex + 1, 1));
    const segmentEnd = nextMonthStart < endDate ? nextMonthStart : endDate;
    const segmentDays = Math.ceil((segmentEnd.getTime() - cursor.getTime()) / MILLIS_PER_DAY);
    const rateInfo = getDailyRateForMonth({ plansBySku, sku, month, fallbackDailyRate, warnings });
    const demandUnitsInWindow = rateInfo.dailyRate * segmentDays;
    total += demandUnitsInWindow;
    coverageDemandBreakdown.push({
      month,
      daysCovered: segmentDays,
      forecastMonthUnits: rateInfo.forecastMonthUnits,
      demandUnitsInWindow,
      usedFallback: rateInfo.usedFallback,
    });
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

  return { demandUnits: total, missingForecast, fallbackDailyRate, coverageDemandBreakdown };
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

function countOverlapDays(windowStart, windowEnd, blackoutStart, blackoutEnd) {
  if (!windowStart || !windowEnd || !blackoutStart || !blackoutEnd) return 0;
  const windowStartUtc = parseIsoDate(windowStart);
  const windowEndUtc = parseIsoDate(windowEnd);
  const blackoutStartUtc = parseIsoDate(blackoutStart);
  const blackoutEndUtc = parseIsoDate(blackoutEnd);
  if (!windowStartUtc || !windowEndUtc || !blackoutStartUtc || !blackoutEndUtc) return 0;
  const overlapStart = windowStartUtc > blackoutStartUtc ? windowStartUtc : blackoutStartUtc;
  const blackoutEndExclusive = addDays(blackoutEndUtc, 1);
  const overlapEnd = windowEndUtc < blackoutEndExclusive ? windowEndUtc : blackoutEndExclusive;
  const diffMs = overlapEnd.getTime() - overlapStart.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / MILLIS_PER_DAY);
}

export function getLatestClosingSnapshotMonth(snapshots = []) {
  let latest = null;
  snapshots.forEach(snapshot => {
    const month = snapshot?.month;
    if (!month) return;
    if (!latest || compareMonthKeys(month, latest) > 0) {
      latest = month;
    }
  });
  return latest;
}

export function buildSkuProjection({
  sku,
  baselineMonth,
  stock0 = 0,
  forecastByMonth = {},
  inboundByMonth = {},
  horizonMonths = 12,
}) {
  const months = [];
  const missingForecastMonths = [];
  let startStock = Number(stock0 || 0);

  for (let idx = 1; idx <= horizonMonths; idx += 1) {
    const month = addMonthsToKey(baselineMonth, idx);
    const demandRaw = forecastByMonth?.[month];
    const demand = Number.isFinite(Number(demandRaw)) ? Number(demandRaw) : 0;
    if (demandRaw == null) {
      missingForecastMonths.push(month);
    }
    const inbound = Number(inboundByMonth?.[month] || 0);
    const { year, month: monthIndex } = parseMonthKey(month);
    const days = daysInMonth(year, monthIndex);
    const avgDailyDemand = demand === 0 ? 0 : demand / days;
    const endStock = startStock + inbound - demand;
    const doh = avgDailyDemand === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(0, endStock / avgDailyDemand);
    months.push({
      month,
      startStock,
      inbound,
      demand,
      endStock,
      avgDailyDemand,
      doh,
    });
    startStock = endStock;
  }

  return {
    sku,
    baselineMonth,
    months,
    missingForecastMonths,
  };
}

export function computeFoRecommendation({
  sku,
  baselineMonth,
  projection,
  plannedSalesBySku = {},
  safetyStockDays = 60,
  coverageDays = 90,
  leadTimeDays = 0,
  cnyPeriod,
  inboundWithoutEtaCount = 0,
  moqUnits = 0,
  unitsPerCarton = null,
  roundupCartonBlock = null,
  roundupMaxPct = null,
  requiredArrivalMonth = null,
}) {
  if (!baselineMonth) {
    return {
      sku,
      status: "no_snapshot",
      issues: [],
    };
  }

  const firstRisk = projection?.months?.find(entry =>
    Number.isFinite(entry.doh) && entry.doh < safetyStockDays);
  if (!firstRisk) {
    return {
      sku,
      status: "no_fo_needed",
      baselineMonth,
      issues: buildIssueList(projection, inboundWithoutEtaCount),
    };
  }

  const projectionByMonth = new Map(
    (projection?.months || []).map((entry) => [entry.month, entry]),
  );
  const selectedArrivalMonth = (
    requiredArrivalMonth
    && projectionByMonth.has(requiredArrivalMonth)
    && compareMonthKeys(requiredArrivalMonth, baselineMonth) > 0
  )
    ? requiredArrivalMonth
    : firstRisk.month;
  const selectedProjectionMonth = projectionByMonth.get(selectedArrivalMonth) || firstRisk;
  const requiredArrivalDate = monthKeyToDate(selectedArrivalMonth);
  const orderDate = addDays(requiredArrivalDate, -Number(leadTimeDays || 0));
  const overlapDays = countOverlapDays(
    orderDate,
    requiredArrivalDate,
    cnyPeriod?.start,
    cnyPeriod?.end,
  );
  const orderDateAdjusted = overlapDays > 0
    ? addDays(orderDate, -overlapDays)
    : orderDate;
  const targetCoverageDays = Math.max(1, Number(coverageDays || 0));
  const coverageDemand = integrateDemand({
    plansBySku: plannedSalesBySku,
    sku,
    startDate: requiredArrivalDate,
    endDate: addDays(requiredArrivalDate, targetCoverageDays),
    warnings: [],
  });
  const coverageDemandUnits = Number.isFinite(coverageDemand?.demandUnits)
    ? Number(coverageDemand.demandUnits)
    : (Number(selectedProjectionMonth?.avgDailyDemand || 0) * targetCoverageDays);
  const coverageDemandBreakdown = Array.isArray(coverageDemand?.coverageDemandBreakdown)
    ? coverageDemand.coverageDemandBreakdown
    : [];
  const stockAtArrival = Number(selectedProjectionMonth?.startStock || 0);
  const recommendedUnitsRaw = Math.max(0, Math.ceil(coverageDemandUnits));
  let unitsAfterMoq = recommendedUnitsRaw;
  let moqApplied = false;
  const moqFloor = Number.isFinite(Number(moqUnits)) ? Math.max(0, Math.ceil(Number(moqUnits))) : 0;
  if (unitsAfterMoq > 0 && moqFloor > 0 && unitsAfterMoq < moqFloor) {
    unitsAfterMoq = moqFloor;
    moqApplied = true;
  }
  const normalizedUnitsPerCarton = Number.isFinite(Number(unitsPerCarton))
    ? Math.max(1, Math.round(Number(unitsPerCarton)))
    : null;
  const cartonSize = normalizedUnitsPerCarton && normalizedUnitsPerCarton > 1
    ? normalizedUnitsPerCarton
    : null;
  const unitsAfterCartonRounding = (cartonSize && unitsAfterMoq > 0)
    ? Math.ceil(unitsAfterMoq / cartonSize) * cartonSize
    : unitsAfterMoq;
  const cartonRoundingApplied = unitsAfterCartonRounding !== unitsAfterMoq;
  const normalizedRoundupCartonBlock = Number.isFinite(Number(roundupCartonBlock))
    ? Math.max(1, Math.round(Number(roundupCartonBlock)))
    : null;
  const normalizedRoundupMaxPct = Number.isFinite(Number(roundupMaxPct))
    ? Math.max(0, Number(roundupMaxPct))
    : 0;
  let recommendedUnits = unitsAfterCartonRounding;
  let roundupCandidateUnits = unitsAfterCartonRounding;
  let roundupLiftUnits = 0;
  let roundupLiftPct = 0;
  let blockRoundupApplied = false;
  if (
    cartonSize
    && normalizedRoundupCartonBlock
    && normalizedRoundupCartonBlock > 1
    && normalizedRoundupMaxPct > 0
    && unitsAfterCartonRounding > 0
  ) {
    const cartonsAfterCartonRounding = Math.ceil(unitsAfterCartonRounding / cartonSize);
    const candidateCartons = Math.ceil(cartonsAfterCartonRounding / normalizedRoundupCartonBlock)
      * normalizedRoundupCartonBlock;
    roundupCandidateUnits = candidateCartons * cartonSize;
    roundupLiftUnits = Math.max(0, roundupCandidateUnits - unitsAfterCartonRounding);
    roundupLiftPct = unitsAfterCartonRounding > 0
      ? (roundupLiftUnits / unitsAfterCartonRounding) * 100
      : 0;
    if (roundupLiftUnits > 0 && roundupLiftPct <= normalizedRoundupMaxPct) {
      recommendedUnits = roundupCandidateUnits;
      blockRoundupApplied = true;
    }
  }
  const recommendedCartons = cartonSize && recommendedUnits > 0
    ? Math.ceil(recommendedUnits / cartonSize)
    : null;

  return {
    sku,
    status: "ok",
    baselineMonth,
    criticalMonth: firstRisk.month,
    selectedArrivalMonth,
    requiredArrivalDate: formatIsoDate(requiredArrivalDate),
    orderDate: formatIsoDate(orderDate),
    orderDateAdjusted: formatIsoDate(orderDateAdjusted),
    overlapDays,
    coverageDaysForOrder: targetCoverageDays,
    coverageDemandUnits,
    coverageDemandBreakdown,
    recommendedUnitsRaw,
    recommendedUnits,
    unitsAfterMoq,
    unitsAfterCartonRounding,
    unitsPerCarton: cartonSize,
    recommendedCartons,
    cartonRoundingApplied,
    roundupCartonBlock: normalizedRoundupCartonBlock,
    roundupMaxPct: normalizedRoundupMaxPct,
    blockRoundupApplied,
    roundupCandidateUnits,
    roundupLiftUnits: blockRoundupApplied ? roundupLiftUnits : 0,
    roundupLiftPct: blockRoundupApplied ? roundupLiftPct : 0,
    safetyStockDays,
    coverageDays,
    moqUnits: moqFloor,
    moqApplied,
    moqLiftUnits: moqApplied ? Math.max(0, unitsAfterMoq - recommendedUnitsRaw) : 0,
    stockAtArrival,
    avgDailyDemand: selectedProjectionMonth?.avgDailyDemand ?? firstRisk.avgDailyDemand,
    issues: buildIssueList(projection, inboundWithoutEtaCount),
  };
}

function buildIssueList(projection, inboundWithoutEtaCount) {
  const issues = [];
  const missingForecastCount = projection?.missingForecastMonths?.length || 0;
  if (missingForecastCount > 0) {
    issues.push({ code: "MISSING_FORECAST", count: missingForecastCount });
  }
  if (inboundWithoutEtaCount > 0) {
    issues.push({ code: "INBOUND_WITHOUT_ETA", count: inboundWithoutEtaCount });
  }
  return issues;
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

export function findEtaForMinDoh({
  sku,
  today = new Date(),
  minimumDohDays,
  plannedSalesBySku,
  closingStockBySku,
  maxHorizonDays = 365,
}) {
  const warnings = [];
  if (!Number.isFinite(minimumDohDays)) {
    warnings.push("Minimum DOH threshold missing.");
    return { etaDate: null, warnings, status: "missing_minimum_doh" };
  }
  const todayDate = parseIsoDate(today);
  const horizonEnd = addDays(todayDate, maxHorizonDays);
  const demandInfo = integrateDemand({
    plansBySku: plannedSalesBySku,
    sku,
    startDate: todayDate,
    endDate: horizonEnd,
    warnings,
  });
  if (demandInfo.missingForecast) {
    warnings.push("Forecast is incomplete; ETA is estimated from partial data.");
  }

  for (let offset = 0; offset <= maxHorizonDays; offset += 1) {
    const currentDate = addDays(todayDate, offset);
    const inventoryInfo = estimateInventoryOnDate({
      snapshotsBySku: closingStockBySku,
      plansBySku: plannedSalesBySku,
      sku,
      date: currentDate,
      fallbackDailyRate: demandInfo.fallbackDailyRate,
      warnings,
    });
    if (inventoryInfo.missingSnapshot) {
      return { etaDate: null, warnings, status: "insufficient_inventory_snapshot" };
    }
    let inventory = inventoryInfo.inventoryUnits ?? 0;
    if (inventory < 0) inventory = 0;
    const dailyRate = getDailyRateForDate({
      plansBySku: plannedSalesBySku,
      sku,
      date: currentDate,
      fallbackDailyRate: demandInfo.fallbackDailyRate,
      warnings,
    });
    const doh = computeDoh(inventory, dailyRate);
    if (Number.isFinite(doh) && doh < minimumDohDays) {
      return { etaDate: formatIsoDate(currentDate), warnings, status: "ok" };
    }
  }

  warnings.push("DOH threshold not reached within horizon.");
  return { etaDate: null, warnings, status: "not_reached" };
}

export const foSuggestionUtils = {
  parseIsoDate,
  formatIsoDate,
  monthKey,
  addMonthsToKey,
  monthKeyToDate,
  compareMonthKeys,
  daysInMonth,
  addDays,
  getDailyRateForDate,
  estimateInventoryOnDate,
  integrateDemand,
  resolveSkuPolicy,
};

import { parseDeNumber } from "../lib/dataHealth.js";
import { normalizeIncludeInForecast } from "./portfolioBuckets.js";

function normalizeMonthKey(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  return raw;
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function isProductActive(product) {
  if (!product) return false;
  if (!normalizeIncludeInForecast(product.includeInForecast, true)) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function daysInMonth(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return 30;
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function parseMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return null;
  return { year, monthIndex: month - 1 };
}

function compareMonthKeys(a, b) {
  const parsedA = parseMonthKey(a);
  const parsedB = parseMonthKey(b);
  if (!parsedA || !parsedB) return String(a || "").localeCompare(String(b || ""));
  const scoreA = parsedA.year * 12 + parsedA.monthIndex;
  const scoreB = parsedB.year * 12 + parsedB.monthIndex;
  return scoreA - scoreB;
}

function addMonthsToMonthKey(monthKey, offset) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  const date = new Date(parsed.year, parsed.monthIndex, 1);
  date.setMonth(date.getMonth() + Number(offset || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeAfter(startMonthExclusive, endMonthInclusive) {
  if (!startMonthExclusive || !endMonthInclusive) return [];
  if (compareMonthKeys(startMonthExclusive, endMonthInclusive) >= 0) return [];
  const months = [];
  let cursor = addMonthsToMonthKey(startMonthExclusive, 1);
  while (cursor && compareMonthKeys(cursor, endMonthInclusive) <= 0) {
    months.push(cursor);
    cursor = addMonthsToMonthKey(cursor, 1);
  }
  return months;
}

function parseISODate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function resolvePoEta(po) {
  const manual = parseISODate(po?.etaManual || po?.etaDate || po?.eta);
  if (manual) return manual;
  const computed = parseISODate(po?.etaComputed);
  if (computed) return computed;
  const orderDate = parseISODate(po?.orderDate);
  if (!orderDate) return null;
  const prodDays = Number(po?.prodDays || 0);
  const transitDays = Number(po?.transitDays || 0);
  const eta = new Date(orderDate.getTime());
  eta.setDate(eta.getDate() + Math.max(0, prodDays + transitDays));
  return eta;
}

function resolveFoArrival(fo) {
  return parseISODate(fo?.targetDeliveryDate || fo?.deliveryDate || fo?.etaDate);
}

function normalizeFoStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "DRAFT";
  if (raw === "PLANNED") return "ACTIVE";
  if (raw === "CANCELLED") return "ARCHIVED";
  return raw;
}

function isFoCountable(fo) {
  const status = normalizeFoStatus(fo?.status);
  return status === "DRAFT" || status === "ACTIVE";
}

function getForecastUnits(state, sku, month) {
  const normalizedMonth = normalizeMonthKey(month);
  if (!normalizedMonth) return null;
  const manual = state?.forecast?.forecastManual?.[sku]?.[normalizedMonth];
  const manualParsed = parseDeNumber(manual);
  if (Number.isFinite(manualParsed)) return manualParsed;
  const imported = state?.forecast?.forecastImport?.[sku]?.[normalizedMonth]?.units;
  const importParsed = parseDeNumber(imported);
  if (Number.isFinite(importParsed)) return importParsed;
  return null;
}

function ensureInboundDetailsBucket(map, sku, month) {
  if (!map.has(sku)) map.set(sku, new Map());
  const skuMap = map.get(sku);
  if (!skuMap.has(month)) {
    skuMap.set(month, {
      totalUnits: 0,
      poUnits: 0,
      foUnits: 0,
      poItems: [],
      foItems: [],
    });
  }
  return skuMap.get(month);
}

function buildInboundDetailMaps(state, months) {
  const monthSet = new Set(months);
  const inboundUnitsMap = new Map();
  const inboundDetailsMap = new Map();
  let inboundMissingDateCount = 0;

  const addUnits = ({
    sku,
    month,
    units,
    source,
    recordId,
    recordNo,
    arrivalDate,
    arrivalSource,
  }) => {
    if (!sku || !monthSet.has(month) || !units) return;
    if (!inboundUnitsMap.has(sku)) inboundUnitsMap.set(sku, new Map());
    const skuMap = inboundUnitsMap.get(sku);
    skuMap.set(month, (skuMap.get(month) || 0) + units);

    const bucket = ensureInboundDetailsBucket(inboundDetailsMap, sku, month);
    const detail = {
      id: String(recordId || ""),
      ref: String(recordNo || "—"),
      units,
      arrivalDate: arrivalDate || null,
      arrivalSource: arrivalSource || null,
    };
    if (source === "fo") {
      bucket.foUnits += units;
      bucket.foItems.push(detail);
    } else {
      bucket.poUnits += units;
      bucket.poItems.push(detail);
    }
    bucket.totalUnits += units;
  };

  (state?.pos || []).forEach(po => {
    if (!po || po.archived) return;
    if (String(po.status || "").toUpperCase() === "CANCELLED") return;
    const etaDate = resolvePoEta(po);
    const etaMonth = etaDate ? toMonthKey(etaDate) : null;
    if (!etaMonth) {
      inboundMissingDateCount += 1;
      return;
    }
    const etaIso = etaDate.toISOString().slice(0, 10);
    const items = Array.isArray(po.items) && po.items.length ? po.items : [{ sku: po.sku, units: po.units }];
    items.forEach(item => {
      const sku = normalizeSku(item?.sku || po?.sku);
      if (!sku) return;
      const raw = item?.units ?? item?.qty ?? item?.quantity ?? po?.units;
      const parsed = parseDeNumber(raw);
      const units = Number.isFinite(parsed) ? Math.round(parsed) : 0;
      if (!units) return;
      addUnits({
        sku,
        month: etaMonth,
        units,
        source: "po",
        recordId: po.id,
        recordNo: po.poNo || po.id,
        arrivalDate: etaIso,
        arrivalSource: "ETA",
      });
    });
  });

  (state?.fos || []).forEach(fo => {
    if (!fo || !isFoCountable(fo)) return;
    const arrival = resolveFoArrival(fo);
    const arrivalMonth = arrival ? toMonthKey(arrival) : null;
    if (!arrivalMonth) {
      inboundMissingDateCount += 1;
      return;
    }
    const arrivalIso = arrival.toISOString().slice(0, 10);
    const items = Array.isArray(fo.items) && fo.items.length ? fo.items : [{ sku: fo.sku, units: fo.units }];
    items.forEach(item => {
      const sku = normalizeSku(item?.sku || fo?.sku);
      if (!sku) return;
      const raw = item?.units ?? item?.qty ?? item?.quantity ?? fo?.units;
      const parsed = parseDeNumber(raw);
      const units = Number.isFinite(parsed) ? Math.round(parsed) : 0;
      if (!units) return;
      addUnits({
        sku,
        month: arrivalMonth,
        units,
        source: "fo",
        recordId: fo.id,
        recordNo: fo.foNo || fo.id,
        arrivalDate: arrivalIso,
        arrivalSource: "DELIVERY",
      });
    });
  });

  return {
    inboundUnitsMap,
    inboundDetailsMap,
    inboundMissingDateCount,
  };
}

function getLatestSnapshotAtOrBefore(state, monthLimit = null) {
  const snapshots = (state?.inventory?.snapshots || [])
    .filter(snap => snap?.month && normalizeMonthKey(snap.month))
    .slice()
    .sort((a, b) => normalizeMonthKey(a.month).localeCompare(normalizeMonthKey(b.month)));
  if (!snapshots.length) return null;
  const limit = normalizeMonthKey(monthLimit);
  if (!limit) return snapshots[snapshots.length - 1];
  for (let idx = snapshots.length - 1; idx >= 0; idx -= 1) {
    const candidate = snapshots[idx];
    const candidateMonth = normalizeMonthKey(candidate?.month);
    if (candidateMonth && compareMonthKeys(candidateMonth, limit) <= 0) {
      return candidate;
    }
  }
  return null;
}

function sortedSnapshots(state) {
  return (state?.inventory?.snapshots || [])
    .filter(snap => snap?.month && normalizeMonthKey(snap.month))
    .slice()
    .sort((a, b) => normalizeMonthKey(a.month).localeCompare(normalizeMonthKey(b.month)));
}

function parseSnapshotItemTotalUnits(item) {
  const amazonUnits = parseDeNumber(item?.amazonUnits);
  const threePLUnits = parseDeNumber(item?.threePLUnits);
  const legacyUnits = parseDeNumber(item?.units);
  const hasSplitUnits = Number.isFinite(amazonUnits) || Number.isFinite(threePLUnits);
  if (hasSplitUnits) {
    return (Number.isFinite(amazonUnits) ? Number(amazonUnits) : 0)
      + (Number.isFinite(threePLUnits) ? Number(threePLUnits) : 0);
  }
  return Number.isFinite(legacyUnits) ? Number(legacyUnits) : 0;
}

function buildLatestSnapshotBySkuAtOrBefore(state, monthLimit = null) {
  const limit = normalizeMonthKey(monthLimit);
  const snapshots = sortedSnapshots(state);
  const bySku = new Map();
  snapshots.forEach((snapshot) => {
    const snapshotMonth = normalizeMonthKey(snapshot?.month);
    if (!snapshotMonth) return;
    if (limit && compareMonthKeys(snapshotMonth, limit) > 0) return;
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    items.forEach((item) => {
      const sku = normalizeSku(item?.sku);
      if (!sku) return;
      bySku.set(sku, {
        month: snapshotMonth,
        units: parseSnapshotItemTotalUnits(item),
      });
    });
  });
  return bySku;
}

function parsePositiveDays(value) {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.round(parsed);
}

export function resolveSafetyStockDays(product, state) {
  const override = parsePositiveDays(product?.safetyStockDohOverride);
  if (override != null) return override;
  const defaultValue = parsePositiveDays(
    state?.settings?.safetyStockDohDefault ?? state?.inventory?.settings?.safetyDays,
  );
  return defaultValue;
}

export function resolveCoverageDays(product, state) {
  const override = parsePositiveDays(product?.foCoverageDohOverride);
  if (override != null) return override;
  const defaultValue = parsePositiveDays(state?.settings?.foCoverageDohDefault);
  return defaultValue;
}

export function getProjectionSafetyClass({
  endAvailable,
  safetyUnits,
  doh,
  safetyDays,
  projectionMode = "units",
}) {
  const mode = projectionMode === "doh" ? "doh" : "units";
  if (mode === "doh") {
    if (!Number.isFinite(doh)) return "";
    if (doh <= 0) return "safety-negative";
    if (Number.isFinite(safetyDays) && doh < safetyDays) return "safety-low";
    return "";
  }
  if (!Number.isFinite(endAvailable)) return "";
  if (endAvailable <= 0) return "safety-negative";
  if (Number.isFinite(safetyUnits) && endAvailable < safetyUnits) return "safety-low";
  return "";
}

export function computeInventoryProjection({
  state,
  months,
  products,
  snapshot,
  snapshotMonth,
  projectionMode = "units",
}) {
  const monthKeys = (Array.isArray(months) ? months : [])
    .map(month => normalizeMonthKey(month))
    .filter(Boolean);
  const productList = Array.isArray(products) ? products : (state?.products || []);
  const firstProjectionMonth = monthKeys[0] || null;
  const requestedSnapshotMonthRaw = normalizeMonthKey(snapshotMonth || snapshot?.month);
  const projectionAnchorLimit = firstProjectionMonth
    ? addMonthsToMonthKey(firstProjectionMonth, -1)
    : null;
  let anchorTargetMonth = requestedSnapshotMonthRaw || projectionAnchorLimit;
  if (
    anchorTargetMonth
    && firstProjectionMonth
    && compareMonthKeys(anchorTargetMonth, firstProjectionMonth) >= 0
    && projectionAnchorLimit
  ) {
    anchorTargetMonth = projectionAnchorLimit;
  }

  const providedSnapshot = snapshot && Array.isArray(snapshot.items) ? snapshot : null;
  const resolvedSnapshot = providedSnapshot
    || getLatestSnapshotAtOrBefore(state, anchorTargetMonth);
  const resolvedSnapshotMonth = normalizeMonthKey(resolvedSnapshot?.month);
  const snapshotFallbackUsed = Boolean(
    requestedSnapshotMonthRaw
    && resolvedSnapshotMonth
    && requestedSnapshotMonthRaw !== resolvedSnapshotMonth,
  );
  anchorTargetMonth = anchorTargetMonth || resolvedSnapshotMonth || projectionAnchorLimit || null;
  const snapshotMap = new Map();
  if (resolvedSnapshot && Array.isArray(resolvedSnapshot.items)) {
    resolvedSnapshot.items.forEach(item => {
      const sku = normalizeSku(item?.sku);
      if (!sku) return;
      snapshotMap.set(sku, parseSnapshotItemTotalUnits(item));
    });
  }
  const latestSnapshotBySku = buildLatestSnapshotBySkuAtOrBefore(state, anchorTargetMonth);
  const startSourceBySku = new Map();
  const startAvailableRawBySku = new Map();
  const anchorSkuFallbackSkus = new Set();
  const anchorSkuMissingHistory = new Set();
  const anchorRollforwardMonthsBySku = new Map();
  const inboundMonthsSet = new Set(monthKeys);

  productList.forEach((product) => {
    const sku = normalizeSku(product?.sku);
    if (!sku) return;
    if (snapshotMap.has(sku) && resolvedSnapshotMonth) {
      startSourceBySku.set(sku, { type: "anchor_snapshot", month: resolvedSnapshotMonth });
      startAvailableRawBySku.set(sku, snapshotMap.get(sku));
    } else {
      const fallback = latestSnapshotBySku.get(sku) || null;
      if (fallback) {
        startSourceBySku.set(sku, { type: "sku_fallback", month: fallback.month });
        startAvailableRawBySku.set(sku, fallback.units);
        anchorSkuFallbackSkus.add(sku);
      } else {
        startSourceBySku.set(sku, { type: "missing_history", month: null });
        startAvailableRawBySku.set(sku, 0);
        anchorSkuMissingHistory.add(sku);
      }
    }
    const sourceMonth = startSourceBySku.get(sku)?.month || null;
    const monthsForSku = monthRangeAfter(sourceMonth, anchorTargetMonth);
    anchorRollforwardMonthsBySku.set(sku, monthsForSku);
    monthsForSku.forEach((month) => inboundMonthsSet.add(month));
  });

  const inboundMonths = Array.from(inboundMonthsSet);
  const {
    inboundUnitsMap,
    inboundDetailsMap,
    inboundMissingDateCount,
  } = buildInboundDetailMaps(state, inboundMonths);
  const perSkuMonth = new Map();
  const activeSkus = new Set();
  const normalizedMode = projectionMode === "doh" ? "doh" : "units";
  const anchorForecastGapSkus = new Set();
  const startAvailableBySku = new Map();

  productList.forEach(product => {
    const sku = normalizeSku(product?.sku);
    if (!sku) return;
    if (isProductActive(product)) activeSkus.add(sku);
    const startAvailable = startAvailableRawBySku.has(sku) ? startAvailableRawBySku.get(sku) : 0;
    let anchorAvailable = Number.isFinite(startAvailable) ? startAvailable : 0;
    const anchorRollforwardMonths = anchorRollforwardMonthsBySku.get(sku) || [];
    anchorRollforwardMonths.forEach(month => {
      const inboundUnits = inboundUnitsMap.get(sku)?.get(month) || 0;
      const forecastUnits = getForecastUnits(state, sku, month);
      if (!Number.isFinite(forecastUnits)) {
        anchorForecastGapSkus.add(sku);
      }
      const demandUnits = Number.isFinite(forecastUnits) ? Number(forecastUnits) : 0;
      anchorAvailable = anchorAvailable + inboundUnits - demandUnits;
    });

    let prevAvailable = anchorAvailable;
    let previousUnknown = false;
    const monthMap = new Map();
    const safetyDays = resolveSafetyStockDays(product, state);

    monthKeys.forEach(month => {
      const forecastUnits = getForecastUnits(state, sku, month);
      const hasForecast = Number.isFinite(forecastUnits);
      const inboundDetails = inboundDetailsMap.get(sku)?.get(month) || null;
      const inboundUnits = inboundDetails?.totalUnits || inboundUnitsMap.get(sku)?.get(month) || 0;
      let endAvailable = null;
      if (!previousUnknown && hasForecast) {
        endAvailable = prevAvailable + inboundUnits - forecastUnits;
        prevAvailable = endAvailable;
      } else {
        previousUnknown = true;
      }
      const forecastMissing = !hasForecast || previousUnknown;
      const dailyDemand = hasForecast && forecastUnits > 0
        ? forecastUnits / daysInMonth(month)
        : null;
      const doh = Number.isFinite(endAvailable) && Number.isFinite(dailyDemand) && dailyDemand > 0
        ? Math.max(0, Math.round(endAvailable / dailyDemand))
        : null;
      const safetyUnits = Number.isFinite(forecastUnits) && Number.isFinite(safetyDays)
        ? Math.round((forecastUnits / daysInMonth(month)) * safetyDays)
        : null;
      const passesDoh = Number.isFinite(doh) && Number.isFinite(safetyDays) && doh >= safetyDays;
      const passesUnits = Number.isFinite(endAvailable) && Number.isFinite(safetyUnits) && endAvailable >= safetyUnits;
      const isCovered = normalizedMode === "doh" ? passesDoh : passesUnits;

      monthMap.set(month, {
        forecastUnits,
        hasForecast,
        inboundUnits,
        inboundDetails,
        endAvailable,
        safetyDays,
        safetyUnits,
        doh,
        passesDoh,
        passesUnits,
        isCovered,
        forecastMissing,
      });
    });
    perSkuMonth.set(sku, monthMap);
    startAvailableBySku.set(sku, anchorAvailable);
  });

  const globalAnchorRollforwardMonths = monthRangeAfter(resolvedSnapshotMonth, anchorTargetMonth);
  const anchorMode = !resolvedSnapshotMonth
    ? "no_snapshot"
    : (globalAnchorRollforwardMonths.length ? "rollforward" : "snapshot");

  return {
    months: monthKeys,
    perSkuMonth,
    inboundUnitsMap,
    inboundDetailsMap,
    snapshot: resolvedSnapshot,
    resolvedSnapshotMonth,
    snapshotFallbackUsed,
    inboundMissingDateCount,
    startAvailableBySku,
    projectionMode: normalizedMode,
    activeSkus,
    anchorMonth: anchorTargetMonth,
    anchorTargetMonth,
    anchorSourceMonth: resolvedSnapshotMonth,
    anchorMode,
    anchorSourceBySku: startSourceBySku,
    anchorSkuFallbackCount: anchorSkuFallbackSkus.size,
    anchorSkuFallbackSkus: Array.from(anchorSkuFallbackSkus).sort(),
    anchorSkuMissingHistory: Array.from(anchorSkuMissingHistory).sort(),
    anchorForecastGapSkus: Array.from(anchorForecastGapSkus).sort(),
  };
}

export { normalizeSku };

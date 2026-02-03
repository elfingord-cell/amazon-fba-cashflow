import { parseDeNumber } from "../lib/dataHealth.js";

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

function isFoCountable(fo) {
  const status = String(fo?.status || "").toUpperCase();
  if (status === "CONVERTED" || status === "CANCELLED") return false;
  return true;
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

function buildInboundUnitsMap(state, months) {
  const monthSet = new Set(months);
  const inboundMap = new Map();
  const addUnits = (sku, month, units) => {
    if (!sku || !monthSet.has(month)) return;
    if (!inboundMap.has(sku)) inboundMap.set(sku, new Map());
    const skuMap = inboundMap.get(sku);
    skuMap.set(month, (skuMap.get(month) || 0) + units);
  };

  (state?.pos || []).forEach(po => {
    if (!po || po.archived) return;
    if (String(po.status || "").toUpperCase() === "CANCELLED") return;
    const etaDate = resolvePoEta(po);
    const etaMonth = etaDate ? toMonthKey(etaDate) : null;
    if (!etaMonth) return;
    const items = Array.isArray(po.items) && po.items.length ? po.items : [{ sku: po.sku, units: po.units }];
    items.forEach(item => {
      const sku = normalizeSku(item?.sku || po?.sku);
      if (!sku) return;
      const raw = item?.units ?? item?.qty ?? item?.quantity ?? po?.units;
      const parsed = parseDeNumber(raw);
      const units = Number.isFinite(parsed) ? Math.round(parsed) : 0;
      if (!units) return;
      addUnits(sku, etaMonth, units);
    });
  });

  (state?.fos || []).forEach(fo => {
    if (!fo || !isFoCountable(fo)) return;
    const arrival = resolveFoArrival(fo);
    const arrivalMonth = arrival ? toMonthKey(arrival) : null;
    if (!arrivalMonth) return;
    const items = Array.isArray(fo.items) && fo.items.length ? fo.items : [{ sku: fo.sku, units: fo.units }];
    items.forEach(item => {
      const sku = normalizeSku(item?.sku || fo?.sku);
      if (!sku) return;
      const raw = item?.units ?? item?.qty ?? item?.quantity ?? fo?.units;
      const parsed = parseDeNumber(raw);
      const units = Number.isFinite(parsed) ? Math.round(parsed) : 0;
      if (!units) return;
      addUnits(sku, arrivalMonth, units);
    });
  });

  return inboundMap;
}

function getLatestSnapshot(state) {
  const snapshots = (state?.inventory?.snapshots || [])
    .filter(snap => snap?.month && normalizeMonthKey(snap.month))
    .slice()
    .sort((a, b) => normalizeMonthKey(a.month).localeCompare(normalizeMonthKey(b.month)));
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

export function computeInventoryProjection({
  state,
  months,
  products,
  snapshot,
  projectionMode = "units",
}) {
  const monthKeys = (Array.isArray(months) ? months : [])
    .map(month => normalizeMonthKey(month))
    .filter(Boolean);
  const productList = Array.isArray(products) ? products : (state?.products || []);
  const resolvedSnapshot = snapshot || getLatestSnapshot(state);
  const snapshotMap = new Map();
  if (resolvedSnapshot && Array.isArray(resolvedSnapshot.items)) {
    resolvedSnapshot.items.forEach(item => {
      const sku = normalizeSku(item?.sku);
      if (!sku) return;
      const amazonUnits = Number(item?.amazonUnits || 0);
      const threePLUnits = Number(item?.threePLUnits || 0);
      snapshotMap.set(sku, amazonUnits + threePLUnits);
    });
  }

  const inboundUnitsMap = buildInboundUnitsMap(state, monthKeys);
  const perSkuMonth = new Map();
  const activeSkus = new Set();
  const normalizedMode = projectionMode === "doh" ? "doh" : "units";

  productList.forEach(product => {
    const sku = normalizeSku(product?.sku);
    if (!sku) return;
    if (isProductActive(product)) activeSkus.add(sku);
    const startAvailable = snapshotMap.has(sku) ? snapshotMap.get(sku) : 0;
    let prevAvailable = Number.isFinite(startAvailable) ? startAvailable : 0;
    let previousUnknown = false;
    const monthMap = new Map();
    const safetyDays = Number(
      product?.safetyStockDohOverride
        ?? state?.settings?.safetyStockDohDefault
        ?? state?.inventory?.settings?.safetyDays
        ?? 60,
    );

    monthKeys.forEach(month => {
      const forecastUnits = getForecastUnits(state, sku, month);
      const hasForecast = Number.isFinite(forecastUnits);
      const inboundUnits = inboundUnitsMap.get(sku)?.get(month) || 0;
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
      const safetyUnits = Number.isFinite(forecastUnits)
        ? Math.round((forecastUnits / daysInMonth(month)) * safetyDays)
        : null;
      const passesDoh = Number.isFinite(doh) && doh >= safetyDays;
      const passesUnits = Number.isFinite(endAvailable) && Number.isFinite(safetyUnits) && endAvailable >= safetyUnits;
      const isCovered = normalizedMode === "doh" ? passesDoh : passesUnits;

      monthMap.set(month, {
        forecastUnits,
        hasForecast,
        inboundUnits,
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
  });

  return {
    months: monthKeys,
    perSkuMonth,
    inboundUnitsMap,
    snapshot: resolvedSnapshot,
    projectionMode: normalizedMode,
    activeSkus,
  };
}

export { normalizeSku };

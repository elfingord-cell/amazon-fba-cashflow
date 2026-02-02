import { parseDeNumber } from "../lib/dataHealth.js";
import { DASHBOARD_RANGE_OPTIONS, currentMonthKey, getVisibleMonths } from "../utils/monthRange.js";

const ABC_THRESHOLDS = {
  A: 0.8,
  B: 0.95,
};

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveProduct(product) {
  if (!product) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function getForecastUnits(state, sku, month) {
  if (!sku || !month) return null;
  const manualValue = state?.forecast?.forecastManual?.[sku]?.[month];
  const manualParsed = parseDeNumber(manualValue);
  if (Number.isFinite(manualParsed)) return manualParsed;
  const importedValue = state?.forecast?.forecastImport?.[sku]?.[month]?.units;
  const importParsed = parseDeNumber(importedValue);
  if (Number.isFinite(importParsed)) return importParsed;
  return null;
}

function collectForecastMonths(state) {
  const monthSet = new Set();
  const addMonth = (month) => {
    if (/^\d{4}-\d{2}$/.test(month || "")) monthSet.add(month);
  };
  const importMap = state?.forecast?.forecastImport || {};
  Object.values(importMap).forEach(skuMap => {
    if (!skuMap || typeof skuMap !== "object") return;
    Object.keys(skuMap).forEach(addMonth);
  });
  const manualMap = state?.forecast?.forecastManual || {};
  Object.values(manualMap).forEach(skuMap => {
    if (!skuMap || typeof skuMap !== "object") return;
    Object.keys(skuMap).forEach(addMonth);
  });
  return Array.from(monthSet).sort();
}

export function computeAbcClassification(state) {
  const products = Array.isArray(state?.products) ? state.products : [];
  const allMonths = collectForecastMonths(state);
  const months = getVisibleMonths(allMonths, "NEXT_6", currentMonthKey(), DASHBOARD_RANGE_OPTIONS);
  const bySku = new Map();
  const revenueEntries = [];

  products.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (!sku) return;
    const normalizedSku = normalizeSku(sku);
    const active = isActiveProduct(product);
    const price = parseDeNumber(product?.avgSellingPriceGrossEUR);
    let units6m = 0;
    if (active && Number.isFinite(price) && price > 0) {
      months.forEach(month => {
        const units = getForecastUnits(state, sku, month);
        if (Number.isFinite(units)) units6m += units;
      });
    }
    const revenue6m = Number.isFinite(price) && price > 0 ? units6m * price : null;
    const entry = {
      sku,
      active,
      vkPriceGross: Number.isFinite(price) ? price : null,
      units6m: active ? units6m : null,
      revenue6m: active ? revenue6m : null,
      abcClass: null,
      includedInRanking: active && Number.isFinite(price) && price > 0,
    };
    if (entry.includedInRanking) {
      revenueEntries.push(entry);
    }
    bySku.set(normalizedSku, entry);
  });

  const totalRevenue = revenueEntries.reduce((acc, entry) => acc + (entry.revenue6m || 0), 0);
  if (totalRevenue > 0) {
    revenueEntries
      .slice()
      .sort((a, b) => (b.revenue6m || 0) - (a.revenue6m || 0))
      .reduce((acc, entry) => {
        const next = acc + (entry.revenue6m || 0);
        const share = next / totalRevenue;
        if (share <= ABC_THRESHOLDS.A) {
          entry.abcClass = "A";
        } else if (share <= ABC_THRESHOLDS.B) {
          entry.abcClass = "B";
        } else {
          entry.abcClass = "C";
        }
        return next;
      }, 0);
  } else {
    revenueEntries.forEach(entry => {
      entry.abcClass = "C";
    });
  }

  return {
    months,
    bySku,
  };
}

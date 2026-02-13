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
  const fallbackEntries = [];
  let totalRevenue = 0;
  let totalRevenueUnits = 0;

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
    const hasPrice = Number.isFinite(price) && price > 0;
    const hasUnits = active && Number.isFinite(units6m) && units6m > 0;
    const revenue6m = hasPrice && hasUnits ? units6m * price : null;
    let abcBasis = "no_data";
    let rankingMetric = null;
    const entry = {
      sku,
      active,
      vkPriceGross: Number.isFinite(price) ? price : null,
      units6m: active ? units6m : null,
      revenue6m: active ? revenue6m : null,
      abcClass: null,
      abcBasis,
      rankingMetric,
      includedInRanking: false,
    };

    if (hasPrice && hasUnits && revenue6m != null) {
      entry.abcBasis = "revenue_6m";
      entry.rankingMetric = revenue6m;
      entry.includedInRanking = true;
      revenueEntries.push(entry);
      totalRevenue += revenue6m;
      totalRevenueUnits += units6m;
    } else if (hasUnits) {
      entry.abcBasis = "units_6m_fallback";
      fallbackEntries.push(entry);
    }
    bySku.set(normalizedSku, entry);
    bySku.set(sku, entry);
  });

  const fallbackUnitPrice = totalRevenue > 0 && totalRevenueUnits > 0
    ? totalRevenue / totalRevenueUnits
    : 1;
  fallbackEntries.forEach((entry) => {
    const units = Number(entry.units6m || 0);
    entry.rankingMetric = units * fallbackUnitPrice;
    entry.includedInRanking = units > 0;
  });

  const rankedEntries = [...revenueEntries, ...fallbackEntries].filter((entry) => entry.includedInRanking);
  const totalMetric = rankedEntries.reduce((acc, entry) => acc + Number(entry.rankingMetric || 0), 0);

  if (totalMetric > 0) {
    rankedEntries
      .slice()
      .sort((a, b) => Number(b.rankingMetric || 0) - Number(a.rankingMetric || 0))
      .reduce((acc, entry) => {
        const next = acc + Number(entry.rankingMetric || 0);
        const share = next / totalMetric;
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
    rankedEntries.forEach(entry => {
      entry.abcClass = "C";
    });
  }

  bySku.forEach((entry) => {
    if (!entry.abcClass) entry.abcClass = "C";
  });

  return {
    months,
    bySku,
  };
}

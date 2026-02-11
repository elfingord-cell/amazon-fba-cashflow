import { addStateListener } from "../data/storageLocal.js";
import { loadAppState, getViewState, getViewValue, setViewValue } from "../storage/store.js";
import { parseEuro, expandFixcostInstances } from "../domain/cashflow.js";
import { buildPaymentRows, getSettings } from "./orderEditorFactory.js";
import { computeVatPreview } from "../domain/vatPreview.js";
import { computeAbcClassification } from "../domain/abcClassification.js";
import { computeInventoryProjection } from "../domain/inventoryProjection.js";
import {
  DASHBOARD_RANGE_OPTIONS,
  currentMonthKey,
  getMonthlyBuckets,
  getVisibleMonths,
} from "../utils/monthRange.js";

const RANGE_STORAGE_KEY = "dashboard_month_range";
const RANGE_DEFAULT = "NEXT_6";
const RANGE_OPTIONS = DASHBOARD_RANGE_OPTIONS;
const INVENTORY_VIEW_KEY = "inventory_view_v1";

function isValidRange(value) {
  return RANGE_OPTIONS.some(option => option.value === value);
}

function loadRangePreference() {
  const stored = getViewValue(RANGE_STORAGE_KEY, RANGE_DEFAULT);
  return isValidRange(stored) ? stored : RANGE_DEFAULT;
}

const dashboardState = {
  expanded: new Set(["inflows", "outflows", "po-payments", "fo-payments"]),
  coverageCollapsed: new Set(),
  range: loadRangePreference(),
  hideEmptyMonths: true,
  limitBalanceToGreen: false,
};

const COVERAGE_THRESHOLDS = {
  full: 0.95,
  wide: 0.8,
  partial: 0.5,
};

const COVERAGE_LEVELS = {
  green: {
    label: "Vollständig",
    detail: "Mindestens 95% der aktiven SKUs sind abgedeckt.",
  },
  light: {
    label: "Weitgehend",
    detail: "80–94% der aktiven SKUs sind abgedeckt.",
  },
  orange: {
    label: "Teilweise",
    detail: "50–79% der aktiven SKUs sind abgedeckt.",
  },
  red: {
    label: "Unzureichend",
    detail: "Unter 50% Abdeckung oder kritische Grundlagen fehlen.",
  },
  gray: {
    label: "Keine Daten",
    detail: "Keine aktiven Produkte vorhanden.",
  },
};

const PO_CONFIG = {
  entityLabel: "PO",
  numberField: "poNo",
};

const MAX_DETAIL_ROWS = 50;

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeGet(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i += 1) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[path[i]];
  }
  return cur;
}

function safeValue(value, fallback) {
  return value == null ? fallback : value;
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function formatEur0(value) {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const rounded = Math.round(num);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(rounded)} €`;
}

function formatCellValue(value) {
  if (value == null) {
    return { text: "—", isEmpty: true };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { text: "—", isEmpty: true };
  }
  const rounded = Math.round(num);
  if (rounded === 0) {
    return { text: "—", isEmpty: true };
  }
  return {
    text: formatEur0(rounded),
    isEmpty: false,
  };
}

function formatValueOnly(value) {
  const formatted = formatCellValue(value);
  return formatted.text;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatInt(value) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, (m - 1) + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDisplayLabel(plannedTotal, actualTotal) {
  if (actualTotal > 0 && plannedTotal > actualTotal) return "Ist+Plan gemischt";
  if (actualTotal > 0) return "Ist (bezahlt)";
  return "Plan";
}

function toMonthKey(dateInput) {
  if (!dateInput) return null;
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function getCnyWindow(settings, year) {
  const direct = settings?.cny;
  if (direct?.start && direct?.end) {
    const start = parseISODate(direct.start);
    const end = parseISODate(direct.end);
    if (start && end && end >= start) return { start, end };
  }
  const entry = settings?.cnyBlackoutByYear?.[String(year)];
  if (!entry) return null;
  const start = parseISODate(entry.start);
  const end = parseISODate(entry.end);
  if (!start || !end) return null;
  if (end < start) return null;
  return { start, end };
}

function applyCnyBlackout(orderDate, prodDays, settings) {
  if (!(orderDate instanceof Date) || Number.isNaN(orderDate.getTime())) {
    return { prodDone: orderDate, adjustmentDays: 0 };
  }
  const baseDays = Math.max(0, Number(prodDays || 0));
  const prodEnd = addDays(orderDate, baseDays);
  if (!settings || baseDays === 0) {
    return { prodDone: prodEnd, adjustmentDays: 0 };
  }
  let adjustmentDays = 0;
  const startYear = orderDate.getUTCFullYear();
  const endYear = prodEnd.getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    const window = getCnyWindow(settings, year);
    if (!window) continue;
    const overlapStart = window.start > orderDate ? window.start : orderDate;
    const overlapEnd = window.end < prodEnd ? window.end : prodEnd;
    if (overlapEnd < overlapStart) continue;
    const overlap = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    adjustmentDays += Math.max(0, overlap);
  }
  const prodDone = adjustmentDays ? addDays(prodEnd, adjustmentDays) : prodEnd;
  return { prodDone, adjustmentDays };
}

function getMonthEnd(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

function formatDate(value) {
  const date = value instanceof Date ? value : parseISODate(value);
  if (!date) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return String(monthKey || "");
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "2-digit", year: "numeric" });
}

function monthColumnClass(index) {
  return `month-col ${index % 2 === 1 ? "month-col-alt" : ""}`.trim();
}

function coverageStatusToHealthClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const mapping = {
    green: "health-full",
    light: "health-mostly",
    orange: "health-partial",
    red: "health-poor",
  };
  return `col-health ${mapping[normalized] || "health-none"}`.trim();
}

function sumUnits(record) {
  if (!record) return 0;
  if (Array.isArray(record.items) && record.items.length) {
    return record.items.reduce((sum, item) => sum + (Number(item.units) || 0), 0);
  }
  return Number(record.units) || 0;
}

function convertToEur(amount, currency, fxRate) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (!currency || currency === "EUR") return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  return value / fx;
}

function isProductActive(product) {
  if (!product) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function getActiveSkus(state) {
  const products = state && Array.isArray(state.products) ? state.products : [];
  const categories = state && Array.isArray(state.productCategories) ? state.productCategories : [];
  const categoryById = new Map(categories.map(category => [String(category.id), category]));
  return products
    .filter(isProductActive)
    .map(product => {
      const categoryId = product.categoryId ? String(product.categoryId) : "";
      const category = categoryById.get(categoryId);
      return {
        sku: String(product.sku || "").trim(),
        alias: String(product.alias || product.sku || "").trim(),
        categoryId,
        categoryName: category && category.name ? category.name : "Ohne Kategorie",
        categorySort: category && Number.isFinite(category.sortOrder) ? category.sortOrder : 0,
      };
    })
    .filter(item => item.sku);
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function parseNumberDE(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function buildSkuAliasMap(state) {
  const products = state && Array.isArray(state.products) ? state.products : [];
  const map = new Map();
  products.forEach(product => {
    const sku = normalizeSku(product && product.sku).toLowerCase();
    if (!sku) return;
    const alias = normalizeSku(product && product.alias);
    if (alias) {
      map.set(sku, alias);
    }
  });
  return map;
}

function getPoAliasInfo(record, aliasMap) {
  const skus = new Set();
  if (Array.isArray(record && record.items)) {
    record.items.forEach(item => {
      const sku = normalizeSku(item && item.sku);
      if (sku) skus.add(sku);
    });
  }
  if (!skus.size) {
    const sku = normalizeSku(record && record.sku);
    if (sku) skus.add(sku);
  }
  const aliases = Array.from(skus)
    .map(sku => aliasMap.get(sku.toLowerCase()))
    .filter(Boolean);
  const uniqueAliases = Array.from(new Set(aliases));
  return { aliases: uniqueAliases, hasSku: skus.size > 0 };
}

function formatAliasTooltip(info) {
  if (!info) return null;
  const { aliases, hasSku } = info;
  if (!aliases.length) {
    return hasSku ? "Alias: —" : null;
  }
  const limited = aliases.slice(0, 3);
  const suffix = aliases.length > limited.length ? " …" : "";
  const label = aliases.length > 1 ? "Aliases" : "Alias";
  return `${label}: ${limited.join(", ")}${suffix}`;
}

function buildCategoryGroups(items, categories = []) {
  const sortedCategories = categories
    .slice()
    .sort((a, b) => {
      const aSort = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
      const bSort = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
      return aSort - bSort || String(a.name || "").localeCompare(String(b.name || ""));
    });
  const groups = sortedCategories.map(category => ({
    id: String(category.id),
    name: category.name || "Ohne Kategorie",
    items: items.filter(item => item.categoryId === String(category.id)),
  }));
  const uncategorized = items.filter(item => !item.categoryId);
  if (uncategorized.length) {
    groups.push({ id: "uncategorized", name: "Ohne Kategorie", items: uncategorized });
  }
  return groups.filter(group => group.items.length);
}

function hasInput(value) {
  return value != null && String(value).trim() !== "";
}

function isCashInPresent(state, month) {
  const incomeRow = (state?.incomings || []).find(row => row?.month === month);
  if (incomeRow && (hasInput(incomeRow.revenueEur) || hasInput(incomeRow.payoutPct))) return true;
  const actuals = state?.monthlyActuals && typeof state.monthlyActuals === "object"
    ? state.monthlyActuals[month]
    : null;
  if (actuals && (hasInput(actuals.realRevenueEUR) || hasInput(actuals.realPayoutRatePct))) return true;
  return false;
}

function computePoEta(po, settings) {
  if (!po) return null;
  if (po.etaManual) return parseISODate(po.etaManual);
  if (po.etaDate) return parseISODate(po.etaDate);
  if (po.eta) return parseISODate(po.eta);
  const orderDate = parseISODate(po.orderDate);
  if (!orderDate) return null;
  const prodDays = Number(po.prodDays || 0);
  const transitDays = Number(po.transitDays || 0);
  const adjusted = applyCnyBlackout(orderDate, prodDays, settings);
  const prodDone = adjusted.prodDone ?? addDays(orderDate, prodDays);
  return addDays(prodDone, transitDays);
}

function computeFoEta(fo) {
  if (!fo) return null;
  if (fo.etaDate) return parseISODate(fo.etaDate);
  if (fo.eta) return parseISODate(fo.eta);
  const target = parseISODate(fo.targetDeliveryDate);
  if (!target) return null;
  const bufferDays = Number(fo.bufferDays || 0);
  return addDays(target, -bufferDays);
}

const STATUS_RANK = {
  gray: -1,
  red: 0,
  orange: 1,
  light: 2,
  green: 3,
};

function minStatus(a, b) {
  return STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;
}

function getCoverageStatusKey(ratio, totalCount) {
  if (totalCount === 0) return "gray";
  if (ratio >= COVERAGE_THRESHOLDS.full) return "green";
  if (ratio >= COVERAGE_THRESHOLDS.wide) return "light";
  if (ratio >= COVERAGE_THRESHOLDS.partial) return "orange";
  return "red";
}

function getInventoryCoverageView() {
  const stored = getViewState(INVENTORY_VIEW_KEY, {});
  const projectionMode = stored?.projectionMode === "doh" ? "doh" : "units";
  return {
    projectionMode,
    selectedMonth: stored?.selectedMonth || null,
    showSafety: stored?.showSafety !== false,
  };
}

function getCoverageSnapshot(state, selectedMonth) {
  const snapshots = (state?.inventory?.snapshots || [])
    .filter(snap => /^\d{4}-\d{2}$/.test(snap?.month || ""))
    .slice()
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  if (selectedMonth) {
    const match = snapshots.find(snap => snap.month === selectedMonth);
    if (match) return match;
  }
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

function computeSkuCoverage(state, months) {
  const activeSkus = getActiveSkus(state);
  const categories = state && Array.isArray(state.productCategories) ? state.productCategories : [];
  const coverage = new Map();
  const details = new Map();
  const totalCount = activeSkus.length;
  const inventoryView = getInventoryCoverageView();
  const snapshot = getCoverageSnapshot(state, inventoryView.selectedMonth);
  const activeProducts = (state?.products || []).filter(isProductActive);
  const projection = computeInventoryProjection({
    state,
    months,
    products: activeProducts,
    snapshot,
    projectionMode: inventoryView.projectionMode,
  });
  const abcBySku = computeAbcClassification(state).bySku;
  const fixcosts = Array.isArray(state?.fixcosts) ? state.fixcosts : [];
  const fixcostInstances = expandFixcostInstances(state, { months });
  const fixcostByMonth = new Map();
  fixcostInstances.forEach(inst => {
    if (!inst?.month) return;
    if (!fixcostByMonth.has(inst.month)) fixcostByMonth.set(inst.month, []);
    fixcostByMonth.get(inst.month).push(inst);
  });
  const vatDefaults = state?.settings?.vatPreview || {};
  const taxesActive = [
    vatDefaults.deShareDefault,
    vatDefaults.feeRateDefault,
    vatDefaults.fixInputDefault,
  ].some(value => value != null && String(value).trim() !== "");
  const vatMonthOverrides = state?.vatPreviewMonths || {};

  months.forEach(month => {
    let coveredSkus = 0;
    const problemSkus = [];
    let missingForecastCount = 0;
    let safetyFailCount = 0;
    let inboundMissingCount = 0;

    activeSkus.forEach(item => {
      const sku = item.sku;
      const skuData = projection.perSkuMonth.get(sku)?.get(month);
      const hasForecast = Boolean(skuData?.hasForecast);
      const isCovered = Boolean(skuData?.isCovered);

      if (hasForecast && isCovered) {
        coveredSkus += 1;
        return;
      }

      const abcClass = abcBySku?.get(sku.toLowerCase())?.abcClass || "—";
      const isDohMode = inventoryView.projectionMode === "doh";
      const value = isDohMode ? skuData?.doh : skuData?.endAvailable;
      const safetyValue = isDohMode ? skuData?.safetyDays : skuData?.safetyUnits;
      let problem = "Forecast fehlt";
      if (hasForecast) {
        problem = isDohMode
          ? `DOH ${formatInt(skuData?.doh)} < ${formatInt(skuData?.safetyDays)}`
          : `Units ${formatInt(skuData?.endAvailable)} < ${formatInt(skuData?.safetyUnits)}`;
      }

      problemSkus.push({
        sku,
        alias: item.alias,
        categoryName: item.categoryName,
        abcClass,
        value,
        safetyValue,
        problem,
      });

      if (!hasForecast) missingForecastCount += 1;
      if (hasForecast && !isCovered) safetyFailCount += 1;
      if (hasForecast && !isCovered && (skuData?.inboundUnits || 0) === 0) inboundMissingCount += 1;
    });

    const coverageRatio = totalCount ? coveredSkus / totalCount : 0;
    const coverageStatusKey = getCoverageStatusKey(coverageRatio, totalCount);
    const cashInPresent = isCashInPresent(state, month);
    const fixcostPresent = fixcosts.length > 0 || (fixcostByMonth.get(month) || []).length > 0;
    const vatMonth = vatMonthOverrides[month] || {};
    const vatConfigured = taxesActive
      ? [
        vatDefaults.deShareDefault,
        vatDefaults.feeRateDefault,
        vatDefaults.fixInputDefault,
        vatMonth.deShare,
        vatMonth.feeRateOfGross,
        vatMonth.fixInputVat,
      ].some(value => value != null && String(value).trim() !== "")
      : true;

    const missingCritical = {
      amazonPayout: !cashInPresent,
      fixedCosts: !fixcostPresent,
      taxes: taxesActive && !vatConfigured,
    };

    let criticalStatusKey = "green";
    if (missingCritical.taxes) criticalStatusKey = minStatus(criticalStatusKey, "light");
    if (missingCritical.fixedCosts) criticalStatusKey = minStatus(criticalStatusKey, "orange");
    if (missingCritical.amazonPayout) criticalStatusKey = minStatus(criticalStatusKey, "orange");

    const statusKey = totalCount === 0
      ? "gray"
      : minStatus(coverageStatusKey, criticalStatusKey);

    const todoLinks = [];
    if (missingForecastCount) {
      todoLinks.push({ label: "Absatzprognose ergänzen", href: `#forecast?month=${month}` });
    }
    if (safetyFailCount) {
      todoLinks.push({ label: "Inventory prüfen", href: `#inventory?month=${month}` });
      if (inboundMissingCount) {
        todoLinks.push({ label: "Forecast Orders (FO) planen", href: `#fo?month=${month}` });
        todoLinks.push({ label: "Bestellungen (PO) prüfen", href: `#po?month=${month}` });
      }
    }
    if (missingCritical.amazonPayout) {
      todoLinks.push({ label: "Amazon Auszahlung erfassen", href: `#eingaben?month=${month}` });
    }
    if (missingCritical.fixedCosts) {
      todoLinks.push({ label: "Fixkosten ergänzen", href: `#fixkosten?month=${month}` });
    }
    if (missingCritical.taxes) {
      todoLinks.push({ label: "USt-Vorschau konfigurieren", href: `#ust?month=${month}` });
    }

    coverage.set(month, statusKey);
    details.set(month, {
      monthKey: month,
      statusKey,
      status: COVERAGE_LEVELS[statusKey]?.label || "—",
      coverageRatio,
      activeSkus: totalCount,
      coveredSkus,
      projectionMode: inventoryView.projectionMode,
      missingCritical,
      taxesActive,
      problemSkus,
      todoLinks,
      coverageStatusKey,
    });
  });

  return {
    coverage,
    details,
    activeSkus,
    groups: buildCategoryGroups(activeSkus, categories),
  };
}

function computePlannedPayoutByMonth(state, months) {
  const forecastEnabled = Boolean(state?.forecast?.settings?.useForecast);
  const payoutPctByMonth = new Map();
  (state?.incomings || []).forEach(row => {
    if (!row?.month) return;
    payoutPctByMonth.set(row.month, row.payoutPct);
  });

  const revenueByMonth = new Map();
  if (forecastEnabled && Array.isArray(state?.forecast?.items)) {
    if (state?.forecast?.forecastImport && typeof state.forecast.forecastImport === "object") {
      Object.values(state.forecast.forecastImport).forEach(monthMap => {
        Object.entries(monthMap || {}).forEach(([month, entry]) => {
          if (!month || !months.includes(month)) return;
          const revenue = parseEuro(entry?.revenueEur ?? entry?.revenue ?? null);
          if (!Number.isFinite(revenue)) return;
          revenueByMonth.set(month, (revenueByMonth.get(month) || 0) + revenue);
        });
      });
    } else {
      state.forecast.items.forEach(item => {
        if (!item || !item.month) return;
        const revenue = parseEuro(item.revenueEur != null ? item.revenueEur : item.revenue);
        if (Number.isFinite(revenue) && revenue !== 0) {
          revenueByMonth.set(item.month, (revenueByMonth.get(item.month) || 0) + revenue);
          return;
        }
        const qty = Number(item.qty != null ? item.qty : (item.units != null ? item.units : (item.quantity != null ? item.quantity : 0))) || 0;
        const price = parseEuro(item.priceEur != null ? item.priceEur : (item.price != null ? item.price : 0));
        revenueByMonth.set(item.month, (revenueByMonth.get(item.month) || 0) + qty * price);
      });
    }
  } else {
    (state?.incomings || []).forEach(row => {
      if (!row?.month) return;
      revenueByMonth.set(row.month, parseEuro(row.revenueEur));
    });
  }

  const result = new Map();
  months.forEach(month => {
    const revenue = revenueByMonth.get(month) || 0;
    let pct = Number(payoutPctByMonth.get(month) || 0) || 0;
    if (pct > 1) pct = pct / 100;
    const payout = revenue * pct;
    result.set(month, payout);
  });
  return result;
}

function buildPoData(state) {
  const settings = getSettings();
  const pos = state && Array.isArray(state.pos) ? state.pos : [];
  return pos.map(po => {
    const paymentRows = buildPaymentRows(po, PO_CONFIG, settings, state?.payments || []);
    const events = paymentRows
      .map(row => {
        const month = toMonthKey(row.dueDate);
        if (!month) return null;
        const actual = Number(row.paidEurActual);
        const actualEur = Number.isFinite(actual) ? actual : 0;
        return {
          id: row.id,
          month,
          label: row.typeLabel || row.label || "Zahlung",
          typeLabel: row.typeLabel || row.label || "Zahlung",
          dueDate: row.dueDate,
          plannedEur: Number(row.plannedEur || 0),
          actualEur,
          paid: row.status === "paid",
          paidDate: row.paidDate || null,
          paymentId: row.paymentId || null,
          paidBy: row.paidBy || null,
          currency: "EUR",
        };
      })
      .filter(Boolean);

    const supplier = (po && po.supplier) || (po && po.supplierName) || "";
    const units = sumUnits(po);
    return {
      record: po,
      supplier,
      units,
      events,
      transactions: [],
    };
  });
}

function buildFoData(state) {
  const fos = state && Array.isArray(state.fos) ? state.fos : [];
  return fos
    .filter(fo => String(fo && fo.status ? fo.status : "").toUpperCase() !== "CONVERTED")
    .map(fo => {
      const fxRate = (fo && fo.fxRate) || (state && state.settings && state.settings.fxRate) || 0;
      const events = (fo.payments || [])
        .map(payment => {
          if (!payment || !payment.dueDate) return null;
          const month = toMonthKey(payment.dueDate);
          if (!month) return null;
          const currency = payment.currency || "EUR";
          const plannedEur = convertToEur(payment.amount, currency, fxRate);
          return {
            id: payment.id,
            month,
            label: payment.label || "Payment",
            typeLabel: payment.label || payment.category || "Payment",
            dueDate: payment.dueDate,
            plannedEur,
            actualEur: 0,
            paid: false,
            paidBy: null,
            currency,
          };
        })
        .filter(Boolean);
      return { record: fo, events };
    });
}

function sumPaymentEvents(events, month, currentMonth) {
  let displayTotal = 0;
  let plannedTotal = 0;
  let actualTotal = 0;
  let paidThisMonthCount = 0;
  let hasPaidValue = false;
  events.forEach(evt => {
    if (evt.month !== month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    const actualValid = paid && actual > 0;

    plannedTotal += planned;
    if (actualValid) {
      actualTotal += actual;
      displayTotal += actual;
      hasPaidValue = true;
      if (evt.paidDate && toMonthKey(evt.paidDate) === currentMonth) {
        paidThisMonthCount += 1;
      }
    } else {
      displayTotal += planned;
    }
  });
  return {
    value: displayTotal,
    plannedTotal,
    actualTotal,
    displayLabel: getDisplayLabel(plannedTotal, actualTotal),
    warnings: [],
    paidThisMonthCount,
    hasPaidValue,
  };
}

function sumGenericEvents(events, month, currentMonth) {
  let displayTotal = 0;
  let plannedTotal = 0;
  let actualTotal = 0;
  let paidThisMonthCount = 0;
  let hasPaidValue = false;
  events.forEach(evt => {
    if (evt.month !== month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    plannedTotal += planned;
    if (paid && actual > 0) {
      actualTotal += actual;
      displayTotal += actual;
      hasPaidValue = true;
      if (evt.paidDate && toMonthKey(evt.paidDate) === currentMonth) {
        paidThisMonthCount += 1;
      }
    } else {
      displayTotal += planned;
    }
  });
  return {
    value: displayTotal,
    plannedTotal,
    actualTotal,
    displayLabel: getDisplayLabel(plannedTotal, actualTotal),
    warnings: [],
    paidThisMonthCount,
    hasPaidValue,
  };
}

function buildRow({
  id,
  label,
  level,
  children = [],
  events = [],
  tooltip = "",
  emptyHint = "",
  isSummary = false,
  alwaysVisible = false,
  sumMode = "payments",
  rowType = "detail",
  section = null,
  sourceLabel = null,
  nav = null,
}) {
  return {
    id,
    label,
    level,
    children,
    events,
    tooltip,
    emptyHint,
    isSummary,
    alwaysVisible,
    sumMode,
    rowType,
    section,
    sourceLabel,
    nav,
    values: {},
  };
}

function collectMonthEvents(row, month) {
  if (!row) return false;
  if (row.events && row.events.some(evt => evt.month === month && (Number(evt.plannedEur || 0) !== 0 || Number(evt.actualEur || 0) !== 0))) {
    return true;
  }
  return row.children.some(child => collectMonthEvents(child, month));
}

function monthHasValues(rows, month) {
  return rows.some(row => {
    const value = row.values && row.values[month] ? row.values[month].value || 0 : 0;
    if (Math.abs(value) > 0.0001) return true;
    return collectMonthEvents(row, month);
  });
}

function applyRowValues(row, months, currentMonth) {
  if (row.events.length) {
    months.forEach(month => {
      const result = row.sumMode === "generic"
        ? sumGenericEvents(row.events, month, currentMonth)
        : sumPaymentEvents(row.events, month, currentMonth);
      row.values[month] = result;
    });
  } else if (row.children.length) {
    row.children.forEach(child => applyRowValues(child, months, currentMonth));
    months.forEach(month => {
      const sum = row.children.reduce((acc, child) => acc + (child.values[month] ? (child.values[month].value || 0) : 0), 0);
      const plannedTotal = row.children.reduce((acc, child) => acc + (child.values[month] ? (child.values[month].plannedTotal || 0) : 0), 0);
      const actualTotal = row.children.reduce((acc, child) => acc + (child.values[month] ? (child.values[month].actualTotal || 0) : 0), 0);
      const warnings = row.children.flatMap(child => (child.values[month] ? (child.values[month].warnings || []) : []));
      const paidThisMonthCount = row.children.reduce((acc, child) => acc + (child.values[month] ? (child.values[month].paidThisMonthCount || 0) : 0), 0);
      const hasPaidValue = row.children.some(child => child.values[month] && child.values[month].hasPaidValue);
      row.values[month] = {
        value: sum,
        plannedTotal,
        actualTotal,
        displayLabel: getDisplayLabel(plannedTotal, actualTotal),
        warnings,
        paidThisMonthCount,
        hasPaidValue,
      };
    });
  }
}

function rowHasValues(row, months) {
  return months.some(month => Math.abs(row.values[month] ? (row.values[month].value || 0) : 0) > 0.0001);
}

function filterRows(row, months) {
  const filteredChildren = row.children
    .map(child => filterRows(child, months))
    .filter(Boolean);
  row.children = filteredChildren;
  const hasChildren = filteredChildren.length > 0;
  const hasValues = rowHasValues(row, months);
  if (row.alwaysVisible || row.isSummary) return row;
  if (hasChildren) return row;
  return hasValues ? row : null;
}

function flattenRows(rows, expandedSet) {
  const result = [];
  function traverse(row) {
    result.push(row);
    if (!row.children.length) return;
    if (!expandedSet.has(row.id)) return;
    if (row.children.length > MAX_DETAIL_ROWS && row.level >= 2) {
      row.children.slice(0, MAX_DETAIL_ROWS).forEach(child => traverse(child));
      const remaining = row.children.length - MAX_DETAIL_ROWS;
      result.push(buildRow({
        id: `${row.id}-more`,
        label: `+ ${remaining} weitere …`,
        level: row.level + 1,
        rowType: "detail",
        section: row.section,
        sourceLabel: row.sourceLabel,
      }));
      return;
    }
    row.children.forEach(child => traverse(child));
  }
  rows.forEach(traverse);
  return result;
}

function buildDashboardRows(state, months, options = {}) {
  const plannedPayoutMap = computePlannedPayoutByMonth(state, months);
  const actualPayoutMap = new Map();
  const monthlyActuals = state && state.monthlyActuals && typeof state.monthlyActuals === "object"
    ? state.monthlyActuals
    : {};
  Object.entries(monthlyActuals).forEach(([month, entry]) => {
    if (!months.includes(month)) return;
    const revenue = Number(entry && entry.realRevenueEUR);
    const payoutRate = Number(entry && entry.realPayoutRatePct);
    if (!Number.isFinite(revenue) || !Number.isFinite(payoutRate)) return;
    actualPayoutMap.set(month, revenue * (payoutRate / 100));
  });
  const coverage = options.coverage instanceof Map ? options.coverage : new Map();

  const amazonEvents = months.map(month => ({
    id: `amazon-${month}`,
    month,
    plannedEur: plannedPayoutMap.get(month) || 0,
    actualEur: actualPayoutMap.get(month) || 0,
    paid: actualPayoutMap.has(month),
  }));

  const extraRows = state && Array.isArray(state.extras) ? state.extras : [];
  const extraInEvents = extraRows
    .filter(row => parseEuro(row && row.amountEur) >= 0)
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: parseEuro(row.amountEur),
      actualEur: parseEuro(row.amountEur),
      paid: true,
    }))
    .filter(evt => evt.month);

  const extraOutEvents = extraRows
    .filter(row => parseEuro(row && row.amountEur) < 0)
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: Math.abs(parseEuro(row.amountEur)),
      actualEur: Math.abs(parseEuro(row.amountEur)),
      paid: true,
    }))
    .filter(evt => evt.month);

  const dividendEvents = (state && Array.isArray(state.dividends) ? state.dividends : [])
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: Math.abs(parseEuro(row.amountEur)),
      actualEur: Math.abs(parseEuro(row.amountEur)),
      paid: true,
    }))
    .filter(evt => evt.month);

  const fixcostInstances = expandFixcostInstances(state, { months });
  const fixcostEvents = fixcostInstances.map(inst => ({
    id: inst.id,
    month: inst.month,
    plannedEur: inst.amount,
    actualEur: inst.amount,
    paid: inst.paid === true,
    fixedCostId: inst.fixedCostId,
    paidDate: inst.paid ? inst.dueDateIso : null,
  }));

  const vatPreview = computeVatPreview(state || {});
  const taxEvents = vatPreview.rows.map(row => ({
    id: `tax-${row.month}`,
    month: row.month,
    plannedEur: Math.max(0, Number(row.payable || 0)),
    actualEur: 0,
    paid: false,
  }));

  const skuAliasMap = buildSkuAliasMap(state);
  const poData = buildPoData(state);
  const foData = buildFoData(state);

  const amazonRow = buildRow({
    id: "amazon-payout",
    label: "Amazon Auszahlungen",
    level: 1,
    events: amazonEvents,
    sumMode: "generic",
    rowType: "subtotal",
    section: "inflows",
    sourceLabel: "Eingaben",
    nav: { route: "#eingaben" },
  });
  const extraInRow = buildRow({
    id: "other-in",
    label: "Weitere Einzahlungen",
    level: 1,
    events: extraInEvents,
    sumMode: "generic",
    rowType: "detail",
    section: "inflows",
    sourceLabel: "Eingaben",
  });

  const inflowRow = buildRow({
    id: "inflows",
    label: "Einzahlungen",
    level: 0,
    children: [amazonRow, extraInRow],
    rowType: "section",
    section: "inflows",
    sourceLabel: "Einzahlungen",
  });

  const poChildren = poData.map(po => {
    const poNo = po.record && po.record.poNo ? po.record.poNo : "";
    const poLabel = poNo ? `PO ${poNo}` : "PO";
    const depositPaid = po.events.some(evt => /deposit/i.test(evt.typeLabel || "") && evt.paid);
    const balancePaid = po.events.some(evt => /balance/i.test(evt.typeLabel || "") && evt.paid);
    const aliasLine = formatAliasTooltip(getPoAliasInfo(po.record, skuAliasMap));
    const tooltipParts = [
      `PO: ${poNo || "—"}`,
      `Supplier: ${po.supplier || "—"}`,
      `Units: ${po.units || 0}`,
      aliasLine,
      `Deposit: ${depositPaid ? "bezahlt" : "offen"}`,
      `Balance: ${balancePaid ? "bezahlt" : "offen"}`,
    ];
    const paymentRows = po.events.map(evt => {
      const eventTooltip = [
        `Typ: ${evt.typeLabel || "Zahlung"}`,
        `Datum: ${evt.dueDate || "—"}`,
        `Ist EUR: ${formatEur0(evt.actualEur || 0)}`,
        aliasLine,
        evt.currency ? `Währung: ${evt.currency}` : null,
        evt.paidBy ? `Paid by: ${evt.paidBy}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return buildRow({
        id: `po-${(po.record && po.record.id) || poLabel}-${evt.id}`,
        label: evt.typeLabel || evt.label || "Zahlung",
        level: 3,
        events: [evt],
        tooltip: eventTooltip,
        rowType: "detail",
        section: "outflows",
        sourceLabel: "PO Zahlung",
        nav: {
          route: "#po",
          open: (po.record && (po.record.id || po.record.poNo)) || "",
          focus: evt.typeLabel ? `payment:${evt.typeLabel}` : null,
        },
      });
    });

    return buildRow({
      id: `po-${(po.record && po.record.id) || poLabel}`,
      label: poLabel,
      level: 2,
      children: paymentRows,
      events: [],
      tooltip: tooltipParts.join(" · "),
      rowType: "detail",
      section: "outflows",
      sourceLabel: "PO",
      nav: { route: "#po", open: (po.record && (po.record.id || po.record.poNo)) || "" },
    });
  });

  const poRow = buildRow({
    id: "po-payments",
    label: "PO Zahlungen",
    level: 1,
    children: poChildren,
    alwaysVisible: true,
    rowType: "subtotal",
    section: "outflows",
    sourceLabel: "PO Zahlungen",
  });

  const foChildren = foData.map(fo => {
    const foNo = fo.record && fo.record.foNo ? fo.record.foNo : "";
    const label = foNo ? `FO ${foNo}` : "FO";
    const foTooltip = [
      `FO: ${foNo || (fo.record && fo.record.id) || "—"}`,
      `SKU: ${(fo.record && fo.record.sku) || "—"}`,
      `Units: ${(fo.record && fo.record.units) || 0}`,
      `ETA: ${(fo.record && (fo.record.etaDate || fo.record.targetDeliveryDate)) || "—"}`,
      `Status: ${(fo.record && fo.record.status) || "—"}`,
    ].join(" · ");
    const events = fo.events.map(evt => {
      const tooltip = [
        `Typ: ${evt.typeLabel || "Payment"}`,
        `Datum: ${evt.dueDate || "—"}`,
        `Ist EUR: ${formatEur0(evt.actualEur || 0)}`,
        evt.currency ? `Währung: ${evt.currency}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return buildRow({
        id: `fo-${(fo.record && fo.record.id) || label}-${evt.id}`,
        label: evt.typeLabel || evt.label || "Payment",
        level: 3,
        events: [evt],
        tooltip,
        rowType: "detail",
        section: "outflows",
        sourceLabel: "FO Zahlung",
        nav: { route: "#fo", open: (fo.record && (fo.record.id || fo.record.foNo)) || "" },
      });
    });
    return buildRow({
      id: `fo-${(fo.record && fo.record.id) || label}`,
      label,
      level: 2,
      children: events,
      events: [],
      tooltip: foTooltip,
      rowType: "detail",
      section: "outflows",
      sourceLabel: "FO",
      nav: { route: "#fo", open: (fo.record && (fo.record.id || fo.record.foNo)) || "" },
    });
  });

  const foRow = buildRow({
    id: "fo-payments",
    label: "FO Zahlungen",
    level: 1,
    children: foChildren,
    alwaysVisible: true,
    rowType: "subtotal",
    section: "outflows",
    sourceLabel: "FO Zahlungen",
  });

  const fixcostRow = buildRow({
    id: "fixcosts",
    label: "Fixkosten",
    level: 1,
    events: fixcostEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Fixkosten vorhanden.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Fixkosten",
    nav: { route: "#fixkosten" },
  });

  const taxRow = buildRow({
    id: "taxes",
    label: "Steuern",
    level: 1,
    events: taxEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Steuerdaten hinterlegt.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Steuern",
  });

  const dividendRow = buildRow({
    id: "dividends",
    label: "Dividende",
    level: 1,
    events: dividendEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Dividenden erfasst.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Dividende",
  });

  const otherOutRow = buildRow({
    id: "other-out",
    label: "Weitere Auszahlungen",
    level: 1,
    events: extraOutEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine weiteren Auszahlungen vorhanden.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Auszahlungen",
  });

  const outflowRow = buildRow({
    id: "outflows",
    label: "Auszahlungen",
    level: 0,
    children: [poRow, foRow, fixcostRow, taxRow, dividendRow, otherOutRow],
    rowType: "section",
    section: "outflows",
    sourceLabel: "Auszahlungen",
  });

  applyRowValues(inflowRow, months, options.currentMonth);
  applyRowValues(outflowRow, months, options.currentMonth);

  const netRow = buildRow({
    id: "net-cashflow",
    label: "Netto Cashflow",
    level: 0,
    isSummary: true,
    alwaysVisible: true,
    rowType: "summary",
    section: "summary",
    sourceLabel: "Netto Cashflow",
  });
  months.forEach(month => {
    const inflow = inflowRow.values[month] ? (inflowRow.values[month].value || 0) : 0;
    const outflow = outflowRow.values[month] ? (outflowRow.values[month].value || 0) : 0;
    const plannedTotal = (inflowRow.values[month] ? (inflowRow.values[month].plannedTotal || 0) : 0)
      - (outflowRow.values[month] ? (outflowRow.values[month].plannedTotal || 0) : 0);
    const actualTotal = (inflowRow.values[month] ? (inflowRow.values[month].actualTotal || 0) : 0)
      - (outflowRow.values[month] ? (outflowRow.values[month].actualTotal || 0) : 0);
    netRow.values[month] = {
      value: inflow - outflow,
      plannedTotal,
      actualTotal,
      displayLabel: getDisplayLabel(Math.abs(plannedTotal), Math.abs(actualTotal)),
      warnings: [],
      paidThisMonthCount: 0,
    };
  });

  const openingRaw = safeValue(state && state.openingEur, safeValue(state && state.settings && state.settings.openingBalance, null));
  const openingBalance = parseEuro(openingRaw || 0);
  const monthlyActualsMap = state && state.monthlyActuals && typeof state.monthlyActuals === "object"
    ? state.monthlyActuals
    : {};
  const balanceRow = buildRow({
    id: "balance",
    label: "Kontostand Monatsende",
    level: 0,
    isSummary: true,
    alwaysVisible: true,
    rowType: "summary",
    section: "summary",
    sourceLabel: "Kontostand",
  });
  if (months.length) {
    let baseBalance = openingBalance;
    const lastGreenIndex = options.limitBalanceToGreen
      ? Math.max(-1, ...months.map((m, idx) => (coverage.get(m) === "green" ? idx : -1)))
      : months.length - 1;
    months.forEach((month, idx) => {
      const actualClosing = Number(monthlyActualsMap[month] && monthlyActualsMap[month].realClosingBalanceEUR);
      const hasActual = Number.isFinite(actualClosing);
      const net = netRow.values[month] ? (netRow.values[month].value || 0) : 0;
      const plannedClosing = (Number.isFinite(baseBalance) ? baseBalance : 0) + net;
      if (options.limitBalanceToGreen && idx > lastGreenIndex) {
        balanceRow.values[month] = { value: null, plannedTotal: 0, actualTotal: 0, displayLabel: "Plan", warnings: [], paidThisMonthCount: 0 };
        return;
      }
      const displayValue = hasActual ? actualClosing : plannedClosing;
      balanceRow.values[month] = {
        value: displayValue,
        plannedTotal: plannedClosing,
        actualTotal: hasActual ? actualClosing : plannedClosing,
        displayLabel: hasActual ? "Ist" : "Plan",
        warnings: [],
        paidThisMonthCount: 0,
        isActual: hasActual,
      };
      baseBalance = hasActual ? actualClosing : plannedClosing;
    });
  }

  const summaryRows = [netRow, balanceRow];

  return { inflowRow, outflowRow, summaryRows };
}

function buildDashboardHTML(state) {
  const startMonth = (state && state.settings && state.settings.startMonth) || "2025-01";
  const horizon = Number((state && state.settings && state.settings.horizonMonths) || 12) || 12;
  const endMonth = addMonths(startMonth, horizon - 1);
  const allMonths = getMonthlyBuckets(startMonth, endMonth);
  const currentMonth = currentMonthKey();
  if (!isValidRange(dashboardState.range)) {
    dashboardState.range = RANGE_DEFAULT;
  }
  const baseMonths = getVisibleMonths(allMonths, dashboardState.range, currentMonth);
  const skuCoverage = computeSkuCoverage(state, baseMonths);
  const monthHealthResults = skuCoverage.details;

  const rowsBoth = buildDashboardRows(state, baseMonths, {
    limitBalanceToGreen: dashboardState.limitBalanceToGreen,
    currentMonth,
    coverage: skuCoverage.coverage,
  });
  const filteredInflow = filterRows(rowsBoth.inflowRow, baseMonths);
  const filteredOutflow = filterRows(rowsBoth.outflowRow, baseMonths);
  const topRowsAll = [filteredInflow, filteredOutflow, ...rowsBoth.summaryRows].filter(Boolean);
  const nonEmptyMonths = dashboardState.hideEmptyMonths
    ? baseMonths.filter(month => monthHasValues(topRowsAll, month))
    : baseMonths.slice();

  const { inflowRow, outflowRow, summaryRows } = buildDashboardRows(state, nonEmptyMonths, {
    limitBalanceToGreen: dashboardState.limitBalanceToGreen,
    currentMonth,
    coverage: skuCoverage.coverage,
  });
  const filteredVisibleInflow = filterRows(inflowRow, nonEmptyMonths);
  const filteredVisibleOutflow = filterRows(outflowRow, nonEmptyMonths);

  const topRows = [filteredVisibleInflow, filteredVisibleOutflow, ...summaryRows].filter(Boolean);
  const flatRows = flattenRows(topRows, dashboardState.expanded);
  const coverageNoticeNeeded = skuCoverage.activeSkus.length > 0
    && nonEmptyMonths.some(month => skuCoverage.coverage.get(month) !== "green");

  const rangeSelect = `
      <label class="dashboard-range">
        <span>Zeitraum</span>
        <select id="dashboard-range">
          ${RANGE_OPTIONS.map(option => `<option value="${option.value}" ${option.value === dashboardState.range ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
    `;

  const monthHealthClasses = nonEmptyMonths.map(month => {
    const statusKey = monthHealthResults.get(month)?.statusKey || "gray";
    return coverageStatusToHealthClass(statusKey);
  });

  const headerCells = nonEmptyMonths
    .map((month, idx) => {
      const columnClass = monthColumnClass(idx);
      const healthClass = monthHealthClasses[idx] || "col-health health-none";
      const detail = skuCoverage.details.get(month) || {};
      const healthResult = monthHealthResults.get(month) || {};
      const status = healthResult.statusKey || detail.statusKey || "gray";
      const totalCount = Number.isFinite(detail.activeSkus) ? detail.activeSkus : 0;
      const statusLabel = COVERAGE_LEVELS[status]?.label || "—";
      const tooltip = [
        `Status: ${statusLabel}`,
        `Abdeckung: ${detail.coveredSkus || 0}/${totalCount} (${formatPercent(detail.coverageRatio || 0)})`,
      ]
        .filter(Boolean)
        .join("\n");
      return `
        <th scope="col" class="${columnClass} ${healthClass}" data-col-index="${idx}">
          <button type="button" class="coverage-indicator coverage-${status} coverage-button" data-coverage-month="${escapeHtml(month)}" data-health-month="${escapeHtml(month)}" title="${escapeHtml(tooltip)}" aria-label="Reifegrad ${escapeHtml(formatMonthLabel(month))}: ${escapeHtml(statusLabel)}"></button>
          <span class="month-header-label">
            <button type="button" class="month-header-trigger" data-health-month="${escapeHtml(month)}">
              ${escapeHtml(formatMonthLabel(month))}
            </button>
          </span>
        </th>
      `;
    })
    .join("");
  const compareHeader = `<th scope="col" class="dashboard-compare-header">Kontostand Plan/Ist</th>`;

  const bodyRows = flatRows
    .map(row => {
      const hasChildren = row.children.length > 0;
      const isExpanded = dashboardState.expanded.has(row.id);
      const indentClass = `tree-level-${row.level}`;
      const toggle = hasChildren
        ? `<button type="button" class="tree-toggle" data-row-id="${escapeHtml(row.id)}" aria-expanded="${isExpanded}">${isExpanded ? "▼" : "▶"}</button>`
        : `<span class="tree-spacer" aria-hidden="true"></span>`;
      const labelTitle = row.tooltip || row.emptyHint || "";
      const rowClasses = [
        row.rowType === "section" ? "row-section" : "",
        row.rowType === "subtotal" ? "row-subtotal" : "",
        row.rowType === "summary" ? "row-summary" : "",
        row.rowType === "detail" ? "row-detail" : "",
        row.section ? `section-${row.section}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const labelCell = `
        <td class="tree-cell ${indentClass} ${row.isSummary ? "tree-summary" : ""}" title="${escapeHtml(labelTitle)}">
          ${toggle}
          <span class="tree-label">${escapeHtml(row.label)}</span>
        </td>
      `;

      const valueCells = nonEmptyMonths
        .map((month, idx) => {
          const columnClass = monthColumnClass(idx);
          const healthClass = monthHealthClasses[idx] || "col-health health-none";
          const cell = row.values[month] || { value: 0, warnings: [] };
          const showBalanceWarning = row.id === "balance" && skuCoverage.coverage.get(month) !== "green";
          const balanceWarning = showBalanceWarning
            ? `<span class="cell-balance-warning" title="Kontostand kann unvollständig sein, da Planung fehlt.">⚠︎</span>`
            : "";
          const formatted = formatCellValue(cell.value);
          const paidThisMonth = month === currentMonth && (cell.paidThisMonthCount || 0) > 0;
          const paidHint = paidThisMonth ? `Zahlungen diesen Monat bezahlt: ${cell.paidThisMonthCount}` : null;
          const isPaidValue = cell.hasPaidValue && String(row.sourceLabel || "").toLowerCase().includes("po");
          const actualMarker = cell.isActual ? `<span class="cell-actual-tag" title="Realer Wert">Ist</span>` : "";
          const tooltip = [
            `Plan/Ist: ${formatValueOnly(cell.plannedTotal)} / ${formatValueOnly(cell.actualTotal)}`,
            `Status: ${cell.displayLabel || "Plan"}`,
          ]
            .filter(Boolean)
            .join("\n");
          const balanceDetail = row.id === "balance" && cell.isActual
            ? `<div class="balance-detail"><span>Plan: ${formatValueOnly(cell.plannedTotal)}</span><span>Ist: ${formatValueOnly(cell.actualTotal)}</span></div>`
            : "";
          const isClickable = row.nav && !formatted.isEmpty;
          const navPayload = row.nav ? encodeURIComponent(JSON.stringify({ ...row.nav, month })) : "";
          return `
            <td class="num ${row.isSummary ? "tree-summary" : ""} ${paidThisMonth ? "cell-paid-current" : ""} ${isClickable ? "cell-link" : ""} ${columnClass} ${healthClass}" ${isClickable ? `data-nav="${navPayload}"` : ""} data-col-index="${idx}" title="${escapeHtml(tooltip)}">
              ${balanceWarning}
              <span class="${formatted.isEmpty ? "cell-empty" : ""} ${isPaidValue ? "cell-paid-value" : ""}">${formatted.text}</span>
              ${balanceDetail}
              ${actualMarker}
              ${isClickable ? `<span class="cell-link-icon" aria-hidden="true">↗</span>` : ""}
            </td>
          `;
        })
        .join("");
      const compareCell = (() => {
        if (row.id !== "balance") {
          return `<td class="num dashboard-compare-cell muted">—</td>`;
        }
        const latestActualMonth = nonEmptyMonths
          .slice()
          .reverse()
          .find(month => row.values[month]?.isActual);
        if (!latestActualMonth) {
          return `<td class="num dashboard-compare-cell muted">—</td>`;
        }
        const cell = row.values[latestActualMonth] || {};
        return `
          <td class="num dashboard-compare-cell">
            <div class="balance-compare">
              <span>Plan: ${formatValueOnly(cell.plannedTotal)}</span>
              <span>Ist: ${formatValueOnly(cell.actualTotal)}</span>
              <span class="muted">${escapeHtml(formatMonthLabel(latestActualMonth))}</span>
            </div>
          </td>
        `;
      })();

      return `<tr data-row-id="${escapeHtml(row.id)}" class="${rowClasses}">${labelCell}${valueCells}${compareCell}</tr>`;
    })
    .join("");

  const coverageNotice = "";

  return `
    <section class="dashboard">
      <div class="dashboard-header">
        <div class="dashboard-topline">
          <div class="dashboard-title-block">
            <h2>Dashboard</h2>
            <p class="muted">Planwerte werden durch Ist ersetzt, sobald Zahlungen verbucht sind. Drilldowns zeigen PO/FO-Events.</p>
          </div>
          <div class="dashboard-range-slot">
            ${rangeSelect}
          </div>
        </div>
        <div class="dashboard-toolbar">
          <div class="dashboard-toggle" role="group" aria-label="Expand">
            <button type="button" class="btn secondary" data-expand="collapse">Alles zu</button>
            <button type="button" class="btn secondary" data-expand="expand">Alles auf</button>
          </div>
          <div class="dashboard-toolbar-filters">
            <label class="dashboard-toggle dashboard-checkbox">
              <input type="checkbox" id="dashboard-hide-empty" ${dashboardState.hideEmptyMonths ? "checked" : ""} />
              <span>Leere Monate ausblenden</span>
            </label>
            <label class="dashboard-toggle dashboard-checkbox">
              <input type="checkbox" id="dashboard-limit-balance" ${dashboardState.limitBalanceToGreen ? "checked" : ""} />
              <span>Kontostand nur bis letztem grünen Monat</span>
            </label>
          </div>
          <div class="dashboard-toolbar-legend muted">
            <button type="button" class="legend-trigger" id="dashboard-legend-info">
              <span class="coverage-indicator coverage-green"></span> Vollständig
              <span class="coverage-indicator coverage-light"></span> Weitgehend
              <span class="coverage-indicator coverage-orange"></span> Teilweise
              <span class="coverage-indicator coverage-red"></span> Unzureichend
              <span class="legend-more">Details</span>
            </button>
            <span class="legend-item"><span class="legend-paid"></span> Zahlung im aktuellen Monat bezahlt</span>
          </div>
        </div>
      </div>
      ${coverageNotice}
      <div class="dashboard-table-wrap">
        <div class="dashboard-table-scroll">
          <table class="table-compact dashboard-tree-table" role="table" data-ui-table="true" data-sticky-cols="1">
            <thead>
              <tr>
                <th scope="col" class="tree-header">Kategorie / Zeile</th>
                ${headerCells}
                ${compareHeader}
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `
                <tr>
                  <td colspan="${nonEmptyMonths.length + 2}" class="muted">Keine Daten vorhanden.</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

function buildCoverageLegendModalHTML() {
  const thresholds = `Schwellen: Vollständig ${formatPercent(COVERAGE_THRESHOLDS.full)}, Weitgehend ≥${formatPercent(COVERAGE_THRESHOLDS.wide)}, Teilweise ≥${formatPercent(COVERAGE_THRESHOLDS.partial)}.`;
  const items = ["green", "light", "orange", "red"]
    .map(key => `
      <li class="dashboard-detail-item">
        <span class="coverage-indicator coverage-${key}"></span>
        <div>
          <strong>${escapeHtml(COVERAGE_LEVELS[key].label)}</strong>
          <div class="muted small">${escapeHtml(COVERAGE_LEVELS[key].detail)}</div>
        </div>
      </li>
    `)
    .join("");
  return `
    <div class="po-modal dashboard-detail-modal">
      <header class="po-modal-header">
        <h3>Reifegrad-Legende</h3>
        <button type="button" class="btn ghost" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="po-modal-body">
        <p class="muted">${thresholds}</p>
        <ul class="dashboard-detail-list">
          ${items}
        </ul>
      </div>
      <footer class="po-modal-actions">
        <button type="button" class="btn secondary" data-close>Schließen</button>
      </footer>
    </div>
  `;
}

function buildMonthHealthPanelHTML(result) {
  if (!result) return "";
  const statusKey = result.statusKey || "gray";
  const statusLabel = result.status || COVERAGE_LEVELS[statusKey]?.label || "—";
  const monthLabel = formatMonthLabel(result.monthKey);
  const activeSkus = Number(result.activeSkus || 0);
  const coveredSkus = Number(result.coveredSkus || 0);
  const coverageRatio = Number(result.coverageRatio || 0);
  const missingCritical = result.missingCritical || {};
  const taxesActive = Boolean(result.taxesActive);
  const projectionMode = result.projectionMode === "doh" ? "doh" : "units";
  const valueLabel = projectionMode === "doh" ? "DOH" : "Units";
  const safetyLabel = projectionMode === "doh" ? "Safety DOH" : "Safety Units";
  const inventoryCoverageOk = activeSkus > 0 && coverageRatio >= COVERAGE_THRESHOLDS.full;
  const checklist = [
    {
      label: "Inventory Coverage ok?",
      description: `${coveredSkus}/${activeSkus} aktive SKUs abgedeckt (${formatPercent(coverageRatio)}).`,
      passed: inventoryCoverageOk,
    },
    {
      label: "Amazon payouts vorhanden?",
      description: "Amazon-Auszahlungen für den Monat sind erfasst.",
      passed: !missingCritical.amazonPayout,
    },
    {
      label: "Fixkosten vorhanden?",
      description: "Fixkosten für den Monat sind gepflegt.",
      passed: !missingCritical.fixedCosts,
    },
    {
      label: "Steuer-Config ok?",
      description: taxesActive ? "USt-Vorschau ist konfiguriert." : "USt-Vorschau ist nicht aktiv.",
      passed: taxesActive ? !missingCritical.taxes : true,
    },
  ];

  const thresholds = `Schwellen: Vollständig ≥${formatPercent(COVERAGE_THRESHOLDS.full)}, Weitgehend ≥${formatPercent(COVERAGE_THRESHOLDS.wide)}, Teilweise ≥${formatPercent(COVERAGE_THRESHOLDS.partial)}.`;
  const todoLinks = Array.isArray(result.todoLinks) ? result.todoLinks : [];
  const showTodos = statusKey !== "green" && todoLinks.length > 0;
  const todoList = showTodos
    ? todoLinks.map(link => `
      <li>
        <a href="${escapeHtml(link.href)}" class="btn ghost btn-small" data-panel-link>${escapeHtml(link.label)}</a>
      </li>
    `).join("")
    : `<li class="muted small">Keine To-Dos.</li>`;

  const problemRows = (result.problemSkus || [])
    .map(item => `
      <tr>
        <td>${escapeHtml(item.sku)}</td>
        <td>${escapeHtml(item.alias || "—")}</td>
        <td class="muted">${escapeHtml(item.abcClass || "—")}</td>
        <td class="num">${formatInt(item.value)}</td>
        <td class="num">${formatInt(item.safetyValue)}</td>
        <td>${escapeHtml(item.problem || "—")}</td>
      </tr>
    `)
    .join("");

  const problemTable = problemRows
    ? `
      <table class="dashboard-detail-table" data-ui-table="true">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Alias</th>
            <th>ABC</th>
            <th class="num">${escapeHtml(valueLabel)}</th>
            <th class="num">${escapeHtml(safetyLabel)}</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          ${problemRows}
        </tbody>
      </table>
    `
    : `<div class="muted">Keine problematischen SKUs.</div>`;

  const checklistHtml = checklist
    .map(item => `
      <li class="dashboard-detail-item ${item.passed ? "detail-pass" : "detail-fail"}">
        <span class="detail-check">${item.passed ? "✓" : "✕"}</span>
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <div class="muted small">${escapeHtml(item.description)}</div>
        </div>
      </li>
    `)
    .join("");

  return `
    <div class="dashboard-side-panel" role="dialog" aria-modal="true" aria-label="Monats-Details">
      <header class="dashboard-side-panel-header">
        <div>
          <h3>Monat ${escapeHtml(monthLabel)} – Status: ${escapeHtml(statusLabel)}</h3>
          <div class="dashboard-side-panel-subtitle">
            <span class="coverage-indicator coverage-${statusKey}"></span>
            <span>${escapeHtml(COVERAGE_LEVELS[statusKey]?.detail || "")}</span>
          </div>
        </div>
        <button type="button" class="btn ghost" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="dashboard-side-panel-body">
        <section class="dashboard-side-panel-section">
          <h4>Status & Berechnung</h4>
          <div class="dashboard-detail-metrics">
            <div>
              <span class="muted">Aktive SKUs</span>
              <strong>${formatInt(activeSkus)}</strong>
            </div>
            <div>
              <span class="muted">Abgedeckte SKUs</span>
              <strong>${formatInt(coveredSkus)}</strong>
            </div>
            <div>
              <span class="muted">Coverage Ratio</span>
              <strong>${formatPercent(coverageRatio)}</strong>
            </div>
          </div>
          <div class="muted small">${escapeHtml(thresholds)}</div>
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Checklist</h4>
          <ul class="dashboard-detail-list">
            ${checklistHtml}
          </ul>
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Problematische SKUs</h4>
          ${problemTable}
        </section>
        <section class="dashboard-side-panel-section">
          <h4>Was zu tun ist</h4>
          <ul class="health-check-list">
            ${todoList}
          </ul>
        </section>
      </div>
    </div>
  `;
}

  // --- Globaler Tooltip an <body> (nicht clipbar) ---
  function ensureGlobalTip(){
    let el = document.getElementById("global-chart-tip");
    if (!el){
      el = document.createElement("div");
      el.id = "global-chart-tip";
      el.className = "chart-tip";
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }
  const tip = ensureGlobalTip();

  function tipHtml(m, row, eom) {
    return `
      <div class="tip-title">${m}</div>
      <div class="tip-row"><span>Netto</span><b>${fmtEUR(row.net)}</b></div>
      <div class="tip-row"><span>Inflow</span><b>${fmtEUR(row.inflow)}</b></div>
      <div class="tip-row"><span>Extras</span><b>${fmtEUR(row.extras)}</b></div>
      <div class="tip-row"><span>Outflow</span><b>${fmtEUR(-Math.abs(row.out))}</b></div>
      <div class="tip-row"><span>Kontostand (EOM)</span><b>${fmtEUR(eom)}</b></div>
    `;
  }

function attachDashboardHandlers(root, state) {
  const openModal = (modalHtml) => {
    const existing = document.querySelector(".dashboard-modal-backdrop");
    if (existing) existing.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "po-modal-backdrop dashboard-modal-backdrop";
    backdrop.innerHTML = modalHtml;
    document.body.appendChild(backdrop);

    const closeModal = () => {
      document.removeEventListener("keydown", handleKeydown);
      backdrop.remove();
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") closeModal();
    };

    backdrop.addEventListener("click", (event) => {
      const closeBtn = event.target.closest("[data-close]");
      if (closeBtn) {
        closeModal();
        return;
      }
      if (event.target === backdrop) {
        closeModal();
        return;
      }
      const fixBtn = event.target.closest("[data-fix-route]");
      if (!fixBtn) return;
      const route = fixBtn.getAttribute("data-fix-route");
      if (!route) return;
      const params = new URLSearchParams();
      const sku = fixBtn.getAttribute("data-fix-sku");
      const month = fixBtn.getAttribute("data-fix-month");
      if (sku) params.set("sku", sku);
      if (month) params.set("month", month);
      location.hash = params.toString() ? `${route}?${params.toString()}` : route;
      closeModal();
    });

    document.addEventListener("keydown", handleKeydown);
  };

  const openSidePanel = (panelHtml) => {
    const existing = document.querySelector(".dashboard-side-panel-backdrop");
    if (existing) existing.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "dashboard-side-panel-backdrop";
    backdrop.innerHTML = panelHtml;
    document.body.appendChild(backdrop);

    const closePanel = () => {
      document.removeEventListener("keydown", handleKeydown);
      backdrop.remove();
    };

    const handleKeydown = (event) => {
      if (event.key === "Escape") closePanel();
    };

    backdrop.addEventListener("click", (event) => {
      const closeBtn = event.target.closest("[data-close]");
      if (closeBtn) {
        closePanel();
        return;
      }
      if (event.target === backdrop) {
        closePanel();
        return;
      }
      const link = event.target.closest("[data-panel-link]");
      if (link) {
        closePanel();
      }
    });

    document.addEventListener("keydown", handleKeydown);
  };

  root.querySelectorAll("[data-expand]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-expand");
      const startMonth = (state && state.settings && state.settings.startMonth) || "2025-01";
      const horizon = Number((state && state.settings && state.settings.horizonMonths) || 12) || 12;
      const endMonth = addMonths(startMonth, horizon - 1);
      const currentMonth = currentMonthKey();
      const months = getMonthlyBuckets(startMonth, endMonth);
      const baseMonths = getVisibleMonths(months, dashboardState.range, currentMonth);
      const skuCoverage = computeSkuCoverage(state, baseMonths);
      const rowsBoth = buildDashboardRows(state, baseMonths, {
        limitBalanceToGreen: dashboardState.limitBalanceToGreen,
        currentMonth,
        coverage: skuCoverage.coverage,
      });
      const topRowsAll = [
        filterRows(rowsBoth.inflowRow, baseMonths),
        filterRows(rowsBoth.outflowRow, baseMonths),
        ...rowsBoth.summaryRows,
      ].filter(Boolean);
      const visibleMonths = dashboardState.hideEmptyMonths
        ? baseMonths.filter(month => monthHasValues(topRowsAll, month))
        : baseMonths;
      const { inflowRow, outflowRow, summaryRows } = buildDashboardRows(state, visibleMonths, {
        limitBalanceToGreen: dashboardState.limitBalanceToGreen,
        currentMonth,
        coverage: skuCoverage.coverage,
      });
      const topRows = [filterRows(inflowRow, visibleMonths), filterRows(outflowRow, visibleMonths), ...summaryRows].filter(Boolean);
      const expandableIds = collectExpandableIds(topRows);
      const coverageGroups = skuCoverage.groups || [];
      if (action === "collapse") {
        dashboardState.expanded = new Set();
        dashboardState.coverageCollapsed = new Set(coverageGroups.map(group => group.id));
      } else {
        dashboardState.expanded = new Set(expandableIds);
        dashboardState.coverageCollapsed = new Set();
      }
      render(root);
    });
  });

  function showTip(ev) {
    const el = ev.target.closest(".vbar");
    if (!el) return;
    const i = Number(el.getAttribute("data-idx"));
    const row = series[i];
    const eom = closing[i];

    tip.innerHTML = tipHtml(months[i], row, eom);
    tip.hidden = false;
  }

  const hideEmptyToggle = root.querySelector("#dashboard-hide-empty");
  if (hideEmptyToggle) {
    hideEmptyToggle.addEventListener("change", () => {
      dashboardState.hideEmptyMonths = hideEmptyToggle.checked;
      render(root);
    });
  }

  const limitBalanceToggle = root.querySelector("#dashboard-limit-balance");
  if (limitBalanceToggle) {
    limitBalanceToggle.addEventListener("change", () => {
      dashboardState.limitBalanceToGreen = limitBalanceToggle.checked;
      render(root);
    });
  }

  const legendButton = root.querySelector("#dashboard-legend-info");
  if (legendButton) {
    legendButton.addEventListener("click", () => {
      openModal(buildCoverageLegendModalHTML());
    });
  }

  root.querySelectorAll("[data-health-month]").forEach(button => {
    button.addEventListener("click", () => {
      const month = button.getAttribute("data-health-month");
      if (!month) return;
      const months = Array.from(root.querySelectorAll("[data-coverage-month]"))
        .map(el => el.getAttribute("data-coverage-month"))
        .filter(Boolean);
      const coverageData = computeSkuCoverage(state, months);
      const result = coverageData.details.get(month);
      if (!result) return;
      openSidePanel(buildMonthHealthPanelHTML(result));
    });
  });

  const table = root.querySelector(".dashboard-tree-table");
  if (table) {
    let activeColIndex = null;
    const clearColumnHover = () => {
      if (activeColIndex == null) return;
      table.querySelectorAll(`[data-col-index="${activeColIndex}"]`).forEach(el => {
        el.classList.remove("is-col-hover");
      });
      activeColIndex = null;
    };
    const setColumnHover = (index) => {
      if (index == null || index === activeColIndex) return;
      clearColumnHover();
      table.querySelectorAll(`[data-col-index="${index}"]`).forEach(el => {
        el.classList.add("is-col-hover");
      });
      activeColIndex = index;
    };
    table.addEventListener("mouseover", (event) => {
      const cell = event.target.closest("[data-col-index]");
      if (!cell || !table.contains(cell)) return;
      setColumnHover(cell.getAttribute("data-col-index"));
    });
    table.addEventListener("mouseleave", () => {
      clearColumnHover();
    });

    table.addEventListener("click", (event) => {
      const toggle = event.target.closest("button.tree-toggle[data-row-id]");
      if (!toggle) return;
      const rowId = toggle.getAttribute("data-row-id");
      if (!rowId) return;
      if (dashboardState.expanded.has(rowId)) {
        dashboardState.expanded.delete(rowId);
      } else {
        dashboardState.expanded.add(rowId);
      }
      render(root);
    });

    const navigate = (payload) => {
      if (!payload || !payload.route) return;
      const params = new URLSearchParams();
      if (payload.open) params.set("open", payload.open);
      if (payload.focus) params.set("focus", payload.focus);
      if (payload.month) params.set("month", payload.month);
      const query = params.toString();
      location.hash = query ? `${payload.route}?${query}` : payload.route;
    };

    table.addEventListener("dblclick", (event) => {
      const cell = event.target.closest("td[data-nav]");
      if (!cell) return;
      const raw = cell.getAttribute("data-nav");
      if (!raw) return;
      try {
        const payload = JSON.parse(decodeURIComponent(raw));
        navigate(payload);
      } catch {}
    });

    table.addEventListener("click", (event) => {
      const icon = event.target.closest(".cell-link-icon");
      if (!icon) return;
      const cell = icon.closest("td[data-nav]");
      if (!cell) return;
      const raw = cell.getAttribute("data-nav");
      if (!raw) return;
      try {
        const payload = JSON.parse(decodeURIComponent(raw));
        navigate(payload);
      } catch {}
    });
  }

  const rangeSelect = root.querySelector("#dashboard-range");
  if (rangeSelect) {
    rangeSelect.addEventListener("change", () => {
      dashboardState.range = rangeSelect.value;
      try {
        if (isValidRange(dashboardState.range)) {
          setViewValue(RANGE_STORAGE_KEY, dashboardState.range);
        }
      } catch {}
      render(root);
    });
  }
}

let dashboardRoot = null;
let stateListenerOff = null;

export function render(root) {
  dashboardRoot = root;
  const state = loadAppState();
  root.innerHTML = buildDashboardHTML(state);
  attachDashboardHandlers(root, state);

  if (!stateListenerOff) {
    stateListenerOff = addStateListener(() => {
      if (location.hash.replace("#", "") === "dashboard" && dashboardRoot) render(dashboardRoot);
    });
  }
}

export default { render };

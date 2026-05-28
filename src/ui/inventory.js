import { loadAppState, commitAppState, getViewState, setViewState } from "../storage/store.js";
import { parseDeNumber } from "../lib/dataHealth.js";
import { computeAbcClassification } from "../domain/abcClassification.js";
import {
  computeInventoryProjection,
  getProjectionSafetyClass,
  resolveCoverageDays,
  resolveSafetyStockDays,
} from "../domain/inventoryProjection.js";

const INVENTORY_VIEW_KEY = "inventory_view_v1";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]
  ));
}

function escapeSelector(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function addMonths(ym, offset) {
  const [y, m] = ym.split("-").map(Number);
  const base = y * 12 + (m - 1) + offset;
  const year = Math.floor(base / 12);
  const month = (base % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildMonthRange(startMonth, count) {
  return Array.from({ length: count }, (_, idx) => addMonths(startMonth, idx + 1));
}

function formatMonthLabel(month) {
  if (!month) return "—";
  const [y, m] = month.split("-");
  return `${m}-${y}`;
}

function formatMonthSlash(month) {
  if (!month) return "—";
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

function formatDateInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfMonthDate(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month, 0);
}

function normalizeAsOfDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const normalized = new Date(date.getTime());
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

function formatExportTitle(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Bestandsaufnahme";
  return `Bestandsaufnahme zum ${formatShortDate(date)}`;
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  const datePart = date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timePart = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} ${timePart}`;
}

function parseIntegerInput(value) {
  if (value == null || value === "") return { value: 0, isRounded: false };
  const parsed = parseDeNumber(String(value));
  if (!Number.isFinite(parsed)) return { value: 0, isRounded: false };
  const rounded = Math.round(parsed);
  return { value: rounded, isRounded: rounded !== parsed };
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

function formatInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function filterProductsBySearch(products, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return products;
  return products.filter(product => {
    return String(product.alias || "").toLowerCase().includes(term)
      || String(product.sku || "").toLowerCase().includes(term);
  });
}

function isProductActive(product) {
  if (!product) return false;
  if (typeof product.active === "boolean") return product.active;
  const status = String(product.status || "").trim().toLowerCase();
  if (!status) return true;
  return status === "active" || status === "aktiv";
}

function buildCategoryGroups(products, categories = []) {
  const categoryMap = new Map();
  products.forEach(product => {
    const key = product.categoryId ? String(product.categoryId) : "";
    if (!categoryMap.has(key)) categoryMap.set(key, []);
    categoryMap.get(key).push(product);
  });
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
    items: categoryMap.get(String(category.id)) || [],
  }));
  const uncategorized = categoryMap.get("") || [];
  if (uncategorized.length) {
    groups.push({ id: "uncategorized", name: "Ohne Kategorie", items: uncategorized });
  }
  return groups.filter(group => group.items.length);
}

function loadViewState() {
  const raw = getViewState(INVENTORY_VIEW_KEY, {});
  const projectionMode = raw.projectionMode === "doh" || raw.projectionMode === "plan"
    ? raw.projectionMode
    : "units";
  const snapshotViewMode = raw.snapshotViewMode === "eur" ? "eur" : "units";
  return {
    selectedMonth: raw.selectedMonth || null,
    collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
    search: raw.search || "",
    showSafety: raw.showSafety !== false,
    projectionMode,
    snapshotAsOfDate: raw.snapshotAsOfDate || "",
    snapshotViewMode,
  };
}

function saveViewState(state) {
  setViewState(INVENTORY_VIEW_KEY, state);
}

function resolveSelectedMonth(state, view) {
  const snapshotMonths = (state.inventory?.snapshots || [])
    .map(snap => snap?.month)
    .filter(month => /^\d{4}-\d{2}$/.test(month))
    .sort();
  const latest = snapshotMonths[snapshotMonths.length - 1];
  const current = currentMonthKey();
  const candidate = view.selectedMonth || latest || current;
  if (!candidate) return current;
  return candidate;
}

function setAllCategoriesCollapsed({ products, categories, view, collapsed }) {
  const filtered = filterProductsBySearch(products, view.search);
  const groups = buildCategoryGroups(filtered, categories);
  const next = { ...view.collapsed };
  groups.forEach(group => {
    next[group.id] = collapsed;
  });
  view.collapsed = next;
  saveViewState(view);
}

function normalizeMonthKey(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  return raw;
}

function getSnapshot(state, month) {
  return (state.inventory?.snapshots || []).find(snap => snap?.month === month) || null;
}

function ensureSnapshot(state, month) {
  const existing = getSnapshot(state, month);
  if (existing) return existing;
  const snapshot = { month, items: [] };
  if (!state.inventory) state.inventory = { snapshots: [], settings: {} };
  if (!Array.isArray(state.inventory.snapshots)) state.inventory.snapshots = [];
  state.inventory.snapshots.push(snapshot);
  return snapshot;
}

function getSnapshotItem(snapshot, sku) {
  if (!snapshot || !sku) return null;
  if (!Array.isArray(snapshot.items)) snapshot.items = [];
  let item = snapshot.items.find(entry => String(entry.sku || "").trim() === sku);
  if (!item) {
    item = { sku, amazonUnits: 0, threePLUnits: 0, note: "" };
    snapshot.items.push(item);
  }
  return item;
}

function getPreviousSnapshot(state, month) {
  const monthIdx = monthIndex(month);
  if (monthIdx == null) return null;
  const snapshots = (state.inventory?.snapshots || [])
    .filter(snap => snap?.month && monthIndex(snap.month) != null)
    .slice()
    .sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  let prev = null;
  snapshots.forEach(snap => {
    const idx = monthIndex(snap.month);
    if (idx != null && idx < monthIdx) prev = snap;
  });
  return prev;
}

function getSupplierName(state, supplierIdOrName) {
  if (!supplierIdOrName) return "—";
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const match = suppliers.find(sup => String(sup.id || "") === String(supplierIdOrName));
  return match?.name || supplierIdOrName || "—";
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

function buildForecastGroupTotals(groups, forecastBySku, months) {
  const monthKeys = months
    .map(month => normalizeMonthKey(month))
    .filter(Boolean);
  const totalsByGroup = new Map();
  groups.forEach(group => {
    const monthTotals = new Map();
    monthKeys.forEach(monthKey => {
      let sum = 0;
      let hasValue = false;
      group.items.forEach(product => {
        const sku = String(product?.sku || "").trim();
        if (!sku) return;
        const value = forecastBySku.get(sku)?.get(monthKey);
        if (Number.isFinite(value)) {
          sum += value;
          hasValue = true;
        }
      });
      if (hasValue) monthTotals.set(monthKey, sum);
    });
    totalsByGroup.set(group.id, monthTotals);
  });
  return totalsByGroup;
}

function getProductEkEur(product, settings) {
  const template = product?.template?.fields || product?.template || {};
  const unitPrice = parseDeNumber(template.unitPriceUsd ?? product?.unitPriceUsd ?? null);
  if (!Number.isFinite(unitPrice)) return null;
  const currency = String(template.currency || settings?.defaultCurrency || "EUR").toUpperCase();
  if (currency === "EUR") return unitPrice;
  if (currency === "USD") {
    const fxRate = parseDeNumber(settings?.fxRate);
    if (!Number.isFinite(fxRate) || fxRate <= 0) return null;
    return unitPrice / fxRate;
  }
  return null;
}

function formatEur(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function resolveAnchorDate(monthKey, anchorDay) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return null;
  const [year, month] = monthKey.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const anchor = String(anchorDay || "START").toUpperCase();
  let day = 1;
  if (anchor === "MID") day = 15;
  if (anchor === "END") day = new Date(year, month, 0).getDate();
  return new Date(Date.UTC(year, month - 1, day));
}

function formatAnchorLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
}

function resolvePoEtd(po) {
  const manual = parseISODate(po?.etdManual || po?.etdDate);
  if (manual) return manual;
  const orderDate = parseISODate(po?.orderDate);
  if (!orderDate) return null;
  const prodDays = Number(po?.prodDays || 0);
  const etd = new Date(orderDate.getTime());
  etd.setDate(etd.getDate() + Math.max(0, prodDays));
  return etd;
}

function buildInboundMap(state) {
  const inboundMap = new Map();
  const missingEtaSkus = new Set();

  function ensureEntry(sku, month) {
    if (!inboundMap.has(sku)) inboundMap.set(sku, new Map());
    const skuMap = inboundMap.get(sku);
    if (!skuMap.has(month)) {
      skuMap.set(month, { events: [], hasPo: false, hasFo: false, poUnits: 0, foUnits: 0 });
    }
    return skuMap.get(month);
  }

  function addEvent(sku, month, event) {
    const entry = ensureEntry(sku, month);
    const existing = entry.events.find(item => item.type === event.type && item.id === event.id);
    if (existing) {
      existing.qty += event.qty;
    } else {
      entry.events.push({ ...event });
    }
    if (event.type === "PO") {
      entry.hasPo = true;
      entry.poUnits += event.qty;
    }
    if (event.type === "FO") {
      entry.hasFo = true;
      entry.foUnits += event.qty;
    }
  }

  (state.pos || []).forEach(po => {
    if (!po || po.archived) return;
    const items = Array.isArray(po.items) && po.items.length
      ? po.items
      : [{ sku: po.sku, units: po.units }];
    const etaDate = resolvePoEta(po);
    const etaMonth = etaDate ? toMonthKey(etaDate) : null;
    items.forEach(item => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const units = parseDeNumber(item?.units ?? 0);
      const qty = Number.isFinite(units) ? Math.round(units) : 0;
      if (!etaMonth) {
        missingEtaSkus.add(sku);
        return;
      }
      addEvent(sku, etaMonth, {
        type: "PO",
        id: String(po.id || po.poNo || sku),
        label: po.poNo || po.id || "PO",
        supplier: getSupplierName(state, po.supplierId || po.supplier),
        qty,
        date: etaDate ? etaDate.toISOString().slice(0, 10) : "—",
        route: "#po",
        open: po.id || po.poNo || "",
      });
    });
  });

  (state.fos || []).forEach(fo => {
    if (!fo) return;
    if (!isFoCountable(fo)) return;
    const items = Array.isArray(fo.items) && fo.items.length
      ? fo.items
      : [{ sku: fo.sku, units: fo.units }];
    const arrival = resolveFoArrival(fo);
    const arrivalMonth = arrival ? toMonthKey(arrival) : null;
    if (!arrivalMonth) return;
    items.forEach(item => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const units = parseDeNumber(item?.units ?? 0);
      const qty = Number.isFinite(units) ? Math.round(units) : 0;
      addEvent(sku, arrivalMonth, {
        type: "FO",
        id: String(fo.id || fo.foNo || sku),
        label: fo.foNo || fo.id || "FO",
        supplier: getSupplierName(state, fo.supplierId || fo.supplier),
        qty,
        date: arrival ? arrival.toISOString().slice(0, 10) : "—",
        route: "#fo",
        open: fo.id || fo.foNo || "",
      });
    });
  });

  return { inboundMap, missingEtaSkus };
}

function computeSnapshotReconciliation({ state, currentSnapshot, previousSnapshot, products, categories, currentMonth, asOfDate }) {
  const settings = state.settings || {};
  const productMap = new Map();
  products.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (sku) productMap.set(sku, product);
  });
  const categoryMap = new Map();
  (categories || []).forEach(cat => {
    if (cat?.id != null) categoryMap.set(String(cat.id), cat.name || "Ohne Kategorie");
  });
  const resolveCategory = (product) => {
    const id = product?.categoryId != null ? String(product.categoryId) : "";
    return id ? { id, name: categoryMap.get(id) || "Ohne Kategorie" } : { id: "uncategorized", name: "Ohne Kategorie" };
  };
  const ekFor = (sku) => {
    const product = productMap.get(sku);
    return getProductEkEur(product, settings);
  };

  const blankBucket = () => ({ measuredPrev: 0, measuredCurr: 0, inboundEur: 0, salesEur: 0, hasMissingEk: false });
  const buckets = new Map();
  const ensureBucket = (id, name) => {
    if (!buckets.has(id)) buckets.set(id, { id, name, ...blankBucket() });
    return buckets.get(id);
  };

  const accumulateSnapshot = (snapshot, field) => {
    if (!snapshot) return;
    (snapshot.items || []).forEach(item => {
      const sku = String(item.sku || "").trim();
      if (!sku) return;
      const product = productMap.get(sku);
      if (!product) return;
      const units = Number(item.amazonUnits || 0) + Number(item.threePLUnits || 0);
      const ek = ekFor(sku);
      const cat = resolveCategory(product);
      const bucket = ensureBucket(cat.id, cat.name);
      if (!Number.isFinite(ek)) {
        bucket.hasMissingEk = true;
        return;
      }
      bucket[field] += units * ek;
    });
  };
  accumulateSnapshot(previousSnapshot, "measuredPrev");
  accumulateSnapshot(currentSnapshot, "measuredCurr");

  const normalizedCurrentMonth = normalizeMonthKey(currentMonth);
  const { inboundMap } = buildInboundMap(state);
  inboundMap.forEach((monthMap, sku) => {
    const entry = monthMap.get(normalizedCurrentMonth);
    if (!entry) return;
    const units = (entry.poUnits || 0) + (entry.foUnits || 0);
    if (!units) return;
    const product = productMap.get(sku);
    if (!product) return;
    const ek = ekFor(sku);
    const cat = resolveCategory(product);
    const bucket = ensureBucket(cat.id, cat.name);
    if (!Number.isFinite(ek)) {
      bucket.hasMissingEk = true;
      return;
    }
    bucket.inboundEur += units * ek;
  });

  products.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (!sku) return;
    const units = getForecastUnits(state, sku, normalizedCurrentMonth);
    if (!Number.isFinite(units) || !units) return;
    const ek = ekFor(sku);
    const cat = resolveCategory(product);
    const bucket = ensureBucket(cat.id, cat.name);
    if (!Number.isFinite(ek)) {
      bucket.hasMissingEk = true;
      return;
    }
    bucket.salesEur += units * ek;
  });

  const perCategory = Array.from(buckets.values())
    .map(bucket => {
      const measuredDelta = bucket.measuredCurr - bucket.measuredPrev;
      const expectedDelta = bucket.inboundEur - bucket.salesEur;
      return {
        ...bucket,
        measuredDelta,
        expectedDelta,
        discrepancy: measuredDelta - expectedDelta,
      };
    })
    .sort((a, b) => Math.abs(b.discrepancy) - Math.abs(a.discrepancy));

  const totals = perCategory.reduce((acc, b) => {
    acc.measuredPrev += b.measuredPrev;
    acc.measuredCurr += b.measuredCurr;
    acc.measuredDelta += b.measuredDelta;
    acc.inboundEur += b.inboundEur;
    acc.salesEur += b.salesEur;
    acc.expectedDelta += b.expectedDelta;
    acc.discrepancy += b.discrepancy;
    if (b.hasMissingEk) acc.hasMissingEk = true;
    return acc;
  }, { measuredPrev: 0, measuredCurr: 0, measuredDelta: 0, inboundEur: 0, salesEur: 0, expectedDelta: 0, discrepancy: 0, hasMissingEk: false });

  return {
    currentMonth: normalizedCurrentMonth,
    previousMonth: previousSnapshot?.month || null,
    perCategory,
    totals,
    forecastIsSurrogate: true,
  };
}

function buildStalePoList(state, asOfDate) {
  const cutoff = normalizeAsOfDate(asOfDate) || new Date();
  const settings = state.settings || {};
  const productMap = new Map();
  (state.products || []).forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (sku) productMap.set(sku, product);
  });
  const stale = [];
  (state.pos || []).forEach(po => {
    if (!po || po.archived) return;
    const status = String(po.status || "").toUpperCase();
    if (status === "CANCELLED" || status === "ARRIVED" || status === "RECEIVED") return;
    const eta = resolvePoEta(po);
    if (!eta || eta > cutoff) return;
    const items = Array.isArray(po.items) && po.items.length
      ? po.items
      : [{ sku: po.sku, units: po.units }];
    let units = 0;
    let valueEur = 0;
    let hasMissingEk = false;
    items.forEach(item => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const qty = Math.round(parseDeNumber(item?.units ?? 0) || 0);
      units += qty;
      const product = productMap.get(sku);
      const ek = getProductEkEur(product, settings);
      if (!Number.isFinite(ek)) {
        hasMissingEk = true;
        return;
      }
      valueEur += qty * ek;
    });
    stale.push({
      id: po.id || po.poNo || "",
      label: po.poNo || po.id || "PO",
      supplier: getSupplierName(state, po.supplierId || po.supplier),
      etaDate: eta,
      etaLabel: formatShortDate(eta),
      ageDays: Math.max(0, Math.round((cutoff - eta) / (24 * 60 * 60 * 1000))),
      units,
      valueEur,
      hasMissingEk,
    });
  });
  stale.sort((a, b) => b.ageDays - a.ageDays);
  return stale;
}

function buildInTransitMap(state, asOfDate) {
  const map = new Map();
  const today = new Date();
  const cutoff = normalizeAsOfDate(asOfDate) || today;
  const addEntry = (sku, entry) => {
    if (!map.has(sku)) map.set(sku, { total: 0, entries: [] });
    const target = map.get(sku);
    target.total += entry.qty;
    target.entries.push(entry);
  };

  (state.pos || []).forEach(po => {
    if (!po || po.archived) return;
    if (String(po.status || "").toUpperCase() === "CANCELLED") return;
    const eta = resolvePoEta(po);
    if (eta && eta <= cutoff) return;
    const etd = resolvePoEtd(po);
    const items = Array.isArray(po.items) && po.items.length
      ? po.items
      : [{ sku: po.sku, units: po.units }];
    items.forEach(item => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const units = parseDeNumber(item?.units ?? 0);
      const qty = Number.isFinite(units) ? Math.round(units) : 0;
      if (!qty) return;
      addEntry(sku, {
        type: "PO",
        id: String(po.id || po.poNo || sku),
        label: po.poNo || po.id || "PO",
        supplier: getSupplierName(state, po.supplierId || po.supplier),
        qty,
        etd: etd ? formatShortDate(etd) : "—",
        eta: eta ? formatShortDate(eta) : "—",
        route: "#po",
        open: po.id || po.poNo || "",
      });
    });
  });

  (state.fos || []).forEach(fo => {
    if (!fo) return;
    if (!isFoCountable(fo)) return;
    const eta = resolveFoArrival(fo);
    if (eta && eta <= cutoff) return;
    const items = Array.isArray(fo.items) && fo.items.length
      ? fo.items
      : [{ sku: fo.sku, units: fo.units }];
    items.forEach(item => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const units = parseDeNumber(item?.units ?? 0);
      const qty = Number.isFinite(units) ? Math.round(units) : 0;
      if (!qty) return;
      addEntry(sku, {
        type: "FO",
        id: String(fo.id || fo.foNo || sku),
        label: fo.foNo || fo.id || "FO",
        supplier: getSupplierName(state, fo.supplierId || fo.supplier),
        qty,
        etd: "—",
        eta: eta ? formatShortDate(eta) : "—",
        route: "#fo",
        open: fo.id || fo.foNo || "",
      });
    });
  });

  return map;
}

function renderInboundTooltip({ alias, month, events }) {
  if (!events || !events.length) return "";
  const rows = events.map(event => `
    <div class="inventory-tooltip-row">
      <div>
        <strong>${escapeHtml(event.type)} ${escapeHtml(event.label)}</strong>
        <div class="muted">${escapeHtml(event.supplier || "—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${formatInt(event.qty)}</div>
        <div class="muted">${escapeHtml(event.date || "—")}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${event.route}" data-open="${escapeHtml(event.open)}">${event.type === "FO" ? "Open FO" : "Open PO"}</button>
    </div>
  `).join("");

  return `
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">Inbound arrivals in ${formatMonthLabel(month)}</div>
        <div class="inventory-tooltip-alias">${escapeHtml(alias || "—")}</div>
      </div>
      <div class="inventory-tooltip-body">${rows}</div>
    </div>
  `;
}

function renderInTransitTooltip({ alias, entries }) {
  if (!entries || !entries.length) return "";
  const rows = entries.map(entry => `
    <div class="inventory-tooltip-row">
      <div>
        <strong>${escapeHtml(entry.type)} ${escapeHtml(entry.label)}</strong>
        <div class="muted">${escapeHtml(entry.supplier || "—")}</div>
      </div>
      <div class="inventory-tooltip-meta">
        <div>${formatInt(entry.qty)}</div>
        <div class="muted">ETD ${escapeHtml(entry.etd)} · ETA ${escapeHtml(entry.eta)}</div>
      </div>
    </div>
    <div class="inventory-tooltip-actions">
      <button class="btn sm secondary inventory-link" type="button" data-route="${entry.route}" data-open="${escapeHtml(entry.open)}">Open ${entry.type}</button>
    </div>
  `).join("");

  return `
    <div class="inventory-tooltip">
      <div class="inventory-tooltip-header">
        <div class="inventory-tooltip-title">In Transit</div>
        <div class="inventory-tooltip-alias">${escapeHtml(alias || "—")}</div>
      </div>
      <div class="inventory-tooltip-body">${rows}</div>
    </div>
  `;
}

function encodeTooltip(html) {
  return encodeURIComponent(html || "");
}

const inventoryDrafts = new Map();

function getInventoryDraftKey(month, sku, field) {
  return `${month || "unknown"}:${sku}:${field}`;
}

function formatEurSigned(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const num = Number(value);
  const sign = num > 0 ? "+" : num < 0 ? "−" : "";
  return `${sign}${formatEur(Math.abs(num))}`;
}

function classifyDiscrepancy(measured, expected) {
  const measuredAbs = Math.abs(measured);
  const expectedAbs = Math.abs(expected);
  const diff = measured - expected;
  const base = Math.max(measuredAbs, expectedAbs, 1);
  const ratio = Math.abs(diff) / base;
  if (Math.abs(diff) < 100) return "ok";
  if (ratio < 0.05) return "ok";
  if (ratio < 0.20) return "warn";
  return "bad";
}

function buildReconciliationPanel({ reconciliation, stalePos, currentMonth, previousMonth }) {
  const totals = reconciliation.totals;
  const status = classifyDiscrepancy(totals.measuredDelta, totals.expectedDelta);
  const statusLabel = status === "ok" ? "Plausibel" : status === "warn" ? "Auffällig" : "Stark abweichend";
  const statusClass = `reco-status-${status}`;
  const currLabel = currentMonth ? formatMonthSlash(currentMonth) : "—";
  const prevLabel = previousMonth ? formatMonthSlash(previousMonth) : "—";
  const missingEkNote = totals.hasMissingEk ? `<span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎ EK fehlt teils</span>` : "";

  const categoryRows = reconciliation.perCategory.length
    ? reconciliation.perCategory.map(bucket => {
        const cls = classifyDiscrepancy(bucket.measuredDelta, bucket.expectedDelta);
        return `
          <tr class="reco-cat-row reco-cat-${cls}">
            <td>${escapeHtml(bucket.name)}${bucket.hasMissingEk ? " <span class=\"cell-warning\" title=\"EK fehlt\">⚠︎</span>" : ""}</td>
            <td class="num">${formatEur(bucket.measuredPrev)}</td>
            <td class="num">${formatEur(bucket.measuredCurr)}</td>
            <td class="num"><strong>${formatEurSigned(bucket.measuredDelta)}</strong></td>
            <td class="num">${formatEur(bucket.inboundEur)}</td>
            <td class="num">${formatEur(bucket.salesEur)}</td>
            <td class="num"><strong>${formatEurSigned(bucket.expectedDelta)}</strong></td>
            <td class="num"><strong>${formatEurSigned(bucket.discrepancy)}</strong></td>
          </tr>
        `;
      }).join("")
    : `<tr><td class="muted" colspan="8">Keine Kategorie-Daten verfügbar.</td></tr>`;

  const staleSection = stalePos.length
    ? `
      <div class="reco-stale">
        <div class="reco-stale-head">
          <div>
            <h4>${stalePos.length} PO${stalePos.length === 1 ? "" : "s"} mit überfälliger ETA — Verbleib klären</h4>
            <p class="muted small">ETA liegt vor dem Snapshot-Stichtag, aber Status ist noch OPEN. Mögliche Ursachen: (a) Ware bereits im Bestand verbucht, PO nicht abgeschlossen → Doppelzählung im Warenwert; (b) Ware verspätet → ETA korrigieren; (c) PO storniert / vergessen → archivieren.</p>
          </div>
          <button class="btn secondary" id="reco-archive-all">Alle archivieren (${stalePos.length})</button>
        </div>
        <table class="table-compact ui-table-standard reco-stale-table">
          <thead>
            <tr>
              <th>PO</th>
              <th>Lieferant</th>
              <th class="num">ETA</th>
              <th class="num">Alter (Tage)</th>
              <th class="num">Units</th>
              <th class="num">Warenwert €</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${stalePos.map(po => `
              <tr data-stale-po="${escapeHtml(po.id)}">
                <td>${escapeHtml(po.label)}</td>
                <td>${escapeHtml(po.supplier || "—")}</td>
                <td class="num">${escapeHtml(po.etaLabel)}</td>
                <td class="num">${formatInt(po.ageDays)}</td>
                <td class="num">${formatInt(po.units)}</td>
                <td class="num">${po.hasMissingEk ? "⚠︎ " : ""}${formatEur(po.valueEur)}</td>
                <td><button class="btn sm secondary reco-archive-one" data-po-id="${escapeHtml(po.id)}">Archivieren</button></td>
              </tr>
            `).join("")}
            <tr class="reco-stale-total">
              <td colspan="4"><strong>Summe offener Volumen</strong></td>
              <td class="num"><strong>${formatInt(stalePos.reduce((s, p) => s + p.units, 0))}</strong></td>
              <td class="num"><strong>${formatEur(stalePos.reduce((s, p) => s + (Number.isFinite(p.valueEur) ? p.valueEur : 0), 0))}</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    `
    : `<div class="reco-stale-empty muted small">✓ Keine alten POs mit überfälliger ETA. In-Transit-Wert sollte sauber sein.</div>`;

  return `
    <div class="reco-panel ${statusClass}">
      <div class="reco-head">
        <div>
          <h3>Plausi-Check ${escapeHtml(prevLabel)} → ${escapeHtml(currLabel)}</h3>
          <p class="muted small">
            Vergleicht die gemessene Bestandsveränderung (Snapshot-Δ in EUR, ohne In-Transit) gegen die erwartete (PO/FO-Eingänge − Verkaufs-Forecast).
            ${reconciliation.forecastIsSurrogate ? "Verkäufe geschätzt aus Forecast — echte Sales-Daten fehlen." : ""}
          </p>
        </div>
        <div class="reco-status-pill">${escapeHtml(statusLabel)} ${missingEkNote}</div>
      </div>
      <div class="reco-headline-grid">
        <div class="reco-kpi">
          <span class="muted small">Bestandsveränderung gemessen</span>
          <strong class="reco-kpi-value">${formatEurSigned(totals.measuredDelta)}</strong>
          <span class="muted small">${formatEur(totals.measuredPrev)} → ${formatEur(totals.measuredCurr)}</span>
        </div>
        <div class="reco-kpi">
          <span class="muted small">Erwartete Veränderung</span>
          <strong class="reco-kpi-value">${formatEurSigned(totals.expectedDelta)}</strong>
          <span class="muted small">Wareneingänge ${formatEur(totals.inboundEur)} − Verkäufe ${formatEur(totals.salesEur)}</span>
        </div>
        <div class="reco-kpi reco-kpi-diff">
          <span class="muted small">Diskrepanz (Phantom-Bestand)</span>
          <strong class="reco-kpi-value">${formatEurSigned(totals.discrepancy)}</strong>
          <span class="muted small">Δ gemessen − Δ erwartet</span>
        </div>
      </div>
      <details class="reco-breakdown" ${status === "ok" ? "" : "open"}>
        <summary>Aufschlüsselung pro Kategorie (sortiert nach Diskrepanz)</summary>
        <table class="table-compact ui-table-standard reco-category-table">
          <thead>
            <tr>
              <th>Kategorie</th>
              <th class="num">Bestand ${escapeHtml(prevLabel)} €</th>
              <th class="num">Bestand ${escapeHtml(currLabel)} €</th>
              <th class="num">Δ gemessen €</th>
              <th class="num">Wareneingänge €</th>
              <th class="num">Verkäufe (FC) €</th>
              <th class="num">Δ erwartet €</th>
              <th class="num">Diskrepanz €</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows}
            <tr class="reco-cat-total">
              <td><strong>Gesamt</strong></td>
              <td class="num"><strong>${formatEur(totals.measuredPrev)}</strong></td>
              <td class="num"><strong>${formatEur(totals.measuredCurr)}</strong></td>
              <td class="num"><strong>${formatEurSigned(totals.measuredDelta)}</strong></td>
              <td class="num"><strong>${formatEur(totals.inboundEur)}</strong></td>
              <td class="num"><strong>${formatEur(totals.salesEur)}</strong></td>
              <td class="num"><strong>${formatEurSigned(totals.expectedDelta)}</strong></td>
              <td class="num"><strong>${formatEurSigned(totals.discrepancy)}</strong></td>
            </tr>
          </tbody>
        </table>
      </details>
      ${staleSection}
    </div>
  `;
}

function buildSnapshotTable({ state, view, snapshot, previousSnapshot, products, categories, asOfDate, snapshotMonth }) {
  const filtered = filterProductsBySearch(products, view.search);
  const viewMode = view.snapshotViewMode === "eur" ? "eur" : "units";
  const isEur = viewMode === "eur";

  const groups = buildCategoryGroups(filtered, categories);
  const prevMap = new Map();
  (previousSnapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) prevMap.set(sku, item);
  });
  const inTransitMap = buildInTransitMap(state, asOfDate);

  const grandTotals = {
    amazonUnits: 0, threePLUnits: 0, totalUnits: 0, inTransit: 0, totalValue: 0,
    amazonEur: 0, threePlEur: 0, totalEur: 0, inTransitEur: 0,
    deltaUnits: 0, deltaEur: 0,
    valueComplete: true,
  };

  const formatNum = (value) => formatInt(value);
  const formatVal = (value) => Number.isFinite(value) ? formatEur(value) : "—";

  const rows = groups.map(group => {
    const collapsed = view.collapsed[group.id];
    const groupTotals = {
      amazonUnits: 0, threePLUnits: 0, totalUnits: 0, inTransit: 0, totalValue: 0,
      amazonEur: 0, threePlEur: 0, totalEur: 0, inTransitEur: 0,
      deltaUnits: 0, deltaEur: 0,
      valueComplete: true,
    };

    const items = group.items.map(product => {
      const sku = String(product.sku || "").trim();
      const item = getSnapshotItem(snapshot, sku);
      const inTransit = inTransitMap.get(sku);
      const inTransitTotal = inTransit ? inTransit.total : 0;
      const prevItem = prevMap.get(sku);
      const amazonUnits = Number(item?.amazonUnits || 0);
      const threePLUnits = Number(item?.threePLUnits || 0);
      const totalUnits = amazonUnits + threePLUnits;
      const totalUnitsWithTransit = totalUnits + inTransitTotal;
      const prevTotal = (prevItem?.amazonUnits || 0) + (prevItem?.threePLUnits || 0);
      const delta = totalUnits - prevTotal;
      const ekEur = getProductEkEur(product, state.settings || {});
      const totalValue = Number.isFinite(ekEur) ? totalUnitsWithTransit * ekEur : null;
      const amazonEur = Number.isFinite(ekEur) ? amazonUnits * ekEur : null;
      const threePlEur = Number.isFinite(ekEur) ? threePLUnits * ekEur : null;
      const totalEur = Number.isFinite(ekEur) ? totalUnits * ekEur : null;
      const inTransitEur = Number.isFinite(ekEur) ? inTransitTotal * ekEur : null;
      const deltaEur = Number.isFinite(ekEur) ? delta * ekEur : null;
      const warning = !Number.isFinite(ekEur);
      const transitTooltip = inTransit && inTransit.entries.length
        ? renderInTransitTooltip({ alias: product.alias || sku, entries: inTransit.entries })
        : "";

      // accumulate group totals
      groupTotals.amazonUnits += amazonUnits;
      groupTotals.threePLUnits += threePLUnits;
      groupTotals.totalUnits += totalUnits;
      groupTotals.inTransit += inTransitTotal;
      groupTotals.deltaUnits += delta;
      if (warning) {
        groupTotals.valueComplete = false;
      } else {
        groupTotals.totalValue += totalValue;
        groupTotals.amazonEur += amazonEur;
        groupTotals.threePlEur += threePlEur;
        groupTotals.totalEur += totalEur;
        groupTotals.inTransitEur += inTransitEur;
        groupTotals.deltaEur += deltaEur;
      }

      const amazonDraft = inventoryDrafts.get(getInventoryDraftKey(snapshotMonth, sku, "amazonUnits"));
      const threePlDraft = inventoryDrafts.get(getInventoryDraftKey(snapshotMonth, sku, "threePLUnits"));

      const amazonCell = isEur
        ? `<td class="num inventory-value" data-field="amazonEur">${formatVal(amazonEur)}</td>`
        : `<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${escapeHtml(amazonDraft ?? String(item?.amazonUnits ?? 0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`;

      const threePlCell = isEur
        ? `<td class="num inventory-value" data-field="threePlEur">${formatVal(threePlEur)}</td>`
        : `<td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${escapeHtml(threePlDraft ?? String(item?.threePLUnits ?? 0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>`;

      const totalCell = isEur
        ? `<td class="num inventory-value" data-field="totalEur">${formatVal(totalEur)}</td>`
        : `<td class="num inventory-value" data-field="totalUnits">${formatNum(totalUnits)}</td>`;

      const inTransitCell = isEur
        ? `<td class="num inventory-value inventory-in-transit" data-field="inTransitEur" data-tooltip-html="${encodeTooltip(transitTooltip)}">${formatVal(inTransitEur)}</td>`
        : `<td class="num inventory-value inventory-in-transit" data-tooltip-html="${encodeTooltip(transitTooltip)}">${formatNum(inTransitTotal)}</td>`;

      const deltaCell = isEur
        ? `<td class="num inventory-value" data-field="deltaEur">${formatVal(deltaEur)}</td>`
        : `<td class="num inventory-value" data-field="delta">${formatNum(delta)}</td>`;

      return `
        <tr class="inventory-row ${collapsed ? "is-collapsed" : ""}" data-sku="${escapeHtml(sku)}" data-category="${escapeHtml(group.id)}">
          <td class="inventory-col-sku sticky-cell">${escapeHtml(sku)}</td>
          <td class="inventory-col-alias sticky-cell">${escapeHtml(product.alias || "—")}</td>
          ${amazonCell}
          ${threePlCell}
          ${totalCell}
          ${inTransitCell}
          <td class="num">
            ${warning ? `<span class="cell-warning" title="EK fehlt im Produkt">${"⚠︎"}</span>` : ""}
            <span data-field="ekEur">${Number.isFinite(ekEur) ? formatEur(ekEur) : "—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(totalValue) ? formatEur(totalValue) : "—"}</td>
          ${deltaCell}
          <td><input class="inventory-input note" data-field="note" value="${escapeHtml(item?.note || "")}" /></td>
        </tr>
      `;
    }).join("");

    // accumulate grand totals
    grandTotals.amazonUnits += groupTotals.amazonUnits;
    grandTotals.threePLUnits += groupTotals.threePLUnits;
    grandTotals.totalUnits += groupTotals.totalUnits;
    grandTotals.inTransit += groupTotals.inTransit;
    grandTotals.deltaUnits += groupTotals.deltaUnits;
    if (!groupTotals.valueComplete) {
      grandTotals.valueComplete = false;
    } else {
      grandTotals.totalValue += groupTotals.totalValue;
      grandTotals.amazonEur += groupTotals.amazonEur;
      grandTotals.threePlEur += groupTotals.threePlEur;
      grandTotals.totalEur += groupTotals.totalEur;
      grandTotals.inTransitEur += groupTotals.inTransitEur;
      grandTotals.deltaEur += groupTotals.deltaEur;
    }

    const subtotalLabel = `Zwischensumme ${group.name}`;
    const subtotalIncomplete = !groupTotals.valueComplete ? ` <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>` : "";
    const subtotalCells = isEur
      ? `
        <td class="num">${formatVal(groupTotals.amazonEur)}</td>
        <td class="num">${formatVal(groupTotals.threePlEur)}</td>
        <td class="num">${formatVal(groupTotals.totalEur)}</td>
        <td class="num">${formatVal(groupTotals.inTransitEur)}</td>
        <td class="num"></td>
        <td class="num">${formatVal(groupTotals.totalValue)}${subtotalIncomplete}</td>
        <td class="num">${formatVal(groupTotals.deltaEur)}</td>
        <td></td>
      `
      : `
        <td class="num">${formatNum(groupTotals.amazonUnits)}</td>
        <td class="num">${formatNum(groupTotals.threePLUnits)}</td>
        <td class="num">${formatNum(groupTotals.totalUnits)}</td>
        <td class="num">${formatNum(groupTotals.inTransit)}</td>
        <td class="num"></td>
        <td class="num">${formatVal(groupTotals.totalValue)}${subtotalIncomplete}</td>
        <td class="num">${formatNum(groupTotals.deltaUnits)}</td>
        <td></td>
      `;

    return `
        <tr class="inventory-category-row" data-category-row="${escapeHtml(group.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="2">
            <button type="button" class="tree-toggle" data-category="${escapeHtml(group.id)}">${collapsed ? "▸" : "▾"}</button>
            <span class="tree-label">${escapeHtml(group.name)}</span>
            <span class="muted">(${group.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${items}
        <tr class="inventory-subtotal-row ${collapsed ? "is-collapsed" : ""}" data-category-subtotal="${escapeHtml(group.id)}">
          <td class="inventory-col-sku sticky-cell" colspan="2"><strong>${escapeHtml(subtotalLabel)}</strong></td>
          ${subtotalCells}
        </tr>
      `;
    }).join("");

  const grandIncomplete = !grandTotals.valueComplete ? ` <span class="cell-warning" title="Mindestens ein Produkt ohne EK">⚠︎</span>` : "";
  const grandCells = isEur
    ? `
      <td class="num">${formatVal(grandTotals.amazonEur)}</td>
      <td class="num">${formatVal(grandTotals.threePlEur)}</td>
      <td class="num">${formatVal(grandTotals.totalEur)}</td>
      <td class="num">${formatVal(grandTotals.inTransitEur)}</td>
      <td class="num"></td>
      <td class="num">${formatVal(grandTotals.totalValue)}${grandIncomplete}</td>
      <td class="num">${formatVal(grandTotals.deltaEur)}</td>
      <td></td>
    `
    : `
      <td class="num">${formatNum(grandTotals.amazonUnits)}</td>
      <td class="num">${formatNum(grandTotals.threePLUnits)}</td>
      <td class="num">${formatNum(grandTotals.totalUnits)}</td>
      <td class="num">${formatNum(grandTotals.inTransit)}</td>
      <td class="num"></td>
      <td class="num">${formatVal(grandTotals.totalValue)}${grandIncomplete}</td>
      <td class="num">${formatNum(grandTotals.deltaUnits)}</td>
      <td></td>
    `;
  const grandRow = groups.length ? `
    <tr class="inventory-grandtotal-row">
      <td class="inventory-col-sku sticky-cell" colspan="2"><strong>Gesamtsumme</strong></td>
      ${grandCells}
    </tr>
  ` : "";

  return `
    <table class="table-compact ui-table-standard inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="2" data-sticky-owner="manual" data-view-mode="${escapeHtml(viewMode)}">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="num">${isEur ? "Amazon €" : "Amazon Units"}</th>
          <th class="num">${isEur ? "3PL €" : "3PL Units"}</th>
          <th class="num">${isEur ? "Total €" : "Total Units"}</th>
          <th class="num">${isEur ? "In Transit €" : "In Transit"}</th>
          <th class="num">EK (EUR)</th>
          <th class="num">Warenwert €</th>
          <th class="num">${isEur ? "Delta € vs prev" : "Delta vs prev"}</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td class="muted" colspan="10">Keine Produkte gefunden.</td></tr>`}
        ${grandRow}
      </tbody>
    </table>
  `;
}

function escapeCsv(value, delimiter = ";") {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (raw.includes("\"") || raw.includes("\n") || raw.includes(delimiter)) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function formatUnitsExport(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return Math.round(Number(value)).toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function formatEurExport(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildSnapshotExportData({ state, view, snapshot, products, categories, asOfDate }) {
  const filtered = filterProductsBySearch(products, view.search);
  const groups = buildCategoryGroups(filtered, categories);
  const inTransitMap = buildInTransitMap(state, asOfDate);
  const snapshotMap = new Map();
  (snapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) snapshotMap.set(sku, item);
  });
  const rows = [];
  const missingEk = [];
  let totalAmazon = 0;
  let totalMajamo = 0;
  let totalTransit = 0;
  let totalValue = 0;
  let totalValueWarehouse = 0;

  groups.forEach(group => {
    group.items.forEach(product => {
      const sku = String(product.sku || "").trim();
      if (!sku) return;
      const alias = product.alias || "";
      const item = snapshotMap.get(sku) || { amazonUnits: 0, threePLUnits: 0 };
      const amazonUnits = Number(item?.amazonUnits || 0);
      const threePlUnits = Number(item?.threePLUnits || 0);
      const inTransit = inTransitMap.get(sku);
      const inTransitUnits = inTransit ? inTransit.total : 0;
      const ekEur = getProductEkEur(product, state.settings || {});
      const totalUnits = amazonUnits + threePlUnits + inTransitUnits;
      const warehouseUnits = amazonUnits + threePlUnits;
      const rowValue = Number.isFinite(ekEur) ? totalUnits * ekEur : null;
      const rowValueWarehouse = Number.isFinite(ekEur) ? warehouseUnits * ekEur : null;
      if (!Number.isFinite(ekEur)) {
        missingEk.push(alias ? `${sku} (${alias})` : sku);
      }
      if (Number.isFinite(amazonUnits)) totalAmazon += amazonUnits;
      if (Number.isFinite(threePlUnits)) totalMajamo += threePlUnits;
      if (Number.isFinite(inTransitUnits)) totalTransit += inTransitUnits;
      if (Number.isFinite(rowValue)) totalValue += rowValue;
      if (Number.isFinite(rowValueWarehouse)) totalValueWarehouse += rowValueWarehouse;
      rows.push({
        sku,
        alias,
        amazonUnits,
        threePlUnits,
        inTransitUnits,
        ekEur,
        rowValue,
        rowValueWarehouse,
      });
    });
  });

  return {
    rows,
    totals: {
      amazonUnits: totalAmazon,
      majamoUnits: totalMajamo,
      inTransitUnits: totalTransit,
      totalUnits: totalAmazon + totalMajamo + totalTransit,
      totalValue,
      totalValueWarehouse,
    },
    missingEk,
  };
}

function buildSnapshotCsv({ title, rows, totals, missingEk }) {
  const delimiter = ";";
  const lines = [];
  if (title) {
    lines.push(escapeCsv(title, delimiter));
    lines.push("");
  }
  const headers = [
    "SKU",
    "Alias",
    "Bestand Amazon (Stk)",
    "Bestand majamo (Stk)",
    "In Transit (Stk)",
    "EK-Preis (EUR / Stk)",
    "Warenwert ohne In-Transit (EUR)",
    "Warenwert inkl. In-Transit (EUR)",
  ];
  lines.push(headers.map(header => escapeCsv(header, delimiter)).join(delimiter));
  rows.forEach(row => {
    const line = [
      row.sku,
      row.alias,
      formatUnitsExport(row.amazonUnits),
      formatUnitsExport(row.threePlUnits),
      formatUnitsExport(row.inTransitUnits),
      formatEurExport(row.ekEur),
      formatEurExport(row.rowValueWarehouse),
      formatEurExport(row.rowValue),
    ];
    lines.push(line.map(value => escapeCsv(value, delimiter)).join(delimiter));
  });
  const totalsRow = [
    "Gesamtsumme",
    "",
    formatUnitsExport(totals.amazonUnits),
    formatUnitsExport(totals.majamoUnits),
    formatUnitsExport(totals.inTransitUnits),
    "",
    formatEurExport(totals.totalValueWarehouse),
    formatEurExport(totals.totalValue),
  ];
  lines.push(totalsRow.map(value => escapeCsv(value, delimiter)).join(delimiter));
  lines.push("");
  lines.push(escapeCsv("Hinweis: 'Warenwert ohne In-Transit' = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden, sofern In-Transit-Eigentum erst beim Eintreffen übergeht.", delimiter));
  if (missingEk.length) {
    lines.push("");
    lines.push(escapeCsv(`Fehlender EK-Preis für: ${missingEk.join(", ")}`, delimiter));
  }
  return lines.join("\n");
}

function buildSnapshotPrintHtml({ title, fileName, rows, totals, missingEk, generatedAt }) {
  const tableRows = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.alias || "")}</td>
        <td class="num">${formatUnitsExport(row.amazonUnits)}</td>
        <td class="num">${formatUnitsExport(row.threePlUnits)}</td>
        <td class="num">${formatUnitsExport(row.inTransitUnits)}</td>
        <td class="num">${formatEurExport(row.ekEur)}</td>
        <td class="num">${formatEurExport(row.rowValueWarehouse)}</td>
        <td class="num">${formatEurExport(row.rowValue)}</td>
      </tr>
  `).join("");
  const totalRow = `
      <tr class="totals">
        <td>Gesamtsumme</td>
        <td></td>
        <td class="num">${formatUnitsExport(totals.amazonUnits)}</td>
        <td class="num">${formatUnitsExport(totals.majamoUnits)}</td>
        <td class="num">${formatUnitsExport(totals.inTransitUnits)}</td>
        <td class="num"></td>
        <td class="num">${formatEurExport(totals.totalValueWarehouse)}</td>
        <td class="num">${formatEurExport(totals.totalValue)}</td>
      </tr>
  `;
  const warning = missingEk.length
    ? `<div class="warning">Fehlender EK-Preis für: ${escapeHtml(missingEk.join(", "))}</div>`
    : "";
  return `
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(fileName || title)}</title>
        <style>
          body { font-family: "Inter", system-ui, sans-serif; margin: 32px; color: #0f172a; }
          h1 { font-size: 20px; margin: 0 0 6px; }
          .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border-bottom: 1px solid #e2e8f0; padding: 8px; text-align: left; }
          th { background: #f8fafc; font-weight: 600; color: #475569; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .totals td { font-weight: 700; background: #f1f5f9; }
          .hint { margin-top: 12px; font-size: 11px; color: #475569; }
          .warning { margin-top: 12px; font-size: 12px; color: #b45309; }
          @media print {
            body { margin: 16px; }
            .actions { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="actions">
          <button onclick="window.print()">Drucken / Als PDF speichern</button>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Erstellt am: ${escapeHtml(generatedAt)}</div>
        <table data-ui-table="true">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Alias</th>
              <th class="num">Bestand Amazon (Stk)</th>
              <th class="num">Bestand majamo (Stk)</th>
              <th class="num">In Transit (Stk)</th>
              <th class="num">EK-Preis (EUR / Stk)</th>
              <th class="num">Warenwert ohne In-Transit (EUR)</th>
              <th class="num">Warenwert inkl. In-Transit (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            ${totalRow}
          </tbody>
        </table>
        <p class="hint">Hinweis: "Warenwert ohne In-Transit" = nur physisch im Lager (Amazon + majamo). Für BWA-Bestandsbewertung typischerweise diese Spalte verwenden.</p>
        ${warning}
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 250);
          });
        </script>
      </body>
    </html>
  `;
}

function buildProjectionTable({
  state,
  view,
  snapshot,
  products,
  categories,
  months,
  projectionData = null,
  inboundData = null,
}) {
  const filtered = filterProductsBySearch(products, view.search);
  const groups = buildCategoryGroups(filtered, categories);
  const forecastBySku = new Map();
  const projection = projectionData || computeInventoryProjection({
    state,
    months,
    products: filtered,
    snapshot,
    projectionMode: view.projectionMode,
  });
  const monthKeys = projection.months;
  filtered.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (!sku) return;
    const monthMap = new Map();
    monthKeys.forEach(monthKey => {
      const data = projection.perSkuMonth.get(sku)?.get(monthKey);
      if (Number.isFinite(data?.forecastUnits)) monthMap.set(monthKey, data.forecastUnits);
    });
    forecastBySku.set(sku, monthMap);
  });
  const forecastTotalsByGroup = view.projectionMode === "plan"
    ? buildForecastGroupTotals(groups, forecastBySku, months)
    : new Map();
  const snapshotMap = new Map();
  (snapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) snapshotMap.set(sku, item);
  });
  const { inboundMap, missingEtaSkus } = inboundData || buildInboundMap(state);
  const abcBySku = computeAbcClassification(state).bySku;

  const rows = groups.map(group => {
    const collapsed = view.collapsed[group.id];
    const items = group.items.map(product => {
      const sku = String(product.sku || "").trim();
      const alias = product.alias || "—";
      const abcClass = abcBySku?.get(sku.toLowerCase())?.abcClass || "—";
      const safetyDaysValue = resolveSafetyStockDays(product, state);
      const coverageDaysValue = resolveCoverageDays(product, state);
      const safetyDaysLabel = Number.isFinite(safetyDaysValue) ? formatInt(safetyDaysValue) : "—";
      const coverageDaysLabel = Number.isFinite(coverageDaysValue) ? formatInt(coverageDaysValue) : "—";
      const drilldownButton = `
        <button class="inventory-drilldown-trigger" type="button" data-action="open-drilldown" data-sku="${escapeHtml(sku)}" data-alias="${escapeHtml(alias)}" title="SKU Verlauf öffnen" aria-label="SKU Verlauf öffnen">
          <span aria-hidden="true">&#128200;</span>
        </button>
      `;
      let inboundDetailIndex = 0;
      const cells = months.map(month => {
        const skuInbound = inboundMap.get(sku);
        const inboundEntry = skuInbound ? skuInbound.get(month) : null;
        const inboundUnits = inboundEntry ? inboundEntry.poUnits + inboundEntry.foUnits : 0;
        const data = projection.perSkuMonth.get(sku)?.get(month);
        const forecastUnits = data?.forecastUnits ?? null;
        const endAvailable = data?.endAvailable ?? null;
        const forecastMissing = data?.forecastMissing ?? true;
        const safetyUnits = Number.isFinite(data?.safetyUnits) ? data.safetyUnits : null;
        const safetyDays = Number.isFinite(data?.safetyDays) ? data.safetyDays : null;
        const daysToOos = Number.isFinite(data?.daysToOos) ? data.daysToOos : null;
        const inboundClasses = inboundEntry?.hasPo && inboundEntry?.hasFo
          ? "inventory-cell inbound-both"
          : inboundEntry?.hasPo
            ? "inventory-cell inbound-po"
            : inboundEntry?.hasFo
              ? "inventory-cell inbound-fo"
              : "inventory-cell";
        const dohValue = data?.doh ?? null;
        const showDoh = view.projectionMode === "doh";
        const showPlan = view.projectionMode === "plan";
        const safetyNegative = showDoh
          ? (Number.isFinite(dohValue) && dohValue <= 0)
          : (Number.isFinite(endAvailable) && endAvailable <= 0);
        const displayValue = showPlan
          ? (Number.isFinite(forecastUnits) ? formatInt(forecastUnits) : "—")
          : forecastMissing
            ? "—"
            : safetyNegative
            ? `0 <span class="inventory-warning-icon">⚠︎</span>`
            : showDoh
              ? (dohValue == null ? "—" : formatInt(dohValue))
              : formatInt(endAvailable);
        const safetyClassFinal = showPlan
          ? ""
          : getProjectionSafetyClass({
            endAvailable,
            safetyUnits,
            doh: dohValue,
            safetyDays,
            daysToOos,
            projectionMode: view.projectionMode,
          });
        const incompleteClass = showPlan ? "" : (forecastMissing ? "incomplete" : "");
        const inboundMarkers = inboundEntry
          ? `
            ${inboundEntry.hasPo ? `<span class="inventory-inbound-marker po"></span>` : ""}
            ${inboundEntry.hasFo ? `<span class="inventory-inbound-marker fo"></span>` : ""}
          `
          : "";
        const tooltip = inboundEntry
          ? renderInboundTooltip({ alias, month, events: inboundEntry.events })
          : "";
        const tooltipHtml = tooltip ? tooltip.replace(/\s+/g, " ").trim() : "";
        const tooltipId = tooltip ? `inventory-inbound-${sku}-${month}-${inboundDetailIndex++}` : "";
        return `
          <td class="num ${inboundClasses} ${safetyClassFinal} ${incompleteClass} inventory-projection-cell" data-month="${escapeHtml(month)}" ${tooltip ? `data-tooltip-html="${encodeTooltip(tooltipHtml)}"` : ""} ${tooltipId ? `data-tooltip-id="${tooltipId}"` : ""}>
            <span class="inventory-cell-value">${displayValue}</span>
            ${inboundMarkers}
          </td>
        `;
      }).join("");

      const missingEta = missingEtaSkus.has(sku)
        ? `<span class="cell-warning" title="PO ohne ETA wird nicht gezählt">⚠︎</span>`
        : "";

      return `
        <tr class="inventory-row ${collapsed ? "is-collapsed" : ""}" data-sku="${escapeHtml(sku)}" data-category="${escapeHtml(group.id)}">
          <td class="inventory-col-sku sticky-cell">${missingEta}${escapeHtml(sku)}</td>
          <td class="inventory-col-alias sticky-cell">
            <div class="inventory-alias-cell">
              <span class="inventory-alias-text">${escapeHtml(alias)}</span>
              ${drilldownButton}
            </div>
          </td>
          <td class="inventory-col-abc sticky-cell">${escapeHtml(abcClass)}</td>
          <td class="inventory-col-safety-days sticky-cell num">${escapeHtml(safetyDaysLabel)}</td>
          <td class="inventory-col-coverage-days sticky-cell num">${escapeHtml(coverageDaysLabel)}</td>
          ${cells}
        </tr>
      `;
    }).join("");

    const groupMonthCells = view.projectionMode === "plan"
      ? months.map(month => {
        const monthKey = normalizeMonthKey(month);
        const sum = forecastTotalsByGroup.get(group.id)?.get(monthKey);
        const value = Number.isFinite(sum) ? formatInt(sum) : "—";
        return `<td class="num inventory-projection-group-cell">${value}</td>`;
      }).join("")
      : `<th colspan="${months.length}"></th>`;

    return `
      <tr class="inventory-category-row" data-category-row="${escapeHtml(group.id)}">
        <th class="inventory-col-sku sticky-cell" colspan="5">
          <button type="button" class="tree-toggle" data-category="${escapeHtml(group.id)}">${collapsed ? "▸" : "▾"}</button>
          <span class="tree-label">${escapeHtml(group.name)}</span>
          <span class="muted">(${group.items.length})</span>
        </th>
        ${groupMonthCells}
      </tr>
      ${items}
    `;
  }).join("");

  const monthHeaders = months.map(month => `<th class="num">${formatMonthLabel(month)}</th>`).join("");

  return `
    <table class="table-compact ui-table-standard inventory-table inventory-projection-table" data-ui-table="true" data-sticky-cols="5" data-sticky-owner="manual">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-abc sticky-header">ABC</th>
          <th class="inventory-col-safety-days sticky-header" data-ui-tooltip="Sicherheitsbestand in Days on Hand">Safety DOH</th>
          <th class="inventory-col-coverage-days sticky-header" data-ui-tooltip="Bestellreichweite in Days on Hand">Coverage DOH</th>
          ${monthHeaders}
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td class="muted" colspan="${months.length + 5}">Keine Produkte gefunden.</td></tr>`}
      </tbody>
    </table>
  `;
}

function updateSnapshotRow(row, snapshot, previousSnapshot, product, state) {
  if (!row || !snapshot || !product) return;
  const sku = String(product.sku || "").trim();
  const item = getSnapshotItem(snapshot, sku);
  const prevItem = previousSnapshot?.items?.find(entry => String(entry.sku || "").trim() === sku);
  const totalUnits = Number(item.amazonUnits || 0) + Number(item.threePLUnits || 0);
  const prevTotal = (prevItem?.amazonUnits || 0) + (prevItem?.threePLUnits || 0);
  const delta = totalUnits - prevTotal;
  const inTransitCell = row.querySelector(".inventory-in-transit");
  const inTransitUnits = parseDeNumber(inTransitCell?.textContent || 0);
  const totalUnitsWithTransit = totalUnits + (Number.isFinite(inTransitUnits) ? inTransitUnits : 0);
  const ekEur = getProductEkEur(product, state.settings || {});
  const totalValue = Number.isFinite(ekEur) ? totalUnitsWithTransit * ekEur : null;
  const totalCell = row.querySelector('[data-field="totalUnits"]');
  const deltaCell = row.querySelector('[data-field="delta"]');
  const valueCell = row.querySelector('[data-field="totalValue"]');
  if (totalCell) totalCell.textContent = formatInt(totalUnits);
  if (deltaCell) deltaCell.textContent = formatInt(delta);
  if (valueCell) valueCell.textContent = Number.isFinite(totalValue) ? formatEur(totalValue) : "—";
}

// Manual validation checklist:
// - Snapshot erstellen, Tab wechseln, zurückkehren => Werte bleiben erhalten.
// - "Copy from previous month" übernimmt Daten oder setzt 0.
// - Projektion startet mit Snapshot-Bestand.
// - Inbound-Highlight für PO-ETA sichtbar.
// - Tooltip zeigt Alias, Menge, PO/FO & Supplier.
// - "Open PO/FO" öffnet richtigen Datensatz.
// - Fehlender Forecast zeigt "—".
// - Safety-Indikator bei Unterschreitung sichtbar.

export function render(root) {
  const state = loadAppState();
  const view = loadViewState();
  const routeQuery = window.__routeQuery || {};
  const routeSku = String(routeQuery.sku || "").trim();
  const routeMonth = String(routeQuery.month || "").trim();
  if (routeSku) {
    view.search = "";
    view.projectionMode = "doh";
  }
  if (/^\d{4}-\d{2}$/.test(routeMonth)) {
    view.selectedMonth = addMonths(routeMonth, -1);
  }
  const selectedMonth = resolveSelectedMonth(state, view);
  view.selectedMonth = selectedMonth;
  saveViewState(view);
  if (root._inventoryCleanup) {
    root._inventoryCleanup();
    root._inventoryCleanup = null;
  }

  const snapshot = getSnapshot(state, selectedMonth) || { month: selectedMonth, items: [] };
  const previousSnapshot = getPreviousSnapshot(state, selectedMonth);
  const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
  const products = (state.products || []).filter(isProductActive);
  const storedAsOfDate = parseDateInput(view.snapshotAsOfDate);
  const monthKeyForStored = storedAsOfDate ? toMonthKey(storedAsOfDate) : null;
  let asOfDate = storedAsOfDate && monthKeyForStored === selectedMonth
    ? storedAsOfDate
    : endOfMonthDate(selectedMonth);
  if (!asOfDate) {
    asOfDate = new Date();
  }
  if (!storedAsOfDate || monthKeyForStored !== selectedMonth) {
    view.snapshotAsOfDate = formatDateInput(asOfDate);
    saveViewState(view);
  }
  const normalizedAsOfDate = normalizeAsOfDate(asOfDate);
  if (routeSku) {
    const matched = products.find(product => String(product?.sku || "").trim() === routeSku);
    if (matched?.categoryId != null) {
      view.collapsed[String(matched.categoryId)] = false;
      saveViewState(view);
    }
  }
  const projectionMonths = Number(state.inventory?.settings?.projectionMonths || 12);
  const projectionOptions = [6, 12, 18];
  const months = buildMonthRange(selectedMonth, projectionOptions.includes(projectionMonths) ? projectionMonths : 12);
  const filteredProjectionProducts = filterProductsBySearch(products, view.search);
  const projectionData = computeInventoryProjection({
    state,
    months,
    products: filteredProjectionProducts,
    snapshot,
    projectionMode: view.projectionMode,
  });
  const inboundData = buildInboundMap(state);

  const isPlanView = view.projectionMode === "plan";
  const exportData = buildSnapshotExportData({
    state,
    view,
    snapshot,
    products,
    categories,
    asOfDate: normalizedAsOfDate,
  });
  const missingEkCount = exportData.missingEk.length;

  const reconciliation = computeSnapshotReconciliation({
    state,
    currentSnapshot: snapshot,
    previousSnapshot,
    products,
    categories,
    currentMonth: selectedMonth,
    asOfDate: normalizedAsOfDate,
  });
  const stalePos = buildStalePoList(state, normalizedAsOfDate);
  const reconciliationHtml = previousSnapshot
    ? buildReconciliationPanel({
        reconciliation,
        stalePos,
        currentMonth: selectedMonth,
        previousMonth: previousSnapshot.month,
      })
    : `<div class="reco-panel reco-status-empty"><div class="muted small">Plausi-Check verfügbar sobald ein Vormonats-Snapshot existiert.</div></div>`;

  root.innerHTML = `
    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${escapeHtml(view.search)}" />
        </div>
      </div>
      <div class="inventory-toolbar ui-toolbar-row">
        <label class="inventory-field">
          <span class="muted">Snapshot Monat</span>
          <select id="inventory-month"></select>
        </label>
        <button class="btn secondary" id="inventory-copy">Copy from previous month</button>
        <button class="btn secondary" id="inventory-expand-all">Alles auf</button>
        <button class="btn secondary" id="inventory-collapse-all">Alles zu</button>
        <div class="inventory-toggle-group">
          <span class="muted">Anzeige</span>
          <div class="segment-control">
            <input type="radio" id="snapshot-mode-units" name="snapshot-view-mode" value="units" ${view.snapshotViewMode === "units" ? "checked" : ""} />
            <label for="snapshot-mode-units">Einheiten</label>
            <input type="radio" id="snapshot-mode-eur" name="snapshot-view-mode" value="eur" ${view.snapshotViewMode === "eur" ? "checked" : ""} />
            <label for="snapshot-mode-eur">EUR</label>
          </div>
        </div>
        <span class="muted small">${previousSnapshot ? `Vorheriger Snapshot: ${formatMonthLabel(previousSnapshot.month)}` : "Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-export">
        <div class="inventory-export-controls">
          <label class="inventory-field">
            <span class="muted">Bestandsaufnahme zum</span>
            <input type="date" id="inventory-export-date" value="${escapeHtml(formatDateInput(asOfDate))}" />
          </label>
          <button class="btn secondary" id="inventory-export-csv">Export CSV</button>
          <button class="btn secondary" id="inventory-export-pdf">Export PDF</button>
        </div>
        <div class="inventory-export-meta">
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert (mit + ohne In-Transit)</span>
          ${missingEkCount ? `<span class="inventory-export-warning">⚠︎ EK fehlt (${missingEkCount})</span>` : ""}
        </div>
      </div>
      ${reconciliationHtml}
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${buildSnapshotTable({
            state,
            view,
            snapshot,
            previousSnapshot,
            products,
            categories,
            asOfDate: normalizedAsOfDate,
            snapshotMonth: selectedMonth,
          })}
        </div>
      </div>
    </section>

    <section class="card inventory-card">
      <div class="inventory-header ui-page-head">
        <div>
          <h3>Projection (next ${projectionOptions.includes(projectionMonths) ? projectionMonths : 12} months)</h3>
          <p class="muted">End-of-Month verfügbares Lager in DE (Amazon + 3PL).</p>
        </div>
        <div class="inventory-controls">
          <label class="inventory-field">
            <span class="muted">Horizon</span>
            <select id="inventory-horizon">
              ${projectionOptions.map(option => `<option value="${option}" ${option === projectionMonths ? "selected" : ""}>${option} Monate</option>`).join("")}
            </select>
          </label>
          <div class="inventory-toggle-group">
            <span class="muted">Anzeige</span>
            <div class="segment-control">
              <input type="radio" id="inventory-mode-units" name="inventory-mode" value="units" ${view.projectionMode === "units" ? "checked" : ""} />
              <label for="inventory-mode-units">Units</label>
              <input type="radio" id="inventory-mode-doh" name="inventory-mode" value="doh" ${view.projectionMode === "doh" ? "checked" : ""} />
              <label for="inventory-mode-doh">Days on hand</label>
              <input type="radio" id="inventory-mode-plan" name="inventory-mode" value="plan" ${view.projectionMode === "plan" ? "checked" : ""} />
              <label for="inventory-mode-plan">Plan-Absatz</label>
            </div>
          </div>
          <label class="inventory-toggle">
            <input type="checkbox" id="inventory-safety" ${view.showSafety ? "checked" : ""} />
            <span>Show safety threshold</span>
          </label>
        </div>
      </div>
      <div class="inventory-table-wrap ui-table-shell">
        <div class="inventory-table-scroll ui-scroll-host">
          ${buildProjectionTable({
            state,
            view,
            snapshot,
            products,
            categories,
            months,
            projectionData,
            inboundData,
          })}
        </div>
      </div>
      <div class="inventory-legend">
        ${isPlanView ? "" : `
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (OOS &lt; Safety-Tage)</span>
        `}
        <span class="inventory-legend-item"><span class="legend-swatch inbound-po"></span> Inbound PO</span>
        <span class="inventory-legend-item"><span class="legend-swatch inbound-fo"></span> Inbound FO</span>
      </div>
    </section>
    <div id="inventory-tooltip-layer" class="inventory-tooltip-layer" hidden></div>
  `;

  const monthSelect = root.querySelector("#inventory-month");
  if (monthSelect) {
    const snapshotMonths = (state.inventory?.snapshots || [])
      .map(snap => snap?.month)
      .filter(month => /^\d{4}-\d{2}$/.test(month));
    const monthSet = new Set([...snapshotMonths, currentMonthKey(), selectedMonth]);
    const options = Array.from(monthSet).sort();
    monthSelect.innerHTML = options.map(month => `<option value="${month}" ${month === selectedMonth ? "selected" : ""}>${formatMonthLabel(month)}</option>`).join("");
    monthSelect.addEventListener("change", (event) => {
      view.selectedMonth = event.target.value;
      saveViewState(view);
      render(root);
    });
  }

  const exportDateInput = root.querySelector("#inventory-export-date");
  if (exportDateInput) {
    exportDateInput.addEventListener("change", (event) => {
      view.snapshotAsOfDate = event.target.value;
      saveViewState(view);
      render(root);
    });
  }

  const exportCsvBtn = root.querySelector("#inventory-export-csv");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (!exportData.rows.length) {
        window.alert("Keine Daten für den Export vorhanden.");
        return;
      }
      const title = formatExportTitle(asOfDate);
      const csv = buildSnapshotCsv({
        title,
        rows: exportData.rows,
        totals: exportData.totals,
        missingEk: exportData.missingEk,
      });
      const fileName = `bestandsaufnahme_${formatDateInput(asOfDate)}.csv`;
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }

  const exportPdfBtn = root.querySelector("#inventory-export-pdf");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      if (!exportData.rows.length) {
        window.alert("Keine Daten für den Export vorhanden.");
        return;
      }
      const title = formatExportTitle(asOfDate);
      const generatedAt = formatDateTime(new Date());
      const fileName = `bestandsaufnahme_${formatDateInput(asOfDate)}.pdf`;
      const html = buildSnapshotPrintHtml({
        title,
        fileName,
        rows: exportData.rows,
        totals: exportData.totals,
        missingEk: exportData.missingEk,
        generatedAt,
      });
      const printWindow = window.open("", "_blank", "noopener,noreferrer");
      if (!printWindow) return;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
    });
  }

  const searchInput = root.querySelector(".inventory-search input");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      view.search = event.target.value || "";
      saveViewState(view);
      render(root);
    });
  }

  const copyBtn = root.querySelector("#inventory-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const targetSnapshot = ensureSnapshot(state, selectedMonth);
      const prevSnapshot = getPreviousSnapshot(state, selectedMonth);
      targetSnapshot.items = (products || []).map(product => {
        const sku = String(product.sku || "").trim();
        const prevItem = prevSnapshot?.items?.find(entry => String(entry.sku || "").trim() === sku);
        return {
          sku,
          amazonUnits: prevItem?.amazonUnits ?? 0,
          threePLUnits: prevItem?.threePLUnits ?? 0,
          note: prevItem?.note ?? "",
        };
      });
      commitAppState(state);
      render(root);
    });
  }

  const expandAllBtn = root.querySelector("#inventory-expand-all");
  if (expandAllBtn) {
    expandAllBtn.addEventListener("click", () => {
      setAllCategoriesCollapsed({ products, categories, view, collapsed: false });
      render(root);
    });
  }

  const collapseAllBtn = root.querySelector("#inventory-collapse-all");
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener("click", () => {
      setAllCategoriesCollapsed({ products, categories, view, collapsed: true });
      render(root);
    });
  }

  root.querySelectorAll("input[name='snapshot-view-mode']").forEach(input => {
    input.addEventListener("change", (event) => {
      const next = event.target.value === "eur" ? "eur" : "units";
      if (view.snapshotViewMode === next) return;
      view.snapshotViewMode = next;
      saveViewState(view);
      render(root);
    });
  });

  const archivePoIds = (ids) => {
    if (!ids.length) return;
    const idSet = new Set(ids.map(String));
    let touched = 0;
    (state.pos || []).forEach(po => {
      const id = String(po?.id || po?.poNo || "");
      if (id && idSet.has(id) && !po.archived) {
        po.archived = true;
        touched += 1;
      }
    });
    if (touched) {
      commitAppState(state);
      render(root);
    }
  };

  const archiveAllBtn = root.querySelector("#reco-archive-all");
  if (archiveAllBtn) {
    archiveAllBtn.addEventListener("click", () => {
      const ids = stalePos.map(po => po.id).filter(Boolean);
      if (!ids.length) return;
      if (!window.confirm(`${ids.length} alte PO${ids.length === 1 ? "" : "s"} archivieren? Sie zählen danach nicht mehr als In-Transit.`)) return;
      archivePoIds(ids);
    });
  }

  root.querySelectorAll(".reco-archive-one").forEach(btn => {
    btn.addEventListener("click", (event) => {
      const id = event.currentTarget.getAttribute("data-po-id");
      if (!id) return;
      archivePoIds([id]);
    });
  });

  const snapshotTable = root.querySelector(".inventory-snapshot-table");
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const targetSnapshot = ensureSnapshot(state, selectedMonth);
      if (targetSnapshot !== snapshot) {
        targetSnapshot.items = snapshot.items;
      }
      commitAppState(state);
    }, 250);
  };

  if (snapshotTable) {
    const resolveInputContext = (input) => {
      const row = input.closest("tr[data-sku]");
      if (!row) return null;
      const sku = row.getAttribute("data-sku");
      const product = products.find(prod => String(prod.sku || "").trim() === sku);
      if (!product) return null;
      const item = getSnapshotItem(snapshot, sku);
      const field = input.dataset.field;
      return { row, sku, product, item, field };
    };

    const commitNumberInput = (input) => {
      const context = resolveInputContext(input);
      if (!context) return;
      const { row, sku, product, item, field } = context;
      if (field !== "amazonUnits" && field !== "threePLUnits") return;
      const draftKey = getInventoryDraftKey(selectedMonth, sku, field);
      const rawValue = inventoryDrafts.get(draftKey) ?? input.value;
      const { value, isRounded } = parseIntegerInput(rawValue);
      inventoryDrafts.delete(draftKey);
      input.value = String(value);
      input.closest("td")?.classList.toggle("inventory-input-warn", isRounded);
      if (field === "amazonUnits") item.amazonUnits = value;
      if (field === "threePLUnits") item.threePLUnits = value;
      updateSnapshotRow(row, snapshot, previousSnapshot, product, state);
      scheduleSave();
    };

    snapshotTable.addEventListener("click", (event) => {
      const toggle = event.target.closest("button.tree-toggle[data-category]");
      if (!toggle) return;
      const categoryId = toggle.getAttribute("data-category");
      view.collapsed[categoryId] = !view.collapsed[categoryId];
      saveViewState(view);
      render(root);
    });

    snapshotTable.addEventListener("input", (event) => {
      const input = event.target.closest("input.inventory-input");
      if (!input) return;
      const context = resolveInputContext(input);
      if (!context) return;
      const { sku, item, field } = context;
      if (field === "note") {
        item.note = input.value;
        scheduleSave();
        return;
      }
      if (field === "amazonUnits" || field === "threePLUnits") {
        const draftKey = getInventoryDraftKey(selectedMonth, sku, field);
        inventoryDrafts.set(draftKey, input.value);
        input.closest("td")?.classList.remove("inventory-input-warn");
      }
    });

    snapshotTable.addEventListener("blur", (event) => {
      const input = event.target.closest("input.inventory-input");
      if (!input) return;
      const context = resolveInputContext(input);
      if (!context) return;
      if (context.field === "note") return;
      commitNumberInput(input);
    }, true);

    snapshotTable.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const input = event.target.closest("input.inventory-input");
      if (!input) return;
      const context = resolveInputContext(input);
      if (!context || context.field === "note") return;
      event.preventDefault();
      commitNumberInput(input);
    });
  }

  const projectionTable = root.querySelector(".inventory-projection-table");
  if (projectionTable) {
    projectionTable.addEventListener("click", (event) => {
      const toggle = event.target.closest("button.tree-toggle[data-category]");
      if (!toggle) return;
      const categoryId = toggle.getAttribute("data-category");
      view.collapsed[categoryId] = !view.collapsed[categoryId];
      saveViewState(view);
      render(root);
    });
    projectionTable.addEventListener("click", (event) => {
      const drilldownTrigger = event.target.closest("button.inventory-drilldown-trigger[data-action='open-drilldown']");
      if (drilldownTrigger) {
        const sku = String(drilldownTrigger.getAttribute("data-sku") || "").trim();
        const alias = String(drilldownTrigger.getAttribute("data-alias") || sku).trim();
        if (!sku) return;
        event.preventDefault();
        event.stopPropagation();
        openInventoryDrilldown({ sku, alias });
        return;
      }
      const toggle = event.target.closest("button.tree-toggle[data-category]");
      if (toggle) return;
      const cell = event.target.closest("td.inventory-projection-cell");
      if (!cell) return;
      const row = cell.closest("tr[data-sku]");
      if (!row) return;
      const sku = row.getAttribute("data-sku");
      const month = cell.getAttribute("data-month");
      if (!sku || !month) return;
      event.stopPropagation();
      openProjectionPopover(cell, { sku, month });
    });
  }

  const tooltipLayer = root.querySelector("#inventory-tooltip-layer");
  let activeTooltipTarget = null;
  let projectionPopover = null;
  let projectionPopoverCell = null;
  let drilldownOverlay = null;
  let drilldownMode = "units";
  let drilldownHideTimer = null;

  function positionTooltip(event) {
    if (!tooltipLayer || tooltipLayer.hidden) return;
    const offset = 12;
    const maxX = window.innerWidth - tooltipLayer.offsetWidth - 8;
    const maxY = window.innerHeight - tooltipLayer.offsetHeight - 8;
    const x = Math.min(event.clientX + offset, maxX);
    const y = Math.min(event.clientY + offset, maxY);
    tooltipLayer.style.left = `${Math.max(8, x)}px`;
    tooltipLayer.style.top = `${Math.max(8, y)}px`;
  }

  function showTooltip(target, html, event) {
    if (!tooltipLayer || !html) return;
    let decoded = html;
    try {
      decoded = decodeURIComponent(html);
    } catch {
      decoded = html;
    }
    tooltipLayer.innerHTML = decoded;
    tooltipLayer.hidden = false;
    tooltipLayer.classList.add("is-visible");
    activeTooltipTarget = target;
    positionTooltip(event);
  }

  function hideTooltip() {
    if (!tooltipLayer) return;
    tooltipLayer.hidden = true;
    tooltipLayer.classList.remove("is-visible");
    tooltipLayer.innerHTML = "";
    activeTooltipTarget = null;
  }

  function closeProjectionPopover() {
    if (projectionPopover) {
      projectionPopover.remove();
    }
    projectionPopover = null;
    projectionPopoverCell = null;
  }

  function positionProjectionPopover(anchor) {
    if (!projectionPopover || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const padding = 8;
    const maxX = window.innerWidth - projectionPopover.offsetWidth - padding;
    const maxY = window.innerHeight - projectionPopover.offsetHeight - padding;
    const x = Math.min(rect.left, maxX);
    const y = Math.min(rect.bottom + 6, maxY);
    projectionPopover.style.left = `${Math.max(padding, x)}px`;
    projectionPopover.style.top = `${Math.max(padding, y)}px`;
  }

  function openProjectionPopover(cell, { sku, month }) {
    if (!cell || !sku || !month) return;
    if (projectionPopoverCell === cell && projectionPopover) {
      closeProjectionPopover();
      return;
    }
    closeProjectionPopover();
    const anchorSetting = state.settings?.monthAnchorDay || "START";
    const anchorDate = resolveAnchorDate(month, anchorSetting);
    const anchorIso = formatAnchorLabel(anchorDate);
    const anchorLabel = formatShortDate(anchorDate);
    const monthLabel = formatMonthSlash(month);
    const planUnits = getForecastUnits(state, sku, month);
    const planRow = Number.isFinite(planUnits)
      ? `<div class="inventory-cell-popover-meta">Plan-Absatz in diesem Monat: ${formatInt(planUnits)}</div>`
      : "";
    const menu = document.createElement("div");
    menu.className = "inventory-cell-popover";
    menu.innerHTML = `
      <div class="inventory-cell-popover-title">Aktion für ${escapeHtml(sku)}</div>
      ${planRow}
      <button class="inventory-cell-popover-action" type="button" data-action="fo">
        FO erstellen – Ankunft in ${escapeHtml(monthLabel)} <span class="muted">(Anker: ${escapeHtml(anchorLabel)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po">
        PO erstellen – Bestellung in ${escapeHtml(monthLabel)} <span class="muted">(Anker: ${escapeHtml(anchorLabel)})</span>
      </button>
      <button class="inventory-cell-popover-action" type="button" data-action="po-arrival">
        PO rückwärts – Ankunft in ${escapeHtml(monthLabel)} <span class="muted">(Anker: ${escapeHtml(anchorLabel)})</span>
      </button>
    `;
    menu.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const params = new URLSearchParams();
      params.set("create", "1");
      params.set("sku", sku);
      params.set("anchorMonth", month);
      params.set("anchorDate", anchorIso);
      if (action === "fo") {
        params.set("target", anchorIso);
        location.hash = `#fo?${params.toString()}`;
      } else if (action === "po") {
        params.set("orderDate", anchorIso);
        params.set("anchorMode", "order");
        location.hash = `#po?${params.toString()}`;
      } else if (action === "po-arrival") {
        params.set("anchorMode", "arrival");
        location.hash = `#po?${params.toString()}`;
      }
      closeProjectionPopover();
    });
    document.body.appendChild(menu);
    projectionPopover = menu;
    projectionPopoverCell = cell;
    positionProjectionPopover(cell);
  }

  function closeInventoryDrilldown() {
    if (drilldownHideTimer) {
      clearTimeout(drilldownHideTimer);
      drilldownHideTimer = null;
    }
    if (!drilldownOverlay) return;
    drilldownOverlay.remove();
    drilldownOverlay = null;
    drilldownMode = "units";
  }

  function buildDrilldownRows(sku) {
    const skuProjection = projectionData.perSkuMonth.get(sku) || new Map();
    const skuInbound = inboundData.inboundMap.get(sku) || new Map();
    return months.map(month => {
      const data = skuProjection.get(month) || null;
      const inboundEntry = skuInbound.get(month) || null;
      return {
        month,
        endAvailable: Number.isFinite(data?.endAvailable) ? Number(data.endAvailable) : null,
        doh: Number.isFinite(data?.doh) ? Number(data.doh) : null,
        safetyUnits: Number.isFinite(data?.safetyUnits) ? Number(data.safetyUnits) : null,
        safetyDays: Number.isFinite(data?.safetyDays) ? Number(data.safetyDays) : null,
        daysToOos: Number.isFinite(data?.daysToOos) ? Number(data.daysToOos) : null,
        forecastUnits: Number.isFinite(data?.forecastUnits) ? Number(data.forecastUnits) : null,
        events: Array.isArray(inboundEntry?.events) ? inboundEntry.events : [],
      };
    });
  }

  function buildDrilldownTooltipHtml({ alias, monthData }) {
    const stockLabel = drilldownMode === "doh"
      ? "Bestand Monatsende (DOH)"
      : "Bestand Monatsende (DE verfügbar)";
    const stockValue = drilldownMode === "doh"
      ? (Number.isFinite(monthData.doh) ? `${formatInt(monthData.doh)} DOH` : "—")
      : (Number.isFinite(monthData.endAvailable) ? `${formatInt(monthData.endAvailable)} Units` : "—");
    const planValue = Number.isFinite(monthData.forecastUnits)
      ? `${formatInt(monthData.forecastUnits)} Units`
      : "—";
    const arrivalsHtml = monthData.events.length
      ? monthData.events.map(event => {
        const linkButton = event.open
          ? `<button class="btn sm secondary inventory-link" type="button" data-route="${escapeHtml(event.route || "")}" data-open="${escapeHtml(event.open || "")}">Open ${escapeHtml(event.type || "")}</button>`
          : "";
        return `
          <div class="inventory-drilldown-arrival">
            <div class="inventory-drilldown-arrival-main">
              <div><strong>${escapeHtml(event.type || "—")} ${escapeHtml(event.label || event.id || "—")}</strong></div>
              <div class="muted">${escapeHtml(event.date || "—")}</div>
            </div>
            <div class="inventory-drilldown-arrival-meta">
              <div>+${formatInt(event.qty)} Units</div>
              ${linkButton}
            </div>
          </div>
        `;
      }).join("")
      : `<div class="inventory-drilldown-tooltip-empty">Keine Ankünfte.</div>`;

    return `
      <div class="inventory-drilldown-tooltip-header">
        <div class="inventory-drilldown-tooltip-title">${escapeHtml(monthData.month)}</div>
        <div class="muted">${escapeHtml(alias || "—")}</div>
      </div>
      <div class="inventory-drilldown-tooltip-kpis">
        <div>${stockLabel}: <strong>${stockValue}</strong></div>
        <div>Plan-Absatz: <strong>${planValue}</strong></div>
      </div>
      <div class="inventory-drilldown-tooltip-arrivals">${arrivalsHtml}</div>
    `;
  }

  function positionDrilldownTooltip(tooltip, event) {
    if (!tooltip || !event) return;
    const offset = 14;
    const maxX = window.innerWidth - tooltip.offsetWidth - 12;
    const maxY = window.innerHeight - tooltip.offsetHeight - 12;
    const x = clamp(event.clientX + offset, 8, Math.max(8, maxX));
    const y = clamp(event.clientY + offset, 8, Math.max(8, maxY));
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideDrilldownTooltip(tooltip) {
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.innerHTML = "";
  }

  function renderInventoryDrilldownChart(overlay, { sku, alias }) {
    const chartHost = overlay?.querySelector("[data-drilldown-chart]");
    const tooltip = overlay?.querySelector(".inventory-drilldown-tooltip");
    if (!chartHost || !tooltip) return;

    if (drilldownHideTimer) {
      clearTimeout(drilldownHideTimer);
      drilldownHideTimer = null;
    }
    hideDrilldownTooltip(tooltip);

    const rows = buildDrilldownRows(sku).map(entry => {
      const riskClass = view.showSafety
        ? getProjectionSafetyClass({
          endAvailable: entry.endAvailable,
          safetyUnits: entry.safetyUnits,
          doh: entry.doh,
          safetyDays: entry.safetyDays,
          daysToOos: entry.daysToOos,
          projectionMode: drilldownMode === "doh" ? "doh" : "units",
        })
        : "";
      return { ...entry, riskClass };
    });

    if (!rows.length) {
      chartHost.innerHTML = `<div class="muted">Keine Projektion vorhanden.</div>`;
      return;
    }

    const monthCount = rows.length;
    const monthWidth = 72;
    const marginLeft = 56;
    const marginRight = 20;
    const trendTop = 18;
    const trendHeight = 210;
    const planTop = trendTop + trendHeight + 36;
    const planHeight = 86;
    const axisBottom = planTop + planHeight;
    const chartWidth = marginLeft + marginRight + (monthCount * monthWidth);
    const chartHeight = axisBottom + 34;
    const stockValues = rows.map(entry => (drilldownMode === "doh" ? entry.doh : entry.endAvailable));
    const safetyValues = rows.map(entry => (drilldownMode === "doh" ? entry.safetyDays : entry.safetyUnits));
    const valueCandidates = stockValues.filter(value => Number.isFinite(value));
    if (view.showSafety) {
      safetyValues.forEach(value => {
        if (Number.isFinite(value)) valueCandidates.push(value);
      });
    }
    let minValue = valueCandidates.length ? Math.min(...valueCandidates) : 0;
    let maxValue = valueCandidates.length ? Math.max(...valueCandidates) : 1;
    minValue = Math.min(minValue, 0);
    if (maxValue <= minValue) maxValue = minValue + 1;
    const maxPlan = Math.max(
      1,
      ...rows.map(entry => (Number.isFinite(entry.forecastUnits) ? entry.forecastUnits : 0)),
    );
    const xForIndex = (index) => marginLeft + (index * monthWidth) + (monthWidth / 2);
    const yForValue = (value) => trendTop + ((maxValue - value) / (maxValue - minValue)) * trendHeight;
    const yForPlan = (value) => {
      const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
      return planTop + planHeight - ((safeValue / maxPlan) * planHeight);
    };
    const tickCount = 4;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, idx) => {
      const ratio = idx / tickCount;
      const value = maxValue - ((maxValue - minValue) * ratio);
      return { value, y: yForValue(value) };
    });

    const stockSegments = [];
    let currentSegment = [];
    stockValues.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        if (currentSegment.length) stockSegments.push(currentSegment);
        currentSegment = [];
        return;
      }
      currentSegment.push({ x: xForIndex(index), y: yForValue(value), index });
    });
    if (currentSegment.length) stockSegments.push(currentSegment);

    const barWidth = Math.max(12, Math.round(monthWidth * 0.42));

    const riskBandsSvg = rows.map((entry, index) => {
      if (!view.showSafety || !entry.riskClass) return "";
      const cls = entry.riskClass === "safety-negative"
        ? "inventory-drilldown-band-negative"
        : "inventory-drilldown-band-low";
      const x = marginLeft + (index * monthWidth);
      return `<rect class="${cls}" x="${x}" y="${trendTop}" width="${monthWidth}" height="${axisBottom - trendTop + 1}"></rect>`;
    }).join("");

    const gridSvg = yTicks.map(tick => `
      <line class="inventory-drilldown-grid" x1="${marginLeft}" y1="${tick.y.toFixed(2)}" x2="${chartWidth - marginRight}" y2="${tick.y.toFixed(2)}"></line>
      <text class="inventory-drilldown-axis-label" x="${marginLeft - 8}" y="${(tick.y + 3).toFixed(2)}" text-anchor="end">${escapeHtml(formatInt(tick.value))}</text>
    `).join("");

    const stockLineSvg = stockSegments.map(segment => {
      const points = segment.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
      return `<polyline class="inventory-drilldown-stock-line" points="${points}"></polyline>`;
    }).join("");
    const stockDotsSvg = stockSegments
      .reduce((all, segment) => all.concat(segment), [])
      .map(point => `<circle class="inventory-drilldown-stock-dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.4"></circle>`)
      .join("");
    const planBarsSvg = rows.map((entry, index) => {
      if (!Number.isFinite(entry.forecastUnits) || entry.forecastUnits <= 0) return "";
      const x = xForIndex(index) - (barWidth / 2);
      const y = yForPlan(entry.forecastUnits);
      const height = Math.max(1, (planTop + planHeight) - y);
      return `<rect class="inventory-drilldown-plan-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth}" height="${height.toFixed(2)}" rx="3"></rect>`;
    }).join("");
    const arrivalSvg = rows.map((entry, index) => {
      if (!entry.events.length) return "";
      const hasPo = entry.events.some(event => event.type === "PO");
      const hasFo = entry.events.some(event => event.type === "FO");
      const label = hasPo && hasFo ? "PO+FO" : (hasPo ? "PO" : "FO");
      const value = stockValues[index];
      const referenceY = Number.isFinite(value) ? yForValue(value) : trendTop + 14;
      const y = clamp(referenceY - 22, trendTop + 2, trendTop + trendHeight - 18);
      const width = label.length > 2 ? 36 : 24;
      const x = xForIndex(index) - (width / 2);
      return `
        <rect class="inventory-drilldown-arrival-pill" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width}" height="14" rx="7"></rect>
        <text class="inventory-drilldown-arrival-pill-text" x="${(x + (width / 2)).toFixed(2)}" y="${(y + 10.2).toFixed(2)}" text-anchor="middle">${label}</text>
      `;
    }).join("");
    const monthLabelsSvg = rows.map((entry, index) => `
      <text class="inventory-drilldown-axis-label" x="${xForIndex(index).toFixed(2)}" y="${(axisBottom + 16).toFixed(2)}" text-anchor="middle">${escapeHtml(formatMonthLabel(entry.month))}</text>
    `).join("");
    const hitAreasSvg = rows.map((_, index) => {
      const x = marginLeft + (index * monthWidth);
      return `<rect class="inventory-drilldown-hit" data-index="${index}" x="${x}" y="${trendTop}" width="${monthWidth}" height="${axisBottom - trendTop + 18}"></rect>`;
    }).join("");

    let safetyLineSvg = "";
    if (view.showSafety && drilldownMode === "doh") {
      const safetyDays = rows.find(entry => Number.isFinite(entry.safetyDays))?.safetyDays;
      if (Number.isFinite(safetyDays)) {
        const y = yForValue(safetyDays);
        safetyLineSvg = `
          <line class="inventory-drilldown-safety-line" x1="${marginLeft}" y1="${y.toFixed(2)}" x2="${chartWidth - marginRight}" y2="${y.toFixed(2)}"></line>
          <text class="inventory-drilldown-axis-label" x="${chartWidth - marginRight}" y="${(y - 6).toFixed(2)}" text-anchor="end">Safety ${escapeHtml(formatInt(safetyDays))}</text>
        `;
      }
    } else if (view.showSafety) {
      const safetySegments = [];
      let currentSafety = [];
      rows.forEach((entry, index) => {
        if (!Number.isFinite(entry.safetyUnits)) {
          if (currentSafety.length) safetySegments.push(currentSafety);
          currentSafety = [];
          return;
        }
        currentSafety.push(`${xForIndex(index).toFixed(2)},${yForValue(entry.safetyUnits).toFixed(2)}`);
      });
      if (currentSafety.length) safetySegments.push(currentSafety);
      safetyLineSvg = safetySegments
        .map(segment => `<polyline class="inventory-drilldown-safety-line" points="${segment.join(" ")}"></polyline>`)
        .join("");
    }

    chartHost.innerHTML = `
      <svg class="inventory-drilldown-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="SKU Verlauf ${escapeHtml(alias || sku)} (${escapeHtml(sku)})">
        ${riskBandsSvg}
        ${gridSvg}
        <line class="inventory-drilldown-axis" x1="${marginLeft}" y1="${(trendTop + trendHeight).toFixed(2)}" x2="${chartWidth - marginRight}" y2="${(trendTop + trendHeight).toFixed(2)}"></line>
        <line class="inventory-drilldown-axis" x1="${marginLeft}" y1="${(planTop + planHeight).toFixed(2)}" x2="${chartWidth - marginRight}" y2="${(planTop + planHeight).toFixed(2)}"></line>
        <text class="inventory-drilldown-axis-label" x="${marginLeft}" y="${(trendTop - 6).toFixed(2)}">${drilldownMode === "doh" ? "DOH" : "Units"}</text>
        <text class="inventory-drilldown-axis-label" x="${marginLeft}" y="${(planTop - 8).toFixed(2)}">Plan-Absatz (Units)</text>
        ${safetyLineSvg}
        ${planBarsSvg}
        ${stockLineSvg}
        ${stockDotsSvg}
        ${arrivalSvg}
        ${monthLabelsSvg}
        ${hitAreasSvg}
      </svg>
    `;

    const scheduleHideTooltip = () => {
      if (drilldownHideTimer) clearTimeout(drilldownHideTimer);
      drilldownHideTimer = setTimeout(() => {
        if (tooltip.matches(":hover")) return;
        hideDrilldownTooltip(tooltip);
      }, 120);
    };

    const showTooltipForIndex = (event, index) => {
      if (drilldownHideTimer) {
        clearTimeout(drilldownHideTimer);
        drilldownHideTimer = null;
      }
      const monthData = rows[index];
      if (!monthData) return;
      tooltip.innerHTML = buildDrilldownTooltipHtml({ alias, monthData });
      tooltip.hidden = false;
      positionDrilldownTooltip(tooltip, event);
    };

    chartHost.querySelectorAll(".inventory-drilldown-hit").forEach(hit => {
      const index = Number(hit.getAttribute("data-index"));
      hit.onmouseenter = (event) => showTooltipForIndex(event, index);
      hit.onmousemove = (event) => showTooltipForIndex(event, index);
      hit.onmouseleave = () => scheduleHideTooltip();
    });
    chartHost.onmouseleave = () => scheduleHideTooltip();
    tooltip.onmouseenter = () => {
      if (drilldownHideTimer) {
        clearTimeout(drilldownHideTimer);
        drilldownHideTimer = null;
      }
    };
    tooltip.onmouseleave = () => hideDrilldownTooltip(tooltip);
  }

  function openInventoryDrilldown({ sku, alias }) {
    if (!sku) return;
    closeInventoryDrilldown();
    drilldownMode = "units";
    const safeAlias = alias || sku;
    const overlay = document.createElement("div");
    overlay.className = "po-modal-backdrop inventory-drilldown-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="po-modal inventory-drilldown-modal">
        <header class="po-modal-header">
          <div>
            <strong>SKU Verlauf – ${escapeHtml(safeAlias)} (${escapeHtml(sku)})</strong>
            <div class="muted small">Zeitraum: ${escapeHtml(months[0] || "—")} bis ${escapeHtml(months[months.length - 1] || "—")}</div>
          </div>
          <button class="btn ghost" type="button" data-drilldown-close aria-label="Schließen">✕</button>
        </header>
        <div class="po-modal-body">
          <div class="inventory-drilldown-toolbar">
            <span class="muted">Anzeige</span>
            <div class="segment-control">
              <input type="radio" id="inventory-drilldown-units" name="inventory-drilldown-mode" value="units" checked />
              <label for="inventory-drilldown-units">Units</label>
              <input type="radio" id="inventory-drilldown-doh" name="inventory-drilldown-mode" value="doh" />
              <label for="inventory-drilldown-doh">Days on Hand</label>
            </div>
          </div>
          <div class="inventory-drilldown-chart-wrap">
            <div class="inventory-drilldown-chart" data-drilldown-chart></div>
          </div>
          <div class="inventory-drilldown-note muted small">Linie: Bestand Monatsende · Balken: Plan-Absatz · Marker: PO/FO-Ankünfte</div>
        </div>
        <footer class="po-modal-actions">
          <button class="btn secondary" type="button" data-drilldown-close>Schließen</button>
        </footer>
      </div>
      <div class="inventory-drilldown-tooltip" hidden></div>
    `;

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-drilldown-close]")) {
        closeInventoryDrilldown();
        return;
      }
      const link = event.target.closest(".inventory-link");
      if (!link) return;
      const route = link.getAttribute("data-route");
      const open = link.getAttribute("data-open");
      if (!route || !open) return;
      const params = new URLSearchParams();
      params.set("open", open);
      location.hash = `${route}?${params.toString()}`;
      closeInventoryDrilldown();
    });

    overlay.addEventListener("change", (event) => {
      const input = event.target.closest("input[name='inventory-drilldown-mode']");
      if (!input) return;
      drilldownMode = input.value === "doh" ? "doh" : "units";
      renderInventoryDrilldownChart(overlay, { sku, alias: safeAlias });
    });

    document.body.appendChild(overlay);
    drilldownOverlay = overlay;
    renderInventoryDrilldownChart(overlay, { sku, alias: safeAlias });
  }

  root.addEventListener("mouseover", (event) => {
    const target = event.target.closest("[data-tooltip-html]");
    if (!target || target === activeTooltipTarget) return;
    const html = target.getAttribute("data-tooltip-html");
    if (!html) return;
    showTooltip(target, html, event);
  });

  root.addEventListener("mousemove", (event) => {
    if (!activeTooltipTarget) return;
    positionTooltip(event);
  });

  root.addEventListener("mouseout", (event) => {
    if (!activeTooltipTarget) return;
    if (event.relatedTarget && tooltipLayer && tooltipLayer.contains(event.relatedTarget)) {
      return;
    }
    const leavingTarget = event.target.closest("[data-tooltip-html]");
    if (leavingTarget && leavingTarget === activeTooltipTarget) {
      hideTooltip();
    }
  });

  if (tooltipLayer) {
    tooltipLayer.addEventListener("mouseleave", () => {
      hideTooltip();
    });
  }

  const handleDocClick = (event) => {
    if (!projectionPopover) return;
    if (projectionPopover.contains(event.target)) return;
    const cell = event.target.closest("td.inventory-projection-cell");
    if (cell && projectionPopoverCell === cell) return;
    closeProjectionPopover();
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      closeProjectionPopover();
      closeInventoryDrilldown();
    }
  };
  document.addEventListener("click", handleDocClick);
  document.addEventListener("keydown", handleKeydown);
  const tableScroll = root.querySelector(".inventory-table-scroll");
  const handleScroll = () => closeProjectionPopover();
  if (tableScroll) {
    tableScroll.addEventListener("scroll", handleScroll);
  }

  root.addEventListener("click", (event) => {
    const link = event.target.closest(".inventory-link");
    if (!link) return;
    const route = link.getAttribute("data-route");
    const open = link.getAttribute("data-open");
    if (!route || !open) return;
    const params = new URLSearchParams();
    params.set("open", open);
    location.hash = `${route}?${params.toString()}`;
  });

  const horizonSelect = root.querySelector("#inventory-horizon");
  if (horizonSelect) {
    horizonSelect.addEventListener("change", (event) => {
      const value = Number(event.target.value || 12);
      if (!state.inventory) state.inventory = { snapshots: [], settings: {} };
      if (!state.inventory.settings) state.inventory.settings = {};
      state.inventory.settings.projectionMonths = value;
      commitAppState(state);
      render(root);
    });
  }

  const safetyToggle = root.querySelector("#inventory-safety");
  if (safetyToggle) {
    safetyToggle.addEventListener("change", (event) => {
      view.showSafety = event.target.checked;
      saveViewState(view);
      render(root);
    });
  }

  const modeInputs = root.querySelectorAll("input[name='inventory-mode']");
  modeInputs.forEach(input => {
    input.addEventListener("change", (event) => {
      const next = event.target.value;
      view.projectionMode = next === "doh" || next === "plan" ? next : "units";
      saveViewState(view);
      render(root);
    });
  });

  function focusFromRoute() {
    if (!routeSku) return;
    const skuSelector = escapeSelector(routeSku);
    const monthSelector = /^\d{4}-\d{2}$/.test(routeMonth)
      ? `[data-month="${escapeSelector(routeMonth)}"]`
      : "[data-month]";
    const cell = root.querySelector(`.inventory-projection-table tr[data-sku="${skuSelector}"] td${monthSelector}`);
    const row = cell ? cell.closest("tr[data-sku]") : root.querySelector(`.inventory-projection-table tr[data-sku="${skuSelector}"]`);
    if (row) row.classList.add("row-focus");
    if (cell) {
      cell.classList.add("cell-focus");
      cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    } else if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.__routeQuery = {};
  }

  focusFromRoute();

  root._inventoryCleanup = () => {
    document.removeEventListener("click", handleDocClick);
    document.removeEventListener("keydown", handleKeydown);
    if (tableScroll) {
      tableScroll.removeEventListener("scroll", handleScroll);
    }
    closeProjectionPopover();
    closeInventoryDrilldown();
  };
}

export default { render };

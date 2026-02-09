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
  return {
    selectedMonth: raw.selectedMonth || null,
    collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
    search: raw.search || "",
    showSafety: raw.showSafety !== false,
    projectionMode,
    snapshotAsOfDate: raw.snapshotAsOfDate || "",
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

function buildSnapshotTable({ state, view, snapshot, previousSnapshot, products, categories, asOfDate, snapshotMonth }) {
  const filtered = filterProductsBySearch(products, view.search);

  const groups = buildCategoryGroups(filtered, categories);
  const prevMap = new Map();
  (previousSnapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) prevMap.set(sku, item);
  });
  const inTransitMap = buildInTransitMap(state, asOfDate);

  const rows = groups.map(group => {
    const collapsed = view.collapsed[group.id];
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
      const warning = !Number.isFinite(ekEur);
      const transitTooltip = inTransit && inTransit.entries.length
        ? renderInTransitTooltip({ alias: product.alias || sku, entries: inTransit.entries })
        : "";
      const amazonDraft = inventoryDrafts.get(getInventoryDraftKey(snapshotMonth, sku, "amazonUnits"));
      const threePlDraft = inventoryDrafts.get(getInventoryDraftKey(snapshotMonth, sku, "threePLUnits"));
      return `
        <tr class="inventory-row ${collapsed ? "is-collapsed" : ""}" data-sku="${escapeHtml(sku)}" data-category="${escapeHtml(group.id)}">
          <td class="inventory-col-sku sticky-cell">${escapeHtml(sku)}</td>
          <td class="inventory-col-alias sticky-cell">${escapeHtml(product.alias || "—")}</td>
          <td class="inventory-col-category sticky-cell">${escapeHtml(group.name)}</td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${escapeHtml(amazonDraft ?? String(item?.amazonUnits ?? 0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${escapeHtml(threePlDraft ?? String(item?.threePLUnits ?? 0))}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num inventory-value" data-field="totalUnits">${formatInt(totalUnits)}</td>
          <td class="num inventory-value inventory-in-transit" data-tooltip-html="${encodeTooltip(transitTooltip)}">${formatInt(inTransitTotal)}</td>
          <td class="num">
            ${warning ? `<span class="cell-warning" title="EK fehlt im Produkt">${"⚠︎"}</span>` : ""}
            <span data-field="ekEur">${Number.isFinite(ekEur) ? formatEur(ekEur) : "—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(totalValue) ? formatEur(totalValue) : "—"}</td>
          <td class="num inventory-value" data-field="delta">${formatInt(delta)}</td>
          <td><input class="inventory-input note" data-field="note" value="${escapeHtml(item?.note || "")}" /></td>
        </tr>
      `;
    }).join("");

    return `
        <tr class="inventory-category-row" data-category-row="${escapeHtml(group.id)}">
          <th class="inventory-col-sku sticky-cell" colspan="3">
            <button type="button" class="tree-toggle" data-category="${escapeHtml(group.id)}">${collapsed ? "▸" : "▾"}</button>
            <span class="tree-label">${escapeHtml(group.name)}</span>
            <span class="muted">(${group.items.length})</span>
          </th>
          <th colspan="8"></th>
        </tr>
        ${items}
      `;
    }).join("");

  return `
    <table class="table-compact inventory-table inventory-snapshot-table" data-ui-table="true" data-sticky-cols="3">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-category sticky-header">Kategorie</th>
          <th class="num">Amazon Units</th>
          <th class="num">3PL Units</th>
          <th class="num">Total Units</th>
          <th class="num">In Transit</th>
          <th class="num">EK (EUR)</th>
          <th class="num">Warenwert €</th>
          <th class="num">Delta vs prev</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td class="muted" colspan="11">Keine Produkte gefunden.</td></tr>`}
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
      const rowValue = Number.isFinite(ekEur) ? totalUnits * ekEur : null;
      if (!Number.isFinite(ekEur)) {
        missingEk.push(alias ? `${sku} (${alias})` : sku);
      }
      if (Number.isFinite(amazonUnits)) totalAmazon += amazonUnits;
      if (Number.isFinite(threePlUnits)) totalMajamo += threePlUnits;
      if (Number.isFinite(inTransitUnits)) totalTransit += inTransitUnits;
      if (Number.isFinite(rowValue)) totalValue += rowValue;
      rows.push({
        sku,
        alias,
        amazonUnits,
        threePlUnits,
        inTransitUnits,
        ekEur,
        rowValue,
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
    "Warenwert (EUR)",
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
      formatEurExport(row.rowValue),
    ];
    lines.push(line.map(value => escapeCsv(value, delimiter)).join(delimiter));
  });
  const totalsRow = [
    "Gesamtsumme Warenwert (EUR)",
    "",
    formatUnitsExport(totals.amazonUnits),
    formatUnitsExport(totals.majamoUnits),
    formatUnitsExport(totals.inTransitUnits),
    "",
    formatEurExport(totals.totalValue),
  ];
  lines.push(totalsRow.map(value => escapeCsv(value, delimiter)).join(delimiter));
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
        <td class="num">${formatEurExport(row.rowValue)}</td>
      </tr>
  `).join("");
  const totalRow = `
      <tr class="totals">
        <td>Gesamtsumme Warenwert (EUR)</td>
        <td></td>
        <td class="num">${formatUnitsExport(totals.amazonUnits)}</td>
        <td class="num">${formatUnitsExport(totals.majamoUnits)}</td>
        <td class="num">${formatUnitsExport(totals.inTransitUnits)}</td>
        <td class="num"></td>
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
              <th class="num">Warenwert (EUR)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
            ${totalRow}
          </tbody>
        </table>
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

function buildProjectionTable({ state, view, snapshot, products, categories, months }) {
  const filtered = filterProductsBySearch(products, view.search);
  const groups = buildCategoryGroups(filtered, categories);
  const forecastBySku = new Map();
  const projection = computeInventoryProjection({
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
  const { inboundMap, missingEtaSkus } = buildInboundMap(state);
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
          <td class="inventory-col-alias sticky-cell">${escapeHtml(alias)}</td>
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
    <table class="table-compact inventory-table inventory-projection-table" data-ui-table="true" data-sticky-cols="5">
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

  root.innerHTML = `
    <section class="card inventory-card">
      <div class="inventory-header">
        <div>
          <h2>Inventory</h2>
          <p class="muted">Month-end Snapshots und Bestandsplanung. Lokal gespeichert.</p>
        </div>
        <div class="inventory-search">
          <input type="search" placeholder="SKU oder Alias suchen" value="${escapeHtml(view.search)}" />
        </div>
      </div>
      <div class="inventory-toolbar">
        <label class="inventory-field">
          <span class="muted">Snapshot Monat</span>
          <select id="inventory-month"></select>
        </label>
        <button class="btn secondary" id="inventory-copy">Copy from previous month</button>
        <button class="btn secondary" id="inventory-expand-all">Alles aufklappen</button>
        <button class="btn secondary" id="inventory-collapse-all">Alles zuklappen</button>
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
          <span class="muted small">Export für Buchführung: SKU, Bestände, In-Transit, EK-Preis, Warenwert</span>
          ${missingEkCount ? `<span class="inventory-export-warning">⚠︎ EK fehlt (${missingEkCount})</span>` : ""}
        </div>
      </div>
      <div class="inventory-table-wrap">
        <div class="inventory-table-scroll">
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
      <div class="inventory-header">
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
      <div class="inventory-table-wrap">
        <div class="inventory-table-scroll">
          ${buildProjectionTable({ state, view, snapshot, products, categories, months })}
        </div>
      </div>
      <div class="inventory-legend">
        ${isPlanView ? "" : `
          <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
          <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (Units)</span>
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
  };
}

export default { render };

import { loadState, saveState } from "../data/storageLocal.js";
import { parseDeNumber } from "../lib/dataHealth.js";

const INVENTORY_VIEW_KEY = "inventory_view_v1";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]
  ));
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

function daysInMonth(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey || "")) return 30;
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function parseIntegerInput(value) {
  if (value == null || value === "") return { value: 0, isRounded: false };
  const parsed = parseDeNumber(String(value));
  if (!Number.isFinite(parsed)) return { value: 0, isRounded: false };
  const rounded = Math.round(parsed);
  return { value: rounded, isRounded: rounded !== parsed };
}

function formatInt(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("de-DE", { maximumFractionDigits: 0 });
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
  try {
    const raw = JSON.parse(localStorage.getItem(INVENTORY_VIEW_KEY) || "{}");
    return {
      selectedMonth: raw.selectedMonth || null,
      collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
      search: raw.search || "",
      showSafety: raw.showSafety !== false,
      projectionMode: raw.projectionMode === "doh" ? "doh" : "units",
    };
  } catch {
    return {
      selectedMonth: null,
      collapsed: {},
      search: "",
      showSafety: true,
      projectionMode: "units",
    };
  }
}

function saveViewState(state) {
  localStorage.setItem(INVENTORY_VIEW_KEY, JSON.stringify(state));
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

function getForecastUnits(state, sku, month) {
  const manual = state?.forecast?.forecastManual?.[sku]?.[month];
  const manualParsed = parseDeNumber(manual);
  if (Number.isFinite(manualParsed)) return manualParsed;
  const imported = state?.forecast?.forecastImport?.[sku]?.[month]?.units;
  const importParsed = parseDeNumber(imported);
  if (Number.isFinite(importParsed)) return importParsed;
  return null;
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

function buildInTransitMap(state) {
  const map = new Map();
  const today = new Date();
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
    if (eta && eta < today) return;
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
    if (String(fo.status || "").toUpperCase() === "CANCELLED") return;
    const eta = resolveFoArrival(fo);
    if (eta && eta < today) return;
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

function buildSnapshotTable({ state, view, snapshot, previousSnapshot, products, categories }) {
  const search = view.search.trim().toLowerCase();
  const filtered = products.filter(product => {
    if (!search) return true;
    return String(product.alias || "").toLowerCase().includes(search)
      || String(product.sku || "").toLowerCase().includes(search);
  });

  const groups = buildCategoryGroups(filtered, categories);
  const prevMap = new Map();
  (previousSnapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) prevMap.set(sku, item);
  });
  const inTransitMap = buildInTransitMap(state);

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
      const prevTotal = (prevItem?.amazonUnits || 0) + (prevItem?.threePLUnits || 0);
      const delta = totalUnits - prevTotal;
      const ekEur = getProductEkEur(product, state.settings || {});
      const totalValue = Number.isFinite(ekEur) ? Math.round(totalUnits * ekEur) : null;
      const warning = !Number.isFinite(ekEur);
      const transitTooltip = inTransit && inTransit.entries.length
        ? renderInTransitTooltip({ alias: product.alias || sku, entries: inTransit.entries })
        : "";
      return `
        <tr class="inventory-row ${collapsed ? "is-collapsed" : ""}" data-sku="${escapeHtml(sku)}" data-category="${escapeHtml(group.id)}">
          <td class="inventory-col-sku sticky-cell">${escapeHtml(sku)}</td>
          <td class="inventory-col-alias sticky-cell">${escapeHtml(product.alias || "—")}</td>
          <td class="inventory-col-category sticky-cell">${escapeHtml(group.name)}</td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="amazonUnits" value="${escapeHtml(item?.amazonUnits ?? 0)}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num">
            <input class="inventory-input" inputmode="decimal" data-field="threePLUnits" value="${escapeHtml(item?.threePLUnits ?? 0)}" />
            <span class="inventory-input-hint">Nur ganze Einheiten</span>
          </td>
          <td class="num inventory-value" data-field="totalUnits">${formatInt(totalUnits)}</td>
          <td class="num inventory-value inventory-in-transit" data-tooltip-html="${encodeTooltip(transitTooltip)}">${formatInt(inTransitTotal)}</td>
          <td class="num">
            ${warning ? `<span class="cell-warning" title="EK fehlt im Produkt">${"⚠︎"}</span>` : ""}
            <span data-field="ekEur">${Number.isFinite(ekEur) ? formatEur(ekEur) : "—"}</span>
          </td>
          <td class="num inventory-value" data-field="totalValue">${Number.isFinite(totalValue) ? formatInt(totalValue) : "—"}</td>
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
    <table class="table-compact inventory-table inventory-snapshot-table">
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
          <th class="num">Total Value €</th>
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

function buildProjectionTable({ state, view, snapshot, products, categories, months }) {
  const search = view.search.trim().toLowerCase();
  const filtered = products.filter(product => {
    if (!search) return true;
    return String(product.alias || "").toLowerCase().includes(search)
      || String(product.sku || "").toLowerCase().includes(search);
  });
  const groups = buildCategoryGroups(filtered, categories);
  const snapshotMap = new Map();
  (snapshot?.items || []).forEach(item => {
    const sku = String(item.sku || "").trim();
    if (sku) snapshotMap.set(sku, item);
  });
  const { inboundMap, missingEtaSkus } = buildInboundMap(state);

  const rows = groups.map(group => {
    const collapsed = view.collapsed[group.id];
    const items = group.items.map(product => {
      const sku = String(product.sku || "").trim();
      const alias = product.alias || "—";
      const snapshotItem = snapshotMap.get(sku);
      const startAvailable = (snapshotItem?.amazonUnits || 0) + (snapshotItem?.threePLUnits || 0);
      let prevAvailable = Number.isFinite(startAvailable) ? startAvailable : 0;
      let previousUnknown = false;
      let inboundDetailIndex = 0;
      const cells = months.map(month => {
        const skuInbound = inboundMap.get(sku);
        const inboundEntry = skuInbound ? skuInbound.get(month) : null;
        const inboundUnits = inboundEntry ? inboundEntry.poUnits + inboundEntry.foUnits : 0;
        const forecastUnits = getForecastUnits(state, sku, month);
        let endAvailable = null;
        if (!previousUnknown && Number.isFinite(forecastUnits)) {
          endAvailable = prevAvailable + inboundUnits - forecastUnits;
          prevAvailable = endAvailable;
        } else {
          previousUnknown = true;
        }
        const forecastMissing = !Number.isFinite(forecastUnits) || previousUnknown;
        const safetyDays = state.inventory?.settings?.safetyDays || 60;
        const safetyUnits = view.showSafety && Number.isFinite(forecastUnits)
          ? Math.round((forecastUnits / daysInMonth(month)) * safetyDays)
          : null;
        const safetyLow = Number.isFinite(endAvailable) && Number.isFinite(safetyUnits) && endAvailable < safetyUnits;
        const safetyNegative = Number.isFinite(endAvailable) && endAvailable < 0;
        const inboundClasses = inboundEntry?.hasPo && inboundEntry?.hasFo
          ? "inventory-cell inbound-both"
          : inboundEntry?.hasPo
            ? "inventory-cell inbound-po"
            : inboundEntry?.hasFo
              ? "inventory-cell inbound-fo"
              : "inventory-cell";
        const safetyClass = safetyNegative
          ? "safety-negative"
          : safetyLow
            ? "safety-low"
            : "";
        const incompleteClass = forecastMissing ? "incomplete" : "";
        const dailyDemand = Number.isFinite(forecastUnits) && forecastUnits > 0
          ? forecastUnits / daysInMonth(month)
          : null;
        const dohValue = Number.isFinite(endAvailable) && Number.isFinite(dailyDemand) && dailyDemand > 0
          ? Math.max(0, Math.round(endAvailable / dailyDemand))
          : null;
        const showDoh = view.projectionMode === "doh";
        const displayValue = forecastMissing
          ? "—"
          : safetyNegative
            ? `0 <span class="inventory-warning-icon">⚠︎</span>`
            : showDoh
              ? (dohValue == null ? "—" : formatInt(dohValue))
              : formatInt(endAvailable);
        const safetyClassFinal = showDoh
          ? (Number.isFinite(dohValue) && dohValue < safetyDays ? "safety-negative" : "")
          : safetyClass;
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
          <td class="num ${inboundClasses} ${safetyClassFinal} ${incompleteClass}" ${tooltip ? `data-tooltip-html="${encodeTooltip(tooltipHtml)}"` : ""} ${tooltipId ? `data-tooltip-id="${tooltipId}"` : ""}>
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
          <td class="inventory-col-category sticky-cell">${escapeHtml(group.name)}</td>
          ${cells}
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
        <th colspan="${months.length}"></th>
      </tr>
      ${items}
    `;
  }).join("");

  const monthHeaders = months.map(month => `<th class="num">${formatMonthLabel(month)}</th>`).join("");

  return `
    <table class="table-compact inventory-table inventory-projection-table">
      <thead>
        <tr>
          <th class="inventory-col-sku sticky-header">SKU</th>
          <th class="inventory-col-alias sticky-header">Alias</th>
          <th class="inventory-col-category sticky-header">Kategorie</th>
          ${monthHeaders}
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td class="muted" colspan="${months.length + 3}">Keine Produkte gefunden.</td></tr>`}
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
  const ekEur = getProductEkEur(product, state.settings || {});
  const totalValue = Number.isFinite(ekEur) ? Math.round(totalUnits * ekEur) : null;
  const totalCell = row.querySelector('[data-field="totalUnits"]');
  const deltaCell = row.querySelector('[data-field="delta"]');
  const valueCell = row.querySelector('[data-field="totalValue"]');
  if (totalCell) totalCell.textContent = formatInt(totalUnits);
  if (deltaCell) deltaCell.textContent = formatInt(delta);
  if (valueCell) valueCell.textContent = Number.isFinite(totalValue) ? formatInt(totalValue) : "—";
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
  const state = loadState();
  const view = loadViewState();
  const selectedMonth = resolveSelectedMonth(state, view);
  view.selectedMonth = selectedMonth;
  saveViewState(view);

  const snapshot = getSnapshot(state, selectedMonth) || { month: selectedMonth, items: [] };
  const previousSnapshot = getPreviousSnapshot(state, selectedMonth);
  const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
  const products = (state.products || []).filter(isProductActive);
  const projectionMonths = Number(state.inventory?.settings?.projectionMonths || 12);
  const projectionOptions = [6, 12, 18];
  const months = buildMonthRange(selectedMonth, projectionOptions.includes(projectionMonths) ? projectionMonths : 12);

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
        <span class="muted small">${previousSnapshot ? `Vorheriger Snapshot: ${formatMonthLabel(previousSnapshot.month)}` : "Kein vorheriger Snapshot vorhanden."}</span>
      </div>
      <div class="inventory-table-wrap">
        <div class="inventory-table-scroll">
          ${buildSnapshotTable({ state, view, snapshot, previousSnapshot, products, categories })}
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
        <span class="inventory-legend-item"><span class="legend-swatch safety-negative"></span> Stockout / unter Safety</span>
        <span class="inventory-legend-item"><span class="legend-swatch safety-low"></span> Unter Safety (Units)</span>
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
      saveState(state);
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
      saveState(state);
    }, 250);
  };

  if (snapshotTable) {
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
      const row = input.closest("tr[data-sku]");
      if (!row) return;
      const sku = row.getAttribute("data-sku");
      const product = products.find(prod => String(prod.sku || "").trim() === sku);
      if (!product) return;
      const item = getSnapshotItem(snapshot, sku);
      const field = input.dataset.field;
      if (field === "note") {
        item.note = input.value;
        scheduleSave();
        return;
      }
      const { value, isRounded } = parseIntegerInput(input.value);
      input.value = String(value);
      input.closest("td")?.classList.toggle("inventory-input-warn", isRounded);
      if (field === "amazonUnits") item.amazonUnits = value;
      if (field === "threePLUnits") item.threePLUnits = value;
      updateSnapshotRow(row, snapshot, previousSnapshot, product, state);
      scheduleSave();
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
  }

  const tooltipLayer = root.querySelector("#inventory-tooltip-layer");
  let activeTooltipTarget = null;

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
      saveState(state);
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
      view.projectionMode = event.target.value === "doh" ? "doh" : "units";
      saveViewState(view);
      render(root);
    });
  });
}

export default { render };

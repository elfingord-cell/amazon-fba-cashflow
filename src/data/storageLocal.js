// FBA-CF-0027 — Local Storage Layer (schlank, mit Listenern)
export const STORAGE_KEY = "amazon_fba_cashflow_v1";

function parseEuro(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatEuro(value) {
  const num = Number(parseEuro(value));
  return Number.isFinite(num)
    ? num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
}

const defaults = {
  settings: {
    startMonth: "2025-02",
    horizonMonths: 18,
    openingBalance: "50.000,00",
    fxRate: "1,08",
    fxFeePct: "0,5",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 14,
    vatPreview: {
      eustLagMonths: 2,
      deShareDefault: 0.8,
      feeRateDefault: 0.38,
      fixInputDefault: 0,
      fixVatLagMonths: 0,
      fixVatCreditAtMonthEnd: true,
    },
  },
  incomings: [ { month:"2025-02", revenueEur:"20.000,00", payoutPct:"100" } ],
  extras:    [ ],
  outgoings: [ ],
  dividends: [ ],
  pos:       [ ],
  fos:       [ ],
  fixcosts:  [ ],
  fixcostOverrides: {},
  poTemplates: [],
  products: [],
  recentProducts: [],
  vatCostRules: [
    { name: "Lizenz", isGrossInput: true, vatRate: "19", reverseCharge: false },
    { name: "Steuerberatung", isGrossInput: true, vatRate: "19", reverseCharge: false },
    { name: "Versicherung", isGrossInput: true, vatRate: "19", reverseCharge: false },
    { name: "Miete", isGrossInput: true, vatRate: "19", reverseCharge: false },
    { name: "Tools", isGrossInput: true, vatRate: "19", reverseCharge: false },
    { name: "Importkosten", isGrossInput: true, vatRate: "0", reverseCharge: false },
    { name: "Reverse Charge", isGrossInput: false, vatRate: "19", reverseCharge: true },
    { name: "Sonstiges", isGrossInput: true, vatRate: "19", reverseCharge: false },
  ],
  vatPreviewMonths: {},
  forecast: {
    items: [],
    settings: {
      useForecast: false,
      grossRevenue: true,
      priceVatRate: 0.19,
    },
    prices: {
      defaults: {},
      byMonth: {},
      vatRate: 0.19,
    },
    manualSkus: [],
  },
  status: {
    autoManualCheck: false,
    events: {},
  },
  fixcostUi: {
    viewMode: "compact",
    expanded: {},
  },
};

function ensureFixcostContainers(state) {
  if (!state) return;
  if (!Array.isArray(state.fixcosts)) state.fixcosts = [];
  if (!state.fixcostOverrides || typeof state.fixcostOverrides !== "object") {
    state.fixcostOverrides = {};
  }

  if (!state.fixcostUi || typeof state.fixcostUi !== "object") {
    state.fixcostUi = structuredClone(defaults.fixcostUi);
  } else {
    state.fixcostUi.viewMode = state.fixcostUi.viewMode === "expanded" ? "expanded" : "compact";
    if (!state.fixcostUi.expanded || typeof state.fixcostUi.expanded !== "object") {
      state.fixcostUi.expanded = {};
    }
  }

   state.fixcosts = state.fixcosts.map(row => {
    if (!row) return row;
    const next = { ...row };
    if (typeof next.isGross === "undefined") next.isGross = true;
    const rate = Number(String(next.vatRate ?? "19").replace(",", "."));
    next.vatRate = Number.isFinite(rate) ? rate : 19;
    return next;
  });
}

function ensurePoTemplates(state) {
  if (!state) return;
  if (!Array.isArray(state.poTemplates)) state.poTemplates = [];
}

function ensureProducts(state) {
  if (!state) return;
  if (!Array.isArray(state.products)) state.products = [];
  if (!Array.isArray(state.recentProducts)) state.recentProducts = [];
}

function ensureOrders(state, key) {
  if (!state || !key) return;
  if (!Array.isArray(state[key])) state[key] = [];
  state[key] = state[key].map(entry => {
    if (!entry) return entry;
    const next = { ...entry };
    if (typeof next.archived !== "boolean") next.archived = false;
    return next;
  });
}

function ensureVatData(state) {
  if (!state) return;
  if (!state.settings) state.settings = {};
  if (!state.settings.vatPreview || typeof state.settings.vatPreview !== "object") {
    state.settings.vatPreview = structuredClone(defaults.settings.vatPreview);
  } else {
    const base = defaults.settings.vatPreview;
    state.settings.vatPreview.eustLagMonths = Number(state.settings.vatPreview.eustLagMonths ?? base.eustLagMonths) || base.eustLagMonths;
    state.settings.vatPreview.deShareDefault = Number(state.settings.vatPreview.deShareDefault ?? base.deShareDefault) || base.deShareDefault;
    state.settings.vatPreview.feeRateDefault = Number(state.settings.vatPreview.feeRateDefault ?? base.feeRateDefault) || base.feeRateDefault;
    state.settings.vatPreview.fixInputDefault = Number(state.settings.vatPreview.fixInputDefault ?? base.fixInputDefault) || base.fixInputDefault;
    state.settings.vatPreview.fixVatLagMonths = Number(state.settings.vatPreview.fixVatLagMonths ?? base.fixVatLagMonths) || 0;
    state.settings.vatPreview.fixVatCreditAtMonthEnd = state.settings.vatPreview.fixVatCreditAtMonthEnd !== false;
  }

  if (!Array.isArray(state.vatCostRules)) {
    state.vatCostRules = structuredClone(defaults.vatCostRules);
  }

  if (!state.vatPreviewMonths || typeof state.vatPreviewMonths !== "object") {
    state.vatPreviewMonths = {};
  }
}

function ensureForecast(state) {
  if (!state) return;
  if (!state.forecast || typeof state.forecast !== "object") {
    state.forecast = structuredClone(defaults.forecast);
  }
  if (!Array.isArray(state.forecast.items)) state.forecast.items = [];
  if (!state.forecast.settings || typeof state.forecast.settings !== "object") {
    state.forecast.settings = { useForecast: false };
  }
  state.forecast.settings.useForecast = Boolean(state.forecast.settings.useForecast);
  state.forecast.settings.grossRevenue = Boolean(state.forecast.settings.grossRevenue);
  const vatSetting = Number(String(state.forecast.settings.priceVatRate ?? "0.19").replace(",", "."));
  state.forecast.settings.priceVatRate = Number.isFinite(vatSetting) ? vatSetting : 0.19;

  if (!state.forecast.prices || typeof state.forecast.prices !== "object") {
    state.forecast.prices = structuredClone(defaults.forecast.prices);
  }
  if (!state.forecast.prices.defaults || typeof state.forecast.prices.defaults !== "object") {
    state.forecast.prices.defaults = {};
  }
  if (!state.forecast.prices.byMonth || typeof state.forecast.prices.byMonth !== "object") {
    state.forecast.prices.byMonth = {};
  }
  const vatPrice = Number(String(state.forecast.prices.vatRate ?? state.forecast.settings.priceVatRate ?? 0.19).replace(",", "."));
  state.forecast.prices.vatRate = Number.isFinite(vatPrice) ? vatPrice : 0.19;
  if (!Array.isArray(state.forecast.manualSkus)) state.forecast.manualSkus = [];
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function migrateLegacyOutgoings(state) {
  if (!state) return;
  if (!Array.isArray(state.outgoings) || !state.outgoings.length) return;
  if (Array.isArray(state.fixcosts) && state.fixcosts.length) {
    state.outgoings = [];
    return;
  }

  const rows = state.outgoings.filter(row => row && row.month);
  if (!rows.length) {
    state.outgoings = [];
    return;
  }

  const months = rows
    .map(row => row.month)
    .filter(Boolean)
    .sort();
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  if (!firstMonth) {
    state.outgoings = [];
    return;
  }

  ensureFixcostContainers(state);

  const id = `fix-migration-${Date.now()}`;
  state.fixcosts.push({
    id,
    name: "Sonstige Fixkosten (Migration)",
    category: "Sonstiges",
    amount: "0,00",
    frequency: "monthly",
    intervalMonths: 1,
    anchor: "LAST",
    startMonth: firstMonth,
    endMonth: lastMonth,
    proration: { enabled: false, method: "none" },
    autoPaid: true,
    notes: "Automatisch aus bestehenden Monatswerten übernommen",
  });

  state.fixcostOverrides[id] = {};
  rows.forEach(row => {
    const month = row.month;
    if (!month) return;
    if (!state.fixcostOverrides[id][month]) state.fixcostOverrides[id][month] = {};
    const override = state.fixcostOverrides[id][month];
    const amount = formatEuro(Math.abs(parseEuro(row.amountEur ?? row.amount ?? 0)));
    override.amount = amount;
    if (row.date) {
      override.dueDate = row.date;
    }
    if (row.label) {
      override.note = row.label;
    }
  });

  state.outgoings = [];
}

const PRODUCT_STATUS = new Set(["active", "inactive"]);

function productKey(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanAlias(alias, sku) {
  const trimmed = String(alias || "").trim();
  if (trimmed) return trimmed;
  const fallback = String(sku || "").trim();
  return fallback ? `Ohne Alias (${fallback})` : "Ohne Alias";
}

function normaliseTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const next = {};
  if (template.scope) {
    next.scope = template.scope === "SKU_SUPPLIER" ? "SKU_SUPPLIER" : "SKU";
  }
  if (template.name) next.name = String(template.name);
  if (template.supplierId) next.supplierId = String(template.supplierId);
  const copyFields = [
    "unitPriceUsd",
    "extraPerUnitUsd",
    "extraFlatUsd",
    "transport",
    "productionDays",
    "transitDays",
    "freightEur",
    "dutyPct",
    "dutyIncludesFreight",
    "vatImportPct",
    "vatRefundActive",
    "vatRefundLag",
    "fxRate",
    "fxFeePct",
    "ddp",
  ];
  for (const field of copyFields) {
    if (template[field] != null) next[field] = template[field];
  }
  if (Array.isArray(template.milestones)) {
    next.milestones = template.milestones.map(row => ({
      id: row.id || `ms-${Math.random().toString(36).slice(2, 9)}`,
      label: row.label || "Milestone",
      percent: Number(row.percent) || 0,
      anchor: row.anchor || "ETA",
      lagDays: Number(row.lagDays) || 0,
    }));
  }
  if (template.fields && typeof template.fields === "object") {
    next.fields = JSON.parse(JSON.stringify(template.fields));
  }
  return next;
}

function migrateProducts(state) {
  if (!state) return;
  ensureProducts(state);
  const map = new Map();
  const now = new Date().toISOString();
  state.products = state.products.filter(Boolean).map(prod => {
    const skuClean = productKey(prod?.sku);
    if (!skuClean) return null;
    const existing = map.get(skuClean);
    const base = existing || {};
    const next = {
      id: prod.id || base.id || `prod-${Math.random().toString(36).slice(2, 9)}`,
      sku: String(prod.sku || base.sku || "").trim(),
      alias: cleanAlias(prod.alias || base.alias, prod.sku || base.sku),
      supplierId: prod.supplierId != null ? String(prod.supplierId).trim() : "",
      status: PRODUCT_STATUS.has(prod.status) ? prod.status : "active",
      tags: Array.isArray(prod.tags) ? prod.tags.filter(Boolean).map(t => String(t).trim()) : [],
      template: normaliseTemplate(prod.template || base.template),
      createdAt: prod.createdAt || base.createdAt || now,
      updatedAt: prod.updatedAt || now,
    };
    map.set(skuClean, next);
    return next;
  }).filter(Boolean);

  const orders = [];
  if (Array.isArray(state.pos)) orders.push(...state.pos);
  if (Array.isArray(state.fos)) orders.push(...state.fos);

  const pushProduct = (sku) => {
    const key = productKey(sku);
    if (!key) return;
    if (!map.has(key)) {
      const entry = {
        id: `prod-${Math.random().toString(36).slice(2, 9)}`,
        sku: String(sku).trim(),
        alias: cleanAlias(null, sku),
        supplierId: "",
        status: "active",
        tags: [],
        template: null,
        createdAt: now,
        updatedAt: now,
      };
      map.set(key, entry);
      state.products.push(entry);
    }
  };

  for (const order of orders) {
    pushProduct(order?.sku);
    if (Array.isArray(order?.items)) {
      order.items.forEach(it => pushProduct(it?.sku));
    }
  }
}

function computeProductStats(state, skuValue) {
  const key = productKey(skuValue);
  if (!key) return {
    lastPoNumber: null,
    lastOrderDate: null,
    avgUnitPriceUsd: null,
    lastQty: null,
    poCount: 0,
  };
  const orders = Array.isArray(state.pos) ? state.pos : [];
  const relevant = orders
    .filter(rec => productKey(rec?.sku) === key || (Array.isArray(rec?.items) && rec.items.some(it => productKey(it?.sku) === key)))
    .sort((a, b) => {
      const da = a?.orderDate || "";
      const db = b?.orderDate || "";
      return db.localeCompare(da);
    });
  if (!relevant.length) {
    return {
      lastPoNumber: null,
      lastOrderDate: null,
      avgUnitPriceUsd: null,
      lastQty: null,
      poCount: 0,
    };
  }
  const last = relevant[0];
  const qtyValues = relevant
    .flatMap(rec => Array.isArray(rec.items) && rec.items.length
      ? rec.items.filter(it => productKey(it?.sku) === key).map(it => Number(it.units) || 0)
      : [Number(rec.units) || 0])
    .filter(v => Number.isFinite(v));
  const unitPrices = relevant
    .flatMap(rec => Array.isArray(rec.items) && rec.items.length
      ? rec.items.filter(it => productKey(it?.sku) === key).map(it => parseEuro(it.unitCostUsd))
      : [parseEuro(rec.unitCostUsd)])
    .filter(v => Number.isFinite(v) && v > 0);
  const avg = unitPrices.length
    ? unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length
    : null;
  return {
    lastPoNumber: last.poNumber || last.number || null,
    lastOrderDate: last.orderDate || null,
    avgUnitPriceUsd: avg,
    lastQty: qtyValues.length ? qtyValues[0] : null,
    poCount: relevant.length,
  };
}

function normaliseProductInput(input) {
  if (!input || typeof input !== "object") throw new Error("Produktdaten erforderlich");
  const sku = String(input.sku || "").trim();
  if (!sku) throw new Error("SKU darf nicht leer sein.");
  const alias = cleanAlias(input.alias, sku);
  const supplierId = input.supplierId != null ? String(input.supplierId).trim() : "";
  const status = PRODUCT_STATUS.has(input.status) ? input.status : "active";
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean).map(t => String(t).trim()) : [];
  const template = normaliseTemplate(input.template);
  const vatRate = Number(String(input.vatRate ?? "19").replace(",", ".")) || 19;
  const jurisdiction = input.jurisdiction || "DE";
  const returnsRate = Number(String(input.returnsRate ?? "0").replace(",", ".")) || 0;
  const vatExempt = input.vatExempt === true;
  return { sku, alias, supplierId, status, tags, template, vatRate, jurisdiction, returnsRate, vatExempt };
}

function updateProductStatsMeta(state, product) {
  if (!product) return product;
  const stats = computeProductStats(state, product.sku);
  return { ...product, stats };
}

function ensureStatusSection(state){
  const target = state || {};
  if (!target.status || typeof target.status !== "object") {
    target.status = { autoManualCheck: false, events: {} };
  }
  if (typeof target.status.autoManualCheck !== "boolean") {
    target.status.autoManualCheck = false;
  }
  if (!target.status.events || typeof target.status.events !== "object") {
    target.status.events = {};
  }
  return target.status;
}

function broadcastStateChanged(){
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event("state:changed"));
    }
  } catch {}
}

let _state = null;
const listeners = new Set();

export function createEmptyState(){
  const clone = structuredClone(defaults);
  ensureStatusSection(clone);
  ensureFixcostContainers(clone);
  ensurePoTemplates(clone);
  ensureProducts(clone);
  ensureOrders(clone, "pos");
  ensureOrders(clone, "fos");
  ensureVatData(clone);
  ensureForecast(clone);
  return clone;
}

export function loadState(){
  if (_state) return _state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _state = raw ? { ...structuredClone(defaults), ...JSON.parse(raw) } : structuredClone(defaults);
  } catch {
    _state = structuredClone(defaults);
  }
  ensureStatusSection(_state);
  ensureFixcostContainers(_state);
  ensurePoTemplates(_state);
  ensureProducts(_state);
  ensureOrders(_state, "pos");
  ensureOrders(_state, "fos");
  ensureVatData(_state);
  ensureForecast(_state);
  migrateLegacyOutgoings(_state);
  migrateProducts(_state);
  return _state;
}

export function saveState(s){
  _state = s || _state || structuredClone(defaults);
  ensureStatusSection(_state);
  ensureFixcostContainers(_state);
  ensurePoTemplates(_state);
  ensureProducts(_state);
  ensureOrders(_state, "pos");
  ensureOrders(_state, "fos");
  ensureVatData(_state);
  ensureForecast(_state);
  try {
    const { _computed, ...clean } = _state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  for (const fn of listeners) try { fn(_state); } catch {}
}

export function addStateListener(fn){
  listeners.add(fn);
  return ()=>listeners.delete(fn);
}

export function exportState(state){
  const payload = state || loadState();
  const fileName = `amazon-fba-cashflow-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function importStateFile(file, cb){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result || '{}');
      ensureStatusSection(json);
      ensureFixcostContainers(json);
      ensureForecast(json);
      migrateLegacyOutgoings(json);
      cb(json);
    } catch (err) {
      cb({ __error: err?.message || 'Ungültige JSON-Datei' });
    }
  };
  reader.onerror = () => {
    cb({ __error: reader.error?.message || 'Datei konnte nicht gelesen werden' });
  };
  reader.readAsText(file, 'utf-8');
}

export function getStatusSnapshot(){
  const state = loadState();
  return ensureStatusSection(state);
}

export function setAutoManualCheck(enabled){
  const state = loadState();
  const status = ensureStatusSection(state);
  const next = enabled === true;
  if (status.autoManualCheck === next) return;
  status.autoManualCheck = next;
  saveState(state);
  broadcastStateChanged();
}

export function setEventManualPaid(eventId, paid){
  if (!eventId) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  if (!map[eventId]) map[eventId] = {};
  const record = map[eventId];
  const next = typeof paid === "boolean" ? paid : Boolean(paid);
  if (record.manual === next) return;
  record.manual = next;
  saveState(state);
  broadcastStateChanged();
}

export function clearEventManualPaid(eventId){
  if (!eventId) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  if (!map[eventId] || typeof map[eventId].manual === "undefined") return;
  delete map[eventId].manual;
  if (!Object.keys(map[eventId]).length) delete map[eventId];
  saveState(state);
  broadcastStateChanged();
}

export function setEventsManualPaid(eventIds, paid){
  if (!Array.isArray(eventIds) || !eventIds.length) return;
  const state = loadState();
  const status = ensureStatusSection(state);
  const map = status.events;
  let changed = false;
  for (const id of eventIds) {
    if (!id) continue;
    if (!map[id]) map[id] = {};
    const record = map[id];
    const next = typeof paid === "boolean" ? paid : Boolean(paid);
    if (record.manual !== next) {
      record.manual = next;
      changed = true;
    }
  }
  if (changed) {
    saveState(state);
    broadcastStateChanged();
  }
}

export function getProductsSnapshot(){
  const state = loadState();
  ensureProducts(state);
  const list = state.products.map(prod => updateProductStatsMeta(state, prod));
  return list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export function getVatPreviewConfig(){
  const state = loadState();
  ensureVatData(state);
  return { settings: state.settings.vatPreview, months: state.vatPreviewMonths };
}

export function updateVatPreviewSettings(patch){
  if (!patch || typeof patch !== "object") return;
  const state = loadState();
  ensureVatData(state);
  const target = state.settings.vatPreview;
  if (typeof patch.eustLagMonths !== "undefined") target.eustLagMonths = Number(patch.eustLagMonths) || target.eustLagMonths;
  if (typeof patch.deShareDefault !== "undefined") target.deShareDefault = Number(patch.deShareDefault);
  if (typeof patch.feeRateDefault !== "undefined") target.feeRateDefault = Number(patch.feeRateDefault);
  if (typeof patch.fixInputDefault !== "undefined") target.fixInputDefault = Number(patch.fixInputDefault);
  if (typeof patch.fixVatLagMonths !== "undefined") target.fixVatLagMonths = Number(patch.fixVatLagMonths) || 0;
  if (typeof patch.fixVatCreditAtMonthEnd !== "undefined") target.fixVatCreditAtMonthEnd = patch.fixVatCreditAtMonthEnd !== false;
  saveState(state);
  broadcastStateChanged();
}

export function updateVatPreviewMonth(month, patch){
  if (!month || !patch || typeof patch !== "object") return;
  const state = loadState();
  ensureVatData(state);
  const target = state.vatPreviewMonths[month] || {};
  if (typeof patch.deShare !== "undefined") target.deShare = Number(patch.deShare);
  if (typeof patch.feeRateOfGross !== "undefined") target.feeRateOfGross = Number(patch.feeRateOfGross);
  if (typeof patch.fixInputVat !== "undefined") target.fixInputVat = Number(patch.fixInputVat);
  if (typeof patch.fixInputVatOverride !== "undefined") target.fixInputVatOverride = patch.fixInputVatOverride === null ? undefined : Number(patch.fixInputVatOverride);
  state.vatPreviewMonths[month] = target;
  saveState(state);
  broadcastStateChanged();
}

export function resetVatPreviewMonths(){
  const state = loadState();
  ensureVatData(state);
  state.vatPreviewMonths = {};
  saveState(state);
  broadcastStateChanged();
}

export function getProductBySku(sku){
  const state = loadState();
  ensureProducts(state);
  const key = productKey(sku);
  const match = state.products.find(prod => productKey(prod.sku) === key);
  return match ? updateProductStatsMeta(state, match) : null;
}

export function upsertProduct(input){
  const state = loadState();
  ensureProducts(state);

  const originalKey = input?.originalSku ? productKey(input.originalSku) : null;
  const normalised = normaliseProductInput(input);
  const nextKey = productKey(normalised.sku);
  const now = new Date().toISOString();

  let target = null;

  if (originalKey) {
    target = state.products.find(prod => productKey(prod.sku) === originalKey) || null;
  }

  const conflict = state.products.find(prod => productKey(prod.sku) === nextKey);
  if (conflict && conflict !== target) {
    throw new Error("Diese SKU existiert bereits.");
  }

  if (!target) {
    target = conflict || null;
  }

  if (!target) {
    target = {
      id: `prod-${Math.random().toString(36).slice(2, 9)}`,
      sku: normalised.sku,
      alias: normalised.alias,
      supplierId: normalised.supplierId,
      status: normalised.status,
      tags: normalised.tags,
      template: normalised.template,
      createdAt: now,
      updatedAt: now,
    };
    state.products.push(target);
  } else {
    target.alias = normalised.alias;
    target.supplierId = normalised.supplierId;
    target.status = normalised.status;
    target.tags = normalised.tags;
    target.template = normalised.template;
    target.updatedAt = now;
    target.sku = normalised.sku;
  }

  if (originalKey && nextKey !== originalKey) {
    state.products = state.products.filter(prod => prod === target || productKey(prod.sku) !== originalKey);
    if (Array.isArray(state.recentProducts)) {
      const seen = new Set();
      state.recentProducts = state.recentProducts
        .map(key => key === originalKey ? nextKey : key)
        .filter(key => {
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }
  }

  saveState(state);
  return updateProductStatsMeta(loadState(), target);
}

export function setProductStatus(sku, status){
  const state = loadState();
  ensureProducts(state);
  const key = productKey(sku);
  const target = state.products.find(prod => productKey(prod.sku) === key);
  if (!target) return null;
  target.status = PRODUCT_STATUS.has(status) ? status : "active";
  target.updatedAt = new Date().toISOString();
  saveState(state);
  return updateProductStatsMeta(loadState(), target);
}

export function deleteProductBySku(sku){
  const state = loadState();
  ensureProducts(state);
  const key = productKey(sku);
  const before = state.products.length;
  state.products = state.products.filter(prod => productKey(prod.sku) !== key);
  if (state.recentProducts && Array.isArray(state.recentProducts)) {
    state.recentProducts = state.recentProducts.filter(entry => entry !== key);
  }
  if (state.products.length !== before) saveState(state);
}

export function recordRecentProduct(sku){
  const state = loadState();
  ensureProducts(state);
  const key = productKey(sku);
  if (!key) return;
  const list = state.recentProducts;
  const existingIndex = list.indexOf(key);
  if (existingIndex !== -1) list.splice(existingIndex, 1);
  list.unshift(key);
  while (list.length > 5) list.pop();
  saveState(state);
}

export function getRecentProducts(){
  const state = loadState();
  ensureProducts(state);
  return state.recentProducts
    .map(key => state.products.find(prod => productKey(prod.sku) === key))
    .filter(Boolean)
    .map(prod => updateProductStatsMeta(state, prod));
}

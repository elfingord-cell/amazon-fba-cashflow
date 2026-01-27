// FBA-CF-0027 — Local Storage Layer (schlank, mit Listenern)
import { parseDeNumber } from "../lib/dataHealth.js";

export const STORAGE_KEY = "amazon_fba_cashflow_v1";
const CURRENCIES = ["EUR", "USD", "CNY"];

function parseEuro(value) {
  if (value == null) return 0;
  const parsed = parseDeNumber(String(value).replace(/€/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
    },
    transportLeadTimesDays: {
      air: 10,
      rail: 25,
      sea: 45,
    },
    defaultProductionLeadTimeDays: null,
    defaultBufferDays: 0,
    defaultCurrency: "EUR",
    defaultDdp: false,
    lastUpdatedAt: null,
    cny: {
      start: "",
      end: "",
    },
    cnyBlackoutByYear: {},
    productsTableColumns: {
      list: [],
      grid: [],
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
  productCategories: [],
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
    },
    forecastImport: {},
    forecastManual: {},
    lastImportAt: null,
    importSource: null,
  },
  status: {
    autoManualCheck: false,
    events: {},
  },
  actuals: [],
  monthlyActuals: {},
  suppliers: [],
  productSuppliers: [],
  payments: [],
  inventory: {
    snapshots: [],
    settings: {
      projectionMonths: 12,
      safetyDays: 60,
    },
  },
};

function ensureFixcostContainers(state) {
  if (!state) return;
  if (!Array.isArray(state.fixcosts)) state.fixcosts = [];
  if (!state.fixcostOverrides || typeof state.fixcostOverrides !== "object") {
    state.fixcostOverrides = {};
  }
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

function ensureProductCategories(state) {
  if (!state) return;
  if (!Array.isArray(state.productCategories)) {
    state.productCategories = [];
    return;
  }
  state.productCategories = state.productCategories
    .filter(Boolean)
    .map(entry => {
      const now = new Date().toISOString();
      const name = String(entry.name || "").trim();
      const sortOrder = entry.sortOrder != null ? Number(entry.sortOrder) : null;
      return {
        id: entry.id || `cat-${Math.random().toString(36).slice(2, 9)}`,
        name: name || "Ohne Kategorie",
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
      };
    });
}

function ensurePayments(state) {
  if (!state) return;
  if (!Array.isArray(state.payments)) state.payments = [];
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
  }

  if (!Array.isArray(state.vatCostRules)) {
    state.vatCostRules = structuredClone(defaults.vatCostRules);
  }

  if (!state.vatPreviewMonths || typeof state.vatPreviewMonths !== "object") {
    state.vatPreviewMonths = {};
  }
}

function ensureGlobalSettings(state) {
  if (!state) return;
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const settings = state.settings;
  if (!settings.transportLeadTimesDays || typeof settings.transportLeadTimesDays !== "object") {
    settings.transportLeadTimesDays = structuredClone(defaults.settings.transportLeadTimesDays);
  } else {
    const base = defaults.settings.transportLeadTimesDays;
    settings.transportLeadTimesDays.air = Number(settings.transportLeadTimesDays.air ?? base.air) || base.air;
    settings.transportLeadTimesDays.rail = Number(settings.transportLeadTimesDays.rail ?? base.rail) || base.rail;
    settings.transportLeadTimesDays.sea = Number(settings.transportLeadTimesDays.sea ?? base.sea) || base.sea;
  }
  if (settings.fxRate == null || String(settings.fxRate).trim() === "") {
    settings.fxRate = defaults.settings.fxRate;
  }
  const defaultProductionLeadTime = parseNumber(settings.defaultProductionLeadTimeDays ?? defaults.settings.defaultProductionLeadTimeDays);
  settings.defaultProductionLeadTimeDays = Number.isFinite(defaultProductionLeadTime) && defaultProductionLeadTime > 0
    ? defaultProductionLeadTime
    : null;
  settings.defaultBufferDays = Math.max(0, Number(settings.defaultBufferDays ?? defaults.settings.defaultBufferDays) || 0);
  settings.defaultCurrency = String(settings.defaultCurrency || defaults.settings.defaultCurrency || "EUR");
  settings.defaultDdp = settings.defaultDdp === true;
  settings.lastUpdatedAt = settings.lastUpdatedAt || null;
  if (!settings.cny || typeof settings.cny !== "object") {
    settings.cny = structuredClone(defaults.settings.cny);
  } else {
    settings.cny.start = settings.cny.start || "";
    settings.cny.end = settings.cny.end || "";
  }
  if (!settings.cnyBlackoutByYear || typeof settings.cnyBlackoutByYear !== "object") {
    settings.cnyBlackoutByYear = {};
  }
  if (!settings.productsTableColumns || typeof settings.productsTableColumns !== "object") {
    settings.productsTableColumns = structuredClone(defaults.settings.productsTableColumns);
  } else {
    if (!Array.isArray(settings.productsTableColumns.list)) settings.productsTableColumns.list = [];
    if (!Array.isArray(settings.productsTableColumns.grid)) settings.productsTableColumns.grid = [];
  }
}

function ensureSuppliers(state) {
  if (!state) return;
  if (!Array.isArray(state.suppliers)) {
    state.suppliers = [];
    return;
  }
  const normaliseSkuOverrides = (overrides) => {
    if (!overrides || typeof overrides !== "object") return {};
    return Object.entries(overrides).reduce((acc, [sku, values]) => {
      if (!sku) return acc;
      const entry = values && typeof values === "object" ? values : {};
      const productionLeadTimeDays = entry.productionLeadTimeDays != null ? Number(entry.productionLeadTimeDays) : null;
      acc[String(sku).trim()] = {
        productionLeadTimeDays: Number.isFinite(productionLeadTimeDays) ? productionLeadTimeDays : null,
      };
      return acc;
    }, {});
  };
  state.suppliers = state.suppliers
    .filter(Boolean)
    .map(entry => {
      const now = new Date().toISOString();
      const name = String(entry.name || "").trim();
      const currencyCandidate = String(entry.currencyDefault || "").trim().toUpperCase();
      const currencyDefault = CURRENCIES.includes(currencyCandidate)
        ? currencyCandidate
        : (defaults.settings.defaultCurrency || "EUR");
      return {
        ...entry,
        id: entry.id || `sup-${Math.random().toString(36).slice(2, 9)}`,
        name: name || "Unbenannt",
        company_name: entry.company_name != null ? String(entry.company_name).trim() : "",
        productionLeadTimeDaysDefault: entry.productionLeadTimeDaysDefault ?? 30,
        incotermDefault: entry.incotermDefault || "EXW",
        currencyDefault,
        paymentTermsDefault: Array.isArray(entry.paymentTermsDefault) ? entry.paymentTermsDefault : null,
        skuOverrides: normaliseSkuOverrides(entry.skuOverrides),
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
      };
    });
}

function ensureProductSuppliers(state) {
  if (!state) return;
  if (!Array.isArray(state.productSuppliers)) state.productSuppliers = [];
  const seenPreferred = new Set();
  state.productSuppliers = state.productSuppliers
    .filter(Boolean)
    .map(entry => {
      const now = new Date().toISOString();
      const normalized = {
        id: entry.id || `sp-${Math.random().toString(36).slice(2, 9)}`,
        supplierId: String(entry.supplierId || "").trim(),
        sku: String(entry.sku || "").trim(),
        isPreferred: Boolean(entry.isPreferred),
        isActive: entry.isActive !== false,
        supplierSku: entry.supplierSku != null ? String(entry.supplierSku) : "",
        unitPrice: entry.unitPrice != null ? entry.unitPrice : null,
        currency: CURRENCIES.includes(String(entry.currency || "").trim().toUpperCase())
          ? String(entry.currency || "").trim().toUpperCase()
          : (defaults.settings.defaultCurrency || "EUR"),
        productionLeadTimeDays: entry.productionLeadTimeDays != null ? Number(entry.productionLeadTimeDays) : null,
        incoterm: String(entry.incoterm || "").trim() || "EXW",
        paymentTermsTemplate: Array.isArray(entry.paymentTermsTemplate) ? entry.paymentTermsTemplate : null,
        minOrderQty: entry.minOrderQty != null ? Number(entry.minOrderQty) : null,
        notes: entry.notes != null ? String(entry.notes) : "",
        validFrom: entry.validFrom || null,
        validTo: entry.validTo || null,
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
      };
      if (!normalized.sku || !normalized.supplierId) return null;
      const key = productKey(normalized.sku);
      if (normalized.isPreferred) {
        if (seenPreferred.has(key)) normalized.isPreferred = false;
        else seenPreferred.add(key);
      }
      return normalized;
    })
    .filter(Boolean);
}

function ensureFos(state) {
  if (!state) return;
  if (!Array.isArray(state.fos)) {
    state.fos = [];
    return;
  }
  state.fos = state.fos
    .filter(Boolean)
    .map(entry => {
      const now = new Date().toISOString();
      return {
        ...entry,
        id: entry.id || `fo-${Math.random().toString(36).slice(2, 9)}`,
        status: entry.status || "DRAFT",
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
      };
    });
}

function ensureForecast(state) {
  if (!state) return;
  if (!state.forecast || typeof state.forecast !== "object") {
    state.forecast = structuredClone(defaults.forecast);
  }
  if (!Array.isArray(state.forecast.items)) state.forecast.items = [];
  if (!state.forecast.settings || typeof state.forecast.settings !== "object") {
    state.forecast.settings = { useForecast: false };
  } else {
    state.forecast.settings.useForecast = Boolean(state.forecast.settings.useForecast);
  }
  if (!state.forecast.forecastImport || typeof state.forecast.forecastImport !== "object") {
    state.forecast.forecastImport = {};
  }
  if (!state.forecast.forecastManual || typeof state.forecast.forecastManual !== "object") {
    state.forecast.forecastManual = {};
  }
  if (!state.forecast.lastImportAt) state.forecast.lastImportAt = null;
  if (!state.forecast.importSource) state.forecast.importSource = null;
  if (!Object.keys(state.forecast.forecastImport).length && state.forecast.items.length) {
    state.forecast.items.forEach(item => {
      if (!item?.sku || !item?.month) return;
      const skuKey = String(item.sku || "").trim();
      if (!skuKey) return;
      const monthKey = String(item.month || "").trim();
      const isManual = String(item.source || "").toLowerCase() === "manual";
      if (isManual) {
        if (!state.forecast.forecastManual[skuKey]) state.forecast.forecastManual[skuKey] = {};
        const units = Number(item.units ?? item.qty ?? item.quantity ?? NaN);
        if (Number.isFinite(units)) {
          state.forecast.forecastManual[skuKey][monthKey] = units;
        }
      } else {
        if (!state.forecast.forecastImport[skuKey]) state.forecast.forecastImport[skuKey] = {};
        state.forecast.forecastImport[skuKey][monthKey] = {
          units: item.units ?? item.qty ?? item.quantity ?? null,
          revenueEur: item.revenueEur ?? item.priceEur ?? item.price ?? null,
          profitEur: item.profitEur ?? null,
        };
      }
    });
  }
}

function ensureInventory(state) {
  if (!state) return;
  if (!state.inventory || typeof state.inventory !== "object") {
    state.inventory = structuredClone(defaults.inventory);
    return;
  }
  if (!Array.isArray(state.inventory.snapshots)) {
    state.inventory.snapshots = [];
  }
  const snapshots = [];
  state.inventory.snapshots.forEach(snapshot => {
    if (!snapshot || typeof snapshot !== "object") return;
    const month = String(snapshot.month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const cleanedItems = items
      .map(item => {
        if (!item || typeof item !== "object") return null;
        const sku = String(item.sku || "").trim();
        if (!sku) return null;
        const amazonUnits = Math.round(parseNumber(item.amazonUnits ?? 0) ?? 0);
        const threePLUnits = Math.round(parseNumber(item.threePLUnits ?? 0) ?? 0);
        return {
          sku,
          amazonUnits: Number.isFinite(amazonUnits) ? amazonUnits : 0,
          threePLUnits: Number.isFinite(threePLUnits) ? threePLUnits : 0,
          note: item.note != null ? String(item.note) : "",
        };
      })
      .filter(Boolean);
    snapshots.push({
      month,
      items: cleanedItems,
    });
  });
  state.inventory.snapshots = snapshots;
  if (!state.inventory.settings || typeof state.inventory.settings !== "object") {
    state.inventory.settings = structuredClone(defaults.inventory.settings);
  } else {
    const base = defaults.inventory.settings;
    const projectionMonths = Number(state.inventory.settings.projectionMonths ?? base.projectionMonths);
    const safetyDays = Number(state.inventory.settings.safetyDays ?? base.safetyDays);
    state.inventory.settings.projectionMonths = Number.isFinite(projectionMonths) && projectionMonths > 0
      ? projectionMonths
      : base.projectionMonths;
    state.inventory.settings.safetyDays = Number.isFinite(safetyDays) && safetyDays > 0
      ? safetyDays
      : base.safetyDays;
  }
}

function ensureActuals(state) {
  if (!state) return;
  if (!Array.isArray(state.actuals)) state.actuals = [];
}

function ensureMonthlyActuals(state) {
  if (!state) return;
  if (!state.monthlyActuals || typeof state.monthlyActuals !== "object") {
    state.monthlyActuals = {};
  }
  const cleaned = {};
  Object.entries(state.monthlyActuals).forEach(([month, values]) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const entry = values && typeof values === "object" ? values : {};
    const revenue = Number(entry.realRevenueEUR);
    const payoutRate = Number(entry.realPayoutRatePct);
    const closing = Number(entry.realClosingBalanceEUR);
    const normalized = {};
    if (Number.isFinite(revenue)) normalized.realRevenueEUR = revenue;
    if (Number.isFinite(payoutRate)) normalized.realPayoutRatePct = payoutRate;
    if (Number.isFinite(closing)) normalized.realClosingBalanceEUR = closing;
    if (Object.keys(normalized).length) cleaned[month] = normalized;
  });
  state.monthlyActuals = cleaned;

  if (!Object.keys(state.monthlyActuals).length && Array.isArray(state.actuals) && state.actuals.length) {
    state.actuals.forEach(entry => {
      if (!entry?.month) return;
      const month = String(entry.month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      const revenue = parseEuro(entry.revenueEur);
      const payout = parseEuro(entry.payoutEur);
      const closing = parseEuro(entry.closingBalanceEur);
      const normalized = {};
      if (Number.isFinite(revenue)) normalized.realRevenueEUR = revenue;
      if (Number.isFinite(closing)) normalized.realClosingBalanceEUR = closing;
      if (Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(payout)) {
        normalized.realPayoutRatePct = (payout / revenue) * 100;
      }
      if (Object.keys(normalized).length) {
        state.monthlyActuals[month] = normalized;
      }
    });
  }
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

function parseNumber(value) {
  return parseDeNumber(value);
}

function normaliseTemplate(template, options = {}) {
  if (!template || typeof template !== "object") return null;
  const next = {};
  if (template.scope) {
    next.scope = template.scope === "SKU_SUPPLIER" ? "SKU_SUPPLIER" : "SKU";
  }
  if (template.name) next.name = String(template.name);
  if (template.supplierId) next.supplierId = String(template.supplierId);
  const rawFields = template.fields && typeof template.fields === "object"
    ? template.fields
    : template;
  const transportRaw = rawFields.transportMode || rawFields.transport || "SEA";
  const currencyRaw = rawFields.currency || defaults.settings.defaultCurrency || "EUR";
  const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return null;
    if (value < min) return min;
    if (value > max) return max;
    return value;
  };
  const parseBoolean = (value) => {
    if (value === true || value === 1 || value === "true") return true;
    if (value === false || value === 0 || value === "false") return false;
    return false;
  };
  const normalizedFields = {
    unitPriceUsd: clamp(parseNumber(rawFields.unitPriceUsd ?? 0) ?? 0, 0, Number.POSITIVE_INFINITY),
    extraPerUnitUsd: clamp(parseNumber(rawFields.extraPerUnitUsd ?? 0) ?? 0, 0, Number.POSITIVE_INFINITY),
    extraFlatUsd: clamp(parseNumber(rawFields.extraFlatUsd ?? 0) ?? 0, 0, Number.POSITIVE_INFINITY),
    transportMode: String(transportRaw || "SEA").toUpperCase(),
    productionDays: Math.max(0, Math.round(parseNumber(rawFields.productionDays ?? 0) ?? 0)),
    transitDays: Math.max(0, Math.round(parseNumber(rawFields.transitDays ?? 0) ?? 0)),
    freightEur: clamp(parseNumber(rawFields.freightEur ?? 0) ?? 0, 0, Number.POSITIVE_INFINITY),
    dutyPct: clamp(parseNumber(rawFields.dutyPct ?? 0) ?? 0, 0, 100),
    dutyIncludesFreight: rawFields.dutyIncludesFreight === true,
    vatImportPct: clamp(parseNumber(rawFields.vatImportPct ?? 19) ?? 19, 0, 100),
    vatRefundActive: rawFields.vatRefundActive === true,
    vatRefundLag: Math.max(0, Math.round(parseNumber(rawFields.vatRefundLag ?? 0) ?? 0)),
    fxRate: parseNumber(rawFields.fxRate ?? defaults.settings.fxRate) ?? parseNumber(defaults.settings.fxRate) ?? 0,
    fxFeePct: clamp(parseNumber(rawFields.fxFeePct ?? 0) ?? 0, 0, 100),
    ddp: Boolean(rawFields.ddp),
    currency: ["USD", "EUR", "CNY"].includes(String(currencyRaw || "USD").toUpperCase())
      ? String(currencyRaw).toUpperCase()
      : "USD",
  };
  next.fields = normalizedFields;
  if (Array.isArray(template.milestones)) {
    next.milestones = template.milestones.map(row => ({
      id: row.id || `ms-${Math.random().toString(36).slice(2, 9)}`,
      label: row.label || "Milestone",
      percent: Number(row.percent) || 0,
      anchor: row.anchor || "ETA",
      lagDays: Number(row.lagDays) || 0,
    }));
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
        categoryId: prod.categoryId || prod.category_id || base.categoryId || null,
        avgSellingPriceGrossEUR: Number.isFinite(Number(prod.avgSellingPriceGrossEUR))
          ? Number(prod.avgSellingPriceGrossEUR)
          : (Number.isFinite(Number(base.avgSellingPriceGrossEUR)) ? Number(base.avgSellingPriceGrossEUR) : null),
        sellerboardMarginPct: Number.isFinite(Number(prod.sellerboardMarginPct))
          ? clampPercent(Number(prod.sellerboardMarginPct))
          : (Number.isFinite(Number(base.sellerboardMarginPct)) ? clampPercent(Number(base.sellerboardMarginPct)) : null),
        moqUnits: Number.isFinite(Number(prod.moqUnits))
          ? Math.max(0, Math.round(Number(prod.moqUnits)))
          : (Number.isFinite(Number(base.moqUnits)) ? Math.max(0, Math.round(Number(base.moqUnits))) : null),
        productionLeadTimeDaysDefault: Number.isFinite(Number(prod.productionLeadTimeDaysDefault))
          ? Number(prod.productionLeadTimeDaysDefault)
          : (Number.isFinite(Number(base.productionLeadTimeDaysDefault)) ? Number(base.productionLeadTimeDaysDefault) : null),
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
        avgSellingPriceGrossEUR: null,
        sellerboardMarginPct: null,
        moqUnits: null,
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
  const categoryValue = input.categoryId ?? input.category_id ?? null;
  const categoryId = categoryValue != null && String(categoryValue).trim()
    ? String(categoryValue).trim()
    : null;
  const status = PRODUCT_STATUS.has(input.status) ? input.status : "active";
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean).map(t => String(t).trim()) : [];
  const template = normaliseTemplate(input.template);
  const vatRate = Number(String(input.vatRate ?? "19").replace(",", ".")) || 19;
  const jurisdiction = input.jurisdiction || "DE";
  const returnsRate = Number(String(input.returnsRate ?? "0").replace(",", ".")) || 0;
  const vatExempt = input.vatExempt === true;
  const productionLeadTimeDaysDefault = parseNumber(input.productionLeadTimeDaysDefault ?? null);
  const moqUnitsRaw = parseNumber(input.moqUnits ?? input.moq ?? null);
  const moqUnits = Number.isFinite(moqUnitsRaw) ? Math.max(0, Math.round(moqUnitsRaw)) : null;
  const avgSellingPriceGrossEUR = parseNumber(input.avgSellingPriceGrossEUR ?? input.avgSellingPriceGrossEur ?? null);
  const sellerboardMarginRaw = parseNumber(input.sellerboardMarginPct ?? input.sellerboardMargin ?? null);
  const sellerboardMarginPct = Number.isFinite(sellerboardMarginRaw) ? clampPercent(sellerboardMarginRaw) : null;
  return {
    sku,
    alias,
    supplierId,
    categoryId,
    status,
    tags,
    template,
    vatRate,
    jurisdiction,
    returnsRate,
    vatExempt,
    moqUnits,
    productionLeadTimeDaysDefault: Number.isFinite(productionLeadTimeDaysDefault) ? productionLeadTimeDaysDefault : null,
    avgSellingPriceGrossEUR: Number.isFinite(avgSellingPriceGrossEUR) ? avgSellingPriceGrossEUR : null,
    sellerboardMarginPct,
  };
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
  ensureProductCategories(clone);
  ensureVatData(clone);
  ensureForecast(clone);
  ensureActuals(clone);
  ensureMonthlyActuals(clone);
  ensureGlobalSettings(clone);
  ensureSuppliers(clone);
  ensureProductSuppliers(clone);
  ensurePayments(clone);
  ensureFos(clone);
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
  ensureProductCategories(_state);
  ensureVatData(_state);
  ensureForecast(_state);
  ensureInventory(_state);
  ensureActuals(_state);
  ensureMonthlyActuals(_state);
  ensureGlobalSettings(_state);
  ensureSuppliers(_state);
  ensureProductSuppliers(_state);
  ensurePayments(_state);
  ensureFos(_state);
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
  ensureProductCategories(_state);
  ensureVatData(_state);
  ensureForecast(_state);
  ensureInventory(_state);
  ensureActuals(_state);
  ensureMonthlyActuals(_state);
  ensureGlobalSettings(_state);
  ensureSuppliers(_state);
  ensureProductSuppliers(_state);
  ensurePayments(_state);
  ensureFos(_state);
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
      ensurePoTemplates(json);
      ensureProducts(json);
      ensureProductCategories(json);
      ensureVatData(json);
      ensureForecast(json);
      ensureInventory(json);
      ensureActuals(json);
      ensureMonthlyActuals(json);
      ensureGlobalSettings(json);
      ensureSuppliers(json);
      ensureProductSuppliers(json);
      ensurePayments(json);
      ensureFos(json);
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

export function setProductsTableColumns(view, widths){
  if (!view || !Array.isArray(widths)) return;
  const state = loadState();
  ensureGlobalSettings(state);
  if (!state.settings.productsTableColumns || typeof state.settings.productsTableColumns !== "object") {
    state.settings.productsTableColumns = structuredClone(defaults.settings.productsTableColumns);
  }
  state.settings.productsTableColumns[view] = widths.map(val => Number(val)).filter(Number.isFinite);
  saveState(state);
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
      categoryId: normalised.categoryId,
      status: normalised.status,
      tags: normalised.tags,
      template: normalised.template,
      moqUnits: normalised.moqUnits,
      productionLeadTimeDaysDefault: normalised.productionLeadTimeDaysDefault,
      avgSellingPriceGrossEUR: normalised.avgSellingPriceGrossEUR,
      sellerboardMarginPct: normalised.sellerboardMarginPct,
      createdAt: now,
      updatedAt: now,
    };
    state.products.push(target);
  } else {
    target.alias = normalised.alias;
    target.supplierId = normalised.supplierId;
    target.categoryId = normalised.categoryId;
    target.status = normalised.status;
    target.tags = normalised.tags;
    target.template = normalised.template;
    target.moqUnits = normalised.moqUnits;
    target.productionLeadTimeDaysDefault = normalised.productionLeadTimeDaysDefault;
    target.avgSellingPriceGrossEUR = normalised.avgSellingPriceGrossEUR;
    target.sellerboardMarginPct = normalised.sellerboardMarginPct;
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

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  if (num > 100) return 100;
  return num;
}

function normalisePaymentTerms(terms) {
  if (!Array.isArray(terms) || !terms.length) return null;
  return terms.map(term => ({
    label: term.label ? String(term.label) : "Milestone",
    percent: clampPercent(term.percent ?? 0),
    triggerEvent: String(term.triggerEvent || "ORDER_DATE"),
    offsetDays: Number(term.offsetDays || 0),
    currency: term.currency ? String(term.currency) : undefined,
  }));
}

function normaliseProductSupplierInput(input = {}) {
  const currencyCandidate = String(input.currency || "").trim().toUpperCase();
  return {
    id: input.id,
    supplierId: String(input.supplierId || "").trim(),
    sku: String(input.sku || "").trim(),
    isPreferred: Boolean(input.isPreferred),
    isActive: input.isActive !== false,
    supplierSku: input.supplierSku != null ? String(input.supplierSku).trim() : "",
    unitPrice: input.unitPrice != null && input.unitPrice !== "" ? Number(input.unitPrice) : null,
    currency: CURRENCIES.includes(currencyCandidate) ? currencyCandidate : (defaults.settings.defaultCurrency || "EUR"),
    productionLeadTimeDays: input.productionLeadTimeDays != null && input.productionLeadTimeDays !== ""
      ? Number(input.productionLeadTimeDays)
      : null,
    incoterm: String(input.incoterm || "").trim() || "EXW",
    paymentTermsTemplate: normalisePaymentTerms(input.paymentTermsTemplate),
    minOrderQty: input.minOrderQty != null && input.minOrderQty !== "" ? Number(input.minOrderQty) : null,
    notes: input.notes != null ? String(input.notes) : "",
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
  };
}

export function upsertProductSupplier(input) {
  const state = loadState();
  ensureProductSuppliers(state);
  const normalised = normaliseProductSupplierInput(input);
  if (!normalised.sku || !normalised.supplierId) {
    throw new Error("Supplier und SKU sind erforderlich.");
  }
  const now = new Date().toISOString();
  let target = state.productSuppliers.find(entry => entry.id === normalised.id) || null;
  if (!target) {
    target = {
      id: normalised.id || `sp-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
    };
    state.productSuppliers.push(target);
  }
  Object.assign(target, normalised, { updatedAt: now, createdAt: target.createdAt || now });
  if (target.isPreferred) {
    const skuKey = productKey(target.sku);
    state.productSuppliers.forEach(entry => {
      if (entry.id !== target.id && productKey(entry.sku) === skuKey) {
        entry.isPreferred = false;
      }
    });
  }
  saveState(state);
  return target;
}

export function deleteProductSupplier(id) {
  if (!id) return;
  const state = loadState();
  ensureProductSuppliers(state);
  const before = state.productSuppliers.length;
  state.productSuppliers = state.productSuppliers.filter(entry => entry.id !== id);
  if (state.productSuppliers.length !== before) {
    saveState(state);
  }
}

export function setPreferredProductSupplier(id) {
  if (!id) return;
  const state = loadState();
  ensureProductSuppliers(state);
  const target = state.productSuppliers.find(entry => entry.id === id);
  if (!target) return;
  const skuKey = productKey(target.sku);
  state.productSuppliers.forEach(entry => {
    if (productKey(entry.sku) === skuKey) {
      entry.isPreferred = entry.id === id;
    }
  });
  target.updatedAt = new Date().toISOString();
  saveState(state);
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

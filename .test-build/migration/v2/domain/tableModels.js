"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCategoryLabelMap = buildCategoryLabelMap;
exports.buildSupplierLabelMap = buildSupplierLabelMap;
exports.buildProductGridRows = buildProductGridRows;
exports.isForecastProductActive = isForecastProductActive;
exports.normalizeManualMap = normalizeManualMap;
exports.serializeManualMap = serializeManualMap;
exports.getImportValue = getImportValue;
exports.getEffectiveUnits = getEffectiveUnits;
exports.deriveForecastValue = deriveForecastValue;
exports.buildForecastMonths = buildForecastMonths;
exports.buildForecastProducts = buildForecastProducts;
exports.filterForecastProducts = filterForecastProducts;
exports.buildForecastRevenueByMonth = buildForecastRevenueByMonth;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const productCompletenessV2_1 = require("./productCompletenessV2");
const months_1 = require("./months");
const planProducts_js_1 = require("../../domain/planProducts.js");
function asNumber(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function templateFields(product) {
    const template = (product.template && typeof product.template === "object")
        ? product.template
        : {};
    const fields = (template.fields && typeof template.fields === "object")
        ? template.fields
        : template;
    return fields || {};
}
function normalizeStatus(value) {
    const normalized = String(value || "active").trim().toLowerCase();
    if (normalized === "inactive")
        return "inactive";
    if (normalized === "prelaunch" || normalized === "not_launched" || normalized === "planned")
        return "prelaunch";
    return "active";
}
function buildCategoryLabelMap(state) {
    const map = new Map();
    (Array.isArray(state.productCategories) ? state.productCategories : []).forEach((entry) => {
        const row = entry;
        const id = String(row.id || "");
        if (!id)
            return;
        map.set(id, String(row.name || "Ohne Kategorie"));
    });
    return map;
}
function buildSupplierLabelMap(state) {
    const map = new Map();
    (Array.isArray(state.suppliers) ? state.suppliers : []).forEach((entry) => {
        const row = entry;
        const id = String(row.id || "");
        if (!id)
            return;
        map.set(id, String(row.name || ""));
    });
    return map;
}
function buildProductGridRows(input) {
    const products = Array.isArray(input.state.products) ? input.state.products : [];
    const mapped = products.map((entry, index) => {
        const product = entry;
        const template = templateFields(product);
        const sku = String(product.sku || "");
        const completeness = (0, productCompletenessV2_1.evaluateProductCompletenessV2)({ product, state: input.state })?.status || "blocked";
        return {
            id: String(product.id || (sku ? `prod-${sku}` : `prod-${index}`)),
            sku,
            alias: String(product.alias || ""),
            supplierId: String(product.supplierId || ""),
            categoryId: product.categoryId ? String(product.categoryId) : null,
            status: normalizeStatus(product.status),
            avgSellingPriceGrossEUR: asNumber(product.avgSellingPriceGrossEUR),
            templateUnitPriceUsd: asNumber(template.unitPriceUsd),
            landedUnitCostEur: asNumber(product.landedUnitCostEur),
            shippingPerUnitEur: asNumber(product.logisticsPerUnitEur ?? product.freightPerUnitEur ?? template.freightEur),
            sellerboardMarginPct: asNumber(product.sellerboardMarginPct),
            moqUnits: asNumber(product.moqUnits),
            hsCode: String(product.hsCode || "").trim(),
            goodsDescription: String(product.goodsDescription || "").trim(),
            completeness: completeness,
            raw: product,
        };
    });
    const needle = input.search.trim().toLowerCase();
    return mapped
        .filter((row) => {
        if (input.statusFilter !== "all" && row.status !== input.statusFilter)
            return false;
        if (!needle)
            return true;
        const haystack = [
            row.sku,
            row.alias,
            row.supplierId,
            row.categoryId || "",
            row.hsCode,
            row.goodsDescription,
            input.supplierLabelById.get(row.supplierId) || "",
            input.categoryLabelById.get(row.categoryId || "") || "",
        ].join(" ").toLowerCase();
        return haystack.includes(needle);
    })
        .sort((a, b) => a.sku.localeCompare(b.sku));
}
function isForecastProductActive(product) {
    if (typeof product.active === "boolean")
        return product.active;
    const status = String(product.status || "").trim().toLowerCase();
    if (!status)
        return true;
    return status === "active" || status === "aktiv" || status === "prelaunch" || status === "not_launched" || status === "planned";
}
function normalizeManualMap(source) {
    const out = {};
    if (!source || typeof source !== "object")
        return out;
    Object.entries(source).forEach(([sku, monthMap]) => {
        if (!monthMap || typeof monthMap !== "object")
            return;
        const nextMonthMap = {};
        Object.entries(monthMap).forEach(([monthRaw, value]) => {
            const month = (0, months_1.normalizeMonthKey)(monthRaw);
            const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
            if (!month || !Number.isFinite(parsed))
                return;
            nextMonthMap[month] = parsed;
        });
        if (Object.keys(nextMonthMap).length)
            out[sku] = nextMonthMap;
    });
    return out;
}
function serializeManualMap(source) {
    const out = {};
    Object.entries(source || {}).forEach(([sku, monthMap]) => {
        const nextMonthMap = {};
        Object.entries(monthMap || {}).forEach(([month, value]) => {
            if (!(0, months_1.normalizeMonthKey)(month))
                return;
            if (!Number.isFinite(value))
                return;
            nextMonthMap[month] = value;
        });
        if (Object.keys(nextMonthMap).length)
            out[sku] = nextMonthMap;
    });
    return out;
}
function getImportValue(forecastImport, sku, month) {
    const skuMap = forecastImport?.[sku];
    if (!skuMap || typeof skuMap !== "object")
        return null;
    const row = skuMap[month];
    if (!row || typeof row !== "object")
        return null;
    return {
        sku,
        month,
        units: (0, dataHealth_js_1.parseDeNumber)(row.units),
        revenueEur: (0, dataHealth_js_1.parseDeNumber)(row.revenueEur),
        profitEur: (0, dataHealth_js_1.parseDeNumber)(row.profitEur),
    };
}
function getEffectiveUnits(manual, forecastImport, sku, month, plannedUnitsByMonth) {
    const planned = plannedUnitsByMonth?.[month];
    if (Number.isFinite(planned))
        return Number(planned);
    const manualValue = manual?.[sku]?.[month];
    if (Number.isFinite(manualValue))
        return manualValue;
    return getImportValue(forecastImport, sku, month)?.units ?? null;
}
function deriveForecastValue(view, units, product) {
    if (!Number.isFinite(units))
        return null;
    if (view === "units")
        return Number(units);
    const price = product.avgSellingPriceGrossEUR;
    if (!Number.isFinite(price))
        return null;
    const revenue = Number(units) * Number(price);
    if (view === "revenue")
        return revenue;
    const margin = product.sellerboardMarginPct;
    if (!Number.isFinite(margin))
        return null;
    return revenue * (Number(margin) / 100);
}
function buildForecastMonths(settings) {
    const startMonth = (0, months_1.normalizeMonthKey)(settings.startMonth) || (0, months_1.currentMonthKey)();
    const horizon = Number(settings.horizonMonths);
    const count = Number.isFinite(horizon) && horizon > 0 ? Math.round(horizon) : 18;
    return (0, months_1.monthRange)(startMonth, count);
}
function buildForecastProducts(state, categoriesById) {
    const liveRows = (Array.isArray(state.products) ? state.products : [])
        .map((entry) => {
        const product = entry;
        const sku = String(product.sku || "").trim();
        if (!sku)
            return null;
        return {
            sku,
            alias: String(product.alias || sku),
            categoryLabel: categoriesById.get(String(product.categoryId || "")) || "Ohne Kategorie",
            isActive: isForecastProductActive(product),
            avgSellingPriceGrossEUR: (0, dataHealth_js_1.parseDeNumber)(product.avgSellingPriceGrossEUR),
            sellerboardMarginPct: (0, dataHealth_js_1.parseDeNumber)(product.sellerboardMarginPct),
            sourceLabel: "csv",
        };
    })
        .filter(Boolean);
    const planMonths = buildForecastMonths((state.settings || {}));
    const planRows = (0, planProducts_js_1.buildPlanProductForecastRows)({ state, months: planMonths })
        .map((row) => ({
        sku: String(row.key || ""),
        alias: String(row.alias || ""),
        categoryLabel: row.categoryId
            ? (categoriesById.get(String(row.categoryId || "")) || "Neue Produkte (Plan)")
            : "Neue Produkte (Plan)",
        isActive: String(row.status || "active") === "active",
        avgSellingPriceGrossEUR: (0, dataHealth_js_1.parseDeNumber)(row.avgSellingPriceGrossEUR),
        sellerboardMarginPct: (0, dataHealth_js_1.parseDeNumber)(row.sellerboardMarginPct),
        isPlan: true,
        plannedSku: row.plannedSku ? String(row.plannedSku) : null,
        sourceLabel: "plan",
        relationType: row.relationType ? String(row.relationType) : null,
        seasonalityReferenceSku: row.seasonalityReferenceSku ? String(row.seasonalityReferenceSku) : null,
        baselineReferenceMonth: (0, dataHealth_js_1.parseDeNumber)(row.baselineReferenceMonth),
        baselineUnitsInReferenceMonth: (0, dataHealth_js_1.parseDeNumber)(row.baselineUnitsInReferenceMonth),
        launchDate: row.launchDate ? String(row.launchDate) : null,
        rampUpWeeks: (0, dataHealth_js_1.parseDeNumber)(row.rampUpWeeks),
        softLaunchStartSharePct: (0, dataHealth_js_1.parseDeNumber)(row.softLaunchStartSharePct),
        planProductId: row.id ? String(row.id) : null,
        plannedUnitsByMonth: (row.unitsByMonth && typeof row.unitsByMonth === "object")
            ? row.unitsByMonth
            : {},
    }))
        .filter((row) => row.sku && row.alias);
    return [...liveRows, ...planRows]
        .sort((a, b) => {
        const category = String(a.categoryLabel || "").localeCompare(String(b.categoryLabel || ""));
        if (category !== 0)
            return category;
        return String(a.alias || a.sku).localeCompare(String(b.alias || b.sku));
    });
}
function filterForecastProducts(input) {
    const needle = input.search.trim().toLowerCase();
    return input.products
        .filter((product) => {
        if (input.onlyActive && !product.isActive)
            return false;
        if (needle) {
            const haystack = [product.sku, product.alias, product.categoryLabel].join(" ").toLowerCase();
            if (!haystack.includes(needle))
                return false;
        }
        if (input.onlyWithForecast) {
            const hasValue = input.visibleMonths.some((month) => {
                const value = getEffectiveUnits(input.manualDraft, input.forecastImport, product.sku, month, product.plannedUnitsByMonth);
                return Number.isFinite(value) && Number(value) > 0;
            });
            if (!hasValue)
                return false;
        }
        return true;
    })
        .sort((a, b) => a.sku.localeCompare(b.sku));
}
function buildForecastRevenueByMonth(input) {
    const map = new Map();
    input.allMonths.forEach((month) => map.set(month, 0));
    input.products.forEach((product) => {
        if (!product.isActive)
            return;
        input.allMonths.forEach((month) => {
            const units = getEffectiveUnits(input.manualDraft, input.forecastImport, product.sku, month, product.plannedUnitsByMonth);
            const revenue = deriveForecastValue("revenue", units, product);
            if (!Number.isFinite(revenue))
                return;
            map.set(month, (map.get(month) || 0) + Number(revenue));
        });
    });
    return map;
}

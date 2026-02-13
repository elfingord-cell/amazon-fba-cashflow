"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateProductCompleteness = evaluateProductCompleteness;
exports.getProductCompleteness = getProductCompleteness;
const productDefaults_js_1 = require("./productDefaults.js");
function normalizeText(value) {
    return String(value || "").trim();
}
function resolveCurrencyWithSource({ product, productSupplier, supplier, settings }) {
    const template = product?.template?.fields || product?.template || {};
    let source = null;
    let candidate = null;
    if (productSupplier?.currency) {
        source = "productSupplier";
        candidate = productSupplier.currency;
    }
    else if (supplier?.currencyDefault) {
        source = "supplier";
        candidate = supplier.currencyDefault;
    }
    else if (template.currency) {
        source = "template";
        candidate = template.currency;
    }
    else if (settings?.defaultCurrency) {
        source = "settings";
        candidate = settings.defaultCurrency;
    }
    const normalized = String(candidate || "EUR").trim().toUpperCase();
    const value = ["EUR", "USD", "CNY"].includes(normalized) ? normalized : "EUR";
    if (!source && value === "EUR")
        return { value, source: "fallback" };
    return { value, source };
}
function resolveDutyRateWithSource({ product, settings }) {
    const template = product?.template?.fields || product?.template || {};
    const productValue = (0, productDefaults_js_1.toNumber)(product?.dutyRatePct);
    if (productValue != null)
        return { value: productValue, source: "product" };
    const templateValue = (0, productDefaults_js_1.toNumber)(template.dutyPct);
    if (templateValue != null)
        return { value: templateValue, source: "template" };
    const settingsValue = (0, productDefaults_js_1.toNumber)(settings?.dutyRatePct);
    if (settingsValue != null)
        return { value: settingsValue, source: "settings" };
    return { value: null, source: null };
}
function resolveEustRateWithSource({ product, settings }) {
    const template = product?.template?.fields || product?.template || {};
    const productValue = (0, productDefaults_js_1.toNumber)(product?.eustRatePct);
    if (productValue != null)
        return { value: productValue, source: "product" };
    const templateValue = (0, productDefaults_js_1.toNumber)(template.vatImportPct);
    if (templateValue != null)
        return { value: templateValue, source: "template" };
    const settingsValue = (0, productDefaults_js_1.toNumber)(settings?.eustRatePct);
    if (settingsValue != null)
        return { value: settingsValue, source: "settings" };
    return { value: null, source: null };
}
function buildFieldStatus(fieldKey, label) {
    return { fieldKey, label };
}
function evaluateProductCompleteness(product, ctx = {}) {
    const state = ctx.state || {};
    const settings = ctx.settings || state.settings || {};
    const suppliers = ctx.suppliers || state.suppliers || [];
    const productSuppliers = ctx.productSuppliers || state.productSuppliers || [];
    const pos = ctx.pos || state.pos || [];
    const fos = ctx.fos || state.fos || [];
    const blockingMissing = [];
    const defaulted = [];
    const suggestedMissing = [];
    const sku = normalizeText(product?.sku);
    if (!sku)
        blockingMissing.push(buildFieldStatus("sku", "SKU", {}));
    const alias = normalizeText(product?.alias);
    if (!alias)
        blockingMissing.push(buildFieldStatus("alias", "Alias", {}));
    if (!normalizeText(product?.categoryId)) {
        blockingMissing.push(buildFieldStatus("categoryId", "Kategorie", {}));
    }
    const { product: resolvedProduct, supplier, productSupplier } = (0, productDefaults_js_1.resolveSupplierContext)({ products: [product].filter(Boolean), suppliers, productSuppliers, pos, fos }, sku, product?.supplierId);
    const unitPrice = (0, productDefaults_js_1.resolveUnitPriceUsd)({ product: resolvedProduct, productSupplier });
    const currency = resolveCurrencyWithSource({ product: resolvedProduct, productSupplier, supplier, settings });
    const hasUnitPrice = unitPrice.value != null && unitPrice.value > 0;
    const hasCurrency = Boolean(currency.value);
    if (!hasUnitPrice || !hasCurrency) {
        blockingMissing.push(buildFieldStatus("unitPriceUsd", "Stückpreis (Währung)", {}));
    }
    else if (unitPrice.source !== "product" || !["product", "template"].includes(currency.source)) {
        defaulted.push({
            fieldKey: "unitPriceUsd",
            label: "Stückpreis (Währung)",
            value: { amount: unitPrice.value, currency: currency.value },
        });
    }
    const leadTime = (0, productDefaults_js_1.resolveProductionLeadTimeDays)({
        product: resolvedProduct,
        productSupplier,
        supplier,
        settings,
    });
    if (!leadTime.value) {
        blockingMissing.push(buildFieldStatus("productionLeadTimeDaysDefault", "Produktionszeit (Tage)", {}));
    }
    else if (leadTime.source !== "product") {
        defaulted.push({
            fieldKey: "productionLeadTimeDaysDefault",
            label: "Produktionszeit (Tage)",
            value: leadTime.value,
        });
    }
    const transportMode = (0, productDefaults_js_1.resolveTransportMode)({ product: resolvedProduct, transportMode: resolvedProduct?.defaultTransportMode });
    const transportLeadTime = (0, productDefaults_js_1.resolveTransportLeadTimeDays)({
        settings,
        product: resolvedProduct,
        transportMode,
    });
    if (!transportLeadTime.value) {
        blockingMissing.push(buildFieldStatus("transitDays", "Transit-Tage", {}));
    }
    else if (transportLeadTime.source !== "product") {
        defaulted.push({
            fieldKey: "transitDays",
            label: "Transit-Tage",
            value: transportLeadTime.value,
        });
    }
    const moqValue = (0, productDefaults_js_1.toNumber)(product?.moqOverrideUnits ?? product?.moqUnits);
    const moqDefault = (0, productDefaults_js_1.toNumber)(settings?.moqDefaultUnits);
    if (moqValue == null || moqValue <= 0) {
        if (moqDefault != null && moqDefault > 0) {
            defaulted.push({ fieldKey: "moqUnits", label: "MOQ", value: moqDefault });
        }
        else {
            blockingMissing.push(buildFieldStatus("moqUnits", "MOQ", {}));
        }
    }
    const dutyRate = resolveDutyRateWithSource({ product: resolvedProduct, settings });
    if (dutyRate.value == null) {
        blockingMissing.push(buildFieldStatus("dutyPct", "Zoll %", {}));
    }
    else if (dutyRate.source === "settings") {
        defaulted.push({ fieldKey: "dutyPct", label: "Zoll %", value: dutyRate.value });
    }
    const eustRate = resolveEustRateWithSource({ product: resolvedProduct, settings });
    if (eustRate.value == null) {
        blockingMissing.push(buildFieldStatus("vatImportPct", "EUSt %", {}));
    }
    else if (eustRate.source === "settings") {
        defaulted.push({ fieldKey: "vatImportPct", label: "EUSt %", value: eustRate.value });
    }
    const avgSellingPrice = (0, productDefaults_js_1.toNumber)(product?.avgSellingPriceGrossEUR);
    if (avgSellingPrice == null || avgSellingPrice <= 0) {
        blockingMissing.push(buildFieldStatus("avgSellingPriceGrossEUR", "Ø VK-Preis (Brutto)", {}));
    }
    const sellerboardMargin = (0, productDefaults_js_1.toNumber)(product?.sellerboardMarginPct);
    if (sellerboardMargin == null) {
        suggestedMissing.push(buildFieldStatus("sellerboardMarginPct", "Sellerboard Marge", {}));
    }
    const landedCost = (0, productDefaults_js_1.toNumber)(product?.landedUnitCostEur);
    if (landedCost == null) {
        suggestedMissing.push(buildFieldStatus("landedUnitCostEur", "Einstandspreis (EUR)", {}));
    }
    const statusValue = blockingMissing.length ? "blocked" : "ok";
    return {
        status: statusValue,
        blockingMissing,
        defaulted,
        suggestedMissing,
    };
}
function getProductCompleteness(product, globalSettings = {}) {
    const ctx = globalSettings?.state ? globalSettings : { settings: globalSettings };
    return evaluateProductCompleteness(product, ctx);
}

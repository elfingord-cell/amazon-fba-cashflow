"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMasterDataHierarchy = resolveMasterDataHierarchy;
exports.applyAdoptedFieldToProduct = applyAdoptedFieldToProduct;
exports.sourceChipClass = sourceChipClass;
exports.isBlockScope = isBlockScope;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const CURRENCIES = new Set(["EUR", "USD", "CNY"]);
const INCOTERMS = new Set(["EXW", "FOB", "DDP", "FCA", "DAP", "CIF"]);
function normalizeText(value) {
    return String(value || "").trim();
}
function asNumber(value) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return null;
    return Number(parsed);
}
function asPositiveNumber(value) {
    const parsed = asNumber(value);
    if (!Number.isFinite(parsed))
        return null;
    const numeric = Number(parsed);
    return numeric > 0 ? numeric : null;
}
function asPercent(value) {
    const parsed = asNumber(value);
    if (!Number.isFinite(parsed))
        return null;
    const numeric = Number(parsed);
    if (numeric < 0)
        return null;
    return numeric;
}
function asBool(value) {
    if (value === true || value === false)
        return value;
    if (value === 1 || value === "1" || value === "true")
        return true;
    if (value === 0 || value === "0" || value === "false")
        return false;
    return null;
}
function asCurrency(value) {
    const upper = normalizeText(value).toUpperCase();
    if (!upper)
        return null;
    if (!CURRENCIES.has(upper))
        return null;
    return upper;
}
function asIncoterm(value) {
    const upper = normalizeText(value).toUpperCase();
    if (!upper)
        return null;
    if (!INCOTERMS.has(upper))
        return null;
    return upper;
}
function sourceLabel(source, orderContext) {
    if (source === "order_override")
        return orderContext === "fo" ? "Diese FO" : orderContext === "po" ? "Diese PO" : "Produkt";
    if (source === "product")
        return "Produkt";
    if (source === "supplier")
        return "Lieferant";
    if (source === "settings")
        return "Settings";
    return "Fehlt";
}
function isEqualValue(left, right) {
    if (typeof left === "number" || typeof right === "number") {
        const a = asNumber(left);
        const b = asNumber(right);
        if (a == null || b == null)
            return false;
        return Math.abs(a - b) < 0.00001;
    }
    if (typeof left === "boolean" || typeof right === "boolean") {
        const a = asBool(left);
        const b = asBool(right);
        return a != null && b != null && a === b;
    }
    return normalizeText(left) === normalizeText(right);
}
function firstValid(candidates, validator) {
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (validator(candidate.value))
            return candidate;
    }
    return null;
}
function resolveHierarchyField(input) {
    const base = firstValid(input.candidates, input.isValid);
    const override = input.parse(input.orderOverrideRaw);
    const hasOverride = input.isValid(override) && (!base || !isEqualValue(override, base.value));
    if (hasOverride) {
        return {
            value: override,
            source: "order_override",
            label: sourceLabel("order_override", input.orderContext),
            required: input.required,
            blocking: false,
            reason: input.reason,
            canReset: true,
            canAdopt: input.orderContext === "fo" || input.orderContext === "po",
        };
    }
    if (base) {
        return {
            value: base.value,
            source: base.source,
            label: sourceLabel(base.source, input.orderContext),
            required: input.required,
            blocking: false,
            reason: input.reason,
            canReset: false,
            canAdopt: false,
        };
    }
    return {
        value: null,
        source: "missing",
        label: sourceLabel("missing", input.orderContext),
        required: input.required,
        blocking: input.required,
        reason: input.reason,
        canReset: false,
        canAdopt: false,
    };
}
function templateFields(product) {
    const source = (product?.template && typeof product.template === "object")
        ? product.template
        : {};
    const fields = (source.fields && typeof source.fields === "object")
        ? source.fields
        : source;
    return fields || {};
}
function findProductBySku(state, sku) {
    const needle = normalizeText(sku).toLowerCase();
    if (!needle)
        return null;
    const products = Array.isArray(state.products) ? state.products : [];
    return products.find((entry) => normalizeText(entry?.sku).toLowerCase() === needle) || null;
}
function findSupplierById(state, supplierId) {
    const needle = normalizeText(supplierId);
    if (!needle)
        return null;
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    return suppliers.find((entry) => normalizeText(entry?.id) === needle) || null;
}
function findProductSupplierLink(state, sku, supplierId) {
    const skuKey = normalizeText(sku).toLowerCase();
    if (!skuKey)
        return null;
    const links = Array.isArray(state.productSuppliers) ? state.productSuppliers : [];
    const matches = links.filter((entry) => normalizeText(entry?.sku).toLowerCase() === skuKey);
    if (!matches.length)
        return null;
    if (supplierId) {
        const direct = matches.find((entry) => normalizeText(entry?.supplierId) === supplierId);
        if (direct)
            return direct;
    }
    const preferred = matches.find((entry) => entry?.isPreferred === true);
    return preferred || matches[0] || null;
}
function resolveTransportMode(template, orderOverrides) {
    const override = normalizeText(orderOverrides.transportMode || orderOverrides.transport || "").toUpperCase();
    if (override)
        return override;
    const productMode = normalizeText(template.transportMode || template.transport || "").toUpperCase();
    if (productMode)
        return productMode;
    return "SEA";
}
function resolveMasterDataHierarchy(input) {
    const state = input.state || {};
    const orderContext = input.orderContext || "product";
    const orderOverrides = (input.orderOverrides && typeof input.orderOverrides === "object")
        ? input.orderOverrides
        : {};
    const seedSku = normalizeText(input.sku || input.product?.sku);
    const resolvedProduct = (input.product && typeof input.product === "object")
        ? input.product
        : findProductBySku(state, seedSku);
    const sku = normalizeText(seedSku || resolvedProduct?.sku);
    const product = resolvedProduct || null;
    const supplierId = normalizeText(input.supplierId || orderOverrides.supplierId || product?.supplierId);
    const productSupplier = findProductSupplierLink(state, sku, supplierId);
    const resolvedSupplierId = normalizeText(supplierId || productSupplier?.supplierId);
    const supplier = findSupplierById(state, resolvedSupplierId);
    const settings = (state.settings && typeof state.settings === "object")
        ? state.settings
        : {};
    const template = templateFields(product);
    const transportMode = resolveTransportMode(template, orderOverrides);
    const settingsTransport = (settings.transportLeadTimesDays && typeof settings.transportLeadTimesDays === "object")
        ? settings.transportLeadTimesDays
        : {};
    const unitPriceUsd = resolveHierarchyField({
        orderContext,
        required: true,
        reason: "EK Preis USD fehlt.",
        orderOverrideRaw: orderOverrides.unitPrice ?? orderOverrides.unitCostUsd,
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(template.unitPriceUsd ?? product?.unitPriceUsd ?? product?.unitPrice) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.unitPrice ?? supplier?.unitPriceDefault) },
        ],
    });
    const avgSellingPriceGrossEur = resolveHierarchyField({
        orderContext,
        required: true,
        reason: "VK Preis Brutto fehlt.",
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(product?.avgSellingPriceGrossEUR) },
        ],
    });
    const marginPct = resolveHierarchyField({
        orderContext,
        required: true,
        reason: "Marge muss > 0 sein.",
        parse: asPercent,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPercent(product?.sellerboardMarginPct) },
        ],
    });
    const moqUnits = resolveHierarchyField({
        orderContext,
        required: true,
        reason: "MOQ fehlt.",
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(product?.moqOverrideUnits ?? product?.moqUnits) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.minOrderQty ?? supplier?.moqDefaultUnits ?? supplier?.minOrderQty) },
            { source: "settings", value: asPositiveNumber(settings.moqDefaultUnits) },
        ],
    });
    const productionLeadTimeDays = resolveHierarchyField({
        orderContext,
        required: true,
        reason: "Production Lead Time fehlt.",
        orderOverrideRaw: orderOverrides.productionLeadTimeDays ?? orderOverrides.prodDays,
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(product?.productionLeadTimeDaysDefault ?? template.productionDays) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.productionLeadTimeDays ?? supplier?.productionLeadTimeDaysDefault) },
            { source: "settings", value: asPositiveNumber(settings.defaultProductionLeadTimeDays) },
        ],
    });
    const transitDays = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "Transit Lead Time fehlt.",
        orderOverrideRaw: orderOverrides.logisticsLeadTimeDays ?? orderOverrides.transitDays,
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(template.transitDays ?? product?.transitDays) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.transitDays ?? supplier?.transitDaysDefault) },
            { source: "settings", value: asPositiveNumber(settingsTransport[transportMode.toLowerCase()]) },
            { source: "settings", value: asPositiveNumber(settingsTransport.sea) },
        ],
    });
    const logisticsPerUnitEur = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "Logistik pro Einheit fehlt.",
        orderOverrideRaw: orderOverrides.logisticsPerUnitEur ?? orderOverrides.freightPerUnitEur,
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(product?.logisticsPerUnitEur ?? product?.freightPerUnitEur ?? template.freightEur) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.logisticsPerUnitEur) },
        ],
    });
    const dutyRatePct = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "Zollsatz fehlt.",
        orderOverrideRaw: orderOverrides.dutyRatePct,
        parse: asPercent,
        isValid: (value) => Number.isFinite(value) && Number(value) >= 0,
        candidates: [
            { source: "product", value: asPercent(product?.dutyRatePct ?? template.dutyPct) },
            { source: "supplier", value: asPercent(productSupplier?.dutyRatePct ?? supplier?.dutyRatePct) },
            { source: "settings", value: asPercent(settings.dutyRatePct) },
        ],
    });
    const eustRatePct = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "EUSt Satz fehlt.",
        orderOverrideRaw: orderOverrides.eustRatePct,
        parse: asPercent,
        isValid: (value) => Number.isFinite(value) && Number(value) >= 0,
        candidates: [
            { source: "product", value: asPercent(product?.eustRatePct ?? template.vatImportPct) },
            { source: "supplier", value: asPercent(productSupplier?.eustRatePct ?? supplier?.eustRatePct) },
            { source: "settings", value: asPercent(settings.eustRatePct) },
        ],
    });
    const ddp = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "DDP Flag fehlt.",
        orderOverrideRaw: orderOverrides.ddp,
        parse: asBool,
        isValid: (value) => value === true || value === false,
        candidates: [
            { source: "product", value: asBool(template.ddp ?? product?.ddp) },
            { source: "supplier", value: asBool(productSupplier?.ddp ?? supplier?.defaultDdp) },
            { source: "settings", value: asBool(settings.defaultDdp) },
        ],
    });
    const incoterm = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "Incoterm fehlt.",
        orderOverrideRaw: orderOverrides.incoterm,
        parse: asIncoterm,
        isValid: (value) => Boolean(value),
        candidates: [
            { source: "product", value: asIncoterm(product?.defaultIncoterm ?? template.incoterm) },
            { source: "supplier", value: asIncoterm(productSupplier?.incoterm ?? supplier?.incotermDefault) },
            { source: "settings", value: asIncoterm(settings.defaultIncoterm) },
        ],
    });
    const currency = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "Währung fehlt.",
        orderOverrideRaw: orderOverrides.currency,
        parse: asCurrency,
        isValid: (value) => Boolean(value),
        candidates: [
            { source: "product", value: asCurrency(template.currency ?? product?.currency) },
            { source: "supplier", value: asCurrency(productSupplier?.currency ?? supplier?.currencyDefault) },
            { source: "settings", value: asCurrency(settings.defaultCurrency) },
        ],
    });
    const fxRate = resolveHierarchyField({
        orderContext,
        required: false,
        reason: "FX Rate fehlt.",
        orderOverrideRaw: orderOverrides.fxRate ?? orderOverrides.fxOverride,
        parse: asPositiveNumber,
        isValid: (value) => Number.isFinite(value) && Number(value) > 0,
        candidates: [
            { source: "product", value: asPositiveNumber(template.fxRate ?? product?.fxRate ?? product?.fxUsdPerEur) },
            { source: "supplier", value: asPositiveNumber(productSupplier?.fxRate ?? supplier?.fxRateDefault) },
            { source: "settings", value: asPositiveNumber(settings.fxRate) },
        ],
    });
    return {
        sku,
        supplierId: resolvedSupplierId,
        product,
        supplier,
        productSupplier,
        fields: {
            unitPriceUsd,
            avgSellingPriceGrossEur,
            marginPct,
            moqUnits,
            productionLeadTimeDays,
            transitDays,
            logisticsPerUnitEur,
            dutyRatePct,
            eustRatePct,
            ddp,
            incoterm,
            currency,
            fxRate,
        },
    };
}
function applyAdoptedFieldToProduct(input) {
    const product = { ...(input.product || {}) };
    const templateSource = (product.template && typeof product.template === "object")
        ? product.template
        : {};
    const templateFields = (templateSource.fields && typeof templateSource.fields === "object")
        ? { ...templateSource.fields }
        : { ...templateSource };
    const numeric = asNumber(input.value);
    const bool = asBool(input.value);
    if (input.field === "unitPriceUsd") {
        if (numeric == null || numeric <= 0)
            return product;
        templateFields.unitPriceUsd = numeric;
    }
    if (input.field === "productionLeadTimeDays") {
        if (numeric == null || numeric <= 0)
            return product;
        product.productionLeadTimeDaysDefault = Math.round(numeric);
    }
    if (input.field === "transitDays") {
        if (numeric == null || numeric <= 0)
            return product;
        templateFields.transitDays = Math.round(numeric);
    }
    if (input.field === "dutyRatePct") {
        if (numeric == null || numeric < 0)
            return product;
        templateFields.dutyPct = numeric;
        product.dutyRatePct = numeric;
    }
    if (input.field === "eustRatePct") {
        if (numeric == null || numeric < 0)
            return product;
        templateFields.vatImportPct = numeric;
        product.eustRatePct = numeric;
    }
    if (input.field === "ddp") {
        if (bool == null)
            return product;
        templateFields.ddp = bool;
        product.ddp = bool;
    }
    product.template = {
        ...templateSource,
        scope: "SKU",
        name: String(templateSource.name || "Standard (SKU)"),
        fields: templateFields,
    };
    return product;
}
function sourceChipClass(source, required = false) {
    if (source === "supplier")
        return "v2-source-chip v2-source-chip--supplier";
    if (source === "settings")
        return "v2-source-chip v2-source-chip--settings";
    if (source === "missing" && required)
        return "v2-source-chip v2-source-chip--missing";
    if (source === "order_override")
        return "v2-source-chip v2-source-chip--override";
    return "v2-source-chip";
}
function isBlockScope(status) {
    const normalized = normalizeText(status).toLowerCase();
    return !normalized || normalized === "active" || normalized === "aktiv" || normalized === "prelaunch" || normalized === "not_launched" || normalized === "planned";
}

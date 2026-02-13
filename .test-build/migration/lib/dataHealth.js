"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_HEALTH_CURRENCIES = exports.DATA_HEALTH_SCOPES = void 0;
exports.parseDeNumber = parseDeNumber;
exports.formatDeNumber = formatDeNumber;
exports.makeIssue = makeIssue;
exports.validateSettings = validateSettings;
exports.validateProducts = validateProducts;
exports.validateSuppliers = validateSuppliers;
exports.validateAll = validateAll;
const CURRENCIES = ["EUR", "USD", "CNY"];
function parseDeNumber(value) {
    if (value == null || value === "")
        return null;
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    const raw = String(value).trim();
    if (!raw)
        return null;
    const cleaned = raw.replace(/[^0-9,.-]/g, "");
    if (!cleaned)
        return null;
    const commaIndex = cleaned.lastIndexOf(",");
    if (commaIndex >= 0) {
        const intPart = cleaned.slice(0, commaIndex).replace(/\./g, "");
        const fracPart = cleaned.slice(commaIndex + 1).replace(/\./g, "");
        const normalised = `${intPart}.${fracPart}`;
        const num = Number(normalised);
        return Number.isFinite(num) ? num : null;
    }
    const dotParts = cleaned.split(".");
    if (dotParts.length > 2)
        return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
}
function formatDeNumber(value, decimals = 2, options = {}) {
    const num = Number(value);
    if (!Number.isFinite(num))
        return options.emptyValue ?? "—";
    return num.toLocaleString("de-DE", {
        minimumFractionDigits: options.minimumFractionDigits ?? decimals,
        maximumFractionDigits: options.maximumFractionDigits ?? decimals,
        useGrouping: options.useGrouping ?? false,
    });
}
function makeIssue({ scope, entityId, severity, field, message, hint, blocking, }) {
    return {
        id: `${scope}:${entityId}:${field}:${severity}`,
        scope,
        entityId,
        severity,
        field,
        message,
        hint,
        blocking: Boolean(blocking),
    };
}
function isValidCurrency(value) {
    return CURRENCIES.includes(String(value || "").trim().toUpperCase());
}
function hasPositiveNumber(value) {
    const parsed = parseDeNumber(value);
    return parsed != null && parsed > 0;
}
function hasNonNegativeNumber(value) {
    const parsed = parseDeNumber(value);
    return parsed != null && parsed >= 0;
}
function validateSettings(settings = {}) {
    const issues = [];
    const fxRate = settings.fxRate;
    if (!hasPositiveNumber(fxRate)) {
        issues.push(makeIssue({
            scope: "settings",
            entityId: "settings",
            severity: "error",
            field: "fxRate",
            message: "FX-Kurs (USD→EUR) fehlt oder ist ungültig.",
            hint: "Bitte einen Kurs > 0 setzen (z. B. 1,08).",
            blocking: true,
        }));
    }
    if (!hasPositiveNumber(settings.eurUsdRate)) {
        issues.push(makeIssue({
            scope: "settings",
            entityId: "settings",
            severity: "warning",
            field: "eurUsdRate",
            message: "FX-Kurs (EUR/USD) prüfen.",
            hint: "Bitte den EUR/USD Kurs prüfen (z. B. 0,92).",
            blocking: false,
        }));
    }
    if (!isValidCurrency(settings.defaultCurrency)) {
        issues.push(makeIssue({
            scope: "settings",
            entityId: "settings",
            severity: "error",
            field: "defaultCurrency",
            message: "Default Currency fehlt.",
            hint: "Bitte eine Währung aus dem Dropdown wählen.",
            blocking: true,
        }));
    }
    const leadTimes = settings.transportLeadTimesDays || {};
    ["air", "rail", "sea"].forEach((mode) => {
        const value = leadTimes?.[mode];
        if (value == null)
            return;
        if (!hasPositiveNumber(value)) {
            issues.push(makeIssue({
                scope: "settings",
                entityId: "settings",
                severity: "error",
                field: `transportLeadTimesDays.${mode}`,
                message: `Transport Lead Time (${mode.toUpperCase()}) fehlt oder ist ungültig.`,
                hint: "Wert muss > 0 sein.",
                blocking: true,
            }));
        }
    });
    return issues;
}
function validateProducts(products = [], settings = {}) {
    const issues = [];
    products.forEach((product) => {
        if (!product)
            return;
        const sku = String(product.sku || "").trim();
        if (!sku)
            return;
        const alias = String(product.alias || "").trim();
        if (!alias) {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "error",
                field: "alias",
                message: `Alias fehlt (${sku}).`,
                hint: "Bitte einen Produktnamen hinterlegen.",
                blocking: true,
            }));
        }
        const templateFields = product.template?.fields || product.template || {};
        const currency = templateFields.currency ?? product.currency;
        if (!isValidCurrency(currency)) {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "error",
                field: "currency",
                message: `Currency fehlt (${sku}).`,
                hint: "Bitte eine Währung aus dem Dropdown wählen.",
                blocking: true,
            }));
        }
        const unitPrice = templateFields.unitPriceUsd ?? product.unitPrice ?? product.defaultUnitPrice;
        if (!hasPositiveNumber(unitPrice)) {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "error",
                field: "unitPrice",
                message: `Unit Price fehlt (${sku}).`,
                hint: "Bitte einen Stückpreis > 0 angeben.",
                blocking: true,
            }));
        }
        if (!hasNonNegativeNumber(product.avgSellingPriceGrossEUR)) {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "error",
                field: "avgSellingPriceGrossEUR",
                message: `Ø VK-Preis (Brutto) fehlt (${sku}).`,
                hint: "Bitte einen Wert ≥ 0 hinterlegen.",
                blocking: true,
            }));
        }
        if (!hasNonNegativeNumber(product.sellerboardMarginPct)) {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "error",
                field: "sellerboardMarginPct",
                message: `Sellerboard Marge fehlt (${sku}).`,
                hint: "Bitte eine Marge ≥ 0 hinterlegen.",
                blocking: true,
            }));
        }
        if ("ddp" in templateFields && typeof templateFields.ddp !== "boolean") {
            issues.push(makeIssue({
                scope: "product",
                entityId: sku,
                severity: "warning",
                field: "ddp",
                message: `DDP-Flag ist nicht sauber gespeichert (${sku}).`,
                hint: "Bitte den DDP-Status prüfen und erneut speichern.",
                blocking: false,
            }));
        }
    });
    return issues;
}
function sumPaymentTerms(terms = []) {
    if (!Array.isArray(terms))
        return null;
    return terms.reduce((acc, term) => acc + (parseDeNumber(term.percent) || 0), 0);
}
function validateSuppliers(suppliers = []) {
    const issues = [];
    suppliers.forEach((supplier) => {
        if (!supplier)
            return;
        const id = supplier.id || supplier.name || "supplier";
        const name = String(supplier.name || "").trim();
        if (!name) {
            issues.push(makeIssue({
                scope: "supplier",
                entityId: id,
                severity: "error",
                field: "name",
                message: "Supplier-Name fehlt.",
                hint: "Bitte einen Namen hinterlegen.",
                blocking: true,
            }));
        }
        if (!isValidCurrency(supplier.currencyDefault)) {
            issues.push(makeIssue({
                scope: "supplier",
                entityId: id,
                severity: "error",
                field: "currency",
                message: `Supplier Currency fehlt (${name || id}).`,
                hint: "Bitte eine Währung aus dem Dropdown wählen.",
                blocking: true,
            }));
        }
        if (!hasPositiveNumber(supplier.productionLeadTimeDaysDefault)) {
            issues.push(makeIssue({
                scope: "supplier",
                entityId: id,
                severity: "error",
                field: "productionLeadTime",
                message: `Production Lead Time fehlt (${name || id}).`,
                hint: "Bitte einen Wert > 0 angeben.",
                blocking: true,
            }));
        }
        const terms = supplier.paymentTermsDefault;
        const sum = sumPaymentTerms(terms);
        if (!Array.isArray(terms) || !terms.length || sum == null || Math.round(sum) !== 100) {
            issues.push(makeIssue({
                scope: "supplier",
                entityId: id,
                severity: "error",
                field: "paymentTerms",
                message: `Payment Terms fehlen oder sind unplausibel (${name || id}).`,
                hint: "Bitte Payment Terms pflegen (Summe 100%).",
                blocking: true,
            }));
        }
    });
    return issues;
}
function validateAll({ settings, products, suppliers, pos, fos } = {}) {
    const issues = [
        ...validateSettings(settings),
        ...validateProducts(products, settings),
        ...validateSuppliers(suppliers, settings),
    ];
    const summary = {
        total: issues.length,
        blocking: issues.filter(issue => issue.blocking).length,
        warnings: issues.filter(issue => issue.severity === "warning").length,
        errors: issues.filter(issue => issue.severity === "error").length,
        byScope: issues.reduce((acc, issue) => {
            acc[issue.scope] = (acc[issue.scope] || 0) + 1;
            return acc;
        }, {}),
        hasOrders: Boolean((pos && pos.length) || (fos && fos.length)),
    };
    return { issues, summary };
}
exports.DATA_HEALTH_SCOPES = ["settings", "product", "supplier", "po", "fo"];
exports.DATA_HEALTH_CURRENCIES = [...CURRENCIES];

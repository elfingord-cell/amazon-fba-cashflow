"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateProductCompletenessV2 = evaluateProductCompletenessV2;
exports.evaluateOrderBlocking = evaluateOrderBlocking;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const masterDataHierarchy_1 = require("./masterDataHierarchy");
function asNumber(value) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return null;
    return Number(parsed);
}
function hasText(value) {
    return String(value || "").trim().length > 0;
}
function pushIssue(target, issue, dedupe) {
    if (dedupe.has(issue.fieldKey))
        return;
    dedupe.add(issue.fieldKey);
    target.push(issue);
}
function buildDefaulted(resolved) {
    const fields = resolved.fields;
    const rows = [];
    const add = (fieldKey, label, source, value) => {
        if (source !== "supplier" && source !== "settings")
            return;
        if (value == null || value === "")
            return;
        rows.push({ fieldKey, label, source, value });
    };
    add("unitPriceUsd", "EK Preis USD", fields.unitPriceUsd.source, fields.unitPriceUsd.value);
    add("moqUnits", "MOQ", fields.moqUnits.source, fields.moqUnits.value);
    add("productionLeadTimeDays", "Production Lead Time", fields.productionLeadTimeDays.source, fields.productionLeadTimeDays.value);
    add("incoterm", "Incoterm", fields.incoterm.source, fields.incoterm.value);
    add("ddp", "DDP", fields.ddp.source, fields.ddp.value);
    add("dutyRatePct", "Zoll %", fields.dutyRatePct.source, fields.dutyRatePct.value);
    add("eustRatePct", "EUSt %", fields.eustRatePct.source, fields.eustRatePct.value);
    return rows;
}
function resolveBlockingIssues(resolved) {
    const issues = [];
    const dedupe = new Set();
    const f = resolved.fields;
    if (f.unitPriceUsd.value == null || Number(f.unitPriceUsd.value) <= 0) {
        pushIssue(issues, {
            fieldKey: "unitPriceUsd",
            label: "EK Preis USD",
            source: f.unitPriceUsd.source,
            reason: "EK Preis USD fehlt.",
        }, dedupe);
    }
    if (f.avgSellingPriceGrossEur.value == null || Number(f.avgSellingPriceGrossEur.value) <= 0) {
        pushIssue(issues, {
            fieldKey: "avgSellingPriceGrossEUR",
            label: "VK Preis Brutto",
            source: f.avgSellingPriceGrossEur.source,
            reason: "VK Preis Brutto fehlt.",
        }, dedupe);
    }
    if (f.marginPct.value == null || Number(f.marginPct.value) <= 0) {
        pushIssue(issues, {
            fieldKey: "sellerboardMarginPct",
            label: "Marge %",
            source: f.marginPct.source,
            reason: "Marge muss > 0 sein.",
        }, dedupe);
    }
    const hasIncotermOrDdp = (f.incoterm.value && String(f.incoterm.value).trim().length > 0) || (f.ddp.value === true || f.ddp.value === false);
    if (!hasIncotermOrDdp) {
        pushIssue(issues, {
            fieldKey: "incoterm_ddp",
            label: "Incoterm / DDP",
            source: f.incoterm.source === "missing" ? f.ddp.source : f.incoterm.source,
            reason: "Incoterm oder DDP Flag fehlt.",
        }, dedupe);
    }
    if (f.moqUnits.value == null || Number(f.moqUnits.value) <= 0) {
        pushIssue(issues, {
            fieldKey: "moqUnits",
            label: "MOQ",
            source: f.moqUnits.source,
            reason: "MOQ fehlt.",
        }, dedupe);
    }
    if (f.productionLeadTimeDays.value == null || Number(f.productionLeadTimeDays.value) <= 0) {
        pushIssue(issues, {
            fieldKey: "productionLeadTimeDaysDefault",
            label: "Production Lead Time",
            source: f.productionLeadTimeDays.source,
            reason: "Production Lead Time fehlt.",
        }, dedupe);
    }
    return issues;
}
function resolveImportantIssues(product) {
    const issues = [];
    const dedupe = new Set();
    if (!hasText(product.hsCode)) {
        pushIssue(issues, {
            fieldKey: "hsCode",
            label: "HS-Code",
            source: "missing",
            reason: "HS-Code fehlt (wichtig).",
        }, dedupe);
    }
    if (!hasText(product.goodsDescription)) {
        pushIssue(issues, {
            fieldKey: "goodsDescription",
            label: "Warenbeschreibung",
            source: "missing",
            reason: "Warenbeschreibung fehlt (wichtig).",
        }, dedupe);
    }
    const landed = asNumber(product.landedUnitCostEur);
    if (!Number.isFinite(landed) || Number(landed) <= 0) {
        pushIssue(issues, {
            fieldKey: "landedUnitCostEur",
            label: "Einstandspreis EUR",
            source: "missing",
            reason: "Einstandspreis EUR fehlt (wichtig).",
        }, dedupe);
    }
    return issues;
}
function evaluateProductCompletenessV2(input) {
    const product = (input.product || {});
    const state = (input.state || {});
    const resolved = (0, masterDataHierarchy_1.resolveMasterDataHierarchy)({
        state,
        product,
        sku: String(product.sku || ""),
        supplierId: String(product.supplierId || ""),
        orderContext: "product",
    });
    const blockingMissing = resolveBlockingIssues(resolved);
    const importantMissing = resolveImportantIssues(product);
    const defaulted = buildDefaulted(resolved);
    const blockScope = (0, masterDataHierarchy_1.isBlockScope)(product.status);
    if (blockScope && blockingMissing.length > 0) {
        return {
            status: "blocked",
            blockingMissing,
            importantMissing,
            defaulted,
            blockScope,
        };
    }
    if (blockingMissing.length > 0 || importantMissing.length > 0 || defaulted.length > 0) {
        return {
            status: "warn",
            blockingMissing,
            importantMissing,
            defaulted,
            blockScope,
        };
    }
    return {
        status: "ok",
        blockingMissing,
        importantMissing,
        defaulted,
        blockScope,
    };
}
function evaluateOrderBlocking(input) {
    const product = input.product || {};
    const resolved = (0, masterDataHierarchy_1.resolveMasterDataHierarchy)({
        state: input.state || {},
        product,
        sku: String(product?.sku || ""),
        supplierId: input.supplierId || String(product?.supplierId || ""),
        orderOverrides: input.orderOverrides || {},
        orderContext: input.orderContext,
    });
    const issues = resolveBlockingIssues(resolved);
    const blockScope = (0, masterDataHierarchy_1.isBlockScope)(product?.status);
    return {
        blocked: blockScope && issues.length > 0,
        blockScope,
        issues,
        resolved,
    };
}

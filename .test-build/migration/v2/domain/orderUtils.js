"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PO_ANCHORS = exports.PAYMENT_CURRENCIES = exports.PAYMENT_TRIGGERS = exports.INCOTERMS = exports.TRANSPORT_MODES = exports.FO_STATUS_VALUES = void 0;
exports.randomId = randomId;
exports.nowIso = nowIso;
exports.convertToEur = convertToEur;
exports.computeFoSchedule = computeFoSchedule;
exports.computeScheduleFromOrderDate = computeScheduleFromOrderDate;
exports.normalizePoItems = normalizePoItems;
exports.computePoAggregateMetrics = computePoAggregateMetrics;
exports.mapSupplierTermsToPoMilestones = mapSupplierTermsToPoMilestones;
exports.computeFoCostValues = computeFoCostValues;
exports.extractSupplierTerms = extractSupplierTerms;
exports.buildFoPayments = buildFoPayments;
exports.sumSupplierPercent = sumSupplierPercent;
exports.normalizeFoRecord = normalizeFoRecord;
exports.createPoFromFo = createPoFromFo;
exports.buildPlannedSalesBySku = buildPlannedSalesBySku;
exports.buildClosingStockBySku = buildClosingStockBySku;
exports.buildInboundBySku = buildInboundBySku;
exports.buildFoRecommendationContext = buildFoRecommendationContext;
exports.resolveProductBySku = resolveProductBySku;
exports.computeFoRecommendationForSku = computeFoRecommendationForSku;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const foSuggestion_js_1 = require("../../domain/foSuggestion.js");
exports.FO_STATUS_VALUES = ["DRAFT", "PLANNED", "CONVERTED", "CANCELLED"];
exports.TRANSPORT_MODES = ["SEA", "RAIL", "AIR"];
exports.INCOTERMS = ["EXW", "DDP"];
exports.PAYMENT_TRIGGERS = ["ORDER_DATE", "PRODUCTION_END", "ETD", "ETA", "DELIVERY"];
exports.PAYMENT_CURRENCIES = ["EUR", "USD", "CNY"];
exports.PO_ANCHORS = ["ORDER_DATE", "PROD_DONE", "ETD", "ETA"];
function mergeExistingPaymentState(generated, existingPayments) {
    const existingList = Array.isArray(existingPayments)
        ? existingPayments
        : [];
    if (!existingList.length)
        return generated;
    const byId = new Map(existingList.map((entry) => [String(entry?.id || ""), entry]));
    return generated.map((row) => {
        const existing = byId.get(String(row.id || ""));
        if (!existing)
            return row;
        return {
            ...row,
            dueDate: existing.dueDateManuallySet ? String(existing.dueDate || row.dueDate || "") : row.dueDate,
            dueDateManuallySet: existing.dueDateManuallySet === true ? true : row.dueDateManuallySet,
            isOverridden: existing.isOverridden === true ? true : row.isOverridden,
            status: existing.status ? String(existing.status) : undefined,
            paidDate: existing.paidDate ? String(existing.paidDate) : undefined,
            paymentId: existing.paymentId ? String(existing.paymentId) : undefined,
            paidEurActual: Number.isFinite(Number(existing.paidEurActual)) ? Number(existing.paidEurActual) : undefined,
            paidUsdActual: Number.isFinite(Number(existing.paidUsdActual)) ? Number(existing.paidUsdActual) : undefined,
            paidBy: existing.paidBy ? String(existing.paidBy) : undefined,
            method: existing.method ? String(existing.method) : undefined,
            note: existing.note ? String(existing.note) : undefined,
            invoiceDriveUrl: existing.invoiceDriveUrl ? String(existing.invoiceDriveUrl) : undefined,
            invoiceFolderDriveUrl: existing.invoiceFolderDriveUrl ? String(existing.invoiceFolderDriveUrl) : undefined,
        };
    });
}
function asNumber(value, fallback = 0) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Number(parsed);
}
function asPositiveNumber(value) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return null;
    const numeric = Number(parsed);
    if (numeric <= 0)
        return null;
    return numeric;
}
function asPositive(value, fallback = 0) {
    return Math.max(0, asNumber(value, fallback));
}
function parseIsoDate(value) {
    if (!value)
        return null;
    const [year, month, day] = String(value).split("-").map(Number);
    if (!year || !month || !day)
        return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime()))
        return null;
    return date;
}
function toIsoDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime()))
        return null;
    return value.toISOString().slice(0, 10);
}
function addDays(value, days) {
    const next = new Date(value.getTime());
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
}
function addMonths(value, months) {
    const next = new Date(value.getTime());
    next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
    return next;
}
function mapPaymentAnchor(trigger) {
    if (trigger === "PRODUCTION_END")
        return "PROD_DONE";
    if (trigger === "DELIVERY")
        return "ETA";
    return trigger;
}
function monthKey(date) {
    return foSuggestion_js_1.foSuggestionUtils.monthKey(date);
}
function normaliseTrigger(value) {
    const candidate = String(value || "").trim().toUpperCase();
    if (exports.PAYMENT_TRIGGERS.includes(candidate)) {
        return candidate;
    }
    return "ORDER_DATE";
}
function normaliseCurrency(value, fallback = "EUR") {
    const candidate = String(value || fallback).trim().toUpperCase();
    if (exports.PAYMENT_CURRENCIES.includes(candidate))
        return candidate;
    return fallback;
}
function defaultTerms() {
    return [
        {
            label: "Deposit",
            percent: 30,
            triggerEvent: "ORDER_DATE",
            offsetDays: 0,
            offsetMonths: 0,
        },
        {
            label: "Balance",
            percent: 70,
            triggerEvent: "ETD",
            offsetDays: 0,
            offsetMonths: 0,
        },
    ];
}
function buildScheduleDates(schedule) {
    const dates = {
        ORDER_DATE: parseIsoDate(schedule.orderDate),
        PRODUCTION_END: parseIsoDate(schedule.productionEndDate),
        ETD: parseIsoDate(schedule.etdDate),
        ETA: parseIsoDate(schedule.etaDate),
        DELIVERY: parseIsoDate(schedule.deliveryDate),
    };
    if (!dates.ETD && dates.ETA && Number.isFinite(Number(schedule.logisticsLeadTimeDays))) {
        dates.ETD = addDays(dates.ETA, -Number(schedule.logisticsLeadTimeDays || 0));
    }
    return dates;
}
function resolveDueDate(trigger, offsetDays, offsetMonths, scheduleDates) {
    const base = scheduleDates[trigger] || null;
    if (!base)
        return null;
    let due = addDays(base, Number(offsetDays || 0));
    if (offsetMonths) {
        due = addMonths(due, Number(offsetMonths || 0));
    }
    return toIsoDate(due);
}
function randomId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
function nowIso() {
    return new Date().toISOString();
}
function convertToEur(amount, currency, fxRate) {
    const value = asNumber(amount, 0);
    const curr = String(currency || "EUR").toUpperCase();
    if (curr === "EUR")
        return value;
    const fx = asPositive(fxRate, 0);
    if (!fx)
        return value;
    return value / fx;
}
function computeFoSchedule(input) {
    const target = parseIsoDate(input.targetDeliveryDate);
    const productionLeadTimeDays = asPositive(input.productionLeadTimeDays, 0);
    const logisticsLeadTimeDays = asPositive(input.logisticsLeadTimeDays, 0);
    const bufferDays = asPositive(input.bufferDays, 0);
    if (!target || productionLeadTimeDays <= 0) {
        return {
            orderDate: null,
            productionEndDate: null,
            etdDate: null,
            etaDate: null,
            deliveryDate: target ? toIsoDate(target) : null,
            logisticsLeadTimeDays,
        };
    }
    const orderDate = addDays(target, -(productionLeadTimeDays + logisticsLeadTimeDays + bufferDays));
    const productionEndDate = addDays(orderDate, productionLeadTimeDays);
    const etdDate = productionEndDate;
    const etaDate = addDays(etdDate, logisticsLeadTimeDays);
    return {
        orderDate: toIsoDate(orderDate),
        productionEndDate: toIsoDate(productionEndDate),
        etdDate: toIsoDate(etdDate),
        etaDate: toIsoDate(etaDate),
        deliveryDate: toIsoDate(target),
        logisticsLeadTimeDays,
    };
}
function computeScheduleFromOrderDate(input) {
    const order = parseIsoDate(input.orderDate);
    const productionLeadTimeDays = asPositive(input.productionLeadTimeDays, 0);
    const logisticsLeadTimeDays = asPositive(input.logisticsLeadTimeDays, 0);
    const bufferDays = asPositive(input.bufferDays, 0);
    if (!order) {
        return {
            orderDate: null,
            productionEndDate: null,
            etdDate: null,
            etaDate: null,
            deliveryDate: input.deliveryDate ? String(input.deliveryDate) : null,
            logisticsLeadTimeDays,
        };
    }
    const productionEndDate = addDays(order, productionLeadTimeDays + bufferDays);
    const etdDate = productionEndDate;
    const etaDate = addDays(etdDate, logisticsLeadTimeDays);
    return {
        orderDate: toIsoDate(order),
        productionEndDate: toIsoDate(productionEndDate),
        etdDate: toIsoDate(etdDate),
        etaDate: toIsoDate(etaDate),
        deliveryDate: input.deliveryDate ? String(input.deliveryDate) : null,
        logisticsLeadTimeDays,
    };
}
function normalizePoItemEntry(input) {
    const row = (input || {});
    const sku = String(row.sku || "").trim();
    if (!sku)
        return null;
    const units = Math.max(0, Math.round(asNumber(row.units, 0)));
    const unitCostUsd = asPositive(row.unitCostUsd, 0);
    const unitExtraUsd = asPositive(row.unitExtraUsd, 0);
    const extraFlatUsd = asPositive(row.extraFlatUsd, 0);
    const prodDays = Math.max(0, Math.round(asPositiveNumber(row.prodDays) ?? asPositive(row.productionLeadTimeDays, 0)));
    const transitDays = Math.max(0, Math.round(asPositiveNumber(row.transitDays) ?? asPositive(row.logisticsLeadTimeDays, 0)));
    const freightEur = asPositive(row.freightEur, 0);
    return {
        id: String(row.id || randomId("poi")),
        sku,
        units,
        unitCostUsd,
        unitExtraUsd,
        extraFlatUsd,
        prodDays,
        transitDays,
        freightEur,
    };
}
function normalizePoItems(items, fallback) {
    const parsedItems = Array.isArray(items) ? items.map(normalizePoItemEntry).filter(Boolean) : [];
    if (parsedItems.length)
        return parsedItems;
    const sku = String(fallback?.sku || "").trim();
    if (!sku)
        return [];
    const fallbackItem = normalizePoItemEntry({
        id: String(fallback?.id || randomId("poi")),
        sku,
        units: fallback?.units,
        unitCostUsd: fallback?.unitCostUsd,
        unitExtraUsd: fallback?.unitExtraUsd,
        extraFlatUsd: fallback?.extraFlatUsd,
        prodDays: fallback?.prodDays,
        transitDays: fallback?.transitDays,
        freightEur: fallback?.freightEur,
    });
    return fallbackItem ? [fallbackItem] : [];
}
function computePoAggregateMetrics(input) {
    const normalizedItems = normalizePoItems(input.items, input.fallback);
    let goodsUsd = 0;
    let freightEur = 0;
    let units = 0;
    let prodDays = 0;
    let transitDays = 0;
    const orderDate = parseIsoDate(input.orderDate);
    let minEtaDate = null;
    let maxEtaDate = null;
    normalizedItems.forEach((item) => {
        const itemGoods = item.units * (item.unitCostUsd + item.unitExtraUsd) + item.extraFlatUsd;
        goodsUsd += itemGoods;
        freightEur += item.freightEur;
        units += item.units;
        prodDays = Math.max(prodDays, item.prodDays);
        transitDays = Math.max(transitDays, item.transitDays);
        if (orderDate) {
            const eta = addDays(orderDate, item.prodDays + item.transitDays);
            if (!minEtaDate || eta < minEtaDate)
                minEtaDate = eta;
            if (!maxEtaDate || eta > maxEtaDate)
                maxEtaDate = eta;
        }
    });
    const schedule = computeScheduleFromOrderDate({
        orderDate: input.orderDate,
        productionLeadTimeDays: prodDays,
        logisticsLeadTimeDays: transitDays,
        bufferDays: 0,
    });
    return {
        items: normalizedItems,
        goodsUsd,
        goodsEur: convertToEur(goodsUsd, "USD", input.fxRate),
        freightEur,
        units,
        prodDays,
        transitDays,
        firstSku: normalizedItems[0]?.sku || "",
        minEtaDate: toIsoDate(minEtaDate),
        maxEtaDate: toIsoDate(maxEtaDate),
        schedule,
    };
}
function mapSupplierTermsToPoMilestones(supplierRow) {
    const terms = extractSupplierTerms([], supplierRow);
    return terms.map((term, index) => ({
        id: String(term.id || `ms-${index + 1}-${Math.random().toString(36).slice(2, 8)}`),
        label: String(term.label || "Milestone"),
        percent: asPositive(term.percent, 0),
        anchor: mapPaymentAnchor(normaliseTrigger(term.triggerEvent)),
        lagDays: asNumber(term.offsetDays, 0),
    }));
}
function computeFoCostValues(input) {
    const units = asPositive(input.units, 0);
    const unitPrice = asPositive(input.unitPrice, 0);
    const supplierCost = units * unitPrice;
    const supplierCostEur = convertToEur(supplierCost, input.currency, input.fxRate);
    const freightAmount = asPositive(input.freight, 0);
    const freightEur = convertToEur(freightAmount, input.freightCurrency, input.fxRate);
    const dutyRatePct = asPositive(input.dutyRatePct, 0);
    const eustRatePct = asPositive(input.eustRatePct, 0);
    const dutyAmountEur = supplierCostEur * (dutyRatePct / 100);
    const eustAmountEur = (supplierCostEur + dutyAmountEur + freightEur) * (eustRatePct / 100);
    const landedCostEur = supplierCostEur + freightEur + dutyAmountEur + eustAmountEur;
    return {
        supplierCost,
        supplierCostEur,
        freightAmount,
        freightEur,
        dutyAmountEur,
        eustAmountEur,
        landedCostEur,
    };
}
function extractSupplierTerms(inputPayments, supplierRow) {
    const existing = Array.isArray(inputPayments)
        ? inputPayments.filter((entry) => String(entry?.category || "supplier") === "supplier")
        : [];
    if (existing.length) {
        return existing.map((entry) => ({
            id: entry.id ? String(entry.id) : undefined,
            label: String(entry.label || "Milestone"),
            percent: asPositive(entry.percent, 0),
            triggerEvent: normaliseTrigger(entry.triggerEvent),
            offsetDays: asNumber(entry.offsetDays, 0),
            offsetMonths: asNumber(entry.offsetMonths, 0),
        }));
    }
    const supplierTerms = Array.isArray(supplierRow?.paymentTermsDefault)
        ? supplierRow?.paymentTermsDefault
        : [];
    if (supplierTerms.length) {
        return supplierTerms.map((entry) => ({
            id: entry.id ? String(entry.id) : undefined,
            label: String(entry.label || "Milestone"),
            percent: asPositive(entry.percent, 0),
            triggerEvent: normaliseTrigger(entry.triggerEvent),
            offsetDays: asNumber(entry.offsetDays, 0),
            offsetMonths: asNumber(entry.offsetMonths, 0),
        }));
    }
    return defaultTerms();
}
function buildFoPayments(input) {
    const costValues = computeFoCostValues(input);
    const scheduleDates = buildScheduleDates(input.schedule);
    const baseValue = asPositive(input.unitPrice, 0) * asPositive(input.units, 0);
    const supplierRows = (input.supplierTerms || []).map((term, index) => {
        const triggerEvent = normaliseTrigger(term.triggerEvent);
        const offsetDays = asNumber(term.offsetDays, 0);
        const offsetMonths = asNumber(term.offsetMonths, 0);
        return {
            id: term.id || `supplier-${index}`,
            label: String(term.label || "Milestone"),
            percent: asPositive(term.percent, 0),
            amount: baseValue * (asPositive(term.percent, 0) / 100),
            currency: normaliseCurrency(input.currency, "EUR"),
            triggerEvent,
            offsetDays,
            offsetMonths,
            dueDate: resolveDueDate(triggerEvent, offsetDays, offsetMonths, scheduleDates),
            isOverridden: false,
            dueDateManuallySet: false,
            category: "supplier",
        };
    });
    const incoterm = String(input.incoterm || "EXW").toUpperCase();
    const rows = [...supplierRows];
    if (incoterm !== "DDP" && costValues.freightAmount > 0) {
        rows.push({
            id: "auto-freight",
            label: "Fracht",
            percent: 0,
            amount: costValues.freightAmount,
            currency: normaliseCurrency(input.freightCurrency, "EUR"),
            triggerEvent: "ETD",
            offsetDays: 0,
            offsetMonths: 0,
            dueDate: resolveDueDate("ETD", 0, 0, scheduleDates),
            category: "freight",
            isOverridden: false,
            dueDateManuallySet: false,
        });
    }
    const dutyRatePct = asPositive(input.dutyRatePct, 0);
    if (incoterm !== "DDP" && dutyRatePct > 0) {
        rows.push({
            id: "auto-duty",
            label: "Duty",
            percent: dutyRatePct,
            amount: costValues.dutyAmountEur,
            currency: "EUR",
            triggerEvent: "ETA",
            offsetDays: 0,
            offsetMonths: 0,
            dueDate: resolveDueDate("ETA", 0, 0, scheduleDates),
            category: "duty",
            isOverridden: false,
            dueDateManuallySet: false,
        });
    }
    const eustRatePct = asPositive(input.eustRatePct, 0);
    if (incoterm !== "DDP" && eustRatePct > 0) {
        rows.push({
            id: "auto-eust",
            label: "EUSt",
            percent: eustRatePct,
            amount: costValues.eustAmountEur,
            currency: "EUR",
            triggerEvent: "ETA",
            offsetDays: 0,
            offsetMonths: 0,
            dueDate: resolveDueDate("ETA", 0, 0, scheduleDates),
            category: "eust",
            isOverridden: false,
            dueDateManuallySet: false,
        });
        rows.push({
            id: "auto-eust-refund",
            label: "EUSt Erstattung",
            percent: eustRatePct,
            amount: -costValues.eustAmountEur,
            currency: "EUR",
            triggerEvent: "ETA",
            offsetDays: 0,
            offsetMonths: 2,
            dueDate: resolveDueDate("ETA", 0, 2, scheduleDates),
            category: "eust_refund",
            isOverridden: false,
            dueDateManuallySet: false,
        });
    }
    return mergeExistingPaymentState(rows, input.existingPayments);
}
function sumSupplierPercent(terms) {
    return Math.round((terms || []).reduce((sum, term) => sum + asPositive(term.percent, 0), 0) * 100) / 100;
}
function normalizeFoRecord(input) {
    const now = nowIso();
    const values = input.values || {};
    const schedule = input.schedule;
    const terms = input.supplierTerms || [];
    const existing = input.existing || null;
    const payments = buildFoPayments({
        supplierTerms: terms,
        schedule,
        unitPrice: values.unitPrice,
        units: values.units,
        currency: values.currency,
        freight: values.freight,
        freightCurrency: values.freightCurrency,
        dutyRatePct: values.dutyRatePct,
        eustRatePct: values.eustRatePct,
        fxRate: values.fxRate,
        incoterm: values.incoterm,
        existingPayments: existing?.payments,
    });
    return {
        ...(existing || {}),
        id: String(values.id || existing?.id || randomId("fo")),
        sku: String(values.sku || ""),
        supplierId: String(values.supplierId || ""),
        targetDeliveryDate: values.targetDeliveryDate ? String(values.targetDeliveryDate) : null,
        units: asPositive(values.units, 0),
        transportMode: String(values.transportMode || "SEA").toUpperCase(),
        incoterm: String(values.incoterm || "EXW").toUpperCase(),
        unitPrice: asPositive(values.unitPrice, 0),
        unitPriceIsOverridden: Boolean(values.unitPriceIsOverridden),
        currency: normaliseCurrency(values.currency, "EUR"),
        freight: asPositive(values.freight, 0),
        freightCurrency: normaliseCurrency(values.freightCurrency, "EUR"),
        dutyRatePct: asPositive(values.dutyRatePct, 0),
        eustRatePct: asPositive(values.eustRatePct, 0),
        fxRate: asPositive(values.fxRate, 0),
        productionLeadTimeDays: asPositive(values.productionLeadTimeDays, 0),
        productionLeadTimeDaysManual: asPositive(values.productionLeadTimeDaysManual, 0),
        productionLeadTimeSource: values.productionLeadTimeSource || null,
        logisticsLeadTimeDays: asPositive(values.logisticsLeadTimeDays, 0),
        bufferDays: asPositive(values.bufferDays, 0),
        orderDate: schedule.orderDate,
        productionEndDate: schedule.productionEndDate,
        etdDate: schedule.etdDate,
        etaDate: schedule.etaDate,
        deliveryDate: schedule.deliveryDate,
        payments,
        status: String(values.status || "DRAFT").toUpperCase(),
        convertedPoId: values.convertedPoId || existing?.convertedPoId || null,
        convertedPoNo: values.convertedPoNo || existing?.convertedPoNo || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
    };
}
function createPoFromFo(input) {
    const fo = input.fo || {};
    const poNo = String(input.poNumber || "").trim();
    const fxRate = asPositive(fo.fxRate, 0);
    const freightEur = convertToEur(fo.freight, fo.freightCurrency, fxRate);
    const productionLead = asPositive(fo.productionLeadTimeDays, 0);
    const bufferDays = asPositive(fo.bufferDays, 0);
    const transitDays = asPositive(fo.logisticsLeadTimeDays, 0);
    const prodDays = productionLead + bufferDays;
    const supplierMilestones = Array.isArray(fo.payments)
        ? fo.payments.filter((payment) => String(payment?.category || "") === "supplier")
        : [];
    const milestoneDefaults = supplierMilestones.length
        ? supplierMilestones
        : defaultTerms();
    const overrideOrderDate = input.orderDateOverride || fo.orderDate || null;
    const orderDate = parseIsoDate(overrideOrderDate) ? String(overrideOrderDate) : null;
    return {
        id: randomId("po"),
        poNo,
        sku: String(fo.sku || ""),
        supplierId: String(fo.supplierId || ""),
        units: asPositive(fo.units, 0),
        unitCostUsd: asPositive(fo.unitPrice, 0),
        unitExtraUsd: 0,
        extraFlatUsd: 0,
        orderDate,
        prodDays,
        transitDays,
        transport: String(fo.transportMode || "SEA").toLowerCase(),
        freightEur,
        dutyRatePct: asPositive(fo.dutyRatePct, 0),
        eustRatePct: asPositive(fo.eustRatePct, 0),
        fxOverride: fxRate || null,
        ddp: String(fo.incoterm || "").toUpperCase() === "DDP",
        milestones: milestoneDefaults.map((payment) => ({
            id: String(payment.id || randomId("ms")),
            label: String(payment.label || "Milestone"),
            percent: asPositive(payment.percent, 0),
            anchor: mapPaymentAnchor(normaliseTrigger(payment.triggerEvent)),
            lagDays: asNumber(payment.offsetDays, 0),
        })),
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
}
function buildPlannedSalesBySku(state) {
    const manual = state?.forecast?.forecastManual || {};
    const imported = state?.forecast?.forecastImport || {};
    const result = {};
    const mergeSku = (skuValue) => {
        const sku = String(skuValue || "").trim();
        if (!sku)
            return;
        if (!result[sku])
            result[sku] = {};
        const manualMonths = manual[sku] || {};
        const importMonths = imported[sku] || {};
        const months = new Set([...Object.keys(importMonths), ...Object.keys(manualMonths)]);
        months.forEach((month) => {
            const manualValue = (0, dataHealth_js_1.parseDeNumber)(manualMonths[month]);
            if (Number.isFinite(manualValue)) {
                result[sku][month] = Number(manualValue);
                return;
            }
            const importValue = (0, dataHealth_js_1.parseDeNumber)(importMonths[month]?.units);
            if (Number.isFinite(importValue)) {
                result[sku][month] = Number(importValue);
            }
        });
    };
    Object.keys(imported).forEach(mergeSku);
    Object.keys(manual).forEach(mergeSku);
    return result;
}
function buildClosingStockBySku(state) {
    const result = {};
    const snapshots = (state?.inventory?.snapshots || []);
    snapshots.forEach((snapshot) => {
        const month = String(snapshot?.month || "");
        if (!month)
            return;
        const items = Array.isArray(snapshot.items) ? snapshot.items : [];
        items.forEach((item) => {
            const sku = String(item?.sku || "").trim();
            if (!sku)
                return;
            if (!result[sku])
                result[sku] = {};
            const amazonUnitsRaw = (0, dataHealth_js_1.parseDeNumber)(item?.amazonUnits);
            const threePlUnitsRaw = (0, dataHealth_js_1.parseDeNumber)(item?.threePLUnits);
            const legacyUnitsRaw = (0, dataHealth_js_1.parseDeNumber)(item?.units);
            const hasSplitUnits = Number.isFinite(amazonUnitsRaw) || Number.isFinite(threePlUnitsRaw);
            if (hasSplitUnits) {
                const amazonUnits = Number.isFinite(amazonUnitsRaw) ? Math.max(0, Number(amazonUnitsRaw)) : 0;
                const threePlUnits = Number.isFinite(threePlUnitsRaw) ? Math.max(0, Number(threePlUnitsRaw)) : 0;
                result[sku][month] = amazonUnits + threePlUnits;
                return;
            }
            result[sku][month] = Number.isFinite(legacyUnitsRaw)
                ? Math.max(0, Number(legacyUnitsRaw))
                : 0;
        });
    });
    return result;
}
function resolveInboundArrivalDate(record) {
    const raw = record?.arrivalDateDe
        || record?.arrivalDate
        || record?.etaDate
        || record?.etaManual
        || record?.eta;
    if (raw) {
        return parseIsoDate(raw);
    }
    const orderDate = parseIsoDate(record?.orderDate);
    if (!orderDate)
        return null;
    const prodDays = asPositive(record?.prodDays ?? record?.productionLeadTimeDays, 0);
    const transitDays = asPositive(record?.transitDays ?? record?.logisticsLeadTimeDays, 0);
    return addDays(orderDate, prodDays + transitDays);
}
function extractInboundItems(record) {
    if (Array.isArray(record?.items) && record.items.length > 0) {
        return record.items.map((item) => ({
            sku: String(item?.sku || "").trim(),
            units: asPositive(item?.units, 0),
        }));
    }
    const sku = String(record?.sku || "").trim();
    if (!sku)
        return [];
    return [{
            sku,
            units: asPositive(record?.units, 0),
        }];
}
function buildInboundBySku(state) {
    const inboundBySku = {};
    let inboundWithoutEtaCount = 0;
    const pos = Array.isArray(state?.pos) ? state.pos : [];
    pos.forEach((po) => {
        if (po?.archived)
            return;
        const arrival = resolveInboundArrivalDate(po);
        if (!arrival) {
            inboundWithoutEtaCount += 1;
            return;
        }
        const month = monthKey(arrival);
        extractInboundItems(po).forEach((item) => {
            if (!item.sku || item.units <= 0)
                return;
            if (!inboundBySku[item.sku])
                inboundBySku[item.sku] = {};
            inboundBySku[item.sku][month] = (inboundBySku[item.sku][month] || 0) + item.units;
        });
    });
    const fos = Array.isArray(state?.fos) ? state.fos : [];
    fos.forEach((fo) => {
        const status = String(fo?.status || "").toUpperCase();
        if (status === "CANCELLED" || status === "CONVERTED")
            return;
        const arrival = resolveInboundArrivalDate(fo);
        if (!arrival) {
            inboundWithoutEtaCount += 1;
            return;
        }
        const month = monthKey(arrival);
        extractInboundItems(fo).forEach((item) => {
            if (!item.sku || item.units <= 0)
                return;
            if (!inboundBySku[item.sku])
                inboundBySku[item.sku] = {};
            inboundBySku[item.sku][month] = (inboundBySku[item.sku][month] || 0) + item.units;
        });
    });
    return {
        inboundBySku,
        inboundWithoutEtaCount,
    };
}
function buildFoRecommendationContext(state) {
    const baselineMonth = (0, foSuggestion_js_1.getLatestClosingSnapshotMonth)((state?.inventory?.snapshots || []));
    const plannedSalesBySku = buildPlannedSalesBySku(state);
    const closingStockBySku = buildClosingStockBySku(state);
    const inbound = buildInboundBySku(state);
    return {
        baselineMonth,
        plannedSalesBySku,
        closingStockBySku,
        inboundBySku: inbound.inboundBySku,
        inboundWithoutEtaCount: inbound.inboundWithoutEtaCount,
    };
}
function resolveProductBySku(products, sku) {
    const key = String(sku || "").trim().toLowerCase();
    if (!key)
        return null;
    return (products.find((entry) => String(entry?.sku || "").trim().toLowerCase() === key)
        || null);
}
function computeFoRecommendationForSku(input) {
    const { context } = input;
    if (!context.baselineMonth)
        return null;
    const sku = String(input.sku || "").trim();
    if (!sku)
        return null;
    const safetyDays = asPositiveNumber(input.product?.safetyStockDohOverride)
        ?? asPositiveNumber(input.settings?.safetyStockDohDefault)
        ?? 60;
    const coverageDays = asPositiveNumber(input.product?.foCoverageDohOverride)
        ?? asPositiveNumber(input.settings?.foCoverageDohDefault)
        ?? 90;
    const moqUnits = asPositiveNumber(input.product?.moqOverrideUnits)
        ?? asPositiveNumber(input.product?.moqUnits)
        ?? asPositiveNumber(input.settings?.moqDefaultUnits)
        ?? 0;
    const stock0 = context.closingStockBySku?.[sku]?.[context.baselineMonth] ?? 0;
    const projection = (0, foSuggestion_js_1.buildSkuProjection)({
        sku,
        baselineMonth: context.baselineMonth,
        stock0,
        forecastByMonth: context.plannedSalesBySku?.[sku] || {},
        inboundByMonth: context.inboundBySku?.[sku] || {},
        horizonMonths: Number(input.horizonMonths || 12),
    });
    return (0, foSuggestion_js_1.computeFoRecommendation)({
        sku,
        baselineMonth: context.baselineMonth,
        projection,
        plannedSalesBySku: context.plannedSalesBySku,
        safetyStockDays: safetyDays,
        coverageDays,
        leadTimeDays: Number(input.leadTimeDays || 0),
        cnyPeriod: input.settings?.cny,
        inboundWithoutEtaCount: context.inboundWithoutEtaCount,
        moqUnits,
        requiredArrivalMonth: input.requiredArrivalMonth,
    });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePaymentId = normalizePaymentId;
exports.buildPaymentId = buildPaymentId;
exports.normalizeUrl = normalizeUrl;
exports.isHttpUrl = isHttpUrl;
exports.allocatePayment = allocatePayment;
exports.validatePaymentModalState = validatePaymentModalState;
const numberFormat_js_1 = require("./numberFormat.js");
function normalizePaymentId(value) {
    if (!value)
        return null;
    const raw = String(value).trim();
    if (!raw)
        return null;
    const normalized = raw.replace(/^(pay-?)+/i, "");
    return `pay-${normalized}`;
}
function buildPaymentId() {
    return normalizePaymentId(`pay-${Math.random().toString(36).slice(2, 9)}`);
}
function normalizeUrl(value) {
    return String(value || "").trim();
}
function isHttpUrl(value) {
    if (!value)
        return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    }
    catch (err) {
        return false;
    }
}
function allocatePayment(total, selectedEvents) {
    if (!Number.isFinite(total))
        return null;
    const safeEvents = (selectedEvents || []).filter(evt => evt && Number.isFinite(Number(evt.plannedEur)));
    if (!safeEvents.length)
        return null;
    const plannedSum = safeEvents.reduce((sum, evt) => sum + Number(evt.plannedEur || 0), 0);
    if (plannedSum <= 0) {
        const even = Math.round((total / safeEvents.length) * 100) / 100;
        return safeEvents.map(evt => ({ eventId: evt.id, planned: 0, actual: even }));
    }
    const allocations = safeEvents.map(evt => {
        const planned = Number(evt.plannedEur || 0);
        const share = planned / plannedSum;
        const actual = Math.round((total * share) * 100) / 100;
        return { eventId: evt.id, planned, actual };
    });
    const allocatedSum = allocations.reduce((sum, entry) => sum + entry.actual, 0);
    const remainder = Math.round((total - allocatedSum) * 100) / 100;
    if (remainder !== 0) {
        let target = allocations[allocations.length - 1];
        if (allocations.length > 1) {
            target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
        }
        target.actual = Math.round((target.actual + remainder) * 100) / 100;
    }
    return allocations;
}
function validatePaymentModalState({ selectedEvents, actualRaw, invoiceUrl, folderUrl, paymentRecord, paymentIdValue, mergedPayments = [], }) {
    const fieldErrors = {};
    const safeEvents = selectedEvents || [];
    if (!safeEvents.length) {
        fieldErrors.events = "Bitte mindestens ein Event auswählen.";
        return { valid: false, reason: fieldErrors.events, fieldErrors };
    }
    const sumPlanned = safeEvents.reduce((sum, evt) => {
        const planned = Number(evt.plannedEur);
        return sum + (Number.isFinite(planned) ? planned : 0);
    }, 0);
    const parsedActual = actualRaw ? (0, numberFormat_js_1.parseMoneyInput)(actualRaw) : sumPlanned;
    if (!Number.isFinite(parsedActual)) {
        fieldErrors.actual = "Bitte einen gültigen Ist-Betrag eingeben.";
        return { valid: false, reason: fieldErrors.actual, fieldErrors, sumPlanned };
    }
    if (parsedActual < 0) {
        fieldErrors.actual = "Ist-Betrag darf nicht negativ sein.";
        return { valid: false, reason: fieldErrors.actual, fieldErrors, sumPlanned, parsedActual };
    }
    if (parsedActual === 0 && sumPlanned > 0) {
        fieldErrors.actual = "Ist-Betrag darf nicht 0 sein, wenn ein Soll-Betrag vorhanden ist.";
        return { valid: false, reason: fieldErrors.actual, fieldErrors, sumPlanned, parsedActual };
    }
    const allocations = allocatePayment(parsedActual, safeEvents);
    if (!allocations) {
        fieldErrors.actual = "Konnte die Ist-Beträge nicht aufteilen.";
        return { valid: false, reason: fieldErrors.actual, fieldErrors, sumPlanned, parsedActual };
    }
    if (invoiceUrl && !isHttpUrl(invoiceUrl)) {
        fieldErrors.invoiceUrl = "Invoice URL muss mit http:// oder https:// beginnen.";
        return { valid: false, reason: fieldErrors.invoiceUrl, fieldErrors, sumPlanned, parsedActual };
    }
    if (folderUrl && !isHttpUrl(folderUrl)) {
        fieldErrors.folderUrl = "Folder URL muss mit http:// oder https:// beginnen.";
        return { valid: false, reason: fieldErrors.folderUrl, fieldErrors, sumPlanned, parsedActual };
    }
    const requestedPaymentId = normalizePaymentId(paymentIdValue) || (paymentRecord?.id || buildPaymentId());
    if (paymentRecord?.id && requestedPaymentId !== paymentRecord.id) {
        const duplicate = mergedPayments.find(entry => entry?.id === requestedPaymentId);
        if (duplicate) {
            fieldErrors.paymentId = "Diese Payment-ID ist bereits vergeben.";
            return { valid: false, reason: fieldErrors.paymentId, fieldErrors, sumPlanned, parsedActual };
        }
    }
    return {
        valid: true,
        fieldErrors,
        selectedEvents: safeEvents,
        sumPlanned,
        parsedActual,
        allocations,
        invoiceUrl,
        folderUrl,
        requestedPaymentId,
    };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthFromDate = exports.normalizeIsoDate = void 0;
exports.isPaidLike = isPaidLike;
exports.buildResolvedPoPaymentMilestones = buildResolvedPoPaymentMilestones;
exports.buildResolvedPoPaymentListSummary = buildResolvedPoPaymentListSummary;
const poPaymentIdentity_js_1 = require("./poPaymentIdentity.js");
const poPlanningCore_js_1 = require("./poPlanningCore.js");
Object.defineProperty(exports, "normalizeIsoDate", { enumerable: true, get: function () { return poPlanningCore_js_1.normalizeIsoDate; } });
Object.defineProperty(exports, "monthFromDate", { enumerable: true, get: function () { return poPlanningCore_js_1.monthFromDate; } });
function normaliseAutoEvents(record, settings, manual) {
    const order = ["freight", "duty", "eust", "vat_refund", "fx_fee"];
    const clones = Array.isArray(record?.autoEvents)
        ? record.autoEvents.filter(Boolean).map((entry) => ({ ...entry }))
        : [];
    const map = new Map();
    clones.forEach((entry) => {
        if (!entry?.type)
            return;
        const canonicalId = (0, poPaymentIdentity_js_1.getCanonicalPoAutoEventId)(record, entry.type);
        if (canonicalId)
            entry.id = canonicalId;
        map.set(entry.type, entry);
    });
    const poDueDefaults = settings?.paymentDueDefaults?.po || {};
    const firstManual = (manual || [])[0] || null;
    const resolveAnchor = (value, fallback) => {
        const upper = String(value || "").trim().toUpperCase();
        if (["ORDER_DATE", "PROD_DONE", "ETD", "ETA"].includes(upper))
            return upper;
        return fallback;
    };
    const resolveLagDays = (value, fallback = 0) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed))
            return fallback;
        return Math.round(parsed);
    };
    const defaultDue = (key, fallbackAnchor, fallbackLagDays) => {
        const row = poDueDefaults[key] && typeof poDueDefaults[key] === "object"
            ? poDueDefaults[key]
            : {};
        return {
            anchor: resolveAnchor(row.anchor, fallbackAnchor),
            lagDays: resolveLagDays(row.lagDays, fallbackLagDays),
        };
    };
    const freightDue = defaultDue("freight", "ETA", settings?.freightLagDays);
    const dutyDue = defaultDue("duty", "ETA", settings?.freightLagDays);
    const eustDue = defaultDue("eust", "ETA", settings?.freightLagDays);
    const vatRefundDue = defaultDue("vatRefund", "ETA", 0);
    function ensure(type, defaults) {
        if (!map.has(type)) {
            const created = { id: (0, poPaymentIdentity_js_1.getCanonicalPoAutoEventId)(record, type), type, ...defaults };
            clones.push(created);
            map.set(type, created);
            return created;
        }
        const existing = map.get(type);
        if (!existing.id)
            existing.id = (0, poPaymentIdentity_js_1.getCanonicalPoAutoEventId)(record, type);
        Object.entries(defaults).forEach(([key, value]) => {
            if (existing[key] === undefined)
                existing[key] = value;
        });
        return existing;
    }
    ensure("freight", {
        label: "Fracht",
        anchor: freightDue.anchor,
        lagDays: freightDue.lagDays,
        enabled: true,
    });
    ensure("duty", {
        label: "Zoll",
        percent: settings?.dutyRatePct,
        anchor: dutyDue.anchor,
        lagDays: dutyDue.lagDays,
        enabled: true,
    });
    ensure("eust", {
        label: "EUSt",
        percent: settings?.eustRatePct,
        anchor: eustDue.anchor,
        lagDays: eustDue.lagDays,
        enabled: true,
    });
    ensure("vat_refund", {
        label: "EUSt-Erstattung",
        percent: 100,
        anchor: vatRefundDue.anchor,
        lagDays: vatRefundDue.lagDays,
        lagMonths: settings?.vatRefundLagMonths,
        enabled: settings?.vatRefundEnabled,
    });
    ensure("fx_fee", {
        label: "FX-Gebühr",
        percent: settings?.fxFeePct,
        anchor: (firstManual && firstManual.anchor) || "ORDER_DATE",
        lagDays: (firstManual && Number(firstManual.lagDays || 0)) || 0,
    });
    clones.sort((left, right) => order.indexOf(left.type) - order.indexOf(right.type));
    if (record?.ddp) {
        clones.forEach((entry) => {
            if (entry.type === "freight" || entry.type === "duty" || entry.type === "eust" || entry.type === "vat_refund") {
                entry.enabled = false;
            }
        });
    }
    return clones;
}
function buildPlannedPoPaymentRows(record, settings) {
    if (!record || typeof record !== "object")
        return [];
    const workingRecord = (0, poPaymentIdentity_js_1.normalizePoPaymentStateRecord)(record, { mutate: false }).record;
    const ref = String(workingRecord.poNo || workingRecord.id || "").trim();
    const prefix = ref ? `PO ${ref}` : "PO";
    const manualMilestones = Array.isArray(workingRecord.milestones) ? workingRecord.milestones : [];
    const autoEvents = normaliseAutoEvents(workingRecord, settings || {}, manualMilestones);
    const anchors = (0, poPlanningCore_js_1.computeAnchors)(workingRecord, settings || {});
    const totals = (0, poPlanningCore_js_1.computeGoodsTotals)(workingRecord, settings || {});
    const goods = Number(totals.eur || 0);
    const freight = (0, poPlanningCore_js_1.computeFreightTotal)(workingRecord, totals);
    const results = [];
    manualMilestones.forEach((milestone, index) => {
        const percent = (0, poPlanningCore_js_1.parsePercent)(milestone?.percent);
        const anchor = String(milestone?.anchor || "ORDER_DATE");
        const baseDate = anchors[anchor] || anchors.ORDER_DATE;
        if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime()))
            return;
        const dueDate = (0, poPlanningCore_js_1.addDays)(baseDate, Number(milestone?.lagDays || 0));
        results.push({
            id: String(milestone?.id || `po-ms-${index + 1}`),
            label: `${prefix}${milestone?.label ? ` – ${String(milestone.label).trim()}` : ""}`,
            typeLabel: String(milestone?.label || "Zahlung").trim(),
            dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
            plannedEur: Math.abs(goods * (percent / 100)),
            direction: "out",
            eventType: "manual",
        });
    });
    // All import-cost amounts come from the shared, drift-free core (poPlanningCore.js)
    // so the dashboard/cashflow and the PO modal cannot diverge. Rate resolution lives in
    // resolveRates (per-PO field wins, settings is fallback, stale autoEvent.percent is
    // ignored) and the goods → duty → EUSt → FX chain lives in computeImportCostBreakdown.
    const rates = (0, poPlanningCore_js_1.resolveRates)(workingRecord, settings || {});
    const breakdown = (0, poPlanningCore_js_1.computeImportCostBreakdown)({ goods, freight, rates });
    const vatLagMonths = rates.vatRefundLagMonths;
    const autoResults = {};
    autoEvents.forEach((event, index) => {
        if (!event || event.enabled === false)
            return;
        const anchor = String(event.anchor || "ETA");
        const baseDate = anchors[anchor] || anchors.ETA;
        if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime()))
            return;
        if (event.type === "freight") {
            if (!freight)
                return;
            const dueDate = (0, poPlanningCore_js_1.addDays)(baseDate, Number(event.lagDays || 0));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "Fracht").trim(),
                dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
                plannedEur: Math.abs(freight),
                direction: "out",
                eventType: "freight",
            });
            return;
        }
        if (event.type === "duty") {
            const dueDate = (0, poPlanningCore_js_1.addDays)(baseDate, Number(event.lagDays || 0));
            autoResults.duty = { amount: breakdown.dutyEur, dueDate };
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "Zoll").trim(),
                dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
                plannedEur: breakdown.dutyEur,
                direction: "out",
                eventType: "duty",
            });
            return;
        }
        if (event.type === "eust") {
            const dueDate = (0, poPlanningCore_js_1.addDays)(baseDate, Number(event.lagDays || 0));
            autoResults.eust = { amount: breakdown.eustEur, dueDate };
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "EUSt").trim(),
                dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
                plannedEur: breakdown.eustEur,
                direction: "out",
                eventType: "eust",
            });
            return;
        }
        if (event.type === "vat_refund") {
            const eust = autoResults.eust;
            if (!eust || eust.amount === 0)
                return;
            const amount = (0, poPlanningCore_js_1.computeVatRefundEur)(breakdown.eustEur, event.percent ?? 100, rates.vatRefundEnabled);
            if (!amount)
                return;
            const lagMonths = Number(event.lagMonths ?? vatLagMonths) || 0;
            const baseDay = (0, poPlanningCore_js_1.addDays)(eust.dueDate || baseDate, Number(event.lagDays || 0));
            const dueDate = (0, poPlanningCore_js_1.monthEndDate)((0, poPlanningCore_js_1.addMonthsDate)(baseDay, lagMonths));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "EUSt-Erstattung").trim(),
                dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
                plannedEur: amount,
                direction: "in",
                eventType: "vat_refund",
            });
            return;
        }
        if (event.type === "fx_fee") {
            if (!breakdown.fxFeeEur)
                return;
            const dueDate = (0, poPlanningCore_js_1.addDays)(baseDate, Number(event.lagDays || 0));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "FX-Gebühr").trim(),
                dueDate: (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate),
                plannedEur: breakdown.fxFeeEur,
                direction: "out",
                eventType: "fx_fee",
            });
        }
    });
    return results
        .filter((entry) => Number(entry.plannedEur || 0) > 0)
        .map((entry) => ({
        ...entry,
        plannedEur: (0, poPlanningCore_js_1.round2)(entry.plannedEur) || 0,
    }));
}
function firstNonEmpty(...values) {
    for (const value of values) {
        if (value == null)
            continue;
        if (typeof value === "string") {
            if (value.trim())
                return value;
            continue;
        }
        return value;
    }
    return null;
}
function readFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function isPaidLike(value) {
    if (value === true || value === 1)
        return true;
    const raw = String(value || "").trim().toLowerCase();
    return raw === "paid"
        || raw === "bezahlt"
        || raw === "done"
        || raw === "true"
        || raw === "1"
        || raw === "yes"
        || raw === "ja";
}
function isActualAmountUsable(amount, planned) {
    if (!Number.isFinite(Number(amount)))
        return false;
    const actual = Number(amount);
    const plannedValue = Number.isFinite(Number(planned)) ? Number(planned) : null;
    if (actual > 0)
        return true;
    if (actual === 0 && plannedValue != null && plannedValue === 0)
        return true;
    return false;
}
function buildPaymentIndexes(payments) {
    const byId = new Map();
    (Array.isArray(payments) ? payments : []).forEach((entry) => {
        const payment = entry || {};
        const paymentId = String(payment.id || "").trim();
        if (!paymentId)
            return;
        byId.set(paymentId, payment);
    });
    return { byId };
}
function allocateByPlanned(total, events) {
    const plannedValues = events.map((entry) => Number(entry.plannedEur || 0));
    const sumPlanned = plannedValues.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(sumPlanned) || sumPlanned <= 0)
        return null;
    const allocations = plannedValues.map((planned, index) => {
        const share = planned / sumPlanned;
        const raw = total * share;
        return {
            eventId: events[index].id,
            planned,
            actual: Math.round(raw * 100) / 100,
        };
    });
    const roundedSum = allocations.reduce((sum, entry) => sum + entry.actual, 0);
    const remainder = Math.round((total - roundedSum) * 100) / 100;
    if (Math.abs(remainder) > 0 && allocations.length) {
        let target = allocations[allocations.length - 1];
        if (allocations.length > 1) {
            target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
        }
        target.actual = Math.round((target.actual + remainder) * 100) / 100;
    }
    return allocations;
}
function resolveActualAllocation({ payment, paymentRow, paymentRows }) {
    if (!payment || !paymentRow?.paymentId)
        return null;
    const total = Number(payment.amountActualEurTotal);
    if (!Number.isFinite(total))
        return null;
    const related = paymentRows.filter((row) => String(row?.paymentId || "") === String(paymentRow.paymentId || ""));
    if (!related.length)
        return null;
    const allocations = allocateByPlanned(total, related.map((row) => ({
        id: String(row.id || ""),
        plannedEur: Number(row.plannedEur || 0),
    })));
    if (!allocations)
        return null;
    return allocations.find((entry) => entry.eventId === paymentRow.id) || null;
}
function resolveActualAmountForLine({ plannedEur, paymentRow, paymentRows, paymentRecord, paymentLogEntry, eventId, }) {
    const directCandidates = [
        paymentRow?.paidEurActual,
        paymentLogEntry?.amountActualEur,
    ];
    for (const candidate of directCandidates) {
        if (candidate == null || candidate === "")
            continue;
        if (!Number.isFinite(Number(candidate)))
            continue;
        if (isActualAmountUsable(candidate, plannedEur)) {
            return Number(candidate);
        }
        return Number(candidate);
    }
    if (paymentRecord?.allocations && Array.isArray(paymentRecord.allocations)) {
        const allocation = paymentRecord.allocations.find((entryRaw) => {
            const entry = entryRaw || {};
            const allocationEventId = String(entry.eventId || entry.plannedId || "").trim();
            return allocationEventId === String(eventId || "");
        }) || null;
        if (allocation) {
            const allocationAmount = firstNonEmpty(allocation.amountEur, allocation.amountActualEur, allocation.actualEur, allocation.actual);
            if (allocationAmount !== null && isActualAmountUsable(allocationAmount, plannedEur)) {
                return Number(allocationAmount);
            }
        }
    }
    if (paymentRecord && paymentRow?.paymentId) {
        const allocation = resolveActualAllocation({ payment: paymentRecord, paymentRow, paymentRows });
        if (allocation && isActualAmountUsable(allocation.actual, plannedEur)) {
            return Number(allocation.actual);
        }
        if (isActualAmountUsable(paymentRecord.amountActualEurTotal, plannedEur)) {
            const related = paymentRows.filter((row) => String(row?.paymentId || "") === String(paymentRow?.paymentId || ""));
            if (related.length <= 1) {
                return Number(paymentRecord.amountActualEurTotal);
            }
        }
    }
    return null;
}
function resolvePaymentViewState(segments) {
    const states = Array.from(new Set((Array.isArray(segments) ? segments : []).map((segment) => String(segment.viewState || "")).filter(Boolean)));
    if (!states.length)
        return "open";
    if (states.includes("paid"))
        return "paid";
    if (states.includes("overdue"))
        return "overdue";
    if (states.includes("open"))
        return "open";
    return states[0];
}
function resolveOpenViewState(dueDate, todayIso) {
    if (dueDate && todayIso && dueDate < todayIso)
        return "overdue";
    return "open";
}
function resolveCashflowKind(eventType) {
    if (String(eventType || "").toLowerCase() === "manual")
        return "po";
    if (String(eventType || "").toLowerCase() === "vat_refund")
        return "po-refund";
    return "po-import";
}
function resolveCashflowGroup(kind) {
    return kind === "po" ? "PO/FO-Zahlungen" : "Importkosten";
}
function buildResolvedPoPaymentMilestones(record, settings, paymentRecords = [], options = {}) {
    if (!record || typeof record !== "object")
        return [];
    const workingRecord = (0, poPaymentIdentity_js_1.normalizePoPaymentStateRecord)(record, { mutate: false }).record;
    const todayIso = (0, poPlanningCore_js_1.normalizeIsoDate)(options.today) || (0, poPlanningCore_js_1.normalizeIsoDate)(new Date());
    const paymentLog = (workingRecord.paymentLog && typeof workingRecord.paymentLog === "object") ? workingRecord.paymentLog : {};
    const paymentIndexes = buildPaymentIndexes(paymentRecords);
    const paymentRows = buildPlannedPoPaymentRows(workingRecord, settings || {}).map((paymentRowRaw) => {
        const paymentRow = paymentRowRaw || {};
        const logEntry = (paymentLog[paymentRow.id] && typeof paymentLog[paymentRow.id] === "object")
            ? paymentLog[paymentRow.id]
            : {};
        const paymentId = String(firstNonEmpty(paymentRow.paymentId, logEntry.paymentId) || "").trim();
        return {
            ...paymentRow,
            paymentId: paymentId || null,
            paidDate: (0, poPlanningCore_js_1.normalizeIsoDate)(logEntry.paidDate),
            paidEurActual: readFiniteNumber(logEntry.amountActualEur),
        };
    });
    return paymentRows
        .map((paymentRowRaw, index) => {
        const paymentRow = paymentRowRaw || {};
        const eventId = String(paymentRow.id || `po-payment-${index + 1}`).trim();
        if (!eventId)
            return null;
        const logEntry = (paymentLog[eventId] && typeof paymentLog[eventId] === "object")
            ? paymentLog[eventId]
            : {};
        const plannedEur = Math.abs(Number(paymentRow.plannedEur || 0));
        const direction = String(paymentRow.direction || "").trim().toLowerCase() === "in" ? "in" : "out";
        const dueDate = (0, poPlanningCore_js_1.normalizeIsoDate)(firstNonEmpty(paymentRow.dueDate, logEntry.dueDate));
        const paymentId = String(firstNonEmpty(paymentRow.paymentId, logEntry.paymentId) || "").trim();
        const paymentRecord = paymentId ? paymentIndexes.byId.get(paymentId) || null : null;
        let paidDate = (0, poPlanningCore_js_1.normalizeIsoDate)(firstNonEmpty(paymentRow.paidDate, logEntry.paidDate, paymentRecord?.paidDate));
        const resolvedActual = resolveActualAmountForLine({
            plannedEur,
            paymentRow,
            paymentRows,
            paymentRecord,
            paymentLogEntry: logEntry,
            eventId,
        });
        const rawActualPaidEur = isActualAmountUsable(resolvedActual, plannedEur)
            ? Math.abs(Number(resolvedActual))
            : 0;
        const hasPaymentEvidence = (0, poPaymentIdentity_js_1.hasExplicitPoPaymentEvidence)({
            status: firstNonEmpty(paymentRow.status, logEntry.status),
            paid: logEntry.paid,
            paymentId,
            paidDate,
            amountActualEur: firstNonEmpty(paymentRow.paidEurActual, logEntry.amountActualEur, resolvedActual),
            amountActualUsd: logEntry.amountActualUsd,
        });
        let paidEur = rawActualPaidEur;
        if (hasPaymentEvidence && paidEur <= 0 && plannedEur >= 0) {
            paidEur = plannedEur;
        }
        if (paidEur > 0 && !paidDate && dueDate) {
            paidDate = dueDate;
        }
        const displayAmountEur = hasPaymentEvidence
            ? ((0, poPlanningCore_js_1.round2)(paidEur) || 0)
            : ((0, poPlanningCore_js_1.round2)(plannedEur) || 0);
        const displayMonth = hasPaymentEvidence
            ? (0, poPlanningCore_js_1.monthFromDate)(paidDate || dueDate)
            : (0, poPlanningCore_js_1.monthFromDate)(dueDate || paidDate);
        const displayDate = hasPaymentEvidence
            ? (0, poPlanningCore_js_1.normalizeIsoDate)(paidDate || dueDate) || null
            : (0, poPlanningCore_js_1.normalizeIsoDate)(dueDate || paidDate) || null;
        const eventViewState = hasPaymentEvidence ? "paid" : resolveOpenViewState(dueDate, todayIso);
        const normalizedPaidEur = (0, poPlanningCore_js_1.round2)(paidEur) || 0;
        const remainingEur = hasPaymentEvidence
            ? 0
            : (plannedEur > 0 ? Math.max(0, (0, poPlanningCore_js_1.round2)(plannedEur) || 0) : 0);
        const kind = resolveCashflowKind(paymentRow.eventType);
        const group = resolveCashflowGroup(kind);
        const segments = [];
        if (displayAmountEur > 0 && displayMonth) {
            segments.push({
                id: `${eventId}:${eventViewState}`,
                eventId,
                amountEur: displayAmountEur,
                month: displayMonth,
                displayDate: displayDate || null,
                displayDateKind: hasPaymentEvidence ? "paid" : "due",
                dueDate: dueDate || null,
                paidDate: paidDate || null,
                viewState: eventViewState,
                statusLabel: hasPaymentEvidence ? "Bezahlt" : "Offen",
                isOverdue: eventViewState === "overdue",
                direction,
                kind,
                group,
                label: String(paymentRow.label || "").trim(),
                typeLabel: String(paymentRow.typeLabel || paymentRow.label || "Zahlung").trim(),
                eventType: String(paymentRow.eventType || "").trim() || null,
                plannedEur,
                paidEur: normalizedPaidEur,
                remainingEur,
                paymentId: paymentId || null,
            });
        }
        if (!segments.length)
            return null;
        return {
            id: eventId,
            eventId,
            label: String(paymentRow.label || "").trim(),
            typeLabel: String(paymentRow.typeLabel || paymentRow.label || "Zahlung").trim(),
            dueDate: dueDate || null,
            paidDate: paidDate || null,
            displayDate,
            displayMonth,
            displayAmountEur,
            status: hasPaymentEvidence ? "paid" : "open",
            direction,
            plannedEur: (0, poPlanningCore_js_1.round2)(plannedEur) || 0,
            paidEur: normalizedPaidEur,
            remainingEur,
            paymentId: paymentId || null,
            eventType: String(paymentRow.eventType || "").trim() || null,
            kind,
            group,
            viewState: resolvePaymentViewState(segments),
            segments,
        };
    })
        .filter(Boolean);
}
function buildResolvedPoPaymentListSummary(record, settings, paymentRecords = [], options = {}) {
    const milestones = buildResolvedPoPaymentMilestones(record, settings, paymentRecords, options)
        .filter((milestone) => {
        if (!milestone || typeof milestone !== "object")
            return false;
        if (String(milestone.direction || "").trim().toLowerCase() === "in")
            return false;
        return Number(milestone.plannedEur || 0) > 0;
    });
    const paidEur = (0, poPlanningCore_js_1.round2)(milestones.reduce((sum, milestone) => sum + Math.abs(Number(milestone?.paidEur || 0)), 0)) || 0;
    const openEur = (0, poPlanningCore_js_1.round2)(milestones.reduce((sum, milestone) => sum + Math.max(0, Number(milestone?.remainingEur || 0)), 0)) || 0;
    const statusText = openEur <= 0 && paidEur > 0
        ? "paid_only"
        : (openEur > 0 && paidEur > 0 ? "mixed" : "open");
    return {
        milestones,
        paidEur,
        openEur,
        statusText,
    };
}

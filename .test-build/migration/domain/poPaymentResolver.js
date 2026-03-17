"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIsoDate = normalizeIsoDate;
exports.monthFromDate = monthFromDate;
exports.isPaidLike = isPaidLike;
exports.buildResolvedPoPaymentMilestones = buildResolvedPoPaymentMilestones;
exports.buildResolvedPoPaymentListSummary = buildResolvedPoPaymentListSummary;
const dataHealth_js_1 = require("../lib/dataHealth.js");
const poPaymentIdentity_js_1 = require("./poPaymentIdentity.js");
function parseNumber(value, fallback = 0) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Number(parsed);
}
function parsePercent(value) {
    return Math.min(100, Math.max(0, parseNumber(value, 0)));
}
function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
}
function addMonthsDate(date, months) {
    const next = new Date(date.getTime());
    next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
    return next;
}
function monthEndDate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}
function parseISODate(value) {
    const iso = normalizeIsoDate(value);
    if (!iso)
        return null;
    const [year, month, day] = iso.split("-").map(Number);
    if (!year || !month || !day)
        return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
}
function getCnyWindow(settings, year) {
    const direct = settings?.cny;
    if (direct?.start && direct?.end) {
        const start = parseISODate(direct.start);
        const end = parseISODate(direct.end);
        if (start && end && end >= start)
            return { start, end };
    }
    const entry = settings?.cnyBlackoutByYear?.[String(year)];
    if (!entry)
        return null;
    const start = parseISODate(entry.start);
    const end = parseISODate(entry.end);
    if (!start || !end || end < start)
        return null;
    return { start, end };
}
function applyCnyBlackout(orderDate, prodDays, settings) {
    if (!(orderDate instanceof Date) || Number.isNaN(orderDate.getTime())) {
        return { prodDone: orderDate, adjustmentDays: 0 };
    }
    const baseDays = Math.max(0, Number(prodDays || 0));
    const prodEnd = addDays(orderDate, baseDays);
    if (!settings || baseDays === 0) {
        return { prodDone: prodEnd, adjustmentDays: 0 };
    }
    let adjustmentDays = 0;
    const startYear = orderDate.getUTCFullYear();
    const endYear = prodEnd.getUTCFullYear();
    for (let year = startYear; year <= endYear; year += 1) {
        const window = getCnyWindow(settings, year);
        if (!window)
            continue;
        const overlapStart = window.start > orderDate ? window.start : orderDate;
        const overlapEnd = window.end < prodEnd ? window.end : prodEnd;
        if (overlapEnd < overlapStart)
            continue;
        const overlap = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        adjustmentDays += Math.max(0, overlap);
    }
    return {
        prodDone: adjustmentDays ? addDays(prodEnd, adjustmentDays) : prodEnd,
        adjustmentDays,
    };
}
function computeGoodsTotals(record, settings) {
    const items = Array.isArray(record?.items) ? record.items : [];
    let totalUsd = 0;
    let totalUnits = 0;
    if (items.length) {
        items.forEach((item) => {
            const units = parseNumber(item?.units ?? 0, 0);
            const unitCostUsd = parseNumber(item?.unitCostUsd ?? 0, 0);
            const unitExtraUsd = parseNumber(item?.unitExtraUsd ?? 0, 0);
            const extraFlatUsd = parseNumber(item?.extraFlatUsd ?? 0, 0);
            const subtotal = Math.max(0, Math.round((((unitCostUsd + unitExtraUsd) * units) + extraFlatUsd) * 100) / 100);
            if (Number.isFinite(subtotal))
                totalUsd += subtotal;
            if (Number.isFinite(units))
                totalUnits += units;
        });
    }
    else {
        const units = parseNumber(record?.units ?? 0, 0);
        const unitCostUsd = parseNumber(record?.unitCostUsd ?? 0, 0);
        const unitExtraUsd = parseNumber(record?.unitExtraUsd ?? 0, 0);
        const extraFlatUsd = parseNumber(record?.extraFlatUsd ?? 0, 0);
        totalUsd = Math.max(0, Math.round((((unitCostUsd + unitExtraUsd) * units) + extraFlatUsd) * 100) / 100);
        if (Number.isFinite(units))
            totalUnits = units;
    }
    const override = parseNumber(record?.fxOverride ?? 0, 0);
    const fxRate = (Number.isFinite(override) && override > 0)
        ? override
        : parseNumber(settings?.fxRate ?? 0, 0);
    const derivedEur = fxRate > 0 ? Math.round((totalUsd / fxRate) * 100) / 100 : 0;
    const fallbackEur = parseNumber(record?.goodsEur ?? 0, 0);
    return {
        usd: totalUsd,
        eur: derivedEur > 0 ? derivedEur : fallbackEur,
        units: totalUnits,
    };
}
function resolveFreightInputMode(record) {
    const mode = String(record?.timeline?.freightInputMode || "").trim().toUpperCase();
    if (mode === "TOTAL_EUR" || mode === "PER_UNIT_EUR" || mode === "AUTO_FROM_LANDED")
        return mode;
    return record?.freightMode === "per_unit" ? "PER_UNIT_EUR" : "TOTAL_EUR";
}
function computeFreightTotal(record, totals) {
    if (record?.timeline?.includeFreight === false)
        return 0;
    const mode = resolveFreightInputMode(record);
    if (mode === "PER_UNIT_EUR") {
        const perUnit = parseNumber(record?.freightPerUnitEur ?? 0, 0);
        const units = Number(totals?.units ?? 0) || 0;
        return Math.round(perUnit * units * 100) / 100;
    }
    if (mode === "AUTO_FROM_LANDED") {
        return parseNumber(record?.derived?.estimatedFreightEur ?? record?.freightEur ?? 0, 0);
    }
    return parseNumber(record?.freightEur ?? 0, 0);
}
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
function anchorsFor(record, settings) {
    const orderDate = parseISODate(record?.orderDate) || new Date();
    const prodDays = Number(record?.productionLeadTimeDays ?? record?.prodDays ?? 0);
    const transitDays = Number(record?.logisticsLeadTimeDays ?? record?.transitDays ?? 0);
    const blackout = applyCnyBlackout(orderDate, prodDays, settings);
    const prodDone = blackout.prodDone ?? addDays(orderDate, prodDays);
    const etdComputed = prodDone;
    const etaComputed = addDays(etdComputed, transitDays);
    const etdManual = parseISODate(record?.etdManual);
    const etaManual = parseISODate(record?.etaManual);
    return {
        ORDER_DATE: orderDate,
        PROD_DONE: prodDone,
        PRODUCTION_END: prodDone,
        ETD: etdManual || etdComputed,
        ETA: etaManual || etaComputed,
    };
}
function buildPlannedPoPaymentRows(record, settings) {
    if (!record || typeof record !== "object")
        return [];
    const workingRecord = (0, poPaymentIdentity_js_1.normalizePoPaymentStateRecord)(record, { mutate: false }).record;
    const ref = String(workingRecord.poNo || workingRecord.id || "").trim();
    const prefix = ref ? `PO ${ref}` : "PO";
    const manualMilestones = Array.isArray(workingRecord.milestones) ? workingRecord.milestones : [];
    const autoEvents = normaliseAutoEvents(workingRecord, settings || {}, manualMilestones);
    const anchors = anchorsFor(workingRecord, settings || {});
    const totals = computeGoodsTotals(workingRecord, settings || {});
    const goods = Number(totals.eur || 0);
    const freight = computeFreightTotal(workingRecord, totals);
    const results = [];
    manualMilestones.forEach((milestone, index) => {
        const percent = parsePercent(milestone?.percent);
        const anchor = String(milestone?.anchor || "ORDER_DATE");
        const baseDate = anchors[anchor] || anchors.ORDER_DATE;
        if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime()))
            return;
        const dueDate = addDays(baseDate, Number(milestone?.lagDays || 0));
        results.push({
            id: String(milestone?.id || `po-ms-${index + 1}`),
            label: `${prefix}${milestone?.label ? ` – ${String(milestone.label).trim()}` : ""}`,
            typeLabel: String(milestone?.label || "Zahlung").trim(),
            dueDate: normalizeIsoDate(dueDate),
            plannedEur: Math.abs(goods * (percent / 100)),
            direction: "out",
            eventType: "manual",
        });
    });
    const dutyIncludeFreight = workingRecord?.dutyIncludeFreight !== false;
    const dutyRate = parsePercent(workingRecord?.dutyRatePct ?? settings?.dutyRatePct ?? 0);
    const eustRate = parsePercent(workingRecord?.eustRatePct ?? settings?.eustRatePct ?? 0);
    const fxFeePct = parsePercent(workingRecord?.fxFeePct ?? settings?.fxFeePct ?? 0);
    const vatLagMonths = Number(workingRecord?.vatRefundLagMonths ?? settings?.vatRefundLagMonths ?? 0) || 0;
    const vatEnabled = workingRecord?.vatRefundEnabled !== false;
    const autoResults = {};
    autoEvents.forEach((event, index) => {
        if (!event || event.enabled === false)
            return;
        const anchor = String(event.anchor || "ETA");
        const baseDate = anchors[anchor] || anchors.ETA;
        if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime()))
            return;
        if (event.type === "freight") {
            const amount = computeFreightTotal(workingRecord, totals);
            if (!amount)
                return;
            const dueDate = addDays(baseDate, Number(event.lagDays || 0));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "Fracht").trim(),
                dueDate: normalizeIsoDate(dueDate),
                plannedEur: Math.abs(amount),
                direction: "out",
                eventType: "freight",
            });
            return;
        }
        if (event.type === "duty") {
            const baseValue = goods + (dutyIncludeFreight ? freight : 0);
            const dueDate = addDays(baseDate, Number(event.lagDays || 0));
            const amount = baseValue * (dutyRate / 100);
            autoResults.duty = { amount, dueDate };
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "Zoll").trim(),
                dueDate: normalizeIsoDate(dueDate),
                plannedEur: Math.abs(amount),
                direction: "out",
                eventType: "duty",
            });
            return;
        }
        if (event.type === "eust") {
            const dutyAbs = Math.abs(autoResults.duty?.amount || 0);
            const baseValue = goods + freight + dutyAbs;
            const dueDate = addDays(baseDate, Number(event.lagDays || 0));
            const amount = baseValue * (eustRate / 100);
            autoResults.eust = { amount, dueDate };
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "EUSt").trim(),
                dueDate: normalizeIsoDate(dueDate),
                plannedEur: Math.abs(amount),
                direction: "out",
                eventType: "eust",
            });
            return;
        }
        if (event.type === "vat_refund") {
            const eust = autoResults.eust;
            if (!vatEnabled || !eust || eust.amount === 0)
                return;
            const percent = parsePercent(event.percent ?? 100);
            const lagMonths = Number(event.lagMonths ?? vatLagMonths) || 0;
            const baseDay = addDays(eust.dueDate || baseDate, Number(event.lagDays || 0));
            const dueDate = monthEndDate(addMonthsDate(baseDay, lagMonths));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "EUSt-Erstattung").trim(),
                dueDate: normalizeIsoDate(dueDate),
                plannedEur: Math.abs(Math.abs(eust.amount) * (percent / 100)),
                direction: "in",
                eventType: "vat_refund",
            });
            return;
        }
        if (event.type === "fx_fee") {
            const percent = parsePercent(event.percent ?? fxFeePct);
            if (!percent)
                return;
            const dueDate = addDays(baseDate, Number(event.lagDays || 0));
            results.push({
                id: String(event.id || `po-auto-${index + 1}`),
                label: `${prefix}${event.label ? ` – ${String(event.label).trim()}` : ""}`,
                typeLabel: String(event.label || "FX-Gebühr").trim(),
                dueDate: normalizeIsoDate(dueDate),
                plannedEur: Math.abs(goods * (percent / 100)),
                direction: "out",
                eventType: "fx_fee",
            });
        }
    });
    return results
        .filter((entry) => Number(entry.plannedEur || 0) > 0)
        .map((entry) => ({
        ...entry,
        plannedEur: round2(entry.plannedEur) || 0,
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
function normalizeIsoDate(value) {
    if (!value)
        return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, "0");
        const day = String(value.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    const raw = String(value).trim();
    if (!raw)
        return "";
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch)
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const deMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (deMatch) {
        const day = String(Number(deMatch[1])).padStart(2, "0");
        const month = String(Number(deMatch[2])).padStart(2, "0");
        const year = String(Number(deMatch[3]));
        return `${year}-${month}-${day}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime()))
        return "";
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function monthFromDate(value) {
    const iso = normalizeIsoDate(value);
    return iso ? iso.slice(0, 7) : "";
}
function readFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function round2(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return Math.round(numeric * 100) / 100;
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
    const todayIso = normalizeIsoDate(options.today) || normalizeIsoDate(new Date());
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
            paidDate: normalizeIsoDate(logEntry.paidDate),
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
        const dueDate = normalizeIsoDate(firstNonEmpty(paymentRow.dueDate, logEntry.dueDate));
        const paymentId = String(firstNonEmpty(paymentRow.paymentId, logEntry.paymentId) || "").trim();
        const paymentRecord = paymentId ? paymentIndexes.byId.get(paymentId) || null : null;
        let paidDate = normalizeIsoDate(firstNonEmpty(paymentRow.paidDate, logEntry.paidDate, paymentRecord?.paidDate));
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
            ? (round2(paidEur) || 0)
            : (round2(plannedEur) || 0);
        const displayMonth = hasPaymentEvidence
            ? monthFromDate(paidDate || dueDate)
            : monthFromDate(dueDate || paidDate);
        const displayDate = hasPaymentEvidence
            ? normalizeIsoDate(paidDate || dueDate) || null
            : normalizeIsoDate(dueDate || paidDate) || null;
        const eventViewState = hasPaymentEvidence ? "paid" : resolveOpenViewState(dueDate, todayIso);
        const normalizedPaidEur = round2(paidEur) || 0;
        const remainingEur = hasPaymentEvidence
            ? 0
            : (plannedEur > 0 ? Math.max(0, round2(plannedEur) || 0) : 0);
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
            plannedEur: round2(plannedEur) || 0,
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
    const paidEur = round2(milestones.reduce((sum, milestone) => sum + Math.abs(Number(milestone?.paidEur || 0)), 0)) || 0;
    const openEur = round2(milestones.reduce((sum, milestone) => sum + Math.max(0, Number(milestone?.remainingEur || 0)), 0)) || 0;
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

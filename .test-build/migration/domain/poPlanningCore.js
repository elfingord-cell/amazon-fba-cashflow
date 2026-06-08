"use strict";
// Shared, drift-free core for deriving PO planning / import-cost amounts.
//
// Background: the PO payment / import-cost amounts used to be derived in two places
// with subtly different logic – the PO modal (src/ui/orderEditorFactory.js) and the
// dashboard/cashflow resolver (src/domain/poPaymentResolver.js). That drift produced
// real bugs (e.g. the customs/Zoll line computing to 0 EUR in the modal while the
// dashboard showed it open, because the modal resolved the duty rate from the stale
// denormalized autoEvent.percent instead of the per-PO record rate; the FX fee had the
// same latent pattern).
//
// To make sure every EUR amount comes from ONE implementation, this module owns:
//   - goods value (computeGoodsTotals)
//   - freight total (computeFreightTotal)
//   - rate resolution (resolveRates)  ← the exact surface where the bugs lived
//   - the import-cost breakdown chain (computeImportCostBreakdown): goods → duty →
//     EUSt → FX, plus the EUSt refund.
//
// Both the modal and the resolver pull their numbers from here, so they cannot drift.
// Each path keeps its own row/event assembly (ids, labels, due-date anchoring, output
// shape) because those already agree and are not the drift surface.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNumber = parseNumber;
exports.parsePercent = parsePercent;
exports.round2 = round2;
exports.addDays = addDays;
exports.addMonthsDate = addMonthsDate;
exports.monthEndDate = monthEndDate;
exports.normalizeIsoDate = normalizeIsoDate;
exports.monthFromDate = monthFromDate;
exports.parseISODate = parseISODate;
exports.applyCnyBlackout = applyCnyBlackout;
exports.computeGoodsTotals = computeGoodsTotals;
exports.resolveFreightInputMode = resolveFreightInputMode;
exports.computeFreightTotal = computeFreightTotal;
exports.computeAnchors = computeAnchors;
exports.resolveRates = resolveRates;
exports.computeImportCostBreakdown = computeImportCostBreakdown;
exports.computeVatRefundEur = computeVatRefundEur;
const dataHealth_js_1 = require("../lib/dataHealth.js");
function parseNumber(value, fallback = 0) {
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Number(parsed);
}
function parsePercent(value) {
    return Math.min(100, Math.max(0, parseNumber(value, 0)));
}
function round2(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return null;
    return Math.round(numeric * 100) / 100;
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
function computeAnchors(record, settings) {
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
        cnyAdjustmentDays: blackout.adjustmentDays || 0,
    };
}
// Canonical rate resolution. The per-PO field wins, falling back to the global settings
// rate. The denormalized autoEvent.percent is a STALE copy (seeded from the global rate
// at materialization) and must NEVER win – that is the bug that hit both duty and FX.
function resolveRates(record, settings) {
    return {
        dutyRatePct: parsePercent(record?.dutyRatePct ?? settings?.dutyRatePct ?? 0),
        eustRatePct: parsePercent(record?.eustRatePct ?? settings?.eustRatePct ?? 0),
        fxFeePct: parsePercent(record?.fxFeePct ?? settings?.fxFeePct ?? 0),
        dutyIncludeFreight: record?.dutyIncludeFreight !== false,
        vatRefundLagMonths: Number(record?.vatRefundLagMonths ?? settings?.vatRefundLagMonths ?? 0) || 0,
        vatRefundEnabled: record?.vatRefundEnabled !== false,
    };
}
// The single chain that turns goods + freight + rates into the import-cost amounts.
// All amounts are absolute EUR. The EUSt base intentionally includes the duty amount
// (goods + freight + duty), matching the German import-VAT base.
function computeImportCostBreakdown({ goods, freight, rates }) {
    const g = parseNumber(goods, 0);
    const f = parseNumber(freight, 0);
    const dutyBaseEur = g + (rates.dutyIncludeFreight ? f : 0);
    const dutyEur = Math.abs(dutyBaseEur * (rates.dutyRatePct / 100));
    const eustBaseEur = g + f + dutyEur;
    const eustEur = Math.abs(eustBaseEur * (rates.eustRatePct / 100));
    const fxFeeEur = Math.abs(g * (rates.fxFeePct / 100));
    return { dutyBaseEur, dutyEur, eustBaseEur, eustEur, fxFeeEur };
}
// EUSt refund amount. The refund percent is a genuine per-event value (default 100 %).
// Gated by vatRefundEnabled; callers additionally gate on the EUSt event being present.
function computeVatRefundEur(eustEur, percent, vatRefundEnabled) {
    const eust = parseNumber(eustEur, 0);
    if (!vatRefundEnabled || eust <= 0)
        return 0;
    return Math.abs(eust * (parsePercent(percent ?? 100) / 100));
}

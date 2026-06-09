"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMonthKey = exports.monthIndex = exports.currentMonthKey = exports.addMonths = void 0;
exports.monthRange = monthRange;
exports.formatMonthLabel = formatMonthLabel;
exports.monthEndDate = monthEndDate;
exports.formatMonthEndLabel = formatMonthEndLabel;
const months_js_1 = require("../../domain/shared/months.js");
Object.defineProperty(exports, "addMonths", { enumerable: true, get: function () { return months_js_1.addMonths; } });
Object.defineProperty(exports, "currentMonthKey", { enumerable: true, get: function () { return months_js_1.currentMonthKey; } });
Object.defineProperty(exports, "monthIndex", { enumerable: true, get: function () { return months_js_1.monthIndex; } });
Object.defineProperty(exports, "normalizeMonthKey", { enumerable: true, get: function () { return months_js_1.normalizeMonthKey; } });
function monthRange(startMonth, months) {
    const normalized = (0, months_js_1.normalizeMonthKey)(startMonth);
    const length = Number.isFinite(months) ? Math.max(0, Math.round(months)) : 0;
    if (!normalized || !length)
        return [];
    return Array.from({ length }, (_, index) => (0, months_js_1.addMonths)(normalized, index));
}
function formatMonthLabel(month) {
    const normalized = (0, months_js_1.normalizeMonthKey)(month);
    if (!normalized)
        return "—";
    const [year, monthNumber] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1, 1));
    return date.toLocaleDateString("de-DE", { month: "short", year: "numeric", timeZone: "UTC" });
}
function monthEndDate(month) {
    const normalized = (0, months_js_1.normalizeMonthKey)(month);
    if (!normalized)
        return null;
    const [year, monthNumber] = normalized.split("-").map(Number);
    if (!year || !monthNumber)
        return null;
    return new Date(Date.UTC(year, monthNumber, 0));
}
function formatMonthEndLabel(month, mode = "long") {
    const date = monthEndDate(month);
    if (!(date instanceof Date) || Number.isNaN(date.getTime()))
        return "—";
    if (mode === "short") {
        return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    }
    return `Ende ${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}`;
}

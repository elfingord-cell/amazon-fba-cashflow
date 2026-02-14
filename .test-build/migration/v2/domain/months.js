"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentMonthKey = currentMonthKey;
exports.normalizeMonthKey = normalizeMonthKey;
exports.monthIndex = monthIndex;
exports.addMonths = addMonths;
exports.monthRange = monthRange;
exports.formatMonthLabel = formatMonthLabel;
exports.monthEndDate = monthEndDate;
exports.formatMonthEndLabel = formatMonthEndLabel;
function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function normalizeMonthKey(value) {
    if (!value)
        return null;
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}$/.test(raw))
        return raw;
    const mmYYYY = raw.match(/^(\d{2})-(\d{4})$/);
    if (mmYYYY)
        return `${mmYYYY[2]}-${mmYYYY[1]}`;
    return null;
}
function monthIndex(month) {
    if (!/^\d{4}-\d{2}$/.test(month || ""))
        return null;
    const [year, monthNumber] = month.split("-").map(Number);
    return year * 12 + (monthNumber - 1);
}
function addMonths(month, offset) {
    const index = monthIndex(month);
    if (index == null)
        return month;
    const next = index + offset;
    const year = Math.floor(next / 12);
    const monthNumber = (next % 12) + 1;
    return `${year}-${String(monthNumber).padStart(2, "0")}`;
}
function monthRange(startMonth, months) {
    const normalized = normalizeMonthKey(startMonth);
    const length = Number.isFinite(months) ? Math.max(0, Math.round(months)) : 0;
    if (!normalized || !length)
        return [];
    return Array.from({ length }, (_, index) => addMonths(normalized, index));
}
function formatMonthLabel(month) {
    const normalized = normalizeMonthKey(month);
    if (!normalized)
        return "—";
    const [year, monthNumber] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1, 1));
    return date.toLocaleDateString("de-DE", { month: "short", year: "numeric", timeZone: "UTC" });
}
function monthEndDate(month) {
    const normalized = normalizeMonthKey(month);
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

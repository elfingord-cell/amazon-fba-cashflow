"use strict";
// Zentrale Monats-Key-Helfer ("YYYY-MM"). Einzige erlaubte Implementierung von
// normalizeMonthKey/currentMonthKey im Repo (Guard: tests/v2/shared-helpers.guard.test.mjs).
// Fallback-Verhalten bei ungültigem Input ist Sache der Call-Site:
// normalizeMonthKey(v) ?? fallback.
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentMonthKey = currentMonthKey;
exports.normalizeMonthKey = normalizeMonthKey;
exports.monthIndex = monthIndex;
exports.addMonths = addMonths;
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

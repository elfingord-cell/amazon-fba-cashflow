"use strict";
// Zentrale Datums-Helfer. Einzige erlaubte addDays-Implementierung im Repo
// (Guard: tests/v2/shared-helpers.guard.test.mjs). Alle Arithmetik läuft in UTC —
// lokale Zeit (setDate/getDate) verschiebt an DST-Grenzen den Kalendertag.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MILLIS_PER_DAY = void 0;
exports.parseISODate = parseISODate;
exports.addDays = addDays;
exports.addDaysIso = addDaysIso;
exports.daysBetween = daysBetween;
exports.MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
function parseISODate(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    const [y, m, d] = String(value).split("-").map(Number);
    if (!y || !m || !d)
        return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(date.getTime()) ? null : date;
}
function addDays(date, days) {
    const base = date instanceof Date ? date : parseISODate(date);
    if (!(base instanceof Date) || Number.isNaN(base.getTime()))
        return null;
    const copy = new Date(base.getTime());
    copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
    return copy;
}
function addDaysIso(value, days) {
    const next = addDays(parseISODate(value), days);
    if (!next)
        return null;
    return next.toISOString().slice(0, 10);
}
function daysBetween(start, end) {
    if (!(start instanceof Date) || Number.isNaN(start.getTime()))
        return null;
    if (!(end instanceof Date) || Number.isNaN(end.getTime()))
        return null;
    return Math.round((end.getTime() - start.getTime()) / exports.MILLIS_PER_DAY);
}

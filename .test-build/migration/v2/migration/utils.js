"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMonthKey = normalizeMonthKey;
exports.normalizeMonthInEntry = normalizeMonthInEntry;
exports.stableHash = stableHash;
exports.deterministicId = deterministicId;
exports.parseDeNumberOrNull = parseDeNumberOrNull;
exports.deepClone = deepClone;
exports.isObject = isObject;
exports.pushIssue = pushIssue;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
function normalizeMonthKey(value) {
    if (typeof value !== "string")
        return null;
    const raw = value.trim();
    if (!raw)
        return null;
    if (/^\d{4}-\d{2}$/.test(raw))
        return raw;
    const deMatch = raw.match(/^(\d{2})-(\d{4})$/);
    if (deMatch)
        return `${deMatch[2]}-${deMatch[1]}`;
    return null;
}
function normalizeMonthInEntry(entry) {
    const monthValue = normalizeMonthKey(entry.month);
    if (!monthValue || monthValue === entry.month) {
        return { value: entry, normalized: false };
    }
    return {
        value: {
            ...entry,
            month: monthValue,
        },
        normalized: true,
    };
}
function stableHash(seed) {
    let hash = 5381;
    for (let i = 0; i < seed.length; i += 1) {
        hash = ((hash << 5) + hash) + seed.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
function deterministicId(prefix, seedParts) {
    const seed = seedParts.map((part) => String(part ?? "")).join("|");
    return `${prefix}-${stableHash(seed)}`;
}
function parseDeNumberOrNull(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value !== "string")
        return null;
    const parsed = (0, dataHealth_js_1.parseDeNumber)(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}
function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function pushIssue(issues, issue) {
    issues.push(issue);
}

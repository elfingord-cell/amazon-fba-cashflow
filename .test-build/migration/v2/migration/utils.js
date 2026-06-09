"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMonthKey = void 0;
exports.normalizeMonthInEntry = normalizeMonthInEntry;
exports.stableHash = stableHash;
exports.deterministicId = deterministicId;
exports.parseDeNumberOrNull = parseDeNumberOrNull;
exports.deepClone = deepClone;
exports.isObject = isObject;
exports.pushIssue = pushIssue;
const dataHealth_js_1 = require("../../lib/dataHealth.js");
const months_js_1 = require("../../domain/shared/months.js");
Object.defineProperty(exports, "normalizeMonthKey", { enumerable: true, get: function () { return months_js_1.normalizeMonthKey; } });
function normalizeMonthInEntry(entry) {
    const monthValue = (0, months_js_1.normalizeMonthKey)(entry.month);
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

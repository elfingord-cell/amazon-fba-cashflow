"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyAppStateV2 = createEmptyAppStateV2;
exports.ensureAppStateV2 = ensureAppStateV2;
const storageLocal_js_1 = require("../../data/storageLocal.js");
function createEmptyAppStateV2() {
    const legacy = (0, storageLocal_js_1.createEmptyState)();
    return {
        ...legacy,
        schemaVersion: 2,
        legacyMeta: {
            unmapped: {},
            importHistory: [],
        },
    };
}
function ensureAppStateV2(input) {
    const base = createEmptyAppStateV2();
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return base;
    }
    const merged = {
        ...base,
        ...input,
    };
    if (merged.schemaVersion !== 2) {
        merged.schemaVersion = 2;
    }
    if (!merged.legacyMeta || typeof merged.legacyMeta !== "object") {
        merged.legacyMeta = { unmapped: {}, importHistory: [] };
    }
    if (!merged.legacyMeta.unmapped || typeof merged.legacyMeta.unmapped !== "object") {
        merged.legacyMeta.unmapped = {};
    }
    if (!Array.isArray(merged.legacyMeta.importHistory)) {
        merged.legacyMeta.importHistory = [];
    }
    return merged;
}

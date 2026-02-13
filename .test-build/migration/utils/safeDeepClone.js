"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeDeepClone = safeDeepClone;
function safeDeepClone(value) {
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        }
        catch (err) {
            // fall through to JSON clone
        }
    }
    if (value === undefined)
        return undefined;
    return JSON.parse(JSON.stringify(value));
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSourceVersion = detectSourceVersion;
const utils_1 = require("./utils");
const LEGACY_HINT_KEYS = [
    "settings",
    "products",
    "suppliers",
    "pos",
    "fos",
    "payments",
    "forecast",
    "inventory",
    "fixcosts",
    "monthlyActuals",
];
function detectSourceVersion(payload) {
    if (!(0, utils_1.isObject)(payload))
        return "unknown";
    const keys = Object.keys(payload);
    const hits = LEGACY_HINT_KEYS.filter((key) => keys.includes(key)).length;
    return hits >= 3 ? "legacy_v1" : "unknown";
}

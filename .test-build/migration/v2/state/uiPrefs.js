"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModuleExpandedCategoryKeys = getModuleExpandedCategoryKeys;
exports.hasModuleExpandedCategoryKeys = hasModuleExpandedCategoryKeys;
exports.setModuleExpandedCategoryKeys = setModuleExpandedCategoryKeys;
const STORAGE_KEY = "v2.ui-prefs";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeExpandedKeys(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}
function readRawPrefs() {
    if (typeof window === "undefined")
        return { byModule: {} };
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return { byModule: {} };
        const parsed = JSON.parse(raw);
        if (!isObject(parsed))
            return { byModule: {} };
        const byModuleInput = isObject(parsed.byModule) ? parsed.byModule : {};
        const byModule = Object.entries(byModuleInput).reduce((acc, [moduleKey, value]) => {
            const entry = isObject(value) ? value : {};
            acc[moduleKey] = {
                expandedCategoryKeys: normalizeExpandedKeys(entry.expandedCategoryKeys),
            };
            return acc;
        }, {});
        return { byModule };
    }
    catch {
        return { byModule: {} };
    }
}
function writeRawPrefs(next) {
    if (typeof window === "undefined")
        return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    catch {
        // ignore localStorage write errors
    }
}
function getModuleExpandedCategoryKeys(moduleKey) {
    const prefs = readRawPrefs();
    return normalizeExpandedKeys(prefs.byModule?.[moduleKey]?.expandedCategoryKeys);
}
function hasModuleExpandedCategoryKeys(moduleKey) {
    const prefs = readRawPrefs();
    const entry = prefs.byModule?.[moduleKey];
    return Boolean(entry && Array.isArray(entry.expandedCategoryKeys));
}
function setModuleExpandedCategoryKeys(moduleKey, keys) {
    const prefs = readRawPrefs();
    const next = {
        byModule: {
            ...prefs.byModule,
            [moduleKey]: {
                ...(prefs.byModule?.[moduleKey] || {}),
                expandedCategoryKeys: normalizeExpandedKeys(keys),
            },
        },
    };
    writeRawPrefs(next);
}

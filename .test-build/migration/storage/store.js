"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAppState = loadAppState;
exports.saveAppState = saveAppState;
exports.commitAppState = commitAppState;
exports.updateEntity = updateEntity;
exports.deleteEntity = deleteEntity;
exports.getViewState = getViewState;
exports.setViewState = setViewState;
exports.getViewValue = getViewValue;
exports.setViewValue = setViewValue;
exports.readDraftCache = readDraftCache;
exports.writeDraftCache = writeDraftCache;
exports.clearDraftCache = clearDraftCache;
exports.countDrafts = countDrafts;
exports.getLastCommitSummary = getLastCommitSummary;
const storageLocal_js_1 = require("../data/storageLocal.js");
const VIEW_PREFIX = "";
const DEFAULT_DRAFT_NAMESPACE = "drafts/v1";
function buildViewKey(key) {
    return VIEW_PREFIX ? `${VIEW_PREFIX}:${key}` : key;
}
function safeParse(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function resolveEntityId(entry, id, type) {
    if (!entry)
        return false;
    const candidates = [];
    if (type === "pos")
        candidates.push("poNumber", "poNo", "number", "id");
    if (type === "fos")
        candidates.push("id", "foId", "number");
    if (type === "products")
        candidates.push("sku", "id");
    if (type === "suppliers")
        candidates.push("id");
    if (type === "payments")
        candidates.push("id");
    if (!candidates.length)
        candidates.push("id");
    return candidates.some((field) => entry?.[field] === id);
}
function loadAppState() {
    return (0, storageLocal_js_1.loadState)();
}
function saveAppState(state, meta = {}) {
    (0, storageLocal_js_1.commitState)(state, { source: meta.source || "saveAppState", ...meta });
}
function commitAppState(nextState, meta = {}) {
    (0, storageLocal_js_1.commitState)(nextState, { source: meta.source || "commit", ...meta });
}
function updateEntity(type, id, updaterOrPatch, meta = {}) {
    const state = (0, storageLocal_js_1.loadState)();
    if (type === "settings") {
        const current = state.settings || {};
        const next = typeof updaterOrPatch === "function"
            ? updaterOrPatch(current)
            : { ...current, ...(updaterOrPatch || {}) };
        state.settings = next;
        (0, storageLocal_js_1.commitState)(state, { source: meta.source || "updateEntity", entityKey: meta.entityKey, action: meta.action || "update" });
        return state;
    }
    if (!Array.isArray(state[type]))
        state[type] = [];
    const collection = state[type];
    const idx = collection.findIndex(entry => resolveEntityId(entry, id, type));
    if (idx >= 0) {
        const current = collection[idx];
        const next = typeof updaterOrPatch === "function"
            ? updaterOrPatch(current)
            : { ...current, ...(updaterOrPatch || {}) };
        collection[idx] = next;
    }
    else {
        const next = typeof updaterOrPatch === "function"
            ? updaterOrPatch({})
            : { ...(updaterOrPatch || {}) };
        if (id != null) {
            if (type === "products")
                next.sku = next.sku || id;
            if (type === "pos")
                next.poNumber = next.poNumber || id;
            if (type === "fos")
                next.id = next.id || id;
        }
        collection.push(next);
    }
    (0, storageLocal_js_1.commitState)(state, { source: meta.source || "updateEntity", entityKey: meta.entityKey, action: meta.action || "update" });
    return state;
}
function deleteEntity(type, id, meta = {}) {
    const state = (0, storageLocal_js_1.loadState)();
    if (!Array.isArray(state[type]))
        return state;
    state[type] = state[type].filter(entry => !resolveEntityId(entry, id, type));
    (0, storageLocal_js_1.commitState)(state, { source: meta.source || "deleteEntity", entityKey: meta.entityKey, action: meta.action || "delete" });
    return state;
}
function getViewState(key, fallback = null) {
    const storageKey = buildViewKey(key);
    return safeParse(localStorage.getItem(storageKey), fallback);
}
function setViewState(key, value) {
    const storageKey = buildViewKey(key);
    localStorage.setItem(storageKey, JSON.stringify(value));
}
function getViewValue(key, fallback = null) {
    const storageKey = buildViewKey(key);
    const raw = localStorage.getItem(storageKey);
    if (raw == null)
        return fallback;
    return raw;
}
function setViewValue(key, value) {
    const storageKey = buildViewKey(key);
    localStorage.setItem(storageKey, value);
}
function readDraftCache(entityKey, namespace = DEFAULT_DRAFT_NAMESPACE) {
    if (!entityKey)
        return null;
    const key = `${namespace}:${entityKey}`;
    const stored = safeParse(localStorage.getItem(key), null);
    if (!stored || typeof stored !== "object")
        return null;
    return {
        updatedAt: stored.updatedAt || null,
        data: stored.data ?? null,
    };
}
function writeDraftCache(entityKey, data, namespace = DEFAULT_DRAFT_NAMESPACE) {
    if (!entityKey)
        return;
    const key = `${namespace}:${entityKey}`;
    const payload = { updatedAt: new Date().toISOString(), data };
    localStorage.setItem(key, JSON.stringify(payload));
}
function clearDraftCache(entityKey, namespace = DEFAULT_DRAFT_NAMESPACE) {
    if (!entityKey)
        return;
    const key = `${namespace}:${entityKey}`;
    localStorage.removeItem(key);
}
function countDrafts(namespace = DEFAULT_DRAFT_NAMESPACE) {
    if (typeof localStorage === "undefined")
        return 0;
    let count = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${namespace}:`))
            count += 1;
    }
    return count;
}
function getLastCommitSummary() {
    const info = (0, storageLocal_js_1.getLastCommitInfo)();
    return {
        lastCommitAt: info?.lastCommitAt || null,
        lastCommitMeta: info?.lastCommitMeta || null,
        storageKey: storageLocal_js_1.STORAGE_KEY,
    };
}

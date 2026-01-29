import {
  loadState,
  commitState,
  getLastCommitInfo,
  STORAGE_KEY,
} from "../data/storageLocal.js";

const VIEW_PREFIX = "";
const DEFAULT_DRAFT_NAMESPACE = "drafts/v1";

function buildViewKey(key) {
  return VIEW_PREFIX ? `${VIEW_PREFIX}:${key}` : key;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function resolveEntityId(entry, id, type) {
  if (!entry) return false;
  const candidates = [];
  if (type === "pos") candidates.push("poNumber", "poNo", "number", "id");
  if (type === "fos") candidates.push("id", "foId", "number");
  if (type === "products") candidates.push("sku", "id");
  if (type === "suppliers") candidates.push("id");
  if (type === "payments") candidates.push("id");
  if (!candidates.length) candidates.push("id");
  return candidates.some((field) => entry?.[field] === id);
}

export function loadAppState() {
  return loadState();
}

export function saveAppState(state, meta = {}) {
  commitState(state, { source: meta.source || "saveAppState", ...meta });
}

export function commitAppState(nextState, meta = {}) {
  commitState(nextState, { source: meta.source || "commit", ...meta });
}

export function updateEntity(type, id, updaterOrPatch, meta = {}) {
  const state = loadState();
  if (type === "settings") {
    const current = state.settings || {};
    const next = typeof updaterOrPatch === "function"
      ? updaterOrPatch(current)
      : { ...current, ...(updaterOrPatch || {}) };
    state.settings = next;
    commitState(state, { source: meta.source || "updateEntity", entityKey: meta.entityKey, action: meta.action || "update" });
    return state;
  }
  if (!Array.isArray(state[type])) state[type] = [];
  const collection = state[type];
  const idx = collection.findIndex(entry => resolveEntityId(entry, id, type));
  if (idx >= 0) {
    const current = collection[idx];
    const next = typeof updaterOrPatch === "function"
      ? updaterOrPatch(current)
      : { ...current, ...(updaterOrPatch || {}) };
    collection[idx] = next;
  } else {
    const next = typeof updaterOrPatch === "function"
      ? updaterOrPatch({})
      : { ...(updaterOrPatch || {}) };
    if (id != null) {
      if (type === "products") next.sku = next.sku || id;
      if (type === "pos") next.poNumber = next.poNumber || id;
      if (type === "fos") next.id = next.id || id;
    }
    collection.push(next);
  }
  commitState(state, { source: meta.source || "updateEntity", entityKey: meta.entityKey, action: meta.action || "update" });
  return state;
}

export function deleteEntity(type, id, meta = {}) {
  const state = loadState();
  if (!Array.isArray(state[type])) return state;
  state[type] = state[type].filter(entry => !resolveEntityId(entry, id, type));
  commitState(state, { source: meta.source || "deleteEntity", entityKey: meta.entityKey, action: meta.action || "delete" });
  return state;
}

export function getViewState(key, fallback = null) {
  const storageKey = buildViewKey(key);
  return safeParse(localStorage.getItem(storageKey), fallback);
}

export function setViewState(key, value) {
  const storageKey = buildViewKey(key);
  localStorage.setItem(storageKey, JSON.stringify(value));
}

export function getViewValue(key, fallback = null) {
  const storageKey = buildViewKey(key);
  const raw = localStorage.getItem(storageKey);
  if (raw == null) return fallback;
  return raw;
}

export function setViewValue(key, value) {
  const storageKey = buildViewKey(key);
  localStorage.setItem(storageKey, value);
}

export function readDraftCache(entityKey, namespace = DEFAULT_DRAFT_NAMESPACE) {
  if (!entityKey) return null;
  const key = `${namespace}:${entityKey}`;
  const stored = safeParse(localStorage.getItem(key), null);
  if (!stored || typeof stored !== "object") return null;
  return {
    updatedAt: stored.updatedAt || null,
    data: stored.data ?? null,
  };
}

export function writeDraftCache(entityKey, data, namespace = DEFAULT_DRAFT_NAMESPACE) {
  if (!entityKey) return;
  const key = `${namespace}:${entityKey}`;
  const payload = { updatedAt: new Date().toISOString(), data };
  localStorage.setItem(key, JSON.stringify(payload));
}

export function clearDraftCache(entityKey, namespace = DEFAULT_DRAFT_NAMESPACE) {
  if (!entityKey) return;
  const key = `${namespace}:${entityKey}`;
  localStorage.removeItem(key);
}

export function countDrafts(namespace = DEFAULT_DRAFT_NAMESPACE) {
  if (typeof localStorage === "undefined") return 0;
  let count = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(`${namespace}:`)) count += 1;
  }
  return count;
}

export function getLastCommitSummary() {
  const info = getLastCommitInfo();
  return {
    lastCommitAt: info?.lastCommitAt || null,
    lastCommitMeta: info?.lastCommitMeta || null,
    storageKey: STORAGE_KEY,
  };
}

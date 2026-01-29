import { deepEqual } from "../utils/deepEqual.js";
import {
  readDraftCache,
  writeDraftCache,
  clearDraftCache,
} from "../storage/store.js";

function clone(value) {
  return structuredClone(value ?? {});
}

function mutate(target, next) {
  const keys = Object.keys(target);
  keys.forEach(key => {
    delete target[key];
  });
  if (next && typeof next === "object") {
    Object.entries(next).forEach(([key, value]) => {
      target[key] = value;
    });
  }
}

export function useDraftForm(initialValue, options = {}) {
  const config = {
    key: options.key || "draft",
    enableDraftCache: options.enableDraftCache !== false,
    draftCacheNamespace: options.draftCacheNamespace || "drafts/v1",
  };

  const draft = clone(initialValue);
  let saved = clone(initialValue);

  function syncCache() {
    if (!config.enableDraftCache) return;
    writeDraftCache(config.key, draft, config.draftCacheNamespace);
  }

  function setDraft(patchOrUpdater) {
    if (typeof patchOrUpdater === "function") {
      const next = patchOrUpdater(draft);
      if (next && typeof next === "object") {
        mutate(draft, clone(next));
      }
    } else if (patchOrUpdater && typeof patchOrUpdater === "object") {
      if (patchOrUpdater === draft) {
        // no-op
      } else {
        Object.assign(draft, patchOrUpdater);
      }
    }
    syncCache();
  }

  function resetDraft() {
    mutate(draft, clone(saved));
    clearDraftCache(config.key, config.draftCacheNamespace);
  }

  function loadDraftIfAvailable() {
    if (!config.enableDraftCache) return { exists: false, draft: null };
    const cached = readDraftCache(config.key, config.draftCacheNamespace);
    if (!cached?.data) return { exists: false, draft: null };
    return { exists: true, draft: cached.data, updatedAt: cached.updatedAt };
  }

  function restoreDraft() {
    if (!config.enableDraftCache) return;
    const cached = readDraftCache(config.key, config.draftCacheNamespace);
    if (!cached?.data) return;
    mutate(draft, clone(cached.data));
  }

  function discardDraft() {
    clearDraftCache(config.key, config.draftCacheNamespace);
    mutate(draft, clone(saved));
  }

  function markClean() {
    saved = clone(draft);
  }

  async function commit(commitFn) {
    if (typeof commitFn !== "function") return;
    const result = commitFn(draft);
    if (result && typeof result.then === "function") {
      await result;
    }
    saved = clone(draft);
    clearDraftCache(config.key, config.draftCacheNamespace);
  }

  const api = {
    get draft() {
      return draft;
    },
    get saved() {
      return saved;
    },
    get isDirty() {
      return !deepEqual(draft, saved);
    },
    setDraft,
    resetDraft,
    loadDraftIfAvailable,
    restoreDraft,
    discardDraft,
    markClean,
    commit,
  };

  return api;
}

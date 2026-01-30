import { deepEqual } from "../utils/deepEqual.js";
import {
  readDraftCache,
  writeDraftCache,
  clearDraftCache,
} from "../storage/store.js";

function safeDeepClone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (err) {
      // fall through to JSON clone
    }
  }
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function clone(value) {
  return safeDeepClone(value ?? {});
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
  const debugForms = typeof window !== "undefined" && window.__DEBUG_FORMS__ === true;

  function assertNoSharedRefs(action) {
    if (!debugForms) return;
    const warnings = [];
    if (!deepEqual(draft, saved)) {
      warnings.push("draft/saved are not deep-equal after save.");
    }
    if (draft === saved) {
      warnings.push("draft and saved share the same reference.");
    }
    if (Array.isArray(draft?.payments) && draft.payments === saved?.payments) {
      warnings.push("payments array reference is shared.");
    }
    if (Array.isArray(draft?.items) && draft.items === saved?.items) {
      warnings.push("items array reference is shared.");
    }
    if (warnings.length) {
      console.warn(`[useDraftForm] Shared references detected after ${action}`, {
        warnings,
        draft,
        saved,
      });
    }
  }

  function syncCache() {
    if (!config.enableDraftCache) return;
    writeDraftCache(config.key, draft, config.draftCacheNamespace);
  }

  function setDraft(patchOrUpdater) {
    if (typeof patchOrUpdater === "function") {
      const next = patchOrUpdater(clone(draft));
      if (next && typeof next === "object") {
        mutate(draft, clone(next));
      }
    } else if (patchOrUpdater && typeof patchOrUpdater === "object") {
      const next = patchOrUpdater === draft ? patchOrUpdater : { ...draft, ...patchOrUpdater };
      mutate(draft, clone(next));
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
    return { exists: true, draft: clone(cached.data), updatedAt: cached.updatedAt };
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
    assertNoSharedRefs("markClean");
  }

  async function commit(commitFn) {
    if (typeof commitFn !== "function") return;
    const result = commitFn(draft);
    if (result && typeof result.then === "function") {
      await result;
    }
    saved = clone(draft);
    assertNoSharedRefs("commit");
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

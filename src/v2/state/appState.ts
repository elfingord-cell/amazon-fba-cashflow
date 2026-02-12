import { createEmptyState } from "../../data/storageLocal.js";
import type { AppStateV2 } from "./types";

export function createEmptyAppStateV2(): AppStateV2 {
  const legacy = createEmptyState() as Record<string, unknown>;
  return {
    ...legacy,
    schemaVersion: 2,
    legacyMeta: {
      unmapped: {},
      importHistory: [],
    },
  } as AppStateV2;
}

export function ensureAppStateV2(input: unknown): AppStateV2 {
  const base = createEmptyAppStateV2();
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return base;
  }
  const merged = {
    ...base,
    ...(input as Record<string, unknown>),
  } as AppStateV2;
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

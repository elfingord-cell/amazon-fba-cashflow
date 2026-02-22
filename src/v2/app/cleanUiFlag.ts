import { loadState } from "../../data/storageLocal.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function resolveCleanUiV2FlagFromSettings(settings: unknown): boolean {
  const settingsRecord = asRecord(settings);
  const featureFlags = asRecord(settingsRecord.featureFlags);
  return featureFlags.cleanUiV2 !== false;
}

export function resolveCleanUiV2FlagFromState(state: unknown): boolean {
  const stateRecord = asRecord(state);
  return resolveCleanUiV2FlagFromSettings(stateRecord.settings);
}

export function readInitialCleanUiV2Flag(): boolean {
  return resolveCleanUiV2FlagFromState(loadState());
}

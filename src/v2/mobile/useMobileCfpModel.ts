// Hook: bindet den Shared-Workspace-State an das CFP-Mobile-Datenmodell und
// persistiert Cockpit-Settings exakt wie das Desktop-Dashboard (saveWith).
import { useCallback, useMemo, useState } from "react";
import { useWorkspaceState } from "../state/workspace";
import { PORTFOLIO_BUCKET_VALUES } from "../../domain/portfolioBuckets.js";
import {
  buildCfpModel,
  DEFAULT_V2_BUCKET_SCOPE,
  type CfpModel,
  type CfpQuoteMode,
  type CfpRange,
  type CfpRevenueBasisMode,
} from "../domain/cfpModel";

function normalizeQuoteMode(value: unknown): CfpQuoteMode {
  return String(value || "").trim().toLowerCase() === "recommendation" ? "recommendation" : "manual";
}

function normalizeRevenueBasisMode(value: unknown): CfpRevenueBasisMode {
  return String(value || "").trim().toLowerCase() === "forecast_direct" ? "forecast_direct" : "hybrid";
}

export interface UseMobileCfpModel {
  loading: boolean;
  error: string;
  range: CfpRange;
  setRange: (range: CfpRange) => void;
  model: CfpModel;
  setQuoteMode: (mode: CfpQuoteMode) => void;
  toggleBucket: (bucket: string, enabled: boolean) => void;
  setCalibration: (enabled: boolean) => void;
  reload: () => void;
  lastSavedAt: string | null;
}

export function useMobileCfpModel(): UseMobileCfpModel {
  const { state, loading, error, saveWith, reload, lastSavedAt } = useWorkspaceState();
  const [range, setRange] = useState<CfpRange>("next12");
  const [bucketScope, setBucketScope] = useState<string[]>(() => DEFAULT_V2_BUCKET_SCOPE.slice());

  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (stateObject.settings && typeof stateObject.settings === "object")
    ? stateObject.settings as Record<string, unknown>
    : {};
  const quoteMode = normalizeQuoteMode(settings.cashInQuoteMode);
  const revenueBasisMode = normalizeRevenueBasisMode(settings.cashInRevenueBasisMode);
  const calibrationEnabled = settings.cashInCalibrationEnabled !== false;

  const model = useMemo(
    () => buildCfpModel(stateObject, { range, bucketScope, quoteMode, revenueBasisMode, calibrationEnabled }),
    [stateObject, range, bucketScope, quoteMode, revenueBasisMode, calibrationEnabled],
  );

  const persistSettings = useCallback(async (patch: Record<string, unknown>): Promise<void> => {
    await saveWith((current) => {
      const next = structuredClone(current);
      if (!next.settings || typeof next.settings !== "object") next.settings = {};
      const settingsState = next.settings as Record<string, unknown>;
      next.settings = { ...settingsState, ...patch, lastUpdatedAt: new Date().toISOString() };
      return next;
    }, "v2:cfp-mobile:cockpit");
  }, [saveWith]);

  const setQuoteMode = useCallback((mode: CfpQuoteMode) => {
    void persistSettings({ cashInQuoteMode: mode }).catch(() => {});
  }, [persistSettings]);

  const setCalibration = useCallback((enabled: boolean) => {
    void persistSettings({ cashInCalibrationEnabled: enabled }).catch(() => {});
  }, [persistSettings]);

  const toggleBucket = useCallback((bucket: string, enabled: boolean) => {
    if (!PORTFOLIO_BUCKET_VALUES.includes(bucket)) return;
    setBucketScope((current) => {
      const normalized = Array.from(new Set((current || []).filter((entry) => PORTFOLIO_BUCKET_VALUES.includes(entry))));
      const isSelected = normalized.includes(bucket);
      if (enabled && !isSelected) return [...normalized, bucket];
      if (!enabled && isSelected) {
        const filtered = normalized.filter((entry) => entry !== bucket);
        return filtered.length ? filtered : normalized;
      }
      return normalized;
    });
  }, []);

  const reloadModel = useCallback(() => { void reload(); }, [reload]);

  return { loading, error, range, setRange, model, setQuoteMode, toggleBucket, setCalibration, reload: reloadModel, lastSavedAt };
}

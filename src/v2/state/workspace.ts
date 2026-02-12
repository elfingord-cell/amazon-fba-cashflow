import { useCallback, useEffect, useRef, useState } from "react";
import { createEmptyAppStateV2, ensureAppStateV2 } from "./appState";
import type { AppStateV2 } from "./types";
import { useStorageAdapter } from "../sync/session";

function cloneState(input: AppStateV2): AppStateV2 {
  return ensureAppStateV2(structuredClone(input));
}

export interface WorkspaceStateController {
  state: AppStateV2;
  loading: boolean;
  saving: boolean;
  error: string;
  lastSavedAt: string | null;
  reload: () => Promise<void>;
  saveWith: (updater: (current: AppStateV2) => AppStateV2, source: string) => Promise<void>;
}

export function useWorkspaceState(): WorkspaceStateController {
  const adapter = useStorageAdapter();
  const [state, setState] = useState<AppStateV2>(() => createEmptyAppStateV2());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const stateRef = useRef<AppStateV2>(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = ensureAppStateV2(await adapter.load());
      setState(loaded);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht geladen werden.");
      setState(createEmptyAppStateV2());
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  const saveWith = useCallback(async (updater: (current: AppStateV2) => AppStateV2, source: string) => {
    const previous = stateRef.current;
    const next = ensureAppStateV2(updater(cloneState(previous)));
    setSaving(true);
    setError("");
    setState(next);
    stateRef.current = next;
    try {
      await adapter.save(next, { source });
      setLastSavedAt(new Date().toISOString());
    } catch (saveError) {
      setState(previous);
      stateRef.current = previous;
      setError(saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.");
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, [adapter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    state,
    loading,
    saving,
    error,
    lastSavedAt,
    reload,
    saveWith,
  };
}

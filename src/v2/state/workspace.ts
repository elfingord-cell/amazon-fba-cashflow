import { useCallback, useEffect, useRef, useState } from "react";
import { loadState, STORAGE_KEY } from "../../data/storageLocal.js";
import { getRuntimeConfig } from "../../storage/runtimeConfig.js";
import { isLocalEditActive } from "../sync/presence";
import {
  startFallbackPolling,
  subscribeWorkspaceChanges,
  type WorkspaceConnectionState,
} from "../sync/realtimeWorkspace";
import { useStorageAdapter, useSyncSession } from "../sync/session";
import { createEmptyAppStateV2, ensureAppStateV2 } from "./appState";
import type { AppStateV2 } from "./types";

const IMPORT_MARKER_PREFIX = "v2_shared_workspace_import_v1:";
const REMOTE_PULL_DEBOUNCE_MS = 340;

function cloneState(input: AppStateV2): AppStateV2 {
  return ensureAppStateV2(structuredClone(input));
}

function readImportMarker(workspaceId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(`${IMPORT_MARKER_PREFIX}${workspaceId}`) || "");
  } catch {
    return "";
  }
}

function writeImportMarker(workspaceId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${IMPORT_MARKER_PREFIX}${workspaceId}`, value);
  } catch {
    // no-op
  }
}

function hasPersistedLocalState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return Boolean(raw && raw.trim() && raw.trim() !== "{}" && raw.trim() !== "null");
  } catch {
    return false;
  }
}

interface RemoteStateApi {
  fetchRemoteState: () => Promise<{ exists?: boolean; rev?: string | null } | null>;
  pushRemoteState: (input: {
    ifMatchRev: string | null;
    updatedBy: string;
    data: AppStateV2;
  }) => Promise<{ rev?: string | null }>;
}

async function loadRemoteStateApi(): Promise<RemoteStateApi> {
  const mod = await import("../../storage/remoteState.js");
  return {
    fetchRemoteState: mod.fetchRemoteState,
    pushRemoteState: mod.pushRemoteState,
  };
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
  const syncSession = useSyncSession();
  const [state, setState] = useState<AppStateV2>(() => createEmptyAppStateV2());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const stateRef = useRef<AppStateV2>(state);
  const mountedRef = useRef(true);
  const remotePullTimerRef = useRef<number | null>(null);
  const stopPollingRef = useRef<(() => void) | null>(null);
  const isRemotePullingRef = useRef(false);
  const connectionStateRef = useRef<WorkspaceConnectionState>("idle");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (remotePullTimerRef.current != null) {
        window.clearTimeout(remotePullTimerRef.current);
        remotePullTimerRef.current = null;
      }
      stopPollingRef.current?.();
      stopPollingRef.current = null;
    };
  }, []);

  const maybeRunInitialLocalImport = useCallback(async () => {
    if (
      !syncSession.workspaceId
      || !syncSession.userId
      || !syncSession.hasWorkspaceAccess
      || !syncSession.isAuthenticated
    ) {
      return;
    }

    const marker = readImportMarker(syncSession.workspaceId);
    if (marker) return;

    const remoteApi = await loadRemoteStateApi();
    const remote = await remoteApi.fetchRemoteState();
    if (remote?.exists) {
      writeImportMarker(syncSession.workspaceId, "remote-exists");
      return;
    }

    if (!hasPersistedLocalState()) {
      writeImportMarker(syncSession.workspaceId, "no-local-state");
      return;
    }

    const localState = ensureAppStateV2(loadState());
    let shouldImport = false;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      shouldImport = window.confirm(
        "Im Browser wurden lokale Daten gefunden und der Shared Workspace ist leer. Lokale Daten jetzt einmalig in den Workspace importieren?",
      );
    }

    if (!shouldImport) {
      writeImportMarker(syncSession.workspaceId, "user-skipped");
      return;
    }

    await remoteApi.pushRemoteState({
      ifMatchRev: remote?.rev || null,
      updatedBy: syncSession.email || syncSession.userId || "workspace-import",
      data: localState,
    });
    writeImportMarker(syncSession.workspaceId, "imported");
  }, [
    syncSession.email,
    syncSession.hasWorkspaceAccess,
    syncSession.isAuthenticated,
    syncSession.userId,
    syncSession.workspaceId,
  ]);

  const pullRemoteNow = useCallback(async () => {
    if (isRemotePullingRef.current) return;
    if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId) return;
    const cfg = getRuntimeConfig();
    const graceMs = Math.max(0, Number(cfg.editGraceMs || 1200));
    if (isLocalEditActive(graceMs)) {
      const delay = Math.max(graceMs + 80, REMOTE_PULL_DEBOUNCE_MS);
      if (remotePullTimerRef.current != null) {
        window.clearTimeout(remotePullTimerRef.current);
      }
      remotePullTimerRef.current = window.setTimeout(() => {
        remotePullTimerRef.current = null;
        void pullRemoteNow();
      }, delay);
      return;
    }

    isRemotePullingRef.current = true;
    try {
      const loaded = ensureAppStateV2(await adapter.load());
      if (!mountedRef.current) return;
      setState(loaded);
      stateRef.current = loaded;
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht aktualisiert werden.");
    } finally {
      isRemotePullingRef.current = false;
    }
  }, [adapter, syncSession.hasWorkspaceAccess, syncSession.workspaceId]);

  const scheduleRemotePull = useCallback((delayMs = REMOTE_PULL_DEBOUNCE_MS) => {
    if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId) return;
    if (remotePullTimerRef.current != null) {
      window.clearTimeout(remotePullTimerRef.current);
    }
    remotePullTimerRef.current = window.setTimeout(() => {
      remotePullTimerRef.current = null;
      void pullRemoteNow();
    }, Math.max(0, Number(delayMs) || REMOTE_PULL_DEBOUNCE_MS));
  }, [pullRemoteNow, syncSession.hasWorkspaceAccess, syncSession.workspaceId]);

  const stopFallbackPolling = useCallback(() => {
    stopPollingRef.current?.();
    stopPollingRef.current = null;
  }, []);

  const startFallbackPollingLoop = useCallback(() => {
    if (stopPollingRef.current) return;
    const cfg = getRuntimeConfig();
    stopPollingRef.current = startFallbackPolling({
      intervalMs: Math.max(1000, Number(cfg.fallbackPollMs || 15000)),
      onTick: () => {
        if (connectionStateRef.current === "subscribed") return;
        scheduleRemotePull(40);
      },
    });
  }, [scheduleRemotePull]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (syncSession.hasWorkspaceAccess && syncSession.workspaceId && syncSession.isAuthenticated) {
        try {
          await maybeRunInitialLocalImport();
        } catch (importError) {
          if (mountedRef.current) {
            setError(importError instanceof Error ? importError.message : "Initialer Import in den Shared Workspace fehlgeschlagen.");
          }
        }
      }

      const loaded = ensureAppStateV2(await adapter.load());
      if (!mountedRef.current) return;
      setState(loaded);
      stateRef.current = loaded;
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht geladen werden.");
      const fallback = createEmptyAppStateV2();
      setState(fallback);
      stateRef.current = fallback;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    adapter,
    maybeRunInitialLocalImport,
    syncSession.hasWorkspaceAccess,
    syncSession.isAuthenticated,
    syncSession.workspaceId,
  ]);

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

  useEffect(() => {
    stopFallbackPolling();
    if (!syncSession.workspaceId || !syncSession.hasWorkspaceAccess) {
      connectionStateRef.current = "idle";
      return () => {};
    }

    const cfg = getRuntimeConfig();
    if (!Boolean(cfg.realtimeEnabled)) {
      startFallbackPollingLoop();
      return () => {
        stopFallbackPolling();
      };
    }

    const unsubscribe = subscribeWorkspaceChanges({
      workspaceId: syncSession.workspaceId,
      onRemoteChange: () => scheduleRemotePull(REMOTE_PULL_DEBOUNCE_MS),
      onConnectionState: (state) => {
        connectionStateRef.current = state;
        if (state === "subscribed") {
          stopFallbackPolling();
          return;
        }
        startFallbackPollingLoop();
      },
    });

    startFallbackPollingLoop();

    return () => {
      unsubscribe();
      stopFallbackPolling();
    };
  }, [
    scheduleRemotePull,
    startFallbackPollingLoop,
    stopFallbackPolling,
    syncSession.hasWorkspaceAccess,
    syncSession.workspaceId,
  ]);

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

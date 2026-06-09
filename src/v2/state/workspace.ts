import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, message } from "antd";
import { loadState, STORAGE_KEY } from "../../data/storageLocal.js";
import { createWorkspaceBackup } from "../sync/storageAdapters";
import { getRuntimeConfig } from "../../storage/runtimeConfig.js";
import { isLocalEditActive } from "../sync/presence";
import {
  publishWorkspaceBroadcast,
  startFallbackPolling,
  subscribeWorkspaceChanges,
  type WorkspaceConnectionState,
} from "../sync/realtimeWorkspace";
import { useStorageAdapter, useSyncSession } from "../sync/session";
import { createEmptyAppStateV2, ensureAppStateV2 } from "./appState";
import type { AppStateV2 } from "./types";

const IMPORT_MARKER_PREFIX = "v2_shared_workspace_import_v1:";
const REMOTE_PULL_DEBOUNCE_MS = 340;
const WORKSPACE_SNAPSHOT_EVENT = "v2:workspace-state-snapshot";

function cloneState(input: AppStateV2): AppStateV2 {
  return ensureAppStateV2(structuredClone(input));
}

function emitWorkspaceSnapshot(state: AppStateV2): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_SNAPSHOT_EVENT, { detail: state }));
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
  const savingRef = useRef(false);
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

    // "pending"/"push-failed" nicht final werten: ein abgebrochener/fehlgeschlagener
    // Push darf den Import nicht dauerhaft blockieren — der Re-Check gegen das Remote
    // entscheidet (existiert es inzwischen, wird "remote-exists" gesetzt).
    const marker = readImportMarker(syncSession.workspaceId);
    if (marker && marker !== "pending" && marker !== "push-failed") return;

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
    const shouldImport = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: "Lokale Daten in den Shared Workspace importieren?",
        content: "Im Browser wurden lokale Daten gefunden und der Shared Workspace ist leer. Die lokalen Daten werden einmalig hochgeladen. Vorher wird automatisch ein lokales Backup angelegt.",
        okText: "Importieren",
        cancelText: "Nicht importieren",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

    if (!shouldImport) {
      writeImportMarker(syncSession.workspaceId, "user-skipped");
      return;
    }

    // Marker VOR dem Push: schlägt der Push fehl, bleibt "push-failed" stehen und
    // der nächste Load prüft erneut gegen das Remote statt blind nochmal zu pushen.
    createWorkspaceBackup("v2:initial-import:pre-push", localState);
    writeImportMarker(syncSession.workspaceId, "pending");
    try {
      await remoteApi.pushRemoteState({
        ifMatchRev: remote?.rev || null,
        updatedBy: syncSession.email || syncSession.userId || "workspace-import",
        data: localState,
      });
    } catch (pushError) {
      writeImportMarker(syncSession.workspaceId, "push-failed");
      throw pushError;
    }
    writeImportMarker(syncSession.workspaceId, "imported");
  }, [
    syncSession.email,
    syncSession.hasWorkspaceAccess,
    syncSession.isAuthenticated,
    syncSession.userId,
    syncSession.workspaceId,
  ]);

  const pullRemoteNow = useCallback(async (options?: { skipLocalGrace?: boolean }) => {
    if (isRemotePullingRef.current) return;
    if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId) return;
    // Niemals pullen, während ein Save läuft — der Pull würde den gerade
    // editierten Stand mit dem (noch alten) Remote-Stand überschreiben.
    if (savingRef.current) {
      if (remotePullTimerRef.current != null) {
        window.clearTimeout(remotePullTimerRef.current);
      }
      remotePullTimerRef.current = window.setTimeout(() => {
        remotePullTimerRef.current = null;
        void pullRemoteNow(options);
      }, REMOTE_PULL_DEBOUNCE_MS);
      return;
    }
    const skipLocalGrace = Boolean(options?.skipLocalGrace);
    const cfg = getRuntimeConfig();
    const graceMs = Math.max(0, Number(cfg.editGraceMs || 1200));
    if (!skipLocalGrace && isLocalEditActive(graceMs)) {
      const delay = Math.max(graceMs + 80, REMOTE_PULL_DEBOUNCE_MS);
      if (remotePullTimerRef.current != null) {
        window.clearTimeout(remotePullTimerRef.current);
      }
      remotePullTimerRef.current = window.setTimeout(() => {
        remotePullTimerRef.current = null;
        void pullRemoteNow({ skipLocalGrace: true });
      }, delay);
      return;
    }

    isRemotePullingRef.current = true;
    try {
      const loaded = ensureAppStateV2(await adapter.load());
      if (!mountedRef.current) return;
      setState(loaded);
      stateRef.current = loaded;
      emitWorkspaceSnapshot(loaded);
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht aktualisiert werden.");
    } finally {
      isRemotePullingRef.current = false;
    }
  }, [adapter, syncSession.hasWorkspaceAccess, syncSession.workspaceId]);

  const scheduleRemotePull = useCallback((delayMs = REMOTE_PULL_DEBOUNCE_MS, options?: { skipLocalGrace?: boolean }) => {
    if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId) return;
    const skipLocalGrace = Boolean(options?.skipLocalGrace);
    if (remotePullTimerRef.current != null) {
      window.clearTimeout(remotePullTimerRef.current);
    }
    remotePullTimerRef.current = window.setTimeout(() => {
      remotePullTimerRef.current = null;
      void pullRemoteNow({ skipLocalGrace });
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
      emitWorkspaceSnapshot(loaded);
    } catch (loadError) {
      if (!mountedRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht geladen werden.");
      const fallback = createEmptyAppStateV2();
      setState(fallback);
      stateRef.current = fallback;
      emitWorkspaceSnapshot(fallback);
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
    savingRef.current = true;
    setError("");
    setState(next);
    stateRef.current = next;
    emitWorkspaceSnapshot(next);

    const commit = (saved: AppStateV2) => {
      setState(saved);
      stateRef.current = saved;
      emitWorkspaceSnapshot(saved);
      if (syncSession.workspaceId) {
        void publishWorkspaceBroadcast({
          workspaceId: syncSession.workspaceId,
          event: "state_saved",
          payload: {
            source,
            at: new Date().toISOString(),
          },
        });
      }
      setLastSavedAt(new Date().toISOString());
    };

    const rollback = (failure: unknown, prefix: string) => {
      setState(previous);
      stateRef.current = previous;
      emitWorkspaceSnapshot(previous);
      const detail = failure instanceof Error ? failure.message : "Speichern fehlgeschlagen.";
      setError(detail);
      message.error(`${prefix}: ${detail}`);
    };

    try {
      await adapter.save(next, { source });
      commit(next);
    } catch (saveError) {
      const isConflict = saveError instanceof Error && saveError.name === "ConflictError";
      if (!isConflict) {
        rollback(saveError, "Speichern fehlgeschlagen");
        throw saveError;
      }
      // Konflikt (Workspace wurde parallel geändert): NIE still den fremden Stand
      // überschreiben. Stattdessen: lokalen Versuch als Backup sichern, Remote neu
      // laden, die Änderung auf dem frischen Stand re-anwenden, genau EIN Retry.
      try {
        createWorkspaceBackup(`${source}:conflict-local-attempt`, next);
        const fresh = ensureAppStateV2(await adapter.load());
        const merged = ensureAppStateV2(updater(cloneState(fresh)));
        await adapter.save(merged, { source: `${source}:conflict-retry` });
        commit(merged);
        message.info("Parallel-Änderung erkannt — deine Änderung wurde auf den neuesten Stand angewendet.");
      } catch (retryError) {
        rollback(retryError, "Speicher-Konflikt (parallel bearbeitet)");
        throw retryError;
      }
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }, [adapter, syncSession.workspaceId]);

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
      onRemoteChange: () => scheduleRemotePull(120),
      onBroadcast: (event) => {
        if (event.event === "state_saved") {
          scheduleRemotePull(80);
        }
      },
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
      // Geplante Pulls des alten Workspace nicht in den neuen hinüberfeuern lassen.
      if (remotePullTimerRef.current != null) {
        window.clearTimeout(remotePullTimerRef.current);
        remotePullTimerRef.current = null;
      }
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

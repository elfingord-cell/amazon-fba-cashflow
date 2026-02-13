"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.useWorkspaceState = useWorkspaceState;
const react_1 = require("react");
const storageLocal_js_1 = require("../../data/storageLocal.js");
const runtimeConfig_js_1 = require("../../storage/runtimeConfig.js");
const presence_1 = require("../sync/presence");
const realtimeWorkspace_1 = require("../sync/realtimeWorkspace");
const session_1 = require("../sync/session");
const appState_1 = require("./appState");
const IMPORT_MARKER_PREFIX = "v2_shared_workspace_import_v1:";
const REMOTE_PULL_DEBOUNCE_MS = 340;
const WORKSPACE_SNAPSHOT_EVENT = "v2:workspace-state-snapshot";
function cloneState(input) {
    return (0, appState_1.ensureAppStateV2)(structuredClone(input));
}
function emitWorkspaceSnapshot(state) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function")
        return;
    window.dispatchEvent(new CustomEvent(WORKSPACE_SNAPSHOT_EVENT, { detail: state }));
}
function readImportMarker(workspaceId) {
    if (typeof window === "undefined")
        return "";
    try {
        return String(localStorage.getItem(`${IMPORT_MARKER_PREFIX}${workspaceId}`) || "");
    }
    catch {
        return "";
    }
}
function writeImportMarker(workspaceId, value) {
    if (typeof window === "undefined")
        return;
    try {
        localStorage.setItem(`${IMPORT_MARKER_PREFIX}${workspaceId}`, value);
    }
    catch {
        // no-op
    }
}
function hasPersistedLocalState() {
    if (typeof window === "undefined")
        return false;
    try {
        const raw = localStorage.getItem(storageLocal_js_1.STORAGE_KEY);
        return Boolean(raw && raw.trim() && raw.trim() !== "{}" && raw.trim() !== "null");
    }
    catch {
        return false;
    }
}
async function loadRemoteStateApi() {
    const mod = await Promise.resolve().then(() => __importStar(require("../../storage/remoteState.js")));
    return {
        fetchRemoteState: mod.fetchRemoteState,
        pushRemoteState: mod.pushRemoteState,
    };
}
function useWorkspaceState() {
    const adapter = (0, session_1.useStorageAdapter)();
    const syncSession = (0, session_1.useSyncSession)();
    const [state, setState] = (0, react_1.useState)(() => (0, appState_1.createEmptyAppStateV2)());
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [saving, setSaving] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)("");
    const [lastSavedAt, setLastSavedAt] = (0, react_1.useState)(null);
    const stateRef = (0, react_1.useRef)(state);
    const mountedRef = (0, react_1.useRef)(true);
    const remotePullTimerRef = (0, react_1.useRef)(null);
    const stopPollingRef = (0, react_1.useRef)(null);
    const isRemotePullingRef = (0, react_1.useRef)(false);
    const connectionStateRef = (0, react_1.useRef)("idle");
    (0, react_1.useEffect)(() => {
        stateRef.current = state;
    }, [state]);
    (0, react_1.useEffect)(() => {
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
    const maybeRunInitialLocalImport = (0, react_1.useCallback)(async () => {
        if (!syncSession.workspaceId
            || !syncSession.userId
            || !syncSession.hasWorkspaceAccess
            || !syncSession.isAuthenticated) {
            return;
        }
        const marker = readImportMarker(syncSession.workspaceId);
        if (marker)
            return;
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
        const localState = (0, appState_1.ensureAppStateV2)((0, storageLocal_js_1.loadState)());
        let shouldImport = false;
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
            shouldImport = window.confirm("Im Browser wurden lokale Daten gefunden und der Shared Workspace ist leer. Lokale Daten jetzt einmalig in den Workspace importieren?");
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
    const pullRemoteNow = (0, react_1.useCallback)(async (options) => {
        if (isRemotePullingRef.current)
            return;
        if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId)
            return;
        const skipLocalGrace = Boolean(options?.skipLocalGrace);
        const cfg = (0, runtimeConfig_js_1.getRuntimeConfig)();
        const graceMs = Math.max(0, Number(cfg.editGraceMs || 1200));
        if (!skipLocalGrace && (0, presence_1.isLocalEditActive)(graceMs)) {
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
            const loaded = (0, appState_1.ensureAppStateV2)(await adapter.load());
            if (!mountedRef.current)
                return;
            setState(loaded);
            stateRef.current = loaded;
            emitWorkspaceSnapshot(loaded);
        }
        catch (loadError) {
            if (!mountedRef.current)
                return;
            setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht aktualisiert werden.");
        }
        finally {
            isRemotePullingRef.current = false;
        }
    }, [adapter, syncSession.hasWorkspaceAccess, syncSession.workspaceId]);
    const scheduleRemotePull = (0, react_1.useCallback)((delayMs = REMOTE_PULL_DEBOUNCE_MS, options) => {
        if (!syncSession.hasWorkspaceAccess || !syncSession.workspaceId)
            return;
        const skipLocalGrace = Boolean(options?.skipLocalGrace);
        if (remotePullTimerRef.current != null) {
            window.clearTimeout(remotePullTimerRef.current);
        }
        remotePullTimerRef.current = window.setTimeout(() => {
            remotePullTimerRef.current = null;
            void pullRemoteNow({ skipLocalGrace });
        }, Math.max(0, Number(delayMs) || REMOTE_PULL_DEBOUNCE_MS));
    }, [pullRemoteNow, syncSession.hasWorkspaceAccess, syncSession.workspaceId]);
    const stopFallbackPolling = (0, react_1.useCallback)(() => {
        stopPollingRef.current?.();
        stopPollingRef.current = null;
    }, []);
    const startFallbackPollingLoop = (0, react_1.useCallback)(() => {
        if (stopPollingRef.current)
            return;
        const cfg = (0, runtimeConfig_js_1.getRuntimeConfig)();
        stopPollingRef.current = (0, realtimeWorkspace_1.startFallbackPolling)({
            intervalMs: Math.max(1000, Number(cfg.fallbackPollMs || 15000)),
            onTick: () => {
                if (connectionStateRef.current === "subscribed")
                    return;
                scheduleRemotePull(40);
            },
        });
    }, [scheduleRemotePull]);
    const reload = (0, react_1.useCallback)(async () => {
        setLoading(true);
        setError("");
        try {
            if (syncSession.hasWorkspaceAccess && syncSession.workspaceId && syncSession.isAuthenticated) {
                try {
                    await maybeRunInitialLocalImport();
                }
                catch (importError) {
                    if (mountedRef.current) {
                        setError(importError instanceof Error ? importError.message : "Initialer Import in den Shared Workspace fehlgeschlagen.");
                    }
                }
            }
            const loaded = (0, appState_1.ensureAppStateV2)(await adapter.load());
            if (!mountedRef.current)
                return;
            setState(loaded);
            stateRef.current = loaded;
            emitWorkspaceSnapshot(loaded);
        }
        catch (loadError) {
            if (!mountedRef.current)
                return;
            setError(loadError instanceof Error ? loadError.message : "Workspace konnte nicht geladen werden.");
            const fallback = (0, appState_1.createEmptyAppStateV2)();
            setState(fallback);
            stateRef.current = fallback;
            emitWorkspaceSnapshot(fallback);
        }
        finally {
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
    const saveWith = (0, react_1.useCallback)(async (updater, source) => {
        const previous = stateRef.current;
        const next = (0, appState_1.ensureAppStateV2)(updater(cloneState(previous)));
        setSaving(true);
        setError("");
        setState(next);
        stateRef.current = next;
        emitWorkspaceSnapshot(next);
        try {
            await adapter.save(next, { source });
            if (syncSession.workspaceId) {
                void (0, realtimeWorkspace_1.publishWorkspaceBroadcast)({
                    workspaceId: syncSession.workspaceId,
                    event: "state_saved",
                    payload: {
                        source,
                        at: new Date().toISOString(),
                    },
                });
            }
            setLastSavedAt(new Date().toISOString());
        }
        catch (saveError) {
            setState(previous);
            stateRef.current = previous;
            emitWorkspaceSnapshot(previous);
            setError(saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.");
            throw saveError;
        }
        finally {
            setSaving(false);
        }
    }, [adapter, syncSession.workspaceId]);
    (0, react_1.useEffect)(() => {
        void reload();
    }, [reload]);
    (0, react_1.useEffect)(() => {
        stopFallbackPolling();
        if (!syncSession.workspaceId || !syncSession.hasWorkspaceAccess) {
            connectionStateRef.current = "idle";
            return () => { };
        }
        const cfg = (0, runtimeConfig_js_1.getRuntimeConfig)();
        if (!Boolean(cfg.realtimeEnabled)) {
            startFallbackPollingLoop();
            return () => {
                stopFallbackPolling();
            };
        }
        const unsubscribe = (0, realtimeWorkspace_1.subscribeWorkspaceChanges)({
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

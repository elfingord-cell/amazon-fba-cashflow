"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeWorkspaceChanges = subscribeWorkspaceChanges;
exports.publishPresence = publishPresence;
exports.clearPresenceField = clearPresenceField;
exports.publishWorkspaceBroadcast = publishWorkspaceBroadcast;
exports.startFallbackPolling = startFallbackPolling;
const runtimeConfig_js_1 = require("../../storage/runtimeConfig.js");
const authSession_js_1 = require("../../storage/authSession.js");
const supabaseClient_js_1 = require("../../storage/supabaseClient.js");
const LOCAL_PRESENCE_KEY = `presence-${Math.random().toString(36).slice(2, 10)}`;
const RECONNECT_DELAY_MS = 2500;
let listenerIdCounter = 1;
const listeners = new Map();
let activeWorkspaceId = null;
let activeChannel = null;
let activeConnectionState = "idle";
let activePresenceEntries = [];
let lastPresencePayload = null;
let heartbeatTimer = null;
let reconnectTimer = null;
function nowIso() {
    return new Date().toISOString();
}
function mapSubscribeState(state) {
    if (state === "SUBSCRIBED")
        return "subscribed";
    if (state === "CLOSED")
        return "closed";
    if (state === "TIMED_OUT")
        return "reconnecting";
    if (state === "CHANNEL_ERROR")
        return "errored";
    return "subscribing";
}
function listenersForWorkspace(workspaceId) {
    return Array.from(listeners.values()).filter((entry) => entry.workspaceId === workspaceId);
}
function emitConnectionState(state) {
    activeConnectionState = state;
    if (!activeWorkspaceId)
        return;
    listenersForWorkspace(activeWorkspaceId).forEach((entry) => {
        entry.onConnectionState?.(state);
    });
}
function emitRemoteChange(event) {
    listenersForWorkspace(event.workspaceId).forEach((entry) => {
        entry.onRemoteChange?.(event);
    });
}
function emitBroadcast(event) {
    listenersForWorkspace(event.workspaceId).forEach((entry) => {
        entry.onBroadcast?.(event);
    });
}
function flattenPresenceState(raw) {
    const next = [];
    Object.entries(raw || {}).forEach(([key, value]) => {
        if (!Array.isArray(value))
            return;
        value.forEach((item) => {
            const payload = (item && typeof item === "object") ? item : {};
            next.push({
                key,
                userId: payload.userId ? String(payload.userId) : null,
                userEmail: payload.userEmail ? String(payload.userEmail) : null,
                userDisplayName: payload.userDisplayName ? String(payload.userDisplayName) : null,
                fieldKey: payload.fieldKey ? String(payload.fieldKey) : null,
                route: payload.route ? String(payload.route) : null,
                startedAt: payload.startedAt ? String(payload.startedAt) : null,
                heartbeatAt: payload.heartbeatAt ? String(payload.heartbeatAt) : null,
                modalScope: payload.modalScope ? String(payload.modalScope) : null,
            });
        });
    });
    return next.sort((a, b) => String(b.heartbeatAt || "").localeCompare(String(a.heartbeatAt || "")));
}
function emitPresence(entries) {
    activePresenceEntries = entries;
    if (!activeWorkspaceId)
        return;
    listenersForWorkspace(activeWorkspaceId).forEach((entry) => {
        entry.onPresenceChange?.(entries);
    });
}
function normalizeBroadcastPayload(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return {};
    return input;
}
async function trackPresenceNow() {
    if (!activeChannel || !lastPresencePayload)
        return;
    try {
        await activeChannel.track({
            ...lastPresencePayload,
            heartbeatAt: nowIso(),
        });
    }
    catch {
        // no-op
    }
}
function clearHeartbeat() {
    if (heartbeatTimer != null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}
function clearReconnectTimer() {
    if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}
function startHeartbeat() {
    clearHeartbeat();
    const cfg = (0, runtimeConfig_js_1.getRuntimeConfig)();
    const intervalMs = Math.max(1000, Number(cfg.presenceHeartbeatMs || 20000));
    heartbeatTimer = window.setInterval(() => {
        if (!lastPresencePayload)
            return;
        void trackPresenceNow();
    }, intervalMs);
}
async function teardownChannel() {
    clearHeartbeat();
    clearReconnectTimer();
    activePresenceEntries = [];
    if (!activeChannel) {
        activeWorkspaceId = null;
        emitConnectionState("idle");
        return;
    }
    try {
        await activeChannel.unsubscribe();
    }
    catch {
        // no-op
    }
    const client = (0, supabaseClient_js_1.getSupabaseBrowserClient)();
    if (client) {
        try {
            await client.removeChannel(activeChannel);
        }
        catch {
            // no-op
        }
    }
    activeChannel = null;
    activeWorkspaceId = null;
    emitConnectionState("idle");
}
async function ensureWorkspaceChannel(workspaceId, options) {
    const targetWorkspace = String(workspaceId || "").trim();
    if (!targetWorkspace) {
        await teardownChannel();
        return;
    }
    const forceRecreate = Boolean(options?.forceRecreate);
    if (activeChannel && activeWorkspaceId === targetWorkspace && !forceRecreate) {
        return;
    }
    clearReconnectTimer();
    await teardownChannel();
    const supabase = (0, supabaseClient_js_1.getSupabaseBrowserClient)();
    if (!supabase) {
        emitConnectionState("errored");
        return;
    }
    const token = await (0, authSession_js_1.getAccessToken)().catch(() => null);
    if (token) {
        try {
            await supabase.realtime.setAuth(token);
        }
        catch {
            // no-op
        }
    }
    const channel = supabase.channel(`workspace:${targetWorkspace}`, {
        config: {
            presence: { key: LOCAL_PRESENCE_KEY },
        },
    });
    channel
        .on("postgres_changes", { event: "*", schema: "public", table: "workspace_state", filter: `workspace_id=eq.${targetWorkspace}` }, (payload) => {
        emitRemoteChange({
            workspaceId: targetWorkspace,
            table: "workspace_state",
            eventType: payload.eventType,
            commitTimestamp: payload.commit_timestamp,
            payload,
        });
    })
        .on("postgres_changes", { event: "*", schema: "public", table: "workspace_meta", filter: `workspace_id=eq.${targetWorkspace}` }, (payload) => {
        emitRemoteChange({
            workspaceId: targetWorkspace,
            table: "workspace_meta",
            eventType: payload.eventType,
            commitTimestamp: payload.commit_timestamp,
            payload,
        });
    })
        .on("broadcast", { event: "*" }, (payload) => {
        const eventName = String(payload?.event || "").trim();
        if (!eventName)
            return;
        emitBroadcast({
            workspaceId: targetWorkspace,
            event: eventName,
            payload: normalizeBroadcastPayload(payload?.payload),
            sentAt: nowIso(),
        });
    })
        .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        emitPresence(flattenPresenceState(state));
    })
        .subscribe((status) => {
        const mapped = mapSubscribeState(status);
        emitConnectionState(mapped);
        if (mapped === "subscribed") {
            clearReconnectTimer();
            if (lastPresencePayload) {
                void trackPresenceNow();
            }
            return;
        }
        if (mapped === "errored" || mapped === "closed" || mapped === "reconnecting") {
            clearReconnectTimer();
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                void ensureWorkspaceChannel(targetWorkspace, { forceRecreate: true });
            }, RECONNECT_DELAY_MS);
        }
    });
    activeWorkspaceId = targetWorkspace;
    activeChannel = channel;
    emitConnectionState("subscribing");
}
function reconcileChannel() {
    const workspaceIds = Array.from(new Set(Array.from(listeners.values())
        .map((entry) => String(entry.workspaceId || "").trim())
        .filter(Boolean)));
    if (!workspaceIds.length) {
        void teardownChannel();
        return;
    }
    const target = workspaceIds[0];
    void ensureWorkspaceChannel(target);
}
function subscribeWorkspaceChanges(options) {
    const workspaceId = String(options.workspaceId || "").trim();
    if (!workspaceId) {
        return () => { };
    }
    const id = listenerIdCounter++;
    listeners.set(id, {
        id,
        workspaceId,
        onRemoteChange: options.onRemoteChange,
        onConnectionState: options.onConnectionState,
        onPresenceChange: options.onPresenceChange,
        onBroadcast: options.onBroadcast,
    });
    if (activeWorkspaceId === workspaceId) {
        options.onConnectionState?.(activeConnectionState);
        options.onPresenceChange?.(activePresenceEntries);
    }
    reconcileChannel();
    return () => {
        listeners.delete(id);
        reconcileChannel();
    };
}
function publishPresence(payload) {
    lastPresencePayload = {
        userId: payload.userId ? String(payload.userId) : null,
        userEmail: payload.userEmail ? String(payload.userEmail) : null,
        userDisplayName: payload.userDisplayName ? String(payload.userDisplayName) : null,
        fieldKey: payload.fieldKey ? String(payload.fieldKey) : null,
        route: payload.route ? String(payload.route) : null,
        startedAt: payload.startedAt ? String(payload.startedAt) : null,
        modalScope: payload.modalScope ? String(payload.modalScope) : null,
        heartbeatAt: nowIso(),
    };
    startHeartbeat();
    void trackPresenceNow();
}
function clearPresenceField() {
    if (!lastPresencePayload)
        return;
    lastPresencePayload = {
        ...lastPresencePayload,
        fieldKey: null,
        heartbeatAt: nowIso(),
    };
    void trackPresenceNow();
}
async function publishWorkspaceBroadcast(input) {
    const workspaceId = String(input.workspaceId || "").trim();
    const event = String(input.event || "").trim();
    if (!workspaceId || !event || !activeChannel || activeWorkspaceId !== workspaceId || !activeChannel.send) {
        return false;
    }
    try {
        await activeChannel.send({
            type: "broadcast",
            event,
            payload: input.payload || {},
        });
        return true;
    }
    catch {
        return false;
    }
}
function startFallbackPolling(options) {
    const intervalMs = Math.max(1000, Number(options.intervalMs || 15000));
    const timer = window.setInterval(() => {
        void options.onTick();
    }, intervalMs);
    return () => window.clearInterval(timer);
}

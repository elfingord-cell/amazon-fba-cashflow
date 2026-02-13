import { getRuntimeConfig } from "../../storage/runtimeConfig.js";
import { getAccessToken } from "../../storage/authSession.js";
import { getSupabaseBrowserClient } from "../../storage/supabaseClient.js";

type REALTIME_SUBSCRIBE_STATES =
  | "SUBSCRIBED"
  | "CLOSED"
  | "TIMED_OUT"
  | "CHANNEL_ERROR"
  | "SUBSCRIBING";

type RealtimePostgresChangesPayload<T> = {
  eventType: string;
  commit_timestamp?: string | null;
  schema?: string;
  table?: string;
  new?: T;
  old?: T;
  [key: string]: unknown;
};

type RealtimeBroadcastPayload = {
  event?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

type RealtimeChannel = {
  on: (...args: unknown[]) => RealtimeChannel;
  subscribe: (callback: (status: REALTIME_SUBSCRIBE_STATES) => void) => RealtimeChannel;
  track: (payload: Record<string, unknown>) => Promise<unknown>;
  send?: (payload: {
    type: "broadcast";
    event: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
  unsubscribe: () => Promise<unknown>;
  presenceState: () => Record<string, unknown>;
};

export type WorkspaceConnectionState =
  | "idle"
  | "subscribing"
  | "subscribed"
  | "reconnecting"
  | "closed"
  | "errored";

export interface WorkspaceRealtimeChange {
  workspaceId: string;
  table: string;
  eventType: string;
  commitTimestamp?: string | null;
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>;
}

export interface WorkspacePresenceEntry {
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  fieldKey: string | null;
  route: string | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  modalScope?: string | null;
  key: string;
}

export interface WorkspaceBroadcastEvent {
  workspaceId: string;
  event: string;
  payload: Record<string, unknown>;
  sentAt: string;
}

interface WorkspaceListener {
  id: number;
  workspaceId: string;
  onRemoteChange?: (event: WorkspaceRealtimeChange) => void;
  onConnectionState?: (state: WorkspaceConnectionState) => void;
  onPresenceChange?: (entries: WorkspacePresenceEntry[]) => void;
  onBroadcast?: (event: WorkspaceBroadcastEvent) => void;
}

interface PresencePayload {
  userId: string | null;
  userEmail: string | null;
  userDisplayName?: string | null;
  fieldKey: string | null;
  route: string | null;
  startedAt: string | null;
  heartbeatAt?: string | null;
  modalScope?: string | null;
}

const LOCAL_PRESENCE_KEY = `presence-${Math.random().toString(36).slice(2, 10)}`;
const RECONNECT_DELAY_MS = 2500;
let listenerIdCounter = 1;
const listeners = new Map<number, WorkspaceListener>();

let activeWorkspaceId: string | null = null;
let activeChannel: RealtimeChannel | null = null;
let activeConnectionState: WorkspaceConnectionState = "idle";
let activePresenceEntries: WorkspacePresenceEntry[] = [];
let lastPresencePayload: PresencePayload | null = null;
let heartbeatTimer: number | null = null;
let reconnectTimer: number | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function mapSubscribeState(state: REALTIME_SUBSCRIBE_STATES): WorkspaceConnectionState {
  if (state === "SUBSCRIBED") return "subscribed";
  if (state === "CLOSED") return "closed";
  if (state === "TIMED_OUT") return "reconnecting";
  if (state === "CHANNEL_ERROR") return "errored";
  return "subscribing";
}

function listenersForWorkspace(workspaceId: string): WorkspaceListener[] {
  return Array.from(listeners.values()).filter((entry) => entry.workspaceId === workspaceId);
}

function emitConnectionState(state: WorkspaceConnectionState): void {
  activeConnectionState = state;
  if (!activeWorkspaceId) return;
  listenersForWorkspace(activeWorkspaceId).forEach((entry) => {
    entry.onConnectionState?.(state);
  });
}

function emitRemoteChange(event: WorkspaceRealtimeChange): void {
  listenersForWorkspace(event.workspaceId).forEach((entry) => {
    entry.onRemoteChange?.(event);
  });
}

function emitBroadcast(event: WorkspaceBroadcastEvent): void {
  listenersForWorkspace(event.workspaceId).forEach((entry) => {
    entry.onBroadcast?.(event);
  });
}

function flattenPresenceState(raw: Record<string, unknown>): WorkspacePresenceEntry[] {
  const next: WorkspacePresenceEntry[] = [];
  Object.entries(raw || {}).forEach(([key, value]) => {
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      const payload = (item && typeof item === "object") ? item as Record<string, unknown> : {};
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

function emitPresence(entries: WorkspacePresenceEntry[]): void {
  activePresenceEntries = entries;
  if (!activeWorkspaceId) return;
  listenersForWorkspace(activeWorkspaceId).forEach((entry) => {
    entry.onPresenceChange?.(entries);
  });
}

function normalizeBroadcastPayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

async function trackPresenceNow(): Promise<void> {
  if (!activeChannel || !lastPresencePayload) return;
  try {
    await activeChannel.track({
      ...lastPresencePayload,
      heartbeatAt: nowIso(),
    });
  } catch {
    // no-op
  }
}

function clearHeartbeat(): void {
  if (heartbeatTimer != null) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startHeartbeat(): void {
  clearHeartbeat();
  const cfg = getRuntimeConfig();
  const intervalMs = Math.max(1000, Number(cfg.presenceHeartbeatMs || 20000));
  heartbeatTimer = window.setInterval(() => {
    if (!lastPresencePayload) return;
    void trackPresenceNow();
  }, intervalMs);
}

async function teardownChannel(): Promise<void> {
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
  } catch {
    // no-op
  }
  const client = getSupabaseBrowserClient();
  if (client) {
    try {
      await client.removeChannel(activeChannel);
    } catch {
      // no-op
    }
  }
  activeChannel = null;
  activeWorkspaceId = null;
  emitConnectionState("idle");
}

async function ensureWorkspaceChannel(workspaceId: string, options?: { forceRecreate?: boolean }): Promise<void> {
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

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    emitConnectionState("errored");
    return;
  }

  const token = await getAccessToken().catch(() => null);
  if (token) {
    try {
      await supabase.realtime.setAuth(token);
    } catch {
      // no-op
    }
  }

  const channel = supabase.channel(`workspace:${targetWorkspace}`, {
    config: {
      presence: { key: LOCAL_PRESENCE_KEY },
    },
  });

  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workspace_state", filter: `workspace_id=eq.${targetWorkspace}` },
      (payload) => {
        emitRemoteChange({
          workspaceId: targetWorkspace,
          table: "workspace_state",
          eventType: payload.eventType,
          commitTimestamp: payload.commit_timestamp,
          payload,
        });
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "workspace_meta", filter: `workspace_id=eq.${targetWorkspace}` },
      (payload) => {
        emitRemoteChange({
          workspaceId: targetWorkspace,
          table: "workspace_meta",
          eventType: payload.eventType,
          commitTimestamp: payload.commit_timestamp,
          payload,
        });
      },
    )
    .on("broadcast", { event: "*" }, (payload: RealtimeBroadcastPayload) => {
      const eventName = String(payload?.event || "").trim();
      if (!eventName) return;
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

function reconcileChannel(): void {
  const workspaceIds = Array.from(new Set(
    Array.from(listeners.values())
      .map((entry) => String(entry.workspaceId || "").trim())
      .filter(Boolean),
  ));

  if (!workspaceIds.length) {
    void teardownChannel();
    return;
  }

  const target = workspaceIds[0];
  void ensureWorkspaceChannel(target);
}

export function subscribeWorkspaceChanges(options: {
  workspaceId: string;
  onRemoteChange?: (event: WorkspaceRealtimeChange) => void;
  onConnectionState?: (state: WorkspaceConnectionState) => void;
  onPresenceChange?: (entries: WorkspacePresenceEntry[]) => void;
  onBroadcast?: (event: WorkspaceBroadcastEvent) => void;
}): () => void {
  const workspaceId = String(options.workspaceId || "").trim();
  if (!workspaceId) {
    return () => {};
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

export function publishPresence(payload: PresencePayload): void {
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

export function clearPresenceField(): void {
  if (!lastPresencePayload) return;
  lastPresencePayload = {
    ...lastPresencePayload,
    fieldKey: null,
    heartbeatAt: nowIso(),
  };
  void trackPresenceNow();
}

export async function publishWorkspaceBroadcast(input: {
  workspaceId: string;
  event: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
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
  } catch {
    return false;
  }
}

export function startFallbackPolling(options: {
  intervalMs: number;
  onTick: () => void | Promise<void>;
}): () => void {
  const intervalMs = Math.max(1000, Number(options.intervalMs || 15000));
  const timer = window.setInterval(() => {
    void options.onTick();
  }, intervalMs);
  return () => window.clearInterval(timer);
}

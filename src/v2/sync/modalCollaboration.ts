import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceBroadcastEvent } from "./realtimeWorkspace";
import { publishWorkspaceBroadcast, subscribeWorkspaceChanges } from "./realtimeWorkspace";
import {
  resolveCollaborationUserLabel,
  type CollaborationDisplayNameMap,
} from "../domain/collaboration";

type ModalRole = "editor" | "viewer";

interface ModalParticipant {
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  joinedAt: string;
}

interface ModalCollaborationOptions {
  workspaceId: string | null | undefined;
  modalScope: string;
  isOpen: boolean;
  userId: string | null;
  userEmail: string | null;
  userDisplayName?: string | null;
  displayNames?: CollaborationDisplayNameMap;
}

interface BroadcastPayload {
  modalScope?: string;
  userId?: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  role?: ModalRole;
  action?: "join" | "leave";
  ownerUserId?: string;
  patch?: Record<string, unknown>;
  sentAt?: string;
}

interface ModalBanner {
  tone: "success" | "warning" | "info";
  text: string;
}

export interface ModalCollaborationState {
  readOnly: boolean;
  role: ModalRole;
  lockOwnerUserId: string | null;
  remoteUserLabel: string | null;
  remoteInModal: boolean;
  remoteEditing: boolean;
  banner: ModalBanner | null;
  remoteDraftPatch: Record<string, unknown> | null;
  remoteDraftVersion: number;
  takeOver: () => void;
  publishDraftPatch: (patch: Record<string, unknown>) => void;
  clearDraft: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPayload(input: Record<string, unknown> | null | undefined): BroadcastPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as BroadcastPayload;
}

function matchesScope(event: WorkspaceBroadcastEvent, modalScope: string): boolean {
  const payload = toPayload(event.payload);
  return String(payload.modalScope || "") === String(modalScope || "");
}

function resolveParticipantLabel(
  participant: ModalParticipant | null | undefined,
  displayNames?: CollaborationDisplayNameMap,
): string | null {
  if (!participant) return null;
  return resolveCollaborationUserLabel({
    userId: participant.userId,
    userEmail: participant.userEmail,
    userDisplayName: participant.userDisplayName,
  }, displayNames);
}

export function useModalCollaboration(options: ModalCollaborationOptions): ModalCollaborationState {
  const workspaceId = String(options.workspaceId || "").trim();
  const modalScope = String(options.modalScope || "").trim();
  const userId = String(options.userId || "").trim();
  const userEmail = options.userEmail || null;
  const userDisplayName = options.userDisplayName || null;

  const [participants, setParticipants] = useState<Record<string, ModalParticipant>>({});
  const [lockOwnerUserId, setLockOwnerUserId] = useState<string | null>(null);
  const [remoteDraftPatch, setRemoteDraftPatch] = useState<Record<string, unknown> | null>(null);
  const [remoteDraftVersion, setRemoteDraftVersion] = useState(0);
  const lockOwnerRef = useRef<string | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const draftBufferRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    lockOwnerRef.current = lockOwnerUserId;
  }, [lockOwnerUserId]);

  const participantArray = useMemo(
    () => Object.values(participants).sort((a, b) => String(a.joinedAt || "").localeCompare(String(b.joinedAt || ""))),
    [participants],
  );
  const remoteParticipants = useMemo(
    () => participantArray.filter((entry) => entry.userId && entry.userId !== userId),
    [participantArray, userId],
  );
  const remoteInModal = remoteParticipants.length > 0;
  const remoteEditing = Boolean(lockOwnerUserId && lockOwnerUserId !== userId);
  const readOnly = Boolean(options.isOpen && userId && lockOwnerUserId && lockOwnerUserId !== userId);
  const role: ModalRole = readOnly ? "viewer" : "editor";

  const sendBroadcast = useCallback(async (event: string, payload: Record<string, unknown>) => {
    if (!workspaceId || !modalScope || !userId) return false;
    return publishWorkspaceBroadcast({
      workspaceId,
      event,
      payload: {
        modalScope,
        userId,
        userEmail,
        userDisplayName,
        sentAt: nowIso(),
        ...payload,
      },
    });
  }, [modalScope, userDisplayName, userEmail, userId, workspaceId]);

  const lockOwnerParticipant = useMemo(
    () => (lockOwnerUserId ? participants[lockOwnerUserId] || null : null),
    [lockOwnerUserId, participants],
  );
  const remoteUserLabel = useMemo(() => {
    if (lockOwnerUserId && lockOwnerUserId !== userId) {
      return resolveParticipantLabel(lockOwnerParticipant, options.displayNames);
    }
    return resolveParticipantLabel(remoteParticipants[0], options.displayNames);
  }, [lockOwnerParticipant, lockOwnerUserId, options.displayNames, remoteParticipants, userId]);

  useEffect(() => {
    if (!options.isOpen || !workspaceId || !modalScope || !userId) return;
    if (lockOwnerUserId) return;
    const ordered = Object.values(participants)
      .filter((entry) => Boolean(entry.userId))
      .sort((left, right) => {
        const byTime = String(left.joinedAt || "").localeCompare(String(right.joinedAt || ""));
        if (byTime !== 0) return byTime;
        return String(left.userId || "").localeCompare(String(right.userId || ""));
      });
    const owner = ordered[0];
    if (!owner?.userId) return;
    setLockOwnerUserId(owner.userId);
    if (owner.userId === userId) {
      void sendBroadcast("modal_lock", { ownerUserId: userId });
    }
  }, [
    lockOwnerUserId,
    modalScope,
    options.isOpen,
    participants,
    sendBroadcast,
    userId,
    workspaceId,
  ]);

  const banner = useMemo<ModalBanner | null>(() => {
    if (!options.isOpen || !userId) return null;
    const remoteLabel = remoteUserLabel || "Kollege";
    if (readOnly) {
      return {
        tone: "warning",
        text: `${remoteLabel} bearbeitet gerade. Du bist im Lesemodus und kannst Bearbeitung übernehmen.`,
      };
    }
    if (remoteInModal) {
      return {
        tone: "info",
        text: `Du bearbeitest. ${remoteLabel} ist ebenfalls im Modal (Lesemodus).`,
      };
    }
    return null;
  }, [options.isOpen, readOnly, remoteInModal, remoteUserLabel, userId]);

  const flushDraftPatch = useCallback(() => {
    if (!options.isOpen || readOnly) return;
    if (!Object.keys(draftBufferRef.current).length) return;
    const patch = draftBufferRef.current;
    draftBufferRef.current = {};
    void sendBroadcast("modal_draft_patch", { patch });
  }, [options.isOpen, readOnly, sendBroadcast]);

  const publishDraftPatch = useCallback((patch: Record<string, unknown>) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
    draftBufferRef.current = { ...draftBufferRef.current, ...patch };
    if (draftTimerRef.current != null) {
      window.clearTimeout(draftTimerRef.current);
    }
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      flushDraftPatch();
    }, 180);
  }, [flushDraftPatch]);

  const clearDraft = useCallback(() => {
    draftBufferRef.current = {};
    if (draftTimerRef.current != null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    if (!options.isOpen) return;
    void sendBroadcast("modal_draft_clear", {});
  }, [options.isOpen, sendBroadcast]);

  const takeOver = useCallback(() => {
    if (!options.isOpen || !workspaceId || !modalScope || !userId) return;
    setLockOwnerUserId(userId);
    void sendBroadcast("modal_takeover", { ownerUserId: userId });
    void sendBroadcast("modal_lock", { ownerUserId: userId });
  }, [modalScope, options.isOpen, sendBroadcast, userId, workspaceId]);

  useEffect(() => {
    if (!options.isOpen || !workspaceId || !modalScope || !userId) {
      setParticipants({});
      setLockOwnerUserId(null);
      setRemoteDraftPatch(null);
      return () => {};
    }

    setParticipants((current) => ({
      ...current,
      [userId]: {
        userId,
        userEmail,
        userDisplayName,
        joinedAt: nowIso(),
      },
    }));

    void sendBroadcast("modal_presence", {
      action: "join",
      role,
    });

    const subscribeCleanup = subscribeWorkspaceChanges({
      workspaceId,
      onBroadcast: (event) => {
        if (!matchesScope(event, modalScope)) return;
        const payload = toPayload(event.payload);
        const senderId = String(payload.userId || "").trim();
        if (!senderId) return;

        if (event.event === "modal_presence") {
          const action = payload.action === "leave" ? "leave" : "join";
          setParticipants((current) => {
            if (action === "leave") {
              if (!current[senderId]) return current;
              const next = { ...current };
              delete next[senderId];
              if (senderId === lockOwnerRef.current) {
                setLockOwnerUserId(null);
              }
              return next;
            }
            return {
              ...current,
              [senderId]: {
                userId: senderId,
                userEmail: payload.userEmail ? String(payload.userEmail) : null,
                userDisplayName: payload.userDisplayName ? String(payload.userDisplayName) : null,
                joinedAt: String(payload.sentAt || nowIso()),
              },
            };
          });
          if (action === "join" && senderId !== userId && lockOwnerRef.current === userId) {
            void sendBroadcast("modal_lock", { ownerUserId: userId });
          }
          return;
        }

        if (event.event === "modal_lock" || event.event === "modal_takeover") {
          const ownerId = String(payload.ownerUserId || "").trim();
          if (!ownerId) return;
          setLockOwnerUserId(ownerId);
          return;
        }

        if (event.event === "modal_unlock") {
          const ownerId = String(payload.ownerUserId || "").trim();
          if (!ownerId || ownerId === lockOwnerUserId) {
            setLockOwnerUserId(null);
          }
          return;
        }

        if (event.event === "modal_draft_patch" && senderId !== userId) {
          const patch = payload.patch;
          if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
          setRemoteDraftPatch(patch as Record<string, unknown>);
          setRemoteDraftVersion((current) => current + 1);
          return;
        }

        if (event.event === "modal_draft_clear" && senderId !== userId) {
          setRemoteDraftPatch(null);
          setRemoteDraftVersion((current) => current + 1);
        }
      },
    });

    return () => {
      subscribeCleanup();
      if (draftTimerRef.current != null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (workspaceId && modalScope && userId) {
        void sendBroadcast("modal_draft_clear", {});
        if (lockOwnerRef.current === userId) {
          void sendBroadcast("modal_unlock", { ownerUserId: userId });
        }
        void sendBroadcast("modal_presence", {
          action: "leave",
          role,
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalScope, options.isOpen, role, sendBroadcast, userDisplayName, userEmail, userId, workspaceId]);

  return {
    readOnly,
    role,
    lockOwnerUserId,
    remoteUserLabel,
    remoteInModal,
    remoteEditing,
    banner,
    remoteDraftPatch,
    remoteDraftVersion,
    takeOver,
    publishDraftPatch,
    clearDraft,
  };
}

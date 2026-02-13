import { useEffect, useMemo, useState } from "react";
import {
  fetchServerSession,
  getCurrentUser,
  onAuthSessionChange,
} from "../../storage/authSession.js";
import { isDbSyncEnabled } from "../../storage/syncBackend.js";
import type { SyncSession, StorageAdapter } from "./types";
import { createDefaultStorageAdapter } from "./storageAdapters";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useSyncSession(): SyncSession {
  const [session, setSession] = useState<SyncSession>({
    userId: null,
    email: null,
    workspaceId: null,
    role: null,
    online: readOnline(),
    isAuthenticated: false,
    hasWorkspaceAccess: false,
    requiresAuth: isDbSyncEnabled(),
  });

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const user = await getCurrentUser();
        const server = user ? await fetchServerSession() : null;
        if (!mounted) return;
        const authenticated = Boolean(user?.id);
        const hasWorkspaceAccess = Boolean(server?.workspaceId);
        setSession({
          userId: user?.id || null,
          email: user?.email || null,
          workspaceId: server?.workspaceId || null,
          role: (server?.role || null) as "owner" | "editor" | null,
          online: readOnline(),
          isAuthenticated: authenticated,
          hasWorkspaceAccess,
          requiresAuth: isDbSyncEnabled() && !authenticated,
        });
      } catch {
        if (!mounted) return;
        setSession((prev) => ({
          ...prev,
          online: readOnline(),
        }));
      }
    };

    refresh();
    const unsub = onAuthSessionChange(() => {
      refresh();
    });

    const onOnline = () => setSession((prev) => ({ ...prev, online: true }));
    const onOffline = () => setSession((prev) => ({ ...prev, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      mounted = false;
      unsub();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return session;
}

export function useStorageAdapter(): StorageAdapter {
  return useMemo(() => createDefaultStorageAdapter(), []);
}

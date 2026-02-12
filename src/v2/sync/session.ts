import { useEffect, useMemo, useState } from "react";
import {
  fetchServerSession,
  getCurrentUser,
  onAuthSessionChange,
} from "../../storage/authSession.js";
import type { SyncSession, StorageAdapter } from "./types";
import { createDefaultStorageAdapter } from "./storageAdapters";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useSyncSession(): SyncSession {
  const [session, setSession] = useState<SyncSession>({
    userId: null,
    workspaceId: null,
    role: null,
    online: readOnline(),
  });

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const user = await getCurrentUser();
        const server = await fetchServerSession();
        if (!mounted) return;
        setSession({
          userId: user?.id || null,
          workspaceId: server?.workspaceId || null,
          role: (server?.role || null) as "owner" | "editor" | null,
          online: readOnline(),
        });
      } catch {
        if (!mounted) return;
        setSession((prev) => ({ ...prev, online: readOnline() }));
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

import type { AppStateV2 } from "../state/types";

export interface SyncSession {
  userId: string | null;
  email: string | null;
  workspaceId: string | null;
  role: "owner" | "editor" | null;
  online: boolean;
  isAuthenticated: boolean;
  hasWorkspaceAccess: boolean;
  requiresAuth: boolean;
}

export interface StorageAdapter {
  load(): Promise<AppStateV2>;
  save(next: AppStateV2, meta: { source: string }): Promise<void>;
}

export interface WorkspaceBackupEntry {
  id: string;
  createdAt: string;
  source: string;
  state: AppStateV2;
}

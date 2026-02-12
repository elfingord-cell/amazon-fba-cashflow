import { loadState, commitState } from "../../data/storageLocal.js";
import {
  AuthRequiredError,
  ConfigurationError,
  ConflictError,
  fetchRemoteState,
  pushRemoteState,
} from "../../storage/remoteState.js";
import { ensureAppStateV2 } from "../state/appState";
import type { AppStateV2 } from "../state/types";
import type { StorageAdapter, WorkspaceBackupEntry } from "./types";

const BACKUP_KEY = "v2_workspace_backups_v1";
const MAX_BACKUPS = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isFallbackError(error: unknown): boolean {
  return (
    error instanceof AuthRequiredError
    || error instanceof ConfigurationError
    || (error instanceof Error && /auth|workspace|supabase/i.test(error.message))
  );
}

function readBackups(): WorkspaceBackupEntry[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBackups(entries: WorkspaceBackupEntry[]): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(entries.slice(0, MAX_BACKUPS)));
  } catch {
    // no-op
  }
}

export function getWorkspaceBackups(): WorkspaceBackupEntry[] {
  return readBackups();
}

export function createWorkspaceBackup(source: string, state: AppStateV2): string {
  const backup: WorkspaceBackupEntry = {
    id: randomId("backup"),
    createdAt: nowIso(),
    source,
    state: ensureAppStateV2(state),
  };
  const entries = [backup, ...readBackups()];
  writeBackups(entries);
  return backup.id;
}

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppStateV2> {
    return ensureAppStateV2(loadState());
  }

  async save(next: AppStateV2, meta: { source: string }): Promise<void> {
    commitState(next, { source: meta.source || "v2:local-save" });
  }
}

export class SupabaseStorageAdapter implements StorageAdapter {
  private lastRev: string | null = null;

  async load(): Promise<AppStateV2> {
    const remote = await fetchRemoteState();
    if (remote?.exists && remote.data) {
      this.lastRev = remote.rev || null;
      return ensureAppStateV2(remote.data);
    }
    this.lastRev = null;
    return ensureAppStateV2(loadState());
  }

  async save(next: AppStateV2, meta: { source: string }): Promise<void> {
    const payload = ensureAppStateV2(next);
    try {
      const result = await pushRemoteState({
        ifMatchRev: this.lastRev,
        updatedBy: meta.source || "v2:supabase-save",
        data: payload,
      });
      this.lastRev = result.rev || null;
    } catch (error) {
      if (error instanceof ConflictError) {
        const latest = await fetchRemoteState();
        this.lastRev = latest?.rev || null;
      }
      throw error;
    }
  }
}

export class SupabaseFirstStorageAdapter implements StorageAdapter {
  private readonly local = new LocalStorageAdapter();
  private readonly remote = new SupabaseStorageAdapter();

  async load(): Promise<AppStateV2> {
    try {
      return await this.remote.load();
    } catch (error) {
      if (isFallbackError(error)) {
        return this.local.load();
      }
      throw error;
    }
  }

  async save(next: AppStateV2, meta: { source: string }): Promise<void> {
    try {
      await this.remote.save(next, meta);
      await this.local.save(next, { source: `${meta.source}:cache` });
      return;
    } catch (error) {
      if (!isFallbackError(error)) {
        throw error;
      }
    }
    await this.local.save(next, { source: `${meta.source}:fallback` });
  }
}

export function createDefaultStorageAdapter(): StorageAdapter {
  return new SupabaseFirstStorageAdapter();
}

import {
  addStateListener,
  loadState,
  commitState,
  exportState,
  STORAGE_KEY,
  LAST_COMMIT_KEY,
} from "../data/storageLocal.js";
import {
  fetchRemoteState,
  pushRemoteState,
  ConflictError,
  AuthRequiredError,
  ConfigurationError,
} from "../storage/remoteState.js";
import { hasSupabaseClientConfig, isDbSyncEnabled } from "../storage/syncBackend.js";
import { openConfirmDialog } from "../ui/utils/confirmDialog.js";

const REMOTE_REV_KEY = "remoteRev";
const REMOTE_UPDATED_KEY = "remoteUpdatedAt";
const REMOTE_BACKUP_KEY = "remoteBackup";
const EDITOR_ID_KEY = "editorId";
const AUTO_SYNC_KEY = "autoSyncEnabled";
const PUBLISH_DISMISSED_KEY = "remotePublishDismissed";

const POLL_INTERVAL_MS = 30000;

function ensureEditorId() {
  let id = localStorage.getItem(EDITOR_ID_KEY);
  if (!id) {
    id = `ed-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(EDITOR_ID_KEY, id);
  }
  return id;
}

function isAutoSyncEnabled() {
  const stored = localStorage.getItem(AUTO_SYNC_KEY);
  if (stored == null) return true;
  return stored !== "false";
}

function setAutoSyncEnabled(next) {
  localStorage.setItem(AUTO_SYNC_KEY, next ? "true" : "false");
}

function ensureBannerContainer() {
  let container = document.getElementById("sync-banner");
  if (!container) {
    container = document.createElement("div");
    container.id = "sync-banner";
    container.className = "sync-banner-container";
    document.body.appendChild(container);
  }
  return container;
}

function clearAllDrafts() {
  const prefix = "drafts/v1:";
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) toRemove.push(key);
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}

function createToast(message) {
  let toast = document.getElementById("sync-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "sync-toast";
    toast.className = "po-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2200);
}

function setupStatusUI() {
  const statusEl = document.getElementById("sync-status");
  const toggleEl = document.getElementById("sync-auto-toggle");
  if (toggleEl) {
    toggleEl.checked = isAutoSyncEnabled();
    toggleEl.addEventListener("change", () => {
      const enabled = Boolean(toggleEl.checked);
      setAutoSyncEnabled(enabled);
    });
  }
  return { statusEl, toggleEl };
}

function updateStatusPill(statusEl, status) {
  if (!statusEl) return;
  statusEl.dataset.status = status;
  statusEl.textContent = status
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function showBanner(config) {
  const container = ensureBannerContainer();
  if (!config) {
    container.innerHTML = "";
    return;
  }
  const { message, type = "info", actions = [], dismissKey } = config;
  container.innerHTML = "";
  const banner = document.createElement("div");
  banner.className = `banner ${type} sync-banner`;
  const content = document.createElement("div");
  content.className = "sync-banner-content";
  content.textContent = message;
  banner.appendChild(content);
  if (actions.length) {
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "sync-banner-actions";
    actions.forEach(({ label, variant = "btn", onClick }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = variant;
      btn.textContent = label;
      btn.addEventListener("click", onClick);
      actionsWrap.appendChild(btn);
    });
    banner.appendChild(actionsWrap);
  }
  if (dismissKey) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn ghost sync-banner-dismiss";
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", () => {
      if (dismissKey) localStorage.setItem(dismissKey, "true");
      container.innerHTML = "";
    });
    banner.appendChild(dismiss);
  }
  container.appendChild(banner);
}

export function initRemoteSync() {
  if (typeof window === "undefined") return null;

  const editorId = ensureEditorId();
  const { statusEl, toggleEl } = setupStatusUI();
  const bannerContainer = ensureBannerContainer();

  let remoteRev = localStorage.getItem(REMOTE_REV_KEY);
  let remoteUpdatedAt = localStorage.getItem(REMOTE_UPDATED_KEY);
  let remoteExists = false;
  let dirty = false;
  let conflict = false;
  let offline = false;
  let authRequired = false;
  let configError = false;
  let suppressNextSync = false;
  let blockAutoSync = false;
  let pollTimer = null;

  if (isDbSyncEnabled() && !hasSupabaseClientConfig()) {
    configError = true;
    showBanner({
      message: "Supabase env fehlt (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).",
      type: "danger",
    });
  }

  const setStatus = (status) => updateStatusPill(statusEl, status);

  const updateStatus = () => {
    if (configError) {
      setStatus("config-error");
      return;
    }
    if (authRequired) {
      setStatus("auth-required");
      return;
    }
    if (offline) {
      setStatus("offline");
      return;
    }
    if (conflict) {
      setStatus("conflict");
      return;
    }
    if (!remoteExists) {
      setStatus("local-only");
      return;
    }
    if (dirty) {
      setStatus("unsynced-changes");
    } else {
      setStatus("synced");
    }
  };

  const clearSyncErrors = () => {
    authRequired = false;
    configError = false;
    offline = false;
  };

  const handleSyncError = (err, fallbackToast = true) => {
    if (err instanceof AuthRequiredError) {
      authRequired = true;
      offline = false;
      conflict = false;
      updateStatus();
      showBanner({
        message: err?.message || "Shared sync requires login. Bitte im Sidebar anmelden.",
        type: "warning",
      });
      return;
    }

    if (err instanceof ConfigurationError) {
      configError = true;
      authRequired = false;
      offline = false;
      conflict = false;
      updateStatus();
      showBanner({
        message: "Supabase env fehlt (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).",
        type: "danger",
      });
      return;
    }

    offline = true;
    authRequired = false;
    configError = false;
    updateStatus();
    if (fallbackToast) createToast("Offline");
  };

  const rememberRemote = (rev, updatedAt, data) => {
    remoteRev = rev;
    remoteUpdatedAt = updatedAt;
    if (rev) localStorage.setItem(REMOTE_REV_KEY, rev);
    if (updatedAt) localStorage.setItem(REMOTE_UPDATED_KEY, updatedAt);
    if (data) {
      const backup = { savedAt: updatedAt, rev, data };
      localStorage.setItem(REMOTE_BACKUP_KEY, JSON.stringify(backup));
    }
  };

  const publishLocalState = async (forceOverwrite = false) => {
    const payload = loadState();
    let ifMatchRev = remoteRev ?? null;
    if (!ifMatchRev && !forceOverwrite) {
      try {
        const latest = await fetchRemoteState();
        if (latest?.exists) {
          ifMatchRev = latest.rev || null;
          if (!ifMatchRev) return;
        }
      } catch (err) {
        handleSyncError(err, false);
        return;
      }
    }
    try {
      const response = await pushRemoteState({
        ifMatchRev,
        updatedBy: editorId,
        data: payload,
      });
      remoteExists = true;
      dirty = false;
      conflict = false;
      clearSyncErrors();
      rememberRemote(response.rev, response.updatedAt, payload);
      updateStatus();
      showBanner(null);
      createToast("Synced");
    } catch (err) {
      if (err instanceof ConflictError) {
        conflict = true;
        updateStatus();
        openConflictModal(err.details);
      } else {
        handleSyncError(err);
      }
    }
  };

  const openConflictModal = (details = {}) => {
    const overlay = document.createElement("div");
    overlay.className = "po-modal-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const modal = document.createElement("div");
    modal.className = "po-modal";
    modal.innerHTML = `
      <header class="po-modal-header">
        <h4>Remote data changed</h4>
        <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
      </header>
      <div class="po-modal-body">
        <p>Someone else saved changes. Choose how to proceed:</p>
        <ul class="simple">
          <li>Reload remote and discard your unsynced changes.</li>
          <li>Export your local version as JSON for backup.</li>
          <li>Force overwrite the remote (dangerous).</li>
        </ul>
      </div>
      <footer class="po-modal-actions">
        <button class="btn secondary" type="button" data-export>Export my version</button>
        <button class="btn" type="button" data-reload>Reload remote</button>
        <button class="btn danger" type="button" data-force>Force overwrite</button>
      </footer>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    modal.querySelector("[data-close]")?.addEventListener("click", close);
    modal.querySelector("[data-export]")?.addEventListener("click", () => {
      exportState(loadState());
    });
    modal.querySelector("[data-reload]")?.addEventListener("click", async () => {
      close();
      await reloadRemoteState();
    });
    modal.querySelector("[data-force]")?.addEventListener("click", () => {
      close();
      openConfirmDialog({
        title: "Force overwrite remote?",
        message: "This will replace the shared state with your local data.",
        confirmLabel: "Overwrite remote",
        cancelLabel: "Cancel",
        onConfirm: async () => {
          await forceOverwriteRemote();
        },
      });
    });
  };

  const reloadRemoteState = async () => {
    try {
      const remote = await fetchRemoteState();
      if (remote?.exists) {
        suppressNextSync = true;
        commitState(remote.data, { source: "remote:reload", action: "overwrite" });
        clearAllDrafts();
        remoteExists = true;
        conflict = false;
        dirty = false;
        clearSyncErrors();
        rememberRemote(remote.rev, remote.updatedAt);
        updateStatus();
        createToast("Updated from remote");
      }
    } catch (err) {
      handleSyncError(err);
    }
  };

  const forceOverwriteRemote = async () => {
    try {
      const latest = await fetchRemoteState();
      const currentRev = latest?.rev || null;
      const payload = loadState();
      const response = await pushRemoteState({
        ifMatchRev: currentRev,
        updatedBy: editorId,
        data: payload,
      });
      remoteExists = true;
      conflict = false;
      dirty = false;
      clearSyncErrors();
      rememberRemote(response.rev, response.updatedAt, payload);
      updateStatus();
      createToast("Remote overwritten");
    } catch (err) {
      if (err instanceof ConflictError) {
        conflict = true;
        updateStatus();
        openConflictModal(err.details);
      } else {
        handleSyncError(err);
      }
    }
  };

  const handleRemoteUpdatedWhileDirty = (remote) => {
    showBanner({
      message: "Remote updated — save to sync, or reload.",
      type: "warning",
      actions: [
        {
          label: "Reload remote",
          variant: "btn",
          onClick: async () => {
            showBanner(null);
            await reloadRemoteState();
          },
        },
        {
          label: "Export my version",
          variant: "btn secondary",
          onClick: () => exportState(loadState()),
        },
      ],
    });
  };

  const handleRemoteMissing = () => {
    const dismissed = localStorage.getItem(PUBLISH_DISMISSED_KEY) === "true";
    if (dismissed) return;
    showBanner({
      message: "Shared storage is empty. Publish your local data to the shared state?",
      type: "info",
      dismissKey: PUBLISH_DISMISSED_KEY,
      actions: [
        {
          label: "Publish local data",
          variant: "btn",
          onClick: async () => {
            await publishLocalState(true);
          },
        },
      ],
    });
  };

  const handleImportedBanner = () => {
    showBanner({
      message: "Imported locally. Publish to shared state?",
      type: "info",
      actions: [
        {
          label: "Publish now",
          variant: "btn",
          onClick: async () => {
            showBanner(null);
            try {
              const latest = await fetchRemoteState();
              if (latest?.exists && latest.rev) {
                openConfirmDialog({
                  title: "Overwrite remote?",
                  message: "Shared state exists. Overwrite with imported data?",
                  confirmLabel: "Overwrite",
                  cancelLabel: "Cancel",
                  onConfirm: async () => {
                    await forceOverwriteRemote();
                  },
                });
                return;
              }
              await publishLocalState(true);
            } catch (err) {
              handleSyncError(err);
            }
          },
        },
      ],
    });
  };

  const reconcileInitialState = async () => {
    try {
      const remote = await fetchRemoteState();
      clearSyncErrors();
      if (remote?.exists) {
        remoteExists = true;
        const localLastCommitAt = localStorage.getItem(LAST_COMMIT_KEY);
        const hasLocalState = Boolean(localStorage.getItem(STORAGE_KEY));
        const remoteIsNewer = localLastCommitAt
          ? new Date(remote.updatedAt) > new Date(localLastCommitAt)
          : !hasLocalState;
        if (remoteIsNewer) {
          suppressNextSync = true;
          commitState(remote.data, { source: "remote:init", action: "overwrite" });
          createToast("Loaded shared state");
        }
        rememberRemote(remote.rev, remote.updatedAt);
      } else {
        remoteExists = false;
        handleRemoteMissing();
      }
      updateStatus();
    } catch (err) {
      handleSyncError(err, false);
    }
  };

  const attemptPush = async (state) => {
    if (!remoteExists && !remoteRev) {
      handleRemoteMissing();
      updateStatus();
      return;
    }
    try {
      const response = await pushRemoteState({
        ifMatchRev: remoteRev,
        updatedBy: editorId,
        data: state,
      });
      remoteExists = true;
      dirty = false;
      conflict = false;
      clearSyncErrors();
      rememberRemote(response.rev, response.updatedAt, state);
      updateStatus();
      createToast("Synced");
    } catch (err) {
      if (err instanceof ConflictError) {
        conflict = true;
        updateStatus();
        openConflictModal(err.details);
      } else {
        handleSyncError(err, false);
      }
    }
  };

  const pollRemote = async () => {
    try {
      const remote = await fetchRemoteState();
      if (!remote?.exists) {
        remoteExists = false;
        updateStatus();
        return;
      }
      remoteExists = true;
      clearSyncErrors();
      if (remote.rev && remote.rev !== remoteRev) {
        if (!dirty) {
          suppressNextSync = true;
          commitState(remote.data, { source: "remote:poll", action: "overwrite" });
          rememberRemote(remote.rev, remote.updatedAt);
          updateStatus();
          createToast("Updated from shared state");
        } else {
          handleRemoteUpdatedWhileDirty(remote);
        }
      }
    } catch (err) {
      handleSyncError(err, false);
    }
  };

  addStateListener((state) => {
    if (suppressNextSync) {
      suppressNextSync = false;
      dirty = false;
      conflict = false;
      updateStatus();
      return;
    }
    if (blockAutoSync) {
      dirty = true;
      updateStatus();
      blockAutoSync = false;
      return;
    }
    if (!isAutoSyncEnabled()) {
      dirty = true;
      updateStatus();
      return;
    }
    dirty = true;
    updateStatus();
    attemptPush(state);
  });

  if (toggleEl) {
    toggleEl.addEventListener("change", () => {
      if (toggleEl.checked && dirty) {
        attemptPush(loadState());
      } else {
        updateStatus();
      }
    });
  }

  const handleLocalImportEvent = () => {
    blockAutoSync = true;
    dirty = true;
    updateStatus();

    if (!isAutoSyncEnabled()) {
      handleImportedBanner();
      return;
    }

    if (!remoteExists && !remoteRev) {
      void publishLocalState(true);
      return;
    }

    void attemptPush(loadState());
  };

  const handleAuthChanged = () => {
    authRequired = false;
    conflict = false;
    offline = false;
    reconcileInitialState();
    if (isAutoSyncEnabled() && dirty) {
      attemptPush(loadState());
    } else {
      updateStatus();
    }
  };

  window.addEventListener("remote-sync:local-import", handleLocalImportEvent);
  window.addEventListener("remote-sync:auth-changed", handleAuthChanged);

  reconcileInitialState();
  pollTimer = window.setInterval(() => {
    if (!dirty) pollRemote();
  }, POLL_INTERVAL_MS);

  updateStatus();

  return {
    publishLocalState,
    teardown() {
      if (pollTimer) window.clearInterval(pollTimer);
      window.removeEventListener("remote-sync:local-import", handleLocalImportEvent);
      window.removeEventListener("remote-sync:auth-changed", handleAuthChanged);
      if (bannerContainer) bannerContainer.innerHTML = "";
    },
  };
}

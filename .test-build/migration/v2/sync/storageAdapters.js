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
exports.SupabaseFirstStorageAdapter = exports.SupabaseStorageAdapter = exports.LocalStorageAdapter = void 0;
exports.getWorkspaceBackups = getWorkspaceBackups;
exports.createWorkspaceBackup = createWorkspaceBackup;
exports.createDefaultStorageAdapter = createDefaultStorageAdapter;
const storageLocal_js_1 = require("../../data/storageLocal.js");
const appState_1 = require("../state/appState");
const BACKUP_KEY = "v2_workspace_backups_v1";
const MAX_BACKUPS = 20;
function nowIso() {
    return new Date().toISOString();
}
function randomId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function hasErrorName(error, names) {
    return Boolean(error instanceof Error && names.includes(error.name));
}
function isConflictError(error) {
    return hasErrorName(error, ["ConflictError"]);
}
function isFallbackError(error) {
    return (hasErrorName(error, ["AuthRequiredError", "ConfigurationError", "SupabaseTimeoutError"])
        || (error instanceof Error && /auth|workspace|supabase/i.test(error.message))
        || (error instanceof Error && /network|offline|fetch|timeout|failed to fetch/i.test(error.message)));
}
async function loadRemoteStateApi() {
    const mod = await Promise.resolve().then(() => __importStar(require("../../storage/remoteState.js")));
    return {
        fetchRemoteState: mod.fetchRemoteState,
        pushRemoteState: mod.pushRemoteState,
    };
}
function readBackups() {
    try {
        const raw = localStorage.getItem(BACKUP_KEY);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function writeBackups(entries) {
    try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(entries.slice(0, MAX_BACKUPS)));
    }
    catch {
        // no-op
    }
}
function getWorkspaceBackups() {
    return readBackups();
}
function createWorkspaceBackup(source, state) {
    const backup = {
        id: randomId("backup"),
        createdAt: nowIso(),
        source,
        state: (0, appState_1.ensureAppStateV2)(state),
    };
    const entries = [backup, ...readBackups()];
    writeBackups(entries);
    return backup.id;
}
class LocalStorageAdapter {
    async load() {
        return (0, appState_1.ensureAppStateV2)((0, storageLocal_js_1.loadState)());
    }
    async save(next, meta) {
        (0, storageLocal_js_1.commitState)(next, { source: meta.source || "v2:local-save" });
    }
}
exports.LocalStorageAdapter = LocalStorageAdapter;
class SupabaseStorageAdapter {
    constructor(options) {
        this.lastRev = null;
        this.remoteApiLoader = options?.remoteApiLoader || loadRemoteStateApi;
    }
    async load() {
        const remoteApi = await this.remoteApiLoader();
        const remote = await remoteApi.fetchRemoteState();
        if (remote?.exists && remote.data) {
            this.lastRev = remote.rev || null;
            return (0, appState_1.ensureAppStateV2)(remote.data);
        }
        this.lastRev = null;
        return (0, appState_1.ensureAppStateV2)((0, storageLocal_js_1.loadState)());
    }
    async save(next, meta) {
        const payload = (0, appState_1.ensureAppStateV2)(next);
        const remoteApi = await this.remoteApiLoader();
        try {
            const result = await remoteApi.pushRemoteState({
                ifMatchRev: this.lastRev,
                updatedBy: meta.source || "v2:supabase-save",
                data: payload,
            });
            this.lastRev = result.rev || null;
        }
        catch (error) {
            if (isConflictError(error)) {
                const latest = await remoteApi.fetchRemoteState();
                this.lastRev = latest?.rev || null;
            }
            throw error;
        }
    }
}
exports.SupabaseStorageAdapter = SupabaseStorageAdapter;
class SupabaseFirstStorageAdapter {
    constructor(options) {
        this.local = options?.local || new LocalStorageAdapter();
        this.remote = options?.remote || new SupabaseStorageAdapter();
    }
    async load() {
        try {
            return await this.remote.load();
        }
        catch (error) {
            if (isFallbackError(error)) {
                return this.local.load();
            }
            throw error;
        }
    }
    async save(next, meta) {
        try {
            await this.remote.save(next, meta);
            await this.local.save(next, { source: `${meta.source}:cache` });
            return;
        }
        catch (error) {
            if (!isFallbackError(error)) {
                throw error;
            }
        }
        await this.local.save(next, { source: `${meta.source}:fallback` });
    }
}
exports.SupabaseFirstStorageAdapter = SupabaseFirstStorageAdapter;
function createDefaultStorageAdapter() {
    return new SupabaseFirstStorageAdapter();
}

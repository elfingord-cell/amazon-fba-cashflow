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
exports.resolveDryRunApplication = resolveDryRunApplication;
exports.applyDryRunBundle = applyDryRunBundle;
const deepEqual_js_1 = require("../../utils/deepEqual.js");
const appState_1 = require("../state/appState");
function nowIso() {
    return new Date().toISOString();
}
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function stableEntityKey(entry, fields, fallback) {
    for (const field of fields) {
        const value = entry[field];
        if (value == null)
            continue;
        const normalized = String(value).trim();
        if (normalized)
            return `${field}:${normalized.toLowerCase()}`;
    }
    return `fallback:${fallback}`;
}
function mergeArrayExistingWins(currentValue, incomingValue, keyFields, section, issues) {
    const current = Array.isArray(currentValue) ? currentValue : [];
    const incoming = Array.isArray(incomingValue) ? incomingValue : [];
    const out = [...current];
    const indexByKey = new Map();
    out.forEach((entry, idx) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            return;
        const key = stableEntityKey(entry, keyFields, `${section}:${idx}`);
        indexByKey.set(key, idx);
    });
    incoming.forEach((entry, idx) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return;
        }
        const key = stableEntityKey(entry, keyFields, `${section}:incoming:${idx}`);
        const existingIndex = indexByKey.get(key);
        if (existingIndex == null) {
            out.push(entry);
            indexByKey.set(key, out.length - 1);
            return;
        }
        const existing = out[existingIndex];
        if (!(0, deepEqual_js_1.deepEqual)(existing, entry)) {
            issues.push({
                code: "MERGE_CONFLICT_EXISTING_WINS",
                severity: "warning",
                entityType: section,
                entityId: key,
                message: `Konflikt in '${section}' fuer ${key}. Bestehender Datensatz wurde beibehalten.`,
            });
        }
    });
    return out;
}
function mergeObjectExistingWins(currentValue, incomingValue) {
    if (Array.isArray(currentValue) || Array.isArray(incomingValue)) {
        return currentValue ?? incomingValue;
    }
    const currentObj = asObject(currentValue);
    const incomingObj = asObject(incomingValue);
    const out = { ...incomingObj, ...currentObj };
    Object.keys(out).forEach((key) => {
        const currentChild = currentObj[key];
        const incomingChild = incomingObj[key];
        if (currentChild && incomingChild && typeof currentChild === "object" && typeof incomingChild === "object") {
            if (!Array.isArray(currentChild) && !Array.isArray(incomingChild)) {
                out[key] = mergeObjectExistingWins(currentChild, incomingChild);
            }
        }
    });
    return out;
}
function mergeUpsert(currentState, incomingState) {
    const issues = [];
    const next = (0, appState_1.ensureAppStateV2)({ ...incomingState, ...currentState });
    const arraySections = [
        { section: "products", keys: ["sku", "id"] },
        { section: "suppliers", keys: ["id", "name"] },
        { section: "productCategories", keys: ["id", "name"] },
        { section: "pos", keys: ["id", "poNo", "poNumber"] },
        { section: "fos", keys: ["id", "foNo"] },
        { section: "payments", keys: ["id", "paymentInternalId"] },
        { section: "fixcosts", keys: ["id", "name"] },
        { section: "incomings", keys: ["month", "id"] },
        { section: "extras", keys: ["id", "date", "label"] },
        { section: "dividends", keys: ["id", "date"] },
    ];
    arraySections.forEach(({ section, keys }) => {
        next[section] = mergeArrayExistingWins(currentState[section], incomingState[section], keys, String(section), issues);
    });
    next.settings = mergeObjectExistingWins(currentState.settings, incomingState.settings);
    next.forecast = mergeObjectExistingWins(currentState.forecast, incomingState.forecast);
    next.inventory = mergeObjectExistingWins(currentState.inventory, incomingState.inventory);
    next.fixcostOverrides = mergeObjectExistingWins(currentState.fixcostOverrides, incomingState.fixcostOverrides);
    next.monthlyActuals = mergeObjectExistingWins(currentState.monthlyActuals, incomingState.monthlyActuals);
    next.legacyMeta = (0, appState_1.ensureAppStateV2)(currentState).legacyMeta;
    next.schemaVersion = 2;
    return { next, issues };
}
function withApplyMetadata(state, mode, sourceVersion) {
    const next = (0, appState_1.ensureAppStateV2)(state);
    next.legacyMeta.importHistory = [
        {
            id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            appliedAt: nowIso(),
            mode,
            sourceVersion,
        },
        ...(next.legacyMeta.importHistory || []),
    ].slice(0, 30);
    return next;
}
function extendReport(baseReport, mergeIssues) {
    if (!mergeIssues.length)
        return baseReport;
    return {
        ...baseReport,
        issues: [...baseReport.issues, ...mergeIssues],
    };
}
function resolveDryRunApplication(bundle, mode, currentState) {
    if (mode === "replace_workspace") {
        return {
            nextState: withApplyMetadata(bundle.mappedState, mode, bundle.report.sourceVersion),
            report: bundle.report,
        };
    }
    const merged = mergeUpsert((0, appState_1.ensureAppStateV2)(currentState), (0, appState_1.ensureAppStateV2)(bundle.mappedState));
    return {
        nextState: withApplyMetadata(merged.next, mode, bundle.report.sourceVersion),
        report: extendReport(bundle.report, merged.issues),
    };
}
async function createWorkspaceBackupLazy(source, state) {
    const storageAdapters = await Promise.resolve().then(() => __importStar(require("../sync/storageAdapters")));
    return storageAdapters.createWorkspaceBackup(source, state);
}
async function applyDryRunBundle(bundle, mode, adapter, options) {
    if (!bundle.report.canApply) {
        throw new Error("Dry-Run report is not applyable.");
    }
    const current = await adapter.load();
    const createBackup = options?.createBackup || createWorkspaceBackupLazy;
    const backupId = await createBackup("v2:migration:pre-apply", (0, appState_1.ensureAppStateV2)(current));
    const resolved = resolveDryRunApplication(bundle, mode, (0, appState_1.ensureAppStateV2)(current));
    await adapter.save(resolved.nextState, { source: `v2:migration:${mode}` });
    return {
        mode,
        backupId,
        report: resolved.report,
        appliedAt: nowIso(),
    };
}

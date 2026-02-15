import { deepEqual } from "../../utils/deepEqual.js";
import { ensureAppStateV2 } from "../state/appState";
import type { AppStateV2, ImportMode } from "../state/types";
import type { StorageAdapter } from "../sync/types";
import type { DryRunBundle, ImportApplyResult, ImportDryRunReport, ImportIssue } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableEntityKey(entry: Record<string, unknown>, fields: string[], fallback: string): string {
  for (const field of fields) {
    const value = entry[field];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return `${field}:${normalized.toLowerCase()}`;
  }
  return `fallback:${fallback}`;
}

function mergeArrayExistingWins(
  currentValue: unknown,
  incomingValue: unknown,
  keyFields: string[],
  section: string,
  issues: ImportIssue[],
): unknown[] {
  const current = Array.isArray(currentValue) ? currentValue : [];
  const incoming = Array.isArray(incomingValue) ? incomingValue : [];

  const out: unknown[] = [...current];
  const indexByKey = new Map<string, number>();

  out.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const key = stableEntityKey(entry as Record<string, unknown>, keyFields, `${section}:${idx}`);
    indexByKey.set(key, idx);
  });

  incoming.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const key = stableEntityKey(entry as Record<string, unknown>, keyFields, `${section}:incoming:${idx}`);
    const existingIndex = indexByKey.get(key);
    if (existingIndex == null) {
      out.push(entry);
      indexByKey.set(key, out.length - 1);
      return;
    }
    const existing = out[existingIndex];
    if (!deepEqual(existing, entry)) {
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

function mergeObjectExistingWins(currentValue: unknown, incomingValue: unknown): unknown {
  if (Array.isArray(currentValue) || Array.isArray(incomingValue)) {
    return currentValue ?? incomingValue;
  }

  const currentObj = asObject(currentValue);
  const incomingObj = asObject(incomingValue);
  const out: Record<string, unknown> = { ...incomingObj, ...currentObj };

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

function mergeUpsert(
  currentState: AppStateV2,
  incomingState: AppStateV2,
): { next: AppStateV2; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const next = ensureAppStateV2({ ...incomingState, ...currentState });

  const arraySections: Array<{ section: keyof AppStateV2; keys: string[] }> = [
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
    next[section] = mergeArrayExistingWins(currentState[section], incomingState[section], keys, String(section), issues) as never;
  });

  next.settings = mergeObjectExistingWins(currentState.settings, incomingState.settings) as Record<string, unknown>;
  next.forecast = mergeObjectExistingWins(currentState.forecast, incomingState.forecast) as Record<string, unknown>;
  next.inventory = mergeObjectExistingWins(currentState.inventory, incomingState.inventory) as Record<string, unknown>;
  next.fixcostOverrides = mergeObjectExistingWins(currentState.fixcostOverrides, incomingState.fixcostOverrides) as Record<string, unknown>;
  next.monthlyActuals = mergeObjectExistingWins(currentState.monthlyActuals, incomingState.monthlyActuals) as Record<string, unknown>;

  const legacyMetaCurrent = ensureAppStateV2(currentState).legacyMeta;
  const legacyMetaIncoming = ensureAppStateV2(incomingState).legacyMeta;
  next.legacyMeta = {
    importHistory: legacyMetaCurrent.importHistory || [],
    unmapped: {
      ...asObject(legacyMetaIncoming.unmapped),
      ...asObject(legacyMetaCurrent.unmapped),
    },
  };
  next.schemaVersion = 2;

  return { next, issues };
}

function withApplyMetadata(state: AppStateV2, mode: ImportMode, sourceVersion: string): AppStateV2 {
  const next = ensureAppStateV2(state);
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

function extendReport(baseReport: ImportDryRunReport, mergeIssues: ImportIssue[]): ImportDryRunReport {
  if (!mergeIssues.length) return baseReport;
  return {
    ...baseReport,
    issues: [...baseReport.issues, ...mergeIssues],
  };
}

export function resolveDryRunApplication(
  bundle: DryRunBundle,
  mode: ImportMode,
  currentState: AppStateV2,
): { nextState: AppStateV2; report: ImportDryRunReport } {
  if (mode === "replace_workspace") {
    return {
      nextState: withApplyMetadata(bundle.mappedState, mode, bundle.report.sourceVersion),
      report: bundle.report,
    };
  }

  const merged = mergeUpsert(ensureAppStateV2(currentState), ensureAppStateV2(bundle.mappedState));
  return {
    nextState: withApplyMetadata(merged.next, mode, bundle.report.sourceVersion),
    report: extendReport(bundle.report, merged.issues),
  };
}

async function createWorkspaceBackupLazy(source: string, state: AppStateV2): Promise<string> {
  const storageAdapters = await import("../sync/storageAdapters");
  return storageAdapters.createWorkspaceBackup(source, state);
}

export async function applyDryRunBundle(
  bundle: DryRunBundle,
  mode: ImportMode,
  adapter: StorageAdapter,
  options?: {
    createBackup?: (source: string, state: AppStateV2) => Promise<string> | string;
  },
): Promise<ImportApplyResult> {
  if (!bundle.report.canApply) {
    throw new Error("Dry-Run report is not applyable.");
  }

  const current = await adapter.load();
  const createBackup = options?.createBackup || createWorkspaceBackupLazy;
  const backupId = await createBackup("v2:migration:pre-apply", ensureAppStateV2(current));

  const resolved = resolveDryRunApplication(bundle, mode, ensureAppStateV2(current));

  await adapter.save(resolved.nextState, { source: `v2:migration:${mode}` });

  return {
    mode,
    backupId,
    report: resolved.report,
    appliedAt: nowIso(),
  };
}

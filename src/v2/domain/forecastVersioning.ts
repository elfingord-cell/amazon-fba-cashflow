import { parseDeNumber } from "../../lib/dataHealth.js";
import { normalizeMonthKey } from "./months";

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export interface ForecastVersionStats {
  rowCount: number;
  skuCount: number;
  monthCount: number;
}

export interface ForecastVersionRecord {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  sourceLabel: string | null;
  importMode: "merge" | "overwrite" | null;
  onlyActiveSkus: boolean;
  forecastImport: Record<string, unknown>;
  stats: ForecastVersionStats;
}

interface ForecastVersionInput {
  id?: string | null;
  name?: string | null;
  note?: string | null;
  createdAt?: string | null;
  sourceLabel?: string | null;
  importMode?: "merge" | "overwrite" | string | null;
  onlyActiveSkus?: boolean;
  forecastImport?: Record<string, unknown>;
  stats?: ForecastVersionStats | null;
}

export interface ForecastVersioningState {
  forecastImport?: Record<string, unknown>;
  versions?: unknown;
  activeVersionId?: string | null;
  lastImpactSummary?: unknown;
  lastImportAt?: string | null;
  importSource?: string | null;
  foConflictDecisionsByVersion?: Record<string, unknown>;
}

function randomId(prefix = "fv"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asLocalTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function toIsoDateSafe(value: unknown): string | null {
  if (!value) return null;
  const candidate = new Date(String(value));
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate.toISOString();
}

function normalizeImportMode(value: unknown): "merge" | "overwrite" | null {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (text === "merge" || text === "overwrite") return text;
  return null;
}

function normalizeSkuKey(value: unknown): string {
  return String(value || "").trim();
}

function normalizeForecastEntry(input: unknown): { units: number | null; revenueEur: number | null; profitEur: number | null } | null {
  if (input == null) return null;
  const source = (input && typeof input === "object")
    ? (input as Record<string, unknown>)
    : { units: input };
  const units = parseDeNumber(source.units ?? source.qty ?? source.quantity);
  const revenue = parseDeNumber(source.revenueEur);
  const profit = parseDeNumber(source.profitEur);
  return {
    units: Number.isFinite(units) ? Number(units) : null,
    revenueEur: Number.isFinite(revenue) ? Number(revenue) : null,
    profitEur: Number.isFinite(profit) ? Number(profit) : null,
  };
}

export function normalizeForecastImportMap(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  Object.entries(input as Record<string, unknown>).forEach(([skuRaw, monthMapRaw]) => {
    const sku = normalizeSkuKey(skuRaw);
    if (!sku || !monthMapRaw || typeof monthMapRaw !== "object") return;
    const monthMapOut: Record<string, unknown> = {};
    Object.entries(monthMapRaw as Record<string, unknown>).forEach(([monthRaw, rowRaw]) => {
      const month = normalizeMonthKey(monthRaw);
      if (!month || !MONTH_KEY_PATTERN.test(month)) return;
      const normalizedEntry = normalizeForecastEntry(rowRaw);
      if (!normalizedEntry) return;
      monthMapOut[month] = normalizedEntry;
    });
    if (Object.keys(monthMapOut).length) {
      out[sku] = monthMapOut;
    }
  });
  return out;
}

export function computeForecastVersionStats(forecastImport: Record<string, unknown>): ForecastVersionStats {
  const skuKeys = Object.keys(forecastImport || {});
  const monthSet = new Set<string>();
  let rowCount = 0;
  skuKeys.forEach((sku) => {
    const monthMap = forecastImport?.[sku];
    if (!monthMap || typeof monthMap !== "object") return;
    Object.keys(monthMap as Record<string, unknown>).forEach((month) => {
      const normalizedMonth = normalizeMonthKey(month);
      if (!normalizedMonth) return;
      monthSet.add(normalizedMonth);
      rowCount += 1;
    });
  });
  return {
    rowCount,
    skuCount: skuKeys.length,
    monthCount: monthSet.size,
  };
}

export function formatForecastVersionTimestamp(value: Date = new Date()): string {
  return asLocalTimestamp(value);
}

export function buildForecastVersionName(value: Date = new Date()): string {
  return `VentoryOne Forecast – ${formatForecastVersionTimestamp(value)}`;
}

function normalizeVersionRecord(input: ForecastVersionInput): ForecastVersionRecord {
  const createdAt = toIsoDateSafe(input.createdAt) || nowIso();
  const forecastImport = normalizeForecastImportMap(input.forecastImport || {});
  const stats = input.stats && typeof input.stats === "object"
    ? {
      rowCount: Math.max(0, Math.round(Number(input.stats.rowCount || 0))),
      skuCount: Math.max(0, Math.round(Number(input.stats.skuCount || 0))),
      monthCount: Math.max(0, Math.round(Number(input.stats.monthCount || 0))),
    }
    : computeForecastVersionStats(forecastImport);
  return {
    id: String(input.id || randomId("fv")),
    name: String(input.name || buildForecastVersionName(new Date(createdAt))).trim() || buildForecastVersionName(new Date(createdAt)),
    note: input.note == null ? null : String(input.note),
    createdAt,
    sourceLabel: input.sourceLabel == null ? null : String(input.sourceLabel),
    importMode: normalizeImportMode(input.importMode),
    onlyActiveSkus: input.onlyActiveSkus === true,
    forecastImport,
    stats,
  };
}

function normalizeVersionList(input: unknown): ForecastVersionRecord[] {
  if (!Array.isArray(input)) return [];
  const list = input
    .map((entry) => (entry && typeof entry === "object" ? normalizeVersionRecord(entry as ForecastVersionInput) : null))
    .filter(Boolean) as ForecastVersionRecord[];
  list.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  return list;
}

export function createForecastVersion(input: ForecastVersionInput): ForecastVersionRecord {
  return normalizeVersionRecord(input);
}

export function getActiveForecastVersion(state: ForecastVersioningState): ForecastVersionRecord | null {
  const versions = normalizeVersionList(state?.versions);
  if (!versions.length) return null;
  const activeVersionId = String(state?.activeVersionId || "").trim();
  if (activeVersionId) {
    const match = versions.find((entry) => entry.id === activeVersionId) || null;
    if (match) return match;
  }
  return versions[versions.length - 1] || null;
}

export function getActiveForecastLabel(state: ForecastVersioningState): string {
  const active = getActiveForecastVersion(state);
  return active?.name || "Keine Baseline";
}

export function ensureForecastVersioningContainers(state: ForecastVersioningState): ForecastVersioningState {
  if (!state || typeof state !== "object") return state;
  const target = state as ForecastVersioningState & Record<string, unknown>;
  if (!target.forecastImport || typeof target.forecastImport !== "object") {
    target.forecastImport = {};
  }
  if (!target.foConflictDecisionsByVersion || typeof target.foConflictDecisionsByVersion !== "object") {
    target.foConflictDecisionsByVersion = {};
  }
  if (target.lastImpactSummary === undefined) {
    target.lastImpactSummary = null;
  }

  const normalizedVersions = normalizeVersionList(target.versions);
  if (!normalizedVersions.length) {
    const legacyImport = normalizeForecastImportMap(target.forecastImport || {});
    if (Object.keys(legacyImport).length) {
      const legacyCreatedAt = toIsoDateSafe(target.lastImportAt) || nowIso();
      const legacyVersion = createForecastVersion({
        id: target.activeVersionId ? String(target.activeVersionId) : null,
        name: buildForecastVersionName(new Date(legacyCreatedAt)),
        note: null,
        createdAt: legacyCreatedAt,
        sourceLabel: target.importSource ? String(target.importSource) : "legacy",
        importMode: "overwrite",
        onlyActiveSkus: false,
        forecastImport: legacyImport,
      });
      target.versions = [legacyVersion];
      target.activeVersionId = legacyVersion.id;
      target.forecastImport = structuredClone(legacyVersion.forecastImport);
      return target;
    }
  } else {
    target.versions = normalizedVersions;
    const activeVersionId = String(target.activeVersionId || "").trim();
    let activeVersion = normalizedVersions.find((entry) => entry.id === activeVersionId) || null;
    if (!activeVersion) {
      activeVersion = normalizedVersions[normalizedVersions.length - 1] || null;
    }
    if (activeVersion) {
      target.activeVersionId = activeVersion.id;
      target.forecastImport = structuredClone(activeVersion.forecastImport);
    }
  }

  if (!target.activeVersionId) target.activeVersionId = null;
  return target;
}

export function appendForecastVersion(state: ForecastVersioningState, input: ForecastVersionInput): ForecastVersionRecord {
  ensureForecastVersioningContainers(state);
  const target = state as ForecastVersioningState & Record<string, unknown>;
  const versions = normalizeVersionList(target.versions);
  const nextVersion = createForecastVersion(input);
  versions.push(nextVersion);
  versions.sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  target.versions = versions;
  return nextVersion;
}

export function renameForecastVersion(
  state: ForecastVersioningState,
  versionId: string,
  update: { name?: string | null; note?: string | null },
): boolean {
  ensureForecastVersioningContainers(state);
  const target = state as ForecastVersioningState & Record<string, unknown>;
  const versions = normalizeVersionList(target.versions);
  const index = versions.findIndex((entry) => entry.id === versionId);
  if (index < 0) return false;
  const current = versions[index];
  const nextName = update.name == null ? current.name : String(update.name).trim();
  versions[index] = {
    ...current,
    name: nextName || current.name,
    note: update.note == null ? current.note : String(update.note),
  };
  target.versions = versions;
  return true;
}

export function deleteForecastVersion(state: ForecastVersioningState, versionId: string): { ok: boolean; reason?: string } {
  ensureForecastVersioningContainers(state);
  const target = state as ForecastVersioningState & Record<string, unknown>;
  const activeVersionId = String(target.activeVersionId || "");
  if (activeVersionId && activeVersionId === versionId) {
    return { ok: false, reason: "ACTIVE_VERSION" };
  }
  const versions = normalizeVersionList(target.versions);
  const next = versions.filter((entry) => entry.id !== versionId);
  if (next.length === versions.length) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  target.versions = next;
  if (target.foConflictDecisionsByVersion && typeof target.foConflictDecisionsByVersion === "object") {
    const decisions = { ...(target.foConflictDecisionsByVersion as Record<string, unknown>) };
    delete decisions[versionId];
    target.foConflictDecisionsByVersion = decisions;
  }
  if (target.lastImpactSummary && typeof target.lastImpactSummary === "object") {
    const summary = target.lastImpactSummary as Record<string, unknown>;
    const fromVersionId = String(summary.fromVersionId || "");
    const toVersionId = String(summary.toVersionId || "");
    if (fromVersionId === versionId || toVersionId === versionId) {
      target.lastImpactSummary = null;
    }
  }
  return { ok: true };
}

export function setActiveVersion(
  state: ForecastVersioningState,
  versionId: string,
  options: { touchImportMeta?: boolean } = {},
): { ok: boolean; reason?: string; version?: ForecastVersionRecord } {
  ensureForecastVersioningContainers(state);
  const target = state as ForecastVersioningState & Record<string, unknown>;
  const versions = normalizeVersionList(target.versions);
  const match = versions.find((entry) => entry.id === versionId);
  if (!match) return { ok: false, reason: "NOT_FOUND" };
  target.activeVersionId = match.id;
  target.forecastImport = structuredClone(match.forecastImport || {});
  if (options.touchImportMeta !== false) {
    target.lastImportAt = match.createdAt;
    target.importSource = match.sourceLabel || target.importSource || "CSV";
  }
  return {
    ok: true,
    version: match,
  };
}

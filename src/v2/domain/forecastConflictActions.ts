import { computeForecastImpact, type FoImpactConflictRow, type ForecastImpactResult } from "./forecastImpact";
import {
  ensureForecastVersioningContainers,
  getActiveForecastVersion,
  type ForecastVersionRecord,
} from "./forecastVersioning";
import { currentMonthKey } from "./months";
import { computeFoSchedule, nowIso, randomId, suggestNextFoNumber } from "./orderUtils";
import type { AppStateV2 } from "../state/types";

interface ForecastImpactSummaryLike {
  fromVersionId: string | null;
  toVersionId: string | null;
}

export interface ForecastConflictActionInput extends Pick<
  FoImpactConflictRow,
  | "foId"
  | "recommendedUnits"
  | "recommendedArrivalDate"
  | "requiredArrivalDate"
  | "currentUnits"
  | "currentTargetDeliveryDate"
  | "currentEtaDate"
> {
  suggestedUnits?: number | null;
}

function normalizeImpactSummary(value: unknown): ForecastImpactSummaryLike | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const toVersionId = raw.toVersionId == null ? null : String(raw.toVersionId || "").trim() || null;
  if (!toVersionId) return null;
  return {
    fromVersionId: raw.fromVersionId == null ? null : String(raw.fromVersionId || "").trim() || null,
    toVersionId,
  };
}

function ensureForecastContainers(state: Record<string, unknown>): void {
  if (!state.forecast || typeof state.forecast !== "object") {
    state.forecast = {
      items: [],
      settings: { useForecast: false },
      forecastImport: {},
      forecastManual: {},
      versions: [],
      activeVersionId: null,
      lastImpactSummary: null,
      foConflictDecisionsByVersion: {},
      lastImportAt: null,
      importSource: null,
    };
  }
  const forecast = state.forecast as Record<string, unknown>;
  if (!forecast.settings || typeof forecast.settings !== "object") {
    forecast.settings = { useForecast: false };
  }
  if (!forecast.forecastManual || typeof forecast.forecastManual !== "object") {
    forecast.forecastManual = {};
  }
  ensureForecastVersioningContainers(forecast);
}

function isConflictIgnored(decisionsForVersion: Record<string, unknown>, foId: string): boolean {
  const entry = decisionsForVersion?.[foId];
  if (!entry || typeof entry !== "object") return false;
  return (entry as Record<string, unknown>).ignored === true;
}

function countOpenConflictsFromImpact(
  impact: ForecastImpactResult,
  decisionsForVersion: Record<string, unknown>,
): number {
  return impact.foConflicts.filter((entry) => !isConflictIgnored(decisionsForVersion, entry.foId)).length;
}

function clearConflictIgnoreDecision(
  forecastTarget: Record<string, unknown>,
  versionId: string | null,
  foId: string,
): void {
  if (!versionId) return;
  const all = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
    ? { ...(forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>) }
    : {};
  const map = { ...(all[versionId] || {}) };
  delete map[foId];
  all[versionId] = map;
  forecastTarget.foConflictDecisionsByVersion = all;
}

function recomputeStoredImpactSummary(stateObject: Record<string, unknown>, forecastTarget: Record<string, unknown>): void {
  const summary = normalizeImpactSummary(forecastTarget.lastImpactSummary);
  if (!summary) return;
  const versions = (Array.isArray(forecastTarget.versions) ? forecastTarget.versions : []) as ForecastVersionRecord[];
  const toVersion = versions.find((entry) => entry.id === summary.toVersionId) || null;
  if (!toVersion) {
    forecastTarget.lastImpactSummary = null;
    return;
  }
  const fromVersion = summary.fromVersionId
    ? (versions.find((entry) => entry.id === summary.fromVersionId) || null)
    : null;
  const impact = computeForecastImpact({
    state: stateObject,
    fromVersion,
    toVersion,
    nowMonth: currentMonthKey(),
  });
  const decisionsAll = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
    ? forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>
    : {};
  const decisionsForVersion = (decisionsAll[toVersion.id] && typeof decisionsAll[toVersion.id] === "object")
    ? decisionsAll[toVersion.id]
    : {};
  forecastTarget.lastImpactSummary = {
    ...impact.summary,
    foConflictsOpen: countOpenConflictsFromImpact(impact, decisionsForVersion),
  };
}

function resolveTargetDate(existing: Record<string, unknown>, conflict: ForecastConflictActionInput): string | null {
  return conflict.recommendedArrivalDate
    || conflict.requiredArrivalDate
    || String(existing.targetDeliveryDate || "") || null;
}

function resolveRecommendedUnits(existing: Record<string, unknown>, conflict: ForecastConflictActionInput): number {
  const nextUnits = conflict.recommendedUnits ?? conflict.suggestedUnits;
  if (Number.isFinite(Number(nextUnits))) {
    return Math.max(0, Math.round(Number(nextUnits)));
  }
  return Math.max(0, Math.round(Number(existing.units || 0)));
}

export function formatForecastConflictType(type: string): string {
  if (type === "units_too_small") return "Menge zu klein";
  if (type === "units_too_large") return "Menge zu groß";
  if (type === "timing_too_late") return "Timing zu spät";
  if (type === "timing_too_early") return "Timing zu früh";
  return type;
}

export function buildForecastConflictSummary(conflictTypes: string[] | null | undefined): string {
  const labels = Array.isArray(conflictTypes) ? conflictTypes.map((entry) => formatForecastConflictType(String(entry || ""))) : [];
  return labels.filter(Boolean).join(", ");
}

export function updateForecastConflictFo(
  state: AppStateV2,
  conflict: ForecastConflictActionInput,
): { foId: string } {
  const nextState = state as unknown as Record<string, unknown>;
  ensureForecastContainers(nextState);
  const forecastTarget = nextState.forecast as Record<string, unknown>;
  const active = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
  const fos = Array.isArray(state.fos) ? [...state.fos] as Record<string, unknown>[] : [];
  const index = fos.findIndex((entry) => String(entry.id || "") === conflict.foId);
  if (index < 0) {
    throw new Error("FO nicht gefunden.");
  }
  const existing = fos[index];
  const targetDate = resolveTargetDate(existing, conflict);
  const schedule = computeFoSchedule({
    targetDeliveryDate: targetDate,
    productionLeadTimeDays: existing.productionLeadTimeDays,
    logisticsLeadTimeDays: existing.logisticsLeadTimeDays,
    bufferDays: existing.bufferDays,
  });
  const changedAt = nowIso();
  fos[index] = {
    ...existing,
    units: resolveRecommendedUnits(existing, conflict),
    targetDeliveryDate: targetDate,
    orderDate: schedule.orderDate,
    productionEndDate: schedule.productionEndDate,
    etdDate: schedule.etdDate,
    etaDate: schedule.etaDate,
    deliveryDate: schedule.deliveryDate,
    forecastBasisVersionId: active?.id || null,
    forecastBasisVersionName: active?.name || null,
    forecastBasisSetAt: changedAt,
    forecastConflictState: "reviewed_updated",
    supersededByFoId: null,
    updatedAt: changedAt,
  };
  state.fos = fos;
  clearConflictIgnoreDecision(forecastTarget, active?.id || null, conflict.foId);
  recomputeStoredImpactSummary(nextState, forecastTarget);
  return { foId: conflict.foId };
}

export function createForecastConflictDraft(
  state: AppStateV2,
  conflict: ForecastConflictActionInput,
): { foId: string; draftId: string } {
  const nextState = state as unknown as Record<string, unknown>;
  ensureForecastContainers(nextState);
  const forecastTarget = nextState.forecast as Record<string, unknown>;
  const active = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
  const fos = Array.isArray(state.fos) ? [...state.fos] as Record<string, unknown>[] : [];
  const index = fos.findIndex((entry) => String(entry.id || "") === conflict.foId);
  if (index < 0) {
    throw new Error("FO nicht gefunden.");
  }
  const existing = fos[index];
  const targetDate = resolveTargetDate(existing, conflict);
  const schedule = computeFoSchedule({
    targetDeliveryDate: targetDate,
    productionLeadTimeDays: existing.productionLeadTimeDays,
    logisticsLeadTimeDays: existing.logisticsLeadTimeDays,
    bufferDays: existing.bufferDays,
  });
  const changedAt = nowIso();
  const draftId = randomId("fo");
  const foNumberSuggestion = suggestNextFoNumber(fos, changedAt);
  const draftFo = {
    ...existing,
    id: draftId,
    foNo: foNumberSuggestion.foNo,
    foNumber: foNumberSuggestion.foNumber,
    status: "DRAFT",
    units: resolveRecommendedUnits(existing, conflict),
    targetDeliveryDate: targetDate,
    orderDate: schedule.orderDate,
    productionEndDate: schedule.productionEndDate,
    etdDate: schedule.etdDate,
    etaDate: schedule.etaDate,
    deliveryDate: schedule.deliveryDate,
    convertedPoId: null,
    convertedPoNo: null,
    forecastBasisVersionId: active?.id || null,
    forecastBasisVersionName: active?.name || null,
    forecastBasisSetAt: changedAt,
    forecastConflictState: "review_needed",
    supersedesFoId: String(existing.id || conflict.foId),
    supersededByFoId: null,
    createdAt: changedAt,
    updatedAt: changedAt,
  };

  fos[index] = {
    ...existing,
    forecastConflictState: "superseded",
    supersededByFoId: draftId,
    updatedAt: changedAt,
  };
  fos.push(draftFo);
  state.fos = fos;
  clearConflictIgnoreDecision(forecastTarget, active?.id || null, conflict.foId);
  recomputeStoredImpactSummary(nextState, forecastTarget);
  return { foId: conflict.foId, draftId };
}

export function ignoreForecastConflict(
  state: AppStateV2,
  conflict: Pick<ForecastConflictActionInput, "foId">,
): { foId: string } {
  const nextState = state as unknown as Record<string, unknown>;
  ensureForecastContainers(nextState);
  const forecastTarget = nextState.forecast as Record<string, unknown>;
  const active = getActiveForecastVersion(forecastTarget as Record<string, unknown>);
  if (!active?.id) {
    throw new Error("Aktive Forecast-Version fehlt.");
  }
  const all = (forecastTarget.foConflictDecisionsByVersion && typeof forecastTarget.foConflictDecisionsByVersion === "object")
    ? { ...(forecastTarget.foConflictDecisionsByVersion as Record<string, Record<string, unknown>>) }
    : {};
  const currentDecisionMap = { ...(all[active.id] || {}) };
  currentDecisionMap[conflict.foId] = {
    ignored: true,
    ignoredAt: nowIso(),
    reason: "manual_ignore",
  };
  all[active.id] = currentDecisionMap;
  forecastTarget.foConflictDecisionsByVersion = all;
  recomputeStoredImpactSummary(nextState, forecastTarget);
  return { foId: conflict.foId };
}

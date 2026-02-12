import { createEmptyAppStateV2, ensureAppStateV2 } from "../state/appState";
import type { AppStateV2 } from "../state/types";
import type { DryRunBundle, ImportDryRunReport, ImportIssue, ImportSectionStats } from "./types";
import { detectSourceVersion } from "./detect";
import {
  deepClone,
  deterministicId,
  isObject,
  normalizeMonthInEntry,
  normalizeMonthKey,
  parseDeNumberOrNull,
  pushIssue,
} from "./utils";

function emptyStats(section: string): ImportSectionStats {
  return {
    section,
    total: 0,
    mapped: 0,
    normalized: 0,
    skipped: 0,
    blocked: 0,
  };
}

function normalizeMonthKeyObject(
  input: Record<string, unknown>,
  section: string,
  stats: ImportSectionStats,
  issues: ImportIssue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(input).forEach(([key, value]) => {
    const normalized = normalizeMonthKey(key);
    const targetKey = normalized || key;
    if (normalized && normalized !== key) {
      stats.normalized += 1;
      pushIssue(issues, {
        code: "MONTH_KEY_NORMALIZED",
        severity: "info",
        entityType: section,
        entityId: key,
        message: `Monatsschluessel '${key}' wurde auf '${targetKey}' normalisiert.`,
      });
    }
    out[targetKey] = value;
  });
  return out;
}

function normalizeCommonRecord(value: Record<string, unknown>): { value: Record<string, unknown>; normalized: number } {
  let normalized = 0;
  let next: Record<string, unknown> = { ...value };

  const monthResult = normalizeMonthInEntry(next);
  if (monthResult.normalized) {
    normalized += 1;
    next = monthResult.value;
  }

  const numericFields = [
    "units",
    "amazonUnits",
    "threePLUnits",
    "projectionMonths",
    "safetyDays",
    "realRevenueEUR",
    "realPayoutRatePct",
    "realClosingBalanceEUR",
  ];

  numericFields.forEach((field) => {
    if (!(field in next)) return;
    const parsed = parseDeNumberOrNull(next[field]);
    if (parsed == null) return;
    if (next[field] !== parsed) {
      normalized += 1;
      next[field] = parsed;
    }
  });

  return { value: next, normalized };
}

function mapArraySection(
  target: AppStateV2,
  source: Record<string, unknown>,
  sectionName: string,
  options: {
    idPrefix: string;
    idField: string;
    requiredField?: string;
    seedFields?: string[];
  },
  stats: ImportSectionStats,
  issues: ImportIssue[],
): void {
  const raw = source[sectionName];
  const list = Array.isArray(raw) ? raw : [];
  stats.total = list.length;
  const mapped: Record<string, unknown>[] = [];

  list.forEach((entry, index) => {
    if (!isObject(entry)) {
      stats.skipped += 1;
      pushIssue(issues, {
        code: "ENTRY_NOT_OBJECT",
        severity: "warning",
        entityType: sectionName,
        entityId: String(index),
        message: "Datensatz ist kein Objekt und wurde uebersprungen.",
      });
      return;
    }

    if (options.requiredField && !entry[options.requiredField]) {
      stats.blocked += 1;
      stats.skipped += 1;
      pushIssue(issues, {
        code: "MISSING_REQUIRED_FIELD",
        severity: "error",
        entityType: sectionName,
        entityId: String(index),
        message: `Pflichtfeld '${options.requiredField}' fehlt. Datensatz wurde uebersprungen.`,
      });
      return;
    }

    const normalized = normalizeCommonRecord(entry);
    let next = normalized.value;
    stats.normalized += normalized.normalized;

    const idField = options.idField;
    if (!next[idField]) {
      const seedValues = (options.seedFields || [idField, "id", "sku", "poNo", "name"]).map((field) => next[field] as string | number | undefined);
      next = {
        ...next,
        [idField]: deterministicId(options.idPrefix, [sectionName, index, ...seedValues]),
      };
      stats.normalized += 1;
      pushIssue(issues, {
        code: "ID_GENERATED",
        severity: "info",
        entityType: sectionName,
        entityId: String(index),
        message: `Fehlende ID in '${sectionName}' wurde deterministisch erzeugt.`,
      });
    }

    mapped.push(next);
  });

  target[sectionName] = mapped;
  stats.mapped = mapped.length;
}

function mapForecast(
  target: AppStateV2,
  source: Record<string, unknown>,
  stats: ImportSectionStats,
  issues: ImportIssue[],
): void {
  const forecast = isObject(source.forecast) ? deepClone(source.forecast) : {};
  stats.total = Object.keys(forecast).length;

  if (!isObject(forecast.forecastManual)) forecast.forecastManual = {};
  if (!isObject(forecast.forecastImport)) forecast.forecastImport = {};

  const manual = forecast.forecastManual as Record<string, unknown>;
  Object.entries(manual).forEach(([sku, monthMap]) => {
    if (!isObject(monthMap)) return;
    manual[sku] = normalizeMonthKeyObject(monthMap, "forecastManual", stats, issues);
  });

  const imported = forecast.forecastImport as Record<string, unknown>;
  Object.entries(imported).forEach(([sku, monthMap]) => {
    if (!isObject(monthMap)) return;
    imported[sku] = normalizeMonthKeyObject(monthMap, "forecastImport", stats, issues);
  });

  target.forecast = forecast;
  stats.mapped = 1;
}

function mapInventory(
  target: AppStateV2,
  source: Record<string, unknown>,
  stats: ImportSectionStats,
  issues: ImportIssue[],
): void {
  const inventory = isObject(source.inventory) ? deepClone(source.inventory) : { snapshots: [], settings: {} };
  const snapshotList = Array.isArray(inventory.snapshots) ? (inventory.snapshots as unknown[]) : [];
  inventory.snapshots = snapshotList;
  stats.total = snapshotList.length;

  const snapshots = snapshotList
    .map((snapshot, index) => {
      if (!isObject(snapshot)) {
        stats.skipped += 1;
        return null;
      }
      const copy = deepClone(snapshot);
      const normalizedMonth = normalizeMonthKey(copy.month);
      if (normalizedMonth && normalizedMonth !== copy.month) {
        copy.month = normalizedMonth;
        stats.normalized += 1;
      }
      if (!Array.isArray(copy.items)) copy.items = [];
      copy.items = (copy.items as unknown[])
        .map((item) => {
          if (!isObject(item)) return null;
          const normalizedItem = normalizeCommonRecord(item);
          stats.normalized += normalizedItem.normalized;
          if (!normalizedItem.value.sku) {
            stats.blocked += 1;
            stats.skipped += 1;
            pushIssue(issues, {
              code: "MISSING_REQUIRED_FIELD",
              severity: "error",
              entityType: "inventory.snapshots.items",
              entityId: String(index),
              message: "Snapshot-Item ohne SKU wurde uebersprungen.",
            });
            return null;
          }
          return normalizedItem.value;
        })
        .filter(Boolean);
      return copy;
    })
    .filter(Boolean);

  inventory.snapshots = snapshots;
  target.inventory = inventory;
  stats.mapped = snapshots.length;
}

function mapMonthlyActuals(
  target: AppStateV2,
  source: Record<string, unknown>,
  stats: ImportSectionStats,
  issues: ImportIssue[],
): void {
  const monthlyActuals = isObject(source.monthlyActuals) ? source.monthlyActuals : {};
  stats.total = Object.keys(monthlyActuals).length;
  const normalized = normalizeMonthKeyObject(monthlyActuals, "monthlyActuals", stats, issues);
  Object.entries(normalized).forEach(([month, value]) => {
    if (!isObject(value)) return;
    const next = { ...value };
    ["realRevenueEUR", "realPayoutRatePct", "realClosingBalanceEUR"].forEach((field) => {
      const parsed = parseDeNumberOrNull(next[field]);
      if (parsed == null) return;
      if (next[field] !== parsed) {
        next[field] = parsed;
        stats.normalized += 1;
      }
    });
    normalized[month] = next;
  });
  target.monthlyActuals = normalized;
  stats.mapped = Object.keys(normalized).length;
}

function mapFixcostOverrides(
  target: AppStateV2,
  source: Record<string, unknown>,
  stats: ImportSectionStats,
  issues: ImportIssue[],
): void {
  const overrides = isObject(source.fixcostOverrides) ? source.fixcostOverrides : {};
  stats.total = Object.keys(overrides).length;
  const next: Record<string, unknown> = {};

  Object.entries(overrides).forEach(([fixId, monthMap]) => {
    if (!isObject(monthMap)) {
      stats.skipped += 1;
      return;
    }
    next[fixId] = normalizeMonthKeyObject(monthMap, "fixcostOverrides", stats, issues);
    stats.mapped += 1;
  });

  target.fixcostOverrides = next;
}

function mapSettings(
  target: AppStateV2,
  source: Record<string, unknown>,
  stats: ImportSectionStats,
): void {
  stats.total = 1;
  const settings = isObject(source.settings) ? deepClone(source.settings) : {};
  target.settings = settings;
  stats.mapped = 1;
}

function mapUnknownRootKeys(
  target: AppStateV2,
  source: Record<string, unknown>,
  issues: ImportIssue[],
): void {
  const known = new Set(Object.keys(createEmptyAppStateV2()));
  Object.entries(source).forEach(([key, value]) => {
    if (known.has(key)) return;
    target.legacyMeta.unmapped[key] = value;
    pushIssue(issues, {
      code: "UNMAPPED_ROOT_FIELD",
      severity: "info",
      entityType: "root",
      entityId: key,
      message: `Unbekanntes Root-Feld '${key}' wurde unter legacyMeta.unmapped abgelegt.`,
    });
  });
}

export function runLegacyDryRun(sourceState: unknown): DryRunBundle {
  const sourceVersion = detectSourceVersion(sourceState);
  const target = createEmptyAppStateV2();
  const issues: ImportIssue[] = [];
  const stats: ImportSectionStats[] = [
    emptyStats("settings"),
    emptyStats("productCategories"),
    emptyStats("suppliers"),
    emptyStats("products"),
    emptyStats("pos"),
    emptyStats("fos"),
    emptyStats("payments"),
    emptyStats("incomings"),
    emptyStats("extras"),
    emptyStats("dividends"),
    emptyStats("fixcosts"),
    emptyStats("fixcostOverrides"),
    emptyStats("monthlyActuals"),
    emptyStats("inventory"),
    emptyStats("forecast"),
  ];

  if (!isObject(sourceState)) {
    issues.push({
      code: "INVALID_JSON_ROOT",
      severity: "error",
      entityType: "root",
      message: "JSON-Root ist kein Objekt.",
    });
    return {
      sourceState,
      mappedState: target,
      report: {
        sourceVersion,
        targetVersion: "v2",
        sections: stats,
        issues,
        canApply: false,
      },
    };
  }

  const source = deepClone(sourceState);

  mapSettings(target, source, stats[0]);
  mapArraySection(target, source, "productCategories", {
    idPrefix: "cat",
    idField: "id",
    requiredField: "name",
    seedFields: ["name"],
  }, stats[1], issues);
  mapArraySection(target, source, "suppliers", {
    idPrefix: "sup",
    idField: "id",
    seedFields: ["name", "company_name"],
  }, stats[2], issues);
  mapArraySection(target, source, "products", {
    idPrefix: "prod",
    idField: "id",
    requiredField: "sku",
    seedFields: ["sku", "alias"],
  }, stats[3], issues);
  mapArraySection(target, source, "pos", {
    idPrefix: "po",
    idField: "id",
    seedFields: ["id", "poNo", "poNumber", "sku"],
  }, stats[4], issues);
  mapArraySection(target, source, "fos", {
    idPrefix: "fo",
    idField: "id",
    seedFields: ["id", "foNo", "sku"],
  }, stats[5], issues);
  mapArraySection(target, source, "payments", {
    idPrefix: "pay",
    idField: "id",
    seedFields: ["id", "paymentInternalId", "paidDate"],
  }, stats[6], issues);
  mapArraySection(target, source, "incomings", {
    idPrefix: "inc",
    idField: "id",
    seedFields: ["month", "revenueEur"],
  }, stats[7], issues);
  mapArraySection(target, source, "extras", {
    idPrefix: "extra",
    idField: "id",
    seedFields: ["date", "label", "amountEur"],
  }, stats[8], issues);
  mapArraySection(target, source, "dividends", {
    idPrefix: "div",
    idField: "id",
    seedFields: ["date", "amountEur"],
  }, stats[9], issues);
  mapArraySection(target, source, "fixcosts", {
    idPrefix: "fix",
    idField: "id",
    seedFields: ["name", "category", "startMonth"],
  }, stats[10], issues);
  mapFixcostOverrides(target, source, stats[11], issues);
  mapMonthlyActuals(target, source, stats[12], issues);
  mapInventory(target, source, stats[13], issues);
  mapForecast(target, source, stats[14], issues);
  mapUnknownRootKeys(target, source, issues);

  const hasFatalErrors = issues.some((issue) => issue.severity === "error" && issue.entityType === "root");
  const mappedTotal = stats.reduce((sum, entry) => sum + entry.mapped, 0);

  const report: ImportDryRunReport = {
    sourceVersion,
    targetVersion: "v2",
    sections: stats,
    issues,
    canApply: !hasFatalErrors && mappedTotal > 0,
  };

  return {
    sourceState,
    mappedState: ensureAppStateV2(target),
    report,
  };
}

export function runLegacyDryRunFromJson(jsonText: string): DryRunBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const fallback = createEmptyAppStateV2();
    return {
      sourceState: null,
      mappedState: fallback,
      report: {
        sourceVersion: "unknown",
        targetVersion: "v2",
        sections: [],
        issues: [
          {
            code: "INVALID_JSON",
            severity: "error",
            entityType: "root",
            message: "JSON konnte nicht geparst werden.",
          },
        ],
        canApply: false,
      },
    };
  }
  return runLegacyDryRun(parsed);
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLegacyDryRun = runLegacyDryRun;
exports.runLegacyDryRunFromJson = runLegacyDryRunFromJson;
const appState_1 = require("../state/appState");
const detect_1 = require("./detect");
const utils_1 = require("./utils");
function emptyStats(section) {
    return {
        section,
        total: 0,
        mapped: 0,
        normalized: 0,
        skipped: 0,
        blocked: 0,
    };
}
function normalizeMonthKeyObject(input, section, stats, issues) {
    const out = {};
    Object.entries(input).forEach(([key, value]) => {
        const normalized = (0, utils_1.normalizeMonthKey)(key);
        const targetKey = normalized || key;
        if (normalized && normalized !== key) {
            stats.normalized += 1;
            (0, utils_1.pushIssue)(issues, {
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
function normalizeCommonRecord(value) {
    let normalized = 0;
    let next = { ...value };
    const monthResult = (0, utils_1.normalizeMonthInEntry)(next);
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
        if (!(field in next))
            return;
        const parsed = (0, utils_1.parseDeNumberOrNull)(next[field]);
        if (parsed == null)
            return;
        if (next[field] !== parsed) {
            normalized += 1;
            next[field] = parsed;
        }
    });
    return { value: next, normalized };
}
function mapArraySection(target, source, sectionName, options, stats, issues) {
    const raw = source[sectionName];
    const list = Array.isArray(raw) ? raw : [];
    stats.total = list.length;
    const mapped = [];
    list.forEach((entry, index) => {
        if (!(0, utils_1.isObject)(entry)) {
            stats.skipped += 1;
            (0, utils_1.pushIssue)(issues, {
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
            (0, utils_1.pushIssue)(issues, {
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
            const seedValues = (options.seedFields || [idField, "id", "sku", "poNo", "name"]).map((field) => next[field]);
            next = {
                ...next,
                [idField]: (0, utils_1.deterministicId)(options.idPrefix, [sectionName, index, ...seedValues]),
            };
            stats.normalized += 1;
            (0, utils_1.pushIssue)(issues, {
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
function mapForecast(target, source, stats, issues) {
    const forecast = (0, utils_1.isObject)(source.forecast) ? (0, utils_1.deepClone)(source.forecast) : {};
    stats.total = Object.keys(forecast).length;
    if (!(0, utils_1.isObject)(forecast.forecastManual))
        forecast.forecastManual = {};
    if (!(0, utils_1.isObject)(forecast.forecastImport))
        forecast.forecastImport = {};
    const manual = forecast.forecastManual;
    Object.entries(manual).forEach(([sku, monthMap]) => {
        if (!(0, utils_1.isObject)(monthMap))
            return;
        manual[sku] = normalizeMonthKeyObject(monthMap, "forecastManual", stats, issues);
    });
    const imported = forecast.forecastImport;
    Object.entries(imported).forEach(([sku, monthMap]) => {
        if (!(0, utils_1.isObject)(monthMap))
            return;
        imported[sku] = normalizeMonthKeyObject(monthMap, "forecastImport", stats, issues);
    });
    target.forecast = forecast;
    stats.mapped = 1;
}
function mapInventory(target, source, stats, issues) {
    const inventory = (0, utils_1.isObject)(source.inventory) ? (0, utils_1.deepClone)(source.inventory) : { snapshots: [], settings: {} };
    const snapshotList = Array.isArray(inventory.snapshots) ? inventory.snapshots : [];
    inventory.snapshots = snapshotList;
    stats.total = snapshotList.length;
    const snapshots = snapshotList
        .map((snapshot, index) => {
        if (!(0, utils_1.isObject)(snapshot)) {
            stats.skipped += 1;
            return null;
        }
        const copy = (0, utils_1.deepClone)(snapshot);
        const normalizedMonth = (0, utils_1.normalizeMonthKey)(copy.month);
        if (normalizedMonth && normalizedMonth !== copy.month) {
            copy.month = normalizedMonth;
            stats.normalized += 1;
        }
        if (!Array.isArray(copy.items))
            copy.items = [];
        copy.items = copy.items
            .map((item) => {
            if (!(0, utils_1.isObject)(item))
                return null;
            const normalizedItem = normalizeCommonRecord(item);
            stats.normalized += normalizedItem.normalized;
            if (!normalizedItem.value.sku) {
                stats.blocked += 1;
                stats.skipped += 1;
                (0, utils_1.pushIssue)(issues, {
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
function mapMonthlyActuals(target, source, stats, issues) {
    const monthlyActuals = (0, utils_1.isObject)(source.monthlyActuals) ? source.monthlyActuals : {};
    stats.total = Object.keys(monthlyActuals).length;
    const normalized = normalizeMonthKeyObject(monthlyActuals, "monthlyActuals", stats, issues);
    Object.entries(normalized).forEach(([month, value]) => {
        if (!(0, utils_1.isObject)(value))
            return;
        const next = { ...value };
        ["realRevenueEUR", "realPayoutRatePct", "realClosingBalanceEUR"].forEach((field) => {
            const parsed = (0, utils_1.parseDeNumberOrNull)(next[field]);
            if (parsed == null)
                return;
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
function mapFixcostOverrides(target, source, stats, issues) {
    const overrides = (0, utils_1.isObject)(source.fixcostOverrides) ? source.fixcostOverrides : {};
    stats.total = Object.keys(overrides).length;
    const next = {};
    Object.entries(overrides).forEach(([fixId, monthMap]) => {
        if (!(0, utils_1.isObject)(monthMap)) {
            stats.skipped += 1;
            return;
        }
        next[fixId] = normalizeMonthKeyObject(monthMap, "fixcostOverrides", stats, issues);
        stats.mapped += 1;
    });
    target.fixcostOverrides = next;
}
function mapSettings(target, source, stats) {
    stats.total = 1;
    const settings = (0, utils_1.isObject)(source.settings) ? (0, utils_1.deepClone)(source.settings) : {};
    target.settings = settings;
    stats.mapped = 1;
}
function mapUnknownRootKeys(target, source, issues) {
    const known = new Set(Object.keys((0, appState_1.createEmptyAppStateV2)()));
    Object.entries(source).forEach(([key, value]) => {
        if (known.has(key))
            return;
        target.legacyMeta.unmapped[key] = value;
        (0, utils_1.pushIssue)(issues, {
            code: "UNMAPPED_ROOT_FIELD",
            severity: "info",
            entityType: "root",
            entityId: key,
            message: `Unbekanntes Root-Feld '${key}' wurde unter legacyMeta.unmapped abgelegt.`,
        });
    });
}
function runLegacyDryRun(sourceState) {
    const sourceVersion = (0, detect_1.detectSourceVersion)(sourceState);
    const target = (0, appState_1.createEmptyAppStateV2)();
    const issues = [];
    const stats = [
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
    if (!(0, utils_1.isObject)(sourceState)) {
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
    const source = (0, utils_1.deepClone)(sourceState);
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
    const report = {
        sourceVersion,
        targetVersion: "v2",
        sections: stats,
        issues,
        canApply: !hasFatalErrors && mappedTotal > 0,
    };
    return {
        sourceState,
        mappedState: (0, appState_1.ensureAppStateV2)(target),
        report,
    };
}
function runLegacyDryRunFromJson(jsonText) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        const fallback = (0, appState_1.createEmptyAppStateV2)();
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

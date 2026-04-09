"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_V2_BUCKET_SCOPE = exports.DASHBOARD_TAX_LABELS = void 0;
exports.alignDashboardCashInToMirror = alignDashboardCashInToMirror;
exports.resolveDashboardEntryBucket = resolveDashboardEntryBucket;
exports.isDashboardEntryInBucketScope = isDashboardEntryInBucketScope;
exports.isDashboardPhantomFoEntry = isDashboardPhantomFoEntry;
exports.aggregateDashboardMonthEntries = aggregateDashboardMonthEntries;
exports.applyTaxInstancesToBreakdown = applyTaxInstancesToBreakdown;
exports.buildDashboardTaxMatrixGroup = buildDashboardTaxMatrixGroup;
exports.applyDashboardBucketScopeToBreakdown = applyDashboardBucketScopeToBreakdown;
const portfolioBuckets_js_1 = require("../../domain/portfolioBuckets.js");
const taxPlanner_js_1 = require("../../domain/taxPlanner.js");
const closingBalanceSeries_1 = require("./closingBalanceSeries");
exports.DASHBOARD_TAX_LABELS = taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.reduce((acc, entry) => {
    acc[entry.key] = entry.label;
    return acc;
}, {});
exports.DEFAULT_V2_BUCKET_SCOPE = [portfolioBuckets_js_1.PORTFOLIO_BUCKET.CORE, portfolioBuckets_js_1.PORTFOLIO_BUCKET.PLAN];
function roundCurrencyAmount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return 0;
    return Math.round(numeric * 100) / 100;
}
function isDashboardSalesPayoutEntry(entry) {
    if (!entry || typeof entry !== "object")
        return false;
    return String(entry.kind || "").toLowerCase() === "sales-payout";
}
function resolveDashboardSalesEntryWeight(entry) {
    const directAmount = Math.abs(Number(entry.amount || 0));
    if (Number.isFinite(directAmount) && directAmount > 0)
        return directAmount;
    const meta = (entry.meta && typeof entry.meta === "object") ? entry.meta : {};
    const cashIn = (meta.cashIn && typeof meta.cashIn === "object") ? meta.cashIn : {};
    const componentRevenueRaw = Math.abs(Number(cashIn.componentRevenueRaw || 0));
    if (Number.isFinite(componentRevenueRaw) && componentRevenueRaw > 0)
        return componentRevenueRaw;
    const revenue = Math.abs(Number(cashIn.revenue || 0));
    if (Number.isFinite(revenue) && revenue > 0)
        return revenue;
    return 0;
}
function allocateMirroredSalesEntries(salesEntries, totalPayout) {
    if (!Array.isArray(salesEntries) || !salesEntries.length)
        return [];
    const target = roundCurrencyAmount(Math.max(0, totalPayout));
    if (!(target > 0))
        return [];
    const weights = salesEntries.map((entry) => resolveDashboardSalesEntryWeight(entry));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    let remaining = target;
    return salesEntries.map((entry, index) => {
        const isLast = index === salesEntries.length - 1;
        const weight = weights[index];
        const allocated = isLast
            ? remaining
            : roundCurrencyAmount(weightSum > 0
                ? (target * weight) / weightSum
                : (target / salesEntries.length));
        remaining = roundCurrencyAmount(remaining - allocated);
        return {
            ...entry,
            direction: "in",
            amount: roundCurrencyAmount(Math.max(0, allocated)),
        };
    }).filter((entry) => Number(entry.amount || 0) > 0);
}
function alignDashboardCashInToMirror(rows, cashInByMonth) {
    if (!Array.isArray(rows) || !rows.length)
        return [];
    const mirror = (cashInByMonth && typeof cashInByMonth === "object") ? cashInByMonth : {};
    return rows.map((row) => {
        const month = String(row.month || "").trim();
        const mirroredPayout = Number(mirror[month]);
        if (!Number.isFinite(mirroredPayout)) {
            return {
                ...row,
                entries: Array.isArray(row.entries) ? row.entries.slice() : [],
            };
        }
        const entries = Array.isArray(row.entries) ? row.entries : [];
        const salesEntries = entries.filter((entry) => isDashboardSalesPayoutEntry(entry));
        const mirroredSalesEntries = allocateMirroredSalesEntries(salesEntries, mirroredPayout);
        if (!salesEntries.length && mirroredPayout > 0) {
            return {
                ...row,
                entries: [
                    {
                        id: `dashboard-cashin-mirror-${month}`,
                        direction: "in",
                        amount: roundCurrencyAmount(mirroredPayout),
                        label: "Amazon Payout",
                        kind: "sales-payout",
                        group: "Sales × Payout",
                        source: "sales",
                        portfolioBucket: portfolioBuckets_js_1.PORTFOLIO_BUCKET.CORE,
                        meta: {
                            cashIn: {
                                payoutAmount: roundCurrencyAmount(mirroredPayout),
                                source: "dashboard_cashin_mirror",
                            },
                            portfolioBucket: portfolioBuckets_js_1.PORTFOLIO_BUCKET.CORE,
                        },
                    },
                    ...entries,
                ],
            };
        }
        let salesIndex = 0;
        return {
            ...row,
            entries: entries.flatMap((entry) => {
                if (!isDashboardSalesPayoutEntry(entry))
                    return [entry];
                const replacement = mirroredSalesEntries[salesIndex] || null;
                salesIndex += 1;
                return replacement ? [replacement] : [];
            }),
        };
    });
}
function createEmptyTaxBreakdown() {
    return taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.reduce((acc, entry) => {
        acc[entry.key] = 0;
        return acc;
    }, {});
}
function resolveDashboardTaxType(entry) {
    const meta = (entry.meta && typeof entry.meta === "object") ? entry.meta : {};
    const sourceType = String(meta.taxType || meta.taxKey || "").trim();
    return sourceType || null;
}
function resolveDashboardEntryBucket(entry) {
    const direct = typeof entry.portfolioBucket === "string" ? entry.portfolioBucket : null;
    if (direct)
        return direct;
    const meta = (entry.meta && typeof entry.meta === "object") ? entry.meta : {};
    return typeof meta.portfolioBucket === "string" ? String(meta.portfolioBucket) : null;
}
function isDashboardEntryInBucketScope(entry, bucketScope) {
    const bucket = resolveDashboardEntryBucket(entry);
    if (!bucket)
        return true;
    if (!portfolioBuckets_js_1.PORTFOLIO_BUCKET_VALUES.includes(bucket))
        return true;
    return bucketScope.has(bucket);
}
function isDashboardPhantomFoEntry(entryRaw, provisionalFoIds) {
    const source = String(entryRaw.source || "").toLowerCase();
    if (source !== "fo")
        return false;
    const sourceId = String(entryRaw.sourceId || "").trim();
    const meta = (entryRaw.meta && typeof entryRaw.meta === "object")
        ? entryRaw.meta
        : {};
    return entryRaw.provisional === true
        || meta.phantom === true
        || (sourceId ? provisionalFoIds?.has(sourceId) === true : false);
}
function aggregateDashboardMonthEntries(entries, options) {
    const bucketScope = options?.bucketScope;
    const includePhantomFo = options?.includePhantomFo !== false;
    const provisionalFoIds = options?.provisionalFoIds;
    const filteredEntries = (Array.isArray(entries) ? entries : [])
        .filter((entryRaw) => !!entryRaw && typeof entryRaw === "object")
        .filter((entryRaw) => !bucketScope || isDashboardEntryInBucketScope(entryRaw, bucketScope))
        .filter((entryRaw) => includePhantomFo || !isDashboardPhantomFoEntry(entryRaw, provisionalFoIds));
    const inflow = {
        amazon: 0,
        amazonCore: 0,
        amazonPlanned: 0,
        amazonNew: 0,
        other: 0,
        total: 0,
    };
    const outflow = {
        fixcost: 0,
        tax: 0,
        taxByType: createEmptyTaxBreakdown(),
        po: 0,
        fo: 0,
        phantomFo: 0,
        other: 0,
        total: 0,
    };
    filteredEntries.forEach((entry) => {
        const direction = String(entry.direction || "").toLowerCase();
        const amount = Math.abs(Number(entry.amount || 0));
        if (!Number.isFinite(amount) || amount <= 0)
            return;
        const source = String(entry.source || "").toLowerCase();
        const group = String(entry.group || "").toLowerCase();
        if (source === "taxes" || group === "steuern") {
            const signedTaxAmount = direction === "in" ? -amount : amount;
            outflow.tax += signedTaxAmount;
            const taxType = resolveDashboardTaxType(entry);
            if (taxType && Object.prototype.hasOwnProperty.call(outflow.taxByType, taxType)) {
                outflow.taxByType[taxType] += signedTaxAmount;
            }
            outflow.total += signedTaxAmount;
            return;
        }
        if (direction === "in") {
            const kind = String(entry.kind || "").toLowerCase();
            const isAmazon = source === "sales" || source === "sales-plan" || kind === "sales-payout";
            if (isAmazon) {
                const bucket = resolveDashboardEntryBucket(entry);
                if (bucket === portfolioBuckets_js_1.PORTFOLIO_BUCKET.PLAN) {
                    inflow.amazonPlanned += amount;
                }
                else if (bucket === portfolioBuckets_js_1.PORTFOLIO_BUCKET.IDEAS) {
                    inflow.amazonNew += amount;
                }
                else {
                    inflow.amazonCore += amount;
                }
                inflow.amazon += amount;
            }
            else {
                inflow.other += amount;
            }
            inflow.total += amount;
            return;
        }
        if (direction !== "out")
            return;
        if (source === "po") {
            outflow.po += amount;
        }
        else if (source === "fo") {
            const isPhantom = isDashboardPhantomFoEntry(entry, provisionalFoIds);
            if (isPhantom)
                outflow.phantomFo += amount;
            else
                outflow.fo += amount;
        }
        else if (source === "fixcosts" || group === "fixkosten") {
            outflow.fixcost += amount;
        }
        else {
            outflow.other += amount;
        }
        outflow.total += amount;
    });
    return {
        entries: filteredEntries,
        inflow,
        outflow,
        totals: {
            cashIn: inflow.total,
            cashOut: outflow.total,
            net: inflow.total - outflow.total,
        },
    };
}
function applyTaxInstancesToBreakdown(rows, state) {
    if (!Array.isArray(rows) || !rows.length)
        return [];
    const months = rows.map((row) => String(row.month || "").trim()).filter(Boolean);
    const taxSummaryByMonth = (0, taxPlanner_js_1.buildMonthlyTaxSummary)((0, taxPlanner_js_1.expandMonthlyTaxCashflowInstances)(state, { months }), months, taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG);
    return rows.map((row) => {
        const summary = taxSummaryByMonth.get(String(row.month || "").trim());
        if (!summary || !Array.isArray(summary.instances) || !summary.instances.length) {
            return {
                ...row,
                entries: Array.isArray(row.entries) ? row.entries.slice() : [],
            };
        }
        const taxEntries = summary.instances.map((instance) => ({
            id: String(instance.id || `tax-${row.month}`),
            direction: String(instance.direction || "out") === "in" ? "in" : "out",
            amount: Math.abs(Number(instance.amount || 0)),
            label: String(instance.label || "Steuern"),
            date: String(instance.dueDateIso || ""),
            kind: "tax_payment",
            group: "Steuern",
            source: "taxes",
            meta: {
                taxType: instance.taxType,
                taxLabel: instance.label,
                sourceSection: instance.sourceSection,
                overrideActive: instance.overrideActive === true,
                note: instance.note || "",
                sourceMonth: instance.sourceMonth || null,
            },
            tooltip: instance.note ? String(instance.note) : undefined,
        }));
        return {
            ...row,
            entries: [...(Array.isArray(row.entries) ? row.entries : []), ...taxEntries],
        };
    });
}
function buildDashboardTaxMatrixGroup(input) {
    const values = {};
    const childValues = taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.reduce((acc, entry) => {
        acc[entry.key] = {};
        return acc;
    }, {});
    input.months.forEach((month) => {
        values[month] = 0;
        taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.forEach((entry) => {
            childValues[entry.key][month] = 0;
        });
    });
    (Array.isArray(input.breakdown) ? input.breakdown : []).forEach((row) => {
        const month = String(row.month || "").trim();
        if (!month || !Object.prototype.hasOwnProperty.call(values, month))
            return;
        const aggregation = aggregateDashboardMonthEntries(Array.isArray(row.entries) ? row.entries : [], {
            bucketScope: input.bucketScope,
            provisionalFoIds: input.provisionalFoIds,
        });
        values[month] = -aggregation.outflow.tax;
        taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.forEach((entry) => {
            childValues[entry.key][month] = -(aggregation.outflow.taxByType[entry.key] || 0);
        });
    });
    return {
        key: "outflows-tax",
        label: "Steuern",
        values,
        children: taxPlanner_js_1.DASHBOARD_TAX_TYPE_CONFIG.map((entry) => ({
            key: `outflows-tax-${entry.key}`,
            label: exports.DASHBOARD_TAX_LABELS[entry.key],
            values: childValues[entry.key],
        })),
    };
}
function applyDashboardBucketScopeToBreakdown(rows, bucketScope, options) {
    if (!rows.length)
        return [];
    const scopedRows = rows.map((row) => {
        const monthAggregation = aggregateDashboardMonthEntries(Array.isArray(row.entries) ? row.entries : [], {
            bucketScope,
            includePhantomFo: options?.includePhantomFo,
            provisionalFoIds: options?.provisionalFoIds,
        });
        return {
            ...row,
            inflow: monthAggregation.totals.cashIn,
            outflow: monthAggregation.totals.cashOut,
            net: monthAggregation.totals.net,
            entries: monthAggregation.entries,
        };
    });
    const firstOpening = Number(rows[0]?.opening || 0);
    const closingSeries = (0, closingBalanceSeries_1.buildHybridClosingBalanceSeries)({
        rows: scopedRows.map((row) => ({
            month: row.month,
            net: row.net,
            actualClosing: row.actualClosing,
        })),
        initialOpening: firstOpening,
    });
    return scopedRows.map((row, index) => {
        const derived = closingSeries[index];
        return {
            ...row,
            opening: Number(derived?.opening ?? row.opening ?? 0),
            plannedClosing: Number(derived?.plannedClosing ?? row.plannedClosing ?? row.closing ?? 0),
            closing: Number(derived?.closing ?? row.closing ?? 0),
            hasActualClosing: derived?.lockedActual === true,
        };
    });
}

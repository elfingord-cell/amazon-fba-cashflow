"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VAT_TAX_TYPE_KEY = exports.VAT_TAX_LABEL = exports.OSS_TAX_TYPE_KEY = exports.OSS_TAX_LABEL = exports.OSS_PROXY_RATE = exports.DEFAULT_OSS_CONFIG = exports.DEFAULT_TAX_MASTER = exports.TAX_TYPE_CONFIG = exports.DASHBOARD_TAX_TYPE_CONFIG = void 0;
exports.createDefaultTaxesState = createDefaultTaxesState;
exports.normalizeTaxesState = normalizeTaxesState;
exports.getTaxTypeLabel = getTaxTypeLabel;
exports.expandTaxInstances = expandTaxInstances;
exports.expandVatTaxInstances = expandVatTaxInstances;
exports.buildOssQuarterPreview = buildOssQuarterPreview;
exports.expandOssTaxInstances = expandOssTaxInstances;
exports.expandMonthlyTaxCashflowInstances = expandMonthlyTaxCashflowInstances;
exports.buildMonthlyTaxSummary = buildMonthlyTaxSummary;
const vatPreview_js_1 = require("./vatPreview.js");
const TAX_TYPE_CONFIG = [
    { key: "koerperschaftsteuer", label: "Körperschaftsteuer" },
    { key: "gewerbesteuer", label: "Gewerbesteuer" },
];
exports.TAX_TYPE_CONFIG = TAX_TYPE_CONFIG;
const TAX_TYPE_KEYS = new Set(TAX_TYPE_CONFIG.map((entry) => entry.key));
const VAT_TAX_TYPE_KEY = "umsatzsteuer_de";
exports.VAT_TAX_TYPE_KEY = VAT_TAX_TYPE_KEY;
const VAT_TAX_LABEL = "Umsatzsteuer DE";
exports.VAT_TAX_LABEL = VAT_TAX_LABEL;
const OSS_TAX_TYPE_KEY = "oss";
exports.OSS_TAX_TYPE_KEY = OSS_TAX_TYPE_KEY;
const OSS_TAX_LABEL = "OSS";
exports.OSS_TAX_LABEL = OSS_TAX_LABEL;
const OSS_PROXY_RATE = 0.203;
exports.OSS_PROXY_RATE = OSS_PROXY_RATE;
const OSS_PAYMENT_DAY = 10;
const DEFAULT_OSS_CONFIG = Object.freeze({
    active: false,
    deSharePct: "100",
});
exports.DEFAULT_OSS_CONFIG = DEFAULT_OSS_CONFIG;
const DASHBOARD_TAX_TYPE_CONFIG = [
    { key: VAT_TAX_TYPE_KEY, label: VAT_TAX_LABEL },
    { key: OSS_TAX_TYPE_KEY, label: OSS_TAX_LABEL },
    ...TAX_TYPE_CONFIG,
];
exports.DASHBOARD_TAX_TYPE_CONFIG = DASHBOARD_TAX_TYPE_CONFIG;
const DASHBOARD_TAX_TYPE_KEYS = new Set(DASHBOARD_TAX_TYPE_CONFIG.map((entry) => entry.key));
const DEFAULT_TAX_MASTER = Object.freeze({
    active: false,
    amount: "0,00",
    firstDueDate: "",
    pauseFromMonth: "",
    endMonth: "",
    note: "",
});
exports.DEFAULT_TAX_MASTER = DEFAULT_TAX_MASTER;
function parseEuro(value) {
    if (value == null)
        return 0;
    const cleaned = String(value)
        .trim()
        .replace(/€/g, "")
        .replace(/\s+/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : 0;
}
function parsePercent(value, fallback = 100) {
    const cleaned = String(value ?? fallback)
        .trim()
        .replace(/%/g, "")
        .replace(/\s+/g, "")
        .replace(",", ".");
    const number = Number(cleaned);
    if (!Number.isFinite(number))
        return fallback;
    return Math.min(100, Math.max(0, number));
}
function isoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime()))
        return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function normalizeMonth(value) {
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}$/.test(raw) ? raw : "";
}
function normalizeDate(value) {
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}
function monthIndex(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || "")))
        return null;
    const [year, month] = String(monthKey).split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month))
        return null;
    return year * 12 + (month - 1);
}
function monthRange(startMonth, horizon) {
    const startIdx = monthIndex(startMonth);
    const safeHorizon = Math.max(1, Number(horizon || 0) || 0);
    if (startIdx == null)
        return [];
    return Array.from({ length: safeHorizon }, (_entry, index) => {
        const idx = startIdx + index;
        const year = Math.floor(idx / 12);
        const month = String((idx % 12) + 1).padStart(2, "0");
        return `${year}-${month}`;
    });
}
function shiftMonth(monthKey, offset) {
    const idx = monthIndex(monthKey);
    const delta = Math.round(Number(offset || 0));
    if (idx == null || !Number.isFinite(delta))
        return "";
    const targetIdx = idx + delta;
    const year = Math.floor(targetIdx / 12);
    const month = String((targetIdx % 12) + 1).padStart(2, "0");
    return `${year}-${month}`;
}
function clampDay(year, monthZero, day) {
    const maxDay = new Date(year, monthZero + 1, 0).getDate();
    return new Date(year, monthZero, Math.min(Math.max(1, day), maxDay));
}
function dueDateForMonth(month, dayOfMonth) {
    const idx = monthIndex(month);
    if (idx == null)
        return null;
    const year = Math.floor(idx / 12);
    const monthZero = idx % 12;
    return clampDay(year, monthZero, dayOfMonth);
}
function clampDayOfMonth(value, fallback = 10) {
    const numeric = Math.round(Number(value || fallback));
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.min(31, Math.max(1, numeric));
}
function normalizeVatPaymentSettings(state) {
    const vatPreview = state?.settings?.vatPreview && typeof state.settings.vatPreview === "object"
        ? state.settings.vatPreview
        : {};
    const lagRaw = Number(vatPreview.paymentLagMonths ?? 1);
    const paymentLagMonths = Math.max(0, Math.round(Number.isFinite(lagRaw) ? lagRaw : 1));
    const paymentDayOfMonth = clampDayOfMonth(vatPreview.paymentDayOfMonth, 10);
    return {
        paymentLagMonths,
        paymentDayOfMonth,
    };
}
function buildTaxTypeTemplate(typeConfig) {
    return typeConfig.reduce((acc, entry) => {
        acc[entry.key] = 0;
        return acc;
    }, {});
}
function quarterIndexForMonth(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || "")))
        return null;
    const month = Number(String(monthKey).slice(5, 7));
    if (!Number.isFinite(month) || month < 1 || month > 12)
        return null;
    return Math.floor((month - 1) / 3);
}
function quarterKeyForMonth(monthKey) {
    const normalizedMonth = normalizeMonth(monthKey);
    const quarterIndex = quarterIndexForMonth(normalizedMonth);
    if (!normalizedMonth || quarterIndex == null)
        return "";
    return `${normalizedMonth.slice(0, 4)}-Q${quarterIndex + 1}`;
}
function parseQuarterKey(quarterKey) {
    const match = /^(\d{4})-Q([1-4])$/.exec(String(quarterKey || "").trim());
    if (!match)
        return null;
    return {
        year: Number(match[1]),
        quarter: Number(match[2]),
    };
}
function quarterLabel(quarterKey) {
    const parsed = parseQuarterKey(quarterKey);
    if (!parsed)
        return String(quarterKey || "");
    return `Q${parsed.quarter} ${parsed.year}`;
}
function sourceMonthsForQuarter(quarterKey) {
    const parsed = parseQuarterKey(quarterKey);
    if (!parsed)
        return [];
    const startMonth = (parsed.quarter - 1) * 3 + 1;
    return Array.from({ length: 3 }, (_entry, index) => {
        const month = String(startMonth + index).padStart(2, "0");
        return `${parsed.year}-${month}`;
    });
}
function paymentMonthForQuarter(quarterKey) {
    const parsed = parseQuarterKey(quarterKey);
    if (!parsed)
        return "";
    if (parsed.quarter === 4) {
        return `${parsed.year + 1}-01`;
    }
    return `${parsed.year}-${String(parsed.quarter * 3 + 1).padStart(2, "0")}`;
}
function uniqueMonths(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((entry) => normalizeMonth(entry)).filter(Boolean)));
}
function buildPreviewStateForMonths(sourceState, sourceMonths, fallbackStartMonth, fallbackHorizon) {
    const months = uniqueMonths(sourceMonths);
    if (!months.length)
        return null;
    const sortedMonths = months.slice().sort((left, right) => left.localeCompare(right));
    const minMonth = sortedMonths[0];
    const maxMonth = sortedMonths[sortedMonths.length - 1];
    const minIdx = monthIndex(minMonth);
    const maxIdx = monthIndex(maxMonth);
    const virtualState = structuredClone(sourceState);
    if (!virtualState.settings || typeof virtualState.settings !== "object") {
        virtualState.settings = {};
    }
    virtualState.settings.startMonth = minMonth || fallbackStartMonth;
    virtualState.settings.horizonMonths = minIdx != null && maxIdx != null
        ? Math.max(1, maxIdx - minIdx + 1)
        : fallbackHorizon;
    return virtualState;
}
function quarterKeysFromPaymentMonths(paymentMonths) {
    return Array.from(new Set(uniqueMonths(paymentMonths).map((paymentMonth) => {
        const idx = monthIndex(paymentMonth);
        if (idx == null)
            return "";
        return quarterKeyForMonth(shiftMonth(paymentMonth, -1));
    }).filter(Boolean)));
}
function normalizeTaxMaster(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
        active: source.active === true,
        amount: String(source.amount ?? DEFAULT_TAX_MASTER.amount),
        firstDueDate: normalizeDate(source.firstDueDate),
        pauseFromMonth: normalizeMonth(source.pauseFromMonth),
        endMonth: normalizeMonth(source.endMonth),
        note: String(source.note || ""),
    };
}
function normalizeOssConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
        active: source.active === true,
        deSharePct: String(source.deSharePct ?? DEFAULT_OSS_CONFIG.deSharePct),
    };
}
function normalizeTaxOverride(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
        active: typeof source.active === "boolean" ? source.active : undefined,
        amount: source.amount == null ? "" : String(source.amount),
        dueDate: normalizeDate(source.dueDate),
        note: String(source.note || ""),
    };
}
function normalizeOverrideMap(raw) {
    if (!raw || typeof raw !== "object")
        return {};
    return Object.entries(raw).reduce((acc, [month, value]) => {
        const normalizedMonth = normalizeMonth(month);
        if (!normalizedMonth)
            return acc;
        acc[normalizedMonth] = normalizeTaxOverride(value);
        return acc;
    }, {});
}
function createDefaultTaxesState() {
    return {
        oss: { ...DEFAULT_OSS_CONFIG },
        ertragsteuern: {
            masters: TAX_TYPE_CONFIG.reduce((acc, entry) => {
                acc[entry.key] = { ...DEFAULT_TAX_MASTER };
                return acc;
            }, {}),
            overrides: TAX_TYPE_CONFIG.reduce((acc, entry) => {
                acc[entry.key] = {};
                return acc;
            }, {}),
        },
    };
}
function normalizeTaxesState(input) {
    const source = input && typeof input === "object" ? input : {};
    const base = createDefaultTaxesState();
    base.oss = normalizeOssConfig(source.oss);
    const rawErtrag = source.ertragsteuern && typeof source.ertragsteuern === "object"
        ? source.ertragsteuern
        : {};
    const rawMasters = rawErtrag.masters && typeof rawErtrag.masters === "object"
        ? rawErtrag.masters
        : {};
    const rawOverrides = rawErtrag.overrides && typeof rawErtrag.overrides === "object"
        ? rawErtrag.overrides
        : {};
    base.ertragsteuern.masters = TAX_TYPE_CONFIG.reduce((acc, entry) => {
        acc[entry.key] = normalizeTaxMaster(rawMasters[entry.key]);
        return acc;
    }, {});
    base.ertragsteuern.overrides = TAX_TYPE_CONFIG.reduce((acc, entry) => {
        acc[entry.key] = normalizeOverrideMap(rawOverrides[entry.key]);
        return acc;
    }, {});
    return base;
}
function getTaxTypeLabel(taxType) {
    const match = DASHBOARD_TAX_TYPE_CONFIG.find((entry) => entry.key === taxType);
    return match?.label || String(taxType || "");
}
function expandTaxInstances(state, opts = {}) {
    const sourceState = state && typeof state === "object" ? state : {};
    const settings = sourceState.settings && typeof sourceState.settings === "object" ? sourceState.settings : {};
    const startMonth = normalizeMonth(opts.startMonth || settings.startMonth) || "2025-01";
    const horizon = Math.max(1, Number(opts.horizon || settings.horizonMonths || 12) || 12);
    const months = Array.isArray(opts.months) && opts.months.length
        ? opts.months.map((entry) => normalizeMonth(entry)).filter(Boolean)
        : monthRange(startMonth, horizon);
    const monthSet = new Set(months);
    const taxesState = normalizeTaxesState(sourceState.taxes);
    const results = [];
    TAX_TYPE_CONFIG.forEach((taxType) => {
        const master = taxesState.ertragsteuern.masters[taxType.key];
        if (!master?.active)
            return;
        const baseAmount = Math.abs(parseEuro(master.amount));
        const firstDueDate = normalizeDate(master.firstDueDate);
        const firstDueMonth = normalizeMonth(firstDueDate.slice(0, 7));
        const firstDueIdx = monthIndex(firstDueMonth);
        if (!baseAmount || !firstDueDate || firstDueIdx == null)
            return;
        const pauseFromIdx = master.pauseFromMonth ? monthIndex(master.pauseFromMonth) : null;
        const endIdx = master.endMonth ? monthIndex(master.endMonth) : null;
        const baseDay = Number(firstDueDate.slice(8, 10)) || 1;
        const overrideMap = taxesState.ertragsteuern.overrides[taxType.key] || {};
        months.forEach((month) => {
            if (!monthSet.has(month))
                return;
            const currentIdx = monthIndex(month);
            if (currentIdx == null || currentIdx < firstDueIdx)
                return;
            if ((currentIdx - firstDueIdx) % 3 !== 0)
                return;
            if (pauseFromIdx != null && currentIdx >= pauseFromIdx)
                return;
            if (endIdx != null && currentIdx > endIdx)
                return;
            const override = normalizeTaxOverride(overrideMap[month]);
            const effectiveActive = override.active == null ? true : override.active === true;
            if (!effectiveActive)
                return;
            const dueDate = override.dueDate || isoDate(dueDateForMonth(month, baseDay));
            const amount = override.amount && String(override.amount).trim() !== ""
                ? Math.abs(parseEuro(override.amount))
                : baseAmount;
            if (!amount || !dueDate)
                return;
            results.push({
                id: `tax-${taxType.key}-${month}`,
                month,
                amount,
                direction: "out",
                baseAmount,
                dueDateIso: dueDate,
                taxType: taxType.key,
                label: taxType.label,
                sourceSection: "ertragsteuern",
                note: override.note || master.note || "",
                override: override,
                overrideActive: override.active != null || Boolean(override.amount) || Boolean(override.dueDate) || Boolean(override.note),
            });
        });
    });
    results.sort((left, right) => {
        if (left.month === right.month) {
            if (left.dueDateIso === right.dueDateIso)
                return String(left.label || "").localeCompare(String(right.label || ""));
            return String(left.dueDateIso || "").localeCompare(String(right.dueDateIso || ""));
        }
        return String(left.month || "").localeCompare(String(right.month || ""));
    });
    return results;
}
function expandVatTaxInstances(state, opts = {}) {
    const sourceState = state && typeof state === "object" ? state : {};
    const settings = sourceState.settings && typeof sourceState.settings === "object" ? sourceState.settings : {};
    const startMonth = normalizeMonth(opts.startMonth || settings.startMonth) || "2025-01";
    const horizon = Math.max(1, Number(opts.horizon || settings.horizonMonths || 12) || 12);
    const months = Array.isArray(opts.months) && opts.months.length
        ? opts.months.map((entry) => normalizeMonth(entry)).filter(Boolean)
        : monthRange(startMonth, horizon);
    if (!months.length)
        return [];
    const monthSet = new Set(months);
    const { paymentLagMonths, paymentDayOfMonth } = normalizeVatPaymentSettings(sourceState);
    const vatPreviewState = structuredClone(sourceState);
    if (!vatPreviewState.settings || typeof vatPreviewState.settings !== "object") {
        vatPreviewState.settings = {};
    }
    vatPreviewState.settings.startMonth = shiftMonth(months[0], -paymentLagMonths) || startMonth;
    vatPreviewState.settings.horizonMonths = Math.max(1, months.length + paymentLagMonths, Number(vatPreviewState.settings.horizonMonths || 0) || 0);
    const preview = (0, vatPreview_js_1.computeVatPreview)(vatPreviewState);
    const rows = Array.isArray(preview?.rows) ? preview.rows : [];
    const results = [];
    rows.forEach((row) => {
        const sourceMonth = normalizeMonth(row?.month);
        if (!sourceMonth)
            return;
        const paymentMonth = shiftMonth(sourceMonth, paymentLagMonths);
        if (!paymentMonth || !monthSet.has(paymentMonth))
            return;
        const payable = Number(row?.payable || 0);
        if (!Number.isFinite(payable) || Math.abs(payable) <= 0.000001)
            return;
        const dueDate = isoDate(dueDateForMonth(paymentMonth, paymentDayOfMonth));
        if (!dueDate)
            return;
        const direction = payable < 0 ? "in" : "out";
        results.push({
            id: `tax-${VAT_TAX_TYPE_KEY}-${sourceMonth}-pay-${paymentMonth}`,
            month: paymentMonth,
            amount: Math.abs(payable),
            direction,
            dueDateIso: dueDate,
            taxType: VAT_TAX_TYPE_KEY,
            label: VAT_TAX_LABEL,
            sourceSection: "ust-de",
            note: `USt DE aus ${sourceMonth}`,
            sourceMonth,
            paymentLagMonths,
            paymentDayOfMonth,
            previewRow: {
                month: sourceMonth,
                payable,
                outVat: Number(row?.outVat || 0),
                feeInputVat: Number(row?.feeInputVat || 0),
                fixInputVat: Number(row?.fixInputVat || 0),
                eustRefund: Number(row?.eustRefund || 0),
            },
            overrideActive: false,
        });
    });
    results.sort((left, right) => {
        if (left.month === right.month) {
            if (left.dueDateIso === right.dueDateIso)
                return String(left.label || "").localeCompare(String(right.label || ""));
            return String(left.dueDateIso || "").localeCompare(String(right.dueDateIso || ""));
        }
        return String(left.month || "").localeCompare(String(right.month || ""));
    });
    return results;
}
function buildOssQuarterPreview(state, opts = {}) {
    const sourceState = state && typeof state === "object" ? state : {};
    const settings = sourceState.settings && typeof sourceState.settings === "object" ? sourceState.settings : {};
    const startMonth = normalizeMonth(opts.startMonth || settings.startMonth) || "2025-01";
    const horizon = Math.max(1, Number(opts.horizon || settings.horizonMonths || 12) || 12);
    const taxesState = normalizeTaxesState(sourceState.taxes);
    const paymentMonths = uniqueMonths(opts.paymentMonths || opts.months);
    const sourceMonths = uniqueMonths(opts.sourceMonths);
    const quarterKeys = paymentMonths.length
        ? quarterKeysFromPaymentMonths(paymentMonths)
        : Array.from(new Set((sourceMonths.length ? sourceMonths : monthRange(startMonth, horizon))
            .map((month) => quarterKeyForMonth(month))
            .filter(Boolean)));
    if (!quarterKeys.length)
        return [];
    const requiredSourceMonths = Array.from(new Set(quarterKeys.flatMap((quarterKey) => sourceMonthsForQuarter(quarterKey)))).sort((left, right) => left.localeCompare(right));
    const previewState = buildPreviewStateForMonths(sourceState, requiredSourceMonths, startMonth, horizon);
    if (!previewState)
        return [];
    const preview = (0, vatPreview_js_1.computeVatPreview)(previewState);
    const rowsByMonth = new Map((Array.isArray(preview?.rows) ? preview.rows : []).map((row) => [normalizeMonth(row?.month), row]));
    const deSharePct = parsePercent(taxesState.oss.deSharePct, 100);
    const deShare = deSharePct / 100;
    const nonDeSharePct = Math.max(0, 100 - deSharePct);
    const nonDeShare = nonDeSharePct / 100;
    return quarterKeys
        .map((quarterKey) => {
        const quarterSourceMonths = sourceMonthsForQuarter(quarterKey);
        const grossRevenue = quarterSourceMonths.reduce((sum, month) => {
            const row = rowsByMonth.get(month);
            return sum + Math.max(0, Number(row?.grossTotal || 0));
        }, 0);
        const netRevenue = grossRevenue / 1.19;
        const quarterBaseAmount = netRevenue * nonDeShare;
        const taxAmount = quarterBaseAmount * OSS_PROXY_RATE;
        const paymentMonth = paymentMonthForQuarter(quarterKey);
        return {
            quarterKey,
            quarterLabel: quarterLabel(quarterKey),
            sourceMonths: quarterSourceMonths,
            active: taxesState.oss.active === true,
            deSharePct,
            deShare,
            nonDeSharePct,
            nonDeShare,
            proxyRatePct: OSS_PROXY_RATE * 100,
            grossRevenue,
            netRevenue,
            quarterBaseAmount,
            taxAmount,
            paymentMonth,
            dueDateIso: isoDate(dueDateForMonth(paymentMonth, OSS_PAYMENT_DAY)),
        };
    })
        .sort((left, right) => String(left.paymentMonth || "").localeCompare(String(right.paymentMonth || "")));
}
function expandOssTaxInstances(state, opts = {}) {
    return buildOssQuarterPreview(state, {
        months: opts.months,
        paymentMonths: opts.months,
        startMonth: opts.startMonth,
        horizon: opts.horizon,
    })
        .filter((quarter) => quarter.active === true)
        .filter((quarter) => Number.isFinite(quarter.taxAmount) && quarter.taxAmount > 0.000001)
        .map((quarter) => ({
        id: `tax-${OSS_TAX_TYPE_KEY}-${quarter.quarterKey}-${quarter.paymentMonth}`,
        month: quarter.paymentMonth,
        amount: quarter.taxAmount,
        direction: "out",
        dueDateIso: quarter.dueDateIso,
        taxType: OSS_TAX_TYPE_KEY,
        label: OSS_TAX_LABEL,
        sourceSection: "oss",
        note: `OSS Proxy ${quarter.quarterLabel}`,
        sourceQuarter: quarter.quarterKey,
        sourceMonths: quarter.sourceMonths,
        deSharePct: quarter.deSharePct,
        nonDeSharePct: quarter.nonDeSharePct,
        proxyRatePct: quarter.proxyRatePct,
        quarterBaseAmount: quarter.quarterBaseAmount,
        overrideActive: false,
    }))
        .sort((left, right) => {
        if (left.month === right.month) {
            if (left.dueDateIso === right.dueDateIso)
                return String(left.label || "").localeCompare(String(right.label || ""));
            return String(left.dueDateIso || "").localeCompare(String(right.dueDateIso || ""));
        }
        return String(left.month || "").localeCompare(String(right.month || ""));
    });
}
function expandMonthlyTaxCashflowInstances(state, opts = {}) {
    return [
        ...expandVatTaxInstances(state, opts),
        ...expandOssTaxInstances(state, opts),
        ...expandTaxInstances(state, opts),
    ].sort((left, right) => {
        if (left.month === right.month) {
            if (left.dueDateIso === right.dueDateIso)
                return String(left.label || "").localeCompare(String(right.label || ""));
            return String(left.dueDateIso || "").localeCompare(String(right.dueDateIso || ""));
        }
        return String(left.month || "").localeCompare(String(right.month || ""));
    });
}
function buildMonthlyTaxSummary(instances, months = [], typeConfig = DASHBOARD_TAX_TYPE_CONFIG) {
    const summary = new Map();
    const seedMonths = Array.isArray(months) ? months : [];
    const allowedTypes = new Set(Array.isArray(typeConfig) && typeConfig.length
        ? typeConfig.map((entry) => String(entry?.key || "")).filter(Boolean)
        : Array.from(DASHBOARD_TAX_TYPE_KEYS));
    const typeTemplate = buildTaxTypeTemplate(Array.isArray(typeConfig) && typeConfig.length
        ? typeConfig
        : DASHBOARD_TAX_TYPE_CONFIG);
    seedMonths.forEach((month) => {
        const normalizedMonth = normalizeMonth(month);
        if (!normalizedMonth)
            return;
        summary.set(normalizedMonth, {
            month: normalizedMonth,
            total: 0,
            byType: { ...typeTemplate },
            instances: [],
        });
    });
    (Array.isArray(instances) ? instances : []).forEach((instance) => {
        if (!instance || typeof instance !== "object")
            return;
        const month = normalizeMonth(instance.month);
        const taxType = String(instance.taxType || "").trim();
        if (!month || !allowedTypes.has(taxType))
            return;
        const amount = Math.abs(Number(instance.amount || 0));
        if (!Number.isFinite(amount) || amount <= 0)
            return;
        const direction = String(instance.direction || "out").trim().toLowerCase() === "in" ? "in" : "out";
        const signedAmount = direction === "in" ? -amount : amount;
        if (!summary.has(month)) {
            summary.set(month, {
                month,
                total: 0,
                byType: { ...typeTemplate },
                instances: [],
            });
        }
        const target = summary.get(month);
        target.total += signedAmount;
        target.byType[taxType] += signedAmount;
        target.instances.push(instance);
    });
    return summary;
}

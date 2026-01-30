import {
  getProductsSnapshot,
  getRecentProducts,
  recordRecentProduct,
  upsertProduct,
} from "../data/storageLocal.js";
import {
  loadAppState,
  commitAppState,
} from "../storage/store.js";
import { createDataTable } from "./components/dataTable.js";
import { makeIssue, validateAll } from "../lib/dataHealth.js";
import { openBlockingModal } from "./dataHealthUi.js";
import { formatLocalizedNumber, parseLocalizedNumber, parseMoneyInput, formatMoneyDE } from "./utils/numberFormat.js";
import { addDays as addDaysUtcDate, overlapDays, parseISODate as parseISODateUtil } from "../lib/dateUtils.js";
import { getSuggestedInvoiceFilename } from "./utils/invoiceFilename.js";
import { computeFreightEstimate } from "../domain/costing/freightEstimate.js";
import { computeFreightPerUnitEur } from "../utils/costing.js";
import { deepEqual } from "../utils/deepEqual.js";
import { safeDeepClone } from "../utils/safeDeepClone.js";
import { useDraftForm } from "../hooks/useDraftForm.js";
import { useDirtyGuard } from "../hooks/useDirtyGuard.js";
import { openConfirmDialog } from "./utils/confirmDialog.js";

function $(sel, r = document) { return r.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
    } else if (typeof value === "boolean") {
      node[key] = value;
      if (value) node.setAttribute(key, "");
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

let productCache = [];

function refreshProductCache() {
  productCache = getProductsSnapshot();
}

function productLabelForList(sku) {
  if (!sku) return "—";
  const match = productCache.find(
    prod => prod && prod.sku && prod.sku.trim().toLowerCase() === String(sku).trim().toLowerCase(),
  );
  if (!match) return sku;
  return `${match.alias || match.sku} (${match.sku})`;
}

function getProductsBySku() {
  refreshProductCache();
  const map = new Map();
  productCache.forEach(prod => {
    if (!prod?.sku) return;
    const key = prod.sku.trim().toLowerCase();
    map.set(key, prod);
    map.set(prod.sku.trim(), prod);
  });
  return map;
}

function resolveFreightInputMode(record) {
  const mode = record?.timeline?.freightInputMode;
  if (mode === "TOTAL_EUR" || mode === "PER_UNIT_EUR" || mode === "AUTO_FROM_LANDED") return mode;
  return record?.freightMode === "per_unit" ? "PER_UNIT_EUR" : "TOTAL_EUR";
}

function ensureTimeline(record, settings = getSettings()) {
  if (!record) return {};
  if (!record.timeline || typeof record.timeline !== "object") record.timeline = {};
  if (record.timeline.includeFreight == null) record.timeline.includeFreight = true;
  record.timeline.freightInputMode = resolveFreightInputMode(record);
  const fxRate = Number(record.fxOverride || settings.fxRate || 0);
  const fxUsdPerEur = Number(record.timeline.fxUsdPerEur || 0);
  if (!Number.isFinite(fxUsdPerEur) || fxUsdPerEur <= 0) {
    if (Number.isFinite(fxRate) && fxRate > 0) {
      record.timeline.fxUsdPerEur = fxRate;
    } else if (Number.isFinite(settings.fxRate) && settings.fxRate > 0) {
      record.timeline.fxUsdPerEur = settings.fxRate;
    }
  }
  return record.timeline;
}

function updateDerivedFreight(record, settings = getSettings()) {
  if (!record) return null;
  const timeline = ensureTimeline(record, settings);
  const freightTotal = parseDE(record.freightEur);
  const freightPerUnit = parseDE(record.freightPerUnitEur);
  timeline.freightTotalEur = Number.isFinite(freightTotal) ? freightTotal : 0;
  timeline.freightPerUnitEur = Number.isFinite(freightPerUnit) ? freightPerUnit : 0;
  const estimate = computeFreightEstimate({
    ...record,
    timeline,
  }, getProductsBySku());
  const issueSet = new Set(estimate.issues || []);
  const freightAutoEvent = Array.isArray(record.autoEvents)
    ? record.autoEvents.find(evt => evt?.type === "freight")
    : null;
  if (freightAutoEvent?.id) {
    const log = record.paymentLog?.[freightAutoEvent.id] || {};
    if (log.status === "paid" && !Number.isFinite(Number(log.amountActualEur))) {
      issueSet.add("MISSING_PAYMENT_MAPPING");
    }
  }
  estimate.issues = Array.from(issueSet);
  record.derived = {
    ...(record.derived || {}),
    estimatedFreightEur: estimate.estimatedFreightEur,
    freightIssues: estimate.issues,
  };
  const lineMap = new Map();
  estimate.lines.forEach(line => {
    if (line.id) lineMap.set(line.id, line);
    if (line.sku) lineMap.set(`sku:${String(line.sku).toLowerCase()}`, line);
  });
  if (Array.isArray(record.items)) {
    record.items = record.items.map(item => {
      const line = lineMap.get(item.id) || lineMap.get(`sku:${String(item.sku || "").toLowerCase()}`) || null;
      return {
        ...item,
        derivedLogisticsPerUnitEur: line?.derivedLogisticsPerUnitEur ?? null,
        derivedIssues: line?.issues ?? [],
      };
    });
  }
  return estimate;
}

function getMergedPayments(record) {
  const stateSnapshot = loadAppState();
  const base = Array.isArray(stateSnapshot.payments) ? stateSnapshot.payments : [];
  const drafts = record?.paymentDrafts || {};
  const merged = base.map(payment => {
    const draft = drafts[payment?.id];
    return draft ? { ...payment, ...draft } : payment;
  });
  Object.values(drafts).forEach(draft => {
    if (!merged.some(entry => entry?.id === draft?.id)) {
      merged.push(draft);
    }
  });
  return merged;
}

function prepareRecordForDraft(record, settings) {
  const next = safeDeepClone(record || {});
  normaliseGoodsFields(next, settings);
  ensureAutoEvents(next, settings, next.milestones || []);
  ensurePaymentLog(next);
  normaliseArchiveFlag(next);
  if (!next.paymentDrafts) next.paymentDrafts = {};
  updateDerivedFreight(next, settings);
  return next;
}

function formatAutoFreightTooltip(line) {
  if (!line) return [];
  const alias = productCache.find(
    prod => prod?.sku?.trim().toLowerCase() === String(line.sku || "").trim().toLowerCase(),
  )?.alias;
  const rows = [
    `SKU: ${line.sku || "—"}`,
    `Alias: ${alias || "—"}`,
    `Einstand (EUR/Stk): ${line.landedUnitCostEur != null ? fmtEURPlain(line.landedUnitCostEur) : "—"}`,
    `Warenwert (EUR/Stk): ${line.goodsPerUnitEur != null ? fmtEURPlain(line.goodsPerUnitEur) : "—"}`,
    `Fracht (EUR/Stk): ${line.derivedLogisticsPerUnitEur != null ? fmtEURPlain(line.derivedLogisticsPerUnitEur) : "—"}`,
  ];
  if (line.issues?.includes("MISSING_LANDED_COST")) {
    rows.push("Einstandskosten fehlen");
  }
  if (line.issues?.includes("NEGATIVE_DERIVED_LOGISTICS")) {
    rows.push("Einstand < Warenwert (FX/EK prüfen)");
  }
  if (line.issues?.includes("MISSING_FX")) {
    rows.push("FX fehlt");
  }
  return rows;
}

function resolveProductUnitPrice(sku) {
  if (!sku) return null;
  const match = productCache.find(
    prod => prod && prod.sku && prod.sku.trim().toLowerCase() === String(sku).trim().toLowerCase(),
  );
  if (!match) return null;
  const template = match.template?.fields ? match.template.fields : match.template;
  const raw = template?.unitPriceUsd ?? match.unitPriceUsd ?? null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatFreightMissingFields(fields) {
  if (!fields || !fields.length) return "";
  const labels = fields.map((field) => {
    if (field === "landedCostEur") return "Einstandspreis";
    if (field === "unitPriceUsd") return "Unit Price";
    if (field === "fxUsdPerEur") return "FX";
    return field;
  });
  return `Fracht nicht berechenbar – ${labels.join(", ")} fehlt`;
}

function formatSkuSummary(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (!items.length) return productLabelForList(record?.sku);
  const uniq = Array.from(new Set(items.map(it => (it?.sku || "").trim()).filter(Boolean)));
  if (!uniq.length) return productLabelForList(record?.sku);
  const first = productLabelForList(uniq[0]);
  if (uniq.length === 1) return first;
  return `${first} +${uniq.length - 1}`;
}

function parseDE(value) {
  const parsed = parseLocalizedNumber(value);
  return parsed == null ? NaN : parsed;
}

function fmtEUR(value) {
  return Number(value || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtEURPlain(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? formatMoneyDE(num, 2) : "0,00";
}

function fmtCurrencyInput(value) {
  const raw = value == null ? "" : String(value);
  const parsed = parseDE(raw);
  if (!raw.trim()) return "";
  if (!Number.isFinite(parsed)) return raw;
  return formatLocalizedNumber(parsed, 2, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUSD(value) {
  return Number(value || 0).toLocaleString("de-DE", {
    style: "currency",
    currency: "USD",
  });
}

function fmtPercent(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : parseDE(value);
  return Number(numeric || 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtFxRate(value) {
  const numeric = typeof value === "number" ? value : parseDE(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return Number(numeric).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function fmtDateDE(input) {
  if (!input) return "—";
  let date;
  if (typeof input === "string") {
    const parts = input.split("-");
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        date = new Date(Date.UTC(y, m - 1, d));
      }
    }
  } else if (input instanceof Date) {
    date = input;
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function copyToClipboard(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return new Promise((resolve) => {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.setAttribute("readonly", "");
    temp.style.position = "absolute";
    temp.style.left = "-9999px";
    document.body.append(temp);
    temp.select();
    try {
      const success = document.execCommand("copy");
      temp.remove();
      resolve(success);
    } catch (error) {
      temp.remove();
      resolve(false);
    }
  });
}

function parseDeDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [_, dd, mm, yyyy] = match;
  const y = Number(yyyy);
  const m = Number(mm);
  const d = Number(dd);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseISOToDate(iso) {
  if (!iso) return null;
  const parts = String(iso).split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (![y, m, d].every(n => Number.isFinite(n))) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getCnyWindow(settings, year) {
  const direct = settings?.cny;
  if (direct?.start && direct?.end) {
    const start = parseISODateUtil(direct.start);
    const end = parseISODateUtil(direct.end);
    if (start && end && end >= start) return { start, end };
  }
  const entry = settings?.cnyBlackoutByYear?.[String(year)];
  if (!entry) return null;
  const start = parseISOToDate(entry.start);
  const end = parseISOToDate(entry.end);
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return null;
  if (end < start) return null;
  return { start, end };
}

function applyCnyBlackout(orderDate, prodDays, settings) {
  if (!(orderDate instanceof Date) || Number.isNaN(orderDate.getTime())) {
    return { prodDone: orderDate, adjustmentDays: 0, cnyStart: null, cnyEnd: null };
  }
  const baseDays = Math.max(0, Number(prodDays || 0));
  const prodEnd = addDaysUtcDate(orderDate, baseDays);
  if (!prodEnd) return { prodDone: orderDate, adjustmentDays: 0, cnyStart: null, cnyEnd: null };

  let adjustmentDays = 0;
  let usedStart = null;
  let usedEnd = null;
  const startYear = orderDate.getUTCFullYear();
  const endYear = prodEnd.getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    const window = getCnyWindow(settings, year);
    if (!window) continue;
    const overlap = overlapDays(orderDate, prodEnd, window.start, window.end);
    if (overlap > 0) {
      adjustmentDays += overlap;
      usedStart = !usedStart || window.start < usedStart ? window.start : usedStart;
      usedEnd = !usedEnd || window.end > usedEnd ? window.end : usedEnd;
    }
  }

  const adjustedEnd = adjustmentDays ? addDaysUtcDate(prodEnd, adjustmentDays) : prodEnd;
  return {
    prodDone: adjustedEnd || prodEnd,
    adjustmentDays,
    cnyStart: usedStart,
    cnyEnd: usedEnd,
  };
}

const QUICKFILL_FIELD_MAP = [
  "units",
  "unitCostUsd",
  "unitExtraUsd",
  "extraFlatUsd",
  "fxOverride",
  "fxFeePct",
  "transport",
  "prodDays",
  "transitDays",
  "freightEur",
  "freightMode",
  "freightPerUnitEur",
  "dutyRatePct",
  "dutyIncludeFreight",
  "eustRatePct",
  "vatRefundEnabled",
  "vatRefundLagMonths",
  "ddp",
];

const QUICKFILL_ARRAY_FIELDS = ["milestones", "autoEvents", "items"];

const TEMPLATE_FIELD_OPTIONS = [
  { key: "units", label: "Stückzahl" },
  { key: "unitCostUsd", label: "Stückkosten (USD)" },
  { key: "unitExtraUsd", label: "Zusatzkosten je Stück (USD)" },
  { key: "extraFlatUsd", label: "Zusatzkosten pauschal (USD)" },
  { key: "fxOverride", label: "FX-Kurs" },
  { key: "fxFeePct", label: "FX-Gebühr (%)" },
  { key: "transport", label: "Transport" },
  { key: "prodDays", label: "Produktionstage" },
  { key: "transitDays", label: "Transit-Tage" },
  { key: "freightEur", label: "Fracht (€)" },
  { key: "freightMode", label: "Fracht-Modus" },
  { key: "freightPerUnitEur", label: "Fracht pro Stück (€)" },
  { key: "dutyRatePct", label: "Zoll (%)" },
  { key: "dutyIncludeFreight", label: "Fracht einbeziehen" },
  { key: "eustRatePct", label: "EUSt (%)" },
  { key: "vatRefundEnabled", label: "EUSt-Erstattung aktiv" },
  { key: "vatRefundLagMonths", label: "EUSt-Lag (Monate)" },
  { key: "ddp", label: "DDP" },
  { key: "items", label: "Positionen" },
  { key: "milestones", label: "Meilensteine" },
  { key: "autoEvents", label: "Importkosten-Einstellungen" },
];

function cloneMilestones(list = []) {
  return list.map(row => ({
    ...row,
    id: Math.random().toString(36).slice(2, 9),
  }));
}

function cloneAutoEvents(list = []) {
  return list.map(evt => ({
    ...evt,
    id: `auto-${evt.type || "evt"}-${Math.random().toString(36).slice(2, 7)}`,
  }));
}

function cloneItems(list = []) {
  return list.map(item => ({
    ...item,
    id: item.id || `item-${Math.random().toString(36).slice(2, 9)}`,
  }));
}

function applyQuickfillSource(baseRecord, source) {
  if (!source) return baseRecord;
  const next = JSON.parse(JSON.stringify(baseRecord));
  for (const field of QUICKFILL_FIELD_MAP) {
    if (source[field] == null) continue;
    next[field] = Array.isArray(source[field])
      ? JSON.parse(JSON.stringify(source[field]))
      : source[field];
  }
  if (source.milestones) {
    next.milestones = cloneMilestones(source.milestones);
  }
  if (source.autoEvents) {
    next.autoEvents = cloneAutoEvents(source.autoEvents);
  }
  if (source.items) {
    next.items = cloneItems(source.items);
  }
  if (source.fxOverride == null && baseRecord.fxOverride != null) {
    next.fxOverride = baseRecord.fxOverride;
  }
  return next;
}

function diffFields(current, incoming) {
  const diffs = [];
  const labelMap = {
    units: "Stückzahl",
    unitCostUsd: "Stückkosten (USD)",
    unitExtraUsd: "Zusatzkosten je Stück (USD)",
    extraFlatUsd: "Zusatzkosten pauschal (USD)",
    fxOverride: "FX-Kurs",
    fxFeePct: "FX-Gebühr (%)",
    transport: "Transport",
    prodDays: "Produktionstage",
    transitDays: "Transit-Tage",
    freightEur: "Fracht (€)",
    freightMode: "Fracht-Modus",
    freightPerUnitEur: "Fracht pro Stück (€)",
    dutyRatePct: "Zoll (%)",
    dutyIncludeFreight: "Fracht einbeziehen",
    eustRatePct: "EUSt (%)",
    vatRefundEnabled: "EUSt-Erstattung aktiv",
    vatRefundLagMonths: "EUSt-Lag (Monate)",
    ddp: "DDP",
    milestones: "Meilensteine",
    autoEvents: "Importkosten-Einstellungen",
  };

  const currencyFields = new Set([
    "unitCostUsd",
    "unitExtraUsd",
    "extraFlatUsd",
    "freightEur",
    "freightPerUnitEur",
  ]);

  const percentFields = new Set([
    "fxFeePct",
    "dutyRatePct",
    "eustRatePct",
  ]);

  for (const field of [...QUICKFILL_FIELD_MAP, ...QUICKFILL_ARRAY_FIELDS]) {
    const label = labelMap[field] || field;
    if (field === "milestones" || field === "autoEvents") {
      const currentJson = JSON.stringify(current[field] || []);
      const incomingJson = JSON.stringify(incoming[field] || []);
      if (currentJson !== incomingJson) {
        diffs.push({ label, before: current[field]?.length || 0, after: incoming[field]?.length || 0, type: "list" });
      }
      continue;
    }

    const before = current[field];
    const after = incoming[field];
    if (before == null && after == null) continue;
    if (before === after) continue;
    const format = (value) => {
      if (value == null) return "—";
      if (currencyFields.has(field)) {
        if (field === "freightEur" || field === "freightPerUnitEur") return fmtEUR(parseDE(value));
        return fmtUSD(parseDE(value));
      }
      if (percentFields.has(field)) return `${fmtPercent(value)} %`;
      if (field === "fxOverride") return fmtFxRate(value);
      if (field === "freightMode") return value === "per_unit" ? "Pro Stück" : "Gesamt";
      if (typeof value === "boolean") return value ? "Ja" : "Nein";
      return String(value);
    };
    if (format(before) === format(after)) continue;
    diffs.push({ label, before: format(before), after: format(after) });
  }
  return diffs;
}

function buildModal({ title, content, actions = [] }) {
  const overlay = el("div", { class: "po-modal-backdrop", role: "dialog", "aria-modal": "true" });
  const card = el("div", { class: "po-modal" }, [
    el("header", { class: "po-modal-header" }, [
      el("h4", {}, [title || ""]),
      el("button", { class: "btn ghost", type: "button", onclick: () => closeModal(overlay), "aria-label": "Schließen" }, ["✕"]),
    ]),
    el("div", { class: "po-modal-body" }, [content]),
    el("footer", { class: "po-modal-actions" }, actions.length ? actions : [
      el("button", { class: "btn", type: "button", onclick: () => closeModal(overlay) }, ["Schließen"]),
    ]),
  ]);
  overlay.append(card);
  document.body.append(overlay);
  const focusable = overlay.querySelector("button, [href], input, select, textarea");
  if (focusable) focusable.focus();
  function handleKey(ev) {
    if (ev.key === "Escape") {
      closeModal(overlay);
    }
  }
  let pointerDownOnOverlay = false;
  overlay.addEventListener("mousedown", (ev) => {
    pointerDownOnOverlay = ev.target === overlay;
  });
  overlay.addEventListener("mouseup", (ev) => {
    if (pointerDownOnOverlay && ev.target === overlay) {
      closeModal(overlay);
    }
    pointerDownOnOverlay = false;
  });
  overlay.addEventListener("keydown", handleKey);
  return overlay;
}

function closeModal(overlay) {
  if (!overlay) return;
  overlay.remove();
}

function clampPct(value) {
  const pct = parseDE(value);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function ensureItems(record) {
  if (!record) return [];
  if (!Array.isArray(record.items) || !record.items.length) {
    record.items = [
      {
        id: `item-${Math.random().toString(36).slice(2, 9)}`,
        sku: record.sku || "",
        units: record.units ?? "0",
        unitCostUsd: record.unitCostUsd ?? "0,00",
        unitExtraUsd: record.unitExtraUsd ?? "0,00",
        extraFlatUsd: record.extraFlatUsd ?? "0,00",
        unitCostManuallyEdited: false,
      },
    ];
  }
  record.items = record.items.map(item => ({
    id: item.id || `item-${Math.random().toString(36).slice(2, 9)}`,
    sku: item.sku || "",
    units: item.units ?? "0",
    unitCostUsd: item.unitCostUsd ?? "0,00",
    unitExtraUsd: item.unitExtraUsd ?? "0,00",
    extraFlatUsd: item.extraFlatUsd ?? "0,00",
    unitCostManuallyEdited: item.unitCostManuallyEdited === true,
  }));
  return record.items;
}

function computeGoodsTotals(record, settings = getSettings()) {
  const items = ensureItems(record);
  let totalUsd = 0;
  let totalUnits = 0;
  let unitCost = 0;
  let unitExtra = 0;
  let extraFlat = 0;
  items.forEach((item, idx) => {
    const unitsRaw = parseDE(item.units);
    const unitRaw = parseDE(item.unitCostUsd);
    const extraRaw = parseDE(item.unitExtraUsd);
    const flatRaw = parseDE(item.extraFlatUsd);
    const units = Number.isFinite(unitsRaw) ? unitsRaw : 0;
    const unit = Number.isFinite(unitRaw) ? unitRaw : 0;
    const extra = Number.isFinite(extraRaw) ? extraRaw : 0;
    const flat = Number.isFinite(flatRaw) ? flatRaw : 0;
    if (idx === 0) {
      unitCost = unit;
      unitExtra = extra;
      extraFlat = flat;
    }
    if (units > 0) totalUnits += units;
    const subtotal = (unit + extra) * units + flat;
    if (Number.isFinite(subtotal)) totalUsd += subtotal;
  });
  totalUsd = Math.max(0, Math.round(totalUsd * 100) / 100);
  let fxRate = settings?.fxRate || 0;
  if (record && record.fxOverride != null && record.fxOverride !== "") {
    const override = typeof record.fxOverride === "number" ? record.fxOverride : parseDE(record.fxOverride);
    if (Number.isFinite(override) && override > 0) fxRate = override;
  }
  const fallbackEur = parseDE(record?.goodsEur);
  const totalEur = fxRate > 0 ? Math.round((totalUsd / fxRate) * 100) / 100 : (Number.isFinite(fallbackEur) ? Math.round(fallbackEur * 100) / 100 : 0);
  return {
    usd: totalUsd,
    eur: totalEur,
    fxRate,
    units: totalUnits,
    unitCost,
    unitExtra,
    extraFlat,
  };
}

function resolveFreightTotal(record, totals = computeGoodsTotals(record, getSettings())) {
  if (!record) return 0;
  const mode = resolveFreightInputMode(record);
  const includeFreight = record?.timeline?.includeFreight !== false;
  if (mode === "AUTO_FROM_LANDED") {
    const estimate = record?.derived?.estimatedFreightEur ?? updateDerivedFreight(record)?.estimatedFreightEur ?? 0;
    return includeFreight ? Math.round(estimate * 100) / 100 : 0;
  }
  if (mode === "PER_UNIT_EUR") {
    const perUnit = parseDE(record?.freightPerUnitEur);
    const units = Number(totals?.units || 0);
    const total = perUnit * units;
    return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
  }
  const total = parseDE(record?.freightEur);
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}

function computeEstimatedFreightTotals(record, settings = getSettings()) {
  if (!record) return { total: 0, missing: 0, used: [], estimate: null };
  const estimate = updateDerivedFreight(record, settings);
  return {
    total: Math.round((estimate?.estimatedFreightEur || 0) * 100) / 100,
    missing: estimate?.missingLandedCount || 0,
    used: estimate?.lines?.map(line => line.sku).filter(Boolean) || [],
    estimate,
  };
}

function normaliseGoodsFields(record, settings = getSettings()) {
  if (!record) return;
  ensureItems(record);
  record.items = record.items.map(item => ({
    ...item,
    unitCostUsd: fmtCurrencyInput(item.unitCostUsd ?? "0,00"),
    unitExtraUsd: fmtCurrencyInput(item.unitExtraUsd ?? "0,00"),
    units: String(item.units ?? "0"),
    extraFlatUsd: fmtCurrencyInput(item.extraFlatUsd ?? "0,00"),
    unitCostManuallyEdited: item.unitCostManuallyEdited === true,
  }));
  if (record.fxOverride != null && record.fxOverride !== "") {
    const override = typeof record.fxOverride === "number" ? record.fxOverride : parseDE(record.fxOverride);
    record.fxOverride = Number.isFinite(override) && override > 0 ? override : null;
  }

  const totals = computeGoodsTotals(record, settings);
  const recalculated = computeGoodsTotals(record, settings);
  record.goodsEur = fmtCurrencyInput(recalculated.eur);
  record.goodsUsd = fmtCurrencyInput(recalculated.usd);
  record.goodsValueUsd = recalculated.usd;
  record.units = String(recalculated.units || "0");
  record.unitCostUsd = fmtCurrencyInput(record.items[0]?.unitCostUsd ?? "0,00");
  record.unitExtraUsd = fmtCurrencyInput(record.items[0]?.unitExtraUsd ?? "0,00");
  record.extraFlatUsd = fmtCurrencyInput(record.items[0]?.extraFlatUsd ?? "0,00");
  record.freightMode = record.freightMode === "per_unit" ? "per_unit" : "total";
  record.freightEur = fmtCurrencyInput(record.freightEur ?? "0,00");
  record.freightPerUnitEur = fmtCurrencyInput(record.freightPerUnitEur ?? "0,00");
  ensureTimeline(record, settings);
  if (!record.derived || typeof record.derived !== "object") {
    record.derived = { estimatedFreightEur: 0, freightIssues: [] };
  }
  if (!record.sku && record.items[0]?.sku) {
    record.sku = record.items[0].sku;
  }
}

function getSettings() {
  const state = loadAppState();
  const raw = (state && state.settings) || {};
  return {
    fxRate: parseDE(raw.fxRate ?? 0) || 0,
    fxFeePct: parseDE(raw.fxFeePct ?? 0) || 0,
    eurUsdRate: parseDE(raw.eurUsdRate ?? 0) || 0,
    dutyRatePct: parseDE(raw.dutyRatePct ?? 0) || 0,
    dutyIncludeFreight: raw.dutyIncludeFreight !== false,
    eustRatePct: parseDE(raw.eustRatePct ?? 0) || 0,
    vatRefundEnabled: raw.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(raw.vatRefundLagMonths ?? 0) || 0,
    freightLagDays: Number(raw.freightLagDays ?? 0) || 0,
    cny: raw.cny ? { start: raw.cny.start || "", end: raw.cny.end || "" } : { start: "", end: "" },
    cnyBlackoutByYear: raw.cnyBlackoutByYear && typeof raw.cnyBlackoutByYear === "object"
      ? structuredClone(raw.cnyBlackoutByYear)
      : {},
  };
}

function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const target = new Date(Date.UTC(year, month + months, 1));
  return target;
}

function monthEnd(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 0));
}

function ensureAutoEvents(record, settings, manualMilestones = []) {
  if (!record.autoEvents) record.autoEvents = [];
  const map = new Map(record.autoEvents.map(evt => [evt.type, evt]));
  const ensure = (type, defaults) => {
    if (!map.has(type)) {
      const created = { id: `auto-${type}`, type, ...defaults };
      record.autoEvents.push(created);
      map.set(type, created);
    } else {
      const current = map.get(type);
      Object.assign(current, { type, ...defaults, ...current });
    }
    return map.get(type);
  };

  ensure("freight", {
    label: "Fracht",
    anchor: "ETA",
    lagDays: settings.freightLagDays || 0,
    enabled: true,
  });

  ensure("duty", {
    label: "Zoll",
    percent: settings.dutyRatePct || 0,
    anchor: "ETA",
    lagDays: settings.freightLagDays || 0,
    enabled: true,
  });

  ensure("eust", {
    label: "EUSt",
    percent: settings.eustRatePct || 0,
    anchor: "ETA",
    lagDays: settings.freightLagDays || 0,
    enabled: true,
  });

  ensure("vat_refund", {
    label: "EUSt-Erstattung",
    percent: 100,
    anchor: "ETA",
    lagMonths: settings.vatRefundLagMonths || 0,
    enabled: settings.vatRefundEnabled !== false,
  });

  const firstMs = manualMilestones[0];
  ensure("fx_fee", {
    label: "FX-Gebühr",
    percent: settings.fxFeePct || 0,
    anchor: firstMs?.anchor || "ORDER_DATE",
    lagDays: firstMs?.lagDays || 0,
    enabled: settings.fxFeePct > 0,
  });

  record.autoEvents = [
    "freight",
    "duty",
    "eust",
    "vat_refund",
    "fx_fee",
  ].map(type => map.get(type)).filter(Boolean);

  if (record.ddp) {
    for (const evt of record.autoEvents) {
      if (evt.type === "freight" || evt.type === "duty" || evt.type === "eust" || evt.type === "vat_refund") {
        if (evt.enabled !== false) evt._ddpEnabledBackup = evt.enabled !== false;
        evt.enabled = false;
      }
    }
  } else {
    for (const evt of record.autoEvents) {
      if ((evt.type === "freight" || evt.type === "duty" || evt.type === "eust" || evt.type === "vat_refund") && evt._ddpEnabledBackup != null) {
        evt.enabled = evt._ddpEnabledBackup;
        delete evt._ddpEnabledBackup;
      }
    }
  }

  return record.autoEvents;
}

function ensurePaymentLog(record) {
  if (!record) return {};
  if (!record.paymentLog || typeof record.paymentLog !== "object") record.paymentLog = {};
  return record.paymentLog;
}

function safeSupplierShortName(value) {
  const base = String(value || "").trim().replace(/[\\/]/g, "");
  if (!base) return "Supplier";
  return base.replace(/\s+/g, "-");
}

function safeFilenameChunk(value) {
  const base = String(value || "").trim().replace(/[\\/]/g, "");
  if (!base) return "";
  return base.replace(/\s+/g, "-");
}

function normalizePaymentId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/^(pay-?)+/i, "");
  return `pay-${normalized}`;
}

function buildPaymentId() {
  return normalizePaymentId(`pay-${Math.random().toString(36).slice(2, 9)}`);
}

function normalizeUrl(value) {
  return String(value || "").trim();
}

function isHttpUrl(value) {
  if (!value) return false;
  return /^https?:\/\//i.test(value);
}

function buildPaymentMap(payments = []) {
  const map = new Map();
  (payments || []).forEach(payment => {
    if (!payment?.id) return;
    map.set(payment.id, payment);
  });
  return map;
}

function ensurePaymentInternalId(record, eventId) {
  if (!record || !eventId) return null;
  const log = record.paymentLog || {};
  if (!log[eventId] || typeof log[eventId] !== "object") log[eventId] = {};
  if (!log[eventId].paymentInternalId) {
    log[eventId].paymentInternalId = `payrow-${Math.random().toString(36).slice(2, 9)}`;
  }
  record.paymentLog = log;
  return log[eventId].paymentInternalId;
}

function resolvePrimaryAlias(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (items.length > 1) return "Multi";
  const sku = items.length ? items[0]?.sku : record?.sku;
  if (!sku) return "Multi";
  const match = productCache.find(prod => prod?.sku?.trim().toLowerCase() === String(sku).trim().toLowerCase());
  return match?.alias || sku;
}

function suggestedInvoiceFilename(record, paidDate) {
  const date = paidDate || new Date().toISOString().slice(0, 10);
  const number = record?.poNo || record?.id || "PO";
  const supplier = safeSupplierShortName(record?.supplier || record?.supplierName || record?.supplierId);
  const alias = safeFilenameChunk(resolvePrimaryAlias(record));
  const aliasChunk = alias ? `_${alias}` : "";
  return `${date}_PO-${number}_${supplier}${aliasChunk}`;
}

function mapPaymentType(evt, milestone) {
  if (evt.type === "freight") return "Fracht";
  if (evt.type === "eust") return "EUSt";
  if (evt.type === "duty") return "Other";
  if (evt.type === "fx_fee") return "Other";
  const label = String(milestone?.label || evt.label || "").toLowerCase();
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("shipping") || label.includes("fracht")) return "Fracht";
  return "Other";
}

function buildInvoiceKeyEvents(selectedEvents) {
  const labels = selectedEvents
    .flatMap(evt => [evt?.typeLabel, evt?.label])
    .filter(Boolean);
  const lowered = labels.map(label => String(label).toLowerCase());
  const hasDeposit = lowered.some(label => label.includes("deposit"));
  const hasBalance = lowered.some(label => label.includes("balance"));
  const hasFx = lowered.some(label => label.includes("fx"));
  const hasShipping = lowered.some(label => label.includes("shipping") || label.includes("fracht"));
  const hasEust = lowered.some(label => label.includes("eust"));
  if (hasDeposit && hasBalance) return `Deposit+Balance${hasFx ? "+FX" : ""}`;
  if (hasDeposit && hasFx) return "Deposit+FX";
  if (hasDeposit) return "Deposit";
  if (hasBalance) return hasFx ? "Balance+FX" : "Balance";
  if (hasShipping) return "Fracht";
  if (hasEust) return "EUSt";
  if (hasFx && lowered.length === 1) return "FX";
  if (labels.length <= 1) return labels[0] || "Payment";
  const unique = Array.from(new Set(labels));
  if (unique.length <= 2) return unique.join("+");
  return `${unique.slice(0, 2).join("+")}+more`;
}

function allocatePayment(total, selectedEvents) {
  const plannedValues = selectedEvents.map(evt => Number(evt.plannedEur || 0));
  const sumPlanned = plannedValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(sumPlanned) || sumPlanned <= 0) return null;
  const allocations = plannedValues.map((planned, index) => {
    const share = planned / sumPlanned;
    const raw = total * share;
    return {
      eventId: selectedEvents[index].id,
      planned,
      raw,
      actual: Math.round(raw * 100) / 100,
    };
  });
  const roundedSum = allocations.reduce((sum, entry) => sum + entry.actual, 0);
  const remainder = Math.round((total - roundedSum) * 100) / 100;
  if (Math.abs(remainder) > 0) {
    let target = allocations[allocations.length - 1];
    if (allocations.length > 1) {
      target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
    }
    target.actual = Math.round((target.actual + remainder) * 100) / 100;
  }
  return allocations;
}

function buildPaymentRows(record, config, settings, paymentRecords = []) {
  ensurePaymentLog(record);
  const milestones = Array.isArray(record.milestones) ? record.milestones : [];
  const msMap = new Map(milestones.map(item => [item.id, item]));
  const paymentMap = buildPaymentMap(paymentRecords);
  const events = orderEvents(JSON.parse(JSON.stringify(record)), config, settings);
  return events
    .filter(evt => evt && Number(evt.amount || 0) < 0)
    .map(evt => {
      const log = record.paymentLog?.[evt.id] || {};
      const paymentInternalId = ensurePaymentInternalId(record, evt.id);
      const planned = Math.abs(Number(evt.amount || 0));
      const payment = log.paymentId ? paymentMap.get(log.paymentId) : null;
      const status = log.status === "paid" || payment ? "paid" : "open";
      const paidDate = log.paidDate || payment?.paidDate || null;
      return {
        id: evt.id,
        paymentInternalId,
        typeLabel: mapPaymentType(evt, msMap.get(evt.id)),
        label: evt.label,
        dueDate: evt.date || null,
        plannedEur: planned,
        status,
        paidDate,
        paidEurActual: Number.isFinite(Number(log.amountActualEur)) ? Number(log.amountActualEur) : null,
        method: payment?.method || log.method || null,
        paidBy: payment?.payer || log.payer || null,
        paymentId: payment?.id || log.paymentId || null,
        note: log.note || "",
        invoiceDriveUrl: payment?.invoiceDriveUrl || "",
        invoiceFolderDriveUrl: payment?.invoiceFolderDriveUrl || "",
        eventType: evt.type || null,
      };
    });
}

function highestNumberInfo(records, field) {
  let best = null;
  const regex = /(\d+)(?!.*\d)/;
  for (const record of records || []) {
    const raw = record?.[field];
    if (!raw) continue;
    const match = regex.exec(String(raw));
    if (!match) continue;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) continue;
    if (!best || numeric > best.numeric) {
      best = {
        raw: String(raw),
        numeric,
        digits: match[1],
        index: match.index ?? (String(raw).lastIndexOf(match[1])),
      };
    }
  }

  if (!best) return { raw: null, next: null };

  const nextDigits = String(best.numeric + 1).padStart(best.digits.length, "0");
  const prefix = best.raw.slice(0, best.index);
  const suffix = best.raw.slice(best.index + best.digits.length);
  const next = `${prefix}${nextDigits}${suffix}`;
  return { raw: best.raw, next };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isoDate(date) {
  if (!(date instanceof Date)) return null;
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  const normalised = new Date(ms - date.getTimezoneOffset() * 60000);
  return normalised.toISOString().slice(0, 10);
}

function defaultRecord(config, settings = getSettings()) {
  const today = new Date().toISOString().slice(0, 10);
  const record = {
    id: Math.random().toString(36).slice(2, 9),
    [config.numberField]: "",
    orderDate: today,
    sku: "",
    supplier: "",
    items: [
      {
        id: `item-${Math.random().toString(36).slice(2, 9)}`,
        sku: "",
        units: "0",
        unitCostUsd: "0,00",
        unitExtraUsd: "0,00",
        extraFlatUsd: "0,00",
        unitCostManuallyEdited: false,
      },
    ],
    goodsEur: "0,00",
    fxOverride: settings.fxRate || null,
    timeline: {
      fxUsdPerEur: settings.fxRate || null,
      includeFreight: true,
      freightInputMode: "TOTAL_EUR",
      freightTotalEur: 0,
      freightPerUnitEur: 0,
    },
    freightEur: "0,00",
    freightMode: "total",
    freightPerUnitEur: "0,00",
    prodDays: 60,
    transport: "sea",
    transitDays: 60,
    ddp: false,
    cnyAdjustmentDays: 0,
    etdManual: null,
    etaManual: null,
    dutyRatePct: settings.dutyRatePct || 0,
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: settings.eustRatePct || 0,
    vatRefundLagMonths: settings.vatRefundLagMonths || 0,
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    fxFeePct: settings.fxFeePct || 0,
    milestones: [
      { id: Math.random().toString(36).slice(2, 9), label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: Math.random().toString(36).slice(2, 9), label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
    ],
    paymentLog: {},
    derived: {
      estimatedFreightEur: 0,
      freightIssues: [],
    },
    archived: false,
  };
  ensureAutoEvents(record, settings, record.milestones);
  normaliseGoodsFields(record, settings);
  return record;
}

function anchorDate(schedule, anchor) {
  if (!schedule) return null;
  if (anchor === "ORDER_DATE") return schedule.order;
  if (anchor === "PROD_DONE") return schedule.prodDone;
  if (anchor === "ETD") return schedule.etd;
  return schedule.eta;
}

function msSum100(ms) {
  const sum = (ms || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
  return Math.round(sum * 10) / 10;
}

function orderEvents(record, config, settings) {
  const totals = computeGoodsTotals(record, settings);
  let goods = totals.eur;
  if (!goods) {
    const fallback = parseDE(record.goodsEur);
    if (fallback) goods = fallback;
  }
  const freight = resolveFreightTotal(record, totals);
  const prefix = record[config.numberField] ? `${config.entityLabel} ${record[config.numberField]} – ` : "";
  const manual = Array.isArray(record.milestones) ? record.milestones : [];
  const auto = ensureAutoEvents(record, settings, manual);

  const events = [];
  const schedule = computeTimeline(record, settings);

  const manualComputed = manual.map(m => {
    const pct = clampPct(m.percent);
    const baseDate = anchorDate(schedule, m.anchor || "ORDER_DATE");
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
    const due = addDays(baseDate, Number(m.lagDays || 0));
    const dueIso = isoDate(due);
    if (!dueIso) return null;
    const amount = -(goods * (pct / 100));
    if (!Number.isFinite(amount)) return null;
    return {
      id: m.id,
      label: `${prefix}${m.label || "Zahlung"}`.trim(),
      date: dueIso,
      amount,
      type: "manual",
      due,
      auto: false,
      direction: amount <= 0 ? "out" : "in",
    };
  }).filter(Boolean);

  events.push(...manualComputed.map(evt => ({
    id: evt.id,
    label: evt.label,
    date: evt.date,
    amount: evt.amount,
    type: evt.type,
    auto: false,
    due: evt.due,
    direction: evt.direction,
  })));

  const dutyIncludeFreight = record.dutyIncludeFreight !== false;
  const stateDutyRate = typeof record.dutyRatePct === "number" ? record.dutyRatePct : clampPct(record.dutyRatePct);
  const stateEustRate = typeof record.eustRatePct === "number" ? record.eustRatePct : clampPct(record.eustRatePct);
  const stateFxFee = typeof record.fxFeePct === "number" ? record.fxFeePct : clampPct(record.fxFeePct);
  const vatLagMonths = Number(record.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0) || 0;

  const autoResults = {};
  for (const autoEvt of auto) {
    if (!autoEvt || autoEvt.enabled === false) continue;
    const anchor = autoEvt.anchor || "ETA";
    const baseDate = anchorDate(schedule, anchor);
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) continue;

    if (autoEvt.type === "freight") {
      const amountAbs = resolveFreightTotal(record, totals);
      if (!amountAbs) {
        const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
        const dueIso = isoDate(due);
        if (!dueIso) continue;
        events.push({
          id: autoEvt.id,
          label: `${prefix}${autoEvt.label ? ` – ${autoEvt.label}` : ""}`.trim(),
          date: dueIso,
          amount: 0,
          type: "freight",
          auto: true,
          due,
          direction: "out",
        });
        continue;
      }
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      const amount = -amountAbs;
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label ? ` – ${autoEvt.label}` : ""}`.trim(),
        date: dueIso,
        amount,
        type: "freight",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "duty") {
      const percent = clampPct(autoEvt.percent ?? stateDutyRate ?? settings.dutyRatePct ?? 0);
      const baseValue = goods + (dutyIncludeFreight ? freight : 0);
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const amount = -(baseValue * (percent / 100));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      autoResults.duty = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "Zoll"}`.trim(),
        date: dueIso,
        amount,
        type: "duty",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "eust") {
      const percent = clampPct(autoEvt.percent ?? stateEustRate ?? settings.eustRatePct ?? 0);
      const dutyAbs = Math.abs(autoResults.duty?.amount || 0);
      const baseValue = goods + freight + dutyAbs;
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const amount = -(baseValue * (percent / 100));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      autoResults.eust = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "EUSt"}`.trim(),
        date: dueIso,
        amount,
        type: "eust",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "vat_refund") {
      const eust = autoResults.eust;
      if (!eust || eust.amount === 0 || record.vatRefundEnabled === false) continue;
      const percent = clampPct(autoEvt.percent ?? 100);
      const months = Number((autoEvt.lagMonths ?? vatLagMonths) || 0);
      const baseDay = addDays(eust.due || baseDate, Number(autoEvt.lagDays || 0));
      const shifted = addMonths(baseDay, months);
      const due = monthEnd(shifted);
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      const amount = Math.abs(eust.amount) * (percent / 100);
      autoResults.vat = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "EUSt-Erstattung"}`.trim(),
        date: dueIso,
        amount,
        type: "vat_refund",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "fx_fee") {
      const percent = clampPct(autoEvt.percent ?? stateFxFee ?? settings.fxFeePct ?? 0);
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      const amount = -(goods * (percent / 100));
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "FX"}`.trim(),
        date: dueIso,
        amount,
        type: "fx_fee",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }
  }

  return events
    .filter(evt => evt && Number.isFinite(evt.amount))
    .sort((a, b) => (a.date === b.date ? (a.label || "").localeCompare(b.label || "") : a.date.localeCompare(b.date)));
}

export { buildPaymentRows, getSettings };

function buildEventList(events, paymentLog = {}, paymentRecords = []) {
  const wrapper = el("div", { class: "po-event-table" });
  if (!events.length) {
    wrapper.append(el("div", { class: "muted" }, ["Keine Ereignisse definiert."]));
    return wrapper;
  }
  const paymentMap = buildPaymentMap(paymentRecords);
  wrapper.append(
    el("div", { class: "po-event-head" }, [
      el("span", { class: "po-event-col" }, ["Name"]),
      el("span", { class: "po-event-col" }, ["Datum"]),
      el("span", { class: "po-event-col amount" }, ["Betrag"]),
      el("span", { class: "po-event-col status" }, ["Status"]),
      el("span", { class: "po-event-col status" }, ["Transfer"]),
    ]),
  );
  for (const evt of events) {
    const log = paymentLog?.[evt.id] || {};
    const payment = log.paymentId ? paymentMap.get(log.paymentId) : null;
    const status = log.status === "paid" || payment ? "paid" : "open";
    const statusLabel = status === "paid" ? "Bezahlt" : "Offen";
    const paymentLabel = payment?.id || log.paymentId || "—";
    wrapper.append(
      el("div", { class: "po-event-row" }, [
        el("span", { class: "po-event-col" }, [evt.label]),
        el("span", { class: "po-event-col" }, [fmtDateDE(evt.due || evt.date)]),
        el("span", { class: "po-event-col amount" }, [fmtEUR(evt.amount)]),
        el("span", { class: "po-event-col status" }, [
          el("span", { class: `po-status-pill ${status === "paid" ? "is-paid" : "is-open"}` }, [statusLabel]),
        ]),
        el("span", { class: "po-event-col status" }, [
          paymentLabel ? el("span", { class: "po-transaction-pill" }, [paymentLabel]) : "—",
        ]),
      ]),
    );
  }
  return wrapper;
}

function renderList(container, records, config, onEdit, onDelete, options = {}) {
  if (config.slug === "po") {
    renderPoList(container, records, config, onEdit, onDelete, options);
    return;
  }
  container.innerHTML = "";
  refreshProductCache();
  const settings = getSettings();
  const rows = Array.isArray(records) ? records : [];
  for (const rec of rows) normaliseGoodsFields(rec, settings);
  const listRows = rows.map(rec => {
    const totals = computeGoodsTotals(rec, settings);
    return { rec, totals };
  });
  const columns = [
    { key: "number", label: `${config.entityLabel}-Nr.` },
    ...((config.slug === "po" || config.slug === "fo") ? [{ key: "product", label: "Produkt" }] : []),
    { key: "order", label: "Order" },
    { key: "timeline", label: "Timeline" },
    { key: "units", label: "Stück", className: "num" },
    { key: "usd", label: "Summe USD", className: "num" },
    { key: "freight", label: "Fracht (€)", className: "num" },
    { key: "payments", label: "Zahlungen" },
    { key: "transport", label: "Transport" },
    { key: "actions", label: "Aktionen" },
  ];
  const table = createDataTable({
    columns,
    rows: listRows,
    rowKey: row => row.rec.id,
    renderCell: (row, col) => {
      const rec = row.rec;
      switch (col.key) {
        case "number":
          return rec[config.numberField] || "—";
        case "product":
          return formatSkuSummary(rec);
        case "order":
          return fmtDateDE(rec.orderDate);
        case "timeline":
          return formatTimelineSummary(rec, settings);
        case "units":
          return Number(row.totals.units || 0).toLocaleString("de-DE");
        case "usd":
          return fmtUSD(row.totals.usd);
        case "freight":
          return fmtEUR(resolveFreightTotal(rec, row.totals));
        case "payments":
          return String((rec.milestones || []).length);
        case "transport":
          return `${rec.transport || "sea"} · ${rec.transitDays || 0}d`;
        case "actions":
          return el("div", { class: "table-actions" }, [
            el("button", { class: "btn", onclick: () => onEdit(rec) }, ["Bearbeiten"]),
            el("button", { class: "btn danger", onclick: () => onDelete(rec) }, ["Löschen"]),
          ]);
        default:
          return "—";
      }
    },
  });
  container.append(table);
}

function renderPoList(container, records, config, onEdit, onDelete, options = {}) {
  container.innerHTML = "";
  refreshProductCache();
  const settings = getSettings();
  const rows = Array.isArray(records) ? records : [];
  rows.forEach(rec => {
    normaliseGoodsFields(rec, settings);
    normaliseArchiveFlag(rec);
  });
  const searchTerm = String(options.searchTerm || "").trim().toLowerCase();
  const showArchived = options.showArchived === true;
  const filtered = rows.filter(rec => {
    if (!showArchived && rec.archived) return false;
    if (!searchTerm) return true;
    const items = Array.isArray(rec.items) ? rec.items : [];
    const labels = items.map(item => {
      const sku = item?.sku || "";
      const match = productCache.find(prod => prod?.sku?.trim().toLowerCase() === String(sku).trim().toLowerCase());
      return [sku, match?.alias || ""].filter(Boolean).join(" ");
    });
    const haystack = [
      rec[config.numberField],
      rec.sku,
      rec.supplier,
      ...labels,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchTerm);
  });
  const listRows = filtered.map(rec => ({
    rec,
    totals: computeGoodsTotals(rec, settings),
    freightEstimate: computeEstimatedFreightTotals(rec, settings),
  }));
  const sortKey = options.sortKey;
  const sortDir = options.sortDir;
  if (sortKey && sortDir) {
    const dir = sortDir === "desc" ? -1 : 1;
    listRows.sort((a, b) => {
      const recA = a.rec;
      const recB = b.rec;
      const val = (key) => {
        switch (key) {
          case "number":
            return String(recA[config.numberField] || "");
          case "order":
            return recA.orderDate || "";
          case "supplier":
            return String(recA.supplier || "");
          case "usd":
            return Number(a.totals.usd || 0);
          case "freight":
            return Number(resolveFreightTotal(recA, a.totals) || 0);
          case "estFreight":
            return Number(a.freightEstimate?.total || 0);
          case "payments":
            return (recA.milestones || []).length;
          case "transport":
            return String(recA.transport || "");
          default:
            return "";
        }
      };
      const valB = (key) => {
        switch (key) {
          case "number":
            return String(recB[config.numberField] || "");
          case "order":
            return recB.orderDate || "";
          case "supplier":
            return String(recB.supplier || "");
          case "usd":
            return Number(b.totals.usd || 0);
          case "freight":
            return Number(resolveFreightTotal(recB, b.totals) || 0);
          case "estFreight":
            return Number(b.freightEstimate?.total || 0);
          case "payments":
            return (recB.milestones || []).length;
          case "transport":
            return String(recB.transport || "");
          default:
            return "";
        }
      };
      const aVal = val(sortKey);
      const bVal = valB(sortKey);
      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
  }

  const table = el("table", { class: "table-compact" });
  const sortToggle = (key) => {
    if (!options.onUpdate) return;
    const nextDir = sortKey !== key ? "asc" : (sortDir === "asc" ? "desc" : (sortDir === "desc" ? null : "asc"));
    options.onUpdate({ sortKey: nextDir ? key : null, sortDir: nextDir });
  };
  const sortIcon = (key) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { style: "width:90px" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("number") }, ["PO-Nr. ", sortIcon("number")]),
      ]),
      el("th", { style: "width:160px" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("supplier") }, ["Lieferant ", sortIcon("supplier")]),
      ]),
      el("th", { style: "width:200px" }, ["Produkt/Items"]),
      el("th", { style: "width:110px" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("order") }, ["Bestelldatum ", sortIcon("order")]),
      ]),
      el("th", { style: "width:180px" }, ["Timeline"]),
      el("th", { style: "width:80px", class: "num" }, ["Stück"]),
      el("th", { style: "width:110px", class: "num" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("usd") }, ["Summe USD ", sortIcon("usd")]),
      ]),
      el("th", { style: "width:110px", class: "num" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("freight") }, ["Fracht (€) ", sortIcon("freight")]),
      ]),
      el("th", { style: "width:140px", class: "num" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("estFreight") }, ["Geschätzte Fracht (€) ", sortIcon("estFreight")]),
      ]),
      el("th", { style: "width:120px" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("payments") }, ["Zahlungen ", sortIcon("payments")]),
      ]),
      el("th", { style: "width:120px" }, [
        el("button", { class: "po-sort-btn", type: "button", onclick: () => sortToggle("transport") }, ["Transport ", sortIcon("transport")]),
      ]),
      el("th", { style: "width:120px" }, ["Aktionen"]),
    ]),
  ]);
  const tbody = el("tbody");
  table.append(thead, tbody);

  function renderPaymentBadges(rec) {
    const milestones = Array.isArray(rec.milestones) ? rec.milestones : [];
    const log = rec.paymentLog || {};
    if (!milestones.length) return el("span", { class: "muted" }, ["—"]);
    const wrap = el("div", { class: "po-payment-badges" });
    milestones.forEach(ms => {
      const label = (ms.label || "Z").trim();
      const badgeLabel = label.split(" ")[0].slice(0, 3);
      const paid = log?.[ms.id]?.status === "paid";
      wrap.append(el("span", {
        class: `po-payment-badge ${paid ? "is-paid" : "is-open"}`,
        title: label,
      }, [badgeLabel]));
    });
    return wrap;
  }

  function updateArchive(rec, archived) {
    const st = loadAppState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    const idx = arr.findIndex(item => item?.id === rec.id || item?.[config.numberField] === rec[config.numberField]);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], archived };
      st[config.entityKey] = arr;
      commitAppState(st, { source: `${config.slug}:archive`, entityKey: `${config.slug}:${rec[config.numberField] || rec.id}`, action: "update" });
      if (typeof options.onUpdate === "function") options.onUpdate();
    }
  }

  if (!listRows.length) {
    tbody.append(el("tr", {}, [
      el("td", { colspan: "12", class: "muted" }, ["Keine Bestellungen gefunden."]),
    ]));
    container.append(table);
    return;
  }

  listRows.forEach(({ rec, totals, freightEstimate }) => {
    const productSummary = formatSkuSummary(rec);
    const productTooltip = formatProductTooltip(rec);
    const timeline = formatTimelineCompact(rec, settings);
    const transport = `${rec.transport || "sea"} · ${rec.transitDays || 0}d`;
    const row = el("tr", {}, [
      el("td", { class: "cell-ellipsis", title: rec[config.numberField] || "—" }, [rec[config.numberField] || "—"]),
      el("td", { class: "cell-ellipsis", title: rec.supplier || "—" }, [rec.supplier || "—"]),
      el("td", { class: "cell-ellipsis", title: productTooltip }, [productSummary || "—"]),
      el("td", { class: "cell-ellipsis", title: fmtDateDE(rec.orderDate) }, [fmtDateDE(rec.orderDate)]),
      el("td", { class: "cell-ellipsis", title: timeline }, [timeline]),
      el("td", { class: "cell-ellipsis num", title: String(totals.units || 0) }, [Number(totals.units || 0).toLocaleString("de-DE")]),
      el("td", { class: "cell-ellipsis num", title: fmtUSD(totals.usd) }, [fmtUSD(totals.usd)]),
      el("td", { class: "cell-ellipsis num", title: fmtEUR(resolveFreightTotal(rec, totals)) }, [fmtEUR(resolveFreightTotal(rec, totals))]),
      el("td", { class: "cell-ellipsis num", title: fmtEUR(freightEstimate?.total || 0) }, [
        fmtEUR(freightEstimate?.total || 0),
      ]),
      el("td", { class: "cell-ellipsis", title: "Zahlungen" }, [renderPaymentBadges(rec)]),
      el("td", { class: "cell-ellipsis", title: transport }, [transport]),
      el("td", { class: "cell-ellipsis" }, [
        el("div", { class: "po-table-actions" }, [
          el("button", { class: "btn sm", type: "button", title: "Bearbeiten", onclick: () => onEdit(rec) }, ["Bearbeiten"]),
          el("button", {
            class: "btn sm secondary",
            type: "button",
            title: rec.archived ? "Reaktivieren" : "Archivieren",
            onclick: () => updateArchive(rec, !rec.archived),
          }, [rec.archived ? "Aktivieren" : "Archivieren"]),
          el("button", { class: "btn sm danger", type: "button", title: "Löschen", onclick: () => onDelete(rec) }, ["Löschen"]),
        ]),
      ]),
    ]);
    tbody.append(row);
  });

  container.append(table);
}

function renderItemsTable(container, record, onChange, dataListId) {
  if (!container) return;
  refreshProductCache();
  ensureItems(record);
  const estimate = updateDerivedFreight(record, getSettings());
  const lineMap = new Map();
  estimate?.lines?.forEach(line => {
    if (line.id) lineMap.set(line.id, line);
    if (line.sku) lineMap.set(`sku:${String(line.sku).toLowerCase()}`, line);
  });
  container.innerHTML = "";
  const updateMissingIndicator = (input, missing) => {
    if (!input) return;
    input.classList.toggle("is-missing", missing);
    input.title = missing ? "Stückpreis fehlt im Produktstamm" : "";
  };
  const applyAutoUnitCost = (item, input, { force } = {}) => {
    if (!item || !input) return;
    if (item.unitCostManuallyEdited) return;
    const current = parseDE(item.unitCostUsd);
    const hasExisting = Number.isFinite(current) && current > 0;
    if (hasExisting && !force) {
      updateMissingIndicator(input, false);
      return;
    }
    const price = resolveProductUnitPrice(item.sku);
    if (price != null) {
      item.unitCostUsd = fmtCurrencyInput(price);
      input.value = item.unitCostUsd;
      updateMissingIndicator(input, false);
    } else if (item.sku) {
      item.unitCostUsd = "";
      input.value = "";
      updateMissingIndicator(input, true);
    } else {
      updateMissingIndicator(input, false);
    }
  };
  const header = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["SKU"]),
      el("th", {}, ["Stück"]),
      el("th", {}, ["Stückkosten (USD)"]),
      el("th", {}, ["Zusatz/ Stück (USD)"]),
      el("th", {}, ["Pauschal (USD)"]),
      el("th", {}, ["Fracht / Stk (EUR)"]),
      el("th", {}, [""])
    ])
  ]);
  const body = el("tbody");
  const dl = el("datalist", { id: dataListId });
  productCache.forEach(prod => {
    dl.append(el("option", { value: prod.sku, label: prod.alias ? `${prod.alias}` : prod.sku }));
  });

  record.items.forEach(item => {
    const row = el("tr", { dataset: { itemId: item.id, unitCostManual: item.unitCostManuallyEdited ? "true" : "false" } });
    const skuAttrs = item.type === "misc"
      ? { value: item.sku || "", placeholder: "Freie Position" }
      : { list: dataListId, value: item.sku || "", placeholder: "SKU" };
    const skuInput = el("input", skuAttrs);

    const unitsInput = el("input", { type: "number", min: "0", step: "1", value: item.units || "0" });
    unitsInput.addEventListener("input", () => { item.units = unitsInput.value; onChange(); });

    const unitCostInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.unitCostUsd ?? "0,00"), placeholder: "0,00" });
    applyAutoUnitCost(item, unitCostInput, { force: false });
    unitCostInput.addEventListener("blur", () => {
      item.unitCostUsd = fmtCurrencyInput(unitCostInput.value);
      unitCostInput.value = item.unitCostUsd;
      item.unitCostManuallyEdited = unitCostInput.value !== "";
      row.dataset.unitCostManual = item.unitCostManuallyEdited ? "true" : "false";
      updateMissingIndicator(unitCostInput, false);
      onChange();
    });
    unitCostInput.addEventListener("input", () => {
      item.unitCostUsd = unitCostInput.value;
      item.unitCostManuallyEdited = true;
      row.dataset.unitCostManual = "true";
      updateMissingIndicator(unitCostInput, false);
    });

    skuInput.addEventListener("input", () => { item.sku = skuInput.value.trim(); onChange(); });
    skuInput.addEventListener("change", () => {
      item.sku = skuInput.value.trim();
      applyAutoUnitCost(item, unitCostInput, { force: true });
      onChange();
    });
    skuInput.addEventListener("blur", () => {
      item.sku = skuInput.value.trim();
      applyAutoUnitCost(item, unitCostInput, { force: true });
      onChange();
    });

    const unitExtraInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.unitExtraUsd ?? "0,00"), placeholder: "0,00" });
    unitExtraInput.addEventListener("blur", () => { item.unitExtraUsd = fmtCurrencyInput(unitExtraInput.value); unitExtraInput.value = item.unitExtraUsd; onChange(); });
    unitExtraInput.addEventListener("input", () => { item.unitExtraUsd = unitExtraInput.value; });

    const flatInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.extraFlatUsd ?? "0,00"), placeholder: "0,00" });
    flatInput.addEventListener("blur", () => { item.extraFlatUsd = fmtCurrencyInput(flatInput.value); flatInput.value = item.extraFlatUsd; onChange(); });
    flatInput.addEventListener("input", () => { item.extraFlatUsd = flatInput.value; });

    const line = lineMap.get(item.id) || lineMap.get(`sku:${String(item.sku || "").toLowerCase()}`) || null;
    const logisticsCell = buildLogisticsCell(line);

    const removeBtn = el("button", { class: "btn danger", type: "button" }, ["✕"]);
    removeBtn.addEventListener("click", () => {
      if ((record.items || []).length <= 1) return;
      record.items = record.items.filter(it => it.id !== item.id);
      renderItemsTable(container, record, onChange, dataListId);
      onChange();
    });

    row.append(
      el("td", {}, [skuInput]),
      el("td", {}, [unitsInput]),
      el("td", {}, [unitCostInput]),
      el("td", {}, [unitExtraInput]),
      el("td", {}, [flatInput]),
      el("td", { dataset: { logisticsCell: "true" } }, [logisticsCell]),
      el("td", {}, [removeBtn]),
    );
    body.append(row);
  });

  const table = el("table", { class: "po-items-table" }, [header, body]);
  container.append(table, dl);
}

function buildLogisticsCell(line) {
  const logisticsValue = line?.derivedLogisticsPerUnitEur;
  const logisticsDisplay = logisticsValue != null ? fmtEURPlain(logisticsValue) : "—";
  const tooltipRows = formatAutoFreightTooltip(line);
  const logisticsTooltip = el("span", { class: "tooltip" }, [
    el("button", { class: "tooltip-trigger", type: "button", "aria-label": "Fracht Details" }, ["ℹ️"]),
    el("span", { class: "tooltip-content" }, tooltipRows.map(row => el("div", {}, [row]))),
  ]);
  const hasMissing = line?.issues?.includes("MISSING_LANDED_COST");
  const hasNegative = line?.issues?.includes("NEGATIVE_DERIVED_LOGISTICS");
  const warningText = hasMissing
    ? "Einstandskosten fehlen"
    : (hasNegative ? "Einstand < Warenwert (FX/EK prüfen)" : "");
  const warningIcon = warningText ? el("span", { class: "cell-warning", title: warningText }, ["⚠︎"]) : null;
  return el("div", { class: "po-logistics-cell" }, [
    el("span", { class: "num" }, [logisticsDisplay]),
    warningIcon,
    logisticsTooltip,
  ]);
}

function updateLogisticsCells(container, estimate) {
  if (!container || !estimate) return;
  const lineMap = new Map();
  estimate?.lines?.forEach(line => {
    if (line.id) lineMap.set(line.id, line);
    if (line.sku) lineMap.set(`sku:${String(line.sku).toLowerCase()}`, line);
  });
  const rows = Array.from(container.querySelectorAll("[data-item-id]"));
  rows.forEach(row => {
    const cell = row.querySelector("[data-logistics-cell]");
    if (!cell) return;
    const itemId = row.dataset.itemId;
    const skuInput = row.querySelector("input");
    const skuValue = skuInput?.value?.trim() || "";
    const line = lineMap.get(itemId) || lineMap.get(`sku:${skuValue.toLowerCase()}`) || null;
    cell.innerHTML = "";
    cell.append(buildLogisticsCell(line));
  });
}

function computeTimeline(record, settings = getSettings()) {
  if (!record) return null;
  const order = parseISOToDate(record.orderDate) || null;
  if (!order) return null;
  const prodDays = Math.max(0, Number(record.prodDays || 0));
  const transitDays = Math.max(0, Number(record.transitDays || 0));
  const blackout = applyCnyBlackout(order, prodDays, settings);
  const prodDone = blackout.prodDone ?? addDays(order, prodDays);
  const etdComputed = prodDone;
  const etaComputed = addDays(etdComputed, transitDays);
  const etdManual = parseISOToDate(record.etdManual);
  const etaManual = parseISOToDate(record.etaManual);
  const etd = etdManual || etdComputed;
  const eta = etaManual || etaComputed;
  const totalDays = Math.max(prodDays + transitDays + (blackout.adjustmentDays || 0), 1);
  return {
    order,
    prodDone,
    etd,
    eta,
    etdComputed,
    etaComputed,
    etdManual,
    etaManual,
    prodDays,
    transitDays,
    totalDays,
    cnyAdjustmentDays: blackout.adjustmentDays || 0,
    cnyStart: blackout.cnyStart,
    cnyEnd: blackout.cnyEnd,
  };
}

function formatTimelineSummary(record, settings) {
  const timeline = computeTimeline(record, settings);
  if (!timeline) return "—";
  return [
    `Order ${fmtDateDE(timeline.order)}`,
    `ETD ${fmtDateDE(timeline.etd)}`,
    `ETA ${fmtDateDE(timeline.eta)}`,
  ].join(" • ");
}

function formatTimelineCompact(record, settings) {
  const timeline = computeTimeline(record, settings);
  if (!timeline) return "—";
  return `ETD ${fmtDateDE(timeline.etd)} • ETA ${fmtDateDE(timeline.eta)}`;
}

function formatProductTooltip(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (!items.length) return record?.sku || "—";
  const labels = items.map(item => {
    const sku = item?.sku || "";
    const match = productCache.find(prod => prod?.sku?.trim().toLowerCase() === String(sku).trim().toLowerCase());
    if (!match) return sku || "—";
    return match.alias ? `${match.alias} (${match.sku})` : match.sku;
  });
  return labels.filter(Boolean).join(", ");
}

function normaliseArchiveFlag(record) {
  if (!record) return;
  if (record.archived == null) record.archived = false;
}

function transportIcon(transport) {
  if (transport === "air") return "✈️";
  if (transport === "rail") return "🚆";
  return "🚢";
}

function renderTimeline(timelineNode, summaryNode, record, settings, cnyBannerNode) {
  if (!timelineNode || !summaryNode) return;
  const timeline = computeTimeline(record, settings);
  summaryNode.innerHTML = "";
  timelineNode.innerHTML = "";
  if (cnyBannerNode) {
    cnyBannerNode.innerHTML = "";
    cnyBannerNode.hidden = true;
  }

  if (!timeline) {
    summaryNode.append(el("span", { class: "muted" }, ["Bitte gültiges Bestelldatum eingeben."]));
    return;
  }

  const summary = el("div", { class: "po-timeline-summary-items" }, [
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["Order"]), " ", fmtDateDE(timeline.order)]),
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["ETD"]), " ", fmtDateDE(timeline.etd)]),
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["ETA"]), " ", fmtDateDE(timeline.eta)]),
  ]);
  summaryNode.append(summary);
  if (cnyBannerNode && timeline.cnyAdjustmentDays > 0) {
    const startText = timeline.cnyStart ? fmtDateDE(timeline.cnyStart) : "—";
    const endText = timeline.cnyEnd ? fmtDateDE(timeline.cnyEnd) : "—";
    cnyBannerNode.textContent = `CNY berücksichtigt: +${timeline.cnyAdjustmentDays} Tage Produktionspause. ETD/ETA angepasst. (${startText} – ${endText})`;
    cnyBannerNode.hidden = false;
  }

  const track = el("div", { class: "po-timeline-track" });
  track.append(el("div", { class: "po-timeline-base" }));

  const segments = el("div", { class: "po-timeline-segments" });
  const total = timeline.totalDays;
  const prodPctRaw = total ? (timeline.prodDays / total) * 100 : 0;
  const transitPctRaw = total ? (timeline.transitDays / total) * 100 : 0;
  const prodPct = Math.max(0, Math.min(100, prodPctRaw));
  const transitPct = Math.max(0, Math.min(100, transitPctRaw));

  if (timeline.prodDays > 0) {
    segments.append(el("div", {
      class: "po-timeline-segment production",
      style: `left:0%; width:${prodPct}%`,
    }, [
      el("span", { class: "po-timeline-segment-icon", "aria-hidden": "true" }, ["🏭"]),
      el("span", { class: "sr-only" }, [`Produktion ${timeline.prodDays} Tage`]),
    ]));
  }

  if (timeline.transitDays > 0) {
    const start = prodPct;
    segments.append(el("div", {
      class: "po-timeline-segment transit",
      style: `left:${start}% ; width:${transitPct}%`,
    }, [
      el("span", { class: "po-timeline-segment-icon", "aria-hidden": "true" }, [transportIcon(record.transport)]),
      el("span", { class: "sr-only" }, [`Transport ${timeline.transitDays} Tage`]),
    ]));
  }

  track.append(segments);

  const markers = el("div", { class: "po-timeline-markers" });
  const addMarker = (label, date, percent, align, extraClass = "") => {
    const marker = el("div", {
      class: `po-timeline-marker po-timeline-marker-${align}${extraClass ? ` ${extraClass}` : ""}`,
      style: `left:${percent}%`,
    }, [
      el("span", { class: "po-timeline-dot" }),
      el("span", { class: "po-timeline-marker-label" }, [
        el("strong", {}, [label]),
        el("span", {}, [fmtDateDE(date)]),
      ]),
    ]);
    markers.append(marker);
  };

  addMarker("Order", timeline.order, 0, "start");
  const middleAlign = prodPct <= 10 ? "start" : (prodPct >= 90 ? "end" : "center");
  addMarker("ETD", timeline.etd, prodPct, middleAlign);
  addMarker("ETA", timeline.eta, 100, "end");

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = (today.getTime() - timeline.order.getTime()) / msPerDay;
  const clampedDays = Math.max(0, Math.min(timeline.totalDays, diffDays));
  const todayPct = timeline.totalDays ? (clampedDays / timeline.totalDays) * 100 : 0;
  const currentAlign = todayPct <= 10 ? "start" : (todayPct >= 90 ? "end" : "center");
  addMarker("Heute", today, todayPct, currentAlign, "po-timeline-marker-current");

  track.append(markers);
  timelineNode.append(track);
}

function renderMsTable(container, record, config, onChange, focusInfo, settings) {
  container.innerHTML = "";
  container.append(el("div", { class: "muted", style: "margin-bottom:6px" }, ["Zahlungsmeilensteine & Importkosten"]));

  ensureAutoEvents(record, settings, record.milestones || []);
  const previewEvents = orderEvents(JSON.parse(JSON.stringify(record)), config, settings);
  const previewMap = new Map(previewEvents.map(evt => [evt.id, evt]));

  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Label"]),
        el("th", {}, ["%"]),
        el("th", {}, ["Anker"]),
        el("th", {}, ["Lag (Einheit)"]),
        el("th", {}, ["Datum"]),
        el("th", {}, ["Betrag (€)"]),
        el("th", {}, ["Aktion"]),
      ]),
    ]),
  ]);

  const tbody = el("tbody", {});
  table.append(tbody);

  const totals = computeGoodsTotals(record, settings);
  const goods = totals.eur || parseDE(record.goodsEur);

  (record.milestones || []).forEach((ms, index) => {
    const computed = previewMap.get(ms.id);
    const dueText = fmtDateDE(computed?.due || computed?.date);
    const amount = computed?.amount ?? -(goods * (clampPct(ms.percent) / 100));

    const row = el("tr", { dataset: { msId: ms.id } }, [
      el("td", {}, [
        el("input", {
          value: ms.label || "",
          dataset: { field: "label" },
          oninput: (e) => { ms.label = e.target.value; onChange(); },
          onblur: (e) => { ms.label = e.target.value.trim(); onChange(); },
        }),
      ]),
      el("td", {}, [
        el("input", {
          type: "text",
          inputmode: "decimal",
          value: fmtPercent(ms.percent ?? 0),
          dataset: { field: "percent" },
          oninput: (e) => { ms.percent = e.target.value; onChange(); },
          onblur: (e) => {
            const next = clampPct(e.target.value);
            ms.percent = next;
            e.target.value = fmtPercent(next);
            onChange();
          },
        }),
      ]),
      el("td", {}, [
        (() => {
          const select = el("select", { dataset: { field: "anchor" }, onchange: (e) => { ms.anchor = e.target.value; onChange(); } }, [
            el("option", { value: "ORDER_DATE" }, ["ORDER_DATE"]),
            el("option", { value: "PROD_DONE" }, ["PROD_DONE"]),
            el("option", { value: "ETD" }, ["ETD"]),
            el("option", { value: "ETA" }, ["ETA"]),
          ]);
          select.value = ms.anchor || "ORDER_DATE";
          return select;
        })(),
      ]),
      el("td", {}, [
        el("div", { class: "lag-field" }, [
          el("input", {
            type: "number",
            value: String(ms.lagDays || 0),
            dataset: { field: "lag" },
            oninput: (e) => { ms.lagDays = Number(e.target.value || 0); onChange(); },
            onblur: (e) => {
              const next = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
              e.target.value = String(next);
              ms.lagDays = next;
              onChange();
            },
          }),
          el("span", { class: "muted" }, ["Tage"]),
        ]),
      ]),
      el("td", { dataset: { role: "ms-date" } }, [dueText]),
      el("td", { dataset: { role: "ms-amount" } }, [fmtEUR(amount)]),
      el("td", {}, [
        el("button", { class: "btn danger", onclick: () => { record.milestones.splice(index, 1); onChange(); } }, ["Entfernen"]),
      ]),
    ]);
    tbody.append(row);
  });

  (record.autoEvents || []).forEach((autoEvt) => {
    const computed = previewMap.get(autoEvt.id);
    const fallbackAmount = autoEvt.type === "freight"
      ? -(resolveFreightTotal(record, totals) || 0)
      : 0;
    const dueText = fmtDateDE(computed?.due || computed?.date);
    const amount = computed?.amount ?? fallbackAmount;
    const active = autoEvt.enabled !== false;
    const lagValue = autoEvt.type === "vat_refund"
      ? Number(autoEvt.lagMonths ?? record.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0)
      : Number(autoEvt.lagDays || 0);

    const row = el("tr", { dataset: { msId: autoEvt.id }, class: `auto-ms${active ? "" : " disabled"}` }, [
      el("td", {}, [
        el("input", {
          value: autoEvt.label || "",
          dataset: { field: "label" },
          oninput: (e) => { autoEvt.label = e.target.value; onChange(); },
          onblur: (e) => { autoEvt.label = e.target.value.trim(); onChange(); },
        }),
      ]),
      autoEvt.type === "freight"
        ? el("td", {}, [el("span", { class: "muted" }, ["—"])])
        : el("td", {}, [
            el("input", {
              type: "text",
              inputmode: "decimal",
              value: fmtPercent(autoEvt.percent ?? 0),
              dataset: { field: "percent" },
              oninput: (e) => { autoEvt.percent = e.target.value; onChange(); },
              onblur: (e) => {
                const next = clampPct(e.target.value);
                autoEvt.percent = next;
                e.target.value = fmtPercent(next);
                onChange();
              },
            }),
          ]),
      el("td", {}, [
        (() => {
          const select = el("select", { dataset: { field: "anchor" }, onchange: (e) => { autoEvt.anchor = e.target.value; onChange(); } }, [
            el("option", { value: "ORDER_DATE" }, ["ORDER_DATE"]),
            el("option", { value: "PROD_DONE" }, ["PROD_DONE"]),
            el("option", { value: "ETD" }, ["ETD"]),
            el("option", { value: "ETA" }, ["ETA"]),
          ]);
          select.value = autoEvt.anchor || "ETA";
          return select;
        })(),
      ]),
      el("td", {}, [
        el("div", { class: "lag-field" }, [
          autoEvt.type === "vat_refund"
            ? el("input", {
                type: "number",
                min: "0",
                value: String(lagValue),
                dataset: { field: "lagMonths" },
                oninput: (e) => { autoEvt.lagMonths = Number(e.target.value || 0); onChange(); },
              })
            : el("input", {
                type: "number",
                value: String(lagValue),
                dataset: { field: "lag" },
                oninput: (e) => { autoEvt.lagDays = Number(e.target.value || 0); onChange(); },
                onblur: (e) => {
                  const next = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
                  e.target.value = String(next);
                  autoEvt.lagDays = next;
                  onChange();
                },
              }),
          el("span", { class: "muted" }, [autoEvt.type === "vat_refund" ? "Monate" : "Tage"]),
        ]),
      ]),
      el("td", { dataset: { role: "ms-date" } }, [dueText]),
      el("td", { dataset: { role: "ms-amount" } }, [fmtEUR(amount)]),
      el("td", {}, [
        el("label", { class: "inline-checkbox" }, [
          el("input", {
            type: "checkbox",
            checked: active,
            onchange: (e) => {
              const checked = e.target.checked;
              autoEvt.enabled = checked;
              if (!checked) autoEvt._ddpEnabledBackup = false;
              else delete autoEvt._ddpEnabledBackup;
              onChange();
            },
          }),
          " Aktiv",
        ]),
      ]),
    ]);

    tbody.append(row);
  });

  container.append(table);

  const addBtn = el("button", {
    class: "btn",
    style: "margin-top:8px",
    onclick: () => {
      const nextIndex = (record.milestones || []).length;
      const id = Math.random().toString(36).slice(2, 9);
      record.milestones.push({ id, label: `Milestone ${nextIndex + 1}`, percent: 0, anchor: "ETA", lagDays: 0 });
      onChange({ focusInfo: { id, field: "label" } });
    },
  }, ["+ Zahlung hinzufügen"]);
  container.append(addBtn);

  const sum = msSum100(record.milestones);
  const warn = sum !== 100;
  const note = el("div", {
    dataset: { role: "ms-sum" },
    style: `margin-top:8px;font-weight:600;${warn ? "color:#c23636" : "color:#0f9960"}`,
  }, [warn ? `Summe: ${sum}% — Bitte auf 100% anpassen.` : "Summe: 100% ✓"]);
  container.append(note);

  const payments = buildPaymentRows(record, config, settings, getMergedPayments(record));
  ensurePaymentLog(record);

  const paymentSection = el("div", { class: "po-payments-section" }, [
    el("h4", {}, ["Zahlungen"]),
    el("p", { class: "muted" }, ["Markiere Zahlungen als bezahlt und ergänze Ist-Daten für die Buchhaltung."]),
  ]);

  const paymentTable = el("table", { class: "po-payments-table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Typ"]),
        el("th", {}, ["Fällig am"]),
        el("th", {}, ["Geplant (EUR)"]),
        el("th", {}, ["Status"]),
        el("th", {}, ["Bezahlt am"]),
        el("th", {}, ["Ist (EUR)"]),
        el("th", {}, ["Methode"]),
        el("th", {}, ["Paid by"]),
        el("th", {}, ["Transfer"]),
        el("th", {}, ["Dateiname (Vorschlag)"]),
        el("th", {}, ["Aktion"]),
      ]),
    ]),
  ]);
  const paymentBody = el("tbody");
  paymentTable.append(paymentBody);

  function openPaymentModal(payment) {
    const debugForms = typeof window !== "undefined" && window.__DEBUG_FORMS__ === true;
    const mergedPayments = getMergedPayments(record);
    const allPayments = buildPaymentRows(record, config, settings, mergedPayments);
    const existingLog = payment ? (record.paymentLog?.[payment.id] || {}) : {};
    const initialPaymentId = existingLog.paymentId || payment?.paymentId || null;
    const paymentRecord = initialPaymentId
      ? mergedPayments.find(entry => entry?.id === initialPaymentId) || null
      : null;
    const currentPaymentId = paymentRecord?.id || initialPaymentId || null;
    const selectedIds = new Set();

    const paidDate = paymentRecord?.paidDate || existingLog.paidDate || new Date().toISOString().slice(0, 10);
    const methodValue = paymentRecord?.method || existingLog.method || "";
    const paidByValue = paymentRecord?.payer || existingLog.payer || "";
    const noteValue = paymentRecord?.note || existingLog.note || "";
    const transferValue = paymentRecord?.id || existingLog.paymentId || "";
    const invoiceUrlValue = paymentRecord?.invoiceDriveUrl || "";
    const folderUrlValue = paymentRecord?.invoiceFolderDriveUrl || "";

    const paidDateInput = el("input", { type: "date", value: paidDate });
    const methodSelect = el("select", {}, [
      el("option", { value: "" }, ["—"]),
      el("option", { value: "Alibaba Trade Assurance" }, ["Alibaba Trade Assurance"]),
      el("option", { value: "Wise/Transferwise" }, ["Wise/Transferwise"]),
      el("option", { value: "PayPal" }, ["PayPal"]),
      el("option", { value: "Bank Transfer" }, ["Bank Transfer"]),
      el("option", { value: "Credit Card" }, ["Credit Card"]),
      el("option", { value: "Other" }, ["Other"]),
    ]);
    if (methodValue && !Array.from(methodSelect.options).some(option => option.value === methodValue)) {
      methodSelect.append(el("option", { value: methodValue }, [methodValue]));
    }
    methodSelect.value = methodValue;

    const paidBySelect = el("select", {}, [
      el("option", { value: "" }, ["—"]),
      el("option", { value: "Pierre" }, ["Pierre"]),
      el("option", { value: "Patrick" }, ["Patrick"]),
    ]);
    if (paidByValue && !Array.from(paidBySelect.options).some(option => option.value === paidByValue)) {
      paidBySelect.append(el("option", { value: paidByValue }, [paidByValue]));
    }
    paidBySelect.value = paidByValue;

    const actualInput = el("input", { type: "text", inputmode: "decimal", placeholder: "0,00" });
    if (Number.isFinite(Number(paymentRecord?.amountActualEurTotal))) {
      actualInput.value = formatMoneyDE(Number(paymentRecord.amountActualEurTotal), 2);
    } else if (Number.isFinite(Number(payment?.paidEurActual))) {
      actualInput.value = formatMoneyDE(Number(payment.paidEurActual), 2);
    }
    const noteInput = el("textarea", { rows: "2", placeholder: "Notiz (optional)" }, [noteValue]);
    const paymentIdInput = el("input", { type: "text", placeholder: "pay-..." });
    paymentIdInput.value = transferValue;
    const invoiceUrlInput = el("input", { type: "url", placeholder: "https://drive.google.com/..." });
    invoiceUrlInput.value = invoiceUrlValue;
    const folderUrlInput = el("input", { type: "url", placeholder: "https://drive.google.com/..." });
    folderUrlInput.value = folderUrlValue;
    const invoiceBtn = el("a", { class: "btn secondary sm", target: "_blank", rel: "noopener noreferrer" }, ["Open Invoice"]);
    const folderBtn = el("a", { class: "btn secondary sm", target: "_blank", rel: "noopener noreferrer" }, ["Open Folder"]);

    const selectedSummary = el("div", { class: "po-payment-summary muted" });
    const allocationTable = el("table", { class: "table po-payment-allocation" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["Event"]),
          el("th", {}, ["Geplant (EUR)"]),
          el("th", {}, ["Ist (EUR)"]),
        ]),
      ]),
    ]);
    const allocationBody = el("tbody");
    allocationTable.append(allocationBody);

    function renderAllocation() {
      allocationBody.innerHTML = "";
      const selectedEvents = allPayments.filter(evt => selectedIds.has(evt.id));
      if (!selectedEvents.length) {
        allocationBody.append(el("tr", {}, [
          el("td", { colspan: "3", class: "muted" }, ["Bitte Events auswählen, um die Aufteilung zu sehen."]),
        ]));
        return;
      }
      const total = parseMoneyInput(actualInput.value);
      const allocations = Number.isFinite(total) ? allocatePayment(total, selectedEvents) : null;
      selectedEvents.forEach(evt => {
        const allocation = allocations?.find(entry => entry.eventId === evt.id);
        allocationBody.append(el("tr", {}, [
          el("td", {}, [evt.label]),
          el("td", {}, [fmtEURPlain(evt.plannedEur)]),
          el("td", {}, [allocation ? formatMoneyDE(allocation.actual, 2) : "—"]),
        ]));
      });
    }

    function updateSummary() {
      const selectedEvents = allPayments.filter(evt => selectedIds.has(evt.id));
      const planned = selectedEvents.reduce((sum, evt) => sum + Number(evt.plannedEur || 0), 0);
      selectedSummary.textContent = selectedEvents.length
        ? `Ausgewählt: ${selectedEvents.length} Events · Geplant ${fmtEURPlain(planned)} EUR`
        : "Bitte mindestens ein Event auswählen.";
      renderAllocation();
    }

    const eventList = el("div", { class: "po-payment-event-list" });
    const selectableEvents = allPayments;
    if (Array.isArray(paymentRecord?.coveredEventIds)) {
      paymentRecord.coveredEventIds.forEach(id => {
        if (id) selectedIds.add(id);
      });
    }
    if (currentPaymentId) {
      Object.entries(record.paymentLog || {}).forEach(([eventId, log]) => {
        if (log?.paymentId === currentPaymentId) selectedIds.add(eventId);
      });
    }
    if (!selectedIds.size && payment?.id) selectedIds.add(payment.id);
    const toggleSelection = (evtId, force) => {
      if (force === true) selectedIds.add(evtId);
      else if (force === false) selectedIds.delete(evtId);
      else if (selectedIds.has(evtId)) selectedIds.delete(evtId);
      else selectedIds.add(evtId);
      updateSummary();
      updateSaveState();
    };
    selectableEvents.forEach(evt => {
      const disabled = evt.status === "paid" && evt.paymentId !== currentPaymentId;
      const checkbox = el("input", { type: "checkbox", checked: selectedIds.has(evt.id), disabled });
      checkbox.addEventListener("change", () => {
        if (disabled) return;
        toggleSelection(evt.id, checkbox.checked);
      });
      const statusLabel = evt.status === "paid" ? "Bezahlt" : "Offen";
      const row = el("div", {
        class: `po-payment-event-row ${disabled ? "is-disabled" : ""}`,
        role: "button",
        tabindex: disabled ? "-1" : "0",
      }, [
        checkbox,
        el("span", { class: "po-payment-event-main" }, [
          el("span", { class: "po-payment-event-title" }, [evt.label]),
          el("span", { class: "muted" }, [`${fmtDateDE(evt.dueDate)} · ${fmtEURPlain(evt.plannedEur)} EUR`]),
        ]),
        el("span", { class: `po-status-pill ${evt.status === "paid" ? "is-paid" : "is-open"}` }, [statusLabel]),
        el("span", { class: "po-transaction-pill" }, [evt.paymentId || "—"]),
      ]);
      row.addEventListener("click", (event) => {
        if (disabled) return;
        if (event.target instanceof HTMLInputElement) return;
        toggleSelection(evt.id);
        checkbox.checked = selectedIds.has(evt.id);
      });
      row.addEventListener("keydown", (event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSelection(evt.id);
          checkbox.checked = selectedIds.has(evt.id);
        }
      });
      eventList.append(row);
    });

    actualInput.addEventListener("input", renderAllocation);
    const updateLinkButtons = () => {
      const invoiceUrl = normalizeUrl(invoiceUrlInput.value);
      const folderUrl = normalizeUrl(folderUrlInput.value);
      const invoiceValid = invoiceUrl && isHttpUrl(invoiceUrl);
      const folderValid = folderUrl && isHttpUrl(folderUrl);
      invoiceBtn.href = invoiceValid ? invoiceUrl : "#";
      folderBtn.href = folderValid ? folderUrl : "#";
      invoiceBtn.style.display = invoiceValid ? "inline-flex" : "none";
      folderBtn.style.display = folderValid ? "inline-flex" : "none";
    };
    invoiceUrlInput.addEventListener("input", updateLinkButtons);
    folderUrlInput.addEventListener("input", updateLinkButtons);
    updateSummary();
    updateLinkButtons();

    const formError = el("div", { class: "form-error po-payment-error" }, []);

    function getModalState() {
      return {
        selectedIds: Array.from(selectedIds).sort(),
        paidDate: paidDateInput.value || "",
        method: methodSelect.value || "",
        paidBy: paidBySelect.value || "",
        actual: actualInput.value.trim(),
        paymentId: paymentIdInput.value.trim(),
        invoiceUrl: normalizeUrl(invoiceUrlInput.value) || "",
        folderUrl: normalizeUrl(folderUrlInput.value) || "",
        note: noteInput.value.trim(),
      };
    }

    const initialState = getModalState();

    function setFormError(message) {
      formError.textContent = message || "";
    }

    function computeValidation() {
      if (!selectedIds.size) {
        return { valid: false, reason: "Bitte mindestens ein Event auswählen." };
      }
      if (!paidBySelect.value) {
        return { valid: false, reason: "Bitte Paid by auswählen." };
      }
      const selectedEvents = allPayments.filter(evt => selectedIds.has(evt.id));
      const sumPlanned = selectedEvents.reduce((sum, evt) => sum + Number(evt.plannedEur || 0), 0);
      if (!Number.isFinite(sumPlanned)) {
        return { valid: false, reason: "Summe der geplanten Beträge muss gültig sein." };
      }
      const actualRaw = actualInput.value.trim();
      const parsedActual = actualRaw ? parseMoneyInput(actualRaw) : sumPlanned;
      if (!Number.isFinite(parsedActual)) {
        return { valid: false, reason: "Bitte einen gültigen Ist-Betrag eingeben." };
      }
      if (parsedActual < 0) {
        return { valid: false, reason: "Ist-Betrag darf nicht negativ sein." };
      }
      if (parsedActual === 0 && sumPlanned > 0) {
        return { valid: false, reason: "Ist-Betrag darf nicht 0 sein, wenn ein Soll-Betrag vorhanden ist." };
      }

      let allocations = null;
      if (sumPlanned > 0) {
        allocations = allocatePayment(parsedActual, selectedEvents);
      } else if (parsedActual === 0) {
        allocations = selectedEvents.map(evt => ({
          eventId: evt.id,
          planned: 0,
          raw: 0,
          actual: 0,
        }));
      }
      if (!allocations) {
        return { valid: false, reason: "Konnte die Ist-Beträge nicht aufteilen." };
      }

      const invoiceUrl = normalizeUrl(invoiceUrlInput.value);
      if (invoiceUrl && !isHttpUrl(invoiceUrl)) {
        return { valid: false, reason: "Invoice URL muss mit http:// oder https:// beginnen." };
      }
      const folderUrl = normalizeUrl(folderUrlInput.value);
      if (folderUrl && !isHttpUrl(folderUrl)) {
        return { valid: false, reason: "Folder URL muss mit http:// oder https:// beginnen." };
      }

      const requestedPaymentId = normalizePaymentId(paymentIdInput.value) || (paymentRecord?.id || buildPaymentId());
      if (paymentRecord?.id && requestedPaymentId !== paymentRecord.id) {
        const duplicate = mergedPayments.find(entry => entry?.id === requestedPaymentId);
        if (duplicate) {
          return { valid: false, reason: "Diese Payment-ID ist bereits vergeben." };
        }
      }

      return {
        valid: true,
        selectedEvents,
        sumPlanned,
        parsedActual,
        allocations,
        invoiceUrl,
        folderUrl,
        requestedPaymentId,
      };
    }

    const form = el("div", { class: "po-payment-form" }, [
      formError,
      el("div", { class: "po-payment-debug muted" }, ["Status: bereit"]),
      el("label", {}, ["Events (mehrere möglich)"]),
      eventList,
      selectedSummary,
      el("label", {}, ["Bezahlt am"]),
      paidDateInput,
      el("label", {}, ["Methode"]),
      methodSelect,
      el("label", {}, ["Paid by"]),
      paidBySelect,
      el("label", {}, ["Ist bezahlt (EUR)"]),
      actualInput,
      el("label", {}, ["Transfer / Payment-ID"]),
      paymentIdInput,
      el("label", {}, ["Invoice (GDrive URL)"]),
      el("div", { style: "display:flex;gap:8px;align-items:center;" }, [invoiceUrlInput, invoiceBtn]),
      el("label", {}, ["Invoice Folder (GDrive URL)"]),
      el("div", { style: "display:flex;gap:8px;align-items:center;" }, [folderUrlInput, folderBtn]),
      el("label", {}, ["Aufteilung (Preview)"]),
      allocationTable,
      el("label", {}, ["Notiz"]),
      noteInput,
    ]);

    const saveHelper = el("div", { class: "muted po-payment-save-hint" }, []);
    const saveBtn = el("button", { class: "btn", type: "button" }, ["Speichern"]);

    function updateSaveState() {
      const validation = computeValidation();
      const isDirty = !deepEqual(getModalState(), initialState);
      saveBtn.disabled = !isDirty || !validation.valid;
      if (!validation.valid) {
        saveHelper.textContent = "Bitte Pflichtfelder ausfüllen";
      } else if (!isDirty) {
        saveHelper.textContent = "Keine Änderungen";
      } else {
        saveHelper.textContent = "";
      }
      if (validation.valid) {
        setFormError("");
      }
      return { isDirty, validation };
    }

    [
      paidDateInput,
      methodSelect,
      paidBySelect,
      actualInput,
      paymentIdInput,
      invoiceUrlInput,
      folderUrlInput,
      noteInput,
    ].forEach(input => {
      input.addEventListener("input", updateSaveState);
      input.addEventListener("change", updateSaveState);
    });

    updateSaveState();

    saveBtn.addEventListener("click", () => {
      const isDirty = !deepEqual(getModalState(), initialState);
      const validation = computeValidation();
      const allocationsSum = Array.isArray(validation.allocations)
        ? validation.allocations.reduce((sum, entry) => sum + Number(entry.actual || 0), 0)
        : null;
      if (debugForms) {
        console.debug("[po-payment-modal] save click", {
          isDirty,
          valid: validation.valid,
          reason: validation.reason || null,
          allocationsSum,
        });
      }
      if (!isDirty) {
        setFormError("Speichern nicht möglich: Keine Änderungen.");
        updateSaveState();
        return;
      }
      if (!validation.valid) {
        setFormError(`Speichern nicht möglich: ${validation.reason}`);
        updateSaveState();
        return;
      }

      const paymentPayload = {
        id: validation.requestedPaymentId,
        paidDate: paidDateInput.value || null,
        method: methodSelect.value || null,
        payer: paidBySelect.value,
        currency: "EUR",
        amountActualEurTotal: validation.parsedActual,
        coveredEventIds: validation.allocations.map(entry => entry.eventId),
        note: noteInput.value.trim() || null,
        invoiceDriveUrl: validation.invoiceUrl || "",
        invoiceFolderDriveUrl: validation.folderUrl || "",
      };

      draftForm.setDraft((current) => {
        const base = current || {};
        const nextPaymentDrafts = { ...(base.paymentDrafts || {}) };
        if (initialPaymentId && initialPaymentId !== paymentPayload.id) {
          delete nextPaymentDrafts[initialPaymentId];
        }
        nextPaymentDrafts[paymentPayload.id] = paymentPayload;

        const currentLog = base.paymentLog || {};
        const nextPaymentLog = { ...currentLog };
        const removedIds = new Set();
        if (initialPaymentId) {
          Object.entries(currentLog).forEach(([eventId, log]) => {
            if (log?.paymentId === initialPaymentId && !selectedIds.has(eventId)) {
              removedIds.add(eventId);
            }
          });
        }
        removedIds.forEach(eventId => {
          const log = currentLog?.[eventId] || {};
          nextPaymentLog[eventId] = {
            ...log,
            status: "open",
            paidDate: null,
            paymentId: null,
            amountActualEur: null,
            method: null,
            payer: null,
            note: null,
          };
        });

        validation.allocations.forEach(entry => {
          const log = currentLog?.[entry.eventId] || {};
          const paymentInternalId = log.paymentInternalId || `payrow-${Math.random().toString(36).slice(2, 9)}`;
          nextPaymentLog[entry.eventId] = {
            ...log,
            paymentInternalId,
            status: "paid",
            paidDate: paymentPayload.paidDate,
            paymentId: paymentPayload.id,
            amountActualEur: entry.actual,
            method: paymentPayload.method,
            payer: paymentPayload.payer,
            note: paymentPayload.note,
          };
        });

        return {
          ...base,
          paymentDrafts: nextPaymentDrafts,
          paymentLog: nextPaymentLog,
        };
      });

      editing = draftForm.draft;
      onAnyChange();
      closeModal(modal);
    });

    const modal = buildModal({
      title: paymentRecord || initialPaymentId ? "Zahlung bearbeiten" : "Zahlungen als bezahlt markieren",
      content: form,
      actions: [
        el("button", { class: "btn secondary", type: "button", onclick: () => closeModal(modal) }, ["Abbrechen"]),
        saveHelper,
        saveBtn,
      ],
    });
  }

  payments.forEach(payment => {
    const planned = `${fmtEURPlain(payment.plannedEur)} EUR`;
    const statusLabel = payment.status === "paid" ? "Bezahlt" : "Offen";
    const paidActual = payment.paidEurActual != null ? `${fmtEURPlain(payment.paidEurActual)} EUR` : "—";
    const delta = payment.paidEurActual != null
      ? `Δ ${fmtEURPlain(payment.paidEurActual - payment.plannedEur)} EUR`
      : null;
    const suggestedFilename = getSuggestedInvoiceFilename(record, {
      status: payment.status,
      paidDate: payment.paidDate,
      dueDate: payment.dueDate,
      typeLabel: payment.typeLabel,
      eventType: payment.eventType,
      amountActualEur: payment.paidEurActual,
      amountPlannedEur: payment.plannedEur,
    }, {
      poNumber: record?.[config.numberField],
      products: productCache,
    });
    const copyButton = el("button", {
      class: "btn secondary sm",
      type: "button",
      onclick: async () => {
        const success = await copyToClipboard(suggestedFilename);
        if (!success) {
          alert("Konnte den Dateinamen nicht kopieren.");
          return;
        }
        const original = copyButton.textContent;
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = original;
        }, 1200);
      },
    }, ["Copy"]);
    const row = el("tr", { dataset: { paymentId: payment.id, paymentType: payment.typeLabel, paymentEventType: payment.eventType || "" } }, [
      el("td", {}, [payment.typeLabel]),
      el("td", {}, [fmtDateDE(payment.dueDate)]),
      el("td", {}, [planned]),
      el("td", {}, [el("span", { class: `po-status-pill ${payment.status === "paid" ? "is-paid" : "is-open"}` }, [statusLabel])]),
      el("td", {}, [payment.paidDate ? fmtDateDE(payment.paidDate) : "—"]),
      el("td", {}, [paidActual, delta ? el("div", { class: "muted" }, [delta]) : null]),
      el("td", {}, [payment.method || "—"]),
      el("td", {}, [payment.paidBy || "—"]),
      el("td", {}, [payment.paymentId ? el("span", { class: "po-transaction-pill" }, [payment.paymentId]) : "—"]),
      el("td", {}, [
        el("div", { class: "po-payment-filename" }, [
          el("div", { class: "po-filename-suggestion" }, [suggestedFilename || "—"]),
          copyButton,
        ]),
      ]),
      el("td", {}, [
        el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;" }, [
          el("button", {
            class: "btn secondary sm",
            type: "button",
            onclick: () => openPaymentModal(payment),
          }, [payment.status === "paid" ? "Edit" : "Mark as paid"]),
          isHttpUrl(normalizeUrl(payment.invoiceDriveUrl))
            ? el("a", {
              class: "btn secondary sm",
              href: normalizeUrl(payment.invoiceDriveUrl),
              target: "_blank",
              rel: "noopener noreferrer",
            }, ["Open Invoice"])
            : null,
          isHttpUrl(normalizeUrl(payment.invoiceFolderDriveUrl))
            ? el("a", {
              class: "btn secondary sm",
              href: normalizeUrl(payment.invoiceFolderDriveUrl),
              target: "_blank",
              rel: "noopener noreferrer",
            }, ["Open Folder"])
            : null,
        ]),
      ]),
    ]);
    paymentBody.append(row);
  });

  if (!payments.length) {
    paymentBody.append(el("tr", {}, [
      el("td", { colspan: "11", class: "muted" }, ["Keine Zahlungen verfügbar."]),
    ]));
  }

  paymentSection.append(paymentTable);
  container.append(paymentSection);

  if (focusInfo && focusInfo.id && focusInfo.field) {
    const target = container.querySelector(`[data-ms-id="${focusInfo.id}"] [data-field="${focusInfo.field}"]`);
    if (target) {
      target.focus();
      if (focusInfo.selectionStart != null && focusInfo.selectionEnd != null && target.setSelectionRange) {
        target.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
      }
    }
  }
}

export function renderOrderModule(root, config) {
  const state = loadAppState();
  if (!Array.isArray(state[config.entityKey])) state[config.entityKey] = [];
  const initialSettings = getSettings();
  state[config.entityKey].forEach(rec => normaliseGoodsFields(rec, initialSettings));

  const quickfillEnabled = config.slug === "po";
  const poMode = config.slug === "po";

  const ids = {
    list: `${config.slug}-list`,
    number: `${config.slug}-number`,
    orderDate: `${config.slug}-order-date`,
    orderDateDisplay: `${config.slug}-order-date-display`,
    orderDatePicker: `${config.slug}-order-date-picker`,
    orderDateError: `${config.slug}-order-date-error`,
    items: `${config.slug}-items`,
    addItem: `${config.slug}-add-item`,
    goodsSummary: `${config.slug}-goods-summary`,
    fxRate: `${config.slug}-fx-rate`,
    freight: `${config.slug}-freight`,
    freightMode: `${config.slug}-freight-mode`,
    freightModeHint: `${config.slug}-freight-mode-hint`,
    freightPerUnit: `${config.slug}-freight-per-unit`,
    freightPerUnitSuggested: `${config.slug}-freight-per-unit-suggested`,
    freightPerUnitReset: `${config.slug}-freight-per-unit-reset`,
    freightPerUnitWarning: `${config.slug}-freight-per-unit-warning`,
    prod: `${config.slug}-prod`,
    transport: `${config.slug}-transport`,
    transit: `${config.slug}-transit`,
    dutyRate: `${config.slug}-duty-rate`,
    dutyInclude: `${config.slug}-duty-include`,
    eustRate: `${config.slug}-eust-rate`,
    fxFee: `${config.slug}-fx-fee`,
    vatLag: `${config.slug}-vat-lag`,
    vatToggle: `${config.slug}-vat-toggle`,
    ddp: `${config.slug}-ddp`,
    timeline: `${config.slug}-timeline`,
    timelineSummary: `${config.slug}-timeline-summary`,
    cnyBanner: `${config.slug}-cny-banner`,
    etdComputed: `${config.slug}-etd-computed`,
    etaComputed: `${config.slug}-eta-computed`,
    etdManual: `${config.slug}-etd-manual`,
    etaManual: `${config.slug}-eta-manual`,
    etdReset: `${config.slug}-etd-reset`,
    etaReset: `${config.slug}-eta-reset`,
    msZone: `${config.slug}-ms-zone`,
    preview: `${config.slug}-preview`,
    save: `${config.slug}-save`,
    create: `${config.slug}-create`,
    remove: `${config.slug}-remove`,
    cancel: `${config.slug}-cancel`,
  };
  if (quickfillEnabled) {
    Object.assign(ids, {
      sku: `${config.slug}-sku`,
      skuList: `${config.slug}-sku-list`,
      recent: `${config.slug}-sku-recent`,
      supplier: `${config.slug}-supplier`,
      quickLatest: `${config.slug}-quick-latest`,
      quickHistory: `${config.slug}-quick-history`,
      templateLoad: `${config.slug}-template-load`,
      templateSave: `${config.slug}-template-save`,
      quickStatus: `${config.slug}-quick-status`,
      productCreate: `${config.slug}-quick-create-product`,
    });
  }
  if (poMode) {
    Object.assign(ids, {
      search: `${config.slug}-search`,
      archiveToggle: `${config.slug}-archive-toggle`,
      newButton: `${config.slug}-new`,
      modal: `${config.slug}-modal`,
      modalClose: `${config.slug}-modal-close`,
      status: `${config.slug}-status`,
      addMiscItem: `${config.slug}-add-misc-item`,
      meta: `${config.slug}-meta`,
      saveHeader: `${config.slug}-save-header`,
    });
  }
  if (config.convertTo) {
    ids.convert = `${config.slug}-convert`;
  }

  const formBodyHtml = `
      <div class="po-form-section">
        <div class="po-form-section-header">
          <h4>Header</h4>
          <span class="po-form-section-meta" id="${ids.status}"></span>
        </div>
        ${quickfillEnabled ? `
        <div class="grid two po-quickfill">
        <div class="po-product-field">
          <label>Produkt (Alias/SKU)</label>
          <input id="${ids.sku}" list="${ids.skuList}" placeholder="Tippe Alias oder SKU …" autocomplete="off" />
          <datalist id="${ids.skuList}"></datalist>
          <div class="po-product-recent" id="${ids.recent}" aria-live="polite"></div>
        </div>
        <div class="po-quickfill-actions">
          <div class="po-quickfill-buttons">
            <button class="btn secondary" type="button" id="${ids.quickLatest}">Neueste übernehmen</button>
            <button class="btn" type="button" id="${ids.quickHistory}">Aus Historie wählen</button>
            <button class="btn secondary" type="button" id="${ids.templateLoad}">Template laden</button>
            <button class="btn secondary" type="button" id="${ids.templateSave}">Als Template speichern…</button>
            <button class="btn tertiary" type="button" id="${ids.productCreate}">Neues Produkt anlegen</button>
          </div>
          <p class="po-quickfill-status" id="${ids.quickStatus}" aria-live="polite"></p>
        </div>
        </div>
        ` : ``}
        <div class="grid ${quickfillEnabled ? "three" : "two"}">
        <div>
          <label>${config.numberLabel}</label>
          <input id="${ids.number}" placeholder="${config.numberPlaceholder}" />
        </div>
        <div>
          <label>Bestelldatum</label>
          <div class="po-date-picker">
            <input
              id="${ids.orderDateDisplay}"
              placeholder="TT.MM.JJJJ"
              inputmode="numeric"
              aria-describedby="${ids.orderDateError}"
            />
            <button type="button" class="btn tertiary" id="${ids.orderDate}-picker-btn" aria-label="Datum auswählen">📅</button>
            <input id="${ids.orderDate}" type="date" aria-hidden="true" tabindex="-1" class="sr-only" />
          </div>
          <div id="${ids.orderDateError}" class="form-error" role="alert"></div>
        </div>
        ${quickfillEnabled ? `
        <div>
          <label>Lieferant</label>
          <input id="${ids.supplier}" placeholder="z. B. Ningbo Trading" />
        </div>
        ` : ``}
        </div>
      </div>
      <div class="po-form-section">
        <div class="po-form-section-header">
          <h4>Positionen</h4>
        </div>
        <div class="po-items-card">
          <div class="po-items-card-header">
            <h4>Artikel</h4>
            <div class="po-table-actions">
              <button class="btn sm" type="button" id="${ids.addItem}">+ SKU Position</button>
              ${poMode ? `<button class="btn sm secondary" type="button" id="${ids.addMiscItem}">+ Freie Position</button>` : ""}
            </div>
          </div>
          <div id="${ids.items}"></div>
        </div>
        <div class="po-goods-summary" id="${ids.goodsSummary}">Summe Warenwert: 0,00 € (0,00 USD)</div>
      </div>
      <div class="po-form-section">
        <div class="po-form-section-header">
          <h4>Timeline / Termine</h4>
        </div>
        <div class="grid two" style="margin-top:12px">
        <div>
          <label>FX-Kurs (USD je EUR)</label>
          <input id="${ids.fxRate}" placeholder="z. B. 1,08" inputmode="decimal" />
        </div>
        </div>
        <div class="grid two" style="margin-top:12px">
        <div>
          <label>Fracht (Eingabeart)</label>
          <select id="${ids.freightMode}">
            <option value="TOTAL_EUR">Gesamtbetrag (€)</option>
            <option value="PER_UNIT_EUR">Pro Stück (€)</option>
            <option value="AUTO_FROM_LANDED">Auto (aus Einstandskosten)</option>
          </select>
          <p class="muted" id="${ids.freightModeHint}" hidden>Berechnung: Einstandskosten (EUR/Stk) − Warenwert (USD ÷ FX). Fehlende Einstandskosten werden markiert.</p>
        </div>
        <div>
          <label>Fracht gesamt (€)</label>
          <input id="${ids.freight}" placeholder="z. B. 4.800,00" />
        </div>
        <div>
          <label>Fracht pro Stück (€)</label>
          <input id="${ids.freightPerUnit}" placeholder="z. B. 1,25" />
          <div class="po-suggested-row">
            <span class="muted" id="${ids.freightPerUnitSuggested}"></span>
            <button class="btn ghost" type="button" id="${ids.freightPerUnitReset}">Reset</button>
          </div>
          <small class="form-error" id="${ids.freightPerUnitWarning}"></small>
        </div>
        <div>
          <label>Produktionstage</label>
          <input id="${ids.prod}" type="number" value="60" />
        </div>
        <div>
          <label>Transport</label>
          <select id="${ids.transport}">
            <option value="sea">Sea</option>
            <option value="rail">Rail</option>
            <option value="air">Air</option>
          </select>
        </div>
        <div>
          <label>Transit-Tage</label>
          <input id="${ids.transit}" type="number" value="60" />
        </div>
      </div>
      <div class="grid two" style="margin-top:12px">
        <div>
          <label>Zollsatz (%)</label>
          <input id="${ids.dutyRate}" placeholder="z. B. 6,5" />
          <label class="inline-checkbox"><input type="checkbox" id="${ids.dutyInclude}" /> Fracht einbeziehen</label>
        </div>
        <div>
          <label>EUSt (%)</label>
          <input id="${ids.eustRate}" placeholder="z. B. 19" />
        </div>
        <div>
          <label>FX-Gebühr (%)</label>
          <input id="${ids.fxFee}" placeholder="z. B. 0,5" />
        </div>
        <div>
          <label>EUSt-Erstattung (Monate)</label>
          <input id="${ids.vatLag}" type="number" min="0" step="1" />
          <label class="inline-checkbox"><input type="checkbox" id="${ids.vatToggle}" /> Erstattung aktiv</label>
        </div>
        <div class="checkbox-line">
          <label><input type="checkbox" id="${ids.ddp}" /> DDP (Importkosten enthalten)</label>
        </div>
        </div>
        <div class="po-timeline-card">
          <div class="po-timeline-card-header">
            <h4>PO Timeline</h4>
            <div id="${ids.timelineSummary}" class="po-timeline-summary"></div>
          </div>
          <div class="po-timeline-dates">
            <div class="po-timeline-date">
              <span class="muted">Berechnet ETD</span>
              <strong id="${ids.etdComputed}">—</strong>
            </div>
            <div class="po-timeline-date">
              <span class="muted">Berechnet ETA</span>
              <strong id="${ids.etaComputed}">—</strong>
            </div>
            <div class="po-timeline-date">
              <label>ETD Override</label>
              <div class="po-timeline-input-row">
                <input id="${ids.etdManual}" type="date" />
                <button class="btn sm" type="button" id="${ids.etdReset}">Reset</button>
              </div>
            </div>
            <div class="po-timeline-date">
              <label>ETA Override</label>
              <div class="po-timeline-input-row">
                <input id="${ids.etaManual}" type="date" />
                <button class="btn sm" type="button" id="${ids.etaReset}">Reset</button>
              </div>
            </div>
          </div>
          <div id="${ids.cnyBanner}" class="banner warning" hidden></div>
          <div id="${ids.timeline}" class="po-timeline-track-wrapper"></div>
        </div>
      </div>
      <div class="po-form-section">
        <div class="po-form-section-header">
          <h4>Zahlungsplan & Importkosten</h4>
        </div>
        <div id="${ids.msZone}" style="margin-top:10px"></div>
      </div>
      <div class="po-sticky-footer">
        <div class="po-sticky-actions">
          <button class="btn primary sm" id="${ids.save}">Speichern</button>
          <button class="btn sm" id="${ids.cancel}">Schließen</button>
          <button class="btn sm" id="${ids.create}">${config.newButtonLabel}</button>
          ${config.convertTo ? `<button class="btn secondary sm" id="${ids.convert}">${config.convertTo.buttonLabel || "In PO umwandeln"}</button>` : ""}
          <button class="btn danger sm" id="${ids.remove}">Löschen</button>
        </div>
      </div>
      <div class="po-form-section">
        <div class="po-form-section-header">
          <h4>Ereignisse / Ledger</h4>
        </div>
        <div id="${ids.preview}" class="po-event-preview"></div>
      </div>
  `;

  const formSectionHtml = poMode
    ? `
      <section class="card po-form-card">
        <div class="po-form-modal-header">
          <div>
            <h3>${config.formTitle}</h3>
            <div class="po-form-modal-meta" id="${ids.meta}"></div>
          </div>
          <div class="po-table-actions">
            <button class="btn primary sm" type="button" id="${ids.saveHeader}">Speichern</button>
            <button class="btn ghost" type="button" id="${ids.modalClose}" aria-label="Schließen">✕</button>
          </div>
        </div>
        ${formBodyHtml}
      </section>
    `
    : `
      <section class="card">
        <h3>${config.formTitle}</h3>
        ${formBodyHtml}
      </section>
    `;

  root.innerHTML = poMode
    ? `
      <section class="card po-list-card">
        <div class="po-list-toolbar">
          <div>
            <h2>${config.listTitle}</h2>
          </div>
          <div class="po-list-actions">
            <input id="${ids.search}" placeholder="Suche PO-Nr., SKU, Alias, Supplier" />
            <label class="po-archive-toggle">
              <input type="checkbox" id="${ids.archiveToggle}" />
              Archiviert
            </label>
            <button class="btn primary" type="button" id="${ids.newButton}">+ Neue PO</button>
          </div>
        </div>
        <div id="${ids.list}" class="po-table-wrap"></div>
      </section>
      <div class="po-form-modal" id="${ids.modal}" aria-hidden="true">
        <div class="po-form-modal-panel">
          ${formSectionHtml}
        </div>
      </div>
    `
    : `
      <section class="card">
        <h2>${config.listTitle}</h2>
        <div id="${ids.list}"></div>
      </section>
      ${formSectionHtml}
    `;

  const listZone = $(`#${ids.list}`, root);
  const poSearchInput = poMode ? $(`#${ids.search}`, root) : null;
  const poArchiveToggle = poMode ? $(`#${ids.archiveToggle}`, root) : null;
  const poNewButton = poMode ? $(`#${ids.newButton}`, root) : null;
  const poModal = poMode ? $(`#${ids.modal}`, root) : null;
  const poModalPanel = poMode && poModal ? poModal.querySelector(".po-form-modal-panel") : null;
  const poModalClose = poMode ? $(`#${ids.modalClose}`, root) : null;
  const poStatus = poMode ? $(`#${ids.status}`, root) : null;
  const poMeta = poMode ? $(`#${ids.meta}`, root) : null;
  const poSaveHeader = poMode ? $(`#${ids.saveHeader}`, root) : null;
  const skuInput = quickfillEnabled ? $(`#${ids.sku}`, root) : null;
  const skuList = quickfillEnabled ? $(`#${ids.skuList}`, root) : null;
  const supplierInput = quickfillEnabled ? $(`#${ids.supplier}`, root) : null;
  const quickLatestBtn = quickfillEnabled ? $(`#${ids.quickLatest}`, root) : null;
  const quickHistoryBtn = quickfillEnabled ? $(`#${ids.quickHistory}`, root) : null;
  const productCreateBtn = quickfillEnabled ? $(`#${ids.productCreate}`, root) : null;
  const templateLoadBtn = quickfillEnabled ? $(`#${ids.templateLoad}`, root) : null;
  const templateSaveBtn = quickfillEnabled ? $(`#${ids.templateSave}`, root) : null;
  const quickStatus = quickfillEnabled ? $(`#${ids.quickStatus}`, root) : null;
  const numberInput = $(`#${ids.number}`, root);
  const orderDateInput = $(`#${ids.orderDate}`, root);
  const orderDateDisplay = $(`#${ids.orderDateDisplay}`, root);
  const orderDateError = $(`#${ids.orderDateError}`, root);
  const orderDatePickerBtn = $(`#${ids.orderDate}-picker-btn`, root);
  const itemsZone = $(`#${ids.items}`, root);
  const addItemBtn = $(`#${ids.addItem}`, root);
  const addMiscItemBtn = poMode ? $(`#${ids.addMiscItem}`, root) : null;
  const itemsDataListId = `${ids.items}-dl`;
  const goodsSummary = $(`#${ids.goodsSummary}`, root);
  const fxRateInput = $(`#${ids.fxRate}`, root);
  const freightModeSelect = $(`#${ids.freightMode}`, root);
  const freightModeHint = $(`#${ids.freightModeHint}`, root);
  const freightInput = $(`#${ids.freight}`, root);
  const freightPerUnitInput = $(`#${ids.freightPerUnit}`, root);
  const freightPerUnitSuggested = $(`#${ids.freightPerUnitSuggested}`, root);
  const freightPerUnitReset = $(`#${ids.freightPerUnitReset}`, root);
  const freightPerUnitWarning = $(`#${ids.freightPerUnitWarning}`, root);
  const prodInput = $(`#${ids.prod}`, root);
  const transportSelect = $(`#${ids.transport}`, root);
  const transitInput = $(`#${ids.transit}`, root);
  const dutyRateInput = $(`#${ids.dutyRate}`, root);
  const dutyIncludeToggle = $(`#${ids.dutyInclude}`, root);
  const eustRateInput = $(`#${ids.eustRate}`, root);
  const fxFeeInput = $(`#${ids.fxFee}`, root);
  const vatLagInput = $(`#${ids.vatLag}`, root);
  const vatToggle = $(`#${ids.vatToggle}`, root);
  const ddpToggle = $(`#${ids.ddp}`, root);
  const timelineZone = $(`#${ids.timeline}`, root);
  const timelineSummary = $(`#${ids.timelineSummary}`, root);
  const cnyBanner = $(`#${ids.cnyBanner}`, root);
  const etdComputed = $(`#${ids.etdComputed}`, root);
  const etaComputed = $(`#${ids.etaComputed}`, root);
  const etdManualInput = $(`#${ids.etdManual}`, root);
  const etaManualInput = $(`#${ids.etaManual}`, root);
  const etdResetBtn = $(`#${ids.etdReset}`, root);
  const etaResetBtn = $(`#${ids.etaReset}`, root);
  const msZone = $(`#${ids.msZone}`, root);
  const saveBtn = $(`#${ids.save}`, root);
  const cancelBtn = $(`#${ids.cancel}`, root);
  const createBtn = $(`#${ids.create}`, root);
  const deleteBtn = $(`#${ids.remove}`, root);
  const preview = $(`#${ids.preview}`, root);
  const convertBtn = ids.convert ? $(`#${ids.convert}`, root) : null;

  let draftForm = useDraftForm(prepareRecordForDraft(defaultRecord(config, getSettings()), getSettings()), {
    key: `${config.slug}:new`,
    enableDraftCache: true,
  });
  let editing = draftForm.draft;
  let lastLoaded = JSON.parse(JSON.stringify(editing));
  let isDirty = false;
  const dirtyGuard = useDirtyGuard(() => draftForm.isDirty, "Ungespeicherte Änderungen verwerfen?");
  dirtyGuard.register();
  dirtyGuard.attachBeforeUnload();
  let freightPerUnitOverridden = false;
  const poListState = poMode ? { searchTerm: "", showArchived: false, sortKey: null, sortDir: null } : null;

  function formatProductOption(product) {
    if (!product) return "";
    const alias = product.alias || product.sku || "Produkt";
    const sku = product.sku || "";
    const supplier = product.supplierId ? ` • ${product.supplierId}` : "";
    return `${alias} – ${sku}${supplier}`;
  }

  function resolveProductFromInput(value) {
    const term = String(value || "").trim().toLowerCase();
    const baseTerm = term.split("•")[0].trim();
    if (!term) return null;
    return productCache.find(prod => {
      if (!prod || !prod.sku) return false;
      const alias = String(prod.alias || "").trim().toLowerCase();
      const sku = String(prod.sku || "").trim().toLowerCase();
      const combo = `${alias} – ${sku}`;
      const supplier = prod.supplierId ? `${combo} • ${String(prod.supplierId).trim().toLowerCase()}` : null;
      if (term === combo.toLowerCase() || baseTerm === combo.toLowerCase()) return true;
      if (supplier && term === supplier) return true;
      if (alias && (term === alias || baseTerm === alias)) return true;
      if (sku && (term === sku || baseTerm === sku)) return true;
      return false;
    }) || null;
  }

  function parseSkuInputValue(raw) {
    const product = resolveProductFromInput(raw);
    if (product) return product.sku;
    return String(raw || "").trim();
  }

  function setSkuField(product) {
    if (!quickfillEnabled || !skuInput) return;
    if (product) {
      skuInput.value = formatProductOption(product);
      skuInput.dataset.sku = product.sku;
      if (supplierInput && !editing.supplier && product.supplierId) {
        supplierInput.value = product.supplierId;
        editing.supplier = product.supplierId;
      }
    } else {
      skuInput.dataset.sku = "";
    }
  }

  function renderRecentChips() {
    if (!quickfillEnabled) return;
    const container = $(`#${ids.recent}`, root);
    if (!container) return;
    const recents = getRecentProducts();
    container.innerHTML = "";
    if (!recents.length) {
      container.append(el("span", { class: "muted" }, ["Zuletzt genutzte Produkte erscheinen hier."]));
      return;
    }
    recents.forEach(prod => {
      const btn = el("button", {
        type: "button",
        class: "chip",
        onclick: () => {
          setSkuField(prod);
          editing.sku = prod.sku;
          refreshQuickfillControls();
          freightPerUnitOverridden = false;
          updateFreightPerUnitSuggestion(prod);
          updateSaveEnabled();
        },
      }, [prod.alias ? `${prod.alias} (${prod.sku})` : prod.sku]);
      container.append(btn);
    });
  }

  function setQuickStatus(message) {
    if (!quickStatus) return;
    quickStatus.textContent = message || "";
  }

  function showToast(message) {
    if (quickStatus) {
      quickStatus.textContent = message;
      return;
    }
    let toast = document.getElementById(`${config.slug}-toast`);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = `${config.slug}-toast`;
      toast.className = "po-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2000);
  }

  function hasUnsavedChanges() {
    const settings = getSettings();
    const snapshot = JSON.parse(JSON.stringify(editing));
    syncEditingFromForm(settings, snapshot);
    const dirty = !deepEqual(snapshot, lastLoaded);
    if (dirty) {
      editing = snapshot;
      draftForm.setDraft(editing);
    } else {
      draftForm.setDraft(lastLoaded);
    }
    isDirty = dirty;
    return dirty;
  }

  function confirmDiscard(onConfirm) {
    openConfirmDialog({
      title: "Ungespeicherte Änderungen",
      message: "Ungespeicherte Änderungen verwerfen?",
      confirmLabel: "Verwerfen",
      cancelLabel: "Abbrechen",
      onConfirm,
    });
  }

  function formatDraftTimestamp(iso) {
    if (!iso) return "unbekannt";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "unbekannt";
    return date.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }

  function entityKeyFor(record) {
    const raw = record?.[config.numberField] || record?.id || "new";
    return `${config.slug}:${raw}`;
  }

  function openFormModal() {
    if (!poMode || !poModal) return;
    poModal.classList.add("is-open");
    poModal.setAttribute("aria-hidden", "false");
    const focusTarget = poModal.querySelector("input, select, textarea, button");
    if (focusTarget) focusTarget.focus();
  }

  function closeFormModal() {
    if (!poMode || !poModal) return;
    poModal.classList.remove("is-open");
    poModal.setAttribute("aria-hidden", "true");
  }

  function attemptCloseForm({ reset } = {}) {
    if (!poMode) return;
    const dirty = hasUnsavedChanges();
    if (!dirty) {
      if (reset) loadForm(lastLoaded || editing);
      closeFormModal();
      return;
    }
    dirtyGuard({
      confirmWithModal: ({ onConfirm }) => confirmDiscard(onConfirm),
      onConfirm: () => {
        if (reset) loadForm(lastLoaded || editing);
        isDirty = false;
        closeFormModal();
      },
    });
  }

  let suppressBackdropClose = false;
  if (poModalPanel) {
    poModalPanel.addEventListener("mousedown", () => {
      suppressBackdropClose = true;
    });
    window.addEventListener("mouseup", () => {
      if (!suppressBackdropClose) return;
      setTimeout(() => { suppressBackdropClose = false; }, 0);
    });
  }

  function getCurrentState() {
    return loadAppState();
  }

  function getAllRecords() {
    const st = getCurrentState();
    if (!Array.isArray(st[config.entityKey])) st[config.entityKey] = [];
    return st[config.entityKey];
  }

  function renderListView(recordsOverride, update = null) {
    const records = recordsOverride || getAllRecords();
    if (poMode && update) {
      if (Object.prototype.hasOwnProperty.call(update, "sortKey")) poListState.sortKey = update.sortKey;
      if (Object.prototype.hasOwnProperty.call(update, "sortDir")) poListState.sortDir = update.sortDir;
    }
    const options = poMode ? { ...poListState, onUpdate: (next) => renderListView(null, next) } : undefined;
    renderList(listZone, records, config, onEdit, onDelete, options);
  }

  function normaliseHistory(records) {
    const settings = getSettings();
    return (records || []).map(rec => {
      const copy = JSON.parse(JSON.stringify(rec));
      normaliseGoodsFields(copy, settings);
      ensureAutoEvents(copy, settings, copy.milestones || []);
      return copy;
    });
  }

  function monthTime(value) {
    const date = parseISOToDate(value);
    return date ? date.getTime() : 0;
  }

  function getHistoryFor(skuValue, supplierValue, limit = 10) {
    if (!skuValue) return [];
    const skuLower = skuValue.trim().toLowerCase();
    const supplierLower = supplierValue ? supplierValue.trim().toLowerCase() : null;
    const matches = getAllRecords().filter(rec => {
      const recSku = (rec?.sku || "").trim().toLowerCase();
      const itemMatch = Array.isArray(rec?.items)
        ? rec.items.some(it => (it?.sku || "").trim().toLowerCase() === skuLower)
        : false;
      if (!recSku && !itemMatch) return false;
      if (recSku && recSku !== skuLower && !itemMatch) return false;
      if (!supplierLower) return true;
      const recSupplier = (rec?.supplier || "").trim().toLowerCase();
      return recSupplier === supplierLower;
    });
    matches.sort((a, b) => monthTime(b.orderDate) - monthTime(a.orderDate));
    return matches.slice(0, limit);
  }

  function findLatestMatch(skuValue, supplierValue) {
    if (!skuValue) return null;
    const withSupplier = supplierValue ? getHistoryFor(skuValue, supplierValue, 1) : [];
    if (withSupplier.length) return withSupplier[0];
    const generic = getHistoryFor(skuValue, null, 1);
    return generic.length ? generic[0] : null;
  }

  function getTemplates() {
    const st = getCurrentState();
    if (!Array.isArray(st.poTemplates)) st.poTemplates = [];
    return st.poTemplates;
  }

  function legacyTemplatesFor(skuValue, supplierValue) {
    if (!skuValue) return [];
    const skuLower = skuValue.trim().toLowerCase();
    const supplierLower = supplierValue ? supplierValue.trim().toLowerCase() : null;
    return getTemplates()
      .filter(tpl => {
        if (!tpl || !tpl.sku) return false;
        const tplSku = String(tpl.sku).trim().toLowerCase();
        if (tplSku !== skuLower) return false;
        if (tpl.scope === "SKU_SUPPLIER") {
          const tplSupplier = (tpl.supplier || "").trim().toLowerCase();
          return supplierLower ? tplSupplier === supplierLower : false;
        }
        return tpl.scope === "SKU";
      })
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  function getTemplateCandidates(skuValue, supplierValue) {
    if (!skuValue) return [];
    const results = [];
    const product = productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === skuValue.trim().toLowerCase());
    if (product && product.template) {
      const scope = product.template.scope === "SKU_SUPPLIER" ? "SKU_SUPPLIER" : "SKU";
      const tplSupplier = (product.template.supplierId || product.supplierId || "").trim().toLowerCase();
      const supplierLower = (supplierValue || "").trim().toLowerCase();
      const matches = scope === "SKU_SUPPLIER" ? (supplierLower && tplSupplier === supplierLower) : true;
      if (matches) {
        results.push({
          id: `product-${product.sku}-${scope}`,
          name: product.template.name || (scope === "SKU_SUPPLIER" ? "Produkt-Template (SKU+Supplier)" : "Produkt-Template (SKU)"),
          scope,
          source: "product",
          template: product.template,
        });
      }
    }
    const legacy = legacyTemplatesFor(skuValue, supplierValue);
    legacy.forEach(tpl => {
      results.push({
        id: tpl.id,
        name: tpl.name || (tpl.scope === "SKU_SUPPLIER" ? "Legacy (SKU+Supplier)" : "Legacy (SKU)"),
        scope: tpl.scope,
        source: "legacy",
        template: tpl,
      });
    });
    return results;
  }

  function refreshSkuOptions() {
    if (!quickfillEnabled || !skuList) return;
    refreshProductCache();
    skuList.innerHTML = "";
    productCache
      .filter(prod => prod && prod.status !== "inactive")
      .forEach(prod => {
        skuList.append(el("option", { value: formatProductOption(prod) }));
      });
  }

  function refreshQuickfillControls() {
    if (!quickfillEnabled) return;
    refreshSkuOptions();
    renderRecentChips();
    const skuValue = parseSkuInputValue(skuInput?.value || editing.sku || "");
    const supplierValue = supplierInput?.value?.trim() || "";
    const latest = findLatestMatch(skuValue, supplierValue);
    const templateCandidates = getTemplateCandidates(skuValue, supplierValue);
    if (quickLatestBtn) {
      quickLatestBtn.disabled = !latest && templateCandidates.length === 0;
      if (latest) {
        quickLatestBtn.title = `Werte aus ${config.entityLabel} ${latest[config.numberField] || "—"} übernehmen`;
      } else if (templateCandidates.length) {
        quickLatestBtn.title = `Werte aus ${templateCandidates[0].name} übernehmen`;
      } else {
        quickLatestBtn.title = "Keine Produktvorlage oder Vorgänger-POs für diese SKU";
      }
    }
    if (quickHistoryBtn) {
      const hasHistory = skuValue && (getHistoryFor(skuValue, supplierValue).length > 0 || (!supplierValue && getHistoryFor(skuValue, null).length > 0));
      quickHistoryBtn.disabled = !hasHistory;
      quickHistoryBtn.title = hasHistory ? "" : "Keine Vorgänger-POs für diese SKU";
    }
    if (templateLoadBtn) {
      const candidates = getTemplateCandidates(skuValue, supplierValue);
      templateLoadBtn.disabled = candidates.length === 0;
      templateLoadBtn.title = candidates.length ? "" : "Kein Template verfügbar";
    }
  }

  function applySourceRecord(source, message) {
    if (!source) return;
    const settings = getSettings();
    const merged = applyQuickfillSource(editing, source);
    if (quickfillEnabled) {
      const skuValue = (skuInput?.value?.trim() || source.sku || "").trim();
      const supplierValue = (supplierInput?.value?.trim() || source.supplier || "").trim();
      merged.sku = parseSkuInputValue(skuValue);
      merged.supplier = supplierValue;
    }
    normaliseGoodsFields(merged, settings);
    ensureAutoEvents(merged, settings, merged.milestones || []);
    loadForm(merged);
    const parsedSku = parseSkuInputValue(merged.sku);
    if (parsedSku) {
      const product = resolveProductFromInput(parsedSku) || productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === parsedSku.trim().toLowerCase());
      if (product) {
        setSkuField(product);
        recordRecentProduct(product.sku);
      }
    }
    if (message) setQuickStatus(message);
  }

  function renderDiffList(diffs, container) {
    if (!container) return;
    container.innerHTML = "";
    if (!diffs.length) {
      container.append(el("p", { class: "muted" }, ["Keine Unterschiede zum aktuellen Formular."]));
      return;
    }
    const list = el("dl", { class: "po-diff-list" });
    diffs.forEach(diff => {
      list.append(
        el("dt", {}, [diff.label]),
        el("dd", {}, [diff.type === "list"
          ? `Anzahl ${diff.before} → ${diff.after}`
          : `${diff.before} → ${diff.after}`]),
      );
    });
    container.append(list);
  }

  function openHistoryModal() {
    if (!quickfillEnabled) return;
    const skuValue = parseSkuInputValue(skuInput?.value || editing.sku || "");
    if (!skuValue) {
      window.alert("Bitte zuerst eine SKU wählen.");
      return;
    }
    const supplierValue = supplierInput?.value?.trim() || "";
    let records = getHistoryFor(skuValue, supplierValue);
    let usingSupplier = true;
    if (!records.length && supplierValue) {
      records = getHistoryFor(skuValue, null);
      usingSupplier = false;
    }
    if (!records.length) {
      window.alert("Keine Vorgänger-POs für diese SKU gefunden.");
      return;
    }
    const tableBody = el("tbody");
    const diffZone = el("div", { class: "po-history-diff" });
    const wrapper = el("div", { class: "po-history" }, [
      el("p", { class: "muted" }, [usingSupplier ? "Sortiert nach Datum (neueste zuerst)." : "Keine passende Lieferantenhistorie – zeige jüngste POs dieser SKU." ]),
      el("table", { class: "po-history-table" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["PO-Nr."]),
            el("th", {}, ["Bestelldatum"]),
            el("th", {}, ["Stückzahl"]),
            el("th", {}, ["Stückpreis (USD)"]),
            el("th", {}, ["Produktionstage"]),
            el("th", {}, ["Transit-Tage"]),
            el("th", {}, ["Transport"]),
            el("th", {}, ["Fracht (€)"]),
            el("th", {}, ["Zoll %"]),
            el("th", {}, ["EUSt %"]),
            el("th", {}, ["FX-Fee %"]),
            el("th", {}, ["Aktionen"]),
          ]),
        ]),
        tableBody,
      ]),
      diffZone,
    ]);

    const overlay = buildModal({ title: `Historie für ${skuValue}`, content: wrapper, actions: [] });
    const footer = overlay.querySelector(".po-modal-actions");
    if (footer) {
      footer.innerHTML = "";
      footer.append(
        el("button", { class: "btn", type: "button", onclick: () => closeModal(overlay) }, ["Abbrechen"]),
      );
    }

    const settings = getSettings();
    const currentSnapshot = JSON.parse(JSON.stringify(editing));
    normaliseGoodsFields(currentSnapshot, settings);
    ensureAutoEvents(currentSnapshot, settings, currentSnapshot.milestones || []);

    records.slice(0, 10).forEach((rec, index) => {
      const normalized = normaliseHistory([rec])[0];
      const compareBtn = el("button", { class: "btn secondary", type: "button" }, ["Vergleichen"]);
      const applyBtn = el("button", { class: "btn primary", type: "button" }, ["Übernehmen"]);
      applyBtn.addEventListener("click", () => {
        closeModal(overlay);
        applySourceRecord(normalized, `Werte aus ${config.entityLabel} ${rec[config.numberField] || ""} übernommen. Du kannst alles anpassen.`);
      });
      compareBtn.addEventListener("click", () => {
        const incoming = applyQuickfillSource(currentSnapshot, normalized);
        const diffs = diffFields(currentSnapshot, incoming);
        renderDiffList(diffs, diffZone);
      });
      const freightText = fmtEUR(resolveFreightTotal(normalized, computeGoodsTotals(normalized, settings)));
      tableBody.append(
        el("tr", { class: index === 0 ? "po-history-latest" : "" }, [
          el("td", {}, [rec[config.numberField] || "—"]),
          el("td", {}, [fmtDateDE(rec.orderDate)]),
          el("td", {}, [Number(parseDE(normalized.units || rec.units || 0) || 0).toLocaleString("de-DE")]),
          el("td", {}, [fmtUSD(parseDE(normalized.unitCostUsd || rec.unitCostUsd || 0))]),
          el("td", {}, [String(rec.prodDays || 0)]),
          el("td", {}, [String(rec.transitDays || 0)]),
          el("td", {}, [rec.transport || "—"]),
          el("td", {}, [freightText]),
          el("td", {}, [`${fmtPercent(normalized.dutyRatePct ?? rec.dutyRatePct ?? 0)} %`]),
          el("td", {}, [`${fmtPercent(normalized.eustRatePct ?? rec.eustRatePct ?? 0)} %`]),
          el("td", {}, [`${fmtPercent(normalized.fxFeePct ?? rec.fxFeePct ?? 0)} %`]),
          el("td", { class: "po-history-actions" }, [compareBtn, applyBtn]),
        ]),
      );
    });
  }

  function openTemplateModal() {
    if (!quickfillEnabled) return;
    const skuValue = parseSkuInputValue(skuInput?.value || editing.sku || "");
    if (!skuValue) {
      window.alert("Bitte zuerst eine SKU eingeben.");
      return;
    }
    const supplierValue = supplierInput?.value?.trim() || "";
    refreshProductCache();
    const nameInput = el("input", { type: "text", placeholder: "z. B. Standardbestellung" });
    const scopeSelect = el("select", {}, [
      el("option", { value: "SKU" }, ["SKU"]),
      el("option", { value: "SKU_SUPPLIER" }, ["SKU+Supplier"]),
    ]);
    if (!supplierValue) scopeSelect.value = "SKU";
    const fieldList = el("div", { class: "po-template-fields" });
    TEMPLATE_FIELD_OPTIONS.forEach(opt => {
      const checkbox = el("input", { type: "checkbox", value: opt.key, id: `tpl-${opt.key}` });
      if (opt.key !== "autoEvents") checkbox.checked = true;
      const label = el("label", { for: `tpl-${opt.key}` }, [opt.label]);
      const row = el("div", { class: "po-template-field" }, [checkbox, label]);
      fieldList.append(row);
    });
    const content = el("div", { class: "po-template-form" }, [
      el("label", {}, ["Name"]),
      nameInput,
      el("label", { style: "margin-top:12px" }, ["Geltungsbereich"]),
      scopeSelect,
      el("p", { class: "muted" }, ["Welche Felder übernehmen?" ]),
      fieldList,
    ]);

    const overlay = buildModal({ title: "Als Template speichern", content, actions: [] });
    const footer = overlay.querySelector(".po-modal-actions");
    if (footer) {
      footer.innerHTML = "";
      const cancelBtn = el("button", { class: "btn", type: "button", onclick: () => closeModal(overlay) }, ["Abbrechen"]);
      const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Speichern"]);
      saveBtn.addEventListener("click", () => {
        const selected = Array.from(fieldList.querySelectorAll("input[type=checkbox]:checked"))
          .map(cb => cb.value);
        if (!selected.length) {
          window.alert("Bitte mindestens ein Feld auswählen.");
          return;
        }
        const scope = scopeSelect.value === "SKU_SUPPLIER" && supplierValue ? "SKU_SUPPLIER" : "SKU";
        const template = {
          scope,
          supplierId: scope === "SKU_SUPPLIER" ? supplierValue : "",
          name: nameInput.value.trim() || (scope === "SKU_SUPPLIER" ? "Standard (SKU+Supplier)" : "Standard (SKU)"),
          fields: {},
          updatedAt: new Date().toISOString(),
        };
        selected.forEach(key => {
          if (key === "milestones") {
            template.fields[key] = cloneMilestones(editing.milestones || []);
          } else if (key === "autoEvents") {
            template.fields[key] = cloneAutoEvents(editing.autoEvents || []);
          } else {
            template.fields[key] = editing[key];
          }
        });
        const existingProduct = productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === skuValue.trim().toLowerCase());
        const payload = {
          sku: skuValue,
          alias: existingProduct?.alias || skuValue,
          supplierId: existingProduct?.supplierId || "",
          status: existingProduct?.status || "active",
          tags: existingProduct?.tags || [],
          template,
        };
        if (existingProduct?.sku) {
          payload.originalSku = existingProduct.sku;
        }
        upsertProduct(payload);
        recordRecentProduct(skuValue);
        refreshProductCache();
        refreshQuickfillControls();
        setQuickStatus(`Template „${template.name}“ gespeichert.`);
        closeModal(overlay);
      });
      footer.append(cancelBtn, saveBtn);
    }
  }

  function applyTemplateCandidate(entry) {
    if (!entry || !entry.template) return;
    const fields = entry.template.fields ? JSON.parse(JSON.stringify(entry.template.fields)) : JSON.parse(JSON.stringify(entry.template));
    applySourceRecord(fields, `Template „${entry.name}“ geladen. Du kannst alles anpassen.`);
  }

  function openTemplatePicker(candidates) {
    let overlay;
    const list = el("div", { class: "po-template-picker" });
    candidates.forEach(entry => {
      const scopeLabel = entry.scope === "SKU_SUPPLIER" ? "SKU+Supplier" : "SKU";
      const row = el("div", { class: "po-template-row" }, [
        el("div", { class: "po-template-info" }, [
          el("strong", {}, [entry.name || "Template"]),
          el("span", { class: "muted" }, [`${scopeLabel} • ${entry.source === "product" ? "Produkt" : "Legacy"}`]),
        ]),
        el("div", { class: "po-template-actions" }, [
          el("button", { class: "btn", type: "button", onclick: () => {
            applyTemplateCandidate(entry);
            closeModal(overlay);
          } }, ["Übernehmen"]),
        ]),
      ]);
      list.append(row);
    });
    overlay = buildModal({ title: "Template wählen", content: list, actions: [] });
    const footer = overlay.querySelector(".po-modal-actions");
    if (footer) {
      footer.innerHTML = "";
      footer.append(
        el("button", { class: "btn", type: "button", onclick: () => closeModal(overlay) }, ["Abbrechen"]),
      );
    }
  }

  function handleTemplateLoad() {
    if (!quickfillEnabled) return;
    const skuValue = parseSkuInputValue(skuInput?.value || editing.sku || "");
    if (!skuValue) {
      window.alert("Bitte zuerst eine SKU wählen.");
      return;
    }
    const supplierValue = supplierInput?.value?.trim() || "";
    refreshProductCache();
    const candidates = getTemplateCandidates(skuValue, supplierValue);
    if (!candidates.length) {
      window.alert("Kein Template verfügbar.");
      return;
    }
    if (candidates.length === 1) {
      applyTemplateCandidate(candidates[0]);
      return;
    }
    openTemplatePicker(candidates);
  }

  function openCreateProductModal() {
    refreshProductCache();
    const form = el("form", { class: "po-product-create" });
    const skuField = el("input", { required: true, placeholder: "SKU" });
    const aliasField = el("input", { required: true, placeholder: "Alias" });
    const supplierField = el("input", { placeholder: "Supplier" });
    form.append(
      el("label", {}, ["SKU", skuField]),
      el("label", {}, ["Alias", aliasField]),
      el("label", {}, ["Supplier", supplierField])
    );
    const overlay = buildModal({ title: "Neues Produkt anlegen", content: form, actions: [] });
    const footer = overlay.querySelector(".po-modal-actions");
    if (footer) {
      const cancelBtn = el("button", { class: "btn", type: "button", onclick: () => closeModal(overlay) }, ["Abbrechen"]);
      const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Speichern"]);
      saveBtn.addEventListener("click", () => {
        const sku = skuField.value.trim();
        const alias = aliasField.value.trim();
        if (!sku || !alias) {
          window.alert("Bitte SKU und Alias angeben.");
          return;
        }
        try {
          upsertProduct({
            sku,
            alias,
            supplierId: supplierField.value.trim(),
            status: "active",
            tags: [],
          });
          recordRecentProduct(sku);
          refreshProductCache();
          if (skuInput) {
            const product = productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === sku.trim().toLowerCase());
            if (product) {
              setSkuField(product);
              editing.sku = product.sku;
              refreshQuickfillControls();
              updateSaveEnabled();
            }
          }
          closeModal(overlay);
          setQuickStatus("Produkt angelegt.");
        } catch (err) {
          window.alert(err.message || String(err));
        }
      });
      footer.innerHTML = "";
      footer.append(cancelBtn, saveBtn);
    }
  }

  function updatePreview(settings) {
    const snapshot = JSON.parse(JSON.stringify(editing));
    syncEditingFromForm(settings, snapshot);
    const draft = JSON.parse(JSON.stringify(snapshot));
    normaliseGoodsFields(draft, settings);
    const events = orderEvents(draft, config, settings);
    preview.innerHTML = "";
    preview.append(el("h4", {}, ["Ereignisse"]));
    preview.append(buildEventList(events, editing.paymentLog, getMergedPayments(editing)));
  }

  function updateTimelineOverrides(timeline) {
    if (etdComputed) etdComputed.textContent = fmtDateDE(timeline?.etdComputed);
    if (etaComputed) etaComputed.textContent = fmtDateDE(timeline?.etaComputed);
    if (etdResetBtn) etdResetBtn.disabled = !editing.etdManual;
    if (etaResetBtn) etaResetBtn.disabled = !editing.etaManual;
  }

  function updateSaveEnabled() {
    const sum = (editing.milestones || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
    const hasSku = (!quickfillEnabled || (skuInput && skuInput.value.trim() !== "")) || (editing.items || []).some(it => it.sku);
    const ok = (Math.round(sum * 10) / 10 === 100)
      && (numberInput.value.trim() !== "")
      && (computeGoodsTotals(editing, getSettings()).usd > 0)
      && !!orderDateInput.value
      && hasSku;
    saveBtn.disabled = !ok || !draftForm.isDirty;
    if (convertBtn) convertBtn.disabled = !ok;
    updateDirtyBadge();
  }

  function setSaveLoading(isLoading) {
    [saveBtn, poSaveHeader].forEach(btn => {
      if (!btn) return;
      if (!btn.dataset.label) btn.dataset.label = btn.textContent;
      btn.textContent = isLoading ? "Speichern…" : btn.dataset.label;
      btn.disabled = isLoading || btn.disabled;
    });
  }

  async function handleSave() {
    if (saveBtn.disabled) return;
    setSaveLoading(true);
    await saveRecord();
    setSaveLoading(false);
    updateSaveEnabled();
  }

  function updateDirtyBadge() {
    if (!poStatus) return;
    const status = editing.archived ? "Status: Archiviert" : "Status: Aktiv";
    poStatus.textContent = draftForm.isDirty ? `${status} • Ungespeichert` : status;
  }

  function updateGoodsSummary(totals, estimate) {
    if (!goodsSummary) return;
    const eurText = fmtEUR(totals.eur || 0);
    const usdText = fmtUSD(totals.usd || 0);
    const fxText = fmtFxRate(totals.fxRate);
    const derived = estimate || updateDerivedFreight(editing, getSettings());
    const freightText = fmtEUR(derived?.estimatedFreightEur || 0);
    const freightSuffix = derived?.mode === "AUTO_FROM_LANDED" && derived?.missingLandedCount
      ? ` · Einstandskosten fehlen (${derived.missingLandedCount})`
      : "";
    goodsSummary.textContent = fxText
      ? `Summe Warenwert: ${eurText} (${usdText} ÷ FX ${fxText}) · Geschätzte Fracht (EUR): ${freightText}${freightSuffix}`
      : `Summe Warenwert: ${eurText} (${usdText}) · Geschätzte Fracht (EUR): ${freightText}${freightSuffix}`;
  }

  function updateFreightModeUI() {
    if (!freightModeSelect || !freightInput || !freightPerUnitInput) return;
    const mode = freightModeSelect.value || "TOTAL_EUR";
    const isAuto = mode === "AUTO_FROM_LANDED";
    freightInput.disabled = mode === "PER_UNIT_EUR" || isAuto;
    freightPerUnitInput.disabled = mode !== "PER_UNIT_EUR" || isAuto;
    if (freightModeHint) freightModeHint.hidden = !isAuto;
  }

  function resolveFreightFxUsdPerEur(product, settings) {
    const fxFromForm = parseDE(fxRateInput?.value ?? "");
    if (Number.isFinite(fxFromForm) && fxFromForm > 0) return fxFromForm;
    const template = product?.template?.fields ? product.template.fields : product?.template;
    const productFx = parseDE(product?.fxUsdPerEur ?? template?.fxRate ?? "");
    if (Number.isFinite(productFx) && productFx > 0) return productFx;
    const settingsFx = typeof settings.fxRate === "number" ? settings.fxRate : parseDE(settings.fxRate);
    if (Number.isFinite(settingsFx) && settingsFx > 0) return settingsFx;
    return null;
  }

  function resolveFreightPerUnitSuggestion(product, settings) {
    if (!product) return { value: null, warning: false, missingFields: [] };
    const stored = parseDE(product.freightPerUnitEur);
    if (Number.isFinite(stored) && stored > 0) {
      return { value: stored, warning: false, missingFields: [] };
    }
    const template = product.template?.fields ? product.template.fields : product.template;
    const unitPriceUsd = parseDE(template?.unitPriceUsd ?? product.unitPriceUsd ?? "");
    const landedCostEur = parseDE(product.landedUnitCostEur ?? product.landedCostEur ?? "");
    const fxUsdPerEur = resolveFreightFxUsdPerEur(product, settings);
    return computeFreightPerUnitEur({
      unitPriceUsd,
      landedCostEur,
      fxUsdPerEur,
    });
  }

  function updateFreightPerUnitSuggestion(product, { force = false } = {}) {
    if (!freightPerUnitInput) return;
    if (!product) {
      if (freightPerUnitSuggested) freightPerUnitSuggested.textContent = "";
      if (freightPerUnitWarning) freightPerUnitWarning.textContent = "";
      return;
    }
    const settings = getSettings();
    const suggestion = resolveFreightPerUnitSuggestion(product, settings);
    if (freightPerUnitSuggested) {
      freightPerUnitSuggested.textContent = suggestion.value != null
        ? `Vorschlag: ${fmtEURPlain(suggestion.value)}`
        : "Vorschlag: —";
    }
    if (freightPerUnitWarning) {
      freightPerUnitWarning.textContent = suggestion.missingFields.length
        ? formatFreightMissingFields(suggestion.missingFields)
        : "";
    }
    const currentValue = parseDE(freightPerUnitInput.value);
    const hasValue = Number.isFinite(currentValue) && currentValue > 0;
    if (!freightPerUnitOverridden && (force || !hasValue)) {
      if (suggestion.value != null) {
        freightPerUnitInput.value = fmtCurrencyInput(suggestion.value);
      } else if (force || !hasValue) {
        freightPerUnitInput.value = "";
      }
    }
  }

  function applyProductDefaultsFromProduct(product) {
    if (!product) return false;
    const template = product.template?.fields ? product.template.fields : product.template;
    if (!template || typeof template !== "object") return false;
    const settings = getSettings();
    const next = JSON.parse(JSON.stringify(editing));
    const parseNum = (value) => {
      const parsed = typeof value === "number" ? value : parseDE(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const setMoney = (key, value) => {
      const parsed = parseNum(value);
      if (parsed == null) return;
      next[key] = fmtCurrencyInput(parsed);
    };
    const setNumber = (key, value) => {
      const parsed = parseNum(value);
      if (parsed == null) return;
      next[key] = parsed;
    };

    setMoney("unitCostUsd", template.unitPriceUsd ?? product.unitPriceUsd);
    setMoney("unitExtraUsd", template.extraPerUnitUsd);
    setMoney("extraFlatUsd", template.extraFlatUsd);
    setNumber("fxOverride", template.fxRate ?? settings.fxRate);
    setNumber("fxFeePct", template.fxFeePct ?? settings.fxFeePct);
    const transportMode = template.transportMode || template.transport;
    if (transportMode) {
      next.transport = String(transportMode).toLowerCase();
    }
    setNumber("prodDays", template.productionDays ?? product.productionLeadTimeDaysDefault);
    setNumber("transitDays", template.transitDays);
    const freightPerUnit = parseNum(template.freightEur);
    if (freightPerUnit != null) {
      next.freightMode = "per_unit";
      next.freightPerUnitEur = fmtCurrencyInput(freightPerUnit);
      next.freightEur = fmtCurrencyInput(0);
    }
    setNumber("dutyRatePct", template.dutyPct ?? settings.dutyRatePct);
    if (typeof template.dutyIncludesFreight === "boolean") {
      next.dutyIncludeFreight = template.dutyIncludesFreight;
    }
    setNumber("eustRatePct", template.vatImportPct ?? settings.eustRatePct);
    if (typeof template.vatRefundActive === "boolean") {
      next.vatRefundEnabled = template.vatRefundActive;
    }
    setNumber("vatRefundLagMonths", template.vatRefundLag ?? settings.vatRefundLagMonths);
    if (typeof template.ddp === "boolean") {
      next.ddp = template.ddp;
    }

    if (Array.isArray(next.items)) {
      next.items = next.items.map(item => {
        if (!item || (item.sku && item.sku !== product.sku)) return item;
        const updated = { ...item };
        if (template.unitPriceUsd != null || product.unitPriceUsd != null) {
          updated.unitCostUsd = fmtCurrencyInput(template.unitPriceUsd ?? product.unitPriceUsd);
          updated.unitCostManuallyEdited = false;
        }
        if (template.extraPerUnitUsd != null) {
          updated.unitExtraUsd = fmtCurrencyInput(template.extraPerUnitUsd);
        }
        if (template.extraFlatUsd != null) {
          updated.extraFlatUsd = fmtCurrencyInput(template.extraFlatUsd);
        }
        return updated;
      });
    }

    loadForm(next);
    return true;
  }

  function syncEditingFromForm(settings = getSettings(), target = editing) {
    const draft = target || editing;
    if (quickfillEnabled) {
      draft.sku = skuInput ? parseSkuInputValue(skuInput.value) : "";
      draft.supplier = supplierInput ? supplierInput.value.trim() : "";
    }
    draft[config.numberField] = numberInput.value.trim();
    const parsedDisplay = parseDeDate(orderDateDisplay?.value || "");
    const isoFromDisplay = parsedDisplay ? formatDateISO(parsedDisplay) : null;
    const isoFromPicker = orderDateInput?.value || null;
    draft.orderDate = isoFromDisplay || isoFromPicker || draft.orderDate;
    const domItems = itemsZone ? Array.from(itemsZone.querySelectorAll("[data-item-id]")) : [];
    const nextItems = [];
    domItems.forEach(row => {
      const id = row.dataset.itemId || `item-${Math.random().toString(36).slice(2, 9)}`;
      const [skuInputEl, unitsEl, unitCostEl, unitExtraEl, flatEl] = row.querySelectorAll("input");
      nextItems.push({
        id,
        sku: skuInputEl?.value?.trim() || "",
        units: unitsEl?.value || "0",
        unitCostUsd: fmtCurrencyInput(unitCostEl?.value || "0,00"),
        unitExtraUsd: fmtCurrencyInput(unitExtraEl?.value || "0,00"),
        extraFlatUsd: fmtCurrencyInput(flatEl?.value || "0,00"),
        unitCostManuallyEdited: row.dataset.unitCostManual === "true",
      });
    });
    if (nextItems.length) {
      draft.items = nextItems;
    }
    ensureItems(draft);
    const fxOverrideValue = parseDE(fxRateInput?.value ?? "");
    draft.fxOverride = Number.isFinite(fxOverrideValue) && fxOverrideValue > 0 ? fxOverrideValue : null;
    draft.timeline = draft.timeline || {};
    draft.timeline.fxUsdPerEur = draft.fxOverride
      ? draft.fxOverride
      : (Number.isFinite(settings.fxRate) && settings.fxRate > 0 ? settings.fxRate : null);
    normaliseGoodsFields(draft, settings);
    const totals = computeGoodsTotals(draft, settings);
    const selectedMode = freightModeSelect?.value || "TOTAL_EUR";
    draft.timeline = draft.timeline || {};
    draft.timeline.freightInputMode = selectedMode;
    draft.freightMode = selectedMode === "PER_UNIT_EUR" ? "per_unit" : "total";
    draft.freightEur = fmtCurrencyInput(freightInput.value);
    draft.freightPerUnitEur = fmtCurrencyInput(freightPerUnitInput?.value || "");
    const estimate = updateDerivedFreight(draft, settings);
    updateGoodsSummary(totals, estimate);
    draft.prodDays = Number(prodInput.value || 0);
    draft.transport = transportSelect.value;
    draft.transitDays = Number(transitInput.value || 0);
    draft.dutyRatePct = clampPct(dutyRateInput.value);
    draft.dutyIncludeFreight = dutyIncludeToggle.checked;
    draft.eustRatePct = clampPct(eustRateInput.value);
    draft.fxFeePct = clampPct(fxFeeInput.value);
    draft.vatRefundLagMonths = Number(vatLagInput.value || 0);
    draft.vatRefundEnabled = vatToggle.checked;
    draft.ddp = ddpToggle.checked;
    if (etdManualInput) {
      draft.etdManual = etdManualInput.value || null;
    }
    if (etaManualInput) {
      draft.etaManual = etaManualInput.value || null;
    }
    const timeline = computeTimeline(draft, settings);
    draft.cnyAdjustmentDays = timeline?.cnyAdjustmentDays || 0;
    return estimate;
  }

  function onAnyChange(opts = {}) {
    let focusInfo = opts.focusInfo || null;
    if (!focusInfo) {
      const active = document.activeElement;
      if (active && active.closest && active.closest("[data-ms-id]")) {
        const row = active.closest("[data-ms-id]");
        focusInfo = {
          id: row?.dataset?.msId,
          field: active.dataset?.field || null,
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd,
        };
      }
    }
    const settings = getSettings();
    let estimate = syncEditingFromForm(settings);
    if (!transitInput.value) {
      transitInput.value = editing.transport === "air" ? "10" : (editing.transport === "rail" ? "30" : "60");
    }
    estimate = syncEditingFromForm(settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    ensurePaymentLog(editing);
    renderTimeline(timelineZone, timelineSummary, editing, settings, cnyBanner);
    updateTimelineOverrides(computeTimeline(editing, settings));
    renderMsTable(msZone, editing, config, onAnyChange, focusInfo, settings);
    updatePreview(settings);
    updateLogisticsCells(itemsZone, estimate);
    updateSaveEnabled();
    draftForm.setDraft(editing);
    isDirty = draftForm.isDirty;
  }

  function updateOrderDateFields(iso) {
    const safeIso = iso || new Date().toISOString().slice(0, 10);
    if (orderDateInput) orderDateInput.value = safeIso;
    if (orderDateDisplay) orderDateDisplay.value = fmtDateDE(safeIso);
    if (orderDateError) orderDateError.textContent = "";
  }

  function validateOrderDate(showError = false) {
    const parsed = parseDeDate(orderDateDisplay?.value || "") || parseISOToDate(orderDateInput?.value || "");
    if (!parsed) {
      if (orderDateError && showError) {
        orderDateError.textContent = "Bitte Datum im Format TT.MM.JJJJ eingeben";
      }
      return null;
    }
    if (orderDateError) orderDateError.textContent = "";
    const isoVal = formatDateISO(parsed);
    if (orderDateInput) orderDateInput.value = isoVal;
    if (orderDateDisplay) orderDateDisplay.value = fmtDateDE(isoVal);
    return isoVal;
  }

  function applyDraftToForm() {
    const settings = getSettings();
    editing = draftForm.draft;
    normaliseGoodsFields(editing, settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    ensurePaymentLog(editing);
    normaliseArchiveFlag(editing);
    if (!editing.paymentDrafts) editing.paymentDrafts = {};
    if (poStatus) {
      poStatus.textContent = editing.archived ? "Status: Archiviert" : "Status: Aktiv";
    }
    if (poMeta) {
      const number = editing[config.numberField] || "—";
      const supplier = editing.supplier || "—";
      poMeta.textContent = `${number} • ${supplier}`;
    }
    renderItemsTable(itemsZone, editing, () => onAnyChange(), itemsDataListId);
    if (quickfillEnabled) {
      refreshProductCache();
      if (skuInput) {
        const product = productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === String(editing.sku || "").trim().toLowerCase());
        if (product) {
          setSkuField(product);
        } else {
          skuInput.value = editing.sku || "";
          skuInput.dataset.sku = editing.sku || "";
        }
      }
      if (supplierInput) supplierInput.value = editing.supplier || "";
      setQuickStatus("");
      refreshQuickfillControls();
    }
    numberInput.value = editing[config.numberField] || "";
    updateOrderDateFields(editing.orderDate || new Date().toISOString().slice(0, 10));
    const fxBase = editing.fxOverride ?? settings.fxRate ?? 0;
    if (fxRateInput) fxRateInput.value = fxBase ? fmtFxRate(fxBase) : "";
    const estimate = updateDerivedFreight(editing, settings);
    updateGoodsSummary(computeGoodsTotals(editing, settings), estimate);
    if (freightModeSelect) freightModeSelect.value = resolveFreightInputMode(editing);
    freightInput.value = fmtCurrencyInput(editing.freightEur ?? "0,00");
    if (freightPerUnitInput) freightPerUnitInput.value = fmtCurrencyInput(editing.freightPerUnitEur ?? "0,00");
    freightPerUnitOverridden = Number.isFinite(parseDE(editing.freightPerUnitEur)) && parseDE(editing.freightPerUnitEur) > 0;
    if (freightPerUnitInput) {
      const product = productCache.find(prod => prod && prod.sku && prod.sku.trim().toLowerCase() === String(editing.sku || "").trim().toLowerCase());
      updateFreightPerUnitSuggestion(product);
    }
    updateFreightModeUI();
    prodInput.value = String(editing.prodDays ?? 60);
    transportSelect.value = editing.transport || "sea";
    transitInput.value = String(editing.transitDays ?? (editing.transport === "air" ? 10 : editing.transport === "rail" ? 30 : 60));
    dutyRateInput.value = fmtPercent(editing.dutyRatePct ?? settings.dutyRatePct ?? 0);
    dutyIncludeToggle.checked = editing.dutyIncludeFreight !== false;
    eustRateInput.value = fmtPercent(editing.eustRatePct ?? settings.eustRatePct ?? 0);
    fxFeeInput.value = fmtPercent(editing.fxFeePct ?? settings.fxFeePct ?? 0);
    vatLagInput.value = String(editing.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0);
    vatToggle.checked = editing.vatRefundEnabled !== false;
    ddpToggle.checked = !!editing.ddp;
    if (etdManualInput) etdManualInput.value = editing.etdManual || "";
    if (etaManualInput) etaManualInput.value = editing.etaManual || "";
    const timeline = computeTimeline(editing, settings);
    renderTimeline(timelineZone, timelineSummary, editing, settings, cnyBanner);
    updateTimelineOverrides(timeline);
    renderMsTable(msZone, editing, config, onAnyChange, null, settings);
    updatePreview(settings);
    updateSaveEnabled();
    isDirty = false;
  }

  function loadForm(record) {
    const settings = getSettings();
    draftForm = useDraftForm(prepareRecordForDraft(record, settings), { key: entityKeyFor(record), enableDraftCache: true });
    editing = draftForm.draft;
    lastLoaded = safeDeepClone(editing);
    applyDraftToForm();
    draftForm.markClean();
    const cached = draftForm.loadDraftIfAvailable();
    if (cached?.exists) {
      openConfirmDialog({
        title: "Entwurf gefunden",
        message: `Es gibt einen ungespeicherten Entwurf von ${formatDraftTimestamp(cached.updatedAt)}. Wiederherstellen?`,
        confirmLabel: "Wiederherstellen",
        cancelLabel: "Verwerfen",
        onConfirm: () => {
          draftForm.restoreDraft();
          applyDraftToForm();
          updateDirtyBadge();
        },
        onCancel: () => {
          draftForm.discardDraft();
          updateDirtyBadge();
        },
      });
    }
  }

  async function saveRecord() {
    const isoDate = validateOrderDate(true);
    if (!isoDate) {
      if (orderDateDisplay) orderDateDisplay.focus();
      return;
    }
    const settings = getSettings();
    syncEditingFromForm(settings);
    normaliseArchiveFlag(editing);
    const stateSnapshot = loadAppState();
    const { issues } = validateAll({
      settings: stateSnapshot.settings,
      products: stateSnapshot.products,
      suppliers: stateSnapshot.suppliers,
    });
    const blocking = issues.filter(issue => issue.blocking && issue.scope === "product"
      && issue.entityId === editing.sku
      && (issue.field === "currency" || issue.field === "unitPrice"));
    if (!editing.supplier) {
      blocking.push(makeIssue({
        scope: "po",
        entityId: editing.id || editing[config.numberField] || "po",
        severity: "error",
        field: "supplier",
        message: "Supplier fehlt.",
        hint: "Bitte einen Supplier hinterlegen.",
        blocking: true,
      }));
    }
    if (blocking.length) {
      openBlockingModal(blocking);
      return;
    }
    await draftForm.commit((draft) => {
      const st = loadAppState();
      const nextRecord = safeDeepClone(draft);
      const paymentDrafts = nextRecord.paymentDrafts || {};
      delete nextRecord.paymentDrafts;
      const basePayments = Array.isArray(st.payments) ? st.payments : [];
      const nextPayments = basePayments.map(payment => safeDeepClone(payment));
      Object.values(paymentDrafts).forEach(payload => {
        if (!payload?.id) return;
        const idx = nextPayments.findIndex(entry => entry?.id === payload.id);
        const nextPayload = safeDeepClone(payload);
        if (idx >= 0) nextPayments[idx] = { ...nextPayments[idx], ...nextPayload };
        else nextPayments.push(nextPayload);
      });
      st.payments = nextPayments;
      const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
      const idx = arr.findIndex(item => (item.id && item.id === nextRecord.id)
        || (item[config.numberField] && item[config.numberField] === nextRecord[config.numberField]));
      if (idx >= 0) arr[idx] = nextRecord;
      else arr.push(nextRecord);
      st[config.entityKey] = arr;
      commitAppState(st, {
        source: `${config.slug}:save`,
        entityKey: entityKeyFor(nextRecord),
        action: idx >= 0 ? "update" : "create",
      });
      lastLoaded = safeDeepClone(nextRecord);
    });
    renderListView(loadAppState()[config.entityKey]);
    refreshQuickfillControls();
    if (quickfillEnabled && editing.sku) {
      recordRecentProduct(editing.sku);
    }
    showToast(`${config.entityLabel || "PO"} gespeichert`);
    isDirty = false;
    if (poMode) closeFormModal();
  }

  async function convertRecord() {
    if (!config.convertTo) return;
    const settings = getSettings();
    syncEditingFromForm(settings);
    if (saveBtn.disabled) {
      window.alert("Bitte gültige Daten eingeben, bevor die FO umgewandelt wird.");
      return;
    }

    await saveRecord();

    const st = loadAppState();
    if (!Array.isArray(st[config.convertTo.entityKey])) st[config.convertTo.entityKey] = [];

    const existing = st[config.convertTo.entityKey];
    const info = highestNumberInfo(existing, config.convertTo.numberField);
    const label = config.convertTo.targetLabel || config.convertTo.numberField || "PO";
    const intro = info.raw
      ? `Aktuell höchste ${label}-Nummer: ${info.raw}`
      : `Es existiert noch keine ${label}-Nummer.`;
    const suggestion = info.next || "";
    const input = window.prompt(`${intro}\nBitte neue ${label}-Nummer eingeben:`, suggestion);
    if (input == null) return;
    const trimmed = input.trim();
    if (!trimmed) {
      window.alert("Bitte eine gültige Nummer eingeben.");
      return;
    }

    const clash = existing.some(item => (item?.[config.convertTo.numberField] || "").toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      window.alert(`${label}-Nummer ${trimmed} ist bereits vergeben.`);
      return;
    }

    const copy = JSON.parse(JSON.stringify(editing));
    const newRecord = {
      ...copy,
      id: Math.random().toString(36).slice(2, 9),
      [config.convertTo.numberField]: trimmed,
    };
    delete newRecord[config.numberField];

    existing.push(newRecord);
    commitAppState(st, {
      source: `${config.slug}:convert`,
      entityKey: `${config.convertTo.slug || config.convertTo.entityKey}:${newRecord[config.convertTo.numberField] || newRecord.id}`,
      action: "create",
    });
    window.alert(`${label} ${trimmed} wurde angelegt.`);
  }

  function onEdit(record) {
    loadForm(record);
    if (poMode) openFormModal();
  }

  function onDelete(record) {
    const st = loadAppState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    st[config.entityKey] = arr.filter(item => {
      if (item.id && record.id) return item.id !== record.id;
      return item[config.numberField] !== record[config.numberField];
    });
    commitAppState(st, {
      source: `${config.slug}:delete`,
      entityKey: entityKeyFor(record),
      action: "delete",
    });
    renderListView(loadAppState()[config.entityKey]);
    loadForm(defaultRecord(config, getSettings()));
    if (poMode) closeFormModal();
  }

  if (addItemBtn) {
    addItemBtn.addEventListener("click", () => {
      ensureItems(editing);
      editing.items.push({
        id: `item-${Math.random().toString(36).slice(2, 9)}`,
        sku: "",
        units: "0",
        unitCostUsd: "0,00",
        unitExtraUsd: "0,00",
        extraFlatUsd: "0,00",
        unitCostManuallyEdited: false,
      });
      renderItemsTable(itemsZone, editing, () => onAnyChange(), itemsDataListId);
      onAnyChange();
    });
  }
  if (addMiscItemBtn) {
    addMiscItemBtn.addEventListener("click", () => {
      ensureItems(editing);
      editing.items.push({
        id: `item-${Math.random().toString(36).slice(2, 9)}`,
        sku: "",
        units: "0",
        unitCostUsd: "0,00",
        unitExtraUsd: "0,00",
        extraFlatUsd: "0,00",
        unitCostManuallyEdited: false,
        type: "misc",
      });
      renderItemsTable(itemsZone, editing, () => onAnyChange(), itemsDataListId);
      onAnyChange();
    });
  }
  if (orderDateDisplay) {
    orderDateDisplay.addEventListener("blur", () => validateOrderDate(true));
    orderDateDisplay.addEventListener("input", () => {
      if (orderDateError) orderDateError.textContent = "";
    });
  }
  if (orderDateInput) {
    orderDateInput.addEventListener("change", () => {
      updateOrderDateFields(orderDateInput.value);
      onAnyChange();
    });
  }
  if (orderDatePickerBtn && orderDateInput) {
    orderDatePickerBtn.addEventListener("click", () => {
      if (orderDateInput.showPicker) {
        orderDateInput.showPicker();
      } else {
        orderDateInput.focus();
      }
    });
  }
  if (freightModeSelect) {
    freightModeSelect.addEventListener("change", () => {
      updateFreightModeUI();
      onAnyChange();
    });
  }
  freightInput.addEventListener("input", onAnyChange);
  freightInput.addEventListener("blur", () => {
    freightInput.value = fmtCurrencyInput(freightInput.value);
    onAnyChange();
  });
  if (freightPerUnitInput) {
    freightPerUnitInput.addEventListener("input", () => {
      freightPerUnitOverridden = true;
      onAnyChange();
    });
    freightPerUnitInput.addEventListener("blur", () => {
      freightPerUnitInput.value = fmtCurrencyInput(freightPerUnitInput.value);
      onAnyChange();
    });
  }
  if (freightPerUnitReset) {
    freightPerUnitReset.addEventListener("click", () => {
      freightPerUnitOverridden = false;
      const product = resolveProductFromInput(skuInput?.value || editing.sku || "");
      updateFreightPerUnitSuggestion(product, { force: true });
      onAnyChange();
    });
  }
  dutyRateInput.addEventListener("input", onAnyChange);
  dutyRateInput.addEventListener("blur", () => {
    const next = clampPct(dutyRateInput.value);
    dutyRateInput.value = fmtPercent(next);
    onAnyChange();
  });
  dutyIncludeToggle.addEventListener("change", onAnyChange);
  eustRateInput.addEventListener("input", onAnyChange);
  eustRateInput.addEventListener("blur", () => {
    const next = clampPct(eustRateInput.value);
    eustRateInput.value = fmtPercent(next);
    onAnyChange();
  });
  fxFeeInput.addEventListener("input", onAnyChange);
  fxFeeInput.addEventListener("blur", () => {
    const next = clampPct(fxFeeInput.value);
    fxFeeInput.value = fmtPercent(next);
    onAnyChange();
  });
  if (fxRateInput) {
    fxRateInput.addEventListener("input", () => {
      onAnyChange();
      const product = resolveProductFromInput(skuInput?.value || editing.sku || "");
      updateFreightPerUnitSuggestion(product);
    });
    fxRateInput.addEventListener("blur", () => {
      const parsed = parseDE(fxRateInput.value);
      fxRateInput.value = parsed > 0 ? fmtFxRate(parsed) : "";
      onAnyChange();
      const product = resolveProductFromInput(skuInput?.value || editing.sku || "");
      updateFreightPerUnitSuggestion(product);
    });
  }
  vatLagInput.addEventListener("input", onAnyChange);
  vatToggle.addEventListener("change", onAnyChange);
  ddpToggle.addEventListener("change", onAnyChange);
  if (etdManualInput) etdManualInput.addEventListener("change", onAnyChange);
  if (etaManualInput) etaManualInput.addEventListener("change", onAnyChange);
  if (etdResetBtn) {
    etdResetBtn.addEventListener("click", () => {
      if (etdManualInput) etdManualInput.value = "";
      editing.etdManual = null;
      onAnyChange();
    });
  }
  if (etaResetBtn) {
    etaResetBtn.addEventListener("click", () => {
      if (etaManualInput) etaManualInput.value = "";
      editing.etaManual = null;
      onAnyChange();
    });
  }
  prodInput.addEventListener("input", (e) => { editing.prodDays = Number(e.target.value || 0); onAnyChange(); });
  transportSelect.addEventListener("change", (e) => {
    editing.transport = e.target.value;
    if (editing.transport === "air") editing.transitDays = 10;
    if (editing.transport === "rail") editing.transitDays = 30;
    if (editing.transport === "sea") editing.transitDays = 60;
    transitInput.value = String(editing.transitDays);
    onAnyChange();
  });
  transitInput.addEventListener("input", (e) => { editing.transitDays = Number(e.target.value || 0); onAnyChange(); });
  if (quickfillEnabled && skuInput) {
    const handleSkuChange = () => {
      const product = resolveProductFromInput(skuInput.value);
      if (product) {
        setSkuField(product);
        editing.sku = product.sku;
        recordRecentProduct(product.sku);
        const applied = applyProductDefaultsFromProduct(product);
        freightPerUnitOverridden = false;
        updateFreightPerUnitSuggestion(product);
        if (applied) return;
      } else {
        editing.sku = skuInput.value.trim();
        updateFreightPerUnitSuggestion(null);
      }
      setQuickStatus("");
      refreshQuickfillControls();
      updateSaveEnabled();
    };
    skuInput.addEventListener("input", handleSkuChange);
    skuInput.addEventListener("blur", () => {
      skuInput.value = skuInput.value.trim();
      handleSkuChange();
    });
  }
  if (quickfillEnabled && supplierInput) {
    const handleSupplier = () => {
      editing.supplier = supplierInput.value.trim();
      refreshQuickfillControls();
    };
    supplierInput.addEventListener("input", handleSupplier);
    supplierInput.addEventListener("blur", () => {
      supplierInput.value = supplierInput.value.trim();
      handleSupplier();
    });
  }
  if (quickfillEnabled && quickLatestBtn) {
    quickLatestBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const skuValue = parseSkuInputValue(skuInput?.value || editing.sku || "");
      if (!skuValue) {
        window.alert("Bitte zuerst eine SKU wählen.");
        return;
      }
      const supplierValue = supplierInput?.value?.trim() || "";
      const latest = findLatestMatch(skuValue, supplierValue);
      if (latest) {
        const normalized = normaliseHistory([latest])[0];
        applySourceRecord(normalized, `Werte aus ${config.entityLabel} ${latest[config.numberField] || ""} übernommen. Du kannst alles anpassen.`);
        return;
      }
      const candidates = getTemplateCandidates(skuValue, supplierValue);
      if (!candidates.length) {
        window.alert("Keine Produktvorlage oder Vorgänger-POs für diese SKU gefunden.");
        return;
      }
      const entry = candidates[0];
      const fields = entry.template.fields ? JSON.parse(JSON.stringify(entry.template.fields)) : JSON.parse(JSON.stringify(entry.template));
      applySourceRecord(fields, `Werte aus ${entry.name} übernommen. Du kannst alles anpassen.`);
    });
  }
  if (quickfillEnabled && quickHistoryBtn) {
    quickHistoryBtn.addEventListener("click", openHistoryModal);
  }
  if (productCreateBtn) {
    productCreateBtn.addEventListener("click", openCreateProductModal);
  }
  if (templateLoadBtn) {
    templateLoadBtn.addEventListener("click", handleTemplateLoad);
  }
  if (templateSaveBtn) {
    templateSaveBtn.addEventListener("click", openTemplateModal);
  }
  if (poSearchInput) {
    poSearchInput.addEventListener("input", () => {
      if (poListState) {
        poListState.searchTerm = poSearchInput.value;
        renderListView();
      }
    });
  }
  if (poArchiveToggle) {
    poArchiveToggle.addEventListener("change", () => {
      if (poListState) {
        poListState.showArchived = poArchiveToggle.checked;
        renderListView();
      }
    });
  }
  if (poNewButton) {
    poNewButton.addEventListener("click", () => {
      loadForm(defaultRecord(config, getSettings()));
      openFormModal();
    });
  }
  if (poModalClose) {
    poModalClose.addEventListener("click", () => attemptCloseForm({ reset: true }));
  }
  if (poSaveHeader) {
    poSaveHeader.addEventListener("click", handleSave);
  }
  if (poModal) {
    let pointerDownOnBackdrop = false;
    poModal.addEventListener("mousedown", (event) => {
      pointerDownOnBackdrop = event.target === poModal;
    });
    poModal.addEventListener("mouseup", (event) => {
      if (pointerDownOnBackdrop && event.target === poModal) {
        if (suppressBackdropClose) return;
        attemptCloseForm({ reset: true });
      }
      pointerDownOnBackdrop = false;
    });
  }
  numberInput.addEventListener("input", onAnyChange);
  if (orderDateDisplay) orderDateDisplay.addEventListener("input", onAnyChange);

  saveBtn.addEventListener("click", handleSave);
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      attemptCloseForm({ reset: true });
    });
  }
  createBtn.addEventListener("click", () => loadForm(defaultRecord(config, getSettings())));
  deleteBtn.addEventListener("click", () => onDelete(editing));
  if (convertBtn) convertBtn.addEventListener("click", () => convertRecord());

  const shortcutHandler = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      handleSave();
    }
    if (ev.key === "Escape" && poMode && poModal?.classList.contains("is-open")) {
      ev.preventDefault();
      attemptCloseForm({ reset: true });
    }
  };
  window.addEventListener("keydown", shortcutHandler);

  renderListView(state[config.entityKey]);
  refreshQuickfillControls();
  loadForm(defaultRecord(config, getSettings()));

  function focusPaymentRow(focus) {
    if (!focus || !poMode) return;
    const targetKey = String(focus).split(":")[1] || "";
    if (!targetKey) return;
    const table = root.querySelector(".po-payments-table");
    if (!table) return;
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    rows.forEach(row => row.classList.remove("is-focus"));
    const needle = targetKey.toLowerCase();
    const match = rows.find(row => {
      const type = String(row.dataset.paymentType || "").toLowerCase();
      const eventType = String(row.dataset.paymentEventType || "").toLowerCase();
      return type.includes(needle) || eventType.includes(needle);
    });
    if (match) {
      match.classList.add("is-focus");
      match.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function openFromRoute() {
    const query = window.__routeQuery || {};
    if (!query.open) return;
    const openValue = String(query.open || "").trim().toLowerCase();
    if (!openValue) return;
    const record = getAllRecords().find(item => {
      if (!item) return false;
      const idMatch = String(item.id || "").trim().toLowerCase() === openValue;
      const numberMatch = String(item[config.numberField] || "").trim().toLowerCase() === openValue;
      return idMatch || numberMatch;
    });
    if (!record) return;
    onEdit(record);
    if (query.focus) {
      setTimeout(() => focusPaymentRow(query.focus), 150);
    }
    window.__routeQuery = {};
  }

  openFromRoute();

  if (root._orderStateListener) {
    window.removeEventListener("state:changed", root._orderStateListener);
  }
  const handleStateChanged = () => {
    const freshState = loadAppState();
    const settings = getSettings();
    renderListView(freshState[config.entityKey]);
    if (preview) updatePreview(settings);
  };
  root._orderStateListener = handleStateChanged;
  window.addEventListener("state:changed", handleStateChanged);

  return {
    cleanup: () => {
      if (root._orderStateListener) {
        window.removeEventListener("state:changed", root._orderStateListener);
      }
      dirtyGuard.unregister();
      dirtyGuard.detachBeforeUnload();
      window.removeEventListener("keydown", shortcutHandler);
    },
  };
}

export const orderEditorUtils = {
  parseDE,
  fmtEUR,
  fmtCurrencyInput,
  fmtPercent,
  clampPct,
  defaultRecord,
  normaliseGoodsFields,
};

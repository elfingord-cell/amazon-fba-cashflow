import {
  loadState,
  saveState,
  getProductsSnapshot,
  getRecentProducts,
  recordRecentProduct,
  upsertProduct,
} from "../data/storageLocal.js";
import { createDataTable } from "./components/dataTable.js";
import { makeIssue, validateAll } from "../lib/dataHealth.js";
import { openBlockingModal } from "./dataHealthUi.js";
import { formatLocalizedNumber, parseLocalizedNumber } from "./utils/numberFormat.js";

function $(sel, r = document) { return r.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
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
  return Number.isFinite(num)
    ? num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
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
  { key: "dutyIncludeFreight", label: "Freight einbeziehen" },
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
    dutyIncludeFreight: "Freight einbeziehen",
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
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeModal(overlay);
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
  const mode = record?.freightMode === "per_unit" ? "per_unit" : "total";
  if (mode === "per_unit") {
    const perUnit = parseDE(record?.freightPerUnitEur);
    const units = Number(totals?.units || 0);
    const total = perUnit * units;
    return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
  }
  const total = parseDE(record?.freightEur);
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
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
  if (!record.sku && record.items[0]?.sku) {
    record.sku = record.items[0].sku;
  }
}

function getSettings() {
  const state = loadState();
  const raw = (state && state.settings) || {};
  return {
    fxRate: parseDE(raw.fxRate ?? 0) || 0,
    fxFeePct: parseDE(raw.fxFeePct ?? 0) || 0,
    dutyRatePct: parseDE(raw.dutyRatePct ?? 0) || 0,
    dutyIncludeFreight: raw.dutyIncludeFreight !== false,
    eustRatePct: parseDE(raw.eustRatePct ?? 0) || 0,
    vatRefundEnabled: raw.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(raw.vatRefundLagMonths ?? 0) || 0,
    freightLagDays: Number(raw.freightLagDays ?? 0) || 0,
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
  if (!Array.isArray(record.paymentTransactions)) record.paymentTransactions = [];
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

function normalizeTransactionId(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/^(tx-?)+/i, "");
  return `tx-${normalized}`;
}

function formatTransactionLabel(value) {
  const normalized = normalizeTransactionId(value);
  return normalized ? `TX-${normalized.slice(3)}` : "—";
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
  if (evt.type === "freight") return "Shipping";
  if (evt.type === "eust") return "EUSt";
  if (evt.type === "duty") return "Other";
  if (evt.type === "fx_fee") return "Other";
  const label = String(milestone?.label || evt.label || "").toLowerCase();
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("shipping") || label.includes("fracht")) return "Shipping";
  return "Other";
}

function getPaymentTransactions(record) {
  if (!record) return [];
  if (!Array.isArray(record.paymentTransactions)) record.paymentTransactions = [];
  record.paymentTransactions = record.paymentTransactions.map(tx => {
    if (!tx) return tx;
    return {
      ...tx,
      id: normalizeTransactionId(tx.id) || tx.id,
    };
  });
  return record.paymentTransactions;
}

function getTransactionById(record, id) {
  if (!id) return null;
  return getPaymentTransactions(record).find(tx => tx && tx.id === id) || null;
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
  if (hasShipping) return "Shipping";
  if (hasEust) return "EUSt";
  if (hasFx && lowered.length === 1) return "FX";
  if (labels.length <= 1) return labels[0] || "Payment";
  const unique = Array.from(new Set(labels));
  if (unique.length <= 2) return unique.join("+");
  return `${unique.slice(0, 2).join("+")}+more`;
}

function buildPaymentRows(record, config, settings) {
  ensurePaymentLog(record);
  const milestones = Array.isArray(record.milestones) ? record.milestones : [];
  const msMap = new Map(milestones.map(item => [item.id, item]));
  const transactions = getPaymentTransactions(record);
  const txMap = new Map(transactions.map(tx => [tx.id, tx]));
  const events = orderEvents(JSON.parse(JSON.stringify(record)), config, settings);
  return events
    .filter(evt => evt && Number(evt.amount || 0) < 0)
    .map(evt => {
      const log = record.paymentLog?.[evt.id] || {};
      const planned = Math.abs(Number(evt.amount || 0));
      const normalizedTxId = normalizeTransactionId(log.transactionId);
      const transaction = normalizedTxId ? txMap.get(normalizedTxId) : null;
      const status = log.status === "paid" || transaction ? "paid" : "open";
      const paidDate = log.paidDate || transaction?.datePaid || null;
      return {
        id: evt.id,
        typeLabel: mapPaymentType(evt, msMap.get(evt.id)),
        label: evt.label,
        dueDate: evt.date || null,
        plannedEur: planned,
        status,
        paidDate,
        paidEurActual: Number.isFinite(Number(log.paidEurActual)) ? Number(log.paidEurActual) : null,
        method: transaction?.method || log.method || null,
        paidBy: transaction?.paidBy || log.paidBy || null,
        transactionId: transaction?.id || normalizedTxId || null,
        transactionTotal: transaction?.actualEurTotal ?? null,
        note: log.note || "",
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
      },
    ],
    goodsEur: "0,00",
    fxOverride: settings.fxRate || null,
    freightEur: "0,00",
    freightMode: "total",
    freightPerUnitEur: "0,00",
    prodDays: 60,
    transport: "sea",
    transitDays: 60,
    ddp: false,
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
    paymentTransactions: [],
    archived: false,
  };
  ensureAutoEvents(record, settings, record.milestones);
  normaliseGoodsFields(record, settings);
  return record;
}

function anchorDate(record, anchor) {
  const order = new Date(record.orderDate);
  const prodDone = addDays(order, Number(record.prodDays || 0));
  const etd = prodDone;
  const eta = addDays(etd, Number(record.transitDays || 0));
  if (anchor === "ORDER_DATE") return order;
  if (anchor === "PROD_DONE") return prodDone;
  if (anchor === "ETD") return etd;
  return eta;
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
  const base = {
    orderDate: record.orderDate,
    prodDays: Number(record.prodDays || 0),
    transport: record.transport,
    transitDays: Number(record.transitDays || 0),
  };

  const manualComputed = manual.map(m => {
    const pct = clampPct(m.percent);
    const baseDate = anchorDate(base, m.anchor || "ORDER_DATE");
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
    const baseDate = anchorDate(base, anchor);
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

function buildEventList(events, paymentLog = {}, transactions = []) {
  const wrapper = el("div", { class: "po-event-table" });
  if (!events.length) {
    wrapper.append(el("div", { class: "muted" }, ["Keine Ereignisse definiert."]));
    return wrapper;
  }
  const txMap = new Map((transactions || []).map(tx => [tx.id, tx]));
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
    const tx = log.transactionId ? txMap.get(log.transactionId) : null;
    const status = log.status === "paid" || tx ? "paid" : "open";
    const statusLabel = status === "paid" ? "Bezahlt" : "Offen";
    const txLabel = tx ? formatTransactionLabel(tx.id) : "—";
    wrapper.append(
      el("div", { class: "po-event-row" }, [
        el("span", { class: "po-event-col" }, [evt.label]),
        el("span", { class: "po-event-col" }, [fmtDateDE(evt.due || evt.date)]),
        el("span", { class: "po-event-col amount" }, [fmtEUR(evt.amount)]),
        el("span", { class: "po-event-col status" }, [
          el("span", { class: `po-status-pill ${status === "paid" ? "is-paid" : "is-open"}` }, [statusLabel]),
        ]),
        el("span", { class: "po-event-col status" }, [
          tx ? el("span", { class: "po-transaction-pill" }, [txLabel]) : "—",
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
          return formatTimelineSummary(rec);
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
  const listRows = filtered.map(rec => ({ rec, totals: computeGoodsTotals(rec, settings) }));
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
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    const idx = arr.findIndex(item => item?.id === rec.id || item?.[config.numberField] === rec[config.numberField]);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], archived };
      st[config.entityKey] = arr;
      saveState(st);
      window.dispatchEvent(new Event("state:changed"));
      if (typeof options.onUpdate === "function") options.onUpdate();
    }
  }

  if (!listRows.length) {
    tbody.append(el("tr", {}, [
      el("td", { colspan: "11", class: "muted" }, ["Keine Bestellungen gefunden."]),
    ]));
    container.append(table);
    return;
  }

  listRows.forEach(({ rec, totals }) => {
    const productSummary = formatSkuSummary(rec);
    const productTooltip = formatProductTooltip(rec);
    const timeline = formatTimelineCompact(rec);
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
  container.innerHTML = "";
  const header = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["SKU"]),
      el("th", {}, ["Stück"]),
      el("th", {}, ["Stückkosten (USD)"]),
      el("th", {}, ["Zusatz/ Stück (USD)"]),
      el("th", {}, ["Pauschal (USD)"]),
      el("th", {}, [""])
    ])
  ]);
  const body = el("tbody");
  const dl = el("datalist", { id: dataListId });
  productCache.forEach(prod => {
    dl.append(el("option", { value: prod.sku, label: prod.alias ? `${prod.alias}` : prod.sku }));
  });

  record.items.forEach(item => {
    const row = el("tr", { dataset: { itemId: item.id } });
    const skuAttrs = item.type === "misc"
      ? { value: item.sku || "", placeholder: "Freie Position" }
      : { list: dataListId, value: item.sku || "", placeholder: "SKU" };
    const skuInput = el("input", skuAttrs);
    skuInput.addEventListener("input", () => { item.sku = skuInput.value.trim(); onChange(); });

    const unitsInput = el("input", { type: "number", min: "0", step: "1", value: item.units || "0" });
    unitsInput.addEventListener("input", () => { item.units = unitsInput.value; onChange(); });

    const unitCostInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.unitCostUsd ?? "0,00"), placeholder: "0,00" });
    unitCostInput.addEventListener("blur", () => { item.unitCostUsd = fmtCurrencyInput(unitCostInput.value); unitCostInput.value = item.unitCostUsd; onChange(); });
    unitCostInput.addEventListener("input", () => { item.unitCostUsd = unitCostInput.value; });

    const unitExtraInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.unitExtraUsd ?? "0,00"), placeholder: "0,00" });
    unitExtraInput.addEventListener("blur", () => { item.unitExtraUsd = fmtCurrencyInput(unitExtraInput.value); unitExtraInput.value = item.unitExtraUsd; onChange(); });
    unitExtraInput.addEventListener("input", () => { item.unitExtraUsd = unitExtraInput.value; });

    const flatInput = el("input", { inputmode: "decimal", value: fmtCurrencyInput(item.extraFlatUsd ?? "0,00"), placeholder: "0,00" });
    flatInput.addEventListener("blur", () => { item.extraFlatUsd = fmtCurrencyInput(flatInput.value); flatInput.value = item.extraFlatUsd; onChange(); });
    flatInput.addEventListener("input", () => { item.extraFlatUsd = flatInput.value; });

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
      el("td", {}, [removeBtn]),
    );
    body.append(row);
  });

  const table = el("table", { class: "po-items-table" }, [header, body]);
  container.append(table, dl);
}

function computeTimeline(record) {
  if (!record) return null;
  const order = parseISOToDate(record.orderDate) || null;
  if (!order) return null;
  const prodDays = Math.max(0, Number(record.prodDays || 0));
  const transitDays = Math.max(0, Number(record.transitDays || 0));
  const prodDone = addDays(order, prodDays);
  const etd = prodDone;
  const eta = addDays(etd, transitDays);
  const totalDays = Math.max(prodDays + transitDays, 1);
  return {
    order,
    prodDone,
    etd,
    eta,
    prodDays,
    transitDays,
    totalDays,
  };
}

function formatTimelineSummary(record) {
  const timeline = computeTimeline(record);
  if (!timeline) return "—";
  return [
    `Order ${fmtDateDE(timeline.order)}`,
    `Prod done/ETD ${fmtDateDE(timeline.prodDone)}`,
    `ETA ${fmtDateDE(timeline.eta)}`,
  ].join(" • ");
}

function formatTimelineCompact(record) {
  const timeline = computeTimeline(record);
  if (!timeline) return "—";
  return `ETD ${fmtDateDE(timeline.prodDone)} • ETA ${fmtDateDE(timeline.eta)}`;
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

function renderTimeline(timelineNode, summaryNode, record) {
  if (!timelineNode || !summaryNode) return;
  const timeline = computeTimeline(record);
  summaryNode.innerHTML = "";
  timelineNode.innerHTML = "";

  if (!timeline) {
    summaryNode.append(el("span", { class: "muted" }, ["Bitte gültiges Bestelldatum eingeben."]));
    return;
  }

  const summary = el("div", { class: "po-timeline-summary-items" }, [
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["Order"]), " ", fmtDateDE(timeline.order)]),
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["Prod done/ETD"]), " ", fmtDateDE(timeline.prodDone)]),
    el("span", { class: "po-timeline-summary-item" }, [el("strong", {}, ["ETA"]), " ", fmtDateDE(timeline.eta)]),
  ]);
  summaryNode.append(summary);

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
  addMarker("Prod done/ETD", timeline.prodDone, prodPct, middleAlign);
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

  const payments = buildPaymentRows(record, config, settings);
  ensurePaymentLog(record);
  const transactions = getPaymentTransactions(record);

  const paymentSection = el("div", { class: "po-payments-section" }, [
    el("h4", {}, ["Zahlungen"]),
    el("p", { class: "muted" }, ["Markiere Zahlungen als bezahlt und ergänze Ist-Daten für die Buchhaltung."]),
  ]);

  const invoiceLinks = transactions.filter(tx => tx?.driveInvoiceLink || tx?.driveInvoiceFolderLink);
  if (invoiceLinks.length) {
    const list = el("div", { class: "po-invoice-links" });
    invoiceLinks.forEach(tx => {
      const linkInput = el("input", { type: "text", value: tx.driveInvoiceLink || "", readonly: "readonly" });
      const openBtn = el("button", { class: "btn secondary", type: "button" }, ["Öffnen"]);
      openBtn.addEventListener("click", () => {
        if (tx.driveInvoiceLink) window.open(tx.driveInvoiceLink, "_blank", "noopener");
      });
      openBtn.disabled = !tx.driveInvoiceLink;
      openBtn.title = tx.driveInvoiceLink ? "" : "Invoice Link nicht hinterlegt";
      const folderBtn = el("button", { class: "btn secondary", type: "button" }, ["Ordner öffnen"]);
      folderBtn.addEventListener("click", () => {
        if (tx.driveInvoiceFolderLink) window.open(tx.driveInvoiceFolderLink, "_blank", "noopener");
      });
      folderBtn.disabled = !tx.driveInvoiceFolderLink;
      folderBtn.title = tx.driveInvoiceFolderLink ? "" : "Ordner-Link nicht hinterlegt";
      const copyBtn = el("button", { class: "btn tertiary", type: "button" }, ["Link kopieren"]);
      copyBtn.addEventListener("click", () => {
        navigator.clipboard?.writeText(tx.driveInvoiceLink || "");
      });
      list.append(
        el("div", { class: "po-invoice-link" }, [
          el("label", {}, [`Invoice Link · ${fmtDateDE(tx.datePaid || "")} · ${formatTransactionLabel(tx.id)}`]),
          linkInput,
          el("div", { class: "po-invoice-actions" }, [openBtn, folderBtn, copyBtn]),
        ]),
      );
    });
    paymentSection.append(list);
  } else {
    paymentSection.append(
      el("div", { class: "po-invoice-warning" }, [
        "Hinweis: Optional kannst du pro Transfer einen Invoice Drive Link hinterlegen.",
      ]),
    );
  }

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
        el("th", {}, ["Aktion"]),
      ]),
    ]),
  ]);
  const paymentBody = el("tbody");
  paymentTable.append(paymentBody);

  function openPaymentModal(payment) {
    const allPayments = buildPaymentRows(record, config, settings);
    const existingLog = payment ? (record.paymentLog?.[payment.id] || {}) : {};
    const editingTransaction = payment?.transactionId ? getTransactionById(record, payment.transactionId) : null;
    const selectedIds = new Set();
    if (editingTransaction?.eventIds?.length) {
      editingTransaction.eventIds.forEach(id => selectedIds.add(id));
    } else if (payment?.id) {
      selectedIds.add(payment.id);
      const fxCandidate = allPayments.find(evt => evt.eventType === "fx_fee" && evt.dueDate === payment.dueDate && evt.status === "open");
      if (fxCandidate) selectedIds.add(fxCandidate.id);
    }
    if (!editingTransaction) {
      const deposit = allPayments.find(evt => evt.status === "open" && evt.typeLabel.toLowerCase().includes("deposit"));
      if (deposit) selectedIds.add(deposit.id);
    }

    const paidDate = editingTransaction?.datePaid || existingLog.paidDate || new Date().toISOString().slice(0, 10);
    const actualValue = Number.isFinite(Number(editingTransaction?.actualEurTotal))
      ? fmtCurrencyInput(editingTransaction.actualEurTotal)
      : fmtCurrencyInput(payment?.plannedEur ?? 0);
    const methodValue = editingTransaction?.method || existingLog.method || "";
    const paidByValue = editingTransaction?.paidBy || existingLog.paidBy || "";
    const noteValue = editingTransaction?.note || existingLog.note || "";
    const invoiceValue = editingTransaction?.driveInvoiceLink || "";
    const folderValue = editingTransaction?.driveInvoiceFolderLink || "";
    const transferValue = normalizeTransactionId(editingTransaction?.id)
      || normalizeTransactionId(`tx-${Math.random().toString(36).slice(2, 7)}`);

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
    methodSelect.value = methodValue;

    const paidBySelect = el("select", {}, [
      el("option", { value: "" }, ["—"]),
      el("option", { value: "Pierre" }, ["Pierre"]),
      el("option", { value: "Patrick" }, ["Patrick"]),
    ]);
    paidBySelect.value = paidByValue;

    const actualInput = el("input", { type: "text", inputmode: "decimal", value: actualValue, placeholder: "0,00" });
    const noteInput = el("textarea", { rows: "2", placeholder: "Notiz (optional)" }, [noteValue]);
    const invoiceInput = el("input", { type: "url", placeholder: "https://drive.google.com/…", value: invoiceValue });
    const folderInput = el("input", { type: "url", placeholder: "https://drive.google.com/…", value: folderValue });
    const transferInput = el("input", { type: "text", value: transferValue || "" });

    const selectedSummary = el("div", { class: "po-payment-summary muted" });
    const copyFilenameBtn = el("button", { class: "btn tertiary po-filename-copy", type: "button" }, [""]);
    copyFilenameBtn.addEventListener("click", () => {
      const text = copyFilenameBtn.dataset.filename || "";
      navigator.clipboard?.writeText(text);
    });

    function updateFileName() {
      const selectedEvents = allPayments.filter(evt => selectedIds.has(evt.id));
      const keyEvents = buildInvoiceKeyEvents(selectedEvents);
      const base = suggestedInvoiceFilename(record, paidDateInput.value);
      const filename = `${base}_${keyEvents}.pdf`;
      copyFilenameBtn.dataset.filename = filename;
      copyFilenameBtn.textContent = filename;
      copyFilenameBtn.title = "Suggested filename kopieren";
    }

    function updateSummary() {
      const selectedEvents = allPayments.filter(evt => selectedIds.has(evt.id));
      const planned = selectedEvents.reduce((sum, evt) => sum + Number(evt.plannedEur || 0), 0);
      selectedSummary.textContent = selectedEvents.length
        ? `Ausgewählt: ${selectedEvents.length} Events · Geplant ${fmtEURPlain(planned)} EUR`
        : "Bitte mindestens ein Event auswählen.";
      updateFileName();
    }

    const eventList = el("div", { class: "po-payment-event-list" });
    const selectableEvents = allPayments.filter(evt => evt.status === "open" || (editingTransaction && evt.transactionId === editingTransaction.id));
    const toggleSelection = (evtId, force) => {
      if (force === true) selectedIds.add(evtId);
      else if (force === false) selectedIds.delete(evtId);
      else if (selectedIds.has(evtId)) selectedIds.delete(evtId);
      else selectedIds.add(evtId);
      updateSummary();
    };
    selectableEvents.forEach(evt => {
      const isPaid = evt.status === "paid";
      const sameTransaction = editingTransaction && evt.transactionId === editingTransaction.id;
      const disabled = isPaid && !sameTransaction;
      const checkbox = el("input", { type: "checkbox", checked: selectedIds.has(evt.id), disabled });
      checkbox.addEventListener("change", () => {
        if (disabled) return;
        toggleSelection(evt.id, checkbox.checked);
      });
      const statusLabel = evt.status === "paid" ? "Bezahlt" : "Offen";
      const txLabel = evt.transactionId ? formatTransactionLabel(evt.transactionId) : "—";
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
        el("span", { class: "po-transaction-pill" }, [txLabel]),
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

    paidDateInput.addEventListener("input", updateFileName);
    updateSummary();

    const form = el("div", { class: "po-payment-form" }, [
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
      el("label", {}, ["Transfer-ID"]),
      transferInput,
      el("label", {}, ["Invoice Drive Link"]),
      invoiceInput,
      el("label", {}, ["Invoice Ordner Link (optional)"]),
      folderInput,
      el("label", {}, ["Notiz"]),
      noteInput,
      el("div", { class: "po-filename-block" }, [
        copyFilenameBtn,
      ]),
    ]);

    const markUnpaidBtn = editingTransaction
      ? el("button", {
          class: "btn danger",
          type: "button",
          onclick: () => {
            if (!confirm("Transfer wirklich als offen markieren?")) return;
            editingTransaction.eventIds.forEach(eventId => {
              const log = record.paymentLog?.[eventId];
              if (log && log.transactionId === editingTransaction.id) {
                record.paymentLog[eventId] = {
                  ...log,
                  status: "open",
                  paidDate: null,
                  paidEurActual: null,
                  transactionId: null,
                };
              }
            });
            record.paymentTransactions = record.paymentTransactions.filter(tx => tx.id !== editingTransaction.id);
            onChange({ persist: true, source: "payment-update" });
            closeModal(modal);
          },
        }, ["Mark as unpaid"])
      : null;

    const modal = buildModal({
      title: editingTransaction ? "Transfer bearbeiten" : "Zahlungen als bezahlt markieren",
      content: form,
      actions: [
        markUnpaidBtn,
        el("button", { class: "btn secondary", type: "button", onclick: () => closeModal(modal) }, ["Abbrechen"]),
        el("button", {
          class: "btn",
          type: "button",
          onclick: () => {
            if (!selectedIds.size) {
              alert("Bitte mindestens ein Event auswählen.");
              return;
            }
            if (!paidBySelect.value) {
              alert("Bitte Paid by auswählen.");
              return;
            }
            const parsed = parseDE(actualInput.value);
            if (!Number.isFinite(parsed)) {
              alert("Bitte einen gültigen Ist-Betrag eingeben.");
              return;
            }
            const transferId = normalizeTransactionId(transferInput.value);
            if (!transferId) {
              alert("Bitte eine gültige Transfer-ID eingeben.");
              return;
            }
            const hasPaidEvents = Object.values(record.paymentLog || {}).some(log => log?.status === "paid");
            if (!hasPaidEvents && !invoiceInput.value.trim()) {
              alert("Bitte den Invoice Drive Link beim ersten bezahlten Event hinterlegen.");
              return;
            }
            const actual = Math.round(parsed * 100) / 100;
            const transactionId = editingTransaction?.id || transferId;
            const tx = {
              id: transactionId,
              datePaid: paidDateInput.value || null,
              method: methodSelect.value || null,
              paidBy: paidBySelect.value,
              actualEurTotal: actual,
              driveInvoiceLink: invoiceInput.value.trim() || null,
              driveInvoiceFolderLink: folderInput.value.trim() || null,
              note: noteInput.value.trim() || null,
              eventIds: Array.from(selectedIds),
            };

            const existingTxIndex = record.paymentTransactions.findIndex(entry => entry.id === transactionId);
            if (existingTxIndex >= 0) record.paymentTransactions[existingTxIndex] = tx;
            else record.paymentTransactions.push(tx);

            const previouslyLinked = new Set(editingTransaction?.eventIds || []);
            previouslyLinked.forEach(eventId => {
              if (!selectedIds.has(eventId)) {
                const log = record.paymentLog?.[eventId];
                if (log && log.transactionId === transactionId) {
                  record.paymentLog[eventId] = {
                    ...log,
                    status: "open",
                    paidDate: null,
                    paidEurActual: null,
                    transactionId: null,
                  };
                }
              }
            });

            selectedIds.forEach(eventId => {
              const log = record.paymentLog?.[eventId] || {};
              const plannedEur = allPayments.find(evt => evt.id === eventId)?.plannedEur || 0;
              const actualValue = Number.isFinite(Number(log.paidEurActual))
                ? Number(log.paidEurActual)
                : plannedEur;
              record.paymentLog[eventId] = {
                ...log,
                status: "paid",
                paidDate: tx.datePaid,
                transactionId,
                paidEurActual: actualValue,
              };
            });

            onChange({ persist: true, source: "payment-update" });
            closeModal(modal);
          },
        }, ["Speichern"]),
      ].filter(Boolean),
    });
  }

  payments.forEach(payment => {
    const planned = `${fmtEURPlain(payment.plannedEur)} EUR`;
    const statusLabel = payment.status === "paid" ? "Bezahlt" : "Offen";
    const paidActual = payment.paidEurActual != null ? `${fmtEURPlain(payment.paidEurActual)} EUR` : "—";
    const delta = payment.paidEurActual != null
      ? `Δ ${fmtEURPlain(payment.paidEurActual - payment.plannedEur)} EUR`
      : null;
    const transactionLabel = payment.transactionId ? formatTransactionLabel(payment.transactionId) : "—";
    const row = el("tr", { dataset: { paymentId: payment.id, paymentType: payment.typeLabel, paymentEventType: payment.eventType || "" } }, [
      el("td", {}, [payment.typeLabel]),
      el("td", {}, [fmtDateDE(payment.dueDate)]),
      el("td", {}, [planned]),
      el("td", {}, [el("span", { class: `po-status-pill ${payment.status === "paid" ? "is-paid" : "is-open"}` }, [statusLabel])]),
      el("td", {}, [payment.paidDate ? fmtDateDE(payment.paidDate) : "—"]),
      el("td", {}, [paidActual, delta ? el("div", { class: "muted" }, [delta]) : null]),
      el("td", {}, [payment.method || "—"]),
      el("td", {}, [payment.paidBy || "—"]),
      el("td", {}, [payment.transactionId ? el("span", { class: "po-transaction-pill" }, [transactionLabel]) : "—"]),
      el("td", {}, [
        el("button", {
          class: "btn secondary sm",
          type: "button",
          onclick: () => openPaymentModal(payment),
        }, [payment.status === "paid" ? "Edit transfer" : "Mark as paid"]),
      ]),
    ]);
    paymentBody.append(row);
  });

  if (!payments.length) {
    paymentBody.append(el("tr", {}, [
      el("td", { colspan: "10", class: "muted" }, ["Keine Zahlungen verfügbar."]),
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
  const state = loadState();
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
    freightPerUnit: `${config.slug}-freight-per-unit`,
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
          <label>FX-Kurs (USD → EUR)</label>
          <input id="${ids.fxRate}" placeholder="z. B. 1,08" inputmode="decimal" />
        </div>
        </div>
        <div class="grid two" style="margin-top:12px">
        <div>
          <label>Fracht (Eingabeart)</label>
          <select id="${ids.freightMode}">
            <option value="total">Gesamtbetrag (€)</option>
            <option value="per_unit">Pro Stück (€)</option>
          </select>
        </div>
        <div>
          <label>Fracht gesamt (€)</label>
          <input id="${ids.freight}" placeholder="z. B. 4.800,00" />
        </div>
        <div>
          <label>Fracht pro Stück (€)</label>
          <input id="${ids.freightPerUnit}" placeholder="z. B. 1,25" />
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
          <label class="inline-checkbox"><input type="checkbox" id="${ids.dutyInclude}" /> Freight einbeziehen</label>
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
  const freightInput = $(`#${ids.freight}`, root);
  const freightPerUnitInput = $(`#${ids.freightPerUnit}`, root);
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
  const msZone = $(`#${ids.msZone}`, root);
  const saveBtn = $(`#${ids.save}`, root);
  const cancelBtn = $(`#${ids.cancel}`, root);
  const createBtn = $(`#${ids.create}`, root);
  const deleteBtn = $(`#${ids.remove}`, root);
  const preview = $(`#${ids.preview}`, root);
  const convertBtn = ids.convert ? $(`#${ids.convert}`, root) : null;

  let editing = defaultRecord(config, getSettings());
  let lastLoaded = JSON.parse(JSON.stringify(editing));
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

  function getCurrentState() {
    return loadState();
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
    syncEditingFromForm(settings);
    const draft = JSON.parse(JSON.stringify({
      ...editing,
      [config.numberField]: numberInput.value,
      orderDate: orderDateInput.value,
      prodDays: Number(prodInput.value || 0),
      transport: transportSelect.value,
      transitDays: Number(transitInput.value || 0),
    }));
    normaliseGoodsFields(draft, settings);
    const events = orderEvents(draft, config, settings);
    preview.innerHTML = "";
    preview.append(el("h4", {}, ["Ereignisse"]));
    preview.append(buildEventList(events, editing.paymentLog, getPaymentTransactions(editing)));
  }

  function updateSaveEnabled() {
    const sum = (editing.milestones || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
    const hasSku = (!quickfillEnabled || (skuInput && skuInput.value.trim() !== "")) || (editing.items || []).some(it => it.sku);
    const ok = (Math.round(sum * 10) / 10 === 100)
      && (numberInput.value.trim() !== "")
      && (computeGoodsTotals(editing, getSettings()).usd > 0)
      && !!orderDateInput.value
      && hasSku;
    saveBtn.disabled = !ok;
    if (convertBtn) convertBtn.disabled = !ok;
  }

  function updateGoodsSummary(totals) {
    if (!goodsSummary) return;
    const eurText = fmtEUR(totals.eur || 0);
    const usdText = fmtUSD(totals.usd || 0);
    const fxText = fmtFxRate(totals.fxRate);
    goodsSummary.textContent = fxText
      ? `Summe Warenwert: ${eurText} (${usdText} ÷ FX ${fxText})`
      : `Summe Warenwert: ${eurText} (${usdText})`;
  }

  function updateFreightModeUI() {
    if (!freightModeSelect || !freightInput || !freightPerUnitInput) return;
    const mode = freightModeSelect.value === "per_unit" ? "per_unit" : "total";
    freightInput.disabled = mode === "per_unit";
    freightPerUnitInput.disabled = mode !== "per_unit";
  }

  function syncEditingFromForm(settings = getSettings()) {
    if (quickfillEnabled) {
      editing.sku = skuInput ? parseSkuInputValue(skuInput.value) : "";
      editing.supplier = supplierInput ? supplierInput.value.trim() : "";
    }
    editing[config.numberField] = numberInput.value.trim();
    const parsedDisplay = parseDeDate(orderDateDisplay?.value || "");
    const isoFromDisplay = parsedDisplay ? formatDateISO(parsedDisplay) : null;
    const isoFromPicker = orderDateInput?.value || null;
    editing.orderDate = isoFromDisplay || isoFromPicker || editing.orderDate;
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
      });
    });
    if (nextItems.length) {
      editing.items = nextItems;
    }
    ensureItems(editing);
    const fxOverrideValue = parseDE(fxRateInput?.value ?? "");
    editing.fxOverride = Number.isFinite(fxOverrideValue) && fxOverrideValue > 0 ? fxOverrideValue : null;
    normaliseGoodsFields(editing, settings);
    const totals = computeGoodsTotals(editing, settings);
    updateGoodsSummary(totals);
    editing.freightMode = freightModeSelect?.value === "per_unit" ? "per_unit" : "total";
    editing.freightEur = fmtCurrencyInput(freightInput.value);
    editing.freightPerUnitEur = fmtCurrencyInput(freightPerUnitInput?.value || "");
    editing.prodDays = Number(prodInput.value || 0);
    editing.transport = transportSelect.value;
    editing.transitDays = Number(transitInput.value || 0);
    editing.dutyRatePct = clampPct(dutyRateInput.value);
    editing.dutyIncludeFreight = dutyIncludeToggle.checked;
    editing.eustRatePct = clampPct(eustRateInput.value);
    editing.fxFeePct = clampPct(fxFeeInput.value);
    editing.vatRefundLagMonths = Number(vatLagInput.value || 0);
    editing.vatRefundEnabled = vatToggle.checked;
    editing.ddp = ddpToggle.checked;
  }

  function persistEditing({ source, silent } = {}) {
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    const idx = arr.findIndex(item => (item.id && item.id === editing.id)
      || (item[config.numberField] && item[config.numberField] === editing[config.numberField]));
    if (idx >= 0) arr[idx] = editing;
    else arr.push(editing);
    st[config.entityKey] = arr;
    saveState(st);
    renderListView(st[config.entityKey]);
    if (!silent) {
      window.dispatchEvent(new CustomEvent("state:changed", { detail: { source } }));
    }
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
    syncEditingFromForm(settings);
    if (!transitInput.value) {
      transitInput.value = editing.transport === "air" ? "10" : (editing.transport === "rail" ? "30" : "60");
    }
    syncEditingFromForm(settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    ensurePaymentLog(editing);
    renderTimeline(timelineZone, timelineSummary, editing);
    renderMsTable(msZone, editing, config, onAnyChange, focusInfo, settings);
    updatePreview(settings);
    updateSaveEnabled();
    if (opts.persist) {
      persistEditing({ source: opts.source, silent: false });
    }
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

  function loadForm(record) {
    const settings = getSettings();
    lastLoaded = JSON.parse(JSON.stringify(record));
    editing = JSON.parse(JSON.stringify(record));
    normaliseGoodsFields(editing, settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    ensurePaymentLog(editing);
    normaliseArchiveFlag(editing);
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
    updateGoodsSummary(computeGoodsTotals(editing, settings));
    if (freightModeSelect) freightModeSelect.value = editing.freightMode === "per_unit" ? "per_unit" : "total";
    freightInput.value = fmtCurrencyInput(editing.freightEur ?? "0,00");
    if (freightPerUnitInput) freightPerUnitInput.value = fmtCurrencyInput(editing.freightPerUnitEur ?? "0,00");
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
    renderTimeline(timelineZone, timelineSummary, editing);
    renderMsTable(msZone, editing, config, onAnyChange, null, settings);
    updatePreview(settings);
    updateSaveEnabled();
  }

  function saveRecord() {
    const isoDate = validateOrderDate(true);
    if (!isoDate) {
      if (orderDateDisplay) orderDateDisplay.focus();
      return;
    }
    const settings = getSettings();
    syncEditingFromForm(settings);
    normaliseArchiveFlag(editing);
    const stateSnapshot = loadState();
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
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    const idx = arr.findIndex(item => (item.id && item.id === editing.id)
      || (item[config.numberField] && item[config.numberField] === editing[config.numberField]));
    if (idx >= 0) arr[idx] = editing;
    else arr.push(editing);
    st[config.entityKey] = arr;
    saveState(st);
    renderListView(st[config.entityKey]);
    refreshQuickfillControls();
    if (quickfillEnabled && editing.sku) {
      recordRecentProduct(editing.sku);
    }
    window.dispatchEvent(new Event("state:changed"));
    showToast(`${config.entityLabel || "PO"} gespeichert`);
    if (poMode) closeFormModal();
  }

  function convertRecord() {
    if (!config.convertTo) return;
    const settings = getSettings();
    syncEditingFromForm(settings);
    if (saveBtn.disabled) {
      window.alert("Bitte gültige Daten eingeben, bevor die FO umgewandelt wird.");
      return;
    }

    saveRecord();

    const st = loadState();
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
    saveState(st);
    window.dispatchEvent(new Event("state:changed"));
    window.alert(`${label} ${trimmed} wurde angelegt.`);
  }

  function onEdit(record) {
    loadForm(record);
    if (poMode) openFormModal();
  }

  function onDelete(record) {
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    st[config.entityKey] = arr.filter(item => {
      if (item.id && record.id) return item.id !== record.id;
      return item[config.numberField] !== record[config.numberField];
    });
    saveState(st);
    renderListView(st[config.entityKey]);
    loadForm(defaultRecord(config, getSettings()));
    window.dispatchEvent(new Event("state:changed"));
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
    freightPerUnitInput.addEventListener("input", onAnyChange);
    freightPerUnitInput.addEventListener("blur", () => {
      freightPerUnitInput.value = fmtCurrencyInput(freightPerUnitInput.value);
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
    fxRateInput.addEventListener("input", onAnyChange);
    fxRateInput.addEventListener("blur", () => {
      const parsed = parseDE(fxRateInput.value);
      fxRateInput.value = parsed > 0 ? fmtFxRate(parsed) : "";
      onAnyChange();
    });
  }
  vatLagInput.addEventListener("input", onAnyChange);
  vatToggle.addEventListener("change", onAnyChange);
  ddpToggle.addEventListener("change", onAnyChange);
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
      } else {
        editing.sku = skuInput.value.trim();
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
    poModalClose.addEventListener("click", closeFormModal);
  }
  if (poSaveHeader) {
    poSaveHeader.addEventListener("click", saveRecord);
  }
  if (poModal) {
    poModal.addEventListener("click", (event) => {
      if (event.target === poModal) closeFormModal();
    });
  }
  numberInput.addEventListener("input", onAnyChange);
  if (orderDateDisplay) orderDateDisplay.addEventListener("input", onAnyChange);

  saveBtn.addEventListener("click", saveRecord);
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      loadForm(lastLoaded || editing);
      if (poMode) closeFormModal();
    });
  }
  createBtn.addEventListener("click", () => loadForm(defaultRecord(config, getSettings())));
  deleteBtn.addEventListener("click", () => onDelete(editing));
  if (convertBtn) convertBtn.addEventListener("click", convertRecord);

  const shortcutHandler = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      saveRecord();
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
    const freshState = loadState();
    const settings = getSettings();
    renderListView(freshState[config.entityKey]);
    if (preview) updatePreview(settings);
  };
  root._orderStateListener = handleStateChanged;
  window.addEventListener("state:changed", handleStateChanged);
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

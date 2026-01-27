import {
  loadState,
  saveState,
  getProductsSnapshot,
  upsertProduct,
} from "../data/storageLocal.js";
import { createDataTable } from "./components/dataTable.js";
import { buildSupplierLabelMap } from "./utils/supplierLabels.js";
import { validateAll } from "../lib/dataHealth.js";
import { openBlockingModal } from "./dataHealthUi.js";
import { parseLocalizedNumber } from "./utils/numberFormat.js";
import { resolveProductionLeadTimeDays } from "../domain/leadTime.js";

function $(sel, root = document) {
  return root.querySelector(sel);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") {
      Object.entries(value).forEach(([dk, dv]) => node.dataset[dk] = dv);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value != null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const TRANSPORT_MODES = ["SEA", "RAIL", "AIR"];
const INCOTERMS = ["EXW", "DDP"];
const PAYMENT_EVENTS = ["ORDER_DATE", "PRODUCTION_END", "ETD", "ETA"];
const CURRENCIES = ["EUR", "USD", "CNY"];
const STATUS_LABELS = {
  DRAFT: "Draft",
  PLANNED: "Planned",
  CONVERTED: "Converted",
  CANCELLED: "Cancelled",
};

function normaliseCurrency(value, fallback = "EUR") {
  const upper = String(value || "").trim().toUpperCase();
  return CURRENCIES.includes(upper) ? upper : fallback;
}

function defaultPaymentTerms() {
  return [
    { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
    { label: "Balance", percent: 70, triggerEvent: "ETD", offsetDays: 0 },
  ];
}

function formatDate(input) {
  if (!input) return "—";
  const [y, m, d] = String(input).split("-").map(Number);
  if (!y || !m || !d) return "—";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function parseLocaleNumber(value) {
  return parseLocalizedNumber(value);
}

function parseNumber(value) {
  return parseLocaleNumber(value);
}

function parsePositive(value) {
  const num = parseLocaleNumber(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parseISODate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function addMonthsDate(date, months) {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function formatCurrency(value, currency) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("de-DE", { style: "currency", currency: currency || "EUR" });
}

function formatNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function convertToEur(amount, currency, fxRate) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (!currency || currency === "EUR") return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  return value / fx;
}

function shortId(id) {
  if (!id) return "—";
  return String(id).slice(-6).toUpperCase();
}

function formatPaymentsSummary(payments = []) {
  if (!payments.length) return "—";
  const preview = payments
    .slice(0, 2)
    .map(p => `${p.percent || 0}% ${formatDate(p.dueDate)}`)
    .join(", ");
  const rest = payments.length > 2 ? ` +${payments.length - 2}` : "";
  return `${payments.length} payments: ${preview}${rest}`;
}

function paymentSummaryTotal(payments = [], fxRate = 0) {
  const total = payments.reduce((sum, payment) => {
    const amount = Number(payment.amount || 0);
    if (!Number.isFinite(amount)) return sum;
    const currency = payment.currency || "EUR";
    const amountEur = convertToEur(amount, currency, fxRate);
    return sum + amountEur;
  }, 0);
  return total;
}

function formatPaymentTooltip(payments = [], fxRate = 0) {
  if (!payments.length) return "";
  return payments
    .map(payment => {
      const amount = Number(payment.amount || 0);
      if (!Number.isFinite(amount)) return null;
      const currency = payment.currency || "EUR";
      const amountEur = convertToEur(amount, currency, fxRate);
      return `${payment.label || "Payment"}: ${formatCurrency(amount, currency)} (${formatCurrency(amountEur, "EUR")})`;
    })
    .filter(Boolean)
    .join(" | ");
}

function mapPaymentAnchor(trigger) {
  if (trigger === "PRODUCTION_END") return "PROD_DONE";
  return trigger || "ORDER_DATE";
}

function findProductSupplier(state, sku, supplierId) {
  if (!sku || !supplierId) return null;
  const keySku = String(sku).trim().toLowerCase();
  const keySup = String(supplierId).trim();
  return (state.productSuppliers || []).find(
    entry => String(entry.sku || "").trim().toLowerCase() === keySku
      && String(entry.supplierId || "").trim() === keySup
      && entry.isActive !== false,
  ) || null;
}

function listActiveMappings(state, sku) {
  const keySku = String(sku || "").trim().toLowerCase();
  return (state.productSuppliers || [])
    .filter(entry => String(entry.sku || "").trim().toLowerCase() === keySku)
    .filter(entry => entry.isActive !== false);
}

function findPreferredMapping(state, sku) {
  const list = listActiveMappings(state, sku);
  const preferred = list.find(entry => entry.isPreferred);
  if (preferred) return preferred;
  if (list.length === 1) return list[0];
  return null;
}

function getProductBySku(products, sku) {
  if (!sku) return null;
  const key = String(sku).trim().toLowerCase();
  return products.find(product => String(product?.sku || "").trim().toLowerCase() === key) || null;
}

function getProductByAlias(products, alias) {
  if (!alias) return null;
  const key = String(alias).trim().toLowerCase();
  return products.find(product => String(product?.alias || "").trim().toLowerCase() === key) || null;
}

function listProductsForSelect(products) {
  return (products || [])
    .filter(Boolean)
    .map(product => {
      const alias = String(product.alias || "").trim();
      const sku = String(product.sku || "").trim();
      const displayAlias = alias || sku;
      return {
        sku,
        alias: displayAlias,
        label: displayAlias,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function resolveDefault(field, context) {
  const { product, supplier, mapping, settings, transportMode, incoterm } = context;
  const incotermValue = String(incoterm || "").toUpperCase();
  if (field === "supplierId") return mapping?.supplierId || product?.supplierId || "";
  if (field === "transportMode") return product?.defaultTransportMode || "SEA";
  if (field === "incoterm") return mapping?.incoterm || product?.defaultIncoterm || supplier?.incotermDefault || "EXW";
  if (field === "currency") return mapping?.currency || supplier?.currencyDefault || "USD";
  if (field === "freightCurrency") return incotermValue === "DDP" ? "USD" : (product?.freightCurrency || "EUR");
  if (field === "unitPrice") {
    if (mapping?.unitPrice != null) return parseLocaleNumber(mapping.unitPrice);
    if (product?.defaultUnitPrice != null || product?.unitPrice != null) {
      return parseLocaleNumber(product.defaultUnitPrice ?? product.unitPrice);
    }
    return null;
  }
  if (field === "freight") {
    const key = transportMode ? `freight${String(transportMode).toUpperCase()}` : null;
    if (key && product?.[key] != null) return parseLocaleNumber(product[key]);
    if (product?.freight != null) return parseLocaleNumber(product.freight);
    return parseLocaleNumber(settings?.freightDefault ?? 0);
  }
  if (field === "dutyRatePct") {
    if (incotermValue === "DDP") return 0;
    if (product?.dutyRatePct != null) return parseLocaleNumber(product.dutyRatePct);
    return parseLocaleNumber(settings?.dutyRatePct ?? 0);
  }
  if (field === "eustRatePct") {
    if (incotermValue === "DDP") return 0;
    if (product?.eustRatePct != null) return parseLocaleNumber(product.eustRatePct);
    return parseLocaleNumber(settings?.eustRatePct ?? 0);
  }
  if (field === "fxRate") {
    if (product?.fxRate != null) return parseLocaleNumber(product.fxRate);
    return parseLocaleNumber(settings?.fxRate ?? 0);
  }
  return null;
}

function buildSuggestedFields(state, form) {
  const settings = state.settings || {};
  const suggestedMapping = form.sku ? findPreferredMapping(state, form.sku) : null;
  const supplierId = form.supplierId || suggestedMapping?.supplierId || "";
  const supplier = (state.suppliers || []).find(item => item.id === supplierId) || null;
  const mapping = findProductSupplier(state, form.sku, supplierId) || suggestedMapping;
  const product = getProductBySku(state.products || [], form.sku);
  const baseContext = { product, supplier, mapping, settings, transportMode: form.transportMode, incoterm: form.incoterm };
  const resolvedTransport = resolveDefault("transportMode", baseContext);
  const transport = String(form.transportMode || resolvedTransport || "SEA").toUpperCase();
  const leadTimes = settings.transportLeadTimesDays || { air: 10, rail: 25, sea: 45 };
  const context = { ...baseContext, transportMode: transport };
  const logisticsLeadTimeDays = Number(leadTimes[transport.toLowerCase()] ?? 0);
  const unitPrice = resolveDefault("unitPrice", context);
  const unitPriceSource = mapping?.unitPrice != null
    ? "Supplier/SKU Mapping"
    : (product?.defaultUnitPrice != null || product?.unitPrice != null ? "Produktdatenbank" : null);
  const leadTimeResolution = resolveProductionLeadTimeDays({
    sku: form.sku,
    supplierId,
    state,
  });
  const incotermSource = mapping?.incoterm ? "Supplier/SKU Mapping" : (product?.defaultIncoterm ? "Produktdatenbank" : "Supplier Default");
  const paymentTermsSource = mapping?.paymentTermsTemplate?.length
    ? "Supplier/SKU Mapping"
    : (supplier?.paymentTermsDefault?.length ? "Supplier Default" : "System Default");
  const fxRateSource = settings?.fxRate ? "Settings" : null;
  return {
    transportMode: transport,
    incoterm: resolveDefault("incoterm", context),
    unitPrice,
    unitPriceSource,
    currency: resolveDefault("currency", context),
    freight: resolveDefault("freight", context),
    freightCurrency: resolveDefault("freightCurrency", context),
    dutyRatePct: resolveDefault("dutyRatePct", context),
    eustRatePct: resolveDefault("eustRatePct", context),
    fxRate: resolveDefault("fxRate", context),
    fxRateSource,
    supplierId,
    supplierSource: mapping?.supplierId ? "Supplier/SKU Mapping" : (product?.supplierId ? "Produktdatenbank" : null),
    productionLeadTimeDays: leadTimeResolution.value,
    productionLeadTimeSource: leadTimeResolution.source,
    incotermSource,
    paymentTermsSource,
    preferredSupplier: Boolean(mapping?.isPreferred),
    logisticsLeadTimeDays: Number.isFinite(logisticsLeadTimeDays) ? logisticsLeadTimeDays : 0,
    bufferDays: settings.defaultBufferDays ?? 0,
  };
}

function buildSchedule(form) {
  const target = parseISODate(form.targetDeliveryDate);
  const productionLeadTimeDays = parsePositive(form.productionLeadTimeDays);
  const logisticsLeadTimeDays = Number(form.logisticsLeadTimeDays || 0);
  const bufferDays = Number(form.bufferDays || 0);
  if (!target || productionLeadTimeDays == null || productionLeadTimeDays === 0) {
    return {
      orderDate: null,
      productionEndDate: null,
      etdDate: null,
      etaDate: null,
      deliveryDate: null,
    };
  }
  const orderDate = addDays(target, -(productionLeadTimeDays + logisticsLeadTimeDays + bufferDays));
  const productionEndDate = addDays(orderDate, productionLeadTimeDays);
  const etdDate = productionEndDate;
  const etaDate = addDays(etdDate, logisticsLeadTimeDays);
  return {
    orderDate: toISO(orderDate),
    productionEndDate: toISO(productionEndDate),
    etdDate: toISO(etdDate),
    etaDate: toISO(etaDate),
    deliveryDate: toISO(target),
  };
}

function buildCostValues(form) {
  const unitPrice = parseLocaleNumber(form.unitPrice) || 0;
  const units = Number(form.units || 0);
  const supplierCost = units * unitPrice;
  const fxRate = parseLocaleNumber(form.fxRate) || 0;
  const baseCurrency = form.currency || "USD";
  const supplierCostEur = convertToEur(supplierCost, baseCurrency, fxRate);
  const freight = parseLocaleNumber(form.freight) || 0;
  const freightCurrency = form.freightCurrency || "EUR";
  const freightEur = convertToEur(freight, freightCurrency, fxRate);
  const dutyRatePct = parseLocaleNumber(form.dutyRatePct) || 0;
  const dutyAmount = dutyRatePct > 0 ? supplierCostEur * (dutyRatePct / 100) : 0;
  const eustRatePct = parseLocaleNumber(form.eustRatePct) || 0;
  const eustAmount = eustRatePct > 0 ? (supplierCostEur + dutyAmount + freightEur) * (eustRatePct / 100) : 0;
  const landedCostEur = supplierCostEur + dutyAmount + freightEur + eustAmount;
  return {
    unitPrice,
    units,
    supplierCost,
    supplierCostEur,
    freight,
    freightCurrency,
    freightEur,
    dutyRatePct,
    eustRatePct,
    fxRate,
    landedCostEur,
  };
}

function buildScheduleFromOrderDate(orderDateIso, productionDays, bufferDays, transitDays) {
  const orderDate = parseISODate(orderDateIso);
  if (!orderDate) {
    return {
      orderDate: null,
      productionEndDate: null,
      etdDate: null,
      etaDate: null,
    };
  }
  const productionEndDate = addDays(orderDate, Number(productionDays || 0) + Number(bufferDays || 0));
  const etdDate = productionEndDate;
  const etaDate = addDays(etdDate, Number(transitDays || 0));
  return {
    orderDate: toISO(orderDate),
    productionEndDate: toISO(productionEndDate),
    etdDate: toISO(etdDate),
    etaDate: toISO(etaDate),
  };
}

function recomputePaymentDueDates(payments, schedule) {
  return payments.map(payment => {
    const triggerEvent = PAYMENT_EVENTS.includes(payment.triggerEvent) ? payment.triggerEvent : "ORDER_DATE";
    const offsetDays = Number(payment.offsetDays || 0);
    const offsetMonths = Number(payment.offsetMonths || 0);
    const baseDate = schedule[triggerEvent] ? parseISODate(schedule[triggerEvent]) : null;
    let dueDate = payment.dueDate;
    if (!payment.isOverridden) {
      let nextDate = baseDate ? addDays(baseDate, offsetDays) : null;
      if (nextDate && offsetMonths) {
        nextDate = addMonthsDate(nextDate, offsetMonths);
      }
      dueDate = nextDate ? toISO(nextDate) : null;
    }
    return {
      ...payment,
      triggerEvent,
      offsetDays,
      offsetMonths,
      dueDate,
    };
  });
}

function buildSuggestedPayments({ supplier, mapping, baseValue, currency, schedule, freight, freightCurrency, dutyRatePct, eustRatePct, fxRate, supplierCostEur, incoterm }) {
  const terms = Array.isArray(mapping?.paymentTermsTemplate) && mapping.paymentTermsTemplate.length
    ? mapping.paymentTermsTemplate
    : (Array.isArray(supplier?.paymentTermsDefault) && supplier.paymentTermsDefault.length
      ? supplier.paymentTermsDefault
      : defaultPaymentTerms());
  const supplierRows = terms.map(term => {
    const triggerEvent = PAYMENT_EVENTS.includes(term.triggerEvent) ? term.triggerEvent : "ORDER_DATE";
    const offsetDays = Number(term.offsetDays || 0);
    const amount = baseValue * (Number(term.percent || 0) / 100);
    const baseDate = schedule[triggerEvent] ? parseISODate(schedule[triggerEvent]) : null;
    const dueDate = baseDate ? toISO(addDays(baseDate, offsetDays)) : null;
    return {
      id: `pay-${Math.random().toString(36).slice(2, 9)}`,
      label: term.label || "Milestone",
      percent: Number(term.percent || 0),
      amount,
      currency: currency || "EUR",
      triggerEvent,
      offsetDays,
      dueDate,
      isOverridden: false,
      category: "supplier",
    };
  });

  const extraRows = [];
  const incotermValue = String(incoterm || "").toUpperCase();
  const freightAmount = Number(freight || 0);
  if (freightAmount > 0) {
    extraRows.push({
      id: `freight-${Math.random().toString(36).slice(2, 9)}`,
      label: "Freight",
      percent: 0,
      amount: freightAmount,
      currency: freightCurrency || "EUR",
      triggerEvent: "ETA",
      offsetDays: 0,
      dueDate: schedule.etaDate || null,
      isOverridden: false,
      category: "freight",
    });
  }

  const dutyRate = Number(dutyRatePct || 0);
  if (incotermValue !== "DDP" && dutyRate > 0) {
    const dutyBase = supplierCostEur;
    extraRows.push({
      id: `duty-${Math.random().toString(36).slice(2, 9)}`,
      label: "Duty",
      percent: dutyRate,
      amount: dutyBase * (dutyRate / 100),
      currency: "EUR",
      triggerEvent: "ETA",
      offsetDays: 0,
      dueDate: schedule.etaDate || null,
      isOverridden: false,
      category: "duty",
    });
  }

  const eustRate = Number(eustRatePct || 0);
  if (incotermValue !== "DDP" && eustRate > 0) {
    const freightEur = convertToEur(freightAmount, freightCurrency, fxRate);
    const dutyAmount = dutyRate > 0 ? supplierCostEur * (dutyRate / 100) : 0;
    const base = supplierCostEur + dutyAmount + freightEur;
    const eustAmount = base * (eustRate / 100);
    extraRows.push({
      id: `eust-${Math.random().toString(36).slice(2, 9)}`,
      label: "EUSt",
      percent: eustRate,
      amount: eustAmount,
      currency: "EUR",
      triggerEvent: "ETA",
      offsetDays: 0,
      dueDate: schedule.etaDate || null,
      isOverridden: false,
      category: "eust",
    });
    extraRows.push({
      id: `eust-refund-${Math.random().toString(36).slice(2, 9)}`,
      label: "EUSt Erstattung",
      percent: eustRate,
      amount: -eustAmount,
      currency: "EUR",
      triggerEvent: "ETA",
      offsetDays: 0,
      offsetMonths: 2,
      dueDate: schedule.etaDate ? toISO(addMonthsDate(parseISODate(schedule.etaDate), 2)) : null,
      isOverridden: false,
      category: "eust_refund",
    });
  }

  return [...supplierRows, ...extraRows];
}

function recomputePayments(payments, values) {
  const { baseValue, schedule, currency, freight, freightCurrency, dutyRatePct, eustRatePct, fxRate, supplierCostEur, incoterm } = values;
  const dutyRate = Number(dutyRatePct || 0);
  const eustRate = Number(eustRatePct || 0);
  const freightAmount = Number(freight || 0);
  const freightEur = convertToEur(freightAmount, freightCurrency, fxRate);
  const dutyAmount = dutyRate > 0 ? supplierCostEur * (dutyRate / 100) : 0;
  const eustBase = supplierCostEur + dutyAmount + freightEur;
  const incotermValue = String(incoterm || "").toUpperCase();
  return payments.map(payment => {
    const triggerEvent = PAYMENT_EVENTS.includes(payment.triggerEvent) ? payment.triggerEvent : "ORDER_DATE";
    const offsetDays = Number(payment.offsetDays || 0);
    const offsetMonths = Number(payment.offsetMonths || 0);
    let amount = Number(payment.amount || 0);
    if (payment.category === "supplier") {
      amount = baseValue * (Number(payment.percent || 0) / 100);
    } else if (payment.category === "freight") {
      amount = freightAmount;
    } else if (payment.category === "duty") {
      amount = incotermValue === "DDP" ? 0 : dutyAmount;
    } else if (payment.category === "eust") {
      amount = incotermValue === "DDP" ? 0 : (eustRate > 0 ? eustBase * (eustRate / 100) : 0);
    } else if (payment.category === "eust_refund") {
      amount = eustRate > 0 ? eustBase * (eustRate / 100) : 0;
      amount = -amount;
    }
    let dueDate = payment.dueDate;
    if (!payment.isOverridden) {
      const baseDate = schedule[triggerEvent] ? parseISODate(schedule[triggerEvent]) : null;
      let nextDate = baseDate ? addDays(baseDate, offsetDays) : null;
      if (nextDate && offsetMonths) {
        nextDate = addMonthsDate(nextDate, offsetMonths);
      }
      dueDate = nextDate ? toISO(nextDate) : null;
    }
    const nextCurrency = payment.category === "supplier"
      ? (currency || "EUR")
      : (payment.category === "freight" ? (freightCurrency || "EUR") : "EUR");
    return {
      ...payment,
      triggerEvent,
      offsetDays,
      amount,
      currency: nextCurrency,
      dueDate,
    };
  });
}

function openModal(title, content, actions = []) {
  const overlay = el("div", { class: "po-modal-backdrop", role: "dialog", "aria-modal": "true" });
  const card = el("div", { class: "po-modal fo-modal-frame" }, [
    el("header", { class: "po-modal-header" }, [
      el("h3", {}, [title]),
      el("button", { class: "btn ghost", type: "button", onclick: () => overlay.remove(), "aria-label": "Schließen" }, ["✕"]),
    ]),
    el("div", { class: "po-modal-body" }, [content]),
    el("footer", { class: "po-modal-actions" }, actions),
  ]);
  overlay.append(card);
  document.body.append(overlay);
  return overlay;
}

function normalizeFoRecord(form, schedule, payments) {
  const now = new Date().toISOString();
  const productionLeadTimeDaysManual = form.productionLeadTimeDaysManual != null
    ? Number(form.productionLeadTimeDaysManual)
    : null;
  const productionLeadTimeDaysValue = parsePositive(form.productionLeadTimeDays);
  return {
    id: form.id,
    sku: form.sku,
    supplierId: form.supplierId,
    targetDeliveryDate: form.targetDeliveryDate,
    units: Number(form.units || 0),
    transportMode: form.transportMode,
    incoterm: form.incoterm,
    unitPrice: parseLocaleNumber(form.unitPrice) || 0,
    unitPriceIsOverridden: Boolean(form.unitPriceIsOverridden),
    currency: normaliseCurrency(form.currency, "EUR"),
    freight: parseLocaleNumber(form.freight) || 0,
    freightCurrency: normaliseCurrency(form.freightCurrency, "EUR"),
    dutyRatePct: parseLocaleNumber(form.dutyRatePct) || 0,
    eustRatePct: parseLocaleNumber(form.eustRatePct) || 0,
    fxRate: parseLocaleNumber(form.fxRate) || 0,
    productionLeadTimeDays: Number.isFinite(productionLeadTimeDaysValue) ? productionLeadTimeDaysValue : null,
    productionLeadTimeDaysManual: Number.isFinite(productionLeadTimeDaysManual) ? productionLeadTimeDaysManual : null,
    productionLeadTimeSource: form.productionLeadTimeSource || null,
    logisticsLeadTimeDays: Number(form.logisticsLeadTimeDays || 0),
    bufferDays: Number(form.bufferDays || 0),
    orderDate: schedule.orderDate,
    productionEndDate: schedule.productionEndDate,
    etdDate: schedule.etdDate,
    etaDate: schedule.etaDate,
    deliveryDate: schedule.deliveryDate,
    payments,
    status: form.status || "DRAFT",
    convertedPoId: form.convertedPoId || null,
    convertedPoNo: form.convertedPoNo || null,
    createdAt: form.createdAt || now,
    updatedAt: now,
  };
}

export default function render(root) {
  const state = loadState();
  if (!Array.isArray(state.fos)) state.fos = [];
  if (!Array.isArray(state.suppliers)) state.suppliers = [];
  if (!Array.isArray(state.productSuppliers)) state.productSuppliers = [];
  const products = getProductsSnapshot();
  const supplierLabelMap = buildSupplierLabelMap(state, products);

  root.innerHTML = `
    <section class="card">
      <h2>Forecast Orders (FO)</h2>
      <div class="table-card-header">
        <span class="muted">Planung neuer Bestände</span>
        <div class="fo-toolbar">
          <input type="text" id="fo-search" placeholder="Alias oder SKU suchen" />
          <select id="fo-status-filter">
            <option value="ALL">Status: Alle</option>
            <option value="DRAFT">Draft</option>
            <option value="PLANNED">Planned</option>
            <option value="CONVERTED">Converted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button class="btn primary" id="fo-add">Create FO</button>
        </div>
      </div>
      <div id="fo-table"></div>
    </section>
  `;

  const tableHost = $("#fo-table", root);
  const searchInput = $("#fo-search", root);
  const statusFilter = $("#fo-status-filter", root);

  function buildPoFromFo(fo, poNumber, orderDateOverride) {
    const poId = `po-${Math.random().toString(36).slice(2, 9)}`;
    const poNo = String(poNumber || "").trim();
    const fxRate = parseLocaleNumber(fo.fxRate) || 0;
    const freightEur = convertToEur(parseLocaleNumber(fo.freight) || 0, fo.freightCurrency, fxRate);
    const milestones = (fo.payments || [])
      .filter(payment => payment.category === "supplier")
      .map(payment => ({
        id: payment.id || `ms-${Math.random().toString(36).slice(2, 9)}`,
        label: payment.label || "Milestone",
        percent: Number(payment.percent || 0),
        anchor: mapPaymentAnchor(payment.triggerEvent),
        lagDays: Number(payment.offsetDays || 0),
      }));
    const prodDays = Number(fo.productionLeadTimeDays || 0) + Number(fo.bufferDays || 0);
    const transitDays = Number(fo.logisticsLeadTimeDays || 0);
    const schedule = buildScheduleFromOrderDate(orderDateOverride, prodDays, 0, transitDays);
    return {
      id: poId,
      poNo,
      sku: fo.sku,
      supplierId: fo.supplierId,
      units: Number(fo.units || 0),
      unitCostUsd: formatNumber(fo.unitPrice || 0),
      unitExtraUsd: "0,00",
      extraFlatUsd: "0,00",
      orderDate: schedule.orderDate || fo.orderDate || null,
      prodDays,
      transitDays,
      transport: fo.transportMode || "SEA",
      freightEur: formatNumber(freightEur),
      dutyRatePct: formatPercent(fo.dutyRatePct || 0),
      eustRatePct: formatPercent(fo.eustRatePct || 0),
      fxOverride: formatNumber(fxRate || 0),
      ddp: String(fo.incoterm || "").toUpperCase() === "DDP",
      milestones,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function renderRows() {
    const searchValue = ($("#fo-search", root)?.value || "").trim().toLowerCase();
    const statusFilter = $("#fo-status-filter", root)?.value || "ALL";
    const rows = state.fos
      .slice()
      .filter(fo => {
        if (statusFilter !== "ALL" && String(fo.status || "DRAFT").toUpperCase() !== statusFilter) return false;
        if (!searchValue) return true;
        const product = getProductBySku(products, fo.sku);
        const alias = String(product?.alias || "").toLowerCase();
        const sku = String(fo.sku || "").toLowerCase();
        return alias.includes(searchValue) || sku.includes(searchValue);
      })
      .sort((a, b) => (a.targetDeliveryDate || "").localeCompare(b.targetDeliveryDate || ""));

    if (!rows.length) {
      tableHost.innerHTML = `<p class="muted">Keine Forecast Orders vorhanden.</p>`;
      return;
    }

    const listRows = rows.map(fo => {
      const supplier = state.suppliers.find(item => item.id === fo.supplierId);
      const product = getProductBySku(products, fo.sku);
      const schedule = buildSchedule(fo);
      const costValues = buildCostValues(fo);
      const paymentsSummary = formatPaymentsSummary(fo.payments);
      const paymentsTotal = paymentSummaryTotal(fo.payments, fo.fxRate);
      const paymentsTooltip = formatPaymentTooltip(fo.payments, fo.fxRate);
      const status = String(fo.status || "DRAFT").toUpperCase();
      return {
        fo,
        supplierLabel: supplier ? (supplierLabelMap.get(supplier.id) || supplier.name || "—") : "—",
        alias: product?.alias || fo.sku || "—",
        skuLabel: fo.sku || "—",
        schedule,
        costValues,
        paymentsSummary,
        paymentsTotal,
        paymentsTooltip,
        status,
        statusLabel: STATUS_LABELS[status] || status,
        statusClass: `badge${status === "CONVERTED" ? " muted" : ""}`,
      };
    });
    const columns = [
      { key: "id", label: "FO ID" },
      { key: "product", label: "Produkt" },
      { key: "supplier", label: "Supplier" },
      { key: "units", label: "Units", className: "num" },
      { key: "target", label: "Target Delivery" },
      { key: "order", label: "Order Date" },
      { key: "timeline", label: "ETD / ETA" },
      { key: "total", label: "Total Value (EUR)", className: "num" },
      { key: "payments", label: "Payments" },
      { key: "status", label: "Status" },
      { key: "actions", label: "Actions" },
    ];
    tableHost.innerHTML = "";
    tableHost.append(createDataTable({
      columns,
      rows: listRows,
      rowKey: row => row.fo.id,
      rowAttrs: row => ({ dataset: { id: row.fo.id } }),
      renderCell: (row, col) => {
        const { fo } = row;
        switch (col.key) {
          case "id":
            return shortId(fo.id);
          case "product":
            return el("div", { class: "fo-product-cell" }, [
              el("strong", {}, [row.alias]),
              el("small", { class: "muted" }, [row.skuLabel]),
            ]);
          case "supplier":
            return el("button", { class: "btn ghost fo-link", type: "button", dataset: { action: "supplier" } }, [row.supplierLabel]);
          case "units":
            return Number(fo.units || 0).toLocaleString("de-DE");
          case "target":
            return formatDate(fo.targetDeliveryDate);
          case "order":
            return formatDate(fo.orderDate);
          case "timeline":
            return el("div", { class: "fo-date-stack" }, [
              el("span", {}, [`ETD ${formatDate(fo.etdDate || row.schedule.etdDate)}`]),
              el("span", { class: "muted" }, [`ETA ${formatDate(fo.etaDate || row.schedule.etaDate)}`]),
            ]);
          case "total":
            return formatCurrency(row.costValues.landedCostEur, "EUR");
          case "payments":
            return el("div", { title: row.paymentsTooltip }, [
              row.paymentsSummary,
              el("br"),
              el("span", { class: "muted" }, [formatCurrency(row.paymentsTotal, "EUR")]),
            ]);
          case "status":
            return el("span", { class: row.statusClass }, [row.statusLabel]);
          case "actions":
            return el("div", { class: "table-actions" }, [
              el("button", { class: "btn", type: "button", dataset: { action: "edit" } }, ["View/Edit"]),
              el("button", { class: "btn secondary", type: "button", dataset: { action: "convert" }, disabled: row.status === "CONVERTED" ? "true" : null }, ["Convert to PO"]),
              el("button", { class: "btn danger", type: "button", dataset: { action: "delete" } }, ["Delete"]),
            ]);
          default:
            return "—";
        }
      },
    }));
  }

  if (searchInput) {
    searchInput.addEventListener("input", renderRows);
  }
  if (statusFilter) {
    statusFilter.addEventListener("change", renderRows);
  }

  function openInfoModal(title, lines = [], actionLabel) {
    const list = el("div", { class: "fo-info-list" }, lines.map(text => el("p", { class: "muted" }, [text])));
    const closeBtn = el("button", { class: "btn", type: "button" }, ["Schließen"]);
    const goBtn = actionLabel
      ? el("button", {
        class: "btn primary",
        type: "button",
        onclick: () => {
          overlay.remove();
          if (actionLabel === "produkte") location.hash = "#produkte";
          if (actionLabel === "suppliers") location.hash = "#suppliers";
        },
      }, [actionLabel === "produkte" ? "Zu Produkten" : "Zu Suppliers"])
      : null;
    const overlay = openModal(title, list, goBtn ? [closeBtn, goBtn] : [closeBtn]);
    closeBtn.addEventListener("click", () => overlay.remove());
  }

  function openConvertModal(fo) {
    const existingPoNumbers = (state.pos || []).map(po => String(po.poNo || "").trim()).filter(Boolean);
    const schedule = buildSchedule(fo);
    let orderDate = schedule.orderDate || fo.orderDate || "";
    let preview = buildScheduleFromOrderDate(orderDate, fo.productionLeadTimeDays || 0, fo.bufferDays || 0, fo.logisticsLeadTimeDays || 0);

    const content = el("div", { class: "fo-convert-modal" }, [
      el("label", {}, [
        "PO Number (Ventory One)",
        el("input", { type: "text", id: "fo-po-number", placeholder: "e.g. 250029", maxlength: "30" }),
        el("small", { class: "muted" }, ["Must match Ventory One PO number"]),
        el("small", { class: "form-error", id: "fo-po-error" }, []),
      ]),
      el("label", { style: "margin-top:10px" }, [
        "Order Date (PO)",
        el("input", { type: "date", id: "fo-po-order-date", value: orderDate }),
        el("div", { class: "fo-convert-actions" }, [
          el("button", { class: "btn secondary", type: "button", id: "fo-po-today" }, ["Today"]),
        ]),
        el("small", { class: "muted" }, ["Default is calculated from FO backward scheduling."]),
      ]),
      el("div", { class: "fo-convert-preview" }, [
        el("p", { class: "muted" }, ["This will update PO dates:"]),
        el("div", { class: "fo-date-stack" }, [
          el("span", { id: "fo-preview-production-convert" }, ["Production End: —"]),
          el("span", { id: "fo-preview-etd-convert" }, ["ETD: —"]),
          el("span", { id: "fo-preview-eta-convert" }, ["ETA: —"]),
        ]),
      ]),
    ]);

    const convertBtn = el("button", { class: "btn primary", type: "button", disabled: "true" }, ["Convert"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Cancel"]);
    const overlay = openModal("Convert FO to PO", content, [cancelBtn, convertBtn]);

    const poInput = $("#fo-po-number", content);
    const orderInput = $("#fo-po-order-date", content);
    const poError = $("#fo-po-error", content);

    function updatePreview() {
      preview = buildScheduleFromOrderDate(orderDate, fo.productionLeadTimeDays || 0, fo.bufferDays || 0, fo.logisticsLeadTimeDays || 0);
      $("#fo-preview-production-convert", content).textContent = `Production End: ${formatDate(preview.productionEndDate)}`;
      $("#fo-preview-etd-convert", content).textContent = `ETD: ${formatDate(preview.etdDate)}`;
      $("#fo-preview-eta-convert", content).textContent = `ETA: ${formatDate(preview.etaDate)}`;
    }

    function validate() {
      const value = poInput.value.trim();
      let error = "";
      if (!value) error = "PO number is required.";
      if (value.length > 30) error = "Max length is 30.";
      if (existingPoNumbers.includes(value)) error = "PO number already exists.";
      if (!orderDate) error = error || "Order date is required.";
      poError.textContent = error;
      convertBtn.disabled = Boolean(error);
      return !error;
    }

    $("#fo-po-today", content).addEventListener("click", () => {
      const today = new Date();
      orderDate = toISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
      orderInput.value = orderDate;
      updatePreview();
    });

    poInput.addEventListener("input", validate);
    orderInput.addEventListener("input", (e) => {
      orderDate = e.target.value;
      updatePreview();
    });

    cancelBtn.addEventListener("click", () => overlay.remove());
    updatePreview();
    validate();

    convertBtn.addEventListener("click", () => {
      if (!validate()) return;
      const updatedSchedule = buildScheduleFromOrderDate(orderDate, fo.productionLeadTimeDays || 0, fo.bufferDays || 0, fo.logisticsLeadTimeDays || 0);
      fo.orderDate = updatedSchedule.orderDate;
      fo.productionEndDate = updatedSchedule.productionEndDate;
      fo.etdDate = updatedSchedule.etdDate;
      fo.etaDate = updatedSchedule.etaDate;
      fo.payments = recomputePaymentDueDates(fo.payments || [], {
        ORDER_DATE: parseISODate(updatedSchedule.orderDate),
        PRODUCTION_END: parseISODate(updatedSchedule.productionEndDate),
        ETD: parseISODate(updatedSchedule.etdDate),
        ETA: parseISODate(updatedSchedule.etaDate),
      });
      const po = buildPoFromFo(fo, poInput.value, updatedSchedule.orderDate);
      if (!Array.isArray(state.pos)) state.pos = [];
      state.pos.push(po);
      fo.status = "CONVERTED";
      fo.convertedPoId = po.id;
      fo.convertedPoNo = po.poNo;
      fo.updatedAt = new Date().toISOString();
      saveState(state);
      renderRows();
      overlay.remove();
      const openPo = window.confirm("PO created. Open PO?");
      if (openPo) location.hash = "#po";
    });
  }

  function openFoModal(existing, prefill = {}) {
    const products = getProductsSnapshot();
    const productOptions = listProductsForSelect(products);
    const isExisting = Boolean(existing);
    const isConverted = String(existing?.status || "").toUpperCase() === "CONVERTED";
    const baseForm = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: `fo-${Math.random().toString(36).slice(2, 9)}`,
          sku: "",
          supplierId: "",
          targetDeliveryDate: "",
          units: "",
          transportMode: "SEA",
          incoterm: "EXW",
          unitPrice: "",
          unitPriceIsOverridden: false,
          currency: state.settings?.defaultCurrency || "EUR",
          freight: "",
          freightCurrency: "EUR",
          dutyRatePct: state.settings?.dutyRatePct ?? 0,
          eustRatePct: state.settings?.eustRatePct ?? 0,
          fxRate: state.settings?.fxRate ?? "",
          productionLeadTimeDays: "",
          productionLeadTimeDaysManual: null,
          productionLeadTimeSource: null,
          logisticsLeadTimeDays: "",
          bufferDays: state.settings?.defaultBufferDays ?? 0,
          payments: [],
          status: "DRAFT",
          createdAt: new Date().toISOString(),
        };
    if (!isExisting && prefill) {
      const prefillSku = String(prefill.sku || "").trim();
      const prefillAlias = String(prefill.alias || "").trim();
      const matchingProduct = getProductBySku(products, prefillSku)
        || getProductByAlias(products, prefillAlias)
        || getProductByAlias(products, prefillSku);
      if (matchingProduct?.sku) {
        baseForm.sku = matchingProduct.sku;
      } else if (prefillSku) {
        baseForm.sku = prefillSku;
      }
      if (prefill.targetDeliveryDate) {
        baseForm.targetDeliveryDate = prefill.targetDeliveryDate;
      }
    }
    if (!baseForm.freightCurrency) baseForm.freightCurrency = "EUR";
    if (baseForm.freight == null) baseForm.freight = "";
    if (baseForm.dutyRatePct == null) baseForm.dutyRatePct = state.settings?.dutyRatePct ?? 0;
    if (baseForm.eustRatePct == null) baseForm.eustRatePct = state.settings?.eustRatePct ?? 0;
    if (baseForm.fxRate == null) baseForm.fxRate = state.settings?.fxRate ?? "";
    if (!baseForm.currency) baseForm.currency = "USD";
    if (typeof baseForm.productionLeadTimeDaysManual === "undefined") {
      baseForm.productionLeadTimeDaysManual = null;
    }
    if (!baseForm.productionLeadTimeSource) {
      baseForm.productionLeadTimeSource = null;
    }
    if (Array.isArray(baseForm.payments)) {
      baseForm.payments = baseForm.payments.map(payment => ({
        ...payment,
        category: payment.category || "supplier",
      }));
    }

    const overrides = {
      transportMode: isExisting,
      incoterm: isExisting,
      currency: isExisting,
      freightCurrency: isExisting,
      freight: isExisting,
      dutyRatePct: isExisting,
      eustRatePct: isExisting,
      fxRate: isExisting,
      productionLeadTimeDays: isExisting,
      logisticsLeadTimeDays: isExisting,
      bufferDays: isExisting,
    };
    if (baseForm.productionLeadTimeDaysManual != null) {
      overrides.productionLeadTimeDays = true;
    }
    if (typeof baseForm.unitPriceIsOverridden !== "boolean") {
      baseForm.unitPriceIsOverridden = isExisting;
    }
    let paymentsDirty = isExisting && Array.isArray(baseForm.payments) && baseForm.payments.length > 0;
    let suggested = buildSuggestedFields(state, baseForm);

    function applySuggestedField(field, value) {
      baseForm[field] = value;
      overrides[field] = false;
      if (field === "productionLeadTimeDays") {
        baseForm.productionLeadTimeDaysManual = null;
        baseForm.productionLeadTimeSource = suggested.productionLeadTimeSource || null;
      }
      const input = $(`#fo-${field}`, content);
      if (input) {
        const formatted = (() => {
          if (value == null) return "";
          if (["unitPrice", "freight", "fxRate"].includes(field)) return formatNumber(value);
          if (["dutyRatePct", "eustRatePct"].includes(field)) return formatPercent(value);
          return value;
        })();
        input.value = formatted;
      }
    }

    function updateSuggestedFields() {
      const previousSupplier = baseForm.supplierId;
      suggested = buildSuggestedFields(state, baseForm);
      if (!baseForm.supplierId && suggested.supplierId) {
        baseForm.supplierId = suggested.supplierId;
        const supplierSelect = $("#fo-supplierId", content);
        if (supplierSelect) supplierSelect.value = suggested.supplierId;
      }
      if (!overrides.transportMode) applySuggestedField("transportMode", suggested.transportMode);
      if (!overrides.incoterm) applySuggestedField("incoterm", suggested.incoterm);
      if (!baseForm.unitPriceIsOverridden) applySuggestedField("unitPrice", suggested.unitPrice ?? "");
      if (!overrides.currency) applySuggestedField("currency", suggested.currency || "USD");
      if (!overrides.freight) applySuggestedField("freight", suggested.freight ?? "");
      if (!overrides.freightCurrency) applySuggestedField("freightCurrency", suggested.freightCurrency || "EUR");
      if (!overrides.dutyRatePct) applySuggestedField("dutyRatePct", suggested.dutyRatePct ?? "");
      if (!overrides.eustRatePct) applySuggestedField("eustRatePct", suggested.eustRatePct ?? "");
      if (!overrides.fxRate) applySuggestedField("fxRate", suggested.fxRate ?? "");
      if (!overrides.productionLeadTimeDays) applySuggestedField("productionLeadTimeDays", suggested.productionLeadTimeDays);
      if (!overrides.logisticsLeadTimeDays) applySuggestedField("logisticsLeadTimeDays", suggested.logisticsLeadTimeDays);
      if (!overrides.bufferDays) applySuggestedField("bufferDays", suggested.bufferDays);
      updateSuggestedLabels();
      updateIncotermState();
      updateWarnings();
      if (!paymentsDirty && baseForm.supplierId && baseForm.supplierId !== previousSupplier) {
        const schedule = buildSchedule(baseForm);
        const baseValue = computeBaseValue();
        const supplier = state.suppliers.find(item => item.id === baseForm.supplierId) || null;
        const costs = buildCostValues(baseForm);
        if (String(baseForm.incoterm || "").toUpperCase() === "DDP") {
          costs.dutyRatePct = 0;
          costs.eustRatePct = 0;
        }
        baseForm.payments = buildSuggestedPayments({
          supplier,
          mapping: findProductSupplier(state, baseForm.sku, baseForm.supplierId),
          baseValue,
          currency: baseForm.currency,
          schedule,
          freight: costs.freight,
          freightCurrency: costs.freightCurrency,
          dutyRatePct: costs.dutyRatePct,
          eustRatePct: costs.eustRatePct,
          fxRate: costs.fxRate,
          supplierCostEur: costs.supplierCostEur,
          incoterm: baseForm.incoterm,
        });
      }
    }

    function updateSuggestedLabels() {
      $("#suggested-transport", content).textContent = `Suggested: ${suggested.transportMode}`;
      $("#suggested-incoterm", content).textContent = `Suggested: ${suggested.incoterm}`;
      if (suggested.unitPrice != null) {
        const source = suggested.unitPriceSource ? ` (Quelle: ${suggested.unitPriceSource})` : "";
        $("#suggested-unitPrice", content).textContent = `Suggested: ${formatNumber(suggested.unitPrice)}${source}`;
      } else {
        $("#suggested-unitPrice", content).textContent = "Suggested: —";
      }
      $("#suggested-currency", content).textContent = `Suggested: ${suggested.currency || "USD"}`;
      $("#suggested-freight", content).textContent = `Suggested: ${suggested.freight != null ? formatNumber(suggested.freight) : "—"}`;
      $("#suggested-freightCurrency", content).textContent = `Suggested: ${suggested.freightCurrency || "EUR"}`;
      $("#suggested-dutyRatePct", content).textContent = `Suggested: ${suggested.dutyRatePct != null ? formatPercent(suggested.dutyRatePct) : "—"} %`;
      $("#suggested-eustRatePct", content).textContent = `Suggested: ${suggested.eustRatePct != null ? formatPercent(suggested.eustRatePct) : "—"} %`;
      $("#suggested-fxRate", content).textContent = `Suggested: ${suggested.fxRate != null ? formatNumber(suggested.fxRate) : "—"}`;
      const leadTimeValue = suggested.productionLeadTimeDays != null ? suggested.productionLeadTimeDays : "—";
      const leadTimeSource = suggested.productionLeadTimeSource ? ` (Quelle: ${suggested.productionLeadTimeSource})` : "";
      $("#suggested-productionLeadTimeDays", content).textContent = `Vorschlag: ${leadTimeValue}${leadTimeSource}`;
      $("#suggested-logisticsLeadTimeDays", content).textContent = `Suggested: ${suggested.logisticsLeadTimeDays}`;
      $("#suggested-bufferDays", content).textContent = `Suggested: ${suggested.bufferDays}`;
      updateSuggestionInfo();
    }

    function updateSuggestionInfo() {
      const list = $(".fo-suggestion-list", content);
      if (!list) return;
      list.innerHTML = "";
      const supplierSource = baseForm.supplierId && baseForm.supplierId !== suggested.supplierId
        ? "Manual override"
        : (suggested.supplierSource || "—");
      const unitPriceSource = baseForm.unitPriceIsOverridden ? "Manual override" : (suggested.unitPriceSource || "—");
      const leadTimeSource = overrides.productionLeadTimeDays ? "Manual override" : (suggested.productionLeadTimeSource || "missing");
      const incotermSource = overrides.incoterm ? "Manual override" : (suggested.incotermSource || "—");
      const paymentTermsSource = Array.isArray(baseForm.payments) && baseForm.payments.length ? (suggested.paymentTermsSource || "—") : "—";
      const fxSource = overrides.fxRate ? "Manual override" : (suggested.fxRateSource || "—");

      list.append(
        el("li", {}, [`Preferred Supplier: ${suggested.preferredSupplier ? "Yes" : "No"}`]),
        el("li", {}, [`Supplier source: ${supplierSource}`]),
        el("li", {}, [`Price source: ${unitPriceSource}`]),
        el("li", {}, [`Production lead time source: ${leadTimeSource}`]),
        el("li", {}, [`Incoterm source: ${incotermSource}`]),
        el("li", {}, [`Payment terms source: ${paymentTermsSource}`]),
        el("li", {}, [`FX source: ${fxSource}`]),
      );
    }

    function updateWarnings() {
      const warningBox = $("#fo-warning-info", content);
      const warningList = $(".fo-warning-list", content);
      if (!warningBox || !warningList) return;
      warningList.innerHTML = "";
      const sku = String(baseForm.sku || "").trim();
      if (sku) {
        const mappingCount = listActiveMappings(state, sku).length;
        if (mappingCount === 0) {
          warningList.append(el("li", {}, [
            "Kein Supplier-SKU Mapping gefunden.",
            " ",
            el("button", { class: "btn ghost fo-fix-now", type: "button", dataset: { sku, tab: "suppliers" } }, ["Fix now"]),
          ]));
        }
      }
      const product = getProductBySku(products, baseForm.sku);
      if (product) {
        const templateFields = product.template?.fields || {};
        const hasFreight = product.freight != null || product.freightAir != null || product.freightSea != null || product.freightRail != null || templateFields.freightEur != null;
        const hasDuty = product.dutyRatePct != null || templateFields.dutyPct != null;
        const hasEust = product.eustRatePct != null || templateFields.vatImportPct != null;
        if (!hasFreight || !hasDuty || !hasEust) {
          warningList.append(el("li", {}, [
            "Produktkosten fehlen (Freight/Zoll/EUSt).",
            " ",
            el("button", { class: "btn ghost fo-fix-now", type: "button", dataset: { sku: product.sku, tab: "produkte" } }, ["Fix now"]),
          ]));
        }
      }
      warningBox.style.display = warningList.childElementCount ? "block" : "none";
    }

    function updateIncotermState() {
      const isDdp = String(baseForm.incoterm || "").toUpperCase() === "DDP";
      const dutyInput = $("#fo-dutyRatePct", content);
      const eustInput = $("#fo-eustRatePct", content);
      const freightCurrencySelect = $("#fo-freightCurrency", content);
      if (isDdp) {
        baseForm.dutyRatePct = 0;
        baseForm.eustRatePct = 0;
        baseForm.freightCurrency = "USD";
        if (dutyInput) dutyInput.value = formatPercent(0);
        if (eustInput) eustInput.value = formatPercent(0);
        if (freightCurrencySelect) freightCurrencySelect.value = "USD";
      }
      if (dutyInput) dutyInput.disabled = isDdp;
      if (eustInput) eustInput.disabled = isDdp;
      if (freightCurrencySelect) freightCurrencySelect.disabled = isDdp;
    }

    function updateProductBanner() {
      const sku = String(baseForm.sku || "").trim();
      const hasProduct = products.some(prod => String(prod.sku || "").trim().toLowerCase() === sku.toLowerCase());
      const banner = $("#fo-product-banner", content);
      if (sku && !hasProduct) {
        banner.style.display = "block";
      } else {
        banner.style.display = "none";
      }
      const skuDisplay = $("#fo-sku-display", content);
      if (skuDisplay) skuDisplay.textContent = sku ? `SKU: ${sku}` : "SKU: —";
    }

    function updatePaymentsPreview() {
      const schedule = buildSchedule(baseForm);
      const baseValue = computeBaseValue();
      const values = buildCostValues(baseForm);
      if (String(baseForm.incoterm || "").toUpperCase() === "DDP") {
        values.dutyRatePct = 0;
        values.eustRatePct = 0;
      }
      baseForm.payments = recomputePayments(baseForm.payments, {
        baseValue,
        schedule,
        currency: baseForm.currency,
        freight: values.freight,
        freightCurrency: values.freightCurrency,
        dutyRatePct: values.dutyRatePct,
        eustRatePct: values.eustRatePct,
        fxRate: values.fxRate,
        supplierCostEur: values.supplierCostEur,
        incoterm: baseForm.incoterm,
      });
      renderPaymentsTable();
      updatePaymentTotals();
      updateSchedulePreview(schedule);
      updateCostSummary(values);
    }

    function updateSchedulePreview(schedule) {
      $("#fo-preview-order", content).textContent = formatDate(schedule.orderDate);
      $("#fo-preview-production", content).textContent = formatDate(schedule.productionEndDate);
      $("#fo-preview-etd", content).textContent = formatDate(schedule.etdDate);
      $("#fo-preview-eta", content).textContent = formatDate(schedule.etaDate);
      $("#fo-preview-target", content).textContent = formatDate(baseForm.targetDeliveryDate);
      const etaDate = parseISODate(schedule.etaDate);
      const targetDate = parseISODate(baseForm.targetDeliveryDate);
      const warning = $("#fo-date-warning", content);
      if (etaDate && targetDate && etaDate > targetDate) {
        warning.textContent = "Warnung: ETA liegt nach dem Zieltermin.";
        warning.style.display = "block";
      } else {
        warning.textContent = "";
        warning.style.display = "none";
      }
    }

    function updatePaymentTotals() {
      const total = baseForm.payments
        .filter(row => row.category === "supplier")
        .reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
      const info = $("#fo-payment-total", content);
      if (Math.round(total) === 100) {
        info.textContent = "Summe: 100%";
        info.style.color = "#0f9960";
      } else {
        info.textContent = `Summe: ${total.toFixed(2)}% (muss 100% sein)`;
        info.style.color = "#c23636";
      }
    }

    function updateCostSummary(values) {
      $("#fo-supplier-cost", content).textContent = formatCurrency(values.supplierCost, baseForm.currency || "USD");
      $("#fo-landed-cost", content).textContent = formatCurrency(values.landedCostEur, "EUR");
    }

    function computeBaseValue() {
      return Number(baseForm.units || 0) * (parseLocaleNumber(baseForm.unitPrice) || 0);
    }

    function normalizePaymentPercents() {
      const supplierRows = baseForm.payments.filter(row => row.category === "supplier");
      const total = supplierRows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
      if (!total) return;
      baseForm.payments = baseForm.payments.map(row => {
        if (row.category !== "supplier") return row;
        return {
          ...row,
          percent: Math.round(((Number(row.percent) || 0) / total) * 10000) / 100,
          isOverridden: true,
        };
      });
      updatePaymentsPreview();
    }

    function renderPaymentsTable() {
      const body = $("#fo-payments-body", content);
      body.innerHTML = "";
      baseForm.payments.forEach((row, idx) => {
        const isSupplier = row.category === "supplier";
        const amountValue = Number.isFinite(Number(row.amount)) ? formatNumber(Number(row.amount)) : "0,00";
        const tr = el("tr", {}, [
          el("td", {}, [
            el("input", {
              type: "text",
              value: row.label || "",
              oninput: (e) => {
                row.label = e.target.value;
                paymentsDirty = true;
              },
            }),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              min: "0",
              max: "100",
              step: "0.1",
              value: row.percent ?? 0,
              disabled: !isSupplier,
              oninput: (e) => {
                row.percent = parsePositive(e.target.value) ?? 0;
                row.isOverridden = true;
                paymentsDirty = true;
                updatePaymentsPreview();
              },
            }),
          ]),
          el("td", { class: "num" }, [
            el("div", { class: "fo-amount-field" }, [
            el("input", {
              type: "text",
              inputmode: "decimal",
              value: amountValue,
              oninput: (e) => {
                const amount = parsePositive(e.target.value) ?? 0;
                if (isSupplier) {
                  const baseValue = computeBaseValue();
                  row.percent = baseValue ? (amount / baseValue) * 100 : 0;
                }
                row.amount = amount;
                row.isOverridden = true;
                paymentsDirty = true;
                updatePaymentsPreview();
              },
              onblur: (e) => {
                const amount = parsePositive(e.target.value);
                if (amount != null) e.target.value = formatNumber(amount);
              },
            }),
            el("span", { class: "fo-amount-currency muted" }, [row.currency || "EUR"]),
            ]),
          ]),
          el("td", {}, [
            (() => {
              const select = el("select", {
                onchange: (e) => {
                  row.triggerEvent = e.target.value;
                  row.isOverridden = false;
                  paymentsDirty = true;
                  updatePaymentsPreview();
                },
              });
              PAYMENT_EVENTS.forEach(evt => select.append(el("option", { value: evt }, [evt])));
              select.value = row.triggerEvent || "ORDER_DATE";
              return select;
            })(),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              step: "1",
              value: row.offsetDays ?? 0,
              oninput: (e) => {
                row.offsetDays = parseNumber(e.target.value) ?? 0;
                row.isOverridden = false;
                paymentsDirty = true;
                updatePaymentsPreview();
              },
            }),
          ]),
          el("td", {}, [
            el("input", {
              type: "date",
              value: row.dueDate || "",
              oninput: (e) => {
                row.dueDate = e.target.value || null;
                row.isOverridden = true;
                paymentsDirty = true;
                updatePaymentsPreview();
              },
            }),
          ]),
          el("td", {}, [
            el("button", {
              class: "btn secondary",
              type: "button",
              onclick: () => {
                const supplier = state.suppliers.find(item => item.id === baseForm.supplierId) || null;
                const schedule = buildSchedule(baseForm);
                const baseValue = computeBaseValue();
                const costs = buildCostValues(baseForm);
                if (String(baseForm.incoterm || "").toUpperCase() === "DDP") {
                  costs.dutyRatePct = 0;
                  costs.eustRatePct = 0;
                }
                const suggestedPayments = buildSuggestedPayments({
                  supplier,
                  mapping: findProductSupplier(state, baseForm.sku, baseForm.supplierId),
                  baseValue,
                  currency: baseForm.currency,
                  schedule,
                  freight: costs.freight,
                  freightCurrency: costs.freightCurrency,
                  dutyRatePct: costs.dutyRatePct,
                  eustRatePct: costs.eustRatePct,
                  fxRate: costs.fxRate,
                  supplierCostEur: costs.supplierCostEur,
                  incoterm: baseForm.incoterm,
                });
                const suggestedRow = suggestedPayments[idx];
                if (suggestedRow) {
                  baseForm.payments[idx] = { ...suggestedRow, id: row.id || suggestedRow.id };
                  paymentsDirty = true;
                  updatePaymentsPreview();
                }
              },
            }, ["Reset"]),
          ]),
        ]);
        body.append(tr);
      });
    }

    const content = el("div", { class: "fo-modal" }, [
      isConverted
        ? el("div", { class: "banner info fo-converted-banner" }, [
          el("strong", {}, ["Converted to PO."]),
          el("span", { class: "muted" }, [` PO: ${baseForm.convertedPoNo || baseForm.convertedPoId || "—"}`]),
        ])
        : null,
      el("div", { class: "grid two" }, [
        el("section", { class: "card" }, [
          el("h3", {}, ["Inputs"]),
          el("div", { class: "grid two" }, [
            el("label", {}, [
              "Produkt (Alias)",
              el("div", { class: "fo-product-picker" }, [
                el("input", {
                  type: "text",
                  id: "fo-product-input",
                  value: (getProductBySku(products, baseForm.sku)?.alias || baseForm.sku || ""),
                  placeholder: "Alias oder SKU suchen",
                  autocomplete: "off",
                }),
                el("div", { class: "fo-product-dropdown", id: "fo-product-dropdown" }, []),
              ]),
              el("div", { class: "muted fo-sku-display", id: "fo-sku-display" }, ["SKU: —"]),
              el("small", { class: "form-error", id: "fo-product-error" }, []),
            ]),
            el("label", {}, [
              "Units",
              el("input", { type: "number", min: "0", step: "1", id: "fo-units", value: baseForm.units || "" }),
              el("small", { class: "form-error", id: "fo-units-error" }, []),
            ]),
            el("label", {}, [
              "Target Delivery Date",
              el("input", { type: "date", id: "fo-targetDeliveryDate", value: baseForm.targetDeliveryDate || "" }),
              el("small", { class: "form-error", id: "fo-target-error" }, []),
            ]),
            el("label", {}, [
              "Supplier",
              (() => {
                const select = el("select", { id: "fo-supplierId" });
                select.append(el("option", { value: "" }, ["Bitte auswählen"]));
                state.suppliers.forEach(supplier => {
                  const label = supplierLabelMap.get(supplier.id) || supplier.name || supplier.id;
                  select.append(el("option", { value: supplier.id }, [label]));
                });
                select.value = baseForm.supplierId || "";
                return select;
              })(),
              el("small", { class: "form-error", id: "fo-supplier-error" }, []),
            ]),
          ]),
          el("div", { class: "grid two" }, [
            el("label", {}, [
              "Transport Mode",
              (() => {
                const select = el("select", { id: "fo-transportMode" });
                TRANSPORT_MODES.forEach(mode => select.append(el("option", { value: mode }, [mode])));
                select.value = baseForm.transportMode || "SEA";
                return select;
              })(),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-transport" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-transportMode" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Incoterm",
              (() => {
                const select = el("select", { id: "fo-incoterm" });
                INCOTERMS.forEach(term => select.append(el("option", { value: term }, [term])));
                select.value = baseForm.incoterm || "EXW";
                return select;
              })(),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-incoterm" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-incoterm" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Unit Price",
              el("input", { type: "text", inputmode: "decimal", id: "fo-unitPrice", value: baseForm.unitPrice ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-unitPrice" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-unitPrice" }, ["Reset"]),
              ]),
              el("small", { class: "form-error", id: "fo-unitPrice-error" }, []),
            ]),
            el("label", {}, [
              "Currency",
              (() => {
                const select = el("select", { id: "fo-currency" });
                CURRENCIES.forEach(currency => select.append(el("option", { value: currency }, [currency])));
                select.value = baseForm.currency || "USD";
                return select;
              })(),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-currency" }, ["USD"]),
                el("button", { class: "btn ghost", type: "button", id: "reset-currency" }, ["Reset"]),
              ]),
              el("small", { class: "form-error", id: "fo-currency-error" }, []),
            ]),
            el("label", {}, [
              "Freight",
              el("input", { type: "text", inputmode: "decimal", id: "fo-freight", value: baseForm.freight ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-freight" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-freight" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Freight Currency",
              (() => {
                const select = el("select", { id: "fo-freightCurrency" });
                CURRENCIES.forEach(currency => select.append(el("option", { value: currency }, [currency])));
                select.value = baseForm.freightCurrency || "EUR";
                return select;
              })(),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-freightCurrency" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-freightCurrency" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Duty %",
              el("input", { type: "text", inputmode: "decimal", id: "fo-dutyRatePct", value: baseForm.dutyRatePct ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-dutyRatePct" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-dutyRatePct" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "EUSt %",
              el("input", { type: "text", inputmode: "decimal", id: "fo-eustRatePct", value: baseForm.eustRatePct ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-eustRatePct" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-eustRatePct" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "FX EUR/USD",
              el("input", { type: "text", inputmode: "decimal", id: "fo-fxRate", value: baseForm.fxRate ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-fxRate" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-fxRate" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Production Lead Time (used)",
              el("input", { type: "number", min: "0", step: "1", id: "fo-productionLeadTimeDays", value: baseForm.productionLeadTimeDays ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-productionLeadTimeDays" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-productionLeadTimeDays" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              "Logistics LT (days)",
              el("input", { type: "number", min: "0", step: "1", id: "fo-logisticsLeadTimeDays", value: baseForm.logisticsLeadTimeDays ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-logisticsLeadTimeDays" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-logisticsLeadTimeDays" }, ["Reset"]),
              ]),
            ]),
            el("label", {}, [
              el("span", { class: "fo-buffer-label" }, [
                "Buffer (days)",
                el("span", { class: "tooltip" }, [
                  el("button", { class: "tooltip-trigger", type: "button", "aria-label": "Buffer Erklärung" }, ["ℹ️"]),
                  el("span", { class: "tooltip-content" }, [
                    "Puffer in Tagen, der zur Sicherheit zusätzlich eingeplant wird. Er wird zur Summe aus Produktions- und Logistik-Leadtimes addiert und verschiebt das Bestelldatum entsprechend nach vorne.",
                  ]),
                ]),
              ]),
              el("input", { type: "number", min: "0", step: "1", id: "fo-bufferDays", value: baseForm.bufferDays ?? "" }),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-bufferDays" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-bufferDays" }, ["Reset"]),
              ]),
            ]),
          ]),
          el("div", { class: "fo-cost-summary" }, [
            el("div", { class: "fo-cost-row" }, [
              el("span", { class: "muted" }, ["Supplier Cost"]),
              el("strong", { id: "fo-supplier-cost" }, ["—"]),
            ]),
            el("div", { class: "fo-cost-row" }, [
              el("span", { class: "muted" }, ["Landed Cost (EUR)"]),
              el("strong", { id: "fo-landed-cost" }, ["—"]),
            ]),
          ]),
          el("div", { class: "banner info", id: "fo-suggestion-info" }, [
            el("strong", {}, ["Why this suggestion"]),
            el("ul", { class: "fo-suggestion-list" }, []),
          ]),
          el("div", { class: "banner warning", id: "fo-warning-info", style: "display:none" }, [
            el("strong", {}, ["Hinweise"]),
            el("ul", { class: "fo-warning-list" }, []),
          ]),
          el("div", { class: "banner info", id: "fo-product-banner", style: "display:none" }, [
            el("strong", {}, ["SKU nicht in Produktdatenbank."]),
            el("span", { class: "muted" }, [" Bitte Produkt anlegen."]),
            el("div", { class: "fo-banner-actions" }, [
              el("input", { type: "text", id: "fo-product-name", placeholder: "Produktname (optional)" }),
              el("button", { class: "btn secondary", type: "button", id: "fo-product-create" }, ["Produkt anlegen"]),
            ]),
          ]),
          el("div", { class: "form-error", id: "fo-save-error", role: "alert" }, []),
        ]),
        el("section", { class: "card" }, [
          el("h3", {}, ["Rückwärtsterminierung"]),
          el("div", { class: "fo-date-list" }, [
            el("div", { class: "fo-date-row" }, [el("span", {}, ["Ziel Delivery"]), el("strong", { id: "fo-preview-target" }, ["—"])]),
            el("div", { class: "fo-date-row" }, [el("span", {}, ["Order Date"]), el("strong", { id: "fo-preview-order" }, ["—"])]),
            el("div", { class: "fo-date-row" }, [el("span", {}, ["Production End"]), el("strong", { id: "fo-preview-production" }, ["—"])]),
            el("div", { class: "fo-date-row" }, [el("span", {}, ["ETD"]), el("strong", { id: "fo-preview-etd" }, ["—"])]),
            el("div", { class: "fo-date-row" }, [el("span", {}, ["ETA"]), el("strong", { id: "fo-preview-eta" }, ["—"])]),
          ]),
          el("p", { class: "muted", id: "fo-date-warning", style: "display:none; margin-top:10px" }, []),
        ]),
      ]),
      el("section", { class: "card" }, [
        el("h3", {}, ["Payments"]),
        el("div", { class: "table-wrap" }, [
          el("table", { class: "table fo-payments-table" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", {}, ["Label"]),
                el("th", { class: "num" }, ["%"]),
                el("th", { class: "num" }, ["Amount"]),
                el("th", {}, ["Trigger"]),
                el("th", { class: "num" }, ["Offset Days"]),
                el("th", {}, ["Due Date"]),
                el("th", {}, ["Reset"]),
              ]),
            ]),
            el("tbody", { id: "fo-payments-body" }, []),
          ]),
        ]),
        el("div", { class: "fo-payments-footer" }, [
          el("p", { class: "muted", id: "fo-payment-total" }, ["Summe: 100%"]),
          el("p", { class: "form-error", id: "fo-payment-error" }, []),
          el("button", { class: "btn secondary", type: "button", id: "fo-payment-normalize" }, ["Normalize to 100%"]),
        ]),
      ]),
    ]);

    const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Save FO"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Cancel"]);
    const overlay = openModal(isExisting ? "FO bearbeiten" : "FO anlegen", content, [cancelBtn, saveBtn]);

    cancelBtn.addEventListener("click", () => overlay.remove());
    if (isConverted) {
      saveBtn.disabled = true;
      content.querySelectorAll("input, select, textarea, button.btn.secondary, button.btn.ghost").forEach((el) => {
        if (el !== cancelBtn) el.setAttribute("disabled", "true");
      });
    }

    function setFieldOverride(field, value) {
      baseForm[field] = value;
      overrides[field] = true;
      if (field === "productionLeadTimeDays") {
        baseForm.productionLeadTimeDaysManual = value;
        baseForm.productionLeadTimeSource = "Manual override";
      }
    }

    function validateForm() {
      const sku = String(baseForm.sku || "").trim();
      const supplierId = String(baseForm.supplierId || "").trim();
      const units = Number(baseForm.units || 0);
      const unitPrice = parseLocaleNumber(baseForm.unitPrice) || 0;
      const target = baseForm.targetDeliveryDate;
      const hasProduct = products.some(prod => String(prod.sku || "").trim().toLowerCase() === sku.toLowerCase());
      const supplierPayments = baseForm.payments.filter(row => row.category === "supplier");
      const totalPercent = supplierPayments.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
      const currency = String(baseForm.currency || "").trim();
      const paymentsValid = supplierPayments.length > 0 && Math.round(totalPercent) === 100;
      const valid = sku && supplierId && units > 0 && unitPrice > 0 && target && paymentsValid && currency && hasProduct;
      const unitPriceError = $("#fo-unitPrice-error", content);
      const unitsError = $("#fo-units-error", content);
      const targetError = $("#fo-target-error", content);
      const productError = $("#fo-product-error", content);
      const supplierError = $("#fo-supplier-error", content);
      const currencyError = $("#fo-currency-error", content);
      const paymentError = $("#fo-payment-error", content);
      if (unitPriceError) {
        unitPriceError.textContent = unitPrice > 0 ? "" : "Unit Price ist erforderlich.";
      }
      if (unitsError) {
        unitsError.textContent = units > 0 ? "" : "Units ist erforderlich.";
      }
      if (targetError) {
        targetError.textContent = target ? "" : "Zieltermin ist erforderlich.";
      }
      if (productError) {
        productError.textContent = hasProduct ? "" : "Produkt fehlt in der Datenbank.";
      }
      if (supplierError) {
        supplierError.textContent = supplierId ? "" : "Supplier ist erforderlich.";
      }
      if (currencyError) {
        currencyError.textContent = currency ? "" : "Currency ist erforderlich.";
      }
      if (paymentError) {
        paymentError.textContent = paymentsValid ? "" : "Payment Terms fehlen oder ergeben nicht 100%.";
      }
      saveBtn.disabled = !valid;
      $("#fo-save-error", content).textContent = valid ? "" : "Bitte fehlende Felder korrigieren.";
    }

    let recomputeTimer = null;
    function scheduleRecompute() {
      if (recomputeTimer) clearTimeout(recomputeTimer);
      recomputeTimer = setTimeout(() => {
        const schedule = buildSchedule(baseForm);
        const baseValue = computeBaseValue();
        const values = buildCostValues(baseForm);
        baseForm.payments = recomputePayments(baseForm.payments, {
          baseValue,
          schedule,
          currency: baseForm.currency,
          freight: values.freight,
          freightCurrency: values.freightCurrency,
          dutyRatePct: values.dutyRatePct,
          eustRatePct: values.eustRatePct,
          fxRate: values.fxRate,
          supplierCostEur: values.supplierCostEur,
        });
        updateSchedulePreview(schedule);
        updatePaymentTotals();
        validateForm();
        updateWarnings();
        renderPaymentsTable();
        updateCostSummary(values);
      }, 300);
    }

    const productInput = $("#fo-product-input", content);
    const dropdown = $("#fo-product-dropdown", content);

    function resolveProductFromInput(value) {
      const directSku = getProductBySku(products, value);
      if (directSku) return directSku;
      return getProductByAlias(products, value);
    }

    function renderProductDropdown(filter = "") {
      dropdown.innerHTML = "";
      const search = String(filter || "").trim().toLowerCase();
      const matches = productOptions.filter(option => {
        if (!search) return true;
        return option.label.toLowerCase().includes(search) || option.sku.toLowerCase().includes(search);
      }).slice(0, 12);
      if (!matches.length) {
        dropdown.append(el("div", { class: "muted fo-product-empty" }, ["Keine Produkte gefunden."]));
        return;
      }
      matches.forEach(option => {
        const row = el("button", {
          class: "fo-product-option",
          type: "button",
          onclick: () => {
            baseForm.sku = option.sku;
            productInput.value = option.alias || option.sku;
            dropdown.style.display = "none";
            updateSuggestedFields();
            updateProductBanner();
            scheduleRecompute();
          },
        }, [
          el("span", { class: "fo-product-alias", title: option.alias || option.sku }, [option.alias || option.sku]),
          el("span", { class: "fo-product-sku muted", title: option.sku }, [option.sku]),
        ]);
        dropdown.append(row);
      });
    }

    productInput.addEventListener("focus", () => {
      dropdown.style.display = "block";
      renderProductDropdown(productInput.value);
    });
    productInput.addEventListener("input", (e) => {
      const value = e.target.value;
      renderProductDropdown(value);
      const match = resolveProductFromInput(value);
      baseForm.sku = match ? match.sku : value.trim();
      updateSuggestedFields();
      updateProductBanner();
      scheduleRecompute();
    });
    productInput.addEventListener("blur", () => {
      setTimeout(() => { dropdown.style.display = "none"; }, 150);
    });

    $("#fo-units", content).addEventListener("input", (e) => {
      baseForm.units = parsePositive(e.target.value) ?? "";
      scheduleRecompute();
    });

    $("#fo-targetDeliveryDate", content).addEventListener("input", (e) => {
      baseForm.targetDeliveryDate = e.target.value;
      scheduleRecompute();
    });

    $("#fo-supplierId", content).addEventListener("change", (e) => {
      baseForm.supplierId = e.target.value;
      updateSuggestedFields();
      if (!paymentsDirty) {
        const schedule = buildSchedule(baseForm);
        const baseValue = computeBaseValue();
        const supplier = state.suppliers.find(item => item.id === baseForm.supplierId) || null;
        const costs = buildCostValues(baseForm);
        baseForm.payments = buildSuggestedPayments({
          supplier,
          baseValue,
          currency: baseForm.currency,
          schedule,
          freight: costs.freight,
          freightCurrency: costs.freightCurrency,
          dutyRatePct: costs.dutyRatePct,
          eustRatePct: costs.eustRatePct,
          fxRate: costs.fxRate,
          supplierCostEur: costs.supplierCostEur,
        });
      }
      scheduleRecompute();
    });

    $("#fo-transportMode", content).addEventListener("change", (e) => {
      setFieldOverride("transportMode", e.target.value);
      updateSuggestedFields();
      scheduleRecompute();
    });

    $("#fo-incoterm", content).addEventListener("change", (e) => {
      setFieldOverride("incoterm", e.target.value);
      updateSuggestedFields();
      updateSuggestedLabels();
      updateIncotermState();
      scheduleRecompute();
    });

    $("#fo-unitPrice", content).addEventListener("input", (e) => {
      baseForm.unitPrice = parsePositive(e.target.value) ?? "";
      baseForm.unitPriceIsOverridden = true;
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-currency", content).addEventListener("change", (e) => {
      setFieldOverride("currency", e.target.value.trim() || "USD");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-freight", content).addEventListener("input", (e) => {
      setFieldOverride("freight", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-freightCurrency", content).addEventListener("change", (e) => {
      setFieldOverride("freightCurrency", e.target.value.trim() || "EUR");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-dutyRatePct", content).addEventListener("input", (e) => {
      setFieldOverride("dutyRatePct", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-eustRatePct", content).addEventListener("input", (e) => {
      setFieldOverride("eustRatePct", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-fxRate", content).addEventListener("input", (e) => {
      setFieldOverride("fxRate", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-productionLeadTimeDays", content).addEventListener("input", (e) => {
      const nextValue = parsePositive(e.target.value);
      if (nextValue == null) {
        applySuggestedField("productionLeadTimeDays", suggested.productionLeadTimeDays);
      } else {
        setFieldOverride("productionLeadTimeDays", nextValue);
      }
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-logisticsLeadTimeDays", content).addEventListener("input", (e) => {
      setFieldOverride("logisticsLeadTimeDays", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-bufferDays", content).addEventListener("input", (e) => {
      setFieldOverride("bufferDays", parsePositive(e.target.value) ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#reset-transportMode", content).addEventListener("click", () => {
      applySuggestedField("transportMode", suggested.transportMode);
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-incoterm", content).addEventListener("click", () => {
      applySuggestedField("incoterm", suggested.incoterm);
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-unitPrice", content).addEventListener("click", () => {
      applySuggestedField("unitPrice", suggested.unitPrice ?? "");
      baseForm.unitPriceIsOverridden = false;
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-currency", content).addEventListener("click", () => {
      applySuggestedField("currency", suggested.currency || "USD");
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-freight", content).addEventListener("click", () => {
      applySuggestedField("freight", suggested.freight ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-freightCurrency", content).addEventListener("click", () => {
      applySuggestedField("freightCurrency", suggested.freightCurrency || "EUR");
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-dutyRatePct", content).addEventListener("click", () => {
      applySuggestedField("dutyRatePct", suggested.dutyRatePct ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-eustRatePct", content).addEventListener("click", () => {
      applySuggestedField("eustRatePct", suggested.eustRatePct ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-fxRate", content).addEventListener("click", () => {
      applySuggestedField("fxRate", suggested.fxRate ?? "");
      updateSuggestedLabels();
      scheduleRecompute();
    });

    ["fo-unitPrice", "fo-freight", "fo-dutyRatePct", "fo-eustRatePct", "fo-fxRate"].forEach((id) => {
      const input = $(`#${id}`, content);
      if (!input) return;
      input.addEventListener("blur", () => {
        const value = parsePositive(input.value);
        if (value == null) return;
        if (id === "fo-dutyRatePct" || id === "fo-eustRatePct") {
          input.value = formatPercent(value);
        } else {
          input.value = formatNumber(value);
        }
      });
    });
    $("#reset-productionLeadTimeDays", content).addEventListener("click", () => {
      applySuggestedField("productionLeadTimeDays", suggested.productionLeadTimeDays);
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-logisticsLeadTimeDays", content).addEventListener("click", () => {
      applySuggestedField("logisticsLeadTimeDays", suggested.logisticsLeadTimeDays);
      updateSuggestedLabels();
      scheduleRecompute();
    });
    $("#reset-bufferDays", content).addEventListener("click", () => {
      applySuggestedField("bufferDays", suggested.bufferDays);
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-payment-normalize", content).addEventListener("click", normalizePaymentPercents);

    $("#fo-product-create", content).addEventListener("click", () => {
      const sku = String(baseForm.sku || "").trim();
      if (!sku) return;
      const name = $("#fo-product-name", content).value.trim();
      try {
        upsertProduct({ sku, alias: name || sku, supplierId: baseForm.supplierId || "" });
        products.push({ sku, alias: name || sku });
        productOptions.push({ sku, alias: name || sku, label: name || sku });
        $("#fo-product-banner", content).style.display = "none";
        scheduleRecompute();
      } catch (err) {
        window.alert(err?.message || "Produkt konnte nicht angelegt werden.");
      }
    });

    content.addEventListener("click", (e) => {
      const btn = e.target.closest(".fo-fix-now");
      if (!btn) return;
      const sku = btn.dataset.sku;
      const tab = btn.dataset.tab || "suppliers";
      if (!sku) return;
      sessionStorage.setItem("healthFocus", JSON.stringify({ tab, sku }));
      if (tab === "produkte") {
        location.hash = "#produkte";
      } else {
        location.hash = "#suppliers";
      }
      overlay.remove();
    });

    function collectBlockingIssues() {
      const { issues } = validateAll({
        settings: state.settings,
        products: state.products,
        suppliers: state.suppliers,
      });
      return issues.filter(issue => {
        if (!issue.blocking) return false;
        if (issue.scope === "settings") {
          return issue.field === "fxRate";
        }
        if (issue.scope === "product") {
          return issue.entityId === baseForm.sku
            && (issue.field === "currency" || issue.field === "unitPrice");
        }
        if (issue.scope === "supplier") {
          return issue.entityId === baseForm.supplierId
            && (issue.field === "paymentTerms" || issue.field === "productionLeadTime");
        }
        return false;
      });
    }

    saveBtn.addEventListener("click", () => {
      validateForm();
      if (saveBtn.disabled) return;
      const blockingIssues = collectBlockingIssues();
      if (blockingIssues.length) {
        openBlockingModal(blockingIssues);
        return;
      }
      if (String(baseForm.incoterm || "").toUpperCase() === "DDP") {
        baseForm.dutyRatePct = 0;
        baseForm.eustRatePct = 0;
        baseForm.freightCurrency = "USD";
      }
      const schedule = buildSchedule(baseForm);
      const normalized = normalizeFoRecord(baseForm, schedule, baseForm.payments);
      const existingIndex = state.fos.findIndex(item => item.id === normalized.id);
      if (existingIndex >= 0) state.fos[existingIndex] = normalized;
      else state.fos.push(normalized);
      saveState(state);
      renderRows();
      window.alert("FO gespeichert.");
      overlay.remove();
    });

    if (!baseForm.payments.length) {
      const schedule = buildSchedule(baseForm);
      const baseValue = computeBaseValue();
      const supplier = state.suppliers.find(item => item.id === baseForm.supplierId) || null;
      const costs = buildCostValues(baseForm);
      if (String(baseForm.incoterm || "").toUpperCase() === "DDP") {
        costs.dutyRatePct = 0;
        costs.eustRatePct = 0;
      }
      baseForm.payments = buildSuggestedPayments({
        supplier,
        mapping: findProductSupplier(state, baseForm.sku, baseForm.supplierId),
        baseValue,
        currency: baseForm.currency,
        schedule,
        freight: costs.freight,
        freightCurrency: costs.freightCurrency,
        dutyRatePct: costs.dutyRatePct,
        eustRatePct: costs.eustRatePct,
        fxRate: costs.fxRate,
        supplierCostEur: costs.supplierCostEur,
        incoterm: baseForm.incoterm,
      });
    }

    updateSuggestedFields();
    updateProductBanner();
    updatePaymentsPreview();
    validateForm();
  }

  $("#fo-add", root).addEventListener("click", () => openFoModal(null));

  tableHost.addEventListener("click", (ev) => {
    const target = ev.target?.closest ? ev.target : ev.target?.parentElement;
    if (!target) return;
    const row = target.closest("tr[data-id], tr[data-key]");
    if (!row) return;
    const id = row.dataset.id || row.dataset.key;
    const fo = state.fos.find(item => item.id === id);
    if (!fo) return;
    const action = target.closest("button")?.dataset?.action;
    if (action === "edit") {
      openFoModal(fo);
    } else if (action === "convert") {
      if (String(fo.status || "").toUpperCase() === "CONVERTED") return;
      openConvertModal(fo);
    } else if (action === "delete") {
      const isConverted = String(fo.status || "").toUpperCase() === "CONVERTED";
      const prompt = isConverted
        ? "Diese FO wurde bereits in eine PO umgewandelt. FO trotzdem löschen? (Die PO bleibt bestehen.)"
        : "Forecast Order wirklich löschen?";
      const confirmed = window.confirm(prompt);
      if (!confirmed) return;
      state.fos = state.fos.filter(item => item.id !== id);
      saveState(state);
      renderRows();
    } else if (action === "supplier") {
      const supplier = state.suppliers.find(item => item.id === fo.supplierId);
      if (supplier) {
        openInfoModal("Supplier Details", [
          `Name: ${supplier.name}`,
          `Incoterm: ${supplier.incotermDefault || "—"}`,
          `Currency: ${supplier.currencyDefault || "—"}`,
        ], "suppliers");
      } else {
        openInfoModal("Supplier Details", ["Supplier ist nicht vorhanden."], "suppliers");
      }
    }
  });

  renderRows();

  function focusFromRoute() {
    const query = window.__routeQuery || {};
    const isCreate = query.create === "1" || query.mode === "create";
    if (isCreate) {
      openFoModal(null, {
        sku: query.sku || "",
        alias: query.alias || "",
        targetDeliveryDate: query.target || "",
      });
      window.__routeQuery = {};
      return;
    }
    if (!query.open) return;
    const needle = String(query.open || "").trim().toLowerCase();
    if (!needle) return;
    const match = state.fos.find(fo => {
      if (!fo) return false;
      const idMatch = String(fo.id || "").toLowerCase() === needle;
      const numberMatch = String(fo.foNo || "").toLowerCase() === needle;
      return idMatch || numberMatch;
    });
    if (match) {
      openFoModal(match);
      window.__routeQuery = {};
    }
  }

  focusFromRoute();
}

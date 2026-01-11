import {
  loadState,
  saveState,
  getProductsSnapshot,
  upsertProduct,
} from "../data/storageLocal.js";

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
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/[^0-9,.-]+/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalised = cleaned;
  if (decimalIndex >= 0) {
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalised = `${integer}.${fraction}`;
  } else {
    normalised = cleaned.replace(/[.,]/g, "");
  }
  const num = Number(normalised);
  return Number.isFinite(num) ? num : null;
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

function findProductSupplier(state, sku, supplierId) {
  if (!sku || !supplierId) return null;
  const keySku = String(sku).trim().toLowerCase();
  const keySup = String(supplierId).trim();
  return (state.productSuppliers || []).find(
    entry => String(entry.sku || "").trim().toLowerCase() === keySku && String(entry.supplierId || "").trim() === keySup,
  ) || null;
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
  if (field === "supplierId") return product?.supplierId || "";
  if (field === "transportMode") return product?.defaultTransportMode || "SEA";
  if (field === "incoterm") return mapping?.incoterm || product?.defaultIncoterm || supplier?.incotermDefault || "EXW";
  if (field === "currency") return supplier?.currencyDefault || product?.defaultCurrency || settings.defaultCurrency || "EUR";
  if (field === "freightCurrency") return product?.freightCurrency || "EUR";
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
    if (product?.dutyRatePct != null) return parseLocaleNumber(product.dutyRatePct);
    return parseLocaleNumber(settings?.dutyRatePct ?? 0);
  }
  if (field === "eustRatePct") {
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
  const supplier = (state.suppliers || []).find(item => item.id === form.supplierId) || null;
  const mapping = findProductSupplier(state, form.sku, form.supplierId);
  const product = getProductBySku(state.products || [], form.sku);
  const baseContext = { product, supplier, mapping, settings, transportMode: form.transportMode, incoterm: form.incoterm };
  const resolvedTransport = resolveDefault("transportMode", baseContext);
  const transport = String(form.transportMode || resolvedTransport || "SEA").toUpperCase();
  const leadTimes = settings.transportLeadTimesDays || { air: 10, rail: 25, sea: 45 };
  const context = { ...baseContext, transportMode: transport };
  const logisticsLeadTimeDays = Number(leadTimes[transport.toLowerCase()] ?? 0);
  const unitPrice = resolveDefault("unitPrice", context);
  const unitPriceSource = mapping?.unitPrice != null
    ? "Product/Supplier Mapping"
    : (product?.defaultUnitPrice != null || product?.unitPrice != null ? "Produktdatenbank" : null);
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
    supplierId: resolveDefault("supplierId", context),
    productionLeadTimeDays: mapping?.productionLeadTimeDays ?? supplier?.productionLeadTimeDaysDefault ?? 30,
    logisticsLeadTimeDays: Number.isFinite(logisticsLeadTimeDays) ? logisticsLeadTimeDays : 0,
    bufferDays: settings.defaultBufferDays ?? 0,
  };
}

function buildSchedule(form) {
  const target = parseISODate(form.targetDeliveryDate);
  const productionLeadTimeDays = Number(form.productionLeadTimeDays || 0);
  const logisticsLeadTimeDays = Number(form.logisticsLeadTimeDays || 0);
  const bufferDays = Number(form.bufferDays || 0);
  if (!target) {
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

function buildSuggestedPayments({ supplier, baseValue, currency, schedule, freight, freightCurrency, dutyRatePct, eustRatePct, fxRate, supplierCostEur }) {
  const terms = Array.isArray(supplier?.paymentTermsDefault) && supplier.paymentTermsDefault.length
    ? supplier.paymentTermsDefault
    : defaultPaymentTerms();
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
  if (dutyRate > 0) {
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
  if (eustRate > 0) {
    const freightEur = convertToEur(freightAmount, freightCurrency, fxRate);
    const dutyAmount = dutyRate > 0 ? supplierCostEur * (dutyRate / 100) : 0;
    const base = supplierCostEur + dutyAmount + freightEur;
    extraRows.push({
      id: `eust-${Math.random().toString(36).slice(2, 9)}`,
      label: "EUSt",
      percent: eustRate,
      amount: base * (eustRate / 100),
      currency: "EUR",
      triggerEvent: "ETA",
      offsetDays: 0,
      dueDate: schedule.etaDate || null,
      isOverridden: false,
      category: "eust",
    });
  }

  return [...supplierRows, ...extraRows];
}

function recomputePayments(payments, values) {
  const { baseValue, schedule, currency, freight, freightCurrency, dutyRatePct, eustRatePct, fxRate, supplierCostEur } = values;
  const dutyRate = Number(dutyRatePct || 0);
  const eustRate = Number(eustRatePct || 0);
  const freightAmount = Number(freight || 0);
  const freightEur = convertToEur(freightAmount, freightCurrency, fxRate);
  const dutyAmount = dutyRate > 0 ? supplierCostEur * (dutyRate / 100) : 0;
  const eustBase = supplierCostEur + dutyAmount + freightEur;
  return payments.map(payment => {
    const triggerEvent = PAYMENT_EVENTS.includes(payment.triggerEvent) ? payment.triggerEvent : "ORDER_DATE";
    const offsetDays = Number(payment.offsetDays || 0);
    let amount = Number(payment.amount || 0);
    if (payment.category === "supplier") {
      amount = baseValue * (Number(payment.percent || 0) / 100);
    } else if (payment.category === "freight") {
      amount = freightAmount;
    } else if (payment.category === "duty") {
      amount = dutyAmount;
    } else if (payment.category === "eust") {
      amount = eustRate > 0 ? eustBase * (eustRate / 100) : 0;
    }
    let dueDate = payment.dueDate;
    if (!payment.isOverridden) {
      const baseDate = schedule[triggerEvent] ? parseISODate(schedule[triggerEvent]) : null;
      dueDate = baseDate ? toISO(addDays(baseDate, offsetDays)) : null;
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
    currency: form.currency || "EUR",
    freight: parseLocaleNumber(form.freight) || 0,
    freightCurrency: form.freightCurrency || "EUR",
    dutyRatePct: parseLocaleNumber(form.dutyRatePct) || 0,
    eustRatePct: parseLocaleNumber(form.eustRatePct) || 0,
    fxRate: parseLocaleNumber(form.fxRate) || 0,
    productionLeadTimeDays: Number(form.productionLeadTimeDays || 0),
    logisticsLeadTimeDays: Number(form.logisticsLeadTimeDays || 0),
    bufferDays: Number(form.bufferDays || 0),
    orderDate: schedule.orderDate,
    productionEndDate: schedule.productionEndDate,
    etdDate: schedule.etdDate,
    etaDate: schedule.etaDate,
    deliveryDate: schedule.deliveryDate,
    payments,
    status: form.status || "DRAFT",
    createdAt: form.createdAt || now,
    updatedAt: now,
  };
}

export default function render(root) {
  const state = loadState();
  if (!Array.isArray(state.fos)) state.fos = [];
  if (!Array.isArray(state.suppliers)) state.suppliers = [];
  if (!Array.isArray(state.productSuppliers)) state.productSuppliers = [];

  root.innerHTML = `
    <section class="card">
      <h2>Forecast Orders (FO)</h2>
      <div class="table-card-header">
        <span class="muted">Planung neuer Bestände</span>
        <button class="btn primary" id="fo-add">Create FO</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>FO ID</th>
              <th>SKU</th>
              <th>Supplier</th>
              <th class="num">Units</th>
              <th>Target Delivery</th>
              <th>Transport</th>
              <th>Order Date</th>
              <th class="num">Total Value</th>
              <th>Payments</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="fo-rows"></tbody>
        </table>
      </div>
    </section>
  `;

  const rowsEl = $("#fo-rows", root);

  function renderRows() {
    if (!state.fos.length) {
      rowsEl.innerHTML = `<tr><td colspan="10" class="muted">Keine Forecast Orders vorhanden.</td></tr>`;
      return;
    }
    rowsEl.innerHTML = state.fos
      .slice()
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(fo => {
        const supplier = state.suppliers.find(item => item.id === fo.supplierId);
        const total = Number(fo.units || 0) * Number(fo.unitPrice || 0);
        const skuLabel = fo.sku || "—";
        const supplierLabel = supplier?.name || "—";
        const transportLabel = `${fo.transportMode || "SEA"} / ${fo.incoterm || "EXW"}`;
        return `
          <tr data-id="${fo.id}">
            <td>${shortId(fo.id)}</td>
            <td><button class="btn ghost fo-link" data-action="sku">${skuLabel}</button></td>
            <td><button class="btn ghost fo-link" data-action="supplier">${supplierLabel}</button></td>
            <td class="num">${Number(fo.units || 0).toLocaleString("de-DE")}</td>
            <td>${formatDate(fo.targetDeliveryDate)}</td>
            <td>${transportLabel}</td>
            <td>${formatDate(fo.orderDate)}</td>
            <td class="num">${formatCurrency(total, fo.currency)}</td>
            <td>${formatPaymentsSummary(fo.payments)}</td>
            <td>
              <button class="btn" data-action="edit">View/Edit</button>
              <button class="btn" data-action="duplicate">Duplicate</button>
              <button class="btn danger" data-action="delete">Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");
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

  function openFoModal(existing) {
    const products = getProductsSnapshot();
    const productOptions = listProductsForSelect(products);
    const isExisting = Boolean(existing);
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
          logisticsLeadTimeDays: "",
          bufferDays: state.settings?.defaultBufferDays ?? 0,
          payments: [],
          status: "DRAFT",
          createdAt: new Date().toISOString(),
        };
    if (!baseForm.freightCurrency) baseForm.freightCurrency = "EUR";
    if (baseForm.freight == null) baseForm.freight = "";
    if (baseForm.dutyRatePct == null) baseForm.dutyRatePct = state.settings?.dutyRatePct ?? 0;
    if (baseForm.eustRatePct == null) baseForm.eustRatePct = state.settings?.eustRatePct ?? 0;
    if (baseForm.fxRate == null) baseForm.fxRate = state.settings?.fxRate ?? "";
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
    if (typeof baseForm.unitPriceIsOverridden !== "boolean") {
      baseForm.unitPriceIsOverridden = isExisting;
    }
    let paymentsDirty = isExisting && Array.isArray(baseForm.payments) && baseForm.payments.length > 0;
    let suggested = buildSuggestedFields(state, baseForm);

    function applySuggestedField(field, value) {
      baseForm[field] = value;
      overrides[field] = false;
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
      if (!overrides.currency) applySuggestedField("currency", suggested.currency);
      if (!overrides.freight) applySuggestedField("freight", suggested.freight ?? "");
      if (!overrides.freightCurrency) applySuggestedField("freightCurrency", suggested.freightCurrency || "EUR");
      if (!overrides.dutyRatePct) applySuggestedField("dutyRatePct", suggested.dutyRatePct ?? "");
      if (!overrides.eustRatePct) applySuggestedField("eustRatePct", suggested.eustRatePct ?? "");
      if (!overrides.fxRate) applySuggestedField("fxRate", suggested.fxRate ?? "");
      if (!overrides.productionLeadTimeDays) applySuggestedField("productionLeadTimeDays", suggested.productionLeadTimeDays);
      if (!overrides.logisticsLeadTimeDays) applySuggestedField("logisticsLeadTimeDays", suggested.logisticsLeadTimeDays);
      if (!overrides.bufferDays) applySuggestedField("bufferDays", suggested.bufferDays);
      updateSuggestedLabels();
      if (!paymentsDirty && baseForm.supplierId && baseForm.supplierId !== previousSupplier) {
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
      $("#suggested-currency", content).textContent = `Suggested: ${suggested.currency}`;
      $("#suggested-freight", content).textContent = `Suggested: ${suggested.freight != null ? formatNumber(suggested.freight) : "—"}`;
      $("#suggested-freightCurrency", content).textContent = `Suggested: ${suggested.freightCurrency || "EUR"}`;
      $("#suggested-dutyRatePct", content).textContent = `Suggested: ${suggested.dutyRatePct != null ? formatPercent(suggested.dutyRatePct) : "—"} %`;
      $("#suggested-eustRatePct", content).textContent = `Suggested: ${suggested.eustRatePct != null ? formatPercent(suggested.eustRatePct) : "—"} %`;
      $("#suggested-fxRate", content).textContent = `Suggested: ${suggested.fxRate != null ? formatNumber(suggested.fxRate) : "—"}`;
      $("#suggested-productionLeadTimeDays", content).textContent = `Suggested: ${suggested.productionLeadTimeDays}`;
      $("#suggested-logisticsLeadTimeDays", content).textContent = `Suggested: ${suggested.logisticsLeadTimeDays}`;
      $("#suggested-bufferDays", content).textContent = `Suggested: ${suggested.bufferDays}`;
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

    function buildCostValues(form) {
      const unitPrice = parseLocaleNumber(form.unitPrice) || 0;
      const units = Number(form.units || 0);
      const supplierCost = units * unitPrice;
      const fxRate = parseLocaleNumber(form.fxRate) || 0;
      const supplierCostEur = convertToEur(supplierCost, form.currency, fxRate);
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

    function updateCostSummary(values) {
      $("#fo-supplier-cost", content).textContent = formatCurrency(values.supplierCost, baseForm.currency);
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
                const suggestedPayments = buildSuggestedPayments({
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
                  select.append(el("option", { value: supplier.id }, [supplier.name]));
                });
                select.value = baseForm.supplierId || "";
                return select;
              })(),
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
                select.value = baseForm.currency || "EUR";
                return select;
              })(),
              el("div", { class: "suggested-row" }, [
                el("span", { class: "muted", id: "suggested-currency" }, []),
                el("button", { class: "btn ghost", type: "button", id: "reset-currency" }, ["Reset"]),
              ]),
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
              "Production LT (days)",
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
          el("button", { class: "btn secondary", type: "button", id: "fo-payment-normalize" }, ["Normalize to 100%"]),
        ]),
      ]),
    ]);

    const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Save FO"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Cancel"]);
    const overlay = openModal(isExisting ? "FO bearbeiten" : "FO anlegen", content, [cancelBtn, saveBtn]);

    cancelBtn.addEventListener("click", () => overlay.remove());

    function setFieldOverride(field, value) {
      baseForm[field] = value;
      overrides[field] = true;
    }

    function validateForm() {
      const sku = String(baseForm.sku || "").trim();
      const supplierId = String(baseForm.supplierId || "").trim();
      const units = Number(baseForm.units || 0);
      const unitPrice = parseLocaleNumber(baseForm.unitPrice) || 0;
      const target = baseForm.targetDeliveryDate;
      const hasProduct = products.some(prod => String(prod.sku || "").trim().toLowerCase() === sku.toLowerCase());
      const totalPercent = baseForm.payments
        .filter(row => row.category === "supplier")
        .reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
      const valid = sku && supplierId && units > 0 && unitPrice > 0 && target && Math.round(totalPercent) === 100 && hasProduct;
      const unitPriceError = $("#fo-unitPrice-error", content);
      const unitsError = $("#fo-units-error", content);
      const targetError = $("#fo-target-error", content);
      const productError = $("#fo-product-error", content);
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
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-unitPrice", content).addEventListener("input", (e) => {
      baseForm.unitPrice = parsePositive(e.target.value) ?? "";
      baseForm.unitPriceIsOverridden = true;
      updateSuggestedLabels();
      scheduleRecompute();
    });

    $("#fo-currency", content).addEventListener("change", (e) => {
      setFieldOverride("currency", e.target.value.trim() || "EUR");
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
      setFieldOverride("productionLeadTimeDays", parsePositive(e.target.value) ?? "");
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
      applySuggestedField("currency", suggested.currency);
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

    saveBtn.addEventListener("click", () => {
      validateForm();
      if (saveBtn.disabled) return;
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

    updateSuggestedFields();
    updateProductBanner();
    updatePaymentsPreview();
    validateForm();
  }

  $("#fo-add", root).addEventListener("click", () => openFoModal(null));

  rowsEl.addEventListener("click", (ev) => {
    const row = ev.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    const fo = state.fos.find(item => item.id === id);
    if (!fo) return;
    const action = ev.target.closest("button")?.dataset?.action;
    if (action === "edit") {
      openFoModal(fo);
    } else if (action === "duplicate") {
      const copy = JSON.parse(JSON.stringify(fo));
      copy.id = `fo-${Math.random().toString(36).slice(2, 9)}`;
      copy.createdAt = new Date().toISOString();
      copy.updatedAt = copy.createdAt;
      copy.status = "DRAFT";
      state.fos.push(copy);
      saveState(state);
      renderRows();
      openFoModal(copy);
    } else if (action === "delete") {
      const confirmed = window.confirm("Forecast Order wirklich löschen?");
      if (!confirmed) return;
      state.fos = state.fos.filter(item => item.id !== id);
      saveState(state);
      renderRows();
    } else if (action === "sku") {
      const product = (getProductsSnapshot() || []).find(prod => String(prod.sku || "").trim().toLowerCase() === String(fo.sku || "").trim().toLowerCase());
      if (product) {
        openInfoModal("Produktdetails", [
          `SKU: ${product.sku}`,
          `Name: ${product.alias || "—"}`,
          `Status: ${product.status || "—"}`,
        ], "produkte");
      } else {
        openInfoModal("Produktdetails", ["SKU ist nicht in der Produktdatenbank vorhanden."], "produkte");
      }
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
}

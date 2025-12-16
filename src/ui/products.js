import {
  loadState,
  getProductsSnapshot,
  upsertProduct,
  deleteProductBySku,
  setProductStatus,
} from "../data/storageLocal.js";

function $(sel, ctx = document) {
  return ctx.querySelector(sel);
}

function createEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "dataset" && value && typeof value === "object") {
      Object.entries(value).forEach(([dk, dv]) => node.dataset[dk] = dv);
    } else if (value != null) {
      node.setAttribute(key, value);
    }
  });
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMonthLong(isoMonth) {
  if (!isoMonth) return "—";
  const [y, m] = isoMonth.split("-").map(Number);
  if (!y || !m) return "—";
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function fmtUSD(value) {
  return Number(value || 0).toLocaleString("de-DE", { style: "currency", currency: "USD" });
}

function fmtEUR(value) {
  return Number(value || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const cleaned = String(value).trim().replace(/[^0-9,.-]+/g, "");
  const comma = cleaned.lastIndexOf(",");
  if (comma >= 0) {
    const replaced = cleaned.slice(0, comma).replace(/\./g, "") + "." + cleaned.slice(comma + 1).replace(/\./g, "");
    const num = Number(replaced);
    return Number.isFinite(num) ? num : 0;
  }
  const num = Number(cleaned.replace(/\./g, ""));
  return Number.isFinite(num) ? num : 0;
}

function openModal({ title, content, actions = [], onClose }) {
  const overlay = createEl("div", { class: "po-modal-backdrop" });
  const modal = createEl("div", { class: "po-modal" });
  const header = createEl("div", { class: "po-modal-header" }, [
    createEl("h3", {}, [title]),
    createEl("button", {
      type: "button",
      class: "btn tertiary",
      onclick: () => {
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", escHandler);
        onClose?.();
      },
      "aria-label": "Schließen",
    }, ["✕"]),
  ]);
  const body = createEl("div", { class: "po-modal-body" }, [content]);
  const footer = createEl("div", { class: "po-modal-actions" });
  actions.forEach(action => footer.append(action));
  modal.append(header, body, footer);
  overlay.append(modal);
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) {
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", escHandler);
      onClose?.();
    }
  });
  function escHandler(ev) {
    if (ev.key === "Escape") {
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", escHandler);
      onClose?.();
    }
  }
  document.addEventListener("keydown", escHandler);
  document.body.append(overlay);
  return { overlay, modal, body, footer };
}

export function openProductDrawer(initialInput, { onSaved } = {}) {
  const products = getProductsSnapshot();
  const initialSku = (typeof initialInput === "string" ? initialInput : initialInput?.sku || "").trim();
  const match = initialSku
    ? products.find(prod => (prod.sku || "").toLowerCase() === initialSku.toLowerCase())
    : null;
  const base = match || {
    sku: initialSku,
    alias: typeof initialInput === "object" ? (initialInput?.alias || "") : "",
    supplierId: "",
    status: "active",
    tags: [],
    template: null,
  };

  const form = createEl("form", { class: "form" });
  const errorMsg = createEl("p", { class: "form-error" }, ["SKU existiert bereits."]);
  errorMsg.style.display = "none";

  const skuInput = createEl("input", { value: base.sku || "", required: true });
  const aliasInput = createEl("input", { value: base.alias || "", required: true });
  const supplierInput = createEl("input", { value: base.supplierId || "" });
  const statusSelect = createEl("select", {}, [
    createEl("option", { value: "active", selected: base.status !== "inactive" }, ["Aktiv"]),
    createEl("option", { value: "inactive", selected: base.status === "inactive" }, ["Inaktiv"]),
  ]);
  const tagsInput = createEl("input", { value: (base.tags || []).join(", ") });

  const template = base.template?.fields ? { ...base.template.fields } : (base.template || {});
  const templateFields = [
    { key: "unitPriceUsd", label: "Stückpreis (USD)", valueType: "number" },
    { key: "extraPerUnitUsd", label: "Zusatz je Stück (USD)", valueType: "number" },
    { key: "extraFlatUsd", label: "Zusatz pauschal (USD)", valueType: "number" },
    { key: "transport", label: "Transport", valueType: "text" },
    { key: "productionDays", label: "Produktionstage", valueType: "number" },
    { key: "transitDays", label: "Transit-Tage", valueType: "number" },
    { key: "freightEur", label: "Fracht (€)", valueType: "number" },
    { key: "dutyPct", label: "Zoll %", valueType: "number" },
    { key: "dutyIncludesFreight", label: "Freight einbeziehen", type: "checkbox" },
    { key: "vatImportPct", label: "EUSt %", valueType: "number" },
    { key: "vatRefundActive", label: "EUSt-Erstattung aktiv", type: "checkbox" },
    { key: "vatRefundLag", label: "EUSt-Lag (Monate)", valueType: "number" },
    { key: "fxRate", label: "FX-Kurs", valueType: "number" },
    { key: "fxFeePct", label: "FX-Gebühr %", valueType: "number" },
    { key: "ddp", label: "DDP", type: "checkbox" },
  ];

  const templateGrid = createEl("div", { class: "template-grid" });
  templateFields.forEach(field => {
    const wrapper = createEl("label", { class: "template-field" }, [
      createEl("span", {}, [field.label]),
    ]);
    const value = template[field.key] ?? "";
    let input;
    if (field.type === "checkbox") {
      input = createEl("input", { type: "checkbox", checked: Boolean(value) });
    } else if (field.valueType === "number") {
      input = createEl("input", { type: "text", value: value === "" ? "" : String(value) });
    } else {
      input = createEl("input", { type: "text", value: value === "" ? "" : String(value) });
    }
    wrapper.append(input);
    templateGrid.append(wrapper);
    wrapper.dataset.key = field.key;
  });

  form.append(
    createEl("label", {}, ["SKU", skuInput]),
    createEl("label", {}, ["Alias", aliasInput]),
    createEl("label", {}, ["Supplier", supplierInput]),
    createEl("label", {}, ["Status", statusSelect]),
    createEl("label", {}, ["Tags (kommagetrennt)", tagsInput]),
    createEl("h4", {}, ["Template"]),
    templateGrid,
    errorMsg,
  );

  const saveBtn = createEl("button", { class: "btn primary", type: "submit" }, ["Speichern"]);
  const cancelBtn = createEl("button", { class: "btn", type: "button" }, ["Abbrechen"]);

  // Buttons live outside the form container; wire the primary control to submit explicitly
  saveBtn.addEventListener("click", ev => {
    ev.preventDefault();
    form.requestSubmit();
  });

  const dialog = openModal({
    title: match ? `Produkt bearbeiten – ${base.alias || base.sku}` : "Produkt anlegen",
    content: form,
    actions: [cancelBtn, saveBtn],
    onClose: () => {},
  });

  const close = () => {
    dialog.overlay.remove();
  };

  cancelBtn.addEventListener("click", () => close());

  form.addEventListener("submit", ev => {
    ev.preventDefault();
    errorMsg.style.display = "none";
    const nextTemplate = {};
    templateGrid.querySelectorAll(".template-field").forEach(field => {
      const key = field.dataset.key;
      const input = field.querySelector("input");
      if (!input) return;
      if (input.type === "checkbox") {
        nextTemplate[key] = input.checked;
      } else {
        const parsed = parseNumber(input.value);
        nextTemplate[key] = Number.isFinite(parsed) ? parsed : 0;
      }
    });

    const payload = {
      sku: skuInput.value.trim(),
      alias: aliasInput.value.trim() || skuInput.value.trim(),
      supplierId: supplierInput.value.trim(),
      status: statusSelect.value,
      tags: (tagsInput.value || "").split(",").map(t => t.trim()).filter(Boolean),
      template: Object.keys(nextTemplate).length ? { fields: nextTemplate } : null,
      originalSku: match?.sku || base.sku,
    };

    try {
      upsertProduct(payload);
      document.dispatchEvent(new Event("state:changed"));
      close();
      onSaved?.();
    } catch (err) {
      errorMsg.textContent = err?.message || "SKU existiert bereits.";
      errorMsg.style.display = "block";
    }
  });

  return { close };
}

function buildHistoryTable(state, sku) {
  const rows = (state.pos || [])
    .filter(po => (po?.sku || "").trim().toLowerCase() === String(sku || "").trim().toLowerCase())
    .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""))
    .slice(0, 10);
  if (!rows.length) {
    return createEl("p", { class: "empty-state" }, ["Keine Bestellhistorie verfügbar."]);
  }
  const table = createEl("table", { class: "table" });
  const thead = createEl("thead", {}, [
    createEl("tr", {}, [
      createEl("th", {}, ["PO-Nr."]),
      createEl("th", {}, ["Bestelldatum"]),
      createEl("th", {}, ["Stückzahl"]),
      createEl("th", {}, ["Stückpreis (USD)"]),
      createEl("th", {}, ["Produktionstage"]),
      createEl("th", {}, ["Transit"]),
      createEl("th", {}, ["Transport"]),
      createEl("th", {}, ["Fracht (€)"]),
      createEl("th", {}, ["Zoll %"]),
      createEl("th", {}, ["EUSt %"]),
      createEl("th", {}, ["FX-Fee %"]),
    ])
  ]);
  const tbody = createEl("tbody");
  rows.forEach(po => {
    tbody.append(createEl("tr", {}, [
      createEl("td", {}, [po.poNumber || po.number || "—"]),
      createEl("td", {}, [fmtDate(po.orderDate)]),
      createEl("td", {}, [po.units != null ? String(po.units) : "—"]),
      createEl("td", {}, [fmtUSD(po.unitCostUsd)]),
      createEl("td", {}, [po.prodDays != null ? String(po.prodDays) : "—"]),
      createEl("td", {}, [po.transitDays != null ? String(po.transitDays) : "—"]),
      createEl("td", {}, [po.transport || "—"]),
      createEl("td", {}, [fmtEUR(po.freightEur)]),
      createEl("td", {}, [po.dutyRatePct != null ? String(po.dutyRatePct) : "—"]),
      createEl("td", {}, [po.eustRatePct != null ? String(po.eustRatePct) : "—"]),
      createEl("td", {}, [po.fxFeePct != null ? String(po.fxFeePct) : "—"]),
    ]));
  });
  table.append(thead, tbody);
  return table;
}

function buildForecastUsage() {
  const st = loadState();
  const usage = new Map();
  (st.forecast?.items || []).forEach(item => {
    const key = (item.sku || '').trim();
    if (!key) return;
    const entry = usage.get(key.toLowerCase()) || { total: 0, months: [] };
    const qty = Number(item.qty || 0);
    entry.total += Number.isFinite(qty) ? qty : 0;
    if (qty > 0 && item.month) entry.months.push(item.month);
    usage.set(key.toLowerCase(), entry);
  });
  return usage;
}

function renderProducts(root) {
  let products = getProductsSnapshot();
  let searchTerm = "";

  function applyFilter(list, term) {
    if (!term) return list;
    const needle = term.trim().toLowerCase();
    return list.filter(item => {
      return [item.alias, item.sku, item.supplierId, ...(item.tags || [])]
        .filter(Boolean)
        .some(val => String(val).toLowerCase().includes(needle));
    });
  }

  function showEditor(existing) {
    openProductDrawer(existing, {
      onSaved: () => {
        renderProducts(root);
      }
    });
  }

  function renderTable(list, forecastMap) {
    if (!list.length) {
      return createEl("p", { class: "empty-state" }, ["Keine Produkte gefunden. Lege ein Produkt an oder erfasse eine PO."]);
    }
    const table = createEl("table", { class: "table products-table" });
    table.append(
      createEl("thead", {}, [
        createEl("tr", {}, [
          createEl("th", {}, ["Alias"]),
          createEl("th", {}, ["SKU"]),
          createEl("th", {}, ["Supplier"]),
          createEl("th", {}, ["Letzte PO"]),
          createEl("th", {}, ["Ø Stückpreis"]),
          createEl("th", {}, ["POs"]),
          createEl("th", {}, ["Forecast"]),
          createEl("th", {}, ["Template"]),
          createEl("th", {}, ["Aktionen"]),
        ])
      ]),
      createEl("tbody", {}, list.map(product => {
        const templateBadge = product.template ? createEl("span", { class: "badge" }, ["vorhanden"]) : createEl("span", { class: "badge muted" }, ["—"]);
        const actionCell = createEl("td", { class: "actions" });
        const editBtn = createEl("button", { class: "btn secondary", type: "button", onclick: () => showEditor(product) }, ["Bearbeiten"]);
        const historyBtn = createEl("button", { class: "btn tertiary", type: "button", onclick: () => showHistory(product) }, ["Historie"]);
        const statusBtn = createEl("button", { class: "btn tertiary", type: "button", onclick: () => {
          setProductStatus(product.sku, product.status === "inactive" ? "active" : "inactive");
          renderProducts(root);
          document.dispatchEvent(new Event("state:changed"));
        } }, [product.status === "inactive" ? "Aktivieren" : "Inaktiv setzen"]);
        const deleteBtn = createEl("button", { class: "btn danger", type: "button", onclick: () => {
          if (confirm("Produkt wirklich löschen?")) {
            deleteProductBySku(product.sku);
            renderProducts(root);
            document.dispatchEvent(new Event("state:changed"));
          }
        } }, ["Löschen"]);
        actionCell.append(editBtn, historyBtn, statusBtn, deleteBtn);
        const forecastKey = (product.sku || '').toLowerCase();
        const forecastInfo = forecastMap.get(forecastKey);
        const forecastCell = createEl("td", {}, [
          createEl("span", { class: `badge ${forecastInfo ? 'success' : 'muted'}` }, [forecastInfo ? "Ja" : "Nein"]),
          forecastInfo?.months?.length ? createEl("div", { class: "small text-muted" }, [`Nächster Bedarf: ${fmtMonthLong(forecastInfo.months.sort()[0])}`]) : null,
        ]);

        return createEl("tr", {}, [
          createEl("td", {}, [product.alias || "—", product.status === "inactive" ? createEl("span", { class: "badge muted" }, ["inaktiv"]) : null]),
          createEl("td", {}, [product.sku || "—"]),
          createEl("td", {}, [product.supplierId || "—"]),
          createEl("td", {}, [product.stats?.lastOrderDate ? fmtDate(product.stats.lastOrderDate) : "—"]),
          createEl("td", {}, [product.stats?.avgUnitPriceUsd != null ? fmtUSD(product.stats.avgUnitPriceUsd) : "—"]),
          createEl("td", {}, [product.stats?.poCount != null ? String(product.stats.poCount) : "0"]),
          forecastCell,
          createEl("td", {}, [templateBadge]),
          actionCell,
        ]);
      }))
    );
    return table;
  }

  function showHistory(product) {
    const state = loadState();
    const historyTable = buildHistoryTable(state, product.sku);
    const closeBtn = createEl("button", { class: "btn", type: "button" }, ["Schließen"]);
    const dialog = openModal({
      title: `Historie – ${product.alias || product.sku}`,
      content: historyTable,
      actions: [closeBtn],
      onClose: () => {}
    });
    closeBtn.addEventListener("click", () => dialog.overlay.remove());
  }

  function render() {
    products = getProductsSnapshot();
    root.innerHTML = "";
    const filtered = applyFilter(products, searchTerm);
    const forecastMap = buildForecastUsage();
    const bannerCount = products.filter(prod => prod.alias.startsWith("Ohne Alias")).length;
    const header = createEl("div", { class: "products-header" });
    const title = createEl("h2", {}, ["Produkte"]);
    const actions = createEl("div", { class: "products-actions" });
    const createBtn = createEl("button", { class: "btn", type: "button", onclick: () => showEditor(null) }, ["+ Produkt anlegen"]);
    const search = createEl("input", {
      type: "search",
      placeholder: "Suche nach Alias, SKU, Tag, Supplier",
      value: searchTerm,
      oninput: ev => {
        searchTerm = ev.target.value;
        render();
      }
    });
    actions.append(search, createBtn);
    header.append(title, actions);
    root.append(header);
    if (bannerCount) {
      root.append(createEl("div", { class: "banner info" }, [
        `${bannerCount} Produkte ohne Alias – bitte ergänzen.`,
      ]));
    }
    root.append(renderTable(filtered, forecastMap));
  }

  render();
}

export default function mountProducts(root) {
  const handler = () => renderProducts(root);
  if (root.__productsCleanup) {
    root.__productsCleanup();
  }
  document.addEventListener("state:changed", handler);
  root.__productsCleanup = () => document.removeEventListener("state:changed", handler);
  renderProducts(root);
  return { cleanup: root.__productsCleanup };
}

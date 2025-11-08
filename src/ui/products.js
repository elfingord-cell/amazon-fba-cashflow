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

function renderProducts(root) {
  const state = loadState();
  const products = getProductsSnapshot();
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
    const state = loadState();
    const product = existing ? { ...existing } : { sku: "", alias: "", supplierId: "", status: "active", tags: [], template: null };
    const form = createEl("form", { class: "form" });

    const skuInput = createEl("input", { value: product.sku || "", required: true });
    const aliasInput = createEl("input", { value: product.alias || "", required: true });
    const supplierInput = createEl("input", { value: product.supplierId || "" });
    const statusSelect = createEl("select", {}, [
      createEl("option", { value: "active", selected: product.status !== "inactive" }, ["Aktiv"]),
      createEl("option", { value: "inactive", selected: product.status === "inactive" }, ["Inaktiv"]),
    ]);
    const tagsInput = createEl("input", { value: (product.tags || []).join(", ") });

    const template = product.template?.fields ? { ...product.template.fields } : (product.template || {});

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

    form.append(
      createEl("label", {}, ["SKU", skuInput]),
      createEl("label", {}, ["Alias", aliasInput]),
      createEl("label", {}, ["Supplier", supplierInput]),
      createEl("label", {}, ["Status", statusSelect]),
      createEl("label", {}, ["Tags (Komma-getrennt)", tagsInput]),
      createEl("hr"),
      createEl("h4", {}, ["Template-Werte"])
    );

    const templateContainer = createEl("div", { class: "grid two" });
    const templateInputs = {};
    const templateFieldMeta = {};
    templateFields.forEach(field => {
      templateFieldMeta[field.key] = field;
      if (field.type === "checkbox") {
        const checkbox = createEl("input", { type: "checkbox", name: field.key, checked: Boolean(template[field.key]) });
        templateInputs[field.key] = checkbox;
        templateContainer.append(createEl("label", { class: "inline-checkbox" }, [checkbox, " ", field.label]));
      } else {
        const input = createEl("input", { name: field.key, value: template[field.key] != null ? String(template[field.key]) : "" });
        templateInputs[field.key] = input;
        templateContainer.append(
          createEl("label", {}, [
            field.label,
            input,
          ])
        );
      }
    });
    form.append(templateContainer);

    const milestonesArea = createEl("textarea", {
      placeholder: "Milestones im JSON-Format (optional)",
      value: template.milestones ? JSON.stringify(template.milestones, null, 2) : "",
      rows: 6,
      style: "width:100%; margin-top:12px;"
    });
    form.append(createEl("label", {}, ["Meilensteine (JSON)", milestonesArea]));

    const historySection = createEl("div", { class: "product-history" }, [
      createEl("h4", {}, ["Historie"]),
      buildHistoryTable(state, product.sku),
    ]);

    const saveBtn = createEl("button", { class: "btn", type: "submit" }, ["Speichern"]);
    const cancelBtn = createEl("button", { class: "btn secondary", type: "button" }, ["Abbrechen"]);

    let dialog;
    dialog = openModal({
      title: existing ? `Produkt bearbeiten – ${existing.alias || existing.sku}` : "Neues Produkt",
      content: createEl("div", {}, [form, historySection]),
      actions: [cancelBtn, saveBtn],
      onClose: () => {},
    });
    cancelBtn.addEventListener("click", () => dialog.overlay.remove());
    saveBtn.addEventListener("click", ev => {
      ev.preventDefault();
      form.requestSubmit();
    });

    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const payload = {
        sku: skuInput.value.trim(),
        alias: aliasInput.value.trim(),
        supplierId: supplierInput.value.trim(),
        status: statusSelect.value,
        tags: tagsInput.value
          .split(",")
          .map(tag => tag.trim())
          .filter(Boolean),
      };
      if (existing?.sku) {
        payload.originalSku = existing.sku;
      }
      const templateObj = {};
      Object.entries(templateInputs).forEach(([key, input]) => {
        if (!input) return;
        if (input.type === "checkbox") {
          templateObj[key] = input.checked;
          return;
        }
        const raw = input.value.trim();
        if (raw === "") return;
        const meta = templateFieldMeta[key] || {};
        if (meta.valueType === "text") {
          templateObj[key] = raw;
        } else {
          templateObj[key] = parseNumber(raw);
        }
      });
      const msValue = milestonesArea.value.trim();
      if (msValue) {
        try {
          const parsed = JSON.parse(msValue);
          if (Array.isArray(parsed)) {
            const sum = parsed.reduce((acc, row) => acc + Number(row.percent || 0), 0);
            if (Math.round(sum) !== 100) {
              alert("Meilensteine müssen in Summe 100 % ergeben.");
              return;
            }
            templateObj.milestones = parsed;
          }
        } catch (err) {
          alert("Ungültiges Meilenstein-JSON: " + (err.message || err));
          return;
        }
      }
      if (Object.keys(templateObj).length) {
        payload.template = {
          scope: existing?.template?.scope || "SKU",
          name: existing?.template?.name || "Standard (SKU)",
          fields: templateObj,
        };
      } else {
        payload.template = null;
      }
      try {
        upsertProduct(payload);
        dialog.overlay.remove();
        renderProducts(root);
        document.dispatchEvent(new Event("state:changed"));
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }

  function renderTable(list) {
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
        return createEl("tr", {}, [
          createEl("td", {}, [product.alias || "—", product.status === "inactive" ? createEl("span", { class: "badge muted" }, ["inaktiv"]) : null]),
          createEl("td", {}, [product.sku || "—"]),
          createEl("td", {}, [product.supplierId || "—"]),
          createEl("td", {}, [product.stats?.lastOrderDate ? fmtDate(product.stats.lastOrderDate) : "—"]),
          createEl("td", {}, [product.stats?.avgUnitPriceUsd != null ? fmtUSD(product.stats.avgUnitPriceUsd) : "—"]),
          createEl("td", {}, [product.stats?.poCount != null ? String(product.stats.poCount) : "0"]),
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
    root.innerHTML = "";
    const filtered = applyFilter(products, searchTerm);
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
    root.append(renderTable(filtered));
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

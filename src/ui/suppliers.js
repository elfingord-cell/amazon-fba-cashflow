import {
  loadState,
  saveState,
  getProductsSnapshot,
  upsertProductSupplier,
  deleteProductSupplier,
  setPreferredProductSupplier,
} from "../data/storageLocal.js";
import { createDataTable } from "./components/dataTable.js";
import { buildSupplierLabelMap } from "./utils/supplierLabels.js";
import { formatDeNumber, parseDeNumber, validateSuppliers } from "../lib/dataHealth.js";
import { openDataHealthPanel } from "./dataHealthUi.js";

function $(sel, root = document) { return root.querySelector(sel); }
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

const TRIGGER_EVENTS = ["ORDER_DATE", "PRODUCTION_END", "ETD", "ETA"];
const CURRENCIES = ["EUR", "USD", "CNY"];
const INCOTERMS = ["EXW", "FOB", "DDP"];

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE");
}

function formatNumber(value) {
  return formatDeNumber(value, 2);
}

function defaultPaymentTerms() {
  return [
    { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
    { label: "Balance", percent: 70, triggerEvent: "ETD", offsetDays: 0 },
  ];
}

function formatTermsSummary(terms = []) {
  if (!terms.length) return "—";
  return terms
    .map(term => `${term.percent}% @ ${term.triggerEvent}${term.offsetDays ? ` ${term.offsetDays >= 0 ? "+" : ""}${term.offsetDays}` : ""}`)
    .join(", ");
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(Math.max(num, 0), 100);
}

function parseNumber(value) {
  return parseDeNumber(value);
}

function uniqueName(list, name, excludeId) {
  const candidate = String(name || "").trim().toLowerCase();
  if (!candidate) return false;
  return !list.some(item => item.id !== excludeId && String(item.name || "").trim().toLowerCase() === candidate);
}

function buildModal(title, content, actions) {
  const overlay = el("div", { class: "po-modal-backdrop", role: "dialog", "aria-modal": "true" });
  const card = el("div", { class: "po-modal" }, [
    el("header", { class: "po-modal-header" }, [
      el("h4", {}, [title || ""]),
      el("button", { class: "btn ghost", type: "button", onclick: () => overlay.remove(), "aria-label": "Schließen" }, ["✕"]),
    ]),
    el("div", { class: "po-modal-body" }, [content]),
    el("footer", { class: "po-modal-actions" }, actions),
  ]);
  overlay.append(card);
  document.body.append(overlay);
  return overlay;
}

export function render(root) {
  const state = loadState();
  if (!Array.isArray(state.suppliers)) state.suppliers = [];
  if (!Array.isArray(state.productSuppliers)) state.productSuppliers = [];
  const products = getProductsSnapshot();
  const productBySku = new Map(products.map(prod => [String(prod.sku || "").trim().toLowerCase(), prod]));
  const supplierLabelMap = buildSupplierLabelMap(state, products);
  let supplierIssuesById = new Map();

  function productLabel(sku) {
    const key = String(sku || "").trim().toLowerCase();
    const product = productBySku.get(key);
    return product?.alias || product?.sku || sku || "—";
  }

  function getSupplierIssueTooltip(issues) {
    if (!issues.length) return "";
    const labels = issues.map((issue) => {
      switch (issue.field) {
        case "name":
          return "Name";
        case "currency":
          return "Currency";
        case "paymentTerms":
          return "Payment Terms";
        case "productionLeadTime":
          return "Production Lead Time";
        default:
          return issue.field;
      }
    });
    return `Fehlt: ${[...new Set(labels)].join(", ")}`;
  }

  function buildHealthDot(supplierId) {
    const issues = supplierIssuesById.get(supplierId) || [];
    if (!issues.length) return null;
    const tooltip = getSupplierIssueTooltip(issues);
    return el("button", {
      class: "data-health-dot",
      type: "button",
      title: tooltip,
      "aria-label": tooltip,
      onclick: (event) => {
        event.stopPropagation();
        openDataHealthPanel({ scope: "supplier", entityId: supplierId });
      },
    });
  }

  root.innerHTML = `
    <section class="card">
      <h2>Suppliers</h2>
      <div class="table-card-header">
        <span class="muted">Lieferanten-Stammdaten</span>
        <button class="btn primary" id="supplier-add">Lieferant hinzufügen</button>
      </div>
      <div id="supplier-table"></div>
    </section>
  `;

  const tableHost = $("#supplier-table", root);

  function refreshSupplierIssues() {
    supplierIssuesById = new Map();
    validateSuppliers(state.suppliers).forEach(issue => {
      const key = String(issue.entityId || "").trim();
      if (!key) return;
      if (!supplierIssuesById.has(key)) supplierIssuesById.set(key, []);
      supplierIssuesById.get(key).push(issue);
    });
  }

  function renderRows() {
    refreshSupplierIssues();
    if (!state.suppliers.length) {
      tableHost.innerHTML = `<p class="muted">Keine Lieferanten vorhanden.</p>`;
      return;
    }
    const rows = state.suppliers
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    const columns = [
      { key: "name", label: "Supplier Name" },
      { key: "company", label: "Company" },
      { key: "lead", label: "Production LT (days)", className: "num" },
      { key: "incoterm", label: "Incoterm" },
      { key: "currency", label: "Currency" },
      { key: "terms", label: "Payment Terms" },
      { key: "updated", label: "Updated" },
      { key: "actions", label: "Actions" },
    ];
    tableHost.innerHTML = "";
    tableHost.append(createDataTable({
      columns,
      rows,
      rowKey: row => row.id,
      rowAttrs: row => ({ dataset: { id: row.id } }),
      renderCell: (supplier, col) => {
        switch (col.key) {
          case "name":
            return el("span", { class: "data-health-inline" }, [
              buildHealthDot(supplier.id),
              supplier.name,
            ]);
          case "company":
            return supplier.company_name || "—";
          case "lead":
            return supplier.productionLeadTimeDaysDefault;
          case "incoterm":
            return supplier.incotermDefault;
          case "currency":
            return supplier.currencyDefault || "EUR";
          case "terms":
            return formatTermsSummary(supplier.paymentTermsDefault);
          case "updated":
            return supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleDateString("de-DE") : "—";
          case "actions":
            return el("div", { class: "table-actions" }, [
              el("button", { class: "btn", type: "button", dataset: { action: "edit" } }, ["Bearbeiten"]),
              el("button", { class: "btn danger", type: "button", dataset: { action: "delete" } }, ["Löschen"]),
            ]);
          default:
            return "—";
        }
      },
    }));
  }

  function openMappingModal({ supplierId, mapping = null, presetSku = "" }) {
    const supplier = state.suppliers.find(item => item.id === supplierId) || null;
    if (!supplier) {
      window.alert("Supplier nicht gefunden.");
      return;
    }
    const productDefaults = (skuValue) => {
      const key = String(skuValue || "").trim().toLowerCase();
      const product = productBySku.get(key);
      const fields = product?.template?.fields || product?.template || {};
      return {
        unitPrice: fields.unitPriceUsd,
        currency: fields.currency,
        productionLeadTimeDays: fields.productionDays,
      };
    };
    const presetDefaults = productDefaults(presetSku);
    const base = mapping
      ? JSON.parse(JSON.stringify(mapping))
      : {
          id: null,
          supplierId,
          sku: presetSku || "",
          isPreferred: false,
          isActive: true,
          supplierSku: "",
          unitPrice: presetDefaults.unitPrice ?? "",
          currency: presetDefaults.currency || supplier.currencyDefault || "USD",
          productionLeadTimeDays: presetDefaults.productionLeadTimeDays ?? supplier.productionLeadTimeDaysDefault ?? 0,
          incoterm: supplier.incotermDefault || "EXW",
          paymentTermsTemplate: null,
          minOrderQty: "",
          notes: "",
          validFrom: "",
          validTo: "",
        };

    const useSupplierTerms = !Array.isArray(base.paymentTermsTemplate) || !base.paymentTermsTemplate.length;
    let useDefaultTerms = useSupplierTerms;
    const editableTerms = Array.isArray(base.paymentTermsTemplate) && base.paymentTermsTemplate.length
      ? base.paymentTermsTemplate.map(term => ({ ...term }))
      : defaultPaymentTerms();

    const termsTable = el("table", { class: "table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["Label"]),
          el("th", { class: "num" }, ["Percent"]),
          el("th", {}, ["Trigger Event"]),
          el("th", { class: "num" }, ["Offset Days"]),
          el("th", {}, [""]),
        ]),
      ]),
    ]);
    const termsBody = el("tbody");
    termsTable.append(termsBody);
    const warning = el("p", { class: "muted", style: "margin-top:6px" }, ["Summe: 100%"]);

    function renderTerms() {
      termsBody.innerHTML = "";
      editableTerms.forEach((term, idx) => {
        const row = el("tr", {}, [
          el("td", {}, [
            el("input", {
              type: "text",
              value: term.label || "",
              oninput: (e) => { term.label = e.target.value; },
            }),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              min: "0",
              max: "100",
              step: "1",
              value: term.percent ?? 0,
              oninput: (e) => { term.percent = e.target.value; updateWarning(); },
            }),
          ]),
          el("td", {}, [
            (() => {
              const select = el("select", { onchange: (e) => { term.triggerEvent = e.target.value; } });
              TRIGGER_EVENTS.forEach(evt => {
                select.append(el("option", { value: evt }, [evt]));
              });
              select.value = term.triggerEvent || "ORDER_DATE";
              return select;
            })(),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              step: "1",
              value: term.offsetDays ?? 0,
              oninput: (e) => { term.offsetDays = e.target.value; },
            }),
          ]),
          el("td", {}, [
            el("button", {
              class: "btn danger",
              type: "button",
              onclick: () => {
                editableTerms.splice(idx, 1);
                renderTerms();
                updateWarning();
              },
            }, ["✕"]),
          ]),
        ]);
        termsBody.append(row);
      });
    }

    function updateWarning() {
      const sum = editableTerms.reduce((acc, row) => acc + (clampPercent(row.percent) || 0), 0);
      if (Math.round(sum) === 100) {
        warning.textContent = "Summe: 100%";
        warning.style.color = "#0f9960";
        return true;
      }
      warning.textContent = `Summe: ${sum}% (muss 100% sein)`;
      warning.style.color = "#c23636";
      return false;
    }

    const productSelect = (() => {
      const select = el("select", { id: "mapping-sku", class: "wide-select" });
      select.append(el("option", { value: "" }, ["Bitte SKU wählen"]));
      products.forEach(prod => {
        select.append(el("option", { value: prod.sku }, [`${prod.alias || prod.sku} (${prod.sku})`]));
      });
      select.value = base.sku || "";
      return select;
    })();

    const content = el("div", {}, [
      el("label", {}, ["SKU", productSelect]),
      el("label", { style: "margin-top:12px" }, ["Supplier SKU (optional)"]),
      el("input", { type: "text", id: "mapping-supplier-sku", value: base.supplierSku || "" }),
      el("label", { style: "margin-top:12px" }, ["Unit Price"]),
      el("input", { type: "text", inputmode: "decimal", id: "mapping-unit-price", value: base.unitPrice != null ? formatDeNumber(base.unitPrice, 2, { emptyValue: "", useGrouping: false }) : "" }),
      el("label", { style: "margin-top:12px" }, ["Currency"]),
      (() => {
        const select = el("select", { id: "mapping-currency", class: "wide-select" });
        CURRENCIES.forEach(currency => select.append(el("option", { value: currency }, [currency])));
        select.value = base.currency || supplier.currencyDefault || "USD";
        return select;
      })(),
      el("label", { style: "margin-top:12px" }, ["Production Lead Time (days)"]),
      el("input", { type: "number", min: "0", step: "1", id: "mapping-lead-time", value: base.productionLeadTimeDays ?? "" }),
      el("label", { style: "margin-top:12px" }, ["Incoterm"]),
      (() => {
        const select = el("select", { id: "mapping-incoterm", class: "wide-select" });
        INCOTERMS.forEach(term => select.append(el("option", { value: term }, [term])));
        select.value = base.incoterm || supplier.incotermDefault || "EXW";
        return select;
      })(),
      el("div", { class: "grid two", style: "margin-top:12px" }, [
        el("label", { class: "inline-checkbox" }, [
          el("input", { type: "checkbox", id: "mapping-preferred", checked: Boolean(base.isPreferred) }),
          " Preferred",
        ]),
        el("label", { class: "inline-checkbox" }, [
          el("input", { type: "checkbox", id: "mapping-active", checked: base.isActive !== false }),
          " Active",
        ]),
      ]),
      el("label", { style: "margin-top:12px" }, ["Min. Order Qty (optional)"]),
      el("input", { type: "number", min: "0", step: "1", id: "mapping-min-qty", value: base.minOrderQty ?? "" }),
      el("label", { style: "margin-top:12px" }, ["Notizen (optional)"]),
      el("textarea", { id: "mapping-notes", rows: "3" }, [base.notes || ""]),
      el("div", { class: "grid two", style: "margin-top:12px" }, [
        el("label", {}, ["Gültig ab", el("input", { type: "date", id: "mapping-valid-from", value: base.validFrom || "" })]),
        el("label", {}, ["Gültig bis", el("input", { type: "date", id: "mapping-valid-to", value: base.validTo || "" })]),
      ]),
      el("h4", { style: "margin-top:16px" }, ["Payment Terms"]),
      el("label", { class: "inline-checkbox" }, [
        el("input", {
          type: "checkbox",
          id: "mapping-terms-default",
          checked: useDefaultTerms,
          onchange: (e) => {
            useDefaultTerms = e.target.checked;
            termsTable.style.display = useDefaultTerms ? "none" : "table";
            termsAdd.style.display = useDefaultTerms ? "none" : "inline-flex";
            warning.style.display = useDefaultTerms ? "none" : "block";
          },
        }),
        " Supplier Default verwenden",
      ]),
      el("div", { class: "table-wrap" }, [termsTable]),
      el("button", { class: "btn secondary", type: "button", id: "mapping-terms-add" }, ["+ Milestone"]),
      warning,
    ]);

    const termsAdd = $("#mapping-terms-add", content);
    if (useDefaultTerms) {
      termsTable.style.display = "none";
      termsAdd.style.display = "none";
      warning.style.display = "none";
    }

    const unitPriceInput = $("#mapping-unit-price", content);
    if (unitPriceInput) {
      unitPriceInput.addEventListener("blur", () => {
        const parsed = parseDeNumber(unitPriceInput.value);
        unitPriceInput.value = parsed == null ? "" : formatDeNumber(parsed, 2, { emptyValue: "", useGrouping: false });
      });
    }

    renderTerms();
    updateWarning();

    termsAdd.addEventListener("click", () => {
      editableTerms.push({ label: "Milestone", percent: 0, triggerEvent: "ORDER_DATE", offsetDays: 0 });
      renderTerms();
      updateWarning();
    });

    const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Speichern"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Abbrechen"]);
    const overlay = buildModal(mapping ? "SKU Mapping bearbeiten" : "SKU Mapping hinzufügen", content, [cancelBtn, saveBtn]);

    productSelect.addEventListener("change", (event) => {
      const skuValue = event.target.value;
      if (!skuValue) return;
      const defaults = productDefaults(skuValue);
      const unitInput = $("#mapping-unit-price", content);
      const currencySelect = $("#mapping-currency", content);
      const leadInput = $("#mapping-lead-time", content);
      if (unitInput) {
        unitInput.value = defaults.unitPrice != null ? formatNumber(defaults.unitPrice) : "";
      }
      if (currencySelect && defaults.currency) {
        currencySelect.value = defaults.currency;
      }
      if (leadInput) {
        leadInput.value = defaults.productionLeadTimeDays != null ? defaults.productionLeadTimeDays : "";
      }
    });

    cancelBtn.addEventListener("click", () => overlay.remove());
    saveBtn.addEventListener("click", () => {
      const sku = $("#mapping-sku", content).value.trim();
      const unitPrice = parseNumber($("#mapping-unit-price", content).value);
      const currency = ($("#mapping-currency", content).value || "USD").trim() || "USD";
      const leadTime = parseNumber($("#mapping-lead-time", content).value);
      const incoterm = ($("#mapping-incoterm", content).value || "EXW").trim() || "EXW";
      const preferred = Boolean($("#mapping-preferred", content).checked);
      const isActive = Boolean($("#mapping-active", content).checked);
      const minQty = parseNumber($("#mapping-min-qty", content).value);
      const validFrom = $("#mapping-valid-from", content).value || null;
      const validTo = $("#mapping-valid-to", content).value || null;
      if (!sku) {
        window.alert("SKU ist erforderlich.");
        return;
      }
      if (unitPrice == null) {
        window.alert("Unit Price ist erforderlich.");
        return;
      }
      if (!currency) {
        window.alert("Currency ist erforderlich.");
        return;
      }
      if (leadTime == null) {
        window.alert("Production Lead Time ist erforderlich.");
        return;
      }
      if (!incoterm) {
        window.alert("Incoterm ist erforderlich.");
        return;
      }
      if (!useDefaultTerms) {
        const percentOk = updateWarning();
        if (!editableTerms.length || !percentOk) {
          window.alert("Payment Terms müssen vorhanden sein und 100% ergeben.");
          return;
        }
      }
      const payload = {
        id: base.id,
        supplierId,
        sku,
        supplierSku: $("#mapping-supplier-sku", content).value.trim(),
        unitPrice,
        currency,
        productionLeadTimeDays: leadTime,
        incoterm,
        isPreferred: preferred,
        isActive,
        minOrderQty: minQty,
        notes: $("#mapping-notes", content).value.trim(),
        validFrom,
        validTo,
        paymentTermsTemplate: useDefaultTerms ? null : editableTerms,
      };
      try {
        upsertProductSupplier(payload);
        state.productSuppliers = loadState().productSuppliers || [];
        renderRows();
        overlay.remove();
      } catch (err) {
        window.alert(err?.message || "Mapping konnte nicht gespeichert werden.");
      }
    });
  }

  function openGlobalMappingModal(presetSku) {
    const supplierSelect = el("select", { id: "global-mapping-supplier", class: "wide-select" });
    supplierSelect.append(el("option", { value: "" }, ["Bitte Supplier wählen"]));
    state.suppliers.forEach(supplier => {
      const label = supplierLabelMap.get(supplier.id) || supplier.name || supplier.id;
      supplierSelect.append(el("option", { value: supplier.id }, [label]));
    });
    const content = el("div", {}, [
      el("label", {}, ["Supplier", supplierSelect]),
      el("p", { class: "muted" }, ["Wähle einen Supplier, um das Mapping anzulegen."]),
    ]);
    const proceedBtn = el("button", { class: "btn primary", type: "button" }, ["Weiter"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Abbrechen"]);
    const overlay = buildModal("SKU Mapping anlegen", content, [cancelBtn, proceedBtn]);
    cancelBtn.addEventListener("click", () => overlay.remove());
    proceedBtn.addEventListener("click", () => {
      const supplierId = supplierSelect.value;
      if (!supplierId) {
        window.alert("Supplier auswählen.");
        return;
      }
      overlay.remove();
      openMappingModal({ supplierId, presetSku });
    });
  }

  function openSupplierModal(existing) {
    const supplier = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: `sup-${Math.random().toString(36).slice(2, 9)}`,
          name: "",
          company_name: "",
          productionLeadTimeDaysDefault: 30,
          incotermDefault: "EXW",
          currencyDefault: "EUR",
          paymentTermsDefault: defaultPaymentTerms(),
          updatedAt: null,
        };

    const termsTable = el("table", { class: "table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["Label"]),
          el("th", { class: "num" }, ["Percent"]),
          el("th", {}, ["Trigger Event"]),
          el("th", { class: "num" }, ["Offset Days"]),
          el("th", {}, [""]),
        ]),
      ]),
    ]);
    const termsBody = el("tbody");
    termsTable.append(termsBody);

    const warning = el("p", { class: "muted", style: "margin-top:6px" }, ["Summe: 100%"]);

    function renderTerms() {
      termsBody.innerHTML = "";
      supplier.paymentTermsDefault.forEach((term, idx) => {
        const row = el("tr", {}, [
          el("td", {}, [
            el("input", {
              type: "text",
              value: term.label || "",
              oninput: (e) => { term.label = e.target.value; },
            }),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              min: "0",
              max: "100",
              step: "1",
              value: term.percent ?? 0,
              oninput: (e) => { term.percent = e.target.value; updateWarning(); },
            }),
          ]),
          el("td", {}, [
            (() => {
              const select = el("select", { onchange: (e) => { term.triggerEvent = e.target.value; } });
              TRIGGER_EVENTS.forEach(evt => {
                select.append(el("option", { value: evt }, [evt]));
              });
              select.value = term.triggerEvent || "ORDER_DATE";
              return select;
            })(),
          ]),
          el("td", { class: "num" }, [
            el("input", {
              type: "number",
              step: "1",
              value: term.offsetDays ?? 0,
              oninput: (e) => { term.offsetDays = e.target.value; },
            }),
          ]),
          el("td", {}, [
            el("button", {
              class: "btn danger",
              type: "button",
              onclick: () => {
                supplier.paymentTermsDefault.splice(idx, 1);
                renderTerms();
                updateWarning();
              },
            }, ["✕"]),
          ]),
        ]);
        termsBody.append(row);
      });
    }

    function updateWarning() {
      const sum = supplier.paymentTermsDefault.reduce((acc, row) => acc + (clampPercent(row.percent) || 0), 0);
      if (Math.round(sum) === 100) {
        warning.textContent = "Summe: 100%";
        warning.style.color = "#0f9960";
        return true;
      }
      warning.textContent = `Summe: ${sum}% (muss 100% sein)`;
      warning.style.color = "#c23636";
      return false;
    }

    const mappingSearch = el("input", { type: "search", placeholder: "SKU oder Alias suchen", id: "mapping-search" });
    const mappingsTable = el("table", { class: "table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["SKU Alias"]),
          el("th", {}, ["SKU"]),
          el("th", { class: "num" }, ["Unit Price"]),
          el("th", {}, ["Currency"]),
          el("th", { class: "num" }, ["Prod LT"]),
          el("th", {}, ["Incoterm"]),
          el("th", {}, ["Preferred"]),
          el("th", {}, ["Active"]),
          el("th", {}, ["Updated"]),
          el("th", {}, ["Actions"]),
        ]),
      ]),
      el("tbody", { id: "mapping-rows" }, []),
    ]);

    function renderMappings(filter = "") {
      const rows = $("#mapping-rows", mappingsTable);
      const needle = String(filter || "").trim().toLowerCase();
      const list = (state.productSuppliers || [])
        .filter(entry => entry.supplierId === supplier.id)
        .filter(entry => {
          if (!needle) return true;
          const label = `${productLabel(entry.sku)} ${entry.sku}`.toLowerCase();
          return label.includes(needle);
        })
        .sort((a, b) => (a.sku || "").localeCompare(b.sku || ""));

      if (!list.length) {
        rows.innerHTML = `<tr><td colspan="10" class="muted">Keine SKU-Mappings vorhanden.</td></tr>`;
        return;
      }

      rows.innerHTML = list.map(entry => `
        <tr data-id="${entry.id}">
          <td title="${productLabel(entry.sku)}">${productLabel(entry.sku)}</td>
          <td>${entry.sku}</td>
          <td class="num">${formatNumber(entry.unitPrice)}</td>
          <td>${entry.currency || "—"}</td>
          <td class="num">${entry.productionLeadTimeDays ?? "—"}</td>
          <td>${entry.incoterm || "—"}</td>
          <td>${entry.isPreferred ? "✓" : "—"}</td>
          <td>${entry.isActive !== false ? "✓" : "—"}</td>
          <td>${formatDate(entry.updatedAt)}</td>
          <td>
            <button class="btn secondary" data-action="edit">Edit</button>
            <button class="btn ghost" data-action="preferred">Set preferred</button>
            <button class="btn danger" data-action="delete">Delete</button>
          </td>
        </tr>
      `).join("");
    }


    const content = el("div", {}, [
      el("label", {}, ["Name"]),
      el("input", { type: "text", id: "supplier-name", value: supplier.name }),
      el("label", { style: "margin-top:12px" }, ["Company"]),
      el("input", { type: "text", id: "supplier-company", value: supplier.company_name || "" }),
      el("label", { style: "margin-top:12px" }, ["Production Lead Time (days)"]),
      el("input", { type: "number", min: "0", step: "1", id: "supplier-lt", value: supplier.productionLeadTimeDaysDefault }),
      el("label", { style: "margin-top:12px" }, ["Incoterm"]),
      (() => {
        const select = el("select", { id: "supplier-incoterm" });
        INCOTERMS.forEach(term => select.append(el("option", { value: term }, [term])));
        return select;
      })(),
      el("label", { style: "margin-top:12px" }, ["Currency"]),
      (() => {
        const select = el("select", { id: "supplier-currency" });
        CURRENCIES.forEach(currency => select.append(el("option", { value: currency }, [currency])));
        select.value = supplier.currencyDefault || "EUR";
        return select;
      })(),
      el("h4", { style: "margin-top:16px" }, ["Payment Terms"]),
      el("div", { class: "table-wrap" }, [termsTable]),
      el("button", { class: "btn secondary", type: "button", id: "terms-add" }, ["+ Milestone"]),
      warning,
      el("h4", { style: "margin-top:20px" }, ["Supplied SKUs"]),
      el("div", { class: "table-card-header" }, [
        el("span", { class: "muted" }, ["Mappings für diesen Supplier"]),
        el("button", { class: "btn secondary", type: "button", id: "mapping-add" }, ["Add SKU to Supplier"]),
      ]),
      mappingSearch,
      el("div", { class: "table-wrap" }, [mappingsTable]),
    ]);

    const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Speichern"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Abbrechen"]);
    const overlay = buildModal(existing ? "Lieferant bearbeiten" : "Lieferant hinzufügen", content, [cancelBtn, saveBtn]);

    $("#supplier-incoterm", content).value = supplier.incotermDefault || "EXW";
    renderTerms();
    updateWarning();
    renderMappings();

    $("#terms-add", content).addEventListener("click", () => {
      supplier.paymentTermsDefault.push({ label: "Milestone", percent: 0, triggerEvent: "ORDER_DATE", offsetDays: 0 });
      renderTerms();
      updateWarning();
    });

    $("#mapping-add", content).addEventListener("click", () => openMappingModal({ supplierId: supplier.id }));
    mappingSearch.addEventListener("input", (e) => renderMappings(e.target.value));
    mappingsTable.addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-id]");
      if (!row) return;
      const action = e.target.closest("button")?.dataset?.action;
      const entry = state.productSuppliers.find(item => item.id === row.dataset.id);
      if (!entry) return;
      if (action === "edit") {
        openMappingModal({ supplierId: supplier.id, mapping: entry });
      } else if (action === "preferred") {
        setPreferredProductSupplier(entry.id);
        state.productSuppliers = loadState().productSuppliers || [];
        renderMappings(mappingSearch.value);
      } else if (action === "delete") {
        const confirmed = window.confirm("Mapping wirklich löschen?");
        if (!confirmed) return;
        deleteProductSupplier(entry.id);
        state.productSuppliers = loadState().productSuppliers || [];
        renderMappings(mappingSearch.value);
      }
    });

    cancelBtn.addEventListener("click", () => overlay.remove());
    saveBtn.addEventListener("click", () => {
      const name = $("#supplier-name", content).value.trim();
      const companyName = $("#supplier-company", content).value.trim();
      const lt = parseNumber($("#supplier-lt", content).value);
      const currency = ($("#supplier-currency", content).value || "EUR").trim() || "EUR";
      const percentOk = updateWarning();
      if (!name) {
        window.alert("Name ist erforderlich.");
        return;
      }
      if (!uniqueName(state.suppliers, name, supplier.id)) {
        window.alert("Name muss eindeutig sein.");
        return;
      }
      if (lt == null || lt < 0) {
        window.alert("Production Lead Time muss ≥ 0 sein.");
        return;
      }
      if (!percentOk) {
        window.alert("Payment Terms müssen insgesamt 100% ergeben.");
        return;
      }
      supplier.name = name;
      supplier.company_name = companyName;
      supplier.productionLeadTimeDaysDefault = lt;
      supplier.incotermDefault = $("#supplier-incoterm", content).value;
      supplier.currencyDefault = currency;
      supplier.paymentTermsDefault = supplier.paymentTermsDefault.map(term => ({
        label: term.label || "Milestone",
        percent: clampPercent(term.percent) || 0,
        triggerEvent: TRIGGER_EVENTS.includes(term.triggerEvent) ? term.triggerEvent : "ORDER_DATE",
        offsetDays: parseNumber(term.offsetDays) || 0,
      }));
      supplier.updatedAt = new Date().toISOString();
      const idx = state.suppliers.findIndex(item => item.id === supplier.id);
      if (idx >= 0) state.suppliers[idx] = supplier;
      else state.suppliers.push(supplier);
      saveState(state);
      renderRows();
      overlay.remove();
    });
  }

  $("#supplier-add", root).addEventListener("click", () => openSupplierModal(null));

  tableHost.addEventListener("click", (ev) => {
    const row = ev.target.closest("tr[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    const supplier = state.suppliers.find(item => item.id === id);
    if (!supplier) return;
    const action = ev.target.closest("button")?.dataset?.action;
    if (action === "edit") {
      openSupplierModal(supplier);
    } else if (action === "delete") {
      const confirmed = window.confirm(`Lieferant "${supplier.name}" löschen?`);
      if (!confirmed) return;
      state.suppliers = state.suppliers.filter(item => item.id !== id);
      saveState(state);
      renderRows();
    }
  });

  renderRows();

  const focusRaw = sessionStorage.getItem("healthFocus");
  if (focusRaw) {
    try {
      const focus = JSON.parse(focusRaw);
      if (focus?.tab === "suppliers" && focus.supplierId) {
        const target = state.suppliers.find(item => item.id === focus.supplierId);
        if (target) openSupplierModal(target);
      } else if (focus?.tab === "suppliers" && focus.sku) {
        openGlobalMappingModal(focus.sku);
      }
    } catch (err) {
      // ignore
    }
    sessionStorage.removeItem("healthFocus");
  }
}

export default { render };

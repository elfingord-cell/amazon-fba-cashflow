import {
  loadState,
  saveState,
  getProductsSnapshot,
} from "../data/storageLocal.js";
import { createDataTable } from "./components/dataTable.js";
import { buildSupplierLabelMap } from "./utils/supplierLabels.js";
import { parseDeNumber, validateSuppliers } from "../lib/dataHealth.js";
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
  const products = getProductsSnapshot();
  const supplierLabelMap = buildSupplierLabelMap(state, products);
  let supplierIssuesById = new Map();

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
      { key: "lead", label: "Default Production Lead Time", className: "num" },
      { key: "incoterm", label: "Incoterm" },
      { key: "currency", label: "Currency" },
      { key: "terms", label: "Payment Terms" },
      { key: "updated", label: "Updated" },
      { key: "actions", label: "Actions" },
    ];
    tableHost.innerHTML = "";
    tableHost.append(createDataTable({
      className: "suppliers-table",
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
            return el("div", { class: "table-actions ui-table-actions-nowrap" }, [
              el("button", { class: "btn sm", type: "button", dataset: { action: "edit" } }, ["Bearbeiten"]),
              el("button", { class: "btn sm danger", type: "button", dataset: { action: "delete" } }, ["Löschen"]),
            ]);
          default:
            return "—";
        }
      },
    }));
  }

  function openSupplierModal(existing) {
    const settings = state.settings || {};
    const supplier = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: `sup-${Math.random().toString(36).slice(2, 9)}`,
          name: "",
          company_name: "",
          productionLeadTimeDaysDefault: 30,
          incotermDefault: "EXW",
          currencyDefault: settings.defaultCurrency || "EUR",
          paymentTermsDefault: defaultPaymentTerms(),
          updatedAt: null,
        };

    const termsTable = el("table", { class: "table ui-table-standard" }, [
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

    const content = el("div", {}, [
      el("label", {}, ["Name"]),
      el("input", { type: "text", id: "supplier-name", value: supplier.name }),
      el("label", { style: "margin-top:12px" }, ["Company"]),
      el("input", { type: "text", id: "supplier-company", value: supplier.company_name || "" }),
      el("label", { style: "margin-top:12px" }, ["Default Production Lead Time"]),
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
        select.value = supplier.currencyDefault || settings.defaultCurrency || "EUR";
        return select;
      })(),
      el("h4", { style: "margin-top:16px" }, ["Payment Terms"]),
      el("div", { class: "table-wrap ui-table-shell ui-scroll-host" }, [termsTable]),
      el("button", { class: "btn secondary", type: "button", id: "terms-add" }, ["+ Milestone"]),
      warning,
      el("h4", { style: "margin-top:20px" }, ["Produkte & Preise"]),
      el("p", { class: "muted" }, ["SKU-Mappings wurden entfernt. Preise und Lieferanten sind jetzt direkt im Produktstamm gepflegt."]),
    ]);

    const saveBtn = el("button", { class: "btn primary", type: "button" }, ["Speichern"]);
    const cancelBtn = el("button", { class: "btn", type: "button" }, ["Abbrechen"]);
    const overlay = buildModal(existing ? "Lieferant bearbeiten" : "Lieferant hinzufügen", content, [cancelBtn, saveBtn]);

    $("#supplier-incoterm", content).value = supplier.incotermDefault || "EXW";
    renderTerms();
    updateWarning();
    $("#terms-add", content).addEventListener("click", () => {
      supplier.paymentTermsDefault.push({ label: "Milestone", percent: 0, triggerEvent: "ORDER_DATE", offsetDays: 0 });
      renderTerms();
      updateWarning();
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
        location.hash = "#produkte";
      }
    } catch (err) {
      // ignore
    }
    sessionStorage.removeItem("healthFocus");
  }
}

export default { render };

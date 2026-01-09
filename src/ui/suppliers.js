import { loadState, saveState } from "../data/storageLocal.js";

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
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

  root.innerHTML = `
    <section class="card">
      <h2>Suppliers</h2>
      <div class="table-card-header">
        <span class="muted">Lieferanten-Stammdaten</span>
        <button class="btn primary" id="supplier-add">Lieferant hinzufügen</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Supplier Name</th>
              <th class="num">Production LT (days)</th>
              <th>Incoterm</th>
              <th>Currency</th>
              <th>Payment Terms</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="supplier-rows"></tbody>
        </table>
      </div>
    </section>
  `;

  const rowsEl = $("#supplier-rows", root);

  function renderRows() {
    if (!state.suppliers.length) {
      rowsEl.innerHTML = `<tr><td colspan="7" class="muted">Keine Lieferanten vorhanden.</td></tr>`;
      return;
    }
    rowsEl.innerHTML = state.suppliers
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map(supplier => `
        <tr data-id="${supplier.id}">
          <td>${supplier.name}</td>
          <td class="num">${supplier.productionLeadTimeDaysDefault}</td>
          <td>${supplier.incotermDefault}</td>
          <td>${supplier.currencyDefault || "EUR"}</td>
          <td>${formatTermsSummary(supplier.paymentTermsDefault)}</td>
          <td>${supplier.updatedAt ? new Date(supplier.updatedAt).toLocaleDateString("de-DE") : "—"}</td>
          <td>
            <button class="btn" data-action="edit">Bearbeiten</button>
            <button class="btn danger" data-action="delete">Löschen</button>
          </td>
        </tr>
      `)
      .join("");
  }

  function openSupplierModal(existing) {
    const supplier = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: `sup-${Math.random().toString(36).slice(2, 9)}`,
          name: "",
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

    const content = el("div", {}, [
      el("label", {}, ["Name"]),
      el("input", { type: "text", id: "supplier-name", value: supplier.name }),
      el("label", { style: "margin-top:12px" }, ["Production Lead Time (days)"]),
      el("input", { type: "number", min: "0", step: "1", id: "supplier-lt", value: supplier.productionLeadTimeDaysDefault }),
      el("label", { style: "margin-top:12px" }, ["Incoterm"]),
      el("select", { id: "supplier-incoterm" }, [
        el("option", { value: "EXW" }, ["EXW"]),
        el("option", { value: "DDP" }, ["DDP"]),
      ]),
      el("label", { style: "margin-top:12px" }, ["Currency"]),
      el("input", { type: "text", id: "supplier-currency", value: supplier.currencyDefault || "EUR" }),
      el("h4", { style: "margin-top:16px" }, ["Payment Terms"]),
      el("div", { class: "table-wrap" }, [termsTable]),
      el("button", { class: "btn secondary", type: "button", id: "terms-add" }, ["+ Milestone"]),
      warning,
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

  rowsEl.addEventListener("click", (ev) => {
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
}

export default { render };

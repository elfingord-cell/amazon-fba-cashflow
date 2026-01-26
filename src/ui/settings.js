import { loadState, saveState } from "../data/storageLocal.js";
import { formatDeNumber, parseDeNumber, validateAll, validateSettings } from "../lib/dataHealth.js";
import { goToIssue } from "./dataHealthUi.js";

const CURRENCIES = ["EUR", "USD", "CNY"];

function $(sel, root = document) { return root.querySelector(sel); }

function clampNonNegative(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatRate(value) {
  const parsed = parseDeNumber(value);
  if (parsed == null) return "";
  return formatDeNumber(parsed, 2, { minimumFractionDigits: 2, maximumFractionDigits: 4, emptyValue: "", useGrouping: false });
}

function updateSettings(state, patch) {
  state.settings = state.settings || {};
  state.settings.transportLeadTimesDays = state.settings.transportLeadTimesDays || { air: 10, rail: 25, sea: 45 };
  Object.assign(state.settings.transportLeadTimesDays, patch.transportLeadTimesDays || {});
  if (typeof patch.defaultBufferDays !== "undefined") {
    state.settings.defaultBufferDays = patch.defaultBufferDays;
  }
  if (typeof patch.defaultCurrency !== "undefined") {
    state.settings.defaultCurrency = patch.defaultCurrency;
  }
  if (typeof patch.fxRate !== "undefined") {
    state.settings.fxRate = patch.fxRate;
  }
  state.settings.lastUpdatedAt = new Date().toISOString();
}

export function render(root) {
  const state = loadState();
  const settings = state.settings || {};
  const lead = settings.transportLeadTimesDays || { air: 10, rail: 25, sea: 45 };
  const errors = { air: "", rail: "", sea: "", buffer: "", fxRate: "" };

  root.innerHTML = `
    <section class="card">
      <h2>Settings</h2>
      <div class="table-card-header">
        <span class="muted">Eigenschaften</span>
        <button class="btn primary" id="settings-save">Speichern</button>
      </div>
    </section>

    <section class="card">
      <h3>Transport Lead Times (days)</h3>
      <div class="grid three">
        <label>
          Air (days)
          <input id="lead-air" type="number" min="0" step="1" value="${lead.air ?? 10}">
          <small class="form-error" id="lead-air-error"></small>
          <small class="health-hint" id="lead-air-health"></small>
        </label>
        <label>
          Rail (days)
          <input id="lead-rail" type="number" min="0" step="1" value="${lead.rail ?? 25}">
          <small class="form-error" id="lead-rail-error"></small>
          <small class="health-hint" id="lead-rail-health"></small>
        </label>
        <label>
          Sea (days)
          <input id="lead-sea" type="number" min="0" step="1" value="${lead.sea ?? 45}">
          <small class="form-error" id="lead-sea-error"></small>
          <small class="health-hint" id="lead-sea-health"></small>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>Defaults</h3>
      <div class="grid two">
        <label>
          Buffer days
          <input id="default-buffer" type="number" min="0" step="1" value="${settings.defaultBufferDays ?? 0}">
          <small class="form-error" id="buffer-error"></small>
        </label>
        <label>
          Currency
          <select id="default-currency">
            ${CURRENCIES.map(currency => `<option value="${currency}">${currency}</option>`).join("")}
          </select>
          <small class="health-hint" id="default-currency-health"></small>
        </label>
      </div>
      <div class="grid two" style="margin-top: 12px;">
        <label>
          FX-Kurs EUR/USD
          <input id="default-fx-rate" type="text" inputmode="decimal" placeholder="z. B. 1,08" value="${formatRate(settings.fxRate)}">
          <small class="form-error" id="fx-rate-error"></small>
          <small class="health-hint" id="fx-rate-health"></small>
        </label>
      </div>
    </section>

    <section class="card" id="settings-categories">
      <h3>Produktkategorien</h3>
      <div class="table-card-header">
        <span class="muted">Kategorien verwalten</span>
        <div class="category-controls">
          <input id="category-name" type="text" placeholder="Neue Kategorie" />
          <button class="btn secondary" id="category-add">Hinzufügen</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table" id="category-table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="num">Sortierung</th>
              <th class="num">Produkte</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="card" id="settings-health">
      <h3>Data Health</h3>
      <p class="muted">Schnell-Checks für fehlende Stammdaten und Defaults.</p>
      <div class="health-list" id="health-list"></div>
    </section>
  `;
  $("#default-currency", root).value = settings.defaultCurrency || "EUR";

  function renderHealthHints() {
    const issues = validateSettings(state.settings || {});
    const issueByField = new Map();
    issues.forEach(issue => issueByField.set(issue.field, issue));
    const mapping = [
      { field: "transportLeadTimesDays.air", id: "#lead-air-health" },
      { field: "transportLeadTimesDays.rail", id: "#lead-rail-health" },
      { field: "transportLeadTimesDays.sea", id: "#lead-sea-health" },
      { field: "defaultCurrency", id: "#default-currency-health" },
      { field: "fxRate", id: "#fx-rate-health" },
    ];
    mapping.forEach(({ field, id }) => {
      const el = $(id, root);
      if (!el) return;
      el.textContent = issueByField.get(field)?.message || "";
    });
  }

  function renderHealth() {
    const list = $("#health-list", root);
    const { issues } = validateAll({
      settings: state.settings,
      products: state.products,
      suppliers: state.suppliers,
    });
    if (!issues.length) {
      list.innerHTML = `<p class="muted">Keine Issues gefunden.</p>`;
      return;
    }
    list.innerHTML = issues
      .map(issue => `
        <div class="health-item">
          <span>${issue.message}</span>
          <button class="btn secondary" data-action="fix" data-issue="${issue.id}">Go to</button>
        </div>
      `)
      .join("");
  }

  function validate() {
    errors.air = "";
    errors.rail = "";
    errors.sea = "";
    errors.buffer = "";
    errors.fxRate = "";
    const air = clampNonNegative($("#lead-air", root).value);
    const rail = clampNonNegative($("#lead-rail", root).value);
    const sea = clampNonNegative($("#lead-sea", root).value);
    const buffer = clampNonNegative($("#default-buffer", root).value);
    const fxRate = parseDeNumber($("#default-fx-rate", root).value);
    if (air == null) errors.air = "Wert muss ≥ 0 sein.";
    if (rail == null) errors.rail = "Wert muss ≥ 0 sein.";
    if (sea == null) errors.sea = "Wert muss ≥ 0 sein.";
    if (buffer == null) errors.buffer = "Wert muss ≥ 0 sein.";
    if (fxRate == null || fxRate <= 0) errors.fxRate = "Wert muss > 0 sein.";
    $("#lead-air-error", root).textContent = errors.air;
    $("#lead-rail-error", root).textContent = errors.rail;
    $("#lead-sea-error", root).textContent = errors.sea;
    $("#buffer-error", root).textContent = errors.buffer;
    $("#fx-rate-error", root).textContent = errors.fxRate;
    return {
      air,
      rail,
      sea,
      buffer,
      fxRate,
      ok: !errors.air && !errors.rail && !errors.sea && !errors.buffer && !errors.fxRate
    };
  }

  $("#settings-save", root).addEventListener("click", () => {
    const { air, rail, sea, buffer, fxRate, ok } = validate();
    if (!ok) return;
    const patch = {
      transportLeadTimesDays: { air, rail, sea },
      defaultBufferDays: buffer,
      defaultCurrency: ($("#default-currency", root).value || "EUR").trim() || "EUR",
      fxRate: formatRate(fxRate),
    };
    updateSettings(state, patch);
    saveState(state);
    renderHealthHints();
    renderHealth();
  });

  root.querySelectorAll("input[type=number]").forEach((input) => {
    input.addEventListener("blur", validate);
  });
  const fxInput = $("#default-fx-rate", root);
  if (fxInput) {
    fxInput.addEventListener("blur", () => {
      const next = parseDeNumber(fxInput.value);
      fxInput.value = next ? formatRate(next) : "";
      validate();
    });
  }

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action='fix']");
    if (!btn) return;
    const issueId = btn.dataset.issue;
    const { issues } = validateAll({
      settings: state.settings,
      products: state.products,
      suppliers: state.suppliers,
    });
    const issue = issues.find(item => item.id === issueId);
    if (issue) goToIssue(issue);
  });

  renderHealthHints();
  renderHealth();

  const focusRaw = sessionStorage.getItem("healthFocus");
  if (focusRaw) {
    try {
      const focus = JSON.parse(focusRaw);
      if (focus?.tab === "settings" && focus.field) {
        const fieldMap = {
          fxRate: "#default-fx-rate",
          defaultCurrency: "#default-currency",
          "transportLeadTimesDays.air": "#lead-air",
          "transportLeadTimesDays.rail": "#lead-rail",
          "transportLeadTimesDays.sea": "#lead-sea",
        };
        const target = $(fieldMap[focus.field], root);
        if (target) {
          target.focus();
          target.scrollIntoView({ block: "center" });
        }
      }
    } catch (err) {
      // ignore
    }
    sessionStorage.removeItem("healthFocus");
  }

  const categoryTable = $("#category-table", root);
  const categoryNameInput = $("#category-name", root);
  const categoryAddBtn = $("#category-add", root);

  function categorySort(a, b) {
    const orderA = Number(a.sortOrder ?? 0);
    const orderB = Number(b.sortOrder ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }

  function renderCategories() {
    const body = categoryTable.querySelector("tbody");
    const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
    const counts = new Map();
    (state.products || []).forEach(product => {
      const key = product.categoryId || "";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (!categories.length) {
      body.innerHTML = `<tr><td colspan="4" class="muted">Keine Kategorien vorhanden.</td></tr>`;
      return;
    }
    body.innerHTML = categories
      .slice()
      .sort(categorySort)
      .map(category => `
        <tr data-id="${category.id}">
          <td><input type="text" data-action="name" value="${category.name || ""}" /></td>
          <td class="num"><input type="number" data-action="order" value="${category.sortOrder ?? 0}" /></td>
          <td class="num">${counts.get(category.id) || 0}</td>
          <td><button class="btn danger" type="button" data-action="delete">Löschen</button></td>
        </tr>
      `).join("");
  }

  function persistCategories() {
    saveState(state);
    renderCategories();
  }

  if (categoryAddBtn) {
    categoryAddBtn.addEventListener("click", () => {
      const name = categoryNameInput.value.trim();
      if (!name) {
        window.alert("Name ist erforderlich.");
        return;
      }
      const exists = (state.productCategories || []).some(cat => String(cat.name || "").trim().toLowerCase() === name.toLowerCase());
      if (exists) {
        window.alert("Kategorie existiert bereits.");
        return;
      }
      const now = new Date().toISOString();
      state.productCategories = state.productCategories || [];
      state.productCategories.push({
        id: `cat-${Math.random().toString(36).slice(2, 9)}`,
        name,
        sortOrder: state.productCategories.length,
        createdAt: now,
        updatedAt: now,
      });
      categoryNameInput.value = "";
      persistCategories();
    });
  }

  if (categoryTable) {
    categoryTable.addEventListener("change", (event) => {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      const category = (state.productCategories || []).find(cat => cat.id === row.dataset.id);
      if (!category) return;
      if (event.target.dataset.action === "name") {
        const nextName = event.target.value.trim();
        if (!nextName) {
          event.target.value = category.name || "";
          return;
        }
        category.name = nextName;
        category.updatedAt = new Date().toISOString();
        persistCategories();
      }
      if (event.target.dataset.action === "order") {
        const nextOrder = Number(event.target.value || 0);
        category.sortOrder = Number.isFinite(nextOrder) ? nextOrder : 0;
        category.updatedAt = new Date().toISOString();
        persistCategories();
      }
    });
    categoryTable.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      if (event.target.dataset.action !== "delete") return;
      const categoryId = row.dataset.id;
      const confirmed = window.confirm("Kategorie wirklich löschen?");
      if (!confirmed) return;
      state.productCategories = (state.productCategories || []).filter(cat => cat.id !== categoryId);
      state.products = (state.products || []).map(product => {
        if (product.categoryId !== categoryId) return product;
        return { ...product, categoryId: null };
      });
      persistCategories();
    });
  }

  renderCategories();
}

export default { render };

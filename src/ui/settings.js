import { loadState, saveState } from "../data/storageLocal.js";

const CURRENCIES = ["EUR", "USD", "CNY"];

function $(sel, root = document) { return root.querySelector(sel); }

function clampNonNegative(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parseRate(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\s+/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let cleaned = raw;
  if (decimalIndex >= 0) {
    const intPart = raw.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fracPart = raw.slice(decimalIndex + 1).replace(/[.,]/g, "");
    cleaned = `${intPart}.${fracPart}`;
  } else {
    cleaned = raw.replace(/[.,]/g, "");
  }
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function formatRate(value) {
  const parsed = parseRate(value);
  if (parsed == null) return "";
  return parsed.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
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
        </label>
        <label>
          Rail (days)
          <input id="lead-rail" type="number" min="0" step="1" value="${lead.rail ?? 25}">
          <small class="form-error" id="lead-rail-error"></small>
        </label>
        <label>
          Sea (days)
          <input id="lead-sea" type="number" min="0" step="1" value="${lead.sea ?? 45}">
          <small class="form-error" id="lead-sea-error"></small>
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
        </label>
      </div>
      <div class="grid two" style="margin-top: 12px;">
        <label>
          FX-Kurs EUR/USD
          <input id="default-fx-rate" type="text" inputmode="decimal" placeholder="z. B. 1,08" value="${formatRate(settings.fxRate)}">
          <small class="form-error" id="fx-rate-error"></small>
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

  function computeHealth() {
    const mappings = Array.isArray(state.productSuppliers) ? state.productSuppliers : [];
    const products = Array.isArray(state.products) ? state.products : [];
    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    const supplierById = new Map(suppliers.map(s => [s.id, s]));

    const missingMappings = products.filter(prod => {
      const sku = String(prod.sku || "").trim().toLowerCase();
      if (!sku) return false;
      if (String(prod.supplierId || "").trim()) return false;
      return !mappings.some(entry => String(entry.sku || "").trim().toLowerCase() === sku && entry.isActive !== false);
    });

    const preferredBySku = new Map();
    mappings.forEach(entry => {
      if (!entry.isPreferred) return;
      const sku = String(entry.sku || "").trim().toLowerCase();
      preferredBySku.set(sku, (preferredBySku.get(sku) || 0) + 1);
    });
    const multiplePreferred = [...preferredBySku.entries()].filter(([, count]) => count > 1);

    const incompleteMappings = mappings.filter(entry => {
      const supplier = supplierById.get(entry.supplierId);
      const hasTerms = Array.isArray(entry.paymentTermsTemplate) && entry.paymentTermsTemplate.length
        ? true
        : Boolean(supplier?.paymentTermsDefault?.length);
      return entry.unitPrice == null || !entry.currency || entry.productionLeadTimeDays == null || !entry.incoterm || !hasTerms;
    });

    const productsMissingCosts = products.filter(prod => {
      const templateFields = prod.template?.fields || {};
      const hasFreight = prod.freight != null || prod.freightAir != null || prod.freightSea != null || prod.freightRail != null || templateFields.freightEur != null;
      const hasDuty = prod.dutyRatePct != null || templateFields.dutyPct != null;
      const hasEust = prod.eustRatePct != null || templateFields.vatImportPct != null;
      return !hasFreight || !hasDuty || !hasEust;
    });

    const settingsMissing = !settings.fxRate || !settings.defaultCurrency;

    return {
      missingMappings,
      multiplePreferred,
      incompleteMappings,
      productsMissingCosts,
      settingsMissing,
    };
  }

  function renderHealth() {
    const list = $("#health-list", root);
    const health = computeHealth();
    const items = [];

    items.push({
      label: `SKU ohne Supplier-Mapping (${health.missingMappings.length})`,
      count: health.missingMappings.length,
      tab: "suppliers",
      sku: health.missingMappings[0]?.sku,
    });
    items.push({
      label: `Mehrere Preferred Supplier für SKU (${health.multiplePreferred.length})`,
      count: health.multiplePreferred.length,
      tab: "suppliers",
    });
    items.push({
      label: `Mappings ohne Pflichtfelder (${health.incompleteMappings.length})`,
      count: health.incompleteMappings.length,
      tab: "suppliers",
    });
    items.push({
      label: `Produkte ohne Pflicht-Produktkosten (${health.productsMissingCosts.length})`,
      count: health.productsMissingCosts.length,
      tab: "produkte",
      sku: health.productsMissingCosts[0]?.sku,
    });
    items.push({
      label: `Settings ohne Exchange Rate/Currency (${health.settingsMissing ? 1 : 0})`,
      count: health.settingsMissing ? 1 : 0,
      tab: "settings",
    });

    list.innerHTML = items.map(item => `
      <div class="health-item">
        <span>${item.label}</span>
        ${item.count ? `<button class="btn secondary" data-action="fix" data-tab="${item.tab}" data-sku="${item.sku || ""}">Fix now</button>` : `<span class="muted">OK</span>`}
      </div>
    `).join("");
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
    const fxRate = parseRate($("#default-fx-rate", root).value);
    if (air == null) errors.air = "Wert muss ≥ 0 sein.";
    if (rail == null) errors.rail = "Wert muss ≥ 0 sein.";
    if (sea == null) errors.sea = "Wert muss ≥ 0 sein.";
    if (buffer == null) errors.buffer = "Wert muss ≥ 0 sein.";
    if (fxRate == null) errors.fxRate = "Wert muss > 0 sein.";
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
    renderHealth();
  });

  root.querySelectorAll("input[type=number]").forEach((input) => {
    input.addEventListener("blur", validate);
  });
  const fxInput = $("#default-fx-rate", root);
  if (fxInput) {
    fxInput.addEventListener("blur", () => {
      const next = parseRate(fxInput.value);
      fxInput.value = next ? formatRate(next) : "";
      validate();
    });
  }

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action='fix']");
    if (!btn) return;
    const tab = btn.dataset.tab;
    const sku = btn.dataset.sku;
    sessionStorage.setItem("healthFocus", JSON.stringify({ tab, sku }));
    if (tab === "produkte") {
      location.hash = "#produkte";
    } else if (tab === "suppliers") {
      location.hash = "#suppliers";
    } else {
      location.hash = "#settings";
    }
  });

  renderHealth();

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

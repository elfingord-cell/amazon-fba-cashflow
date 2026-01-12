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
  const cleaned = String(value).trim().replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
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
  `;
  $("#default-currency", root).value = settings.defaultCurrency || "EUR";

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
}

export default { render };

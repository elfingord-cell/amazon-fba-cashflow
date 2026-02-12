// Eingaben-Tab mit deutschen Formaten und zusätzlichen Tabellen für Extras, Fixkosten und Dividenden
import { loadState, saveState } from "../data/storageLocal.js";
import { expandFixcostInstances } from "../domain/cashflow.js";

function $(sel, root = document) { return root.querySelector(sel); }
function ensureArray(v) { return Array.isArray(v) ? v : []; }

function parseDE(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[€]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseNumberDE(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized = cleaned;
  if (decimalIndex >= 0) {
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = `${integer}.${fraction}`;
  } else {
    normalized = cleaned.replace(/[.,]/g, "");
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function fmtCurrency(value) {
  return Number(parseDE(value) || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNumber0(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return Math.round(Number(value)).toLocaleString("de-DE", { maximumFractionDigits: 0 });
}

function fmtPercent(value) {
  const num = parseDE(value);
  return Number(num || 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function toIsoDate(input) {
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const match = input.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function toDisplayDate(iso) {
  if (!iso) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function incMonth(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return ym;
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  const ny = d.getFullYear();
  const nm = String(d.getMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

function addMonths(ym, delta) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return ym;
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, (m - 1) + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyBuckets(startMonth, endMonth) {
  if (!startMonth || !endMonth) return [];
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) return [];
  const [startY, startM] = startMonth.split("-").map(Number);
  const [endY, endM] = endMonth.split("-").map(Number);
  const startIndex = startY * 12 + (startM - 1);
  const endIndex = endY * 12 + (endM - 1);
  if (endIndex < startIndex) return [];
  const months = [];
  for (let idx = startIndex; idx <= endIndex; idx += 1) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

function getRangeOptions(months) {
  const options = [];
  [12, 18, 24].forEach(count => {
    if (months.length >= count) {
      options.push({ value: `next${count}`, label: `Nächste ${count}` });
    }
  });
  if (months.length) options.push({ value: "all", label: "Alle" });
  return options;
}

function applyRange(months, range) {
  if (!months.length) return [];
  if (range === "all") return months.slice();
  const count = Number(String(range).replace("next", "")) || 0;
  if (!Number.isFinite(count) || count <= 0) return months.slice();
  return months.slice(0, count);
}

const monthlyActualsView = {
  range: "next12",
};

function ensureMonthFromDate(dateIso) {
  if (!dateIso) return "";
  if (/^\d{4}-\d{2}$/.test(dateIso)) return dateIso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso.slice(0, 7);
  return "";
}

export async function render(root) {
  const state = loadState();
  state.incomings = ensureArray(state.incomings);
  state.extras = ensureArray(state.extras);
  state.dividends = ensureArray(state.dividends);
  state.actuals = ensureArray(state.actuals);
  state.monthlyActuals = state.monthlyActuals && typeof state.monthlyActuals === "object" ? state.monthlyActuals : {};
  state.settings = state.settings || {};

  root.innerHTML = `
    <section class="card">
      <div class="ui-page-head">
        <div>
          <h2>Eingaben</h2>
        </div>
      </div>
      <div class="grid two">
        <label>
          Opening Balance (€)
          <input id="opening" inputmode="decimal" value="${fmtCurrency(state.settings.openingBalance || "0")}" aria-describedby="opening-help">
          <small id="opening-help" class="muted">Kommazahlen erlaubt (z. B. 150.000,00).</small>
        </label>
        <label>
          Startmonat
          <input id="startMonth" type="month" value="${state.settings.startMonth || "2025-01"}" aria-describedby="start-help">
          <small id="start-help" class="muted">Planungsbeginn, bestimmt die Zeithorizont-Achse.</small>
        </label>
      </div>
    </section>

    <section class="card">
      <h3>Umsätze × Payout</h3>
      <p class="muted">Optional können Umsätze aus der <a href="#forecast">Absatzprognose</a> übernommen werden.</p>
      <div class="income-legend">
        <span class="income-source-tag income-source-forecast">Prognose</span>
        <span class="income-source-tag income-source-manual">Manuell</span>
      </div>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Umsatz (€)</th><th>Payout (%)</th><th>Quelle</th><th></th></tr></thead>
          <tbody id="income-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="income-add">+ Monat hinzufügen</button>
    </section>

    <section class="card">
      <h3>Extras (Ein-/Auszahlungen)</h3>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Datum (TT.MM.JJJJ)</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
          <tbody id="extras-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="extra-add">+ Extra hinzufügen</button>
    </section>

    <section class="card">
      <h3>Fixkosten (Übersicht)</h3>
      <p class="muted">Pflege und Detailbearbeitung im Tab <strong>Fixkosten</strong>. Übersicht der geplanten Zahlungen im aktuellen Planungshorizont.</p>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Summe (€)</th><th>Bezahlt (€)</th><th>Offen (€)</th></tr></thead>
          <tbody id="fix-summary-rows"></tbody>
        </table>
      </div>
      <a class="btn secondary" href="#fixkosten">Zum Fixkosten-Tab</a>
    </section>

    <section class="card">
      <h3>Dividenden & KapESt</h3>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead><tr><th>Monat</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
          <tbody id="dividend-rows"></tbody>
        </table>
      </div>
      <button class="btn" id="dividend-add">+ Dividenden-Zeile</button>
    </section>

    <section class="card">
      <div class="monthly-actuals-header">
        <div>
          <h3>Monats-Realdaten</h3>
          <p class="muted">Erfasse Ist-Umsätze, Auszahlungsquote und Kontostand je Monat. Werte werden im Dashboard für die Planung genutzt.</p>
        </div>
        <div class="monthly-actuals-controls">
          <label class="dashboard-range">
            <span>Monatsbereich</span>
            <select id="monthly-actuals-range"></select>
          </label>
          <div class="monthly-actuals-actions">
            <span class="muted" id="monthly-actuals-changes">Keine Änderungen</span>
            <button class="btn secondary" type="button" id="monthly-actuals-discard" disabled>Änderungen verwerfen</button>
            <button class="btn" type="button" id="monthly-actuals-save" disabled>Änderungen speichern</button>
          </div>
        </div>
      </div>
      <div class="table-wrap ui-table-shell ui-scroll-host">
        <table class="table ui-table-standard">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Realer Umsatz (€)</th>
              <th>Reale Auszahlungsquote (%)</th>
              <th>Realer Kontostand Monatsende (€)</th>
            </tr>
          </thead>
          <tbody id="monthly-actuals-rows"></tbody>
        </table>
      </div>
    </section>
  `;

  const incomeRows = $("#income-rows", root);
  const extrasRows = $("#extras-rows", root);
  const fixSummaryRows = $("#fix-summary-rows", root);
  const dividendRows = $("#dividend-rows", root);
  const monthlyActualsRows = $("#monthly-actuals-rows", root);
  const monthlyActualsRange = $("#monthly-actuals-range", root);
  const monthlyActualsChanges = $("#monthly-actuals-changes", root);
  const monthlyActualsDiscard = $("#monthly-actuals-discard", root);
  const monthlyActualsSave = $("#monthly-actuals-save", root);

  function renderIncomes() {
    if (!state.incomings.length) {
      incomeRows.innerHTML = `<tr><td colspan="5" class="muted">Keine Einträge</td></tr>`;
      return;
    }
    incomeRows.innerHTML = state.incomings
      .map((row, idx) => {
        const sourceKey = row.source === "forecast" ? "forecast" : "manual";
        const sourceLabel = sourceKey === "forecast" ? "Prognose" : "Manuell";
        const sourceClass = sourceKey === "forecast" ? "income-source-forecast" : "income-source-manual";
        return `
          <tr data-idx="${idx}" data-month="${row.month || ""}" class="${sourceClass}">
            <td><input type="month" data-field="month" value="${row.month || ""}"></td>
            <td><input type="text" data-field="revenueEur" inputmode="decimal" value="${fmtCurrency(row.revenueEur)}"></td>
            <td><input type="text" data-field="payoutPct" inputmode="decimal" value="${fmtPercent(row.payoutPct)}"></td>
            <td><span class="income-source-tag ${sourceClass}">${sourceLabel}</span></td>
            <td><button class="btn danger" data-remove="${idx}">Entfernen</button></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderExtras() {
    if (!state.extras.length) {
      extrasRows.innerHTML = `<tr><td colspan="4" class="muted">Keine Einträge</td></tr>`;
      return;
    }
    extrasRows.innerHTML = state.extras
      .map((row, idx) => {
        const iso = row.date || (row.month ? `${row.month}-01` : "");
        return `
          <tr data-idx="${idx}">
            <td><input type="text" placeholder="TT.MM.JJJJ" data-field="date" value="${toDisplayDate(iso)}"></td>
            <td><input type="text" data-field="label" value="${row.label || ""}"></td>
            <td><input type="text" inputmode="decimal" data-field="amountEur" value="${fmtCurrency(row.amountEur)}"></td>
            <td><button class="btn danger" data-remove="${idx}">Entfernen</button></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderFixSummary() {
    const instances = expandFixcostInstances(state, { today: new Date() });
    if (!instances.length) {
      fixSummaryRows.innerHTML = `<tr><td colspan="4" class="muted">Keine Fixkosten geplant.</td></tr>`;
      return;
    }
    const grouped = new Map();
    instances.forEach((inst) => {
      if (!grouped.has(inst.month)) {
        grouped.set(inst.month, { total: 0, paid: 0 });
      }
      const bucket = grouped.get(inst.month);
      bucket.total += inst.amount || 0;
      if (inst.paid) bucket.paid += inst.amount || 0;
    });
    const rows = Array.from(grouped.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, sums]) => {
        const open = Math.max(0, sums.total - sums.paid);
        return `
          <tr>
            <td>${month}</td>
            <td>${fmtCurrency(sums.total)} €</td>
            <td>${fmtCurrency(sums.paid)} €</td>
            <td>${fmtCurrency(open)} €</td>
          </tr>
        `;
      })
      .join("");
    fixSummaryRows.innerHTML = rows;
  }

  function renderDividends() {
    if (!state.dividends.length) {
      dividendRows.innerHTML = `<tr><td colspan="4" class="muted">Keine Einträge</td></tr>`;
      return;
    }
    dividendRows.innerHTML = state.dividends
      .map((row, idx) => `
        <tr data-idx="${idx}">
          <td><input type="month" data-field="month" value="${row.month || ""}"></td>
          <td><input type="text" data-field="label" value="${row.label || ""}"></td>
          <td><input type="text" inputmode="decimal" data-field="amountEur" value="${fmtCurrency(row.amountEur)}"></td>
          <td><button class="btn danger" data-remove="${idx}">Entfernen</button></td>
        </tr>
      `)
      .join("");
  }

  let actualsOriginal = structuredClone(state.monthlyActuals || {});
  let actualsDraft = structuredClone(actualsOriginal);
  const changeKeys = new Set();

  function updateChangesView() {
    const count = changeKeys.size;
    if (monthlyActualsChanges) {
      monthlyActualsChanges.textContent = count ? `${count} Änderungen` : "Keine Änderungen";
    }
    if (monthlyActualsDiscard) monthlyActualsDiscard.disabled = !count;
    if (monthlyActualsSave) monthlyActualsSave.disabled = !count;
  }

  function renderMonthlyActuals() {
    const startMonth = state.settings.startMonth || "2025-01";
    const horizon = Number(state.settings.horizonMonths || 12) || 12;
    const endMonth = addMonths(startMonth, horizon - 1);
    const allMonths = getMonthlyBuckets(startMonth, endMonth);
    const rangeOptions = getRangeOptions(allMonths);
    if (rangeOptions.length && !rangeOptions.some(option => option.value === monthlyActualsView.range)) {
      monthlyActualsView.range = rangeOptions[0].value;
    }
    if (monthlyActualsRange) {
      monthlyActualsRange.innerHTML = rangeOptions
        .map(option => `<option value="${option.value}" ${option.value === monthlyActualsView.range ? "selected" : ""}>${option.label}</option>`)
        .join("");
    }
    const visibleMonths = rangeOptions.length ? applyRange(allMonths, monthlyActualsView.range) : allMonths;
    if (!visibleMonths.length) {
      monthlyActualsRows.innerHTML = `<tr><td colspan="4" class="muted">Keine Monate verfügbar.</td></tr>`;
      return;
    }
    monthlyActualsRows.innerHTML = visibleMonths
      .map(month => {
        const entry = actualsDraft[month] || {};
        return `
          <tr data-month="${month}">
            <td>${month}</td>
            <td><input type="text" inputmode="decimal" data-field="realRevenueEUR" value="${fmtNumber0(entry.realRevenueEUR)}"></td>
            <td><input type="text" inputmode="decimal" data-field="realPayoutRatePct" value="${fmtNumber0(entry.realPayoutRatePct)}"></td>
            <td><input type="text" inputmode="decimal" data-field="realClosingBalanceEUR" value="${fmtNumber0(entry.realClosingBalanceEUR)}"></td>
          </tr>
        `;
      })
      .join("");
  }

  renderIncomes();
  renderExtras();
  renderFixSummary();
  renderDividends();
  renderMonthlyActuals();

  function focusFromRoute() {
    const query = window.__routeQuery || {};
    if (!query.month) return;
    const month = query.month;
    const row = incomeRows.querySelector(`tr[data-month="${month}"]`);
    if (!row) return;
    row.classList.add("row-focus");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    window.__routeQuery = {};
  }

  focusFromRoute();

  $("#opening", root)?.addEventListener("blur", (ev) => {
    const val = fmtCurrency(ev.target.value);
    ev.target.value = val;
    state.settings.openingBalance = val;
    saveState(state);
  });

  $("#startMonth", root)?.addEventListener("change", (ev) => {
    state.settings.startMonth = ev.target.value;
    saveState(state);
  });

  $("#income-add", root)?.addEventListener("click", () => {
    const last = state.incomings[state.incomings.length - 1];
    const next = last ? incMonth(last.month || state.settings.startMonth || "") : (state.settings.startMonth || "");
    state.incomings.push({ month: next, revenueEur: "0,00", payoutPct: "0", source: "manual" });
    saveState(state);
    renderIncomes();
  });

  $("#extra-add", root)?.addEventListener("click", () => {
    state.extras.push({ date: "", month: state.settings.startMonth || "", label: "", amountEur: "0,00" });
    saveState(state);
    renderExtras();
  });

  $("#dividend-add", root)?.addEventListener("click", () => {
    state.dividends.push({ month: state.settings.startMonth || "", label: "Dividende", amountEur: "0,00" });
    saveState(state);
    renderDividends();
  });

  monthlyActualsRange?.addEventListener("change", () => {
    monthlyActualsView.range = monthlyActualsRange.value;
    renderMonthlyActuals();
  });

  incomeRows?.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = ev.target.dataset.field;
    if (!(field && state.incomings[idx])) return;
    state.incomings[idx][field] = ev.target.value;
    if (["month", "revenueEur", "payoutPct"].includes(field)) {
      state.incomings[idx].source = "manual";
    }
  });

  incomeRows?.addEventListener("focusout", (ev) => {
    const input = ev.target.closest("input");
    if (!input) return;
    const tr = input.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = input.dataset.field;
    if (!(field && state.incomings[idx])) return;
    if (field === "revenueEur") {
      const formatted = fmtCurrency(input.value);
      state.incomings[idx][field] = formatted;
      input.value = formatted;
    } else if (field === "payoutPct") {
      const formatted = fmtPercent(input.value);
      state.incomings[idx][field] = formatted;
      input.value = formatted;
    } else if (field === "month") {
      state.incomings[idx][field] = input.value;
    }
  });

  incomeRows?.addEventListener("change", () => {
    saveState(state);
  });

  incomeRows?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.remove);
    state.incomings.splice(idx, 1);
    saveState(state);
    renderIncomes();
  });

  extrasRows?.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = ev.target.dataset.field;
    if (!(field && state.extras[idx])) return;
    state.extras[idx][field] = ev.target.value;
  });

  extrasRows?.addEventListener("focusout", (ev) => {
    const input = ev.target.closest("input");
    if (!input) return;
    const tr = input.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = input.dataset.field;
    if (!(field && state.extras[idx])) return;
    if (field === "amountEur") {
      const formatted = fmtCurrency(input.value);
      state.extras[idx][field] = formatted;
      input.value = formatted;
    } else if (field === "date") {
      const iso = toIsoDate(input.value);
      state.extras[idx].date = iso;
      state.extras[idx].month = ensureMonthFromDate(iso);
      input.value = iso ? toDisplayDate(iso) : "";
    } else {
      state.extras[idx][field] = input.value.trim();
    }
  });

  extrasRows?.addEventListener("change", () => {
    saveState(state);
  });

  extrasRows?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.remove);
    state.extras.splice(idx, 1);
    saveState(state);
    renderExtras();
  });

  dividendRows?.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = ev.target.dataset.field;
    if (!(field && state.dividends[idx])) return;
    state.dividends[idx][field] = ev.target.value;
  });

  dividendRows?.addEventListener("focusout", (ev) => {
    const input = ev.target.closest("input");
    if (!input) return;
    const tr = input.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = input.dataset.field;
    if (!(field && state.dividends[idx])) return;
    if (field === "amountEur") {
      const formatted = fmtCurrency(input.value);
      state.dividends[idx][field] = formatted;
      input.value = formatted;
    } else {
      state.dividends[idx][field] = input.value.trim();
    }
  });

  dividendRows?.addEventListener("change", () => {
    saveState(state);
  });

  dividendRows?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.remove);
    state.dividends.splice(idx, 1);
    saveState(state);
    renderDividends();
  });

  monthlyActualsRows?.addEventListener("input", (ev) => {
    const input = ev.target.closest("input[data-field]");
    if (!input) return;
    const row = input.closest("tr[data-month]");
    if (!row) return;
    const month = row.dataset.month;
    const field = input.dataset.field;
    const parsed = parseNumberDE(input.value);
    const normalized = parsed == null ? null : Math.round(parsed);
    if (!actualsDraft[month]) actualsDraft[month] = {};
    if (normalized == null) {
      delete actualsDraft[month][field];
      if (!Object.keys(actualsDraft[month]).length) delete actualsDraft[month];
    } else {
      actualsDraft[month][field] = normalized;
    }
    const originalValue = Number(actualsOriginal?.[month]?.[field]);
    const originalNormalized = Number.isFinite(originalValue) ? originalValue : null;
    const isChanged = normalized !== originalNormalized;
    const key = `${month}:${field}`;
    if (isChanged) changeKeys.add(key);
    else changeKeys.delete(key);
    updateChangesView();
  });

  monthlyActualsRows?.addEventListener("focusout", (ev) => {
    const input = ev.target.closest("input[data-field]");
    if (!input) return;
    const row = input.closest("tr[data-month]");
    if (!row) return;
    const month = row.dataset.month;
    const field = input.dataset.field;
    const value = actualsDraft?.[month]?.[field];
    input.value = fmtNumber0(value);
  });

  monthlyActualsDiscard?.addEventListener("click", () => {
    actualsDraft = structuredClone(actualsOriginal);
    changeKeys.clear();
    renderMonthlyActuals();
    updateChangesView();
  });

  monthlyActualsSave?.addEventListener("click", () => {
    state.monthlyActuals = structuredClone(actualsDraft);
    saveState(state);
    actualsOriginal = structuredClone(actualsDraft);
    changeKeys.clear();
    renderMonthlyActuals();
    updateChangesView();
  });

  updateChangesView();
}

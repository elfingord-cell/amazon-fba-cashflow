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

function fmtCurrency(value) {
  return Number(parseDE(value) || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  state.settings = state.settings || {};

  root.innerHTML = `
    <section class="card">
      <h2>Eingaben</h2>
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
      <table class="table">
        <thead><tr><th>Monat</th><th>Umsatz (€)</th><th>Payout (%)</th><th></th></tr></thead>
        <tbody id="income-rows"></tbody>
      </table>
      <button class="btn" id="income-add">+ Monat hinzufügen</button>
    </section>

    <section class="card">
      <h3>Extras (Ein-/Auszahlungen)</h3>
      <table class="table">
        <thead><tr><th>Datum (TT.MM.JJJJ)</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
        <tbody id="extras-rows"></tbody>
      </table>
      <button class="btn" id="extra-add">+ Extra hinzufügen</button>
    </section>

    <section class="card">
      <h3>Fixkosten (Übersicht)</h3>
      <p class="muted">Pflege und Detailbearbeitung im Tab <strong>Fixkosten</strong>. Übersicht der geplanten Zahlungen im aktuellen Planungshorizont.</p>
      <table class="table">
        <thead><tr><th>Monat</th><th>Summe (€)</th><th>Bezahlt (€)</th><th>Offen (€)</th></tr></thead>
        <tbody id="fix-summary-rows"></tbody>
      </table>
      <a class="btn secondary" href="#fixkosten">Zum Fixkosten-Tab</a>
    </section>

    <section class="card">
      <h3>Dividenden & KapESt</h3>
      <table class="table">
        <thead><tr><th>Monat</th><th>Label</th><th>Betrag (€)</th><th></th></tr></thead>
        <tbody id="dividend-rows"></tbody>
      </table>
      <button class="btn" id="dividend-add">+ Dividenden-Zeile</button>
    </section>
  `;

  const incomeRows = $("#income-rows", root);
  const extrasRows = $("#extras-rows", root);
  const fixSummaryRows = $("#fix-summary-rows", root);
  const dividendRows = $("#dividend-rows", root);

  function renderIncomes() {
    if (!state.incomings.length) {
      incomeRows.innerHTML = `<tr><td colspan="4" class="muted">Keine Einträge</td></tr>`;
      return;
    }
    incomeRows.innerHTML = state.incomings
      .map((row, idx) => `
        <tr data-idx="${idx}">
          <td><input type="month" data-field="month" value="${row.month || ""}"></td>
          <td><input type="text" data-field="revenueEur" inputmode="decimal" value="${fmtCurrency(row.revenueEur)}"></td>
          <td><input type="text" data-field="payoutPct" inputmode="decimal" value="${fmtPercent(row.payoutPct)}"></td>
          <td><button class="btn danger" data-remove="${idx}">Entfernen</button></td>
        </tr>
      `)
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

  renderIncomes();
  renderExtras();
  renderFixSummary();
  renderDividends();

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
    state.incomings.push({ month: next, revenueEur: "0,00", payoutPct: "0" });
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

  incomeRows?.addEventListener("input", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const field = ev.target.dataset.field;
    if (!(field && state.incomings[idx])) return;
    state.incomings[idx][field] = ev.target.value;
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
}

import {
  loadState,
  addStateListener,
  updateVatPreviewSettings,
  updateVatPreviewMonth,
  resetVatPreviewMonths,
} from "../data/storageLocal.js";
import { fmtEUR, parseEuro } from "../domain/cashflow.js";
import { computeVatPreview } from "../domain/vatPreview.js";

const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short", year: "numeric" });
const dateShort = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const DETAIL_LABELS = {
  deBrutto: "DE-Brutto",
  outputUst: "Output-USt",
  vstFees: "VSt Fees",
  fixkostenVst: "Fixkosten-VSt",
  eustErstattung: "EUSt-Erstattung",
  zahllast: "Zahllast",
};

const DETAIL_COLUMNS = {
  deBrutto: [
    {
      label: "SKU / Alias",
      getValue: item => [item.label, item.sublabel].filter(Boolean).join(" – "),
      align: "left",
    },
    {
      label: "Units",
      getValue: item => (item.meta?.units != null ? fmtNumber(item.meta.units) : "–"),
      align: "num",
    },
    {
      label: "Preis",
      getValue: item => (item.meta?.price != null ? fmt(item.meta.price) : "–"),
      align: "num",
    },
    {
      label: "Umsatzbeitrag",
      getValue: item => fmt(item.amount),
      align: "num",
    },
  ],
  outputUst: [
    { label: "Posten", getValue: item => item.label, align: "left" },
    { label: "Betrag", getValue: item => fmt(item.amount), align: "num" },
  ],
  vstFees: [
    { label: "Quelle/Typ", getValue: item => item.label, align: "left" },
    { label: "Basis", getValue: item => item.sublabel || "–", align: "left" },
    { label: "VSt Betrag", getValue: item => fmt(item.amount), align: "num" },
  ],
  fixkostenVst: [
    { label: "Name", getValue: item => item.label, align: "left" },
    { label: "VSt Anteil", getValue: item => fmt(item.amount), align: "num" },
  ],
  eustErstattung: [
    { label: "PO/FO", getValue: item => item.label || "–", align: "left" },
    { label: "Event", getValue: item => item.sublabel || "–", align: "left" },
    { label: "Datum", getValue: item => (item.date ? dateShort.format(new Date(item.date)) : "–"), align: "left" },
    { label: "Betrag", getValue: item => fmt(item.amount), align: "num" },
  ],
  zahllast: [
    { label: "Komponente", getValue: item => item.label, align: "left" },
    { label: "Betrag", getValue: item => fmt(item.amount), align: "num" },
  ],
};

function fmt(val) {
  return fmtEUR(Number(val || 0));
}

function fmtNumber(value, decimals = 0) {
  if (!Number.isFinite(Number(value))) return "–";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function monthKeyToDateLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return monthShort.format(new Date(y, m - 1, 1));
}

function rateInput(value) {
  const num = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : 0;
}

function buildToolbar(data) {
  const wrapper = document.createElement("div");
  wrapper.className = "vat-preview-toolbar";
  wrapper.innerHTML = `
    <label>
      EUSt-Lag (Monate)
      <input type="number" id="vat-eust-lag" min="0" value="${data.settings.eustLagMonths}" aria-label="EUSt Lag Monate" />
    </label>
    <label>
      DE-Anteil
      <input type="number" id="vat-de-share" step="0.01" min="0" max="1" value="${data.settings.deShareDefault}" aria-label="DE-Anteil Standard" />
    </label>
    <label>
      Gebührensatz
      <input type="number" id="vat-fee-rate" step="0.01" min="0" max="1" value="${data.settings.feeRateDefault}" aria-label="Gebührensatz Standard" />
    </label>
    <label>
      Fixkosten-VSt
      <input type="text" id="vat-fix-input" inputmode="decimal" value="${fmt(data.settings.fixInputDefault)}" aria-label="Fixkosten Vorsteuer Standard" />
    </label>
    <div class="vat-preview-toolbar-actions">
      <button type="button" class="btn secondary sm" id="vat-reset" aria-label="Alle zurücksetzen">Alle zurücksetzen</button>
    </div>
  `;
  return wrapper;
}

function buildCsv(columns, items) {
  const escape = value => {
    const text = String(value ?? "");
    if (text.includes(";") || text.includes("\n") || text.includes("\"")) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
  };
  const header = columns.map(col => escape(col.label)).join(";");
  const rows = items.map(item => columns.map(col => escape(col.getValue(item))).join(";"));
  return [header, ...rows].join("\n");
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return Promise.resolve();
}

function openVatDetailModal(root, row, detailKey) {
  const detail = row?.details?.[detailKey];
  if (!detail) return;
  const metricLabel = DETAIL_LABELS[detailKey] || detailKey;
  const monthLabel = monthKeyToDateLabel(row.month);
  const items = Array.isArray(detail.items) ? detail.items : [];
  const columns = DETAIL_COLUMNS[detailKey] || [
    { label: "Posten", getValue: item => item.label, align: "left" },
    { label: "Betrag", getValue: item => fmt(item.amount), align: "num" },
  ];

  const overlay = document.createElement("div");
  overlay.className = "po-modal-backdrop vat-detail-modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "po-modal vat-detail-modal-frame";
  modal.innerHTML = `
    <header class="po-modal-header">
      <div>
        <h3>Details – ${metricLabel} – ${monthLabel}</h3>
        ${detail.formula ? `<p class="muted small">${detail.formula}</p>` : ""}
      </div>
      <button class="btn ghost" type="button" data-close aria-label="Schließen">✕</button>
    </header>
  `;

  const body = document.createElement("div");
  body.className = "po-modal-body";

  if (detail.notes) {
    const notes = document.createElement("p");
    notes.className = "muted small vat-detail-notes";
    notes.textContent = detail.notes;
    body.appendChild(notes);
  }

  const controls = document.createElement("div");
  controls.className = "vat-detail-controls";
  let filterTerm = "";
  let filteredItems = items;
  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.placeholder = "Suche in Details";
  filterInput.className = "vat-detail-search";
  if (items.length > 50) {
    controls.appendChild(filterInput);
  }

  const limitHint = document.createElement("div");
  limitHint.className = "muted small vat-detail-limit";
  if (items.length > 50) {
    limitHint.textContent = "Es werden nur die ersten 50 Zeilen angezeigt (Nutze Suche oder CSV kopieren).";
  }

  const tableWrap = document.createElement("div");
  tableWrap.className = "vat-detail-table-wrap ui-table-shell ui-scroll-host";
  const table = document.createElement("table");
  table.className = "table-compact ui-table-standard vat-detail-table";
  table.innerHTML = `
    <thead>
      <tr>
        ${columns.map(col => `<th class="${col.align === "num" ? "num" : ""}">${col.label}</th>`).join("")}
      </tr>
    </thead>
    <tbody></tbody>
    <tfoot>
      <tr>
        <td class="vat-detail-sum" colspan="${Math.max(1, columns.length - 1)}">Summe</td>
        <td class="num vat-detail-sum">${fmt(detail.total ?? 0)}</td>
      </tr>
    </tfoot>
  `;
  tableWrap.appendChild(table);

  const emptyState = document.createElement("p");
  emptyState.className = "muted small vat-detail-empty";
  emptyState.textContent = "Keine Details verfügbar.";

  function applyFilter() {
    if (!filterTerm) {
      filteredItems = items;
    } else {
      const needle = filterTerm.toLowerCase();
      filteredItems = items.filter(item => {
        const haystack = [
          item.label,
          item.sublabel,
          item.date,
          item.meta?.sourceNumber,
        ]
          .filter(Boolean)
          .map(val => String(val).toLowerCase())
          .join(" ");
        return haystack.includes(needle);
      });
    }
  }

  function renderRows() {
    applyFilter();
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    if (!filteredItems.length) {
      tableWrap.replaceWith(emptyState);
      return;
    }
    if (!tableWrap.isConnected) {
      emptyState.replaceWith(tableWrap);
    }
    const showItems = items.length > 50 && !filterTerm ? filteredItems.slice(0, 50) : filteredItems;
    showItems.forEach(item => {
      const rowEl = document.createElement("tr");
      columns.forEach(col => {
        const cell = document.createElement("td");
        if (col.align === "num") cell.className = "num";
        cell.textContent = col.getValue(item);
        rowEl.appendChild(cell);
      });
      tbody.appendChild(rowEl);
    });
  }

  filterInput.addEventListener("input", ev => {
    filterTerm = ev.target.value || "";
    renderRows();
  });

  const actions = document.createElement("footer");
  actions.className = "po-modal-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn secondary";
  copyBtn.textContent = "CSV kopieren";
  copyBtn.addEventListener("click", () => {
    applyFilter();
    const csv = buildCsv(columns, filteredItems);
    copyToClipboard(csv);
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn";
  closeBtn.textContent = "Schließen";

  actions.append(copyBtn, closeBtn);
  if (controls.childNodes.length) body.appendChild(controls);
  if (limitHint.textContent) body.appendChild(limitHint);
  body.appendChild(items.length ? tableWrap : emptyState);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) close();
  });
  modal.querySelector("[data-close]")?.addEventListener("click", close);
  closeBtn.addEventListener("click", close);

  renderRows();
}

function buildKpis(data) {
  const wrapper = document.createElement("div");
  wrapper.className = "vat-preview-kpis";
  wrapper.innerHTML = `
    <div class="vat-preview-kpi">
      <span class="label">Output-USt gesamt</span>
      <span class="value">${fmt(data.totals.outVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">VSt Fees gesamt</span>
      <span class="value">${fmt(data.totals.feeInputVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">Fixkosten-VSt gesamt</span>
      <span class="value">${fmt(data.totals.fixInputVat)}</span>
    </div>
    <div class="vat-preview-kpi">
      <span class="label">Zahllast gesamt</span>
      <span class="value ${data.totals.payable < 0 ? "is-negative" : ""}">${fmt(data.totals.payable)}</span>
    </div>
  `;
  return wrapper;
}

function renderTable(root, data) {
  const table = document.createElement("div");
  table.className = "panel vat-panel";
  table.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>USt-Vorschau (DE)</h2>
        <p class="muted">19 % DE, Gebührenquote, Fixkosten-VSt und EUSt-Erstattung pro Monat</p>
      </div>
    </div>
    <div class="vat-preview-table-wrap table-wrap ui-table-shell ui-scroll-host">
      <table class="table-compact ui-table-standard vat-preview-table" aria-label="USt Vorschau Tabelle">
        <thead>
          <tr>
            <th>Monat</th>
            <th class="num">DE-Brutto</th>
            <th class="num">Output-USt</th>
            <th class="num">VSt Fees</th>
            <th class="num">Fixkosten-VSt</th>
            <th class="num">EUSt-Erstattung</th>
            <th class="num">Zahllast</th>
            <th class="vat-preview-actions-col"></th>
          </tr>
        </thead>
        <tbody class="vat-body"></tbody>
        <tfoot>
          <tr class="vat-preview-summary">
            <td>Summe</td>
            <td class="num">${fmt(data.totals.grossDe)}</td>
            <td class="num">${fmt(data.totals.outVat)}</td>
            <td class="num">${fmt(data.totals.feeInputVat)}</td>
            <td class="num">${fmt(data.totals.fixInputVat)}</td>
            <td class="num">${fmt(data.totals.eustRefund)}</td>
            <td class="num vat-payable ${data.totals.payable < 0 ? "is-negative" : ""}">${fmt(data.totals.payable)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="muted small">Vereinfachte Schätzung (19 % DE; ohne RC/OSS). EUSt-Erstattung wird automatisch aus POs (Monatsende + Lag) übernommen.</p>
  `;

  const body = table.querySelector(".vat-body");
  data.rows.forEach((row, idx) => {
    const monthCfg = data.monthConfig[row.month];
    const label = monthKeyToDateLabel(row.month);
    const payableClass = row.payable < 0 ? "is-negative" : "";
    const detailDisabled = idx === 0 ? "disabled" : "";
    const rowEl = document.createElement("tr");
    rowEl.className = "vat-preview-row";
    rowEl.dataset.month = row.month;
    rowEl.innerHTML = `
      <td class="mono">${label}</td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="deBrutto" data-month="${row.month}" title="Details anzeigen">${fmt(row.grossDe)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="outputUst" data-month="${row.month}" title="Details anzeigen">${fmt(row.outVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="vstFees" data-month="${row.month}" title="Details anzeigen">${fmt(row.feeInputVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="fixkostenVst" data-month="${row.month}" title="Details anzeigen">${fmt(row.fixInputVat)}</button></td>
      <td class="num"><button class="vat-detail-trigger" type="button" data-detail-key="eustErstattung" data-month="${row.month}" title="Details anzeigen">${fmt(row.eustRefund)}</button></td>
      <td class="num vat-payable ${payableClass}"><button class="vat-detail-trigger ${payableClass}" type="button" data-detail-key="zahllast" data-month="${row.month}" title="Details anzeigen">${fmt(row.payable)}</button></td>
      <td class="vat-preview-action">
        <button type="button" class="btn secondary sm" data-toggle="${row.month}" aria-expanded="false">Bearbeiten</button>
      </td>
    `;
    const detailRow = document.createElement("tr");
    detailRow.className = "vat-preview-details";
    detailRow.dataset.details = row.month;
    detailRow.hidden = true;
    detailRow.innerHTML = `
      <td colspan="8">
        <div class="vat-preview-details-inner">
          <div class="vat-preview-fields">
            <label>
              DE-Anteil
              <input type="number" step="0.01" min="0" max="1" data-month="${row.month}" data-field="deShare" value="${monthCfg.deShare}" aria-label="DE-Anteil" />
            </label>
            <label>
              Gebührensatz
              <input type="number" step="0.01" min="0" max="1" data-month="${row.month}" data-field="feeRateOfGross" value="${monthCfg.feeRateOfGross}" aria-label="Gebührensatz" />
            </label>
            <label>
              Fixkosten-VSt
              <input type="text" inputmode="decimal" data-month="${row.month}" data-field="fixInputVat" value="${fmt(monthCfg.fixInputVat)}" aria-label="Fixkosten Vorsteuer" />
            </label>
          </div>
          <div class="vat-preview-actions">
            <button type="button" class="btn secondary sm" data-copy-prev="${row.month}" ${detailDisabled} aria-label="Vormonat übernehmen">Vormonat übernehmen</button>
          </div>
        </div>
      </td>
    `;
    body.appendChild(rowEl);
    body.appendChild(detailRow);
  });

  const toolbar = buildToolbar(data);
  const kpis = buildKpis(data);
  table.querySelector(".panel-header")?.after(toolbar);
  toolbar.after(kpis);

  toolbar.querySelector("#vat-eust-lag")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ eustLagMonths: Number(ev.target.value) || 0 });
  });

  toolbar.querySelector("#vat-de-share")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ deShareDefault: rateInput(ev.target.value) });
  });

  toolbar.querySelector("#vat-fee-rate")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ feeRateDefault: rateInput(ev.target.value) });
  });

  toolbar.querySelector("#vat-fix-input")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ fixInputDefault: parseEuro(ev.target.value) });
  });

  toolbar.querySelector("#vat-reset")?.addEventListener("click", () => {
    resetVatPreviewMonths();
  });

  body.addEventListener("change", (ev) => {
    const target = ev.target;
    const field = target.getAttribute("data-field");
    const month = target.getAttribute("data-month");
    if (!field || !month) return;
    const value = field === "fixInputVat" ? parseEuro(target.value) : rateInput(target.value);
    updateVatPreviewMonth(month, { [field]: value });
  });

  body.addEventListener("click", (ev) => {
    const toggle = ev.target.closest("[data-toggle]");
    if (toggle) {
      const month = toggle.getAttribute("data-toggle");
      const details = body.querySelector(`[data-details="${month}"]`);
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      if (details) {
        details.hidden = expanded;
        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.textContent = expanded ? "Bearbeiten" : "Schließen";
      }
      return;
    }
    const detailTrigger = ev.target.closest(".vat-detail-trigger");
    if (detailTrigger) {
      const month = detailTrigger.getAttribute("data-month");
      const detailKey = detailTrigger.getAttribute("data-detail-key");
      const rowData = data.rows.find(entry => entry.month === month);
      if (rowData && detailKey) {
        openVatDetailModal(root, rowData, detailKey);
      }
      return;
    }
    const btn = ev.target.closest("[data-copy-prev]");
    if (!btn) return;
    const month = btn.getAttribute("data-copy-prev");
    const months = data.months;
    const idx = months.indexOf(month);
    if (idx > 0) {
      const prevMonth = months[idx - 1];
      const cfg = data.monthConfig[prevMonth];
      updateVatPreviewMonth(month, {
        deShare: cfg.deShare,
        feeRateOfGross: cfg.feeRateOfGross,
        fixInputVat: cfg.fixInputVat,
      });
    }
  });

  root.appendChild(table);
}

export default function renderVat(el) {
  const root = el;
  root.innerHTML = "";

  function refresh() {
    const state = loadState();
    const result = computeVatPreview(state);
    const monthConfig = {};
    result.months.forEach(m => {
      monthConfig[m] = {
        deShare: Number(state.vatPreviewMonths?.[m]?.deShare ?? state.settings.vatPreview.deShareDefault ?? 0.8),
        feeRateOfGross: Number(state.vatPreviewMonths?.[m]?.feeRateOfGross ?? state.settings.vatPreview.feeRateDefault ?? 0.38),
        fixInputVat: parseEuro(state.vatPreviewMonths?.[m]?.fixInputVat ?? state.settings.vatPreview.fixInputDefault ?? 0),
      };
    });
    result.settings = state.settings.vatPreview;
    result.monthConfig = monthConfig;
    result.months = result.months;
    root.innerHTML = "";
    renderTable(root, result);
    const query = window.__routeQuery || {};
    if (query.month) {
      const row = root.querySelector(`.vat-preview-row[data-month="${query.month}"]`);
      if (row) {
        row.classList.add("row-focus");
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        window.__routeQuery = {};
      }
    }
  }

  refresh();
  const off = addStateListener(() => refresh());
  return { cleanup: off };
}

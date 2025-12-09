import {
  loadState,
  addStateListener,
  updateVatPreviewSettings,
} from "../data/storageLocal.js";
import { fmtEUR } from "../domain/cashflow.js";
import { computeVatPreview } from "../domain/vatPreview.js";

const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short", year: "numeric" });

function fmt(val) {
  return fmtEUR(Number(val || 0));
}

function monthKeyToDateLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return monthShort.format(new Date(y, m - 1, 1));
}

function renderTable(root, data) {
  const table = document.createElement("div");
  table.className = "panel vat-panel";
  table.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>USt-Vorschau</h2>
        <p class="muted">Output-USt, Vorsteuer inkl. EUSt-Erstattung und RC je Monat</p>
      </div>
      <div class="toolbar">
        <label class="switch">
          <input type="checkbox" id="vat-ist" ${data.settings.istVersteuerung ? "checked" : ""} aria-label="Ist-Versteuerung">
          <span>Ist-Versteuerung</span>
        </label>
        <label>
          EUSt-Lag (Monate)
          <input type="number" id="vat-eust-lag" min="0" value="${data.settings.eustLagMonths}" />
        </label>
        <label>
          Δ Rückläufer (pp)
          <input type="number" step="0.1" id="vat-returns-delta" value="${data.settings.returnsDelta || 0}" />
        </label>
        <label>
          Δ USt-Satz (pp)
          <input type="number" step="0.1" id="vat-rate-delta" value="${data.settings.vatRateDelta || 0}" />
        </label>
      </div>
    </div>
    <div class="vat-table" role="table" aria-label="USt Vorschau Tabelle">
      <div class="vat-head" role="row">
        <span role="columnheader">Monat</span>
        <span role="columnheader">Output-USt</span>
        <span role="columnheader">Input-VSt</span>
        <span role="columnheader">EUSt-Erst.</span>
        <span role="columnheader">RC ±</span>
        <span role="columnheader">Zahllast</span>
      </div>
      ${data.rows
        .map(row => {
          const rcNet = row.rcVat - row.rcInput;
          const outputTip = row.outputTop.map(item => `${item.label}: ${fmt(item.value)}`).join("\n") || "Keine Daten";
          const inputTip = row.inputTop.map(item => `${item.label}: ${fmt(item.value)}`).join("\n") || "Keine Daten";
          const eustTip = row.eustTop.map(item => `${item.label}: ${fmt(item.value)}`).join("\n") || "Keine Daten";
          return `<div class="vat-row" role="row">
            <span role="cell" class="mono">${monthKeyToDateLabel(row.month)}</span>
            <span role="cell" title="${outputTip}">${fmt(row.outputVat)}</span>
            <span role="cell" title="${inputTip}">${fmt(row.inputVat)}</span>
            <span role="cell" title="${eustTip}">${fmt(row.eustRefund)}</span>
            <span role="cell">${fmt(rcNet)}</span>
            <span role="cell" class="bold">${fmt(row.payable)}</span>
          </div>`;
        })
        .join("")}
      <div class="vat-row vat-footer" role="row">
        <span role="cell">Summe</span>
        <span role="cell">${fmt(data.totals.outputVat)}</span>
        <span role="cell">${fmt(data.totals.inputVat)}</span>
        <span role="cell">${fmt(data.totals.eustRefund)}</span>
        <span role="cell">${fmt(data.totals.rcVat - data.totals.rcInput)}</span>
        <span role="cell" class="bold">${fmt(data.totals.payable)}</span>
      </div>
    </div>
  `;

  table.querySelector("#vat-ist")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ istVersteuerung: ev.target.checked });
  });
  table.querySelector("#vat-eust-lag")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ eustLagMonths: Number(ev.target.value) || 0 });
  });
  table.querySelector("#vat-returns-delta")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ returnsDelta: Number(ev.target.value) || 0 });
  });
  table.querySelector("#vat-rate-delta")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ vatRateDelta: Number(ev.target.value) || 0 });
  });

  root.appendChild(table);
}

export default function renderVat(el) {
  const root = el;
  root.innerHTML = "";

  function refresh() {
    const state = loadState();
    const result = computeVatPreview(state);
    result.settings = state.settings.vatPreview;
    root.innerHTML = "";
    renderTable(root, result);
  }

  refresh();
  const off = addStateListener(() => refresh());
  return { cleanup: off };
}

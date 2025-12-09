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

function fmt(val) {
  return fmtEUR(Number(val || 0));
}

function monthKeyToDateLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return monthShort.format(new Date(y, m - 1, 1));
}

function rateInput(value) {
  const num = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(num) ? num : 0;
}

function buildRow(row, cfg) {
  const wrapper = document.createElement("div");
  wrapper.className = "vat-row";
  wrapper.setAttribute("role", "row");
  const label = monthKeyToDateLabel(row.month);
  wrapper.innerHTML = `
    <span role="cell" class="mono">${label}</span>
    <span role="cell" title="Brutto-Umsatz gesamt">${fmt(row.grossTotal)}</span>
    <span role="cell" title="Anteil Deutschland">${fmt(row.grossDe)}</span>
    <span role="cell" title="Output-USt">${fmt(row.outVat)}</span>
    <span role="cell" title="Vorsteuer auf Amazon-Gebühren">${fmt(row.feeInputVat)}</span>
    <span role="cell" title="Vorsteuer aus Fixkosten">${fmt(row.fixInputVat)}</span>
    <span role="cell" title="EUSt-Erstattung">${fmt(row.eustRefund)}</span>
    <span role="cell" class="bold" title="Zahllast DE">${fmt(row.payable)}</span>
    <div class="vat-controls" role="cell">
      <label>
        DE-Anteil
        <input type="number" step="0.01" min="0" max="1" data-month="${row.month}" data-field="deShare" value="${cfg.deShare}" aria-label="DE-Anteil" />
      </label>
      <label>
        Gebührensatz
        <input type="number" step="0.01" min="0" max="1" data-month="${row.month}" data-field="feeRateOfGross" value="${cfg.feeRateOfGross}" aria-label="Gebührensatz" />
      </label>
      <label>
        Fixkosten-VSt
        <input type="text" inputmode="decimal" data-month="${row.month}" data-field="fixInputVat" value="${fmt(row.fixInputVat)}" aria-label="Fixkosten Vorsteuer" />
      </label>
      <div class="vat-actions">
        <button type="button" class="btn-secondary" data-copy-prev="${row.month}" aria-label="Vormonat übernehmen">Vormonat übernehmen</button>
      </div>
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
      <div class="toolbar">
        <label>
          EUSt-Lag (Monate)
          <input type="number" id="vat-eust-lag" min="0" value="${data.settings.eustLagMonths}" aria-label="EUSt Lag Monate" />
        </label>
        <button type="button" class="btn-secondary" id="vat-reset" aria-label="Alle zurücksetzen">Alle zurücksetzen</button>
      </div>
    </div>
    <div class="vat-table" role="table" aria-label="USt Vorschau Tabelle">
      <div class="vat-head" role="row">
        <span role="columnheader">Monat</span>
        <span role="columnheader">Brutto gesamt</span>
        <span role="columnheader">DE-Brutto</span>
        <span role="columnheader">Output-USt</span>
        <span role="columnheader">VSt Fees</span>
        <span role="columnheader">VSt Fix</span>
        <span role="columnheader">EUSt-Erst.</span>
        <span role="columnheader">Zahllast</span>
        <span role="columnheader" class="wide">Einstellungen</span>
      </div>
      <div class="vat-body" role="rowgroup"></div>
      <div class="vat-row vat-footer" role="row">
        <span role="cell">Summe</span>
        <span role="cell">${fmt(data.totals.grossTotal)}</span>
        <span role="cell">${fmt(data.totals.grossDe)}</span>
        <span role="cell">${fmt(data.totals.outVat)}</span>
        <span role="cell">${fmt(data.totals.feeInputVat)}</span>
        <span role="cell">${fmt(data.totals.fixInputVat)}</span>
        <span role="cell">${fmt(data.totals.eustRefund)}</span>
        <span role="cell" class="bold">${fmt(data.totals.payable)}</span>
        <span role="cell"></span>
      </div>
    </div>
    <p class="muted small">Vereinfachte Schätzung (19 % DE; ohne RC/OSS). EUSt-Erstattung wird automatisch aus POs (Monatsende + Lag) übernommen.</p>
  `;

  const body = table.querySelector(".vat-body");
  data.rows.forEach(row => {
    const monthCfg = data.monthConfig[row.month];
    body.appendChild(buildRow(row, monthCfg));
  });

  table.querySelector("#vat-eust-lag")?.addEventListener("change", (ev) => {
    updateVatPreviewSettings({ eustLagMonths: Number(ev.target.value) || 0 });
  });

  table.querySelector("#vat-reset")?.addEventListener("click", () => {
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
  }

  refresh();
  const off = addStateListener(() => refresh());
  return { cleanup: off };
}

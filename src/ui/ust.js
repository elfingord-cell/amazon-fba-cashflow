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
    <div class="vat-preview-table-wrap table-wrap">
      <table class="table-compact vat-preview-table" aria-label="USt Vorschau Tabelle">
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
      <td class="num">${fmt(row.grossDe)}</td>
      <td class="num">${fmt(row.outVat)}</td>
      <td class="num">${fmt(row.feeInputVat)}</td>
      <td class="num">${fmt(row.fixInputVat)}</td>
      <td class="num">${fmt(row.eustRefund)}</td>
      <td class="num vat-payable ${payableClass}">${fmt(row.payable)}</td>
      <td class="vat-preview-action">
        <button type="button" class="btn ghost sm" data-toggle="${row.month}" aria-expanded="false">Bearbeiten</button>
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

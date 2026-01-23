import { loadState, addStateListener } from "../data/storageLocal.js";
import { parseEuro, fmtEUR, expandFixcostInstances } from "../domain/cashflow.js";
import { buildPaymentRows, getSettings } from "./orderEditorFactory.js";
import { computeVatPreview } from "../domain/vatPreview.js";

const dashboardState = {
  mode: "ist",
  expanded: new Set(["inflows", "outflows", "po-payments", "fo-payments"]),
  range: "18",
};

const PO_CONFIG = {
  entityLabel: "PO",
  numberField: "poNo",
};

const MODE_OPTIONS = [
  { key: "ist", label: "Ist" },
  { key: "plan", label: "Plan" },
  { key: "both", label: "Ist+Plan" },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtEURCell(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(num) ? num : 0);
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, (m - 1) + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthlyBuckets(startMonth, endMonth) {
  if (!startMonth || !endMonth) return [];
  const startIndex = monthIndex(startMonth);
  const endIndex = monthIndex(endMonth);
  if (startIndex == null || endIndex == null) return [];
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
  const length = months.length;
  const candidates = [12, 18, 24];
  candidates.forEach(count => {
    if (length >= count) options.push({ value: String(count), label: `Letzte ${count}` });
  });
  if (length > 0) options.push({ value: "all", label: "Alle" });
  return options;
}

function applyRange(months, range) {
  if (!months.length) return [];
  if (range === "all") return months.slice();
  const count = Number(range || 0);
  if (!Number.isFinite(count) || count <= 0) return months.slice();
  return months.slice(-count);
}

function toMonthKey(dateInput) {
  if (!dateInput) return null;
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function sumUnits(record) {
  if (!record) return 0;
  if (Array.isArray(record.items) && record.items.length) {
    return record.items.reduce((sum, item) => sum + (Number(item.units) || 0), 0);
  }
  return Number(record.units) || 0;
}

function convertToEur(amount, currency, fxRate) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (!currency || currency === "EUR") return value;
  const fx = Number(fxRate || 0);
  if (!Number.isFinite(fx) || fx <= 0) return value;
  return value / fx;
}

function computePlannedPayoutByMonth(state, months) {
  const forecastEnabled = Boolean(state?.forecast?.settings?.useForecast);
  const payoutPctByMonth = new Map();
  (state?.incomings || []).forEach(row => {
    if (!row?.month) return;
    payoutPctByMonth.set(row.month, row.payoutPct);
  });

  const revenueByMonth = new Map();
  if (forecastEnabled && Array.isArray(state?.forecast?.items)) {
    state.forecast.items.forEach(item => {
      if (!item?.month) return;
      const qty = Number(item.qty ?? item.quantity ?? 0) || 0;
      const price = parseEuro(item.priceEur ?? item.price ?? 0);
      revenueByMonth.set(item.month, (revenueByMonth.get(item.month) || 0) + qty * price);
    });
  } else {
    (state?.incomings || []).forEach(row => {
      if (!row?.month) return;
      revenueByMonth.set(row.month, parseEuro(row.revenueEur));
    });
  }

  const result = new Map();
  months.forEach(month => {
    const revenue = revenueByMonth.get(month) || 0;
    let pct = Number(payoutPctByMonth.get(month) || 0) || 0;
    if (pct > 1) pct = pct / 100;
    const payout = revenue * pct;
    result.set(month, payout);
  });
  return result;
}

function buildPoData(state) {
  const settings = getSettings();
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  return pos.map(po => {
    const paymentRows = buildPaymentRows(po, PO_CONFIG, settings);
    const transactions = Array.isArray(po.paymentTransactions) ? po.paymentTransactions : [];
    const txMap = new Map(transactions.map(tx => [tx?.id, tx]));
    const events = paymentRows
      .map(row => {
        const month = toMonthKey(row.dueDate);
        if (!month) return null;
        const tx = row.transactionId ? txMap.get(row.transactionId) : null;
        const actual = Number(row.paidEurActual);
        const actualEur = Number.isFinite(actual) ? actual : 0;
        return {
          id: row.id,
          month,
          label: row.typeLabel || row.label || "Zahlung",
          typeLabel: row.typeLabel || row.label || "Zahlung",
          dueDate: row.dueDate,
          plannedEur: Number(row.plannedEur || 0),
          actualEur,
          paid: row.status === "paid",
          hasInvoiceLink: Boolean(tx?.driveInvoiceLink),
          invoiceLink: tx?.driveInvoiceLink || null,
          paidBy: row.paidBy || null,
          currency: "EUR",
        };
      })
      .filter(Boolean);

    const supplier = po?.supplier || po?.supplierName || "";
    const units = sumUnits(po);
    return {
      record: po,
      supplier,
      units,
      events,
      transactions,
    };
  });
}

function buildFoData(state) {
  const fos = Array.isArray(state?.fos) ? state.fos : [];
  return fos
    .filter(fo => String(fo?.status || "").toUpperCase() !== "CONVERTED")
    .map(fo => {
      const fxRate = fo.fxRate || state?.settings?.fxRate || 0;
      const events = (fo.payments || [])
        .map(payment => {
          if (!payment?.dueDate) return null;
          const month = toMonthKey(payment.dueDate);
          if (!month) return null;
          const currency = payment.currency || "EUR";
          const plannedEur = convertToEur(payment.amount, currency, fxRate);
          return {
            id: payment.id,
            month,
            label: payment.label || "Payment",
            typeLabel: payment.label || payment.category || "Payment",
            dueDate: payment.dueDate,
            plannedEur,
            actualEur: 0,
            paid: false,
            hasInvoiceLink: true,
            invoiceLink: null,
            paidBy: null,
            currency,
          };
        })
        .filter(Boolean);
      return { record: fo, events };
    });
}

function sumPaymentEvents(events, month, mode) {
  let total = 0;
  const warnings = [];
  events.forEach(evt => {
    if (evt.month !== month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    const hasInvoice = evt.hasInvoiceLink !== false;
    const actualValid = paid && actual > 0 && hasInvoice;
    const missingInvoice = paid && (!hasInvoice || actual <= 0);

    if (missingInvoice) {
      warnings.push("Paid but missing invoice link");
    }

    if (mode === "ist") {
      if (actualValid) total += actual;
      return;
    }
    if (mode === "plan") {
      if (!paid || missingInvoice) total += planned;
      return;
    }
    if (actualValid) total += actual;
    else total += planned;
  });
  return { value: total, warnings };
}

function sumGenericEvents(events, month, mode) {
  let total = 0;
  events.forEach(evt => {
    if (evt.month !== month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    if (mode === "ist") {
      if (paid) total += actual;
      return;
    }
    if (mode === "plan") {
      total += planned;
      return;
    }
    total += paid ? actual : planned;
  });
  return { value: total, warnings: [] };
}

function buildRow({ id, label, level, children = [], events = [], tooltip = "", emptyHint = "", isSummary = false, alwaysVisible = false, sumMode = "payments" }) {
  return {
    id,
    label,
    level,
    children,
    events,
    tooltip,
    emptyHint,
    isSummary,
    alwaysVisible,
    sumMode,
    values: {},
  };
}

function applyRowValues(row, months, mode) {
  if (row.events.length) {
    months.forEach(month => {
      const result = row.sumMode === "generic"
        ? sumGenericEvents(row.events, month, mode)
        : sumPaymentEvents(row.events, month, mode);
      row.values[month] = result;
    });
  } else if (row.children.length) {
    row.children.forEach(child => applyRowValues(child, months, mode));
    months.forEach(month => {
      const sum = row.children.reduce((acc, child) => acc + (child.values[month]?.value || 0), 0);
      const warnings = row.children.flatMap(child => child.values[month]?.warnings || []);
      row.values[month] = { value: sum, warnings };
    });
  }
}

function rowHasValues(row, months) {
  return months.some(month => Math.abs(row.values[month]?.value || 0) > 0.0001);
}

function filterRows(row, months) {
  const filteredChildren = row.children
    .map(child => filterRows(child, months))
    .filter(Boolean);
  row.children = filteredChildren;
  const hasChildren = filteredChildren.length > 0;
  const hasValues = rowHasValues(row, months);
  if (row.alwaysVisible || row.isSummary) return row;
  if (hasChildren) return row;
  return hasValues ? row : null;
}

function flattenRows(rows, expandedSet) {
  const result = [];
  function traverse(row) {
    result.push(row);
    if (!row.children.length) return;
    if (!expandedSet.has(row.id)) return;
    row.children.forEach(child => traverse(child));
  }
  rows.forEach(traverse);
  return result;
}

function buildDashboardRows(state, months, mode) {
  const plannedPayoutMap = computePlannedPayoutByMonth(state, months);
  const actualPayoutMap = new Map();
  (state?.actuals || []).forEach(row => {
    if (!row?.month) return;
    actualPayoutMap.set(row.month, parseEuro(row.payoutEur));
  });

  const amazonEvents = months.map(month => ({
    id: `amazon-${month}`,
    month,
    plannedEur: plannedPayoutMap.get(month) || 0,
    actualEur: actualPayoutMap.get(month) || 0,
    paid: actualPayoutMap.has(month),
  }));

  const extraRows = Array.isArray(state?.extras) ? state.extras : [];
  const extraInEvents = extraRows
    .filter(row => parseEuro(row?.amountEur) >= 0)
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: parseEuro(row.amountEur),
      actualEur: parseEuro(row.amountEur),
      paid: true,
    }))
    .filter(evt => evt.month);

  const extraOutEvents = extraRows
    .filter(row => parseEuro(row?.amountEur) < 0)
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: Math.abs(parseEuro(row.amountEur)),
      actualEur: Math.abs(parseEuro(row.amountEur)),
      paid: true,
    }))
    .filter(evt => evt.month);

  const dividendEvents = (state?.dividends || [])
    .map(row => ({
      id: row.id || row.label || row.month,
      month: row.month || toMonthKey(row.date),
      plannedEur: Math.abs(parseEuro(row.amountEur)),
      actualEur: Math.abs(parseEuro(row.amountEur)),
      paid: true,
    }))
    .filter(evt => evt.month);

  const fixcostInstances = expandFixcostInstances(state, { months });
  const fixcostEvents = fixcostInstances.map(inst => ({
    id: inst.id,
    month: inst.month,
    plannedEur: inst.amount,
    actualEur: inst.amount,
    paid: inst.paid === true,
  }));

  const vatPreview = computeVatPreview(state || {});
  const taxEvents = vatPreview.rows.map(row => ({
    id: `tax-${row.month}`,
    month: row.month,
    plannedEur: Math.max(0, Number(row.payable || 0)),
    actualEur: 0,
    paid: false,
  }));

  const poData = buildPoData(state);
  const foData = buildFoData(state);

  const amazonRow = buildRow({
    id: "amazon-payout",
    label: "Amazon Auszahlungen",
    level: 1,
    events: amazonEvents,
    sumMode: "generic",
  });
  const extraInRow = buildRow({
    id: "other-in",
    label: "Weitere Einzahlungen",
    level: 1,
    events: extraInEvents,
    sumMode: "generic",
  });

  const inflowRow = buildRow({
    id: "inflows",
    label: "Einzahlungen",
    level: 0,
    children: [amazonRow, extraInRow],
  });

  const poChildren = poData.map(po => {
    const poLabel = po.record?.poNo ? `PO ${po.record.poNo}` : "PO";
    const depositPaid = po.events.some(evt => /deposit/i.test(evt.typeLabel || "") && evt.paid);
    const balancePaid = po.events.some(evt => /balance/i.test(evt.typeLabel || "") && evt.paid);
    const missingInvoice = po.events.some(evt => evt.paid && !evt.hasInvoiceLink);
    const tooltipParts = [
      `PO: ${po.record?.poNo || "—"}`,
      `Supplier: ${po.supplier || "—"}`,
      `Units: ${po.units || 0}`,
      `Deposit: ${depositPaid ? "bezahlt" : "offen"}`,
      `Balance: ${balancePaid ? "bezahlt" : "offen"}`,
      `Invoice-Link: ${missingInvoice ? "fehlt" : "ok"}`,
    ];
    const paymentRows = po.events.map(evt => {
      const eventTooltip = [
        `Typ: ${evt.typeLabel || "Zahlung"}`,
        `Datum: ${evt.dueDate || "—"}`,
        `Ist EUR: ${fmtEUR(evt.actualEur || 0)}`,
        evt.currency ? `Währung: ${evt.currency}` : null,
        evt.paidBy ? `Paid by: ${evt.paidBy}` : null,
        evt.paid && !evt.hasInvoiceLink ? "Paid but missing invoice link" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return buildRow({
        id: `po-${po.record?.id || poLabel}-${evt.id}`,
        label: evt.typeLabel || evt.label || "Zahlung",
        level: 3,
        events: [evt],
        tooltip: eventTooltip,
      });
    });

    return buildRow({
      id: `po-${po.record?.id || poLabel}`,
      label: poLabel,
      level: 2,
      children: paymentRows,
      events: [],
      tooltip: tooltipParts.join(" · "),
    });
  });

  const poRow = buildRow({
    id: "po-payments",
    label: "PO Zahlungen",
    level: 1,
    children: poChildren,
    alwaysVisible: true,
  });

  const foChildren = foData.map(fo => {
    const label = fo.record?.foNo ? `FO ${fo.record.foNo}` : "FO";
    const events = fo.events.map(evt => {
      const tooltip = [
        `Typ: ${evt.typeLabel || "Payment"}`,
        `Datum: ${evt.dueDate || "—"}`,
        `Ist EUR: ${fmtEUR(evt.actualEur || 0)}`,
        evt.currency ? `Währung: ${evt.currency}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return buildRow({
        id: `fo-${fo.record?.id || label}-${evt.id}`,
        label: evt.typeLabel || evt.label || "Payment",
        level: 3,
        events: [evt],
        tooltip,
      });
    });
    return buildRow({
      id: `fo-${fo.record?.id || label}`,
      label,
      level: 2,
      children: events,
      events: [],
    });
  });

  const foRow = buildRow({
    id: "fo-payments",
    label: "FO Zahlungen",
    level: 1,
    children: foChildren,
    alwaysVisible: true,
  });

  const fixcostRow = buildRow({
    id: "fixcosts",
    label: "Fixkosten",
    level: 1,
    events: fixcostEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Fixkosten vorhanden.",
  });

  const taxRow = buildRow({
    id: "taxes",
    label: "Steuern",
    level: 1,
    events: taxEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Steuerdaten hinterlegt.",
  });

  const dividendRow = buildRow({
    id: "dividends",
    label: "Dividende",
    level: 1,
    events: dividendEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Dividenden erfasst.",
  });

  const otherOutRow = buildRow({
    id: "other-out",
    label: "Weitere Auszahlungen",
    level: 1,
    events: extraOutEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine weiteren Auszahlungen vorhanden.",
  });

  const outflowRow = buildRow({
    id: "outflows",
    label: "Auszahlungen",
    level: 0,
    children: [poRow, foRow, fixcostRow, taxRow, dividendRow, otherOutRow],
  });

  applyRowValues(inflowRow, months, mode);
  applyRowValues(outflowRow, months, mode);

  const netRow = buildRow({
    id: "net-cashflow",
    label: "Netto Cashflow",
    level: 0,
    isSummary: true,
    alwaysVisible: true,
  });
  months.forEach(month => {
    const inflow = inflowRow.values[month]?.value || 0;
    const outflow = outflowRow.values[month]?.value || 0;
    netRow.values[month] = { value: inflow - outflow, warnings: [] };
  });

  const openingRaw = state?.openingEur ?? state?.settings?.openingBalance ?? null;
  const openingBalance = parseEuro(openingRaw || 0);
  let running = openingBalance;
  let balanceRow = null;
  if (openingBalance !== 0) {
    balanceRow = buildRow({
      id: "balance",
      label: "Kontostand (kumuliert)",
      level: 0,
      isSummary: true,
      alwaysVisible: true,
    });
    months.forEach(month => {
      running += netRow.values[month]?.value || 0;
      balanceRow.values[month] = { value: running, warnings: [] };
    });
  }

  const summaryRows = [netRow];
  if (balanceRow) summaryRows.push(balanceRow);

  return { inflowRow, outflowRow, summaryRows };
}

function buildDashboardHTML(state) {
  const startMonth = state?.settings?.startMonth || "2025-01";
  const horizon = Number(state?.settings?.horizonMonths || 12) || 12;
  const endMonth = addMonths(startMonth, horizon - 1);
  const months = getMonthlyBuckets(startMonth, endMonth);
  const rangeOptions = getRangeOptions(months);
  if (rangeOptions.length && !rangeOptions.some(option => option.value === dashboardState.range)) {
    dashboardState.range = rangeOptions[0].value;
  }
  const visibleMonths = rangeOptions.length
    ? applyRange(months, dashboardState.range)
    : months.slice();

  const { inflowRow, outflowRow, summaryRows } = buildDashboardRows(state, visibleMonths, dashboardState.mode);
  const filteredInflow = filterRows(inflowRow, visibleMonths);
  const filteredOutflow = filterRows(outflowRow, visibleMonths);

  const topRows = [filteredInflow, filteredOutflow, ...summaryRows].filter(Boolean);
  const flatRows = flattenRows(topRows, dashboardState.expanded);

  const rangeSelect = rangeOptions.length
    ? `
      <label class="dashboard-range">
        <span>Monatsbereich</span>
        <select id="dashboard-range">
          ${rangeOptions.map(option => `<option value="${option.value}" ${option.value === dashboardState.range ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
    `
    : "";

  const headerCells = visibleMonths
    .map(month => `<th scope="col">${escapeHtml(month)}</th>`)
    .join("");

  const bodyRows = flatRows
    .map(row => {
      const hasChildren = row.children.length > 0;
      const isExpanded = dashboardState.expanded.has(row.id);
      const indentClass = `tree-level-${row.level}`;
      const toggle = hasChildren
        ? `<button type="button" class="tree-toggle" data-row-id="${escapeHtml(row.id)}" aria-expanded="${isExpanded}">${isExpanded ? "▼" : "▶"}</button>`
        : `<span class="tree-spacer" aria-hidden="true"></span>`;
      const labelTitle = row.tooltip || row.emptyHint || "";
      const labelCell = `
        <td class="tree-cell ${indentClass} ${row.isSummary ? "tree-summary" : ""}" title="${escapeHtml(labelTitle)}">
          ${toggle}
          <span class="tree-label">${escapeHtml(row.label)}</span>
        </td>
      `;

      const valueCells = visibleMonths
        .map(month => {
          const cell = row.values[month] || { value: 0, warnings: [] };
          const warnings = cell.warnings || [];
          const warnIcon = warnings.length
            ? `<span class="cell-warning" title="${escapeHtml(warnings.join(" · "))}">⚠</span>`
            : "";
          return `
            <td class="num ${row.isSummary ? "tree-summary" : ""}">
              ${warnIcon}
              <span>${fmtEURCell(cell.value)}</span>
            </td>
          `;
        })
        .join("");

      return `<tr data-row-id="${escapeHtml(row.id)}">${labelCell}${valueCells}</tr>`;
    })
    .join("");

  return `
    <section class="dashboard">
      <div class="dashboard-header">
        <div>
          <h2>Dashboard</h2>
          <p class="muted">Ist-/Plan-Ansicht auf Monatsbasis mit Drilldowns für PO- und FO-Zahlungen.</p>
        </div>
      </div>
      <div class="dashboard-controls">
        <div class="dashboard-toggle" role="group" aria-label="Ansicht">
          ${MODE_OPTIONS.map(option => `
            <button type="button" class="btn ${dashboardState.mode === option.key ? "primary" : "secondary"}" data-mode="${option.key}">
              ${option.label}
            </button>
          `).join("")}
        </div>
        <div class="dashboard-toggle" role="group" aria-label="Expand">
          <button type="button" class="btn secondary" data-expand="collapse">Alles zu</button>
          <button type="button" class="btn secondary" data-expand="expand">Alles auf</button>
        </div>
        ${rangeSelect}
      </div>
      <div class="dashboard-table-wrap">
        <table class="table-compact dashboard-tree-table" role="table">
          <thead>
            <tr>
              <th scope="col" class="tree-header">Kategorie / Zeile</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${bodyRows || `
              <tr>
                <td colspan="${visibleMonths.length + 1}" class="muted">Keine Daten vorhanden.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function collectExpandableIds(rows, ids = new Set()) {
  rows.forEach(row => {
    if (row.children.length) ids.add(row.id);
    row.children.forEach(child => collectExpandableIds([child], ids));
  });
  return ids;
}

function attachDashboardHandlers(root, state) {
  root.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      dashboardState.mode = btn.getAttribute("data-mode") || "ist";
      render(root);
    });
  });

  root.querySelectorAll("[data-expand]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-expand");
      const startMonth = state?.settings?.startMonth || "2025-01";
      const horizon = Number(state?.settings?.horizonMonths || 12) || 12;
      const endMonth = addMonths(startMonth, horizon - 1);
      const months = getMonthlyBuckets(startMonth, endMonth);
      const visibleMonths = applyRange(months, dashboardState.range);
      const { inflowRow, outflowRow, summaryRows } = buildDashboardRows(state, visibleMonths, dashboardState.mode);
      const topRows = [filterRows(inflowRow, visibleMonths), filterRows(outflowRow, visibleMonths), ...summaryRows].filter(Boolean);
      const expandableIds = collectExpandableIds(topRows);
      if (action === "collapse") {
        dashboardState.expanded = new Set();
      } else {
        dashboardState.expanded = new Set(expandableIds);
      }
      render(root);
    });
  });

  root.querySelectorAll(".tree-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const rowId = btn.getAttribute("data-row-id");
      if (!rowId) return;
      if (dashboardState.expanded.has(rowId)) dashboardState.expanded.delete(rowId);
      else dashboardState.expanded.add(rowId);
      render(root);
    });
  });

  const rangeSelect = root.querySelector("#dashboard-range");
  if (rangeSelect) {
    rangeSelect.addEventListener("change", () => {
      dashboardState.range = rangeSelect.value;
      render(root);
    });
  }
}

let dashboardRoot = null;
let stateListenerOff = null;

export function render(root) {
  dashboardRoot = root;
  const state = loadState();
  root.innerHTML = buildDashboardHTML(state);
  attachDashboardHandlers(root, state);

  if (!stateListenerOff) {
    stateListenerOff = addStateListener(() => {
      if (location.hash.replace("#", "") === "dashboard" && dashboardRoot) render(dashboardRoot);
    });
  }
}

export default { render };

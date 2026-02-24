import { loadState, getProductsSnapshot } from "../data/storageLocal.js";
import { getSettings } from "./orderEditorFactory.js";
import { formatEurDE } from "./utils/numberFormat.js";
import { buildPaymentJournalRowsCore } from "../domain/paymentJournalCore.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return "—";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtEurPlain(value) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  return Number.isFinite(num)
    ? `${formatEurDE(num, 2)} EUR`
    : "—";
}

function formatCsvNumber(value) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return formatEurDE(num, 2);
}

function toCsv(rows, headers, delimiter = ";") {
  const escapeCell = (value) => {
    const raw = value == null ? "" : String(value);
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
  };
  const head = headers.map((header) => escapeCell(header.label)).join(delimiter);
  const body = rows.map((row) => headers.map((header) => escapeCell(row[header.key])).join(delimiter)).join("\n");
  return `${head}\n${body}`;
}

function normalizeScope(includePaid, includeOpen) {
  if (includePaid && includeOpen) return "both";
  if (includeOpen) return "open";
  return "paid";
}

function isActualAmountValid(amount, planned) {
  if (!Number.isFinite(Number(amount))) return false;
  const actual = Number(amount);
  const plannedValue = Number.isFinite(Number(planned)) ? Number(planned) : null;
  if (actual > 0) return true;
  if (actual === 0 && plannedValue != null && plannedValue === 0) return true;
  return false;
}

const ISSUE_LABELS = {
  DATE_UNCERTAIN: "Datum unsicher (Due-Date verwendet).",
  AUTO_GENERATED: "Auto generiert (bitte pruefen).",
  IST_FEHLT: "Ist fehlt (Plan als Fallback).",
  MISSING_ACTUAL_AMOUNT: "Ist-Zahlung fehlt.",
  PRO_RATA_ALLOCATION: "Ist wurde anteilig verteilt.",
  GROUPED_PAYMENT: "Mehrere Positionen in einer Zahlung.",
  PAID_WITHOUT_DATE: "Bezahlt ohne Datum.",
};

function summarizeIssues(issues = []) {
  const mapped = Array.from(new Set((Array.isArray(issues) ? issues : [])
    .map((code) => ISSUE_LABELS[String(code)] || String(code))
    .filter(Boolean)));
  return mapped.length ? mapped.join(" ") : "—";
}

function paymentDateForRow(row) {
  if (!row) return "";
  return row.status === "PAID" ? (row.paidDate || row.dueDate || "") : (row.dueDate || "");
}

export function buildPaymentJournalRowsFromState(state, { month = "", scope = "both" } = {}, options = {}) {
  const sourceState = state && typeof state === "object" ? state : {};
  const settings = options.settings || getSettings();
  const products = options.products || getProductsSnapshot();
  return buildPaymentJournalRowsCore({
    state: sourceState,
    settings,
    products,
    month,
    scope,
    includeFo: true,
  });
}

function buildPaymentJournalRows({ month, scope }) {
  const state = loadState();
  return buildPaymentJournalRowsFromState(state, { month, scope });
}

function buildCsvRows(rows) {
  return rows.map((row) => ({
    paymentDate: paymentDateForRow(row),
    status: row.status,
    entityType: row.entityType,
    poOrFoNumber: row.entityType === "PO" ? (row.poNumber || "") : (row.foNumber || ""),
    supplierName: row.supplierName,
    item: row.itemSummary || row.skuAliases || "",
    includedPositions: row.paymentType || "",
    amountActualEur: row.status === "PAID" ? formatCsvNumber(row.amountActualEur) : "",
    amountPlannedEur: formatCsvNumber(row.amountPlannedEur),
    payer: row.payer || "",
    paymentMethod: row.paymentMethod || "",
    note: row.note || "",
    issues: Array.isArray(row.issues) ? row.issues.join("|") : "",
    paymentId: row.paymentId || "",
    internalId: row.internalId || "",
  }));
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function openPrintView(rows, { month, scope }) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;
  const scopeLabel = scope === "paid" ? "Paid" : scope === "open" ? "Open" : "Both";
  const title = `Zahlungsjournal ${month || ""}`.trim();
  const paidSum = sumRows(rows.filter((row) => row.status === "PAID"), "amountActualEur");
  const openSum = sumRows(rows.filter((row) => row.status === "OPEN"), "amountPlannedEur");
  const tableRows = rows.map((row) => `
    <tr>
      <td>${paymentDateForRow(row) || ""}</td>
      <td>${row.status}</td>
      <td>${row.entityType === "PO" ? (row.poNumber || "") : (row.foNumber || "")}</td>
      <td>${row.supplierName || ""}</td>
      <td>${row.itemSummary || row.skuAliases || ""}</td>
      <td>${row.paymentType || ""}</td>
      <td>${row.status === "PAID" ? formatCsvNumber(row.amountActualEur) : ""}</td>
      <td>${formatCsvNumber(row.amountPlannedEur)}</td>
      <td>${row.payer || ""}</td>
      <td>${row.paymentMethod || ""}</td>
      <td>${row.note || ""}</td>
      <td>${summarizeIssues(row.issues)}</td>
    </tr>
  `).join("");

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: #0f1b2d; margin: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .summary { margin-bottom: 12px; font-size: 12px; color: #6b7280; }
    .actions { margin-bottom: 16px; }
    .btn { background: #3bc2a7; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #d7dde5; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f7fa; font-weight: 600; }
    .totals { margin-top: 12px; font-size: 12px; }
    @media print {
      body { margin: 12mm; }
      .actions { display: none; }
      @page { size: A4; margin: 12mm; }
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="summary">Scope: ${scopeLabel} · Rows: ${rows.length}</div>
  <div class="actions"><button class="btn" onclick="window.print()">Drucken / Als PDF speichern</button></div>
  <table>
    <thead>
      <tr>
        <th>Zahlungsdatum</th>
        <th>Status</th>
        <th>PO/FO Nr</th>
        <th>Supplier</th>
        <th>Item</th>
        <th>Positionen</th>
        <th>Ist EUR</th>
        <th>Plan EUR</th>
        <th>Zahler</th>
        <th>Methode</th>
        <th>Notiz</th>
        <th>Hinweise</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <div class="totals">
    <div>Sum Actual EUR (PAID): ${formatCsvNumber(paidSum)}</div>
    <div>Sum Planned EUR (OPEN): ${formatCsvNumber(openSum)}</div>
  </div>
</body>
</html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

export function render(root) {
  const filterMonth = el("input", { type: "month", value: currentMonthKey() });
  const includePaidInput = el("input", { type: "checkbox", checked: "checked" });
  const includeOpenInput = el("input", { type: "checkbox" });

  const formatOptions = [
    { value: "csv", label: "CSV" },
    { value: "print", label: "PDF (Print)" },
  ];
  function buildSegmented(name, options, defaultValue) {
    const wrapper = el("div", { class: "segment-control" });
    options.forEach((option) => {
      const input = el("input", { type: "radio", name, value: option.value, id: `${name}-${option.value}` });
      if (option.value === defaultValue) input.checked = true;
      const label = el("label", { for: `${name}-${option.value}` }, [option.label]);
      wrapper.append(input, label);
    });
    return wrapper;
  }
  const formatControl = buildSegmented("payment-format", formatOptions, "csv");

  const table = el("table", {
    class: "table-compact ui-table-standard ui-data-table payments-export-table",
    "data-ui-table": "true",
    "data-sticky-cols": "1",
  });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["Zahlungsdatum"]),
      el("th", {}, ["Status"]),
      el("th", {}, ["PO/FO Nr"]),
      el("th", {}, ["Lieferant"]),
      el("th", {}, ["Item"]),
      el("th", {}, ["Enthaltene Positionen"]),
      el("th", { class: "num" }, ["Ist EUR"]),
      el("th", { class: "num" }, ["Plan EUR"]),
      el("th", {}, ["Zahler"]),
      el("th", {}, ["Methode"]),
      el("th", {}, ["Notiz"]),
      el("th", {}, ["Hinweise"]),
    ]),
  ]);
  const tbody = el("tbody");
  table.append(thead, tbody);

  function getFormatValue() {
    const checked = formatControl.querySelector("input:checked");
    return checked ? checked.value : "csv";
  }

  function getScopeValue() {
    const includePaid = includePaidInput.checked;
    const includeOpen = includeOpenInput.checked;
    return normalizeScope(includePaid, includeOpen);
  }

  function renderRows() {
    tbody.innerHTML = "";
    const month = filterMonth.value || "";
    const rows = buildPaymentJournalRows({
      month,
      scope: getScopeValue(),
    });

    if (!rows.length) {
      tbody.append(el("tr", {}, [
        el("td", { colspan: "12", class: "muted" }, ["Keine Zahlungen gefunden."]),
      ]));
      return rows;
    }

    rows.forEach((row) => {
      const paymentDate = paymentDateForRow(row);
      const hasActual = isActualAmountValid(row.amountActualEur, row.amountPlannedEur);
      const actualValue = row.status === "PAID" ? (hasActual ? fmtEurPlain(row.amountActualEur) : "—") : "—";
      const itemText = row.itemSummary || row.skuAliases || "—";
      const issueText = summarizeIssues(row.issues);
      const issueTooltip = (Array.isArray(row.issues) ? row.issues : []).join("\n");
      const entityRef = row.entityType === "PO" ? (row.poNumber || "—") : (row.foNumber || "—");
      const showWarning = row.status === "PAID" && !hasActual;
      const rowClass = showWarning ? "payments-export-row-warning" : "";
      tbody.append(el("tr", { class: rowClass }, [
        el("td", {}, [fmtDate(paymentDate)]),
        el("td", {}, [row.status === "PAID" ? "Bezahlt" : "Offen"]),
        el("td", {}, [entityRef]),
        el("td", {}, [row.supplierName || "—"]),
        el("td", { "data-ui-tooltip": row.itemTooltip || row.skuAliases || "—" }, [itemText]),
        el("td", { "data-ui-tooltip": (Array.isArray(row.includedPositions) ? row.includedPositions.join(", ") : row.paymentType) || "—" }, [row.paymentType || "—"]),
        el("td", { class: "num" }, [actualValue]),
        el("td", { class: "num" }, [fmtEurPlain(row.amountPlannedEur)]),
        el("td", {}, [row.payer || "—"]),
        el("td", {}, [row.paymentMethod || "—"]),
        el("td", { "data-ui-tooltip": row.note || "—" }, [row.note || "—"]),
        el("td", { "data-ui-tooltip": issueTooltip || "—" }, [
          issueText,
          showWarning ? el("span", { class: "cell-warning", title: "Bezahlt, aber Ist-Zahlung fehlt." }, ["⚠︎"]) : null,
        ]),
      ]));
    });

    return rows;
  }

  const exportBtn = el("button", { class: "btn primary", type: "button" }, ["Export"]);
  const previewBtn = el("button", { class: "btn secondary", type: "button" }, ["Preview"]);
  const infoNode = el("p", { class: "muted payments-export-info" }, [
    "Monatsfilter basiert auf Zahlungsdatum. Falls eine Zahlung als bezahlt markiert ist, aber kein Zahlungsdatum hat, wird die Faelligkeit als Datum verwendet und als unsicher markiert.",
  ]);

  exportBtn.addEventListener("click", () => {
    const month = filterMonth.value || "";
    const scope = getScopeValue();
    const rows = buildPaymentJournalRows({ month, scope });
    if (!rows.length) {
      window.alert("Keine passenden Zahlungen fuer den Export gefunden.");
      return;
    }
    const format = getFormatValue();
    if (format === "print") {
      openPrintView(rows, { month, scope });
      return;
    }

    const headers = [
      { key: "paymentDate", label: "paymentDate" },
      { key: "status", label: "status" },
      { key: "entityType", label: "entityType" },
      { key: "poOrFoNumber", label: "poOrFoNumber" },
      { key: "supplierName", label: "supplierName" },
      { key: "item", label: "item" },
      { key: "includedPositions", label: "includedPositions" },
      { key: "amountActualEur", label: "amountActualEur" },
      { key: "amountPlannedEur", label: "amountPlannedEur" },
      { key: "payer", label: "payer" },
      { key: "paymentMethod", label: "paymentMethod" },
      { key: "note", label: "note" },
      { key: "issues", label: "issues" },
      { key: "paymentId", label: "paymentId" },
      { key: "internalId", label: "internalId" },
    ];
    const csvRows = buildCsvRows(rows);
    const csv = toCsv(csvRows, headers, ";");
    const fileMonth = month || currentMonthKey();
    const fileName = `payment_journal_${fileMonth}_${scope}.csv`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  previewBtn.addEventListener("click", () => {
    renderRows();
  });
  filterMonth.addEventListener("change", renderRows);
  includePaidInput.addEventListener("change", renderRows);
  includeOpenInput.addEventListener("change", renderRows);

  root.innerHTML = "";
  root.append(
    el("section", { class: "card" }, [
      el("div", { class: "ui-page-head" }, [
        el("div", {}, [
          el("h2", {}, ["Payments Export"]),
          infoNode,
        ]),
      ]),
      el("div", { class: "payments-export-toolbar" }, [
        el("div", { class: "payments-export-filters" }, [
          el("label", { class: "payments-export-field" }, [
            el("span", {}, ["Monat (bezahlt)"]),
            filterMonth,
          ]),
          el("label", { class: "payments-export-field payments-export-check" }, [
            el("span", {}, ["Filter"]),
            el("span", { class: "row" }, [includePaidInput, el("span", {}, ["Nur bezahlt"])]),
          ]),
          el("label", { class: "payments-export-field payments-export-check" }, [
            el("span", {}, ["Ansicht"]),
            el("span", { class: "row" }, [includeOpenInput, el("span", {}, ["Offen/geplant anzeigen"])]),
          ]),
          el("div", { class: "payments-export-field" }, [
            el("span", {}, ["Format"]),
            formatControl,
          ]),
        ]),
        el("div", { class: "payments-export-actions" }, [exportBtn, previewBtn]),
      ]),
      el("div", { class: "table-wrap ui-table-shell ui-scroll-host payments-export-scroll" }, [table]),
    ]),
  );

  renderRows();
}

export default { render };


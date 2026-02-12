import { loadState, getProductsSnapshot } from "../data/storageLocal.js";
import { buildPaymentRows, getSettings } from "./orderEditorFactory.js";
import { formatEurDE } from "./utils/numberFormat.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach(child => {
    if (child == null) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
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
  const escapeCell = value => {
    const raw = value == null ? "" : String(value);
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
  };
  const head = headers.map(h => escapeCell(h.label)).join(delimiter);
  const body = rows.map(row => headers.map(h => escapeCell(row[h.key])).join(delimiter)).join("\n");
  return `${head}\n${body}`;
}

function buildSupplierNameMap(state) {
  const map = new Map();
  (state.suppliers || []).forEach(supplier => {
    if (!supplier) return;
    const name = String(supplier.name || "").trim();
    if (!name) return;
    const idKey = normalizeKey(supplier.id);
    const nameKey = normalizeKey(name);
    if (idKey) map.set(idKey, name);
    if (nameKey) map.set(nameKey, name);
  });
  return map;
}

function resolveSupplierName(record, supplierNameMap) {
  const fallback = record.supplierName || record.supplier || "";
  const key = normalizeKey(record.supplierId || record.supplier || record.supplierName || "");
  return supplierNameMap.get(key) || (fallback ? String(fallback) : "—");
}

function buildSkuAliasMap(products) {
  const map = new Map();
  (products || []).forEach(prod => {
    const key = normalizeKey(prod?.sku);
    if (!key) return;
    map.set(key, prod?.alias || prod?.sku || "");
  });
  return map;
}

function resolveSkuAliases(record, skuAliasMap) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  const skus = items.length ? items.map(item => item?.sku).filter(Boolean) : [record?.sku];
  const aliases = Array.from(new Set(skus.map(sku => {
    const key = normalizeKey(sku);
    return key ? (skuAliasMap.get(key) || sku) : null;
  }).filter(Boolean)));
  return aliases.join(", ") || "—";
}

function normalizePaymentType({ label, eventType }) {
  const lowered = String(label || "").toLowerCase();
  if (eventType === "fx_fee" || lowered.includes("fx")) return null;
  if (eventType === "freight" || lowered.includes("shipping") || lowered.includes("fracht")) return "Fracht";
  if (eventType === "eust" || lowered.includes("eust")) return "EUSt";
  if (lowered.includes("balance2") || lowered.includes("balance 2") || lowered.includes("second balance")) return "Balance2";
  if (lowered.includes("balance") || lowered.includes("rest")) return "Balance";
  if (lowered.includes("deposit") || lowered.includes("anzahlung")) return "Deposit";
  return null;
}

function allocateByPlanned(total, events = []) {
  const plannedValues = events.map(evt => Number(evt.plannedEur || 0));
  const sumPlanned = plannedValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(sumPlanned) || sumPlanned <= 0) return null;
  const allocations = plannedValues.map((planned, index) => {
    const share = planned / sumPlanned;
    const raw = total * share;
    return {
      eventId: events[index].id,
      planned,
      raw,
      actual: Math.round(raw * 100) / 100,
    };
  });
  const roundedSum = allocations.reduce((sum, entry) => sum + entry.actual, 0);
  const remainder = Math.round((total - roundedSum) * 100) / 100;
  if (Math.abs(remainder) > 0) {
    let target = allocations[allocations.length - 1];
    if (allocations.length > 1) {
      target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
    }
    target.actual = Math.round((target.actual + remainder) * 100) / 100;
  }
  return allocations;
}

function buildPaymentIndexes(payments = []) {
  const byId = new Map();
  const allocationByEvent = new Map();
  (payments || []).forEach(payment => {
    if (!payment?.id) return;
    byId.set(payment.id, payment);
    if (Array.isArray(payment.allocations)) {
      payment.allocations.forEach(entry => {
        if (!entry?.eventId) return;
        allocationByEvent.set(entry.eventId, entry);
      });
    }
  });
  return { byId, allocationByEvent };
}

function resolveActualAllocation({ payment, paymentRow, paymentRows }) {
  if (!payment || !paymentRow?.paymentId) return null;
  const total = Number(payment.amountActualEurTotal);
  if (!Number.isFinite(total)) return null;
  const related = (paymentRows || []).filter(row => row.paymentId && row.paymentId === paymentRow.paymentId);
  if (!related.length) return null;
  const allocations = allocateByPlanned(total, related);
  if (!allocations) return null;
  return allocations.find(entry => entry.eventId === paymentRow.id) || null;
}

function getRowMonth(row) {
  const date = row.status === "PAID" ? row.paidDate : row.dueDate;
  return date ? date.slice(0, 7) : "";
}

function isActualAmountValid(amount, planned) {
  if (!Number.isFinite(Number(amount))) return false;
  const actual = Number(amount);
  const plannedValue = Number.isFinite(Number(planned)) ? Number(planned) : null;
  if (actual > 0) return true;
  if (actual === 0 && plannedValue != null && plannedValue === 0) return true;
  return false;
}

function resolveActualAmountForLine({ row, paymentRow, paymentRows, paymentRecord, paymentIndexes, state }) {
  const issues = [];
  if (row.status !== "PAID") return { amountActualEur: null, issues };
  if (!row.paidDate) issues.push("PAID_WITHOUT_DATE");

  if (Number.isFinite(Number(paymentRow?.paidEurActual))) {
    if (isActualAmountValid(paymentRow.paidEurActual, row.amountPlannedEur)) {
      return { amountActualEur: Number(paymentRow.paidEurActual), issues };
    }
    issues.push("MISSING_ACTUAL_AMOUNT");
    return { amountActualEur: Number(paymentRow.paidEurActual), issues };
  }

  if (paymentRecord?.allocations?.length) {
    const allocation = paymentRecord.allocations.find(entry => {
      if (!entry) return false;
      if (entry.eventId && paymentRow?.id && entry.eventId === paymentRow.id) return true;
      if (entry.plannedId && paymentRow?.id && entry.plannedId === paymentRow.id) return true;
      if (entry.entityType && entry.paymentType) {
        const matchesType = String(entry.paymentType) === String(row.paymentType);
        const matchesEntity = String(entry.entityType) === String(row.entityType);
        const matchesNumber = row.entityType === "PO"
          ? String(entry.poNumber || "") === String(row.poNumber || "")
          : String(entry.foNumber || "") === String(row.foNumber || "");
        return matchesType && matchesEntity && matchesNumber;
      }
      return false;
    });
    if (allocation && isActualAmountValid(allocation.amountEur, row.amountPlannedEur)) {
      return { amountActualEur: Number(allocation.amountEur), issues };
    }
  }

  if (paymentRecord && paymentRow?.paymentId) {
    const allocation = paymentIndexes?.allocationByEvent?.get(paymentRow.id)
      || resolveActualAllocation({ payment: paymentRecord, paymentRow, paymentRows });
    if (allocation && isActualAmountValid(allocation.actual, row.amountPlannedEur)) {
      issues.push("PRO_RATA_ALLOCATION");
      return { amountActualEur: Number(allocation.actual), issues };
    }
    if (isActualAmountValid(paymentRecord.amountActualEurTotal, row.amountPlannedEur) && paymentRows?.length === 1) {
      return { amountActualEur: Number(paymentRecord.amountActualEurTotal), issues };
    }
  }

  if (!paymentRow?.paymentId && row.paidDate && paymentRow?.id) {
    const match = (state.payments || []).find(payment => {
      if (!payment) return false;
      if (payment.paidDate !== row.paidDate) return false;
      if (Array.isArray(payment.coveredEventIds) && payment.coveredEventIds.includes(paymentRow.id)) return true;
      return false;
    });
    if (match && isActualAmountValid(match.amountActualEurTotal, row.amountPlannedEur)) {
      return { amountActualEur: Number(match.amountActualEurTotal), issues };
    }
  }

  issues.push("MISSING_ACTUAL_AMOUNT");
  return { amountActualEur: null, issues };
}

function buildPaymentJournalRows({ month, scope }) {
  const state = loadState();
  const settings = getSettings();
  const products = getProductsSnapshot();
  const supplierNameMap = buildSupplierNameMap(state);
  const skuAliasMap = buildSkuAliasMap(products);
  const poRecords = Array.isArray(state.pos) ? state.pos : [];
  const foRecords = Array.isArray(state.fos) ? state.fos : [];
  const paymentIndexes = buildPaymentIndexes(state.payments || []);
  const rows = [];

  const poConfig = { slug: "po", entityLabel: "PO", numberField: "poNo" };

  poRecords.forEach(record => {
    if (!record) return;
    const supplierName = resolveSupplierName(record, supplierNameMap);
    const skuAliases = resolveSkuAliases(record, skuAliasMap);
    const snapshot = JSON.parse(JSON.stringify(record));
    const payments = buildPaymentRows(snapshot, poConfig, settings, state.payments || []);
    payments.forEach(payment => {
      const paymentType = normalizePaymentType({ label: payment.typeLabel || payment.label, eventType: payment.eventType });
      if (!paymentType) return;
      const paymentRecord = payment.paymentId ? paymentIndexes.byId.get(payment.paymentId) : null;
      const status = payment.status === "paid" || payment.status === "PAID" ? "PAID" : "OPEN";
      const dueDate = payment.dueDate || "";
      const paidDate = paymentRecord?.paidDate || payment.paidDate || "";
      const planned = Number.isFinite(Number(payment.plannedEur)) ? Number(payment.plannedEur) : null;
      const entityId = record.id || record.poNo || "";
      const rowId = `PO-${entityId}-${paymentType}-${dueDate || paidDate || ""}`;
      const rowBase = {
        rowId,
        eventId: payment.id,
        month: getRowMonth({ status, dueDate, paidDate }),
        entityType: "PO",
        poNumber: record.poNo || "",
        foNumber: "",
        supplierName,
        skuAliases,
        paymentType,
        status,
        dueDate,
        paidDate,
        paymentId: payment.paymentId || "",
        amountPlannedEur: planned,
        payer: payment.paidBy || "",
        paymentMethod: payment.method || "",
        note: payment.note || "",
        internalId: payment.paymentInternalId || payment.id || record.id || rowId,
      };
      const { amountActualEur, issues } = resolveActualAmountForLine({
        row: rowBase,
        paymentRow: payment,
        paymentRows: payments,
        paymentRecord,
        paymentIndexes,
        state,
      });
      rows.push({
        ...rowBase,
        amountActualEur,
        issues,
      });
    });
  });

  foRecords.forEach(record => {
    if (!record || !Array.isArray(record.payments)) return;
    const supplierName = resolveSupplierName(record, supplierNameMap);
    const skuAliases = record.sku
      ? (skuAliasMap.get(normalizeKey(record.sku)) || record.sku)
      : "—";
    const fxRate = Number(record.fxRate || 0);
    record.payments.forEach(payment => {
      if (!payment) return;
      if (payment.category === "eust_refund") return;
      const paymentType = normalizePaymentType({ label: payment.label, eventType: payment.category });
      if (!paymentType) return;
      const rawAmount = Number(payment.amount || 0);
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;
      const currency = payment.currency || "EUR";
      const planned = currency === "EUR" ? rawAmount : (fxRate > 0 ? rawAmount / fxRate : rawAmount);
      const dueDate = payment.dueDate || "";
      const entityId = record.id || record.foNumber || "";
      const rowId = `FO-${entityId}-${paymentType}-${dueDate || ""}`;
      rows.push({
        rowId,
        eventId: payment.id || rowId,
        month: getRowMonth({ status: "OPEN", dueDate, paidDate: "" }),
        entityType: "FO",
        poNumber: record.convertedPoNo || "",
        foNumber: record.foNumber || record.id || "",
        supplierName,
        skuAliases,
        paymentType,
        status: "OPEN",
        dueDate,
        paidDate: "",
        paymentId: "",
        amountPlannedEur: planned,
        amountActualEur: null,
        payer: "",
        paymentMethod: "",
        note: "",
        internalId: record.id || rowId,
        issues: [],
      });
    });
  });

  const scopeValue = scope || "both";
  const filtered = rows.filter(row => {
    if (scopeValue === "paid" && row.status !== "PAID") return false;
    if (scopeValue === "open" && row.status !== "OPEN") return false;
    if (month && row.month !== month) return false;
    return true;
  });

  const deduped = [];
  const seen = new Set();
  filtered.forEach(row => {
    if (seen.has(row.rowId)) return;
    seen.add(row.rowId);
    deduped.push(row);
  });

  return deduped.sort((a, b) => {
    const left = a.dueDate || a.paidDate || "";
    const right = b.dueDate || b.paidDate || "";
    return left.localeCompare(right);
  });
}

function buildCsvRows(rows) {
  return rows.map(row => ({
    month: row.month || "",
    entityType: row.entityType,
    poNumber: row.poNumber,
    foNumber: row.foNumber,
    supplierName: row.supplierName,
    skuAliases: row.skuAliases,
    paymentType: row.paymentType,
    status: row.status,
    dueDate: row.dueDate,
    paidDate: row.paidDate,
    amountPlannedEur: formatCsvNumber(row.amountPlannedEur),
    amountActualEur: row.status === "PAID" ? formatCsvNumber(row.amountActualEur) : "",
    issues: row.issues?.length ? row.issues.join("|") : "",
    paymentId: row.paymentId || "",
    payer: row.payer,
    paymentMethod: row.paymentMethod,
    note: row.note,
    internalId: row.internalId,
  }));
}

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

let exportAssertionsRan = false;

function runExportAssertions() {
  if (exportAssertionsRan) return;
  exportAssertionsRan = true;
  const sampleEvents = [
    { id: "dep", plannedEur: 3000, dueDate: "2025-01-10", status: "open" },
    { id: "bal", plannedEur: 7000, dueDate: "2025-02-10", status: "open" },
  ];
  const allocations = allocateByPlanned(9500, sampleEvents) || [];
  const totalAllocated = allocations.reduce((sum, entry) => sum + Number(entry.actual || 0), 0);
  console.assert(Math.round(totalAllocated * 100) / 100 === 9500, "Allocation sum should match total");
  const depAlloc = allocations.find(entry => entry.eventId === "dep");
  console.assert(depAlloc && Math.round(depAlloc.actual * 100) / 100 === 2850, "Deposit allocation should be proportional");
  console.assert(sampleEvents[0].plannedEur === 3000 && sampleEvents[1].plannedEur === 7000, "Planned values should remain unchanged");
}

function openPrintView(rows, { month, scope }) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) return;
  const scopeLabel = scope === "paid" ? "Paid" : scope === "open" ? "Open" : "Both";
  const title = `Zahlungsjournal ${month || ""}`.trim();
  const paidSum = sumRows(rows.filter(row => row.status === "PAID"), "amountActualEur");
  const openSum = sumRows(rows.filter(row => row.status === "OPEN"), "amountPlannedEur");
  const tableRows = rows.map(row => `
    <tr>
      <td>${row.entityType}</td>
      <td>${row.entityType === "PO" ? row.poNumber : row.foNumber}</td>
      <td>${row.supplierName}</td>
      <td>${row.paymentType}</td>
      <td>${row.status}</td>
      <td>${row.dueDate || ""}</td>
      <td>${row.paidDate || ""}</td>
      <td>${row.status === "PAID" ? formatCsvNumber(row.amountActualEur) : ""}</td>
      <td>${row.issues?.length ? row.issues.join(" | ") : ""}</td>
      <td>${row.paymentId || ""}</td>
      <td>${row.paymentMethod || ""}</td>
      <td>${row.payer || ""}</td>
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
        <th>Typ</th>
        <th>PO/FO Nr</th>
        <th>Supplier</th>
        <th>PaymentType</th>
        <th>Status</th>
        <th>DueDate</th>
        <th>PaidDate</th>
        <th>Ist EUR</th>
        <th>Issues</th>
        <th>PaymentId</th>
        <th>Methode</th>
        <th>Zahler</th>
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

  const scopeOptions = [
    { value: "paid", label: "Paid" },
    { value: "open", label: "Open" },
    { value: "both", label: "Both" },
  ];
  const formatOptions = [
    { value: "csv", label: "CSV" },
    { value: "print", label: "PDF (Print)" },
  ];

  function buildSegmented(name, options, defaultValue) {
    const wrapper = el("div", { class: "segment-control" });
    options.forEach(option => {
      const input = el("input", { type: "radio", name, value: option.value, id: `${name}-${option.value}` });
      if (option.value === defaultValue) input.checked = true;
      const label = el("label", { for: `${name}-${option.value}` }, [option.label]);
      wrapper.append(input, label);
    });
    return wrapper;
  }

  const scopeControl = buildSegmented("payment-scope", scopeOptions, "both");
  const formatControl = buildSegmented("payment-format", formatOptions, "csv");

  const table = el("table", {
    class: "table-compact ui-data-table payments-export-table",
    "data-ui-table": "true",
    "data-sticky-cols": "1",
  });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["Monat"]),
      el("th", {}, ["Typ"]),
      el("th", {}, ["PO/FO Nr"]),
      el("th", {}, ["Supplier"]),
      el("th", {}, ["SKU Alias"]),
      el("th", {}, ["Payment Type"]),
      el("th", {}, ["Status"]),
      el("th", {}, ["Fällig"]),
      el("th", {}, ["Bezahlt"]),
      el("th", { class: "num" }, ["Soll EUR"]),
      el("th", { class: "num" }, ["Ist EUR"]),
      el("th", {}, ["Issues"]),
      el("th", {}, ["Payment ID"]),
      el("th", {}, ["Zahler"]),
      el("th", {}, ["Methode"]),
      el("th", {}, ["Notiz"]),
    ]),
  ]);
  const tbody = el("tbody");
  table.append(thead, tbody);

  function getScopeValue() {
    const checked = scopeControl.querySelector("input:checked");
    return checked ? checked.value : "both";
  }

  function getFormatValue() {
    const checked = formatControl.querySelector("input:checked");
    return checked ? checked.value : "csv";
  }

  function renderRows() {
    tbody.innerHTML = "";
    const month = filterMonth.value || "";
    const scope = getScopeValue();
    const rows = buildPaymentJournalRows({ month, scope });
    runExportAssertions();
    rows.forEach(row => {
      if (row.status === "PAID" && Number.isFinite(Number(row.amountActualEur))) {
        const planned = Number.isFinite(Number(row.amountPlannedEur)) ? Number(row.amountPlannedEur) : null;
        if (planned == null || planned > 0) {
          console.assert(Number(row.amountActualEur) > 0, "Paid rows should not have 0 actual amounts");
        }
      }
    });

    if (!rows.length) {
      tbody.append(el("tr", {}, [
        el("td", { colspan: "16", class: "muted" }, ["Keine Zahlungen gefunden."]),
      ]));
      return rows;
    }

    rows.forEach(row => {
      const hasActual = isActualAmountValid(row.amountActualEur, row.amountPlannedEur);
      const actualValue = hasActual ? fmtEurPlain(row.amountActualEur) : "—";
      const issueText = row.issues?.length ? row.issues.join(" | ") : "";
      const showWarning = row.status === "PAID" && !hasActual;
      const entityRef = row.entityType === "PO" ? row.poNumber || "—" : row.foNumber || "—";
      const entityTooltip = [
        `${row.entityType}: ${entityRef}`,
        row.skuAliases ? `Alias: ${row.skuAliases}` : "",
        row.supplierName ? `Supplier: ${row.supplierName}` : "",
        row.paymentType ? `Payment: ${row.paymentType}` : "",
      ].filter(Boolean).join("\n");
      tbody.append(el("tr", {}, [
        el("td", {}, [row.month || "—"]),
        el("td", {}, [row.entityType]),
        el("td", { "data-ui-tooltip": entityTooltip }, [entityRef]),
        el("td", {}, [row.supplierName]),
        el("td", { "data-ui-tooltip": row.skuAliases || "—" }, [row.skuAliases]),
        el("td", {}, [row.paymentType]),
        el("td", {}, [row.status === "PAID" ? "Bezahlt" : "Offen"]),
        el("td", {}, [fmtDate(row.dueDate)]),
        el("td", {}, [fmtDate(row.paidDate)]),
        el("td", { class: "num" }, [fmtEurPlain(row.amountPlannedEur)]),
        el("td", { class: "num" }, [
          row.status === "PAID" ? actualValue : "—",
          showWarning ? el("span", { class: "cell-warning", title: "Bezahlt, aber keine Ist-Zahlung zugeordnet" }, ["⚠︎"]) : null,
        ]),
        el("td", {}, [issueText || "—"]),
        el("td", {}, [row.paymentId || "—"]),
        el("td", {}, [row.payer || "—"]),
        el("td", {}, [row.paymentMethod || "—"]),
        el("td", {}, [row.note || "—"]),
      ]));
    });

    return rows;
  }

  const exportBtn = el("button", { class: "btn primary", type: "button" }, ["Export"]);
  const previewBtn = el("button", { class: "btn secondary", type: "button" }, ["Preview"]);

  exportBtn.addEventListener("click", () => {
    const month = filterMonth.value || "";
    const scope = getScopeValue();
    const rows = buildPaymentJournalRows({ month, scope });
    if (!rows.length) {
      window.alert("Keine passenden Zahlungen für den Export gefunden.");
      return;
    }
    const format = getFormatValue();
    if (format === "print") {
      openPrintView(rows, { month, scope });
      return;
    }
    const headers = [
      { key: "month", label: "month" },
      { key: "entityType", label: "entityType" },
      { key: "poNumber", label: "poNumber" },
      { key: "foNumber", label: "foNumber" },
      { key: "supplierName", label: "supplierName" },
      { key: "skuAliases", label: "skuAliases" },
      { key: "paymentType", label: "paymentType" },
      { key: "status", label: "status" },
      { key: "dueDate", label: "dueDate" },
      { key: "paidDate", label: "paidDate" },
      { key: "amountPlannedEur", label: "amountPlannedEur" },
      { key: "amountActualEur", label: "amountActualEur" },
      { key: "issues", label: "issues" },
      { key: "paymentId", label: "paymentId" },
      { key: "payer", label: "payer" },
      { key: "paymentMethod", label: "paymentMethod" },
      { key: "note", label: "note" },
      { key: "internalId", label: "internalId" },
    ];
    const csvRows = buildCsvRows(rows);
    const csv = toCsv(csvRows, headers, ";");
    const scopeLabel = scope || "both";
    const fileMonth = month || currentMonthKey();
    const fileName = `payment_journal_${fileMonth}_${scopeLabel}.csv`;
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
  scopeControl.addEventListener("change", renderRows);

  root.innerHTML = "";
  root.append(
    el("section", { class: "card" }, [
      el("h2", {}, ["Payment Exports"]),
      el("div", { class: "payments-export-toolbar" }, [
        el("div", { class: "payments-export-filters" }, [
          el("label", { class: "payments-export-field" }, [
            el("span", {}, ["Monat"]),
            filterMonth,
          ]),
          el("div", { class: "payments-export-field" }, [
            el("span", {}, ["Scope"]),
            scopeControl,
          ]),
          el("div", { class: "payments-export-field" }, [
            el("span", {}, ["Format"]),
            formatControl,
          ]),
        ]),
        el("div", { class: "payments-export-actions" }, [exportBtn, previewBtn]),
      ]),
      table,
    ]),
  );

  renderRows();
}

export default { render };

import { loadState } from "../data/storageLocal.js";
import { buildPaymentRows, getSettings } from "./orderEditorFactory.js";

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

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtEurPlain(value) {
  const num = Number(value || 0);
  return Number.isFinite(num)
    ? `${num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
    : "—";
}

function toCsv(rows, headers) {
  const escapeCell = value => {
    const raw = value == null ? "" : String(value);
    const escaped = raw.replace(/"/g, '""');
    return `"${escaped}"`;
  };
  const head = headers.map(h => escapeCell(h.label)).join(",");
  const body = rows.map(row => headers.map(h => escapeCell(row[h.key])).join(",")).join("\n");
  return `${head}\n${body}`;
}

function buildPaymentExportRows(records, settings) {
  const config = { slug: "po", entityLabel: "PO", numberField: "poNo" };
  return records.flatMap(record => {
    const snapshot = JSON.parse(JSON.stringify(record));
    const payments = buildPaymentRows(snapshot, config, settings);
    return payments.map(payment => ({
      poNumber: record.poNo || record.id || "—",
      supplier: record.supplier || record.supplierName || record.supplierId || "—",
      type: payment.typeLabel,
      dueDate: payment.dueDate || "",
      plannedEur: payment.plannedEur != null ? payment.plannedEur : "",
      status: payment.status,
      paidDate: payment.paidDate || "",
      actualEur: payment.paidEurActual != null ? payment.paidEurActual : "",
      method: payment.method || "",
      invoiceDriveLink: record.invoiceDriveLink || "",
      note: payment.note || "",
    }));
  });
}

export function render(root) {
  const state = loadState();
  const settings = getSettings();
  const records = Array.isArray(state.pos) ? state.pos : [];
  const rows = buildPaymentExportRows(records, settings);

  const suppliers = Array.from(new Set(rows.map(row => row.supplier).filter(Boolean))).sort();
  const months = Array.from(new Set(rows.map(row => {
    const date = row.status === "paid" ? row.paidDate : row.dueDate;
    return date ? date.slice(0, 7) : null;
  }).filter(Boolean))).sort();

  const filterMonth = el("select", {}, [
    el("option", { value: "" }, ["Alle Monate"]),
    ...months.map(month => el("option", { value: month }, [month])),
  ]);
  const filterSupplier = el("select", {}, [
    el("option", { value: "" }, ["Alle Supplier"]),
    ...suppliers.map(name => el("option", { value: name }, [name])),
  ]);
  const filterStatus = el("select", {}, [
    el("option", { value: "" }, ["Alle Status"]),
    el("option", { value: "paid" }, ["Bezahlt"]),
    el("option", { value: "open" }, ["Offen"]),
  ]);

  const table = el("table", { class: "table payments-export-table" });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["PO-Nummer"]),
      el("th", {}, ["Supplier"]),
      el("th", {}, ["Payment Type"]),
      el("th", {}, ["Due date"]),
      el("th", {}, ["Planned EUR"]),
      el("th", {}, ["Status"]),
      el("th", {}, ["Paid date"]),
      el("th", {}, ["Actual EUR"]),
      el("th", {}, ["Method"]),
      el("th", {}, ["Invoice Drive Link"]),
      el("th", {}, ["Note"]),
    ]),
  ]);
  const tbody = el("tbody");
  table.append(thead, tbody);

  const headers = [
    { key: "poNumber", label: "PO number" },
    { key: "supplier", label: "Supplier" },
    { key: "type", label: "Payment type" },
    { key: "dueDate", label: "Due date" },
    { key: "plannedEur", label: "Planned EUR" },
    { key: "status", label: "Status" },
    { key: "paidDate", label: "Paid date" },
    { key: "actualEur", label: "Actual EUR" },
    { key: "method", label: "Method" },
    { key: "invoiceDriveLink", label: "Invoice Drive Link" },
    { key: "note", label: "Note" },
  ];

  function renderRows() {
    tbody.innerHTML = "";
    const filtered = rows.filter(row => {
      if (filterSupplier.value && row.supplier !== filterSupplier.value) return false;
      if (filterStatus.value && row.status !== filterStatus.value) return false;
      if (filterMonth.value) {
        const date = row.status === "paid" ? row.paidDate : row.dueDate;
        if (!date || !date.startsWith(filterMonth.value)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      tbody.append(el("tr", {}, [
        el("td", { colspan: "11", class: "muted" }, ["Keine Zahlungen gefunden."]),
      ]));
      return;
    }

    filtered.forEach(row => {
      tbody.append(el("tr", {}, [
        el("td", {}, [row.poNumber]),
        el("td", {}, [row.supplier]),
        el("td", {}, [row.type]),
        el("td", {}, [fmtDate(row.dueDate)]),
        el("td", {}, [fmtEurPlain(row.plannedEur)]),
        el("td", {}, [row.status === "paid" ? "Bezahlt" : "Offen"]),
        el("td", {}, [fmtDate(row.paidDate)]),
        el("td", {}, [fmtEurPlain(row.actualEur)]),
        el("td", {}, [row.method || "—"]),
        el("td", {}, [row.invoiceDriveLink || "—"]),
        el("td", {}, [row.note || "—"]),
      ]));
    });
  }

  [filterMonth, filterSupplier, filterStatus].forEach(select => select.addEventListener("change", renderRows));

  const downloadBtn = el("button", { class: "btn", type: "button" }, ["Download CSV"]);
  downloadBtn.addEventListener("click", () => {
    const csv = toCsv(rows, headers);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `payments-export-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  const copyBtn = el("button", { class: "btn secondary", type: "button" }, ["Copy to clipboard"]);
  copyBtn.addEventListener("click", () => {
    const csv = toCsv(rows, headers);
    navigator.clipboard?.writeText(csv);
  });

  root.innerHTML = "";
  root.append(
    el("section", { class: "card" }, [
      el("h2", {}, ["Payments Export"]),
      el("div", { class: "payments-export-filters" }, [
        el("label", {}, ["Monat", filterMonth]),
        el("label", {}, ["Supplier", filterSupplier]),
        el("label", {}, ["Status", filterStatus]),
      ]),
      el("div", { class: "payments-export-actions" }, [downloadBtn, copyBtn]),
      table,
    ]),
  );

  renderRows();
}

export default { render };

import { parseDeNumber } from "../../lib/dataHealth.js";
import { buildPaymentRows } from "../../ui/orderEditorFactory.js";

export type PaymentExportScope = "paid" | "open" | "both";

export interface PaymentJournalRow {
  rowId: string;
  eventId: string;
  month: string;
  entityType: "PO" | "FO";
  poNumber: string;
  foNumber: string;
  supplierName: string;
  skuAliases: string;
  paymentType: "Deposit" | "Balance" | "Balance2" | "Fracht" | "EUSt" | "Other";
  status: "PAID" | "OPEN";
  dueDate: string;
  paidDate: string;
  paymentId: string;
  amountPlannedEur: number | null;
  amountActualEur: number | null;
  payer: string;
  paymentMethod: string;
  note: string;
  internalId: string;
  issues: string[];
}

const PO_CONFIG = { slug: "po", entityLabel: "PO", numberField: "poNo" };

function normalizeKey(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeFoStatus(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "DRAFT";
  if (raw === "PLANNED") return "ACTIVE";
  if (raw === "CANCELLED") return "ARCHIVED";
  return raw;
}

function isFoPlanningStatus(value: unknown): boolean {
  const status = normalizeFoStatus(value);
  return status === "DRAFT" || status === "ACTIVE";
}

function parseNumber(value: unknown): number {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return 0;
  return Number(parsed);
}

function normalizePaymentType(input: { label?: unknown; eventType?: unknown }): PaymentJournalRow["paymentType"] | null {
  const label = String(input.label || "").toLowerCase();
  const eventType = String(input.eventType || "");
  if (eventType === "fx_fee" || label.includes("fx")) return null;
  if (eventType === "freight" || label.includes("shipping") || label.includes("fracht")) return "Fracht";
  if (eventType === "eust" || label.includes("eust")) return "EUSt";
  if (label.includes("balance2") || label.includes("balance 2") || label.includes("second balance")) return "Balance2";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  return "Other";
}

function toOrderSettings(state: Record<string, unknown>): Record<string, unknown> {
  const raw = (state.settings || {}) as Record<string, unknown>;
  return {
    fxRate: parseNumber(raw.fxRate),
    fxFeePct: parseNumber(raw.fxFeePct),
    eurUsdRate: parseNumber(raw.eurUsdRate),
    dutyRatePct: parseNumber(raw.dutyRatePct),
    dutyIncludeFreight: raw.dutyIncludeFreight !== false,
    eustRatePct: parseNumber(raw.eustRatePct),
    vatRefundEnabled: raw.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(raw.vatRefundLagMonths || 0) || 0,
    freightLagDays: Number(raw.freightLagDays || 0) || 0,
    cny: raw.cny && typeof raw.cny === "object"
      ? {
        start: String((raw.cny as Record<string, unknown>).start || ""),
        end: String((raw.cny as Record<string, unknown>).end || ""),
      }
      : { start: "", end: "" },
    cnyBlackoutByYear: raw.cnyBlackoutByYear && typeof raw.cnyBlackoutByYear === "object"
      ? structuredClone(raw.cnyBlackoutByYear)
      : {},
  };
}

function buildSupplierNameMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.suppliers) ? state.suppliers : []).forEach((entry) => {
    const supplier = entry as Record<string, unknown>;
    const name = String(supplier.name || "").trim();
    if (!name) return;
    const idKey = normalizeKey(supplier.id);
    const nameKey = normalizeKey(name);
    if (idKey) map.set(idKey, name);
    if (nameKey) map.set(nameKey, name);
  });
  return map;
}

function buildSkuAliasMap(state: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  (Array.isArray(state.products) ? state.products : []).forEach((entry) => {
    const product = entry as Record<string, unknown>;
    const key = normalizeKey(product.sku);
    if (!key) return;
    map.set(key, String(product.alias || product.sku || ""));
  });
  return map;
}

function resolveSupplierName(record: Record<string, unknown>, supplierNameMap: Map<string, string>): string {
  const fallback = record.supplierName || record.supplier || "";
  const key = normalizeKey(record.supplierId || record.supplier || record.supplierName || "");
  return supplierNameMap.get(key) || (fallback ? String(fallback) : "—");
}

function resolveSkuAliases(record: Record<string, unknown>, skuAliasMap: Map<string, string>): string {
  const items = Array.isArray(record.items) ? record.items.filter(Boolean) : [];
  const skus = items.length
    ? items.map((item) => (item as Record<string, unknown>).sku).filter(Boolean)
    : [record.sku];
  const aliases = Array.from(
    new Set(
      skus.map((sku) => {
        const key = normalizeKey(sku);
        return key ? (skuAliasMap.get(key) || String(sku || "")) : null;
      }).filter(Boolean),
    ),
  );
  return aliases.join(", ") || "—";
}

function allocateByPlanned(total: number, events: Array<{ id: string; plannedEur: number }>) {
  const plannedValues = events.map((entry) => Number(entry.plannedEur || 0));
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
  if (Math.abs(remainder) > 0 && allocations.length) {
    let target = allocations[allocations.length - 1];
    if (allocations.length > 1) {
      target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
    }
    target.actual = Math.round((target.actual + remainder) * 100) / 100;
  }
  return allocations;
}

function buildPaymentIndexes(payments: unknown[]) {
  const byId = new Map<string, Record<string, unknown>>();
  const allocationByEvent = new Map<string, Record<string, unknown>>();
  (Array.isArray(payments) ? payments : []).forEach((entry) => {
    const payment = entry as Record<string, unknown>;
    if (!payment?.id) return;
    byId.set(String(payment.id), payment);
    if (Array.isArray(payment.allocations)) {
      payment.allocations.forEach((allocationRaw) => {
        const allocation = allocationRaw as Record<string, unknown>;
        if (!allocation?.eventId) return;
        allocationByEvent.set(String(allocation.eventId), allocation);
      });
    }
  });
  return { byId, allocationByEvent };
}

function isActualAmountValid(amount: unknown, planned: unknown): boolean {
  if (!Number.isFinite(Number(amount))) return false;
  const actual = Number(amount);
  const plannedValue = Number.isFinite(Number(planned)) ? Number(planned) : null;
  if (actual > 0) return true;
  if (actual === 0 && plannedValue != null && plannedValue === 0) return true;
  return false;
}

function resolveActualAllocation(input: {
  payment: Record<string, unknown> | null;
  paymentRow: Record<string, unknown>;
  paymentRows: Record<string, unknown>[];
}) {
  if (!input.payment || !input.paymentRow?.paymentId) return null;
  const total = Number(input.payment.amountActualEurTotal);
  if (!Number.isFinite(total)) return null;
  const related = input.paymentRows.filter(
    (row) => row.paymentId && row.paymentId === input.paymentRow.paymentId,
  );
  if (!related.length) return null;
  const allocations = allocateByPlanned(
    total,
    related.map((row) => ({ id: String(row.id || ""), plannedEur: Number(row.plannedEur || 0) })),
  );
  if (!allocations) return null;
  return allocations.find((entry) => entry.eventId === input.paymentRow.id) || null;
}

function resolveActualAmountForLine(input: {
  row: PaymentJournalRow;
  paymentRow: Record<string, unknown>;
  paymentRows: Record<string, unknown>[];
  paymentRecord: Record<string, unknown> | null;
  paymentIndexes: {
    byId: Map<string, Record<string, unknown>>;
    allocationByEvent: Map<string, Record<string, unknown>>;
  };
  state: Record<string, unknown>;
}): { amountActualEur: number | null; issues: string[] } {
  const issues: string[] = [];
  if (input.row.status !== "PAID") return { amountActualEur: null, issues };
  if (!input.row.paidDate) issues.push("PAID_WITHOUT_DATE");

  const hasDirectActual = input.paymentRow?.paidEurActual != null
    && input.paymentRow?.paidEurActual !== ""
    && Number.isFinite(Number(input.paymentRow?.paidEurActual));
  if (hasDirectActual) {
    if (isActualAmountValid(input.paymentRow.paidEurActual, input.row.amountPlannedEur)) {
      return { amountActualEur: Number(input.paymentRow.paidEurActual), issues };
    }
    issues.push("MISSING_ACTUAL_AMOUNT");
    return { amountActualEur: Number(input.paymentRow.paidEurActual), issues };
  }

  if (input.paymentRecord?.allocations && Array.isArray(input.paymentRecord.allocations)) {
    const allocation = (input.paymentRecord.allocations as Record<string, unknown>[]).find((entry) => {
      if (!entry) return false;
      if (entry.eventId && input.paymentRow?.id && entry.eventId === input.paymentRow.id) return true;
      if (entry.plannedId && input.paymentRow?.id && entry.plannedId === input.paymentRow.id) return true;
      if (entry.entityType && entry.paymentType) {
        const matchesType = String(entry.paymentType) === String(input.row.paymentType);
        const matchesEntity = String(entry.entityType) === String(input.row.entityType);
        const matchesNumber = input.row.entityType === "PO"
          ? String(entry.poNumber || "") === String(input.row.poNumber || "")
          : String(entry.foNumber || "") === String(input.row.foNumber || "");
        return matchesType && matchesEntity && matchesNumber;
      }
      return false;
    });
    if (allocation && isActualAmountValid(allocation.amountEur, input.row.amountPlannedEur)) {
      return { amountActualEur: Number(allocation.amountEur), issues };
    }
  }

  if (input.paymentRecord && input.paymentRow?.paymentId) {
    const allocation = input.paymentIndexes.allocationByEvent.get(String(input.paymentRow.id))
      || resolveActualAllocation({
        payment: input.paymentRecord,
        paymentRow: input.paymentRow,
        paymentRows: input.paymentRows,
      });
    if (allocation && isActualAmountValid(allocation.actual, input.row.amountPlannedEur)) {
      issues.push("PRO_RATA_ALLOCATION");
      return { amountActualEur: Number(allocation.actual), issues };
    }
    if (isActualAmountValid(input.paymentRecord.amountActualEurTotal, input.row.amountPlannedEur) && input.paymentRows.length === 1) {
      return { amountActualEur: Number(input.paymentRecord.amountActualEurTotal), issues };
    }
  }

  if (!input.paymentRow?.paymentId && input.row.paidDate && input.paymentRow?.id) {
    const match = (Array.isArray(input.state.payments) ? input.state.payments : []).find((entry) => {
      const payment = entry as Record<string, unknown>;
      if (!payment) return false;
      if (payment.paidDate !== input.row.paidDate) return false;
      if (Array.isArray(payment.coveredEventIds) && payment.coveredEventIds.includes(input.paymentRow.id)) return true;
      return false;
    }) as Record<string, unknown> | undefined;
    if (match && isActualAmountValid(match.amountActualEurTotal, input.row.amountPlannedEur)) {
      return { amountActualEur: Number(match.amountActualEurTotal), issues };
    }
  }

  issues.push("MISSING_ACTUAL_AMOUNT");
  return { amountActualEur: null, issues };
}

function getRowMonth(input: { status: string; dueDate: string; paidDate: string }): string {
  const date = input.status === "PAID" ? input.paidDate : input.dueDate;
  return date ? String(date).slice(0, 7) : "";
}

export function buildPaymentJournalRowsFromState(
  state: Record<string, unknown>,
  filters: { month?: string; scope?: PaymentExportScope },
): PaymentJournalRow[] {
  const settings = toOrderSettings(state);
  const productsByAlias = buildSkuAliasMap(state);
  const supplierNameMap = buildSupplierNameMap(state);
  const poRecords = Array.isArray(state.pos) ? state.pos : [];
  const foRecords = Array.isArray(state.fos) ? state.fos : [];
  const paymentIndexes = buildPaymentIndexes(Array.isArray(state.payments) ? state.payments : []);
  const rows: PaymentJournalRow[] = [];

  poRecords.forEach((entry) => {
    const record = entry as Record<string, unknown>;
    if (!record) return;
    const supplierName = resolveSupplierName(record, supplierNameMap);
    const skuAliases = resolveSkuAliases(record, productsByAlias);
    const snapshot = structuredClone(record);
    const paymentRows = buildPaymentRows(
      snapshot,
      PO_CONFIG,
      settings,
      (Array.isArray(state.payments) ? state.payments : []) as Record<string, unknown>[],
    ) as Record<string, unknown>[];

    paymentRows.forEach((payment) => {
      const paymentType = normalizePaymentType({ label: payment.typeLabel || payment.label, eventType: payment.eventType });
      if (!paymentType) return;
      const paymentRecord = payment.paymentId ? paymentIndexes.byId.get(String(payment.paymentId)) || null : null;
      const status: "PAID" | "OPEN" = payment.status === "paid" || payment.status === "PAID" ? "PAID" : "OPEN";
      const dueDate = String(payment.dueDate || "");
      const paidDate = String(paymentRecord?.paidDate || payment.paidDate || "");
      const planned = Number.isFinite(Number(payment.plannedEur)) ? Number(payment.plannedEur) : null;
      const entityId = String(record.id || record.poNo || "");
      const rowId = `PO-${entityId}-${paymentType}-${dueDate || paidDate || ""}`;
      const baseRow: PaymentJournalRow = {
        rowId,
        eventId: String(payment.id || ""),
        month: getRowMonth({ status, dueDate, paidDate }),
        entityType: "PO",
        poNumber: String(record.poNo || ""),
        foNumber: "",
        supplierName,
        skuAliases,
        paymentType,
        status,
        dueDate,
        paidDate,
        paymentId: String(payment.paymentId || ""),
        amountPlannedEur: planned,
        amountActualEur: null,
        payer: String(payment.paidBy || ""),
        paymentMethod: String(payment.method || ""),
        note: String(payment.note || ""),
        internalId: String(payment.paymentInternalId || payment.id || record.id || rowId),
        issues: [],
      };
      const resolved = resolveActualAmountForLine({
        row: baseRow,
        paymentRow: payment,
        paymentRows,
        paymentRecord,
        paymentIndexes,
        state,
      });
      rows.push({
        ...baseRow,
        amountActualEur: resolved.amountActualEur,
        issues: resolved.issues,
      });
    });
  });

  foRecords.forEach((entry) => {
    const record = entry as Record<string, unknown>;
    if (!isFoPlanningStatus(record?.status)) return;
    if (!record || !Array.isArray(record.payments)) return;
    const supplierName = resolveSupplierName(record, supplierNameMap);
    const skuAliases = record.sku
      ? (productsByAlias.get(normalizeKey(record.sku)) || String(record.sku))
      : "—";
    const fxRate = Number(record.fxRate || 0);

    (record.payments as Record<string, unknown>[]).forEach((payment) => {
      if (!payment) return;
      if (String(payment.category || "") === "eust_refund") return;
      const paymentType = normalizePaymentType({ label: payment.label, eventType: payment.category });
      if (!paymentType) return;
      const rawAmount = Number(payment.amount || 0);
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;
      const currency = String(payment.currency || "EUR");
      const planned = currency === "EUR" ? rawAmount : (fxRate > 0 ? rawAmount / fxRate : rawAmount);
      const dueDate = String(payment.dueDate || "");
      const status: "PAID" | "OPEN" = "OPEN";
      const paidDate = "";
      const entityId = String(record.id || record.foNumber || "");
      const eventId = String(payment.id || `${entityId}-${paymentType}-${dueDate}`);
      const rowId = `FO-${entityId}-${paymentType}-${dueDate || ""}`;
      rows.push({
        rowId,
        eventId,
        month: getRowMonth({ status, dueDate, paidDate }),
        entityType: "FO",
        poNumber: String(record.convertedPoNo || ""),
        foNumber: String(record.foNumber || record.id || ""),
        supplierName,
        skuAliases,
        paymentType,
        status,
        dueDate,
        paidDate,
        paymentId: "",
        amountPlannedEur: planned,
        amountActualEur: null,
        payer: "",
        paymentMethod: "",
        note: "",
        internalId: String(record.id || rowId),
        issues: [],
      });
    });
  });

  const scope = filters.scope || "both";
  const month = String(filters.month || "");
  const filtered = rows.filter((row) => {
    if (scope === "paid" && row.status !== "PAID") return false;
    if (scope === "open" && row.status !== "OPEN") return false;
    if (month && row.month !== month) return false;
    return true;
  });

  const deduped: PaymentJournalRow[] = [];
  const seen = new Set<string>();
  filtered.forEach((row) => {
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

function formatCsvNumber(value: unknown): string {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function buildPaymentJournalCsvRows(rows: PaymentJournalRow[]) {
  return rows.map((row) => ({
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

export function paymentJournalRowsToCsv(rows: Array<Record<string, unknown>>, delimiter = ";"): string {
  const headers = [
    "month",
    "entityType",
    "poNumber",
    "foNumber",
    "supplierName",
    "skuAliases",
    "paymentType",
    "status",
    "dueDate",
    "paidDate",
    "amountPlannedEur",
    "amountActualEur",
    "issues",
    "paymentId",
    "payer",
    "paymentMethod",
    "note",
    "internalId",
  ];
  const escapeCell = (value: unknown) => {
    const raw = String(value ?? "");
    const escaped = raw.replace(/"/g, "\"\"");
    return `"${escaped}"`;
  };
  const head = headers.map((header) => escapeCell(header)).join(delimiter);
  const body = rows.map((row) => headers.map((header) => escapeCell(row[header])).join(delimiter)).join("\n");
  return `${head}\n${body}`;
}

export function sumPaymentRows(rows: PaymentJournalRow[], key: "amountPlannedEur" | "amountActualEur"): number {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

export function openPaymentJournalPrintView(rows: PaymentJournalRow[], filters: { month?: string; scope?: PaymentExportScope }): void {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return;
  const scope = filters.scope || "both";
  const scopeLabel = scope === "paid" ? "Paid" : scope === "open" ? "Open" : "Both";
  const title = `Zahlungsjournal ${filters.month || ""}`.trim();
  const paidSum = sumPaymentRows(rows.filter((row) => row.status === "PAID"), "amountActualEur");
  const openSum = sumPaymentRows(rows.filter((row) => row.status === "OPEN"), "amountPlannedEur");
  const bodyRows = rows.map((row) => `
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
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f1b2d; margin: 24px; }
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
      ${bodyRows}
    </tbody>
  </table>
  <div class="totals">
    <div>Sum Actual EUR (PAID): ${formatCsvNumber(paidSum)}</div>
    <div>Sum Planned EUR (OPEN): ${formatCsvNumber(openSum)}</div>
  </div>
</body>
</html>`;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

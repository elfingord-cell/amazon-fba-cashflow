import { parseDeNumber } from "../../lib/dataHealth.js";
import { buildPaymentJournalRowsCore } from "../../domain/paymentJournalCore.js";

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
  itemSummary?: string;
  itemTooltip?: string;
  paymentType: string;
  includedPositions?: string[];
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

function parseNumber(value: unknown): number {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed as number)) return 0;
  return Number(parsed);
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

export function buildPaymentJournalRowsFromState(
  state: Record<string, unknown>,
  filters: { month?: string; scope?: PaymentExportScope },
): PaymentJournalRow[] {
  const sourceState = state && typeof state === "object" ? state : {};
  const rows = buildPaymentJournalRowsCore({
    state: sourceState,
    settings: toOrderSettings(sourceState),
    products: Array.isArray(sourceState.products) ? sourceState.products : [],
    month: String(filters.month || ""),
    scope: (filters.scope || "both") as PaymentExportScope,
    includeFo: true,
  });
  return rows as PaymentJournalRow[];
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
    itemSummary: row.itemSummary || "",
    skuAliases: row.skuAliases,
    paymentType: row.paymentType,
    includedPositions: Array.isArray(row.includedPositions) ? row.includedPositions.join("+") : "",
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
    "itemSummary",
    "skuAliases",
    "paymentType",
    "includedPositions",
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


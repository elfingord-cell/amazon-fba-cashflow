import { parseDeNumber } from "../lib/dataHealth.js";
import { buildPaymentRows } from "../ui/orderEditorFactory.js";

const PO_CONFIG = { slug: "po", entityLabel: "PO", numberField: "poNo" };
const CSV_HEADERS = [
  "po_number",
  "payment_stage",
  "supplier_name",
  "payment_date",
  "payment_channel",
  "invoice_currency",
  "invoice_amount",
  "paid_currency",
  "paid_amount",
  "reference_hint",
  "invoice_id_or_number",
  "units_total",
  "sku_list",
  "notes",
];

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeMonth(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return currentMonthKey();
}

function parseNumber(value) {
  const parsed = parseDeNumber(value);
  return Number.isFinite(parsed) ? Number(parsed) : null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const deMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    const day = Number(deMatch[1]);
    const month = Number(deMatch[2]);
    const year = Number(deMatch[3]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(value) {
  const date = parseDate(value);
  if (!date) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthFromDate(value) {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 7) : null;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildOrderSettings(state) {
  const settings = state?.settings || {};
  return {
    fxRate: parseNumber(settings.fxRate) || 1,
    fxFeePct: parseNumber(settings.fxFeePct) || 0,
    eurUsdRate: parseNumber(settings.eurUsdRate) || 0,
    dutyRatePct: parseNumber(settings.dutyRatePct) || 0,
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: parseNumber(settings.eustRatePct) || 0,
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(settings.vatRefundLagMonths || 0) || 0,
    freightLagDays: Number(settings.freightLagDays || 0) || 0,
    cny: settings.cny && typeof settings.cny === "object"
      ? {
        start: String(settings.cny.start || ""),
        end: String(settings.cny.end || ""),
      }
      : { start: "", end: "" },
    cnyBlackoutByYear: settings.cnyBlackoutByYear && typeof settings.cnyBlackoutByYear === "object"
      ? structuredClone(settings.cnyBlackoutByYear)
      : {},
  };
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record || {}));
}

function buildSupplierMap(state) {
  const map = new Map();
  (Array.isArray(state?.suppliers) ? state.suppliers : []).forEach((entry) => {
    const supplier = entry || {};
    const name = String(supplier.name || "").trim();
    if (!name) return;
    const idKey = normalizeKey(supplier.id);
    const nameKey = normalizeKey(name);
    if (idKey) map.set(idKey, name);
    if (nameKey) map.set(nameKey, name);
  });
  return map;
}

function resolveSupplierName(record, supplierMap) {
  const key = normalizeKey(record?.supplierId || record?.supplier || record?.supplierName);
  if (key && supplierMap.has(key)) return supplierMap.get(key);
  const fallback = String(record?.supplierName || record?.supplier || "").trim();
  return fallback || "—";
}

function parseUnits(value) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(Number(parsed)));
}

function getPoItems(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (items.length) return items;
  if (record?.sku) {
    return [{ sku: record.sku, units: record.units || 0 }];
  }
  return [];
}

function buildUnitsTotal(record) {
  return getPoItems(record).reduce((sum, item) => sum + parseUnits(item?.units), 0);
}

function buildSkuList(record) {
  const parts = getPoItems(record)
    .map((item) => ({
      sku: String(item?.sku || "").trim(),
      units: parseUnits(item?.units),
    }))
    .filter((entry) => entry.sku)
    .map((entry) => `${entry.sku}:${entry.units}`);
  return parts.join("|");
}

function computeGoodsUsd(record) {
  const fromHeader = parseNumber(record?.goodsUsd || record?.goodsAmountUsd);
  if (Number.isFinite(fromHeader)) return Number(fromHeader);

  const items = getPoItems(record);
  if (!items.length) return null;

  let total = 0;
  let hasData = false;
  items.forEach((item) => {
    const units = parseUnits(item?.units);
    const unitCost = parseNumber(item?.unitCostUsd || item?.unitPriceUsd || record?.unitCostUsd);
    const unitExtra = parseNumber(item?.unitExtraUsd) || 0;
    const extraFlat = parseNumber(item?.extraFlatUsd) || 0;
    if (!Number.isFinite(unitCost)) return;
    const line = (units * (Number(unitCost) + unitExtra)) + extraFlat;
    if (!Number.isFinite(line)) return;
    total += line;
    hasData = true;
  });
  return hasData ? total : null;
}

function normalizePaymentStage(paymentRow) {
  const text = `${String(paymentRow?.typeLabel || "")} ${String(paymentRow?.label || "")}`.toLowerCase();
  if (text.includes("full") || text.includes("one-shot") || text.includes("100%")) return "FULL";
  if (text.includes("deposit") || text.includes("anzahlung")) return "DEPOSIT";
  if (
    text.includes("balance2")
    || text.includes("balance 2")
    || text.includes("second balance")
    || text.includes("balance")
    || text.includes("rest")
  ) return "BALANCE";
  return "OTHER";
}

function normalizePaymentChannel(method) {
  const text = String(method || "").trim().toLowerCase();
  if (!text) return "OTHER";
  if (text.includes("wise") || text.includes("transferwise")) return "WISE";
  if (text.includes("alibaba") || text.includes("trade assurance")) return "ALIBABA_TA";
  if (text.includes("paypal")) return "PAYPAL";
  if (text.includes("sepa") || text.includes("bank transfer") || text.includes("ueberweisung")) return "SEPA";
  return "OTHER";
}

function allocateByPlanned(total, events) {
  const plannedValues = events.map((entry) => Number(entry.plannedEur || 0));
  const sumPlanned = plannedValues.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(sumPlanned) || sumPlanned <= 0) return null;
  const allocations = plannedValues.map((planned, index) => {
    const share = planned / sumPlanned;
    const raw = total * share;
    return {
      eventId: events[index].id,
      planned,
      actual: Math.round(raw * 100) / 100,
    };
  });
  const roundedSum = allocations.reduce((sum, entry) => sum + entry.actual, 0);
  const remainder = Math.round((total - roundedSum) * 100) / 100;
  if (Math.abs(remainder) > 0 && allocations.length) {
    allocations[allocations.length - 1].actual = Math.round((allocations[allocations.length - 1].actual + remainder) * 100) / 100;
  }
  return allocations;
}

function readPositiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function readAllocationAmount(allocation, currency) {
  if (!allocation || typeof allocation !== "object") return null;
  if (currency === "USD") {
    return (
      readPositiveNumber(allocation.amountUsd)
      || readPositiveNumber(allocation.amountActualUsd)
      || readPositiveNumber(allocation.actualUsd)
    );
  }
  return (
    readPositiveNumber(allocation.amountEur)
    || readPositiveNumber(allocation.amountActualEur)
    || readPositiveNumber(allocation.actualEur)
    || readPositiveNumber(allocation.actual)
  );
}

function resolveAllocatedAmount({ paymentRecord, paymentRows, paymentRow, currency }) {
  if (!paymentRecord || !paymentRow?.paymentId) return null;

  if (Array.isArray(paymentRecord.allocations)) {
    const allocation = paymentRecord.allocations.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (entry.eventId && String(entry.eventId) === String(paymentRow.id || "")) return true;
      if (entry.plannedId && String(entry.plannedId) === String(paymentRow.id || "")) return true;
      return false;
    });
    const fromAllocation = readAllocationAmount(allocation, currency);
    if (fromAllocation != null) return fromAllocation;
  }

  const totalField = currency === "USD" ? "amountActualUsdTotal" : "amountActualEurTotal";
  const total = readPositiveNumber(paymentRecord?.[totalField]);
  if (total == null) return null;

  const related = paymentRows.filter((row) => (
    String(row?.paymentId || "") === String(paymentRow.paymentId || "")
    && String(row?.status || "").toLowerCase() === "paid"
  ));
  if (!related.length) return null;
  if (related.length === 1) return total;

  const allocations = allocateByPlanned(total, related.map((row) => ({
    id: String(row.id || ""),
    plannedEur: Number(row.plannedEur || 0),
  })));
  if (!allocations) return null;
  const match = allocations.find((entry) => entry.eventId === paymentRow.id);
  return readPositiveNumber(match?.actual);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function formatCsvNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const decimals = Number.isFinite(options.decimals) ? Number(options.decimals) : 2;
  return number.toFixed(decimals);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildReferenceHint(input) {
  const parts = [`PO ${input.poNumber || "—"} ${input.paymentStage || "OTHER"}`];
  if (input.paymentId) parts.push(`PAY ${input.paymentId}`);
  if (input.transferReference) parts.push(`TRX ${input.transferReference}`);
  if (input.invoiceIdOrNumber) parts.push(`INV ${input.invoiceIdOrNumber}`);
  return parts.join(" | ");
}

function buildMilestonePercentMap(record) {
  const map = new Map();
  (Array.isArray(record?.milestones) ? record.milestones : []).forEach((entry) => {
    if (!entry?.id) return;
    const percent = parseNumber(entry.percent);
    if (!Number.isFinite(percent)) return;
    map.set(String(entry.id), Number(percent));
  });
  return map;
}

function resolvePaidAmountEur(input) {
  const direct = readPositiveNumber(input.paymentRow?.paidEurActual)
    || readPositiveNumber(input.paymentLogEntry?.amountActualEur);
  if (direct != null) return direct;
  return resolveAllocatedAmount({
    paymentRecord: input.paymentRecord,
    paymentRows: input.paymentRows,
    paymentRow: input.paymentRow,
    currency: "EUR",
  });
}

function resolveInvoiceAmountCurrency(input) {
  const usdDirect = readPositiveNumber(input.paymentLogEntry?.amountActualUsd)
    || readPositiveNumber(input.paymentRow?.paidUsdActual)
    || resolveAllocatedAmount({
      paymentRecord: input.paymentRecord,
      paymentRows: input.paymentRows,
      paymentRow: input.paymentRow,
      currency: "USD",
    });
  if (usdDirect != null) {
    return { invoiceCurrency: "USD", invoiceAmount: usdDirect };
  }

  if (Number.isFinite(input.milestonePercent) && Number.isFinite(input.goodsUsd)) {
    const usdFromMilestone = (Number(input.goodsUsd) * Number(input.milestonePercent)) / 100;
    if (usdFromMilestone > 0) {
      return { invoiceCurrency: "USD", invoiceAmount: usdFromMilestone };
    }
  }

  const fallbackAmount = readPositiveNumber(input.paidAmount);
  if (fallbackAmount != null) {
    return {
      invoiceCurrency: input.paidCurrency || "EUR",
      invoiceAmount: fallbackAmount,
    };
  }

  return { invoiceCurrency: input.paidCurrency || "EUR", invoiceAmount: null };
}

function buildRowFromPayment(input) {
  const paidDate = toIsoDate(input.paymentRow?.paidDate);
  if (!paidDate) return null;
  if (monthFromDate(paidDate) !== input.month) return null;

  const paidAmount = resolvePaidAmountEur(input);
  if (!(paidAmount > 0)) return null;

  const paymentStage = normalizePaymentStage(input.paymentRow);
  const paymentMethod = input.paymentRow?.method || input.paymentRecord?.method || input.paymentLogEntry?.method || "";
  const paymentChannel = normalizePaymentChannel(paymentMethod);
  const paidCurrency = String(input.paymentRecord?.currency || "EUR").trim().toUpperCase() || "EUR";
  const milestonePercent = input.milestonePercentByEventId.get(String(input.paymentRow?.id || ""));
  const invoiceResolved = resolveInvoiceAmountCurrency({
    paymentRecord: input.paymentRecord,
    paymentRows: input.paymentRows,
    paymentRow: input.paymentRow,
    paymentLogEntry: input.paymentLogEntry,
    milestonePercent,
    goodsUsd: input.goodsUsd,
    paidAmount,
    paidCurrency,
  });

  const invoiceIdOrNumber = firstNonEmpty(
    input.paymentRow?.invoiceIdOrNumber,
    input.paymentRecord?.invoiceIdOrNumber,
    input.paymentLogEntry?.invoiceIdOrNumber,
  );
  const transferReference = firstNonEmpty(
    input.paymentRow?.transferReference,
    input.paymentRecord?.transferReference,
    input.paymentLogEntry?.transferReference,
  );
  const notes = firstNonEmpty(
    input.paymentRow?.note,
    input.paymentRecord?.note,
    input.paymentLogEntry?.note,
  );

  const poNumber = String(input.record?.poNo || input.record?.id || "").trim();
  return {
    po_number: poNumber,
    payment_stage: paymentStage,
    supplier_name: input.supplierName,
    payment_date: paidDate,
    payment_channel: paymentChannel,
    invoice_currency: String(invoiceResolved.invoiceCurrency || paidCurrency || "EUR").toUpperCase(),
    invoice_amount: round2(invoiceResolved.invoiceAmount),
    paid_currency: paidCurrency,
    paid_amount: round2(paidAmount),
    reference_hint: buildReferenceHint({
      poNumber,
      paymentStage,
      paymentId: String(input.paymentRow?.paymentId || ""),
      transferReference,
      invoiceIdOrNumber,
    }),
    invoice_id_or_number: invoiceIdOrNumber,
    units_total: input.unitsTotal,
    sku_list: input.skuList,
    notes,
  };
}

export function buildPoPaymentsLedgerRows(state, options = {}) {
  const month = normalizeMonth(options.month);
  const sourceState = state && typeof state === "object" ? state : {};
  const supplierMap = buildSupplierMap(sourceState);
  const settings = buildOrderSettings(sourceState);
  const paymentRecordById = new Map(
    (Array.isArray(sourceState.payments) ? sourceState.payments : [])
      .filter((entry) => entry?.id)
      .map((entry) => [String(entry.id), entry]),
  );
  const rows = [];

  (Array.isArray(sourceState.pos) ? sourceState.pos : []).forEach((entry) => {
    const record = entry || {};
    if (record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const paymentRows = buildPaymentRows(cloneRecord(record), PO_CONFIG, settings, sourceState.payments || []);
    const paymentLog = (record.paymentLog && typeof record.paymentLog === "object") ? record.paymentLog : {};
    const supplierName = resolveSupplierName(record, supplierMap);
    const milestonePercentByEventId = buildMilestonePercentMap(record);
    const goodsUsd = computeGoodsUsd(record);
    const unitsTotal = buildUnitsTotal(record);
    const skuList = buildSkuList(record);

    paymentRows.forEach((paymentRow) => {
      if (String(paymentRow?.status || "").toLowerCase() !== "paid") return;
      const paymentRecord = paymentRow?.paymentId ? (paymentRecordById.get(String(paymentRow.paymentId)) || null) : null;
      const paymentLogEntry = paymentLog?.[paymentRow?.id] || null;
      const row = buildRowFromPayment({
        month,
        record,
        supplierName,
        paymentRows,
        paymentRow,
        paymentRecord,
        paymentLogEntry,
        milestonePercentByEventId,
        goodsUsd,
        unitsTotal,
        skuList,
      });
      if (!row) return;
      if (!(Number(row.paid_amount) > 0)) return;
      rows.push(row);
    });
  });

  return rows.sort((left, right) => {
    const dateCompare = String(left.payment_date || "").localeCompare(String(right.payment_date || ""));
    if (dateCompare !== 0) return dateCompare;
    const poCompare = String(left.po_number || "").localeCompare(String(right.po_number || ""));
    if (poCompare !== 0) return poCompare;
    return String(left.payment_stage || "").localeCompare(String(right.payment_stage || ""));
  });
}

export function poPaymentsLedgerRowsToCsv(rows) {
  const body = (Array.isArray(rows) ? rows : []).map((row) => {
    const columns = CSV_HEADERS.map((header) => {
      if (header === "invoice_amount" || header === "paid_amount") {
        return escapeCsvCell(formatCsvNumber(row?.[header], { decimals: 2 }));
      }
      if (header === "units_total") {
        const units = Number(row?.[header]);
        return escapeCsvCell(Number.isFinite(units) ? String(Math.round(units)) : "");
      }
      return escapeCsvCell(row?.[header] ?? "");
    });
    return columns.join(",");
  });
  const header = CSV_HEADERS.map((entry) => escapeCsvCell(entry)).join(",");
  return [header, ...body].join("\n");
}

export function buildPoPaymentsLedgerExport(state, options = {}) {
  const month = normalizeMonth(options.month);
  const rows = buildPoPaymentsLedgerRows(state, { month });
  return {
    fileName: `po-payments_${month}.csv`,
    csv: poPaymentsLedgerRowsToCsv(rows),
    rowCount: rows.length,
  };
}

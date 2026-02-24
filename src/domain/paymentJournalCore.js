import { parseDeNumber } from "../lib/dataHealth.js";
import { buildPaymentRows } from "../ui/orderEditorFactory.js";

const PO_CONFIG = { slug: "po", entityLabel: "PO", numberField: "poNo" };

const POSITION_ORDER = [
  "Deposit",
  "Balance",
  "Balance2",
  "Shipping",
  "EUSt",
  "Zoll",
  "EUSt-Erstattung",
  "Other",
];

const RELEVANT_POSITIONS = new Set([
  "Deposit",
  "Balance",
  "Balance2",
  "Shipping",
  "EUSt",
  "Zoll",
  "EUSt-Erstattung",
]);

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMonth(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : "";
}

function parseNumber(value) {
  const parsed = parseDeNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed);
}

function readFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function normalizeIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const raw = String(value).trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const deMatch = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    const day = String(Number(deMatch[1])).padStart(2, "0");
    const month = String(Number(deMatch[2])).padStart(2, "0");
    const year = String(Number(deMatch[3]));
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthFromDate(value) {
  const iso = normalizeIsoDate(value);
  return iso ? iso.slice(0, 7) : "";
}

function isPaidLike(value) {
  if (value === true || value === 1) return true;
  const raw = String(value || "").trim().toLowerCase();
  return raw === "paid" || raw === "bezahlt" || raw === "done" || raw === "true" || raw === "1" || raw === "yes" || raw === "ja";
}

function isActualAmountUsable(amount, planned) {
  if (!Number.isFinite(Number(amount))) return false;
  const actual = Number(amount);
  const plannedValue = Number.isFinite(Number(planned)) ? Number(planned) : null;
  if (actual > 0) return true;
  if (actual === 0 && plannedValue != null && plannedValue === 0) return true;
  return false;
}

function cloneRecord(record) {
  if (typeof structuredClone === "function") return structuredClone(record || {});
  return JSON.parse(JSON.stringify(record || {}));
}

function toOrderSettings(state, incomingSettings = null) {
  const source = incomingSettings && typeof incomingSettings === "object"
    ? incomingSettings
    : (state?.settings || {});
  return {
    fxRate: parseNumber(source.fxRate),
    fxFeePct: parseNumber(source.fxFeePct),
    eurUsdRate: parseNumber(source.eurUsdRate),
    dutyRatePct: parseNumber(source.dutyRatePct),
    dutyIncludeFreight: source.dutyIncludeFreight !== false,
    eustRatePct: parseNumber(source.eustRatePct),
    vatRefundEnabled: source.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(source.vatRefundLagMonths || 0) || 0,
    freightLagDays: Number(source.freightLagDays || 0) || 0,
    cny: source.cny && typeof source.cny === "object"
      ? {
        start: String(source.cny.start || ""),
        end: String(source.cny.end || ""),
      }
      : { start: "", end: "" },
    cnyBlackoutByYear: source.cnyBlackoutByYear && typeof source.cnyBlackoutByYear === "object"
      ? cloneRecord(source.cnyBlackoutByYear)
      : {},
  };
}

function buildSupplierNameMap(state) {
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
  const key = normalizeKey(record?.supplierId || record?.supplier || record?.supplierName || "");
  if (key && supplierMap.has(key)) return supplierMap.get(key);
  const fallback = String(record?.supplierName || record?.supplier || "").trim();
  return fallback || "—";
}

function buildSkuAliasMap(products) {
  const map = new Map();
  (Array.isArray(products) ? products : []).forEach((entry) => {
    const product = entry || {};
    const key = normalizeKey(product.sku);
    if (!key) return;
    map.set(key, String(product.alias || product.sku || ""));
  });
  return map;
}

function readUnits(value) {
  const parsed = readFiniteNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function getRecordItems(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (items.length) return items;
  if (record?.sku) return [{ sku: record.sku, units: record.units || 0 }];
  return [];
}

function buildItemMeta(record, skuAliasMap) {
  const items = getRecordItems(record);
  if (!items.length) {
    return {
      skuAliases: "—",
      itemSummary: "—",
      itemTooltip: "Keine Positionen vorhanden.",
    };
  }

  const aliasList = [];
  const details = [];
  items.forEach((item) => {
    const sku = String(item?.sku || "").trim();
    const alias = sku ? (skuAliasMap.get(normalizeKey(sku)) || sku) : "—";
    const units = readUnits(item?.units);
    aliasList.push(alias);
    details.push(`${alias} (${sku || "—"}) · Menge ${units == null ? "—" : String(units)}`);
  });

  const uniqueAliases = Array.from(new Set(aliasList.filter(Boolean)));
  const skuAliases = uniqueAliases.join(", ") || "—";
  const itemSummary = uniqueAliases.length > 1 ? `${uniqueAliases[0]}, …` : (uniqueAliases[0] || "—");
  return {
    skuAliases,
    itemSummary,
    itemTooltip: details.join("\n") || skuAliases,
  };
}

function normalizeFoStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "DRAFT";
  if (raw === "PLANNED") return "ACTIVE";
  if (raw === "CANCELLED") return "ARCHIVED";
  return raw;
}

function isFoPlanningStatus(value) {
  const status = normalizeFoStatus(value);
  return status === "DRAFT" || status === "ACTIVE";
}

function sortPositions(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => {
    const leftIndex = POSITION_ORDER.indexOf(left);
    const rightIndex = POSITION_ORDER.indexOf(right);
    const safeLeft = leftIndex >= 0 ? leftIndex : POSITION_ORDER.length + 1;
    const safeRight = rightIndex >= 0 ? rightIndex : POSITION_ORDER.length + 1;
    return safeLeft - safeRight;
  });
}

function hasRelevantPosition(values) {
  return values.some((value) => RELEVANT_POSITIONS.has(value));
}

function classifyPaymentPositions({ label, eventType }) {
  const lowered = String(label || "").toLowerCase();
  const type = String(eventType || "").toLowerCase();
  if (type === "fx_fee" || lowered.includes("fx")) return [];

  const set = new Set();
  if (type === "freight") set.add("Shipping");
  if (type === "duty") set.add("Zoll");
  if (type === "eust") set.add("EUSt");
  if (type === "vat_refund" || type === "eust_refund") set.add("EUSt-Erstattung");

  if (lowered.includes("deposit") || lowered.includes("anzahlung")) set.add("Deposit");
  if (lowered.includes("balance2") || lowered.includes("balance 2") || lowered.includes("second balance")) {
    set.add("Balance2");
  } else if (lowered.includes("balance") || lowered.includes("rest")) {
    set.add("Balance");
  }
  if (lowered.includes("shipping") || lowered.includes("fracht")) set.add("Shipping");
  if (lowered.includes("eust")) set.add("EUSt");
  if (lowered.includes("zoll") || lowered.includes("custom") || lowered.includes("duty")) set.add("Zoll");
  if (lowered.includes("refund") && lowered.includes("eust")) set.add("EUSt-Erstattung");

  const positions = sortPositions(Array.from(set));
  if (!positions.length) return ["Other"];
  return positions;
}

function formatPositions(positions) {
  return sortPositions(positions).join("+") || "Other";
}

function buildPaymentIndexes(payments) {
  const byId = new Map();
  const allocationByEvent = new Map();
  const paymentIdsByEvent = new Map();
  (Array.isArray(payments) ? payments : []).forEach((entry) => {
    const payment = entry || {};
    const paymentId = String(payment.id || "").trim();
    if (!paymentId) return;
    byId.set(paymentId, payment);

    if (Array.isArray(payment.allocations)) {
      payment.allocations.forEach((allocationRaw) => {
        const allocation = allocationRaw || {};
        const eventId = String(allocation.eventId || allocation.plannedId || "").trim();
        if (!eventId) return;
        allocationByEvent.set(eventId, allocation);
        paymentIdsByEvent.set(eventId, paymentId);
      });
    }

    if (Array.isArray(payment.coveredEventIds)) {
      payment.coveredEventIds.forEach((eventIdRaw) => {
        const eventId = String(eventIdRaw || "").trim();
        if (!eventId) return;
        paymentIdsByEvent.set(eventId, paymentId);
      });
    }
  });
  return { byId, allocationByEvent, paymentIdsByEvent };
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
    let target = allocations[allocations.length - 1];
    if (allocations.length > 1) {
      target = allocations.reduce((best, entry) => (entry.planned > best.planned ? entry : best), target);
    }
    target.actual = Math.round((target.actual + remainder) * 100) / 100;
  }
  return allocations;
}

function resolveActualAllocation({ payment, paymentRow, paymentRows }) {
  if (!payment || !paymentRow?.paymentId) return null;
  const total = Number(payment.amountActualEurTotal);
  if (!Number.isFinite(total)) return null;

  const related = paymentRows.filter(
    (row) => String(row?.paymentId || "") === String(paymentRow.paymentId || ""),
  );
  if (!related.length) return null;

  const allocations = allocateByPlanned(total, related.map((row) => ({
    id: String(row.id || ""),
    plannedEur: Number(row.plannedEur || 0),
  })));
  if (!allocations) return null;
  return allocations.find((entry) => entry.eventId === paymentRow.id) || null;
}

function resolveActualAmountForLine({
  status,
  plannedEur,
  paymentRow,
  paymentRows,
  paymentRecord,
  paymentIndexes,
  paymentLogEntry,
  state,
  eventId,
  paidDate,
}) {
  const issues = [];
  if (status !== "PAID") return { amountActualEur: null, issues };

  const directCandidates = [
    paymentRow?.paidEurActual,
    paymentLogEntry?.amountActualEur,
  ];
  for (const candidate of directCandidates) {
    if (candidate == null || candidate === "") continue;
    if (!Number.isFinite(Number(candidate))) continue;
    if (isActualAmountUsable(candidate, plannedEur)) {
      return { amountActualEur: Number(candidate), issues };
    }
    issues.push("MISSING_ACTUAL_AMOUNT");
    return { amountActualEur: Number(candidate), issues };
  }

  if (paymentRecord?.allocations && Array.isArray(paymentRecord.allocations)) {
    const allocation = paymentRecord.allocations.find((entryRaw) => {
      const entry = entryRaw || {};
      const allocationEventId = String(entry.eventId || entry.plannedId || "").trim();
      if (!allocationEventId) return false;
      return allocationEventId === String(eventId || "");
    }) || null;
    if (allocation) {
      const allocationAmount = firstNonEmpty(
        allocation.amountEur,
        allocation.amountActualEur,
        allocation.actualEur,
        allocation.actual,
      );
      if (allocationAmount !== "" && isActualAmountUsable(allocationAmount, plannedEur)) {
        return { amountActualEur: Number(allocationAmount), issues };
      }
    }
  }

  if (paymentRecord && paymentRow?.paymentId) {
    const allocation = paymentIndexes.allocationByEvent.get(String(eventId || ""))
      || resolveActualAllocation({ payment: paymentRecord, paymentRow, paymentRows });
    if (allocation && isActualAmountUsable(allocation.actual, plannedEur)) {
      issues.push("PRO_RATA_ALLOCATION");
      return { amountActualEur: Number(allocation.actual), issues };
    }
    if (isActualAmountUsable(paymentRecord.amountActualEurTotal, plannedEur)) {
      const related = paymentRows.filter(
        (row) => String(row?.paymentId || "") === String(paymentRow?.paymentId || ""),
      );
      if (related.length <= 1) {
        return { amountActualEur: Number(paymentRecord.amountActualEurTotal), issues };
      }
    }
  }

  if (!paymentRow?.paymentId && paidDate && eventId) {
    const fallbackMatch = (Array.isArray(state?.payments) ? state.payments : []).find((entry) => {
      const payment = entry || {};
      if (normalizeIsoDate(payment.paidDate) !== normalizeIsoDate(paidDate)) return false;
      if (Array.isArray(payment.coveredEventIds) && payment.coveredEventIds.includes(eventId)) return true;
      return false;
    });
    if (fallbackMatch && isActualAmountUsable(fallbackMatch.amountActualEurTotal, plannedEur)) {
      return { amountActualEur: Number(fallbackMatch.amountActualEurTotal), issues };
    }
  }

  issues.push("MISSING_ACTUAL_AMOUNT");
  return { amountActualEur: null, issues };
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function combineDisplay(values) {
  const entries = uniq(values);
  if (!entries.length) return "";
  if (entries.length === 1) return entries[0];
  return `${entries[0]}, …`;
}

function collectEventRowsForPo({ state, settings, supplierNameMap, skuAliasMap, paymentIndexes }) {
  const rows = [];
  const payments = Array.isArray(state?.payments) ? state.payments : [];
  const poRecords = Array.isArray(state?.pos) ? state.pos : [];

  poRecords.forEach((entry) => {
    const record = entry || {};
    if (record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const supplierName = resolveSupplierName(record, supplierNameMap);
    const itemMeta = buildItemMeta(record, skuAliasMap);
    const recordId = String(record.id || record.poNo || "po");
    const paymentLog = (record.paymentLog && typeof record.paymentLog === "object") ? record.paymentLog : {};

    const paymentRows = buildPaymentRows(
      cloneRecord(record),
      PO_CONFIG,
      settings,
      payments,
      { includeIncoming: true },
    );

    const seenEventIds = new Set();
    paymentRows.forEach((paymentRowRaw) => {
      const paymentRow = paymentRowRaw || {};
      const eventId = String(paymentRow.id || "").trim();
      if (!eventId) return;
      seenEventIds.add(eventId);

      const logEntry = (paymentLog[eventId] && typeof paymentLog[eventId] === "object")
        ? paymentLog[eventId]
        : {};

      const positions = classifyPaymentPositions({
        label: paymentRow.typeLabel || paymentRow.label || logEntry.label || "",
        eventType: paymentRow.eventType || logEntry.eventType || "",
      });
      if (!hasRelevantPosition(positions)) return;

      const paymentId = firstNonEmpty(
        paymentRow.paymentId,
        logEntry.paymentId,
        paymentIndexes.paymentIdsByEvent.get(eventId),
      );
      const paymentRecord = paymentId ? paymentIndexes.byId.get(paymentId) || null : null;
      const status = (
        isPaidLike(paymentRow.status)
        || isPaidLike(logEntry.status)
        || isPaidLike(logEntry.paid)
        || (paymentRecord ? isPaidLike(paymentRecord.status) : false)
      )
        ? "PAID"
        : "OPEN";

      const dueDate = normalizeIsoDate(firstNonEmpty(paymentRow.dueDate, logEntry.dueDate));
      let paidDate = normalizeIsoDate(firstNonEmpty(paymentRecord?.paidDate, paymentRow.paidDate, logEntry.paidDate));
      const issues = [];
      if (status === "PAID" && !paidDate && dueDate) {
        paidDate = dueDate;
        issues.push("DATE_UNCERTAIN");
      }
      if (status === "PAID" && !paidDate) {
        issues.push("PAID_WITHOUT_DATE");
      }

      const planned = readFiniteNumber(paymentRow.plannedEur);
      const resolved = resolveActualAmountForLine({
        status,
        plannedEur: planned,
        paymentRow,
        paymentRows,
        paymentRecord,
        paymentIndexes,
        paymentLogEntry: logEntry,
        state,
        eventId,
        paidDate,
      });
      let actual = resolved.amountActualEur;
      issues.push(...resolved.issues);

      if (status === "PAID" && !isActualAmountUsable(actual, planned)) {
        if (Number.isFinite(planned)) {
          actual = planned;
          issues.push("IST_FEHLT");
        } else {
          actual = null;
          issues.push("IST_FEHLT");
        }
      }

      const synthetic = status === "PAID" && (!paymentId || !paymentRecord);
      if (synthetic) issues.push("AUTO_GENERATED");

      const month = status === "PAID" ? monthFromDate(paidDate) : monthFromDate(dueDate);
      const rowId = `PO-EVT-${recordId}-${eventId}`;

      rows.push({
        rowId,
        eventId,
        month,
        entityType: "PO",
        poNumber: String(record.poNo || record.id || ""),
        foNumber: "",
        supplierName,
        skuAliases: itemMeta.skuAliases,
        itemSummary: itemMeta.itemSummary,
        itemTooltip: itemMeta.itemTooltip,
        paymentType: formatPositions(positions),
        includedPositions: sortPositions(positions),
        status,
        dueDate,
        paidDate,
        paymentId: paymentId || "",
        amountPlannedEur: planned,
        amountActualEur: status === "PAID" ? round2(actual) : null,
        payer: firstNonEmpty(paymentRow.paidBy, paymentRecord?.payer, logEntry.payer),
        paymentMethod: firstNonEmpty(paymentRow.method, paymentRecord?.method, logEntry.method),
        note: firstNonEmpty(paymentRow.note, paymentRecord?.note, logEntry.note),
        internalId: String(paymentRow.paymentInternalId || paymentRow.id || record.id || rowId),
        issues: uniq(issues),
        _positions: sortPositions(positions),
      });
    });

    Object.entries(paymentLog).forEach(([eventId, logEntryRaw]) => {
      if (seenEventIds.has(eventId)) return;
      const logEntry = (logEntryRaw && typeof logEntryRaw === "object") ? logEntryRaw : {};
      const status = (isPaidLike(logEntry.status) || isPaidLike(logEntry.paid)) ? "PAID" : "OPEN";
      if (status !== "PAID") return;

      const positions = classifyPaymentPositions({
        label: logEntry.label || eventId,
        eventType: logEntry.eventType || "",
      });
      if (!hasRelevantPosition(positions)) return;

      const paymentId = firstNonEmpty(logEntry.paymentId, paymentIndexes.paymentIdsByEvent.get(eventId));
      const paymentRecord = paymentId ? paymentIndexes.byId.get(paymentId) || null : null;
      const dueDate = normalizeIsoDate(firstNonEmpty(logEntry.dueDate));
      let paidDate = normalizeIsoDate(firstNonEmpty(paymentRecord?.paidDate, logEntry.paidDate));
      const issues = ["AUTO_GENERATED"];
      if (!paidDate && dueDate) {
        paidDate = dueDate;
        issues.push("DATE_UNCERTAIN");
      }
      if (!paidDate) issues.push("PAID_WITHOUT_DATE");

      const planned = readFiniteNumber(firstNonEmpty(logEntry.amountPlannedEur, logEntry.plannedEur));
      let actual = readFiniteNumber(firstNonEmpty(logEntry.amountActualEur, paymentRecord?.amountActualEurTotal));
      if (!isActualAmountUsable(actual, planned)) {
        if (Number.isFinite(planned)) {
          actual = planned;
          issues.push("IST_FEHLT");
        } else {
          actual = null;
          issues.push("IST_FEHLT");
        }
      }

      const month = monthFromDate(paidDate);
      const rowId = `PO-LEGACY-${recordId}-${eventId}`;
      rows.push({
        rowId,
        eventId,
        month,
        entityType: "PO",
        poNumber: String(record.poNo || record.id || ""),
        foNumber: "",
        supplierName,
        skuAliases: itemMeta.skuAliases,
        itemSummary: itemMeta.itemSummary,
        itemTooltip: itemMeta.itemTooltip,
        paymentType: formatPositions(positions),
        includedPositions: sortPositions(positions),
        status: "PAID",
        dueDate,
        paidDate,
        paymentId: paymentId || "",
        amountPlannedEur: planned,
        amountActualEur: round2(actual),
        payer: firstNonEmpty(paymentRecord?.payer, logEntry.payer),
        paymentMethod: firstNonEmpty(paymentRecord?.method, logEntry.method),
        note: firstNonEmpty(paymentRecord?.note, logEntry.note),
        internalId: String(logEntry.paymentInternalId || eventId || record.id || rowId),
        issues: uniq(issues),
        _positions: sortPositions(positions),
      });
    });
  });

  return rows;
}

function mergeGroupedPoPayments(eventRows, paymentIndexes) {
  const groupedByPayment = new Map();
  const output = [];

  eventRows.forEach((row) => {
    if (row.status === "PAID" && row.paymentId) {
      if (!groupedByPayment.has(row.paymentId)) groupedByPayment.set(row.paymentId, []);
      groupedByPayment.get(row.paymentId).push(row);
      return;
    }
    output.push(row);
  });

  groupedByPayment.forEach((rows, paymentId) => {
    if (!rows.length) return;
    if (rows.length === 1) {
      output.push(rows[0]);
      return;
    }

    const paymentRecord = paymentIndexes.byId.get(paymentId) || null;
    const allPositions = sortPositions(rows.flatMap((row) => row._positions || []));
    const issues = uniq([
      ...rows.flatMap((row) => row.issues || []),
      "GROUPED_PAYMENT",
    ]);

    const plannedTotal = round2(rows.reduce((sum, row) => sum + (Number(row.amountPlannedEur) || 0), 0));
    let actual = readFiniteNumber(paymentRecord?.amountActualEurTotal);
    if (!isActualAmountUsable(actual, plannedTotal)) {
      actual = round2(rows.reduce((sum, row) => sum + (Number(row.amountActualEur) || 0), 0));
    }
    if (!isActualAmountUsable(actual, plannedTotal)) {
      if (Number.isFinite(plannedTotal)) {
        actual = plannedTotal;
        issues.push("IST_FEHLT");
      } else {
        actual = null;
      }
    }

    let paidDate = normalizeIsoDate(firstNonEmpty(
      paymentRecord?.paidDate,
      ...rows.map((row) => row.paidDate),
    ));
    const dueDateCandidates = rows.map((row) => normalizeIsoDate(row.dueDate)).filter(Boolean).sort();
    const dueDate = dueDateCandidates[0] || "";
    if (!paidDate && dueDate) {
      paidDate = dueDate;
      issues.push("DATE_UNCERTAIN");
    }

    const month = monthFromDate(paidDate);
    const poNumbers = uniq(rows.map((row) => row.poNumber));
    const suppliers = uniq(rows.map((row) => row.supplierName));
    const aliasSet = uniq(rows.flatMap((row) => String(row.skuAliases || "").split(",").map((value) => value.trim())));
    const itemSummary = aliasSet.length > 1 ? `${aliasSet[0]}, …` : (aliasSet[0] || "—");
    const itemTooltip = uniq(rows.map((row) => row.itemTooltip)).join("\n\n");

    output.push({
      rowId: `PO-PAY-${paymentId}-${month || "undated"}-${poNumbers[0] || "po"}`,
      eventId: rows.map((row) => row.eventId).join("|"),
      month,
      entityType: "PO",
      poNumber: combineDisplay(poNumbers) || "—",
      foNumber: "",
      supplierName: combineDisplay(suppliers) || "—",
      skuAliases: aliasSet.join(", ") || "—",
      itemSummary,
      itemTooltip: itemTooltip || rows[0].itemTooltip || "",
      paymentType: formatPositions(allPositions),
      includedPositions: allPositions,
      status: "PAID",
      dueDate,
      paidDate,
      paymentId,
      amountPlannedEur: plannedTotal,
      amountActualEur: round2(actual),
      payer: firstNonEmpty(paymentRecord?.payer, ...rows.map((row) => row.payer)),
      paymentMethod: firstNonEmpty(paymentRecord?.method, ...rows.map((row) => row.paymentMethod)),
      note: firstNonEmpty(paymentRecord?.note, ...rows.map((row) => row.note)),
      internalId: paymentId,
      issues: uniq(issues),
    });
  });

  return output;
}

function collectFoRows({ state, supplierNameMap, skuAliasMap }) {
  const rows = [];
  const foRecords = Array.isArray(state?.fos) ? state.fos : [];

  foRecords.forEach((entry) => {
    const record = entry || {};
    if (!isFoPlanningStatus(record.status)) return;
    if (!Array.isArray(record.payments)) return;

    const supplierName = resolveSupplierName(record, supplierNameMap);
    const sku = String(record.sku || "").trim();
    const alias = sku ? (skuAliasMap.get(normalizeKey(sku)) || sku) : "—";
    const fxRate = Number(record.fxRate || 0);

    record.payments.forEach((paymentRaw) => {
      const payment = paymentRaw || {};
      if (String(payment.category || "").toLowerCase() === "eust_refund") return;

      const positions = classifyPaymentPositions({
        label: payment.label || payment.category || "",
        eventType: payment.category || "",
      });
      if (!hasRelevantPosition(positions)) return;

      const rawAmount = Number(payment.amount || 0);
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) return;

      const currency = String(payment.currency || "EUR").toUpperCase();
      const planned = currency === "EUR" ? rawAmount : (fxRate > 0 ? rawAmount / fxRate : rawAmount);
      const dueDate = normalizeIsoDate(payment.dueDate);
      const month = monthFromDate(dueDate);
      const entityId = String(record.id || record.foNumber || "");
      const paymentType = formatPositions(positions);
      const eventId = String(payment.id || `${entityId}-${paymentType}-${dueDate}`);

      rows.push({
        rowId: `FO-${entityId}-${eventId}`,
        eventId,
        month,
        entityType: "FO",
        poNumber: String(record.convertedPoNo || ""),
        foNumber: String(record.foNumber || record.id || ""),
        supplierName,
        skuAliases: alias,
        itemSummary: alias,
        itemTooltip: `${alias} (${sku || "—"})`,
        paymentType,
        includedPositions: sortPositions(positions),
        status: "OPEN",
        dueDate,
        paidDate: "",
        paymentId: "",
        amountPlannedEur: round2(planned),
        amountActualEur: null,
        payer: "",
        paymentMethod: "",
        note: "",
        internalId: String(record.id || eventId),
        issues: [],
      });
    });
  });

  return rows;
}

function rowSortDate(row) {
  if (row.status === "PAID") return normalizeIsoDate(row.paidDate || row.dueDate);
  return normalizeIsoDate(row.dueDate || row.paidDate);
}

function dedupeRows(rows) {
  const deduped = [];
  const seen = new Set();
  rows.forEach((row) => {
    const key = String(row.rowId || "");
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(row);
  });
  return deduped;
}

export function buildPaymentJournalRowsCore(input = {}) {
  const state = input?.state && typeof input.state === "object" ? input.state : {};
  const settings = toOrderSettings(state, input?.settings || null);
  const products = Array.isArray(input?.products) ? input.products : (Array.isArray(state?.products) ? state.products : []);
  const month = normalizeMonth(input?.month || "");
  const scope = String(input?.scope || "both");
  const includeFo = input?.includeFo !== false;

  const supplierNameMap = buildSupplierNameMap(state);
  const skuAliasMap = buildSkuAliasMap(products);
  const paymentIndexes = buildPaymentIndexes(Array.isArray(state?.payments) ? state.payments : []);

  const poEventRows = collectEventRowsForPo({
    state,
    settings,
    supplierNameMap,
    skuAliasMap,
    paymentIndexes,
  });
  const poRows = mergeGroupedPoPayments(poEventRows, paymentIndexes);
  const foRows = includeFo
    ? collectFoRows({ state, supplierNameMap, skuAliasMap })
    : [];

  const rows = dedupeRows([...poRows, ...foRows]).filter((row) => {
    if (scope === "paid" && row.status !== "PAID") return false;
    if (scope === "open" && row.status !== "OPEN") return false;
    if (month && row.month !== month) return false;
    return true;
  });

  return rows.sort((left, right) => {
    const leftDate = rowSortDate(left);
    const rightDate = rowSortDate(right);
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const leftRef = `${left.entityType}:${left.poNumber || left.foNumber}:${left.paymentType}:${left.rowId}`;
    const rightRef = `${right.entityType}:${right.poNumber || right.foNumber}:${right.paymentType}:${right.rowId}`;
    return leftRef.localeCompare(rightRef);
  });
}

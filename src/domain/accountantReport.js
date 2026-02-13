import { parseDeNumber } from "../lib/dataHealth.js";
import { buildPaymentRows } from "../ui/orderEditorFactory.js";
import { buildAccountantWorkbookBlob } from "./accountantWorkbook.js";
import { buildAccountantPdfBlob } from "./accountantPdf.js";
import { buildZipBlob, monthFileStamp } from "./accountantBundle.js";

const PO_CONFIG = { slug: "po", entityLabel: "PO", numberField: "poNo" };

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
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
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
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function endOfMonthIso(month) {
  const normalized = normalizeMonth(month);
  const [year, monthIndex] = normalized.split("-").map(Number);
  const date = new Date(year, monthIndex, 0);
  return toIsoDate(date);
}

function buildSettings(state) {
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
    defaultCurrency: String(settings.defaultCurrency || "EUR").toUpperCase(),
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

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveSupplierName(record, supplierMap) {
  const key = normalizeKey(record?.supplierId || record?.supplier || record?.supplierName);
  if (key && supplierMap.has(key)) return supplierMap.get(key);
  const fallback = record?.supplierName || record?.supplier || "";
  return fallback ? String(fallback) : "-";
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

function buildProductMaps(state) {
  const bySku = new Map();
  const aliasBySku = new Map();
  const categoryMap = new Map();

  (Array.isArray(state?.productCategories) ? state.productCategories : []).forEach((entry) => {
    const category = entry || {};
    const id = String(category.id || "").trim();
    if (!id) return;
    categoryMap.set(id, String(category.name || "Ohne Kategorie"));
  });

  (Array.isArray(state?.products) ? state.products : []).forEach((entry) => {
    const product = entry || {};
    const sku = String(product.sku || "").trim();
    if (!sku) return;
    const key = normalizeKey(sku);
    const alias = String(product.alias || sku).trim();
    bySku.set(key, product);
    aliasBySku.set(key, alias || sku);
  });

  return {
    productBySku: bySku,
    aliasBySku,
    categoryMap,
  };
}

function resolveSkuAliases(record, aliasBySku) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  const skus = items.length
    ? items.map((item) => String(item?.sku || "").trim()).filter(Boolean)
    : [String(record?.sku || "").trim()].filter(Boolean);
  const aliases = Array.from(new Set(skus.map((sku) => aliasBySku.get(normalizeKey(sku)) || sku)));
  return aliases.join(", ") || "-";
}

function parseUnits(value) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(Number(parsed)));
}

function parseMoney(value) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed);
}

function getPoItems(record) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  if (items.length) return items;
  if (record?.sku) {
    return [{ sku: record.sku, units: record.units || 0 }];
  }
  return [];
}

function computeGoodsUsd(record) {
  const fromHeader = parseMoney(record?.goodsUsd || record?.goodsAmountUsd);
  if (Number.isFinite(fromHeader)) return fromHeader;

  const items = getPoItems(record);
  if (!items.length) return null;

  let total = 0;
  let hasData = false;

  items.forEach((item) => {
    const units = parseUnits(item.units);
    const unitCost = parseMoney(item.unitCostUsd || item.unitPriceUsd || record?.unitCostUsd);
    const unitExtra = parseMoney(item.unitExtraUsd);
    const extraFlat = parseMoney(item.extraFlatUsd);
    const effectiveCost = Number.isFinite(unitCost) ? unitCost : null;
    if (!Number.isFinite(effectiveCost)) return;
    const extraPerUnit = Number.isFinite(unitExtra) ? unitExtra : 0;
    const extraTotal = Number.isFinite(extraFlat) ? extraFlat : 0;
    const line = (units * (effectiveCost + extraPerUnit)) + extraTotal;
    if (!Number.isFinite(line)) return;
    total += line;
    hasData = true;
  });

  return hasData ? total : null;
}

function computeGoodsEur(record, settings, goodsUsd) {
  const direct = parseMoney(record?.goodsEur || record?.goodsAmountEur);
  if (Number.isFinite(direct)) return direct;
  if (!Number.isFinite(goodsUsd)) return null;
  const fx = parseMoney(record?.fxOverride) || parseMoney(settings?.fxRate);
  if (!Number.isFinite(fx) || fx <= 0) return null;
  return goodsUsd / fx;
}

function resolveEtdDate(record) {
  const manual = toIsoDate(record?.etdManual || record?.etdDate);
  if (manual) return manual;
  const orderDate = parseDate(record?.orderDate);
  if (!orderDate) return null;
  const prodDays = Math.max(0, Number(record?.prodDays || 0));
  const etd = new Date(orderDate.getTime());
  etd.setDate(etd.getDate() + prodDays);
  return toIsoDate(etd);
}

function resolveEtaDate(record) {
  const manual = toIsoDate(record?.etaManual || record?.etaDate || record?.eta);
  if (manual) return manual;
  const computed = toIsoDate(record?.etaComputed);
  if (computed) return computed;
  const etd = parseDate(resolveEtdDate(record));
  if (!etd) return null;
  const transitDays = Math.max(0, Number(record?.transitDays || 0));
  const eta = new Date(etd.getTime());
  eta.setDate(eta.getDate() + transitDays);
  return toIsoDate(eta);
}

function resolveArrivalDate(record) {
  const priority = [
    { key: "arrivalDateDe", mode: "de" },
    { key: "arrivalDate", mode: "auto" },
    { key: "etaManual", mode: "auto" },
    { key: "etaDate", mode: "auto" },
    { key: "eta", mode: "auto" },
  ];

  for (const entry of priority) {
    const raw = record?.[entry.key];
    if (!raw) continue;
    const parsed = entry.mode === "de" ? parseDate(String(raw).replace(/\s+/g, "")) : parseDate(raw);
    const iso = toIsoDate(parsed);
    if (iso) return { date: iso, source: entry.key };
  }

  const computed = resolveEtaDate(record);
  if (computed) return { date: computed, source: "etaComputed" };
  return { date: null, source: "missing" };
}

function findSnapshot(state, month) {
  const snapshots = Array.isArray(state?.inventory?.snapshots) ? state.inventory.snapshots : [];
  return snapshots.find((snap) => String(snap?.month || "") === month) || null;
}

function resolveProductEkEur(product, settings) {
  const template = product?.template?.fields || product?.template || {};
  const unitPrice = parseMoney(template?.unitPriceUsd ?? product?.unitPriceUsd);
  if (!Number.isFinite(unitPrice)) return null;

  const currencyRaw = String(template?.currency || settings?.defaultCurrency || "EUR").toUpperCase();
  if (currencyRaw === "EUR") return unitPrice;
  if (currencyRaw === "USD") {
    const fx = parseMoney(settings?.fxRate);
    if (!Number.isFinite(fx) || fx <= 0) return null;
    return unitPrice / fx;
  }
  return null;
}

function endOfMonthDate(month) {
  const [year, monthValue] = normalizeMonth(month).split("-").map(Number);
  const date = new Date(year, monthValue, 0);
  date.setHours(23, 59, 59, 999);
  return date;
}

function resolvePoEtaForTransit(record) {
  const arrival = resolveArrivalDate(record);
  return parseDate(arrival.date);
}

function computeInTransitBySku(state, month) {
  const cutoff = endOfMonthDate(month);
  const inTransit = new Map();

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;
    const orderDate = parseDate(record.orderDate);
    if (orderDate && orderDate > cutoff) return;
    const eta = resolvePoEtaForTransit(record);
    if (eta && eta <= cutoff) return;

    getPoItems(record).forEach((item) => {
      const sku = String(item?.sku || "").trim();
      if (!sku) return;
      const key = normalizeKey(sku);
      const units = parseUnits(item?.units);
      if (!units) return;
      inTransit.set(key, (inTransit.get(key) || 0) + units);
    });
  });

  return inTransit;
}

function addQualityIssue(target, seen, issue) {
  const key = `${issue.code || "ISSUE"}|${issue.entityType || ""}|${issue.entityId || ""}|${issue.message || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(issue);
}

function buildInventorySection(state, request, options, productMaps, quality, qualitySeen) {
  const month = request.month;
  const settings = buildSettings(state);
  const snapshot = findSnapshot(state, month);
  const snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const monthAsOf = snapshot?.asOfDate || endOfMonthIso(month);
  const inTransitBySku = computeInTransitBySku(state, month);
  const rows = [];

  let totalAmazonUnits = 0;
  let total3plUnits = 0;
  let totalInTransitUnits = 0;
  let totalValueEur = 0;
  let hasValuableRows = false;

  snapshotItems.forEach((item) => {
    const sku = String(item?.sku || "").trim();
    if (!sku) return;
    const key = normalizeKey(sku);
    const product = productMaps.productBySku.get(key) || {};
    const alias = String(product.alias || sku);
    const category = productMaps.categoryMap.get(String(product.categoryId || "")) || "Ohne Kategorie";
    const amazonUnits = parseUnits(item?.amazonUnits);
    const threePLUnits = parseUnits(item?.threePLUnits);
    const inTransitUnits = parseUnits(item?.inTransitUnits) || (inTransitBySku.get(key) || 0);
    const totalUnits = amazonUnits + threePLUnits + inTransitUnits;
    const ekEur = resolveProductEkEur(product, settings);
    const rowValueEur = Number.isFinite(ekEur) ? totalUnits * ekEur : null;

    if (!Number.isFinite(ekEur)) {
      addQualityIssue(quality, qualitySeen, {
        code: "MISSING_EK_PRICE",
        severity: "warning",
        message: `Kein EK-Preis fuer SKU ${sku} vorhanden.`,
        entityType: "INVENTORY",
        entityId: sku,
      });
    }

    totalAmazonUnits += amazonUnits;
    total3plUnits += threePLUnits;
    totalInTransitUnits += inTransitUnits;
    if (Number.isFinite(rowValueEur)) {
      totalValueEur += rowValueEur;
      hasValuableRows = true;
    }

    rows.push({
      sku,
      alias,
      category,
      amazonUnits,
      threePLUnits,
      inTransitUnits,
      totalUnits,
      ekEur,
      rowValueEur,
      note: String(item?.note || ""),
    });
  });

  if (!snapshot) {
    addQualityIssue(quality, qualitySeen, {
      code: "MISSING_SNAPSHOT",
      severity: "warning",
      message: `Kein Inventory-Snapshot fuer ${month} gefunden.`,
      entityType: "INVENTORY",
      entityId: month,
    });
  }

  let manualOverrideUsed = false;
  if ((!hasValuableRows || !snapshot) && Number.isFinite(Number(options?.inventoryValueOverrideEur))) {
    totalValueEur = Number(options.inventoryValueOverrideEur);
    manualOverrideUsed = true;
  }

  const summary = {
    month,
    snapshotAsOf: monthAsOf,
    totalValueEur: hasValuableRows || manualOverrideUsed ? totalValueEur : null,
    totalAmazonUnits,
    total3plUnits,
    totalInTransitUnits,
    manualOverrideUsed,
    issues: quality
      .filter((issue) => issue.entityType === "INVENTORY")
      .map((issue) => issue.code),
  };

  return { summary, rows };
}

function buildDepositsSection(state, request, productMaps, supplierMap, quality, qualitySeen) {
  const settings = buildSettings(state);
  const month = request.month;
  const rows = [];

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const workingRecord = structuredClone(record);
    const paymentRows = buildPaymentRows(workingRecord, PO_CONFIG, settings, state?.payments || []);
    const goodsUsd = computeGoodsUsd(record);

    paymentRows.forEach((payment) => {
      const status = String(payment?.status || "").toUpperCase();
      const typeLabel = String(payment?.typeLabel || "");
      const isDeposit = /deposit|anzahlung/i.test(typeLabel);
      if (!isDeposit) return;

      if (status === "PAID" && !payment?.paidDate) {
        addQualityIssue(quality, qualitySeen, {
          code: "PAID_WITHOUT_DATE",
          severity: "warning",
          message: `PO ${record.poNo || record.id || "-"}: Deposit ist bezahlt, aber paidDate fehlt.`,
          entityType: "PO",
          entityId: String(record.id || record.poNo || ""),
        });
      }

      if (status !== "PAID") return;
      if (monthFromDate(payment?.paidDate) !== month) return;

      const milestone = (Array.isArray(record?.milestones) ? record.milestones : []).find((entry) => entry?.id === payment?.id);
      const percent = parseMoney(milestone?.percent);
      const amountUsd = Number.isFinite(goodsUsd) && Number.isFinite(percent)
        ? (goodsUsd * percent) / 100
        : null;

      const actualEur = Number.isFinite(Number(payment?.paidEurActual)) ? Number(payment.paidEurActual) : null;
      const plannedEur = Number.isFinite(Number(payment?.plannedEur)) ? Number(payment.plannedEur) : null;

      const rowIssues = [];
      if (!Number.isFinite(amountUsd)) rowIssues.push("MISSING_USD");
      if (!Number.isFinite(actualEur)) rowIssues.push("MISSING_ACTUAL_EUR");
      if (!payment?.invoiceDriveUrl && !payment?.invoiceFolderDriveUrl) rowIssues.push("MISSING_INVOICE_LINK");

      rowIssues.forEach((code) => {
        addQualityIssue(quality, qualitySeen, {
          code,
          severity: code === "MISSING_ACTUAL_EUR" ? "warning" : "info",
          message: `PO ${record.poNo || record.id || "-"}: ${code}`,
          entityType: "PO",
          entityId: String(record.id || record.poNo || ""),
        });
      });

      const arrivalInfo = resolveArrivalDate(record);

      rows.push({
        poNumber: String(record.poNo || record.id || ""),
        supplier: resolveSupplierName(record, supplierMap),
        skuAliases: resolveSkuAliases(record, productMaps.aliasBySku),
        paymentType: "Deposit",
        plannedEur,
        actualEur,
        paidDate: toIsoDate(payment?.paidDate),
        dueDate: toIsoDate(payment?.dueDate),
        amountUsd,
        etdDate: resolveEtdDate(record),
        etaDate: resolveEtaDate(record),
        arrivalDate: arrivalInfo.date,
        invoiceUrl: payment?.invoiceDriveUrl || "",
        folderUrl: payment?.invoiceFolderDriveUrl || "",
        issues: rowIssues,
      });
    });
  });

  return rows.sort((a, b) => String(a.paidDate || "").localeCompare(String(b.paidDate || "")));
}

function buildArrivalsSection(state, request, productMaps, supplierMap, quality, qualitySeen) {
  const settings = buildSettings(state);
  const month = request.month;
  const rows = [];

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const arrivalInfo = resolveArrivalDate(record);
    if (!arrivalInfo.date) {
      addQualityIssue(quality, qualitySeen, {
        code: "MISSING_ARRIVAL_DATE",
        severity: "warning",
        message: `PO ${record.poNo || record.id || "-"}: kein Arrival/ETA Datum vorhanden.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
      });
      return;
    }

    if (monthFromDate(arrivalInfo.date) !== month) return;

    const items = getPoItems(record);
    const units = items.reduce((sum, item) => sum + parseUnits(item?.units), 0);
    const goodsUsd = computeGoodsUsd(record);
    const goodsEur = computeGoodsEur(record, settings, goodsUsd);

    const rowIssues = [];
    if (!Number.isFinite(goodsUsd)) rowIssues.push("MISSING_GOODS_USD");
    if (!Number.isFinite(goodsEur)) rowIssues.push("MISSING_GOODS_EUR");
    if (arrivalInfo.source !== "arrivalDate" && arrivalInfo.source !== "arrivalDateDe") {
      rowIssues.push("ARRIVAL_FROM_ETA");
    }

    rowIssues.forEach((code) => {
      addQualityIssue(quality, qualitySeen, {
        code,
        severity: code.startsWith("MISSING") ? "warning" : "info",
        message: `PO ${record.poNo || record.id || "-"}: ${code}`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
      });
    });

    rows.push({
      poNumber: String(record.poNo || record.id || ""),
      supplier: resolveSupplierName(record, supplierMap),
      skuAliases: resolveSkuAliases(record, productMaps.aliasBySku),
      units,
      goodsUsd,
      goodsEur,
      etdDate: resolveEtdDate(record),
      etaDate: resolveEtaDate(record),
      arrivalDate: arrivalInfo.date,
      transport: String(record.transport || ""),
      issues: rowIssues,
    });
  });

  return rows.sort((a, b) => String(a.arrivalDate || "").localeCompare(String(b.arrivalDate || "")));
}

function normalizeJournalPaymentType(typeLabel, eventType) {
  const label = String(typeLabel || "").toLowerCase();
  if (eventType === "fx_fee" || label.includes("fx")) return null;
  if (eventType === "freight" || label.includes("shipping") || label.includes("fracht")) return "Fracht";
  if (eventType === "eust" || label.includes("eust")) return "EUSt";
  if (label.includes("balance2") || label.includes("balance 2") || label.includes("second balance")) return "Balance2";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  return "Other";
}

function buildPoJournalRows(state, request, supplierMap, productMaps) {
  const settings = buildSettings(state);
  const month = request.month;
  const rows = [];

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const supplierName = resolveSupplierName(record, supplierMap);
    const skuAliases = resolveSkuAliases(record, productMaps.aliasBySku);
    const paymentRows = buildPaymentRows(structuredClone(record), PO_CONFIG, settings, state?.payments || []);

    paymentRows.forEach((payment) => {
      const paymentType = normalizeJournalPaymentType(payment?.typeLabel || payment?.label, payment?.eventType);
      if (!paymentType) return;
      const status = String(payment?.status || "").toUpperCase() === "PAID" ? "PAID" : "OPEN";
      const paidDate = toIsoDate(payment?.paidDate);
      const dueDate = toIsoDate(payment?.dueDate);
      const rowMonth = status === "PAID" ? String(paidDate || "").slice(0, 7) : String(dueDate || "").slice(0, 7);
      if (month && rowMonth !== month) return;

      const amountPlannedEur = Number.isFinite(Number(payment?.plannedEur)) ? Number(payment.plannedEur) : null;
      const amountActualEur = Number.isFinite(Number(payment?.paidEurActual)) ? Number(payment.paidEurActual) : null;
      const issues = [];
      if (status === "PAID" && amountActualEur == null) issues.push("MISSING_ACTUAL_AMOUNT");

      rows.push({
        month: rowMonth,
        entityType: "PO",
        poNumber: String(record.poNo || record.id || ""),
        supplierName,
        skuAliases,
        paymentType,
        status,
        dueDate,
        paidDate,
        amountPlannedEur,
        amountActualEur,
        issues,
        paymentId: String(payment?.paymentId || ""),
      });
    });
  });

  return rows.sort((a, b) => {
    const left = a.dueDate || a.paidDate || "";
    const right = b.dueDate || b.paidDate || "";
    return left.localeCompare(right);
  });
}

function formatCsvNumber(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

function escapeCsvCell(value, delimiter = ";") {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (!raw.includes(delimiter) && !raw.includes("\"") && !raw.includes("\n")) return raw;
  return `\"${raw.replace(/\"/g, "\"\"")}\"`;
}

function toCsv(rows, headers, delimiter = ";") {
  const head = headers.map((header) => escapeCsvCell(header.label, delimiter)).join(delimiter);
  const lines = rows.map((row) => headers
    .map((header) => {
      const value = header.format ? header.format(row[header.key], row) : row[header.key];
      return escapeCsvCell(value, delimiter);
    })
    .join(delimiter));
  return [head, ...lines].join("\n");
}

function buildEmailDraft(report, options = {}) {
  const month = report.request.month;
  const workspaceName = String(options.workspaceName || report.workspaceName || "Workspace");
  const attachments = [
    `buchhaltung_${month}_bericht.pdf`,
    `buchhaltung_${month}.xlsx`,
    `buchhaltung_${month}_warenbestand.csv`,
    `buchhaltung_${month}_anzahlungen_po.csv`,
    `buchhaltung_${month}_wareneingang_po.csv`,
  ];

  if (report.request.scope === "core_plus_journal") {
    attachments.push(`buchhaltung_${month}_zahlungsjournal.csv`);
  }

  attachments.push(`buchhaltung_${month}_email.txt`);

  const subject = `Unterlagen Buchhaltung ${month} - Mandant ${workspaceName}`;
  const lines = [
    `Betreff: ${subject}`,
    "",
    "Hallo,",
    "",
    `anbei das Buchhalter-Paket fuer ${month}.`,
    "",
    "Kurzstatus:",
    `- Warenbestand zum Monatsende (${report.inventory.snapshotAsOf || "n/a"}): ${Number.isFinite(Number(report.inventory.totalValueEur)) ? `${Number(report.inventory.totalValueEur).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : "kein Wert verfuegbar"}`,
    `- Lieferanzahlungen (PO, paidDate im Monat): ${report.deposits.length} Zeilen`,
    `- Wareneingaenge (PO, Arrival/ETA im Monat): ${report.arrivals.length} Zeilen`,
    `- Datenqualitaetshinweise: ${(report.quality || []).length}`,
    "",
    "Anlagen:",
    ...attachments.map((file) => `- ${file}`),
    "",
    "Viele Gruesse",
  ];

  return {
    subject,
    text: lines.join("\n"),
    attachments,
  };
}

function resolveRequest(input = {}) {
  return {
    month: normalizeMonth(input.month),
    scope: input.scope === "core_plus_journal" ? "core_plus_journal" : "core",
    includeCsv: input.includeCsv !== false,
    includeXlsx: input.includeXlsx !== false,
    includePdf: input.includePdf !== false,
    includeEmailDraft: input.includeEmailDraft !== false,
    poOnly: true,
    mode: "paid_and_arrival",
  };
}

export function buildAccountantReportData(state, requestInput = {}, options = {}) {
  const request = resolveRequest(requestInput);
  const sourceState = state && typeof state === "object" ? state : {};
  const supplierMap = buildSupplierMap(sourceState);
  const productMaps = buildProductMaps(sourceState);
  const quality = [];
  const qualitySeen = new Set();

  const inventory = buildInventorySection(sourceState, request, options, productMaps, quality, qualitySeen);
  const deposits = buildDepositsSection(sourceState, request, productMaps, supplierMap, quality, qualitySeen);
  const arrivals = buildArrivalsSection(sourceState, request, productMaps, supplierMap, quality, qualitySeen);

  let journalRows = [];
  if (request.scope === "core_plus_journal") {
    journalRows = buildPoJournalRows(sourceState, request, supplierMap, productMaps);
  }

  const canApplyInventoryValue = inventory.summary.totalValueEur != null;
  if (!canApplyInventoryValue && !Number.isFinite(Number(options.inventoryValueOverrideEur))) {
    addQualityIssue(quality, qualitySeen, {
      code: "MISSING_INVENTORY_VALUE",
      severity: "warning",
      message: "Warenwert konnte nicht vollstaendig aus Snapshot/EK ermittelt werden.",
      entityType: "INVENTORY",
      entityId: request.month,
    });
  }

  return {
    request,
    inventory: inventory.summary,
    inventoryRows: inventory.rows,
    deposits,
    arrivals,
    journalRows,
    quality,
  };
}

function buildCsvPayloads(report) {
  const inventoryCsv = toCsv(report.inventoryRows || [], [
    { key: "sku", label: "sku" },
    { key: "alias", label: "alias" },
    { key: "category", label: "category" },
    { key: "amazonUnits", label: "amazonUnits" },
    { key: "threePLUnits", label: "threePLUnits" },
    { key: "inTransitUnits", label: "inTransitUnits" },
    { key: "totalUnits", label: "totalUnits" },
    { key: "ekEur", label: "ekEur", format: formatCsvNumber },
    { key: "rowValueEur", label: "rowValueEur", format: formatCsvNumber },
    { key: "note", label: "note" },
  ]);

  const depositsCsv = toCsv(report.deposits || [], [
    { key: "poNumber", label: "poNumber" },
    { key: "supplier", label: "supplier" },
    { key: "skuAliases", label: "skuAliases" },
    { key: "paymentType", label: "paymentType" },
    { key: "plannedEur", label: "plannedEur", format: formatCsvNumber },
    { key: "actualEur", label: "actualEur", format: formatCsvNumber },
    { key: "paidDate", label: "paidDate" },
    { key: "dueDate", label: "dueDate" },
    { key: "amountUsd", label: "amountUsd", format: formatCsvNumber },
    { key: "etdDate", label: "etdDate" },
    { key: "etaDate", label: "etaDate" },
    { key: "arrivalDate", label: "arrivalDate" },
    { key: "invoiceUrl", label: "invoiceUrl" },
    { key: "folderUrl", label: "folderUrl" },
    { key: "issues", label: "issues", format: (value) => Array.isArray(value) ? value.join("|") : "" },
  ]);

  const arrivalsCsv = toCsv(report.arrivals || [], [
    { key: "poNumber", label: "poNumber" },
    { key: "supplier", label: "supplier" },
    { key: "skuAliases", label: "skuAliases" },
    { key: "units", label: "units" },
    { key: "goodsUsd", label: "goodsUsd", format: formatCsvNumber },
    { key: "goodsEur", label: "goodsEur", format: formatCsvNumber },
    { key: "etdDate", label: "etdDate" },
    { key: "etaDate", label: "etaDate" },
    { key: "arrivalDate", label: "arrivalDate" },
    { key: "transport", label: "transport" },
    { key: "issues", label: "issues", format: (value) => Array.isArray(value) ? value.join("|") : "" },
  ]);

  let journalCsv = null;
  if (Array.isArray(report.journalRows) && report.journalRows.length) {
    journalCsv = toCsv(report.journalRows, [
      { key: "month", label: "month" },
      { key: "entityType", label: "entityType" },
      { key: "poNumber", label: "poNumber" },
      { key: "supplierName", label: "supplierName" },
      { key: "skuAliases", label: "skuAliases" },
      { key: "paymentType", label: "paymentType" },
      { key: "status", label: "status" },
      { key: "dueDate", label: "dueDate" },
      { key: "paidDate", label: "paidDate" },
      { key: "amountPlannedEur", label: "amountPlannedEur", format: formatCsvNumber },
      { key: "amountActualEur", label: "amountActualEur", format: formatCsvNumber },
      { key: "issues", label: "issues", format: (value) => Array.isArray(value) ? value.join("|") : "" },
      { key: "paymentId", label: "paymentId" },
    ]);
  }

  return {
    inventoryCsv,
    depositsCsv,
    arrivalsCsv,
    journalCsv,
  };
}

export async function buildAccountantReportBundleFromState(state, requestInput = {}, options = {}) {
  const report = buildAccountantReportData(state, requestInput, options);
  const month = monthFileStamp(report.request.month);
  const emailDraft = buildEmailDraft(report, options);
  const csvPayloads = buildCsvPayloads(report);

  const fileNames = {
    pdf: `buchhaltung_${month}_bericht.pdf`,
    xlsx: `buchhaltung_${month}.xlsx`,
    csvInventory: `buchhaltung_${month}_warenbestand.csv`,
    csvDeposits: `buchhaltung_${month}_anzahlungen_po.csv`,
    csvArrivals: `buchhaltung_${month}_wareneingang_po.csv`,
    csvJournal: `buchhaltung_${month}_zahlungsjournal.csv`,
    emailTxt: `buchhaltung_${month}_email.txt`,
    zip: `buchhaltung_${month}_paket.zip`,
  };

  const files = {};

  if (report.request.includePdf) {
    files.pdfReport = buildAccountantPdfBlob(report);
  }
  if (report.request.includeXlsx) {
    files.xlsxWorkbook = await buildAccountantWorkbookBlob(report);
  }
  if (report.request.includeCsv) {
    files.csvInventory = new Blob([csvPayloads.inventoryCsv], { type: "text/csv;charset=utf-8" });
    files.csvDeposits = new Blob([csvPayloads.depositsCsv], { type: "text/csv;charset=utf-8" });
    files.csvArrivals = new Blob([csvPayloads.arrivalsCsv], { type: "text/csv;charset=utf-8" });
    if (csvPayloads.journalCsv) {
      files.csvJournal = new Blob([csvPayloads.journalCsv], { type: "text/csv;charset=utf-8" });
    }
  }
  if (report.request.includeEmailDraft) {
    files.emailDraftTxt = new Blob([emailDraft.text], { type: "text/plain;charset=utf-8" });
  }

  const zipEntries = [];
  if (files.pdfReport) zipEntries.push({ name: fileNames.pdf, data: files.pdfReport });
  if (files.xlsxWorkbook) zipEntries.push({ name: fileNames.xlsx, data: files.xlsxWorkbook });
  if (files.csvInventory) zipEntries.push({ name: fileNames.csvInventory, data: files.csvInventory });
  if (files.csvDeposits) zipEntries.push({ name: fileNames.csvDeposits, data: files.csvDeposits });
  if (files.csvArrivals) zipEntries.push({ name: fileNames.csvArrivals, data: files.csvArrivals });
  if (files.csvJournal) zipEntries.push({ name: fileNames.csvJournal, data: files.csvJournal });
  if (files.emailDraftTxt) zipEntries.push({ name: fileNames.emailTxt, data: files.emailDraftTxt });

  const zipBlob = await buildZipBlob(zipEntries, "application/zip");

  return {
    ...report,
    emailDraft,
    fileNames,
    files,
    zipBlob,
    zipFileName: fileNames.zip,
  };
}

export function buildAccountantEmailDraftTextFromState(state, requestInput = {}, options = {}) {
  const report = buildAccountantReportData(state, requestInput, options);
  return buildEmailDraft(report, options);
}

export function createDefaultAccountantRequest(month = currentMonthKey()) {
  return resolveRequest({ month });
}

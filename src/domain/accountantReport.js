import { parseDeNumber } from "../lib/dataHealth.js";
import { buildPaymentRows } from "../ui/orderEditorFactory.js";
import { buildAccountantWorkbookBlob } from "./accountantWorkbook.js";
import { buildAccountantPdfBlob } from "./accountantPdf.js";
import { buildZipBlob, monthFileStamp } from "./accountantBundle.js";

const PO_CONFIG = { slug: "po", entityLabel: "PO", numberField: "poNo" };
const MANUELL_BEIZULEGEN = [
  "Kontoauszug als PDF",
  "Kreditkartenabrechnung als PDF und CSV",
  "Amazon Gebuehrenrechnungen",
  "Amazon Werbekostenrechnungen",
  "Sonstige Besonderheiten wie Darlehen",
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

function buildPoItemAliasMeta(record, aliasBySku) {
  const items = Array.isArray(record?.items) ? record.items.filter(Boolean) : [];
  const skus = items.length
    ? items.map((item) => String(item?.sku || "").trim()).filter(Boolean)
    : [String(record?.sku || "").trim()].filter(Boolean);
  const aliases = Array.from(new Set(skus.map((sku) => aliasBySku.get(normalizeKey(sku)) || sku))).filter(Boolean);
  const skuAliases = aliases.join(", ") || "-";
  const itemSummary = aliases.length > 1 ? `${aliases[0]}, …` : (aliases[0] || "-");
  const allItems = (items.length ? items : [{ sku: record?.sku, units: record?.units }])
    .map((item) => {
      const sku = String(item?.sku || "").trim();
      const alias = sku ? (aliasBySku.get(normalizeKey(sku)) || sku) : "-";
      const units = parseUnits(item?.units);
      return `${alias} (${sku || "-"}) x${units}`;
    })
    .join(" | ");
  return {
    skuAliases,
    itemSummary,
    allItems: allItems || skuAliases,
  };
}

function resolveSkuAliases(record, aliasBySku) {
  return buildPoItemAliasMeta(record, aliasBySku).skuAliases;
}

function normalizeAccountantPaymentType(typeLabel, eventType, eventId = "") {
  const label = String(typeLabel || "").toLowerCase();
  const type = String(eventType || "").toLowerCase();
  const id = String(eventId || "").toLowerCase();
  if (type === "fx_fee" || label.includes("fx")) return null;
  if (type === "freight" || label.includes("shipping") || label.includes("fracht")) return "Shipping/Freight";
  if (type === "eust" || label.includes("eust")) return "EUSt";
  if (type === "duty" || label.includes("zoll") || label.includes("custom") || label.includes("duty")) return "Zoll";
  if (label.includes("balance2") || label.includes("balance 2") || label.includes("second balance") || id.includes("balance2") || id.includes("bal2")) return "Balance2";
  if (label.includes("balance") || label.includes("rest")) return "Balance";
  if (label.includes("deposit") || label.includes("anzahlung")) return "Deposit";
  return "Other";
}

function isUsdRelevantPaymentType(type) {
  return type === "Deposit" || type === "Balance" || type === "Balance2";
}

function resolvePaidDateInMonth(payment, month, rowIssues) {
  const paidDate = toIsoDate(payment?.paidDate);
  const dueDate = toIsoDate(payment?.dueDate);
  let effectivePaidDate = paidDate;
  let usedDueDateFallback = false;
  if (!effectivePaidDate && dueDate) {
    effectivePaidDate = dueDate;
    usedDueDateFallback = true;
  }
  if (!effectivePaidDate) {
    rowIssues.push("PAID_WITHOUT_DATE");
    return null;
  }
  if (monthFromDate(effectivePaidDate) !== month) return null;
  if (usedDueDateFallback) rowIssues.push("DATE_UNCERTAIN");
  return { paidDate: effectivePaidDate, dueDate };
}

function mapRelevanceReasonLabel(reason) {
  if (reason === "payment+arrival") return "Zahlung im Monat + Wareneingang im Monat";
  if (reason === "payment") return "Zahlung im Monat";
  if (reason === "arrival") return "Wareneingang im Monat";
  return "Nicht relevant im Monat";
}

function formatLocaleNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function isActualArrivalSource(source) {
  return source === "arrivalDate" || source === "arrivalDateDe";
}

function isEtaBasedArrivalSource(source) {
  return source === "etaManual" || source === "etaDate" || source === "eta" || source === "etaComputed";
}

function mapArrivalSourceLabel(source) {
  if (isActualArrivalSource(source)) return "Tatsaechlicher Wareneingang";
  if (source === "etaComputed") return "Geplante Ankunft (automatisch berechnet)";
  if (isEtaBasedArrivalSource(source)) return "Geplante Ankunft";
  return "Keine Angabe";
}

function mapPaymentTypeLabel(type) {
  if (type === "Deposit") return "Anzahlung";
  if (type === "Balance") return "Restzahlung";
  if (type === "Balance2") return "zweite Restzahlung";
  if (type === "Shipping/Freight") return "Fracht";
  if (type === "EUSt") return "EUSt";
  if (type === "Zoll") return "Zoll";
  return "Unklare Zahlungsart";
}

function mapPaymentTreatment(type) {
  if (type === "Deposit") return "Anzahlung buchen";
  if (type === "Balance") return "Restzahlung buchen";
  if (type === "Balance2") return "zweite Restzahlung buchen";
  if (type === "Shipping/Freight") return "Fracht buchen";
  if (type === "EUSt") return "EUSt buchen";
  if (type === "Zoll") return "Zoll buchen";
  return "Pruefen: Zahlungsart unklar";
}

function mapArrivalTreatment(source) {
  if (isActualArrivalSource(source)) return "Wareneingang erfassen / mit Anzahlungen abstimmen";
  if (isEtaBasedArrivalSource(source)) return "Nur Information: Wareneingang noch nicht bestaetigt";
  return "Pruefen: Wareneingangsdatum fehlt";
}

function mapOrderStatus(arrivalInfo) {
  if (isActualArrivalSource(arrivalInfo?.source)) return "Ware bereits eingegangen";
  if (isEtaBasedArrivalSource(arrivalInfo?.source)) return "Wareneingang nur geplant";
  return "Ware noch nicht eingegangen";
}

function joinMessages(messages = []) {
  return Array.from(new Set(messages.filter(Boolean))).join(" | ");
}

function mapQualityArea(entityType) {
  if (entityType === "INVENTORY") return "Warenbestand";
  if (entityType === "PO") return "Bestellungen";
  return "Allgemein";
}

function enrichQualityIssue(issue) {
  const severity = issue?.severity || "info";
  const message = String(issue?.message || issue?.hinweis || "").trim();
  return {
    ...issue,
    severity,
    message,
    bereich: issue?.bereich || mapQualityArea(issue?.entityType),
    bezug: issue?.bezug || issue?.entityId || "-",
    hinweis: issue?.hinweis || message,
    relevanzFuerBuchhaltung: issue?.relevanzFuerBuchhaltung || (severity === "warning" ? "Bitte pruefen" : "Zur Kenntnis"),
  };
}

function buildVisibleFileNames(month) {
  return {
    pdf: `01_Monatsuebersicht_${month}.pdf`,
    xlsx: `02_Buchhaltungslisten_${month}.xlsx`,
    csvPayments: `03_Zahlungen_Lieferanten_${month}.csv`,
    csvArrivals: `04_Wareneingaenge_${month}.csv`,
    csvInventory: `05_Warenbestand_Monatsende_${month}.csv`,
    zip: `buchhaltung_${month}_paket.zip`,
    emailTxt: `buchhaltung_${month}_email.txt`,
  };
}

function buildBewertungsgrundlageText(settings) {
  const fxText = Number.isFinite(Number(settings?.fxRate))
    ? formatLocaleNumber(settings.fxRate, 4)
    : "-";
  return [
    "Betrag Ist EUR bei Zahlungen ist der in der Plattform erfasste tatsaechliche EUR-Zahlbetrag.",
    "Betrag USD bei Anzahlungen und Restzahlungen ist ein aus Warenwert und Zahlungsmeilenstein abgeleiteter Referenzwert.",
    "Warenwert EUR bei Wareneingaengen ist entweder direkt im Datensatz hinterlegt oder aus Warenwert USD und dem hinterlegten FX-Kurs berechnet.",
    "Bestandswert EUR zum Monatsende ergibt sich aus Gesamtbestand x Einstandspreis EUR je SKU.",
    `Verwendeter FX-Kurs im Workspace: ${fxText}.`,
  ].join(" ");
}

function buildVollstaendigkeitText() {
  return "Enthalten sind alle im Workspace erfassten Lieferantenzahlungen mit Zahlungsdatum im Monat sowie alle im Workspace erfassten Wareneingaenge des Monats. Nicht enthalten sind bewusst externe Unterlagen wie Kontoauszuege, Kreditkartenabrechnungen und Amazon-Dokumente. Voraussetzung dieser Aussage ist, dass Bestellungen, Zahlungen und Wareneingaenge im Workspace vollstaendig gepflegt sind.";
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
  const normalized = enrichQualityIssue(issue);
  const key = `${normalized.code || "ISSUE"}|${normalized.entityType || ""}|${normalized.entityId || ""}|${normalized.message || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(normalized);
}

function buildPaymentTotalsForRecord(record, settings, payments, month) {
  const paymentRows = buildPaymentRows(structuredClone(record), PO_CONFIG, settings, payments || []);
  let bisherigeLieferantenzahlungenEur = 0;
  let davonImMonatBezahltEur = 0;

  paymentRows.forEach((payment) => {
    const status = String(payment?.status || "").toUpperCase();
    if (status !== "PAID") return;

    const actualEur = Number(payment?.paidEurActual);
    if (Number.isFinite(actualEur)) {
      bisherigeLieferantenzahlungenEur += actualEur;
    }

    const monthIssues = [];
    const paidMeta = resolvePaidDateInMonth(payment, month, monthIssues);
    if (!paidMeta) return;
    if (Number.isFinite(actualEur)) {
      davonImMonatBezahltEur += actualEur;
    }
  });

  return {
    paymentRows,
    bisherigeLieferantenzahlungenEur,
    davonImMonatBezahltEur,
  };
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
      artikelnummerSku: sku,
      artikelbezeichnung: alias,
      warengruppe: category,
      bestandAmazon: amazonUnits,
      bestandExternesLager: threePLUnits,
      bestandImZulauf: inTransitUnits,
      gesamtbestand: totalUnits,
      einstandspreisEur: ekEur,
      bestandswertEur: rowValueEur,
      hinweis: String(item?.note || ""),
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
    blattzweck: "Bestandsbewertung zum Monatsende",
    issues: quality
      .filter((issue) => issue.entityType === "INVENTORY")
      .map((issue) => issue.code),
  };

  return { summary, rows };
}

function buildPaymentsInMonthSection(state, request, productMaps, supplierMap, quality, qualitySeen) {
  const settings = buildSettings(state);
  const month = request.month;
  const rows = [];

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const { paymentRows } = buildPaymentTotalsForRecord(record, settings, state?.payments || [], month);
    const goodsUsd = computeGoodsUsd(record);
    const arrivalInfo = resolveArrivalDate(record);
    const itemMeta = buildPoItemAliasMeta(record, productMaps.aliasBySku);
    const poNumber = String(record.poNo || record.id || "");
    const supplier = resolveSupplierName(record, supplierMap);

    paymentRows.forEach((payment) => {
      const status = String(payment?.status || "").toUpperCase();
      if (status !== "PAID") return;
      const paymentType = normalizeAccountantPaymentType(payment?.typeLabel || payment?.label, payment?.eventType, payment?.id);
      if (!paymentType) return;

      const rowIssues = [];
      const paidMeta = resolvePaidDateInMonth(payment, month, rowIssues);
      if (!paidMeta) {
        if (rowIssues.includes("PAID_WITHOUT_DATE")) {
          addQualityIssue(quality, qualitySeen, {
            code: "PAID_WITHOUT_DATE",
            severity: "warning",
            message: `Bestellung ${poNumber || "-"} ist als bezahlt markiert, aber ohne Zahlungs- oder Faelligkeitsdatum.`,
            entityType: "PO",
            entityId: String(record.id || poNumber || ""),
            bezug: `Bestellung ${poNumber || "-"}`,
          });
        }
        return;
      }

      const milestone = (Array.isArray(record?.milestones) ? record.milestones : [])
        .find((entry) => entry?.id === payment?.id);
      const percent = parseMoney(milestone?.percent);
      let amountUsd = null;
      if (isUsdRelevantPaymentType(paymentType)) {
        amountUsd = Number.isFinite(goodsUsd) && Number.isFinite(percent)
          ? (goodsUsd * percent) / 100
          : null;
      }

      const actualEur = Number.isFinite(Number(payment?.paidEurActual)) ? Number(payment.paidEurActual) : null;
      const beleglink = payment?.invoiceDriveUrl || payment?.invoiceFolderDriveUrl || "";
      const hinweise = [];

      if (rowIssues.includes("DATE_UNCERTAIN")) {
        hinweise.push("Zahlungsdatum fehlt, Faelligkeitsdatum verwendet");
        addQualityIssue(quality, qualitySeen, {
          code: "DATE_UNCERTAIN",
          severity: "warning",
          message: `Bestellung ${poNumber || "-"}: Zahlungsdatum fehlt, Faelligkeitsdatum verwendet.`,
          entityType: "PO",
          entityId: String(record.id || poNumber || ""),
          bezug: `Bestellung ${poNumber || "-"}`,
        });
      }
      if (paymentType === "Other") {
        hinweise.push("Zahlungsart unklar");
        addQualityIssue(quality, qualitySeen, {
          code: "PAYMENT_TYPE_UNCLEAR",
          severity: "warning",
          message: `Bestellung ${poNumber || "-"}: Zahlungsart konnte nicht eindeutig bestimmt werden.`,
          entityType: "PO",
          entityId: String(record.id || poNumber || ""),
          bezug: `Bestellung ${poNumber || "-"}`,
        });
      }
      if (isUsdRelevantPaymentType(paymentType) && !Number.isFinite(amountUsd)) {
        hinweise.push("USD-Referenzbetrag konnte nicht ermittelt werden");
        addQualityIssue(quality, qualitySeen, {
          code: "MISSING_USD",
          severity: "info",
          message: `Bestellung ${poNumber || "-"}: USD-Referenzbetrag konnte nicht ermittelt werden.`,
          entityType: "PO",
          entityId: String(record.id || poNumber || ""),
          bezug: `Bestellung ${poNumber || "-"}`,
        });
      }
      if (!Number.isFinite(actualEur)) {
        hinweise.push("Ist-Betrag EUR fehlt");
        addQualityIssue(quality, qualitySeen, {
          code: "MISSING_ACTUAL_EUR",
          severity: "warning",
          message: `Bestellung ${poNumber || "-"}: Ist-Betrag EUR fehlt.`,
          entityType: "PO",
          entityId: String(record.id || poNumber || ""),
          bezug: `Bestellung ${poNumber || "-"}`,
        });
      }
      if (!beleglink) {
        hinweise.push("Beleglink fehlt");
        addQualityIssue(quality, qualitySeen, {
          code: "MISSING_INVOICE_LINK",
          severity: "warning",
          message: `Bestellung ${poNumber || "-"}: Beleglink fehlt.`,
          entityType: "PO",
          entityId: String(record.id || poNumber || ""),
          bezug: `Bestellung ${poNumber || "-"}`,
        });
      }

      rows.push({
        fachlicheBehandlung: mapPaymentTreatment(paymentType),
        zahlungsdatum: paidMeta.paidDate,
        lieferant: supplier,
        bestellnummerIntern: poNumber,
        verknuepfteBestellung: poNumber,
        zahlungsart: mapPaymentTypeLabel(paymentType),
        betragIstEur: actualEur,
        betragUsd: amountUsd,
        artikelMengen: itemMeta.allItems,
        geplanteAbfahrt: resolveEtdDate(record),
        geplanteAnkunft: resolveEtaDate(record),
        wareneingangLautSystem: arrivalInfo.date,
        wareneingangGrundlageLabel: mapArrivalSourceLabel(arrivalInfo.source),
        statusZurBestellung: mapOrderStatus(arrivalInfo),
        beleglink,
        hinweise,
        hinweis: joinMessages(hinweise),
        poNumber,
        supplier,
        skuAliases: itemMeta.skuAliases,
        itemSummary: itemMeta.itemSummary,
        allItems: itemMeta.allItems,
        paymentType,
        plannedEur: null,
        actualEur,
        paidDate: paidMeta.paidDate,
        dueDate: paidMeta.dueDate,
        amountUsd,
        etdDate: resolveEtdDate(record),
        etaDate: resolveEtaDate(record),
        arrivalDate: arrivalInfo.date,
        invoiceUrl: payment?.invoiceDriveUrl || "",
        folderUrl: payment?.invoiceFolderDriveUrl || "",
        issues: hinweise,
      });
    });
  });

  return rows.sort((a, b) => {
    const dateCompare = String(a.paidDate || "").localeCompare(String(b.paidDate || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(a.poNumber || "").localeCompare(String(b.poNumber || ""));
  });
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
        message: `Bestellung ${record.poNo || record.id || "-"}: kein Wareneingangs- oder ETA-Datum vorhanden.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
        bezug: `Bestellung ${record.poNo || record.id || "-"}`,
      });
      return;
    }

    if (monthFromDate(arrivalInfo.date) !== month) return;

    const items = getPoItems(record);
    const units = items.reduce((sum, item) => sum + parseUnits(item?.units), 0);
    const goodsUsd = computeGoodsUsd(record);
    const goodsEur = computeGoodsEur(record, settings, goodsUsd);
    const itemMeta = buildPoItemAliasMeta(record, productMaps.aliasBySku);
    const paymentTotals = buildPaymentTotalsForRecord(record, settings, state?.payments || [], month);

    const rowIssues = [];
    if (!Number.isFinite(goodsUsd)) rowIssues.push("Warenwert USD fehlt");
    if (!Number.isFinite(goodsEur)) rowIssues.push("Warenwert EUR fehlt");
    if (arrivalInfo.source !== "arrivalDate" && arrivalInfo.source !== "arrivalDateDe") {
      rowIssues.push("Wareneingangsdatum aus geplanter Ankunft abgeleitet");
    }

    if (!Number.isFinite(goodsUsd)) {
      addQualityIssue(quality, qualitySeen, {
        code: "MISSING_GOODS_USD",
        severity: "warning",
        message: `Bestellung ${record.poNo || record.id || "-"}: Warenwert USD fehlt.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
        bezug: `Bestellung ${record.poNo || record.id || "-"}`,
      });
    }
    if (!Number.isFinite(goodsEur)) {
      addQualityIssue(quality, qualitySeen, {
        code: "MISSING_GOODS_EUR",
        severity: "warning",
        message: `Bestellung ${record.poNo || record.id || "-"}: Warenwert EUR fehlt.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
        bezug: `Bestellung ${record.poNo || record.id || "-"}`,
      });
    }
    if (!isActualArrivalSource(arrivalInfo.source)) {
      addQualityIssue(quality, qualitySeen, {
        code: "ARRIVAL_FROM_ETA",
        severity: "info",
        message: `Bestellung ${record.poNo || record.id || "-"}: Wareneingangsdatum aus geplanter Ankunft abgeleitet.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
        bezug: `Bestellung ${record.poNo || record.id || "-"}`,
        relevanzFuerBuchhaltung: "Bitte nur informativ verwenden",
      });
    }

    rows.push({
      fachlicheBehandlung: mapArrivalTreatment(arrivalInfo.source),
      wareneingangLautSystem: arrivalInfo.date,
      wareneingangGrundlageLabel: mapArrivalSourceLabel(arrivalInfo.source),
      lieferant: resolveSupplierName(record, supplierMap),
      bestellnummerIntern: String(record.poNo || record.id || ""),
      verknuepfteBestellung: String(record.poNo || record.id || ""),
      artikelMengen: itemMeta.allItems,
      gesamtmenge: units,
      warenwertUsd: goodsUsd,
      warenwertEur: goodsEur,
      geplanteAbfahrt: resolveEtdDate(record),
      geplanteAnkunft: resolveEtaDate(record),
      bisherigeLieferantenzahlungenEur: paymentTotals.bisherigeLieferantenzahlungenEur,
      davonImMonatBezahltEur: paymentTotals.davonImMonatBezahltEur,
      transportart: String(record.transport || ""),
      hinweise: rowIssues,
      hinweis: joinMessages(rowIssues),
      poNumber: String(record.poNo || record.id || ""),
      supplier: resolveSupplierName(record, supplierMap),
      skuAliases: itemMeta.skuAliases,
      itemSummary: itemMeta.itemSummary,
      allItems: itemMeta.allItems,
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

function buildPoLedgerSection(state, request, productMaps, supplierMap, quality, qualitySeen) {
  const settings = buildSettings(state);
  const month = request.month;
  const rows = [];

  (Array.isArray(state?.pos) ? state.pos : []).forEach((record) => {
    if (!record || record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const workingRecord = structuredClone(record);
    const paymentRows = buildPaymentRows(workingRecord, PO_CONFIG, settings, state?.payments || []);
    const goodsUsd = computeGoodsUsd(record);
    const arrivalInfo = resolveArrivalDate(record);
    const units = getPoItems(record).reduce((sum, item) => sum + parseUnits(item?.units), 0);
    const itemMeta = buildPoItemAliasMeta(record, productMaps.aliasBySku);

    let paymentActualEurMonth = 0;
    let hasPaymentActual = false;
    let paymentAmountUsdMonth = 0;
    let hasPaymentUsd = false;
    const paymentTypesInMonth = new Set();
    const rowIssues = [];

    paymentRows.forEach((payment) => {
      const status = String(payment?.status || "").toUpperCase();
      if (status !== "PAID") return;
      const paymentType = normalizeAccountantPaymentType(payment?.typeLabel || payment?.label, payment?.eventType, payment?.id);
      if (!paymentType) return;
      const paidMeta = resolvePaidDateInMonth(payment, month, rowIssues);
      if (!paidMeta) return;

      paymentTypesInMonth.add(paymentType);

      const actualEur = Number(payment?.paidEurActual);
      if (Number.isFinite(actualEur)) {
        paymentActualEurMonth += actualEur;
        hasPaymentActual = true;
      }

      const milestone = (Array.isArray(record?.milestones) ? record.milestones : [])
        .find((entry) => entry?.id === payment?.id);
      const percent = parseMoney(milestone?.percent);
      if (isUsdRelevantPaymentType(paymentType)) {
        const amountUsd = Number.isFinite(goodsUsd) && Number.isFinite(percent)
          ? (goodsUsd * percent) / 100
          : null;
        if (Number.isFinite(amountUsd)) {
          paymentAmountUsdMonth += amountUsd;
          hasPaymentUsd = true;
        }
      }

      if (paymentType === "Other") {
        rowIssues.push("PAYMENT_TYPE_UNCLEAR");
        addQualityIssue(quality, qualitySeen, {
          code: "PAYMENT_TYPE_UNCLEAR",
          severity: "warning",
          message: `PO ${record.poNo || record.id || "-"}: Zahlungstyp unklar.`,
          entityType: "PO",
          entityId: String(record.id || record.poNo || ""),
        });
      }
    });

    const hasActualArrival = arrivalInfo.source === "arrivalDate" || arrivalInfo.source === "arrivalDateDe";
    const arrivalDate = arrivalInfo.date;
    const arrivalMonth = monthFromDate(arrivalDate);
    const monthMarkerPayment = paymentTypesInMonth.size > 0 || hasPaymentActual || hasPaymentUsd;
    const monthMarkerArrival = arrivalMonth === month;
    const monthMarker = monthMarkerPayment || monthMarkerArrival;

    let relevanceReason = "none";
    if (monthMarkerPayment && monthMarkerArrival) relevanceReason = "payment+arrival";
    else if (monthMarkerPayment) relevanceReason = "payment";
    else if (monthMarkerArrival) relevanceReason = "arrival";

    if (!arrivalDate) {
      rowIssues.push("MISSING_ARRIVAL_DATE");
      addQualityIssue(quality, qualitySeen, {
        code: "MISSING_ARRIVAL_DATE",
        severity: "warning",
        message: `PO ${record.poNo || record.id || "-"}: kein Arrival/ETA Datum vorhanden.`,
        entityType: "PO",
        entityId: String(record.id || record.poNo || ""),
      });
    } else if (!hasActualArrival) {
      rowIssues.push("ARRIVAL_FROM_ETA");
    }

    rows.push({
      poNumber: String(record.poNo || record.id || ""),
      supplier: resolveSupplierName(record, supplierMap),
      skuAliases: itemMeta.skuAliases,
      itemSummary: itemMeta.itemSummary,
      allItems: itemMeta.allItems,
      units,
      paymentActualEurMonth: hasPaymentActual ? paymentActualEurMonth : null,
      paymentAmountUsdMonth: hasPaymentUsd ? paymentAmountUsdMonth : null,
      depositActualEurMonth: hasPaymentActual ? paymentActualEurMonth : null,
      depositAmountUsdMonth: hasPaymentUsd ? paymentAmountUsdMonth : null,
      etdDate: resolveEtdDate(record),
      etaDate: resolveEtaDate(record),
      arrivalDate,
      arrivalSource: hasActualArrival ? "actual" : (arrivalDate ? "eta" : "missing"),
      monthMarker,
      monthMarkerReason: relevanceReason,
      relevanceReason,
      relevanceReasonLabel: mapRelevanceReasonLabel(relevanceReason),
      paymentTypesInMonth: Array.from(paymentTypesInMonth).sort().join(" + "),
      issues: rowIssues,
    });
  });

  return rows.sort((left, right) => {
    if (left.monthMarker !== right.monthMarker) return left.monthMarker ? -1 : 1;
    const leftDate = String(left.arrivalDate || left.etaDate || "9999-12-31");
    const rightDate = String(right.arrivalDate || right.etaDate || "9999-12-31");
    const dateCompare = leftDate.localeCompare(rightDate);
    if (dateCompare !== 0) return dateCompare;
    return String(left.poNumber || "").localeCompare(String(right.poNumber || ""));
  });
}

function normalizeJournalPaymentType(typeLabel, eventType, eventId = "") {
  const type = normalizeAccountantPaymentType(typeLabel, eventType, eventId);
  if (!type) return null;
  return type === "Shipping/Freight" ? "Shipping" : type;
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
      const paymentType = normalizeJournalPaymentType(payment?.typeLabel || payment?.label, payment?.eventType, payment?.id);
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

function buildOverview(report, settings, fileNames) {
  const paymentsInMonth = Array.isArray(report?.paymentsInMonth) ? report.paymentsInMonth : [];
  const arrivalsInMonth = Array.isArray(report?.arrivalsInMonth) ? report.arrivalsInMonth : [];
  return {
    monat: report?.request?.month || "",
    verbindlicheDatei: fileNames.xlsx,
    standardDateien: [fileNames.pdf, fileNames.xlsx],
    bestandStichtag: report?.inventory?.snapshotAsOf || "",
    anzahlZahlungenLieferanten: paymentsInMonth.length,
    summeZahlungenIstEur: paymentsInMonth.reduce((sum, row) => sum + (Number(row?.betragIstEur) || 0), 0),
    anzahlWareneingaenge: arrivalsInMonth.length,
    summeWareneingaengeEur: arrivalsInMonth.reduce((sum, row) => sum + (Number(row?.warenwertEur) || 0), 0),
    anzahlPruefhinweise: Array.isArray(report?.quality) ? report.quality.length : 0,
    fxKurs: Number.isFinite(Number(settings?.fxRate)) ? Number(settings.fxRate) : null,
    bewertungsgrundlageText: buildBewertungsgrundlageText(settings),
    vollstaendigkeitInnerhalbPlattformText: buildVollstaendigkeitText(),
    manuellAusserhalbPlattformBeizulegen: MANUELL_BEIZULEGEN.slice(),
  };
}

function buildEmailDraft(report, options = {}) {
  const month = report.request.month;
  const workspaceName = String(options.workspaceName || report.workspaceName || "Workspace");
  const visibleFileNames = buildVisibleFileNames(monthFileStamp(month));
  const attachments = [visibleFileNames.pdf, visibleFileNames.xlsx];

  if (report.request.includeCsv) {
    attachments.push(visibleFileNames.csvPayments, visibleFileNames.csvArrivals, visibleFileNames.csvInventory);
  }

  const subject = `Buchhaltungspaket ${month} - ${workspaceName}`;
  const lines = [
    `Betreff: ${subject}`,
    "",
    "Hallo,",
    "",
    `anbei das Buchhaltungspaket fuer ${month}.`,
    "",
    `Verbindliche Datei: ${report.uebersicht?.verbindlicheDatei || visibleFileNames.xlsx}`,
    `Zahlungen Lieferanten: ${report.uebersicht?.anzahlZahlungenLieferanten || 0}`,
    `Wareneingaenge: ${report.uebersicht?.anzahlWareneingaenge || 0}`,
    `Pruefhinweise: ${report.uebersicht?.anzahlPruefhinweise || 0}`,
    "",
    "Im Paket enthalten:",
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
    includeCsv: input.includeCsv === true,
    includeXlsx: input.includeXlsx !== false,
    includePdf: input.includePdf !== false,
    includeEmailDraft: input.includeEmailDraft === true,
    poOnly: true,
    mode: "paid_and_arrival",
  };
}

export function buildAccountantReportData(state, requestInput = {}, options = {}) {
  const request = resolveRequest(requestInput);
  const sourceState = state && typeof state === "object" ? state : {};
  const supplierMap = buildSupplierMap(sourceState);
  const productMaps = buildProductMaps(sourceState);
  const settings = buildSettings(sourceState);
  const quality = [];
  const qualitySeen = new Set();

  const inventory = buildInventorySection(sourceState, request, options, productMaps, quality, qualitySeen);
  const paymentsInMonth = buildPaymentsInMonthSection(sourceState, request, productMaps, supplierMap, quality, qualitySeen);
  const arrivalsInMonth = buildArrivalsSection(sourceState, request, productMaps, supplierMap, quality, qualitySeen);

  const canApplyInventoryValue = inventory.summary.totalValueEur != null;
  if (!canApplyInventoryValue && !Number.isFinite(Number(options.inventoryValueOverrideEur))) {
    addQualityIssue(quality, qualitySeen, {
      code: "MISSING_INVENTORY_VALUE",
      severity: "warning",
      message: "Warenwert konnte nicht vollstaendig aus Snapshot/EK ermittelt werden.",
      entityType: "INVENTORY",
      entityId: request.month,
      bezug: `Monat ${request.month}`,
    });
  }

  const fileNames = buildVisibleFileNames(monthFileStamp(request.month));
  const report = {
    request,
    inventory: inventory.summary,
    inventoryRows: inventory.rows,
    warenbestandRows: inventory.rows,
    paymentsInMonth,
    zahlungenLieferanten: paymentsInMonth,
    arrivalsInMonth,
    wareneingaenge: arrivalsInMonth,
    deposits: paymentsInMonth,
    arrivals: arrivalsInMonth,
    quality,
    pruefhinweise: quality,
    poLedger: [],
    journalRows: [],
    fileNames,
    verbindlicheDatei: fileNames.xlsx,
    bewertungsgrundlageText: buildBewertungsgrundlageText(settings),
    vollstaendigkeitInnerhalbPlattformText: buildVollstaendigkeitText(),
    manuellAusserhalbPlattformBeizulegen: MANUELL_BEIZULEGEN.slice(),
  };
  report.uebersicht = buildOverview(report, settings, fileNames);

  return report;
}

function buildCsvPayloads(report) {
  const paymentsInMonth = Array.isArray(report.paymentsInMonth) ? report.paymentsInMonth : (report.deposits || []);
  const arrivalsInMonth = Array.isArray(report.arrivalsInMonth) ? report.arrivalsInMonth : (report.arrivals || []);

  const inventoryCsv = toCsv(report.inventoryRows || [], [
    { key: "artikelnummerSku", label: "Artikelnummer / SKU" },
    { key: "artikelbezeichnung", label: "Artikelbezeichnung" },
    { key: "warengruppe", label: "Warengruppe" },
    { key: "bestandAmazon", label: "Bestand Amazon" },
    { key: "bestandExternesLager", label: "Bestand externes Lager" },
    { key: "bestandImZulauf", label: "Bestand im Zulauf" },
    { key: "gesamtbestand", label: "Gesamtbestand" },
    { key: "einstandspreisEur", label: "Einstandspreis EUR", format: formatCsvNumber },
    { key: "bestandswertEur", label: "Bestandswert EUR", format: formatCsvNumber },
    { key: "hinweis", label: "Hinweis" },
  ]);

  const paymentsCsv = toCsv(paymentsInMonth, [
    { key: "fachlicheBehandlung", label: "Fachliche Behandlung" },
    { key: "zahlungsdatum", label: "Zahlungsdatum" },
    { key: "lieferant", label: "Lieferant" },
    { key: "bestellnummerIntern", label: "Bestellnummer (intern)" },
    { key: "verknuepfteBestellung", label: "Verknuepfte Bestellung" },
    { key: "zahlungsart", label: "Zahlungsart" },
    { key: "betragIstEur", label: "Betrag Ist EUR", format: formatCsvNumber },
    { key: "betragUsd", label: "Betrag USD", format: formatCsvNumber },
    { key: "artikelMengen", label: "Artikel / Mengen" },
    { key: "geplanteAbfahrt", label: "Geplante Abfahrt" },
    { key: "geplanteAnkunft", label: "Geplante Ankunft" },
    { key: "wareneingangLautSystem", label: "Wareneingang laut System" },
    { key: "wareneingangGrundlageLabel", label: "Datengrundlage Wareneingang" },
    { key: "statusZurBestellung", label: "Status zur Bestellung" },
    { key: "beleglink", label: "Beleglink" },
    { key: "hinweis", label: "Hinweis" },
  ]);

  const arrivalsCsv = toCsv(arrivalsInMonth, [
    { key: "fachlicheBehandlung", label: "Fachliche Behandlung" },
    { key: "wareneingangLautSystem", label: "Wareneingang laut System" },
    { key: "wareneingangGrundlageLabel", label: "Datengrundlage Wareneingang" },
    { key: "lieferant", label: "Lieferant" },
    { key: "bestellnummerIntern", label: "Bestellnummer (intern)" },
    { key: "verknuepfteBestellung", label: "Verknuepfte Bestellung" },
    { key: "artikelMengen", label: "Artikel / Mengen" },
    { key: "gesamtmenge", label: "Gesamtmenge" },
    { key: "warenwertUsd", label: "Warenwert USD", format: formatCsvNumber },
    { key: "warenwertEur", label: "Warenwert EUR", format: formatCsvNumber },
    { key: "geplanteAbfahrt", label: "Geplante Abfahrt" },
    { key: "geplanteAnkunft", label: "Geplante Ankunft" },
    { key: "bisherigeLieferantenzahlungenEur", label: "Bisherige Lieferantenzahlungen laut System EUR", format: formatCsvNumber },
    { key: "davonImMonatBezahltEur", label: "Davon im aktuellen Monat bezahlt EUR", format: formatCsvNumber },
    { key: "transportart", label: "Transportart" },
    { key: "hinweis", label: "Hinweis" },
  ]);

  return {
    inventoryCsv,
    paymentsCsv,
    arrivalsCsv,
  };
}

export async function buildAccountantReportBundleFromState(state, requestInput = {}, options = {}) {
  const report = buildAccountantReportData(state, requestInput, options);
  const month = monthFileStamp(report.request.month);
  const emailDraft = buildEmailDraft(report, options);
  const csvPayloads = buildCsvPayloads(report);
  const fileNames = buildVisibleFileNames(month);

  const files = {};

  if (report.request.includePdf) {
    files.pdfReport = buildAccountantPdfBlob(report);
  }
  if (report.request.includeXlsx) {
    files.xlsxWorkbook = await buildAccountantWorkbookBlob(report);
  }
  if (report.request.includeCsv) {
    files.csvInventory = new Blob([csvPayloads.inventoryCsv], { type: "text/csv;charset=utf-8" });
    files.csvPayments = new Blob([csvPayloads.paymentsCsv], { type: "text/csv;charset=utf-8" });
    files.csvArrivals = new Blob([csvPayloads.arrivalsCsv], { type: "text/csv;charset=utf-8" });
    files.csvDeposits = files.csvPayments;
  }
  if (report.request.includeEmailDraft) {
    files.emailDraftTxt = new Blob([emailDraft.text], { type: "text/plain;charset=utf-8" });
  }

  const zipEntries = [];
  if (files.pdfReport) zipEntries.push({ name: fileNames.pdf, data: files.pdfReport });
  if (files.xlsxWorkbook) zipEntries.push({ name: fileNames.xlsx, data: files.xlsxWorkbook });
  if (files.csvInventory) zipEntries.push({ name: fileNames.csvInventory, data: files.csvInventory });
  if (files.csvPayments) zipEntries.push({ name: fileNames.csvPayments, data: files.csvPayments });
  if (files.csvArrivals) zipEntries.push({ name: fileNames.csvArrivals, data: files.csvArrivals });
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

import { loadState, addStateListener } from "../data/storageLocal.js";
import { parseEuro, fmtEUR, expandFixcostInstances } from "../domain/cashflow.js";
import { buildPaymentRows, getSettings } from "./orderEditorFactory.js";
import { computeVatPreview } from "../domain/vatPreview.js";

const MATURITY_STORAGE_KEY = "dashboard_maturity_v1";

const storedMaturity = (() => {
  try {
    return JSON.parse(localStorage.getItem(MATURITY_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
})();

const dashboardState = {
  expanded: new Set(["inflows", "outflows", "po-payments", "fo-payments"]),
  range: "next12",
  hideEmptyMonths: true,
  limitBalanceToGreen: false,
  maturityHorizon: Number(storedMaturity.horizonMonths ?? 6) || 6,
  expectPoFo: storedMaturity.expectPoFo !== false,
};

const PO_CONFIG = {
  entityLabel: "PO",
  numberField: "poNo",
};

const COVERAGE_LABELS = {
  green: "Reifegrad hoch: Einzahlungen + Ausgaben vorhanden.",
  yellow: "Reifegrad mittel: Einzahlungen + Fixkosten, aber noch keine PO/FO geplant.",
  red: "Reifegrad niedrig: Einzahlungen vorhanden, aber noch keine Ausgaben erfasst → Kontostand wahrscheinlich zu optimistisch.",
  gray: "Noch keine Daten für diesen Monat.",
};

const MAX_DETAIL_ROWS = 50;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCellValue(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || Math.abs(num) < 0.0001) {
    return { text: "—", isEmpty: true };
  }
  return {
    text: new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num),
    isEmpty: false,
  };
}

function formatValueOnly(value) {
  const formatted = formatCellValue(value);
  return formatted.text;
}

function monthIndex(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || "")) return null;
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
    if (length >= count) options.push({ value: `next${count}`, label: `Nächste ${count}` });
  });
  if (length > 0) options.push({ value: "all", label: "Alle" });
  return options;
}

function applyRange(months, range) {
  if (!months.length) return [];
  if (range === "all") return months.slice();
  const count = Number(String(range).replace("next", "")) || 0;
  if (!Number.isFinite(count) || count <= 0) return months.slice();
  return months.slice(0, count);
}

function getDisplayLabel(plannedTotal, actualTotal) {
  if (actualTotal > 0 && plannedTotal > actualTotal) return "Ist+Plan gemischt";
  if (actualTotal > 0) return "Ist (bezahlt)";
  return "Plan";
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
          paidDate: row.paidDate || null,
          transactionId: row.transactionId || null,
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

function sumPaymentEvents(events, month, currentMonth) {
  let displayTotal = 0;
  let plannedTotal = 0;
  let actualTotal = 0;
  let paidThisMonthCount = 0;
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
      const txLabel = evt.transactionId ? `Transfer ${evt.transactionId}` : "Transfer —";
      warnings.push(`${evt.label || "Zahlung"} · ${txLabel} · Invoice-Link fehlt`);
    }

    plannedTotal += planned;
    if (actualValid) {
      actualTotal += actual;
      displayTotal += actual;
      if (evt.paidDate && toMonthKey(evt.paidDate) === currentMonth) {
        paidThisMonthCount += 1;
      }
    } else {
      displayTotal += planned;
    }
  });
  return {
    value: displayTotal,
    plannedTotal,
    actualTotal,
    displayLabel: getDisplayLabel(plannedTotal, actualTotal),
    warnings,
    paidThisMonthCount,
  };
}

function sumGenericEvents(events, month, currentMonth) {
  let displayTotal = 0;
  let plannedTotal = 0;
  let actualTotal = 0;
  let paidThisMonthCount = 0;
  events.forEach(evt => {
    if (evt.month !== month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    plannedTotal += planned;
    if (paid && actual > 0) {
      actualTotal += actual;
      displayTotal += actual;
      if (evt.paidDate && toMonthKey(evt.paidDate) === currentMonth) {
        paidThisMonthCount += 1;
      }
    } else {
      displayTotal += planned;
    }
  });
  return {
    value: displayTotal,
    plannedTotal,
    actualTotal,
    displayLabel: getDisplayLabel(plannedTotal, actualTotal),
    warnings: [],
    paidThisMonthCount,
  };
}

function buildRow({
  id,
  label,
  level,
  children = [],
  events = [],
  tooltip = "",
  emptyHint = "",
  isSummary = false,
  alwaysVisible = false,
  sumMode = "payments",
  rowType = "detail",
  section = null,
  sourceLabel = null,
  nav = null,
}) {
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
    rowType,
    section,
    sourceLabel,
    nav,
    values: {},
  };
}

function buildPresenceMap(events, { requireInvoice = false } = {}) {
  const map = new Map();
  events.forEach(evt => {
    if (!evt?.month) return;
    const planned = Number(evt.plannedEur || 0);
    const actual = Number(evt.actualEur || 0);
    const paid = evt.paid === true;
    const hasInvoice = requireInvoice ? evt.hasInvoiceLink !== false : true;
    const actualValid = paid && actual > 0 && hasInvoice;
    const entry = map.get(evt.month) || { plan: false, actual: false };
    if (planned > 0) entry.plan = true;
    if (actualValid) entry.actual = true;
    map.set(evt.month, entry);
  });
  return map;
}

function pickPresence(entry) {
  if (!entry) return false;
  return entry.actual ? true : entry.plan;
}

function computeCoverage(months, { cashInEvents, fixcostEvents, poEvents, foEvents, cashInExplicitMonths, horizonMonths, expectPoFo, currentMonth }) {
  const cashInMap = buildPresenceMap(cashInEvents, { requireInvoice: false });
  const fixcostMap = buildPresenceMap(fixcostEvents, { requireInvoice: false });
  const poMap = buildPresenceMap(poEvents, { requireInvoice: true });
  const foMap = buildPresenceMap(foEvents, { requireInvoice: false });
  const warningMap = new Map();
  poEvents.forEach(evt => {
    if (!evt?.month) return;
    if (evt.paid && !evt.hasInvoiceLink) {
      const list = warningMap.get(evt.month) || [];
      const txLabel = evt.transactionId ? `Transfer ${evt.transactionId}` : "Transfer —";
      list.push(`${evt.label || "Zahlung"} · ${txLabel} · Invoice-Link fehlt`);
      warningMap.set(evt.month, list);
    }
  });
  const coverage = new Map();
  const details = new Map();
  const currentIndex = monthIndex(currentMonth);
  months.forEach(month => {
    const monthOffset = currentIndex != null ? (monthIndex(month) - currentIndex) : 0;
    if (Number.isFinite(monthOffset) && monthOffset > horizonMonths) {
      coverage.set(month, "gray");
      details.set(month, { status: "gray", reason: "Zukunftsmonat außerhalb des Reifegrad-Horizonts.", warnings: [] });
      return;
    }
    const cashInPresent = pickPresence(cashInMap.get(month));
    const cashInExplicit = cashInExplicitMonths?.has(month);
    const fixedCostsPresent = pickPresence(fixcostMap.get(month));
    const poOutPresent = pickPresence(poMap.get(month));
    const foOutPresent = pickPresence(foMap.get(month));
    const anyOutPresent = fixedCostsPresent || poOutPresent || foOutPresent;
    const warnings = warningMap.get(month) || [];
    const missing = [];
    if (!cashInPresent && !cashInExplicit) missing.push("Keine Amazon-Auszahlungen");
    if (!fixedCostsPresent) missing.push("Keine Fixkosten");
    if (expectPoFo && !poOutPresent && !foOutPresent) missing.push("Keine PO/FO-Zahlungen geplant");
    let status = "gray";
    let reason = "Noch keine Daten für diesen Monat.";

    if (warnings.length) {
      status = "red";
      reason = "Bezahlte Zahlungen ohne Invoice-Link.";
    } else if (anyOutPresent && !cashInPresent && !cashInExplicit) {
      status = "red";
      reason = "Auszahlungen vorhanden, aber keine Amazon-Auszahlungen erfasst.";
    } else if (!missing.length && (cashInPresent || cashInExplicit) && anyOutPresent) {
      status = "green";
      reason = "Einzahlungen und Ausgaben vorhanden.";
    } else if (cashInPresent || cashInExplicit) {
      status = "yellow";
      reason = missing.length ? missing.join(" · ") : "Unvollständige Planung.";
    }

    coverage.set(month, status);
    details.set(month, { status, reason, warnings });
  });
  return { coverage, details };
}

function collectMonthEvents(row, month) {
  if (!row) return false;
  if (row.events && row.events.some(evt => evt.month === month && (Number(evt.plannedEur || 0) !== 0 || Number(evt.actualEur || 0) !== 0))) {
    return true;
  }
  return row.children.some(child => collectMonthEvents(child, month));
}

function monthHasValues(rows, month) {
  return rows.some(row => {
    const value = row.values?.[month]?.value || 0;
    if (Math.abs(value) > 0.0001) return true;
    return collectMonthEvents(row, month);
  });
}

function applyRowValues(row, months, currentMonth) {
  if (row.events.length) {
    months.forEach(month => {
      const result = row.sumMode === "generic"
        ? sumGenericEvents(row.events, month, currentMonth)
        : sumPaymentEvents(row.events, month, currentMonth);
      row.values[month] = result;
    });
  } else if (row.children.length) {
    row.children.forEach(child => applyRowValues(child, months, currentMonth));
    months.forEach(month => {
      const sum = row.children.reduce((acc, child) => acc + (child.values[month]?.value || 0), 0);
      const plannedTotal = row.children.reduce((acc, child) => acc + (child.values[month]?.plannedTotal || 0), 0);
      const actualTotal = row.children.reduce((acc, child) => acc + (child.values[month]?.actualTotal || 0), 0);
      const warnings = row.children.flatMap(child => child.values[month]?.warnings || []);
      const paidThisMonthCount = row.children.reduce((acc, child) => acc + (child.values[month]?.paidThisMonthCount || 0), 0);
      row.values[month] = {
        value: sum,
        plannedTotal,
        actualTotal,
        displayLabel: getDisplayLabel(plannedTotal, actualTotal),
        warnings,
        paidThisMonthCount,
      };
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
    if (row.children.length > MAX_DETAIL_ROWS && row.level >= 2) {
      row.children.slice(0, MAX_DETAIL_ROWS).forEach(child => traverse(child));
      const remaining = row.children.length - MAX_DETAIL_ROWS;
      result.push(buildRow({
        id: `${row.id}-more`,
        label: `+ ${remaining} weitere …`,
        level: row.level + 1,
        rowType: "detail",
        section: row.section,
        sourceLabel: row.sourceLabel,
      }));
      return;
    }
    row.children.forEach(child => traverse(child));
  }
  rows.forEach(traverse);
  return result;
}

function buildDashboardRows(state, months, options = {}) {
  const plannedPayoutMap = computePlannedPayoutByMonth(state, months);
  const actualPayoutMap = new Map();
  (state?.actuals || []).forEach(row => {
    if (!row?.month) return;
    actualPayoutMap.set(row.month, parseEuro(row.payoutEur));
  });
  const cashInExplicitMonths = new Set(
    (state?.incomings || []).map(row => row?.month).filter(Boolean),
  );

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
    fixedCostId: inst.fixedCostId,
    paidDate: inst.paid ? inst.dueDateIso : null,
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
  const poEvents = poData.flatMap(po => po.events);
  const foEvents = foData.flatMap(fo => fo.events);
  const { coverage, details: coverageDetails } = computeCoverage(months, {
    cashInEvents: amazonEvents,
    fixcostEvents,
    poEvents,
    foEvents,
    cashInExplicitMonths,
    horizonMonths: options.maturityHorizon,
    expectPoFo: options.expectPoFo,
    currentMonth: options.currentMonth,
  });

  const amazonRow = buildRow({
    id: "amazon-payout",
    label: "Amazon Auszahlungen",
    level: 1,
    events: amazonEvents,
    sumMode: "generic",
    rowType: "subtotal",
    section: "inflows",
    sourceLabel: "Eingaben",
    nav: { route: "#eingaben" },
  });
  const extraInRow = buildRow({
    id: "other-in",
    label: "Weitere Einzahlungen",
    level: 1,
    events: extraInEvents,
    sumMode: "generic",
    rowType: "detail",
    section: "inflows",
    sourceLabel: "Eingaben",
  });

  const inflowRow = buildRow({
    id: "inflows",
    label: "Einzahlungen",
    level: 0,
    children: [amazonRow, extraInRow],
    rowType: "section",
    section: "inflows",
    sourceLabel: "Einzahlungen",
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
        rowType: "detail",
        section: "outflows",
        sourceLabel: "PO Zahlung",
      nav: {
        route: "#po",
        open: po.record?.id || po.record?.poNo || "",
        focus: evt.typeLabel ? `payment:${evt.typeLabel}` : null,
      },
    });
  });

    return buildRow({
      id: `po-${po.record?.id || poLabel}`,
      label: poLabel,
      level: 2,
      children: paymentRows,
      events: [],
      tooltip: tooltipParts.join(" · "),
      rowType: "detail",
      section: "outflows",
      sourceLabel: "PO",
      nav: { route: "#po", open: po.record?.id || po.record?.poNo || "" },
    });
  });

  const poRow = buildRow({
    id: "po-payments",
    label: "PO Zahlungen",
    level: 1,
    children: poChildren,
    alwaysVisible: true,
    rowType: "subtotal",
    section: "outflows",
    sourceLabel: "PO Zahlungen",
  });

  const foChildren = foData.map(fo => {
    const label = fo.record?.foNo ? `FO ${fo.record.foNo}` : "FO";
    const foTooltip = [
      `FO: ${fo.record?.foNo || fo.record?.id || "—"}`,
      `SKU: ${fo.record?.sku || "—"}`,
      `Units: ${fo.record?.units || 0}`,
      `ETA: ${fo.record?.etaDate || fo.record?.targetDeliveryDate || "—"}`,
      `Status: ${fo.record?.status || "—"}`,
    ].join(" · ");
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
        rowType: "detail",
        section: "outflows",
        sourceLabel: "FO Zahlung",
        nav: { route: "#fo", open: fo.record?.id || fo.record?.foNo || "" },
      });
    });
    return buildRow({
      id: `fo-${fo.record?.id || label}`,
      label,
      level: 2,
      children: events,
      events: [],
      tooltip: foTooltip,
      rowType: "detail",
      section: "outflows",
      sourceLabel: "FO",
      nav: { route: "#fo", open: fo.record?.id || fo.record?.foNo || "" },
    });
  });

  const foRow = buildRow({
    id: "fo-payments",
    label: "FO Zahlungen",
    level: 1,
    children: foChildren,
    alwaysVisible: true,
    rowType: "subtotal",
    section: "outflows",
    sourceLabel: "FO Zahlungen",
  });

  const fixcostRow = buildRow({
    id: "fixcosts",
    label: "Fixkosten",
    level: 1,
    events: fixcostEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Fixkosten vorhanden.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Fixkosten",
    nav: { route: "#fixkosten" },
  });

  const taxRow = buildRow({
    id: "taxes",
    label: "Steuern",
    level: 1,
    events: taxEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Steuerdaten hinterlegt.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Steuern",
  });

  const dividendRow = buildRow({
    id: "dividends",
    label: "Dividende",
    level: 1,
    events: dividendEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine Dividenden erfasst.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Dividende",
  });

  const otherOutRow = buildRow({
    id: "other-out",
    label: "Weitere Auszahlungen",
    level: 1,
    events: extraOutEvents,
    sumMode: "generic",
    alwaysVisible: true,
    emptyHint: "Keine weiteren Auszahlungen vorhanden.",
    rowType: "detail",
    section: "outflows",
    sourceLabel: "Auszahlungen",
  });

  const outflowRow = buildRow({
    id: "outflows",
    label: "Auszahlungen",
    level: 0,
    children: [poRow, foRow, fixcostRow, taxRow, dividendRow, otherOutRow],
    rowType: "section",
    section: "outflows",
    sourceLabel: "Auszahlungen",
  });

  applyRowValues(inflowRow, months, options.currentMonth);
  applyRowValues(outflowRow, months, options.currentMonth);

  const netRow = buildRow({
    id: "net-cashflow",
    label: "Netto Cashflow",
    level: 0,
    isSummary: true,
    alwaysVisible: true,
    rowType: "summary",
    section: "summary",
    sourceLabel: "Netto Cashflow",
  });
  months.forEach(month => {
    const inflow = inflowRow.values[month]?.value || 0;
    const outflow = outflowRow.values[month]?.value || 0;
    const plannedTotal = (inflowRow.values[month]?.plannedTotal || 0) - (outflowRow.values[month]?.plannedTotal || 0);
    const actualTotal = (inflowRow.values[month]?.actualTotal || 0) - (outflowRow.values[month]?.actualTotal || 0);
    netRow.values[month] = {
      value: inflow - outflow,
      plannedTotal,
      actualTotal,
      displayLabel: getDisplayLabel(Math.abs(plannedTotal), Math.abs(actualTotal)),
      warnings: [],
      paidThisMonthCount: 0,
    };
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
      rowType: "summary",
      section: "summary",
      sourceLabel: "Kontostand",
    });
    const lastGreenIndex = options.limitBalanceToGreen
      ? Math.max(-1, ...months.map((m, idx) => (coverage.get(m) === "green" ? idx : -1)))
      : months.length - 1;
    months.forEach((month, idx) => {
      if (options.limitBalanceToGreen && idx > lastGreenIndex) {
        balanceRow.values[month] = { value: null, plannedTotal: 0, actualTotal: 0, displayLabel: "Plan", warnings: [], paidThisMonthCount: 0 };
        return;
      }
      running += netRow.values[month]?.value || 0;
      balanceRow.values[month] = {
        value: running,
        plannedTotal: running,
        actualTotal: running,
        displayLabel: "Ist/Plan",
        warnings: [],
        paidThisMonthCount: 0,
      };
    });
  }

  const summaryRows = [netRow];
  if (balanceRow) summaryRows.push(balanceRow);

  return { inflowRow, outflowRow, summaryRows, coverage, coverageDetails };
}

function buildDashboardHTML(state) {
  const startMonth = state?.settings?.startMonth || "2025-01";
  const horizon = Number(state?.settings?.horizonMonths || 12) || 12;
  const endMonth = addMonths(startMonth, horizon - 1);
  const allMonths = getMonthlyBuckets(startMonth, endMonth);
  const currentMonth = currentMonthKey();
  const months = allMonths.filter(month => month >= currentMonth);
  const rangeOptions = getRangeOptions(months);
  if (rangeOptions.length && !rangeOptions.some(option => option.value === dashboardState.range)) {
    dashboardState.range = rangeOptions[0].value;
  }
  const baseMonths = rangeOptions.length
    ? applyRange(months, dashboardState.range)
    : months.slice();

  const rowsBoth = buildDashboardRows(state, baseMonths, {
    limitBalanceToGreen: dashboardState.limitBalanceToGreen,
    maturityHorizon: dashboardState.maturityHorizon,
    expectPoFo: dashboardState.expectPoFo,
    currentMonth,
  });
  const filteredInflow = filterRows(rowsBoth.inflowRow, baseMonths);
  const filteredOutflow = filterRows(rowsBoth.outflowRow, baseMonths);
  const topRowsAll = [filteredInflow, filteredOutflow, ...rowsBoth.summaryRows].filter(Boolean);
  const nonEmptyMonths = dashboardState.hideEmptyMonths
    ? baseMonths.filter(month => monthHasValues(topRowsAll, month))
    : baseMonths.slice();

  const { inflowRow, outflowRow, summaryRows, coverage, coverageDetails } = buildDashboardRows(state, nonEmptyMonths, {
    limitBalanceToGreen: dashboardState.limitBalanceToGreen,
    maturityHorizon: dashboardState.maturityHorizon,
    expectPoFo: dashboardState.expectPoFo,
    currentMonth,
  });
  const filteredVisibleInflow = filterRows(inflowRow, nonEmptyMonths);
  const filteredVisibleOutflow = filterRows(outflowRow, nonEmptyMonths);

  const topRows = [filteredVisibleInflow, filteredVisibleOutflow, ...summaryRows].filter(Boolean);
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

  const headerCells = nonEmptyMonths
    .map(month => {
      const status = coverage.get(month) || "gray";
      const detail = coverageDetails.get(month);
      const tooltip = [
        detail?.reason || COVERAGE_LABELS[status] || COVERAGE_LABELS.gray,
        ...(detail?.warnings || []),
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <th scope="col">
          <span class="coverage-indicator coverage-${status}" title="${escapeHtml(tooltip)}"></span>
          <span>${escapeHtml(month)}</span>
        </th>
      `;
    })
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
      const rowClasses = [
        row.rowType === "section" ? "row-section" : "",
        row.rowType === "subtotal" ? "row-subtotal" : "",
        row.rowType === "summary" ? "row-summary" : "",
        row.rowType === "detail" ? "row-detail" : "",
        row.section ? `section-${row.section}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const labelCell = `
        <td class="tree-cell ${indentClass} ${row.isSummary ? "tree-summary" : ""}" title="${escapeHtml(labelTitle)}">
          ${toggle}
          <span class="tree-label">${escapeHtml(row.label)}</span>
        </td>
      `;

      const valueCells = nonEmptyMonths
        .map(month => {
          const cell = row.values[month] || { value: 0, warnings: [] };
          const warnings = cell.warnings || [];
          const warnIcon = warnings.length
            ? `<span class="cell-warning" title="${escapeHtml(warnings.join(" · "))}">⚠</span>`
            : "";
          const showBalanceWarning = row.id === "balance" && ["red", "yellow"].includes(coverage.get(month));
          const balanceWarning = showBalanceWarning
            ? `<span class="cell-balance-warning" title="Kontostand kann unvollständig sein, da PO/FO fehlen.">⚠︎</span>`
            : "";
          const formatted = formatCellValue(cell.value);
          const paidThisMonth = month === currentMonth && (cell.paidThisMonthCount || 0) > 0;
          const paidHint = paidThisMonth ? `Zahlungen diesen Monat bezahlt: ${cell.paidThisMonthCount}` : null;
          const tooltip = [
            `Geplant: ${formatValueOnly(cell.plannedTotal)}`,
            `Ist: ${formatValueOnly(cell.actualTotal)}`,
            `Status: ${cell.displayLabel || "Plan"}`,
            `Quelle: ${row.sourceLabel || row.label}`,
            `Anzeige: ${cell.displayLabel || "Plan"}`,
            paidHint,
          ]
            .filter(Boolean)
            .join(" · ");
          const isClickable = row.nav && !formatted.isEmpty;
          const navPayload = row.nav ? encodeURIComponent(JSON.stringify({ ...row.nav, month })) : "";
          return `
            <td class="num ${row.isSummary ? "tree-summary" : ""} ${paidThisMonth ? "cell-paid-current" : ""} ${isClickable ? "cell-link" : ""}" ${isClickable ? `data-nav="${navPayload}"` : ""} title="${escapeHtml(tooltip)}">
              ${warnIcon}
              ${balanceWarning}
              <span class="${formatted.isEmpty ? "cell-empty" : ""}">${formatted.text}</span>
              ${isClickable ? `<span class="cell-link-icon" aria-hidden="true">↗</span>` : ""}
            </td>
          `;
        })
        .join("");

      return `<tr data-row-id="${escapeHtml(row.id)}" class="${rowClasses}">${labelCell}${valueCells}</tr>`;
    })
    .join("");

  return `
    <section class="dashboard">
      <div class="dashboard-header">
        <div>
          <h2>Dashboard</h2>
          <p class="muted">Planwerte werden durch Ist ersetzt, sobald Zahlungen verbucht sind. Drilldowns zeigen PO/FO-Events.</p>
        </div>
      </div>
      <div class="dashboard-controls">
        <div class="dashboard-toggle" role="group" aria-label="Expand">
          <button type="button" class="btn secondary" data-expand="collapse">Alles zu</button>
          <button type="button" class="btn secondary" data-expand="expand">Alles auf</button>
        </div>
        <label class="dashboard-toggle dashboard-checkbox">
          <input type="checkbox" id="dashboard-hide-empty" ${dashboardState.hideEmptyMonths ? "checked" : ""} />
          <span>Leere Monate ausblenden</span>
        </label>
        <label class="dashboard-toggle dashboard-checkbox">
          <input type="checkbox" id="dashboard-limit-balance" ${dashboardState.limitBalanceToGreen ? "checked" : ""} />
          <span>Kontostand nur bis letztem grünen Monat</span>
        </label>
        <label class="dashboard-toggle dashboard-checkbox">
          <span>Reifegrad-Horizont (Monate)</span>
          <input type="number" min="1" max="24" id="dashboard-maturity-horizon" value="${dashboardState.maturityHorizon}" />
        </label>
        <label class="dashboard-toggle dashboard-checkbox">
          <input type="checkbox" id="dashboard-expect-pofo" ${dashboardState.expectPoFo ? "checked" : ""} />
          <span>PO/FO im Horizont erwarten</span>
        </label>
        ${rangeSelect}
      </div>
      <div class="dashboard-legend muted">
        <span class="coverage-indicator coverage-green"></span> Reifegrad
        <span class="legend-item">⚠ Warnung</span>
        <span class="legend-item"><span class="legend-paid"></span> Zahlung im aktuellen Monat bezahlt</span>
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
                <td colspan="${nonEmptyMonths.length + 1}" class="muted">Keine Daten vorhanden.</td>
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
  root.querySelectorAll("[data-expand]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-expand");
      const startMonth = state?.settings?.startMonth || "2025-01";
      const horizon = Number(state?.settings?.horizonMonths || 12) || 12;
      const endMonth = addMonths(startMonth, horizon - 1);
      const currentMonth = currentMonthKey();
      const months = getMonthlyBuckets(startMonth, endMonth).filter(month => month >= currentMonth);
      const baseMonths = applyRange(months, dashboardState.range);
      const rowsBoth = buildDashboardRows(state, baseMonths, {
        limitBalanceToGreen: dashboardState.limitBalanceToGreen,
        maturityHorizon: dashboardState.maturityHorizon,
        expectPoFo: dashboardState.expectPoFo,
        currentMonth,
      });
      const topRowsAll = [
        filterRows(rowsBoth.inflowRow, baseMonths),
        filterRows(rowsBoth.outflowRow, baseMonths),
        ...rowsBoth.summaryRows,
      ].filter(Boolean);
      const visibleMonths = dashboardState.hideEmptyMonths
        ? baseMonths.filter(month => monthHasValues(topRowsAll, month))
        : baseMonths;
      const { inflowRow, outflowRow, summaryRows } = buildDashboardRows(state, visibleMonths, {
        limitBalanceToGreen: dashboardState.limitBalanceToGreen,
        maturityHorizon: dashboardState.maturityHorizon,
        expectPoFo: dashboardState.expectPoFo,
        currentMonth,
      });
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

  const hideEmptyToggle = root.querySelector("#dashboard-hide-empty");
  if (hideEmptyToggle) {
    hideEmptyToggle.addEventListener("change", () => {
      dashboardState.hideEmptyMonths = hideEmptyToggle.checked;
      render(root);
    });
  }

  const limitBalanceToggle = root.querySelector("#dashboard-limit-balance");
  if (limitBalanceToggle) {
    limitBalanceToggle.addEventListener("change", () => {
      dashboardState.limitBalanceToGreen = limitBalanceToggle.checked;
      render(root);
    });
  }

  const maturityInput = root.querySelector("#dashboard-maturity-horizon");
  if (maturityInput) {
    maturityInput.addEventListener("change", () => {
      const next = Math.max(1, Number(maturityInput.value) || 1);
      dashboardState.maturityHorizon = next;
      localStorage.setItem(MATURITY_STORAGE_KEY, JSON.stringify({
        horizonMonths: dashboardState.maturityHorizon,
        expectPoFo: dashboardState.expectPoFo,
      }));
      render(root);
    });
  }

  const expectPoFoToggle = root.querySelector("#dashboard-expect-pofo");
  if (expectPoFoToggle) {
    expectPoFoToggle.addEventListener("change", () => {
      dashboardState.expectPoFo = expectPoFoToggle.checked;
      localStorage.setItem(MATURITY_STORAGE_KEY, JSON.stringify({
        horizonMonths: dashboardState.maturityHorizon,
        expectPoFo: dashboardState.expectPoFo,
      }));
      render(root);
    });
  }

  const table = root.querySelector(".dashboard-tree-table");
  if (table) {
    const navigate = (payload) => {
      if (!payload?.route) return;
      const params = new URLSearchParams();
      if (payload.open) params.set("open", payload.open);
      if (payload.focus) params.set("focus", payload.focus);
      if (payload.month) params.set("month", payload.month);
      const query = params.toString();
      location.hash = query ? `${payload.route}?${query}` : payload.route;
    };

    table.addEventListener("dblclick", (event) => {
      const cell = event.target.closest("td[data-nav]");
      if (!cell) return;
      const raw = cell.getAttribute("data-nav");
      if (!raw) return;
      try {
        const payload = JSON.parse(decodeURIComponent(raw));
        navigate(payload);
      } catch {}
    });

    table.addEventListener("click", (event) => {
      const icon = event.target.closest(".cell-link-icon");
      if (!icon) return;
      const cell = icon.closest("td[data-nav]");
      if (!cell) return;
      const raw = cell.getAttribute("data-nav");
      if (!raw) return;
      try {
        const payload = JSON.parse(decodeURIComponent(raw));
        navigate(payload);
      } catch {}
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

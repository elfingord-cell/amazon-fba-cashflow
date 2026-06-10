import { computeSeries, parseEuro } from "./cashflow.js";

const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return monthLong.format(d);
}

function toRate(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function getMonthConfig(month, state) {
  const cfg = state?.settings?.vatPreview || {};
  const monthCfg = state?.vatPreviewMonths?.[month] || {};
  return {
    deShare: toRate(monthCfg.deShare, cfg.deShareDefault ?? 0.8),
    feeRateOfGross: toRate(monthCfg.feeRateOfGross, cfg.feeRateDefault ?? 0.38),
    fixInputVat: parseEuro(monthCfg.fixInputVat ?? cfg.fixInputDefault ?? 0),
  };
}

// EUSt des Monats = Vorsteuer in der VA desselben Monats (Verrechnung beim Finanzamt,
// bestätigt gegen reale USt-VAs 01-04/2026). Erstattungs-Events sind dafür obsolet.
function isEustOutflowEntry(entry) {
  if (!entry || entry.direction !== "out") return false;
  const kind = String(entry.kind || "");
  if (kind !== "po-import" && kind !== "fo-import") return false;
  const label = String(entry.label || "").toLowerCase();
  return label.includes("eust") && !label.includes("erstatt");
}

function sumEustInput(entries) {
  return entries
    .filter(isEustOutflowEntry)
    .reduce((sum, e) => sum + Math.abs(Number(e.amount) || 0), 0);
}

// Ist-Zahllast je Quellmonat (aus der MBD-Mail "Auswertung Finanzbuchführung").
// Negative Werte = Erstattung. Quelle: state.vatActualsByMonth[YYYY-MM].payableEur
export function readVatActualPayable(state, month) {
  const map = state?.vatActualsByMonth;
  if (!map || typeof map !== "object") return null;
  const entry = map[month];
  if (entry == null) return null;
  const raw = typeof entry === "object" ? entry.payableEur : entry;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeSvzConfig(state) {
  const cfg = state?.settings?.vatPreview?.sondervorauszahlung;
  if (!cfg || typeof cfg !== "object") return { active: false, amountEur: 0 };
  const amount = Math.abs(parseEuro(cfg.amountEur ?? cfg.amount ?? 0));
  return {
    active: cfg.active === true && amount > 0,
    amountEur: amount,
  };
}

function getForecastEntry(state, sku, month) {
  const forecast = state?.forecast || {};
  const manualMap = forecast.forecastManual || {};
  const manualSku = manualMap[sku];
  if (manualSku && Object.prototype.hasOwnProperty.call(manualSku, month)) {
    const units = Number(manualSku[month]);
    return Number.isFinite(units) ? { units } : null;
  }
  const importMap = forecast.forecastImport || {};
  const importSku = importMap[sku];
  if (!importSku || !Object.prototype.hasOwnProperty.call(importSku, month)) return null;
  const entry = importSku[month];
  if (entry && typeof entry === "object") {
    const units = Number(entry.units);
    const revenueEur = parseEuro(entry.revenueEur ?? entry.revenue ?? 0);
    return {
      units: Number.isFinite(units) ? units : null,
      revenueEur: Number.isFinite(revenueEur) && revenueEur > 0 ? revenueEur : null,
    };
  }
  const units = Number(entry);
  return Number.isFinite(units) ? { units } : null;
}

function collectRevenueBreakdownBase(state, month) {
  const products = Array.isArray(state?.products) ? state.products : [];
  const categories = Array.isArray(state?.productCategories) ? state.productCategories : [];
  const categoryMap = new Map(categories.map(cat => [String(cat.id), cat.name]));
  const rawItems = [];

  products.forEach(product => {
    const sku = String(product?.sku || "").trim();
    if (!sku) return;
    const forecast = getForecastEntry(state, sku, month);
    if (!forecast) return;
    const units = Number(forecast.units);
    const price = parseEuro(product?.avgSellingPriceGrossEUR ?? 0);
    let revenue = Number(forecast.revenueEur);
    if (!Number.isFinite(revenue) || revenue <= 0) {
      if (Number.isFinite(units) && Number.isFinite(price)) {
        revenue = units * price;
      }
    }
    if (!Number.isFinite(revenue) || revenue <= 0) return;
    rawItems.push({
      sku,
      alias: product?.alias || "",
      category: categoryMap.get(String(product?.categoryId || "")) || "Ohne Kategorie",
      units: Number.isFinite(units) ? units : null,
      price: Number.isFinite(price) ? price : null,
      revenue,
    });
  });

  if (!rawItems.length) {
    return {
      items: [],
      notes: "Keine SKU-Aufschlüsselung verfügbar.",
      revenueBaseTotal: 0,
    };
  }

  let grouped = rawItems;
  let notes = "";
  if (rawItems.length > 50) {
    const groupedMap = new Map();
    rawItems.forEach(item => {
      const key = item.category || "Ohne Kategorie";
      const existing = groupedMap.get(key) || { label: key, units: 0, revenue: 0 };
      existing.units += item.units || 0;
      existing.revenue += item.revenue || 0;
      groupedMap.set(key, existing);
    });
    grouped = Array.from(groupedMap.values()).map(entry => ({
      sku: entry.label,
      alias: "Kategorie",
      units: entry.units || null,
      price: entry.units ? entry.revenue / entry.units : null,
      revenue: entry.revenue,
    }));
    notes = "Zu viele SKUs – Aggregation je Kategorie.";
  }

  const revenueBaseTotal = grouped.reduce((sum, item) => sum + (item.revenue || 0), 0);
  if (!revenueBaseTotal) {
    return {
      items: [],
      notes: "Keine SKU-Aufschlüsselung verfügbar.",
      revenueBaseTotal: 0,
    };
  }

  return { items: grouped, notes, revenueBaseTotal };
}

function buildDeBruttoItems(state, month, grossDe) {
  const breakdownBase = collectRevenueBreakdownBase(state, month);
  if (!breakdownBase.revenueBaseTotal) {
    return {
      items: [{ label: "Umsatz (Eingaben)", amount: grossDe }],
      notes: breakdownBase.notes,
    };
  }

  const items = breakdownBase.items.map(item => ({
    label: item.sku,
    sublabel: item.alias || "",
    amount: grossDe * (item.revenue / breakdownBase.revenueBaseTotal),
    meta: {
      units: item.units,
      price: item.price,
      revenueBase: item.revenue,
    },
  }));

  return { items, notes: breakdownBase.notes };
}

function buildEustItems(entries) {
  return entries
    .filter(isEustOutflowEntry)
    .map(entry => ({
      label: entry.sourceNumber ? `${entry.kind === "fo-import" ? "FO" : "PO"} ${entry.sourceNumber}` : (entry.source || "PO/FO"),
      sublabel: entry.label || "EUSt",
      date: entry.date || null,
      amount: Math.abs(Number(entry.amount || 0)),
      meta: {
        sourceTab: entry.sourceTab,
      },
    }));
}

export function computeVatPreview(state) {
  const series = computeSeries(state || {});
  const months = series.months;
  const svz = normalizeSvzConfig(state);
  const forecastRevenueByMonth = Object.fromEntries(
    months.map((month) => {
      const breakdownBase = collectRevenueBreakdownBase(state, month);
      return [month, Number(breakdownBase.revenueBaseTotal || 0)];
    }),
  );

  const rows = months.map((m, idx) => {
    const cfg = getMonthConfig(m, state);
    const revRow = (state?.incomings || []).find(r => r.month === m);
    const manualGrossTotal = parseEuro(revRow?.revenueEur);
    const grossTotal = manualGrossTotal > 0
      ? manualGrossTotal
      : Number(forecastRevenueByMonth[m] || 0);
    const grossDe = grossTotal * cfg.deShare;
    const outVat = grossDe / 1.19 * 0.19;
    const feeInputVat = (grossTotal * cfg.feeRateOfGross) / 1.19 * 0.19;
    const fixInputVat = cfg.fixInputVat || 0;
    const entries = series.breakdown[idx]?.entries || [];
    const eustInputVat = sumEustInput(entries);
    const svzCredit = svz.active && m.endsWith("-12") ? svz.amountEur : 0;
    const payable = outVat - feeInputVat - fixInputVat - eustInputVat - svzCredit;
    const eustItems = buildEustItems(entries);
    const deBreakdown = buildDeBruttoItems(state, m, grossDe);
    const feeBase = grossTotal * cfg.feeRateOfGross;

    const details = {
      deBrutto: {
        formula: `DE-Brutto = Umsatz × DE-Anteil (${(cfg.deShare * 100).toFixed(0)} %)`,
        items: deBreakdown.items,
        notes: deBreakdown.notes || "",
        total: grossDe,
      },
      outputUst: {
        formula: "Output-USt = DE-Brutto × 19/119",
        items: [
          { label: "DE-Brutto", amount: grossDe },
          { label: "Nettoanteil (Brutto/1,19)", amount: grossDe / 1.19 },
          { label: "Output-USt (19 %)", amount: outVat },
        ],
        notes: "DE-Anteil ist bereits im DE-Brutto berücksichtigt.",
        total: outVat,
      },
      vstFees: {
        formula: "VSt Fees = Gebührenbasis × 19/119",
        items: [
          { label: "Gebührenbasis", sublabel: `Gesamt-Brutto × ${(cfg.feeRateOfGross * 100).toFixed(1)} %`, amount: feeBase },
          { label: "VSt aus Gebühren", sublabel: "19/119 der Gebührenbasis", amount: feeInputVat },
        ],
        notes: "Gebührensatz basiert auf der Einstellungen der USt-Vorschau.",
        total: feeInputVat,
      },
      fixkostenVst: {
        formula: "Fixkosten-VSt = pauschaler VSt-Wert",
        items: [{ label: "Fixkosten-VSt pauschal", amount: fixInputVat }],
        notes: "Pauschale Fixkosten-VSt gemäß Monats-/Standardwert.",
        total: fixInputVat,
      },
      eustVorsteuer: {
        formula: "EUSt-VSt = im Monat gezahlte EUSt (Vorsteuer in der VA desselben Monats)",
        items: eustItems,
        notes: eustItems.length ? "" : "Keine EUSt-Zahlungen in diesem Monat.",
        total: eustInputVat,
      },
      zahllast: {
        formula: "Zahllast = Output-USt – VSt Fees – Fixkosten-VSt – EUSt-VSt" + (svzCredit ? " – Sondervorauszahlung" : ""),
        items: [
          { label: "Output-USt", amount: outVat },
          { label: "- VSt Fees", amount: -feeInputVat },
          { label: "- Fixkosten-VSt", amount: -fixInputVat },
          { label: "- EUSt-VSt", amount: -eustInputVat },
          ...(svzCredit ? [{ label: "- Verrechnung USt-Sondervorauszahlung", amount: -svzCredit }] : []),
        ],
        notes: "",
        total: payable,
      },
    };

    const actualPayable = readVatActualPayable(state, m);

    return {
      month: m,
      monthLabel: monthLabel(m),
      grossTotal,
      grossDe,
      outVat,
      feeInputVat,
      fixInputVat,
      eustInputVat,
      svzCredit,
      payable,
      actualPayable,
      payableDeviation: actualPayable == null ? null : payable - actualPayable,
      details,
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.grossTotal += row.grossTotal;
    acc.grossDe += row.grossDe;
    acc.outVat += row.outVat;
    acc.feeInputVat += row.feeInputVat;
    acc.fixInputVat += row.fixInputVat;
    acc.eustInputVat += row.eustInputVat;
    acc.svzCredit += row.svzCredit;
    acc.payable += row.payable;
    return acc;
  }, { grossTotal: 0, grossDe: 0, outVat: 0, feeInputVat: 0, fixInputVat: 0, eustInputVat: 0, svzCredit: 0, payable: 0 });

  return { months, rows, totals };
}

export default computeVatPreview;

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

function sumRefund(entries) {
  return entries
    .filter(e => e && (e.type === "vat_refund" || (e.label || "").toLowerCase().includes("eust-erstatt")))
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
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

function buildDeBruttoItems(state, month, grossDe) {
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
      items: [{ label: "Umsatz (Eingaben)", amount: grossDe }],
      notes: "Keine SKU-Aufschlüsselung verfügbar.",
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

  const totalRevenue = grouped.reduce((sum, item) => sum + (item.revenue || 0), 0);
  if (!totalRevenue) {
    return {
      items: [{ label: "Umsatz (Eingaben)", amount: grossDe }],
      notes: "Keine SKU-Aufschlüsselung verfügbar.",
    };
  }

  const items = grouped.map(item => ({
    label: item.sku,
    sublabel: item.alias || "",
    amount: grossDe * (item.revenue / totalRevenue),
    meta: {
      units: item.units,
      price: item.price,
      revenueBase: item.revenue,
    },
  }));

  return { items, notes };
}

function buildRefundItems(entries) {
  const refundEntries = entries.filter(entry => {
    const label = String(entry?.label || "").toLowerCase();
    return entry?.kind === "po-refund"
      || entry?.kind === "fo-refund"
      || label.includes("eust-erstatt");
  });

  return refundEntries.map(entry => ({
    label: entry.sourceNumber ? `PO ${entry.sourceNumber}` : (entry.source || "PO/FO"),
    sublabel: entry.label || "EUSt-Erstattung",
    date: entry.date || null,
    amount: Number(entry.amount || 0),
    meta: {
      sourceTab: entry.sourceTab,
      lagMonths: entry.lagMonths,
    },
  }));
}

export function computeVatPreview(state) {
  const series = computeSeries(state || {});
  const months = series.months;

  const rows = months.map((m, idx) => {
    const cfg = getMonthConfig(m, state);
    const revRow = (state?.incomings || []).find(r => r.month === m);
    const grossTotal = parseEuro(revRow?.revenueEur);
    const grossDe = grossTotal * cfg.deShare;
    const outVat = grossDe / 1.19 * 0.19;
    const feeInputVat = (grossTotal * cfg.feeRateOfGross) / 1.19 * 0.19;
    const fixInputVat = cfg.fixInputVat || 0;
    const entries = series.breakdown[idx]?.entries || [];
    const eustRefund = sumRefund(entries);
    const payable = outVat - feeInputVat - fixInputVat - eustRefund;
    const refundItems = buildRefundItems(entries);
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
          { label: "Gebührenbasis", sublabel: `DE-Brutto × ${(cfg.feeRateOfGross * 100).toFixed(1)} %`, amount: feeBase },
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
      eustErstattung: {
        formula: "EUSt-Erstattung = Summe der EUSt-Erstattungs-Events im Monat",
        items: refundItems,
        notes: refundItems.length ? "" : "Keine EUSt-Erstattungs-Events für diesen Monat gefunden.",
        total: eustRefund,
      },
      zahllast: {
        formula: "Zahllast = Output-USt – VSt Fees – Fixkosten-VSt – EUSt-Erstattung",
        items: [
          { label: "Output-USt", amount: outVat },
          { label: "- VSt Fees", amount: -feeInputVat },
          { label: "- Fixkosten-VSt", amount: -fixInputVat },
          { label: "- EUSt-Erstattung", amount: -eustRefund },
        ],
        notes: "",
        total: payable,
      },
    };

    return {
      month: m,
      monthLabel: monthLabel(m),
      grossTotal,
      grossDe,
      outVat,
      feeInputVat,
      fixInputVat,
      eustRefund,
      payable,
      details,
    };
  });

  const totals = rows.reduce((acc, row) => {
    acc.grossTotal += row.grossTotal;
    acc.grossDe += row.grossDe;
    acc.outVat += row.outVat;
    acc.feeInputVat += row.feeInputVat;
    acc.fixInputVat += row.fixInputVat;
    acc.eustRefund += row.eustRefund;
    acc.payable += row.payable;
    return acc;
  }, { grossTotal: 0, grossDe: 0, outVat: 0, feeInputVat: 0, fixInputVat: 0, eustRefund: 0, payable: 0 });

  return { months, rows, totals };
}

export default computeVatPreview;

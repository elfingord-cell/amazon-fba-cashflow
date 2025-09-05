// Domain: Cashflow-Logik (Parsing, Aggregation, KPIs)

export function parseDE(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  const s2 = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s2);
  return Number.isFinite(n) ? n : 0;
}

export function fmtEUR(n) {
  try {
    return n.toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2
    });
  } catch {
    return `${Math.round(n)} €`;
  }
}

export function monthSeq(startYm = "2025-02", n = 18) {
  const [y, m] = (startYm || "2025-02").split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(y, (m - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Vereinheitlichter State (nur die Felder, die wir wirklich nutzen)
export function normalizeState(s) {
  s = s || {};
  const openingEur = parseDE(s.openingEur ?? s.settings?.openingBalance ?? 0);
  const startMonth = s.settings?.startMonth || "2025-02";
  const horizonMonths = Number(s.settings?.horizonMonths || 18);

  const incomings = Array.isArray(s.incomings)
    ? s.incomings.map(r => ({
        month: r.month,
        revenueEur: parseDE(r.revenueEur),
        payoutPct: Number(r.payoutPct ?? 0)
      }))
    : [];

  const extras = Array.isArray(s.extras)
    ? s.extras.map(r => ({
        month: r.month,
        amountEur: parseDE(r.amountEur),
        label: r.label || ""
      }))
    : [];

  const outgoings = Array.isArray(s.outgoings)
    ? s.outgoings.map(r => ({
        month: r.month,
        amountEur: parseDE(r.amountEur),
        label: r.label || ""
      }))
    : [];

  return { openingEur, startMonth, horizonMonths, incomings, extras, outgoings };
}

// Aggregation je Monat
export function computeByMonth(state) {
  const s = normalizeState(state);
  const months = monthSeq(s.startMonth, s.horizonMonths);
  const map = new Map(months.map(m => [m, { inflow: 0, extras: 0, out: 0 }]));

  s.incomings.forEach(r => {
    if (!map.has(r.month)) return;
    const inflow = r.revenueEur * (r.payoutPct > 1 ? r.payoutPct / 100 : r.payoutPct);
    map.get(r.month).inflow += inflow;
  });

  s.extras.forEach(r => { if (map.has(r.month)) map.get(r.month).extras += r.amountEur; });
  s.outgoings.forEach(r => { if (map.has(r.month)) map.get(r.month).out += r.amountEur; });

  const series = months.map(m => {
    const { inflow, extras, out } = map.get(m);
    return { month: m, inflow, extras, out, net: (inflow + extras) - out };
  });

  return { months, series };
}

// Öffentliche API fürs Dashboard
export function computeSeries(state) {
  const { months, series } = computeByMonth(state);
  const inflowMonths = series.filter(r => r.inflow !== 0);
  const salesPayoutAvg = inflowMonths.length
    ? inflowMonths.reduce((a, b) => a + b.inflow, 0) / inflowMonths.length
    : 0;

  const firstNeg = series.find(r => r.net < 0)?.month ?? null;
  const opening = normalizeState(state).openingEur;

  return { months, series, kpis: { opening, salesPayoutAvg, firstNegativeMonth: firstNeg } };
}

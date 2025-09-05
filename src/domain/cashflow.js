// src/domain/cashflow.js
// Domain-Logik: Aggregation je Monat (local-first, ohne externe Abhängigkeiten)

/** EUR im deutschen Format nach Number (z.B. "22.500,00" -> 22500) */
export function parseDE(x) {
  if (x == null) return 0;
  const s = String(x).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Prozent robust parsen: "0,85" | "85" | "85%" | 0.85 -> 0.85 */
export function parsePctDE(x) {
  if (x == null || x === "") return 0;
  const s = String(x).trim().replace("%", "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

/** EUR formatieren (de-DE) */
export function fmtEUR(n) {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${(n || 0).toFixed(2)} €`;
  }
}

/** Monatsfolge "YYYY-MM" für n Monate ab startYm */
export function monthSeq(startYm = "2025-02", n = 18) {
  const [y, m] = String(startYm).split("-").map(Number);
  const out = [];
  for (let i = 0; i < Number(n || 0); i++) {
    const d = new Date(y || 2025, (m || 1) - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * computeSeries(state)
 * Liefert:
 *  - months: ["2025-02", ...]
 *  - series: [{month, inflow, extras, out, net}]
 *  - closings: [{month, closing}]
 *  - kpis: { opening, salesPayoutAvg, firstNegativeMonth }
 */
export function computeSeries(state) {
  const startYm = state?.settings?.startMonth ?? "2025-02";
  const horizon = Number(state?.settings?.horizonMonths ?? 18);
  const months = monthSeq(startYm, horizon);

  // Opening: bevorzugt "openingEur", sonst settings.openingBalance
  const opening =
    parseDE(state?.openingEur) ||
    parseDE(state?.settings?.openingBalance) ||
    0;

  // Monats-Map vorbereiten
  const by = new Map(months.map((m) => [m, { inflow: 0, extras: 0, out: 0 }]));

  // 1) Inflows: ausschließlich aus state.incomings (Sales × Payout je Monat)
  for (const r of state?.incomings ?? []) {
    const m = r?.month;
    if (!m || !by.has(m)) continue;
    const rev = parseDE(r?.revenueEur);
    const pct = parsePctDE(r?.payoutPct);
    by.get(m).inflow += rev * pct;
  }

  // 2) Extras (positiv/negativ erlaubt)
  for (const r of state?.extras ?? []) {
    const m = r?.month;
    if (!m || !by.has(m)) continue;
    by.get(m).extras += parseDE(r?.amountEur);
  }

  // 3) Ausgaben (immer negativ aufs Netto)
  for (const r of state?.outgoings ?? []) {
    const m = r?.month;
    if (!m || !by.has(m)) continue;
    by.get(m).out += parseDE(r?.amountEur);
  }

  // 4) Serie (Netto je Monat)
  const series = months.map((m) => {
    const row = by.get(m);
    const net = (row.inflow + row.extras) - row.out;
    return { month: m, inflow: row.inflow, extras: row.extras, out: row.out, net };
  });

  // 5) Closing (kumulativ)
  const closings = [];
  let bal = opening;
  for (const r of series) {
    bal += r.net;
    closings.push({ month: r.month, closing: bal });
  }

  // KPIs
  const inflows = series.map((r) => r.inflow).filter((v) => v > 0);
  const salesPayoutAvg = inflows.length
    ? inflows.reduce((a, b) => a + b, 0) / inflows.length
    : 0;

  const firstNegativeMonth = (closings.find((c) => c.closing < 0)?.month) ?? null;

  const kpis = { opening, salesPayoutAvg, firstNegativeMonth };

  return { months, series, kpis, closings };
}

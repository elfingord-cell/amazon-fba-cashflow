// Engine v1 — Cashflow-Aggregation (cent-genau, DE-Format tolerant)
// Liefert: months[], series[{inflow, extras, out, net}], closing[], kpis{opening, salesPayoutAvg, firstNegativeMonth}

//// ─────────────────────────── Helpers (intern) ───────────────────────────

function toCentsDE(x) {
  if (x == null) return 0;
  if (typeof x === "number" && Number.isFinite(x)) return Math.round(x * 100);
  const s = String(x).trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCentsEUR(cents) {
  return (cents || 0) / 100;
}

export function fmtEUR(n) {
  const v = typeof n === "number" ? n : Number(n || 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(v);
}

function normPct(p) {
  // akzeptiert: 0,85 | "0,85" | 85 | "85"
  const raw = toCentsDE(p) / 100; // jetzt Dezimalzahl (z.B. 0.85 oder 85)
  if (!Number.isFinite(raw)) return 0;
  if (raw > 1) return raw / 100;
  if (raw < 0) return 0;
  return raw;
}

function ymList(startYm = "2025-02", n = 18) {
  const [y, m] = (startYm || "2025-02").split("-").map(Number);
  const out = [];
  for (let i = 0; i < (n || 18); i++) {
    const d = new Date(y || 2025, (m || 2) - 1 + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function endOfMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0); // letzter Tag des Monats
}

function safeArray(a) {
  return Array.isArray(a) ? a : [];
}

//// ────────────────────────── Events aus State ────────────────────────────

function buildEvents(state, months) {
  // Unified Event-Shape:
  // { date: Date, month: 'YYYY-MM', kind: 'INFLOW'|'EXTRA'|'OUT', amountCents: number }
  const events = [];

  // Incomings (Umsatz × Payout) – bevorzugt Zeilen aus state.incomings
  const incomings = safeArray(state?.incomings);
  if (incomings.length > 0) {
    for (const r of incomings) {
      const ym = r?.month;
      if (!months.includes(ym)) continue;
      const rev = toCentsDE(r?.revenueEur);
      const pct = normPct(r?.payoutPct);
      const inflow = Math.round(rev * pct);
      events.push({
        date: endOfMonth(ym),
        month: ym,
        kind: "INFLOW",
        amountCents: inflow
      });
    }
  } else {
    // Fallback: einheitlicher Monatsumsatz aus evtl. älteren States
    const revC = toCentsDE(state?.monthlyAmazonEur);
    const pct = normPct(state?.payoutPct);
    if (revC > 0 && pct > 0) {
      for (const ym of months) {
        events.push({
          date: endOfMonth(ym),
          month: ym,
          kind: "INFLOW",
          amountCents: Math.round(revC * pct)
        });
      }
    }
  }

  // Extras (±) am Monatsende
  for (const r of safeArray(state?.extras)) {
    const ym = r?.month;
    if (!months.includes(ym)) continue;
    events.push({
      date: endOfMonth(ym),
      month: ym,
      kind: "EXTRA",
      amountCents: toCentsDE(r?.amountEur)
    });
  }

  // Outgoings (Kosten) am Monatsende
  for (const r of safeArray(state?.outgoings)) {
    const ym = r?.month;
    if (!months.includes(ym)) continue;
    const val = Math.abs(toCentsDE(r?.amountEur));
    events.push({
      date: endOfMonth(ym),
      month: ym,
      kind: "OUT",
      amountCents: val
    });
  }

  // (PO/FO später: jeweils Events hier hineinpushen)

  // sortiert nach Datum (falls gleiche Monate)
  events.sort((a, b) => a.date - b.date);
  return events;
}

//// ───────────────────────── Aggregation je Monat ─────────────────────────

export function computeSeries(state) {
  // 1) Fenster
  const startYm = state?.settings?.startMonth || "2025-02";
  const horizon = Number(state?.settings?.horizonMonths || 18);
  const months = ymList(startYm, horizon);

  // 2) Opening
  // akzeptiert: state.openingEur oder state.settings.openingBalance
  const openingC =
    toCentsDE(state?.openingEur) ||
    toCentsDE(state?.settings?.openingBalance) ||
    0;

  // 3) Events
  const events = buildEvents(state, months);

  // 4) Aggregation Map → Monatszeilen
  const map = new Map(months.map(m => [m, { inflow: 0, extras: 0, out: 0 }]));
  for (const ev of events) {
    const row = map.get(ev.month);
    if (!row) continue;
    if (ev.kind === "INFLOW") row.inflow += ev.amountCents;
    else if (ev.kind === "EXTRA") row.extras += ev.amountCents;
    else if (ev.kind === "OUT") row.out += ev.amountCents;
  }

  // 5) Netto + Closing
  const series = months.map(m => {
    const r = map.get(m) || { inflow: 0, extras: 0, out: 0 };
    const netC = r.inflow + r.extras - r.out;
    return {
      inflow: fromCentsEUR(r.inflow),
      extras: fromCentsEUR(r.extras),
      out: fromCentsEUR(r.out),
      net: fromCentsEUR(netC)
    };
  });

  const closing = [];
  let balC = openingC;
  for (let i = 0; i < months.length; i++) {
    const r = map.get(months[i]);
    const netC = (r?.inflow || 0) + (r?.extras || 0) - (r?.out || 0);
    balC += netC;
    closing.push(fromCentsEUR(balC));
  }

  // 6) KPIs
// 6) KPIs — Ø nur über aktive Monate (inflow > 0)
const inflowOnly = months.map(m => map.get(m)?.inflow || 0);
const inflowActive = inflowOnly.filter(v => v > 0);
const inflowAvgC =
  inflowActive.length > 0
    ? Math.round(inflowActive.reduce((a, b) => a + b, 0) / inflowActive.length)
    : 0;

  let firstNeg = null;
  {
    let run = openingC;
    for (let i = 0; i < months.length; i++) {
      const r = map.get(months[i]) || { inflow: 0, extras: 0, out: 0 };
      run += r.inflow + r.extras - r.out;
      if (run < 0) {
        firstNeg = months[i];
        break;
      }
    }
  }

  const kpis = {
    opening: fromCentsEUR(openingC),
    salesPayoutAvg: fromCentsEUR(inflowAvgC),
    firstNegativeMonth: firstNeg
  };

  return { months, series, closing, kpis };
}

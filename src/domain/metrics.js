// FBA-CF-0003 — Metriken & Serien für Dashboard (ohne externe Libs)

function parseDE(x) {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  const s = String(x).trim();
  if (!s) return 0;
  return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
}

export function monthsFrom(startYYYYMM, n) {
  const [y0, m0] = (startYYYYMM || "2025-01").split("-").map(Number);
  const out = [];
  for (let i = 0; i < (n || 12); i++) {
    const d = new Date(y0, (m0 - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// Liefert: { months, net[], closing[], openingList[] }
export function buildSeries(state) {
  const settings = state.settings || {};
  const start = settings.startMonth || "2025-02";
  const horizon = Number(settings.horizonMonths || 18);

  const opening = (state.openingEur != null) ? Number(state.openingEur) : parseDE(settings.openingBalance || 0);
  const revMonthly = Number(state.monthlyAmazonEur || 0); // Umsatz (nicht Payout)
  const payout = (state.payoutPct != null) ? Number(state.payoutPct) : 0.85; // Faktor 0..1

  const months = monthsFrom(start, horizon);

  const extraMap = new Map();  // + Beträge
  const outMap   = new Map();  // - Beträge

  (state.extras || []).forEach(r => {
    const k = r.month;
    const v = parseDE(r.amountEur);
    extraMap.set(k, (extraMap.get(k) || 0) + v);
  });
  (state.outgoings || []).forEach(r => {
    const k = r.month;
    const v = Math.abs(parseDE(r.amountEur));
    outMap.set(k, (outMap.get(k) || 0) + v);
  });

  const net = months.map(m => {
    const baseInflow = revMonthly * payout;
    const extra = extraMap.get(m) || 0;
    const out = outMap.get(m) || 0;
    return baseInflow + extra - out;
  });

  const openingList = [];
  const closing = [];
  let bal = opening;
  for (let i = 0; i < net.length; i++) {
    openingList.push(bal);
    bal = bal + net[i];
    closing.push(bal);
  }

  return { months, net, closing, openingList, opening, start, horizon };
}

export function fmtEUR(n) {
  try {
    return Number(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  } catch {
    return "—";
  }
}

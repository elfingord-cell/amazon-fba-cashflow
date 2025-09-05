// src/domain/cashflow.js
// Liefert die Monatsreihe inkl. Sales×Payout, Extras, Outgoings, FO und (optional) PO-Events

function parseDE(x){
  if (x == null) return 0;
  const s = String(x).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function toMonth(d){
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return null;
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}`;
}
function monthSeq(startYm="2025-02", n=18){
  const [y,m] = (startYm||"2025-02").split("-").map(Number);
  const out=[]; for (let i=0;i<n;i++){ const d = new Date(y,(m-1)+i,1); out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`); }
  return out;
}

// Events aus PO (optional, tolerant). Falls keine Detail-Events vorhanden,
// kannst du in Zukunft pro PO ein Feld `events: [{date, amountEur}]` übergeben.
// Dann werden genau diese Beträge berücksichtigt.
function collectPOEvents(state){
  const pos = (state?.orders?.pos) || [];
  const events = [];
  for (const po of pos){
    if (Array.isArray(po?.events)){
      for (const ev of po.events){
        const m = toMonth(ev.date);
        if (!m) continue;
        const v = parseDE(ev.amountEur);
        if (!v) continue;
        events.push({ month: m, amount: v });
      }
      continue;
    }
    // Minimal-Fallback: wenn ein PO `amountEur` und `date` hat, behandle es als einmalige Ausgabe
    if (po?.date && (po?.amountEur!=null)){
      const m = toMonth(po.date);
      if (m) events.push({ month: m, amount: -Math.abs(parseDE(po.amountEur)) });
    }
  }
  return events;
}

// FO sind freie, datumsgenaue Ausgaben: { date:"YYYY-MM-DD", label, amountEur }
// Positive Eingaben werden als Kosten interpretiert (negativ in der Reihe).
function collectFOEvents(state){
  const fos = (state?.orders?.fos) || [];
  const events = [];
  for (const fo of fos){
    const m = toMonth(fo?.date);
    if (!m) continue;
    const v = parseDE(fo?.amountEur);
    if (!v) continue;
    events.push({ month: m, amount: -Math.abs(v) }); // Kosten
  }
  return events;
}

export function computeSeries(state){
  const s = state || {};
  const startYm = s?.settings?.startMonth || "2025-02";
  const horizon  = Number(s?.settings?.horizonMonths ?? 18) || 18;
  const months   = monthSeq(startYm, horizon);

  const byMonth = new Map(months.map(m => [m, { inflow:0, extras:0, outgo:0, net:0 }]));

  // 1) Sales × Payout: gleichbleibend je Monat (Phase 1, simpel)
  const payout = (Number(s?.payoutPct||0) > 1) ? Number(s?.payoutPct)/100 : Number(s?.payoutPct||0);
  const baseInflow = parseDE(s?.monthlyAmazonEur) * payout;
  for (const m of months){ byMonth.get(m).inflow += baseInflow; }

  // 2) Extras (+) & Outgoings (−)
  for (const ex of (s?.extras||[])){
    const m = ex?.month; if (!byMonth.has(m)) continue;
    byMonth.get(m).extras += parseDE(ex?.amountEur);
  }
  for (const og of (s?.outgoings||[])){
    const m = og?.month; if (!byMonth.has(m)) continue;
    byMonth.get(m).outgo  += Math.abs(parseDE(og?.amountEur)); // Kosten
  }

  // 3) FO & PO (Events)
  for (const ev of collectFOEvents(s)){
    if (!byMonth.has(ev.month)) continue;
    byMonth.get(ev.month).outgo += Math.abs(ev.amount);
  }
  for (const ev of collectPOEvents(s)){
    if (!byMonth.has(ev.month)) continue;
    const v = parseDE(ev.amount);
    if (v >= 0) byMonth.get(ev.month).inflow += v;
    else byMonth.get(ev.month).outgo  += Math.abs(v);
  }

  // 4) Netto je Monat
  for (const m of months){
    const row = byMonth.get(m);
    row.net = (row.inflow + row.extras) - row.outgo;
  }

  return {
    months,
    series: months.map(m => ({ month:m, ...byMonth.get(m) }))
  };
}

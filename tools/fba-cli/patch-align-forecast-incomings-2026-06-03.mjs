// Angleich veralteter Forecast-incomings an aktuelle Prognose (2026-06-03).
// Nur source:"forecast" + Zukunftsmonate (>= 2026-06); Vergangenheit (Ist) und source:"manual" bleiben unberührt.
// REIN KOSMETISCH: der Cashflow nutzt diese Werte nicht (rechnet forecast-getrieben); gleicht nur die ANZEIGE an.
// Werte = computeSeries.cashInByMonth (forecastRevenueRaw als Umsatz, payoutPct als berechnete Auszahlquote).
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-align-forecast-incomings-2026-06-03.mjs [--commit]
const UPDATES = {
 "2026-06": {
  "revenueEur": 133278.52,
  "payoutPct": 54.61
 },
 "2026-07": {
  "revenueEur": 139262.36,
  "payoutPct": 59.99
 },
 "2026-08": {
  "revenueEur": 139917.9,
  "payoutPct": 57.94
 },
 "2026-09": {
  "revenueEur": 122801.42,
  "payoutPct": 54.41
 },
 "2026-10": {
  "revenueEur": 98307.89,
  "payoutPct": 54.61
 },
 "2026-11": {
  "revenueEur": 95765.37,
  "payoutPct": 59.64
 },
 "2026-12": {
  "revenueEur": 118617.78,
  "payoutPct": 57.63
 }
};
export default async function (state) {
  const rows = Array.isArray(state.incomings) ? state.incomings : [];
  let n=0;
  for (const row of rows) {
    if (String(row.source) !== "forecast") continue;
    const u = UPDATES[String(row.month)];
    if (!u) continue;
    console.log("  ~ "+row.month+": revenue "+Math.round(row.revenueEur||0)+" -> "+Math.round(u.revenueEur)+", payout "+row.payoutPct+" -> "+u.payoutPct);
    row.revenueEur = u.revenueEur;
    row.payoutPct = u.payoutPct;
    n+=1;
  }
  console.log("  => "+n+" Forecast-incomings angeglichen.");
}

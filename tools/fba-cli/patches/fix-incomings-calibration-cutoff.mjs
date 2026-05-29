// Bereinigt Incomings-Zeilen, deren calibrationCutoffDate in einem ANDEREN Monat als row.month liegt
// (logisch unmöglich -> liegengebliebene/kopierte Testdaten). Leert das ganze Kalibrier-Set dieser Zeilen.
// Betrifft aktuell nur Zeile 1 (month=2026-01, cutoff=2026-02-20). Abgeschlossene Monate brauchen keine
// laufende Kalibrierung -> kein Einfluss auf echte Rechnung; behebt den dauerhaften Validierungsfehler.
export default async function (state) {
  const rows = Array.isArray(state.incomings) ? state.incomings : [];
  let fixed = 0;
  for (const row of rows) {
    const cut = String(row.calibrationCutoffDate || "").trim();
    const month = String(row.month || "");
    if (cut && /^\d{4}-\d{2}/.test(cut) && /^\d{4}-\d{2}$/.test(month) && cut.slice(0, 7) !== month) {
      row.calibrationCutoffDate = null;
      row.calibrationRevenueToDateEur = null;
      row.calibrationSellerboardMonthEndEur = null;
      row.calibrationPayoutRateToDatePct = null;
      fixed += 1;
    }
  }
  if (!fixed) throw new Error("Keine inkonsistente Incomings-Zeile gefunden - Abbruch (nichts zu tun).");
}

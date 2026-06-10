// Steuer-Realabgleich 2026-06-10 (Kontoauszüge Holvi 01-05/2026 + MBD-Mails):
// 1. USt-VA: Dauerfristverlängerung → Zahlung Quellmonat+2, Lastschrift ~14.
// 2. EUSt wird ab jetzt im Quellmonat als Vorsteuer verrechnet (vatPreview-Fix B)
//    → Erstattungs-Events global aus, sonst Doppelzählung (~40,6k zu optimistisch).
// 3. USt-Sondervorauszahlung 2026: 1.001 EUR (real abgebucht 13.02.2026).
// 4. Ertragsteuer-Vorauszahlungen auf reale Bescheide: GewSt 2.589, KSt+Soli 3.002,53.
// 5. KapESt+Soli 26,375% auf Ausschüttungen aktiv (real: 10.746,27 am 05.01.2026).
export default async function (state) {
  state.settings = state.settings || {};
  const vp = (state.settings.vatPreview && typeof state.settings.vatPreview === "object")
    ? state.settings.vatPreview
    : {};
  state.settings.vatPreview = {
    ...vp,
    paymentLagMonths: 2,
    paymentDayOfMonth: 14,
    sondervorauszahlung: { active: true, amountEur: 1001 },
  };
  state.settings.vatRefundEnabled = false;
  state.settings.dividendKapest = { enabled: true, ratePct: 26.375 };

  const masters = state.taxes?.ertragsteuern?.masters;
  if (!masters?.gewerbesteuer || !masters?.koerperschaftsteuer) {
    throw new Error("Ertragsteuer-Masters nicht gefunden");
  }
  masters.gewerbesteuer.amount = "2589,00";
  masters.gewerbesteuer.note = "Realer Bescheid (Lastschrift 2.589,00, Stadt Eltville)";
  masters.koerperschaftsteuer.amount = "3002,53";
  masters.koerperschaftsteuer.note = "Realer Bescheid inkl. Soli (Lastschrift 3.002,53, FA Limburg-Weilburg)";
  return state;
}

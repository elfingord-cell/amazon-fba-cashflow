// VA-Ist-Werte (Soll/Ist-Abgleich) — Quellen: Holvi-Kontoauszüge 01-05/2026 + MBD-Mails.
// Negative Werte = Erstattung. Schlüssel = VA-Quellmonat.
export default async function (state) {
  state.vatActualsByMonth = {
    ...(state.vatActualsByMonth && typeof state.vatActualsByMonth === "object" ? state.vatActualsByMonth : {}),
    "2025-11": { payableEur: -2504.04, note: "Erstattung 19.01.2026 (Kontoauszug)" },
    "2025-12": { payableEur: 2529.11, note: "Lastschrift 13.02.2026 (ohne SVZ 1.001)" },
    "2026-01": { payableEur: 2289.33, note: "Lastschrift 13.03.2026" },
    "2026-02": { payableEur: 2745.88, note: "Lastschrift 15.04.2026" },
    "2026-03": { payableEur: 4909.10, note: "Lastschrift 15.05.2026 / MBD-Mail 21.04." },
    "2026-04": { payableEur: 3441.14, note: "MBD-Mail 02.06.2026, Abbuchung ~15.06." },
  };
  return state;
}

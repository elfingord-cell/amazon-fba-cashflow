// Auslaufend-Flags wiederherstellen (waren durch VO-Resync/Forecast-Import verloren gegangen)
// + ferne Depletion des Langsam-Drehers Tassimo 1er (024.001) akzeptieren.
//
// Befund: state.products[].discontinued war bei ALLEN 4 auslaufend-Produkten weg -> sie galten als
// aktiv (0 Bestand + Forecast) => permanente OOS-Coverage-Blocker + Phantom-Umsatz (Revenue nicht
// am Bestand gedeckelt). GF-Entscheid (E1, Frühjahr) gilt weiter: diese Produkte werden ausverkauft,
// nicht nachbestellt.
//
// 024.001 (Tassimo 1er) ist NICHT auslaufend, hat ~664 Stk (~12 Monate) Bestand; Depletion erst
// ~Apr/Mai 2027. Für den gut bestückten Langsam-Dreher wird kein Reorder jetzt geplant -> ferne
// Unter-Safety/OOS im Fenster akzeptiert (Reorder, wenn es näher rückt).
//
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-restore-discontinued-2026-06.mjs [--commit]

const DISCONTINUED = [
  "029.001-TAMPER-STEEL",
  "029.003-TAMPER-LEATHER",
  "025.001-Knife-Bar",
  "024.002-TASSIMO-CAPSULES-2-BODIES-3-LIDS",
];

const ACCEPTS_024001 = [
  { reason: "stock_under_safety", from: "2026-06", until: "2027-05", dur: 12 },
  { reason: "stock_oos", from: "2026-06", until: "2027-05", dur: 12 },
];

export default async function (state) {
  console.log("\n=== Auslaufend-Flags wiederherstellen ===");
  for (const sku of DISCONTINUED) {
    const p = (state.products || []).find((x) => String(x.sku) === sku);
    if (!p) { console.log(`  !! ${sku} nicht gefunden`); continue; }
    const before = p.discontinued;
    p.discontinued = true;
    console.log(`  ${sku}: discontinued ${before === undefined ? "—" : before} -> true`);
  }

  console.log("=== Tassimo 1er (024.001) ferne Depletion akzeptieren ===");
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const acc = state.settings.phantomFoShortageAcceptBySku || (state.settings.phantomFoShortageAcceptBySku = {});
  const sku = "024.001-TASSIMO-CAPSULE-200ml";
  for (const a of ACCEPTS_024001) {
    const key = `${sku.toLowerCase()}::${a.reason}::${a.from}`;
    acc[key] = {
      sku, reason: a.reason, acceptedFromMonth: a.from, acceptedUntilMonth: a.until, durationMonths: a.dur,
      note: "Langsam-Dreher mit ~12 Monaten Bestand; ferne Depletion (~Apr/Mai 2027) akzeptiert, Reorder erst wenn näher (GF-Entscheid 2026-06).",
      updatedAt: "2026-06-08T00:00:00.000Z",
    };
    console.log(`  + Accept ${sku} ${a.reason} ${a.from}..${a.until}`);
  }
  console.log("=== fertig ===");
}

// ETA aus VentoryOne übertragen für PO260007 + PO260008 (hatten im CFP keine etaManual).
// VO pflegt für diese Bestellungen kein explizites Eingangsdatum, nur die Lieferzeit (Order->Ankunft):
//   PO260007: Lieferzeit 107 T, Bestelldatum (CFP) 2026-04-28 -> ETA 2026-08-13
//   PO260008: Lieferzeit 123 T, Bestelldatum (CFP) 2026-04-29 -> ETA 2026-08-30
// Methode validiert an PO260006 (Bestelldatum 2026-04-02 + Lieferzeit 96 T = 2026-07-07 = vorhandene etaManual).
// Hinweis: PO260008 VO-Lieferzeit (123 T) > CFP-interne Lead-Times (90 T) -> interne ETA war zu optimistisch;
// die VO-ETA (30.08.) ist maßgeblich. Verschiebt Schlusszahlung/Fracht/EUSt entsprechend nach hinten.
//
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-eta-po260007-260008-2026-06.mjs [--commit]

const ETAS = { "260007": "2026-08-13", "260008": "2026-08-30" };

export default async function (state) {
  for (const [no, eta] of Object.entries(ETAS)) {
    const po = (state.pos || []).find((p) => String(p.poNo) === no);
    if (!po) { console.log(`  !! PO${no} nicht gefunden`); continue; }
    const before = po.etaManual || "—";
    po.etaManual = eta;
    if (po.arrivalDate) po.arrivalDate = null; // noch nicht empfangen
    console.log(`  PO${no}: etaManual ${before} -> ${eta}`);
  }
  console.log("  => ETAs aus VO übertragen.");
}

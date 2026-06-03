// Korrektur-Patch 2026-06-03 (Claude, GF-Anstoß Pierre):
//
// (A) FOOD POUCH FEHLTE IN CFP-PO260006.
//   VO PO260006 ("BIKEPACK-Grossbestellung", id 301542, Status Bestellt) enthält 6 SKUs,
//   darunter 035.001-BIKEPACK-FOOD-POUCH = 450 + 50 = 500 Stk @ 3,20 USD/Stk.
//   Die CFP-PO260006 (po-typ47r3) hatte nur 5 SKUs (Σ 4.338 Stk); die Food-Pouch-Zeile fehlte
//   (Differenz 4.838 − 4.338 = exakt 500). Folge: CFP meldete "Food Pouch ohne Order" / Prelaunch,
//   obwohl die Bestellung längst läuft. -> Zeile ergänzen.
//   Fracht: VO-Logistik noch "Logistik Anfrage" (offen). Food Pouch ist bulkig (~11,9 cbm von 30,03
//   cbm Gesamt = 39,6 %). Bestehende 5 Positionen tragen 5.596,80 EUR Fracht für ~18,13 cbm
//   (= 308,7 EUR/cbm). Volumen-proportional => Food-Pouch-Frachtanteil ~3.674 EUR (SCHÄTZUNG,
//   bei finalem VO-Logistik-Angebot anzupassen). PO-Gesamtfracht 5.596,80 -> 9.270,80 EUR.
//
// (B) DREI DRAFT-FOs (FO-CLAUDE-*) WAREN DUPLIKATE.
//   Framebag (023.001) hat POs 260005/260006/260008, Fork-Bag (032.001) POs 260006/260008,
//   Dichtungsringe (I5-IMBE-OGXU) PO260009 — alle bereits als Inbound erfasst (ETA ~Jul).
//   Die Juni-OOS-Lücke ist die vom GF akzeptierte Transit-Lücke (Sea-Reorder, keine Luftfracht;
//   E4-Shortage-Accepts für Framebag/Fork-Bag vorhanden). Mit dashboardShowPhantomFoInChart=true
//   treiben Phantom-FOs den Cashflow ohnehin. Die manuell angelegten DRAFT-FOs doppelten also die
//   reale Beschaffung -> entfernen.
//
// Aufruf:
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-foodpouch-and-drop-dup-fos-2026-06.mjs           # dry-run
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-foodpouch-and-drop-dup-fos-2026-06.mjs --commit  # schreibt

const FOOD_POUCH = {
  id: "poi-foodpouch-260006",
  sku: "035.001-BIKEPACK-FOOD-POUCH",
  units: 500,
  prodDays: 45,
  transitDays: 45,
  freightEur: 3674, // SCHÄTZUNG (volumen-proportional), VO-Logistik noch offen
  sourceFoId: null,
  unitCostUsd: 3.2,
  extraFlatUsd: 0,
  unitExtraUsd: 0,
};

const DROP_FO_IDS = ["fo-claude-023001bi", "fo-claude-032001bi", "fo-claude-i5imbeog"];

export default async function (state) {
  const log = (m) => console.log("  " + m);
  console.log("\n=== (A) Food-Pouch-Zeile in PO260006 ergänzen ===");
  const po = (state.pos || []).find((p) => String(p.poNo) === "260006" || String(p.id) === "po-typ47r3");
  if (!po) {
    log("!! PO260006 NICHT GEFUNDEN");
  } else {
    po.items = Array.isArray(po.items) ? po.items : [];
    const exists = po.items.some((it) => String(it.sku).includes("035.001"));
    if (exists) {
      log("~~ Food-Pouch-Zeile existiert bereits — nichts zu tun.");
    } else {
      const unitsBefore = po.units;
      const freightBefore = po.freightEur;
      po.items.push({ ...FOOD_POUCH });
      po.units = po.items.reduce((s, it) => s + (Number(it.units) || 0), 0);
      po.freightEur = Math.round(((Number(freightBefore) || 0) + FOOD_POUCH.freightEur) * 100) / 100;
      log(`+ 035.001-BIKEPACK-FOOD-POUCH 500 Stk @ 3,20 USD, Fracht ${FOOD_POUCH.freightEur} EUR (Schätzung)`);
      log(`  units ${unitsBefore} -> ${po.units}; freightEur ${freightBefore} -> ${po.freightEur}`);
    }
  }

  console.log("=== (B) Duplikat-DRAFT-FOs entfernen ===");
  const fosBefore = (state.fos || []).length;
  state.fos = (state.fos || []).filter((f) => {
    const hit = DROP_FO_IDS.includes(String(f.id));
    if (hit) log(`- entferne FO ${f.foNo || f.id} (${f.sku})`);
    return !hit;
  });
  log(`fos: ${fosBefore} -> ${state.fos.length}`);
  console.log("=== fertig ===");
}

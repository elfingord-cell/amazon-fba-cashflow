// Auslaufungsliste korrigieren (GF-Vorgabe Pierre, 2026-06-08):
//   + Tamper Holz (029.002) wird auslaufend  -> Reorder-FO entfernen
//   - Tassimo 2er (024.002) ist NICHT auslaufend -> Flag entfernen (wieder aktiv)
//     Folge: 024.002 hat 0 Bestand + ~7/Mon Forecast -> würde als OOS flaggen; vorläufig akzeptiert,
//     damit die Robustheit hält. Reorder-Entscheidung offen (siehe Report).
//   (Tamper Stahl 029.001 + Leder 029.003 + Messerleiste 025.001 bleiben auslaufend.)
//   Tonie-tipi + Solar sind alte Produkte, nicht mehr im CFP-Katalog -> keine Aktion.
//
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-auslaufliste-korrektur-2026-06.mjs [--commit]

const SET_DISCONTINUED = { "029.002-TAMPER-WOOD": true, "024.002-TASSIMO-CAPSULES-2-BODIES-3-LIDS": false };
const REMOVE_FO_IDS = ["fo-plan-029002tamperwood-202612"];
const ACCEPT_024002 = [
  { reason: "stock_oos", from: "2026-06", until: "2027-05", dur: 12 },
  { reason: "stock_under_safety", from: "2026-06", until: "2027-05", dur: 12 },
];

export default async function (state) {
  console.log("\n=== discontinued-Flags ===");
  for (const [sku, val] of Object.entries(SET_DISCONTINUED)) {
    const p = (state.products || []).find((x) => String(x.sku) === sku);
    if (!p) { console.log(`  !! ${sku} nicht gefunden`); continue; }
    const before = p.discontinued === undefined ? "—" : p.discontinued;
    p.discontinued = val;
    console.log(`  ${sku}: discontinued ${before} -> ${val}`);
  }

  console.log("=== Tamper-Holz-Reorder-FO entfernen ===");
  const before = (state.fos || []).length;
  state.fos = (state.fos || []).filter((f) => {
    const hit = REMOVE_FO_IDS.includes(String(f.id));
    if (hit) console.log(`  - entferne FO ${f.foNo || f.id} (${f.sku})`);
    return !hit;
  });
  console.log(`  fos: ${before} -> ${state.fos.length}`);

  console.log("=== Tassimo 2er (024.002) OOS vorläufig akzeptieren (aktiv, 0 Bestand) ===");
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const acc = state.settings.phantomFoShortageAcceptBySku || (state.settings.phantomFoShortageAcceptBySku = {});
  const sku = "024.002-TASSIMO-CAPSULES-2-BODIES-3-LIDS";
  for (const a of ACCEPT_024002) {
    acc[`${sku.toLowerCase()}::${a.reason}::${a.from}`] = {
      sku, reason: a.reason, acceptedFromMonth: a.from, acceptedUntilMonth: a.until, durationMonths: a.dur,
      note: "Aktiv, aber 0 Bestand bei ~7/Mon. OOS vorläufig akzeptiert; Reorder-Entscheidung offen (GF, 2026-06).",
      updatedAt: "2026-06-08T00:00:00.000Z",
    };
    console.log(`  + Accept ${sku} ${a.reason} ${a.from}..${a.until}`);
  }
  console.log("=== fertig ===");
}

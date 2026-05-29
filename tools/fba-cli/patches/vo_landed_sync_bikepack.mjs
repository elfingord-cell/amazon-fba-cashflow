// VO→CFP Landed-Cost-Sync BIKEPACK (PO260006, verifiziert 2026-05-29)
// VentoryOne ist führend. Nur landedUnitCostEur der 5 existierenden Produkte.
export default async function (state) {
  const updates = {
    "028.001-BIKEPACK-SADDLEBAG": 12.30,
    "023.001-BIKEPACK-FRAMEBAG": 7.08,
    "026.001-BIKEPACK-TOP-TUBE": 6.28,
    "032.001-BIKEPACK-FORK-BAG": 7.58,
    "022.002-BIKEPACK-HANDLEBAR-v2": 8.44,
  };
  const log = [];
  for (const [sku, lc] of Object.entries(updates)) {
    const p = (state.products || []).find(x => x.sku === sku);
    if (!p) throw new Error("SKU nicht in CFP: " + sku);
    log.push(`${sku}: ${p.landedUnitCostEur} -> ${lc}`);
    p.landedUnitCostEur = lc;
  }
  console.log("LANDED-COST-UPDATES:\n  " + log.join("\n  "));
}

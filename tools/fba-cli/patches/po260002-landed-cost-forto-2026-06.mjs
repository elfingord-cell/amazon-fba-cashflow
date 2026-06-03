// PO260002 Landed-Cost-Sync (Fall B) — Forto-Logistik IN0290915 verteilt, FX 1,1649.
// Führende Quelle: VentoryOne Einstandspreis-Kalkulator (überschrieben + persistent verifiziert).
// Spiegelt NUR Produkt-Stammdaten (landed cost). Archivierte, voll bezahlte PO 260002 bleibt unangetastet
// (Cashflow-/paymentLog-/milestones-Felder bewahren = Skill-Kernregel).
//
// VO-Ergebnis (maßgeblich, Chrome-Kalkulator):
//   MB2er  X3-42Y5-Q7DT          : Einstandspreis 11,8838 €  (Kaufpreis 9,2712 + Volumen 2,61)   alt 12,58
//   MB360er 021.001-KNIFE-BLOCK-360: Einstandspreis 13,6541 €  (Kaufpreis 11,0739 + Volumen 2,58) alt 16,13
// EK USD unverändert (10,80 / 12,90).

export default async function (state) {
  const updates = [
    { sku: "X3-42Y5-Q7DT",           landed: 11.88, logistics: 2.61, ekUsd: 10.8 },
    { sku: "021.001-KNIFE-BLOCK-360", landed: 13.65, logistics: 2.58, ekUsd: 12.9 },
  ];
  for (const u of updates) {
    const p = (state.products || []).find((x) => x.sku === u.sku);
    if (!p) throw new Error("SKU nicht in CFP: " + u.sku);
    p.template = p.template || { fields: {} };
    p.template.fields = p.template.fields || {};
    p.template.fields.unitPriceUsd = u.ekUsd;     // EK USD (VO-geführt, hier unverändert)
    p.landedUnitCostEur = u.landed;               // Landed Cost EUR (VO-geführt)
    p.logisticsPerUnitEur = u.logistics;          // Logistik/Stück (VO Volumen-Umlage)
    p.freightPerUnitEur = u.logistics;
  }
}

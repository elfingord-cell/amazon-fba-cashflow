// T078: 4 veraltete Ziel-VK (avgSellingPriceGrossEUR) auf aktuellen Amazon-Listenpreis korrigieren.
// Quelle: amazon.de PDP (per Chrome verifiziert 2026-06-01). Messerblock 360 NICHT geändert (VK aktuell;
// die VO-Differenz dort ist Promotion-realisiert, kein stale VK). Promotion-Gaps bleiben unangetastet.
export default async function (state) {
  const updates = {
    "I5-IMBE-OGXU": 5.90,                 // 4,90 -> 5,90 (Amazon aktuell)
    "028.001-BIKEPACK-SADDLEBAG": 69.90,  // 62,90 -> 69,90
    "022.002-BIKEPACK-HANDLEBAR-v2": 42.90, // 39,90 -> 42,90
    "031.001-NESPRESSO-DRAWER": 25.90,    // 23,90 -> 25,90
  };
  let n = 0;
  for (const [sku, vk] of Object.entries(updates)) {
    const p = (state.products || []).find((x) => String(x.sku) === sku);
    if (!p) throw new Error("SKU nicht gefunden: " + sku);
    p.avgSellingPriceGrossEUR = vk;
    n += 1;
  }
  if (n !== 4) throw new Error("Erwartet 4 Updates, " + n + " angewendet");
}

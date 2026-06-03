// Robustheits-Remediation 2026-06-03 (GF-Entscheid Pierre: "World A — geplante Reorders als FO").
//
// Ziel: jeder Monat Jun–Dez 2026 robust (alle 5 sku_coverage-Checks). Plausibilisierung gegen VO
// abgeschlossen; einzige scheiternde Dimension war sku_coverage mit exakt 5 SKUs:
//
//  - 035.001 Food Pouch: OOS Jun (Launch Jul, PO260006 ETA 07.07.) -> Prelaunch-Accept Jun.
//  - 034.001 MB selbstschärfend: OOS Jun-Jul (Launch Aug, PO260007); Launch-Stock 1260 >= Plan 1073
//    -> Aug-Dez gedeckt -> nur Prelaunch-Accept Jun-Jul.
//  - 021.002 MB gerade: Prelaunch Jun-Jul + Aug-Dez Reorder-Lücke (Launch 510 < Plan 648).
//  - 021.003 MB schräg: Prelaunch Jun-Jul + Aug-Dez Reorder-Lücke (Launch 510 < Plan 809).
//  - I5 Dichtungsringe: aktiver Seller, PO260009 (200) reicht bis ~Okt -> Reorder.
//
// Maßnahmen:
//  (A) 3 Reorder-FOs (DRAFT) = Engine-Coverage-Vorschläge (buildPhantomFoSuggestions, foRecord verbatim):
//      021.002: 500 Stk, Order 18.08., ETA 01.12., RAIL/EXW, 5,99 USD, Fracht 1000 €
//      021.003: 602 Stk, Order 18.08., ETA 01.12., RAIL/EXW, 7,28 USD, Fracht 1204 €
//      I5:      500 Stk, Order 27.08., ETA 01.10., AIR/DDP,  0,48 USD, Fracht 5 €
//      -> schließt Aug-Dez (Dez-OOS + Aug-Nov Bestellpflicht); Plan-Umsatz wird real (kein Phantom).
//  (B) Prelaunch-Accepts (stock_oos, unvermeidbar — vor Launch kein verkaufbarer Bestand):
//      021.002 Jun-Jul, 021.003 Jun-Jul, 034.001 Jun-Jul, 035.001 Jun.
//      Alte (falsche) E3-Accepts 021.002/003 stock_under_safety werden entfernt (Reason-Mismatch).
//  (C) Datenfix PO260005: Saddlebag 028.001 1056 -> 1008 Stk (VO-Ist; CFP war +48 zu hoch).
//
// Verifiziert (in-memory Simulation vor Commit): Jun-Dez 7/7 robust.
//
// Aufruf:
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-robust-jun-dez-2026-06-03.mjs           # dry-run
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-robust-jun-dez-2026-06-03.mjs --commit  # schreibt

const REORDER_FOS = [
  {
    id: "fo-reorder-021002", foNo: "FO-REORDER-021.002", foNumber: "FO-REORDER-021.002",
    sku: "021.002-KNIFE-BLOCK-STRAIGHT", supplierId: "sup-noikg8l", status: "DRAFT",
    note: "Reorder-Plan (World A) 2026-06-03, Engine-Coverage-Vorschlag (Launch-Stock 510 < Plan Aug-Dez 648)",
    targetDeliveryDate: "2026-12-01", units: 500, transportMode: "RAIL", incoterm: "EXW",
    unitPrice: 5.99, currency: "USD", freight: 1000, freightCurrency: "EUR",
    dutyRatePct: 0, eustRatePct: 19, fxRate: 1.19,
    productionLeadTimeDays: 60, logisticsLeadTimeDays: 45, bufferDays: 0,
    orderDate: "2026-08-18", productionEndDate: "2026-10-17", etdDate: "2026-10-17",
    etaDate: "2026-12-01", deliveryDate: "2026-12-01",
    payments: [
      { id: "supplier-0", label: "Deposit", percent: 30, amount: 898.5, currency: "USD", triggerEvent: "ORDER_DATE", offsetDays: 0, offsetMonths: 0, dueDate: "2026-08-18", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
      { id: "supplier-1", label: "Balance", percent: 70, amount: 2096.5, currency: "USD", triggerEvent: "ETA", offsetDays: -10, offsetMonths: 0, dueDate: "2026-11-21", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
      { id: "auto-freight", label: "Fracht", percent: 0, amount: 1000, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 0, dueDate: "2026-12-01", category: "freight", isOverridden: false, dueDateManuallySet: false },
      { id: "auto-eust", label: "EUSt", percent: 19, amount: 668.1932773109244, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 0, dueDate: "2026-12-01", category: "eust", isOverridden: false, dueDateManuallySet: false },
      { id: "auto-eust-refund", label: "EUSt Erstattung", percent: 19, amount: -668.1932773109244, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 2, dueDate: "2027-02-01", category: "eust_refund", isOverridden: false, dueDateManuallySet: false },
    ],
  },
  {
    id: "fo-reorder-021003", foNo: "FO-REORDER-021.003", foNumber: "FO-REORDER-021.003",
    sku: "021.003-KNIFE-BLOCK-SLOPE", supplierId: "sup-noikg8l", status: "DRAFT",
    note: "Reorder-Plan (World A) 2026-06-03, Engine-Coverage-Vorschlag (Launch-Stock 510 < Plan Aug-Dez 809)",
    targetDeliveryDate: "2026-12-01", units: 602, transportMode: "RAIL", incoterm: "EXW",
    unitPrice: 7.28, currency: "USD", freight: 1204, freightCurrency: "EUR",
    dutyRatePct: 0, eustRatePct: 19, fxRate: 1.19,
    productionLeadTimeDays: 60, logisticsLeadTimeDays: 45, bufferDays: 0,
    orderDate: "2026-08-18", productionEndDate: "2026-10-17", etdDate: "2026-10-17",
    etaDate: "2026-12-01", deliveryDate: "2026-12-01",
    payments: [
      { id: "supplier-0", label: "Deposit", percent: 30, amount: 1314.768, currency: "USD", triggerEvent: "ORDER_DATE", offsetDays: 0, offsetMonths: 0, dueDate: "2026-08-18", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
      { id: "supplier-1", label: "Balance", percent: 70, amount: 3067.792, currency: "USD", triggerEvent: "ETA", offsetDays: -10, offsetMonths: 0, dueDate: "2026-11-21", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
      { id: "auto-freight", label: "Fracht", percent: 0, amount: 1204, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 0, dueDate: "2026-12-01", category: "freight", isOverridden: false, dueDateManuallySet: false },
      { id: "auto-eust", label: "EUSt", percent: 19, amount: 928.4964705882355, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 0, dueDate: "2026-12-01", category: "eust", isOverridden: false, dueDateManuallySet: false },
      { id: "auto-eust-refund", label: "EUSt Erstattung", percent: 19, amount: -928.4964705882355, currency: "EUR", triggerEvent: "ETA", offsetDays: 0, offsetMonths: 2, dueDate: "2027-02-01", category: "eust_refund", isOverridden: false, dueDateManuallySet: false },
    ],
  },
  {
    id: "fo-reorder-i5imbe", foNo: "FO-REORDER-I5-IMBE-OGXU", foNumber: "FO-REORDER-I5-IMBE-OGXU",
    sku: "I5-IMBE-OGXU", supplierId: "sup-7aco79f", status: "DRAFT",
    note: "Reorder-Plan (World A) 2026-06-03, Engine-Coverage-Vorschlag (aktiver Seller, PO260009 reicht bis ~Okt)",
    targetDeliveryDate: "2026-10-01", units: 500, transportMode: "AIR", incoterm: "DDP",
    unitPrice: 0.48, currency: "USD", freight: 5, freightCurrency: "EUR",
    dutyRatePct: 6.5, eustRatePct: 19, fxRate: 1.19,
    productionLeadTimeDays: 14, logisticsLeadTimeDays: 21, bufferDays: 0,
    orderDate: "2026-08-27", productionEndDate: "2026-09-10", etdDate: "2026-09-10",
    etaDate: "2026-10-01", deliveryDate: "2026-10-01",
    payments: [
      { id: "supplier-0", label: "Deposit", percent: 30, amount: 72, currency: "USD", triggerEvent: "ORDER_DATE", offsetDays: 0, offsetMonths: 0, dueDate: "2026-08-27", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
      { id: "supplier-1", label: "Balance", percent: 70, amount: 168, currency: "USD", triggerEvent: "ETD", offsetDays: 0, offsetMonths: 0, dueDate: "2026-09-10", isOverridden: false, dueDateManuallySet: false, category: "supplier" },
    ],
  },
];

const ACCEPTS = [
  { sku: "021.002-KNIFE-BLOCK-STRAIGHT", from: "2026-06", until: "2026-07", dur: 2 },
  { sku: "021.003-KNIFE-BLOCK-SLOPE", from: "2026-06", until: "2026-07", dur: 2 },
  { sku: "034.001-KNIFE-BLOCK-SHARP", from: "2026-06", until: "2026-07", dur: 2 },
  { sku: "035.001-BIKEPACK-FOOD-POUCH", from: "2026-06", until: "2026-06", dur: 1 },
];

export default async function (state) {
  const log = (m) => console.log("  " + m);

  console.log("\n=== (A) Reorder-FOs (DRAFT) ergänzen ===");
  state.fos = Array.isArray(state.fos) ? state.fos : [];
  for (const fo of REORDER_FOS) {
    if (state.fos.some((f) => String(f.id) === fo.id)) { log(`~~ ${fo.foNo} existiert bereits`); continue; }
    state.fos.push(JSON.parse(JSON.stringify(fo)));
    log(`+ ${fo.foNo} ${fo.sku} ${fo.units} Stk, Order ${fo.orderDate}, ETA ${fo.etaDate}, ${fo.transportMode}`);
  }

  console.log("=== (B) Prelaunch-Accepts setzen + alte E3-Accepts (Reason-Mismatch) entfernen ===");
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const acc = state.settings.phantomFoShortageAcceptBySku || (state.settings.phantomFoShortageAcceptBySku = {});
  for (const k of Object.keys(acc)) {
    if (/021\.00[23].*::stock_under_safety::/i.test(k)) { delete acc[k]; log(`- alter Accept entfernt: ${k}`); }
  }
  for (const a of ACCEPTS) {
    const key = `${a.sku.toLowerCase()}::stock_oos::${a.from}`;
    acc[key] = {
      sku: a.sku, reason: "stock_oos", acceptedFromMonth: a.from, acceptedUntilMonth: a.until,
      durationMonths: a.dur,
      note: "Prelaunch: Launch-Stock per PO bestellt; vor Launch kein verkaufbarer Bestand (Claude/GF 2026-06-03).",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    log(`+ Accept ${a.sku} stock_oos ${a.from}..${a.until}`);
  }

  console.log("=== (C) Datenfix PO260005 Saddlebag 1056 -> 1008 (VO-Ist) ===");
  const po5 = (state.pos || []).find((p) => String(p.poNo) === "260005");
  if (po5) {
    const it = (po5.items || []).find((i) => String(i.sku).includes("028.001"));
    if (it && it.units !== 1008) {
      const diff = it.units - 1008;
      log(`PO260005 028.001 ${it.units} -> 1008 (units ${po5.units} -> ${po5.units - diff})`);
      it.units = 1008;
      po5.units = (Number(po5.units) || 0) - diff;
    } else { log("~~ PO260005 Saddlebag bereits 1008 oder nicht gefunden"); }
  } else { log("!! PO260005 nicht gefunden"); }

  console.log("=== fertig ===");
}

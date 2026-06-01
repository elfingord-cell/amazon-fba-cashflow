// Tests fuer die reine Mapping-Funktion mapVentoryRowToItem.
// Lauf: node --test tools/fba-cli/build-snapshot-from-ventory.test.mjs
//
// Mapping (GF-Entscheidung 2026-06-01):
//   amazonUnits  = InStock + reserviert + Transit-zu-FBA   (alles bei/unterwegs zu Amazon)
//   threePLUnits = wh_pcs_left                             (nur Majamo-3PL)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapVentoryRowToItem } from "./build-snapshot-from-ventory.mjs";

test("Transit zaehlt zu Amazon: inStock=10, resv=2, onway=63 -> amazonUnits=75, 3PL=0", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 0, fba_pcs_on_the_way: 63, InStockSupplyQuantity: 10, afn_reserved_quantity: 2 },
    "TEST-SADDLEBAG",
  );
  assert.equal(it.amazonUnits, 75);   // 10 + 2 + 63
  assert.equal(it.threePLUnits, 0);
  assert.equal(it.components.inTransitUnits, 63);
  assert.equal(it.components.whStockUnits, 0);
});

test("Nur 3PL-Lager landet im 3PL-Eimer: wh=1300, onway=0 -> 3PL=1300", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 1300, fba_pcs_on_the_way: 0, InStockSupplyQuantity: 5, afn_reserved_quantity: 0 },
    "TEST-KNIFE-360",
  );
  assert.equal(it.threePLUnits, 1300);
  assert.equal(it.amazonUnits, 5);
});

test("wh + Transit: wh=1300, onway=19 -> 3PL=1300, amazon=24 (inStock5+transit19)", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 1300, fba_pcs_on_the_way: 19, InStockSupplyQuantity: 5, afn_reserved_quantity: 0 },
    "TEST-KNIFE-360",
  );
  assert.equal(it.threePLUnits, 1300);   // nur wh
  assert.equal(it.amazonUnits, 24);      // 5 + 0 + 19
});

test("Satteltasche-Fall (VO live): inStock776, resv42, wh0, onway66 -> amazon=884, 3PL=0", () => {
  const it = mapVentoryRowToItem(
    { InStockSupplyQuantity: 776, afn_reserved_quantity: 42, wh_pcs_left: 0, fba_pcs_on_the_way: 66 },
    "028.001-BIKEPACK-SADDLEBAG",
  );
  assert.equal(it.amazonUnits, 884);
  assert.equal(it.threePLUnits, 0);
});

test("amazonUnits = inStock + reserved + transit", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 0, fba_pcs_on_the_way: 8, InStockSupplyQuantity: 120, afn_reserved_quantity: 35 },
    "TEST-SKU",
  );
  assert.equal(it.amazonUnits, 163);   // 120 + 35 + 8
});

test("Geschriebenes Item hat sku/note/amazonUnits/threePLUnits + components (persistiert)", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 10, fba_pcs_on_the_way: 5, InStockSupplyQuantity: 1, afn_reserved_quantity: 1 },
    "TEST-SKU",
  );
  assert.deepEqual(Object.keys(it).sort(), ["amazonUnits", "components", "note", "sku", "threePLUnits"]);
  assert.deepEqual(it.components, {
    inStock: 1, reserved: 1, wh: 10, onTheWay: 5, whStockUnits: 10, inTransitUnits: 5,
  });
});

test("Nicht-numerische / fehlende Werte -> 0", () => {
  const it = mapVentoryRowToItem({ wh_pcs_left: "x", fba_pcs_on_the_way: undefined }, "TEST-SKU");
  assert.equal(it.threePLUnits, 0);
  assert.equal(it.amazonUnits, 0);
});

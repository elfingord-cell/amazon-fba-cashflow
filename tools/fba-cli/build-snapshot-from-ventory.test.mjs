// Tests fuer die reine Mapping-Funktion mapVentoryRowToItem.
// Lauf: node --test tools/fba-cli/build-snapshot-from-ventory.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapVentoryRowToItem } from "./build-snapshot-from-ventory.mjs";

test("Transit nur unterwegs: wh=0, onway=63 -> threePLUnits=63", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 0, fba_pcs_on_the_way: 63, InStockSupplyQuantity: 10, afn_reserved_quantity: 2 },
    "TEST-SADDLEBAG",
  );
  assert.equal(it.threePLUnits, 63);
  assert.equal(it.amazonUnits, 12);
  assert.equal(it._components.inTransitUnits, 63);
  assert.equal(it._components.whStockUnits, 0);
});

test("Additiv, disjunkt: wh=504, onway=504 -> threePLUnits=1008 (zwei Chargen)", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 504, fba_pcs_on_the_way: 504, InStockSupplyQuantity: 0, afn_reserved_quantity: 0 },
    "TEST-FRAMEBAG-EDGE",
  );
  assert.equal(it.threePLUnits, 1008);
});

test("Lager + Transit: wh=1300, onway=19 -> threePLUnits=1319", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 1300, fba_pcs_on_the_way: 19, InStockSupplyQuantity: 5, afn_reserved_quantity: 0 },
    "TEST-KNIFE-360",
  );
  assert.equal(it.threePLUnits, 1319);
});

test("amazonUnits = inStock + reserved (unveraendert)", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 0, fba_pcs_on_the_way: 0, InStockSupplyQuantity: 120, afn_reserved_quantity: 35 },
    "TEST-SKU",
  );
  assert.equal(it.amazonUnits, 155);
});

test("Geschriebenes Item bekommt nur erlaubte Felder (Schema-Kompat)", () => {
  const it = mapVentoryRowToItem(
    { wh_pcs_left: 10, fba_pcs_on_the_way: 5, InStockSupplyQuantity: 1, afn_reserved_quantity: 1 },
    "TEST-SKU",
  );
  const { _components, ...written } = it;
  assert.deepEqual(Object.keys(written).sort(), ["amazonUnits", "note", "sku", "threePLUnits"]);
});

test("Nicht-numerische / fehlende Werte -> 0", () => {
  const it = mapVentoryRowToItem({ wh_pcs_left: "x", fba_pcs_on_the_way: undefined }, "TEST-SKU");
  assert.equal(it.threePLUnits, 0);
  assert.equal(it.amazonUnits, 0);
});

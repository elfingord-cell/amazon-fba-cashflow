import test from "node:test";
import assert from "node:assert/strict";
import { parseVentoryFbaPaste } from "./ventoryFbaPasteParser.js";

const KNOWN = {
  "021.001-knife-block-360": "021.001-KNIFE-BLOCK-360",
  "025.001-knife-bar": "025.001-Knife-Bar",
  "001.001-nespresso-capsules-1": "001.001-NESPRESSO-CAPSULES-1",
  "005.002-nespresso-4": "005.002-NESPRESSO-4",
};

test("parses VentoryOne clipboard text with title row and relevant FBA columns", () => {
  const text = [
    "Aktueller Bestand | VentoryOne",
    "FBA Quelle\tSKU\tFBA Bestand\tFBA Bestand verf\u00fcgbar\tFBA Bestand reserviert",
    "amazon.de\t021.001-KNIFE-BLOCK-360\t241\t221\t20",
    "amazon.de\tUNKNOWN-SKU\t15\t14\t1",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.equal(result.error, "");
  assert.equal(result.recognizedRows, 2);
  assert.equal(result.knownSkuCount, 1);
  assert.equal(result.unknownSkuCount, 1);
  assert.equal(result.importableSkuCount, 1);
  assert.equal(result.canImport, true);
  assert.equal(result.importableBySku["021.001-KNIFE-BLOCK-360"].fbaUnits, 241);
  assert.deepEqual(result.unknownSkus, ["UNKNOWN-SKU"]);
});

test("matches SKU case-insensitive and keeps canonical SKU", () => {
  const text = [
    "SKU\tFBA Bestand",
    "021.001-knife-block-360\t241",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.equal(result.error, "");
  assert.equal(result.previewRows[0].sku, "021.001-KNIFE-BLOCK-360");
  assert.equal(result.previewRows[0].status, "zuordenbar");
});

test("supports thousands separators and comma/dot variants", () => {
  const text = [
    "SKU\tFBA Bestand",
    "025.001-Knife-Bar\t1.234",
    "021.001-KNIFE-BLOCK-360\t1,234",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.equal(result.error, "");
  assert.equal(result.importableBySku["025.001-Knife-Bar"].fbaUnits, 1234);
  assert.equal(result.importableBySku["021.001-KNIFE-BLOCK-360"].fbaUnits, 1234);
});

test("uses only FBA Bestand even when FBA Bestand verfügbar is present", () => {
  const text = [
    "SKU\tFBA Bestand\tFBA Bestand verf\u00fcgbar",
    "005.002-NESPRESSO-4\t161\t20",
    "001.001-NESPRESSO-CAPSULES-1\t455\t280",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.equal(result.error, "");
  assert.equal(result.importableBySku["005.002-NESPRESSO-4"].fbaUnits, 161);
  assert.equal(result.importableBySku["001.001-NESPRESSO-CAPSULES-1"].fbaUnits, 455);
});

test("duplicate SKU keeps latest row and emits warning", () => {
  const text = [
    "SKU\tFBA Bestand",
    "025.001-Knife-Bar\t108",
    "025.001-Knife-Bar\t120",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.equal(result.error, "");
  assert.equal(result.duplicateSkuCount, 1);
  assert.equal(result.importableBySku["025.001-Knife-Bar"].fbaUnits, 120);
  assert.match(result.warnings.join(" | "), /mehrfach/i);
});

test("returns header error when required columns are missing", () => {
  const text = [
    "SKU\tBestand",
    "A\t1",
  ].join("\n");

  const result = parseVentoryFbaPaste({ text, knownSkuMap: KNOWN });

  assert.match(result.error, /Header nicht erkannt/i);
  assert.equal(result.previewRows.length, 0);
  assert.equal(result.canImport, false);
});

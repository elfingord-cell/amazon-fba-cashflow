import test from "node:test";
import assert from "node:assert/strict";
import { parseVentory3plPaste } from "./ventory3plPasteParser.js";

const KNOWN = {
  "005.002-nespresso-4": "005.002-NESPRESSO-4",
  "024.001-tassimo-capsule-200ml": "024.001-TASSIMO-CAPSULE-200ml",
  "025.001-knife-bar": "025.001-Knife-Bar",
};

test("parses VentoryOne clipboard text with title row and header", () => {
  const text = [
    "Warenlager Verwaltung | VentoryOne",
    "Produkt Typ\tFarbe\tGröße\tSKU\tFNSKU\tSTK / Ktn. Standard\tAnzahl Ktns.\tSTK - In Kartons\tSTK - Stückgut\tSTK - Insgesamt",
    "01 - Nespresso\t\t4 Stück\t005.002-NESPRESSO-4\tX0027XJ51B\t190\t1\t140\t0\t140",
    "01 - Nespresso\tSilber-\t1 Stück\t024.001-TASSIMO-CAPSULE-200ml\tX0026PHL0H\t257\t1\t257\t0\t257",
    "99 - Weitere\tBeton\t\tUNKNOWN-SKU\tX001H8108D\t8\t14\t112\t0\t112",
  ].join("\n");

  const result = parseVentory3plPaste({ text, knownSkuMap: KNOWN, duplicatePolicy: "block" });

  assert.equal(result.error, "");
  assert.equal(result.recognizedRows, 3);
  assert.equal(result.knownSkuCount, 2);
  assert.equal(result.unknownSkuCount, 1);
  assert.equal(result.duplicateSkuCount, 0);
  assert.equal(result.importableSkuCount, 2);
  assert.equal(result.canImport, true);
  assert.equal(result.importableBySku["005.002-NESPRESSO-4"], 140);
  assert.equal(result.importableBySku["024.001-TASSIMO-CAPSULE-200ml"], 257);
  assert.deepEqual(result.unknownSkus, ["UNKNOWN-SKU"]);
});

test("duplicate policy block requires decision and excludes duplicate SKU from importable set", () => {
  const text = [
    "SKU\tSTK – Insgesamt",
    "025.001-Knife-Bar\t390",
    "025.001-Knife-Bar\t10",
  ].join("\n");

  const result = parseVentory3plPaste({ text, knownSkuMap: KNOWN, duplicatePolicy: "block" });

  assert.equal(result.error, "");
  assert.equal(result.duplicateSkuCount, 1);
  assert.equal(result.canImport, false);
  assert.equal(result.importableSkuCount, 0);
  assert.equal(result.previewRows[0].status, "Duplikat (Entscheidung erforderlich)");
  assert.deepEqual(result.duplicateRows[0].values, [390, 10]);
});

test("duplicate policy sum aggregates units", () => {
  const text = [
    "SKU\tSTK - Insgesamt",
    "025.001-Knife-Bar\t390",
    "025.001-Knife-Bar\t10",
  ].join("\n");

  const result = parseVentory3plPaste({ text, knownSkuMap: KNOWN, duplicatePolicy: "sum" });

  assert.equal(result.canImport, true);
  assert.equal(result.importableSkuCount, 1);
  assert.equal(result.importableBySku["025.001-Knife-Bar"], 400);
  assert.equal(result.previewRows[0].status, "zuordenbar (Duplikat: Summe)");
});

test("duplicate policy last keeps last value", () => {
  const text = [
    "SKU\tSTK - Insgesamt",
    "025.001-Knife-Bar\t390",
    "025.001-Knife-Bar\t10",
  ].join("\n");

  const result = parseVentory3plPaste({ text, knownSkuMap: KNOWN, duplicatePolicy: "last" });

  assert.equal(result.canImport, true);
  assert.equal(result.importableSkuCount, 1);
  assert.equal(result.importableBySku["025.001-Knife-Bar"], 10);
  assert.equal(result.previewRows[0].status, "zuordenbar (Duplikat: letzte Zeile)");
});

test("returns header error when required columns are missing", () => {
  const text = [
    "SKU\tBestand",
    "A\t1",
  ].join("\n");

  const result = parseVentory3plPaste({ text, knownSkuMap: KNOWN, duplicatePolicy: "block" });

  assert.match(result.error, /Header nicht erkannt/i);
  assert.equal(result.previewRows.length, 0);
  assert.equal(result.canImport, false);
});

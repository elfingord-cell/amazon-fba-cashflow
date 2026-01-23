import test from "node:test";
import assert from "node:assert/strict";
import { parseVentoryCsv, _test } from "./forecastCsv.js";

const sampleCsv = [
  ";;Erwartete Verkäufe Jan. 2026 FBA- und FBM-Prognose;;;Erwartete Verkäufe März 2026 FBA- und FBM-Prognose",
  "SKU;Alias;Einheiten;Umsatz [€];Gewinn [€];Einheiten;Umsatz [€];Gewinn [€]",
  "ABC-123;Produkt A;218,67;9868,58;5191,23;164,77;7436,07;3911,64",
  "Gesamt;;;;;;;",
].join("\n");

test("parseVentoryCsv reads month groups and skips Gesamt rows", () => {
  const result = parseVentoryCsv(sampleCsv);
  assert.equal(result.error, undefined);
  assert.equal(result.records.length, 2);
  assert.equal(result.ignoredTotal, 1);
  assert.equal(result.records[0].units, 218.67);
  const months = new Set(result.records.map(rec => rec.month));
  assert.deepEqual(Array.from(months).sort(), ["2026-01", "2026-03"]);
});

test("parseVentoryMonth maps März/Mrz/Marz to 03", () => {
  assert.equal(_test.parseVentoryMonth("Erwartete Verkäufe März 2026"), "2026-03");
  assert.equal(_test.parseVentoryMonth("Erwartete Verkäufe Mrz. 2026"), "2026-03");
  assert.equal(_test.parseVentoryMonth("Erwartete Verkäufe Marz 2026"), "2026-03");
});

test("parseNumberDE parses German decimals", () => {
  assert.equal(_test.parseNumberDE("218,67"), 218.67);
  assert.equal(_test.parseNumberDE("1.234,50"), 1234.5);
});

test("detectDelimiter prefers comma when commas dominate", () => {
  const delimiter = _test.detectDelimiter([
    "SKU,Einheiten,Umsatz [€]",
    "ABC,1,2",
    "DEF,3,4",
  ]);
  assert.equal(delimiter, ",");
});

import test from "node:test";
import assert from "node:assert/strict";

import { parseForecastJsonPayload, normalizeMonthToken, formatEuroDE, parseVentoryCsv, mergeForecastItems } from "./forecastImport.js";

test("normalises month tokens", () => {
  assert.equal(normalizeMonthToken("2025-11"), "2025-11");
  assert.equal(normalizeMonthToken("11/2025"), "2025-11");
  assert.equal(normalizeMonthToken("Okt 2026"), "2026-10");
});

test("parses app export incomings", () => {
  const payload = {
    settings: { startMonth: "2025-11", horizonMonths: 18 },
    incomings: [
      { month: "2025-11", revenueEur: "67.827,00", payoutPct: "51" },
      { month: "2025-12", revenueEur: "84.109,00", payoutPct: "51" },
    ],
  };
  const res = parseForecastJsonPayload(payload);
  assert.equal(res.type, "app-export");
  assert.equal(res.incomings[0].month, "2025-11");
  assert.equal(res.incomings[0].revenueEur, 67827);
  assert.equal(res.incomings[0].payoutPct, 51);
  assert.equal(res.settings.startMonth, "2025-11");
  assert.equal(res.settings.horizonMonths, 18);
});

test("parses ventory broad json", () => {
  const payload = {
    columns: ["SKU", "Alias", "2025-11", "2025-12"],
    rows: [
      ["CAP-STEEL-2PK", "Refill Cap Steel 2-pack", 120, 130],
      ["MAT-DRIP-SIL", "Silicone Drip Mat", 60, 62],
    ],
    priceEur: { "CAP-STEEL-2PK": 24.9, "MAT-DRIP-SIL": 25 },
  };
  const res = parseForecastJsonPayload(payload);
  assert.equal(res.type, "ventory-broad");
  assert.equal(res.records.length, 4);
  const first = res.records.find(r => r.sku === "CAP-STEEL-2PK" && r.month === "2025-11");
  assert.ok(first);
  assert.equal(first.qty, 120);
  assert.equal(first.priceEur, 24.9);
});

test("parses ventory long json", () => {
  const payload = {
    items: [
      { sku: "CAP-STEEL-2PK", month: "2025-11", qty: 120, priceEur: 24.9 },
      { sku: "CAP-STEEL-2PK", month: "2025-12", qty: 130 },
    ],
  };
  const res = parseForecastJsonPayload(payload);
  assert.equal(res.type, "ventory-long");
  assert.equal(res.records.length, 2);
  assert.equal(res.records[1].qty, 130);
});

test("formats euro for de locale", () => {
  assert.equal(formatEuroDE("1.234,5"), "1.234,50");
});

test("parses ventory csv with grouped headers, skipping Gesamt and mapping months", () => {
  const csv = [
    ["", "", "Erwartete Verkäufe März 2026 FBA- und FBM-Prognose", "", "", "Erwartete Verkäufe Apr. 2026 FBA- und FBM-Prognose", "", ""].join(','),
    ["SKU", "FNSKU", "Einheiten", "Umsatz [€]", "Gewinn [€]", "Einheiten", "Umsatz [€]", "Gewinn [€]"].join(','),
    ["X3-42Y5-Q7DT", "X0018H9DJV", '"229,23"', "", "", '"199,69"', "", ""].join(','),
    ["3V-TA5N-FAOP", "X001GKXH5L", '"127,87"', "", "", '"90,82"', "", ""].join(','),
    ["Gesamt", "", "", "", "", "", "", ""].join(','),
  ].join("\n");
  const res = parseVentoryCsv(csv);
  const march = res.records.find(r => r.sku === "X3-42Y5-Q7DT" && r.month === "2026-03");
  const april = res.records.find(r => r.sku === "X3-42Y5-Q7DT" && r.month === "2026-04");
  assert.ok(march, "march value present");
  assert.ok(april, "april value present");
  assert.equal(march.qty, 229.23);
  assert.equal(april.qty, 199.69);
  assert.equal(res.records.filter(r => r.sku.toLowerCase().includes("gesamt")).length, 0);
  assert.ok(res.importedMonths.includes("2026-03"));
  assert.ok(res.importedMonths.includes("2026-04"));
});

test("mergeForecastItems replaces imported months for matching SKUs", () => {
  const existing = [
    { sku: "SKU1", month: "2026-03", qty: 10 },
    { sku: "SKU1", month: "2026-05", qty: 5 },
    { sku: "SKU2", month: "2026-03", qty: 7 },
  ];
  const incoming = [
    { sku: "SKU1", month: "2026-03", qty: 99 },
    { sku: "SKU1", month: "2026-04", qty: 11 },
  ];
  const merged = mergeForecastItems(existing, incoming);
  const byKey = new Map(merged.items.map(it => [`${it.sku}__${it.month}`, it]));
  assert.equal(byKey.get("SKU1__2026-03").qty, 99);
  assert.equal(byKey.get("SKU1__2026-05").qty, 5);
  assert.equal(byKey.get("SKU1__2026-04").qty, 11);
  assert.ok(byKey.get("SKU2__2026-03"));
});

import test from "node:test";
import assert from "node:assert/strict";

import { parseForecastJsonPayload, normalizeMonthToken, formatEuroDE } from "./forecastImport.js";

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

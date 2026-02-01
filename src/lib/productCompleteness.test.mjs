import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductCompleteness } from "./productCompleteness.js";
import { buildPrefillForSku } from "./prefill.js";

test("evaluateProductCompleteness marks ready product", () => {
  const state = {
    settings: {
      fxRate: 1.17,
      transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
      defaultProductionLeadTimeDays: 30,
    },
    suppliers: [{ id: "sup-1", productionLeadTimeDaysDefault: 20 }],
    productSuppliers: [{ sku: "SKU-1", supplierId: "sup-1", productionLeadTimeDays: 18 }],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-1",
    alias: "Testprodukt",
    status: "active",
    categoryId: "cat-1",
    supplierId: "sup-1",
    landedUnitCostEur: 10,
    productionLeadTimeDaysDefault: 18,
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.missingRequired, []);
});

test("evaluateProductCompleteness blocks missing cost basis", () => {
  const state = {
    settings: { fxRate: 1.17, transportLeadTimesDays: { air: 10, rail: 25, sea: 45 } },
    suppliers: [],
    productSuppliers: [],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-2",
    alias: "Ohne Kosten",
    status: "active",
    categoryId: "cat-2",
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "blocked");
  assert.ok(result.missingRequired.includes("Kostenbasis"));
});

test("evaluateProductCompleteness warns on missing supplier", () => {
  const state = {
    settings: { fxRate: 1.17, transportLeadTimesDays: { air: 10, rail: 25, sea: 45 } },
    suppliers: [],
    productSuppliers: [],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-3",
    alias: "Ohne Supplier",
    status: "active",
    categoryId: "cat-3",
    landedUnitCostEur: 5,
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "warning");
  assert.ok(result.missingWarnings.includes("Supplier"));
});

test("buildPrefillForSku resolves unit price, logistics, and payment terms", () => {
  const state = {
    settings: {
      fxRate: 1.17,
      transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
      defaultBufferDays: 2,
    },
    suppliers: [{
      id: "sup-2",
      currencyDefault: "USD",
      productionLeadTimeDaysDefault: 40,
      paymentTermsDefault: [
        { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { label: "Balance", percent: 70, triggerEvent: "ETD", offsetDays: 0 },
      ],
    }],
    productSuppliers: [{
      sku: "SKU-4",
      supplierId: "sup-2",
      unitPrice: 6.37,
      currency: "USD",
      productionLeadTimeDays: 35,
    }],
    products: [{
      sku: "SKU-4",
      alias: "Logistik-Test",
      status: "active",
      categoryId: "cat-4",
      supplierId: "sup-2",
      landedUnitCostEur: 6.78,
      template: { fields: { unitPriceUsd: 6.37 } },
    }],
  };
  const prefill = buildPrefillForSku("SKU-4", { mode: "FO" }, { state });
  assert.equal(prefill.unitPrice, 6.37);
  assert.equal(prefill.currency, "USD");
  assert.equal(prefill.productionLeadTimeDays, 35);
  assert.ok(Math.abs(prefill.logisticsPerUnitEur - 1.34) < 0.02);
  assert.equal(prefill.paymentTerms.length, 2);
});

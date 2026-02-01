import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductCompleteness } from "./productCompleteness.js";
import { buildPrefillForSku } from "./prefill.js";

test("evaluateProductCompleteness marks ready product", () => {
  const state = {
    settings: {
      transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
      defaultProductionLeadTimeDays: 30,
      moqDefaultUnits: 500,
      dutyRatePct: 6.5,
      eustRatePct: 19,
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
    moqUnits: 600,
    template: {
      fields: { unitPriceUsd: 5.5, transitDays: 30, dutyPct: 6.5, vatImportPct: 19, currency: "USD" },
    },
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.blockingMissing, []);
});

test("evaluateProductCompleteness warns when MOQ uses default", () => {
  const state = {
    settings: {
      transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
      defaultProductionLeadTimeDays: 30,
      moqDefaultUnits: 500,
      dutyRatePct: 6.5,
      eustRatePct: 19,
    },
    suppliers: [{ id: "sup-2", currencyDefault: "USD" }],
    productSuppliers: [{ sku: "SKU-2", supplierId: "sup-2", unitPrice: 6.37, currency: "USD" }],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-2",
    alias: "Mit Preis",
    status: "active",
    categoryId: "cat-2",
    productionLeadTimeDaysDefault: 12,
    template: { fields: { transitDays: 22 } },
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "warn");
  assert.equal(result.blockingMissing.length, 0);
  assert.ok(result.defaulted.some(item => item.label === "MOQ"));
});

test("evaluateProductCompleteness blocks missing MOQ without default", () => {
  const state = {
    settings: { transportLeadTimesDays: { air: 10, rail: 25, sea: 45 }, defaultProductionLeadTimeDays: 25 },
    suppliers: [],
    productSuppliers: [],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-3",
    alias: "Ohne MOQ",
    status: "active",
    categoryId: "cat-3",
    template: { fields: { unitPriceUsd: 5.5, transitDays: 30, dutyPct: 6.5, vatImportPct: 19 } },
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockingMissing.some(item => item.label === "MOQ"));
});

test("evaluateProductCompleteness defaults duty and eust without blocking", () => {
  const state = {
    settings: {
      transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
      defaultProductionLeadTimeDays: 30,
      dutyRatePct: 6.5,
      eustRatePct: 19,
    },
    suppliers: [],
    productSuppliers: [],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-4",
    alias: "Mit Defaults",
    status: "active",
    categoryId: "cat-4",
    moqUnits: 400,
    productionLeadTimeDaysDefault: 14,
    template: { fields: { unitPriceUsd: 4.2, transitDays: 30 } },
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "warn");
  assert.ok(result.defaulted.some(item => item.label === "Zoll %"));
  assert.ok(result.defaulted.some(item => item.label === "EUSt %"));
  assert.equal(result.blockingMissing.length, 0);
});

test("evaluateProductCompleteness blocks missing production and transit days without defaults", () => {
  const state = {
    settings: {},
    suppliers: [],
    productSuppliers: [],
    forecast: { settings: { useForecast: false } },
  };
  const product = {
    sku: "SKU-5",
    alias: "Ohne Lead Times",
    status: "active",
    categoryId: "cat-5",
    moqUnits: 300,
    template: { fields: { unitPriceUsd: 5.1, dutyPct: 6.5, vatImportPct: 19 } },
  };
  const result = evaluateProductCompleteness(product, { state });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockingMissing.some(item => item.label === "Produktionszeit (Tage)"));
  assert.ok(result.blockingMissing.some(item => item.label === "Transit-Tage"));
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

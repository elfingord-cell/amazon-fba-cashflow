const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveMasterDataHierarchy,
} = require("../../.test-build/migration/v2/domain/masterDataHierarchy.js");
const {
  evaluateOrderBlocking,
  evaluateProductCompletenessV2,
} = require("../../.test-build/migration/v2/domain/productCompletenessV2.js");

function baseState() {
  return {
    settings: {
      defaultCurrency: "EUR",
      fxRate: 0.92,
      moqDefaultUnits: 500,
      defaultProductionLeadTimeDays: 60,
      dutyRatePct: 4,
      eustRatePct: 19,
      defaultDdp: false,
      transportLeadTimesDays: { sea: 45 },
    },
    suppliers: [
      {
        id: "sup-1",
        name: "Supplier 1",
        unitPriceDefault: 7.1,
        moqDefaultUnits: 320,
        productionLeadTimeDaysDefault: 52,
        transitDaysDefault: 39,
        dutyRatePct: 5,
        eustRatePct: 19,
        defaultDdp: false,
      },
    ],
    productSuppliers: [
      {
        sku: "SKU-1",
        supplierId: "sup-1",
        unitPrice: 6.2,
        minOrderQty: 240,
        productionLeadTimeDays: 41,
        transitDays: 36,
      },
    ],
    products: [
      {
        id: "prod-1",
        sku: "SKU-1",
        supplierId: "sup-1",
        status: "active",
        avgSellingPriceGrossEUR: 19.9,
        sellerboardMarginPct: 24,
        template: {
          fields: {
            unitPriceUsd: 6.5,
            productionDays: 45,
            transitDays: 38,
            ddp: false,
            currency: "USD",
          },
        },
      },
    ],
  };
}

test("master data hierarchy: precedence is override -> product -> supplier", () => {
  const state = baseState();

  const fromProduct = resolveMasterDataHierarchy({
    state,
    sku: "SKU-1",
    supplierId: "sup-1",
    orderContext: "po",
  });
  assert.equal(fromProduct.fields.unitPriceUsd.source, "product");
  assert.equal(fromProduct.fields.unitPriceUsd.value, 6.5);

  const fromOverride = resolveMasterDataHierarchy({
    state,
    sku: "SKU-1",
    supplierId: "sup-1",
    orderContext: "po",
    orderOverrides: { unitCostUsd: 6.0 },
  });
  assert.equal(fromOverride.fields.unitPriceUsd.source, "order_override");
  assert.equal(fromOverride.fields.unitPriceUsd.value, 6.0);

  const stateNoProductPrice = baseState();
  stateNoProductPrice.products[0].template.fields.unitPriceUsd = null;
  const fromSupplierLink = resolveMasterDataHierarchy({
    state: stateNoProductPrice,
    sku: "SKU-1",
    supplierId: "sup-1",
    orderContext: "po",
  });
  assert.equal(fromSupplierLink.fields.unitPriceUsd.source, "supplier");
  assert.equal(fromSupplierLink.fields.unitPriceUsd.value, 6.2);
});

test("master data hierarchy: moq/prod fallback uses supplier then settings", () => {
  const state = baseState();
  state.products[0].moqOverrideUnits = null;
  state.products[0].moqUnits = null;
  state.products[0].productionLeadTimeDaysDefault = null;
  state.products[0].template.fields.productionDays = null;

  const fromSupplier = resolveMasterDataHierarchy({
    state,
    sku: "SKU-1",
    supplierId: "sup-1",
    orderContext: "po",
  });
  assert.equal(fromSupplier.fields.moqUnits.source, "supplier");
  assert.equal(fromSupplier.fields.moqUnits.value, 240);
  assert.equal(fromSupplier.fields.productionLeadTimeDays.source, "supplier");
  assert.equal(fromSupplier.fields.productionLeadTimeDays.value, 41);

  const stateNoSupplierDefaults = baseState();
  stateNoSupplierDefaults.products[0].moqOverrideUnits = null;
  stateNoSupplierDefaults.products[0].moqUnits = null;
  stateNoSupplierDefaults.products[0].productionLeadTimeDaysDefault = null;
  stateNoSupplierDefaults.products[0].template.fields.productionDays = null;
  stateNoSupplierDefaults.productSuppliers = [];
  stateNoSupplierDefaults.suppliers[0].moqDefaultUnits = null;
  stateNoSupplierDefaults.suppliers[0].productionLeadTimeDaysDefault = null;

  const fromSettings = resolveMasterDataHierarchy({
    state: stateNoSupplierDefaults,
    sku: "SKU-1",
    supplierId: "sup-1",
    orderContext: "po",
  });
  assert.equal(fromSettings.fields.moqUnits.source, "settings");
  assert.equal(fromSettings.fields.moqUnits.value, 500);
  assert.equal(fromSettings.fields.productionLeadTimeDays.source, "settings");
  assert.equal(fromSettings.fields.productionLeadTimeDays.value, 60);
});

test("product completeness v2: active/prelaunch block, inactive warns, margin <= 0 blocks", () => {
  const state = baseState();
  const broken = {
    id: "prod-2",
    sku: "SKU-2",
    supplierId: "sup-1",
    status: "active",
    avgSellingPriceGrossEUR: null,
    sellerboardMarginPct: 0,
    template: { fields: { unitPriceUsd: null } },
  };
  state.products.push(broken);

  const activeResult = evaluateProductCompletenessV2({ product: broken, state });
  assert.equal(activeResult.status, "blocked");
  assert.ok(activeResult.blockingMissing.some((entry) => entry.fieldKey === "avgSellingPriceGrossEUR"));
  assert.ok(activeResult.blockingMissing.some((entry) => entry.fieldKey === "sellerboardMarginPct"));
  assert.ok(!activeResult.blockingMissing.some((entry) => entry.fieldKey === "unitPriceUsd"));
  assert.ok(!activeResult.blockingMissing.some((entry) => entry.fieldKey === "moqUnits"));

  const prelaunchResult = evaluateProductCompletenessV2({
    product: { ...broken, status: "prelaunch" },
    state,
  });
  assert.equal(prelaunchResult.status, "blocked");

  const inactiveResult = evaluateProductCompletenessV2({
    product: { ...broken, status: "inactive" },
    state,
  });
  assert.equal(inactiveResult.status, "warn");
});

test("order blocking: overrides unblock missing order fields without mutating product data", () => {
  const state = baseState();
  const product = {
    id: "prod-3",
    sku: "SKU-3",
    supplierId: "sup-1",
    status: "active",
    avgSellingPriceGrossEUR: 18,
    sellerboardMarginPct: 22,
    template: { fields: { unitPriceUsd: null, productionDays: null } },
  };
  state.products.push(product);
  state.suppliers[0].unitPriceDefault = null;

  const blocked = evaluateOrderBlocking({
    product,
    state,
    supplierId: "sup-1",
    orderContext: "po",
  });
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.issues.some((entry) => entry.fieldKey === "unitPriceUsd"));

  const unblocked = evaluateOrderBlocking({
    product,
    state,
    supplierId: "sup-1",
    orderContext: "po",
    orderOverrides: {
      unitCostUsd: 5.95,
      prodDays: 33,
      transitDays: 29,
      incoterm: "EXW",
    },
  });
  assert.equal(unblocked.blocked, false);
});

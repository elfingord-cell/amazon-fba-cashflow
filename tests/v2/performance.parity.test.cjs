const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const {
  buildCategoryLabelMap,
  buildForecastMonths,
  buildForecastProducts,
  buildForecastRevenueByMonth,
  buildProductGridRows,
  buildSupplierLabelMap,
  filterForecastProducts,
} = require("../../.test-build/migration/v2/domain/tableModels.js");

function measure(fn) {
  fn();
  const start = performance.now();
  const value = fn();
  return {
    value,
    durationMs: performance.now() - start,
  };
}

function createSyntheticState(productsCount = 3500) {
  const categories = Array.from({ length: 24 }, (_, index) => ({
    id: `cat-${index + 1}`,
    name: `Category ${index + 1}`,
  }));
  const suppliers = Array.from({ length: 80 }, (_, index) => ({
    id: `sup-${index + 1}`,
    name: `Supplier ${index + 1}`,
    productionLeadTimeDaysDefault: 35,
    currencyDefault: "USD",
  }));

  const products = Array.from({ length: productsCount }, (_, index) => {
    const sku = `SKU-${String(index + 1).padStart(5, "0")}`;
    const inactive = index % 7 === 0;
    return {
      id: `prod-${index + 1}`,
      sku,
      alias: `Product ${index + 1}`,
      supplierId: suppliers[index % suppliers.length].id,
      categoryId: categories[index % categories.length].id,
      status: inactive ? "inactive" : "active",
      moqUnits: 500 + (index % 120),
      avgSellingPriceGrossEUR: 19 + (index % 35),
      sellerboardMarginPct: 12 + (index % 18),
      productionLeadTimeDaysDefault: 40,
      template: {
        fields: {
          unitPriceUsd: 3 + (index % 4),
          transportMode: "SEA",
          transitDays: 45,
          dutyPct: 6.5,
          vatImportPct: 19,
          currency: "USD",
        },
      },
    };
  });

  const settings = {
    startMonth: "2025-01",
    horizonMonths: 18,
    defaultCurrency: "USD",
    dutyRatePct: 6.5,
    eustRatePct: 19,
    transportLeadTimesDays: { air: 10, rail: 25, sea: 45 },
    defaultProductionLeadTimeDays: 35,
    moqDefaultUnits: 500,
  };

  const months = buildForecastMonths(settings);
  const forecastImport = {};
  const forecastManual = {};
  products.forEach((product, index) => {
    const sku = product.sku;
    const monthMap = {};
    months.forEach((month, monthIndex) => {
      const units = ((index + monthIndex) % 45) + 8;
      monthMap[month] = {
        units,
        revenueEur: units * (product.avgSellingPriceGrossEUR || 0),
        profitEur: units * 4,
      };
    });
    forecastImport[sku] = monthMap;
    if (index % 5 === 0) {
      forecastManual[sku] = {
        [months[0]]: 42 + (index % 6),
        [months[1]]: 37 + (index % 4),
      };
    }
  });

  return {
    settings,
    products,
    suppliers,
    productCategories: categories,
    productSuppliers: [],
    pos: [],
    fos: [],
    forecast: {
      forecastImport,
      forecastManual,
    },
  };
}

test("performance parity: products grid selector handles large product list interactively", () => {
  const state = createSyntheticState(3500);
  const categoryLabelById = buildCategoryLabelMap(state);
  const supplierLabelById = buildSupplierLabelMap(state);

  const { value: rows, durationMs } = measure(() => buildProductGridRows({
    state,
    search: "",
    statusFilter: "all",
    categoryLabelById,
    supplierLabelById,
  }));

  assert.equal(rows.length, 3500);
  assert.ok(
    durationMs < 2200,
    `products selector too slow: ${durationMs.toFixed(1)}ms for 3500 rows`,
  );
});

test("performance parity: forecast table selectors stay responsive on large dataset", () => {
  const state = createSyntheticState(3000);
  const categoryLabelById = buildCategoryLabelMap(state);
  const products = buildForecastProducts(state, categoryLabelById);
  const allMonths = buildForecastMonths(state.settings);
  const visibleMonths = allMonths.slice(0, 12);
  const manualDraft = state.forecast.forecastManual;
  const forecastImport = state.forecast.forecastImport;
  const activeCount = products.filter((product) => product.isActive).length;

  const { value, durationMs } = measure(() => {
    const filtered = filterForecastProducts({
      products,
      search: "",
      onlyActive: true,
      onlyWithForecast: true,
      visibleMonths,
      manualDraft,
      forecastImport,
    });
    const revenueByMonth = buildForecastRevenueByMonth({
      allMonths,
      products,
      manualDraft,
      forecastImport,
    });
    return { filtered, revenueByMonth };
  });

  assert.equal(value.filtered.length, activeCount);
  assert.equal(value.revenueByMonth.size, allMonths.length);
  assert.ok(
    durationMs < 2200,
    `forecast selectors too slow: ${durationMs.toFixed(1)}ms for 3000 products x ${allMonths.length} months`,
  );
});

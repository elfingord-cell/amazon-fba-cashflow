import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  STORAGE_KEY,
  createEmptyState,
  loadState,
  saveState,
  upsertProduct,
} from "../../src/data/storageLocal.js";

const require = createRequire(import.meta.url);
const {
  buildCategoryLabelMap,
  buildProductGridRows,
  buildSupplierLabelMap,
} = require("../../.test-build/migration/v2/domain/tableModels.js");

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

function installLocalStorage() {
  globalThis.localStorage = new MemoryStorage();
}

function resetState() {
  saveState(createEmptyState(), { source: "test:reset" });
}

test.beforeEach(() => {
  installLocalStorage();
  resetState();
});

test("fnsku parity: product grid rows map fnsku and search matches it", () => {
  const state = createEmptyState();
  state.suppliers = [{ id: "sup-1", name: "Supplier One" }];
  state.productCategories = [{ id: "cat-1", name: "Category One" }];
  state.products = [{
    id: "prod-1",
    sku: "SKU-ALPHA",
    alias: "Alpha",
    fnsku: "X001-ALPHA",
    supplierId: "sup-1",
    categoryId: "cat-1",
    status: "active",
    includeInForecast: true,
    avgSellingPriceGrossEUR: 19.99,
    sellerboardMarginPct: 22,
    productionLeadTimeDaysDefault: 35,
    landedUnitCostEur: 4.5,
    template: {
      fields: {
        unitPriceUsd: 3.2,
        transitDays: 42,
        ddp: false,
      },
    },
  }];

  const categoryLabelById = buildCategoryLabelMap(state);
  const supplierLabelById = buildSupplierLabelMap(state);
  const rows = buildProductGridRows({
    state,
    search: "",
    statusFilter: "all",
    categoryLabelById,
    supplierLabelById,
  });
  const filtered = buildProductGridRows({
    state,
    search: "x001-alpha",
    statusFilter: "all",
    categoryLabelById,
    supplierLabelById,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fnsku, "X001-ALPHA");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].sku, "SKU-ALPHA");
});

test("fnsku parity: saveState migration trims fnsku on product records", () => {
  const state = createEmptyState();
  state.products = [{
    sku: "SKU-TRIM",
    alias: "Trim",
    fnsku: "  X000TRIM  ",
  }];

  saveState(state, { source: "test:save" });

  const product = loadState().products.find((entry) => entry.sku === "SKU-TRIM");
  assert.ok(product, "Produkt wurde nicht gespeichert.");
  assert.equal(product.fnsku, "X000TRIM");

  const raw = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  assert.equal(raw.products[0].fnsku, "X000TRIM");
});

test("fnsku parity: upsertProduct stores trimmed fnsku and allows clearing it", () => {
  upsertProduct({
    sku: "SKU-UPSERT",
    alias: "Upsert",
    fnsku: "  X000UPSERT  ",
  });

  let product = loadState().products.find((entry) => entry.sku === "SKU-UPSERT");
  assert.ok(product, "Produkt wurde nicht angelegt.");
  assert.equal(product.fnsku, "X000UPSERT");

  upsertProduct({
    originalSku: "SKU-UPSERT",
    sku: "SKU-UPSERT",
    alias: "Upsert",
    fnsku: "   ",
  });

  product = loadState().products.find((entry) => entry.sku === "SKU-UPSERT");
  assert.ok(product, "Produkt wurde beim Update nicht gefunden.");
  assert.equal(product.fnsku, "");
});

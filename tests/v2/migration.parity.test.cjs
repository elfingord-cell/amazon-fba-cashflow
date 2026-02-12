const test = require("node:test");
const assert = require("node:assert/strict");

const { runLegacyDryRun, runLegacyDryRunFromJson } = require("../../.test-build/migration/v2/migration/mapLegacy.js");
const { applyDryRunBundle, resolveDryRunApplication } = require("../../.test-build/migration/v2/migration/apply.js");
const { ensureAppStateV2 } = require("../../.test-build/migration/v2/state/appState.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripImportHistory(state) {
  const next = clone(state);
  next.legacyMeta = next.legacyMeta || {};
  next.legacyMeta.unmapped = next.legacyMeta.unmapped || {};
  next.legacyMeta.importHistory = [];
  return next;
}

class MemoryAdapter {
  constructor(initialState) {
    this.state = ensureAppStateV2(initialState);
    this.saves = [];
  }

  async load() {
    return clone(this.state);
  }

  async save(next, meta) {
    this.state = ensureAppStateV2(next);
    this.saves.push({
      next: clone(this.state),
      meta: clone(meta),
    });
  }
}

function createLegacySeed() {
  return {
    settings: {
      startMonth: "2025-01",
      openingBalance: "12.345,67",
      vatPreview: { eustLagMonths: 2 },
    },
    productCategories: [
      { name: "Kernsortiment" },
    ],
    suppliers: [
      { name: "Lieferant A" },
    ],
    products: [
      { sku: "SKU-1", alias: "Produkt 1", month: "01-2025" },
    ],
    monthlyActuals: {
      "01-2025": {
        realRevenueEUR: "1.234,56",
      },
    },
    forecast: {
      forecastManual: {
        "SKU-1": { "01-2025": 12 },
      },
      forecastImport: {},
    },
    inventory: {
      snapshots: [
        {
          month: "01-2025",
          items: [{ sku: "SKU-1", units: "1.000,00" }],
        },
      ],
      settings: { projectionMonths: "12" },
    },
    unknownTopLevelField: { keep: true },
  };
}

test("migration dry-run: report is reproducible and section stats are complete", () => {
  const source = createLegacySeed();
  const first = runLegacyDryRun(source);
  const second = runLegacyDryRun(clone(source));

  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.mappedState, second.mappedState);
  assert.equal(first.report.canApply, true);
  assert.deepEqual(first.report.sections.map((entry) => entry.section), [
    "settings",
    "productCategories",
    "suppliers",
    "products",
    "pos",
    "fos",
    "payments",
    "incomings",
    "extras",
    "dividends",
    "fixcosts",
    "fixcostOverrides",
    "monthlyActuals",
    "inventory",
    "forecast",
  ]);

  first.report.sections.forEach((section) => {
    assert.equal(typeof section.total, "number");
    assert.equal(typeof section.mapped, "number");
    assert.equal(typeof section.normalized, "number");
    assert.equal(typeof section.skipped, "number");
    assert.equal(typeof section.blocked, "number");
  });

  const unmappedIssues = first.report.issues.filter((issue) => issue.code === "UNMAPPED_ROOT_FIELD");
  assert.equal(unmappedIssues.length, 1);
});

test("migration apply: replace_workspace saves mapped target state exactly", async () => {
  const bundle = runLegacyDryRun(createLegacySeed());
  const currentState = ensureAppStateV2({
    settings: { openingBalance: "99,00" },
    products: [{ id: "old", sku: "OLD-1", alias: "Alt" }],
  });
  const adapter = new MemoryAdapter(currentState);
  const backupCalls = [];

  const result = await applyDryRunBundle(bundle, "replace_workspace", adapter, {
    createBackup: (source, state) => {
      backupCalls.push({ source, state: clone(state) });
      return "backup-test-1";
    },
  });

  assert.equal(result.mode, "replace_workspace");
  assert.equal(result.backupId, "backup-test-1");
  assert.equal(adapter.saves.length, 1);
  assert.equal(adapter.saves[0].meta.source, "v2:migration:replace_workspace");
  assert.equal(backupCalls.length, 1);
  assert.equal(backupCalls[0].source, "v2:migration:pre-apply");
  assert.deepEqual(stripImportHistory(backupCalls[0].state), stripImportHistory(currentState));

  const saved = adapter.saves[0].next;
  assert.deepEqual(stripImportHistory(saved), stripImportHistory(bundle.mappedState));
  assert.equal(saved.legacyMeta.importHistory.length, 1);
  assert.equal(saved.legacyMeta.importHistory[0].mode, "replace_workspace");
});

test("migration apply: merge_upsert keeps existing values and reports conflicts", () => {
  const currentState = ensureAppStateV2({
    settings: {
      openingBalance: "99,00",
      keepFlag: true,
      nested: {
        shared: "existing",
        existingOnly: "x",
      },
    },
    products: [{ id: "prod-existing", sku: "SKU-1", alias: "Bestehend" }],
    suppliers: [{ id: "sup-1", name: "Lieferant Bestehend" }],
  });

  const incomingBundle = runLegacyDryRun({
    settings: {
      openingBalance: "11,00",
      nested: {
        shared: "incoming",
        incomingOnly: "y",
      },
    },
    products: [
      { id: "prod-incoming", sku: "SKU-1", alias: "Neu" },
      { sku: "SKU-2", alias: "Neu 2" },
    ],
    suppliers: [
      { id: "sup-1", name: "Lieferant Ueberschreiben" },
      { name: "Lieferant Neu" },
    ],
  });

  const resolved = resolveDryRunApplication(incomingBundle, "merge_upsert", currentState);
  const nextState = ensureAppStateV2(resolved.nextState);

  const productBySku = new Map((nextState.products || []).map((entry) => [String(entry.sku), entry]));
  assert.equal(productBySku.get("SKU-1").alias, "Bestehend");
  assert.equal(productBySku.get("SKU-2").alias, "Neu 2");

  const supplierById = new Map((nextState.suppliers || []).map((entry) => [String(entry.id), entry]));
  assert.equal(supplierById.get("sup-1").name, "Lieferant Bestehend");
  assert.ok((nextState.suppliers || []).some((entry) => String(entry.name) === "Lieferant Neu"));

  assert.equal(nextState.settings.openingBalance, "99,00");
  assert.equal(nextState.settings.keepFlag, true);
  assert.equal(nextState.settings.nested.shared, "existing");
  assert.equal(nextState.settings.nested.existingOnly, "x");
  assert.equal(nextState.settings.nested.incomingOnly, "y");

  const conflictIssues = resolved.report.issues.filter((issue) => issue.code === "MERGE_CONFLICT_EXISTING_WINS");
  assert.ok(conflictIssues.length >= 2);
  assert.ok(conflictIssues.some((issue) => issue.entityType === "products"));
  assert.ok(conflictIssues.some((issue) => issue.entityType === "suppliers"));
});

test("migration dry-run: partial defects are skipped while valid records are imported", () => {
  const bundle = runLegacyDryRun({
    settings: { startMonth: "2025-01" },
    products: [
      { sku: "OK-1", alias: "OK" },
      { alias: "Missing SKU" },
      42,
    ],
    inventory: {
      snapshots: [
        {
          month: "01-2025",
          items: [
            { sku: "OK-1", units: "1.000,00" },
            { units: "10" },
          ],
        },
        "invalid snapshot",
      ],
      settings: {},
    },
    monthlyActuals: {
      "01-2025": {
        realRevenueEUR: "2.500,50",
      },
    },
  });

  assert.equal(bundle.report.canApply, true);

  const productsStats = bundle.report.sections.find((entry) => entry.section === "products");
  assert.ok(productsStats);
  assert.equal(productsStats.total, 3);
  assert.equal(productsStats.mapped, 1);
  assert.equal(productsStats.skipped, 2);
  assert.equal(productsStats.blocked, 1);

  const inventoryStats = bundle.report.sections.find((entry) => entry.section === "inventory");
  assert.ok(inventoryStats);
  assert.equal(inventoryStats.total, 2);
  assert.equal(inventoryStats.mapped, 1);
  assert.equal(inventoryStats.skipped, 2);
  assert.equal(inventoryStats.blocked, 1);

  const issueCodes = bundle.report.issues.map((entry) => entry.code);
  assert.ok(issueCodes.includes("ENTRY_NOT_OBJECT"));
  assert.ok(issueCodes.includes("MISSING_REQUIRED_FIELD"));
  assert.ok(issueCodes.includes("ID_GENERATED"));
  assert.ok(issueCodes.includes("MONTH_KEY_NORMALIZED"));

  assert.equal(bundle.mappedState.products.length, 1);
  assert.equal(bundle.mappedState.products[0].sku, "OK-1");
  assert.equal(bundle.mappedState.inventory.snapshots.length, 1);
  assert.equal(bundle.mappedState.inventory.snapshots[0].items.length, 1);
  assert.equal(bundle.mappedState.monthlyActuals["2025-01"].realRevenueEUR, 2500.5);
});

test("migration dry-run: invalid json is rejected gracefully", () => {
  const bundle = runLegacyDryRunFromJson("{invalid");
  assert.equal(bundle.report.canApply, false);
  assert.equal(bundle.report.targetVersion, "v2");
  assert.ok(bundle.report.issues.some((issue) => issue.code === "INVALID_JSON"));
});

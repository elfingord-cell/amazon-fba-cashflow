const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

const root = path.resolve(__dirname, "../..");

let server;
let addSupplierOutlookManualRow;
let buildSupplierOutlookDraft;
let buildSupplierOutlookExportModel;
let buildSupplierOutlookWorkbookModel;
let buildSupplierOutlookPrintHtml;
let collectSupplierOutlookSkuOptions;
let duplicateSupplierOutlookRecord;
let freezeSupplierOutlookRecord;
let markSupplierOutlookRecordExported;
let resetSupplierOutlookCell;
let resetSupplierOutlookRow;
let resolveSupplierFacingCellStatus;
let setSupplierOutlookRowExcluded;
let supplierOutlookHash;
let updateSupplierOutlookCell;
let updateSupplierOutlookRowMeta;
let upsertSupplierOutlookRecordInState;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return monthKeyFromDate(date);
}

function rangeMonths(startMonth, count) {
  return Array.from({ length: count }, (_, index) => addMonths(startMonth, index));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseSettings(overrides = {}) {
  return {
    safetyStockDohDefault: 60,
    foCoverageDohDefault: 90,
    fxRate: 1,
    vatRefundLagMonths: 0,
    paymentDueDefaults: {},
    ...overrides,
  };
}

function makeProduct(sku, input = {}) {
  const productionDays = input.productionLeadTimeDaysDefault ?? 12;
  const transitDays = input.transitDays ?? 14;
  return {
    id: input.id || `prod-${sku.toLowerCase()}`,
    sku,
    alias: input.alias || sku,
    status: "active",
    supplierId: input.supplierId ?? "sup-1",
    productionLeadTimeDaysDefault: productionDays,
    transitDays,
    avgSellingPriceGrossEUR: input.avgSellingPriceGrossEUR ?? 20,
    template: {
      fields: {
        unitPriceUsd: 1,
        freightEur: 0,
        transportMode: "SEA",
        transitDays,
        productionDays,
      },
    },
    ...(input.extra || {}),
  };
}

function buildOperationalState() {
  const now = monthKeyFromDate(new Date());
  const previousMonth = addMonths(now, -1);
  const poMonth = addMonths(now, 1);
  const foMonth = addMonths(now, 2);
  return {
    settings: baseSettings(),
    suppliers: [{ id: "sup-1", name: "Supplier One" }],
    products: [
      makeProduct("SKU-PO", { alias: "Alpha", supplierId: "sup-1" }),
      makeProduct("SKU-FO", { alias: "Beta", supplierId: "sup-1" }),
      makeProduct("SKU-LINK", { alias: "Gamma", supplierId: "" }),
    ],
    productSuppliers: [
      { sku: "SKU-LINK", supplierId: "sup-1", isPreferred: true },
    ],
    forecast: {
      versions: [{
        id: "fv-active",
        name: "Baseline März",
        createdAt: `${now}-01T00:00:00.000Z`,
        forecastImport: {},
        stats: { rowCount: 0, skuCount: 0, monthCount: 0 },
      }],
      activeVersionId: "fv-active",
      forecastManual: {},
    },
    inventory: {
      snapshots: [{
        month: previousMonth,
        items: [
          { sku: "SKU-PO", amazonUnits: 150, threePLUnits: 0 },
          { sku: "SKU-FO", amazonUnits: 90, threePLUnits: 0 },
          { sku: "SKU-LINK", amazonUnits: 40, threePLUnits: 0 },
        ],
      }],
      settings: {
        projectionMonths: 6,
        safetyDays: 30,
      },
    },
    pos: [{
      id: "po-1",
      supplierId: "sup-1",
      poNo: "PO-1001",
      orderDate: `${now}-05`,
      arrivalDate: `${poMonth}-15`,
      items: [{ sku: "SKU-PO", units: 120 }],
    }],
    fos: [{
      id: "fo-1",
      supplierId: "sup-1",
      foNumber: "FO-2001",
      status: "DRAFT",
      sku: "SKU-FO",
      units: 80,
      orderDate: `${now}-10`,
      targetDeliveryDate: `${foMonth}-20`,
    }],
    incomings: [],
    fixcosts: [],
    vatPreviewMonths: {},
    monthlyActuals: {},
  };
}

function buildPfoState() {
  const now = monthKeyFromDate(new Date());
  const previousMonth = addMonths(now, -1);
  const months = rangeMonths(now, 12);
  return {
    settings: baseSettings(),
    suppliers: [{ id: "sup-1", name: "Supplier One" }],
    products: [
      makeProduct("SKU-PFO", {
        alias: "Delta",
        supplierId: "sup-1",
        productionLeadTimeDaysDefault: 20,
        transitDays: 25,
      }),
    ],
    productSuppliers: [],
    forecast: {
      versions: [{
        id: "fv-active",
        name: "Baseline März",
        createdAt: `${now}-01T00:00:00.000Z`,
        forecastImport: {},
        stats: { rowCount: 0, skuCount: 0, monthCount: 0 },
      }],
      activeVersionId: "fv-active",
      forecastManual: {
        "SKU-PFO": Object.fromEntries(months.map((month, index) => [month, index < 6 ? 80 : 20])),
      },
    },
    inventory: {
      snapshots: [{
        month: previousMonth,
        items: [
          { sku: "SKU-PFO", amazonUnits: 220, threePLUnits: 0 },
        ],
      }],
      settings: {
        projectionMonths: 12,
        safetyDays: 30,
      },
    },
    pos: [],
    fos: [],
    incomings: [],
    fixcosts: [],
    vatPreviewMonths: {},
    monthlyActuals: {},
  };
}

function findRow(record, sku) {
  return record.rows.find((row) => String(row.sku || row.linkedSku || "") === sku) || null;
}

function findMaterialCell(row) {
  if (!row) return null;
  return Object.values(row.cells).find((cell) => Number(cell.systemQty || cell.finalQty || 0) > 0 || cell.sourceBreakdown.length > 0) || null;
}

test.before(async () => {
  server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    optimizeDeps: {
      noDiscovery: true,
      entries: [],
    },
  });

  ({
    addSupplierOutlookManualRow,
    buildSupplierOutlookDraft,
    buildSupplierOutlookExportModel,
    collectSupplierOutlookSkuOptions,
    duplicateSupplierOutlookRecord,
    freezeSupplierOutlookRecord,
    markSupplierOutlookRecordExported,
    resetSupplierOutlookCell,
    resetSupplierOutlookRow,
    resolveSupplierFacingCellStatus,
    setSupplierOutlookRowExcluded,
    supplierOutlookHash,
    updateSupplierOutlookCell,
    updateSupplierOutlookRowMeta,
    upsertSupplierOutlookRecordInState,
  } = await server.ssrLoadModule("/src/v2/domain/supplierOutlook.ts"));
  ({ buildSupplierOutlookWorkbookModel } = await server.ssrLoadModule("/src/domain/supplierOutlookWorkbook.js"));
  ({ buildSupplierOutlookPrintHtml } = await server.ssrLoadModule("/src/domain/supplierOutlookPrint.js"));
});

test.after(async () => {
  await server.close();
});

test("supplier outlook derives PO and FO proposal rows without mutating source state", () => {
  const state = buildOperationalState();
  const snapshot = clone(state);
  const now = monthKeyFromDate(new Date());
  const supplierSkuOptions = collectSupplierOutlookSkuOptions(state, "sup-1");

  assert.equal(
    supplierSkuOptions.some((entry) => entry.id === "SKU-LINK"),
    true,
    "Supplier SKU Optionen muessen auch productSuppliers-Verknuepfungen enthalten.",
  );

  const draft = buildSupplierOutlookDraft({
    state,
    supplierId: "sup-1",
    startMonth: now,
    horizonMonths: 6,
    includedSkuIds: ["SKU-PO", "SKU-FO", "SKU-ADHOC"],
    includedSourceTypes: ["po", "fo"],
    actor: { userId: "user-1", userLabel: "Alice" },
  });

  assert.deepEqual(state, snapshot, "Die Vorschlagserzeugung darf PO/FO/PFO-Quellen nicht mutieren.");
  assert.deepEqual(draft.includedSourceTypes, ["po", "fo"]);
  assert.equal(draft.forecastVersionId, "fv-active");
  assert.equal(draft.forecastVersionName, "Baseline März");
  assert.equal(draft.createdByUserId, "user-1");
  assert.equal(draft.updatedByLabel, "Alice");

  const poMonth = addMonths(now, 1);
  const foMonth = addMonths(now, 2);
  const poRow = findRow(draft, "SKU-PO");
  const foRow = findRow(draft, "SKU-FO");
  const adhocRow = findRow(draft, "SKU-ADHOC");

  assert.ok(poRow, "PO SKU muss als Matrixzeile angelegt werden.");
  assert.ok(foRow, "FO SKU muss als Matrixzeile angelegt werden.");
  assert.ok(adhocRow, "Explizit gewaehlte SKUs muessen auch ohne Stammdaten als Zeile erhalten bleiben.");
  assert.equal(poRow.cells[poMonth].systemQty, 120);
  assert.equal(poRow.cells[poMonth].finalQty, 120);
  assert.equal(poRow.cells[poMonth].sourceBreakdown[0].sourceType, "po");
  assert.equal(foRow.cells[foMonth].systemQty, 80);
  assert.equal(foRow.cells[foMonth].sourceBreakdown[0].sourceType, "fo");
  assert.equal(adhocRow.cells[now].systemQty, 0);
});

test("supplier outlook includes optional PFO input only when selected and marks it as indicative", () => {
  const state = buildPfoState();
  const now = monthKeyFromDate(new Date());

  const withoutPfo = buildSupplierOutlookDraft({
    state,
    supplierId: "sup-1",
    startMonth: now,
    horizonMonths: 12,
    includedSkuIds: ["SKU-PFO"],
    includedSourceTypes: ["po", "fo"],
    actor: { userId: "user-1", userLabel: "Alice" },
  });
  const withoutPfoRow = findRow(withoutPfo, "SKU-PFO");
  assert.ok(withoutPfoRow, "Die gewaehlte PFO-SKU muss auch ohne Quelle als Zeile bestehen bleiben.");
  assert.equal(
    Object.values(withoutPfoRow.cells).some((cell) => cell.sourceBreakdown.length > 0 || cell.systemQty > 0),
    false,
    "Ohne aktivierte PFO-Quelle duerfen keine indikativen Mengen erscheinen.",
  );

  const withPfo = buildSupplierOutlookDraft({
    state,
    supplierId: "sup-1",
    startMonth: now,
    horizonMonths: 12,
    includedSkuIds: ["SKU-PFO"],
    includedSourceTypes: ["pfo"],
    actor: { userId: "user-1", userLabel: "Alice" },
  });
  const withPfoRow = findRow(withPfo, "SKU-PFO");
  const pfoCell = findMaterialCell(withPfoRow);

  assert.ok(withPfoRow, "Die PFO-SKU muss im Entwurf vorhanden sein.");
  assert.ok(pfoCell, "Mit aktivierter PFO-Quelle wird mindestens eine indikative Menge erwartet.");
  assert.equal(
    pfoCell.sourceBreakdown.some((entry) => entry.sourceType === "pfo"),
    true,
    "Die indikative Menge muss auf die abgeleitete PFO-Quelle verweisen.",
  );
  assert.equal(resolveSupplierFacingCellStatus(withPfoRow, pfoCell), "indicative");

  const exportModel = buildSupplierOutlookExportModel({ record: withPfo, state });
  const previewRow = exportModel.supplierRows.find((row) => row.sku === "SKU-PFO");
  const previewCell = previewRow
    ? Object.values(previewRow.cells).find((cell) => Boolean(cell.text))
    : null;

  assert.ok(previewRow, "Die Lieferantenvorschau muss die indikative SKU anzeigen.");
  assert.ok(previewCell, "Die Lieferantenvorschau braucht eine sichtbare indikative Zelle.");
  assert.equal(previewCell.status, "indicative");
  assert.match(previewCell.text, /\bindicative\b/i);
});

test("supplier outlook supports manual overrides, manual rows, resets, and no-op updates stay stable", async () => {
  const state = buildOperationalState();
  const now = monthKeyFromDate(new Date());
  const draft = buildSupplierOutlookDraft({
    state,
    supplierId: "sup-1",
    startMonth: now,
    horizonMonths: 6,
    includedSkuIds: ["SKU-PO", "SKU-FO"],
    includedSourceTypes: ["po", "fo"],
    actor: { userId: "user-1", userLabel: "Alice" },
  });

  const poRow = findRow(draft, "SKU-PO");
  const poMonth = addMonths(now, 1);

  await sleep(5);
  const overridden = updateSupplierOutlookCell(draft, {
    rowId: poRow.id,
    month: poMonth,
    patch: {
      finalQty: 150,
      note: "Mit Lieferant abgestimmt",
      reason: "MOQ gerundet",
    },
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  const overriddenRow = findRow(overridden, "SKU-PO");
  const overriddenCell = overriddenRow.cells[poMonth];

  assert.equal(overriddenCell.finalQty, 150);
  assert.equal(overriddenCell.note, "Mit Lieferant abgestimmt");
  assert.equal(overriddenCell.reason, "MOQ gerundet");
  assert.equal(overridden.updatedByUserId, "user-2");
  assert.notEqual(overridden.updatedAt, draft.updatedAt);

  const noOp = updateSupplierOutlookCell(overridden, {
    rowId: poRow.id,
    month: poMonth,
    patch: {
      finalQty: 150,
      note: "Mit Lieferant abgestimmt",
      reason: "MOQ gerundet",
    },
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  assert.strictEqual(noOp, overridden, "No-op Updates duerfen keinen neuen Draft-Zustand erzwingen.");
  assert.equal(supplierOutlookHash(noOp), supplierOutlookHash(overridden));

  const rowExcluded = setSupplierOutlookRowExcluded(overridden, {
    rowId: poRow.id,
    excluded: true,
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  assert.equal(Object.values(findRow(rowExcluded, "SKU-PO").cells).every((cell) => cell.excluded === true), true);

  const rowReset = resetSupplierOutlookRow(rowExcluded, {
    rowId: poRow.id,
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  const resetCell = findRow(rowReset, "SKU-PO").cells[poMonth];
  assert.equal(resetCell.finalQty, resetCell.systemQty);
  assert.equal(resetCell.excluded, false);
  assert.equal(resetCell.note, "");
  assert.equal(resetCell.reason, "");

  const withManualRow = addSupplierOutlookManualRow(rowReset, {
    actor: { userId: "user-2", userLabel: "Bob" },
    label: "Zusatzmenge Lageraufbau",
    linkedSku: "SKU-PO",
  });
  const manualRow = withManualRow.rows.find((row) => row.rowType === "manual");
  assert.ok(manualRow, "Eine manuelle Zeile muss hinzugefuegt werden koennen.");

  const renamedManualRow = updateSupplierOutlookRowMeta(withManualRow, {
    rowId: manualRow.id,
    patch: {
      manualLabel: "Zusatzmenge Kampagne",
      linkedSku: "SKU-FO",
    },
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  const manualMonth = now;
  const withManualQty = updateSupplierOutlookCell(renamedManualRow, {
    rowId: manualRow.id,
    month: manualMonth,
    patch: {
      finalQty: 40,
      reason: "Marketingpeak",
    },
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  const manualQtyCell = withManualQty.rows.find((row) => row.rowType === "manual").cells[manualMonth];
  assert.equal(manualQtyCell.finalQty, 40);

  const resetManualCell = resetSupplierOutlookCell(withManualQty, {
    rowId: manualRow.id,
    month: manualMonth,
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  assert.equal(resetManualCell.rows.find((row) => row.rowType === "manual").cells[manualMonth].finalQty, 0);

  const previewDraft = updateSupplierOutlookCell(renamedManualRow, {
    rowId: manualRow.id,
    month: manualMonth,
    patch: {
      finalQty: 40,
      reason: "Marketingpeak",
    },
    actor: { userId: "user-2", userLabel: "Bob" },
  });
  const previewModel = buildSupplierOutlookExportModel({ record: previewDraft, state });
  const previewManualRow = previewModel.supplierRows.find((row) => row.rowType === "manual");
  assert.ok(previewManualRow, "Die Lieferantenvorschau muss ungespeicherte manuelle Zeilen sofort widerspiegeln.");
  assert.equal(previewManualRow.cells[manualMonth].text, "40 · indicative");

  const persistedState = upsertSupplierOutlookRecordInState(state, previewDraft);
  assert.equal(Array.isArray(persistedState.supplierOutlooks), true);
  assert.equal(persistedState.supplierOutlooks[0].id, previewDraft.id);
  assert.equal(persistedState.supplierOutlooks[0].updatedByUserId, "user-2");
  assert.deepEqual(persistedState.pos, state.pos, "Manuelle Draft-Edits duerfen keine PO-Daten zurueckschreiben.");
  assert.deepEqual(persistedState.fos, state.fos, "Manuelle Draft-Edits duerfen keine FO-Daten zurueckschreiben.");
  assert.deepEqual(persistedState.forecast, state.forecast, "Manuelle Draft-Edits duerfen Forecast-Daten nicht veraendern.");
  assert.equal(Object.prototype.hasOwnProperty.call(persistedState, "pfos"), false, "Es darf weiterhin kein state.pfos geben.");
});

test("supplier outlook freeze keeps snapshots stable and export stays supplier-safe", () => {
  const state = buildOperationalState();
  const now = monthKeyFromDate(new Date());
  const draft = buildSupplierOutlookDraft({
    state,
    supplierId: "sup-1",
    startMonth: now,
    horizonMonths: 6,
    includedSkuIds: ["SKU-PO", "SKU-FO"],
    includedSourceTypes: ["po", "fo"],
    actor: { userId: "user-1", userLabel: "Alice" },
  });
  const frozen = freezeSupplierOutlookRecord(draft, { userId: "user-3", userLabel: "Cara" });
  assert.equal(frozen.status, "frozen");
  assert.equal(Boolean(frozen.frozenAt), true);
  assert.equal(frozen.frozenByUserId, "user-3");

  const blockedEdit = updateSupplierOutlookCell(frozen, {
    rowId: findRow(frozen, "SKU-PO").id,
    month: addMonths(now, 1),
    patch: { finalQty: 999 },
    actor: { userId: "user-4", userLabel: "Dana" },
  });
  assert.strictEqual(blockedEdit, frozen, "Frozen Drafts duerfen nicht weiter bearbeitet werden.");

  const changedState = clone(state);
  changedState.pos[0].items[0].units = 999;
  const frozenExportModel = buildSupplierOutlookExportModel({ record: frozen, state: changedState });
  const frozenSupplierRow = frozenExportModel.supplierRows.find((row) => row.sku === "SKU-PO");
  assert.equal(frozenSupplierRow.cells[addMonths(now, 1)].text, "120 · confirmed");
  assert.equal(
    frozenExportModel.traceRows.some((row) => row.sourceSummary.includes("PO: 120")),
    true,
    "Der interne Trace muss die eingefrorene Herleitung weiter zeigen.",
  );

  const exported = markSupplierOutlookRecordExported(frozen, {
    format: "xlsx",
    actor: { userId: "user-6", userLabel: "Faye" },
  });
  assert.equal(exported.status, "frozen");
  assert.equal(exported.lastExportFormat, "xlsx");
  assert.equal(exported.lastExportedByUserId, "user-6");
  assert.equal(Boolean(exported.lastExportedAt), true);

  const duplicate = duplicateSupplierOutlookRecord(exported, { userId: "user-5", userLabel: "Eve" });
  assert.notEqual(duplicate.id, exported.id);
  assert.equal(duplicate.status, "draft");
  assert.equal(duplicate.frozenAt, null);
  assert.equal(duplicate.lastExportedAt, null);
  assert.equal(duplicate.lastExportFormat, null);

  const exportedModel = buildSupplierOutlookExportModel({ record: exported, state: changedState });
  assert.equal(exportedModel.lastExportFormat, "xlsx");
  assert.equal(Boolean(exportedModel.lastExportedAt), true);
  assert.equal(
    exportedModel.supplierRows.every((row) => Object.prototype.hasOwnProperty.call(row, "id") === false),
    true,
    "Das supplier-facing Modell darf keine internen Zeilen-IDs tragen.",
  );

  const workbookModel = buildSupplierOutlookWorkbookModel(exportedModel);
  assert.deepEqual(
    workbookModel.sheets.map((sheet) => sheet.name),
    ["Lieferant", "Intern Trace"],
    "Der XLSX Export braucht genau ein Lieferantenblatt und ein internes Trace-Blatt.",
  );

  const printHtml = buildSupplierOutlookPrintHtml(exportedModel);
  assert.match(printHtml, /confirmed|planned|indicative/i);
  assert.doesNotMatch(printHtml, /\bPFO\b|\bPO\b|\bFO\b|Phantom/i, "Die Lieferantensicht darf keine interne Taxonomie leaken.");
  assert.doesNotMatch(printHtml, /\bpo-1\b|\bfo-1\b|supplier-outlook/i, "Die Lieferantensicht darf keine internen IDs leaken.");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  buildPaymentJournalRowsFromState: buildV2PaymentJournalRowsFromState,
} = require("../../.test-build/migration/v2/domain/paymentJournal.js");

let legacyPaymentsExportPromise = null;

function loadLegacyPaymentsExport() {
  if (!legacyPaymentsExportPromise) {
    const modulePath = path.resolve(__dirname, "../../src/ui/paymentsExport.js");
    const moduleUrl = pathToFileURL(modulePath).href;
    legacyPaymentsExportPromise = import(moduleUrl);
  }
  return legacyPaymentsExportPromise;
}

function round2(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function sumRows(rows, key) {
  return round2(rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0)) || 0;
}

function normalizeRow(row) {
  return {
    rowId: String(row.rowId || ""),
    entityType: String(row.entityType || ""),
    paymentType: String(row.paymentType || ""),
    status: String(row.status || ""),
    month: String(row.month || ""),
    dueDate: String(row.dueDate || ""),
    paidDate: String(row.paidDate || ""),
    paymentId: String(row.paymentId || ""),
    amountPlannedEur: round2(row.amountPlannedEur),
    amountActualEur: round2(row.amountActualEur),
    issues: (Array.isArray(row.issues) ? row.issues : []).slice().sort(),
  };
}

function normalizeRows(rows) {
  return rows
    .map(normalizeRow)
    .sort((a, b) => a.rowId.localeCompare(b.rowId));
}

function summarizeRows(rows) {
  const paidRows = rows.filter((row) => row.status === "PAID");
  const openRows = rows.filter((row) => row.status === "OPEN");
  const poPaidRows = paidRows.filter((row) => row.entityType === "PO");
  const poOpenRows = openRows.filter((row) => row.entityType === "PO");
  const foOpenRows = openRows.filter((row) => row.entityType === "FO");

  const byType = {};
  rows.forEach((row) => {
    const key = `${row.entityType}:${row.paymentType}:${row.status}`;
    byType[key] = round2((byType[key] || 0) + Number(row.amountActualEur || row.amountPlannedEur || 0)) || 0;
  });

  return {
    rowCount: rows.length,
    paidCount: paidRows.length,
    openCount: openRows.length,
    paidActualTotal: sumRows(paidRows, "amountActualEur"),
    openPlannedTotal: sumRows(openRows, "amountPlannedEur"),
    poPaidActualTotal: sumRows(poPaidRows, "amountActualEur"),
    poOpenPlannedTotal: sumRows(poOpenRows, "amountPlannedEur"),
    foOpenPlannedTotal: sumRows(foOpenRows, "amountPlannedEur"),
    byType,
  };
}

function createParityState() {
  return {
    settings: {
      fxRate: 1.0,
      fxFeePct: 0,
      eurUsdRate: 1.0,
      dutyRatePct: 0,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cny: { start: "", end: "" },
      cnyBlackoutByYear: {},
    },
    suppliers: [
      { id: "sup-a", name: "Supplier A" },
      { id: "sup-b", name: "Supplier B" },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha" },
      { sku: "SKU-B", alias: "Beta" },
      { sku: "SKU-C", alias: "Gamma" },
    ],
    payments: [
      {
        id: "pay-po1-dep",
        paidDate: "2025-01-06",
        method: "bank",
        payer: "ops",
        amountActualEurTotal: 120,
        allocations: [
          { eventId: "po1-ms-dep", amountEur: 120 },
        ],
      },
    ],
    pos: [
      {
        id: "po-1",
        poNo: "PO-1001",
        supplierId: "sup-a",
        sku: "SKU-A",
        orderDate: "2025-01-05",
        prodDays: 20,
        transitDays: 15,
        items: [
          {
            id: "po1-item-1",
            sku: "SKU-A",
            units: "100",
            unitCostUsd: "4,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        freightEur: "0,00",
        milestones: [
          { id: "po1-ms-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po1-ms-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po1-ms-dep": { status: "paid", paymentId: "pay-po1-dep" },
        },
        autoEvents: [
          { id: "po1-auto-freight", type: "freight", enabled: false },
          { id: "po1-auto-duty", type: "duty", enabled: false },
          { id: "po1-auto-eust", type: "eust", enabled: false },
          { id: "po1-auto-vat", type: "vat_refund", enabled: false },
          { id: "po1-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-2",
        poNo: "PO-1002",
        supplierId: "sup-b",
        sku: "SKU-B",
        orderDate: "2025-02-10",
        prodDays: 18,
        transitDays: 12,
        items: [
          {
            id: "po2-item-1",
            sku: "SKU-B",
            units: "50",
            unitCostUsd: "4,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
          {
            id: "po2-item-2",
            sku: "SKU-C",
            units: "30",
            unitCostUsd: "6,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        freightEur: "0,00",
        milestones: [
          { id: "po2-ms-dep", label: "Deposit", percent: 50, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po2-ms-bal", label: "Balance", percent: 50, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {},
        autoEvents: [
          { id: "po2-auto-freight", type: "freight", enabled: false },
          { id: "po2-auto-duty", type: "duty", enabled: false },
          { id: "po2-auto-eust", type: "eust", enabled: false },
          { id: "po2-auto-vat", type: "vat_refund", enabled: false },
          { id: "po2-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
    ],
    fos: [
      {
        id: "fo-1",
        foNumber: "FO-2001",
        supplierId: "sup-a",
        sku: "SKU-A",
        status: "ACTIVE",
        fxRate: 1.2,
        payments: [
          { id: "fo1-pay-dep", label: "Deposit", category: "supplier", amount: 240, currency: "USD", dueDate: "2025-03-18" },
          { id: "fo1-pay-freight", label: "Fracht", category: "freight", amount: 60, currency: "EUR", dueDate: "2025-03-25" },
          { id: "fo1-pay-refund", label: "EUSt Refund", category: "eust_refund", amount: 40, currency: "EUR", dueDate: "2025-03-28" },
        ],
      },
      {
        id: "fo-2",
        foNumber: "FO-2002",
        supplierId: "sup-b",
        sku: "SKU-B",
        status: "CONVERTED",
        fxRate: 1.0,
        payments: [
          { id: "fo2-pay-dep", label: "Deposit", category: "supplier", amount: 120, currency: "EUR", dueDate: "2025-04-10" },
        ],
      },
      {
        id: "fo-3",
        foNumber: "FO-2003",
        supplierId: "sup-a",
        sku: "SKU-C",
        status: "PLANNED",
        fxRate: 1.0,
        payments: [
          { id: "fo3-pay-dep", label: "Deposit", category: "supplier", amount: 80, currency: "EUR", dueDate: "2025-04-05" },
        ],
      },
    ],
  };
}

async function buildLegacyRows(state, filters) {
  const legacy = await loadLegacyPaymentsExport();
  return legacy.buildPaymentJournalRowsFromState(
    state,
    filters,
    { settings: state.settings, products: state.products },
  );
}

test("po payment parity remains aligned with legacy snapshots", async () => {
  const state = createParityState();
  const filters = [
    { scope: "both" },
    { scope: "paid" },
    { scope: "open" },
    { scope: "both", month: "2025-01" },
    { scope: "both", month: "2025-03" },
  ];

  for (const filter of filters) {
    const [legacyRows, v2Rows] = await Promise.all([
      buildLegacyRows(state, filter),
      Promise.resolve(buildV2PaymentJournalRowsFromState(state, filter)),
    ]);
    const legacyPoRows = legacyRows.filter((row) => String(row.entityType || "") === "PO");
    const v2PoRows = v2Rows.filter((row) => String(row.entityType || "") === "PO");

    assert.deepEqual(
      normalizeRows(v2PoRows),
      normalizeRows(legacyPoRows),
      `PO row mismatch for filter ${JSON.stringify(filter)}`,
    );
  }
});

test("fo payment journal is planning-only (open) and excludes converted/archived", async () => {
  const state = createParityState();
  const rowsBoth = buildV2PaymentJournalRowsFromState(state, { scope: "both" });
  const foRows = rowsBoth.filter((row) => row.entityType === "FO");
  assert.ok(foRows.length > 0, "expected FO plan rows");
  assert.ok(foRows.every((row) => row.status === "OPEN"), "FO rows must stay OPEN");
  assert.ok(foRows.every((row) => !row.paymentId), "FO rows must not expose payment IDs");
  assert.ok(foRows.every((row) => row.amountActualEur == null), "FO rows must not have actual EUR amounts");

  const paidRows = buildV2PaymentJournalRowsFromState(state, { scope: "paid" });
  assert.equal(paidRows.filter((row) => row.entityType === "FO").length, 0, "FO rows must not appear in paid scope");

  const aprilRows = buildV2PaymentJournalRowsFromState(state, { scope: "both", month: "2025-04" });
  const aprilFoIds = aprilRows.filter((row) => row.entityType === "FO").map((row) => row.internalId);
  assert.deepEqual(aprilFoIds, ["fo-3"], "legacy PLANNED should be treated as active; converted FO must be excluded");
});

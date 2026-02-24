const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPaymentJournalCsvRows,
  buildPaymentJournalRowsFromState,
  openPaymentJournalPrintView,
  paymentJournalRowsToCsv,
  sumPaymentRows,
} = require("../../.test-build/migration/v2/domain/paymentJournal.js");

function parseDeCsvNumber(value) {
  if (value == null || value === "") return null;
  const cleaned = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function createPaymentJournalState() {
  return {
    settings: {
      fxRate: 1,
      fxFeePct: 0,
      eurUsdRate: 1,
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
      { id: "sup-1", name: "Supplier One" },
    ],
    products: [
      { sku: "SKU-1", alias: "Alpha" },
    ],
    payments: [
      {
        id: "pay-1",
        paidDate: "2025-01-08",
        method: "Bank",
        payer: "Ops",
        amountActualEurTotal: 31,
        allocations: [
          { eventId: "ms-deposit", amountEur: 31 },
        ],
      },
    ],
    pos: [
      {
        id: "po-1",
        poNo: "PO-1",
        orderDate: "2025-01-05",
        prodDays: 30,
        transitDays: 0,
        supplierId: "sup-1",
        sku: "SKU-1",
        items: [
          {
            id: "item-1",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "1,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        goodsEur: "100,00",
        freightEur: "0,00",
        milestones: [
          { id: "ms-deposit", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "ms-balance", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "ms-deposit": { status: "paid", paymentId: "pay-1" },
        },
        autoEvents: [
          { id: "auto-freight", type: "freight", label: "Fracht", anchor: "ETA", lagDays: 0, enabled: true },
          { id: "auto-duty", type: "duty", label: "Zoll", anchor: "ETA", lagDays: 0, enabled: true },
          { id: "auto-eust", type: "eust", label: "EUSt", anchor: "ETA", lagDays: 0, enabled: true },
          { id: "auto-vat", type: "vat_refund", label: "EUSt-Erstattung", anchor: "ETA", lagMonths: 0, enabled: false },
          { id: "auto-fx", type: "fx_fee", label: "FX-Gebuehr", anchor: "ORDER_DATE", lagDays: 0, enabled: false },
        ],
      },
    ],
    fos: [
      {
        id: "fo-1",
        foNumber: "FO-1",
        supplierId: "sup-1",
        sku: "SKU-1",
        fxRate: 1.1,
        payments: [
          { id: "fo-pay-1", label: "Deposit", category: "supplier", amount: 110, currency: "USD", dueDate: "2025-03-15" },
          { id: "fo-pay-2", label: "EUSt Refund", category: "eust_refund", amount: 50, currency: "EUR", dueDate: "2025-03-20" },
        ],
      },
    ],
  };
}

function createFallbackState() {
  return {
    settings: {
      fxRate: 1,
      fxFeePct: 0,
      eurUsdRate: 1,
      dutyRatePct: 0,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cny: { start: "", end: "" },
      cnyBlackoutByYear: {},
    },
    suppliers: [{ id: "sup-1", name: "Supplier One" }],
    products: [{ sku: "SKU-1", alias: "Alpha" }],
    payments: [],
    pos: [
      {
        id: "po-fallback",
        poNo: "PO-FALLBACK",
        orderDate: "2025-01-10",
        prodDays: 30,
        transitDays: 0,
        supplierId: "sup-1",
        sku: "SKU-1",
        items: [
          {
            id: "item-1",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "1,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        goodsEur: "100,00",
        freightEur: "0,00",
        milestones: [
          { id: "ms-deposit", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "ms-balance", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "ms-deposit": { status: true },
        },
        autoEvents: [
          { id: "auto-freight", type: "freight", label: "Fracht", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-duty", type: "duty", label: "Zoll", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-eust", type: "eust", label: "EUSt", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-vat", type: "vat_refund", label: "EUSt-Erstattung", anchor: "ETA", lagMonths: 0, enabled: false },
          { id: "auto-fx", type: "fx_fee", label: "FX-Gebuehr", anchor: "ORDER_DATE", lagDays: 0, enabled: false },
        ],
      },
    ],
    fos: [],
  };
}

function createGroupedPaymentState() {
  return {
    settings: {
      fxRate: 1,
      fxFeePct: 0,
      eurUsdRate: 1,
      dutyRatePct: 0,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cny: { start: "", end: "" },
      cnyBlackoutByYear: {},
    },
    suppliers: [{ id: "sup-1", name: "Supplier One" }],
    products: [{ sku: "SKU-1", alias: "Alpha" }],
    payments: [
      {
        id: "pay-bundle",
        paidDate: "2025-01-31",
        method: "Wise",
        payer: "Pierre",
        amountActualEurTotal: 100,
        allocations: [
          { eventId: "ms-deposit", amountEur: 30 },
          { eventId: "ms-balance", amountEur: 70 },
        ],
      },
    ],
    pos: [
      {
        id: "po-grouped",
        poNo: "PO-GROUPED",
        orderDate: "2025-01-05",
        prodDays: 10,
        transitDays: 0,
        supplierId: "sup-1",
        sku: "SKU-1",
        items: [
          {
            id: "item-1",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "1,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        goodsEur: "100,00",
        freightEur: "0,00",
        milestones: [
          { id: "ms-deposit", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "ms-balance", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "ms-deposit": { status: "paid", paymentId: "pay-bundle" },
          "ms-balance": { status: "paid", paymentId: "pay-bundle" },
        },
        autoEvents: [
          { id: "auto-freight", type: "freight", label: "Fracht", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-duty", type: "duty", label: "Zoll", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-eust", type: "eust", label: "EUSt", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-vat", type: "vat_refund", label: "EUSt-Erstattung", anchor: "ETA", lagMonths: 0, enabled: false },
          { id: "auto-fx", type: "fx_fee", label: "FX-Gebuehr", anchor: "ORDER_DATE", lagDays: 0, enabled: false },
        ],
      },
    ],
    fos: [],
  };
}

function createDutyState() {
  return {
    settings: {
      fxRate: 1,
      fxFeePct: 0,
      eurUsdRate: 1,
      dutyRatePct: 6.5,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cny: { start: "", end: "" },
      cnyBlackoutByYear: {},
    },
    suppliers: [{ id: "sup-1", name: "Supplier One" }],
    products: [{ sku: "SKU-1", alias: "Alpha" }],
    payments: [
      {
        id: "pay-duty",
        paidDate: "2025-02-12",
        method: "Bank",
        payer: "Ops",
        amountActualEurTotal: 6.5,
        allocations: [{ eventId: "auto-duty", amountEur: 6.5 }],
      },
    ],
    pos: [
      {
        id: "po-duty",
        poNo: "PO-DUTY",
        orderDate: "2025-01-10",
        prodDays: 10,
        transitDays: 10,
        supplierId: "sup-1",
        sku: "SKU-1",
        items: [
          {
            id: "item-1",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "1,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
        goodsEur: "100,00",
        freightEur: "0,00",
        milestones: [
          { id: "ms-deposit", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "auto-duty": { status: "paid", paymentId: "pay-duty" },
        },
        autoEvents: [
          { id: "auto-freight", type: "freight", label: "Fracht", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-duty", type: "duty", label: "Zoll", anchor: "ETA", lagDays: 0, enabled: true },
          { id: "auto-eust", type: "eust", label: "EUSt", anchor: "ETA", lagDays: 0, enabled: false },
          { id: "auto-vat", type: "vat_refund", label: "EUSt-Erstattung", anchor: "ETA", lagMonths: 0, enabled: false },
          { id: "auto-fx", type: "fx_fee", label: "FX-Gebuehr", anchor: "ORDER_DATE", lagDays: 0, enabled: false },
        ],
      },
    ],
    fos: [],
  };
}

test("payments export parity: status split and totals are consistent", () => {
  const rows = buildPaymentJournalRowsFromState(createPaymentJournalState(), { scope: "both" });
  assert.equal(rows.length, 3);

  const paidRows = rows.filter((row) => row.status === "PAID");
  const openRows = rows.filter((row) => row.status === "OPEN");
  assert.equal(paidRows.length, 1);
  assert.equal(openRows.length, 2);

  const paidTotal = sumPaymentRows(paidRows, "amountActualEur");
  const openTotal = sumPaymentRows(openRows, "amountPlannedEur");
  assert.equal(paidTotal, 31);
  assert.equal(openTotal, 170);

  assert.ok(rows.some((row) => row.entityType === "PO" && row.paymentType === "Deposit" && row.status === "PAID"));
  assert.ok(rows.some((row) => row.entityType === "PO" && row.paymentType === "Balance" && row.status === "OPEN"));
  assert.ok(rows.some((row) => row.entityType === "FO" && row.status === "OPEN"));
});

test("payments export parity: CSV rows keep status/amount semantics", () => {
  const rows = buildPaymentJournalRowsFromState(createPaymentJournalState(), { scope: "both" });
  const csvRows = buildPaymentJournalCsvRows(rows);
  assert.equal(csvRows.length, 3);

  const paidCsvRows = csvRows.filter((row) => row.status === "PAID");
  const openCsvRows = csvRows.filter((row) => row.status === "OPEN");
  assert.equal(paidCsvRows.length, 1);
  assert.equal(openCsvRows.length, 2);

  assert.equal(paidCsvRows[0].amountActualEur, "31,00");
  openCsvRows.forEach((row) => assert.equal(row.amountActualEur, ""));

  const csv = paymentJournalRowsToCsv(csvRows, ";");
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines[0].includes("\"status\""));
  assert.ok(lines[0].includes("\"amountActualEur\""));

  const paidActualFromCsv = paidCsvRows.reduce(
    (sum, row) => sum + (parseDeCsvNumber(row.amountActualEur) || 0),
    0,
  );
  const openPlannedFromCsv = openCsvRows.reduce(
    (sum, row) => sum + (parseDeCsvNumber(row.amountPlannedEur) || 0),
    0,
  );
  assert.equal(paidActualFromCsv, 31);
  assert.equal(openPlannedFromCsv, 170);
});

test("payments export parity: print/PDF view renders matching sums and statuses", () => {
  const rows = buildPaymentJournalRowsFromState(createPaymentJournalState(), { scope: "both" });
  let writtenHtml = "";

  global.window = {
    open() {
      return {
        document: {
          open() {},
          write(html) {
            writtenHtml = String(html || "");
          },
          close() {},
        },
      };
    },
  };

  try {
    openPaymentJournalPrintView(rows, { scope: "both" });
  } finally {
    delete global.window;
  }

  assert.ok(writtenHtml.includes("Scope: Both"));
  assert.ok(writtenHtml.includes("Rows: 3"));
  assert.ok(writtenHtml.includes("PAID"));
  assert.ok(writtenHtml.includes("OPEN"));
  assert.ok(writtenHtml.includes("Sum Actual EUR (PAID): 31,00"));
  assert.ok(writtenHtml.includes("Sum Planned EUR (OPEN): 170,00"));
});

test("payments export: paid without paidDate falls back to dueDate and is flagged", () => {
  const rows = buildPaymentJournalRowsFromState(createFallbackState(), { month: "2025-01", scope: "paid" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.entityType, "PO");
  assert.equal(row.paymentType, "Deposit");
  assert.equal(row.month, "2025-01");
  assert.equal(row.paidDate, "2025-01-10");
  assert.equal(row.amountActualEur, 30);
  assert.ok(row.issues.includes("DATE_UNCERTAIN"));
  assert.ok(row.issues.includes("AUTO_GENERATED"));
  assert.ok(row.issues.includes("IST_FEHLT"));
});

test("payments export: grouped payment is exported as one row with combined positions", () => {
  const rows = buildPaymentJournalRowsFromState(createGroupedPaymentState(), { month: "2025-01", scope: "paid" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.paymentId, "pay-bundle");
  assert.ok(String(row.paymentType || "").includes("Deposit"));
  assert.ok(String(row.paymentType || "").includes("Balance"));
  assert.equal(row.amountPlannedEur, 100);
  assert.equal(row.amountActualEur, 100);
  assert.ok(row.issues.includes("GROUPED_PAYMENT"));
});

test("payments export: duty event is mapped to Zoll and appears in paid month", () => {
  const rows = buildPaymentJournalRowsFromState(createDutyState(), { month: "2025-02", scope: "paid" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.paymentType, "Zoll");
  assert.equal(row.amountActualEur, 6.5);
  assert.equal(row.paidDate, "2025-02-12");
});

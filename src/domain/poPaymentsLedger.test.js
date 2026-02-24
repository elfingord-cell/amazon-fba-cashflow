import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPoPaymentsLedgerExport,
  buildPoPaymentsLedgerRows,
  poPaymentsLedgerRowsToCsv,
} from "./poPaymentsLedger.js";

function baseSettings() {
  return {
    fxRate: 1,
    fxFeePct: 0,
    eurUsdRate: 1,
    dutyRatePct: 0,
    dutyIncludeFreight: false,
    eustRatePct: 19,
    vatRefundEnabled: false,
    vatRefundLagMonths: 0,
    freightLagDays: 0,
    cny: { start: "", end: "" },
    cnyBlackoutByYear: {},
  };
}

function createLedgerState() {
  return {
    settings: baseSettings(),
    suppliers: [
      { id: "sup-a", name: "Supplier A" },
      { id: "sup-b", name: "Supplier B" },
      { id: "sup-c", name: "Supplier C" },
      { id: "sup-d", name: "Supplier D" },
      { id: "sup-e", name: "Supplier E" },
      { id: "sup-f", name: "Supplier F" },
    ],
    payments: [
      {
        id: "pay-a-dep",
        paidDate: "2026-01-05",
        method: "Wise Transfer",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 300,
        amountActualUsdTotal: 330,
        invoiceIdOrNumber: "INV-A-DEP",
        transferReference: "W-123",
      },
      {
        id: "pay-a-bal",
        paidDate: "2026-01-20",
        method: "Alibaba Trade Assurance",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 700,
      },
      {
        id: "pay-b-eust",
        paidDate: "2026-01-11",
        method: "PayPal",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 55,
      },
      {
        id: "pay-c-undated",
        paidDate: "",
        method: "Wise Transfer",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 90,
      },
      {
        id: "pay-c-zero",
        paidDate: "2026-01-15",
        method: "Wise Transfer",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 0,
      },
      {
        id: "pay-d-sepa",
        paidDate: "2026-01-12",
        method: "SEPA Bank Transfer",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 120,
      },
      {
        id: "pay-e-other",
        paidDate: "2026-01-13",
        method: "Cash Counter",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 130,
      },
      {
        id: "pay-f-bundle",
        paidDate: "2026-01-18",
        method: "Wise Transfer",
        payer: "Ops",
        currency: "EUR",
        amountActualEurTotal: 1000,
      },
    ],
    pos: [
      {
        id: "po-a",
        poNo: "25001",
        supplierId: "sup-a",
        orderDate: "2026-01-01",
        prodDays: 10,
        transitDays: 10,
        items: [
          {
            id: "po-a-item-1",
            sku: "SKU-A",
            units: "100",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-a-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po-a-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po-a-dep": {
            status: "paid",
            paymentId: "pay-a-dep",
            amountActualEur: 300,
            amountActualUsd: 330,
          },
          "po-a-bal": {
            status: "paid",
            paymentId: "pay-a-bal",
            amountActualEur: 700,
          },
        },
        autoEvents: [
          { id: "po-a-auto-freight", type: "freight", enabled: false },
          { id: "po-a-auto-duty", type: "duty", enabled: false },
          { id: "po-a-auto-eust", type: "eust", enabled: false },
          { id: "po-a-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-a-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-b",
        poNo: "25002",
        supplierId: "sup-b",
        orderDate: "2026-01-03",
        prodDays: 10,
        transitDays: 10,
        etaManual: "2026-01-10",
        items: [
          {
            id: "po-b-item-1",
            sku: "SKU-B",
            units: "50",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-b-dep", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "po-b-auto-eust": {
            status: "paid",
            paymentId: "pay-b-eust",
            amountActualEur: 55,
          },
        },
        autoEvents: [
          { id: "po-b-auto-freight", type: "freight", enabled: false },
          { id: "po-b-auto-duty", type: "duty", enabled: false },
          { id: "po-b-auto-eust", type: "eust", enabled: true, anchor: "ETA", lagDays: 0, label: "EUSt" },
          { id: "po-b-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-b-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-c",
        poNo: "25003",
        supplierId: "sup-c",
        orderDate: "2026-01-05",
        prodDays: 10,
        transitDays: 10,
        items: [
          {
            id: "po-c-item-1",
            sku: "SKU-C",
            units: "10",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-c-dep", label: "Deposit", percent: 45, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po-c-bal", label: "Balance", percent: 45, anchor: "PROD_DONE", lagDays: 0 },
          { id: "po-c-fee", label: "Service Fee", percent: 10, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po-c-dep": { status: "open" },
          "po-c-bal": { status: "paid", paymentId: "pay-c-undated", amountActualEur: 90 },
          "po-c-fee": { status: "paid", paymentId: "pay-c-zero", amountActualEur: 0 },
        },
        autoEvents: [
          { id: "po-c-auto-freight", type: "freight", enabled: false },
          { id: "po-c-auto-duty", type: "duty", enabled: false },
          { id: "po-c-auto-eust", type: "eust", enabled: false },
          { id: "po-c-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-c-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-d",
        poNo: "25004",
        supplierId: "sup-d",
        orderDate: "2026-01-04",
        prodDays: 10,
        transitDays: 10,
        items: [
          {
            id: "po-d-item-1",
            sku: "SKU-D",
            units: "20",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-d-dep", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "po-d-dep": { status: "paid", paymentId: "pay-d-sepa", amountActualEur: 120 },
        },
        autoEvents: [
          { id: "po-d-auto-freight", type: "freight", enabled: false },
          { id: "po-d-auto-duty", type: "duty", enabled: false },
          { id: "po-d-auto-eust", type: "eust", enabled: false },
          { id: "po-d-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-d-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-e",
        poNo: "25005",
        supplierId: "sup-e",
        orderDate: "2026-01-04",
        prodDays: 10,
        transitDays: 10,
        items: [
          {
            id: "po-e-item-1",
            sku: "SKU-E",
            units: "20",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-e-dep", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "po-e-dep": { status: "paid", paymentId: "pay-e-other", amountActualEur: 130 },
        },
        autoEvents: [
          { id: "po-e-auto-freight", type: "freight", enabled: false },
          { id: "po-e-auto-duty", type: "duty", enabled: false },
          { id: "po-e-auto-eust", type: "eust", enabled: false },
          { id: "po-e-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-e-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-f",
        poNo: "25006",
        supplierId: "sup-f",
        orderDate: "2026-01-02",
        prodDays: 10,
        transitDays: 10,
        items: [
          {
            id: "po-f-item-1",
            sku: "SKU-F",
            units: "100",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-f-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po-f-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po-f-dep": { status: "paid", paymentId: "pay-f-bundle" },
          "po-f-bal": { status: "paid", paymentId: "pay-f-bundle" },
        },
        autoEvents: [
          { id: "po-f-auto-freight", type: "freight", enabled: false },
          { id: "po-f-auto-duty", type: "duty", enabled: false },
          { id: "po-f-auto-eust", type: "eust", enabled: false },
          { id: "po-f-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-f-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
    ],
    fos: [],
  };
}

function createPerformanceState(poCount = 750) {
  return {
    settings: baseSettings(),
    suppliers: [{ id: "sup-perf", name: "Supplier Perf" }],
    payments: Array.from({ length: poCount }, (_, index) => ({
      id: `pay-perf-${index}`,
      paidDate: "2026-01-15",
      method: "Wise Transfer",
      payer: "Perf",
      currency: "EUR",
      amountActualEurTotal: 100 + index,
    })),
    pos: Array.from({ length: poCount }, (_, index) => ({
      id: `po-perf-${index}`,
      poNo: String(30000 + index),
      supplierId: "sup-perf",
      orderDate: "2026-01-01",
      prodDays: 10,
      transitDays: 10,
      items: [
        {
          id: `po-perf-item-${index}`,
          sku: `SKU-P-${index}`,
          units: "10",
          unitCostUsd: "10,00",
          unitExtraUsd: "0,00",
          extraFlatUsd: "0,00",
        },
      ],
      milestones: [
        { id: `po-perf-dep-${index}`, label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
      ],
      paymentLog: {
        [`po-perf-dep-${index}`]: { status: "paid", paymentId: `pay-perf-${index}`, amountActualEur: 100 + index },
      },
      autoEvents: [
        { id: `po-perf-auto-freight-${index}`, type: "freight", enabled: false },
        { id: `po-perf-auto-duty-${index}`, type: "duty", enabled: false },
        { id: `po-perf-auto-eust-${index}`, type: "eust", enabled: false },
        { id: `po-perf-auto-vat-${index}`, type: "vat_refund", enabled: false },
        { id: `po-perf-auto-fx-${index}`, type: "fx_fee", enabled: false },
      ],
    })),
    fos: [],
  };
}

test("po payments ledger: exports paid PO events and keeps deposit/balance split", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  assert.equal(rows.length, 7);

  const po25001 = rows.filter((row) => row.po_number === "25001");
  assert.equal(po25001.length, 2);
  assert.deepEqual(po25001.map((row) => row.payment_stage).sort(), ["BALANCE", "DEPOSIT"]);
});

test("po payments ledger: excludes open, undated or zero-amount payments", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  assert.equal(rows.some((row) => row.po_number === "25003"), false);
  assert.equal(rows.every((row) => Number(row.paid_amount) > 0), true);
});

test("po payments ledger: maps payment channels and non-supplier stages", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  const byPo = new Map(rows.map((row) => [row.po_number, row]));

  assert.equal(byPo.get("25002")?.payment_stage, "OTHER");
  assert.equal(byPo.get("25002")?.payment_channel, "PAYPAL");
  assert.equal(byPo.get("25004")?.payment_channel, "SEPA");
  assert.equal(byPo.get("25005")?.payment_channel, "OTHER");
});

test("po payments ledger: carries reference fields and reference hint", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  const deposit = rows.find((row) => row.po_number === "25001" && row.payment_stage === "DEPOSIT");
  assert.ok(deposit);
  assert.equal(deposit?.invoice_id_or_number, "INV-A-DEP");
  assert.match(String(deposit?.reference_hint || ""), /PO 25001 DEPOSIT/);
  assert.match(String(deposit?.reference_hint || ""), /TRX W-123/);
  assert.match(String(deposit?.reference_hint || ""), /INV INV-A-DEP/);
});

test("po payments ledger: allocates paid amount from bundled payment totals", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  const po25006 = rows.filter((row) => row.po_number === "25006");
  assert.equal(po25006.length, 2);

  const dep = po25006.find((row) => row.payment_stage === "DEPOSIT");
  const bal = po25006.find((row) => row.payment_stage === "BALANCE");
  assert.equal(dep?.paid_amount, 300);
  assert.equal(bal?.paid_amount, 700);
});

test("po payments ledger: csv and export metadata are consistent", () => {
  const rows = buildPoPaymentsLedgerRows(createLedgerState(), { month: "2026-01" });
  const csv = poPaymentsLedgerRowsToCsv(rows);
  const lines = csv.split("\n");
  assert.equal(lines.length, rows.length + 1);
  assert.equal(
    lines[0],
    "\"po_number\",\"payment_stage\",\"supplier_name\",\"payment_date\",\"payment_channel\",\"invoice_currency\",\"invoice_amount\",\"paid_currency\",\"paid_amount\",\"reference_hint\",\"invoice_id_or_number\",\"units_total\",\"sku_list\",\"notes\"",
  );
  assert.match(csv, /"300\.00"/);
  assert.equal(csv.includes(";"), false);

  const exported = buildPoPaymentsLedgerExport(createLedgerState(), { month: "2026-01" });
  assert.equal(exported.fileName, "po-payments_2026-01.csv");
  assert.equal(exported.rowCount, rows.length);
  assert.equal(exported.csv, csv);
});

test("po payments ledger: performance smoke stays below 5s for typical volume", () => {
  const state = createPerformanceState();
  const startedAt = Date.now();
  const rows = buildPoPaymentsLedgerRows(state, { month: "2026-01" });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(rows.length, 750);
  assert.ok(elapsedMs < 5000, `Expected < 5000ms, got ${elapsedMs}ms`);
});

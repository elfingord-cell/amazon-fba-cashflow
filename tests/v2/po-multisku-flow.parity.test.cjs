const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  computePoAggregateMetrics,
  mapSupplierTermsToPoMilestones,
} = require("../../.test-build/migration/v2/domain/orderUtils.js");
const { buildPaymentRows } = require("../../.test-build/migration/ui/orderEditorFactory.js");

const PO_CONFIG = {
  slug: "po",
  entityLabel: "PO",
  numberField: "poNo",
};

function readPoModuleSource() {
  const filePath = path.resolve(__dirname, "../../src/v2/modules/po/index.tsx");
  return fs.readFileSync(filePath, "utf8");
}

test("po multi-sku flow: critical path aggregation uses max lead times", () => {
  const metrics = computePoAggregateMetrics({
    items: [
      {
        id: "i-1",
        sku: "SKU-A",
        units: 120,
        unitCostUsd: 4,
        unitExtraUsd: 0,
        extraFlatUsd: 0,
        prodDays: 21,
        transitDays: 48,
        freightEur: 130,
      },
      {
        id: "i-2",
        sku: "SKU-B",
        units: 80,
        unitCostUsd: 6,
        unitExtraUsd: 0,
        extraFlatUsd: 0,
        prodDays: 42,
        transitDays: 31,
        freightEur: 90,
      },
    ],
    orderDate: "2026-02-10",
    fxRate: 1,
  });

  assert.equal(metrics.prodDays, 42);
  assert.equal(metrics.transitDays, 48);
  assert.equal(metrics.schedule.etdDate, "2026-03-24");
  assert.equal(metrics.schedule.etaDate, "2026-05-11");
});

test("po multi-sku flow: supplier terms are mapped to PO milestones", () => {
  const milestones = mapSupplierTermsToPoMilestones({
    paymentTermsDefault: [
      { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
      { label: "Balance", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
    ],
  });

  assert.equal(milestones.length, 2);
  assert.equal(milestones[0].anchor, "ORDER_DATE");
  assert.equal(milestones[1].anchor, "PROD_DONE");
});

test("po multi-sku flow: supplier milestones are goods-based and freight stays separate", () => {
  const paymentRows = buildPaymentRows(
    {
      id: "po-m1",
      poNo: "PO-M1",
      supplierId: "sup-1",
      orderDate: "2026-02-10",
      prodDays: 35,
      transitDays: 45,
      fxOverride: 1,
      items: [
        {
          id: "i-1",
          sku: "SKU-A",
          units: 100,
          unitCostUsd: 2,
          unitExtraUsd: 0,
          extraFlatUsd: 0,
        },
        {
          id: "i-2",
          sku: "SKU-B",
          units: 50,
          unitCostUsd: 4,
          unitExtraUsd: 0,
          extraFlatUsd: 0,
        },
      ],
      freightEur: 90,
      milestones: [
        { id: "ms-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
        { id: "ms-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
      ],
      autoEvents: [
        { id: "auto-freight", type: "freight", enabled: true },
        { id: "auto-duty", type: "duty", enabled: false },
        { id: "auto-eust", type: "eust", enabled: false },
        { id: "auto-vat", type: "vat_refund", enabled: false },
        { id: "auto-fx", type: "fx_fee", enabled: false },
      ],
    },
    PO_CONFIG,
    {
      fxRate: 1,
      fxFeePct: 0,
      dutyRatePct: 0,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cny: { start: "", end: "" },
      cnyBlackoutByYear: {},
    },
    [],
  );

  const deposit = paymentRows.find((row) => String(row.id || "") === "ms-dep");
  const balance = paymentRows.find((row) => String(row.id || "") === "ms-bal");
  const freight = paymentRows.find((row) => String(row.eventType || "") === "freight");

  assert.ok(deposit, "deposit row missing");
  assert.ok(balance, "balance row missing");
  assert.ok(freight, "freight row missing");

  const supplierTotal = Number(deposit.plannedEur || 0) + Number(balance.plannedEur || 0);
  assert.equal(supplierTotal, 400);
  assert.equal(Number(freight.plannedEur || 0), 90);
});

test("po multi-sku flow: PO module enforces supplier scope and mirror fields", () => {
  const source = readPoModuleSource();

  assert.match(source, /SKU .*gehoert nicht zum gewaehlten Lieferanten/);
  assert.match(source, /items: normalizedItems/);
  assert.match(source, /units: Math\.max\(0, Math\.round\(aggregated\.units/);
  assert.match(source, /prodDays: Number\(aggregated\.prodDays/);
  assert.match(source, /transitDays: Number\(aggregated\.transitDays/);
  assert.match(source, /freightEur: Number\(aggregated\.freightEur/);
});

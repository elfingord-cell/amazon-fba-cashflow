const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  computePoAggregateMetrics,
  createPoFromFos,
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

test("po timeline event coverage: timeline view can include refund and all payment milestones", () => {
  const record = {
    id: "po-timeline-1",
    poNo: "PO-TL-1",
    supplierId: "sup-1",
    orderDate: "2026-03-01",
    prodDays: 30,
    transitDays: 20,
    dutyRatePct: 6.5,
    eustRatePct: 19,
    dutyIncludeFreight: true,
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    items: [
      {
        id: "po-tl-item-1",
        sku: "SKU-A",
        units: 100,
        unitCostUsd: 5,
        unitExtraUsd: 0,
        extraFlatUsd: 0,
      },
    ],
    freightEur: 120,
    milestones: [
      { id: "ms-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: "ms-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
    ],
    autoEvents: [
      { id: "auto-freight", type: "freight", enabled: true },
      { id: "auto-duty", type: "duty", enabled: true },
      { id: "auto-eust", type: "eust", enabled: true },
      { id: "auto-vat", type: "vat_refund", enabled: true },
      { id: "auto-fx", type: "fx_fee", enabled: false },
    ],
    paymentLog: {},
  };

  const settings = {
    fxRate: 1,
    fxFeePct: 0,
    dutyRatePct: 6.5,
    dutyIncludeFreight: true,
    eustRatePct: 19,
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 0,
    cny: { start: "", end: "" },
    cnyBlackoutByYear: {},
  };

  const defaultRows = buildPaymentRows(record, PO_CONFIG, settings, []);
  const timelineRows = buildPaymentRows(record, PO_CONFIG, settings, [], { includeIncoming: true });
  const timelineTypes = new Set(timelineRows.map((row) => String(row.eventType || "")));
  const timelineLabels = timelineRows.map((row) => String(row.typeLabel || row.label || ""));

  assert.equal(defaultRows.some((row) => String(row.eventType || "") === "vat_refund"), false);
  assert.equal(timelineTypes.has("freight"), true);
  assert.equal(timelineTypes.has("duty"), true);
  assert.equal(timelineTypes.has("eust"), true);
  assert.equal(timelineTypes.has("vat_refund"), true);
  assert.equal(timelineLabels.some((label) => label.toLowerCase().includes("deposit")), true);
  assert.equal(timelineLabels.some((label) => label.toLowerCase().includes("balance")), true);
});

test("po multi-sku flow: FO merge creates a single multi-item PO with critical path", () => {
  const po = createPoFromFos({
    poNumber: "PO-FO-MERGE-1",
    targetDeliveryDate: "2026-08-31",
    fos: [
      {
        id: "fo-a",
        supplierId: "sup-1",
        sku: "SKU-A",
        units: 120,
        unitPrice: 4.5,
        freight: 100,
        freightCurrency: "EUR",
        fxRate: 1.1,
        productionLeadTimeDays: 40,
        bufferDays: 5,
        logisticsLeadTimeDays: 35,
        transportMode: "SEA",
        incoterm: "EXW",
        dutyRatePct: 8,
        eustRatePct: 19,
      },
      {
        id: "fo-b",
        supplierId: "sup-1",
        sku: "SKU-B",
        units: 80,
        unitPrice: 6.2,
        freight: 80,
        freightCurrency: "EUR",
        fxRate: 1.1,
        productionLeadTimeDays: 28,
        bufferDays: 0,
        logisticsLeadTimeDays: 49,
        transportMode: "SEA",
        incoterm: "EXW",
        dutyRatePct: 8,
        eustRatePct: 19,
      },
    ],
  });

  assert.equal(po.poNo, "PO-FO-MERGE-1");
  assert.equal(Array.isArray(po.items), true);
  assert.equal(po.items.length, 2);
  assert.equal(po.units, 200);
  assert.equal(po.prodDays, 45);
  assert.equal(po.transitDays, 49);
  assert.equal(po.etaManual, "2026-08-31");
  assert.deepEqual(po.sourceFoIds, ["fo-a", "fo-b"]);
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

test("po timeline integration: table and timeline reuse shared filtered rows", () => {
  const source = readPoModuleSource();

  assert.match(source, /const filteredRows = useMemo/);
  assert.match(source, /data=\{filteredRows\}/);
  assert.match(source, /filteredRows\.map\(\(row\) =>/);
  assert.match(source, /paymentStatusFilter/);
  assert.match(source, /onlyOpenPayments/);
});

test("po timeline marker click opens payment flow with modal fallback", () => {
  const source = readPoModuleSource();

  assert.match(source, /setMarkerPendingAction/);
  assert.match(source, /openTimelinePayment/);
  assert.match(source, /openPaymentBookingModal\(markerRow\)/);
  assert.match(source, /setModalFocusTarget\("payments"\)/);
});

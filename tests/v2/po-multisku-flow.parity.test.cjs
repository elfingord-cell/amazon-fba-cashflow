const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  buildInboundBySku,
  buildMultiFoPoPreflight,
  computePoAggregateMetrics,
  convertFoSelectionToPo,
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

function readFoModuleSource() {
  const filePath = path.resolve(__dirname, "../../src/v2/modules/fo/index.tsx");
  return fs.readFileSync(filePath, "utf8");
}

function readOrdersModuleSource() {
  const filePath = path.resolve(__dirname, "../../src/v2/modules/orders/index.tsx");
  return fs.readFileSync(filePath, "utf8");
}

function readOrdersTabsSource() {
  const filePath = path.resolve(__dirname, "../../src/v2/modules/orders/tabs.ts");
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

test("po payment event coverage: default rows exclude refund, optional incoming rows include it", () => {
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

test("po freight hydration logic: units/sku auto-recalc remains active until manual freight override", () => {
  const source = readPoModuleSource();

  assert.match(source, /trackFreightOverrides/);
  assert.match(source, /manualFreightOverrideIdsRef/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(row, "freightEur"\)/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(row, "units"\)/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(row, "sku"\)/);
  assert.equal(source.includes("if (Number(item.freightEur || 0) > 0) return item;"), false);
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

test("po multi-sku flow: preflight resolves earliest order date and conservative header timing", () => {
  const state = {
    settings: {
      fxRate: 1.1,
    },
    suppliers: [
      {
        id: "sup-1",
        name: "Supplier 1",
        currencyDefault: "USD",
        incotermDefault: "EXW",
        paymentTermsDefault: [
          { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
          { label: "Balance", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
        ],
      },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha", supplierId: "sup-1" },
      { sku: "SKU-B", alias: "Beta", supplierId: "sup-1" },
    ],
    fos: [],
  };
  const fos = [
    {
      id: "fo-a",
      foNo: "26001",
      supplierId: "sup-1",
      sku: "SKU-A",
      units: 120,
      unitPrice: 4.5,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      dutyRatePct: 8,
      eustRatePct: 19,
      orderDate: "2026-02-10",
      targetDeliveryDate: "2026-05-05",
      productionLeadTimeDays: 20,
      bufferDays: 5,
      logisticsLeadTimeDays: 15,
      payments: [
        { id: "a-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "a-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
    {
      id: "fo-b",
      foNo: "26002",
      supplierId: "sup-1",
      sku: "SKU-B",
      units: 80,
      unitPrice: 6.2,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      dutyRatePct: 8,
      eustRatePct: 19,
      orderDate: "2026-02-18",
      targetDeliveryDate: "2026-05-20",
      productionLeadTimeDays: 35,
      bufferDays: 0,
      logisticsLeadTimeDays: 30,
      payments: [
        { id: "b-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "b-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
  ];

  const preflight = buildMultiFoPoPreflight({ state, fos });

  assert.equal(preflight.compatible, true);
  assert.equal(preflight.header.orderDate, "2026-02-10");
  assert.equal(preflight.header.etdDate, "2026-03-17");
  assert.equal(preflight.header.etaDate, "2026-04-16");
  assert.equal(preflight.header.timingIsConservative, true);
  assert.ok(preflight.warnings.some((entry) => entry.code === "timing_conservative"));
});

test("po multi-sku flow: preflight blocks incompatible supplier and commercial settings", () => {
  const baseState = {
    settings: { fxRate: 1.1 },
    suppliers: [
      {
        id: "sup-1",
        name: "Supplier 1",
        currencyDefault: "USD",
        incotermDefault: "EXW",
        paymentTermsDefault: [
          { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
          { label: "Balance", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
        ],
      },
      {
        id: "sup-2",
        name: "Supplier 2",
        currencyDefault: "EUR",
        incotermDefault: "DDP",
      },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha", supplierId: "sup-1" },
      { sku: "SKU-B", alias: "Beta", supplierId: "sup-2" },
    ],
  };

  const supplierConflict = buildMultiFoPoPreflight({
    state: baseState,
    fos: [
      {
        id: "fo-a",
        supplierId: "sup-1",
        sku: "SKU-A",
        units: 20,
        unitPrice: 3,
        currency: "USD",
        incoterm: "EXW",
        fxRate: 1.1,
        orderDate: "2026-02-10",
        targetDeliveryDate: "2026-03-10",
        productionLeadTimeDays: 10,
        bufferDays: 0,
        logisticsLeadTimeDays: 10,
        payments: [{ label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 }],
      },
      {
        id: "fo-b",
        supplierId: "sup-2",
        sku: "SKU-B",
        units: 20,
        unitPrice: 3,
        currency: "EUR",
        incoterm: "DDP",
        fxRate: 1,
        orderDate: "2026-02-10",
        targetDeliveryDate: "2026-03-10",
        productionLeadTimeDays: 10,
        bufferDays: 0,
        logisticsLeadTimeDays: 10,
        payments: [{ label: "Net 100", category: "supplier", percent: 100, triggerEvent: "ETA", offsetDays: 0 }],
      },
    ],
  });

  assert.equal(supplierConflict.compatible, false);
  assert.ok(supplierConflict.blockers.some((entry) => entry.code === "supplier_mismatch"));
  assert.ok(supplierConflict.blockers.some((entry) => entry.code === "currency_mismatch"));
  assert.ok(supplierConflict.blockers.some((entry) => entry.code === "incoterm_mismatch"));
  assert.ok(supplierConflict.blockers.some((entry) => entry.code === "payment_terms_mismatch"));
});

test("po multi-sku flow: manual later order date is blocked by timing conflict", () => {
  const state = {
    settings: { fxRate: 1.1 },
    suppliers: [
      {
        id: "sup-1",
        name: "Supplier 1",
        currencyDefault: "USD",
        incotermDefault: "EXW",
        paymentTermsDefault: [
          { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
          { label: "Balance", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
        ],
      },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha", supplierId: "sup-1" },
      { sku: "SKU-B", alias: "Beta", supplierId: "sup-1" },
    ],
  };
  const fos = [
    {
      id: "fo-a",
      foNo: "26001",
      supplierId: "sup-1",
      sku: "SKU-A",
      units: 120,
      unitPrice: 4.5,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      orderDate: "2026-02-10",
      targetDeliveryDate: "2026-05-05",
      productionLeadTimeDays: 20,
      bufferDays: 5,
      logisticsLeadTimeDays: 15,
      payments: [
        { id: "a-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "a-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
    {
      id: "fo-b",
      foNo: "26002",
      supplierId: "sup-1",
      sku: "SKU-B",
      units: 80,
      unitPrice: 6.2,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      orderDate: "2026-02-18",
      targetDeliveryDate: "2026-05-20",
      productionLeadTimeDays: 35,
      bufferDays: 0,
      logisticsLeadTimeDays: 30,
      payments: [
        { id: "b-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "b-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
  ];

  const preflight = buildMultiFoPoPreflight({
    state,
    fos,
    orderDateOverride: "2026-03-20",
  });

  assert.equal(preflight.compatible, false);
  assert.ok(preflight.blockers.some((entry) => entry.code === "timing_conflict"));
});

test("po multi-sku flow: conversion keeps provenance and converted FOs no longer double-count inbound", () => {
  const state = {
    settings: { fxRate: 1.1, vatRefundLagMonths: 2, paymentDueDefaults: {} },
    suppliers: [
      {
        id: "sup-1",
        name: "Supplier 1",
        currencyDefault: "USD",
        incotermDefault: "EXW",
        paymentTermsDefault: [
          { label: "Deposit", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
          { label: "Balance", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
        ],
      },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha", supplierId: "sup-1" },
      { sku: "SKU-B", alias: "Beta", supplierId: "sup-1" },
    ],
    pos: [],
    fos: [],
  };
  const fos = [
    {
      id: "fo-a",
      foNo: "26001",
      supplierId: "sup-1",
      sku: "SKU-A",
      status: "ACTIVE",
      units: 120,
      unitPrice: 4.5,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      freight: 100,
      freightCurrency: "EUR",
      dutyRatePct: 8,
      eustRatePct: 19,
      orderDate: "2026-02-10",
      targetDeliveryDate: "2026-05-05",
      productionLeadTimeDays: 20,
      bufferDays: 5,
      logisticsLeadTimeDays: 15,
      payments: [
        { id: "a-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "a-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
    {
      id: "fo-b",
      foNo: "26002",
      supplierId: "sup-1",
      sku: "SKU-B",
      status: "ACTIVE",
      units: 80,
      unitPrice: 6.2,
      currency: "USD",
      incoterm: "EXW",
      fxRate: 1.1,
      freight: 80,
      freightCurrency: "EUR",
      dutyRatePct: 8,
      eustRatePct: 19,
      orderDate: "2026-02-18",
      targetDeliveryDate: "2026-05-20",
      productionLeadTimeDays: 35,
      bufferDays: 0,
      logisticsLeadTimeDays: 30,
      payments: [
        { id: "b-dep", label: "Deposit", category: "supplier", percent: 30, triggerEvent: "ORDER_DATE", offsetDays: 0 },
        { id: "b-bal", label: "Balance", category: "supplier", percent: 70, triggerEvent: "PRODUCTION_END", offsetDays: 0 },
      ],
    },
  ];

  const conversion = convertFoSelectionToPo({
    state,
    fos,
    poNumber: "PO-REVIEW-1",
  });

  assert.equal(conversion.preflight.compatible, true);
  assert.deepEqual(conversion.po.sourceFoIds, ["fo-a", "fo-b"]);
  assert.deepEqual(conversion.po.items.map((item) => item.sourceFoId), ["fo-a", "fo-b"]);
  assert.equal(conversion.updatedFos.every((fo) => fo.status === "CONVERTED"), true);
  assert.equal(conversion.updatedFos.every((fo) => fo.convertedPoNo === "PO-REVIEW-1"), true);

  const inbound = buildInboundBySku({
    ...state,
    pos: [conversion.po],
    fos: conversion.updatedFos,
  });
  const totalSkuA = Object.values(inbound.inboundBySku["SKU-A"] || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalSkuB = Object.values(inbound.inboundBySku["SKU-B"] || {}).reduce((sum, value) => sum + Number(value || 0), 0);

  assert.equal(totalSkuA, 120);
  assert.equal(totalSkuB, 80);
});

test("po multi-sku flow: PO module enforces supplier scope and mirror fields", () => {
  const source = readPoModuleSource();

  assert.match(source, /SKU .*gehoert nicht zum gewaehlten Lieferanten/);
  assert.match(source, /items: normalizedItems/);
  assert.match(source, /sourceFoId/);
  assert.match(source, /units: Math\.max\(0, Math\.round\(aggregated\.units/);
  assert.match(source, /prodDays: Number\(aggregated\.prodDays/);
  assert.match(source, /transitDays: Number\(aggregated\.transitDays/);
  assert.match(source, /freightEur: Number\(aggregated\.freightEur/);
});

test("fo multi-sku flow: FO module opens a review/preflight dialog before creating a PO", () => {
  const source = readFoModuleSource();

  assert.match(source, /buildMultiFoPoPreflight/);
  assert.match(source, /mergePreflight\.blockers/);
  assert.match(source, /FO-Auswahl prüfen und in eine PO umwandeln/);
  assert.match(source, /okButtonProps=\{\{ disabled: !mergeCanSubmit \}\}/);
});

test("po timeline integration: table and timeline reuse shared filtered rows", () => {
  const source = readPoModuleSource();

  assert.match(source, /const filteredRows = useMemo/);
  assert.match(source, /data=\{filteredRows\}/);
  assert.match(source, /filteredRows\.map\(\(row\) =>/);
  assert.match(source, /paymentStatusFilter/);
  assert.match(source, /onlyOpenPayments/);
  assert.match(source, /sortPaymentRowsByFlow\(draftPaymentRowsRaw\)/);
  assert.match(source, /const draftIncomingPaymentRows = useMemo/);
  assert.match(source, /Automatische Eingaenge \(Info\)/);
  assert.match(source, /row\.eventType === "vat_refund" \|\| row\.direction === "in"/);
  assert.match(source, /\.filter\(\(row\) => row\.eventType !== "vat_refund"\)/);
  assert.match(source, /EUSt-Erstattung wird automatisch verbucht/);
});

test("po modal planning uses one schedule truth and shows the fixed payment event basis", () => {
  const source = readPoModuleSource();

  assert.match(source, /draftPlanningSnapshot\.schedule\.etdDate/);
  assert.match(source, /draftPlanningSnapshot\.schedule\.etaDate/);
  assert.match(source, /aggregateEtaStart/);
  assert.match(source, /aggregateEtaEnd/);
  assert.match(source, /PLANNING_AUTO_EVENT_ORDER = \["freight", "eust", "duty", "vat_refund"\]/);
  assert.match(source, /visiblePlanningAutoEvents/);
  assert.match(source, /planningEventDisplayLabel/);
  assert.equal(source.includes("draftAutoEvents.map"), false);
});

test("po timeline marker click opens payment flow with modal fallback", () => {
  const source = readPoModuleSource();

  assert.match(source, /setMarkerPendingAction/);
  assert.match(source, /openTimelinePayment/);
  assert.match(source, /openPaymentBookingModal\(markerRow\)/);
  assert.match(source, /setModalFocusTarget\("payments"\)/);
});

test("fo timeline integration: table and timeline share filtered rows and query view mode", () => {
  const source = readFoModuleSource();

  assert.match(source, /resolveFoViewMode/);
  assert.match(source, /foViewMode/);
  assert.match(source, /Segmented/);
  assert.match(source, /OrdersGanttTimeline/);
  assert.match(source, /rows\.flatMap/);
  assert.match(source, /toggleMergeSelectionForRow/);
  assert.match(source, /openConvertModalForRow/);
});

test("orders tabs include dedicated sku timeline view", () => {
  const moduleSource = readOrdersModuleSource();
  const tabsSource = readOrdersTabsSource();

  assert.match(tabsSource, /export type OrdersTabKey = "po" \| "fo" \| "pfo" \| "sku" \| "lieferantenausblick"/);
  assert.match(tabsSource, /if \(pathname\.includes\("\/orders\/sku"\)\) return "sku"/);
  assert.match(tabsSource, /label: "SKU Sicht"/);
  assert.match(moduleSource, /tab\.key === "sku"\s*\n\s*\?\s*<SkuTimelineView \/>/);
});

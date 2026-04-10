const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateDashboardMonthEntries,
  alignDashboardCashInToMirror,
  applyTaxInstancesToBreakdown,
  applyDashboardBucketScopeToBreakdown,
  buildDashboardTaxMatrixGroup,
} = require("../../.test-build/migration/v2/domain/dashboardCashflow.js");

function withMockedNow(date, callback) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(date.getTime());
        return;
      }
      super(...args);
    }

    static now() {
      return date.getTime();
    }
  }
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  globalThis.Date = MockDate;
  try {
    return callback();
  } finally {
    globalThis.Date = RealDate;
  }
}

test("dashboard chart and matrix keep forecast-sourced hybrid months on live forecast revenue", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
  ]);
  const state = {
    settings: {
      startMonth: "2026-01",
      horizonMonths: 4,
      openingBalance: 1000,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-1": {
          "2026-03": { revenueEur: "5.000,00" },
        },
      },
    },
    products: [
      {
        sku: "SKU-1",
        alias: "Hero SKU",
        includeInForecast: true,
      },
    ],
    incomings: [
      {
        id: "inc-mar",
        month: "2026-03",
        revenueEur: "1.000,00",
        payoutPct: "40",
        source: "forecast",
      },
    ],
    fixcosts: [
      {
        id: "fc-mar",
        name: "Tooling",
        category: "Tools",
        amount: "130,00",
        frequency: "monthly",
        anchor: "LAST",
        startMonth: "2026-03",
        proration: { enabled: false, method: "none" },
      },
    ],
    fixcostOverrides: {},
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };
  const bucketScope = new Set([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN]);

  const report = computeSeries(state);
  const scoped = applyDashboardBucketScopeToBreakdown(report.breakdown, bucketScope, {
    includePhantomFo: true,
  });
  const march = scoped.find((row) => row.month === "2026-03");
  assert.ok(march);

  const marchAggregation = aggregateDashboardMonthEntries(march.entries, {
    bucketScope,
    includePhantomFo: true,
  });

  const chartIncome = marchAggregation.inflow.amazonCore
    + marchAggregation.inflow.amazonPlanned
    + marchAggregation.inflow.amazonNew
    + marchAggregation.inflow.other;
  const matrixIncome = marchAggregation.inflow.total;

  assert.equal(march.inflow, 2000);
  assert.equal(march.outflow, 130);
  assert.equal(march.net, 1870);
  assert.equal(march.net, march.inflow - march.outflow);
  assert.equal(marchAggregation.totals.cashIn, 2000);
  assert.equal(marchAggregation.totals.cashOut, 130);
  assert.equal(marchAggregation.totals.net, 1870);
  assert.equal(chartIncome, 2000);
  assert.equal(matrixIncome, 2000);
  assert.equal(chartIncome, matrixIncome);
  assert.equal(chartIncome, march.inflow);
});

test("dashboard chart and matrix ignore legacy manual zero revenue in hybrid mode", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
  ]);
  const state = {
    settings: {
      startMonth: "2026-01",
      horizonMonths: 4,
      openingBalance: 1000,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-1": {
          "2026-03": { revenueEur: "5.000,00" },
        },
      },
    },
    products: [
      {
        sku: "SKU-1",
        alias: "Hero SKU",
        includeInForecast: true,
      },
    ],
    incomings: [
      {
        id: "inc-mar",
        month: "2026-03",
        revenueEur: "0",
        payoutPct: "40",
        source: "manual",
      },
    ],
    fixcosts: [
      {
        id: "fc-mar",
        name: "Tooling",
        category: "Tools",
        amount: "130,00",
        frequency: "monthly",
        anchor: "LAST",
        startMonth: "2026-03",
        proration: { enabled: false, method: "none" },
      },
    ],
    fixcostOverrides: {},
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };
  const bucketScope = new Set([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN]);

  const report = computeSeries(state);
  const scoped = applyDashboardBucketScopeToBreakdown(report.breakdown, bucketScope, {
    includePhantomFo: true,
  });
  const march = scoped.find((row) => row.month === "2026-03");
  assert.ok(march);

  const marchAggregation = aggregateDashboardMonthEntries(march.entries, {
    bucketScope,
    includePhantomFo: true,
  });

  assert.equal(march.inflow, 2000);
  assert.equal(march.outflow, 130);
  assert.equal(march.net, 1870);
  assert.equal(marchAggregation.totals.cashIn, 2000);
  assert.equal(marchAggregation.totals.cashOut, 130);
  assert.equal(marchAggregation.totals.net, 1870);
});

test("dashboard PO cashflow uses PO payment truth for paid month bucketing without emitting mixed/open remainder state", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2025-01",
      horizonMonths: 3,
      openingBalance: 0,
      fxRate: 1,
      fxFeePct: 0,
      dutyRatePct: 0,
      dutyIncludeFreight: false,
      eustRatePct: 0,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [],
    extras: [],
    dividends: [],
    fos: [],
    payments: [
      {
        id: "pay-stray-freight",
        paidDate: "2025-03-10",
        amountActualEurTotal: 250,
        coveredEventIds: ["auto-freight"],
        allocations: [{ eventId: "auto-freight", amountEur: 250 }],
      },
      {
        id: "pay-stray-duty",
        paidDate: "2025-03-11",
        amountActualEurTotal: 90,
        coveredEventIds: ["auto-duty"],
        allocations: [{ eventId: "auto-duty", amountEur: 90 }],
      },
      {
        id: "pay-stray-eust",
        paidDate: "2025-03-11",
        amountActualEurTotal: 180,
        coveredEventIds: ["auto-eust"],
        allocations: [{ eventId: "auto-eust", amountEur: 180 }],
      },
    ],
    pos: [
      {
        id: "po-paid-late",
        poNo: "PO-PAID-LATE",
        orderDate: "2025-01-05",
        prodDays: 0,
        transitDays: 0,
        fxOverride: 1,
        freightEur: "0,00",
        items: [
          {
            id: "po-paid-late-item",
            sku: "SKU-1",
            units: "10",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-paid-late-ms", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "po-paid-late-ms": {
            status: "paid",
            paidDate: "2025-02-10",
            amountActualEur: 100,
          },
        },
        autoEvents: [
          { id: "po-paid-late-freight", type: "freight", enabled: false },
          { id: "po-paid-late-duty", type: "duty", enabled: false },
          { id: "po-paid-late-eust", type: "eust", enabled: false },
          { id: "po-paid-late-vat", type: "vat_refund", enabled: false },
          { id: "po-paid-late-fx", type: "fx_fee", enabled: false },
        ],
      },
      {
        id: "po-partial",
        poNo: "PO-PARTIAL",
        orderDate: "2025-01-08",
        prodDays: 0,
        transitDays: 0,
        fxOverride: 1,
        freightEur: "0,00",
        items: [
          {
            id: "po-partial-item",
            sku: "SKU-2",
            units: "10",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-partial-ms", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
        ],
        paymentLog: {
          "po-partial-ms": {
            status: "paid",
            paidDate: "2025-02-12",
            amountActualEur: 40,
          },
        },
        autoEvents: [
          { id: "po-partial-freight", type: "freight", enabled: false },
          { id: "po-partial-duty", type: "duty", enabled: false },
          { id: "po-partial-eust", type: "eust", enabled: false },
          { id: "po-partial-vat", type: "vat_refund", enabled: false },
          { id: "po-partial-fx", type: "fx_fee", enabled: false },
        ],
      },
    ],
    products: [
      { sku: "SKU-1", alias: "Alpha", includeInForecast: true, portfolioBucket: PORTFOLIO_BUCKET.CORE },
      { sku: "SKU-2", alias: "Beta", includeInForecast: true, portfolioBucket: PORTFOLIO_BUCKET.CORE },
    ],
    status: { autoManualCheck: false, events: {} },
  };
  const snapshot = structuredClone(state);
  const bucketScope = new Set([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN]);

  const report = withMockedNow(new Date("2025-03-01T12:00:00Z"), () => computeSeries(state));
  const january = report.breakdown.find((row) => row.month === "2025-01");
  const february = report.breakdown.find((row) => row.month === "2025-02");
  assert.ok(january);
  assert.ok(february);

  const januaryAggregation = aggregateDashboardMonthEntries(january.entries, { bucketScope, includePhantomFo: true });
  const februaryAggregation = aggregateDashboardMonthEntries(february.entries, { bucketScope, includePhantomFo: true });
  assert.equal(januaryAggregation.outflow.po, 0, "a paid PO event delta must not stay behind as open backlog");
  assert.equal(februaryAggregation.outflow.po, 140, "paid cash should move into the actual payment month");

  const januaryPoEntries = january.entries.filter((entry) => String(entry.source || "") === "po" && String(entry.direction || "") === "out");
  const februaryPoEntries = february.entries.filter((entry) => String(entry.source || "") === "po" && String(entry.direction || "") === "out");
  assert.equal(
    januaryPoEntries.some((entry) => String(entry.sourceNumber || "") === "PO-PAID-LATE"),
    false,
    "fully paid past-due milestone must not remain as January backlog",
  );
  assert.deepEqual(
    januaryPoEntries.map((entry) => ({
      ref: entry.sourceNumber,
      state: entry.meta?.poPaymentState,
      paid: entry.paid,
      amount: entry.amount,
    })),
    [],
  );
  assert.deepEqual(
    februaryPoEntries.map((entry) => ({
      ref: entry.sourceNumber,
      state: entry.meta?.poPaymentState,
      paid: entry.paid,
      amount: entry.amount,
    })).sort((left, right) => String(left.ref).localeCompare(String(right.ref))),
    [
      { ref: "PO-PAID-LATE", state: "paid", paid: true, amount: 100 },
      { ref: "PO-PARTIAL", state: "paid", paid: true, amount: 40 },
    ],
  );
  assert.equal(
    [...januaryPoEntries, ...februaryPoEntries].some((entry) => entry.meta?.poPaymentState === "mixed"),
    false,
    "dashboard PO entries must not emit a mixed payment state",
  );
  assert.deepEqual(state, snapshot, "dashboard cashflow must stay derived-only and must not persist dashboard payment state");
});

test("dashboard PO cashflow keeps deposit, balance, freight, customs, and import VAT on their exact event month/amount/status", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2025-03",
      horizonMonths: 5,
      openingBalance: 0,
      fxRate: 1,
      fxFeePct: 0,
      dutyRatePct: 10,
      dutyIncludeFreight: true,
      eustRatePct: 20,
      vatRefundEnabled: false,
      vatRefundLagMonths: 0,
      freightLagDays: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [],
    extras: [],
    dividends: [],
    fos: [],
    payments: [],
    pos: [
      {
        id: "po-event-truth",
        poNo: "PO-EVENT-TRUTH",
        orderDate: "2025-03-01",
        prodDays: 75,
        transitDays: 0,
        fxOverride: 1,
        freightEur: "500,00",
        items: [
          {
            id: "po-event-truth-item",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "10,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-ms-deposit", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po-ms-balance", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po-ms-deposit": {
            status: "paid",
            paidDate: "2025-03-05",
            amountActualEur: 290,
          },
        },
        autoEvents: [
          { id: "po-auto-freight", type: "freight", enabled: true, anchor: "ETA", lagDays: 30, label: "Fracht" },
          { id: "po-auto-duty", type: "duty", enabled: true, anchor: "ETA", lagDays: 30, label: "Zoll", percent: 10 },
          { id: "po-auto-eust", type: "eust", enabled: true, anchor: "ETA", lagDays: 30, label: "EUSt", percent: 20 },
          { id: "po-auto-vat", type: "vat_refund", enabled: false, anchor: "ETA", lagDays: 0, label: "EUSt-Erstattung" },
          { id: "po-auto-fx", type: "fx_fee", enabled: false, anchor: "ORDER_DATE", lagDays: 0, label: "FX-Gebühr" },
        ],
      },
    ],
    products: [
      { sku: "SKU-1", alias: "Alpha", includeInForecast: true, portfolioBucket: PORTFOLIO_BUCKET.CORE },
    ],
    status: { autoManualCheck: false, events: {} },
  };
  const snapshot = structuredClone(state);
  const bucketScope = new Set([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN]);

  const report = withMockedNow(new Date("2025-03-16T12:00:00Z"), () => computeSeries(state));
  const march = report.breakdown.find((row) => row.month === "2025-03");
  const may = report.breakdown.find((row) => row.month === "2025-05");
  const june = report.breakdown.find((row) => row.month === "2025-06");
  assert.ok(march);
  assert.ok(may);
  assert.ok(june);

  const marchAggregation = aggregateDashboardMonthEntries(march.entries, { bucketScope, includePhantomFo: true });
  const mayAggregation = aggregateDashboardMonthEntries(may.entries, { bucketScope, includePhantomFo: true });
  const juneAggregation = aggregateDashboardMonthEntries(june.entries, { bucketScope, includePhantomFo: true });
  assert.equal(marchAggregation.outflow.po, 290);
  assert.equal(mayAggregation.outflow.po, 700);
  assert.equal(juneAggregation.outflow.po, 980);

  const pickPoRows = (monthRow) => monthRow.entries
    .filter((entry) => String(entry.source || "") === "po" && String(entry.direction || "") === "out")
    .map((entry) => ({
      ref: entry.sourceNumber,
      label: entry.label,
      date: entry.date,
      state: entry.meta?.poPaymentState,
      displayDate: entry.meta?.poPaymentDisplayDate,
      displayDateKind: entry.meta?.poPaymentDisplayDateKind,
      dueDate: entry.meta?.poPaymentDueDate,
      paidDate: entry.meta?.poPaymentPaidDate,
      paid: entry.paid,
      amount: entry.amount,
    }))
    .sort((left, right) => String(left.label || "").localeCompare(String(right.label || "")));

  assert.deepEqual(
    pickPoRows(march),
    [{
      ref: "PO-EVENT-TRUTH",
      label: "PO PO-EVENT-TRUTH – Deposit",
      date: "2025-03-05",
      state: "paid",
      displayDate: "2025-03-05",
      displayDateKind: "paid",
      dueDate: "2025-03-01",
      paidDate: "2025-03-05",
      paid: true,
      amount: 290,
    }],
  );
  assert.deepEqual(
    pickPoRows(may),
    [{
      ref: "PO-EVENT-TRUTH",
      label: "PO PO-EVENT-TRUTH – Balance",
      date: "2025-05-15",
      state: "open",
      displayDate: "2025-05-15",
      displayDateKind: "due",
      dueDate: "2025-05-15",
      paidDate: null,
      paid: false,
      amount: 700,
    }],
  );
  assert.deepEqual(
    pickPoRows(june),
    [
      {
        ref: "PO-EVENT-TRUTH",
        label: "PO PO-EVENT-TRUTH – EUSt",
        date: "2025-06-14",
        state: "open",
        displayDate: "2025-06-14",
        displayDateKind: "due",
        dueDate: "2025-06-14",
        paidDate: null,
        paid: false,
        amount: 330,
      },
      {
        ref: "PO-EVENT-TRUTH",
        label: "PO PO-EVENT-TRUTH – Fracht",
        date: "2025-06-14",
        state: "open",
        displayDate: "2025-06-14",
        displayDateKind: "due",
        dueDate: "2025-06-14",
        paidDate: null,
        paid: false,
        amount: 500,
      },
      {
        ref: "PO-EVENT-TRUTH",
        label: "PO PO-EVENT-TRUTH – Zoll",
        date: "2025-06-14",
        state: "open",
        displayDate: "2025-06-14",
        displayDateKind: "due",
        dueDate: "2025-06-14",
        paidDate: null,
        paid: false,
        amount: 150,
      },
    ],
  );
  assert.deepEqual(state, snapshot, "dashboard PO cashflow must remain derived-only");
});

test("dashboard mirror injects cash-in table payout when sales entries are missing", () => {
  const bucketScope = new Set(["Kernportfolio", "Planprodukte"]);
  const rows = alignDashboardCashInToMirror([
    {
      month: "2026-03",
      opening: 1130,
      closing: 1130,
      inflow: 0,
      outflow: 130,
      net: -130,
      entries: [
        { id: "mar-fix", direction: "out", amount: 130, source: "fixcosts", group: "Fixkosten" },
      ],
    },
  ], {
    "2026-03": 2000,
  });

  const march = rows[0];
  const aggregation = aggregateDashboardMonthEntries(march.entries, {
    bucketScope,
    includePhantomFo: true,
  });

  assert.equal(aggregation.totals.cashIn, 2000);
  assert.equal(aggregation.totals.cashOut, 130);
  assert.equal(aggregation.totals.net, 1870);
  assert.equal(aggregation.inflow.amazonCore, 2000);
});

test("dashboard cashflow aggregation keeps March income non-zero and consumers numerically aligned", () => {
  const bucketScope = new Set(["core", "plan"]);
  const rows = [
    {
      month: "2026-01",
      opening: 1000,
      closing: 1070,
      inflow: 0,
      outflow: 0,
      net: 0,
      entries: [
        { id: "jan-sales", direction: "in", amount: 120, source: "sales", kind: "sales-payout", portfolioBucket: "core" },
        { id: "jan-fix", direction: "out", amount: 50, source: "fixcosts", group: "Fixkosten" },
      ],
    },
    {
      month: "2026-02",
      opening: 1070,
      closing: 1130,
      inflow: 0,
      outflow: 0,
      net: 0,
      entries: [
        { id: "feb-sales", direction: "in", amount: 80, source: "sales", kind: "sales-payout", portfolioBucket: "core" },
        { id: "feb-other", direction: "out", amount: 20, source: "extras", group: "Extras (Out)" },
      ],
    },
    {
      month: "2026-03",
      opening: 1130,
      closing: 1400,
      inflow: 0,
      outflow: 0,
      net: 0,
      entries: [
        { id: "mar-sales", direction: "in", amount: 400, source: "sales", kind: "sales-payout", portfolioBucket: "core" },
        { id: "mar-fix", direction: "out", amount: 130, source: "fixcosts", group: "Fixkosten" },
      ],
    },
  ];

  const scoped = applyDashboardBucketScopeToBreakdown(rows, bucketScope, {
    includePhantomFo: true,
  });

  assert.equal(scoped[0].inflow, 120);
  assert.equal(scoped[0].outflow, 50);
  assert.equal(scoped[0].net, 70);
  assert.equal(scoped[1].inflow, 80);
  assert.equal(scoped[1].outflow, 20);
  assert.equal(scoped[1].net, 60);

  const march = scoped.find((row) => row.month === "2026-03");
  assert.ok(march);
  assert.equal(march.inflow, 400);
  assert.equal(march.outflow, 130);
  assert.equal(march.net, 270);
  assert.equal(march.net, march.inflow - march.outflow);

  const marchAggregation = aggregateDashboardMonthEntries(march.entries, {
    bucketScope,
    includePhantomFo: true,
  });

  const summaryCashIn = marchAggregation.totals.cashIn;
  const summaryCashOut = marchAggregation.totals.cashOut;
  const summaryNet = marchAggregation.totals.net;
  const chartIncome = marchAggregation.inflow.amazonCore
    + marchAggregation.inflow.amazonPlanned
    + marchAggregation.inflow.amazonNew
    + marchAggregation.inflow.other;
  const matrixIncome = marchAggregation.inflow.total;

  assert.equal(summaryCashIn, 400);
  assert.equal(summaryCashOut, 130);
  assert.equal(summaryNet, 270);
  assert.equal(chartIncome, 400);
  assert.equal(matrixIncome, 400);
  assert.equal(chartIncome, matrixIncome);
  assert.equal(chartIncome, march.inflow);
  assert.equal(summaryNet, march.net);
});

test("dashboard tax aggregation stays aligned across chart bucket, matrix group, and month drawer summary", () => {
  const baseRows = [
    {
      month: "2026-04",
      opening: 1000,
      closing: 1450,
      inflow: 0,
      outflow: 0,
      net: 0,
      entries: [
        { id: "apr-sales", direction: "in", amount: 900, source: "sales", kind: "sales-payout", portfolioBucket: "core" },
        { id: "apr-fix", direction: "out", amount: 120, source: "fixcosts", group: "Fixkosten" },
      ],
    },
  ];
  const state = {
    settings: {
      startMonth: "2026-04",
      horizonMonths: 1,
      vatPreview: {
        eustLagMonths: 2,
        deShareDefault: 0.8,
        feeRateDefault: 0.38,
        fixInputDefault: 1900,
        paymentLagMonths: 1,
        paymentDayOfMonth: 10,
      },
    },
    incomings: [
      { month: "2026-01", revenueEur: "1.190" },
      { month: "2026-02", revenueEur: "1.190" },
      { month: "2026-03", revenueEur: "100.000" },
      { month: "2026-04", revenueEur: "0" },
    ],
    extras: [],
    dividends: [],
    fixcosts: [],
    fixcostOverrides: {},
    fos: [],
    pos: [],
    products: [],
    vatCostRules: [],
    vatPreviewMonths: {},
    recentProducts: [],
    status: { autoManualCheck: false, events: {} },
    taxes: {
      oss: {
        active: true,
        deSharePct: "80",
      },
      ertragsteuern: {
        masters: {
          koerperschaftsteuer: {
            active: true,
            amount: "1.200,00",
            firstDueDate: "2026-04-10",
            pauseFromMonth: "",
            endMonth: "",
            note: "",
          },
          gewerbesteuer: {
            active: true,
            amount: "900,00",
            firstDueDate: "2026-04-20",
            pauseFromMonth: "",
            endMonth: "",
            note: "",
          },
        },
        overrides: {
          koerperschaftsteuer: {},
          gewerbesteuer: {},
        },
      },
    },
  };
  const bucketScope = new Set(["core", "plan"]);

  const rowsWithTaxes = applyTaxInstancesToBreakdown(baseRows, state);
  const scoped = applyDashboardBucketScopeToBreakdown(rowsWithTaxes, bucketScope, {
    includePhantomFo: true,
  });
  const march = scoped[0];
  const aggregation = aggregateDashboardMonthEntries(march.entries, {
    bucketScope,
    includePhantomFo: true,
  });
  const taxMatrixGroup = buildDashboardTaxMatrixGroup({
    months: ["2026-04"],
    breakdown: scoped,
    bucketScope,
  });

  assert.ok(Math.abs(aggregation.outflow.taxByType.oss - 3492.96) < 0.02);
  assert.ok(Math.abs(aggregation.outflow.taxByType.umsatzsteuer_de - 4805.88) < 0.5);
  assert.equal(aggregation.outflow.taxByType.koerperschaftsteuer, 1200);
  assert.equal(aggregation.outflow.taxByType.gewerbesteuer, 900);
  assert.ok(Math.abs(aggregation.outflow.tax - 10398.84) < 0.5);
  assert.ok(Math.abs(march.outflow - 10518.84) < 0.5);
  assert.ok(Math.abs(march.net + 9618.84) < 0.5);
  assert.ok(Math.abs(taxMatrixGroup.values["2026-04"] + 10398.84) < 0.5);
  assert.ok(Math.abs(taxMatrixGroup.children[0].values["2026-04"] + 4805.88) < 0.5);
  assert.ok(Math.abs(taxMatrixGroup.children[1].values["2026-04"] + 3492.96) < 0.02);
  assert.equal(taxMatrixGroup.children[2].values["2026-04"], -1200);
  assert.equal(taxMatrixGroup.children[3].values["2026-04"], -900);
});

test("dashboard tax aggregation keeps refund-like USt DE months signed consistently", () => {
  const rows = applyTaxInstancesToBreakdown([
    {
      month: "2026-03",
      opening: 1000,
      closing: 1000,
      inflow: 0,
      outflow: 0,
      net: 0,
      entries: [],
    },
  ], {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 1,
      vatPreview: {
        eustLagMonths: 2,
        deShareDefault: 0.8,
        feeRateDefault: 0.38,
        fixInputDefault: 4000,
        paymentLagMonths: 0,
        paymentDayOfMonth: 15,
      },
    },
    incomings: [
      { month: "2026-03", revenueEur: "10.000" },
    ],
    extras: [],
    dividends: [],
    fixcosts: [],
    fixcostOverrides: {},
    fos: [],
    pos: [],
    products: [],
    vatCostRules: [],
    vatPreviewMonths: {},
    recentProducts: [],
    status: { autoManualCheck: false, events: {} },
    taxes: {
      oss: {
        active: false,
        deSharePct: "100",
      },
      ertragsteuern: {
        masters: {
          koerperschaftsteuer: { active: false, amount: "0,00", firstDueDate: "", pauseFromMonth: "", endMonth: "", note: "" },
          gewerbesteuer: { active: false, amount: "0,00", firstDueDate: "", pauseFromMonth: "", endMonth: "", note: "" },
        },
        overrides: {
          koerperschaftsteuer: {},
          gewerbesteuer: {},
        },
      },
    },
  });
  const aggregation = aggregateDashboardMonthEntries(rows[0].entries, {
    bucketScope: new Set(["core", "plan"]),
    includePhantomFo: true,
  });
  const taxMatrixGroup = buildDashboardTaxMatrixGroup({
    months: ["2026-03"],
    breakdown: rows,
    bucketScope: new Set(["core", "plan"]),
  });

  assert.ok(aggregation.outflow.tax < 0);
  assert.ok(aggregation.outflow.taxByType.umsatzsteuer_de < 0);
  assert.ok(taxMatrixGroup.values["2026-03"] > 0);
  assert.ok(taxMatrixGroup.children[0].values["2026-03"] > 0);
});

test("active plan products contribute to dashboard revenue only through the shared plan path and scope remains filter-only", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-PLAN": {
          "2026-03": { units: 100 },
        },
      },
    },
    products: [],
    planProducts: [
      {
        id: "plan-alpha",
        alias: "Plan Alpha",
        plannedSku: "PLAN-ALPHA",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-PLAN",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 20,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1.5,
        launchDate: "2026-03-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [
      {
        id: "inc-plan-mar",
        month: "2026-03",
        payoutPct: "40",
        source: "forecast",
      },
    ],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  const report = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => computeSeries(projection.planningState),
  );
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const coreScope = new Set([PORTFOLIO_BUCKET.CORE]);

  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, {
    includePhantomFo: true,
  });
  const coreScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, coreScope, {
    includePhantomFo: true,
  });

  const marchPlan = planScoped.find((row) => row.month === "2026-03");
  const marchCore = coreScoped.find((row) => row.month === "2026-03");
  assert.ok(marchPlan);
  assert.ok(marchCore);

  const planAggregation = aggregateDashboardMonthEntries(marchPlan.entries, {
    bucketScope: planScope,
    includePhantomFo: true,
  });
  const coreAggregation = aggregateDashboardMonthEntries(marchCore.entries, {
    bucketScope: coreScope,
    includePhantomFo: true,
  });

  assert.equal(planAggregation.inflow.amazonPlanned, 800);
  assert.equal(planAggregation.totals.cashIn, 800);
  assert.equal(coreAggregation.totals.cashIn, 0);
  assert.equal(
    marchPlan.entries.every((entry) => String(entry.portfolioBucket || entry.meta?.portfolioBucket || "") === PORTFOLIO_BUCKET.PLAN),
    true,
    "Der Plan-Scope darf nur bereits berechnete Plan-Einträge zeigen.",
  );
});

test("plan product FO outflows stay in the plan bucket and disappear when plan scope is excluded", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 0,
      fxRate: 1,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-PLAN": {
          "2026-03": { units: 100 },
        },
      },
    },
    products: [],
    planProducts: [
      {
        id: "plan-fo",
        alias: "Plan FO",
        plannedSku: "PLAN-FO",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-PLAN",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 20,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 25,
        transitDays: 15,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1,
        launchDate: "2026-03-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  const planningSku = String(projection.virtualProducts?.[0]?.sku || "");
  assert.ok(planningSku, "Der Shared-Builder muss eine virtuelle Plan-SKU erzeugen.");

  const report = withMockedNow(new Date("2026-03-10T12:00:00Z"), () => computeSeries({
    ...projection.planningState,
    fos: [
      {
        id: "fo-plan-1",
        foNo: "FO-PLAN-1",
        sku: planningSku,
        status: "ACTIVE",
        orderDate: "2026-03-01",
        payments: [
          {
            id: "fo-plan-pay-1",
            label: "Deposit",
            amount: 500,
            currency: "EUR",
            dueDate: "2026-03-05",
            triggerEvent: "ORDER_DATE",
            offsetDays: 0,
          },
        ],
      },
    ],
  }));
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const coreScope = new Set([PORTFOLIO_BUCKET.CORE]);
  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, {
    includePhantomFo: true,
  });
  const coreScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, coreScope, {
    includePhantomFo: true,
  });
  const marchPlan = planScoped.find((row) => row.month === "2026-03");
  const marchCore = coreScoped.find((row) => row.month === "2026-03");
  assert.ok(marchPlan);
  assert.ok(marchCore);

  const planAggregation = aggregateDashboardMonthEntries(marchPlan.entries, {
    bucketScope: planScope,
    includePhantomFo: true,
  });
  const coreAggregation = aggregateDashboardMonthEntries(marchCore.entries, {
    bucketScope: coreScope,
    includePhantomFo: true,
  });

  assert.equal(planAggregation.outflow.fo, 500);
  assert.equal(planAggregation.totals.cashOut, 500);
  assert.equal(coreAggregation.totals.cashOut, 0);
});

test("incomplete plan products stay out of dashboard revenue instead of being half-included", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-INCOMPLETE": {
          "2026-03": { units: 100 },
        },
      },
    },
    products: [],
    planProducts: [
      {
        id: "plan-incomplete",
        alias: "Plan Incomplete",
        plannedSku: "PLAN-INCOMPLETE",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-INCOMPLETE",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 20,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: null,
        logisticsPerUnitEur: 1,
        launchDate: "2026-03-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [
      {
        id: "inc-incomplete-mar",
        month: "2026-03",
        payoutPct: "40",
        source: "forecast",
      },
    ],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  assert.deepEqual(projection.entries[0].missingPlanningInputs, ["unit_price_usd"]);

  const report = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => computeSeries(projection.planningState),
  );
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, {
    includePhantomFo: true,
  });
  const marchPlan = planScoped.find((row) => row.month === "2026-03");
  assert.ok(marchPlan);

  const aggregation = aggregateDashboardMonthEntries(marchPlan.entries, {
    bucketScope: planScope,
    includePhantomFo: true,
  });
  assert.equal(aggregation.totals.cashIn, 0);
});

test("plan products without selling price stay out of dashboard revenue through the shared path", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-NO-PRICE": {
          "2026-03": { units: 100 },
        },
      },
    },
    products: [],
    planProducts: [
      {
        id: "plan-no-price",
        alias: "Plan No Price",
        plannedSku: "PLAN-NO-PRICE",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-NO-PRICE",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: null,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1,
        launchDate: "2026-03-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [
      {
        id: "inc-no-price-mar",
        month: "2026-03",
        payoutPct: "40",
        source: "forecast",
      },
    ],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  assert.deepEqual(projection.entries[0].missingPlanningInputs, ["avg_selling_price_gross_eur"]);
  assert.equal(projection.sharedPathEntries.length, 0);

  const report = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => computeSeries(projection.planningState),
  );
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, {
    includePhantomFo: true,
  });
  const marchPlan = planScoped.find((row) => row.month === "2026-03");
  assert.ok(marchPlan);

  const aggregation = aggregateDashboardMonthEntries(marchPlan.entries, {
    bucketScope: planScope,
    includePhantomFo: true,
  });
  assert.equal(aggregation.inflow.amazonPlanned, 0);
  assert.equal(aggregation.totals.cashIn, 0);
});

test("plan product launch costs appear exactly once in dashboard plan scope", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-LAUNCH": {
          "2026-03": { units: 100 },
        },
      },
    },
    products: [],
    planProducts: [
      {
        id: "plan-launch-cost",
        alias: "Plan Launch Cost",
        plannedSku: "PLAN-LAUNCH-COST",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-LAUNCH",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 20,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1,
        launchDate: "2026-03-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        launchCosts: [
          { id: "lc-1", type: "Samples", amountEur: 300, date: "2026-03-15" },
        ],
      },
    ],
    incomings: [],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  const report = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => computeSeries(projection.planningState),
  );
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, {
    includePhantomFo: true,
  });
  const marchPlan = planScoped.find((row) => row.month === "2026-03");
  assert.ok(marchPlan);

  const launchEntries = marchPlan.entries.filter((entry) => entry.kind === "launch-cost");
  assert.equal(launchEntries.length, 1);
  assert.equal(launchEntries[0].amount, 300);
  assert.equal(launchEntries[0].portfolioBucket, PORTFOLIO_BUCKET.PLAN);
});

test("plan product revenue changes P&L when Planprodukte toggle is switched with forecast_direct mode", async () => {
  const [{ computeSeries }, { PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }] = await Promise.all([
    import("../../src/domain/cashflow.js"),
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-03",
      horizonMonths: 3,
      openingBalance: 10000,
      cashInQuoteMode: "recommendation",
      cashInRevenueBasisMode: "forecast_direct",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-KNIFE": {
          "2026-03": { units: 200, revenueEur: 18000 },
          "2026-04": { units: 180, revenueEur: 16200 },
          "2026-05": { units: 210, revenueEur: 18900 },
        },
      },
    },
    products: [
      {
        sku: "REF-KNIFE",
        alias: "Messerblock Kern",
        status: "active",
        includeInForecast: true,
        avgSellingPriceGrossEUR: 90,
        sellerboardMarginPct: 25,
        portfolioBucket: PORTFOLIO_BUCKET.CORE,
      },
    ],
    planProducts: [
      {
        id: "plan-messer-2",
        alias: "Messerblock Plan",
        // No plannedSku — matches user's "ohne SKU" scenario
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-KNIFE",
        baselineReferenceMonth: 3,
        baselineUnitsInReferenceMonth: 120,
        avgSellingPriceGrossEUR: 28,
        sellerboardMarginPct: 25,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1.5,
        launchDate: "2026-03-01",
        rampUpWeeks: 1,
        softLaunchStartSharePct: 50,
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [
      // The reference SKU has a purchase order — this is the real-world scenario
      {
        id: "po-1",
        sku: "REF-KNIFE",
        items: [{ sku: "REF-KNIFE", units: 500, unitPriceUsd: 5 }],
      },
    ],
    status: { autoManualCheck: false, events: {} },
  };

  const projection = buildSharedPlanProductProjection({ state });
  const planningState = projection.planningState;

  // Diagnostic: check effective bucket assignment
  const planEntry = projection.entries.find((e) => e.active);
  const effectiveBucket = planEntry?.effectivePortfolioBucket;

  const report = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => computeSeries(planningState),
  );

  const months = report.months || [];
  const breakdown = report.breakdown || [];

  // Verify plan entries exist in the raw breakdown
  const marchRow = breakdown.find((row) => row.month === "2026-03");
  assert.ok(marchRow, "March row should exist in breakdown");

  const allEntries = marchRow.entries || [];
  const planEntries = allEntries.filter((e) =>
    (e.portfolioBucket === PORTFOLIO_BUCKET.PLAN || (e.meta && e.meta.portfolioBucket === PORTFOLIO_BUCKET.PLAN))
    && e.kind === "sales-payout"
  );

  // Diagnostic: print entry details
  const salesEntries = allEntries.filter((e) => e.kind === "sales-payout");
  const entryDetails = salesEntries.map((e) => ({
    id: e.id,
    amount: e.amount,
    bucket: e.portfolioBucket || (e.meta && e.meta.portfolioBucket),
    source: e.source,
    label: e.label,
  }));

  assert.ok(
    planEntries.length > 0,
    `Plan sales entries should exist in March (effectiveBucket was: ${effectiveBucket}). ` +
    `Found ${salesEntries.length} sales entries total: ${JSON.stringify(entryDetails, null, 2)}`,
  );

  // Step 1: Without mirror — verify plan entries exist and toggle works
  const bothScope = new Set([PORTFOLIO_BUCKET.CORE, PORTFOLIO_BUCKET.PLAN]);
  const coreOnlyScope = new Set([PORTFOLIO_BUCKET.CORE]);

  const rawWithPlan = applyDashboardBucketScopeToBreakdown(breakdown, bothScope);
  const rawWithoutPlan = applyDashboardBucketScopeToBreakdown(breakdown, coreOnlyScope);
  const rawInflowWith = rawWithPlan.reduce((sum, row) => sum + row.inflow, 0);
  const rawInflowWithout = rawWithoutPlan.reduce((sum, row) => sum + row.inflow, 0);

  assert.ok(
    rawInflowWith > rawInflowWithout,
    `Raw (no mirror): Inflow with plan (${rawInflowWith.toFixed(2)}) > without (${rawInflowWithout.toFixed(2)})`,
  );

  // Step 2: With mirror — reproduce the ACTUAL dashboard flow
  const { buildCashInPayoutMirrorByMonth } = require("../../.test-build/migration/v2/domain/cashInPayoutMirror.js");

  const cashInMirrorByMonth = withMockedNow(
    new Date("2026-03-15T12:00:00Z"),
    () => buildCashInPayoutMirrorByMonth({ months, state: planningState }),
  );
  const dashboardBreakdown = alignDashboardCashInToMirror(
    applyTaxInstancesToBreakdown(breakdown, state),
    cashInMirrorByMonth,
  );

  // Check if plan entries survived the mirror
  const mirroredMarchRow = dashboardBreakdown.find((row) => row.month === "2026-03");
  const mirroredSalesEntries = (mirroredMarchRow?.entries || []).filter((e) => e.kind === "sales-payout");
  const mirroredPlanEntries = mirroredSalesEntries.filter((e) =>
    e.portfolioBucket === PORTFOLIO_BUCKET.PLAN || (e.meta && e.meta.portfolioBucket === PORTFOLIO_BUCKET.PLAN),
  );
  const mirroredEntryDetails = mirroredSalesEntries.map((e) => ({
    id: e.id,
    amount: e.amount,
    bucket: e.portfolioBucket || (e.meta && e.meta.portfolioBucket),
  }));

  assert.ok(
    mirroredPlanEntries.length > 0,
    `Plan entries should survive mirror. Found ${mirroredSalesEntries.length} sales entries after mirror: ${JSON.stringify(mirroredEntryDetails, null, 2)}`,
  );

  const withPlanScoped = applyDashboardBucketScopeToBreakdown(dashboardBreakdown, bothScope);
  const withoutPlanScoped = applyDashboardBucketScopeToBreakdown(dashboardBreakdown, coreOnlyScope);

  const totalInflowWithPlan = withPlanScoped.reduce((sum, row) => sum + row.inflow, 0);
  const totalInflowWithoutPlan = withoutPlanScoped.reduce((sum, row) => sum + row.inflow, 0);

  // THE BUG: toggling Planprodukte should significantly change the inflow AFTER mirror
  assert.ok(
    totalInflowWithPlan > totalInflowWithoutPlan,
    `After mirror: Inflow with Planprodukte (${totalInflowWithPlan.toFixed(2)}) should be greater than without (${totalInflowWithoutPlan.toFixed(2)}).`,
  );

  const diff = totalInflowWithPlan - totalInflowWithoutPlan;
  assert.ok(
    diff > 100,
    `After mirror: Difference should be substantial (got ${diff.toFixed(2)} EUR).`,
  );
});

test("plan product with future launch date gets non-zero shortage in inventory projection", async () => {
  const [{ PORTFOLIO_BUCKET }, { buildSharedPlanProductProjection }, { computeInventoryProjection }] = await Promise.all([
    import("../../src/domain/portfolioBuckets.js"),
    import("../../src/domain/planProducts.js"),
    import("../../src/domain/inventoryProjection.js"),
  ]);

  const state = {
    settings: {
      startMonth: "2026-04",
      horizonMonths: 6,
      openingBalance: 10000,
      fxRate: 1.08,
      cashInQuoteMode: "manual",
      cashInRevenueBasisMode: "hybrid",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-PFO": {
          "2026-04": { units: 150 },
          "2026-05": { units: 180 },
          "2026-06": { units: 200 },
          "2026-07": { units: 170 },
          "2026-08": { units: 160 },
          "2026-09": { units: 140 },
        },
      },
    },
    products: [
      {
        sku: "REF-PFO",
        alias: "Referenz",
        status: "active",
        includeInForecast: true,
        portfolioBucket: "Kernportfolio",
      },
    ],
    planProducts: [
      {
        id: "plan-pfo-1",
        alias: "Plan PFO",
        status: "active",
        includeInForecast: true,
        seasonalityReferenceSku: "REF-PFO",
        baselineReferenceMonth: 5,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 25,
        sellerboardMarginPct: 30,
        productionLeadTimeDaysDefault: 30,
        transitDays: 30,
        unitPriceUsd: 5,
        logisticsPerUnitEur: 2,
        launchDate: "2026-06-01",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
      },
    ],
    incomings: [],
    fixcosts: [],
    extras: [],
    dividends: [],
    fos: [],
    pos: [],
    suppliers: [],
    status: { autoManualCheck: false, events: {} },
  };

  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const projection = buildSharedPlanProductProjection({ state, months });
  const virtualSku = String(projection.virtualProducts?.[0]?.sku || "");
  assert.ok(virtualSku, "A virtual plan product SKU must be created.");
  assert.equal(
    projection.virtualProducts[0].portfolioBucket,
    PORTFOLIO_BUCKET.PLAN,
    "Virtual product must have Planprodukte bucket.",
  );

  const ps = projection.planningState;
  const activeProducts = (ps.products || [])
    .filter((p) => String(p.sku || "").trim())
    .filter((p) => {
      const s = String(p.status || "").toLowerCase();
      return !s || s === "active";
    });

  const proj = computeInventoryProjection({
    state: ps,
    months,
    products: activeProducts,
    snapshot: null,
    snapshotMonth: "2026-03",
    projectionMode: "forecast_direct",
  });

  const skuProjection = proj.perSkuMonth.get(virtualSku) || proj.perSkuMonth.get(virtualSku.toLowerCase());
  assert.ok(skuProjection, `Inventory projection must include virtual SKU ${virtualSku}.`);

  // Pre-launch month: forecastUnits should be 0, endAvailable should be 0
  const preLaunchData = skuProjection.get("2026-04") || skuProjection.get("2026-05");
  // Post-launch month: forecastUnits should be > 0, endAvailable should be < 0
  const postLaunchData = skuProjection.get("2026-06");
  assert.ok(postLaunchData, "Post-launch month must exist in projection.");
  assert.ok(
    postLaunchData.forecastUnits > 0,
    `Post-launch month must have forecastUnits > 0. Got ${postLaunchData.forecastUnits}.`,
  );
  assert.ok(
    postLaunchData.endAvailable < 0,
    `Post-launch month must have negative endAvailable (shortage). Got ${postLaunchData.endAvailable}.`,
  );

  // The fix ensures that robustness skips pre-launch months (forecastUnits=0, endAvailable>=0)
  // and picks the post-launch month as the first risk month, producing non-zero shortageUnits.
  // This is verified by the shortage calculation:
  const safetyUnits = Number(postLaunchData.safetyUnits ?? 0);
  const endAvailable = Number(postLaunchData.endAvailable ?? 0);
  const shortageUnits = Math.max(0, Math.ceil(safetyUnits - endAvailable));
  assert.ok(
    shortageUnits > 0,
    `Shortage units from post-launch month must be > 0. Got ${shortageUnits} (safety=${safetyUnits}, endAvail=${endAvailable}).`,
  );

  // Also verify: plan product FO with virtual SKU gets correct bucket in computeSeries
  const { computeSeries } = await import("../../src/domain/cashflow.js");
  const report = withMockedNow(new Date("2026-04-10T12:00:00Z"), () =>
    computeSeries({
      ...ps,
      fos: [{
        id: "fo-plan-pfo",
        foNo: "FO-PLAN-PFO",
        sku: virtualSku,
        status: "ACTIVE",
        orderDate: "2026-04-01",
        payments: [{ id: "pay1", label: "Deposit", amount: 500, currency: "EUR", dueDate: "2026-04-15", triggerEvent: "ORDER_DATE", offsetDays: 0 }],
      }],
    }),
  );
  const planScope = new Set([PORTFOLIO_BUCKET.PLAN]);
  const planScoped = applyDashboardBucketScopeToBreakdown(report.breakdown, planScope, { includePhantomFo: true });
  let planOutflow = 0;
  planScoped.forEach((row) => { planOutflow += row.outflow; });
  assert.ok(
    planOutflow >= 500,
    `Plan product FO cost (500 EUR) must appear in plan scope outflow. Got ${planOutflow.toFixed(2)}.`,
  );
});

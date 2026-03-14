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

test("dashboard PO cashflow uses PO payment truth for paid month bucketing and overdue remainder without mutating state", async () => {
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
    payments: [],
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
  assert.equal(januaryAggregation.outflow.po, 60, "only the unpaid remainder should stay in the due month");
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
    [{ ref: "PO-PARTIAL", state: "overdue", paid: false, amount: 60 }],
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
  assert.deepEqual(state, snapshot, "dashboard cashflow must stay derived-only and must not persist dashboard payment state");
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

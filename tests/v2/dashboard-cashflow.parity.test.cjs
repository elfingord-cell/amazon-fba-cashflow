const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateDashboardMonthEntries,
  alignDashboardCashInToMirror,
  applyTaxInstancesToBreakdown,
  applyDashboardBucketScopeToBreakdown,
  buildDashboardTaxMatrixGroup,
} = require("../../.test-build/migration/v2/domain/dashboardCashflow.js");

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

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateDashboardMonthEntries,
  applyDashboardBucketScopeToBreakdown,
} = require("../../.test-build/migration/v2/domain/dashboardCashflow.js");

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

import test from "node:test";
import assert from "node:assert/strict";

import { computeSeries } from "./cashflow.js";
import { buildSharedPlanProductProjection } from "./planProducts.js";
import { PORTFOLIO_BUCKET } from "./portfolioBuckets.js";

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function findMonth(report, month) {
  return (report.series || []).find((row) => row.month === month) || null;
}

test("includeInForecast gates forecast payout and PO events", () => {
  const month = currentMonthKey();
  const state = {
    settings: {
      startMonth: month,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      fxRate: 1,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-A": {
          [month]: { revenueEur: 1000 },
        },
        "SKU-B": {
          [month]: { revenueEur: 500 },
        },
      },
    },
    incomings: [{ month, revenueEur: 0, payoutPct: 100 }],
    products: [
      {
        sku: "SKU-A",
        alias: "A",
        status: "active",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        includeInForecast: false,
      },
      {
        sku: "SKU-B",
        alias: "B",
        status: "active",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        includeInForecast: true,
      },
    ],
    pos: [
      {
        id: "po-a",
        poNo: "PO-A",
        sku: "SKU-A",
        units: 100,
        goodsEur: 200,
        orderDate: `${month}-01`,
        milestones: [
          {
            id: "po-a-ms",
            label: "Deposit",
            percent: 100,
            anchor: "ORDER_DATE",
            lagDays: 9,
          },
        ],
        paymentLog: {},
      },
    ],
    fos: [],
    extras: [],
    dividends: [],
  };

  const report = computeSeries(state);
  const row = findMonth(report, month);
  assert.ok(row, "month row should exist");

  const salesEntries = row.entries.filter((entry) => entry.kind === "sales-payout" && entry.source === "sales");
  assert.equal(salesEntries.length, 1);
  assert.equal(salesEntries[0].amount, 300);
  assert.equal(salesEntries[0].portfolioBucket, PORTFOLIO_BUCKET.PLAN);

  const poEntries = row.entries.filter((entry) => entry.source === "po");
  assert.equal(poEntries.length, 0);
});

test("PO existence forces effective core bucket in payout and PO events", () => {
  const month = currentMonthKey();
  const state = {
    settings: {
      startMonth: month,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      fxRate: 1,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-A": {
          [month]: { revenueEur: 1000 },
        },
      },
    },
    incomings: [{ month, revenueEur: 0, payoutPct: 100 }],
    products: [
      {
        sku: "SKU-A",
        alias: "A",
        status: "active",
        portfolioBucket: PORTFOLIO_BUCKET.IDEAS,
        includeInForecast: true,
      },
    ],
    pos: [
      {
        id: "po-a",
        poNo: "PO-A",
        sku: "SKU-A",
        units: 100,
        goodsEur: 150,
        orderDate: `${month}-01`,
        milestones: [
          {
            id: "po-a-ms",
            label: "Deposit",
            percent: 100,
            anchor: "ORDER_DATE",
            lagDays: 9,
          },
        ],
        paymentLog: {},
      },
    ],
    fos: [],
    extras: [],
    dividends: [],
  };

  const report = computeSeries(state);
  const row = findMonth(report, month);
  assert.ok(row, "month row should exist");

  const salesEntry = row.entries.find((entry) => entry.kind === "sales-payout" && entry.source === "sales");
  assert.ok(salesEntry, "sales entry should exist");
  assert.equal(salesEntry.portfolioBucket, PORTFOLIO_BUCKET.CORE);

  const poEntry = row.entries.find((entry) => entry.source === "po");
  assert.ok(poEntry, "po entry should exist");
  assert.equal(poEntry.portfolioBucket, PORTFOLIO_BUCKET.CORE);
});

test("launch costs are emitted as outflows in product bucket and respect include gate", () => {
  const month = currentMonthKey();
  const state = {
    settings: {
      startMonth: month,
      horizonMonths: 1,
      openingBalance: 0,
      cashInMode: "basis",
      fxRate: 1,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [],
    products: [
      {
        sku: "SKU-I",
        alias: "Idea Product",
        status: "active",
        portfolioBucket: PORTFOLIO_BUCKET.IDEAS,
        includeInForecast: true,
        launchCosts: [
          { id: "lc-1", type: "Fotografie", amountEur: 300, date: `${month}-15`, note: "Shoot" },
        ],
      },
      {
        sku: "SKU-X",
        alias: "Excluded",
        status: "active",
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        includeInForecast: false,
        launchCosts: [
          { id: "lc-2", type: "Samples", amountEur: 200, date: `${month}-18` },
        ],
      },
    ],
    planProducts: [],
    pos: [],
    fos: [],
    extras: [],
    dividends: [],
  };

  const report = computeSeries(state);
  const row = findMonth(report, month);
  assert.ok(row, "month row should exist");

  const launchEntries = row.entries.filter((entry) => entry.kind === "launch-cost");
  assert.equal(launchEntries.length, 1);
  assert.equal(launchEntries[0].amount, 300);
  assert.equal(launchEntries[0].portfolioBucket, PORTFOLIO_BUCKET.IDEAS);
});

test("plan product without selling price stays out of shared-path revenue", () => {
  const month = currentMonthKey();
  const referenceMonth = Number(month.slice(5, 7));
  const state = {
    settings: {
      startMonth: month,
      horizonMonths: 1,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-PLAN": {
          [month]: { units: 100 },
        },
      },
    },
    incomings: [{ id: `inc-${month}`, month, payoutPct: 40, source: "forecast" }],
    products: [],
    planProducts: [
      {
        id: "plan-no-price",
        alias: "Plan No Price",
        plannedSku: "PLAN-NO-PRICE",
        status: "active",
        includeInForecast: true,
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        seasonalityReferenceSku: "REF-PLAN",
        baselineReferenceMonth: referenceMonth,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: null,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1,
        launchDate: `${month}-01`,
      },
    ],
    pos: [],
    fos: [],
    extras: [],
    dividends: [],
  };

  const projection = buildSharedPlanProductProjection({ state, months: [month] });
  assert.equal(projection.sharedPathEntries.length, 0);
  assert.deepEqual(projection.entries[0]?.missingPlanningInputs, ["avg_selling_price_gross_eur"]);

  const report = computeSeries(projection.planningState);
  const row = findMonth(report, month);
  assert.ok(row, "month row should exist");
  const salesPlanEntries = row.entries.filter((entry) => entry.source === "sales-plan");
  assert.equal(salesPlanEntries.length, 0);
});

test("virtual plan products do not duplicate launch costs", () => {
  const month = currentMonthKey();
  const referenceMonth = Number(month.slice(5, 7));
  const state = {
    settings: {
      startMonth: month,
      horizonMonths: 1,
      openingBalance: 0,
      cashInQuoteMode: "manual",
      cashInCalibrationEnabled: false,
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "REF-LAUNCH": {
          [month]: { units: 100 },
        },
      },
    },
    incomings: [{ id: `inc-${month}`, month, payoutPct: 40, source: "forecast" }],
    products: [],
    planProducts: [
      {
        id: "plan-launch",
        alias: "Plan Launch",
        plannedSku: "PLAN-LAUNCH",
        status: "active",
        includeInForecast: true,
        portfolioBucket: PORTFOLIO_BUCKET.PLAN,
        seasonalityReferenceSku: "REF-LAUNCH",
        baselineReferenceMonth: referenceMonth,
        baselineUnitsInReferenceMonth: 100,
        avgSellingPriceGrossEUR: 20,
        productionLeadTimeDaysDefault: 20,
        transitDays: 20,
        unitPriceUsd: 4,
        logisticsPerUnitEur: 1,
        launchDate: `${month}-01`,
        launchCosts: [
          { id: "lc-1", type: "Samples", amountEur: 300, date: `${month}-15` },
        ],
      },
    ],
    pos: [],
    fos: [],
    extras: [],
    dividends: [],
  };

  const projection = buildSharedPlanProductProjection({ state, months: [month] });
  assert.equal(projection.virtualProducts.length, 1);

  const report = computeSeries(projection.planningState);
  const row = findMonth(report, month);
  assert.ok(row, "month row should exist");
  const launchEntries = row.entries.filter((entry) => entry.kind === "launch-cost");
  assert.equal(launchEntries.length, 1);
  assert.equal(launchEntries[0].amount, 300);
  assert.equal(launchEntries[0].sourceTab, "#plan-products");
  assert.equal(launchEntries[0].portfolioBucket, PORTFOLIO_BUCKET.PLAN);
});

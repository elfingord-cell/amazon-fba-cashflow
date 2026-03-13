import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOssQuarterPreview,
  buildMonthlyTaxSummary,
  DASHBOARD_TAX_TYPE_CONFIG,
  expandOssTaxInstances,
  expandTaxInstances,
  expandVatTaxInstances,
} from "./taxPlanner.js";

function buildState() {
  return {
    settings: {
      startMonth: "2026-01",
      horizonMonths: 9,
      openingBalance: "0",
      vatPreview: {
        eustLagMonths: 2,
        deShareDefault: 0.8,
        feeRateDefault: 0.38,
        fixInputDefault: 0,
        paymentLagMonths: 1,
        paymentDayOfMonth: 10,
      },
    },
    incomings: [],
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
          koerperschaftsteuer: {
            active: true,
            amount: "1.000,00",
            firstDueDate: "2026-02-10",
            pauseFromMonth: "",
            endMonth: "",
            note: "KSt Basis",
          },
          gewerbesteuer: {
            active: true,
            amount: "800,00",
            firstDueDate: "2026-03-15",
            pauseFromMonth: "",
            endMonth: "",
            note: "GewSt Basis",
          },
        },
        overrides: {
          koerperschaftsteuer: {},
          gewerbesteuer: {},
        },
      },
    },
  };
}

test("expandTaxInstances generates quarterly payment months for Körperschaftsteuer and Gewerbesteuer", () => {
  const instances = expandTaxInstances(buildState());
  const compact = instances.map((entry) => ({
    taxType: entry.taxType,
    month: entry.month,
    dueDateIso: entry.dueDateIso,
    amount: entry.amount,
  }));

  assert.deepEqual(compact, [
    { taxType: "koerperschaftsteuer", month: "2026-02", dueDateIso: "2026-02-10", amount: 1000 },
    { taxType: "gewerbesteuer", month: "2026-03", dueDateIso: "2026-03-15", amount: 800 },
    { taxType: "koerperschaftsteuer", month: "2026-05", dueDateIso: "2026-05-10", amount: 1000 },
    { taxType: "gewerbesteuer", month: "2026-06", dueDateIso: "2026-06-15", amount: 800 },
    { taxType: "koerperschaftsteuer", month: "2026-08", dueDateIso: "2026-08-10", amount: 1000 },
    { taxType: "gewerbesteuer", month: "2026-09", dueDateIso: "2026-09-15", amount: 800 },
  ]);
});

test("tax instance overrides replace the scheduled month without creating duplicates", () => {
  const state = buildState();
  state.taxes.ertragsteuern.overrides.koerperschaftsteuer["2026-05"] = {
    active: true,
    amount: "1.250,00",
    dueDate: "2026-05-20",
    note: "Angepasst",
  };
  state.taxes.ertragsteuern.overrides.gewerbesteuer["2026-06"] = {
    active: false,
    amount: "",
    dueDate: "",
    note: "Ausgesetzt",
  };

  const instances = expandTaxInstances(state);
  const mayInstances = instances.filter((entry) => entry.month === "2026-05" && entry.taxType === "koerperschaftsteuer");
  const juneTradeInstances = instances.filter((entry) => entry.month === "2026-06" && entry.taxType === "gewerbesteuer");

  assert.equal(mayInstances.length, 1);
  assert.equal(mayInstances[0].amount, 1250);
  assert.equal(mayInstances[0].dueDateIso, "2026-05-20");
  assert.equal(mayInstances[0].note, "Angepasst");
  assert.equal(juneTradeInstances.length, 0);

  const monthlySummary = buildMonthlyTaxSummary(instances, ["2026-05", "2026-06"]);
  assert.equal(monthlySummary.get("2026-05")?.total, 1250);
  assert.equal(monthlySummary.get("2026-06")?.total, 0);
});

test("expandVatTaxInstances maps USt DE payable into payment months", () => {
  const state = buildState();
  state.settings.startMonth = "2026-03";
  state.settings.horizonMonths = 2;
  state.incomings = [
    { month: "2026-03", revenueEur: "100.000" },
    { month: "2026-04", revenueEur: "0" },
  ];
  state.vatPreviewMonths = {
    "2026-03": { fixInputVat: 1900 },
  };

  const instances = expandVatTaxInstances(state, { months: ["2026-04"] });

  assert.equal(instances.length, 1);
  assert.equal(instances[0].taxType, "umsatzsteuer_de");
  assert.equal(instances[0].sourceMonth, "2026-03");
  assert.equal(instances[0].month, "2026-04");
  assert.equal(instances[0].dueDateIso, "2026-04-10");
  assert.equal(instances[0].direction, "out");
  assert.ok(Math.abs(Number(instances[0].amount || 0) - 4805.88) < 0.5);
});

test("buildMonthlyTaxSummary keeps refund-like USt DE months negative instead of forcing positive outflow", () => {
  const state = buildState();
  state.settings.startMonth = "2026-03";
  state.settings.horizonMonths = 1;
  state.settings.vatPreview.paymentLagMonths = 0;
  state.settings.vatPreview.paymentDayOfMonth = 15;
  state.incomings = [
    { month: "2026-03", revenueEur: "10.000" },
  ];
  state.vatPreviewMonths = {
    "2026-03": { fixInputVat: 4000 },
  };

  const instances = expandVatTaxInstances(state, { months: ["2026-03"] });
  const summary = buildMonthlyTaxSummary(instances, ["2026-03"], DASHBOARD_TAX_TYPE_CONFIG);

  assert.equal(instances.length, 1);
  assert.equal(instances[0].direction, "in");
  assert.equal(instances[0].dueDateIso, "2026-03-15");
  assert.ok(summary.get("2026-03")?.total < 0);
  assert.ok((summary.get("2026-03")?.byType?.umsatzsteuer_de || 0) < 0);
});

test("buildOssQuarterPreview calculates quarterly proxy tax and maps quarter payments including Q4 year rollover", () => {
  const state = buildState();
  state.settings.startMonth = "2026-01";
  state.settings.horizonMonths = 12;
  state.taxes.oss = {
    active: true,
    deSharePct: "80",
  };
  state.incomings = Array.from({ length: 12 }, (_entry, index) => ({
    month: `2026-${String(index + 1).padStart(2, "0")}`,
    revenueEur: "1.190",
  }));

  const preview = buildOssQuarterPreview(state);
  const instances = expandOssTaxInstances(state, { months: ["2026-04", "2026-07", "2026-10", "2027-01"] });

  assert.deepEqual(
    preview.map((row) => ({
      quarter: row.quarterKey,
      paymentMonth: row.paymentMonth,
      base: Number(row.quarterBaseAmount.toFixed(2)),
      tax: Number(row.taxAmount.toFixed(2)),
    })),
    [
      { quarter: "2026-Q1", paymentMonth: "2026-04", base: 600, tax: 121.8 },
      { quarter: "2026-Q2", paymentMonth: "2026-07", base: 600, tax: 121.8 },
      { quarter: "2026-Q3", paymentMonth: "2026-10", base: 600, tax: 121.8 },
      { quarter: "2026-Q4", paymentMonth: "2027-01", base: 600, tax: 121.8 },
    ],
  );
  assert.deepEqual(
    instances.map((entry) => ({ month: entry.month, taxType: entry.taxType, amount: Number(entry.amount.toFixed(2)) })),
    [
      { month: "2026-04", taxType: "oss", amount: 121.8 },
      { month: "2026-07", taxType: "oss", amount: 121.8 },
      { month: "2026-10", taxType: "oss", amount: 121.8 },
      { month: "2027-01", taxType: "oss", amount: 121.8 },
    ],
  );
});

test("OSS handles zero and full non-DE share edge cases without noisy instances", () => {
  const state = buildState();
  state.settings.startMonth = "2026-01";
  state.settings.horizonMonths = 3;
  state.incomings = [
    { month: "2026-01", revenueEur: "1.190" },
    { month: "2026-02", revenueEur: "1.190" },
    { month: "2026-03", revenueEur: "1.190" },
  ];

  state.taxes.oss = { active: true, deSharePct: "100" };
  const zeroInstances = expandOssTaxInstances(state, { months: ["2026-04"] });
  assert.equal(zeroInstances.length, 0);

  state.taxes.oss = { active: true, deSharePct: "0" };
  const fullInstances = expandOssTaxInstances(state, { months: ["2026-04"] });
  assert.equal(fullInstances.length, 1);
  assert.equal(fullInstances[0].month, "2026-04");
  assert.ok(Math.abs(Number(fullInstances[0].amount || 0) - 609) < 0.001);
});

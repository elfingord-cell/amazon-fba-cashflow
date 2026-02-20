import test from "node:test";
import assert from "node:assert/strict";

import { computeSeries, expandFixcostInstances } from "./cashflow.js";
import { createEmptyState, saveState, STORAGE_KEY } from "../data/storageLocal.js";

const store = new Map();

globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
};

function resetStorage() {
  store.clear();
}

function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + Number(offset || 0), 1);
  return monthKeyFromDate(date);
}

function salesPayoutAmountForMonth(report, month) {
  const row = report.series.find((entry) => entry.month === month);
  if (!row) return 0;
  return row.itemsIn
    .filter((entry) => entry.kind === "sales-payout")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
}

test.beforeEach(() => {
  resetStorage();
  saveState(createEmptyState());
});

test("expandFixcostInstances respects overrides and auto-paid", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 6 },
    fixcosts: [
      {
        id: "fc-1",
        name: "Miete",
        category: "Miete",
        amount: "1.000,00",
        frequency: "monthly",
        anchor: "15",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
        autoPaid: true,
      },
      {
        id: "fc-2",
        name: "Versicherung",
        category: "Versicherung",
        amount: "600,00",
        frequency: "quarterly",
        anchor: "LAST",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
      },
    ],
    fixcostOverrides: {
      "fc-1": {
        "2025-02": { amount: "1.200,00", note: "Index" },
      },
      "fc-2": {
        "2025-04": { dueDate: "2025-04-10" },
      },
    },
    status: { autoManualCheck: false, events: {} },
  };

  const months = ["2025-01", "2025-02", "2025-03", "2025-04"];
  const result = expandFixcostInstances(state, { months, today: "2025-03-20" });

  assert.strictEqual(result.length, 6);

  const feb = result.find(row => row.month === "2025-02" && row.fixedCostId === "fc-1");
  assert.ok(feb);
  assert.strictEqual(feb.overrideActive, true);
  assert.strictEqual(feb.amount, 1200);
  assert.strictEqual(feb.paid, true); // auto-paid before today

  const aprilInsurance = result.find(row => row.month === "2025-04" && row.fixedCostId === "fc-2");
  assert.ok(aprilInsurance);
  assert.strictEqual(aprilInsurance.dueDateIso, "2025-04-10");
  assert.strictEqual(aprilInsurance.paid, false);
});

test("autoManualCheck suppresses automatic paid flag", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 3 },
    fixcosts: [
      {
        id: "fc-auto",
        name: "Lizenz",
        category: "Tools",
        amount: "500,00",
        frequency: "monthly",
        anchor: "1",
        startMonth: "2025-01",
        proration: { enabled: false, method: "none" },
        autoPaid: true,
      },
    ],
    fixcostOverrides: {},
    status: { autoManualCheck: true, events: {} },
  };

  const result = expandFixcostInstances(state, { months: ["2025-01"], today: "2025-02-05" });
  assert.strictEqual(result.length, 1);
  const entry = result[0];
  assert.strictEqual(entry.paid, false);
  assert.strictEqual(entry.autoSuppressed, true);
  assert.match(entry.autoTooltip || "", /manuelle Prüfung aktiv/);
});

test("daily proration adjusts first and last month", () => {
  const state = {
    settings: { startMonth: "2025-01", horizonMonths: 1 },
    fixcosts: [
      {
        id: "fc-pro",
        name: "Marketing",
        category: "Sonstiges",
        amount: "1.000,00",
        frequency: "monthly",
        anchor: "15",
        startMonth: "2025-01",
        endMonth: "2025-01",
        proration: { enabled: true, method: "daily" },
      },
    ],
    fixcostOverrides: {},
    status: { autoManualCheck: false, events: {} },
  };

  const [entry] = expandFixcostInstances(state, { months: ["2025-01"], today: "2025-01-16" });
  assert.strictEqual(entry.prorationApplied, true);
  assert.strictEqual(entry.amount, 265.35);
});

test("saveState persists fixcost masters and overrides", () => {
  const state = createEmptyState();
  state.fixcosts = [
    {
      id: "fc-store",
      name: "Miete",
      category: "Miete",
      amount: "2.500,00",
      frequency: "monthly",
      intervalMonths: 1,
      anchor: "LAST",
      startMonth: "2025-01",
      proration: { enabled: false, method: "none" },
      autoPaid: false,
      notes: "Büro",
    },
  ];
  state.fixcostOverrides = {
    "fc-store": {
      "2025-03": { amount: "3.000,00", dueDate: "2025-03-28", note: "Index" },
    },
  };
  state.status = { autoManualCheck: false, events: { "fix-fc-store-2025-03": { manual: true } } };

  saveState(state);
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(raw, "state should be stored in localStorage");
  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.fixcosts[0].name, "Miete");
  assert.strictEqual(parsed.fixcostOverrides["fc-store"]["2025-03"].amount, "3.000,00");
  assert.strictEqual(parsed.status.events["fix-fc-store-2025-03"].manual, true);
});

test("computeSeries treats FO milestones as plan-only and excludes converted/archived", () => {
  const state = {
    settings: {
      startMonth: "2025-03",
      horizonMonths: 2,
      openingBalance: 0,
      fxRate: 1,
      vatRefundLagMonths: 2,
    },
    forecast: { settings: { useForecast: false } },
    incomings: [],
    extras: [],
    dividends: [],
    pos: [],
    fos: [
      {
        id: "fo-active",
        status: "ACTIVE",
        orderDate: "2025-03-01",
        prodDays: 0,
        transitDays: 0,
        payments: [
          { id: "fo-active-pay", label: "Deposit", amount: 100, currency: "EUR", dueDate: "2025-03-05", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-planned",
        status: "PLANNED",
        orderDate: "2025-03-01",
        prodDays: 0,
        transitDays: 0,
        payments: [
          { id: "fo-planned-pay", label: "Deposit", amount: 50, currency: "EUR", dueDate: "2025-04-05", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-converted",
        status: "CONVERTED",
        orderDate: "2025-03-01",
        payments: [
          { id: "fo-converted-pay", label: "Deposit", amount: 999, currency: "EUR", dueDate: "2025-03-10", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
      {
        id: "fo-archived",
        status: "ARCHIVED",
        orderDate: "2025-03-01",
        payments: [
          { id: "fo-archived-pay", label: "Deposit", amount: 999, currency: "EUR", dueDate: "2025-03-10", triggerEvent: "ORDER_DATE", offsetDays: 0 },
        ],
      },
    ],
  };

  const report = computeSeries(state);
  const march = report.series.find((entry) => entry.month === "2025-03");
  const april = report.series.find((entry) => entry.month === "2025-04");
  assert.ok(march);
  assert.ok(april);
  const marchFoEntries = march.entries.filter((entry) => entry.source === "fo");
  const aprilFoEntries = april.entries.filter((entry) => entry.source === "fo");
  assert.equal(marchFoEntries.length, 1);
  assert.equal(aprilFoEntries.length, 1);
  assert.equal(marchFoEntries[0].amount, 100);
  assert.equal(aprilFoEntries[0].amount, 50);
  assert.equal(marchFoEntries[0].paid, false);
  assert.equal(aprilFoEntries[0].paid, false);
});

test("computeSeries uses median basis quote from completed actual months in basis mode", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const state = {
    settings: {
      startMonth: prev2,
      horizonMonths: 5,
      openingBalance: 0,
      cashInMode: "basis",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: prev2, revenueEur: "10.000,00", payoutPct: "48" },
      { month: prev1, revenueEur: "10.000,00", payoutPct: "49" },
      { month: currentMonth, revenueEur: "10.000,00", payoutPct: "55" },
      { month: next1, revenueEur: "10.000,00", payoutPct: "10" },
      { month: next2, revenueEur: "10.000,00", payoutPct: "10" },
    ],
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 70 },
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 50 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  const future1 = salesPayoutAmountForMonth(report, next1);
  const future2 = salesPayoutAmountForMonth(report, next2);
  const current = salesPayoutAmountForMonth(report, currentMonth);

  assert.equal(future1, 6000);
  assert.equal(future2, 6000);
  assert.equal(current, 5500);
  assert.equal(report.kpis?.cashIn?.mode, "basis");
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 60);
  assert.equal(report.kpis?.cashIn?.istMonthsCount, 2);
  assert.equal(report.kpis?.cashIn?.hasIstData, true);
  assert.equal(report.kpis?.cashIn?.fallbackUsed, "none");
});

test("computeSeries applies conservative margin buckets and clamps max quote", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev2 = addMonths(currentMonth, -2);
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const next4 = addMonths(currentMonth, 4);
  const next7 = addMonths(currentMonth, 7);
  const next13 = addMonths(currentMonth, 13);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 14,
      openingBalance: 0,
      cashInMode: "conservative",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      ...Array.from({ length: 14 }, (_, index) => ({
        month: addMonths(currentMonth, index),
        revenueEur: "1.000,00",
        payoutPct: "20",
      })),
    ],
    monthlyActuals: {
      [prev2]: { realRevenueEUR: 10000, realPayoutRatePct: 90 },
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 70 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 75);
  assert.equal(salesPayoutAmountForMonth(report, currentMonth), 200);
  assert.equal(salesPayoutAmountForMonth(report, next1), 740);
  assert.equal(salesPayoutAmountForMonth(report, next2), 730);
  assert.equal(salesPayoutAmountForMonth(report, next4), 720);
  assert.equal(salesPayoutAmountForMonth(report, next7), 710);
  assert.equal(salesPayoutAmountForMonth(report, next13), 700);
});

test("computeSeries falls back to latest plan quote when no actual quotes exist", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const next1 = addMonths(currentMonth, 1);
  const next2 = addMonths(currentMonth, 2);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 3,
      openingBalance: 0,
      cashInMode: "basis",
    },
    forecast: { settings: { useForecast: false } },
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "45" },
      { month: next1, revenueEur: "1.000,00", payoutPct: "58" },
      { month: next2, revenueEur: "1.000,00", payoutPct: "58" },
    ],
    monthlyActuals: {},
    actuals: [],
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(report.kpis?.cashIn?.fallbackUsed, "last_plan_quote");
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 58);
  assert.equal(salesPayoutAmountForMonth(report, next1), 580);
  assert.equal(salesPayoutAmountForMonth(report, next2), 580);
});

test("computeSeries clamps conservative quote to min and applies same quote to forecast live/plan split", () => {
  const currentMonth = monthKeyFromDate(new Date());
  const prev1 = addMonths(currentMonth, -1);
  const next1 = addMonths(currentMonth, 1);
  const state = {
    settings: {
      startMonth: currentMonth,
      horizonMonths: 2,
      openingBalance: 0,
      cashInMode: "conservative",
    },
    forecast: {
      settings: { useForecast: true },
      forecastImport: {
        "SKU-LIVE": {
          [next1]: { revenueEur: 500 },
        },
        "SKU-PLAN-REF": {
          [currentMonth]: { units: 10 },
          [next1]: { units: 10 },
        },
      },
    },
    planProducts: [
      {
        id: "plan-1",
        alias: "Plan Produkt",
        status: "active",
        seasonalityReferenceSku: "SKU-PLAN-REF",
        baselineReferenceMonth: Number(String(next1).slice(5, 7)),
        baselineUnitsInReferenceMonth: 10,
        avgSellingPriceGrossEUR: 100,
      },
    ],
    incomings: [
      { month: currentMonth, revenueEur: "1.000,00", payoutPct: "20" },
      { month: next1, revenueEur: "0,00", payoutPct: "20" },
    ],
    monthlyActuals: {
      [prev1]: { realRevenueEUR: 10000, realPayoutRatePct: 20 },
    },
    extras: [],
    dividends: [],
    pos: [],
    fos: [],
  };

  const report = computeSeries(state);
  assert.equal(report.kpis?.cashIn?.basisQuotePct, 35);
  const nextRow = report.series.find((entry) => entry.month === next1);
  assert.ok(nextRow);
  const salesEntries = nextRow.entries.filter((entry) => entry.kind === "sales-payout");
  const liveEntry = salesEntries.find((entry) => String(entry.label || "").includes("Live/CSV"));
  const planEntry = salesEntries.find((entry) => String(entry.label || "").includes("Prognose - Plan"));
  assert.ok(liveEntry);
  assert.ok(planEntry);
  assert.equal(liveEntry.amount, 175);
  assert.equal(planEntry.amount, 350);
  assert.match(String(liveEntry.tooltip || ""), /Quote: 35,0%/);
  assert.match(String(planEntry.tooltip || ""), /Quote: 35,0%/);
});

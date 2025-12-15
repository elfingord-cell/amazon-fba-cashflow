import test from "node:test";
import assert from "node:assert/strict";
import { computeVatPreview } from "./vatPreview.js";

const baseState = {
  settings: {
    startMonth: "2025-10",
    horizonMonths: 6,
    openingBalance: "0",
    fxRate: "1,08",
    fxFeePct: "0,5",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
    freightLagDays: 14,
    vatPreview: {
      eustLagMonths: 2,
      deShareDefault: 0.8,
      feeRateDefault: 0.38,
      fixInputDefault: 0,
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
};

function cloneState() {
  return JSON.parse(JSON.stringify(baseState));
}

test("applies DE VAT preview formula with defaults", () => {
  const state = cloneState();
  state.incomings = [
    { month: "2025-10", revenueEur: "100.000" },
  ];
  state.vatPreviewMonths = {
    "2025-10": { fixInputVatOverride: 1900 },
  };

  const res = computeVatPreview(state);
  const row = res.rows.find(r => r.month === "2025-10");
  assert.ok(row, "row present");
  assert.ok(Math.abs(row.grossDe - 80000) < 0.1, "DE share 80% of 100k");
  assert.ok(Math.abs(row.outVat - 12773.11) < 0.5, `Output VAT expected ~12773, got ${row.outVat}`);
  assert.ok(Math.abs(row.feeInputVat - 6067.23) < 0.5, `Fee input VAT expected ~6067, got ${row.feeInputVat}`);
  assert.ok(Math.abs(row.payable - 4805.88) < 0.5, `Payable expected ~4805.88, got ${row.payable}`);
});

test("uses monthly overrides and EUSt refunds", () => {
  const state = cloneState();
  state.settings.horizonMonths = 4;
  state.incomings = [
    { month: "2025-10", revenueEur: "50.000" },
    { month: "2025-11", revenueEur: "50.000" },
  ];
  state.vatPreviewMonths = {
    "2025-11": { deShare: 0.5, feeRateOfGross: 0.2, fixInputVatOverride: 100 },
  };
  state.pos.push({
    id: "po1",
    poNo: "PO25007",
    orderDate: "2025-10-01",
    prodDays: 0,
    transitDays: 0,
    transport: "sea",
    ddp: false,
    freightEur: "4.800,00",
    dutyRatePct: "6,5",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    vatRefundActive: true,
    vatRefundLag: 2,
    fxOverride: "1,08",
    items: [
      { sku: "SKU-1", units: "1", unitCostUsd: "80000", unitExtraUsd: "0", extraFlatUsd: "0" },
    ],
    milestones: [
      { id: "m1", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
    ],
  });

  const res = computeVatPreview(state);
  const nov = res.rows.find(r => r.month === "2025-11");
  assert.ok(nov, "November row present");
  assert.ok(Math.abs(nov.grossDe - 25000) < 0.1, "Override DE share applied");
  const refundMonth = res.rows.find(r => r.eustRefund > 0);
  assert.ok(refundMonth, "EUSt refund populated");
});

test("computes fix VAT with lag from gross and net amounts", () => {
  const state = cloneState();
  state.settings.startMonth = "2025-11";
  state.settings.horizonMonths = 3;
  state.settings.vatPreview.fixVatLagMonths = 1;
  state.fixcosts = [
    { id: "fc1", name: "Steuerberatung", amount: "1.190,00", isGross: true, vatRate: "19", frequency: "monthly", anchor: "15", startMonth: "2025-11" },
    { id: "fc2", name: "SaaS", amount: "100,00", isGross: false, vatRate: "19", frequency: "monthly", anchor: "05", startMonth: "2025-11" },
  ];
  state.incomings = [{ month: "2025-11", revenueEur: "0" }, { month: "2025-12", revenueEur: "0" }];

  const res = computeVatPreview(state);
  const dec = res.rows.find(r => r.month === "2025-12");
  assert.ok(dec, "December row present");
  assert.ok(Math.abs(dec.fixInputVat - 209) < 0.01, `Expected 209 VAT credit, got ${dec.fixInputVat}`);
  state.settings.vatPreview.fixVatLagMonths = 0;
  const res2 = computeVatPreview(state);
  const nov = res2.rows.find(r => r.month === "2025-11");
  assert.ok(Math.abs(nov.fixInputVat - 209) < 0.01, "Lag 0 shifts credit back");
});

import test from "node:test";
import assert from "node:assert/strict";
import { computeVatPreview } from "./vatPreview.js";

const baseState = {
  settings: {
    startMonth: "2025-10",
    horizonMonths: 4,
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
      istVersteuerung: false,
      rcNetting: true,
      timingAlpha: [1, 0, 0],
      returnsDelta: 0,
      vatRateDelta: 0,
      mixShift: 0,
    },
  },
  incomings: [],
  extras: [],
  dividends: [],
  fixcosts: [],
  fixcostOverrides: {},
  fos: [],
  pos: [
    {
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
    },
  ],
  products: [{ sku: "SKU-1", alias: "SKU-1", vatRate: 19, returnsRate: 0 }],
  vatCostRules: [],
  recentProducts: [],
  status: { autoManualCheck: false, events: {} },
};

test("VAT preview includes EUSt and refund with correct timing", () => {
  const res = computeVatPreview(baseState);
  const oct = res.rows.find(r => r.month === "2025-10");
  const dec = res.rows.find(r => r.month === "2025-12");
  assert.ok(oct, "October row present");
  assert.ok(dec, "December row present");
  // EUSt basis: (80000/1.08 + 4800 + duty) with duty 6.5% of goods+freight
  assert.ok(Math.abs(oct.inputVat - 15960.36) < 0.2, `EUSt expected ~15960, got ${oct.inputVat}`);
  assert.ok(Math.abs(dec.eustRefund - 15960.36) < 0.2, `Refund expected ~15960, got ${dec.eustRefund}`);
});

test("Quickfill ignores PO number and date", () => {
  const state = JSON.parse(JSON.stringify(baseState));
  state.pos.push({
    id: "po2",
    poNo: "PO12345",
    orderDate: "2025-11-02",
    prodDays: 0,
    transitDays: 0,
    transport: "sea",
    ddp: false,
    freightEur: "0",
    dutyRatePct: "0",
    eustRatePct: "19",
    vatRefundActive: true,
    vatRefundLag: 2,
    items: [
      { sku: "SKU-1", units: "1", unitCostUsd: "100", unitExtraUsd: "0", extraFlatUsd: "0" },
    ],
    milestones: [
      { id: "m1", label: "Deposit", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
    ],
  });
  const res = computeVatPreview(state);
  assert.equal(res.rows.length, 4);
});

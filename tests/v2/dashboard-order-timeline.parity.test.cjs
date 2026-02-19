const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDashboardOrderTimeline,
} = require("../../.test-build/migration/v2/domain/dashboardOrderTimeline.js");

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(isoDate) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function baseSettings() {
  return {
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
  };
}

test("dashboard order timeline: PO lifecycle + payment status markers", () => {
  const state = {
    settings: baseSettings(),
    payments: [
      {
        id: "pay-po-1-deposit",
        paidDate: "2026-03-01",
      },
    ],
    pos: [
      {
        id: "po-1",
        poNo: "PO-3001",
        supplierId: "sup-1",
        orderDate: "2026-03-01",
        prodDays: 20,
        transitDays: 30,
        fxOverride: 1,
        freightEur: "220,00",
        items: [
          {
            id: "po-item-1",
            sku: "SKU-1",
            units: "100",
            unitCostUsd: "5,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
          },
        ],
        milestones: [
          { id: "po-ms-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po-ms-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po-ms-dep": { status: "paid", paymentId: "pay-po-1-deposit" },
        },
        autoEvents: [
          { id: "po-auto-freight", type: "freight", enabled: true },
          { id: "po-auto-duty", type: "duty", enabled: false },
          { id: "po-auto-eust", type: "eust", enabled: false },
          { id: "po-auto-vat", type: "vat_refund", enabled: false },
          { id: "po-auto-fx", type: "fx_fee", enabled: false },
        ],
      },
    ],
  };

  const timeline = buildDashboardOrderTimeline({
    state,
    source: "po",
    sourceId: "po-1",
    sourceNumber: "PO-3001",
  });

  assert.ok(timeline, "timeline should be built");
  assert.equal(timeline.source, "po");
  assert.ok(timeline.items.some((item) => item.className.includes("--production")), "production segment missing");
  assert.ok(timeline.items.some((item) => item.className.includes("--transit")), "transit segment missing");
  assert.ok(timeline.items.some((item) => item.className.includes("--payment-paid")), "paid payment marker missing");
  assert.ok(timeline.items.some((item) => item.className.includes("--payment-open")), "open payment marker missing");
});

test("dashboard order timeline: FO lookup via foNumber works without foNo", () => {
  const state = {
    settings: baseSettings(),
    fos: [
      {
        id: "fo-1",
        foNumber: "FO-9001",
        orderDate: "2026-04-03",
        etdDate: "2026-05-08",
        etaDate: "2026-06-15",
        targetDeliveryDate: "2026-06-18",
        productionLeadTimeDays: 35,
        logisticsLeadTimeDays: 38,
        bufferDays: 0,
        fxRate: 1.1,
        payments: [
          {
            id: "fo-pay-deposit",
            label: "Deposit",
            category: "supplier",
            amount: 220,
            currency: "USD",
            dueDate: "2026-04-03",
            status: "paid",
          },
          {
            id: "fo-pay-refund",
            label: "EUSt Erstattung",
            category: "eust_refund",
            amount: 90,
            currency: "EUR",
            dueDate: "2026-07-01",
            status: "open",
          },
        ],
      },
    ],
  };

  const timeline = buildDashboardOrderTimeline({
    state,
    source: "fo",
    sourceNumber: "FO-9001",
  });

  assert.ok(timeline, "timeline should be built");
  assert.equal(timeline.sourceNumber, "FO-9001");
  assert.ok(timeline.items.some((item) => item.className.includes("--payment-paid")), "paid marker missing");
  assert.ok(timeline.items.some((item) => item.className.includes("--payment-incoming")), "incoming refund marker missing");

  const minLifecycle = toMs("2026-04-03");
  const maxLifecycle = toMs("2026-07-01");
  assert.ok(timeline.visibleStartMs <= (minLifecycle - DAY_MS), "timeline should include left lifecycle padding");
  assert.ok(timeline.visibleEndMs >= (maxLifecycle + DAY_MS), "timeline should include right lifecycle padding");
});

test("dashboard order timeline: FO lookup via id fallback works when number is missing", () => {
  const state = {
    settings: baseSettings(),
    fos: [
      {
        id: "fo-only-id",
        orderDate: "2026-08-01",
        etdDate: "2026-08-20",
        etaDate: "2026-09-12",
        fxRate: 1,
        payments: [
          {
            id: "fo-only-id-pay-1",
            label: "Balance",
            category: "supplier",
            amount: 120,
            currency: "EUR",
            dueDate: "2026-08-21",
            status: "open",
          },
        ],
      },
    ],
  };

  const timeline = buildDashboardOrderTimeline({
    state,
    source: "fo",
    sourceNumber: "fo-only-id",
  });

  assert.ok(timeline, "timeline should be built via id fallback");
  assert.equal(timeline.sourceId, "fo-only-id");
});

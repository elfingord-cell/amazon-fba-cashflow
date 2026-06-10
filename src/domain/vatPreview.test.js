import test from "node:test";
import assert from "node:assert/strict";
import { computeVatPreview } from "./vatPreview.js";
import { computeSeries as computeSeriesForTest } from "./cashflow.js";

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
    "2025-10": { fixInputVat: 1900 },
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
    "2025-11": { deShare: 0.5, feeRateOfGross: 0.2, fixInputVat: 100 },
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
  // EUSt wird im Monat der EUSt-Zahlung (ETA-Monat) als Vorsteuer verrechnet,
  // nicht mehr über spätere Erstattungs-Events.
  const oct = res.rows.find(r => r.month === "2025-10");
  assert.ok(oct, "Oktober row present");
  assert.ok(oct.eustInputVat > 0, `EUSt-VSt im ETA-Monat erwartet, got ${oct.eustInputVat}`);
  const expectedEust = oct.eustInputVat;
  const expectedPayable = oct.outVat - oct.feeInputVat - oct.fixInputVat - expectedEust;
  assert.ok(Math.abs(oct.payable - expectedPayable) < 0.01, "Zahllast zieht EUSt-VSt im selben Monat ab");
});

test("global vatRefundEnabled=false suppresses refund events (no double counting)", () => {
  const state = cloneState();
  state.settings.vatRefundEnabled = false;
  state.settings.horizonMonths = 6;
  state.pos.push({
    id: "po2",
    poNo: "PO25008",
    orderDate: "2025-10-01",
    prodDays: 0,
    transitDays: 0,
    transport: "sea",
    ddp: false,
    freightEur: "0",
    dutyRatePct: "0",
    dutyIncludeFreight: true,
    eustRatePct: "19",
    fxOverride: "1,00",
    items: [
      { sku: "SKU-1", units: "1", unitCostUsd: "10000", unitExtraUsd: "0", extraFlatUsd: "0" },
    ],
    milestones: [
      { id: "m1", label: "Full", percent: 100, anchor: "ORDER_DATE", lagDays: 0 },
    ],
  });

  const series = computeSeriesForTest(state);
  const refundEntries = series.breakdown.flatMap((b) => (b.entries || []))
    .filter((e) => e.kind === "po-refund" || e.kind === "fo-refund");
  assert.equal(refundEntries.length, 0, "Keine EUSt-Erstattungs-Events bei globalem Aus");

  const res = computeVatPreview(state);
  const eustMonths = res.rows.filter((row) => row.eustInputVat > 0);
  assert.ok(eustMonths.length === 1, "EUSt-VSt genau im ETA-Monat");
  assert.ok(Math.abs(eustMonths[0].eustInputVat - 1900) < 0.5, `EUSt-VSt 1900 erwartet, got ${eustMonths[0].eustInputVat}`);
});

test("Sondervorauszahlung reduziert Dezember-Zahllast", () => {
  const state = cloneState();
  state.settings.startMonth = "2025-10";
  state.settings.horizonMonths = 4;
  state.settings.vatPreview.sondervorauszahlung = { active: true, amountEur: 1001 };
  state.incomings = [
    { month: "2025-12", revenueEur: "100.000" },
  ];

  const res = computeVatPreview(state);
  const dec = res.rows.find((row) => row.month === "2025-12");
  assert.ok(dec, "Dezember row present");
  assert.ok(Math.abs(dec.svzCredit - 1001) < 0.001, "SVZ-Verrechnung im Dezember");
  const expected = dec.outVat - dec.feeInputVat - dec.fixInputVat - dec.eustInputVat - 1001;
  assert.ok(Math.abs(dec.payable - expected) < 0.01, "Zahllast um SVZ gemindert");
  const nov = res.rows.find((row) => row.month === "2025-11");
  assert.ok(nov && nov.svzCredit === 0, "Keine SVZ-Verrechnung außerhalb Dezember");
});

test("falls back to forecast-based gross revenue when month revenue input is missing", () => {
  const state = cloneState();
  state.settings.startMonth = "2026-01";
  state.settings.horizonMonths = 4;
  state.settings.cashInCalibrationEnabled = false;
  state.settings.cashInRevenueBasisMode = "forecast_direct";
  state.settings.cashInQuoteMode = "recommendation";
  state.settings.cashInRecommendationSeasonalityEnabled = false;
  state.settings.cashInRecommendationBaselineNormalPct = 50;
  state.incomings = [
    { month: "2026-01", revenueEur: "1.000" },
    { month: "2026-02", revenueEur: "2.000" },
    { month: "2026-04", revenueEur: "4.000" },
  ];
  state.products = [
    { sku: "SKU-1", alias: "SKU-1", avgSellingPriceGrossEUR: 100 },
  ];
  state.forecast = {
    forecastManual: {
      "SKU-1": {
        "2026-01": 10,
        "2026-02": 20,
        "2026-03": 30,
        "2026-04": 40,
      },
    },
  };

  const res = computeVatPreview(state);
  const march = res.rows.find(r => r.month === "2026-03");

  assert.ok(march, "März 2026 vorhanden");
  assert.ok(Math.abs(march.grossTotal - 3000) < 0.1, `Forecast-Fallback erwartet 3000 EUR Umsatz, got ${march.grossTotal}`);
  assert.ok(Math.abs(march.grossDe - 2400) < 0.1, `DE-Brutto erwartet 2400 EUR, got ${march.grossDe}`);
  assert.ok(march.outVat > 0, "Output-USt darf bei vorhandenem Forecast-Umsatz nicht 0 sein.");
});

test("payment-month settings do not change the underlying USt preview payable calculation", () => {
  const state = cloneState();
  state.incomings = [
    { month: "2025-10", revenueEur: "100.000" },
  ];

  const baseline = computeVatPreview(state);
  state.settings.vatPreview.paymentLagMonths = 2;
  state.settings.vatPreview.paymentDayOfMonth = 27;
  const shifted = computeVatPreview(state);

  const baselineRow = baseline.rows.find((row) => row.month === "2025-10");
  const shiftedRow = shifted.rows.find((row) => row.month === "2025-10");

  assert.ok(baselineRow);
  assert.ok(shiftedRow);
  assert.ok(Math.abs(Number(baselineRow.payable || 0) - Number(shiftedRow.payable || 0)) < 0.000001);
});

test("vatActualsByMonth liefert actualPayable und Abweichung in der Vorschau", () => {
  const state = cloneState();
  state.incomings = [
    { month: "2025-10", revenueEur: "100.000" },
  ];
  state.vatActualsByMonth = {
    "2025-10": { payableEur: 4000 },
  };

  const res = computeVatPreview(state);
  const oct = res.rows.find((row) => row.month === "2025-10");
  assert.ok(oct);
  assert.equal(oct.actualPayable, 4000);
  assert.ok(Math.abs(oct.payableDeviation - (oct.payable - 4000)) < 0.001);
  const nov = res.rows.find((row) => row.month === "2025-11");
  assert.equal(nov.actualPayable, null);
  assert.equal(nov.payableDeviation, null);
});

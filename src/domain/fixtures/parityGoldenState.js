function monthKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);
  return monthKeyFromDate(date);
}

function buildForecastManualForAbc() {
  const current = new Date();
  const start = monthKeyFromDate(current);
  const manual = {
    "SKU-A": {},
    "SKU-B": {},
  };
  for (let index = 0; index < 6; index += 1) {
    const month = addMonths(start, index);
    manual["SKU-A"][month] = 120;
    manual["SKU-B"][month] = 20;
  }
  return manual;
}

export function createParityGoldenState() {
  const abcManual = buildForecastManualForAbc();
  return {
    settings: {
      startMonth: "2025-01",
      horizonMonths: 3,
      openingBalance: "10.000,00",
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
        fixInputDefault: 100,
      },
      safetyStockDohDefault: 30,
      foCoverageDohDefault: 90,
    },
    incomings: [
      { month: "2025-01", revenueEur: "20.000,00", payoutPct: "50" },
      { month: "2025-02", revenueEur: "30.000,00", payoutPct: "50" },
      { month: "2025-03", revenueEur: "0,00", payoutPct: "50" },
    ],
    extras: [
      { id: "extra-1", month: "2025-01", date: "2025-01-15", label: "Sonderkosten", amountEur: "-1.000,00" },
      { id: "extra-2", month: "2025-02", date: "2025-02-07", label: "Bonus", amountEur: "500,00" },
    ],
    dividends: [
      { id: "div-1", month: "2025-02", date: "2025-02-28", label: "Dividende", amountEur: "200,00" },
    ],
    fixcosts: [
      {
        id: "fix-1",
        name: "Tooling",
        category: "Tools",
        amount: "100,00",
        frequency: "monthly",
        intervalMonths: 1,
        anchor: "LAST",
        startMonth: "2025-01",
        endMonth: "",
        proration: { enabled: false, method: "none" },
        autoPaid: false,
      },
    ],
    fixcostOverrides: {},
    forecast: {
      settings: { useForecast: false },
      forecastManual: {
        ...abcManual,
        "SKU-A": {
          ...abcManual["SKU-A"],
          "2025-02": 30,
          "2025-03": 40,
        },
        "SKU-B": {
          ...abcManual["SKU-B"],
          "2025-02": 10,
          "2025-03": 10,
        },
      },
      forecastImport: {},
    },
    products: [
      {
        id: "prod-a",
        sku: "SKU-A",
        alias: "Alpha",
        status: "active",
        avgSellingPriceGrossEUR: "25",
        safetyStockDohOverride: 30,
      },
      {
        id: "prod-b",
        sku: "SKU-B",
        alias: "Beta",
        status: "active",
        avgSellingPriceGrossEUR: "10",
      },
    ],
    productCategories: [],
    inventory: {
      snapshots: [
        {
          month: "2025-01",
          items: [
            { sku: "SKU-A", amazonUnits: 100, threePLUnits: 0 },
            { sku: "SKU-B", amazonUnits: 30, threePLUnits: 0 },
          ],
        },
      ],
      settings: {
        projectionMonths: 2,
        safetyDays: 30,
      },
    },
    fos: [
      {
        id: "fo-1",
        status: "DRAFT",
        targetDeliveryDate: "2025-03-15",
        items: [
          { sku: "SKU-A", units: 50 },
        ],
      },
    ],
    pos: [],
    payments: [],
    status: { autoManualCheck: false, events: {} },
    monthlyActuals: {
      "2025-02": {
        realRevenueEUR: 28000,
        realPayoutRatePct: 50,
        realClosingBalanceEUR: 33000,
      },
    },
    vatCostRules: [],
    vatPreviewMonths: {},
    recentProducts: [],
    suppliers: [],
    productSuppliers: [],
    actuals: [],
  };
}

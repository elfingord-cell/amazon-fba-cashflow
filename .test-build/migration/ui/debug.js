"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDemoState = buildDemoState;
exports.render = render;
const storageLocal_js_1 = require("../data/storageLocal.js");
const store_js_1 = require("../storage/store.js");
const orderEditorFactory_js_1 = require("./orderEditorFactory.js");
const abcClassification_js_1 = require("../domain/abcClassification.js");
function monthKeyFromDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function addMonths(monthKey, offset) {
    const [year, month] = String(monthKey || "").split("-").map(Number);
    const probe = new Date(year, (month || 1) - 1 + Number(offset || 0), 1);
    return monthKeyFromDate(probe);
}
function monthStartIso(monthKey) {
    return `${String(monthKey || "")}-01`;
}
function buildForecastMonthMap(startMonth, values) {
    const map = {};
    values.forEach((row, index) => {
        const month = addMonths(startMonth, index);
        map[month] = {
            units: row.units,
            revenueEur: row.revenueEur,
            profitEur: row.profitEur,
        };
    });
    return map;
}
function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function buildDemoState() {
    const demo = (0, storageLocal_js_1.createEmptyState)();
    const planningStartMonth = addMonths(monthKeyFromDate(new Date()), -1);
    const planLaunchMonth = addMonths(planningStartMonth, 1);
    demo.settings = {
        startMonth: planningStartMonth,
        horizonMonths: 8,
        openingBalance: "120.000,00",
        fxRate: 1.08,
        fxFeePct: "0,5",
        dutyRatePct: "6,5",
        dutyIncludeFreight: true,
        eustRatePct: "19",
        vatRefundEnabled: true,
        vatRefundLagMonths: 2,
        freightLagDays: 14,
        safetyStockDohDefault: 30,
        foCoverageDohDefault: 90,
        cashInQuoteMode: "manual",
        cashInRevenueBasisMode: "forecast_direct",
        cashInCalibrationEnabled: false,
        dashboardShowPhantomFoInChart: true,
    };
    demo.incomings = Array.from({ length: Number(demo.settings.horizonMonths || 0) }, (_, index) => {
        const month = addMonths(planningStartMonth, index);
        return {
            id: `inc-${month}`,
            month,
            payoutPct: "40",
            source: "forecast",
        };
    });
    demo.extras = [
        { date: "2024-12-20", label: "Weihnachtsbonus", amountEur: "5.200,00" },
        { date: "2025-03-15", label: "Steuererstattung", amountEur: "7.500,00" },
        { date: "2025-05-10", label: "Marketing-Offensive", amountEur: "-6.800,00" },
    ];
    demo.fixcosts = [
        {
            id: "fix-steuerberatung",
            name: "Steuerberatung",
            category: "Steuerberatung",
            amount: "2.400,00",
            frequency: "monthly",
            intervalMonths: 1,
            anchor: "15",
            startMonth: "2024-10",
            endMonth: "",
            proration: { enabled: false, method: "none" },
            autoPaid: true,
            notes: "Monatliches Honorar",
        },
        {
            id: "fix-ventory",
            name: "Ventory One Lizenz",
            category: "Lizenz",
            amount: "1.350,00",
            frequency: "monthly",
            intervalMonths: 1,
            anchor: "1",
            startMonth: "2024-10",
            endMonth: "",
            proration: { enabled: false, method: "none" },
            autoPaid: false,
            notes: "Softwarelizenz",
        },
        {
            id: "fix-lager",
            name: "Lager & Logistik",
            category: "Miete",
            amount: "5.800,00",
            frequency: "monthly",
            intervalMonths: 1,
            anchor: "LAST",
            startMonth: "2024-10",
            endMonth: "",
            proration: { enabled: false, method: "none" },
            autoPaid: true,
            notes: "Lagerhalle inkl. Nebenkosten",
        },
        {
            id: "fix-versicherung",
            name: "Betriebsversicherung",
            category: "Versicherung",
            amount: "2.400,00",
            frequency: "quarterly",
            intervalMonths: 3,
            anchor: "15",
            startMonth: "2024-10",
            endMonth: "",
            proration: { enabled: false, method: "none" },
            autoPaid: false,
            notes: "Quartalsweise Prämie",
        },
    ];
    demo.fixcostOverrides = {
        "fix-steuerberatung": {
            "2024-12": { amount: "3.800,00", note: "Jahresabschluss" },
        },
        "fix-lager": {
            "2025-07": { amount: "6.300,00", note: "Index-Anpassung", dueDate: "2025-07-25" },
        },
        "fix-versicherung": {
            "2025-04": { amount: "2.800,00", note: "Police erweitert" },
        },
    };
    demo.products = [
        {
            id: "prod-sku-alpha",
            sku: "SKU-ALPHA",
            alias: "Premium French Press Set",
            supplierId: "Ningbo Trading",
            status: "active",
            tags: ["Kitchen", "Coffee"],
            template: {
                scope: "SKU",
                name: "Standard (SKU)",
                fields: {
                    units: "1200",
                    unitCostUsd: "11,80",
                    unitExtraUsd: "0,60",
                    extraFlatUsd: "250,00",
                    transport: "sea",
                    prodDays: 40,
                    transitDays: 55,
                    freightEur: "3.200,00",
                    dutyRatePct: "6,5",
                    dutyIncludeFreight: true,
                    eustRatePct: "19",
                    vatRefundEnabled: true,
                    vatRefundLagMonths: 2,
                    fxRate: "1,08",
                    fxFeePct: "0,5",
                    milestones: [
                        { id: "tpl-alpha-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
                        { id: "tpl-alpha-ms2", label: "Production", percent: 50, anchor: "PROD_DONE", lagDays: 0 },
                        { id: "tpl-alpha-ms3", label: "Balance", percent: 20, anchor: "ETA", lagDays: 5 },
                    ],
                },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: "prod-sku-bravo",
            sku: "SKU-BRAVO",
            alias: "Ergonomischer Bürostuhl",
            supplierId: "Shenzhen Seats Co.",
            status: "active",
            tags: ["Office"],
            template: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: "prod-sku-charlie",
            sku: "SKU-CHARLIE",
            alias: "Fitness Resistance Bands Set",
            supplierId: "Xiamen Fitness",
            status: "active",
            tags: ["Fitness"],
            template: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    ];
    demo.recentProducts = ["sku-alpha", "sku-bravo"];
    demo.dividends = [
        { month: "2025-06", label: "Dividende", amountEur: "-12.500,00" },
        { month: "2025-06", label: "KapESt", amountEur: "-3.200,00" },
        { month: "2025-09", label: "Dividende", amountEur: "-15.000,00" },
        { month: "2025-09", label: "KapESt", amountEur: "-3.800,00" },
    ];
    demo.pos = [
        {
            id: "po-demo-2024-10",
            poNo: "24010",
            sku: "SKU-ALPHA",
            supplier: "Ningbo Trading",
            orderDate: "2024-10-05",
            goodsEur: "24.500,00",
            freightEur: "3.200,00",
            prodDays: 40,
            transport: "sea",
            transitDays: 55,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2024-10-ms1", label: "Deposit", percent: 35, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2024-10-ms2", label: "Production", percent: 25, anchor: "PROD_DONE", lagDays: 0 },
                { id: "po-demo-2024-10-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
            ],
        },
        {
            id: "po-demo-2024-11",
            poNo: "24011",
            sku: "SKU-ALPHA",
            supplier: "Ningbo Trading",
            orderDate: "2024-11-07",
            goodsEur: "23.800,00",
            freightEur: "2.800,00",
            prodDays: 32,
            transport: "rail",
            transitDays: 30,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2024-11-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2024-11-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 2 },
                { id: "po-demo-2024-11-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
            ],
        },
        {
            id: "po-demo-2024-12",
            poNo: "24012",
            sku: "SKU-ALPHA",
            supplier: "Ningbo Trading",
            orderDate: "2024-12-03",
            goodsEur: "27.200,00",
            freightEur: "3.000,00",
            prodDays: 28,
            transport: "air",
            transitDays: 12,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2024-12-ms1", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2024-12-ms2", label: "Inspection", percent: 25, anchor: "PROD_DONE", lagDays: 1 },
                { id: "po-demo-2024-12-ms3", label: "Balance", percent: 35, anchor: "ETA", lagDays: 2 },
            ],
        },
        {
            id: "po-demo-2025-01",
            poNo: "25001",
            sku: "SKU-BRAVO",
            supplier: "Shenzhen Works",
            orderDate: "2025-01-10",
            goodsEur: "28.600,00",
            freightEur: "3.600,00",
            prodDays: 36,
            transport: "sea",
            transitDays: 50,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-01-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-01-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 0 },
                { id: "po-demo-2025-01-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 6 },
            ],
        },
        {
            id: "po-demo-2025-02",
            poNo: "25002",
            sku: "SKU-BRAVO",
            supplier: "Shenzhen Works",
            orderDate: "2025-02-06",
            goodsEur: "26.400,00",
            freightEur: "3.100,00",
            prodDays: 34,
            transport: "rail",
            transitDays: 28,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-02-ms1", label: "Deposit", percent: 35, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-02-ms2", label: "Production", percent: 25, anchor: "PROD_DONE", lagDays: 0 },
                { id: "po-demo-2025-02-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
            ],
        },
        {
            id: "po-demo-2025-03",
            poNo: "25003",
            sku: "SKU-BRAVO",
            supplier: "Shenzhen Works",
            orderDate: "2025-03-04",
            goodsEur: "29.100,00",
            freightEur: "3.300,00",
            prodDays: 33,
            transport: "sea",
            transitDays: 54,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-03-ms1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-03-ms2", label: "Production", percent: 30, anchor: "PROD_DONE", lagDays: 3 },
                { id: "po-demo-2025-03-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
            ],
        },
        {
            id: "po-demo-2025-04",
            poNo: "25004",
            sku: "SKU-CHARLIE",
            supplier: "Ningbo Trading",
            orderDate: "2025-04-08",
            goodsEur: "30.500,00",
            freightEur: "3.500,00",
            prodDays: 31,
            transport: "rail",
            transitDays: 29,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-04-ms1", label: "Deposit", percent: 32, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-04-ms2", label: "Production", percent: 28, anchor: "PROD_DONE", lagDays: 2 },
                { id: "po-demo-2025-04-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 3 },
            ],
        },
        {
            id: "po-demo-2025-05",
            poNo: "25005",
            sku: "SKU-CHARLIE",
            supplier: "Ningbo Trading",
            orderDate: "2025-05-09",
            goodsEur: "27.900,00",
            freightEur: "3.000,00",
            prodDays: 29,
            transport: "air",
            transitDays: 13,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-05-ms1", label: "Deposit", percent: 38, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-05-ms2", label: "Production", percent: 22, anchor: "PROD_DONE", lagDays: 1 },
                { id: "po-demo-2025-05-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 2 },
            ],
        },
        {
            id: "po-demo-2025-06",
            poNo: "25006",
            sku: "SKU-CHARLIE",
            supplier: "Ningbo Trading",
            orderDate: "2025-06-06",
            goodsEur: "31.200,00",
            freightEur: "3.400,00",
            prodDays: 35,
            transport: "sea",
            transitDays: 56,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-06-ms1", label: "Deposit", percent: 34, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-06-ms2", label: "Production", percent: 26, anchor: "PROD_DONE", lagDays: 3 },
                { id: "po-demo-2025-06-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
            ],
        },
        {
            id: "po-demo-2025-07",
            poNo: "25007",
            sku: "SKU-DELTA",
            supplier: "Shenzhen Works",
            orderDate: "2025-07-04",
            goodsEur: "28.800,00",
            freightEur: "2.900,00",
            prodDays: 30,
            transport: "rail",
            transitDays: 27,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-07-ms1", label: "Deposit", percent: 36, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-07-ms2", label: "Inspection", percent: 24, anchor: "PROD_DONE", lagDays: 2 },
                { id: "po-demo-2025-07-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 3 },
            ],
        },
        {
            id: "po-demo-2025-08",
            poNo: "25008",
            sku: "SKU-DELTA",
            supplier: "Shenzhen Works",
            orderDate: "2025-08-05",
            goodsEur: "26.700,00",
            freightEur: "2.700,00",
            prodDays: 28,
            transport: "air",
            transitDays: 11,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-08-ms1", label: "Deposit", percent: 37, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-08-ms2", label: "Production", percent: 23, anchor: "PROD_DONE", lagDays: 1 },
                { id: "po-demo-2025-08-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 1 },
            ],
        },
        {
            id: "po-demo-2025-09",
            poNo: "25009",
            sku: "SKU-DELTA",
            supplier: "Shenzhen Works",
            orderDate: "2025-09-09",
            goodsEur: "29.400,00",
            freightEur: "3.100,00",
            prodDays: 32,
            transport: "sea",
            transitDays: 57,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-09-ms1", label: "Deposit", percent: 34, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-09-ms2", label: "Production", percent: 26, anchor: "PROD_DONE", lagDays: 3 },
                { id: "po-demo-2025-09-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 4 },
            ],
        },
        {
            id: "po-demo-2025-10",
            poNo: "25010",
            sku: "SKU-DELTA",
            supplier: "Shenzhen Works",
            orderDate: "2025-10-06",
            goodsEur: "27.500,00",
            freightEur: "2.800,00",
            prodDays: 29,
            transport: "rail",
            transitDays: 28,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "po-demo-2025-10-ms1", label: "Deposit", percent: 33, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "po-demo-2025-10-ms2", label: "Production", percent: 27, anchor: "PROD_DONE", lagDays: 2 },
                { id: "po-demo-2025-10-ms3", label: "Balance", percent: 40, anchor: "ETA", lagDays: 5 },
            ],
        },
    ];
    demo.fos = [
        {
            id: "fo-demo-2025-09",
            foNo: "26002",
            sku: "SKU-FOXTROT",
            supplier: "Ningbo Trading",
            orderDate: "2025-09-01",
            goodsEur: "33.000,00",
            freightEur: "3.200,00",
            prodDays: 42,
            transport: "sea",
            transitDays: 60,
            ddp: false,
            dutyRatePct: "6,5",
            dutyIncludeFreight: true,
            eustRatePct: "19",
            vatRefundLagMonths: 2,
            vatRefundEnabled: true,
            fxFeePct: "0,5",
            milestones: [
                { id: "fo-demo-2025-09-ms1", label: "Deposit", percent: 20, anchor: "ORDER_DATE", lagDays: 0 },
                { id: "fo-demo-2025-09-ms2", label: "Production", percent: 50, anchor: "PROD_DONE", lagDays: 0 },
                { id: "fo-demo-2025-09-ms3", label: "Balance", percent: 30, anchor: "ETD", lagDays: 0 },
            ],
        },
    ];
    demo.forecast = {
        ...(demo.forecast || {}),
        settings: {
            ...((demo.forecast && demo.forecast.settings) || {}),
            useForecast: true,
        },
        forecastManual: {},
        forecastImport: {
            "SKU-ALPHA": buildForecastMonthMap(planningStartMonth, [
                { units: 180, revenueEur: 12582, profitEur: 3522.96 },
                { units: 210, revenueEur: 14679, profitEur: 4110.12 },
                { units: 235, revenueEur: 16426.5, profitEur: 4599.42 },
                { units: 260, revenueEur: 18174, profitEur: 5088.72 },
                { units: 240, revenueEur: 16776, profitEur: 4697.28 },
                { units: 215, revenueEur: 15028.5, profitEur: 4208 },
                { units: 195, revenueEur: 13631, profitEur: 3816.68 },
                { units: 175, revenueEur: 12233.5, profitEur: 3425.38 },
            ]),
            "SKU-BRAVO": buildForecastMonthMap(planningStartMonth, [
                { units: 120, revenueEur: 9600, profitEur: 2112 },
                { units: 128, revenueEur: 10240, profitEur: 2252.8 },
                { units: 135, revenueEur: 10800, profitEur: 2376 },
                { units: 142, revenueEur: 11360, profitEur: 2499.2 },
                { units: 138, revenueEur: 11040, profitEur: 2428.8 },
                { units: 132, revenueEur: 10560, profitEur: 2323.2 },
                { units: 126, revenueEur: 10080, profitEur: 2217.6 },
                { units: 118, revenueEur: 9440, profitEur: 2076.8 },
            ]),
        },
    };
    demo.inventory = {
        ...(demo.inventory || {}),
        snapshots: [
            {
                month: planningStartMonth,
                items: [
                    { sku: "SKU-ALPHA", amazonUnits: 1800, threePLUnits: 0 },
                    { sku: "SKU-BRAVO", amazonUnits: 1200, threePLUnits: 0 },
                ],
            },
        ],
        settings: {
            ...((demo.inventory && demo.inventory.settings) || {}),
            projectionMonths: Number(demo.settings.horizonMonths || 0),
            safetyDays: 30,
        },
    };
    demo.planProducts = [
        {
            id: "plan-demo-shaker",
            alias: "Planprodukt Demo Shaker",
            plannedSku: "PLAN-SHAKER-01",
            relationType: "standalone",
            status: "active",
            portfolioBucket: "plan",
            includeInForecast: true,
            baselineReferenceMonth: Number(planLaunchMonth.slice(5, 7)),
            baselineUnitsInReferenceMonth: 160,
            seasonalityReferenceSku: "SKU-ALPHA",
            baselineReferenceSku: "SKU-ALPHA",
            avgSellingPriceGrossEUR: 44.9,
            sellerboardMarginPct: 29,
            productionLeadTimeDaysDefault: 42,
            transportMode: "SEA",
            transitDays: 34,
            unitPriceUsd: 9.8,
            logisticsPerUnitEur: 2.7,
            freightPerUnitEur: 2.7,
            template: {
                scope: "SKU",
                name: "Planprodukt",
                fields: {
                    transportMode: "SEA",
                    transitDays: 34,
                    productionDays: 42,
                    unitPriceUsd: 9.8,
                    freightEur: 2.7,
                },
            },
            launchDate: monthStartIso(planLaunchMonth),
            rampUpWeeks: 4,
            softLaunchStartSharePct: 35,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    ];
    const fxRate = Number(demo.settings?.fxRate ?? 0) || 0;
    const goodsSettings = { fxRate };
    const { normaliseGoodsFields } = orderEditorFactory_js_1.orderEditorUtils;
    demo.pos.forEach(po => normaliseGoodsFields(po, goodsSettings));
    demo.fos.forEach(fo => normaliseGoodsFields(fo, goodsSettings));
    return demo;
}
async function render(root) {
    const commitInfo = (0, store_js_1.getLastCommitSummary)();
    const draftCount = (0, store_js_1.countDrafts)();
    const state = (0, store_js_1.loadAppState)();
    const abcSnapshot = (0, abcClassification_js_1.computeAbcClassification)(state);
    root.innerHTML = `
    <section class="card">
      <h2>Debug / Werkzeuge</h2>
      <p class="muted">Hilfsfunktionen zum schnellen Befüllen oder Zurücksetzen des lokalen Speichers.</p>
      <div class="toolbar" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:16px;">
        <button class="btn" id="seed">Testdaten &amp; POs laden</button>
        <button class="btn danger" id="wipe">Alle Daten löschen</button>
        <button class="btn secondary" id="undo" disabled>Letzten Import rückgängig</button>
      </div>
      <div id="status" class="muted" style="margin-top:12px"></div>
      <div class="muted" style="margin-top:12px">
        <div>Storage-Key: <strong>${commitInfo?.storageKey || "—"}</strong></div>
        <div>Last Commit: <strong>${commitInfo?.lastCommitAt || "—"}</strong></div>
        <div>Last Commit Meta: <strong>${commitInfo?.lastCommitMeta ? escapeHtml(JSON.stringify(commitInfo.lastCommitMeta)) : "—"}</strong></div>
        <div>Drafts (lokal): <strong>${draftCount}</strong></div>
      </div>
    </section>`;
    const debugPanel = document.createElement("section");
    debugPanel.className = "card";
    debugPanel.innerHTML = `
      <h3>ABC Debug</h3>
      <p class="muted">Kontrolle der ABC-Berechnung auf Basis der Absatzprognose (nächste 6 Monate).</p>
      <div class="row" style="gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <label style="display:flex; flex-direction:column; gap:6px;">
          SKU
          <select id="abc-debug-sku"></select>
        </label>
      </div>
      <div id="abc-debug-output" class="muted" style="margin-top:12px;"></div>
    `;
    root.append(debugPanel);
    const status = root.querySelector("#status");
    const undoBtn = root.querySelector("#undo");
    const skuSelect = root.querySelector("#abc-debug-sku");
    const output = root.querySelector("#abc-debug-output");
    let lastSnapshot = null;
    function updateStatus(msg) {
        status.textContent = msg;
        if (!msg)
            return;
        setTimeout(() => { if (status.textContent === msg)
            status.textContent = ""; }, 2500);
    }
    function hasExistingData(state) {
        if (!state)
            return false;
        const keys = ["pos", "fos", "incomings", "extras", "fixcosts", "dividends", "products"];
        return keys.some(key => Array.isArray(state[key]) && state[key].length);
    }
    function updateUndoState() {
        if (!undoBtn)
            return;
        undoBtn.disabled = !lastSnapshot;
    }
    function formatValue(value, options = {}) {
        if (!Number.isFinite(value))
            return "—";
        const formatter = new Intl.NumberFormat("de-DE", {
            maximumFractionDigits: options.maximumFractionDigits ?? 2,
        });
        return formatter.format(value);
    }
    function renderAbcDebug(sku) {
        if (!output)
            return;
        if (!sku) {
            output.textContent = "Keine SKU ausgewählt.";
            return;
        }
        const info = abcSnapshot.bySku.get(String(sku).trim().toLowerCase());
        if (!info) {
            output.textContent = "Keine Daten verfügbar.";
            return;
        }
        output.innerHTML = `
      <div>VK-Preis (Brutto): <strong>${formatValue(info.vkPriceGross)}</strong></div>
      <div>Forecast Units (6M): <strong>${formatValue(info.units6m, { maximumFractionDigits: 0 })}</strong></div>
      <div>Umsatz 6M: <strong>${formatValue(info.revenue6m)}</strong></div>
      <div>ABC: <strong>${info.abcClass || "—"}</strong></div>
    `;
    }
    if (skuSelect) {
        const skus = (state.products || [])
            .map(product => String(product?.sku || "").trim())
            .filter(Boolean);
        skuSelect.innerHTML = skus.map(sku => `<option value="${escapeHtml(sku)}">${escapeHtml(sku)}</option>`).join("");
        skuSelect.addEventListener("change", () => renderAbcDebug(skuSelect.value));
        renderAbcDebug(skuSelect.value);
    }
    root.querySelector("#seed").addEventListener("click", () => {
        const current = (0, store_js_1.loadAppState)();
        if (hasExistingData(current)) {
            const proceed = window.confirm("Daten vorhanden – überschreiben?");
            if (!proceed)
                return;
            lastSnapshot = current;
        }
        else {
            lastSnapshot = null;
        }
        const demoState = buildDemoState();
        (0, store_js_1.commitAppState)(demoState, { source: "debug:seed", action: "seed" });
        updateStatus("Testdaten wurden geladen.");
        updateUndoState();
    });
    root.querySelector("#wipe").addEventListener("click", () => {
        const empty = (0, storageLocal_js_1.createEmptyState)();
        (0, store_js_1.commitAppState)(empty, { source: "debug:wipe", action: "wipe" });
        updateStatus("Alle Daten wurden zurückgesetzt.");
    });
    if (undoBtn) {
        undoBtn.addEventListener("click", () => {
            if (!lastSnapshot)
                return;
            (0, store_js_1.commitAppState)(lastSnapshot, { source: "debug:undo", action: "undo" });
            updateStatus("Letzter Import wurde rückgängig gemacht.");
            lastSnapshot = null;
            updateUndoState();
        });
    }
    updateUndoState();
}

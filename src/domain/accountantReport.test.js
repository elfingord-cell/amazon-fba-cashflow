import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountantReportData,
  buildAccountantReportBundleFromState,
} from "./accountantReport.js";

function createState() {
  return {
    settings: {
      fxRate: "1,10",
      defaultCurrency: "EUR",
    },
    suppliers: [
      { id: "sup-1", name: "Supplier One" },
      { id: "sup-2", name: "Supplier Two" },
    ],
    products: [
      {
        sku: "SKU-A",
        alias: "Alpha",
        categoryId: "cat-1",
        template: { fields: { unitPriceUsd: "5,50", currency: "USD" } },
      },
      {
        sku: "SKU-B",
        alias: "Beta",
        categoryId: "cat-1",
        template: { fields: { unitPriceUsd: "3,00", currency: "USD" } },
      },
    ],
    productCategories: [
      { id: "cat-1", name: "Kaffee" },
    ],
    inventory: {
      snapshots: [
        {
          month: "2026-01",
          asOfDate: "2026-01-31",
          items: [
            { sku: "SKU-A", amazonUnits: 100, threePLUnits: 40, note: "ok" },
            { sku: "SKU-B", amazonUnits: 20, threePLUnits: 10, note: "ok" },
          ],
        },
      ],
    },
    payments: [
      {
        id: "pay-po1-dep",
        paidDate: "2026-01-05",
        method: "bank",
        payer: "ops",
        amountActualEurTotal: 340,
        invoiceDriveUrl: "https://drive.example.com/invoice-1",
        invoiceFolderDriveUrl: "https://drive.example.com/folder-1",
      },
      {
        id: "pay-po2-dep",
        paidDate: "",
        method: "bank",
        payer: "ops",
        amountActualEurTotal: 120,
      },
    ],
    pos: [
      {
        id: "po-1",
        poNo: "PO-1001",
        supplierId: "sup-1",
        orderDate: "2025-12-20",
        prodDays: 20,
        transitDays: 10,
        etaManual: "2026-01-25",
        milestones: [
          { id: "po1-ms-dep", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po1-ms-bal", label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po1-ms-dep": {
            status: "paid",
            paymentId: "pay-po1-dep",
            amountActualEur: 340,
          },
        },
        autoEvents: [],
        items: [
          {
            id: "po1-item-a",
            sku: "SKU-A",
            units: "100",
            unitCostUsd: "4,00",
            unitExtraUsd: "0,20",
            extraFlatUsd: "10,00",
            unitCostManuallyEdited: false,
          },
        ],
      },
      {
        id: "po-2",
        poNo: "PO-1002",
        supplierId: "sup-2",
        orderDate: "2026-01-03",
        prodDays: 15,
        transitDays: 12,
        etaDate: "2026-02-02",
        milestones: [
          { id: "po2-ms-dep", label: "Deposit", percent: 50, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po2-ms-bal", label: "Balance", percent: 50, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {
          "po2-ms-dep": {
            status: "paid",
            paymentId: "pay-po2-dep",
          },
        },
        autoEvents: [],
        items: [
          {
            id: "po2-item-b",
            sku: "SKU-B",
            units: "50",
            unitCostUsd: "3,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
      },
      {
        id: "po-3",
        poNo: "PO-1003",
        supplierId: "sup-1",
        orderDate: "2026-01-10",
        prodDays: 10,
        transitDays: 10,
        eta: "2026-01-30",
        milestones: [
          { id: "po3-ms-dep", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
          { id: "po3-ms-bal", label: "Balance", percent: 60, anchor: "PROD_DONE", lagDays: 0 },
        ],
        paymentLog: {},
        autoEvents: [],
        items: [
          {
            id: "po3-item-a",
            sku: "SKU-A",
            units: "20",
            unitCostUsd: "5,00",
            unitExtraUsd: "0,00",
            extraFlatUsd: "0,00",
            unitCostManuallyEdited: false,
          },
        ],
      },
    ],
    fos: [],
  };
}

function parseZipEntryNames(bytes) {
  const names = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);
    if (signature !== 0x04034b50) break;
    const fileNameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const compressedSize = (
      bytes[offset + 18]
      | (bytes[offset + 19] << 8)
      | (bytes[offset + 20] << 16)
      | (bytes[offset + 21] << 24)
    ) >>> 0;

    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const nameBytes = bytes.slice(nameStart, nameEnd);
    names.push(new TextDecoder().decode(nameBytes));

    offset = nameEnd + extraLength + compressedSize;
  }
  return names;
}

test("accountant report: applies paid and arrival month filters", () => {
  const report = buildAccountantReportData(createState(), {
    month: "2026-01",
    scope: "core",
  });

  assert.equal(report.deposits.length, 1);
  assert.equal(report.deposits[0].poNumber, "PO-1001");

  const arrivalPoNumbers = report.arrivals.map((row) => row.poNumber).sort();
  assert.deepEqual(arrivalPoNumbers, ["PO-1001", "PO-1003"]);

  assert.equal(report.poLedger.length, 3);
  const ledgerPo1 = report.poLedger.find((row) => row.poNumber === "PO-1001");
  const ledgerPo2 = report.poLedger.find((row) => row.poNumber === "PO-1002");
  const ledgerPo3 = report.poLedger.find((row) => row.poNumber === "PO-1003");
  assert.ok(ledgerPo1);
  assert.ok(ledgerPo2);
  assert.ok(ledgerPo3);
  assert.equal(ledgerPo1?.monthMarker, true);
  assert.equal(ledgerPo1?.monthMarkerReason, "deposit+arrival");
  assert.equal(ledgerPo3?.monthMarkerReason, "arrival");
  assert.equal(ledgerPo2?.monthMarker, false);
  assert.equal(ledgerPo1?.depositActualEurMonth, 340);
  assert.ok(Math.abs(Number(ledgerPo1?.depositAmountUsdMonth || 0) - 129) < 0.0001);

  assert.ok(report.quality.some((issue) => issue.code === "PAID_WITHOUT_DATE"));
  assert.ok(report.quality.some((issue) => issue.code === "ARRIVAL_FROM_ETA"));
});

test("accountant report: explicit arrivalDate overrides ETA in arrivals and ledger", () => {
  const state = createState();
  state.pos[0].arrivalDate = "2026-01-28";
  const report = buildAccountantReportData(state, {
    month: "2026-01",
    scope: "core",
  });

  const arrivalPo1 = report.arrivals.find((row) => row.poNumber === "PO-1001");
  const ledgerPo1 = report.poLedger.find((row) => row.poNumber === "PO-1001");
  assert.ok(arrivalPo1);
  assert.ok(ledgerPo1);
  assert.equal(arrivalPo1?.arrivalDate, "2026-01-28");
  assert.equal(ledgerPo1?.arrivalDate, "2026-01-28");
  assert.equal(ledgerPo1?.arrivalSource, "actual");
});

test("accountant report: keeps export possible without snapshot and uses override", () => {
  const report = buildAccountantReportData(createState(), {
    month: "2026-02",
    scope: "core",
  }, {
    inventoryValueOverrideEur: 123456,
  });

  assert.equal(report.inventory.snapshotAsOf, "2026-02-28");
  assert.equal(report.inventory.manualOverrideUsed, true);
  assert.equal(report.inventory.totalValueEur, 123456);
  assert.ok(report.quality.some((issue) => issue.code === "MISSING_SNAPSHOT"));
});

test("accountant report bundle: zip contains required core files and optional journal", async () => {
  const state = createState();

  const coreBundle = await buildAccountantReportBundleFromState(state, {
    month: "2026-01",
    scope: "core",
  }, {
    workspaceName: "WS-1",
  });

  const coreNames = parseZipEntryNames(new Uint8Array(await coreBundle.zipBlob.arrayBuffer()));
  assert.ok(coreNames.includes("buchhaltung_2026-01_bericht.pdf"));
  assert.ok(coreNames.includes("buchhaltung_2026-01.xlsx"));
  assert.ok(coreNames.includes("buchhaltung_2026-01_warenbestand.csv"));
  assert.ok(coreNames.includes("buchhaltung_2026-01_anzahlungen_po.csv"));
  assert.ok(coreNames.includes("buchhaltung_2026-01_wareneingang_po.csv"));
  assert.ok(coreNames.includes("buchhaltung_2026-01_anzahlung_wareneingang_po.csv"));
  assert.ok(coreNames.includes("buchhaltung_2026-01_email.txt"));
  assert.equal(coreNames.includes("buchhaltung_2026-01_zahlungsjournal.csv"), false);

  const journalBundle = await buildAccountantReportBundleFromState(state, {
    month: "2026-01",
    scope: "core_plus_journal",
  }, {
    workspaceName: "WS-1",
  });
  const journalNames = parseZipEntryNames(new Uint8Array(await journalBundle.zipBlob.arrayBuffer()));
  assert.ok(journalNames.includes("buchhaltung_2026-01_zahlungsjournal.csv"));
  assert.match(journalBundle.emailDraft.subject, /Unterlagen Buchhaltung 2026-01 - Mandant WS-1/);
});

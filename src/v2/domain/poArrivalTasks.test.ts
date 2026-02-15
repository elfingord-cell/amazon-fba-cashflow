import test from "node:test";
import assert from "node:assert/strict";
import { buildPoArrivalTasks } from "./poArrivalTasks";

function createState(): Record<string, unknown> {
  return {
    suppliers: [
      { id: "sup-1", name: "Supplier One" },
    ],
    products: [
      { sku: "SKU-A", alias: "Alpha" },
      { sku: "SKU-B", alias: "Beta" },
    ],
    pos: [
      {
        id: "po-current-month",
        poNo: "PO-1001",
        supplierId: "sup-1",
        etaManual: "2026-02-20",
        items: [{ sku: "SKU-A", units: 100 }],
      },
      {
        id: "po-overdue-open",
        poNo: "PO-1002",
        supplierId: "sup-1",
        etaManual: "2026-01-10",
        items: [{ sku: "SKU-B", units: 40 }],
      },
      {
        id: "po-overdue-arrived",
        poNo: "PO-1003",
        supplierId: "sup-1",
        etaManual: "2026-01-05",
        arrivalDate: "2026-01-07",
        items: [{ sku: "SKU-A", units: 30 }],
      },
      {
        id: "po-multi-sku",
        poNo: "PO-1004",
        supplierId: "sup-1",
        etaManual: "2026-02-12",
        arrivalDate: "2026-02-14",
        items: [
          { sku: "SKU-A", units: 10 },
          { sku: "SKU-B", units: 15 },
        ],
      },
    ],
  };
}

test("po arrival tasks: includes ETA in selected month", () => {
  const tasks = buildPoArrivalTasks({
    state: createState(),
    month: "2026-02",
    todayIso: "2026-02-15",
  });

  const poNumbers = tasks.map((row) => row.poNumber);
  assert.ok(poNumbers.includes("PO-1001"));
});

test("po arrival tasks: includes overdue ETA without arrival date", () => {
  const tasks = buildPoArrivalTasks({
    state: createState(),
    month: "2026-02",
    todayIso: "2026-02-15",
  });

  const overdue = tasks.find((row) => row.poNumber === "PO-1002");
  assert.ok(overdue);
  assert.equal(overdue?.isOverdue, true);
  assert.equal(overdue?.pending, true);
});

test("po arrival tasks: arrived overdue PO is not shown in pending scope", () => {
  const tasks = buildPoArrivalTasks({
    state: createState(),
    month: "2026-02",
    todayIso: "2026-02-15",
  });
  assert.equal(tasks.some((row) => row.poNumber === "PO-1003"), false);
});

test("po arrival tasks: resolves multi-sku aliases and unit sums", () => {
  const tasks = buildPoArrivalTasks({
    state: createState(),
    month: "2026-02",
    todayIso: "2026-02-15",
  });

  const multiSku = tasks.find((row) => row.poNumber === "PO-1004");
  assert.ok(multiSku);
  assert.equal(multiSku?.skuAliases, "Alpha, Beta");
  assert.equal(multiSku?.units, 25);
});

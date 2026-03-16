import test from "node:test";
import assert from "node:assert/strict";

function createStorageStub() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
  };
}

async function loadSumPaymentEvents() {
  globalThis.localStorage = createStorageStub();
  globalThis.document = {
    body: {
      appendChild() {},
    },
    getElementById() {
      return null;
    },
    createElement() {
      return {
        id: "",
        className: "",
        hidden: false,
      };
    },
  };
  const mod = await import(`./dashboard.js?test=${Date.now()}`);
  return mod.sumPaymentEvents;
}

test("sumPaymentEvents treats paid PO rows as settled even when actual differs from plan", async () => {
  const sumPaymentEvents = await loadSumPaymentEvents();
  const result = sumPaymentEvents(
    [
      {
        month: "2026-06",
        plannedEur: 100,
        actualEur: 40,
        paid: true,
        paidDate: "2026-03-16",
      },
    ],
    "2026-06",
    "2026-03",
  );

  assert.equal(result.value, 40);
  assert.equal(result.plannedTotal, 40);
  assert.equal(result.actualTotal, 40);
  assert.equal(result.displayLabel, "Ist (bezahlt)");
  assert.equal(result.paidThisMonthCount, 1);
});

test("sumPaymentEvents keeps mixed label when paid and open PO rows share a month", async () => {
  const sumPaymentEvents = await loadSumPaymentEvents();
  const result = sumPaymentEvents(
    [
      {
        month: "2026-06",
        plannedEur: 100,
        actualEur: 40,
        paid: true,
        paidDate: "2026-03-16",
      },
      {
        month: "2026-06",
        plannedEur: 60,
        actualEur: 0,
        paid: false,
        paidDate: null,
      },
    ],
    "2026-06",
    "2026-03",
  );

  assert.equal(result.value, 100);
  assert.equal(result.plannedTotal, 100);
  assert.equal(result.actualTotal, 40);
  assert.equal(result.displayLabel, "Ist+Plan gemischt");
});

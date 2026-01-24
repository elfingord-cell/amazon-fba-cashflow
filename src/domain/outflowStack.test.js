import test from "node:test";
import assert from "node:assert/strict";
import { computeOutflowStack } from "./cashflow.js";

test("splits PO paid vs open with multiple payments", () => {
  const entries = [
    { direction: "out", source: "po", kind: "po", paid: true, amount: 100 },
    { direction: "out", source: "po", kind: "po", paid: false, amount: 50 },
    { direction: "out", source: "po", kind: "po", paid: true, amount: 25 },
  ];
  const res = computeOutflowStack(entries);
  assert.equal(res.poPaid, 125);
  assert.equal(res.poOpen, 50);
  assert.equal(res.total, 175);
});

test("keeps categories MECE across fixcost, fo, and other expenses", () => {
  const entries = [
    { direction: "out", group: "Fixkosten", amount: 200 },
    { direction: "out", source: "fo", kind: "fo", amount: 80 },
    { direction: "out", source: "extras", kind: "extra", amount: 40 },
    { direction: "out", source: "po", kind: "po", paid: false, amount: 60 },
  ];
  const res = computeOutflowStack(entries);
  assert.equal(res.fixedCosts, 200);
  assert.equal(res.foPlanned, 80);
  assert.equal(res.otherExpenses, 40);
  assert.equal(res.poOpen, 60);
  assert.equal(res.poPaid, 0);
  assert.equal(res.total, 380);
});

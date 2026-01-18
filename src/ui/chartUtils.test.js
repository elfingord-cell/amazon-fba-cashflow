import test from "node:test";
import assert from "node:assert/strict";
import { computeNiceTickStep, formatEUR, getNiceTicks } from "./chartUtils.js";

test("computeNiceTickStep chooses expected steps", () => {
  assert.equal(computeNiceTickStep(8000), 5000);
  assert.equal(computeNiceTickStep(40000), 5000);
  assert.equal(computeNiceTickStep(60000), 10000);
});

test("formatEUR formats using German locale with euros", () => {
  assert.equal(formatEUR(12345), "12.345\u00a0€");
  assert.equal(formatEUR(-9876), "-9.876\u00a0€");
});

test("getNiceTicks includes zero and expected bounds", () => {
  const res = getNiceTicks(-12000, 42000);
  assert.equal(res.step, 10000);
  assert.ok(res.ticks.includes(0));
  assert.equal(res.minTick, -20000);
  assert.equal(res.maxTick, 50000);
});

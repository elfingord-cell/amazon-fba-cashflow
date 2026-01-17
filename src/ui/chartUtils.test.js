import test from "node:test";
import assert from "node:assert/strict";
import { computeNiceTickStep, formatEUR } from "./chartUtils.js";

test("computeNiceTickStep chooses expected steps", () => {
  assert.equal(computeNiceTickStep(800), 1000);
  assert.equal(computeNiceTickStep(6000), 2000);
  assert.equal(computeNiceTickStep(24000), 5000);
  assert.equal(computeNiceTickStep(26000), 10000);
  assert.equal(computeNiceTickStep(90000), 20000);
  assert.equal(computeNiceTickStep(260000), 50000);
});

test("formatEUR formats using German locale with euros", () => {
  assert.equal(formatEUR(12345), "12.345\u00a0€");
  assert.equal(formatEUR(-9876), "-9.876\u00a0€");
});

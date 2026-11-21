import test from "node:test";
import assert from "node:assert/strict";
import { calculateSiteMaterialCosts } from "./site-material-costs.ts";

test("prices outbound and legacy positive issue quantities as absolute quantities", () => {
  const result = calculateSiteMaterialCosts([
    { quantity: -4, unit_cost: 250 },
    { quantity: 2.5, unit_cost: 200 },
  ]);
  assert.deepEqual(
    result.items.map(({ quantity, cost }) => [quantity, cost]),
    [
      [4, 1000],
      [2.5, 500],
    ],
  );
  assert.equal(result.total, 1500);
});

test("unpriced materials are distinguished from zero quantities and never inflate totals", () => {
  const result = calculateSiteMaterialCosts([
    { quantity: 2, unit_cost: null },
    { quantity: -2, unit_cost: 0 },
    { quantity: 0, unit_cost: null },
  ]);
  assert.equal(result.total, 0);
  assert.equal(result.unpriced, 2);
  assert.deepEqual(
    result.items.map(({ cost }) => cost),
    [null, null, null],
  );
});

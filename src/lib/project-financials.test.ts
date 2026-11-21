import test from "node:test";
import assert from "node:assert/strict";
import { calculateProjectFinancials, type FinancialSnapshot } from "./project-financials.ts";

const fixture: FinancialSnapshot = {
  budget: 100_000,
  canEditBudget: false,
  syncedAt: "",
  approvedReports: 1,
  crew: [{ name: "عامل", period_count: 1, cumulative_count: 2 }],
  materials: {
    period_cost: 10_000,
    cumulative_cost: 20_000,
    period_unpriced: 0,
    cumulative_unpriced: 0,
  },
};
const wages = [{ title: "عامل", daily_rate: 30_000, monthly_rate: 0, currency: "IQD" }];
const totals = (budget: number | null) => calculateProjectFinancials({ ...fixture, budget }, wages);

test("uses approved biometric rates and combines period costs separately from contract-to-date spend", () => {
  const result = totals(100_000);
  assert.equal(result.labor, 30_000);
  assert.equal(result.material, 10_000);
  assert.equal(result.actual, 40_000);
  assert.equal(result.cumulativeActual, 80_000);
  assert.equal(result.varianceAmount, -20_000);
  assert.equal(result.variancePercent, -20);
  assert.equal(result.status, "warning");
});

test("handles the 80 and 100 percent boundaries, overspending and missing budgets", () => {
  assert.equal(totals(100_001).status, "safe");
  assert.equal(totals(80_000).status, "warning");
  assert.equal(totals(80_000).variancePercent, 0);
  assert.equal(totals(40_000).status, "over");
  assert.equal(totals(40_000).variancePercent, 100);
  assert.equal(totals(null).variancePercent, null);
  assert.equal(totals(0).status, "unbudgeted");
});

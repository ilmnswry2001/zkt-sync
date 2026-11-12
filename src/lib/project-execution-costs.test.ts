import test from "node:test";
import assert from "node:assert/strict";
import {
  verifiedSpecialtyCosts,
  projectDailyRate,
  projectCostCrew,
} from "./project-execution-costs.ts";
test("saved workshop attendance charges one site once with or without a punch", () => {
  const line = (employee_id: string, workshop: string, site_id: string | null = null) => ({
    employee_id,
    site_id,
    role_label: "steel",
    daily_workshop_reports: { work_site_id: workshop },
  });
  const crew = projectCostCrew(
    [{ employee_id: "a", site_id: "x", specialty: "steel", conflicting: false }],
    [
      line("a", "x"),
      line("b", "x"),
      line("b", "x"),
      line("c", "x"),
      line("c", "y"),
      line("d", "y", "x"),
    ],
  );
  const costs = verifiedSpecialtyCosts(
    crew.filter((p) => p.site_id === "x" && !p.conflicting),
    [{ title: "steel", daily_rate: 50000, monthly_rate: 0, currency: "IQD" }],
  );
  assert.equal(costs[0].count, 3);
  assert.equal(costs[0].cost, 150000);
  assert.equal(crew.find((p) => p.employee_id === "c")?.conflicting, true);
});
test("a repeated employee cannot inflate verified payroll", () => {
  const result = verifiedSpecialtyCosts(
    [
      { employee_id: "a", specialty: " steel " },
      { employee_id: "a", specialty: "steel" },
      { employee_id: "b", specialty: "steel" },
    ],
    [{ title: "steel", daily_rate: 50000, monthly_rate: 0, currency: "IQD" }],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 2);
  assert.equal(result[0].cost, 100000);
});
test("planned and actual costing use the same monthly fallback rate", () => {
  const wages = [{ title: "steel", daily_rate: 0, monthly_rate: 1300000, currency: "IQD" }];
  assert.equal(projectDailyRate(" steel ", wages), 50000);
  assert.equal(
    verifiedSpecialtyCosts([{ employee_id: "a", specialty: "steel" }], wages)[0].cost,
    50000,
  );
});
test("foreign currencies and zero rates cannot be silently treated as IQD", () => {
  const costs = verifiedSpecialtyCosts(
    [{ employee_id: "a", specialty: "steel" }],
    [{ title: "steel", daily_rate: 100, monthly_rate: 0, currency: "USD" }],
  );
  assert.equal(costs[0].hasRate, false);
  assert.equal(costs[0].usedDefault, true);
  assert.notEqual(costs[0].dailyRate, 100);
  assert.deepEqual(verifiedSpecialtyCosts([], []), []);
});

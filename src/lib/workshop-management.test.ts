import test from "node:test";
import assert from "node:assert/strict";
import {
  matchWorkshopPunches,
  reorderWorkshopIds,
  workshopPeriodDays,
  workshopSiteLabel,
} from "./workshop-management.ts";

test("marks matching employees across workshops, using employee numbers for older punches", () => {
  const member = (workshop_id: string, employee_id: string, employee_no: string) => ({
    workshop_id, employee_id, employee: { employee_no },
  });
  const { byWorkshop, employeeCount } = matchWorkshopPunches(
    [member("first", "employee-a", "01"), member("second", "employee-b", "02"),
      member("second", "employee-a", "01"), member("third", "employee-c", "03")],
    [{ employee_id: "employee-a", employee_no: "old-no" }, { employee_id: null, employee_no: "02" },
      { employee_id: null, employee_no: "02" }, { employee_id: null, employee_no: "99" }],
  );
  assert.deepEqual(byWorkshop, new Map([
    ["first", new Set(["employee-a"])], ["second", new Set(["employee-b", "employee-a"])],
  ]));
  assert.equal(employeeCount, 2);
});

test("reorders across filtered workshops without dropping hidden workshops", () => {
  const original = ["a", "hidden", "b", "c"];
  assert.deepEqual(reorderWorkshopIds(original, "c", "a"), ["c", "a", "hidden", "b"]);
  assert.deepEqual(original, ["a", "hidden", "b", "c"]);
});
test("moves downward and safely ignores stale drag targets", () => {
  assert.deepEqual(reorderWorkshopIds(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(reorderWorkshopIds(["a", "b"], "missing", "b"), ["a", "b"]);
});

test("assignment periods include both endpoints across month and leap-day boundaries", () => {
  assert.equal(workshopPeriodDays("2026-11-11", "2026-11-11"), 1);
  assert.equal(workshopPeriodDays("2026-11-30", "2026-12-02"), 3);
  assert.equal(workshopPeriodDays("2028-02-28", "2028-03-01"), 3);
});
test("rejects reversed, impossible and excessive assignment periods", () => {
  assert.equal(workshopPeriodDays("2026-11-12", "2026-11-11"), 0);
  assert.equal(workshopPeriodDays("2026-02-30", "2026-03-02"), 0);
  assert.equal(workshopPeriodDays("", "2026-11-11"), 0);
  assert.equal(workshopPeriodDays("2026-01-01", "2027-01-01"), 366);
  assert.equal(workshopPeriodDays("2026-01-01", "2027-01-02"), 0);
});

test("project labels preserve the full CTR and project name", () => {
  assert.equal(
    workshopSiteLabel({ id: "x", name: "Station Five Steel Works", ctr_code: "CTR-005-STEEL" }),
    "CTR-005-STEEL — Station Five Steel Works",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  appendStaffEmployee,
  appendStaffNames,
  normalizePersonName,
  normalizeStaffAssignments,
  removeStaffEmployee,
} from "./planning-staff.ts";

test("normalizes only the edges and repeated whitespace of a name", () => {
  assert.equal(normalizePersonName("علي عماد"), "علي عماد");
  assert.equal(normalizePersonName("  علي   عماد "), "علي عماد");
});

test("appends consecutive names to the same specialty", () => {
  const first = appendStaffNames([], "نجار", "علي عماد");
  const second = appendStaffNames(first.assignments, "نجار", "سالم خليل");

  assert.deepEqual(second.assignments, [
    { specialty: "نجار", names: ["علي عماد", "سالم خليل"], employees: [] },
  ]);
});

test("reads legacy flat assignments and avoids duplicate names", () => {
  const legacy = normalizeStaffAssignments([
    { name: "  علي   عماد ", specialty: "نجار" },
    { name: "علي عماد", specialty: "نجار" },
  ]);

  assert.deepEqual(legacy, [{ specialty: "نجار", names: ["علي عماد"], employees: [] }]);
});

test("stores employee metadata and prevents assigning the employee twice in a plan", () => {
  const employee = {
    id: "employee-1",
    full_name: "علي عماد",
    employee_no: "1001",
    phone: "07700000000",
    position: "نجار",
    department_name: "الإنشاءات",
  };
  const first = appendStaffEmployee([], "نجار", employee);
  const duplicate = appendStaffEmployee(first.assignments, "كهربائي", employee);

  assert.equal(first.duplicate, false);
  assert.deepEqual(first.assignments[0].names, ["علي عماد"]);
  assert.deepEqual(first.assignments[0].employees, [employee]);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.assignments, first.assignments);
});

test("normalizes employee assignments while retaining legacy names for printing", () => {
  const assignments = normalizeStaffAssignments([
    {
      specialty: "نجار",
      names: ["علي عماد"],
      employees: [
        {
          id: "employee-1",
          full_name: " علي   عماد ",
          employee_no: "1001",
          phone: null,
          position: "نجار",
          department_name: null,
        },
      ],
    },
  ]);

  assert.deepEqual(assignments[0].names, ["علي عماد"]);
  assert.equal(assignments[0].employees[0].employee_no, "1001");
  assert.deepEqual(removeStaffEmployee(assignments, "نجار", "employee-1"), []);
});
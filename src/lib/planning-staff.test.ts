import assert from "node:assert/strict";
import test from "node:test";
import {
  appendStaffEmployee,
  appendStaffNames,
  normalizePersonName,
  normalizeStaffAssignments,
  removeStaffEmployee,
  suggestStaffEmployees,
  isStaffEmployeeAssigned,
} from "./planning-staff.ts";

const staffFixture = (id: string, name: string, position = "عامل") => ({ id, full_name: name, employee_no: id, phone: null, position, department_name: null });

test("suggests exactly 50 employees with specialty matches first", () => {
  const employees = Array.from({ length: 70 }, (_, i) => staffFixture(String(i), `موظف ${i}`));
  employees.push(staffFixture("6358", "عماد وليد", "اداري موقع"));
  const result = suggestStaffEmployees(employees, "إداري موقع");
  assert.equal(result.length, 50);
  assert.equal(result[0].employee_no, "6358");
});

test("searches beyond the first 50 and allows unrelated specialties", () => {
  const employees = Array.from({ length: 1600 }, (_, i) => staffFixture(String(i), `موظف ${i}`, "ريكر"));
  employees.push(staffFixture("6358", "عِماد وليد عبدالعالي الحميدي", "اداري موقع"));
  assert.equal(suggestStaffEmployees(employees, "ريكر", "عماد وليد")[0]?.employee_no, "6358");
  assert.equal(suggestStaffEmployees(employees, "ريكر", "6358", true)[0]?.employee_no, "6358");
});

test("distinct employees with the same name can both be assigned", () => {
  const first = staffFixture("1", "محمد كامل");
  const second = staffFixture("2", "محمد كامل");
  const assigned = appendStaffEmployee([], "ريكر", first).assignments;
  assert.equal(isStaffEmployeeAssigned(assigned, second), false);
  assert.equal(appendStaffEmployee(assigned, "ريكر", second).duplicate, false);
});

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
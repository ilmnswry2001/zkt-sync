import assert from "node:assert/strict";
import test from "node:test";
import { matchZktecoPins } from "./zkteco-employee-matching.ts";

function employeeAdmin(rows: { id: string; employee_no: string; attendance_device_id: string }[], error: unknown = null) {
  return {
    from(table: string) {
      assert.equal(table, "employees");
      return {
        select(columns: string) {
          assert.equal(columns, "id, employee_no, attendance_device_id");
          return {
            in(column: string, pins: string[]) {
              assert.equal(column, "attendance_device_id");
              return Promise.resolve({ data: rows.filter((row) => pins.includes(row.attendance_device_id)), error });
            },
          };
        },
      };
    },
  };
}

test("matches a device pin only through Attendance Device ID when employee_no differs", async () => {
  const employees = [{ id: "employee-1", employee_no: "2048", attendance_device_id: "5116" }];
  const matches = await matchZktecoPins(employeeAdmin(employees), ["5116", "2048"]);

  assert.equal(matches.get("5116")?.id, "employee-1");
  assert.equal(matches.has("2048"), false);
});

test("does not assign an ambiguous Attendance Device ID", async () => {
  const employees = [
    { id: "employee-1", employee_no: "2048", attendance_device_id: "5116" },
    { id: "employee-2", employee_no: "3099", attendance_device_id: "5116" },
  ];
  const matches = await matchZktecoPins(employeeAdmin(employees), ["5116"]);

  assert.equal(matches.has("5116"), false);
});

test("refuses to fall back when Attendance Device ID is unavailable in the schema", async () => {
  const admin = employeeAdmin([], { code: "42703", message: "column attendance_device_id does not exist" });

  await assert.rejects(matchZktecoPins(admin, ["5116"]), /Attendance Device ID غير موجود/);
});

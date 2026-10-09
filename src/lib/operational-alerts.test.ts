import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationalAlerts } from "./operational-alerts.ts";

const baseInput = {
  today: "2026-10-06",
  employees: [
    {
      id: "employee-1",
      employee_no: "1001",
      full_name: "موظف تجريبي",
      department_id: "department-1",
      contract_end_date: "2026-11-05",
      passport_expiry: null,
      residency_expiry: null,
      safety_passport_expiry: null,
    },
  ],
  items: [
    { id: "item-1", name: "مثقاب", code: "T-01", min_qty: 5, is_active: true },
  ],
  warehouses: [
    { id: "warehouse-1", name: "المخزن الرئيسي", is_active: true },
    { id: "warehouse-2", name: "مخزن الموقع", is_active: true },
  ],
  movements: [
    { item_id: "item-1", warehouse_id: "warehouse-1", qty_delta: 3 },
    { item_id: "item-1", warehouse_id: "warehouse-2", qty_delta: 5 },
  ],
  tasks: [
    { id: "task-open", title: "فحص الموقع", due_date: "2026-10-05", status: "in_progress", employee_id: "employee-1", department_id: "department-1" },
    { id: "task-done", title: "مهمة مكتملة", due_date: "2026-10-01", status: "completed", employee_id: "employee-1", department_id: "department-1" },
  ],
};

test("builds critical stock, 30-day document, and overdue task alerts", () => {
  const alerts = buildOperationalAlerts(baseInput);
  assert.equal(alerts.length, 3);
  assert.deepEqual(alerts.map((alert) => alert.severity), ["critical", "warning", "follow_up"]);
  assert.match(alerts[0].href, /warehouses\?critical=true/);
  assert.match(alerts[1].href, /employees\/employee-1/);
  assert.equal(alerts[2].id, "task:task-open");
});

test("does not alert for expired documents, safe stock, or completed tasks", () => {
  const alerts = buildOperationalAlerts({
    ...baseInput,
    employees: baseInput.employees.map((employee) => ({ ...employee, contract_end_date: "2026-10-05" })),
    movements: baseInput.warehouses.map((warehouse) => ({ item_id: "item-1", warehouse_id: warehouse.id, qty_delta: 8 })),
    tasks: baseInput.tasks.map((task) => ({ ...task, status: "completed" })),
  });
  assert.deepEqual(alerts, []);
});

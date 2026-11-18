import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dateKeyInTimeZone } from "@/lib/date-time";
import { loadAllRows } from "@/lib/monthly-report";
import {
  buildOperationalAlerts,
  type EmployeeAlertRow,
  type ItemAlertRow,
  type MovementAlertRow,
  type TaskAlertRow,
  type WarehouseAlertRow,
} from "@/lib/operational-alerts";

async function getDepartmentScope(supabase: SupabaseClient<Database>, userId: string) {
  const [assignments, managed] = await Promise.all([
    supabase.from("user_departments").select("department_id").eq("user_id", userId),
    supabase.from("department_managers").select("department_id").eq("user_id", userId),
  ]);
  if (assignments.error) throw assignments.error;
  if (managed.error) throw managed.error;
  return [
    ...new Set([
      ...(assignments.data ?? []).map((row) => row.department_id),
      ...(managed.data ?? []).map((row) => row.department_id),
    ]),
  ];
}

async function fetchOperationalAlerts(
  supabase: SupabaseClient<Database>,
  today: string,
  userId: string,
  scoped: boolean,
) {
  const departmentIds = scoped ? await getDepartmentScope(supabase, userId) : undefined;
  const employeeQuery = supabase
    .from("employees")
    .select(
      "id, employee_no, full_name, department_id, contract_end_date, passport_expiry, residency_expiry, safety_passport_expiry",
    )
    .eq("status", "active")
    .order("id");
  const taskQuery = supabase
    .from("employee_tasks")
    .select("id, title, due_date, status, employee_id, department_id")
    .lt("due_date", today)
    .is("archived_at", null)
    .order("due_date")
    .order("id");
  const scopedEmployees = departmentIds
    ? departmentIds.length
      ? employeeQuery.in("department_id", departmentIds)
      : null
    : employeeQuery;
  const scopedTasks = departmentIds
    ? departmentIds.length
      ? taskQuery.in("department_id", departmentIds)
      : null
    : taskQuery;
  const [itemsResult, warehousesResult] = await Promise.all([
    supabase
      .from("warehouse_items")
      .select("id, name, code, min_qty, is_active")
      .gt("min_qty", 0)
      .eq("is_active", true),
    supabase.from("warehouses").select("id, name, is_active").eq("is_active", true),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (warehousesResult.error) throw warehousesResult.error;
  const monitoredItemIds = (itemsResult.data ?? [])
    .filter((item) => Number(item.min_qty) > 0)
    .map((item) => item.id);
  const readMovements = async () => {
    const movements: MovementAlertRow[] = [];
    for (let offset = 0; offset < monitoredItemIds.length; offset += 80) {
      const itemIds = monitoredItemIds.slice(offset, offset + 80);
      movements.push(
        ...(await loadAllRows<MovementAlertRow>((from, to) =>
          supabase
            .from("stock_movements")
            .select("item_id, warehouse_id, qty_delta")
            .in("item_id", itemIds)
            .order("id")
            .range(from, to),
        )),
      );
    }
    return movements;
  };
  const [movements, employees, tasks] = await Promise.all([
    readMovements(),
    scopedEmployees
      ? loadAllRows<EmployeeAlertRow>((from, to) => scopedEmployees.range(from, to))
      : Promise.resolve([] as EmployeeAlertRow[]),
    scopedTasks
      ? loadAllRows<TaskAlertRow>((from, to) => scopedTasks.range(from, to))
      : Promise.resolve([] as TaskAlertRow[]),
  ]);
  return buildOperationalAlerts({
    today,
    items: (itemsResult.data ?? []) as ItemAlertRow[],
    warehouses: (warehousesResult.data ?? []) as WarehouseAlertRow[],
    movements,
    employees,
    tasks,
  });
}

export const getOperationalAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context: { supabase, userId } }) => {
    const [roles, ceo] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("form_role_assignments").select("role").eq("role", "ceo").eq("user_id", userId),
    ]);
    if (roles.error) throw roles.error;
    if (ceo.error) throw ceo.error;
    const global =
      ceo.data.length > 0 || roles.data.some(({ role }) => role === "admin" || role === "hr");
    if (!global && !roles.data.some(({ role }) => role === "department_manager"))
      return { count: 0, recent: [] };
    const alerts = await fetchOperationalAlerts(
      supabase,
      dateKeyInTimeZone(new Date()),
      userId,
      !global,
    );
    return { count: alerts.length, recent: alerts.slice(0, 6) };
  });

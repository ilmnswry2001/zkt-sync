import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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

async function getDepartmentScope(userId: string) {
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

async function fetchOperationalAlerts(today: string, userId: string, scoped: boolean) {
  const departmentIds = scoped ? await getDepartmentScope(userId) : undefined;
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
      .eq("is_active", true),
    supabase.from("warehouses").select("id, name, is_active").eq("is_active", true),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (warehousesResult.error) throw warehousesResult.error;
  const monitoredItemIds = (itemsResult.data ?? [])
    .filter((item) => Number(item.min_qty) > 0)
    .map((item) => item.id);
  const [movements, employees, tasks] = await Promise.all([
    monitoredItemIds.length
      ? loadAllRows<MovementAlertRow>((from, to) =>
          supabase
            .from("stock_movements")
            .select("item_id, warehouse_id, qty_delta")
            .in("item_id", monitoredItemIds)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([] as MovementAlertRow[]),
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

export function useOperationalAlerts() {
  const { user, isAdmin, isHR, isCompanyManager, isDepartmentManager } = useAuth();
  const canView = isAdmin || isHR || isCompanyManager || isDepartmentManager;
  const departmentScoped = isDepartmentManager && !isAdmin && !isHR && !isCompanyManager;
  return useQuery({
    queryKey: ["operational-alerts", user?.id, departmentScoped],
    queryFn: () =>
      fetchOperationalAlerts(dateKeyInTimeZone(new Date()), user!.id, departmentScoped),
    enabled: canView && !!user,
    refetchInterval: 120_000,
  });
}

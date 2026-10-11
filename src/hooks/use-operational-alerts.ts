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

async function fetchMaterialRequestAlerts(userId: string) {
  const requestDb = supabase as any;
  const { data, error } = await requestDb
    .from("material_request_events")
    .select(
      "id, action, note, created_at, request:material_requests!inner(id, request_number, created_by, request_type, status)",
    )
    .eq("request.created_by", userId)
    .in("action", ["planning_return", "planning_reject", "receipt_confirmed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      action: string;
      note: string | null;
      created_at: string;
      request: { id: string; request_number: string; request_type: string; status: string };
    }>
  ).flatMap((event) => {
    const request = event.request;
    if (
      event.action === "receipt_confirmed" &&
      !["partially_received", "received"].includes(request.status)
    )
      return [];
    const title =
      event.action === "planning_return"
        ? "أُعيد طلبك للتعديل"
        : event.action === "planning_reject"
          ? "رُفض طلبك"
          : request.status === "received"
            ? "اكتمل استلام طلبك"
            : "وصل طلبك جزئياً";
    const statusDetail =
      event.action === "receipt_confirmed"
        ? request.status === "received"
          ? "اكتمل استلام الطلب."
          : "تم تسجيل استلام جزئي للطلب."
        : event.note || "راجع تفاصيل الطلب لمعرفة الملاحظات.";
    return [
      {
        id: `request:${event.id}`,
        kind: "request" as const,
        severity:
          event.action === "planning_reject" ? ("warning" as const) : ("follow_up" as const),
        title,
        detail: `${request.request_number} · ${statusDetail}`,
        href: `/requests?requestId=${encodeURIComponent(request.id)}&type=${encodeURIComponent(request.request_type)}`,
        date: event.created_at,
      },
    ];
  });
}

export function useOperationalAlerts() {
  const { user, roles, isAdmin, isHR, isCompanyManager, isDepartmentManager } = useAuth();
  const canViewExisting = isAdmin || isHR || isCompanyManager || isDepartmentManager;
  const canViewRequests =
    isAdmin ||
    isCompanyManager ||
    roles.some((role) =>
      ["engineer", "department_manager", "supervisor", "site_admin"].includes(role),
    );
  const canView = canViewExisting || canViewRequests;
  const departmentScoped = isDepartmentManager && !isAdmin && !isHR && !isCompanyManager;
  return useQuery({
    queryKey: ["operational-alerts", user?.id, departmentScoped],
    queryFn: async () => {
      const [operational, requestAlerts] = await Promise.all([
        canViewExisting
          ? fetchOperationalAlerts(dateKeyInTimeZone(new Date()), user!.id, departmentScoped)
          : Promise.resolve([]),
        canViewRequests ? fetchMaterialRequestAlerts(user!.id) : Promise.resolve([]),
      ]);
      return [...operational, ...requestAlerts].sort((left, right) =>
        right.date.localeCompare(left.date),
      );
    },
    enabled: canView && !!user,
    refetchInterval: 120_000,
  });
}

export type AlertSeverity = "critical" | "warning" | "follow_up";
export type OperationalAlert = {
  id: string;
  kind: "stock" | "document" | "task";
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
  date: string;
};

export type EmployeeAlertRow = {
  id: string;
  employee_no: string;
  full_name: string;
  department_id: string | null;
  contract_end_date: string | null;
  passport_expiry: string | null;
  residency_expiry: string | null;
  safety_passport_expiry: string | null;
};
export type ItemAlertRow = {
  id: string;
  name: string;
  code: string | null;
  min_qty: number;
  is_active: boolean;
};
export type WarehouseAlertRow = { id: string; name: string; is_active: boolean };
export type MovementAlertRow = { item_id: string; warehouse_id: string; qty_delta: number };
export type TaskAlertRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  employee_id: string | null;
  department_id: string | null;
};

const completedTaskStatuses = new Set([
  "completed",
  "done",
  "executed",
  "cancelled",
  "rejected",
  "archived",
]);
const dateDifference = (left: string, right: string) =>
  (Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;

export function buildOperationalAlerts(input: {
  today: string;
  employees: EmployeeAlertRow[];
  items: ItemAlertRow[];
  warehouses: WarehouseAlertRow[];
  movements: MovementAlertRow[];
  tasks: TaskAlertRow[];
}): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  const stock = new Map<string, number>();
  for (const movement of input.movements) {
    const key = `${movement.warehouse_id}|${movement.item_id}`;
    stock.set(key, (stock.get(key) ?? 0) + Number(movement.qty_delta || 0));
  }

  for (const item of input.items) {
    const minimum = Number(item.min_qty || 0);
    if (!item.is_active || minimum <= 0) continue;
    for (const warehouse of input.warehouses) {
      if (!warehouse.is_active) continue;
      const balance = stock.get(`${warehouse.id}|${item.id}`) ?? 0;
      if (balance >= minimum) continue;
      alerts.push({
        id: `stock:${warehouse.id}:${item.id}`,
        kind: "stock",
        severity: "critical",
        title: "مخزون حرج بحاجة لتوريد",
        detail: `${item.name}${item.code ? ` (${item.code})` : ""} · ${warehouse.name}: المتوفر ${balance}، حد إعادة الطلب ${minimum}`,
        href: "/warehouses?critical=true",
        date: input.today,
      });
    }
  }

  const documentFields = [
    ["contract_end_date", "انتهاء عقد"] as const,
    ["passport_expiry", "انتهاء جواز السفر"] as const,
    ["residency_expiry", "انتهاء الإقامة"] as const,
    ["safety_passport_expiry", "انتهاء جواز السلامة"] as const,
  ];
  for (const employee of input.employees) {
    for (const [field, label] of documentFields) {
      const expiresOn = employee[field];
      if (!expiresOn) continue;
      const days = dateDifference(expiresOn, input.today);
      if (!Number.isFinite(days) || days < 0 || days > 30) continue;
      alerts.push({
        id: `document:${employee.id}:${field}`,
        kind: "document",
        severity: "warning",
        title: "عقود/وثائق قاربت على الانتهاء",
        detail: `${employee.full_name} · ${label} بتاريخ ${expiresOn} · متبقٍ ${days} يومًا`,
        href: `/employees/${encodeURIComponent(employee.id)}`,
        date: expiresOn,
      });
    }
  }

  const employeeNames = new Map(
    input.employees.map((employee) => [employee.id, employee.full_name]),
  );
  for (const task of input.tasks) {
    if (!task.due_date || task.due_date >= input.today || completedTaskStatuses.has(task.status))
      continue;
    alerts.push({
      id: `task:${task.id}`,
      kind: "task",
      severity: "follow_up",
      title: "مهمة متأخرة وغير منجزة",
      detail: `${task.title}${task.employee_id ? ` · ${employeeNames.get(task.employee_id) ?? "موظف"}` : ""} · موعدها ${task.due_date}`,
      href: "/team-follow-up",
      date: task.due_date,
    });
  }

  const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, follow_up: 2 };
  return alerts.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.date.localeCompare(right.date),
  );
}

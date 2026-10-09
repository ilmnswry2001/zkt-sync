export type AppRole =
  | "admin"
  | "hr"
  | "supervisor"
  | "data_entry"
  | "site_admin"
  | "department_manager"
  | "engineer"
  | "ceo";

export type ModuleKey =
  | "dashboard"
  | "work-center"
  | "employees"
  | "attendance"
  | "shift-schedules"
  | "leave"
  | "overtime"
  | "departments"
  | "tasks"
  | "projects"
  | "sites"
  | "workforce"
  | "payroll"
  | "expenses"
  | "reports"
  | "accounts"
  | "settings";

export type EriModuleDefinition = {
  key: ModuleKey;
  path: string;
  label: string;
  roles: AppRole[];
  permission: string;
  departmentScoped?: boolean;
};

export const ERP_ROLE_DEFINITIONS: Record<AppRole, { label: string; description: string }> = {
  admin: { label: "مدير النظام", description: "إدارة كاملة للنظام، المستخدمين، الصلاحيات، والبيانات" },
  hr: { label: "موارد بشرية", description: "إدارة الموظفين، الحضور، الإجازات، الرواتب والملفات" },
  supervisor: { label: "مشرف", description: "إدارة الفريق، المهام، والتقارير المقررة" },
  data_entry: { label: "إدخال بيانات", description: "إدخال البيانات وتحديث السجلات اليومية" },
  site_admin: { label: "إداري موقع", description: "إدارة الموقع، الحضور، المهام، والتقارير الميدانية" },
  department_manager: { label: "مدير قسم", description: "متابعة الأقسام والموظفين وطلبات التوجيه" },
  engineer: { label: "مهندس", description: "إدارة خطط المشاريع والتخصيصات الفنية" },
  ceo: { label: "مدير الشركة", description: "عرض مستوى الشركة، تقارير الإدارة، ومتابعة الأداء" },
};

export const ERP_MODULES: EriModuleDefinition[] = [
  {
    key: "dashboard",
    path: "/dashboard",
    label: "لوحة التحكم",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager", "ceo"],
    permission: "dashboard.view",
  },
  {
    key: "work-center",
    path: "/work-center",
    label: "مركز العمل",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager", "engineer"],
    permission: "work_center.view",
  },
  {
    key: "employees",
    path: "/employees",
    label: "الموظفون",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager"],
    permission: "employees.view",
    departmentScoped: true,
  },
  {
    key: "attendance",
    path: "/attendance",
    label: "الحضور والانصراف",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager", "data_entry"],
    permission: "attendance.view",
    departmentScoped: true,
  },
  {
    key: "shift-schedules",
    path: "/shift-schedules",
    label: "جداول الورديات",
    roles: ["admin", "hr"],
    permission: "attendance.manage_schedules",
  },
  {
    key: "departments",
    path: "/departments",
    label: "الأقسام",
    roles: ["admin", "hr", "supervisor", "department_manager"],
    permission: "departments.view",
  },
  {
    key: "tasks",
    path: "/tasks",
    label: "المهام",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager", "engineer"],
    permission: "tasks.view",
    departmentScoped: true,
  },
  {
    key: "projects",
    path: "/projects",
    label: "المشاريع",
    roles: ["admin", "hr", "supervisor", "site_admin", "engineer", "ceo"],
    permission: "projects.view",
  },
  {
    key: "sites",
    path: "/sites",
    label: "المواقع والمحطات",
    roles: ["admin", "hr", "site_admin", "department_manager", "supervisor", "engineer"],
    permission: "sites.view",
  },
  {
    key: "workforce",
    path: "/workforce",
    label: "العمالة",
    roles: ["admin", "hr", "site_admin", "supervisor"],
    permission: "workforce.view",
  },
  {
    key: "payroll",
    path: "/payroll",
    label: "الرواتب",
    roles: ["admin", "hr", "ceo"],
    permission: "payroll.view",
  },
  {
    key: "leave",
    path: "/leaves",
    label: "إدارة الإجازات",
    roles: ["admin", "hr", "department_manager", "data_entry", "ceo"],
    permission: "leave.manage",
    departmentScoped: true,
  },
  {
    key: "expenses",
    path: "/expenses",
    label: "المصاريف",
    roles: ["admin", "hr", "site_admin", "supervisor", "ceo"],
    permission: "expenses.view",
  },
  {
    key: "reports",
    path: "/reports",
    label: "التقارير",
    roles: ["admin", "hr", "supervisor", "site_admin", "department_manager", "ceo"],
    permission: "reports.view",
  },
  {
    key: "accounts",
    path: "/accounts",
    label: "إدارة المستخدمين",
    roles: ["admin"],
    permission: "users.manage",
  },
  {
    key: "settings",
    path: "/settings",
    label: "الإعدادات",
    roles: ["admin", "hr"],
    permission: "settings.manage",
  },
];

export const ERP_PERMISSION_MATRIX = ERP_MODULES.reduce<Record<string, AppRole[]>>((acc, item) => {
  acc[item.permission] = item.roles;
  return acc;
}, {});

export function rolesAllowModule(roles: string[], module: EriModuleDefinition) {
  return roles.some((role) => module.roles.includes(role as AppRole));
}

export function canAccessModulePath(
  path: string,
  roles: string[],
  allowedSections: string[] | null | undefined,
) {
  const module = ERP_MODULES.find((item) => path === item.path || path.startsWith(`${item.path}/`));
  if (!module) return true;

  if (roles.includes("admin")) return true;
  if (allowedSections && allowedSections.length > 0) {
    const sectionMatch = allowedSections.includes(module.path) || allowedSections.includes("/planning") && module.path === "/project-plans";
    if (!sectionMatch) return false;
  }

  return rolesAllowModule(roles, module);
}

export function filterAccessibleModules(roles: string[], allowedSections?: string[] | null) {
  return ERP_MODULES.filter((module) => canAccessModulePath(module.path, roles, allowedSections));
}


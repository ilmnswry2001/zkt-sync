import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Role = Database["public"]["Enums"]["app_role"];

export const accountRoles = {
  admin: ["مدير النظام", "إدارة النظام والحسابات والصلاحيات"],
  hr: ["الموارد البشرية", "الموظفون والحضور والأجور"],
  supervisor: ["مشرف", "متابعة التقارير والمهام بحسب النطاق"],
  data_entry: ["مدخل بيانات", "إدخال التقارير والمهام المسموحة"],
  department_manager: ["مدير قسم", "إدارة ومتابعة فريق قسم محدد"],
  site_admin: ["إداري موقع", "إدارة الموقع ومهامه"],
  engineer: ["مهندس", "الخطط وطلبات المواد والمعدات"],
  planning_officer: ["مسؤول تخطيط", "مراجعة الخطط وطلبات المواد والمعدات"],
  warehouse_keeper: ["مسؤول مخازن", "الصرف واستلام المشتريات"],
  procurement_officer: ["مسؤول مشتريات", "تسجيل دفعات الشراء وإرسالها للاستلام"],
  maintenance_manager: ["مدير الصيانة", "إدارة أعمال الصيانة والكتالوج والتقارير"],
  maintenance_admin: ["منسق الصيانة", "تسجيل ومتابعة سجلات الصيانة"],
  accountant: ["قسم الحسابات", "الرواتب والسلف ومتابعة الصرف"],
} satisfies Record<Role, [label: string, description: string]>;

export const roleKeys = Object.keys(accountRoles) as [Role, ...Role[]];
export const initialRolePages: Partial<Record<Role, string>> = {
  engineer: "/planning",
  planning_officer: "/planning",
  warehouse_keeper: "/warehouses",
  procurement_officer: "/procurement",
  maintenance_manager: "/maintenance",
  maintenance_admin: "/maintenance",
  accountant: "/payroll",
};

export const passwordSchema = z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(72);
const rolesSchema = z.array(z.enum(roleKeys)).max(roleKeys.length);
const sectionsSchema = z
  .array(
    z
      .string()
      .regex(/^\/[a-z0-9_-]+(\/[a-z0-9_-]+)*$/)
      .max(60),
  )
  .max(100);
export const accountPlanSchema = z.object({
  canRequest: z.boolean(),
  canApprove: z.boolean(),
  canStaffAll: z.boolean(),
  specialties: z.array(z.string().trim().min(1).max(120)).max(100),
});
export const accountAccessSchema = z.object({
  fullName: z.string().trim().min(2, "أدخل الاسم الكامل").max(160),
  roles: rolesSchema,
  departmentIds: z.array(z.string().uuid()).max(100),
  allowedSections: sectionsSchema,
  plan: accountPlanSchema,
});
export const readAccountAccessSchema = z.object({
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  roles: rolesSchema,
  departments: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  allowedSections: z.array(z.string()),
  plan: accountPlanSchema.extend({ specialties: z.array(z.string()) }),
});
export const accountDirectorySchema = z.object({
  total: z.number(),
  filteredCount: z.number(),
  admins: z.number(),
  unassigned: z.number(),
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      full_name: z.string().nullable(),
      email: z.string().nullable(),
      created_at: z.string(),
      roles: rolesSchema,
    }),
  ),
});

export type AccountAccess = z.infer<typeof accountAccessSchema>;
export type AccountDetails = z.infer<typeof readAccountAccessSchema>;
export type DirectoryAccount = z.infer<typeof accountDirectorySchema>["accounts"][number];
export type AccountDepartment = AccountDetails["departments"][number];

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

type Role =
  | "admin"
  | "hr"
  | "supervisor"
  | "data_entry"
  | "site_admin"
  | "department_manager"
  | "engineer"
  | "planning_officer"
  | "warehouse_keeper"
  | "procurement_officer"
  | "maintenance_manager"
  | "maintenance_admin";

const roleSchema = z.enum([
  "admin",
  "hr",
  "supervisor",
  "data_entry",
  "site_admin",
  "department_manager",
  "engineer",
  "planning_officer",
  "warehouse_keeper",
  "procurement_officer",
  "maintenance_manager",
  "maintenance_admin",
] satisfies [Role, ...Role[]]);
const passwordSchema = z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(72);

const createAccountSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم مطلوب").max(160),
  email: z.string().trim().email("البريد الإلكتروني غير صالح").max(320),
  password: passwordSchema,
  role: roleSchema,
  departmentIds: z.array(z.string().uuid()).optional(),
  allowedSections: z.array(z.string().max(60)).max(40).optional(),
});

const updatePasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});

const updateDepartmentsSchema = z.object({
  userId: z.string().uuid(),
  departmentIds: z.array(z.string().uuid()),
  allowedSections: z.array(z.string().max(60)).max(40).default([]),
});
const deleteAccountSchema = z.object({ userId: z.string().uuid() });

function translateAuthError(error: { message?: string; status?: number } | null | undefined) {
  const message = (error?.message ?? "").toLowerCase();
  if (
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("user already exists") ||
    message.includes("already exists") ||
    message.includes("duplicate key") ||
    message.includes("email_exists")
  ) {
    return "هذا البريد الإلكتروني مسجل مسبقاً في النظام. يمكنك تعديل صلاحياته أو إعادة تعيين كلمة المرور له من القائمة.";
  }
  if (
    message.includes("password") &&
    (message.includes("weak") || message.includes("short") || message.includes("at least"))
  ) {
    return "كلمة المرور ضعيفة. استخدم 8 أحرف على الأقل، ويفضل الجمع بين الأحرف والأرقام والرموز.";
  }
  if (message.includes("invalid email") || message.includes("email address is invalid")) {
    return "صيغة البريد الإلكتروني غير صحيحة. أدخل بريداً مثل name@example.com.";
  }
  if (message.includes("email") && message.includes("required")) {
    return "البريد الإلكتروني مطلوب.";
  }
  if (message.includes("user not found") || message.includes("not found")) {
    return "الحساب المطلوب غير موجود أو تم حذفه.";
  }
  if (error?.status === 401) return "انتهت جلسة الدخول. أعد تسجيل الدخول ثم حاول مرة أخرى.";
  if (error?.status === 403) return "ليس لديك صلاحية لتنفيذ هذه العملية.";
  return error?.message || "تعذر تنفيذ العملية. حاول مرة أخرى.";
}

async function assertAdmin(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("هذه العملية متاحة لمدير النظام فقط");
}

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => createAccountSchema.parse(value))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (existingProfile) {
      throw new Error(
        "هذا البريد الإلكتروني مسجل مسبقاً في النظام. يمكنك تعديل صلاحياته أو إعادة تعيين كلمة المرور له من القائمة.",
      );
    }
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createError || !created.user) {
      throw new Error(translateAuthError(createError));
    }

    // A trigger gives every new user a default role; replace it with the chosen one.
    await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role as never });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(`تم التراجع عن إنشاء الحساب: ${translateAuthError(roleError)}`);
    }
    const roleSection: Partial<Record<Role, string>> = {
      engineer: "/planning",
      planning_officer: "/planning",
      warehouse_keeper: "/warehouses",
      procurement_officer: "/procurement",
      maintenance_manager: "/maintenance",
      maintenance_admin: "/maintenance",
    };
    const sections = roleSection[data.role]
      ? [roleSection[data.role]!]
      : (data.allowedSections ?? []);
    await supabaseAdmin
      .from("profiles")
      .update({ allowed_sections: sections.length ? sections : null, full_name: data.fullName })
      .eq("id", created.user.id);
    if (data.departmentIds?.length) {
      // The generated Lovable types are refreshed only after the SQL migration is applied.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessClient = supabaseAdmin as SupabaseClient<any>;
      const { error } = await accessClient
        .from("user_departments")
        .insert(
          data.departmentIds.map((department_id) => ({ user_id: created.user.id, department_id })),
        );
      if (error) {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        throw new Error(`تم التراجع عن إنشاء الحساب: ${error.message}`);
      }
    }
    return { userId: created.user.id };
  });

export const updateUserDepartments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => updateDepartmentsSchema.parse(value))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The generated Lovable types are refreshed only after the SQL migration is applied.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accessClient = supabaseAdmin as SupabaseClient<any>;
    const { error: deleteError } = await accessClient
      .from("user_departments")
      .delete()
      .eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);
    if (data.departmentIds.length) {
      const { error } = await accessClient
        .from("user_departments")
        .insert(
          data.departmentIds.map((department_id) => ({ user_id: data.userId, department_id })),
        );
      if (error) throw new Error(error.message);
    }
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ allowed_sections: data.allowedSections.length ? data.allowedSections : null })
      .eq("id", data.userId);
    if (profileError) throw new Error(profileError.message);
    return { userId: data.userId, departmentIds: data.departmentIds, allowedSections: data.allowedSections };
  });

export const updateAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => updatePasswordSchema.parse(value))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(translateAuthError(error));
    return { userId: data.userId };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => deleteAccountSchema.parse(value))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.userId === context.userId) {
      throw new Error("لا يمكن حذف الحساب الذي تستخدمه حالياً.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (rolesError) throw new Error(rolesError.message);

    if (targetRoles?.some((assignment) => assignment.role === "admin")) {
      const { count, error: countError } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) <= 1) {
        throw new Error("لا يمكن حذف المدير الوحيد في النظام. عيّن مديراً آخر أولاً.");
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("foreign key") ||
        message.includes("constraint") ||
        message.includes("database error deleting user")
      ) {
        throw new Error("تعذر حذف الحساب لارتباطه بسجلات تاريخية محمية. احتفظ بالحساب وأزل صلاحياته عند الحاجة.");
      }
      throw new Error(translateAuthError(error));
    }
    return { userId: data.userId };
  });

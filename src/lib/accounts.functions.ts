import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

type Role = "admin" | "hr" | "supervisor" | "data_entry" | "site_admin" | "department_manager";

const roleSchema = z.enum([
  "admin",
  "hr",
  "supervisor",
  "data_entry",
  "site_admin",
  "department_manager",
] satisfies [Role, ...Role[]]);
const passwordSchema = z.string().min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").max(72);

const createAccountSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم مطلوب").max(160),
  email: z.string().trim().email("البريد الإلكتروني غير صالح").max(320),
  password: passwordSchema,
  role: roleSchema,
  departmentIds: z.array(z.string().uuid()).optional().default([]),
});

const updatePasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});

const updateDepartmentsSchema = z.object({
  userId: z.string().uuid(),
  departmentIds: z.array(z.string().uuid()).max(200),
});

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

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role } as never);
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(`تم التراجع عن إنشاء الحساب: ${translateAuthError(roleError)}`);
    }
    if (data.departmentIds.length > 0) {
      const { error: departmentError } = await (supabaseAdmin as any).from("user_departments").insert(
        data.departmentIds.map((departmentId) => ({ user_id: created.user.id, department_id: departmentId })),
      );
      if (departmentError) {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        throw new Error(`تم التراجع عن إنشاء الحساب: ${departmentError.message}`);
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
    const { error: deleteError } = await (supabaseAdmin as any)
      .from("user_departments")
      .delete()
      .eq("user_id", data.userId);
    if (deleteError) throw new Error(deleteError.message);
    if (data.departmentIds.length > 0) {
      const { error } = await (supabaseAdmin as any).from("user_departments").insert(
        data.departmentIds.map((departmentId) => ({ user_id: data.userId, department_id: departmentId })),
      );
      if (error) throw new Error(error.message);
    }
    return { userId: data.userId, departmentIds: data.departmentIds };
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

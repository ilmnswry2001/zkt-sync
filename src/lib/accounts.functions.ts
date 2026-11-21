import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

import {
  accountAccessSchema,
  accountDirectorySchema,
  passwordSchema,
  readAccountAccessSchema,
  roleKeys,
  type AccountAccess,
  type AccountDetails,
} from "@/lib/account-access";

type AccountContext = { supabase: SupabaseClient<Database>; userId: string };

const createAccountSchema = accountAccessSchema
  .extend({
    email: z.string().trim().email("البريد الإلكتروني غير صالح").max(320),
    password: passwordSchema,
  })
  .refine((data) => data.roles.length > 0, "اختر دوراً واحداً على الأقل");

const updatePasswordSchema = z.object({
  userId: z.string().uuid(),
  password: passwordSchema,
});
const accountIdSchema = z.object({ userId: z.string().uuid() });

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

async function assertAdmin(context: AccountContext) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("هذه العملية متاحة لمدير النظام فقط");
}

async function saveAccess(
  context: AccountContext,
  userId: string,
  access: AccountAccess,
  expected?: AccountDetails,
) {
  const { error } = await context.supabase.rpc(
    "save_account_access" as never,
    {
      p_user_id: userId,
      p_full_name: access.fullName,
      p_roles: [...new Set(access.roles)],
      p_departments: [...new Set(access.departmentIds)],
      p_sections: [...new Set(access.allowedSections)],
      p_can_request: access.plan.canRequest,
      p_can_approve: access.plan.canApprove,
      p_can_staff_all: access.plan.canStaffAll,
      p_specialties: [...new Set(access.plan.specialties)],
      p_expected: expected ?? null,
    } as never,
  );
  if (error) throw new Error(error.message);
}

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      search: z.string().trim().max(160),
      role: z.union([z.enum(roleKeys), z.literal("unassigned"), z.literal("")]),
      page: z.number().int().min(0),
    }),
  )
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc(
      "read_account_directory" as never,
      {
        p_search: data.search,
        p_role: data.role,
        p_page: data.page,
      } as never,
    );
    if (error) throw new Error(error.message);
    return accountDirectorySchema.parse(result);
  });

export const readAccountAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(accountIdSchema)
  .handler(async ({ context, data }) => {
    const { data: result, error } = await context.supabase.rpc(
      "read_account_access" as never,
      {
        p_user_id: data.userId,
      } as never,
    );
    if (error) throw new Error(error.message);
    return readAccountAccessSchema.parse(result);
  });

export const updateAccountAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    accountIdSchema.extend({
      access: accountAccessSchema,
      expected: readAccountAccessSchema,
    }),
  )
  .handler(async ({ context, data }) => {
    await saveAccess(context, data.userId, data.access, data.expected);
  });

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(createAccountSchema)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.roles.includes("department_manager") && new Set(data.departmentIds).size !== 1) {
      throw new Error("حدد قسماً واحداً لحساب مدير القسم");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(translateAuthError(error));

    try {
      await saveAccess(context, created.user.id, data);
    } catch (accessError) {
      const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (cleanupError) {
        throw new Error("أُنشئ الحساب وتعذر حفظ صلاحياته أو إزالته. ابحث عنه بالبريد وأكمل ضبطه.");
      }
      throw accessError;
    }
    return { userId: created.user.id };
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
  .inputValidator((value: unknown) => accountIdSchema.parse(value))
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
        throw new Error(
          "تعذر حذف الحساب لارتباطه بسجلات تاريخية محمية. احتفظ بالحساب وأزل صلاحياته عند الحاجة.",
        );
      }
      throw new Error(translateAuthError(error));
    }
    return { userId: data.userId };
  });

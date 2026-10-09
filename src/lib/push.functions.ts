import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAttendancePushKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null }));

export const saveAttendancePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const email = typeof context.claims.email === "string" ? context.claims.email : null;
    if (!email) throw new Error("حسابك لا يحتوي على بريد إلكتروني");
    const { data: employee, error: employeeError } = await context.supabase.from("employees")
      .select("id").eq("email", email).eq("status", "active").maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("لا يوجد سجل موظف نشط مرتبط بحسابك");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("attendance_push_subscriptions").upsert({
      user_id: context.userId, employee_id: employee.id, endpoint: data.endpoint,
      subscription: data, updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw new Error(error.message);
    return { success: true };
  });

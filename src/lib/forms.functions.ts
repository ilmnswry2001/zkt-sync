import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { listLeaveDates } from "@/lib/leave-utils";

const dayStatus = z.enum(["present", "absent", "leave", "holiday", "rest"]);

const createSchema = z.object({
  employee_id: z.string().uuid(),
  target_department_id: z.string().uuid().nullable().optional(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leave_end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  kind: z.enum(["attendance", "overtime", "leave"]),
  day_status: dayStatus.nullable().optional(),
  overtime_hours: z.number().min(0).max(24).default(0),
  check_in: z.string().nullable().optional(),
  check_out: z.string().nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
});

const actSchema = z.object({
  form_id: z.string().uuid(),
  action: z.enum(["approve", "reject", "execute"]),
  note: z.string().trim().max(500).nullable().optional(),
});

async function actorPowers(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<{ admin: boolean; hr: boolean; manager: boolean; ceo: boolean; executor: boolean }> {
  const [{ data: appRoles }, { data: formRoles }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("form_role_assignments").select("role").eq("user_id", userId),
  ]);
  const a = (appRoles ?? []).map((r: { role: string }) => r.role);
  const f = (formRoles ?? []).map((r: { role: string }) => r.role);
  const admin = a.includes("admin");
  return {
    admin,
    hr: admin || a.includes("hr"),
    manager: admin || f.includes("dept_manager"),
    ceo: admin || f.includes("ceo"),
    executor: admin || a.includes("data_entry") || f.includes("executor"),
  };
}

export const createForm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: emp, error: empError } = await supabase
      .from("employees")
      .select("id, department_id")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("الموظف غير موجود");
    const leaveEndDate =
      data.kind === "leave" ? (data.leave_end_date ?? data.work_date) : data.work_date;
    const leaveDates = data.kind === "leave" ? listLeaveDates(data.work_date, leaveEndDate) : [];
    if (data.kind === "leave" && !leaveDates.length) throw new Error("نطاق الإجازة غير صحيح");
    if (data.kind === "leave") {
      const { data: setting } = await supabase
        .from("leave_settings")
        .select("annual_allowance_days")
        .eq("id", 1)
        .maybeSingle();
      const allowance = Number(setting?.annual_allowance_days ?? 21);
      const yearStart = `${data.work_date.slice(0, 4)}-01-01`;
      const yearEnd = `${data.work_date.slice(0, 4)}-12-31`;
      const { data: prior } = await supabase
        .from("forms")
        .select("work_date, leave_end_date, leave_days, status")
        .eq("employee_id", data.employee_id)
        .eq("kind", "leave")
        .neq("status", "rejected")
        .gte("work_date", yearStart)
        .lte("work_date", yearEnd);
      const used = (prior ?? []).reduce(
        (sum, row) =>
          sum +
          Number(
            row.leave_days ||
              listLeaveDates(row.work_date, row.leave_end_date ?? row.work_date).length,
          ),
        0,
      );
      if (used + leaveDates.length > allowance)
        throw new Error(`رصيد الإجازة غير كافٍ. المتبقي ${Math.max(0, allowance - used)} يوماً`);
      if (
        (prior ?? []).some((row) =>
          listLeaveDates(row.work_date, row.leave_end_date ?? row.work_date).some((date) =>
            leaveDates.includes(date),
          ),
        )
      )
        throw new Error("يوجد تداخل مع إجازة سابقة لهذا الموظف");
    }

    const { data: form, error } = await supabase
      .from("forms")
      .insert({
        employee_id: data.employee_id,
        department_id: emp.department_id,
        target_department_id: data.target_department_id ?? null,
        work_date: data.work_date,
        leave_end_date: data.kind === "leave" ? leaveEndDate : null,
        leave_days: data.kind === "leave" ? leaveDates.length : 0,
        kind: data.kind,
        day_status:
          data.day_status ??
          (data.kind === "leave" ? "leave" : data.kind === "attendance" ? "present" : null),
        overtime_hours: data.kind === "overtime" ? data.overtime_hours : 0,
        check_in: data.check_in || null,
        check_out: data.check_out || null,
        reason: data.reason,
        status: data.kind === "leave" ? "pending_manager" : "pending_execution",
        created_by: userId,
      })
      .select("id, form_no")
      .single();
    if (error) throw new Error(error.message);

    await supabase
      .from("form_events")
      .insert({ form_id: form.id, action: "created", note: data.reason, actor: userId });
    return form;
  });

export const actOnForm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => actSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: form, error } = await supabase
      .from("forms")
      .select("*")
      .eq("id", data.form_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!form) throw new Error("الاستمارة غير موجودة");

    const powers = await actorPowers(supabase, userId);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (data.action === "reject") {
      if (form.status === "executed") throw new Error("لا يمكن رفض استمارة منفذة");
      const allowed =
        (form.status === "pending_manager" && powers.manager) ||
        (form.status === "pending_ceo" && powers.ceo) ||
        (form.status === "pending_execution" && powers.executor) ||
        powers.admin;
      if (!allowed) throw new Error("لا تملك صلاحية رفض هذه الاستمارة");
      Object.assign(patch, {
        status: "rejected",
        rejected_by: userId,
        rejected_at: now,
        rejection_reason: data.note ?? null,
      });
    } else if (data.action === "approve") {
      if (form.status === "pending_manager") {
        if (!powers.manager) throw new Error("الموافقة الأولى من صلاحية مدير القسم");
        Object.assign(patch, {
          status: "pending_ceo",
          manager_approved_by: userId,
          manager_approved_at: now,
        });
      } else if (form.status === "pending_ceo") {
        if (!powers.ceo) throw new Error("هذه الموافقة من صلاحية مدير الشركة");
        Object.assign(patch, {
          status: "pending_execution",
          ceo_approved_by: userId,
          ceo_approved_at: now,
        });
      } else {
        throw new Error("الاستمارة ليست في مرحلة موافقة");
      }
    } else {
      if (form.status !== "pending_execution") throw new Error("الاستمارة ليست جاهزة للتنفيذ");
      if (!powers.executor) throw new Error("التنفيذ من صلاحية قسم تنفيذ الاستمارات");

      const { data: existing } = await supabase
        .from("attendance_day_status")
        .select("status, overtime_hours")
        .eq("employee_id", form.employee_id)
        .eq("work_date", form.work_date)
        .maybeSingle();

      const status =
        form.kind === "overtime"
          ? (form.day_status ?? existing?.status ?? "present")
          : (form.day_status ?? (form.kind === "leave" ? "leave" : "present"));
      const overtime =
        form.kind === "overtime"
          ? Number(form.overtime_hours ?? 0)
          : Number(existing?.overtime_hours ?? 0);

      const dates =
        form.kind === "leave"
          ? listLeaveDates(form.work_date, form.leave_end_date ?? form.work_date)
          : [form.work_date];
      const { error: upsertError } = await supabase.from("attendance_day_status").upsert(
        dates.map((work_date) => ({
          employee_id: form.employee_id,
          work_date,
          status,
          overtime_hours: overtime,
          notes: `استمارة #${form.form_no}: ${form.reason}`.slice(0, 300),
          updated_by: userId,
        })),
        { onConflict: "employee_id,work_date" },
      );
      if (upsertError) throw new Error(upsertError.message);
      Object.assign(patch, { status: "executed", executed_by: userId, executed_at: now });
    }

    const { error: updateError } = await supabase
      .from("forms")
      .update(patch as never)
      .eq("id", form.id);
    if (updateError) throw new Error(updateError.message);
    await supabase
      .from("form_events")
      .insert({ form_id: form.id, action: data.action, note: data.note ?? null, actor: userId });
    return { status: patch["status"] as string };
  });

export const getMyFormPowers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => actorPowers(context.supabase, context.userId));

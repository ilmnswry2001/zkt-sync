import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
  leave_type_id: z.string().uuid().nullable().optional(),
  kind: z.enum(["attendance", "overtime", "leave", "early_exit"]),
  day_status: dayStatus.nullable().optional(),
  overtime_hours: z.number().min(0).max(24).default(0),
  check_in: z.string().nullable().optional(),
  check_out: z.string().nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
});

const actSchema = z.object({
  form_id: z.string().uuid(),
  action: z.enum(["approve", "reject", "execute", "withdraw"]),
  note: z.string().trim().max(500).nullable().optional(),
});

async function actorPowers(
  supabase: { from: (t: string) => any },
  userId: string,
): Promise<{
  admin: boolean;
  hr: boolean;
  dataEntry: boolean;
  manager: boolean;
  globalManager: boolean;
  managerDepartmentIds: string[];
  ceo: boolean;
  executor: boolean;
}> {
  const [{ data: appRoles }, { data: formRoles }, { data: managedDepartments }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("form_role_assignments").select("role").eq("user_id", userId),
    supabase.from("department_managers").select("department_id").eq("user_id", userId),
  ]);
  const a = (appRoles ?? []).map((r: { role: string }) => r.role);
  const f = (formRoles ?? []).map((r: { role: string }) => r.role);
  const admin = a.includes("admin");
  const hr = admin || a.includes("hr");
  const dataEntry = a.includes("data_entry");
  const globalManager = admin || hr || f.includes("dept_manager");
  const managerDepartmentIds = (managedDepartments ?? []).map((row: { department_id: string }) => row.department_id);
  return {
    admin,
    hr,
    dataEntry,
    manager: globalManager || (a.includes("department_manager") && managerDepartmentIds.length > 0),
    globalManager,
    managerDepartmentIds,
    ceo: admin || f.includes("ceo"),
    executor: admin || hr || a.includes("data_entry") || f.includes("executor"),
  };
}

export const createForm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const powers = data.kind === "leave" ? await actorPowers(supabase, userId) : null;
    const { data: emp, error: empError } = await supabase
      .from("employees")
      .select("id, department_id, email")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (empError) throw new Error(empError.message);
    if (!emp) throw new Error("الموظف غير موجود");
    const needsProfile = data.kind === "early_exit" || data.kind === "overtime" ||
      (data.kind === "leave" && !powers?.hr && !powers?.dataEntry);
    const { data: profile, error: profileError } = needsProfile
      ? await supabase.from("profiles").select("email").eq("id", userId).maybeSingle()
      : { data: null, error: null };
    if (profileError) throw new Error(profileError.message);
    if (
      data.kind === "leave" &&
      !powers?.hr &&
      !powers?.dataEntry &&
      (!profile?.email ||
        !emp.email ||
        emp.email.trim().toLowerCase() !== profile.email.trim().toLowerCase())
    ) {
      throw new Error("يمكنك تقديم طلب إجازة لنفسك فقط");
    }
    const isOwnRequest = !!profile?.email && !!emp.email &&
      emp.email.trim().toLowerCase() === profile.email.trim().toLowerCase();
    const baghdadParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date());
    const part = (type: string) => baghdadParts.find((item) => item.type === type)?.value ?? "00";
    const nowDate = `${part("year")}-${part("month")}-${part("day")}`;
    const nowMinutes = Number(part("hour")) * 60 + Number(part("minute"));
    let selfOvertimeHours = data.overtime_hours;
    if (data.kind === "early_exit") {
      if (!isOwnRequest || data.work_date !== nowDate) {
        throw new Error("يمكنك تقديم طلب خروج مبكر لنفسك ولليوم الحالي فقط");
      }
      const { data: settings, error: settingsError } = await (supabase as any)
        .from("self_attendance_settings")
        .select("latest_check_out_time")
        .eq("id", true)
        .maybeSingle();
      if (settingsError) throw new Error(settingsError.message);
      const endTime = settings?.latest_check_out_time as string | null;
      if (!endTime) throw new Error("لم تحدد الإدارة وقت نهاية الدوام بعد");
      const [endHour, endMinute] = endTime.split(":").map(Number);
      if (nowMinutes >= endHour * 60 + endMinute) {
        throw new Error("انتهى وقت الدوام؛ لم يعد طلب الخروج المبكر متاحاً");
      }
      const dayStart = `${nowDate}T00:00:00+03:00`;
      const dayEnd = `${nowDate}T23:59:59+03:00`;
      const { data: checkIn, error: attendanceError } = await supabase
        .from("attendance_logs")
        .select("id")
        .eq("employee_id", data.employee_id)
        .gte("verify_time", dayStart)
        .lt("verify_time", dayEnd)
        .or("self_event_type.eq.check_in,verify_type.eq.0")
        .limit(1);
      if (attendanceError) throw new Error(attendanceError.message);
      if (!checkIn?.length) throw new Error("سجّل حضورك أولاً قبل طلب الخروج المبكر");
    }
    if (data.kind === "overtime" && isOwnRequest) {
      if (data.work_date !== nowDate) throw new Error("طلب الوقت الإضافي الذاتي متاح لليوم الحالي فقط");
      const { data: settings, error: settingsError } = await (supabase as any)
        .from("self_attendance_settings")
        .select("latest_check_out_time")
        .eq("id", true)
        .maybeSingle();
      if (settingsError) throw new Error(settingsError.message);
      const endTime = settings?.latest_check_out_time as string | null;
      if (!endTime) throw new Error("لم تحدد الإدارة وقت نهاية الدوام؛ لا يمكن تسجيل وقت إضافي");
      const [endHour, endMinute] = endTime.split(":").map(Number);
      const elapsedMinutes = nowMinutes - (endHour * 60 + endMinute);
      if (elapsedMinutes < 30) throw new Error("لا يمكن تسجيل الوقت الإضافي إلا بعد انتهاء الدوام بنصف ساعة على الأقل");
      const dayStart = `${nowDate}T00:00:00+03:00`;
      const dayEnd = `${nowDate}T23:59:59+03:00`;
      const { data: checkIn, error: attendanceError } = await supabase
        .from("attendance_logs")
        .select("id")
        .eq("employee_id", data.employee_id)
        .gte("verify_time", dayStart)
        .lt("verify_time", dayEnd)
        .or("self_event_type.eq.check_in,verify_type.eq.0")
        .limit(1);
      if (attendanceError) throw new Error(attendanceError.message);
      if (!checkIn?.length) throw new Error("سجّل حضورك أولاً قبل طلب الوقت الإضافي");
      selfOvertimeHours = Math.floor(elapsedMinutes / 30) / 2;
    } else if (data.kind === "overtime" && !isOwnRequest) {
      const requesterPowers = await actorPowers(supabase, userId);
      if (!requesterPowers.admin && !requesterPowers.hr && !requesterPowers.dataEntry && !requesterPowers.manager) {
        throw new Error("يمكنك تقديم طلب وقت إضافي لنفسك فقط");
      }
    }
    if (isOwnRequest && (data.kind === "early_exit" || data.kind === "overtime")) {
      const { data: existingRequest, error: existingRequestError } = await (supabase as any)
        .from("forms")
        .select("id")
        .eq("employee_id", data.employee_id)
        .eq("work_date", data.work_date)
        .eq("kind", data.kind)
        .neq("status", "rejected")
        .limit(1);
      if (existingRequestError) throw new Error(existingRequestError.message);
      if (existingRequest?.length) {
        throw new Error(data.kind === "early_exit"
          ? "لديك طلب خروج مبكر غير مرفوض لهذا اليوم"
          : "لديك طلب وقت إضافي غير مرفوض لهذا اليوم");
      }
    }
    const leaveEndDate =
      data.kind === "leave" ? (data.leave_end_date ?? data.work_date) : data.work_date;
    let leaveTypeId: string | null = null;
    let leaveDays = 0;
    if (data.kind === "leave") {
      if (leaveEndDate < data.work_date) throw new Error("تاريخ نهاية الإجازة يسبق تاريخ بدايتها");
      const typeQuery = await (supabase as any)
        .from("leave_types")
        .select("id, is_active, count_non_working_days")
        .eq(data.leave_type_id ? "id" : "code", data.leave_type_id ?? "annual")
        .maybeSingle();
      if (typeQuery.error) throw new Error(typeQuery.error.message);
      if (!typeQuery.data || !typeQuery.data.is_active) throw new Error("نوع الإجازة غير متاح للطلبات الجديدة");
      leaveTypeId = typeQuery.data.id;
      const { data: dates, error: datesError } = await (supabase as any).rpc("leave_work_dates", {
        _employee_id: data.employee_id,
        _start_date: data.work_date,
        _end_date: leaveEndDate,
        _count_non_working_days: typeQuery.data.count_non_working_days,
      });
      if (datesError) throw new Error(datesError.message);
      leaveDays = dates?.length ?? 0;
      if (!leaveDays) throw new Error("لا توجد أيام دوام ضمن الفترة المحددة");
    }

    const { data: form, error } = await (supabase as any)
      .from("forms")
      .insert({
        employee_id: data.employee_id,
        department_id: emp.department_id,
        target_department_id: data.target_department_id ?? null,
        work_date: data.work_date,
        leave_end_date: data.kind === "leave" ? leaveEndDate : null,
        leave_days: leaveDays,
        leave_type_id: leaveTypeId,
        kind: data.kind,
        day_status:
          data.day_status ??
          (data.kind === "leave" ? "leave" : data.kind === "attendance" ? "present" : null),
        overtime_hours: data.kind === "overtime" ? selfOvertimeHours : 0,
        check_in: data.check_in || null,
        check_out: data.kind === "early_exit"
          ? `${part("hour")}:${part("minute")}`
          : data.check_out || null,
        reason: data.reason,
        status: data.kind === "leave" || data.kind === "early_exit" ? "pending_manager" : "pending_execution",
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
    const canManageDepartment =
      powers.admin || powers.hr || powers.globalManager ||
      (powers.managerDepartmentIds.includes(form.department_id ?? "") && powers.manager);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (data.action === "withdraw") {
      const pendingLeave =
        form.kind === "leave" &&
        ["pending_manager", "pending_ceo", "pending_execution"].includes(form.status);
      const [{ data: employee }, { data: profile }] = await Promise.all([
        supabase.from("employees").select("email").eq("id", form.employee_id).maybeSingle(),
        supabase.from("profiles").select("email").eq("id", userId).maybeSingle(),
      ]);
      if (
        !pendingLeave ||
        form.created_by !== userId ||
        !employee?.email ||
        !profile?.email ||
        employee.email.trim().toLowerCase() !== profile.email.trim().toLowerCase()
      ) {
        throw new Error("لا يمكنك سحب هذا الطلب بعد انتقاله إلى مرحلة غير قابلة للسحب");
      }
      Object.assign(patch, {
        status: "rejected",
        rejected_by: userId,
        rejected_at: now,
        rejection_reason: "تم سحب الطلب من مقدم الطلب",
      });
    } else if (data.action === "reject") {
      if (form.status === "executed") throw new Error("لا يمكن رفض استمارة منفذة");
      if (form.kind === "leave" && (data.note ?? "").trim().length < 3)
        throw new Error("اكتب سبب الرفض حتى يظهر في سجل طلب الإجازة");
      const allowed =
        (form.status === "pending_manager" && canManageDepartment) ||
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
        if (!canManageDepartment) throw new Error("الموافقة الأولى من صلاحية مدير القسم");
        Object.assign(patch, {
          status: "pending_ceo",
          manager_approved_by: userId,
          manager_approved_at: now,
        });
      } else if (form.status === "pending_ceo") {
        if (!powers.ceo) throw new Error("هذه الموافقة من صلاحية مدير الشركة");
        if ((form.kind as string) === "early_exit") {
          const { error: approvalError } = await (supabase as any).rpc("approve_self_attendance_early_exit", {
            p_form_id: form.id,
          });
          if (approvalError) throw new Error(approvalError.message);
          return { status: "executed" };
        }
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
      let dates = [form.work_date];
      let isPaidLeave = true;
      if (form.kind === "leave") {
        const { data: leaveType, error: leaveTypeError } = await (supabase as any)
          .from("leave_types")
          .select("is_paid, count_non_working_days")
          .eq("id", form.leave_type_id)
          .maybeSingle();
        if (leaveTypeError) throw new Error(leaveTypeError.message);
        isPaidLeave = leaveType?.is_paid ?? true;
        const { data: workDates, error: datesError } = await (supabase as any).rpc("leave_work_dates", {
          _employee_id: form.employee_id,
          _start_date: form.work_date,
          _end_date: form.leave_end_date ?? form.work_date,
          _count_non_working_days: leaveType?.count_non_working_days ?? true,
        });
        if (datesError) throw new Error(datesError.message);
        dates = (workDates ?? []).map((row: { work_date: string }) => row.work_date);
        if (!dates.length) throw new Error("لا توجد أيام دوام لتطبيق هذا الطلب");
        const { data: currentDays, error: currentDaysError } = await supabase
          .from("attendance_day_status")
          .select("work_date, status")
          .eq("employee_id", form.employee_id)
          .in("work_date", dates);
        if (currentDaysError) throw new Error(currentDaysError.message);
        if ((currentDays ?? []).some((day) => ["present", "holiday", "rest"].includes(day.status))) {
          throw new Error("يوجد حضور أو عطلة أو راحة معتمدة في فترة الإجازة؛ راجع الحالة قبل التنفيذ");
        }
      }
      const overtime =
        form.kind === "leave"
          ? 0
          : form.kind === "overtime"
            ? Number(form.overtime_hours ?? 0)
            : Number(existing?.overtime_hours ?? 0);
      const { error: upsertError } = await supabase.from("attendance_day_status").upsert(
        dates.map((work_date) => ({
          employee_id: form.employee_id,
          work_date,
          status,
          overtime_hours: overtime,
          notes: `${form.kind === "leave" && !isPaidLeave ? "إجازة بدون راتب — " : ""}استمارة #${form.form_no}: ${form.reason}`.slice(0, 300),
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
      .insert({
        form_id: form.id,
        action: data.action === "withdraw" ? "withdrawn" : data.action,
        note: data.action === "withdraw" ? "سحب مقدم الطلب الإجازة قبل التنفيذ" : (data.note ?? null),
        actor: userId,
      });
    return { status: patch["status"] as string };
  });

export const getMyFormPowers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => actorPowers(context.supabase, context.userId));


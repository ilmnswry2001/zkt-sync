import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ingestSchema = z.object({
  upload_id: z.string().uuid(),
  device_id: z.string().uuid().nullable(),
  serial: z.string().max(64),
  users: z.array(z.object({
    user_pin: z.string().min(1).max(48),
    name: z.string().max(96),
    privilege: z.number().int(),
    dept_id: z.number().int(),
  })).max(20000),
  departments: z.array(z.object({
    external_id: z.number().int(),
    name: z.string().min(1).max(120),
  })).max(2000),
  logs: z.array(z.object({
    external_id: z.number().int(),
    user_pin: z.string().min(1).max(48),
    verify_time: z.string().min(10).max(40),
    verify_type: z.number().int(),
    status: z.number().int(),
  })).max(100000),
});

function normalizeVerifyTime(value: string) {
  const trimmed = value.trim();
  // ZKTeco exports commonly omit a timezone. Treat those values as UTC,
  // but do not append a second timezone designator to ISO timestamps.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(`${trimmed}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`وقت بصمة غير صالح: ${value}`);
  return parsed.toISOString();
}

export const ingestZkData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ingestSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // mark processing
    await supabase.from("uploaded_files").update({ status: "processing", device_serial: data.serial })
      .eq("id", data.upload_id);

    try {
      // ملفات البصمة تُستخدم للحضور فقط: لا يتم إنشاء أو تعديل بيانات الموظفين أو الأقسام.
      // الربط يتم عبر الرقم التعريفي للموظف (employee_no) الموجود مسبقاً في النظام.
      const pins = [...new Set(data.logs.map((l) => l.user_pin))];
      const empIdByPin = new Map<string, string>();
      for (let i = 0; i < pins.length; i += 500) {
        const chunk = pins.slice(i, i + 500);
        const { data: rows, error } = await supabase
          .from("employees")
          .select("id, employee_no")
          .in("employee_no", chunk);
        if (error) throw error;
        rows?.forEach((r: any) => empIdByPin.set(r.employee_no, r.id));
      }
      const unmatched = pins.filter((p) => !empIdByPin.has(p)).length;

      // إدراج سجلات البصمة (تجاهل المكرر)
      const logRows = data.logs.map((l) => {
        return {
          employee_no: l.user_pin,
          employee_id: empIdByPin.get(l.user_pin) ?? null,
          device_id: data.device_id,
          upload_id: data.upload_id,
          verify_time: normalizeVerifyTime(l.verify_time),
          verify_type: l.verify_type,
          status: l.status,
          external_log_id: l.external_id,
        };
      });

      let inserted = 0;
      for (let i = 0; i < logRows.length; i += 1000) {
        const chunk = logRows.slice(i, i + 1000);
        const { data: rows, error } = await supabase.from("attendance_logs")
          // Must match attendance_logs' UNIQUE(employee_no, verify_time, device_id)
          // constraint. The previous two-column target made every import fail
          // with PostgreSQL's "no unique constraint matching" error.
          .upsert(chunk, { onConflict: "employee_no,verify_time,device_id", ignoreDuplicates: true })
          .select("id");
        if (error) throw error;
        inserted += rows?.length ?? 0;
      }

      await supabase.from("uploaded_files").update({
        status: "completed",
        users_count: data.users.length,
        logs_count: data.logs.length,
        inserted_logs: inserted,
        processed_at: new Date().toISOString(),
      }).eq("id", data.upload_id);

      // update device last_sync
      if (data.device_id) {
        await supabase.from("devices").update({ last_sync_at: new Date().toISOString() }).eq("id", data.device_id);
      }

      return { success: true, inserted, users: data.users.length, departments: 0, unmatched };
    } catch (e: any) {
      await supabase.from("uploaded_files").update({
        status: "failed",
        error_message: String(e?.message ?? e),
      }).eq("id", data.upload_id);
      throw e;
    }
  });

// Dashboard summary
export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);

    const [emps, devs, logs, todayLogs] = await Promise.all([
      supabase.from("employees").select("id", { count: "exact", head: true }),
      supabase.from("devices").select("id", { count: "exact", head: true }),
      supabase.from("attendance_logs").select("id", { count: "exact", head: true }),
      supabase.from("attendance_logs")
        .select("employee_no, verify_time")
        .gte("verify_time", today.toISOString())
        .lt("verify_time", tomorrow.toISOString()),
    ]);

    const presentToday = new Set((todayLogs.data ?? []).map((r: any) => r.employee_no)).size;
    const totalEmployees = emps.count ?? 0;

    // last 7 days chart
    const since = new Date(today.getTime() - 6 * 86400000);
    const { data: weekLogs } = await supabase.from("attendance_logs")
      .select("employee_no, verify_time")
      .gte("verify_time", since.toISOString());
    const dayMap = new Map<string, Set<string>>();
    (weekLogs ?? []).forEach((l: any) => {
      const day = l.verify_time.slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, new Set());
      dayMap.get(day)!.add(l.employee_no);
    });
    const chart: { day: string; present: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
      chart.push({ day: d, present: dayMap.get(d)?.size ?? 0 });
    }

    return {
      totalEmployees,
      totalDevices: devs.count ?? 0,
      totalLogs: logs.count ?? 0,
      presentToday,
      absentToday: Math.max(0, totalEmployees - presentToday),
      chart,
    };
  });

// Daily attendance report
export const getDailyReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { date: string }) => z.object({ date: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const start = new Date(data.date + "T00:00:00+03:00");
    const end = new Date(start.getTime() + 86400000);
    const { data: logs, error: logsError } = await (supabase as any).from("attendance_logs")
      .select("employee_no, employee_id, verify_time, device_id, source, is_suspicious, selfie_path")
      .gte("verify_time", start.toISOString())
      .lt("verify_time", end.toISOString())
      .order("verify_time", { ascending: true });
    if (logsError) throw new Error(logsError.message);
    const { data: emps, error: employeesError } = await supabase.from("employees")
      .select("id, employee_no, full_name, status, department_id, departments(name), shifts(start_time, end_time, grace_minutes)");
    if (employeesError) throw new Error(employeesError.message);
    const startOfDay = new Date(`${data.date}T00:00:00+03:00`).toISOString();
    const startOfNextDay = new Date(new Date(startOfDay).getTime() + 86400000).toISOString();
    const { data: attempts } = await (supabase as any).from("attendance_suspicious_attempts")
      .select("employee_id, selfie_path, reason, attempted_at").gte("attempted_at", startOfDay).lt("attempted_at", startOfNextDay);
    const attemptByEmployee = new Map((attempts ?? []).map((attempt: any) => [attempt.employee_id, attempt]));
    const weekday = new Date(`${data.date}T00:00:00`).getDay();
    const { data: schedules, error: scheduleError } = await (supabase as any).from("employee_weekly_schedules")
      .select("employee_id, start_time, end_time, grace_minutes, effective_from, effective_until")
      .eq("weekday", weekday).lte("effective_from", data.date).or(`effective_until.is.null,effective_until.gte.${data.date}`);
    if (scheduleError) throw new Error(scheduleError.message);
    const scheduleByEmployee = new Map((schedules ?? []).map((schedule: any) => [schedule.employee_id, schedule]));

    const byPin = new Map<string, { first: string; last: string; devices: Set<string>; sources: Set<string>; suspicious: boolean }>();
    (logs ?? []).forEach((l: any) => {
      const cur = byPin.get(l.employee_no);
      if (!cur) byPin.set(l.employee_no, { first: l.verify_time, last: l.verify_time, devices: new Set(l.device_id ? [l.device_id] : []), sources: new Set(l.source ? [l.source] : []), suspicious: !!l.is_suspicious });
      else { cur.last = l.verify_time; if (l.device_id) cur.devices.add(l.device_id); if (l.source) cur.sources.add(l.source); cur.suspicious ||= !!l.is_suspicious; }
    });

    const rows = await Promise.all((emps ?? []).map(async (e: any) => {
      const rec = byPin.get(e.employee_no);
      const attempt: any = attemptByEmployee.get(e.id);
      const photoLog = (logs ?? []).find((log: any) => log.employee_no === e.employee_no && log.selfie_path);
      const photoPath = photoLog?.selfie_path ?? attempt?.selfie_path;
      const selfieUrl = photoPath ? (await supabase.storage.from("attendance-selfies").createSignedUrl(photoPath, 3600)).data?.signedUrl ?? null : null;
      const hours = rec ? (new Date(rec.last).getTime() - new Date(rec.first).getTime()) / 3600000 : 0;
      const shift: any = scheduleByEmployee.get(e.id) ?? e.shifts;
      const late = rec && shift?.start_time
        ? isLateArrival(data.date, rec.first, shift.start_time, shift.end_time, shift.grace_minutes ?? 0)
        : false;
      return {
        employee_no: e.employee_no,
        full_name: e.full_name,
        active: e.status === "active",
        department: e.departments?.name ?? null,
        check_in: rec?.first ?? null,
        check_out: rec?.last !== rec?.first ? rec?.last ?? null : null,
        hours: rec ? Math.max(0, Math.round(hours * 100) / 100) : 0,
        devices: rec?.devices.size ?? 0,
        mobile_self: rec?.sources.has("mobile_self") ?? false,
        sources: [...(rec?.sources ?? [])],
        suspicious: (rec?.suspicious ?? false) || !!attempt,
        suspicious_reason: attempt?.reason ?? null,
        selfie_url: selfieUrl,
        late,
        status: rec ? "present" : "absent",
      };
    }));
    const sourceCounts = { device: 0, mobile_self: 0, zk_agent: 0, manual: 0 };
    for (const log of logs ?? []) {
      const source = (log as any).source;
      if (source === "mobile_self") sourceCounts.mobile_self++;
      else if (source === "zk_agent" || source === "zkteco_auto_agent") sourceCounts.zk_agent++;
      else if (source === "manual") sourceCounts.manual++;
      else sourceCounts.device++;
    }
    return { rows, sourceCounts, suspiciousCount: (logs ?? []).filter((log: any) => log.is_suspicious).length + (attempts ?? []).length };
  });

function isLateArrival(
  date: string,
  checkIn: string,
  shiftStart: string,
  shiftEnd: string | null,
  graceMinutes: number,
) {
  const checkInTime = Date.parse(checkIn);
  let shiftStartTime = Date.parse(`${date}T${shiftStart}+03:00`);
  if (!Number.isFinite(checkInTime) || !Number.isFinite(shiftStartTime)) return false;

  if (shiftEnd && shiftEnd < shiftStart && checkInTime < shiftStartTime) {
    shiftStartTime -= 86400000;
  }
  return checkInTime > shiftStartTime + Math.max(0, Number(graceMinutes) || 0) * 60000;
}

// حذف ملفات مرفوعة مع سجلات البصمة الناتجة عنها
export const deleteUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: files, error: readErr } = await supabase
      .from("uploaded_files")
      .select("id, storage_path")
      .in("id", data.ids);
    if (readErr) throw new Error(readErr.message);

    const { error: logErr } = await supabase.from("attendance_logs").delete().in("upload_id", data.ids);
    if (logErr) throw new Error(logErr.message);

    const paths = (files ?? []).map((f) => f.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from("zk-backups").remove(paths);

    const { error } = await supabase.from("uploaded_files").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    return { deleted: data.ids.length };
  });

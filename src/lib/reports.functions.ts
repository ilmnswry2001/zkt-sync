import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), employee_id: z.string().uuid() });

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

// تقرير شهري لموظف واحد: كل يوم مع أول دخول وآخر خروج والساعات والحالة
export const getEmployeeMonthly = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => monthSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const start = `${data.month}-01`;
    const total = daysInMonth(data.month);
    const end = new Date(new Date(start + "T00:00:00Z").getTime() + total * 86400000).toISOString();

    const { data: emp } = await supabase.from("employees")
      .select("id, employee_no, full_name, position, base_salary, departments(name), sites(name, ctr_code), wage_rates(title, daily_rate, monthly_rate, overtime_hour_rate)")
      .eq("id", data.employee_id).maybeSingle();
    if (!emp) throw new Error("الموظف غير موجود");

    const [{ data: logs }, { data: overrides }, { data: additions }] = await Promise.all([
      supabase.from("attendance_logs").select("verify_time")
        .eq("employee_no", (emp as any).employee_no)
        .gte("verify_time", start + "T00:00:00Z").lt("verify_time", end)
        .order("verify_time", { ascending: true }),
      supabase.from("attendance_day_status").select("work_date, status, notes")
        .eq("employee_id", data.employee_id)
        .gte("work_date", start).lt("work_date", end.slice(0, 10)),
      supabase.from("salary_additions").select("id, kind, description, amount")
        .eq("employee_id", data.employee_id).eq("month", start),
    ]);

    const byDay = new Map<string, string[]>();
    (logs ?? []).forEach((l: any) => {
      const day = l.verify_time.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(l.verify_time);
    });
    const ovMap = new Map((overrides ?? []).map((o: any) => [o.work_date, o]));

    const days = [] as {
      date: string; check_in: string | null; check_out: string | null; hours: number;
      status: string; manual: boolean; notes: string | null; punches: number;
    }[];
    for (let i = 1; i <= total; i++) {
      const date = `${data.month}-${String(i).padStart(2, "0")}`;
      const times = byDay.get(date) ?? [];
      const first = times[0] ?? null;
      const last = times.length > 1 ? times[times.length - 1]! : null;
      const hours = first && last ? Math.max(0, Math.round(((new Date(last).getTime() - new Date(first).getTime()) / 3600000) * 100) / 100) : 0;
      const ov = ovMap.get(date) as any;
      days.push({
        date,
        check_in: first,
        check_out: last,
        hours,
        status: ov?.status ?? (times.length ? "present" : "absent"),
        manual: !!ov,
        notes: ov?.notes ?? null,
        punches: times.length,
      });
    }

    const presentDays = days.filter((d) => d.status === "present").length;
    const absentDays = days.filter((d) => d.status === "absent").length;
    const leaveDays = days.filter((d) => d.status === "leave").length;
    const holidayDays = days.filter((d) => d.status === "holiday" || d.status === "rest").length;
    const totalHours = Math.round(days.reduce((s, d) => s + d.hours, 0) * 100) / 100;

    const wage: any = (emp as any).wage_rates ?? null;
    const dailyRate = Number(wage?.daily_rate ?? 0);
    const monthly = Number((emp as any).base_salary ?? wage?.monthly_rate ?? 0);
    const basePay = dailyRate > 0 ? dailyRate * presentDays : monthly;
    const additionsTotal = (additions ?? []).reduce((s: number, a: any) => s + Number(a.amount ?? 0), 0);

    return {
      employee: emp,
      days,
      summary: { presentDays, absentDays, leaveDays, holidayDays, totalHours, workDays: total },
      payroll: {
        dailyRate, monthly, basePay,
        additions: additions ?? [],
        additionsTotal,
        total: Math.round((basePay + additionsTotal) * 100) / 100,
        currency: wage?.currency ?? "IQD",
      },
    };
  });

// تعديل حالة يوم واحد
export const setDayStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    employee_id: z.string().uuid(),
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["present", "absent", "leave", "holiday", "rest"]).nullable(),
    notes: z.string().max(300).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.status === null) {
      const { error } = await supabase.from("attendance_day_status").delete()
        .eq("employee_id", data.employee_id).eq("work_date", data.work_date);
      if (error) throw new Error(error.message);
      return { removed: true };
    }
    const { error } = await supabase.from("attendance_day_status")
      .upsert({
        employee_id: data.employee_id,
        work_date: data.work_date,
        status: data.status,
        notes: data.notes ?? null,
        updated_by: context.userId,
      }, { onConflict: "employee_id,work_date" });
    if (error) throw new Error(error.message);
    return { saved: true };
  });

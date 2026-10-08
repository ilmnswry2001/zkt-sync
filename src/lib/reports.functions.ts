import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAttendanceDays,
  calculatePayroll,
  loadAllRows,
  monthDates,
  summarizeDays,
} from "@/lib/monthly-report";
import { z } from "zod";

const monthValue = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const monthSchema = z.object({ month: monthValue, employee_id: z.string().uuid() });

function monthRange(month: string) {
  const dates = monthDates(month);
  const end = new Date(Date.parse(`${dates[0]}T00:00:00Z`) + dates.length * 86400000).toISOString();
  return { dates, start: dates[0], end };
}

export const getMonthlySheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ month: monthValue }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { dates, start, end } = monthRange(data.month);
    const today = new Date().toISOString().slice(0, 10);
    const employees = await loadAllRows((from, to) =>
      supabase
        .from("employees")
        .select(
          "id, employee_no, full_name, status, pay_type, department_id, site_id, shift_id, departments(name), sites!site_id(name), shifts(name, start_time, end_time, grace_minutes)",
        )
        .order("employee_no")
        .order("id")
        .range(from, to),
    );
    const rows = [];
    for (let i = 0; i < employees.length; i += 100) {
      const batch = employees.slice(i, i + 100);
      const [logs, overrides] = await Promise.all([
        loadAllRows((from, to) =>
          supabase
            .from("attendance_logs")
            .select("employee_no, verify_time")
            .in(
              "employee_no",
              batch.map((e) => e.employee_no),
            )
            .gte("verify_time", `${start}T00:00:00Z`)
            .lt("verify_time", end)
            .order("verify_time")
            .order("id")
            .range(from, to),
        ),
        loadAllRows((from, to) =>
          supabase
            .from("attendance_day_status")
            .select("employee_id, work_date, status, notes, overtime_hours")
            .in(
              "employee_id",
              batch.map((e) => e.id),
            )
            .gte("work_date", start)
            .lt("work_date", end.slice(0, 10))
            .order("employee_id")
            .order("work_date")
            .range(from, to),
        ),
      ]);
      const logsByEmployee = new Map<string, typeof logs>();
      for (const log of logs) {
        const entries = logsByEmployee.get(log.employee_no) ?? [];
        entries.push(log);
        logsByEmployee.set(log.employee_no, entries);
      }
      const overridesByEmployee = new Map<string, typeof overrides>();
      for (const override of overrides) {
        const entries = overridesByEmployee.get(override.employee_id) ?? [];
        entries.push(override);
        overridesByEmployee.set(override.employee_id, entries);
      }
      for (const employee of batch) {
        const days = buildAttendanceDays(
          dates,
          logsByEmployee.get(employee.employee_no) ?? [],
          overridesByEmployee.get(employee.id) ?? [],
          employee.shifts?.end_time,
          today,
          employee.pay_type === "daily" ? "daily" : "monthly",
          employee.shifts?.grace_minutes ?? 0,
        );
        rows.push({ employee, days, summary: summarizeDays(days) });
      }
    }
    return { dates, rows, today };
  });

export const getEmployeeMonthly = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => monthSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { dates, start, end } = monthRange(data.month);
    const { data: emp, error } = await supabase
      .from("employees")
      .select(
        "id, employee_no, full_name, position, base_salary, pay_type, departments(name), sites!site_id(name, ctr_code), shifts(name, start_time, end_time, grace_minutes), wage_rates(title, daily_rate, monthly_rate, overtime_hour_rate, currency)",
      )
      .eq("id", data.employee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp) throw new Error("الموظف غير موجود");

    const [logs, overrides, additions, penalties] = await Promise.all([
      loadAllRows((from, to) =>
        supabase
          .from("attendance_logs")
          .select("verify_time")
          .eq("employee_no", emp.employee_no)
          .gte("verify_time", `${start}T00:00:00Z`)
          .lt("verify_time", end)
          .order("verify_time")
          .order("id")
          .range(from, to),
      ),
      loadAllRows((from, to) =>
        supabase
          .from("attendance_day_status")
          .select("work_date, status, notes, overtime_hours")
          .eq("employee_id", data.employee_id)
          .gte("work_date", start)
          .lt("work_date", end.slice(0, 10))
          .order("work_date")
          .range(from, to),
      ),
      loadAllRows((from, to) =>
        supabase
          .from("salary_additions")
          .select("id, kind, description, amount")
          .eq("employee_id", data.employee_id)
          .eq("month", start)
          .order("id")
          .range(from, to),
      ),
      loadAllRows((from, to) =>
        supabase
          .from("employee_penalties")
          .select("id, deduction_amount")
          .eq("employee_id", data.employee_id)
          .gte("penalty_date", start)
          .lt("penalty_date", end.slice(0, 10))
          .order("penalty_date")
          .range(from, to),
      ),
    ]);
    const payType = emp.pay_type === "daily" ? ("daily" as const) : ("monthly" as const);
    const days = buildAttendanceDays(
      dates,
      logs,
      overrides,
      emp.shifts?.end_time,
      new Date().toISOString().slice(0, 10),
      payType,
      emp.shifts?.grace_minutes ?? 0,
    );
    const summary = summarizeDays(days);
    const wage = emp.wage_rates;
    const monthly = Number(emp.base_salary ?? wage?.monthly_rate ?? 0);
    const pay = calculatePayroll({
      payType,
      monthlySalary: monthly,
      dailyRate: Number(wage?.daily_rate ?? (monthly ? monthly / 26 : 0)),
      daysInMonth: dates.length,
      summary,
      holidayDays: days.filter((day) => day.status === "holiday").length,
      overtimeHourlyRate: Number(wage?.overtime_hour_rate ?? 0),
    });
    const additionsTotal = additions.reduce((sum, a) => sum + Number(a.amount ?? 0), 0);
    const deductionsTotal = penalties.reduce((sum, penalty) => sum + Number(penalty.deduction_amount ?? 0), 0);

    return {
      employee: emp,
      days,
      summary,
      payroll: {
        ...pay,
        dailyRate: pay.dayRate,
        monthly,
        additions,
        additionsTotal,
        penalties,
        deductionsTotal,
        total: Math.round((pay.basePay + pay.overtimePay + additionsTotal - deductionsTotal) * 100) / 100,
        currency: wage?.currency ?? "IQD",
      },
    };
  });

export const setDayStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        employee_id: z.string().uuid(),
        work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(["present", "absent", "leave", "holiday", "rest"]).nullable(),
        notes: z.string().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.status === null) {
      const { error } = await supabase
        .from("attendance_day_status")
        .delete()
        .eq("employee_id", data.employee_id)
        .eq("work_date", data.work_date);
      if (error) throw new Error(error.message);
      return { removed: true };
    }
    const { error } = await supabase.from("attendance_day_status").upsert(
      {
        employee_id: data.employee_id,
        work_date: data.work_date,
        status: data.status,
        notes: data.notes ?? null,
        updated_by: context.userId,
      },
      { onConflict: "employee_id,work_date" },
    );
    if (error) throw new Error(error.message);
    return { saved: true };
  });

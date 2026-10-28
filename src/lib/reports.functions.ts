import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAttendanceDays,
  calculatePayroll,
  loadAllRows,
  monthDates,
  summarizeDays,
  type WeeklyShiftSchedule,
} from "./monthly-report.ts";
import { z } from "zod";
import { monthInstantRangeInBaghdad, todayInBaghdad } from "./date-time.ts";
import { getEmployeePayType } from "./employee-pay-type.ts";

async function approvedLeaveOverrides(supabase: any, employeeIds: string[], start: string, endDate: string) {
  const rows: { employee_id: string; work_date: string; status: "leave"; notes: string; overtime_hours: number; is_paid: boolean }[] = [];
  for (let i = 0; i < employeeIds.length; i += 100) {
    const batch = employeeIds.slice(i, i + 100);
    const { data, error } = await supabase.from("forms")
      .select("employee_id, work_date, leave_end_date, reason, status, leave_type_id")
      .eq("kind", "leave").in("status", ["pending_execution", "executed"])
      .in("employee_id", batch).lt("work_date", endDate).gte("leave_end_date", start);
    if (error) throw new Error(error.message);
    const leaveTypeIds = [...new Set((data ?? []).map((form: any) => form.leave_type_id).filter(Boolean))];
    const leaveTypesById = new Map<string, { is_paid: boolean; count_non_working_days: boolean }>();
    if (leaveTypeIds.length) {
      const { data: leaveTypes, error: leaveTypesError } = await supabase
        .from("leave_types")
        .select("id, is_paid, count_non_working_days")
        .in("id", leaveTypeIds);
      if (leaveTypesError) throw new Error(leaveTypesError.message);
      for (const leaveType of leaveTypes ?? []) leaveTypesById.set(leaveType.id, leaveType);
    }
    for (const form of data ?? []) {
      const leaveType = leaveTypesById.get(form.leave_type_id);
      const { data: workDates, error: dateError } = await (supabase as any).rpc("leave_work_dates", {
        _employee_id: form.employee_id,
        _start_date: form.work_date,
        _end_date: form.leave_end_date ?? form.work_date,
        _count_non_working_days: leaveType?.count_non_working_days ?? true,
      });
      if (dateError) throw new Error(dateError.message);
      for (const { work_date: date } of workDates ?? []) {
        if (date >= start && date < endDate) rows.push({
          employee_id: form.employee_id,
          work_date: date,
          status: "leave",
          notes: `إجازة ${leaveType?.is_paid === false ? "بدون راتب" : "معتمدة"}: ${form.reason ?? ""}`,
          overtime_hours: 0,
          is_paid: leaveType?.is_paid !== false,
        });
      }
    }
  }
  return rows;
}

const monthValue = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const monthSchema = z.object({ month: monthValue, employee_id: z.string().uuid() });

function monthRange(month: string) {
  const dates = monthDates(month);
  const endDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10);
  const { start: logStart, end: logEnd } = monthInstantRangeInBaghdad(month);
  return { dates, start: dates[0], endDate, logStart, logEnd };
}

export const getMonthlySheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    month: monthValue,
    page: z.number().int().min(0).default(0),
    employee_id: z.string().uuid().optional(),
    department_id: z.string().uuid().optional(),
    site_id: z.string().uuid().optional(),
    shift_id: z.string().uuid().optional(),
    search: z.string().max(100).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { dates, start, endDate, logStart, logEnd } = monthRange(data.month);
    const today = todayInBaghdad();
    let employeeQuery = supabase
      .from("employees")
      .select(
        "id, employee_no, full_name, status, pay_type, department_id, site_id, shift_id, departments(name), sites!employees_site_id_fkey(name), shifts(name, start_time, end_time, grace_minutes)",
        { count: "exact" },
      );
    if (data.employee_id) employeeQuery = employeeQuery.eq("id", data.employee_id);
    if (data.department_id) employeeQuery = employeeQuery.eq("department_id", data.department_id);
    if (data.site_id) employeeQuery = employeeQuery.eq("site_id", data.site_id);
    if (data.shift_id) employeeQuery = employeeQuery.eq("shift_id", data.shift_id);
    const search = data.search?.trim().replace(/[^\p{L}\p{N}\s-]/gu, "");
    if (search) employeeQuery = employeeQuery.or(`full_name.ilike.%${search}%,employee_no.ilike.%${search}%`);
    const { data: employees, error: employeesError, count } = await employeeQuery
      .order("employee_no")
      .order("id")
      .range(data.page * 50, data.page * 50 + 49);
    if (employeesError) throw new Error(employeesError.message);
    const rows = [];
    for (let i = 0; i < (employees ?? []).length; i += 100) {
      const batch = (employees ?? []).slice(i, i + 100);
      const [logs, overrides, weeklySchedules] = await Promise.all([
        loadAllRows((from, to) =>
          supabase
            .from("attendance_logs")
            .select("employee_no, verify_time, status, source, self_event_type")
            .in(
              "employee_no",
              batch.map((e) => e.employee_no),
            )
            .gte("verify_time", logStart)
            .lt("verify_time", logEnd)
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
            .lt("work_date", endDate)
            .order("employee_id")
            .order("work_date")
            .range(from, to),
        ),
        loadAllRows((from, to) =>
          (supabase as any)
            .from("employee_weekly_schedules")
            .select("employee_id, weekday, start_time, end_time, grace_minutes, effective_from, effective_until")
            .in("employee_id", batch.map((employee) => employee.id))
            .lt("effective_from", endDate)
            .or(`effective_until.is.null,effective_until.gte.${start}`)
            .order("effective_from", { ascending: false })
            .range(from, to),
        ),
      ]);
      const leaveOverrides = await approvedLeaveOverrides(supabase, batch.map((employee) => employee.id), start, endDate);
      const logsByEmployee = new Map<string, typeof logs>();
      for (const log of logs) {
        const entries = logsByEmployee.get(log.employee_no) ?? [];
        entries.push(log);
        logsByEmployee.set(log.employee_no, entries);
      }
      const overridesByEmployee = new Map<string, typeof overrides>();
      for (const override of [...overrides, ...leaveOverrides]) {
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
          (weeklySchedules as WeeklyShiftSchedule[]).filter((schedule) => schedule.employee_id === employee.id),
        );
        rows.push({ employee, days, summary: summarizeDays(days) });
      }
    }
    return { dates, rows, today, totalRows: count ?? 0 };
  });

export const getEmployeeMonthly = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => monthSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { dates, start, endDate, logStart, logEnd } = monthRange(data.month);
    const { data: emp, error } = await supabase
      .from("employees")
      .select(
        "id, employee_no, full_name, position, base_salary, pay_type, departments(name), sites!employees_site_id_fkey(name, ctr_code), shifts(name, start_time, end_time, grace_minutes), wage_rates(title, daily_rate, monthly_rate, overtime_hour_rate, currency)",
      )
      .eq("id", data.employee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!emp) throw new Error("الموظف غير موجود");

    const [logs, overrides, additions, penalties, leaveOverrides, weeklySchedules] = await Promise.all([
      loadAllRows((from, to) =>
        supabase
          .from("attendance_logs")
          .select("verify_time, status, source, self_event_type")
          .eq("employee_no", emp.employee_no)
          .gte("verify_time", logStart)
          .lt("verify_time", logEnd)
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
          .lt("work_date", endDate)
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
          .lt("penalty_date", endDate)
          .order("penalty_date")
          .range(from, to),
      ),
      approvedLeaveOverrides(supabase, [data.employee_id], start, endDate),
      loadAllRows((from, to) =>
        (supabase as any)
          .from("employee_weekly_schedules")
          .select("employee_id, weekday, start_time, end_time, grace_minutes, effective_from, effective_until")
          .eq("employee_id", data.employee_id)
          .lt("effective_from", endDate)
          .or(`effective_until.is.null,effective_until.gte.${start}`)
          .order("effective_from", { ascending: false })
          .range(from, to),
      ),
    ]);
    const payType = getEmployeePayType(emp);
    const days = buildAttendanceDays(
      dates,
      logs,
      [...overrides, ...leaveOverrides],
      emp.shifts?.end_time,
      todayInBaghdad(),
      payType,
      emp.shifts?.grace_minutes ?? 0,
      weeklySchedules as WeeklyShiftSchedule[],
    );
    const summary = summarizeDays(days);
    const wage = emp.wage_rates;
    const monthly = Number(emp.base_salary ?? wage?.monthly_rate ?? 0);
    const additionsTotal = additions.reduce((sum, a) => sum + Number(a.amount ?? 0), 0);
    const deductionsTotal = penalties.reduce(
      (sum, penalty) => sum + Number(penalty.deduction_amount ?? 0),
      0,
    );
    const pay = calculatePayroll({
      payType,
      monthlySalary: monthly,
      dailyRate: Number(wage?.daily_rate ?? (monthly ? monthly / 26 : 0)),
      daysInMonth: dates.length,
      summary,
      holidayDays: days.filter((day) => day.status === "holiday").length,
      overtimeHourlyRate: Number(wage?.overtime_hour_rate ?? 0),
      additions: additionsTotal,
      deductions: deductionsTotal,
    });

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
        total: pay.netPay,
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


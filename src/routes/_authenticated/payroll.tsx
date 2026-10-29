import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Banknote, Download, Eye, Printer, RefreshCw, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { printReport, escapeHtml } from "@/lib/report-print";
import { amountInArabicIqd } from "@/lib/arabic-currency";
import { currentMonthInBaghdad, monthInstantRangeInBaghdad, todayInBaghdad } from "@/lib/date-time";
import { getEmployeePayType } from "@/lib/employee-pay-type";
import {
  type AttendanceDailyOvertime,
  buildAttendanceDays,
  calculatePayroll,
  loadAllRows,
  monthDates,
  roundMoney,
  summarizeDays,
  type WeeklyShiftSchedule,
} from "@/lib/monthly-report";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({ meta: [{ title: "الرواتب" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const { data: formRoles } = await supabase
      .from("form_role_assignments")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "ceo");
    if (!roles?.some((r) => r.role === "admin" || r.role === "hr" || r.role === "accountant") && !formRoles?.length)
      throw redirect({ to: "/dashboard" });
  },
  component: PayrollPage,
});

type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  base_salary: number | null;
  pay_type: string | null;
  position: string | null;
  salary_type: string | null;
  contract_type: string | null;
  bank_name: string | null;
  bank_account: string | null;
  iban: string | null;
  sites: { name: string } | null;
  departments: { name: string } | null;
  wage_rates: {
    title: string | null;
    monthly_rate: number | null;
    daily_rate: number | null;
    overtime_hour_rate: number | null;
    currency: string;
  } | null;
  shifts: { end_time: string | null; grace_minutes: number | null } | null;
};
type Addition = { employee_id: string; amount: number; kind: string };
type Penalty = {
  id: string;
  employee_id: string | null;
  deduction_amount: number;
  penalty_date: string;
  notes: string | null;
};
type AttendanceLog = { employee_no: string; verify_time: string; status: number | null; source: string | null; self_event_type: string | null };
type ApprovedLeaveCalendarDay = { employee_id: string; work_date: string; leave_end_date: string | null; is_paid: boolean; count_non_working_days: boolean | null; status: string };
type AttendanceOverride = {
  employee_id: string;
  work_date: string;
  status: "present" | "absent" | "leave" | "holiday" | "rest";
  notes: string | null;
  overtime_hours: number | null;
  is_paid?: boolean;
};
type Vehicle = {
  id: string;
  vehicle_no: string;
  name: string;
  vehicle_class: "light" | "heavy";
  daily_rate: number;
  currency: string;
  is_active: boolean;
};
type VehicleOperation = { vehicle_id: string; operating_days: number };

type PayrollSlipRow = {
  employee: { full_name: string; employee_no: string; departments?: { name: string } | null };
  payroll: { basePay: number; overtimeHours: number; overtimePay: number };
  additions: number;
  deductions: number;
  total: number;
  summary: { presentDays: number };
  penalties: Array<{ deduction_amount: number | null; notes: string | null }>;
};

const money = (value: number) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} د.ع`;

function buildPayrollSlipHtml(row: PayrollSlipRow, month: string) {
  const deductionRows = row.penalties
    .filter((penalty) => Number(penalty.deduction_amount) > 0)
    .map((penalty) => `<tr><td>${escapeHtml(penalty.notes || "استقطاع")}</td><td class="amount">−${money(Number(penalty.deduction_amount))}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قصاصة راتب — ${escapeHtml(row.employee.full_name)}</title><style>
    @page{size:100mm 150mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:100mm;height:150mm;font-family:Arial,Tahoma,sans-serif;color:#17202a;background:#fff}body{direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}.slip{width:100mm;height:150mm;padding:5mm;overflow:hidden;border:1px solid #dce5eb;display:flex;flex-direction:column}.hero{height:25mm;flex:none;border-radius:3mm;padding:3mm 4mm;background:linear-gradient(120deg,#07858a,#144b67);color:#fff;display:flex;align-items:center;justify-content:space-between}.hero-label{font-size:8pt}.hero-amount{font-size:18pt;font-weight:700;direction:ltr;text-align:right;margin-top:1mm}.hero-month{text-align:left;font-size:8pt;align-self:flex-end;padding-bottom:1mm}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1.5mm;margin-top:2mm}.stat{height:16mm;background:#f0f6f6;border-radius:2mm;padding:2mm;text-align:right}.stat span{display:block;color:#718096;font-size:7pt}.stat b{display:block;font-size:9pt;margin-top:1mm;white-space:nowrap}.identity{height:28mm;flex:none;display:grid;grid-template-columns:1fr 1fr;gap:1.5mm;margin-top:3mm;padding:2.5mm;border:1px solid #e0e7ed;border-radius:2mm}.identity span{display:block;color:#718096;font-size:7pt}.identity b{display:block;font-size:8pt;margin-top:.5mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.heading{height:9mm;flex:none;display:flex;align-items:center;justify-content:space-between;margin-top:3mm;padding:0 2mm;background:#f0f2f4;font-weight:bold;font-size:8pt}.table-wrap{flex:1;min-height:0;overflow:hidden}.slip table{width:100%;border-collapse:collapse;font-size:7.5pt}.slip td{height:8mm;padding:1.5mm 2mm;border-bottom:1px solid #e6eaee}.amount{direction:ltr;text-align:left;font-weight:bold;white-space:nowrap}.net{height:13mm;flex:none;margin-top:2mm;background:#edf5f4;border-radius:2mm;padding:2mm 3mm;display:flex;align-items:center;justify-content:space-between;font-weight:bold;font-size:8pt}.net b{font-size:12pt;direction:ltr}.footer{height:7mm;flex:none;margin-top:2mm;padding-top:1.5mm;border-top:1px solid #e6eaee;color:#758195;display:flex;justify-content:space-between;font-size:6.5pt}.screen-print{display:none}@media screen{body{width:100mm;height:150mm;margin:0}.slip{box-shadow:0 2px 18px #2030402b}.screen-print{display:block;position:fixed;top:5px;right:calc(50% - 50mm);transform:translateY(-100%);background:#173d58;color:#fff;border:0;border-radius:5px;padding:7px 12px;cursor:pointer;font-size:13px}}@media print{.screen-print{display:none}}
    </style></head><body><main class="slip"><section class="hero"><div><div class="hero-label">صافي الراتب</div><div class="hero-amount">${money(row.total)}</div></div><div class="hero-month">د.ع<br>${escapeHtml(month)}</div></section><section class="stats"><div class="stat"><span>الأساسي</span><b>${money(row.payroll.basePay)}</b></div><div class="stat"><span>الإضافي</span><b>${money(row.payroll.overtimePay + row.additions)}</b></div><div class="stat"><span>الاستقطاع</span><b>${money(row.deductions)}</b></div></section><section class="identity"><div><span>الموظف</span><b>${escapeHtml(row.employee.full_name)}</b></div><div><span>الرقم</span><b>${escapeHtml(row.employee.employee_no)}</b></div><div><span>القسم</span><b>${escapeHtml(row.employee.departments?.name || "—")}</b></div><div><span>أيام العمل</span><b>${row.summary.presentDays} يوم</b></div></section><div class="heading"><span>تفاصيل الراتب</span><span>د.ع</span></div><div class="table-wrap"><table><tbody><tr><td>الراتب الأساسي</td><td class="amount">${money(row.payroll.basePay)}</td></tr><tr><td>بدل الساعات الإضافية (${roundMoney(row.payroll.overtimeHours)} ساعة)</td><td class="amount">${money(row.payroll.overtimePay)}</td></tr><tr><td>الإضافات والمكافآت</td><td class="amount">${money(row.additions)}</td></tr>${deductionRows}<tr><td>إجمالي الاستقطاعات</td><td class="amount">−${money(row.deductions)}</td></tr></tbody></table></div><section class="net"><span>صافي الراتب</span><b>${money(row.total)}</b></section><footer class="footer"><span>صادرة إلكترونيًا من نظام الموارد البشرية</span><span>١ من ١</span></footer></main></body></html>`;
}

function PayrollSlipPreview({ row, month }: { row: PayrollSlipRow; month: string }) {
  const deductions = row.penalties
    .filter((penalty) => Number(penalty.deduction_amount) > 0)
    .map((penalty) => ({ label: penalty.notes || "استقطاع", amount: Number(penalty.deduction_amount) }));
  return (
    <article className="mx-auto flex aspect-[2/3] w-full max-w-[100mm] flex-col overflow-hidden border border-slate-200 bg-white p-[5%] text-slate-900 shadow-md">
      <header className="flex h-[17%] shrink-0 items-center justify-between rounded-lg bg-gradient-to-l from-teal-700 to-cyan-700 px-[5%] text-white">
        <div><span className="block text-xs">صافي الراتب</span><b className="mt-1 block text-xl" dir="ltr">{money(row.total)}</b></div>
        <div className="text-left text-xs">د.ع<br />{month}</div>
      </header>
      <section className="mt-[3%] grid shrink-0 grid-cols-3 gap-2 text-right text-xs">
        <div className="rounded bg-slate-50 p-2"><span className="text-slate-500">الأساسي</span><b className="mt-1 block">{money(row.payroll.basePay)}</b></div>
        <div className="rounded bg-slate-50 p-2"><span className="text-slate-500">الإضافي</span><b className="mt-1 block">{money(row.payroll.overtimePay + row.additions)}</b></div>
        <div className="rounded bg-slate-50 p-2"><span className="text-slate-500">الاستقطاع</span><b className="mt-1 block">{money(row.deductions)}</b></div>
      </section>
      <section className="mt-[3%] grid shrink-0 grid-cols-2 gap-x-4 gap-y-2 rounded border border-slate-200 p-[4%] text-xs">
        <div><span className="text-slate-500">الموظف</span><b className="block">{row.employee.full_name}</b></div>
        <div><span className="text-slate-500">الرقم</span><b className="block">{row.employee.employee_no}</b></div>
        <div><span className="text-slate-500">القسم</span><b className="block">{row.employee.departments?.name || "—"}</b></div>
        <div><span className="text-slate-500">أيام العمل</span><b className="block">{row.summary.presentDays} يوم</b></div>
      </section>
      <div className="mt-[3%] flex shrink-0 justify-between bg-slate-100 px-3 py-2 text-xs font-semibold"><span>تفاصيل الراتب</span><span>د.ع</span></div>
      <div className="min-h-0 flex-1 overflow-auto text-xs">
        <div className="flex justify-between border-b border-slate-100 py-2"><span>الراتب الأساسي</span><b>{money(row.payroll.basePay)}</b></div>
        <div className="flex justify-between border-b border-slate-100 py-2"><span>الساعات الإضافية ({roundMoney(row.payroll.overtimeHours)} ساعة)</span><b>{money(row.payroll.overtimePay)}</b></div>
        <div className="flex justify-between border-b border-slate-100 py-2"><span>الإضافات والمكافآت</span><b>{money(row.additions)}</b></div>
        {deductions.map((item, index) => <div key={`${item.label}-${index}`} className="flex justify-between border-b border-slate-100 py-2"><span>{item.label}</span><b>−{money(item.amount)}</b></div>)}
        <div className="flex justify-between border-b border-slate-100 py-2"><span>إجمالي الاستقطاعات</span><b>−{money(row.deductions)}</b></div>
      </div>
      <footer className="mt-[3%] flex shrink-0 justify-between rounded bg-teal-50 px-3 py-2 text-sm font-semibold"><span>صافي الراتب</span><b>{money(row.total)}</b></footer>
      <div className="mt-2 shrink-0 border-t pt-2 text-[10px] text-slate-500">صادرة إلكترونيًا من نظام الموارد البشرية</div>
    </article>
  );
}

function PayrollPage() {
  const queryClient = useQueryClient();
  const [previewRow, setPreviewRow] = useState<PayrollSlipRow | null>(null);
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [advanceEmployeeId, setAdvanceEmployeeId] = useState("");
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState("cash");
  const pageSize = 20;
  const nextMonth = useMemo(() => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 10);
  }, [month]);
  const query = useQuery({
    queryKey: ["payroll", month],
    staleTime: 60_000,
    queryFn: async () => {
      const attendanceRange = monthInstantRangeInBaghdad(month);
      const employeeQuery = supabase
        .from("employees")
        .select(
          "id, employee_no, full_name, position, base_salary, pay_type, salary_type, contract_type, bank_name, bank_account, iban, sites!employees_site_id_fkey(name), departments!employees_department_id_fkey(name), wage_rates(title, monthly_rate, daily_rate, overtime_hour_rate, currency), shifts(end_time, grace_minutes)",
          { count: "exact" },
        )
        .order("employee_no")
        .order("id");
      const employees = await loadAllRows((from, to) => employeeQuery.range(from, to)) as Employee[];
      const employeeIds = employees.map((employee) => employee.id);
      const employeeNumbers = employees.map((employee) => employee.employee_no);
      const [additions, penalties, logs, overrides, weeklySchedules, storedOvertime, vehicles, vehicleOperations, leaveCalendar] =
        await Promise.all([
          employeeIds.length ? loadAllRows((from, to) =>
            supabase
              .from("salary_additions")
              .select("employee_id, amount, kind")
              .in("employee_id", employeeIds)
              .eq("month", `${month}-01`)
              .order("id")
              .range(from, to),
          ) : Promise.resolve([]),
          employeeIds.length ? loadAllRows((from, to) =>
            supabase
              .from("employee_penalties")
              .select("id, employee_id, deduction_amount, penalty_date, notes")
              .in("employee_id", employeeIds)
              .gte("penalty_date", `${month}-01`)
              .lt("penalty_date", nextMonth)
              .order("id")
              .range(from, to),
          ) : Promise.resolve([]),
          employeeNumbers.length ? loadAllRows((from, to) =>
            supabase
              .from("attendance_logs")
              .select("employee_no, verify_time, status, source, self_event_type")
              .in("employee_no", employeeNumbers)
              .gte("verify_time", attendanceRange.start)
              .lt("verify_time", attendanceRange.end)
              .order("verify_time")
              .order("id")
              .range(from, to),
          ) : Promise.resolve([]),
          employeeIds.length ? loadAllRows((from, to) =>
            supabase
              .from("attendance_day_status")
              .select("employee_id, work_date, status, notes, overtime_hours")
              .in("employee_id", employeeIds)
              .gte("work_date", `${month}-01`)
              .lt("work_date", nextMonth)
              .order("employee_id")
              .order("work_date")
              .range(from, to),
          ) : Promise.resolve([]),
          employeeIds.length ? loadAllRows((from, to) =>
            (supabase as any)
              .from("employee_weekly_schedules")
              .select("employee_id, weekday, start_time, end_time, grace_minutes, effective_from, effective_until")
              .in("employee_id", employeeIds)
              .lt("effective_from", nextMonth)
              .or(`effective_until.is.null,effective_until.gte.${month}-01`)
              .order("effective_from", { ascending: false })
              .range(from, to),
          ) : Promise.resolve([]),
          employeeIds.length ? loadAllRows((from, to) =>
            (supabase as any)
              .from("attendance_daily_overtime")
              .select("employee_id, work_date, overtime_hours")
              .in("employee_id", employeeIds)
              .gte("work_date", `${month}-01`)
              .lt("work_date", nextMonth)
              .order("employee_id")
              .order("work_date")
              .range(from, to),
          ) : Promise.resolve([]),
          Promise.resolve([]),
          Promise.resolve([]),
          employeeIds.length ? loadAllRows((from, to) =>
            supabase
              .from("forms")
              .select("employee_id, work_date, leave_end_date, status, leave_types(is_paid, count_non_working_days)")
              .in("employee_id", employeeIds)
              .eq("kind", "leave")
              .in("status", ["pending_execution", "executed"])
              .lt("work_date", nextMonth)
              .gte("leave_end_date", `${month}-01`)
              .range(from, to),
          ) : Promise.resolve([]),
        ]);
      const [{ data: runData, error: runError }, { data: advanceData, error: advancesError }] = await Promise.all([
        (supabase as any).from("payroll_runs").select("*").eq("month", `${month}-01`).maybeSingle(),
        (supabase as any).from("employee_advance_installments")
          .select("id, advance_id, amount, employee_advances!inner(employee_id, status)")
          .eq("month", `${month}-01`).eq("status", "scheduled").eq("employee_advances.status", "active"),
      ]);
      if (runError) throw new Error(runError.message);
      if (advancesError) throw new Error(advancesError.message);
      const { data: payrollLines, error: linesError } = runData
        ? await (supabase as any).from("payroll_run_lines").select("employee_id, base_amount, overtime_hours, overtime_amount, additions_amount, deductions_amount, advance_deduction, net_amount, calculation_snapshot").eq("payroll_run_id", runData.id)
        : { data: [], error: null };
      if (linesError) throw new Error(linesError.message);
      const approvedLeaveDays: AttendanceOverride[] = (leaveCalendar as any[]).flatMap((form) => {
        const leaveType = Array.isArray(form.leave_types) ? form.leave_types[0] : form.leave_types;
        const end = form.leave_end_date || form.work_date;
        const dates: AttendanceOverride[] = [];
        for (let date = new Date(`${form.work_date}T00:00:00Z`); date <= new Date(`${end}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
          const workDate = date.toISOString().slice(0, 10);
          if (workDate < `${month}-01` || workDate >= nextMonth) continue;
          if (!leaveType?.count_non_working_days && [0, 5].includes(date.getUTCDay())) continue;
          dates.push({ employee_id: form.employee_id, work_date: workDate, status: "leave", notes: `إجازة ${leaveType?.is_paid ? "مدفوعة" : "بدون راتب"}`, overtime_hours: 0, is_paid: Boolean(leaveType?.is_paid) });
        }
        return dates;
      });
      return {
        employees,
        employeeCount: employees.length,
        additions: additions as Addition[],
        penalties: penalties as Penalty[],
        logs: logs as AttendanceLog[],
        overrides: [...(overrides as AttendanceOverride[]), ...approvedLeaveDays],
        weeklySchedules: weeklySchedules as WeeklyShiftSchedule[],
        storedOvertime: storedOvertime as AttendanceDailyOvertime[],
        vehicles: vehicles as Vehicle[],
        vehicleOperations: vehicleOperations as VehicleOperation[],
        payrollRun: runData,
        payrollLines: payrollLines ?? [],
        advanceInstallments: (advanceData ?? []) as Array<{ id: string; amount: number; employee_advances: { employee_id: string; status: string } | Array<{ employee_id: string; status: string }> }>,
      };
    },
  });
  const dataByEmployee = useMemo(() => {
    const groupBy = <T,>(items: T[], key: (item: T) => string) => {
      const groups = new Map<string, T[]>();
      for (const item of items) {
        const groupKey = key(item);
        const group = groups.get(groupKey);
        if (group) group.push(item);
        else groups.set(groupKey, [item]);
      }
      return groups;
    };
    const data = query.data;
    return {
      logs: groupBy(data?.logs ?? [], (item) => item.employee_no),
      overrides: groupBy(data?.overrides ?? [], (item) => item.employee_id),
      schedules: groupBy(data?.weeklySchedules ?? [], (item) => item.employee_id),
      overtime: groupBy(data?.storedOvertime ?? [], (item) => item.employee_id),
      additions: groupBy(data?.additions ?? [], (item) => item.employee_id),
      penalties: groupBy(data?.penalties ?? [], (item) => item.employee_id ?? ""),
      advances: groupBy(data?.advanceInstallments ?? [], (item) => {
        const advance = Array.isArray(item.employee_advances) ? item.employee_advances[0] : item.employee_advances;
        return advance?.employee_id ?? "";
      }),
    };
  }, [query.data]);
  const rows = useMemo(
    () => {
      const savedLines = new Map((query.data?.payrollLines ?? []).map((line: any) => [line.employee_id, line]));
      return (query.data?.employees ?? []).map((employee) => {
        const payType = getEmployeePayType(employee);
        const days = buildAttendanceDays(
          monthDates(month),
          dataByEmployee.logs.get(employee.employee_no) ?? [],
          dataByEmployee.overrides.get(employee.id) ?? [],
          employee.shifts?.end_time,
          todayInBaghdad(),
          payType,
          employee.shifts?.grace_minutes ?? 0,
          dataByEmployee.schedules.get(employee.id) ?? [],
          dataByEmployee.overtime.get(employee.id) ?? [],
        );
        const summary = summarizeDays(days);
        const monthlySalary = Number(
          employee.base_salary ?? employee.wage_rates?.monthly_rate ?? 0,
        );
        const dailyRate = Number(
          employee.wage_rates?.daily_rate ?? (monthlySalary ? monthlySalary / 26 : 0),
        );
        let additions = (dataByEmployee.additions.get(employee.id) ?? [])
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const employeePenalties = dataByEmployee.penalties.get(employee.id) ?? [];
        let deductions = employeePenalties
          .reduce((sum, item) => sum + Number(item.deduction_amount || 0), 0);
        const payroll = calculatePayroll({
          payType,
          monthlySalary,
          dailyRate,
          daysInMonth: days.length,
          summary,
          holidayDays: days.filter((day) => day.status === "holiday").length,
          overtimeHourlyRate: Number(employee.wage_rates?.overtime_hour_rate ?? 0),
          additions,
          deductions,
        });
        const advanceInstallments = dataByEmployee.advances.get(employee.id) ?? [];
        const advanceDeduction = Math.min(payroll.netPay, advanceInstallments.reduce((sum, installment) => sum + Number(installment.amount || 0), 0));
        const total = Math.max(0, payroll.netPay - advanceDeduction);
        const saved = ["approved", "paid"].includes(query.data?.payrollRun?.status ?? "")
          ? savedLines.get(employee.id) as any
          : undefined;
        if (saved) {
          payroll.basePay = Number(saved.base_amount);
          payroll.overtimeHours = Number(saved.overtime_hours);
          payroll.overtimePay = Number(saved.overtime_amount);
          payroll.netPay = Number(saved.net_amount);
          additions = Number(saved.additions_amount);
          deductions = Number(saved.deductions_amount);
          return {
            employee, payType, payroll,
            summary: saved.calculation_snapshot?.summary ?? summary,
            additions, deductions, penalties: employeePenalties,
            advanceDeduction: Number(saved.advance_deduction), advanceInstallments, total: Number(saved.net_amount),
          };
        }
        return { employee, payType, payroll, summary, additions, deductions, penalties: employeePenalties, advanceDeduction, advanceInstallments, total };
      });
    },
    [query.data?.employees, query.data?.payrollLines, query.data?.payrollRun, dataByEmployee, month],
  );
  const filteredRows = search.trim()
    ? rows.filter(({ employee }) => `${employee.full_name} ${employee.employee_no}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    : rows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const bankRows = rows.filter(
    (row) => row.employee.bank_account?.trim() || row.employee.iban?.trim(),
  );
  const cashRows = rows.filter(({ employee }) => {
    if (getEmployeePayType(employee) === "daily") return true;
    return [employee.salary_type, employee.contract_type].some((value) =>
      /نقد|cash/i.test(value ?? ""),
    );
  });
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const payrollRun = query.data?.payrollRun as { id: string; status: string; approved_by: string | null; payment_method: string | null; payment_reference: string | null } | null | undefined;
  const actorQuery = useQuery({
    queryKey: ["payroll-actor"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { hr: false, admin: false, accountant: false, ceo: false };
      const [{ data: roles }, { data: formRoles }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", auth.user.id),
        supabase.from("form_role_assignments").select("role").eq("user_id", auth.user.id).eq("role", "ceo"),
      ]);
      return { hr: !!roles?.some((item) => item.role === "hr"), admin: !!roles?.some((item) => item.role === "admin"), accountant: !!roles?.some((item) => item.role === "accountant"), ceo: !!formRoles?.length };
    },
  });
  const isHr = actorQuery.data?.hr || actorQuery.data?.admin;
  const isPayrollOperator = isHr || actorQuery.data?.accountant;
  const isCeo = actorQuery.data?.ceo;
  const isLocked = payrollRun?.status === "approved" || payrollRun?.status === "paid";
  const savePayrollRun = useMutation({
    mutationFn: async (action: "draft" | "review" | "approve" | "pay") => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("انتهت جلسة الدخول");
      const runPayload: Record<string, unknown> = {};
      if (action === "draft" || action === "review") {
        runPayload.month = `${month}-01`;
        runPayload.total_amount = total;
      }
      if (!payrollRun && (action === "draft" || action === "review")) runPayload.created_by = auth.user.id;
      if (action === "review") runPayload.reviewed_by = auth.user.id;
      if (action === "approve") { runPayload.status = "approved"; runPayload.approved_by = auth.user.id; }
      if (action === "pay") {
        runPayload.status = "paid"; runPayload.paid_by = auth.user.id;
        runPayload.payment_method = advancePaymentMethod;
        runPayload.payment_reference = window.prompt("رقم مرجع التحويل أو سند الصرف (اختياري)") || null;
        runPayload.paid_at = new Date().toISOString();
      }
      let runId = payrollRun?.id;
      if (runId) {
        const { error } = await (supabase as any).from("payroll_runs").update(runPayload).eq("id", runId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any).from("payroll_runs").insert({ ...runPayload, status: "draft" }).select("id").single();
        if (error) throw error;
        runId = data.id;
      }
      if (action === "draft" || action === "review") {
        const { error: deleteError } = await (supabase as any).from("payroll_run_lines").delete().eq("payroll_run_id", runId);
        if (deleteError) throw deleteError;
        if (rows.length) {
          const lines = rows.map((row) => ({
            payroll_run_id: runId, employee_id: row.employee.id,
            base_amount: row.payroll.basePay, overtime_hours: row.payroll.overtimeHours,
            overtime_amount: row.payroll.overtimePay, additions_amount: row.additions,
            deductions_amount: row.deductions, advance_deduction: row.advanceDeduction,
            net_amount: row.total,
            calculation_snapshot: { summary: row.summary, payType: row.payType, penaltyIds: row.penalties.map((item) => item.id) },
          }));
          const { error } = await (supabase as any).from("payroll_run_lines").insert(lines);
          if (error) throw error;
        }
      }
      if (action === "review") {
        const { error } = await (supabase as any).from("payroll_runs").update({ status: "review" }).eq("id", runId);
        if (error) throw error;
      }
      if (action === "pay") {
        const installmentIds = rows.flatMap((row) => row.advanceInstallments.map((item) => item.id));
        if (installmentIds.length) {
          const { error } = await (supabase as any).from("employee_advance_installments")
            .update({ status: "deducted", payroll_run_id: runId }).in("id", installmentIds);
          if (error) throw error;
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["payroll", month] });
      toast.success("تم تحديث دورة الرواتب");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const createAdvance = useMutation({
    mutationFn: async (form: FormData) => {
      const amount = Number(form.get("amount"));
      const installmentAmount = Number(form.get("installment_amount"));
      const count = Math.ceil(amount / installmentAmount);
      const firstMonth = String(form.get("first_month") ?? "");
      if (!advanceEmployeeId || amount <= 0 || installmentAmount <= 0 || count > 120 || firstMonth < currentMonthInBaghdad()) throw new Error("تحقق من الموظف والمبلغ والقسط وشهر بدء الخصم (الحد الأقصى 120 قسطًا)");
      const { data: auth } = await supabase.auth.getUser();
      const { data: advance, error } = await (supabase as any).from("employee_advances").insert({
        employee_id: advanceEmployeeId, amount, installment_amount: installmentAmount,
        installments_count: count, first_deduction_month: `${firstMonth}-01`,
        purpose: form.get("purpose") || null, created_by: auth.user?.id,
      }).select("id").single();
      if (error) throw error;
      const first = new Date(`${firstMonth}-01T00:00:00Z`);
      const installments = Array.from({ length: count }, (_, index) => {
        const date = new Date(first); date.setUTCMonth(date.getUTCMonth() + index);
        return { advance_id: advance.id, month: date.toISOString().slice(0, 10), amount: index === count - 1 ? amount - installmentAmount * (count - 1) : installmentAmount };
      });
      const { error: installmentError } = await (supabase as any).from("employee_advance_installments").insert(installments);
      if (installmentError) throw installmentError;
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["payroll", month] }); toast.success("تم تسجيل السلفة وجدولة أقساطها"); },
    onError: (error: Error) => toast.error(error.message),
  });
  const vehicleRows = (kind: Vehicle["vehicle_class"]) =>
    (query.data?.vehicles ?? [])
      .filter((vehicle) => vehicle.vehicle_class === kind)
      .map((vehicle) => {
        const operatingDays = Number(
          query.data?.vehicleOperations.find((op) => op.vehicle_id === vehicle.id)
            ?.operating_days ?? 0,
        );
        return { vehicle, operatingDays, total: operatingDays * Number(vehicle.daily_rate) };
      });
  const exportExcel = (kind: "employees" | Vehicle["vehicle_class"] = "employees") => {
    const workbook = XLSX.utils.book_new();
    if (kind !== "employees") {
      const vehicleSheet = XLSX.utils.json_to_sheet(
        vehicleRows(kind).map(({ vehicle, operatingDays, total: net }) => ({
          "رقم المركبة": vehicle.vehicle_no,
          "اسم / نوع المركبة": vehicle.name,
          "أيام التشغيل": operatingDays,
          "الأجر اليومي": Number(vehicle.daily_rate),
          "صافي المستحق": net,
          العملة: vehicle.currency,
        })),
      );
      vehicleSheet["!cols"] = [
        { wch: 18 },
        { wch: 30 },
        { wch: 16 },
        { wch: 18 },
        { wch: 20 },
        { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(
        workbook,
        vehicleSheet,
        kind === "light" ? "رواتب المركبات الخفيفة" : "رواتب المركبات الثقيلة",
      );
      XLSX.writeFile(
        workbook,
        `رواتب_المركبات_${kind === "light" ? "الخفيفة" : "الثقيلة"}_${month}.xlsx`,
      );
      return;
    }
    const sheetRows = filteredRows.map(
      ({ employee, payroll, summary, additions, deductions, total: net }) => ({
        "رقم الموظف": employee.employee_no,
        "اسم الموظف": employee.full_name,
        "نوع الأجر": getEmployeePayType(employee) === "daily" ? "يومي" : "شهري",
        "أيام الحضور": summary.presentDays,
        "إجازة مدفوعة": payroll.leaveDays,
        "إجازة بدون راتب": payroll.unpaidLeaveDays,
        "أيام الراحة الأسبوعية": payroll.woDays,
        "أيام العطل المعتمدة": payroll.holidayDays,
        "ساعات إضافية": payroll.overtimeHours,
        "الأجر الأساسي": payroll.basePay,
        "بدل الإضافي": payroll.overtimePay,
        الإضافات: additions,
        الاستقطاعات: deductions,
        "صافي الراتب": net,
        العملة: employee.wage_rates?.currency ?? "IQD",
      }),
    );
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    sheet["!cols"] = [
      { wch: 16 },
      { wch: 30 },
      { wch: 14 },
      ...Array(11).fill({ wch: 20 }),
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, "رواتب الموظفين");
    XLSX.writeFile(workbook, `رواتب_الموظفين_${month}.xlsx`);
  };
  const exportBankPayroll = (format: "xlsx" | "csv") => {
    if (!bankRows.length) {
      toast.error("لا توجد حسابات مصرفية أو أرقام دفع مسجلة للموظفين");
      return;
    }
    const sheetRows = bankRows.map(({ employee, total: net }) => ({
      "اسم الموظف الكامل": employee.full_name,
      "رقم الموظف": employee.employee_no,
      الفرع: employee.sites?.name || employee.departments?.name || "",
      المصرف: employee.bank_name || "",
      "رقم الحساب / بطاقة الدفع": employee.bank_account || "",
      IBAN: employee.iban || "",
      "صافي المستحق": roundMoney(net),
      العملة: "IQD",
    }));
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    sheet["!cols"] = [
      { wch: 30 },
      { wch: 16 },
      { wch: 24 },
      { wch: 22 },
      { wch: 28 },
      { wch: 34 },
      { wch: 18 },
      { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "كشف الصرف المصرفي");
    XLSX.writeFile(workbook, `كشف_مصرفي_للرواتب_${month}.${format}`, { bookType: format });
    const skipped = rows.length - bankRows.length;
    if (skipped)
      toast.warning(`تم التصدير، واستُبعد ${skipped} موظف لعدم تسجيل حساب مصرفي أو رقم دفع`);
    else toast.success("تم تنزيل كشف الصرف المصرفي");
  };
  const printCashVouchers = () => {
    if (!cashRows.length) {
      toast.error("لا توجد عمالة يومية أو عقود نقدية في كشف هذا الشهر");
      return;
    }
    const printWindow = window.open("about:blank", "_blank", "width=1100,height=850");
    if (!printWindow) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة قسائم الصرف");
      return;
    }
    const voucher = (row: (typeof cashRows)[number]) => {
      const branch = row.employee.sites?.name || row.employee.departments?.name || "—";
      const gross = roundMoney(row.payroll.grossPay + row.additions);
      const net = roundMoney(row.total);
      const deductionRows = row.penalties.filter((penalty) => Number(penalty.deduction_amount) > 0).map((penalty) => `<tr><th>${escapeHtml(penalty.notes || "استقطاع")} · ${escapeHtml(penalty.penalty_date)}</th><td>${money(Number(penalty.deduction_amount))}</td></tr>`).join("");
      return `<article class="voucher"><header class="voucher-head"><div><strong>قسيمة صرف نقدي</strong><span>منظومة زِكت · الرواتب</span></div><div class="voucher-month">${escapeHtml(month)}</div></header><section class="identity"><div><span>اسم العامل</span><b>${escapeHtml(row.employee.full_name)}</b></div><div><span>رقم القيد</span><b>${escapeHtml(row.employee.employee_no)}</b></div><div><span>الموقع / القسم</span><b>${escapeHtml(branch)}</b></div><div><span>شهر الصرف</span><b>${escapeHtml(month)}</b></div></section><section class="attendance"><div><span>أيام الحضور</span><b>${row.summary.presentDays} يوم</b></div><div><span>ساعات الإضافي</span><b>${roundMoney(row.payroll.overtimeHours)} ساعة</b></div></section><table><tbody><tr><th>إجمالي الأجر</th><td>${money(gross)}</td></tr>${deductionRows}<tr><th>إجمالي الخصومات والاستقطاعات</th><td>${money(row.deductions)}</td></tr><tr class="net"><th>صافي المستلم رقمًا</th><td>${money(net)}</td></tr></tbody></table><div class="amount-words"><span>المبلغ كتابةً</span><b>${escapeHtml(amountInArabicIqd(net))}</b></div><footer class="signatures"><div>توقيع / بصمة العامل</div><div>أمين الصندوق</div><div>المحاسب</div></footer></article>`;
    };
    const pages: (typeof cashRows)[] = [];
    for (let index = 0; index < cashRows.length; index += 3)
      pages.push(cashRows.slice(index, index + 3));
    const pageMarkup = pages
      .map(
        (page) =>
          `<section class="voucher-page">${page.map(voucher).join("")}${Array.from({ length: 3 - page.length }, () => '<article class="voucher voucher-empty" aria-hidden="true"></article>').join("")}</section>`,
      )
      .join("");
    printWindow.document
      .write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قسائم الصرف النقدي - ${escapeHtml(month)}</title><style>
      @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;font-family:Arial,"Tahoma",sans-serif;color:#17202a;background:#fff}body{direction:rtl}.voucher-page{height:281mm;display:grid;grid-template-rows:repeat(3,minmax(0,1fr));gap:4mm;page-break-after:always;break-after:page}.voucher-page:last-child{page-break-after:auto;break-after:auto}.voucher{min-height:0;overflow:hidden;border:1px dashed #718096;border-radius:3mm;padding:4mm 5mm;display:flex;flex-direction:column;break-inside:avoid;page-break-inside:avoid}.voucher-empty{visibility:hidden}.voucher-head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0f766e;padding-bottom:2mm}.voucher-head strong{display:block;font-size:15px;color:#0f766e}.voucher-head span{display:block;margin-top:1mm;font-size:9px;color:#64748b}.voucher-month{font-size:11px;font-weight:bold;border:1px solid #cbd5e1;border-radius:2mm;padding:2mm 3mm}.identity{display:grid;grid-template-columns:1.5fr .75fr 1.3fr .75fr;gap:2mm;margin:3mm 0}.identity div,.attendance div{min-width:0;border:1px solid #e2e8f0;border-radius:2mm;padding:2mm}.identity span,.attendance span,.amount-words span{display:block;margin-bottom:1mm;font-size:8px;color:#64748b}.identity b,.attendance b{display:block;font-size:10px;overflow-wrap:anywhere}.attendance{display:grid;grid-template-columns:1fr 1fr;gap:2mm;margin-bottom:2mm}.voucher table{width:100%;border-collapse:collapse;font-size:9px}.voucher th,.voucher td{border:1px solid #cbd5e1;padding:1.5mm 2mm;text-align:right}.voucher th{width:60%;background:#f1f5f9}.voucher .net th,.voucher .net td{font-weight:bold;background:#ecfdf5;color:#065f46}.amount-words{margin-top:2mm;padding:2mm;border-right:2px solid #0f766e;background:#f8fafc}.amount-words b{display:block;font-size:9px;line-height:1.5}.signatures{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:3mm;margin-top:auto;padding-top:4mm}.signatures div{height:15mm;border-top:1px solid #475569;padding-top:1.5mm;text-align:center;font-size:8px;color:#475569}@media print{html,body{height:auto;overflow:visible!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.voucher-page{margin:0}.voucher{box-shadow:none}.voucher-empty{visibility:hidden}}
      </style></head><body>${pageMarkup}<script>window.onload=()=>{window.focus();window.print()}</script></body></html>`);
    printWindow.document.close();
  };
  const printSlip = (row: (typeof rows)[number]) => {
    const html = buildPayrollSlipHtml(row, month);
    const printWindow = window.open("about:blank", "_blank", "width=520,height=760");
    if (!printWindow) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة القصاصة");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.setTimeout(() => printWindow.print(), 300);
  };
  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3">
            <Banknote className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">الرواتب</h1>
            <p className="text-muted-foreground">تقارير الرواتب والحضور والاستحقاقات الشهرية</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href="/vehicles">
              <Truck className="ml-2 h-4 w-4" /> إدارة المركبات
            </a>
          </Button>
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`ml-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /> تحديث
          </Button>
          <Button onClick={() => exportExcel()} disabled={!filteredRows.length || query.isLoading}>
            <Download className="ml-2 h-4 w-4" /> تصدير Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => exportBankPayroll("xlsx")}
            disabled={query.isLoading}
          >
            <Download className="ml-2 h-4 w-4" /> كشف مصرفي Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => exportBankPayroll("csv")}
            disabled={query.isLoading}
          >
            <Download className="ml-2 h-4 w-4" /> كشف مصرفي CSV
          </Button>
          <Button
            variant="outline"
            onClick={printCashVouchers}
            disabled={!cashRows.length || query.isLoading}
          >
            <Printer className="ml-2 h-4 w-4" /> طباعة قسائم الصرف النقدية
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>دورة راتب {month}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              الحالة: {({ draft: "مسودة", review: "قيد المراجعة", approved: "معتمد", paid: "مصروف" } as Record<string, string>)[payrollRun?.status ?? "draft"]}
              {payrollRun?.payment_method ? ` · طريقة الصرف: ${payrollRun.payment_method === "bank" ? "تحويل مصرفي" : "نقدًا"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={advancePaymentMethod} onValueChange={setAdvancePaymentMethod}>
              <SelectTrigger className="w-40"><SelectValue placeholder="طريقة الصرف" /></SelectTrigger>
              <SelectContent><SelectItem value="cash">نقدًا</SelectItem><SelectItem value="bank">تحويل مصرفي</SelectItem></SelectContent>
            </Select>
            {isPayrollOperator && !isLocked && <>
              <Button variant="outline" disabled={savePayrollRun.isPending || query.isLoading} onClick={() => savePayrollRun.mutate("draft")}>حفظ المسودة</Button>
              <Button disabled={savePayrollRun.isPending || query.isLoading || !rows.length} onClick={() => savePayrollRun.mutate("review")}>إرسال للمراجعة</Button>
            </>}
            {isCeo && payrollRun?.status === "review" && <Button disabled={savePayrollRun.isPending} onClick={() => savePayrollRun.mutate("approve")}>اعتماد المسير</Button>}
            {isPayrollOperator && payrollRun?.status === "approved" && <Button disabled={savePayrollRun.isPending} onClick={() => savePayrollRun.mutate("pay")}>تأكيد صرف الرواتب</Button>}
            <Badge variant="secondary">الإجمالي الصافي: {money(total)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_2fr]">
          <form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-1" onSubmit={(event) => {
            event.preventDefault();
            if (payrollRun && payrollRun.status !== "draft") { toast.error("لا يمكن إضافة سلفة بعد بدء مراجعة المسير"); return; }
            createAdvance.mutate(new FormData(event.currentTarget));
            event.currentTarget.reset(); setAdvanceEmployeeId("");
          }}>
            <h3 className="font-semibold sm:col-span-2 lg:col-span-1">تسجيل سلفة وجدولة أقساط</h3>
            <Select value={advanceEmployeeId} onValueChange={setAdvanceEmployeeId}>
              <SelectTrigger className="sm:col-span-2 lg:col-span-1"><SelectValue placeholder="اختر الموظف" /></SelectTrigger>
              <SelectContent>{(query.data?.employees ?? []).map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.employee_no} — {employee.full_name}</SelectItem>)}</SelectContent>
            </Select>
            <Input name="amount" type="number" min="1" step="0.01" placeholder="مبلغ السلفة بالدينار" required />
            <Input name="installment_amount" type="number" min="1" step="0.01" placeholder="مبلغ القسط الشهري" required />
            <Input name="first_month" type="month" defaultValue={month} required />
            <Input name="purpose" placeholder="سبب السلفة (اختياري)" />
            <Button type="submit" disabled={!isPayrollOperator || createAdvance.isPending || isLocked} className="sm:col-span-2 lg:col-span-1">تسجيل السلفة</Button>
          </form>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b bg-muted/40 text-right"><th className="p-3">الموظف</th><th className="p-3">القسط المستحق هذا الشهر</th><th className="p-3">الصافي بعد الخصم</th></tr></thead>
              <tbody>{rows.filter((row) => row.advanceDeduction > 0).map((row) => <tr key={row.employee.id} className="border-b"><td className="p-3">{row.employee.full_name}</td><td className="p-3">{money(row.advanceDeduction)}</td><td className="p-3">{money(row.total)}</td></tr>)}
                {!rows.some((row) => row.advanceDeduction > 0) && <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">لا توجد أقساط سلف مستحقة لهذا الشهر.</td></tr>}
              </tbody>
            </table>
          </div>
          {payrollRun?.payment_reference && <p className="text-sm text-muted-foreground lg:col-span-2">مرجع الصرف: {payrollRun.payment_reference}</p>}
        </CardContent>
      </Card>
      <Tabs defaultValue="employees" dir="rtl" className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent sm:grid-cols-3">
          <TabsTrigger value="employees" className="min-h-11 rounded-xl border bg-card">
            رواتب الموظفين
          </TabsTrigger>
          <TabsTrigger value="light-vehicles" className="min-h-11 rounded-xl border bg-card">
            رواتب المركبات الخفيفة
          </TabsTrigger>
          <TabsTrigger value="heavy-vehicles" className="min-h-11 rounded-xl border bg-card">
            رواتب المركبات الثقيلة
          </TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <Label htmlFor="payroll-month">شهر الراتب</Label>
                <Input
                  id="payroll-month"
                  type="month"
                  value={month}
                  onChange={(e) => { setMonth(e.target.value); setPage(1); }}
                  className="mt-2 max-w-xs"
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex h-full items-center justify-between p-4">
                <div>
                  <p className="text-sm text-muted-foreground">صافي رواتب الموظفين</p>
                  <p className="mt-1 text-2xl font-bold">{money(total)}</p>
                </div>
                <Badge variant="secondary">{query.data?.employeeCount ?? 0} موظف</Badge>
              </CardContent>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader className="gap-3 border-b bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>تقرير رواتب الموظفين</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  يشمل احتساب الحضور والراحة والعطل والإضافي والإضافات والاستقطاعات.
                  {` · ${query.data?.employeeCount ?? 0} موظفًا`}
                  {query.data?.employeeCount && rows.length > bankRows.length
                    ? ` · بعض نتائج البنك تخص الصفحة الحالية فقط`
                    : ""}
                </p>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="ابحث بالاسم أو الرقم"
                  className="pr-9"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {query.isError ? (
                <div className="p-8 text-center text-destructive">
                  تعذر تحميل تقرير الرواتب: {(query.error as Error).message}
                </div>
              ) : query.isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  جارٍ تحميل بيانات الرواتب…
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-right">
                        <th className="p-3">الموظف</th>
                        <th className="p-3">الحضور</th>
                        <th className="p-3">الإجازات</th>
                        <th className="p-3">الأجر الأساسي</th>
                        <th className="p-3">الإضافي</th>
                        <th className="p-3">الإضافات</th>
                        <th className="p-3">الاستقطاعات</th>
                        <th className="p-3">الصافي</th>
                        <th className="p-3">القصاصة</th>
                      </tr>
                    </thead>
                    <tbody>
                  {visibleRows.map((row) => (
                        <tr
                          key={row.employee.id}
                          className="border-b transition-colors hover:bg-muted/20"
                        >
                          <td className="p-3">
                            <b>{row.employee.full_name}</b>
                            <div className="text-xs text-muted-foreground">
                              {row.employee.employee_no} ·{" "}
                              {row.payType === "daily" ? "يومي" : "شهري"}
                            </div>
                          </td>
                          <td className="p-3">
                            {row.summary.presentDays} يوم{" "}
                            <div className="text-xs text-muted-foreground">
                              {row.payroll.overtimeHours} س إضافي
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="block">مدفوعة: {row.payroll.leaveDays}</span>
                            <span className="text-xs text-muted-foreground">بدون راتب: {row.payroll.unpaidLeaveDays}</span>
                          </td>
                          <td className="p-3">{money(row.payroll.basePay)}</td>
                          <td className="p-3">{money(row.payroll.overtimePay)}</td>
                          <td className="p-3 text-emerald-700">{money(row.additions)}</td>
                          <td className="p-3 text-red-600">{money(row.deductions)}</td>
                          <td className="p-3 font-bold">{money(row.total)}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => setPreviewRow(row)}>
                                <Eye className="ml-2 h-4 w-4" /> عرض القصاصة
                              </Button>
                            <Button size="sm" variant="outline" onClick={() => printSlip(row)}>
                              <Printer className="ml-2 h-4 w-4" /> طباعة
                            </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredRows.length && (
                    <p className="py-10 text-center text-muted-foreground">
                      لا توجد بيانات مطابقة.
                    </p>
                  )}
                  {(query.data?.employeeCount ?? 0) > pageSize && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                      <p className="text-sm text-muted-foreground">
                        عرض {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, query.data?.employeeCount ?? 0)} من {query.data?.employeeCount ?? 0} موظفًا
                      </p>
                      <Pagination className="mx-0 w-auto">
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              href="#"
                              aria-disabled={page === 1}
                              className={page === 1 ? "pointer-events-none opacity-50" : ""}
                              onClick={(event) => { event.preventDefault(); setPage((current) => Math.max(1, current - 1)); }}
                            />
                          </PaginationItem>
                          <PaginationItem>
                            <PaginationLink href="#" isActive onClick={(event) => event.preventDefault()}>
                              {page} / {pageCount}
                            </PaginationLink>
                          </PaginationItem>
                          <PaginationItem>
                            <PaginationNext
                              href="#"
                              aria-disabled={page >= pageCount}
                              className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
                              onClick={(event) => { event.preventDefault(); setPage((current) => Math.min(pageCount, current + 1)); }}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {(["light", "heavy"] as const).map((kind) => {
          const vehicles = vehicleRows(kind);
          const vehicleTotal = vehicles.reduce((sum, row) => sum + row.total, 0);
          return (
            <TabsContent
              key={kind}
              value={kind === "light" ? "light-vehicles" : "heavy-vehicles"}
              className="space-y-5"
            >
              <div className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-semibold">
                    رواتب المركبات {kind === "light" ? "الخفيفة" : "الثقيلة"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    الاستحقاق = أيام التشغيل × الأجر اليومي · شهر {month}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{vehicles.length} مركبة</Badge>
                  <Button onClick={() => exportExcel(kind)} disabled={!vehicles.length}>
                    <Download className="ml-2 h-4 w-4" /> تصدير Excel
                  </Button>
                </div>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>إجمالي المستحق: {money(vehicleTotal)}</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-right">
                        <th className="p-3">المركبة</th>
                        <th className="p-3">أيام التشغيل</th>
                        <th className="p-3">الأجر اليومي</th>
                        <th className="p-3">المستحق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.map(({ vehicle, operatingDays, total: net }) => (
                        <tr key={vehicle.id} className="border-b">
                          <td className="p-3">
                            <b>{vehicle.name}</b>
                            <div className="text-xs text-muted-foreground">
                              {vehicle.vehicle_no}
                            </div>
                          </td>
                          <td className="p-3">{operatingDays} يوم</td>
                          <td className="p-3">{money(Number(vehicle.daily_rate))}</td>
                          <td className="p-3 font-bold">{money(net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!vehicles.length && (
                    <p className="p-8 text-center text-muted-foreground">
                      لا توجد مركبات مسجلة في هذا التصنيف.{" "}
                      <a className="text-primary underline" href="/vehicles">
                        إدارة المركبات
                      </a>
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
      <Dialog open={previewRow !== null} onOpenChange={(open) => !open && setPreviewRow(null)}>
        <DialogContent dir="rtl" className="max-h-[95vh] w-[calc(100vw-2rem)] max-w-[680px] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>قصاصة راتب — {previewRow?.employee.full_name}</DialogTitle>
          </DialogHeader>
          {previewRow && (
            <div className="max-h-[78vh] w-full overflow-auto rounded-lg bg-slate-100 p-3 sm:p-5">
              <PayrollSlipPreview row={previewRow} month={month} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


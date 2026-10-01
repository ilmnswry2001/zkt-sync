import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Banknote, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { printReport, escapeHtml } from "@/lib/report-print";
import {
  buildAttendanceDays,
  calculatePayroll,
  monthDates,
  summarizeDays,
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
    if (!roles?.some((r) => r.role === "admin" || r.role === "hr"))
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
  wage_rates: {
    monthly_rate: number | null;
    daily_rate: number | null;
    overtime_hour_rate: number | null;
    currency: string;
  } | null;
  shifts: { end_time: string | null; grace_minutes: number | null } | null;
};
type Addition = { employee_id: string; amount: number; kind: string };
type Penalty = { employee_id: string | null; deduction_amount: number };
type AttendanceLog = { employee_no: string; verify_time: string };

function PayrollPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const nextMonth = useMemo(() => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 10);
  }, [month]);
  const query = useQuery({
    queryKey: ["payroll", month],
    queryFn: async () => {
      const [
        { data: employees, error: employeesError },
        { data: additions, error: additionsError },
        { data: penalties, error: penaltiesError },
        { data: logs, error: logsError },
      ] = await Promise.all([
        supabase
          .from("employees")
          .select(
            "id, employee_no, full_name, base_salary, pay_type, wage_rates(monthly_rate, daily_rate, overtime_hour_rate, currency), shifts(end_time, grace_minutes)",
          )
          .order("employee_no")
          .limit(2000),
        supabase
          .from("salary_additions")
          .select("employee_id, amount, kind")
          .eq("month", `${month}-01`),
        supabase
          .from("employee_penalties")
          .select("employee_id, deduction_amount")
          .gte("penalty_date", `${month}-01`)
          .lt("penalty_date", nextMonth),
        supabase
          .from("attendance_logs")
          .select("employee_no, verify_time")
          .gte("verify_time", `${month}-01T00:00:00Z`)
          .lt("verify_time", `${nextMonth}T00:00:00Z`)
          .order("verify_time"),
      ]);
      if (employeesError) throw employeesError;
      if (additionsError) throw additionsError;
      if (penaltiesError) throw penaltiesError;
      if (logsError) throw logsError;
      return {
        employees: (employees ?? []) as Employee[],
        additions: (additions ?? []) as Addition[],
        penalties: (penalties ?? []) as Penalty[],
        logs: (logs ?? []) as AttendanceLog[],
      };
    },
  });
  const rows = useMemo(
    () =>
      (query.data?.employees ?? []).map((employee) => {
        const payType = employee.pay_type === "daily" ? "daily" : "monthly";
        const days = buildAttendanceDays(
          monthDates(month),
          (query.data?.logs ?? []).filter((log) => log.employee_no === employee.employee_no),
          [],
          employee.shifts?.end_time,
          new Date().toISOString().slice(0, 10),
          payType,
          employee.shifts?.grace_minutes ?? 0,
        );
        const summary = summarizeDays(days);
        const monthlySalary = Number(
          employee.base_salary ?? employee.wage_rates?.monthly_rate ?? 0,
        );
        const dailyRate = Number(
          employee.wage_rates?.daily_rate ?? (monthlySalary ? monthlySalary / 26 : 0),
        );
        const payroll = calculatePayroll({
          payType,
          monthlySalary,
          dailyRate,
          daysInMonth: days.length,
          summary,
        });
        const gross = payroll.basePay;
        const additions = (query.data?.additions ?? [])
          .filter((item) => item.employee_id === employee.id)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const deductions = (query.data?.penalties ?? [])
          .filter((item) => item.employee_id === employee.id)
          .reduce((sum, item) => sum + Number(item.deduction_amount || 0), 0);
        return { employee, gross, additions, deductions, total: gross + additions - deductions };
      }),
    [query.data],
  );
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const printSlip = (row: (typeof rows)[number]) => {
    const body = `<div class="meta"><b>الموظف:</b> ${escapeHtml(row.employee.full_name)}<br/><b>الرقم:</b> ${escapeHtml(row.employee.employee_no)}<br/><b>الشهر:</b> ${escapeHtml(month)}</div><table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>الراتب الإجمالي</td><td>${row.gross.toLocaleString()} د.ع</td></tr><tr><td>الإضافات والمكافآت</td><td>${row.additions.toLocaleString()} د.ع</td></tr><tr><td>الاستقطاعات</td><td>${row.deductions.toLocaleString()} د.ع</td></tr><tr class="total"><td>الصافي المستحق</td><td>${row.total.toLocaleString()} د.ع</td></tr></table>`;
    if (!printReport(`قصاصة راتب — ${row.employee.full_name}`, body))
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
  };
  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <Banknote className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">الرواتب</h1>
            <p className="text-muted-foreground">التقرير المالي الشهري وقصاصة راتب الموظف</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => query.refetch()}>
          <RefreshCw className="ml-2 h-4 w-4" /> تحديث
        </Button>
      </div>
      <Card>
        <CardContent className="p-4">
          <Label htmlFor="payroll-month">شهر الراتب</Label>
          <Input
            id="payroll-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 max-w-xs"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>إجمالي رواتب الشركة: {total.toLocaleString()} د.ع</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead>
              <tr className="border-b bg-muted/60 text-right">
                <th className="p-3">الموظف</th>
                <th className="p-3">الراتب الإجمالي</th>
                <th className="p-3">الإضافات</th>
                <th className="p-3">الاستقطاعات</th>
                <th className="p-3">الصافي</th>
                <th className="p-3">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employee.id} className="border-b">
                  <td className="p-3">
                    <b>{row.employee.full_name}</b>
                    <div className="text-xs text-muted-foreground">{row.employee.employee_no}</div>
                  </td>
                  <td className="p-3">{row.gross.toLocaleString()} د.ع</td>
                  <td className="p-3 text-emerald-700">{row.additions.toLocaleString()} د.ع</td>
                  <td className="p-3 text-red-600">{row.deductions.toLocaleString()} د.ع</td>
                  <td className="p-3 font-bold">{row.total.toLocaleString()} د.ع</td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" onClick={() => printSlip(row)}>
                      <Printer className="ml-2 h-4 w-4" /> طباعة القصاصة
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="py-8 text-center text-muted-foreground">لا توجد بيانات رواتب.</p>
          )}
          <Badge className="mt-4">عدد الموظفين: {rows.length}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

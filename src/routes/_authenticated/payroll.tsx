import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Banknote, Download, Printer, RefreshCw, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { printReport, escapeHtml } from "@/lib/report-print";
import { amountInArabicIqd } from "@/lib/arabic-currency";
import { currentMonthInBaghdad, monthInstantRangeInBaghdad, todayInBaghdad } from "@/lib/date-time";
import {
  buildAttendanceDays,
  calculatePayroll,
  loadAllRows,
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
  salary_type?: string | null;
  contract_type?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  iban?: string | null;
  sites?: { name: string } | null;
  departments?: { name: string } | null;
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
type AttendanceOverride = {
  employee_id: string;
  work_date: string;
  status: "present" | "absent" | "leave" | "holiday" | "rest";
  notes: string | null;
  overtime_hours: number | null;
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

function PayrollPage() {
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [search, setSearch] = useState("");
  const nextMonth = useMemo(() => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 10);
  }, [month]);
  const query = useQuery({
    queryKey: ["payroll", month],
    queryFn: async () => {
      const attendanceRange = monthInstantRangeInBaghdad(month);
      const [employees, additions, penalties, logs, overrides, vehicles, vehicleOperations] =
        await Promise.all([
          loadAllRows((from, to) =>
            supabase
              .from("employees")
              .select(
                "id, employee_no, full_name, base_salary, pay_type, salary_type, contract_type, bank_name, bank_account, iban, sites!employees_site_id_fkey(name), departments!employees_department_id_fkey(name), wage_rates(monthly_rate, daily_rate, overtime_hour_rate, currency), shifts(end_time, grace_minutes)",
              )
              .order("employee_no")
              .order("id")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            supabase
              .from("salary_additions")
              .select("employee_id, amount, kind")
              .eq("month", `${month}-01`)
              .order("id")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            supabase
              .from("employee_penalties")
              .select("employee_id, deduction_amount")
              .gte("penalty_date", `${month}-01`)
              .lt("penalty_date", nextMonth)
              .order("id")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            supabase
              .from("attendance_logs")
              .select("employee_no, verify_time")
              .gte("verify_time", attendanceRange.start)
              .lt("verify_time", attendanceRange.end)
              .order("verify_time")
              .order("id")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            supabase
              .from("attendance_day_status")
              .select("employee_id, work_date, status, notes, overtime_hours")
              .gte("work_date", `${month}-01`)
              .lt("work_date", nextMonth)
              .order("employee_id")
              .order("work_date")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            (supabase as any)
              .from("vehicles")
              .select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active")
              .eq("is_active", true)
              .order("vehicle_no")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            (supabase as any)
              .from("vehicle_monthly_operations")
              .select("vehicle_id, operating_days")
              .eq("month", `${month}-01`)
              .order("vehicle_id")
              .range(from, to),
          ),
        ]);
      return {
        employees: employees as Employee[],
        additions: additions as Addition[],
        penalties: penalties as Penalty[],
        logs: logs as AttendanceLog[],
        overrides: overrides as AttendanceOverride[],
        vehicles: vehicles as Vehicle[],
        vehicleOperations: vehicleOperations as VehicleOperation[],
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
          (query.data?.overrides ?? []).filter((item) => item.employee_id === employee.id),
          employee.shifts?.end_time,
          todayInBaghdad(),
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
        const additions = (query.data?.additions ?? [])
          .filter((item) => item.employee_id === employee.id)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const deductions = (query.data?.penalties ?? [])
          .filter((item) => item.employee_id === employee.id)
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
        const total = payroll.netPay;
        return { employee, payroll, summary, additions, deductions, total };
      }),
    [query.data, month],
  );
  const filteredRows = rows.filter((row) =>
    `${row.employee.full_name} ${row.employee.employee_no}`
      .toLocaleLowerCase("ar")
      .includes(search.trim().toLocaleLowerCase("ar")),
  );
  const bankRows = rows.filter(
    (row) => row.employee.bank_account?.trim() || row.employee.iban?.trim(),
  );
  const cashRows = rows.filter(
    ({ employee }) =>
      employee.pay_type === "daily" ||
      [employee.salary_type, employee.contract_type].some((value) => /نقد|cash/i.test(value ?? "")),
  );
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const money = (value: number) =>
    `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} د.ع`;
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
        "نوع الأجر": employee.pay_type === "daily" ? "يومي" : "شهري",
        "أيام الحضور": summary.presentDays,
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
      ...Array(9).fill({ wch: 20 }),
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, "رواتب الموظفين");
    XLSX.writeFile(workbook, `رواتب_الموظفين_${month}.xlsx`);
  };
  const printSlip = (row: (typeof rows)[number]) => {
    const body = `<div class="meta"><b>الموظف:</b> ${escapeHtml(row.employee.full_name)}<br/><b>الرقم:</b> ${escapeHtml(row.employee.employee_no)}<br/><b>الشهر:</b> ${escapeHtml(month)}</div><table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>الأجر الأساسي</td><td>${money(row.payroll.basePay)}</td></tr><tr><td>بدل الساعات الإضافية (${row.payroll.overtimeHours})</td><td>${money(row.payroll.overtimePay)}</td></tr><tr><td>الإضافات والمكافآت</td><td>${money(row.additions)}</td></tr><tr><td>الاستقطاعات</td><td>${money(row.deductions)}</td></tr><tr class="total"><td>الصافي المستحق</td><td>${money(row.total)}</td></tr></table>`;
    if (!printReport(`قصاصة راتب — ${row.employee.full_name}`, body))
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
  };
  const exportCsv = () => {
    const header = [
      "رقم الموظف",
      "اسم الموظف",
      "نوع الأجر",
      "أيام الحضور",
      "أيام الجمعة",
      "الأجر الأساسي",
      "الإضافي",
      "الإضافات",
      "الاستقطاعات",
      "صافي الراتب",
    ];
    const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const content =
      "\uFEFF" +
      [
        header,
        ...filteredRows.map(({ employee, payroll, summary, additions, deductions, total: net }) => [
          employee.employee_no,
          employee.full_name,
          employee.pay_type === "daily" ? "يومي" : "شهري",
          summary.presentDays,
          payroll.woDays,
          payroll.basePay,
          payroll.overtimePay,
          additions,
          deductions,
          net,
        ]),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `رواتب_الموظفين_${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    const incomplete = filteredRows.filter((row) => {
      const employee = row.employee as Employee & {
        bank_account?: string | null;
        iban?: string | null;
      };
      return !employee.bank_account && !employee.iban;
    }).length;
    toast.success(
      `تم تصدير الكشف بصيغة CSV${incomplete ? ` — تنبيه: ${incomplete} موظف يحتاج بيانات مصرفية` : ""}`,
    );
  };
  const printCashVouchers = () => {
    const vouchers = cashRows
      .map(
        ({ employee, payroll, total: net }) =>
          `<section class="voucher"><h2>قسيمة صرف نقدية</h2><p><b>الموظف:</b> ${escapeHtml(employee.full_name)} — <b>الرقم:</b> ${escapeHtml(employee.employee_no)}</p><p><b>الشهر:</b> ${escapeHtml(month)}</p><table><tr><th>الأجر الأساسي</th><td>${money(payroll.basePay)}</td></tr><tr><th>الساعات الإضافية</th><td>${money(payroll.overtimePay)}</td></tr><tr><th>الإضافات والخصومات</th><td>${money(payroll.additions - payroll.deductions)}</td></tr><tr><th>الصافي</th><td>${money(net)}</td></tr></table><p><b>المبلغ كتابةً:</b> ${escapeHtml(amountInArabicIqd(net))}</p><div class="sign">المستلم: ________________ &nbsp;&nbsp; المحاسب: ________________</div></section>`,
      )
      .join("");
    if (!vouchers) return toast.error("لا توجد بيانات للطباعة");
    if (
      !printReport(
        `قسائم الصرف — ${month}`,
        `<style>.voucher{height:30%;box-sizing:border-box;border:1px solid #999;padding:16px;margin-bottom:12px;page-break-inside:avoid}.voucher h2{text-align:center}.voucher table{width:100%;border-collapse:collapse}.voucher th,.voucher td{border:1px solid #bbb;padding:6px;text-align:right}.sign{margin-top:28px}</style>${vouchers}`,
      )
    )
      toast.error("تعذر فتح الطباعة");
  };
  const exportBankPayroll = (format: "xlsx" | "csv") => {
    if (!bankRows.length) return toast.error("لا توجد حسابات مصرفية أو أرقام دفع مسجلة للموظفين");
    const sheetRows = bankRows.map(({ employee, total: net }) => ({
      "اسم الموظف الكامل": employee.full_name,
      "رقم الموظف": employee.employee_no,
      الفرع: employee.sites?.name || employee.departments?.name || "",
      المصرف: employee.bank_name || "",
      "رقم الحساب / بطاقة الدفع": employee.bank_account || "",
      IBAN: employee.iban || "",
      "صافي المستحق": net,
      العملة: "IQD",
    }));
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "كشف الصرف المصرفي");
    XLSX.writeFile(workbook, `كشف_مصرفي_للرواتب_${month}.${format}`, { bookType: format });
    toast.success("تم تنزيل كشف الصرف المصرفي");
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
        <div className="flex gap-2">
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
            onClick={exportCsv}
            disabled={!filteredRows.length || query.isLoading}
          >
            <Download className="ml-2 h-4 w-4" /> CSV
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
            disabled={!filteredRows.length || query.isLoading}
          >
            <Printer className="ml-2 h-4 w-4" /> قسائم الصرف
          </Button>
        </div>
      </div>
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
                  onChange={(e) => setMonth(e.target.value)}
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
                <Badge variant="secondary">{rows.length} موظف</Badge>
              </CardContent>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHeader className="gap-3 border-b bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>تقرير رواتب الموظفين</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  يشمل احتساب الحضور والراحة والعطل والإضافي والإضافات والاستقطاعات.
                </p>
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
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
                        <th className="p-3">الأجر الأساسي</th>
                        <th className="p-3">الإضافي</th>
                        <th className="p-3">الإضافات</th>
                        <th className="p-3">الاستقطاعات</th>
                        <th className="p-3">الصافي</th>
                        <th className="p-3">القصاصة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => (
                        <tr
                          key={row.employee.id}
                          className="border-b transition-colors hover:bg-muted/20"
                        >
                          <td className="p-3">
                            <b>{row.employee.full_name}</b>
                            <div className="text-xs text-muted-foreground">
                              {row.employee.employee_no} ·{" "}
                              {row.employee.pay_type === "daily" ? "يومي" : "شهري"}
                            </div>
                          </td>
                          <td className="p-3">
                            {row.summary.presentDays} يوم{" "}
                            <div className="text-xs text-muted-foreground">
                              {row.payroll.overtimeHours} س إضافي
                            </div>
                          </td>
                          <td className="p-3">{money(row.payroll.basePay)}</td>
                          <td className="p-3">{money(row.payroll.overtimePay)}</td>
                          <td className="p-3 text-emerald-700">{money(row.additions)}</td>
                          <td className="p-3 text-red-600">{money(row.deductions)}</td>
                          <td className="p-3 font-bold">{money(row.total)}</td>
                          <td className="p-3">
                            <Button size="sm" variant="outline" onClick={() => printSlip(row)}>
                              <Printer className="ml-2 h-4 w-4" /> طباعة
                            </Button>
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
    </div>
  );
}

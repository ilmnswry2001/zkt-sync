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
import { getEmployeePayType } from "@/lib/employee-pay-type";
import {
  buildAttendanceDays,
  calculatePayroll,
  loadAllRows,
  monthDates,
  roundMoney,
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
type ApprovedLeaveCalendarDay = { employee_id: string; work_date: string; is_paid: boolean; status: string };
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
      const [employees, additions, penalties, logs, overrides, vehicles, vehicleOperations, leaveCalendar] =
        await Promise.all([
          loadAllRows((from, to) =>
            supabase
              .from("employees")
              .select(
                "id, employee_no, full_name, position, base_salary, pay_type, salary_type, contract_type, bank_name, bank_account, iban, sites!employees_site_id_fkey(name), departments!employees_department_id_fkey(name), wage_rates(title, monthly_rate, daily_rate, overtime_hour_rate, currency), shifts(end_time, grace_minutes)",
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
              .select("id, employee_id, deduction_amount, penalty_date, notes")
              .gte("penalty_date", `${month}-01`)
              .lt("penalty_date", nextMonth)
              .order("id")
              .range(from, to),
          ),
          loadAllRows((from, to) =>
            supabase
              .from("attendance_logs")
              .select("employee_no, verify_time, status, source, self_event_type")
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
          loadAllRows((from, to) =>
            (supabase as any)
              .rpc("leave_calendar_month", {
                _year: Number(month.slice(0, 4)),
                _month: Number(month.slice(5, 7)),
              })
              .range(from, to),
          ),
        ]);
      const approvedLeaveDays = (leaveCalendar as ApprovedLeaveCalendarDay[])
        .filter((day) => ["pending_execution", "executed"].includes(day.status))
        .map((day): AttendanceOverride => ({
          employee_id: day.employee_id,
          work_date: day.work_date,
          status: "leave",
          notes: `إجازة ${day.is_paid ? "مدفوعة" : "بدون راتب"}`,
          overtime_hours: 0,
          is_paid: day.is_paid,
        }));
      return {
        employees: employees as Employee[],
        additions: additions as Addition[],
        penalties: penalties as Penalty[],
        logs: logs as AttendanceLog[],
        overrides: [...(overrides as AttendanceOverride[]), ...approvedLeaveDays],
        vehicles: vehicles as Vehicle[],
        vehicleOperations: vehicleOperations as VehicleOperation[],
      };
    },
  });
  const rows = useMemo(
    () =>
      (query.data?.employees ?? []).map((employee) => {
        const payType = getEmployeePayType(employee);
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
        const employeePenalties = (query.data?.penalties ?? [])
          .filter((item) => item.employee_id === employee.id);
        const deductions = employeePenalties
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
        return { employee, payType, payroll, summary, additions, deductions, penalties: employeePenalties, total };
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
  const cashRows = rows.filter(({ employee }) => {
    if (getEmployeePayType(employee) === "daily") return true;
    return [employee.salary_type, employee.contract_type].some((value) =>
      /نقد|cash/i.test(value ?? ""),
    );
  });
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
    const deductionRows = row.penalties.filter((penalty) => Number(penalty.deduction_amount) > 0).map((penalty) => `<tr><td>${escapeHtml(penalty.penalty_date)} · ${escapeHtml(penalty.notes || "استقطاع")}</td><td>${money(Number(penalty.deduction_amount))}</td></tr>`).join("");
    const body = `<div class="meta"><b>الموظف:</b> ${escapeHtml(row.employee.full_name)}<br/><b>الرقم:</b> ${escapeHtml(row.employee.employee_no)}<br/><b>الشهر:</b> ${escapeHtml(month)}<br/><b>إجازة مدفوعة:</b> ${row.payroll.leaveDays} يوم · <b>بدون راتب:</b> ${row.payroll.unpaidLeaveDays} يوم</div><table><tr><th>البند</th><th>المبلغ</th></tr><tr><td>الأجر الأساسي</td><td>${money(row.payroll.basePay)}</td></tr><tr><td>بدل الساعات الإضافية (${row.payroll.overtimeHours})</td><td>${money(row.payroll.overtimePay)}</td></tr><tr><td>الإضافات والمكافآت</td><td>${money(row.additions)}</td></tr>${deductionRows}<tr><td>إجمالي الاستقطاعات</td><td>${money(row.deductions)}</td></tr><tr class="total"><td>الصافي المستحق</td><td>${money(row.total)}</td></tr></table>`;
    if (!printReport(`قصاصة راتب — ${row.employee.full_name}`, body))
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
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
                  {rows.length > bankRows.length &&
                    ` · ${rows.length - bankRows.length} موظف دون بيانات دفع مصرفية`}
                  {` · ${cashRows.length} قسيمة نقدية/يومية`}
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
                      {filteredRows.map((row) => (
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


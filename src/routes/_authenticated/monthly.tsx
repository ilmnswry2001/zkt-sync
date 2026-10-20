import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  RefreshCw,
  Search,
  Truck,
  Download,
  Printer,
  Banknote,
  Cog,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getEmployeeMonthly, getMonthlySheet, setDayStatus } from "@/lib/reports.functions";
import { dailyTotals, type DayStatus } from "@/lib/monthly-report";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { printReport, escapeHtml } from "@/lib/report-print";

export const Route = createFileRoute("/_authenticated/monthly")({
  head: () => ({
    meta: [
      { title: "كشف الحضور الشهري" },
      {
        name: "description",
        content: "كشف حضور الموظفين حسب أيام الشهر مع فلاتر ورسم بياني وتعديل الحالات.",
      },
    ],
  }),
  component: MonthlyPage,
});

const statuses: { value: DayStatus; label: string; code: string; className: string }[] = [
  { value: "present", label: "حاضر", code: "P", className: "text-emerald-700 bg-emerald-50" },
  { value: "absent", label: "غائب", code: "A", className: "text-red-600 bg-red-50" },
  { value: "leave", label: "إجازة", code: "L", className: "text-blue-600 bg-blue-50" },
  { value: "holiday", label: "عطلة", code: "H", className: "text-amber-700 bg-amber-50" },
  { value: "rest", label: "راحة أسبوعية", code: "WO", className: "text-slate-600 bg-slate-100" },
];
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const summaryColumns = [
  { key: "presentDays", label: "حضور", className: "text-emerald-700" },
  { key: "absentDays", label: "غياب", className: "text-red-600" },
  { key: "leaveDays", label: "إجازة", className: "text-blue-600" },
  { key: "holidayDays", label: "عطلة / راحة", className: "" },
  { key: "fridayDays", label: "أيام الجمعة", className: "text-indigo-600" },
  { key: "totalHours", label: "الساعات", className: "" },
  { key: "totalOvertimeHours", label: "الإضافي", className: "" },
] as const;
type SheetRow = Awaited<ReturnType<typeof getMonthlySheet>>["rows"][number];
type EmployeeOption = Pick<
  SheetRow["employee"],
  | "id"
  | "employee_no"
  | "full_name"
  | "department_id"
  | "site_id"
  | "shift_id"
  | "departments"
  | "sites"
  | "shifts"
>;
type MonthlyVehicle = {
  id: string;
  vehicle_no: string;
  name: string;
  vehicle_class: "light" | "heavy";
  daily_rate: number;
  currency: string;
  is_active: boolean;
  operatingDays: number;
  operatingDates: string[];
  total: number;
};
type MonthlyMachinery = {
  id: string;
  code: string;
  asset_number: string | null;
  name: string;
  category: string | null;
  status: string;
  daily_rent: number;
  operatingDays: number;
  operatingDates: string[];
  total: number;
};
const weekday = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("ar", { weekday: "short", timeZone: "UTC" });
const formatTime = (time: string | null) =>
  time
    ? new Date(time).toLocaleTimeString("ar", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      })
    : "—";

function optionsFor(
  employees: EmployeeOption[],
  field: "departments" | "sites" | "shifts",
  idField: "department_id" | "site_id" | "shift_id",
) {
  const options = new Map<string, string>();
  for (const employee of employees) {
    const id = employee[idField];
    const name = employee[field]?.name;
    if (id && name) options.set(id, name);
  }
  return [...options].sort((a, b) => a[1].localeCompare(b[1], "ar"));
}

function MonthlyPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [site, setSite] = useState("");
  const [shift, setShift] = useState("");
  const [summarized, setSummarized] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{ employeeId: string; date: string } | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [machinerySearch, setMachinerySearch] = useState("");
  const [machineryPage, setMachineryPage] = useState(0);
  const [activeMachinery, setActiveMachinery] = useState<MonthlyMachinery | null>(null);
  const [machineryDatesDraft, setMachineryDatesDraft] = useState<string[]>([]);
  const fetchSheet = useServerFn(getMonthlySheet);
  const { data: allEmployees = [] } = useQuery<EmployeeOption[]>({
    queryKey: ["monthly", "employee-options"],
    queryFn: async () => {
      const employees: EmployeeOption[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: batch, error } = await (supabase as any)
          .from("employees")
          .select(
            "id, employee_no, full_name, department_id, site_id, shift_id, departments(name), sites!employees_site_id_fkey(name), shifts(name)",
          )
          .order("employee_no")
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        employees.push(...(batch ?? []));
        if (!batch || batch.length < 1000) return employees;
      }
    },
  });
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["monthly", "sheet", month, page, employeeId, department, site, shift, search],
    queryFn: () =>
      fetchSheet({
        data: {
      month,
      page,
      employee_id: employeeId || undefined,
      department_id: department || undefined,
      site_id: site || undefined,
      shift_id: shift || undefined,
      search,
        },
      }),
  });
  const vehicleReport = useQuery({
    queryKey: ["monthly", "vehicle-report", month],
    queryFn: async () => {
      const [{ data: vehicles, error: vehiclesError }, operationsResult] = await Promise.all([
        (supabase as any)
          .from("vehicles")
          .select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active")
          .order("vehicle_no"),
        (supabase as any)
          .from("vehicle_monthly_operations")
          .select("vehicle_id, operating_days, operating_dates")
          .eq("month", `${month}-01`),
      ]);
      let operations = operationsResult.data;
      let operationsError = operationsResult.error;
      if (operationsError && /operating_dates|column/i.test(operationsError.message)) {
        const fallback = await (supabase as any)
          .from("vehicle_monthly_operations")
          .select("vehicle_id, operating_days")
          .eq("month", `${month}-01`);
        operations = (fallback.data ?? []).map(
          (row: { vehicle_id: string; operating_days: number }) => ({
            ...row,
            operating_dates: [],
          }),
        );
        operationsError = fallback.error;
      }
      if (vehiclesError) throw vehiclesError;
      if (operationsError) throw operationsError;
      const operationByVehicle = new Map<string, { days: number; dates: string[] }>(
        (operations ?? []).map(
          (row: { vehicle_id: string; operating_days: number; operating_dates?: string[] }) => [
            row.vehicle_id,
            {
              days: Number(row.operating_days),
              dates: (row.operating_dates ?? []).map((date) => date.slice(0, 10)).sort(),
            },
          ],
        ),
      );
      return (
        (vehicles ?? []) as Omit<MonthlyVehicle, "operatingDays" | "operatingDates" | "total">[]
      ).map((vehicle) => {
        const operation = operationByVehicle.get(vehicle.id);
        const days = operation?.dates.length ? operation.dates.length : (operation?.days ?? 0);
        return {
          ...vehicle,
          operatingDays: days,
          operatingDates: operation?.dates ?? [],
          total: days * Number(vehicle.daily_rate),
        };
      });
    },
  });
  const vehicleRows = useMemo<MonthlyVehicle[]>(
    () =>
      ((vehicleReport.data ?? []) as MonthlyVehicle[]).filter((vehicle) =>
        `${vehicle.vehicle_no} ${vehicle.name}`
          .toLocaleLowerCase("ar")
          .includes(vehicleSearch.trim().toLocaleLowerCase("ar")),
      ),
    [vehicleReport.data, vehicleSearch],
  );
  const vehicleTotal = vehicleRows.reduce((sum, vehicle) => sum + vehicle.total, 0);
  const machineryReport = useQuery({
    queryKey: ["monthly", "machinery-report", month, machineryPage, machinerySearch],
    queryFn: async () => {
      let machineryQuery = (supabase as any)
        .from("machinery")
        .select("id, code, asset_number, name, category, status, daily_rent", { count: "exact" })
        .order("code")
        .range(machineryPage * 50, machineryPage * 50 + 49);
      const normalizedSearch = machinerySearch.trim().replace(/[(),]/g, " ");
      if (normalizedSearch) {
        machineryQuery = machineryQuery.or(
          `code.ilike.%${normalizedSearch}%,asset_number.ilike.%${normalizedSearch}%,name.ilike.%${normalizedSearch}%`,
        );
      }
      const { data: machinery, error: machineryError, count } = await machineryQuery;
      if (machineryError) throw machineryError;
      const machineryIds = (machinery ?? []).map((machine: { id: string }) => machine.id);
      let operations: { machinery_id: string; operating_days: number; operating_dates: string[] }[] = [];
      if (machineryIds.length) {
        const result = await (supabase as any)
        .from("machinery_monthly_operations")
        .select("machinery_id, operating_days, operating_dates")
        .eq("month", `${month}-01`)
        .in("machinery_id", machineryIds);
        if (result.error) throw result.error;
        operations = result.data ?? [];
      }
      const byMachinery = new Map<string, { days: number; dates: string[] }>(
        operations.map(
          (row: { machinery_id: string; operating_days: number; operating_dates: string[] }) => [
            row.machinery_id,
            {
              days: Number(row.operating_days),
              dates: (row.operating_dates ?? []).map((date) => date.slice(0, 10)).sort(),
            },
          ],
        ),
      );
      const rows = (
        (machinery ?? []) as Omit<
          MonthlyMachinery,
          "operatingDays" | "operatingDates" | "total"
        >[]
      ).map((machine) => {
        const operation = byMachinery.get(machine.id);
        const operatingDays = operation?.dates.length ?? operation?.days ?? 0;
        return {
          ...machine,
          operatingDays,
          operatingDates: operation?.dates ?? [],
          total: operatingDays * Number(machine.daily_rent ?? 0),
        };
      });
      return { rows, total: count ?? 0 };
    },
  });
  const machineryRows = machineryReport.data?.rows ?? [];
  const machineryCount = machineryReport.data?.total ?? 0;
  const machineryPageCount = Math.max(1, Math.ceil(machineryCount / 50));
  const machineryTotal = machineryRows.reduce((sum, machine) => sum + machine.total, 0);
  const saveMachineryAttendance = useMutation({
    mutationFn: async () => {
      if (!activeMachinery) return;
      const dates = [...new Set(machineryDatesDraft)].filter((date) => date.startsWith(`${month}-`)).sort();
      const { error } = await (supabase as any).from("machinery_monthly_operations").upsert(
        {
          machinery_id: activeMachinery.id,
          month: `${month}-01`,
          operating_days: dates.length,
          operating_dates: dates,
        },
        { onConflict: "machinery_id,month" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حفظ أيام تشغيل الآلية");
      setActiveMachinery(null);
      await qc.invalidateQueries({ queryKey: ["monthly", "machinery-report"] });
    },
    onError: (error: Error) => toast.error(`تعذر حفظ حضور الآلية: ${formatErrorMessage(error)}`),
  });
  const exportVehicleReport = () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      vehicleRows.map((vehicle) => ({
      "رقم المركبة": vehicle.vehicle_no,
        المركبة: vehicle.name,
        الفئة: vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة",
      "أيام التشغيل": vehicle.operatingDays,
      "تواريخ الحضور": vehicle.operatingDates.map((date) => Number(date.slice(8))).join("، "),
      "الأجر اليومي": Number(vehicle.daily_rate),
        العملة: vehicle.currency,
      "إجمالي المستحق": vehicle.total,
        الحالة: vehicle.is_active ? "نشطة" : "متوقفة",
      })),
    );
    sheet["!cols"] = [
      { wch: 18 },
      { wch: 26 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 },
      { wch: 12 },
      { wch: 22 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, "تقرير المركبات");
    XLSX.writeFile(workbook, `تقرير-المركبات-${month}.xlsx`);
  };
  const printVehicleReport = () => {
    const rowsMarkup = vehicleRows
      .map(
        (vehicle) =>
          `<tr><td>${escapeHtml(vehicle.vehicle_no)}</td><td>${escapeHtml(vehicle.name)}</td><td>${vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}</td><td>${vehicle.operatingDays}</td><td>${escapeHtml(vehicle.operatingDates.map((date) => Number(date.slice(8)).toLocaleString("ar")).join("، ") || "—")}</td><td>${Number(vehicle.daily_rate).toLocaleString("ar-IQ")}</td><td>${vehicle.total.toLocaleString("ar-IQ")}</td><td>${vehicle.is_active ? "نشطة" : "متوقفة"}</td></tr>`,
      )
      .join("");
    const body = `<p>الشهر: ${escapeHtml(month)} · عدد المركبات: ${vehicleRows.length} · إجمالي الاستحقاق: ${vehicleTotal.toLocaleString("ar-IQ")} د.ع</p><table><thead><tr><th>رقم المركبة</th><th>المركبة</th><th>الفئة</th><th>أيام الحضور</th><th>تواريخ الحضور</th><th>الأجر اليومي</th><th>المستحق</th><th>الحالة</th></tr></thead><tbody>${rowsMarkup}</tbody></table>`;
    if (!printReport(`التقرير الشهري للمركبات — ${month}`, body))
      toast.error("اسمح بالنوافذ المنبثقة لطباعة التقرير");
  };
  const filters = useMemo(
    () => ({
      departments: optionsFor(allEmployees, "departments", "department_id"),
      sites: optionsFor(allEmployees, "sites", "site_id"),
      shifts: optionsFor(allEmployees, "shifts", "shift_id"),
    }),
    [allEmployees],
  );
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const chart = useMemo(
    () => dailyTotals(data?.dates ?? [], rows, data?.today ?? ""),
    [data, rows],
  );
  const pageCount = Math.max(1, Math.ceil((data?.totalRows ?? 0) / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows;
  const employeeOptions = allEmployees.filter(
    (employee) =>
      !search.trim() ||
      `${employee.employee_no} ${employee.full_name}`
      .toLocaleLowerCase("ar")
      .includes(search.trim().toLocaleLowerCase("ar")),
  );
  const selectedEmployee = allEmployees.find((employee) => employee.id === employeeId);
  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="h-6 w-6 text-primary" /> كشف الحضور الشهري
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            حضور الموظفين يومًا بيوم · اضغط على حالة اليوم لعرض التفاصيل أو تعديلها
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => qc.invalidateQueries({ queryKey: ["monthly"] })}
        >
          <RefreshCw className={cn("ml-2 h-4 w-4", isFetching && "animate-spin")} /> تحديث التقرير
        </Button>
      </header>

      <Tabs defaultValue="attendance" dir="rtl" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-3">
          <TabsTrigger value="attendance" className="min-h-12 rounded-xl border bg-card">
            <CalendarDays className="ml-2 h-4 w-4" /> كشف حضور الموظفين
          </TabsTrigger>
          <TabsTrigger value="vehicles" className="min-h-12 rounded-xl border bg-card">
            <Truck className="ml-2 h-4 w-4" /> التقرير الشهري للمركبات
          </TabsTrigger>
          <TabsTrigger value="machinery" className="min-h-12 rounded-xl border bg-card">
            <Cog className="ml-2 h-4 w-4" /> حضور الآليات
          </TabsTrigger>
      </TabsList>
      <TabsContent value="attendance" className="mt-0">
      <Card className="min-w-0 overflow-hidden">
        <div className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-month">الشهر</Label>
            <Input
              id="report-month"
              type="month"
              min="1000-01"
              max="9999-12"
              value={month}
              onChange={(e) => {
                if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                  setMonth(e.target.value);
                  setPage(0);
                  setSelection(null);
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employee-search">بحث عن موظف</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="employee-search"
                className="pr-9"
                placeholder="الاسم أو الرقم الوظيفي"
                value={search}
                onChange={(e) => setFilter(setSearch, e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employee-filter">الموظف</Label>
            <select
              id="employee-filter"
              className={selectClass}
              value={employeeId}
              onChange={(e) => setFilter(setEmployeeId, e.target.value)}
            >
              <option value="">جميع الموظفين</option>
                  {selectedEmployee &&
                    !employeeOptions.some((employee) => employee.id === employeeId) && (
                <option value={employeeId}>{selectedEmployee.full_name}</option>
              )}
              {employeeOptions.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_no} — {employee.full_name}
                </option>
              ))}
            </select>
          </div>
          {[
            {
              id: "department",
              label: "القسم",
              all: "جميع الأقسام",
              value: department,
              setter: setDepartment,
              options: filters.departments,
            },
            {
              id: "site",
              label: "الموقع",
              all: "جميع المواقع",
              value: site,
              setter: setSite,
              options: filters.sites,
            },
            {
              id: "shift",
              label: "الدوام",
              all: "جميع الدوامات",
              value: shift,
              setter: setShift,
              options: filters.shifts,
            },
          ].map((filter) => (
            <div key={filter.id} className="space-y-1.5">
              <Label htmlFor={filter.id}>{filter.label}</Label>
              <select
                id={filter.id}
                className={selectClass}
                value={filter.value}
                onChange={(e) => setFilter(filter.setter, e.target.value)}
              >
                <option value="">{filter.all}</option>
                {filter.options.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={summarized}
                onChange={(e) => setSummarized(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              عرض مختصر (الإجماليات)
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setEmployeeId("");
                setDepartment("");
                setSite("");
                setShift("");
                setPage(0);
              }}
            >
              مسح الفلاتر
            </Button>
            {data && (
              <span className="mr-auto text-xs text-muted-foreground">
                {(data?.totalRows ?? 0).toLocaleString("ar")} موظف
              </span>
            )}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-3 text-xs"
          aria-label="دليل حالات الحضور"
        >
          {statuses.map((status) => (
            <span key={status.value} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn("rounded px-1.5 py-0.5 font-bold", status.className)}
                    dir="ltr"
                  >
                {status.code}
              </span>
              {status.label}
            </span>
          ))}
          <span className="text-muted-foreground">— لم يحن موعده</span>
          <span className="text-muted-foreground">• تعديل يدوي</span>
          <span className="rounded border border-orange-400 bg-orange-50 px-1.5 py-0.5 text-orange-700">
            إضافي
          </span>
        </div>

        {isPending ? (
          <p role="status" className="py-20 text-center text-muted-foreground">
            جارٍ تحميل كشف الحضور...
          </p>
        ) : error ? (
          <div role="alert" className="space-y-3 p-10 text-center">
            <p className="text-destructive">تعذر تحميل التقرير: {error.message}</p>
            <Button variant="outline" onClick={() => refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : !rows.length ? (
          <p role="status" className="py-20 text-center text-muted-foreground">
            {employeeId || department || site || shift || search.trim()
              ? "لا يوجد موظفون يطابقون الفلاتر المحددة"
              : "لا يوجد موظفون لعرضهم في التقرير"}
          </p>
        ) : (
          <>
            <section className="border-b p-4" aria-labelledby="attendance-chart-title">
              <h2 id="attendance-chart-title" className="mb-3 text-sm font-medium">
                الحضور والغياب خلال الشهر — موظفو الصفحة الحالية
              </h2>
              <div
                dir="ltr"
                className="h-56 w-full"
                role="img"
                aria-label="رسم يومي للحضور والغياب والإجازات لموظفي الصفحة الحالية"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart} margin={{ top: 8, right: 12, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date: string) => date.slice(8)}
                      minTickGap={10}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      labelFormatter={(date) => `${date} · ${weekday(String(date))}`}
                      contentStyle={{ direction: "rtl", borderRadius: 8 }}
                    />
                    <Line
                      name="حاضر"
                      dataKey="present"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      name="غائب"
                      dataKey="absent"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      name="إجازة"
                      dataKey="leave"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                    الرسم يشمل جميع نتائج الفلاتر، والإجماليات بالساعات. الأيام المستقبلية بلا تسجيل
                    لا تُحتسب غيابًا.
              </p>
            </section>

            <div
              className="max-h-[560px] overflow-auto"
              tabIndex={0}
              role="region"
              aria-label="جدول الحضور الشهري، قابل للتمرير أفقيًا وعموديًا"
            >
              <table className="w-full border-separate border-spacing-0 text-right text-xs">
                <caption className="sr-only">كشف الحضور لشهر {month}</caption>
                <thead className="sticky top-0 z-20">
                  <tr className="[&>th]:border-b [&>th]:border-l [&>th]:bg-muted [&>th]:px-3 [&>th]:py-3 [&>th]:font-medium [&>th]:whitespace-nowrap">
                    <th scope="col" className="sticky right-0 z-30 min-w-56">
                      الموظف / الرقم الوظيفي
                    </th>
                    <th scope="col">القسم</th>
                    <th scope="col">الدوام</th>
                    {!summarized &&
                      data?.dates.map((date) => (
                        <th scope="col" key={date} className="min-w-14 text-center">
                          <span className="block font-semibold">{date.slice(8)}</span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {weekday(date)}
                          </span>
                        </th>
                      ))}
                    {summaryColumns.map((column) => (
                      <th scope="col" key={column.key} className="text-center">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.employee.id}
                      className="group [&>td]:border-b [&>td]:border-l [&>td]:px-2 [&>td]:py-1.5"
                    >
                      <th
                        scope="row"
                        className="sticky right-0 z-10 max-w-64 border-b border-l bg-card px-3 py-2 font-normal group-hover:bg-muted"
                      >
                        <button
                          className="block w-full text-right hover:text-primary focus-visible:outline-primary"
                          onClick={() =>
                            setSelection({
                              employeeId: row.employee.id,
                              date: data?.dates[0] ?? `${month}-01`,
                            })
                          }
                        >
                          <span
                            className="block truncate font-medium"
                            title={row.employee.full_name}
                          >
                            {row.employee.full_name}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {row.employee.employee_no}
                          </span>
                        </button>
                      </th>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {row.employee.departments?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {row.employee.shifts?.name ?? "—"}
                      </td>
                      {!summarized &&
                        row.days.map((day) => {
                          const status = statuses.find((s) => s.value === day.status);
                          const description = `${row.employee.full_name}، ${day.date}، ${status?.label ?? "لم يحن موعده"}${day.overtime_hours > 0 ? `، وقت إضافي ${day.overtime_hours} ساعة` : ""}${day.manual ? "، تعديل يدوي" : ""}`;
                          return (
                            <td key={day.date} className="text-center">
                              <button
                                className={cn(
                                  "relative h-8 w-9 rounded font-semibold transition-colors hover:ring-1 hover:ring-primary focus-visible:outline-primary",
                                  status?.className ?? "text-muted-foreground",
                                  day.overtime_hours > 0 &&
                                    "ring-2 ring-orange-400 bg-orange-100 text-orange-800",
                                )}
                                aria-label={description}
                                title={description}
                                onClick={() =>
                                  setSelection({ employeeId: row.employee.id, date: day.date })
                                }
                              >
                                <span dir="ltr">{status?.code ?? "—"}</span>
                                {day.manual && (
                                  <span
                                    aria-hidden="true"
                                    className="absolute left-0.5 top-0 text-[10px]"
                                  >
                                    •
                                  </span>
                                )}
                                {day.overtime_hours > 0 && (
                                  <span
                                    aria-hidden="true"
                                    className="absolute right-0.5 top-0 text-[9px] text-orange-700"
                                  >
                                    +
                                  </span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      {summaryColumns.map((column) => (
                        <td
                          key={column.key}
                              className={cn(
                                "text-center font-semibold tabular-nums",
                                column.className,
                              )}
                        >
                          {row.summary[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground">
              <span>
                {summarized
                  ? "اضغط على اسم الموظف لعرض تفاصيل الأيام"
                  : "اسحب الجدول أفقيًا لعرض بقية أيام الشهر"}{" "}
                · {(data?.totalRows ?? 0).toLocaleString("ar")} موظف
              </span>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  السابق
                </Button>
                <span>
                  صفحة {currentPage + 1} من {pageCount}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  التالي
                </Button>
              </div>
            </footer>
          </>
        )}
      </Card>
      </TabsContent>
      <TabsContent value="vehicles" className="mt-0 space-y-4">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "إجمالي المركبات", value: vehicleReport.data?.length ?? 0, icon: Truck },
              {
                label: "مركبات عاملة",
                value: (vehicleReport.data ?? []).filter((vehicle) => vehicle.is_active).length,
                icon: Truck,
              },
              {
                label: "أيام التشغيل",
                value: (vehicleReport.data ?? []).reduce(
                  (sum, vehicle) => sum + vehicle.operatingDays,
                  0,
                ),
                icon: CalendarDays,
              },
              {
                label: "إجمالي الاستحقاق",
                value: `${vehicleTotal.toLocaleString("ar-IQ")} د.ع`,
                icon: Banknote,
              },
            ].map((stat) => (
              <Card key={stat.label} className="rounded-2xl">
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {vehicleReport.isPending ? "—" : stat.value}
                    </p>
                  </div>
                  <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
                    <stat.icon className="h-5 w-5" />
                  </span>
                </div>
              </Card>
            ))}
        </section>
        <Card className="overflow-hidden">
          <div className="flex flex-col justify-between gap-4 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Truck className="h-5 w-5 text-primary" /> مستحقات المركبات لشهر {month}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  الاستحقاق = أيام التشغيل المسجلة × الأجر اليومي، وفق بيانات إدارة المركبات.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void vehicleReport.refetch()}
                  disabled={vehicleReport.isFetching}
                >
                  <RefreshCw
                    className={cn("ml-2 h-4 w-4", vehicleReport.isFetching && "animate-spin")}
                  />{" "}
                  تحديث
                </Button>
                <Button
                  variant="outline"
                  onClick={printVehicleReport}
                  disabled={!vehicleRows.length}
                >
                  <Printer className="ml-2 h-4 w-4" /> طباعة
                </Button>
                <Button onClick={exportVehicleReport} disabled={!vehicleRows.length}>
                  <Download className="ml-2 h-4 w-4" /> Excel
                </Button>
              </div>
          </div>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end">
              <div className="w-full space-y-1.5 sm:max-w-xs">
                <Label htmlFor="vehicle-report-month">شهر التقرير</Label>
                <Input
                  id="vehicle-report-month"
                  type="month"
                  value={month}
                  onChange={(event) => {
                    if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value))
                      setMonth(event.target.value);
                  }}
                />
              </div>
              <div className="w-full space-y-1.5 sm:max-w-sm">
                <Label htmlFor="vehicle-report-search">البحث عن مركبة</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="vehicle-report-search"
                    className="pr-9"
                    placeholder="رقم المركبة أو الاسم"
                    value={vehicleSearch}
                    onChange={(event) => setVehicleSearch(event.target.value)}
                  />
                </div>
              </div>
              <Badge variant="secondary" className="w-fit sm:mr-auto">
                {vehicleRows.length.toLocaleString("ar")} مركبة ·{" "}
                {vehicleTotal.toLocaleString("ar-IQ")} د.ع
              </Badge>
            </div>
            {vehicleReport.isError ? (
              <div role="alert" className="space-y-3 p-10 text-center">
                <p className="text-destructive">
                  تعذر تحميل تقرير المركبات: {vehicleReport.error.message}
                </p>
                <Button variant="outline" onClick={() => void vehicleReport.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : vehicleReport.isPending ? (
              <p role="status" className="p-12 text-center text-muted-foreground">
                جارٍ تحميل تقرير المركبات…
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-right">
                      <th className="p-3">المركبة</th>
                      <th className="p-3">الفئة</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">أيام الحضور</th>
                      <th className="p-3">تواريخ الحضور</th>
                      <th className="p-3">الأجر اليومي</th>
                      <th className="p-3">الاستحقاق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicleRows.map((vehicle) => (
                      <tr key={vehicle.id} className="border-b transition-colors hover:bg-muted/20">
                        <td className="p-3">
                          <b>{vehicle.name}</b>
                          <div className="text-xs text-muted-foreground">{vehicle.vehicle_no}</div>
                        </td>
                        <td className="p-3">
                          {vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}
                        </td>
                        <td className="p-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-1 text-xs",
                              vehicle.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {vehicle.is_active ? "نشطة" : "متوقفة"}
                          </span>
                        </td>
                        <td className="p-3 tabular-nums">{vehicle.operatingDays} يوم</td>
                        <td className="max-w-72 p-3 text-xs leading-6 text-muted-foreground">
                          {vehicle.operatingDates.length
                            ? vehicle.operatingDates
                                .map((date) => Number(date.slice(8)).toLocaleString("ar"))
                                .join("، ")
                            : "لم تُسجّل التواريخ بعد"}
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(vehicle.daily_rate).toLocaleString("ar-IQ")} د.ع
                        </td>
                        <td className="p-3 font-bold tabular-nums">
                          {vehicle.total.toLocaleString("ar-IQ")} د.ع
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-bold">
                      <td className="p-3" colSpan={3}>
                        الإجمالي
                      </td>
                      <td className="p-3">
                        {vehicleRows.reduce((sum, vehicle) => sum + vehicle.operatingDays, 0)} يوم
                      </td>
                      <td className="p-3">—</td>
                      <td className="p-3">—</td>
                      <td className="p-3">{vehicleTotal.toLocaleString("ar-IQ")} د.ع</td>
                    </tr>
                  </tfoot>
                </table>
                {!vehicleRows.length && (
                  <p className="p-10 text-center text-muted-foreground">
                    {vehicleReport.data?.length
                      ? "لا توجد مركبات تطابق البحث."
                      : "لا توجد مركبات مسجلة. أضف المركبات وسجل أيام تشغيلها من إدارة المركبات."}
                  </p>
                )}
          </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="machinery" className="mt-0 space-y-4">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b p-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Cog className="h-5 w-5 text-primary" /> كشف حضور الآليات
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  أيام التشغيل المسجلة لكل آلية خلال الشهر المحدد.
                </p>
              </div>
              <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="machinery-report-month">الشهر</Label>
                  <Input
                    id="machinery-report-month"
                    type="month"
                    value={month}
                    onChange={(event) => {
                      if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) {
                        setMonth(event.target.value);
                        setMachineryPage(0);
                      }
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="machinery-report-search">بحث برقم الآلية</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="machinery-report-search"
                      className="pr-9"
                      placeholder="رقم الأصل أو الكود"
                      value={machinerySearch}
                      onChange={(event) => {
                        setMachinerySearch(event.target.value);
                        setMachineryPage(0);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
            {machineryReport.isError ? (
              <div role="alert" className="space-y-3 p-10 text-center">
                <p className="text-destructive">
                  تعذر تحميل حضور الآليات: {machineryReport.error.message}
                </p>
                <p className="text-sm text-muted-foreground">
                  تحقق من تطبيق ترحيل سجل حضور الآليات في قاعدة البيانات.
                </p>
                <Button variant="outline" onClick={() => void machineryReport.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : machineryReport.isPending ? (
              <p role="status" className="p-10 text-center text-muted-foreground">
                جارٍ تحميل سجل الآليات…
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-right">
                      <th className="p-3">الآلية</th>
                      <th className="p-3">رقم الآلية</th>
                      <th className="p-3">التصنيف</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">أيام الحضور</th>
                      <th className="p-3">تواريخ الحضور</th>
                      <th className="p-3">الإيجار اليومي</th>
                      <th className="p-3">الإجمالي</th>
                      <th className="p-3">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineryRows.map((machine) => (
                      <tr key={machine.id} className="border-b hover:bg-muted/20">
                        <td className="p-3 font-medium">{machine.name}</td>
                        <td className="p-3">{machine.asset_number || machine.code}</td>
                        <td className="p-3">{machine.category || "—"}</td>
                        <td className="p-3">
                          {machine.status === "active"
                            ? "نشطة"
                            : machine.status === "maintenance"
                              ? "قيد الصيانة"
                              : "متوقفة"}
                        </td>
                        <td className="p-3 tabular-nums">
                          {machine.operatingDays.toLocaleString("ar")} يوم
                        </td>
                        <td className="max-w-72 p-3 text-xs leading-6 text-muted-foreground">
                          {machine.operatingDates.length
                            ? machine.operatingDates
                                .map((date) => Number(date.slice(8)).toLocaleString("ar"))
                                .join("، ")
                            : "لا توجد أيام مسجلة"}
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(machine.daily_rent).toLocaleString("ar-IQ")} د.ع
                        </td>
                        <td className="p-3 font-bold tabular-nums">
                          {machine.total.toLocaleString("ar-IQ")} د.ع
                        </td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveMachinery(machine);
                              setMachineryDatesDraft(machine.operatingDates);
                            }}
                          >
                            <CalendarDays className="ml-2 h-4 w-4" /> تسجيل / تعديل الدوام
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-bold">
                      <td className="p-3" colSpan={4}>
                        الآليات المعروضة: {machineryRows.length.toLocaleString("ar")} من أصل {machineryCount.toLocaleString("ar")}
                      </td>
                      <td className="p-3">
                        {machineryRows
                          .reduce((sum, machine) => sum + machine.operatingDays, 0)
                          .toLocaleString("ar")}{" "}
                        يوم
                      </td>
                      <td className="p-3">—</td>
                      <td className="p-3">—</td>
                      <td className="p-3">{machineryTotal.toLocaleString("ar-IQ")} د.ع</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                {!machineryRows.length && (
                  <p className="p-10 text-center text-muted-foreground">
                    لا توجد آليات تطابق رقم البحث.
                  </p>
                )}
                {machineryCount > 50 && (
                  <div className="flex items-center justify-between gap-3 border-t p-4">
                    <Button
                      variant="outline"
                      disabled={machineryPage === 0 || machineryReport.isFetching}
                      onClick={() => setMachineryPage((current) => Math.max(0, current - 1))}
                    >
                      الصفحة السابقة
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      صفحة {(machineryPage + 1).toLocaleString("ar")} من {machineryPageCount.toLocaleString("ar")} · 50 آلية كحد أقصى
                    </span>
                    <Button
                      variant="outline"
                      disabled={machineryPage + 1 >= machineryPageCount || machineryReport.isFetching}
                      onClick={() => setMachineryPage((current) => current + 1)}
                    >
                      الصفحة التالية
                    </Button>
                  </div>
                )}
              </div>
            )}
        </Card>
      </TabsContent>
      </Tabs>
      <Dialog
        open={!!selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {selection && (
            <EmployeeDetails
              key={`${selection.employeeId}-${month}`}
              employeeId={selection.employeeId}
              month={month}
              initialDate={selection.date}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeMachinery}
        onOpenChange={(open) => {
          if (!open) setActiveMachinery(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeMachinery && (
            <>
              <DialogHeader>
                <DialogTitle>تسجيل أيام تشغيل الآلية</DialogTitle>
                <DialogDescription>
                  {activeMachinery.name} · {activeMachinery.asset_number || activeMachinery.code} · {month}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-7 gap-2">
                {["ح", "ن", "ث", "ر", "خ", "ج", "س"].map((day) => (
                  <div key={day} className="py-1 text-center text-xs font-medium text-muted-foreground">{day}</div>
                ))}
                {Array.from({ length: new Date(`${month}-01T00:00:00`).getDay() }, (_, index) => (
                  <div key={`empty-${index}`} />
                ))}
                {Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() }, (_, index) => {
                  const day = index + 1;
                  const date = `${month}-${String(day).padStart(2, "0")}`;
                  const selected = machineryDatesDraft.includes(date);
                  return (
                    <Button
                      key={date}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      className="h-10"
                      aria-pressed={selected}
                      onClick={() => setMachineryDatesDraft((current) => selected ? current.filter((item) => item !== date) : [...current, date].sort())}
                    >
                      {day.toLocaleString("ar")}
                    </Button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <p className="text-sm">أيام التشغيل: <b>{machineryDatesDraft.length.toLocaleString("ar")}</b> · التكلفة: <b>{(machineryDatesDraft.length * Number(activeMachinery.daily_rent ?? 0)).toLocaleString("ar-IQ")} د.ع</b></p>
                <Button onClick={() => saveMachineryAttendance.mutate()} disabled={saveMachineryAttendance.isPending}>
                  حفظ الحضور
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeDetails({
  employeeId,
  month,
  initialDate,
}: {
  employeeId: string;
  month: string;
  initialDate: string;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(initialDate);
  const fetchMonthly = useServerFn(getEmployeeMonthly);
  const saveDay = useServerFn(setDayStatus);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["monthly", "employee", employeeId, month],
    queryFn: () => fetchMonthly({ data: { employee_id: employeeId, month } }),
  });
  const mutation = useMutation({
    mutationFn: (value: { date: string; status: DayStatus | null; notes: string | null }) =>
      saveDay({
        data: {
          employee_id: employeeId,
          work_date: value.date,
          status: value.status,
          notes: value.notes,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["monthly"] });
      toast.success("تم تحديث اليوم");
    },
    onError: (e: Error) => toast.error(formatErrorMessage(e)),
  });
  const day = data?.days.find((d) => d.date === date);
  const status = statuses.find((s) => s.value === day?.status);
  return (
    <>
      <DialogHeader className="pt-3 sm:text-right">
        <DialogTitle>
          {data ? `${data.employee.full_name} — ${data.employee.employee_no}` : "تفاصيل الموظف"}
        </DialogTitle>
        <DialogDescription>تفاصيل الحضور والأجر لشهر {month}</DialogDescription>
      </DialogHeader>
      {isPending && <p role="status">جارٍ تحميل التفاصيل...</p>}
      {error && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>تعذر تحميل التفاصيل: {error.message}</p>
          <Button variant="outline" onClick={() => refetch()}>
            إعادة المحاولة
          </Button>
        </div>
      )}
      {data && day && (
        <div className="space-y-5 text-sm">
          <div className="rounded-2xl bg-gradient-to-l from-primary to-primary/70 p-4 text-primary-foreground shadow-md">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/20 text-lg font-bold">
                {data.employee.full_name.trim().charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-bold">{data.employee.full_name}</p>
                <p className="text-xs opacity-90">
                  {data.employee.departments?.name ?? "بدون قسم"} ·{" "}
                  {data.employee.shifts?.name ?? "بدون دوام"}
                  {data.employee.sites ? ` · ${data.employee.sites.name}` : ""}
                </p>
              </div>
              <span className="mr-auto rounded-full bg-background/20 px-3 py-1 text-xs font-semibold">
                {data.payroll.payType === "daily" ? "أجر يومي" : "راتب شهري"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[
                ["حضور", data.summary.presentDays],
                ["غياب", data.summary.absentDays],
                ["إضافي", `${data.summary.totalOvertimeHours}س`],
                ["ساعات", data.summary.totalHours],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-background/15 p-2">
                  <p className="text-lg font-bold">{value}</p>
                  <p className="text-[11px] opacity-90">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>أيام الشهر — اختر يوماً</Label>
            <div className="grid grid-cols-7 gap-1.5">
              {data.days.map((d) => {
                const s = statuses.find((x) => x.value === d.status);
                return (
                  <button
                    key={d.date}
                    type="button"
                    title={`${d.date} · ${weekday(d.date)} · ${s?.label ?? "—"}`}
                    onClick={() => setDate(d.date)}
                    disabled={mutation.isPending}
                    className={cn(
                      "flex flex-col items-center rounded-lg border py-1 text-[11px] transition",
                      s?.className ?? "bg-muted/40 text-muted-foreground",
                      d.date === date && "ring-2 ring-primary ring-offset-1",
                    )}
                  >
                    <span className="font-bold">{Number(d.date.slice(8))}</span>
                    <span>{s?.code ?? "·"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="mb-2 text-xs text-muted-foreground">
              {date} · {weekday(date)}
            </p>
            <div className="mb-4 flex items-center justify-between">
              <span className={cn("rounded px-2 py-1 font-medium", status?.className)}>
                {status?.label ?? "لم يحن موعده"}
              </span>
              <span className="text-xs text-muted-foreground">
                {day.manual ? "تعديل يدوي" : day.punches ? "البصمة" : "لا توجد بصمات"}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-4">
              {[
                ["أول دخول", formatTime(day.check_in)],
                ["آخر خروج", formatTime(day.check_out)],
                ["ساعات العمل", `${day.hours} س`],
                ["الوقت الإضافي", `${day.overtime_hours} س`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 space-y-2">
              <Label htmlFor="day-status">تعديل حالة اليوم</Label>
              <select
                id="day-status"
                className={selectClass}
                value={day.manual ? (day.status ?? "auto") : "auto"}
                disabled={mutation.isPending}
                onChange={(e) => {
                  const status = statuses.find((s) => s.value === e.target.value)?.value ?? null;
                  mutation.mutate({ date: day.date, status, notes: day.notes });
                }}
              >
                <option value="auto">تلقائي (البصمة)</option>
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {mutation.isPending && (
                <p role="status" className="text-xs text-muted-foreground">
                  جارٍ الحفظ...
                </p>
              )}
              {day.notes && <p className="text-xs text-muted-foreground">{day.notes}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {summaryColumns.map((column) => (
              <div key={column.key}>
                <p className="text-xs text-muted-foreground">{column.label}</p>
                <p className={cn("mt-1 font-semibold", column.className)}>
                  {data.summary[column.key]}
                </p>
              </div>
            ))}
          </div>
          <section className="border-t pt-4">
            <h3 className="mb-3 font-semibold">
              ملخص الأجر — {data.payroll.payType === "daily" ? "موظف يومي" : "موظف شهري"}
            </h3>
            <dl className="grid grid-cols-2 gap-4">
              {(
                [
                  ["الأجر اليومي", data.payroll.dailyRate],
                  ...(data.payroll.payType === "daily"
                    ? ([["أيام العمل المستحقة", data.payroll.paidDays]] as [string, number][])
                    : []),
                  ["أجر الحضور", data.payroll.basePay],
                  ["بدل الساعات الإضافية", data.payroll.overtimePay],
                  ["الإضافات والمكافآت", data.payroll.additionsTotal],
                  ["الاستقطاعات والعقوبات", data.payroll.deductionsTotal],
                  ["الإجمالي المستحق", data.payroll.total],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold">
                    {value.toLocaleString()}{" "}
                    {label.includes("أيام") || label.includes("الأيام")
                      ? "يوم"
                      : data.payroll.currency}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </>
  );
}

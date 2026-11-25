import { direction, displayLocale, ui } from "@/lib/ui-language";
import { useDirectorySearch } from "@/hooks/use-directory-search";
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
import { EmployeeReportHistory } from "@/components/EmployeeReportHistory";
import { getEmployeeMonthly, getMonthlySheet, setDayStatus } from "@/lib/reports.functions";
import { dailyTotals, type DayStatus, type ComputedStatus } from "@/lib/monthly-report";
import { COMPANY_TIME_ZONE, currentMonthInBaghdad } from "@/lib/date-time";
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
      { title: ui("كشف الحضور الشهري") },
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
const computedStatusLabels: Record<ComputedStatus, { label: string; code: string; className: string }> = {
  present: { label: "حاضر", code: "P", className: "text-emerald-700 bg-emerald-50" },
  absent: { label: "غائب", code: "A", className: "text-red-600 bg-red-50" },
  leave: { label: "إجازة", code: "L", className: "text-blue-600 bg-blue-50" },
  holiday: { label: "عطلة", code: "H", className: "text-amber-700 bg-amber-50" },
  rest: { label: "راحة أسبوعية", code: "WO", className: "text-slate-600 bg-slate-100" },
  incomplete: { label: "بصمة غير مكتملة", code: "…", className: "text-amber-800 bg-amber-100" },
};
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
type EmployeeOption = Pick<SheetRow["employee"], "id" | "employee_no" | "full_name">;
const MONTHLY_EMPLOYEE_LIMIT = 20;
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
  new Date(`${date}T00:00:00Z`).toLocaleDateString(displayLocale(), { weekday: "short", timeZone: "UTC" });
const datesInMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
};
const formatTime = (time: string | null) =>
  time
    ? new Date(time).toLocaleTimeString(displayLocale(), {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: COMPANY_TIME_ZONE,
      })
    : "—";

function MonthlyPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [site, setSite] = useState("");
  const [shift, setShift] = useState("");
  const [summarized, setSummarized] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
  const [selection, setSelection] = useState<{ employeeId: string; date: string } | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [machinerySearch, setMachinerySearch] = useState("");
  const [machineryPage, setMachineryPage] = useState(0);
  const [activeMachinery, setActiveMachinery] = useState<MonthlyMachinery | null>(null);
  const [machineryDatesDraft, setMachineryDatesDraft] = useState<string[]>([]);
  const [activeVehicle, setActiveVehicle] = useState<MonthlyVehicle | null>(null);
  const [vehicleDatesDraft, setVehicleDatesDraft] = useState<string[]>([]);
  const fetchSheet = useServerFn(getMonthlySheet);
  const lookup = useDirectorySearch(search);
  const searchTerm = lookup.valid ? lookup.term : "";
  const { data: filters, error: filtersError } = useQuery({
    queryKey: ["monthly", "filter-options"],
    queryFn: async () => {
      const [departments, sites, shifts] = await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("sites").select("id, name").order("name"),
        supabase.from("shifts").select("id, name").order("name"),
      ]);
      if (departments.error) throw departments.error;
      if (sites.error) throw sites.error;
      if (shifts.error) throw shifts.error;
      const options = (rows: { id: string; name: string }[]) =>
        rows.map(({ id, name }) => [id, name] as const);
      return { departments: options(departments.data), sites: options(sites.data), shifts: options(shifts.data) };
    },
  });
  const employeeLookup = useQuery({
    queryKey: ["monthly", "employee-options", department, site, shift, searchTerm],
    enabled: !lookup.waiting,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      let query = supabase.from("employees").select("id, employee_no, full_name");
      if (department) query = query.eq("department_id", department);
      if (site) query = query.eq("site_id", site);
      if (shift) query = query.eq("shift_id", shift);
      for (const term of searchTerm.split(" ").filter(Boolean)) {
        query = query.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%`);
      }
      const { data, error } = await query.order("employee_no").order("id").limit(MONTHLY_EMPLOYEE_LIMIT).abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const employeeOptions = lookup.waiting ? [] : (employeeLookup.data ?? []);
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["monthly", "sheet", month, employeeId, department, site, shift, searchTerm],
    enabled: !lookup.waiting,
    queryFn: ({ signal }) => fetchSheet({
      signal,
      data: {
        month,
        page_size: MONTHLY_EMPLOYEE_LIMIT,
        employee_id: employeeId || undefined,
        department_id: department || undefined,
        site_id: site || undefined,
        shift_id: shift || undefined,
        search: searchTerm,
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
  const monthDays = useMemo(() => datesInMonth(month), [month]);
  const vehicleDailyChart = useMemo(
    () => monthDays.map((date) => ({ day: Number(date.slice(-2)), operating: vehicleRows.filter((vehicle) => vehicle.operatingDates.includes(date)).length })),
    [monthDays, vehicleRows],
  );
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
  const machineryDailyChart = useMemo(
    () => monthDays.map((date) => ({ day: Number(date.slice(-2)), operating: machineryRows.filter((machine) => machine.operatingDates.includes(date)).length })),
    [monthDays, machineryRows],
  );
  const saveVehicleAttendance = useMutation({
    mutationFn: async () => {
      if (!activeVehicle) return;
      const dates = [...new Set(vehicleDatesDraft)].filter((date) => date.startsWith(`${month}-`)).sort();
      const { error } = await (supabase as any).from("vehicle_monthly_operations").upsert(
        { vehicle_id: activeVehicle.id, month: `${month}-01`, operating_days: dates.length, operating_dates: dates },
        { onConflict: "vehicle_id,month" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(ui("تم حفظ أيام تشغيل المركبة"));
      setActiveVehicle(null);
      await qc.invalidateQueries({ queryKey: ["monthly", "vehicle-report"] });
    },
    onError: (error: Error) => toast.error((ui("تعذر حفظ حضور المركبة: ") + (formatErrorMessage(error)))),
  });
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
      toast.success(ui("تم حفظ أيام تشغيل الآلية"));
      setActiveMachinery(null);
      await qc.invalidateQueries({ queryKey: ["monthly", "machinery-report"] });
    },
    onError: (error: Error) => toast.error((ui("تعذر حفظ حضور الآلية: ") + (formatErrorMessage(error)))),
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
          `<tr><td>${escapeHtml(vehicle.vehicle_no)}</td><td>${escapeHtml(vehicle.name)}</td><td>${vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}</td><td>${vehicle.operatingDays}</td><td>${escapeHtml(vehicle.operatingDates.map((date) => Number(date.slice(8)).toLocaleString(displayLocale())).join("، ") || "—")}</td><td>${Number(vehicle.daily_rate).toLocaleString(displayLocale())}</td><td>${vehicle.total.toLocaleString(displayLocale())}</td><td>${vehicle.is_active ? "نشطة" : "متوقفة"}</td></tr>`,
      )
      .join("");
    const body = `<p>${ui("الشهر: ")}${escapeHtml(month)} · عدد المركبات: ${vehicleRows.length} · إجمالي الاستحقاق: ${vehicleTotal.toLocaleString(displayLocale())} د.ع</p><table><thead><tr><th>${ui("رقم المركبة")}</th><th>${ui("المركبة")}</th><th>${ui("الفئة")}</th><th>${ui("أيام الحضور")}</th><th>${ui("تواريخ الحضور")}</th><th>${ui("الأجر اليومي")}</th><th>${ui("المستحق")}</th><th>${ui("الحالة")}</th></tr></thead><tbody>${rowsMarkup}</tbody></table>`;
    if (!printReport(`التقرير الشهري للمركبات — ${month}`, body))
      toast.error(ui("اسمح بالنوافذ المنبثقة لطباعة التقرير"));
  };
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const chart = useMemo(
    () => dailyTotals(data?.dates ?? [], rows, data?.today ?? ""),
    [data, rows],
  );
  const visibleRows = rows;
  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setEmployeeId("");
    setSelectedEmployee(null);
  };

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarDays className="h-6 w-6 text-primary" />{ui(" كشف الحضور الشهري")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ui("حضور الموظفين يومًا بيوم · اضغط على حالة اليوم لعرض التفاصيل أو تعديلها")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => qc.invalidateQueries({ queryKey: ["monthly"] })}
        >
          <RefreshCw className={cn("ml-2 h-4 w-4", isFetching && "animate-spin")} />{ui(" تحديث التقرير")}</Button>
      </header>

      <Tabs defaultValue="attendance" dir={direction()} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-4">
          <TabsTrigger value="history" className="min-h-12 rounded-xl border bg-card">{ui("سجل التغييرات")}</TabsTrigger>
          <TabsTrigger value="attendance" className="min-h-12 rounded-xl border bg-card">
            <CalendarDays className="ml-2 h-4 w-4" />{ui(" كشف حضور الموظفين")}</TabsTrigger>
          <TabsTrigger value="vehicles" className="min-h-12 rounded-xl border bg-card">
            <Truck className="ml-2 h-4 w-4" />{ui(" التقرير الشهري للمركبات")}</TabsTrigger>
          <TabsTrigger value="machinery" className="min-h-12 rounded-xl border bg-card">
            <Cog className="ml-2 h-4 w-4" />{ui(" حضور الآليات")}</TabsTrigger>
      </TabsList>
      <TabsContent value="history"><EmployeeReportHistory key={month} month={month} /></TabsContent>
      <TabsContent value="attendance" className="mt-0">
      <Card className="min-w-0 overflow-hidden">
        <div className="grid grid-cols-1 gap-3 border-b p-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-month">{ui("الشهر")}</Label>
            <Input
              id="report-month"
              type="month"
              min="1000-01"
              max="9999-12"
              value={month}
              onChange={(e) => {
                if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                  setMonth(e.target.value);
                  setSelection(null);
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employee-search">{ui("بحث عن موظف")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="employee-search"
                className="pr-9"
                placeholder={ui("حرفان على الأقل من الاسم أو الرقم")}
                maxLength={100}
                value={search}
                onChange={(e) => setFilter(setSearch, e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employee-filter">{ui("الموظف")}</Label>
            <select
              id="employee-filter"
              className={selectClass}
              value={employeeId}
              onChange={(e) => {
                const id = e.target.value;
                setEmployeeId(id);
                setSelectedEmployee(employeeOptions.find((employee) => employee.id === id) ?? null);
              }}
            >
              <option value="">{ui("أول 20 موظفاً مطابقاً")}</option>
              {selectedEmployee &&
                !employeeOptions.some((employee) => employee.id === employeeId) && (
                <option value={employeeId}>
                  {selectedEmployee.employee_no} — {selectedEmployee.full_name}
                </option>
              )}
              {employeeOptions.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_no} — {employee.full_name}
                </option>
              ))}
            </select>
            {lookup.waiting || employeeLookup.isFetching ? (
              <p role="status" className="text-xs text-muted-foreground">{ui("جارٍ البحث عن الموظفين…")}</p>
            ) : employeeLookup.isError ? (
              <p role="alert" className="text-xs text-destructive">{ui("تعذر البحث عن الموظفين.")}</p>
            ) : null}
          </div>
          {filtersError && <p role="alert" className="text-xs text-destructive">{ui("تعذر تحميل خيارات الفلاتر.")}</p>}
          {[
            {
              id: "department",
              label: "القسم",
              all: "جميع الأقسام",
              value: department,
              setter: setDepartment,
              options: filters?.departments ?? [],
            },
            {
              id: "site",
              label: "الموقع",
              all: "جميع المواقع",
              value: site,
              setter: setSite,
              options: filters?.sites ?? [],
            },
            {
              id: "shift",
              label: "الدوام",
              all: "جميع الدوامات",
              value: shift,
              setter: setShift,
              options: filters?.shifts ?? [],
            },
          ].map((filter) => (
            <div key={filter.id} className="space-y-1.5">
              <Label htmlFor={filter.id}>{ui(filter.label)}</Label>
              <select
                id={filter.id}
                className={selectClass}
                value={filter.value}
                onChange={(e) => setFilter(filter.setter, e.target.value)}
              >
                <option value="">{ui(filter.all)}</option>
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
              />{ui("عرض مختصر (الإجماليات)")}</label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setEmployeeId("");
                setDepartment("");
                setSite("");
                setShift("");
                setSelectedEmployee(null);
              }}
            >{ui("مسح الفلاتر")}</Button>
            {data && (
              <span className="mr-auto text-xs text-muted-foreground">
                {(data?.totalRows ?? 0).toLocaleString(displayLocale())}{ui(" موظف")}</span>
            )}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-3 text-xs"
          aria-label={ui("دليل حالات الحضور")}
        >
          {statuses.map((status) => (
            <span key={status.value} className="inline-flex items-center gap-1.5">
                  <span
                    className={cn("rounded px-1.5 py-0.5 font-bold", status.className)}
                    dir="ltr"
                  >
                {status.code}
              </span>
              {ui(status.label)}
            </span>
          ))}
          <span className="text-muted-foreground">{ui("— لم يحن موعده")}</span>
          <span className="text-muted-foreground">{ui("• تعديل يدوي")}</span>
          <span className="rounded border border-orange-400 bg-orange-50 px-1.5 py-0.5 text-orange-700">{ui("إضافي")}</span>
        </div>

        {lookup.waiting || isPending ? (
          <p role="status" className="py-20 text-center text-muted-foreground">{ui("جارٍ تحميل كشف الحضور...")}</p>
        ) : error ? (
          <div role="alert" className="space-y-3 p-10 text-center">
            <p className="text-destructive">{ui("تعذر تحميل التقرير: ")}{error.message}</p>
            <Button variant="outline" onClick={() => refetch()}>{ui("إعادة المحاولة")}</Button>
          </div>
        ) : !rows.length ? (
          <p role="status" className="py-20 text-center text-muted-foreground">
            {employeeId || department || site || shift || search.trim()
              ? ui("لا يوجد موظفون يطابقون الفلاتر المحددة")
              : ui("لا يوجد موظفون لعرضهم في التقرير")}
          </p>
        ) : (
          <>
            <section className="border-b p-4" aria-labelledby="attendance-chart-title">
              <h2 id="attendance-chart-title" className="mb-3 text-sm font-medium">{ui("الحضور والغياب خلال الشهر — الموظفون المعروضون")}</h2>
              <div
                dir="ltr"
                className="h-56 w-full"
                role="img"
                aria-label={ui("رسم يومي للحضور والغياب والإجازات للموظفين المعروضين")}
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
              <p className="mt-2 text-xs text-muted-foreground">{ui("الرسم يشمل جميع نتائج الفلاتر، والإجماليات بالساعات. الأيام المستقبلية بلا تسجيل لا تُحتسب غيابًا.")}</p>
            </section>

            <div
              className="max-h-[560px] overflow-auto"
              tabIndex={0}
              role="region"
              aria-label={ui("جدول الحضور الشهري، قابل للتمرير أفقيًا وعموديًا")}
            >
              <table className="w-full border-separate border-spacing-0 text-right text-xs">
                <caption className="sr-only">{ui("كشف الحضور لشهر ")}{month}</caption>
                <thead className="sticky top-0 z-20">
                  <tr className="[&>th]:border-b [&>th]:border-l [&>th]:bg-muted [&>th]:px-3 [&>th]:py-3 [&>th]:font-medium [&>th]:whitespace-nowrap">
                    <th scope="col" className="sticky right-0 z-30 min-w-56">{ui("الموظف / الرقم الوظيفي")}</th>
                    <th scope="col">{ui("القسم")}</th>
                    <th scope="col">{ui("الدوام")}</th>
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
                        {ui(column.label)}
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
                          const status = day.status ? computedStatusLabels[day.status] : undefined;
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
                  ? ui("اضغط على اسم الموظف لعرض تفاصيل الأيام")
                  : ui("اسحب الجدول أفقيًا لعرض بقية أيام الشهر")}
              </span>
              <span>{ui("عرض ")}{rows.length}{ui(" من ")}{data?.totalRows ?? 0}
                {(data?.totalRows ?? 0) > MONTHLY_EMPLOYEE_LIMIT && ui(" · استخدم البحث للوصول إلى بقية الموظفين")}
              </span>
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
                value: `${vehicleTotal.toLocaleString(displayLocale())} ${ui("د.ع")}`,
                icon: Banknote,
              },
            ].map((stat) => (
              <Card key={stat.label} className="rounded-2xl">
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{ui(stat.label)}</p>
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
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{ui("تشغيل المركبات خلال الشهر")}</h2>
              <p className="text-xs text-muted-foreground">{ui("عدد المركبات المسجّل لها تشغيل في كل يوم · النتائج حسب الفلاتر الحالية")}</p>
            </div>
            <Badge variant="secondary">{vehicleRows.filter((vehicle) => vehicle.operatingDays > 0).length.toLocaleString(displayLocale())}{ui(" مركبة مسجلة")}</Badge>
          </div>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vehicleDailyChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tickFormatter={(value) => Number(value).toLocaleString(displayLocale())} />
                <YAxis allowDecimals={false} width={36} />
                <Tooltip labelFormatter={(value) => `اليوم ${Number(value).toLocaleString(displayLocale())}`} formatter={(value) => [`${Number(value).toLocaleString(displayLocale())} مركبة`, "عاملة"]} />
                <Line type="monotone" dataKey="operating" name="مركبات عاملة" stroke="#14b8a6" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="flex flex-col justify-between gap-4 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Truck className="h-5 w-5 text-primary" />{ui(" مستحقات المركبات لشهر ")}{month}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{ui("الاستحقاق = أيام التشغيل المسجلة × الأجر اليومي، وفق بيانات إدارة المركبات.")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void vehicleReport.refetch()}
                  disabled={vehicleReport.isFetching}
                >
                  <RefreshCw
                    className={cn("ml-2 h-4 w-4", vehicleReport.isFetching && "animate-spin")}
                  />{" "}{ui("تحديث")}</Button>
                <Button
                  variant="outline"
                  onClick={printVehicleReport}
                  disabled={!vehicleRows.length}
                >
                  <Printer className="ml-2 h-4 w-4" />{ui(" طباعة")}</Button>
                <Button onClick={exportVehicleReport} disabled={!vehicleRows.length}>
                  <Download className="ml-2 h-4 w-4" /> Excel
                </Button>
              </div>
          </div>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end">
              <div className="w-full space-y-1.5 sm:max-w-xs">
                <Label htmlFor="vehicle-report-month">{ui("شهر التقرير")}</Label>
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
                <Label htmlFor="vehicle-report-search">{ui("البحث عن مركبة")}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="vehicle-report-search"
                    className="pr-9"
                    placeholder={ui("رقم المركبة أو الاسم")}
                    value={vehicleSearch}
                    onChange={(event) => setVehicleSearch(event.target.value)}
                  />
                </div>
              </div>
              <Badge variant="secondary" className="w-fit sm:mr-auto">
                {vehicleRows.length.toLocaleString(displayLocale())}{ui(" مركبة ·")}{" "}
                {vehicleTotal.toLocaleString(displayLocale())}{ui(" د.ع")}</Badge>
            </div>
            {vehicleReport.isError ? (
              <div role="alert" className="space-y-3 p-10 text-center">
                <p className="text-destructive">{ui("تعذر تحميل تقرير المركبات: ")}{vehicleReport.error.message}
                </p>
                <Button variant="outline" onClick={() => void vehicleReport.refetch()}>{ui("إعادة المحاولة")}</Button>
              </div>
            ) : vehicleReport.isPending ? (
              <p role="status" className="p-12 text-center text-muted-foreground">{ui("جارٍ تحميل تقرير المركبات…")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-right">
                      <th className="p-3">{ui("المركبة")}</th>
                      <th className="p-3">{ui("الفئة")}</th>
                      <th className="p-3">{ui("الحالة")}</th>
                      <th className="p-3">{ui("أيام الحضور")}</th>
                      <th className="p-3">{ui("تواريخ الحضور")}</th>
                      <th className="p-3">{ui("الأجر اليومي")}</th>
                      <th className="p-3">{ui("الاستحقاق")}</th>
                      <th className="p-3">{ui("تسجيل الدوام")}</th>
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
                          {vehicle.vehicle_class === "light" ? ui("خفيفة") : ui("ثقيلة")}
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
                            {vehicle.is_active ? ui("نشطة") : ui("متوقفة")}
                          </span>
                        </td>
                        <td className="p-3 tabular-nums">{vehicle.operatingDays}{ui(" يوم")}</td>
                        <td className="max-w-72 p-3 text-xs leading-6 text-muted-foreground">
                          {vehicle.operatingDates.length
                            ? vehicle.operatingDates
                                .map((date) => Number(date.slice(8)).toLocaleString(displayLocale()))
                                .join("، ")
                            : ui("لم تُسجّل التواريخ بعد")}
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(vehicle.daily_rate).toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                        <td className="p-3 font-bold tabular-nums">
                          {vehicle.total.toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                        <td className="p-3">
                          <Button size="sm" variant="outline" onClick={() => { setActiveVehicle(vehicle); setVehicleDatesDraft(vehicle.operatingDates); }}>
                            <CalendarDays className="ml-2 h-4 w-4" />{ui(" تعديل الأيام")}</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-bold">
                      <td className="p-3" colSpan={3}>{ui("الإجمالي")}</td>
                      <td className="p-3">
                        {vehicleRows.reduce((sum, vehicle) => sum + vehicle.operatingDays, 0)}{ui(" يوم")}</td>
                      <td className="p-3">—</td>
                      <td className="p-3">—</td>
                      <td className="p-3">{vehicleTotal.toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                {!vehicleRows.length && (
                  <p className="p-10 text-center text-muted-foreground">
                    {vehicleReport.data?.length
                      ? ui("لا توجد مركبات تطابق البحث.")
                      : ui("لا توجد مركبات مسجلة. أضف المركبات وسجل أيام تشغيلها من إدارة المركبات.")}
                  </p>
                )}
          </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="machinery" className="mt-0 space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "إجمالي الآليات", value: machineryCount.toLocaleString(displayLocale()), icon: Cog },
            { label: "آليات سُجل لها تشغيل", value: machineryRows.filter((machine) => machine.operatingDays > 0).length.toLocaleString(displayLocale()), icon: CalendarDays },
            { label: "أيام التشغيل المسجلة", value: machineryRows.reduce((sum, machine) => sum + machine.operatingDays, 0).toLocaleString(displayLocale()), icon: CalendarDays },
            { label: "كلفة الآليات المعروضة", value: `${machineryTotal.toLocaleString(displayLocale())} ${ui("د.ع")}`, icon: Banknote },
          ].map((stat) => (
            <Card key={stat.label} className="rounded-2xl">
              <div className="flex items-center justify-between p-4">
                <div><p className="text-sm text-muted-foreground">{ui(stat.label)}</p><p className="mt-1 text-xl font-bold tabular-nums">{machineryReport.isPending ? "—" : stat.value}</p></div>
                <span className="rounded-xl bg-primary/10 p-2.5 text-primary"><stat.icon className="h-5 w-5" /></span>
              </div>
            </Card>
          ))}
        </section>
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{ui("تشغيل الآليات خلال ")}{month}</h2>
              <p className="text-xs text-muted-foreground">{ui("عدد الآليات المسجل لها تشغيل يومياً في الصفحة الحالية")}</p>
            </div>
            <div className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 rounded-full bg-teal-500" />{ui(" آليات عاملة")}</div>
          </div>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={machineryDailyChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tickFormatter={(value) => Number(value).toLocaleString(displayLocale())} />
                <YAxis allowDecimals={false} width={36} />
                <Tooltip labelFormatter={(value) => `اليوم ${Number(value).toLocaleString(displayLocale())}`} formatter={(value) => [`${Number(value).toLocaleString(displayLocale())} آلية`, "عاملة"]} />
                <Line type="monotone" dataKey="operating" name="آليات عاملة" stroke="#14b8a6" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b p-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Cog className="h-5 w-5 text-primary" />{ui(" كشف حضور الآليات")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{ui("سجل شهري يومي قابل للمراجعة والتعديل · التكلفة = أيام التشغيل × الإيجار اليومي.")}</p>
              </div>
              <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="machinery-report-month">{ui("الشهر")}</Label>
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
                  <Label htmlFor="machinery-report-search">{ui("بحث برقم الآلية")}</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="machinery-report-search"
                      className="pr-9"
                      placeholder={ui("رقم الأصل أو الكود")}
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
                <p className="text-destructive">{ui("تعذر تحميل حضور الآليات: ")}{machineryReport.error.message}
                </p>
                <p className="text-sm text-muted-foreground">{ui("تحقق من تطبيق ترحيل سجل حضور الآليات في قاعدة البيانات.")}</p>
                <Button variant="outline" onClick={() => void machineryReport.refetch()}>{ui("إعادة المحاولة")}</Button>
              </div>
            ) : machineryReport.isPending ? (
              <p role="status" className="p-10 text-center text-muted-foreground">{ui("جارٍ تحميل سجل الآليات…")}</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex flex-wrap gap-4 border-b p-3 text-xs text-muted-foreground">
                  <span><b className="ml-1 text-emerald-700">✓</b>{ui(" تم تسجيل تشغيل الآلية في ذلك اليوم")}</span>
                  <span><b className="ml-1">—</b>{ui(" لا يوجد تشغيل مسجل")}</span>
                  <span>{ui("استخدم «تعديل الأيام» لتسجيل الدوام أو تغييره")}</span>
                </div>
                <table className="w-full min-w-[1500px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-right">
                      <th className="sticky right-0 z-10 min-w-48 bg-muted/40 p-3">{ui("الآلية / الرقم")}</th>
                      <th className="p-3">{ui("التصنيف والحالة")}</th>
                      {monthDays.map((date) => <th key={date} className="min-w-12 p-2 text-center"><span>{Number(date.slice(-2)).toLocaleString(displayLocale())}</span><small className="block text-muted-foreground">{weekday(date)}</small></th>)}
                      <th className="p-3">{ui("أيام التشغيل")}</th>
                      <th className="p-3">{ui("الإيجار اليومي")}</th>
                      <th className="p-3">{ui("الإجمالي")}</th>
                      <th className="p-3">{ui("إجراء")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineryRows.map((machine) => (
                      <tr key={machine.id} className="border-b hover:bg-muted/20">
                        <td className="sticky right-0 z-[1] bg-background p-3 font-medium">{machine.name}<small className="block text-muted-foreground">{machine.asset_number || machine.code}</small></td>
                        <td className="p-3">{machine.category || "—"}<small className="block text-muted-foreground">{machine.status === "active" ? ui("نشطة") : machine.status === "maintenance" ? ui("قيد الصيانة") : ui("متوقفة")}</small></td>
                        {monthDays.map((date) => {
                          const operated = machine.operatingDates.includes(date);
                          return <td key={date} className="border-x p-1 text-center"><span className={cn("inline-flex h-8 min-w-8 items-center justify-center rounded font-bold", operated ? "bg-emerald-100 text-emerald-800" : "bg-muted/60 text-muted-foreground")}>{operated ? "✓" : "—"}</span></td>;
                        })}
                        <td className="p-3 tabular-nums">
                          {machine.operatingDays.toLocaleString(displayLocale())}{ui(" يوم")}</td>
                        <td className="p-3 tabular-nums">
                          {Number(machine.daily_rent).toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                        <td className="p-3 font-bold tabular-nums">
                          {machine.total.toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActiveMachinery(machine);
                              setMachineryDatesDraft(machine.operatingDates);
                            }}
                          >
                            <CalendarDays className="ml-2 h-4 w-4" />{ui(" تعديل الأيام")}</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-bold">
                      <td className="sticky right-0 z-[1] bg-muted/30 p-3" colSpan={2}>{ui("الآليات المعروضة: ")}{machineryRows.length.toLocaleString(displayLocale())}{ui(" من أصل ")}{machineryCount.toLocaleString(displayLocale())}
                      </td>
                      {monthDays.map((date) => <td key={date} className="p-1" />)}
                      <td className="p-3">
                        {machineryRows
                          .reduce((sum, machine) => sum + machine.operatingDays, 0)
                          .toLocaleString(displayLocale())}{" "}{ui("يوم")}</td>
                      <td className="p-3">—</td>
                      <td className="p-3">{machineryTotal.toLocaleString(displayLocale())}{ui(" د.ع")}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                {!machineryRows.length && (
                  <p className="p-10 text-center text-muted-foreground">{ui("لا توجد آليات تطابق رقم البحث.")}</p>
                )}
                {machineryCount > 50 && (
                  <div className="flex items-center justify-between gap-3 border-t p-4">
                    <Button
                      variant="outline"
                      disabled={machineryPage === 0 || machineryReport.isFetching}
                      onClick={() => setMachineryPage((current) => Math.max(0, current - 1))}
                    >{ui("الصفحة السابقة")}</Button>
                    <span className="text-sm text-muted-foreground">{ui("صفحة ")}{(machineryPage + 1).toLocaleString(displayLocale())}{ui(" من ")}{machineryPageCount.toLocaleString(displayLocale())}{ui(" · 50 آلية كحد أقصى")}</span>
                    <Button
                      variant="outline"
                      disabled={machineryPage + 1 >= machineryPageCount || machineryReport.isFetching}
                      onClick={() => setMachineryPage((current) => current + 1)}
                    >{ui("الصفحة التالية")}</Button>
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
        <DialogContent dir={direction()} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
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
        <DialogContent dir={direction()} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeMachinery && (
            <MonthlyOperatingDaysForm
              title={ui("تسجيل أيام تشغيل الآلية")}
              subtitle={`${activeMachinery.name} · ${activeMachinery.asset_number || activeMachinery.code} · ${month}`}
              month={month}
              dailyRate={Number(activeMachinery.daily_rent ?? 0)}
              dates={machineryDatesDraft}
              setDates={setMachineryDatesDraft}
              saving={saveMachineryAttendance.isPending}
              onSave={() => saveMachineryAttendance.mutate()}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeVehicle}
        onOpenChange={(open) => {
          if (!open) setActiveVehicle(null);
        }}
      >
        <DialogContent dir={direction()} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeVehicle && (
            <MonthlyOperatingDaysForm
              title={ui("تسجيل أيام تشغيل المركبة")}
              subtitle={`${activeVehicle.name} · ${activeVehicle.vehicle_no} · ${month}`}
              month={month}
              dailyRate={Number(activeVehicle.daily_rate ?? 0)}
              dates={vehicleDatesDraft}
              setDates={setVehicleDatesDraft}
              saving={saveVehicleAttendance.isPending}
              onSave={() => saveVehicleAttendance.mutate()}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonthlyOperatingDaysForm({
  title,
  subtitle,
  month,
  dailyRate,
  dates,
  setDates,
  saving,
  onSave,
}: {
  title: string;
  subtitle: string;
  month: string;
  dailyRate: number;
  dates: string[];
  setDates: React.Dispatch<React.SetStateAction<string[]>>;
  saving: boolean;
  onSave: () => void;
}) {
  const allDates = datesInMonth(month);
  const firstWeekday = new Date(`${month}-01T00:00:00`).getDay();
  const daysOfWeek = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{subtitle}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" />{ui(" يوم تشغيل مسجل")}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border bg-background" />{ui(" لا يوجد تشغيل")}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDates([])}>{ui("مسح أيام الشهر")}</Button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {daysOfWeek.map((day) => <div key={day} className="py-2 text-center text-[10px] font-medium text-muted-foreground sm:text-xs">{day}</div>)}
        {Array.from({ length: firstWeekday }, (_, index) => <div aria-hidden="true" key={`blank-${index}`} />)}
        {allDates.map((date) => {
          const selected = dates.includes(date);
          const day = Number(date.slice(-2));
          return (
            <Button
              key={date}
              type="button"
              variant="outline"
              aria-pressed={selected}
              aria-label={((day) + " " + (selected ? "يوم تشغيل مسجل" : "لا يوجد تشغيل"))}
              className={cn("h-11 flex-col gap-0 p-1 sm:h-12", selected && "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white")}
              onClick={() => setDates((current) => selected ? current.filter((item) => item !== date) : [...current, date].sort())}
            >
              <span className="text-sm font-bold">{day.toLocaleString(displayLocale())}</span>
              <span className={cn("text-[9px]", selected ? "text-emerald-50" : "text-muted-foreground")}>{selected ? ui("عمل") : "—"}</span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm">{ui("أيام التشغيل: ")}<b>{dates.length.toLocaleString(displayLocale())}</b>{ui(" · الأجر اليومي: ")}<b>{dailyRate.toLocaleString(displayLocale())}{ui(" د.ع")}</b>{ui(" · الإجمالي: ")}<b>{(dates.length * dailyRate).toLocaleString(displayLocale())}{ui(" د.ع")}</b></p>
        <Button onClick={onSave} disabled={saving}>{saving ? ui("جارٍ الحفظ…") : ui("حفظ أيام التشغيل")}</Button>
      </div>
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
      toast.success(ui("تم تحديث اليوم"));
    },
    onError: (e: Error) => toast.error(ui(formatErrorMessage(e))),
  });
  const day = data?.days.find((d) => d.date === date);
  const status = day?.status ? computedStatusLabels[day.status] : undefined;
  return (
    <>
      <DialogHeader className="pt-3 sm:text-right">
        <DialogTitle>
          {data ? `${data.employee.full_name} — ${data.employee.employee_no}` : ui("تفاصيل الموظف")}
        </DialogTitle>
        <DialogDescription>{ui("تفاصيل الحضور والأجر لشهر ")}{month}</DialogDescription>
      </DialogHeader>
      {isPending && <p role="status">{ui("جارٍ تحميل التفاصيل...")}</p>}
      {error && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{ui("تعذر تحميل التفاصيل: ")}{error.message}</p>
          <Button variant="outline" onClick={() => refetch()}>{ui("إعادة المحاولة")}</Button>
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
                  {data.employee.departments?.name ?? ui("بدون قسم")} ·{" "}
                  {data.employee.shifts?.name ?? ui("بدون دوام")}
                  {data.employee.sites ? ` · ${data.employee.sites.name}` : ""}
                </p>
              </div>
              <span className="mr-auto rounded-full bg-background/20 px-3 py-1 text-xs font-semibold">
                {data.payroll.payType === "daily" ? ui("أجر يومي") : ui("راتب شهري")}
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
                  <p className="text-[11px] opacity-90">{ui(label)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{ui("أيام الشهر — اختر يوماً")}</Label>
            <div className="grid grid-cols-7 gap-1.5">
              {data.days.map((d) => {
                const s = d.status ? computedStatusLabels[d.status] : undefined;
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
                {ui(status?.label) ?? ui("لم يحن موعده")}
              </span>
              <span className="text-xs text-muted-foreground">
                {day.manual ? ui("تعديل يدوي") : day.punches ? ui("البصمة") : ui("لا توجد بصمات")}
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
                  <dt className="text-xs text-muted-foreground">{ui(label)}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 space-y-2">
              <Label htmlFor="day-status">{ui("تعديل حالة اليوم")}</Label>
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
                <option value="auto">{ui("تلقائي (البصمة)")}</option>
                {statuses.map((s) => (
                  <option key={s.value} value={s.value}>
                    {ui(s.label)}
                  </option>
                ))}
              </select>
              {mutation.isPending && (
                <p role="status" className="text-xs text-muted-foreground">{ui("جارٍ الحفظ...")}</p>
              )}
              {day.notes && <p className="text-xs text-muted-foreground">{day.notes}</p>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {summaryColumns.map((column) => (
              <div key={column.key}>
                <p className="text-xs text-muted-foreground">{ui(column.label)}</p>
                <p className={cn("mt-1 font-semibold", column.className)}>
                  {data.summary[column.key]}
                </p>
              </div>
            ))}
          </div>
          <section className="border-t pt-4">
            <h3 className="mb-3 font-semibold">{ui("ملخص الأجر — ")}{data.payroll.payType === "daily" ? ui("موظف يومي") : ui("موظف شهري")}
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
                  <dt className="text-xs text-muted-foreground">{ui(label)}</dt>
                  <dd className="mt-1 font-semibold">
                    {value.toLocaleString()}{" "}
                    {label.includes("أيام") || label.includes("الأيام")
                      ? ui("يوم")
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

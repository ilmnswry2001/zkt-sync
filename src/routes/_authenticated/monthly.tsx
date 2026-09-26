import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, RefreshCw, Search } from "lucide-react";
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
  rows: SheetRow[],
  field: "departments" | "sites" | "shifts",
  idField: "department_id" | "site_id" | "shift_id",
) {
  const options = new Map<string, string>();
  for (const { employee } of rows) {
    const id = employee[idField];
    const name = employee[field]?.name;
    if (id && name) options.set(id, name);
  }
  return [...options].sort((a, b) => a[1].localeCompare(b[1], "ar"));
}

function MonthlyPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [site, setSite] = useState("");
  const [shift, setShift] = useState("");
  const [summarized, setSummarized] = useState(false);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{ employeeId: string; date: string } | null>(null);
  const fetchSheet = useServerFn(getMonthlySheet);
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["monthly", "sheet", month],
    queryFn: () => fetchSheet({ data: { month } }),
  });
  const filters = useMemo(
    () => ({
      departments: optionsFor(data?.rows ?? [], "departments", "department_id"),
      sites: optionsFor(data?.rows ?? [], "sites", "site_id"),
      shifts: optionsFor(data?.rows ?? [], "shifts", "shift_id"),
    }),
    [data],
  );
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        ({ employee: e }) =>
          (!employeeId || e.id === employeeId) &&
          (!department || e.department_id === department) &&
          (!site || e.site_id === site) &&
          (!shift || e.shift_id === shift) &&
          (!search.trim() ||
            `${e.employee_no} ${e.full_name}`
              .toLocaleLowerCase("ar")
              .includes(search.trim().toLocaleLowerCase("ar"))),
      ),
    [data, employeeId, department, site, shift, search],
  );
  const chart = useMemo(
    () => dailyTotals(data?.dates ?? [], rows, data?.today ?? ""),
    [data, rows],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * 50, (currentPage + 1) * 50);
  const employeeOptions = (data?.rows ?? []).filter(
    ({ employee: e }) =>
      !search.trim() ||
      `${e.employee_no} ${e.full_name}`
        .toLocaleLowerCase("ar")
        .includes(search.trim().toLocaleLowerCase("ar")),
  );
  const selectedEmployee = data?.rows.find(({ employee }) => employee.id === employeeId);
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
              {selectedEmployee && !employeeOptions.some((r) => r.employee.id === employeeId) && (
                <option value={employeeId}>{selectedEmployee.employee.full_name}</option>
              )}
              {employeeOptions.map(({ employee: e }) => (
                <option key={e.id} value={e.id}>
                  {e.employee_no} — {e.full_name}
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
                {rows.length.toLocaleString("ar")} موظف
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
              <span className={cn("rounded px-1.5 py-0.5 font-bold", status.className)} dir="ltr">
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
            {data?.rows.length
              ? "لا يوجد موظفون يطابقون الفلاتر المحددة"
              : "لا يوجد موظفون لعرضهم في التقرير"}
          </p>
        ) : (
          <>
            <section className="border-b p-4" aria-labelledby="attendance-chart-title">
              <h2 id="attendance-chart-title" className="mb-3 text-sm font-medium">
                الحضور والغياب خلال الشهر
              </h2>
              <div
                dir="ltr"
                className="h-56 w-full"
                role="img"
                aria-label="رسم يومي للحضور والغياب والإجازات للموظفين المطابقين للفلاتر"
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
                الرسم يشمل جميع نتائج الفلاتر، والإجماليات بالساعات. الأيام المستقبلية بلا تسجيل لا
                تُحتسب غيابًا.
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
                          className={cn("text-center font-semibold tabular-nums", column.className)}
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
                · {rows.length} موظف
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
    onError: (e: Error) => toast.error(e.message),
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
          <p className="text-muted-foreground">
            {data.employee.departments?.name ?? "بدون قسم"} ·{" "}
            {data.employee.shifts?.name ?? "بدون دوام"}
            {data.employee.sites ? ` · ${data.employee.sites.name}` : ""}
          </p>
          <div className="space-y-2">
            <Label htmlFor="detail-day">اليوم</Label>
            <select
              id="detail-day"
              className={selectClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={mutation.isPending}
            >
              {data.days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date} · {weekday(d.date)}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border p-4">
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
                    ? ([
                        ["أيام الجمعة المحتسبة", data.payroll.paidDays],
                        ["الأيام المدفوعة", data.payroll.paidDays],
                      ] as [string, number][])
                    : []),
                  ["أجر الحضور", data.payroll.basePay],
                  ["الإضافات والمكافآت", data.payroll.additionsTotal],
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

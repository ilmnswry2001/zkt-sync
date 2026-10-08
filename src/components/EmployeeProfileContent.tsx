import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRight,
  Award,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileWarning,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  UserRound,
  WalletCards,
} from "lucide-react";

type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  status: string;
  department_id: string | null;
  site_id: string | null;
  email: string | null;
  phone1: string | null;
  phone2: string | null;
  hire_date: string | null;
  birth_date: string | null;
  nationality: string | null;
  gender: string | null;
  marital_status: string | null;
  education: string | null;
  address: string | null;
  base_salary: number | null;
  pay_type: string | null;
  salary_type: string | null;
  contract_type: string | null;
  contract_end_date: string | null;
  id_no: string | null;
  erp_no: string | null;
  ctr_code: string | null;
  notes: string | null;
  departments?: { name: string } | null;
  sites?: { name: string; ctr_code: string | null } | null;
  wage_rates?: {
    title: string;
    monthly_rate: number;
    daily_rate: number;
    overtime_hour_rate: number;
  } | null;
};
type Attendance = {
  id: string;
  work_date: string;
  status: string;
  overtime_hours: number;
  notes: string | null;
};
type Punch = { id: string; verify_time: string; verify_type: number | null };
type Form = {
  id: string;
  work_date: string;
  kind: string;
  status: string;
  overtime_hours: number;
  reason: string;
  check_in: string | null;
  check_out: string | null;
};
type Penalty = {
  id: string;
  penalty_date: string;
  penalty_type: string;
  deduction_amount: number;
  notes: string | null;
  executed_at: string | null;
};
type Task = {
  id: string;
  task_date: string;
  title: string;
  description: string | null;
  status: string;
  duration_minutes: number;
  manager_note: string | null;
};
type Addition = {
  id: string;
  month: string;
  kind: string;
  description: string | null;
  amount: number;
  created_at: string;
};
type Custody = {
  item_id: string;
  item_code: string | null;
  item_name: string;
  unit: string;
  warehouse_name: string;
  remaining_qty: number;
  received_date: string;
};
type Clearance = {
  clearance_status: string;
  has_open_custody: boolean;
  notes: string | null;
  created_at: string;
};

const monthBounds = (month: string) => ({ start: `${month}-01`, end: `${month}-31` });
const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("ar-IQ", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const fmtMoney = (value: number) => `${Number(value || 0).toLocaleString("ar-IQ")} د.ع`;
const statusText: Record<string, string> = {
  present: "حاضر",
  absent: "غائب",
  leave: "إجازة",
  holiday: "عطلة",
  rest: "راحة",
  pending: "قيد الانتظار",
  completed: "منجزة",
  in_progress: "قيد التنفيذ",
  cancelled: "ملغاة",
  absence: "غياب",
  deduction: "استقطاع",
  warning: "إنذار",
  attendance: "دوام",
  overtime: "وقت إضافي",
};

function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  note?: string;
  icon: typeof Clock3;
  tone: string;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <CardContent className="relative p-4">
        <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
        {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export function EmployeeProfileContent({
  employeeId,
  embedded = false,
}: {
  employeeId: string;
  embedded?: boolean;
}) {
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const { data, isLoading, error } = useQuery({
    queryKey: ["employee-profile", employeeId, month],
    queryFn: async () => {
      const bounds = monthBounds(month);
      const { data: employee, error: employeeError } = await (supabase as any)
        .from("employees")
        .select(
          "*, departments(name), sites!site_id(name, ctr_code), wage_rates(title, monthly_rate, daily_rate, overtime_hour_rate)",
        )
        .eq("id", employeeId)
        .single();
      if (employeeError) throw employeeError;
      const safe = async <T,>(
        request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
      ) => {
        const result = await request;
        return result.error ? ([] as T[]) : ((result.data ?? []) as T[]);
      };
      const [attendance, punches, forms, penalties, tasks, additions, custody, clearances] =
        await Promise.all([
          safe<Attendance>(
            (supabase as any)
              .from("attendance_day_status")
              .select("id, work_date, status, overtime_hours, notes")
              .eq("employee_id", employeeId)
              .gte("work_date", bounds.start)
              .lte("work_date", bounds.end)
              .order("work_date", { ascending: false }),
          ),
          safe<Punch>(
            (supabase as any)
              .from("attendance_logs")
              .select("id, verify_time, verify_type")
              .eq("employee_id", employeeId)
              .gte("verify_time", `${bounds.start}T00:00:00`)
              .lte("verify_time", `${bounds.end}T23:59:59`)
              .order("verify_time", { ascending: false })
              .limit(200),
          ),
          safe<Form>(
            (supabase as any)
              .from("forms")
              .select("id, work_date, kind, status, overtime_hours, reason, check_in, check_out")
              .eq("employee_id", employeeId)
              .gte("work_date", bounds.start)
              .lte("work_date", bounds.end)
              .order("work_date", { ascending: false }),
          ),
          safe<Penalty>(
            (supabase as any)
              .from("employee_penalties")
              .select("id, penalty_date, penalty_type, deduction_amount, notes, executed_at")
              .eq("employee_id", employeeId)
              .order("penalty_date", { ascending: false }),
          ),
          safe<Task>(
            (supabase as any)
              .from("employee_tasks")
              .select("id, task_date, title, description, status, duration_minutes, manager_note")
              .eq("employee_id", employeeId)
              .gte("task_date", bounds.start)
              .lte("task_date", bounds.end)
              .order("task_date", { ascending: false }),
          ),
          safe<Addition>(
            (supabase as any)
              .from("salary_additions")
              .select("id, month, kind, description, amount, created_at")
              .eq("employee_id", employeeId)
              .gte("month", bounds.start)
              .lte("month", `${month}-31`)
              .order("month", { ascending: false }),
          ),
          safe<Custody>((supabase as any).rpc("get_employee_custody", { emp_id: employeeId })),
          safe<Clearance>(
            (supabase as any)
              .from("employee_clearances")
              .select("clearance_status, has_open_custody, notes, created_at")
              .eq("employee_id", employeeId)
              .order("created_at", { ascending: false })
              .limit(1),
          ),
        ]);
      return {
        employee: employee as Employee,
        attendance,
        punches,
        forms,
        penalties,
        tasks,
        additions,
        custody,
        clearances,
      };
    },
  });
  const employee = data?.employee;
  const stats = useMemo(() => {
    const attendance = data?.attendance ?? [];
    const forms = data?.forms ?? [];
    const tasks = data?.tasks ?? [];
    const penalties = data?.penalties ?? [];
    const additions = data?.additions ?? [];
    const overtime =
      attendance.reduce((sum, row) => sum + Number(row.overtime_hours || 0), 0) +
      forms
        .filter((row) => row.kind === "overtime")
        .reduce((sum, row) => sum + Number(row.overtime_hours || 0), 0);
    return {
      present: attendance.filter((row) => row.status === "present").length,
      leave:
        attendance.filter((row) => row.status === "leave").length +
        forms.filter((row) => row.kind === "leave").length,
      absent: attendance.filter((row) => row.status === "absent").length,
      overtime,
      tasks: tasks.length,
      completed: tasks.filter((row) => ["completed", "done", "executed"].includes(row.status))
        .length,
      penalties: penalties.length,
      deductions: penalties.reduce((sum, row) => sum + Number(row.deduction_amount || 0), 0),
      additions: additions.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    };
  }, [data]);

  if (isLoading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (error || !employee)
    return (
      <Card>
        <CardContent className="p-8 text-center text-destructive">
          تعذر تحميل ملف الموظف. {(error as Error)?.message ?? "الموظف غير موجود"}
        </CardContent>
      </Card>
    );
  return (
    <div dir="rtl" className="space-y-6 pb-10">
      {!embedded && (
        <Link
          to="/employees"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" /> العودة إلى الموظفين
        </Link>
      )}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-primary p-6 text-white shadow-xl md:p-8">
        <div className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 text-3xl font-bold ring-1 ring-white/20">
              {employee.full_name.slice(0, 1)}
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/20">
                  {employee.status === "active" ? "موظف نشط" : employee.status}
                </Badge>
                <span className="text-sm text-white/60">#{employee.employee_no}</span>
              </div>
              <h1 className="text-3xl font-bold md:text-4xl">{employee.full_name}</h1>
              <p className="mt-1 text-white/70">
                {employee.position || "المسمى الوظيفي غير محدد"} ·{" "}
                {employee.departments?.name || "بدون قسم"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[280px]">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/60">الموقع</p>
              <p className="mt-1 font-semibold">{employee.sites?.name || "غير محدد"}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/60">تاريخ المباشرة</p>
              <p className="mt-1 font-semibold">{fmtDate(employee.hire_date)}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold">لوحة الأداء الشهرية</h2>
          <p className="text-sm text-muted-foreground">
            الإحصائيات مرتبطة بسجلات الحضور والمهام والاستمارات والعقوبات الفعلية.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          الشهر{" "}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-lg border bg-background px-3"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric
          label="أيام الدوام"
          value={stats.present}
          icon={CalendarDays}
          tone="bg-emerald-600"
        />
        <Metric
          label="ساعات إضافية"
          value={`${stats.overtime} س`}
          icon={Clock3}
          tone="bg-indigo-600"
        />
        <Metric label="الإجازات" value={stats.leave} icon={BriefcaseBusiness} tone="bg-sky-600" />
        <Metric label="أيام الغياب" value={stats.absent} icon={ShieldAlert} tone="bg-rose-600" />
        <Metric label="مهام الشهر" value={stats.tasks} icon={ClipboardList} tone="bg-violet-600" />
        <Metric label="مهام منجزة" value={stats.completed} icon={CheckCircle2} tone="bg-teal-600" />
        <Metric label="العقوبات" value={stats.penalties} icon={FileWarning} tone="bg-orange-600" />
        <Metric
          label="الإضافات"
          value={fmtMoney(stats.additions)}
          icon={Award}
          tone="bg-amber-600"
        />
      </div>
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:grid-cols-3 lg:grid-cols-7">
          <TabsTrigger value="overview" className="min-h-11 rounded-xl border">
            نظرة عامة
          </TabsTrigger>
          <TabsTrigger value="attendance" className="min-h-11 rounded-xl border">
            الحضور والبصمة
          </TabsTrigger>
          <TabsTrigger value="leave" className="min-h-11 rounded-xl border">
            الإجازات والعقوبات
          </TabsTrigger>
          <TabsTrigger value="tasks" className="min-h-11 rounded-xl border">
            المهام
          </TabsTrigger>
          <TabsTrigger value="finance" className="min-h-11 rounded-xl border">
            الأجور والبدلات
          </TabsTrigger>
          <TabsTrigger value="custody" className="min-h-11 rounded-xl border">
            العهدة وبراءة الذمة
          </TabsTrigger>
          <TabsTrigger value="identity" className="min-h-11 rounded-xl border">
            البيانات والملفات
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>ملخص نشاط {employee.full_name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Info icon={UserRound} label="الرقم الوظيفي" value={employee.employee_no} />
              <Info
                icon={BriefcaseBusiness}
                label="المسمى والقسم"
                value={`${employee.position || "غير محدد"} · ${employee.departments?.name || "بدون قسم"}`}
              />
              <Info
                icon={MapPin}
                label="الموقع"
                value={`${employee.sites?.name || "غير محدد"}${employee.sites?.ctr_code ? ` · ${employee.sites.ctr_code}` : ""}`}
              />
              <Info
                icon={WalletCards}
                label="الأجر الأساسي"
                value={`${fmtMoney(Number(employee.base_salary || employee.wage_rates?.monthly_rate || 0))} · ${employee.pay_type === "daily" ? "يومي" : "شهري"}`}
              />
              <Info
                icon={CalendarDays}
                label="تاريخ المباشرة"
                value={fmtDate(employee.hire_date)}
              />
              <Info
                icon={Phone}
                label="الهاتف"
                value={employee.phone1 || employee.phone2 || "غير محدد"}
              />
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-b from-primary/10 to-card">
            <CardHeader>
              <CardTitle>مؤشر الإنجاز</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-primary">
                  {stats.tasks ? Math.round((stats.completed / stats.tasks) * 100) : 0}
                </span>
                <span className="mb-2 text-muted-foreground">%</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">نسبة المهام المنجزة خلال {month}</p>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${stats.tasks ? Math.min(100, (stats.completed / stats.tasks) * 100) : 0}%`,
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="attendance" className="space-y-4">
          <DataCard
            title={`سجل الحضور — ${month}`}
            headers={["التاريخ", "الحالة", "الساعات الإضافية", "ملاحظات"]}
            rows={(data?.attendance ?? []).map((row) => [
              fmtDate(row.work_date),
              statusText[row.status] || row.status,
              `${Number(row.overtime_hours || 0)} ساعة`,
              row.notes || "—",
            ])}
            empty="لا توجد سجلات حضور معتمدة لهذا الشهر."
          />
          <DataCard
            title="آخر سجلات البصمة"
            headers={["وقت البصمة", "نوع التحقق"]}
            rows={(data?.punches ?? [])
              .slice(0, 30)
              .map((row) => [
                new Date(row.verify_time).toLocaleString("ar-IQ"),
                row.verify_type == null ? "—" : String(row.verify_type),
              ])}
            empty="لا توجد سجلات بصمة مرتبطة بهذا الموظف."
          />
        </TabsContent>
        <TabsContent value="leave" className="grid gap-4 lg:grid-cols-2">
          <DataCard
            title="الإجازات والاستمارات"
            headers={["التاريخ", "النوع", "الحالة", "السبب"]}
            rows={(data?.forms ?? [])
              .filter((row) => row.kind === "leave")
              .map((row) => [
                fmtDate(row.work_date),
                statusText[row.kind] || row.kind,
                statusText[row.status] || row.status,
                row.reason || "—",
              ])}
            empty="لا توجد إجازات مسجلة لهذا الشهر."
          />
          <DataCard
            title="العقوبات والسجل التأديبي"
            headers={["التاريخ", "النوع", "المبلغ", "التنفيذ"]}
            rows={(data?.penalties ?? []).map((row) => [
              fmtDate(row.penalty_date),
              statusText[row.penalty_type] || row.penalty_type,
              fmtMoney(row.deduction_amount),
              row.executed_at ? "منفذة" : "غير منفذة",
            ])}
            empty="لا توجد عقوبات مسجلة لهذا الموظف."
          />
        </TabsContent>
        <TabsContent value="tasks">
          <DataCard
            title={`مهام الموظف — ${month}`}
            headers={["التاريخ", "المهمة", "الحالة", "المدة", "ملاحظة المدير"]}
            rows={(data?.tasks ?? []).map((row) => [
              fmtDate(row.task_date),
              row.title,
              statusText[row.status] || row.status,
              `${row.duration_minutes || 0} دقيقة`,
              row.manager_note || "—",
            ])}
            empty="لا توجد مهام مسجلة لهذا الشهر."
          />
        </TabsContent>
        <TabsContent value="finance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>الأجر الأساسي ومعدل الإضافي</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Info
                icon={Banknote}
                label="الأجر الأساسي"
                value={fmtMoney(
                  Number(employee.base_salary || employee.wage_rates?.monthly_rate || 0),
                )}
              />
              <Info
                icon={WalletCards}
                label="أجر التخصص"
                value={employee.wage_rates?.title || "غير محدد"}
              />
              <Info
                icon={Clock3}
                label="أجر ساعة إضافية"
                value={fmtMoney(Number(employee.wage_rates?.overtime_hour_rate || 0))}
              />
            </CardContent>
          </Card>
          <DataCard
            title="الإضافات والمكافآت"
            headers={["الشهر", "النوع", "الوصف", "المبلغ"]}
            rows={(data?.additions ?? []).map((row) => [
              row.month,
              row.kind,
              row.description || "—",
              fmtMoney(row.amount),
            ])}
            empty="لا توجد إضافات أو مكافآت لهذا الشهر."
          />
        </TabsContent>
        <TabsContent value="custody" className="space-y-4">
          <DataCard
            title="العِهد المفتوحة"
            headers={["الصنف", "الرمز", "المخزن", "الكمية", "تاريخ التسليم"]}
            rows={(data?.custody ?? []).map((row) => [
              row.item_name,
              row.item_code || "—",
              row.warehouse_name,
              String(row.remaining_qty),
              fmtDate(row.received_date),
            ])}
            empty="لا توجد عِهد مفتوحة لهذا الموظف."
          />
          {data?.clearances?.length ? (
            <DataCard
              title="آخر براءة ذمة"
              headers={["الحالة", "عهد مفتوحة", "التاريخ", "ملاحظات"]}
              rows={data.clearances.map((row) => [
                statusText[row.clearance_status] || row.clearance_status,
                row.has_open_custody ? "نعم" : "لا",
                fmtDate(row.created_at.slice(0, 10)),
                row.notes || "—",
              ])}
              empty=""
            />
          ) : (
            <Empty text="لم تصدر براءة ذمة لهذا الموظف بعد." />
          )}
        </TabsContent>
        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle>البيانات الوظيفية والشخصية</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Info icon={Mail} label="البريد الإلكتروني" value={employee.email || "غير محدد"} />
              <Info icon={Phone} label="الهاتف" value={employee.phone1 || "غير محدد"} />
              <Info
                icon={UserRound}
                label="الجنسية / الجنس"
                value={`${employee.nationality || "—"} · ${employee.gender || "—"}`}
              />
              <Info
                icon={BriefcaseBusiness}
                label="نوع العقد"
                value={`${employee.contract_type || "غير محدد"}${employee.contract_end_date ? ` · ينتهي ${fmtDate(employee.contract_end_date)}` : ""}`}
              />
              <Info icon={ShieldAlert} label="رقم الهوية" value={employee.id_no || "غير محدد"} />
              <Info icon={MapPin} label="العنوان" value={employee.address || "غير محدد"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>ملاحظات الموظف</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-muted-foreground">
              {employee.notes || "لا توجد ملاحظات محفوظة."}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </div>
      <p className="font-medium">{value}</p>
    </div>
  );
}
function DataCard({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b text-right">
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-3 font-semibold text-muted-foreground">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${index}-${row[0]}`}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    {row.map((cell, cellIndex) => (
                      <td key={`${index}-${cellIndex}`} className="px-3 py-3">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text={empty} />
        )}
      </CardContent>
    </Card>
  );
}

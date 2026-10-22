import { formatErrorMessage } from "@/lib/error-message";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { FaceCameraDialog } from "@/components/FaceCameraDialog";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
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
  ScanFace,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  WalletCards,
  Wrench,
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
  employee_import_data?: Record<string, string | number | boolean | null> | null;
  face_descriptor?: number[] | null;
  face_enrolled_at?: string | null;
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
type CustodyRow = {
  movement_id: string;
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string;
  received_date: string;
  warehouse_id: string;
  warehouse_name: string;
  remaining_qty: number;
};
type Clearance = {
  id: string;
  clearance_status: "pending" | "approved" | "rejected";
  cleared_by: string | null;
  created_at: string;
  has_open_custody: boolean;
  notes: string | null;
};
const EMPTY_CUSTODY: CustodyRow[] = [];
const EMPTY_CLEARANCES: Clearance[] = [];

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
function printClearanceDocument(employee: Employee, clearance: Clearance) {
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) return false;
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char,
    );
  const issuedDate = new Date(clearance.created_at).toLocaleDateString("ar-IQ", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  popup.document.write(
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>براءة ذمة - ${escapeHtml(employee.full_name)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18212b;line-height:1.9}.header{text-align:center;border-bottom:3px solid #0f766e;padding-bottom:18px}.header h1{font-size:25px;margin:0}.header p{margin:4px 0;color:#52616b}.stamp{margin:34px auto;padding:24px;border:2px solid #15803d;border-radius:8px;text-align:center;color:#166534;font-size:20px;font-weight:bold}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.field{border:1px solid #cbd5e1;border-radius:6px;padding:12px}.label{display:block;color:#64748b;font-size:12px}.statement{margin-top:26px;text-align:justify}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:100px;text-align:center}.line{border-top:1px solid #334155;margin-top:54px;padding-top:8px}.footer{margin-top:60px;border-top:1px solid #cbd5e1;padding-top:10px;color:#64748b;font-size:11px;text-align:center}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="header"><h1>براءة ذمة إلكترونية</h1><p>إدارة الموارد البشرية والمخازن</p></header><div class="stamp">تشهد الإدارة بخلو ذمة الموظف من العدد والأدوات</div><section class="details"><div class="field"><span class="label">اسم الموظف</span>${escapeHtml(employee.full_name)}</div><div class="field"><span class="label">الرقم الوظيفي</span>${escapeHtml(employee.employee_no)}</div><div class="field"><span class="label">القسم</span>${escapeHtml(employee.departments?.name || "—")}</div><div class="field"><span class="label">المسمى الوظيفي</span>${escapeHtml(employee.position || "—")}</div><div class="field"><span class="label">الموقع</span>${escapeHtml(employee.sites?.name || "—")}</div><div class="field"><span class="label">رقم البراءة</span>${escapeHtml(clearance.id)}</div><div class="field"><span class="label">تاريخ الإصدار</span>${escapeHtml(issuedDate)}</div><div class="field"><span class="label">حالة العهدة</span>لا توجد عهد أدوات مفتوحة</div></section><p class="statement">تؤكد هذه الوثيقة، وفق سجل حركات المخازن حتى تاريخ الإصدار أعلاه، أن الموظف المذكور لا توجد في ذمته أي عدد أو أدوات غير مسترجعة. صدرت هذه البراءة للاستخدام الإداري الرسمي.</p><section class="signatures"><div class="line">الموارد البشرية / الإدارة</div><div class="line">مسؤول المخازن</div></section><footer class="footer">وثيقة صادرة إلكترونيًا من منظومة زِكت</footer><script>window.onload=()=>window.print()</script></body></html>`,
  );
  popup.document.close();
  return true;
}
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
  const queryClient = useQueryClient();
  const { roles, isAdmin, isHR, user } = useAuth();
  const canEnrollFace = isAdmin || isHR || roles.includes("data_entry");
  const canReturnCustody = roles.some((role) =>
    ["admin", "hr", "data_entry", "site_admin"].includes(role),
  );
  const canIssueClearance = isAdmin || isHR;
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedCustody, setSelectedCustody] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [faceDialogOpen, setFaceDialogOpen] = useState(false);
  const [savingFace, setSavingFace] = useState(false);
  const custodyQuery = useQuery({
    queryKey: ["employee-custody", employeeId],
    queryFn: async () => {
      const { data: custody, error: custodyError } = await (supabase as any).rpc(
        "get_employee_custody",
        {
          emp_id: employeeId,
        },
      );
      if (custodyError) throw custodyError;
      let clearances: Clearance[] = [];
      if (canIssueClearance) {
        const { data, error: clearanceError } = await (supabase as any)
          .from("employee_clearances")
          .select("id, clearance_status, cleared_by, created_at, has_open_custody, notes")
          .eq("employee_id", employeeId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (clearanceError) throw clearanceError;
        clearances = (data ?? []) as Clearance[];
      }
      return { custody: (custody ?? []) as CustodyRow[], clearances };
    },
  });
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
      const [attendance, punches, forms, penalties, tasks, additions] = await Promise.all([
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
      ]);
      return {
        employee: employee as Employee,
        attendance,
        punches,
        forms,
        penalties,
        tasks,
        additions,
      };
    },
  });
  const employee = data?.employee;
  const custody = custodyQuery.data?.custody ?? EMPTY_CUSTODY;
  const clearances = custodyQuery.data?.clearances ?? EMPTY_CLEARANCES;
  const returnChoices = useMemo(() => {
    const grouped = new Map<string, CustodyRow>();
    for (const row of custody) {
      const key = `${row.item_id}|${row.warehouse_id}`;
      const existing = grouped.get(key);
      grouped.set(
        key,
        existing
          ? {
              ...existing,
              remaining_qty: Number(existing.remaining_qty) + Number(row.remaining_qty),
            }
          : { ...row },
      );
    }
    return [...grouped.entries()].map(([key, row]) => ({ key, ...row }));
  }, [custody]);
  const selectedReturnChoice = returnChoices.find((row) => row.key === selectedCustody);
  const latestApprovedClearance = clearances.find(
    (clearance) => clearance.clearance_status === "approved",
  );
  const saveFaceEnrollment = async (descriptor: number[]) => {
    if (!user) return toast.error("انتهت جلسة الدخول؛ أعد تسجيل الدخول");
    setSavingFace(true);
    const { error: saveError } = await (supabase as any)
      .from("employees")
      .update({
        face_descriptor: descriptor,
        face_enrolled_at: new Date().toISOString(),
        face_enrolled_by: user.id,
      })
      .eq("id", employeeId);
    setSavingFace(false);
    if (saveError) return toast.error(`تعذر حفظ بصمة الوجه: ${formatErrorMessage(saveError)}`);
    await queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] });
    toast.success("تم تسجيل بصمة الوجه للموظف");
  };
  const returnCustodyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReturnChoice) throw new Error("اختر العهدة المراد إرجاعها");
      const quantity = Number(returnQuantity);
      if (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > Number(selectedReturnChoice.remaining_qty)
      ) {
        throw new Error("أدخل كمية صحيحة لا تتجاوز الكمية المتبقية");
      }
      const { error: returnError } = await (supabase as any).rpc("return_employee_custody", {
        _employee_id: employeeId,
        _item_id: selectedReturnChoice.item_id,
        _warehouse_id: selectedReturnChoice.warehouse_id,
        _quantity: quantity,
        _notes: returnNotes.trim() || null,
      });
      if (returnError) throw returnError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee-custody", employeeId] });
      await queryClient.invalidateQueries({ queryKey: ["wh-moves"] });
      setReturnDialogOpen(false);
      setSelectedCustody("");
      setReturnQuantity("");
      setReturnNotes("");
      toast.success("تم تسجيل استرجاع العهدة");
    },
    onError: (returnError: Error) =>
      toast.error(formatErrorMessage(returnError, "تعذر تسجيل استرجاع العهدة")),
  });
  const issueClearanceMutation = useMutation({
    mutationFn: async () => {
      if (custody.length) throw new Error("لا يمكن إصدار براءة الذمة مع وجود عهدة مفتوحة");
      const { error: clearanceError } = await (supabase as any).rpc("issue_employee_clearance", {
        _employee_id: employeeId,
        _notes: "تم التحقق من خلو ذمة الموظف من العدد والأدوات.",
      });
      if (clearanceError) throw clearanceError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee-custody", employeeId] });
      toast.success("تم اعتماد براءة الذمة. يمكنك الآن طباعة الوثيقة الرسمية.");
    },
    onError: (clearanceError: Error) =>
      toast.error(formatErrorMessage(clearanceError, "تعذر إصدار براءة الذمة")),
  });
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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold md:text-4xl">{employee.full_name}</h1>
                {employee.face_descriptor && <Badge className="bg-emerald-600 text-white"><ScanFace className="ml-1 h-3.5 w-3.5" /> بصمة الوجه مفعلة</Badge>}
              </div>
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
        <TabsList className={`grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:grid-cols-4 ${canEnrollFace ? "lg:grid-cols-8" : "lg:grid-cols-7"}`}>
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
          <TabsTrigger value="identity" className="min-h-11 rounded-xl border">
            البيانات والملفات
          </TabsTrigger>
          <TabsTrigger value="custody" className="min-h-11 rounded-xl border">
            عِهدة العِدد والأدوات
          </TabsTrigger>
          {canEnrollFace && <TabsTrigger value="face" className="min-h-11 rounded-xl border"><ScanFace className="ml-2 h-4 w-4" /> بصمة الوجه</TabsTrigger>}
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
          {Object.entries(employee.employee_import_data ?? {}).some(([, value]) => value !== null && value !== "") && (
            <Card>
              <CardHeader>
                <CardTitle>البيانات المستوردة من الملف الأصلي</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(employee.employee_import_data ?? {})
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([label, value]) => (
                    <Info key={label} icon={ClipboardList} label={label} value={String(value)} />
                  ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        {canEnrollFace && (
          <TabsContent value="face" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ScanFace className="h-5 w-5 text-primary" /> تسجيل بصمة الوجه</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">تُحفظ بصمة رقمية للوجه داخل سجل الموظف لاستخدامها في مطابقة الحضور الذاتي. لا تُرفع صورة التسجيل المرجعية.</p>
                {employee.face_enrolled_at && <p className="text-sm text-emerald-700">آخر تسجيل: {new Date(employee.face_enrolled_at).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}</p>}
                <Button onClick={() => setFaceDialogOpen(true)} disabled={savingFace}>
                  <ScanFace className="ml-2 h-4 w-4" /> {savingFace ? "جارٍ حفظ البصمة..." : employee.face_descriptor ? "إعادة تسجيل بصمة الوجه" : "تسجيل بصمة الوجه"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="custody" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                {custody.length ? (
                  <Badge className="bg-red-600 text-white hover:bg-red-600">
                    توجد عِدد في ذمة الموظف
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">
                    الذمة بريئة - لا توجد عِهد مفتوحة
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {custody.length} بند عهدة مفتوح
                </span>
              </div>
              {canReturnCustody && custody.length > 0 && (
                <Button onClick={() => setReturnDialogOpen(true)}>
                  <RotateCcw className="ml-2 h-4 w-4" />
                  تسجيل استرجاع عِهدة
                </Button>
              )}
              {canIssueClearance && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => issueClearanceMutation.mutate()}
                    disabled={
                      custody.length > 0 ||
                      issueClearanceMutation.isPending ||
                      custodyQuery.isLoading
                    }
                  >
                    <ShieldCheck className="ml-2 h-4 w-4" />
                    {issueClearanceMutation.isPending
                      ? "جارٍ الاعتماد..."
                      : "إصدار براءة ذمة رسمية"}
                  </Button>
                  {latestApprovedClearance && custody.length === 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!printClearanceDocument(employee, latestApprovedClearance))
                          toast.error("اسمح بالنوافذ المنبثقة لطباعة الوثيقة");
                      }}
                    >
                      طباعة براءة الذمة
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {custody.length > 0 && canIssueClearance && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
            >
              <p className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="h-4 w-4" />
                تعذر إصدار براءة الذمة قبل إغلاق العهد المفتوحة:
              </p>
              <ul className="mt-2 list-inside list-disc">
                {custody.map((row) => (
                  <li key={row.movement_id}>
                    {row.item_name} ({row.item_code || "دون كود"}) — المتبقي {row.remaining_qty}{" "}
                    {row.unit} في {row.warehouse_name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {custodyQuery.isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : custodyQuery.error ? (
            <Card>
              <CardContent className="p-6 text-sm text-destructive">
                تعذر تحميل سجل العهدة أو براءة الذمة. تأكد من تطبيق ترحيل العهدة على قاعدة البيانات.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  العدد والأدوات الموجودة في الذمة
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>اسم الأداة</TableHead>
                      <TableHead>الكود</TableHead>
                      <TableHead>تاريخ الاستلام</TableHead>
                      <TableHead>المخزن التابع له</TableHead>
                      <TableHead>الكمية المتبقية</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {custody.map((row) => (
                      <TableRow key={row.movement_id}>
                        <TableCell className="font-medium">{row.item_name}</TableCell>
                        <TableCell>{row.item_code || "—"}</TableCell>
                        <TableCell>{fmtDate(row.received_date)}</TableCell>
                        <TableCell>{row.warehouse_name}</TableCell>
                        <TableCell>
                          {row.remaining_qty} {row.unit}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!custody.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                          لا توجد عِدد أو أدوات مفتوحة في ذمة الموظف.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {canIssueClearance && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  سجل براءات الذمة
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاريخ الإصدار</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الملاحظات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clearances.map((clearance) => (
                      <TableRow key={clearance.id}>
                        <TableCell>
                          {new Date(clearance.created_at).toLocaleString("ar-IQ")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              clearance.clearance_status === "approved"
                                ? "default"
                                : clearance.clearance_status === "rejected"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {clearance.clearance_status === "approved"
                              ? "معتمدة"
                              : clearance.clearance_status === "rejected"
                                ? "مرفوضة"
                                : "قيد الانتظار"}
                          </Badge>
                        </TableCell>
                        <TableCell>{clearance.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!clearances.length && (
                      <TableRow>
                        <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                          لا توجد براءات ذمة سابقة.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
            <DialogContent dir="rtl" className="max-w-md">
              <DialogHeader>
                <DialogTitle>تسجيل استرجاع عِهدة</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  returnCustodyMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label>الأداة والمخزن</Label>
                  <Select
                    value={selectedCustody}
                    onValueChange={(value) => {
                      setSelectedCustody(value);
                      const choice = returnChoices.find((row) => row.key === value);
                      setReturnQuantity(choice ? String(choice.remaining_qty) : "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر العهدة المراد إرجاعها" />
                    </SelectTrigger>
                    <SelectContent>
                      {returnChoices.map((row) => (
                        <SelectItem key={row.key} value={row.key}>
                          {row.item_name} · {row.warehouse_name} · المتبقي {row.remaining_qty}{" "}
                          {row.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custody-return-quantity">الكمية المسترجعة</Label>
                  <Input
                    id="custody-return-quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={selectedReturnChoice?.remaining_qty}
                    value={returnQuantity}
                    onChange={(event) => setReturnQuantity(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custody-return-notes">ملاحظات</Label>
                  <Input
                    id="custody-return-notes"
                    value={returnNotes}
                    onChange={(event) => setReturnNotes(event.target.value)}
                    maxLength={500}
                  />
                </div>
                <Button
                  className="w-full"
                  type="submit"
                  disabled={returnCustodyMutation.isPending || !selectedCustody}
                >
                  {returnCustodyMutation.isPending ? "جارٍ تسجيل الحركة..." : "تأكيد الاسترجاع"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
      {canEnrollFace && <FaceCameraDialog open={faceDialogOpen} onOpenChange={setFaceDialogOpen} mode="enroll" onComplete={({ descriptor }) => void saveFaceEnrollment(descriptor)} />}
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

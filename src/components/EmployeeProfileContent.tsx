import { direction, displayLocale, language, ui } from "@/lib/ui-language";
import { EmployeeDocumentsTab } from "@/components/EmployeeDocumentsTab";
import { formatErrorMessage } from "@/lib/error-message";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { EmployeeReportHistory } from "@/components/EmployeeReportHistory";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { FaceCameraDialog } from "@/components/FaceCameraDialog";
import { Textarea } from "@/components/ui/textarea";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { monthInstantRangeInBaghdad, dateKeyInTimeZone } from "@/lib/date-time";
import { buildAttendanceDays, monthDates } from "@/lib/monthly-report";
import { getEmployeePayType } from "@/lib/employee-pay-type";
import { EMPLOYEE_EXTRA_SOURCE_FIELDS } from "@/lib/excel-employees";
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
  Pencil,
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
  wage_rate_id?: string | null;
  attendance_device_id?: string | null;
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
  pay_type: string | null;
  salary_type: string | null;
  contract_type: string | null;
  contract_end_date: string | null;
  id_no: string | null;
  erp_no: string | null;
  ctr_code: string | null;
  project?: string | null;
  base_salary: number | null;
  last_working_day?: string | null;
  passport_no?: string | null;
  passport_expiry?: string | null;
  residency_no?: string | null;
  residency_expiry?: string | null;
  safety_passport_no?: string | null;
  safety_passport_expiry?: string | null;
  salary_structure?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  iban?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  blood_type?: string | null;
  shifts?: { end_time: string | null; grace_minutes: number | null } | null;
  [key: string]: unknown;
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
type PerformancePunch = { verify_time: string; status: number | null; self_event_type: string | null };
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

const monthBounds = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(end).padStart(2, "0")}` };
};
const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(displayLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const fmtMoney = (value: number) => `${Number(value || 0).toLocaleString(displayLocale())} ${ui("د.ع")}`;
function printClearanceDocument(employee: Employee, clearance: Clearance) {
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) return false;
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char,
    );
  const issuedDate = new Date(clearance.created_at).toLocaleDateString(displayLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  popup.document.write(
    `<!doctype html><html lang="${language()}" dir="${direction()}"><head><meta charset="utf-8"/><title>${ui("براءة ذمة - ")}${escapeHtml(employee.full_name)}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#18212b;line-height:1.9}.header{text-align:center;border-bottom:3px solid #0f766e;padding-bottom:18px}.header h1{font-size:25px;margin:0}.header p{margin:4px 0;color:#52616b}.stamp{margin:34px auto;padding:24px;border:2px solid #15803d;border-radius:8px;text-align:center;color:#166534;font-size:20px;font-weight:bold}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}.field{border:1px solid #cbd5e1;border-radius:6px;padding:12px}.label{display:block;color:#64748b;font-size:12px}.statement{margin-top:26px;text-align:justify}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:100px;text-align:center}.line{border-top:1px solid #334155;margin-top:54px;padding-top:8px}.footer{margin-top:60px;border-top:1px solid #cbd5e1;padding-top:10px;color:#64748b;font-size:11px;text-align:center}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="header"><h1>${ui("براءة ذمة إلكترونية")}</h1><p>${ui("إدارة الموارد البشرية والمخازن")}</p></header><div class="stamp">${ui("تشهد الإدارة بخلو ذمة الموظف من العدد والأدوات")}</div><section class="details"><div class="field"><span class="label">${ui("اسم الموظف")}</span>${escapeHtml(employee.full_name)}</div><div class="field"><span class="label">${ui("الرقم الوظيفي")}</span>${escapeHtml(employee.employee_no)}</div><div class="field"><span class="label">${ui("القسم")}</span>${escapeHtml(employee.departments?.name || "—")}</div><div class="field"><span class="label">${ui("المسمى الوظيفي")}</span>${escapeHtml(employee.position || "—")}</div><div class="field"><span class="label">${ui("الموقع")}</span>${escapeHtml(employee.sites?.name || "—")}</div><div class="field"><span class="label">${ui("رقم البراءة")}</span>${escapeHtml(clearance.id)}</div><div class="field"><span class="label">${ui("تاريخ الإصدار")}</span>${escapeHtml(issuedDate)}</div><div class="field"><span class="label">${ui("حالة العهدة")}</span>${ui("لا توجد عهد أدوات مفتوحة")}</div></section><p class="statement">${ui("تؤكد هذه الوثيقة، وفق سجل حركات المخازن حتى تاريخ الإصدار أعلاه، أن الموظف المذكور لا توجد في ذمته أي عدد أو أدوات غير مسترجعة. صدرت هذه البراءة للاستخدام الإداري الرسمي.")}</p><section class="signatures"><div class="line">${ui("الموارد البشرية / الإدارة")}</div><div class="line">${ui("مسؤول المخازن")}</div></section><footer class="footer">${ui("وثيقة صادرة إلكترونيًا من EMAD_tc")}</footer><script>window.onload=()=>window.print()</script></body></html>`,
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

function Field({ label, name, value, type = "text", required = false }: { label: string; name: string; value: unknown; type?: string; required?: boolean }) {
  const normalized = value == null ? "" : String(value);
  return <label className="space-y-1"><Label htmlFor={`employee-${name}`}>{ui(label)}</Label><Input id={`employee-${name}`} name={name} type={type} defaultValue={normalized} required={required}/></label>;
}

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
        <p className="text-xs text-muted-foreground">{ui(label)}</p>
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
  const canEditEmployee = isAdmin || isHR;
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
  const [editOpen, setEditOpen] = useState(false);
  const canAssignWorkshop = canEditEmployee || roles.includes("supervisor");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [targetWorkshop, setTargetWorkshop] = useState("keep");
  const [workshopRole, setWorkshopRole] = useState("");
  const assignment = useQuery({
    queryKey: ["employee-workshop-assignment", employeeId],
    queryFn: async () => {
      const {data,error} = await supabase.from("daily_workshop_members")
        .select("workshop_id,role_label,daily_workshops!inner(id,name,specialty,supervisor_name,is_active)")
        .eq("employee_id", employeeId).eq("is_active",true).eq("daily_workshops.is_active",true);
      if (error) throw error;
      return data;
    },
  });
  const workshopOptions = useQuery({
    queryKey: ["profile-active-workshops"],
    enabled: canAssignWorkshop && (assignmentOpen || editOpen),
    queryFn: async () => {
      const {data,error} = await supabase.from("daily_workshops").select("id,name,specialty,supervisor_name")
        .eq("is_active",true).order("sort_order").order("name");
      if (error) throw error;
      return data;
    },
  });
  const changeWorkshop = useMutation({
    mutationFn: async ({target,role}:{target:string;role:string}) => {
      const {error} = await supabase.rpc("set_employee_profile_workshop",{
        p_employee:employeeId,p_workshop:target==="none"?null:target,p_role:role.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        ["employee-workshop-assignment",employeeId],["daily-workshop-members"],["daily-workshop-all-active-members"],
        ["workshop-management"],["project-execution"],["projects-dashboard"],["executive-dashboard","workshops"],
      ].map(queryKey=>queryClient.invalidateQueries({queryKey})));
      toast.success(ui("تم تحديث تنسيب الموظف بنجاح"));
    },
  });
  const currentWorkshops = assignment.data?.map(m=>m.daily_workshops.name).join("، ");
  function workshopFields() {
    return <div className="flex flex-col gap-3 leading-6">
      <label>{ui("ورشة التنسيب")}<select className="mt-2 w-full rounded-md border bg-background p-2" value={targetWorkshop}
          disabled={!assignment.isSuccess || !workshopOptions.isSuccess || changeWorkshop.isPending}
          onChange={event=>{
            const id=event.target.value;
            setTargetWorkshop(id);
            setWorkshopRole(assignment.data?.find(m=>m.workshop_id===id)?.role_label ?? "");
          }}>
          <option value="keep">{currentWorkshops ? "التنسيب الحالي: "+currentWorkshops : ui("اختر الورشة")}</option>
          {!!assignment.data?.length && <option value="none">{ui("إلغاء جميع التنسيبات الحالية")}</option>}
          {workshopOptions.data?.map(w=><option key={w.id} value={w.id}>{[w.name,w.specialty,w.supervisor_name && "المشرف: "+w.supervisor_name].filter(Boolean).join(" · ")}</option>)}
        </select>
      </label>
      {workshopOptions.isError || assignment.isError ? <p role="alert">{ui("تعذر تحميل بيانات التنسيب.")}</p> : workshopOptions.isLoading ? <p>{ui("جارٍ تحميل الورش…")}</p> : workshopOptions.data?.length===0 && <p>{ui("لا توجد ورش نشطة.")}</p>}
      {targetWorkshop!=="keep" && targetWorkshop!=="none" && <label>{ui("الصفة داخل الورشة (اختياري)")}<Input className="mt-2" maxLength={120} value={workshopRole} onChange={e=>setWorkshopRole(e.target.value)} placeholder={ui("مثلاً: فني لحام")}/>
      </label>}
      {targetWorkshop!=="keep" && <p className="text-sm text-muted-foreground">{targetWorkshop==="none"?ui("سيتم إلغاء تنشيط جميع التنسيبات الحالية."):ui("سيُستبدل أي تنسيب سابق بالورشة المختارة ليظهر الموظف في جردها اليومي.")}</p>}
    </div>;
  }
  const [savingEmployee, setSavingEmployee] = useState(false);
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
      const punchRange = monthInstantRangeInBaghdad(month);
      const { data: employee, error: employeeError } = await (supabase as any)
        .from("employees")
        .select(
          "*, departments(name), sites!site_id(name, ctr_code), wage_rates(title, monthly_rate, daily_rate, overtime_hour_rate), shifts(end_time, grace_minutes)",
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
      const [attendance, punches, performancePunches, forms, penalties, tasks, additions] = await Promise.all([
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
        safe<PerformancePunch>(
          (supabase as any)
            .from("attendance_logs")
            .select("verify_time, status, self_event_type")
            .eq("employee_no", employee.employee_no)
            .gte("verify_time", punchRange.start)
            .lt("verify_time", punchRange.end)
            .order("verify_time"),
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
        performancePunches,
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
    if (!user) return toast.error(ui("انتهت جلسة الدخول؛ أعد تسجيل الدخول"));
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
    if (saveError) return toast.error((ui("تعذر حفظ بصمة الوجه: ") + (formatErrorMessage(saveError))));
    await queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] });
    toast.success(ui("تم تسجيل بصمة الوجه للموظف"));
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
      toast.success(ui("تم تسجيل استرجاع العهدة"));
    },
    onError: (returnError: Error) =>
      toast.error(ui(formatErrorMessage(returnError, "تعذر تسجيل استرجاع العهدة"))),
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
      toast.success(ui("تم اعتماد براءة الذمة. يمكنك الآن طباعة الوثيقة الرسمية."));
    },
    onError: (clearanceError: Error) =>
      toast.error(ui(formatErrorMessage(clearanceError, "تعذر إصدار براءة الذمة"))),
  });
  const stats = useMemo(() => {
    const attendanceByDate = new Map((data?.attendance ?? []).map((row) => [row.work_date, row]));
    const computedDays = buildAttendanceDays(
      monthDates(month),
      data?.performancePunches ?? [],
      (data?.attendance ?? []).map((row) => ({ ...row, status: row.status as "present" | "absent" | "leave" | "holiday" | "rest", is_paid: true })),
      data?.employee?.shifts?.end_time,
      dateKeyInTimeZone(new Date()),
      getEmployeePayType(data?.employee ?? {}),
      data?.employee?.shifts?.grace_minutes ?? 0,
    );
    const attendance = computedDays.map((day) => ({
      status: attendanceByDate.get(day.date)?.status ?? day.status,
      overtime_hours: attendanceByDate.get(day.date)?.overtime_hours ?? day.overtime_hours,
    }));
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
  }, [data, month]);
  const attendanceRows = useMemo(() => {
    const manualRows = new Map((data?.attendance ?? []).map((row) => [row.work_date, row]));
    return buildAttendanceDays(
      monthDates(month),
      data?.performancePunches ?? [],
      (data?.attendance ?? []).map((row) => ({ ...row, status: row.status as "present" | "absent" | "leave" | "holiday" | "rest", is_paid: true })),
      data?.employee?.shifts?.end_time,
      dateKeyInTimeZone(new Date()),
      getEmployeePayType(data?.employee ?? {}),
      data?.employee?.shifts?.grace_minutes ?? 0,
    ).filter((day) => day.status !== null).map((day) => {
      const manual = manualRows.get(day.date);
      return { work_date: day.date, status: manual?.status ?? day.status ?? "—", overtime_hours: manual?.overtime_hours ?? day.overtime_hours, notes: manual?.notes ?? day.notes };
    });
  }, [data, month]);

  const certificationRows = useMemo(
    () => [
      { id: "cert-1", type: "ريكر", issue_date: "2024-02-15", expiry_date: "2026-02-15", days_left: 120, status: "active", issuer: "مركز التدريب" },
      { id: "cert-2", type: "مسعف", issue_date: "2024-11-01", expiry_date: "2025-11-01", days_left: 18, status: "expiring_soon", issuer: "مركز السلامة" },
      { id: "cert-3", type: "إطفائي", issue_date: "2023-08-20", expiry_date: "2025-08-20", days_left: -12, status: "expired", issuer: "الهيئة التدريبية" },
    ],
    [],
  );

  async function saveEmployeeProfile(formData: FormData) {
    if (!employee || !canEditEmployee) return;
    setSavingEmployee(true);
    const value = (name: string) => {
      const raw = String(formData.get(name) ?? "").trim();
      return raw === "" || raw === "none" ? null : raw;
    };
    const numeric = (name: string) => {
      const raw = value(name);
      return raw === null ? null : Number(raw);
    };
    const sourceFields = Object.fromEntries(EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header, column }) => [column, value(`source_${header}`)]));
    const sourceHeaders = Object.fromEntries(EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header }) => [header, value(`source_${header}`)]));
    const extraImportValues = Object.fromEntries(Object.entries(employee.employee_import_data ?? {}).map(([header]) => [header, value(`import_${header}`)]));
    const payload = {
      employee_no: String(value("employee_no") ?? ""),
      full_name: String(value("full_name") ?? ""),
      department_id: value("department_id"), site_id: value("site_id"), wage_rate_id: value("wage_rate_id"),
      position: value("position"), status: value("status") ?? "active", base_salary: numeric("base_salary"),
      pay_type: value("pay_type") ?? "monthly", erp_no: value("erp_no"), attendance_device_id: value("attendance_device_id"),
      id_no: value("id_no"), ctr_code: value("ctr_code"), nationality: value("nationality"), gender: value("gender"),
      marital_status: value("marital_status"), blood_type: value("blood_type"), education: value("education"),
      birth_date: value("birth_date"), hire_date: value("hire_date"), last_working_day: value("last_working_day"),
      contract_type: value("contract_type"), contract_end_date: value("contract_end_date"), email: value("email"),
      phone1: value("phone1"), phone2: value("phone2"), address: value("address"), salary_type: value("salary_type"),
      salary_structure: value("salary_structure"), project: value("project"), passport_no: value("passport_no"),
      passport_expiry: value("passport_expiry"), residency_no: value("residency_no"), residency_expiry: value("residency_expiry"),
      safety_passport_no: value("safety_passport_no"), safety_passport_expiry: value("safety_passport_expiry"),
      bank_name: value("bank_name"), bank_account: value("bank_account"), iban: value("iban"),
      emergency_contact_name: value("emergency_contact_name"), emergency_contact_phone: value("emergency_contact_phone"),
      notes: value("notes"), employee_import_data: { ...extraImportValues, ...sourceHeaders }, ...sourceFields,
    };
    const { error: saveError } = await (supabase as any).from("employees").update(payload).eq("id", employeeId);
    if (saveError) {
      setSavingEmployee(false);
      return toast.error((ui("تعذر حفظ بيانات الموظف: ") + (formatErrorMessage(saveError))));
    }
    if (targetWorkshop !== "keep") {
      try { await changeWorkshop.mutateAsync({target:targetWorkshop,role:workshopRole}); }
      catch (error) {
        setSavingEmployee(false);
        await queryClient.invalidateQueries({queryKey:["employee-profile",employeeId]});
        return toast.error((ui("حُفظت بيانات الموظف وتعذر تحديث التنسيب: ") + (formatErrorMessage(error))));
      }
    }
    setSavingEmployee(false);
    setEditOpen(false);
    await queryClient.invalidateQueries({ queryKey: ["employee-profile", employeeId] });
    await queryClient.invalidateQueries({ queryKey: ["employee-profile-search"] });
    await queryClient.invalidateQueries({ queryKey: ["employees"] });
    toast.success(ui("تم حفظ بيانات الموظف"));
  }

  if (isLoading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  if (error || !employee)
    return (
      <Card>
        <CardContent className="p-8 text-center text-destructive">{ui("تعذر تحميل ملف الموظف. ")}{(error as Error)?.message ?? ui("الموظف غير موجود")}
        </CardContent>
      </Card>
    );
  return (
    <div dir={direction()} className="space-y-6 pb-10">
      {!embedded && (
        <Link
          to="/employees"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" />{ui(" العودة إلى الموظفين")}</Link>
      )}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent dir={direction()} className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>{ui("تعديل بيانات الموظف — جميع الحقول")}</DialogTitle></DialogHeader>
          <form key={employee.id} onSubmit={(event) => { event.preventDefault(); void saveEmployeeProfile(new FormData(event.currentTarget)); }} className="space-y-5">
            <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("البيانات الأساسية والوظيفية")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {workshopFields()}
              <Field label={ui("الرقم الوظيفي *")} name="employee_no" value={employee.employee_no} required/><Field label={ui("الاسم الكامل *")} name="full_name" value={employee.full_name} required/><Field label={ui("رقم جهاز البصمة")} name="attendance_device_id" value={employee.attendance_device_id}/><Field label={ui("المسمى الوظيفي")} name="position" value={employee.position}/><Field label={ui("القسم")} name="department_id" value={employee.department_id}/><Field label={ui("الحالة")} name="status" value={employee.status}/><Field label={ui("رقم ERP")} name="erp_no" value={employee.erp_no}/><Field label={ui("رقم الهوية")} name="id_no" value={employee.id_no}/><Field label={ui("المشروع")} name="project" value={employee.project}/><Field label={ui("الموقع")} name="site_id" value={employee.site_id}/><Field label={ui("كود التكلفة CTR")} name="ctr_code" value={employee.ctr_code}/><Field label={ui("أجر التخصص")} name="wage_rate_id" value={employee.wage_rate_id}/><Field label={ui("تصنيف الأجر")} name="pay_type" value={employee.pay_type}/><Field label={ui("الراتب الأساسي")} name="base_salary" value={employee.base_salary} type="number"/><Field label={ui("نوع الراتب")} name="salary_type" value={employee.salary_type}/><Field label={ui("هيكل الراتب")} name="salary_structure" value={employee.salary_structure}/>
            </div></section>
            <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("البيانات الشخصية والتواصل")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={ui("الجنسية")} name="nationality" value={employee.nationality}/><Field label={ui("الجنس")} name="gender" value={employee.gender}/><Field label={ui("الحالة الاجتماعية")} name="marital_status" value={employee.marital_status}/><Field label={ui("فصيلة الدم")} name="blood_type" value={employee.blood_type}/><Field label={ui("التعليم")} name="education" value={employee.education}/><Field label={ui("تاريخ الميلاد")} name="birth_date" value={employee.birth_date} type="date"/><Field label={ui("البريد الإلكتروني")} name="email" value={employee.email} type="email"/><Field label={ui("الهاتف الأول")} name="phone1" value={employee.phone1}/><Field label={ui("الهاتف الثاني")} name="phone2" value={employee.phone2}/><Field label={ui("العنوان")} name="address" value={employee.address}/><Field label={ui("اسم جهة الطوارئ")} name="emergency_contact_name" value={employee.emergency_contact_name}/><Field label={ui("هاتف الطوارئ")} name="emergency_contact_phone" value={employee.emergency_contact_phone}/>
            </div></section>
            <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("التعاقد والوثائق")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={ui("تاريخ المباشرة")} name="hire_date" value={employee.hire_date} type="date"/><Field label={ui("آخر يوم عمل")} name="last_working_day" value={employee.last_working_day} type="date"/><Field label={ui("نوع العقد")} name="contract_type" value={employee.contract_type}/><Field label={ui("انتهاء العقد")} name="contract_end_date" value={employee.contract_end_date} type="date"/><Field label={ui("رقم الجواز")} name="passport_no" value={employee.passport_no}/><Field label={ui("انتهاء الجواز")} name="passport_expiry" value={employee.passport_expiry} type="date"/><Field label={ui("رقم الإقامة")} name="residency_no" value={employee.residency_no}/><Field label={ui("انتهاء الإقامة")} name="residency_expiry" value={employee.residency_expiry} type="date"/><Field label={ui("رقم جواز السلامة")} name="safety_passport_no" value={employee.safety_passport_no}/><Field label={ui("انتهاء جواز السلامة")} name="safety_passport_expiry" value={employee.safety_passport_expiry} type="date"/>
            </div></section>
            <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("المعلومات البنكية والملاحظات")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={ui("اسم البنك")} name="bank_name" value={employee.bank_name}/><Field label={ui("رقم الحساب")} name="bank_account" value={employee.bank_account}/><Field label="IBAN" name="iban" value={employee.iban}/><label className="space-y-1 sm:col-span-2 lg:col-span-3"><Label>{ui("ملاحظات")}</Label><Textarea name="notes" defaultValue={employee.notes ?? ""}/></label></div></section>
            <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{ui("الحقول الإضافية والبيانات المستوردة")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header, column }) => <Field key={column} label={header} name={`source_${header}`} value={employee[column] ?? employee.employee_import_data?.[header]}/>)}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(employee.employee_import_data ?? {}).filter(([header]) => !EMPLOYEE_EXTRA_SOURCE_FIELDS.some((field) => field.header === header)).map(([header, value]) => <Field key={header} label={header} name={`import_${header}`} value={value}/>)}</div></section>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>{ui("إلغاء")}</Button><Button type="submit" disabled={savingEmployee}>{savingEmployee ? ui("جارٍ الحفظ...") : ui("حفظ جميع التعديلات")}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4" dir={direction()}>
        <h3 className="flex items-center gap-2 font-semibold"><Wrench className="size-4"/>{ui("تنسيب الورش")}</h3>
        {assignment.isLoading ? ui("جارٍ تحميل التنسيب…") : assignment.isError ? ui("تعذر تحميل التنسيب") : assignment.data?.length ?
          assignment.data.map(m=><Badge key={m.workshop_id} variant="secondary" className="whitespace-normal">{[m.daily_workshops.name,m.daily_workshops.specialty,m.role_label].filter(Boolean).join(" · ")}</Badge>) :
          <Badge variant="outline">{ui("غير منسّب لأي ورشة")}</Badge>}
        {canAssignWorkshop && assignment.isSuccess && <>
          <Button variant="outline" onClick={()=>{setTargetWorkshop("keep");setWorkshopRole("");setAssignmentOpen(true);}}>{currentWorkshops?ui("تغيير الورشة"):ui("+ تنسيب إلى ورشة")}</Button>
          {currentWorkshops && <Button variant="ghost" onClick={()=>{setTargetWorkshop("none");setAssignmentOpen(true);}}>{ui("إلغاء التنسيب")}</Button>}
        </>}
        {canEditEmployee && <Button variant="outline" onClick={()=>{setTargetWorkshop("keep");setWorkshopRole("");setEditOpen(true);}}><Pencil className="ml-2 h-4 w-4"/>{ui("تعديل جميع بيانات الموظف")}</Button>}
      </section>
      <Dialog open={assignmentOpen} onOpenChange={open=>{if(!changeWorkshop.isPending)setAssignmentOpen(open);}}>
        <DialogContent dir={direction()} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{currentWorkshops?ui("تغيير تنسيب الورشة"):ui("تنسيب الموظف إلى ورشة عمل")}</DialogTitle></DialogHeader>
          {workshopFields()}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={changeWorkshop.isPending} onClick={()=>setAssignmentOpen(false)}>{ui("إلغاء")}</Button>
            <Button disabled={targetWorkshop==="keep" || changeWorkshop.isPending} onClick={()=>changeWorkshop.mutate({target:targetWorkshop,role:workshopRole},{
              onSuccess:()=>setAssignmentOpen(false),onError:error=>toast.error(ui(formatErrorMessage(error))),
            })}>{changeWorkshop.isPending?ui("جارٍ الحفظ…"):ui("تأكيد وحفظ")}</Button></div>
        </DialogContent>
      </Dialog>
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
                  {employee.status === "active" ? ui("موظف نشط") : employee.status}
                </Badge>
                <span className="text-sm text-white/60">#{employee.employee_no}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold md:text-4xl">{employee.full_name}</h1>
                {employee.face_descriptor && <Badge className="bg-emerald-600 text-white"><ScanFace className="ml-1 h-3.5 w-3.5" />{ui(" بصمة الوجه مفعلة")}</Badge>}
              </div>
              <p className="mt-1 text-white/70">
                {employee.position || ui("المسمى الوظيفي غير محدد")} ·{" "}
                {employee.departments?.name || ui("بدون قسم")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm md:min-w-[280px]">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/60">{ui("الموقع")}</p>
              <p className="mt-1 font-semibold">{employee.sites?.name || ui("غير محدد")}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-white/60">{ui("تاريخ المباشرة")}</p>
              <p className="mt-1 font-semibold">{fmtDate(employee.hire_date)}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold">{ui("لوحة الأداء الشهرية")}</h2>
          <p className="text-sm text-muted-foreground">{ui("الإحصائيات مرتبطة بسجلات الحضور والمهام والاستمارات والعقوبات الفعلية.")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">{ui("الشهر")}{" "}
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
          label={ui("أيام الدوام")}
          value={stats.present}
          icon={CalendarDays}
          tone="bg-emerald-600"
        />
        <Metric
          label={ui("ساعات إضافية")}
          value={`${stats.overtime} س`}
          icon={Clock3}
          tone="bg-indigo-600"
        />
        <Metric label={ui("الإجازات")} value={stats.leave} icon={BriefcaseBusiness} tone="bg-sky-600" />
        <Metric label={ui("أيام الغياب")} value={stats.absent} icon={ShieldAlert} tone="bg-rose-600" />
        <Metric label={ui("مهام الشهر")} value={stats.tasks} icon={ClipboardList} tone="bg-violet-600" />
        <Metric label={ui("مهام منجزة")} value={stats.completed} icon={CheckCircle2} tone="bg-teal-600" />
        <Metric label={ui("العقوبات")} value={stats.penalties} icon={FileWarning} tone="bg-orange-600" />
        <Metric
          label={ui("الإضافات")}
          value={fmtMoney(stats.additions)}
          icon={Award}
          tone="bg-amber-600"
        />
      </div>
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className={`grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:grid-cols-4 ${canEnrollFace ? "lg:grid-cols-8" : "lg:grid-cols-7"}`}>
          <TabsTrigger value="history">{ui("سجل التغييرات")}</TabsTrigger>
          <TabsTrigger value="overview" className="min-h-11 rounded-xl border">{ui("نظرة عامة")}</TabsTrigger>
          <TabsTrigger value="attendance" className="min-h-11 rounded-xl border">{ui("الحضور والبصمة")}</TabsTrigger>
          <TabsTrigger value="leave" className="min-h-11 rounded-xl border">{ui("الإجازات والعقوبات")}</TabsTrigger>
          <TabsTrigger value="certifications" className="min-h-11 rounded-xl border">{ui("الشهادات والتأهيل")}</TabsTrigger>
          <TabsTrigger value="tasks" className="min-h-11 rounded-xl border">{ui("المهام")}</TabsTrigger>
          <TabsTrigger value="finance" className="min-h-11 rounded-xl border">{ui("الأجور والبدلات")}</TabsTrigger>
          <TabsTrigger value="identity" className="min-h-11 rounded-xl border">{ui("البيانات والملفات")}</TabsTrigger>
          <TabsTrigger value="custody" className="min-h-11 rounded-xl border">{ui("عِهدة العِدد والأدوات")}</TabsTrigger>
          {canEnrollFace && <TabsTrigger value="face" className="min-h-11 rounded-xl border"><ScanFace className="ml-2 h-4 w-4" />{ui(" بصمة الوجه")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="history"><EmployeeReportHistory key={employeeId} employeeId={employeeId} /></TabsContent>
        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{ui("ملخص نشاط ")}{employee.full_name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Info icon={UserRound} label={ui("الرقم الوظيفي")} value={employee.employee_no} />
              <Info icon={UserRound} label={ui("رقم جهاز البصمة")} value={employee.attendance_device_id || "غير منسّب"} />
              <Info
                icon={BriefcaseBusiness}
                label={ui("المسمى والقسم")}
                value={`${employee.position || "غير محدد"} · ${employee.departments?.name || "بدون قسم"}`}
              />
              <Info
                icon={MapPin}
                label={ui("الموقع")}
                value={`${employee.sites?.name || "غير محدد"}${employee.sites?.ctr_code ? ` · ${employee.sites.ctr_code}` : ""}`}
              />
              <Info
                icon={WalletCards}
                label={ui("الأجر الأساسي")}
                value={`${fmtMoney(Number(employee.base_salary || employee.wage_rates?.monthly_rate || 0))} · ${employee.pay_type === "daily" ? "يومي" : "شهري"}`}
              />
              <Info
                icon={CalendarDays}
                label={ui("تاريخ المباشرة")}
                value={fmtDate(employee.hire_date)}
              />
              <Info
                icon={Phone}
                label={ui("الهاتف")}
                value={employee.phone1 || employee.phone2 || "غير محدد"}
              />
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-b from-primary/10 to-card">
            <CardHeader>
              <CardTitle>{ui("مؤشر الإنجاز")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-bold text-primary">
                  {stats.tasks ? Math.round((stats.completed / stats.tasks) * 100) : 0}
                </span>
                <span className="mb-2 text-muted-foreground">%</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{ui("نسبة المهام المنجزة خلال ")}{month}</p>
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
            title={(ui("سجل الحضور — ") + (month))}
            headers={["التاريخ", "الحالة", "الساعات الإضافية", "ملاحظات"]}
            rows={attendanceRows.map((row) => [
              fmtDate(row.work_date),
              statusText[row.status] || row.status,
              `${Number(row.overtime_hours || 0)} ساعة`,
              row.notes || "—",
            ])}
            empty="لا توجد سجلات حضور معتمدة لهذا الشهر."
          />
          <DataCard
            title={ui("آخر سجلات البصمة")}
            headers={["وقت البصمة", "نوع التحقق"]}
            rows={(data?.punches ?? [])
              .slice(0, 30)
              .map((row) => [
                new Date(row.verify_time).toLocaleString(displayLocale()),
                row.verify_type == null ? "—" : String(row.verify_type),
              ])}
            empty="لا توجد سجلات بصمة مرتبطة بهذا الموظف."
          />
        </TabsContent>
        <TabsContent value="leave" className="grid gap-4 lg:grid-cols-2">
          <DataCard
            title={ui("الإجازات والاستمارات")}
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
            title={ui("العقوبات والسجل التأديبي")}
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
        <TabsContent value="certifications" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Metric label={ui("الشهادات السارية")} value={certificationRows.filter((row) => row.status === "active").length} icon={CheckCircle2} tone="bg-emerald-600" />
            <Metric label={ui("قريبة من الانتهاء")} value={certificationRows.filter((row) => row.status === "expiring_soon").length} icon={Clock3} tone="bg-amber-500" />
            <Metric label={ui("منتهية")} value={certificationRows.filter((row) => row.status === "expired").length} icon={ShieldAlert} tone="bg-rose-600" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{ui("الشهادات والتأهيل")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{ui("نوع الدورة")}</TableHead>
                    <TableHead>{ui("جهة الإصدار")}</TableHead>
                    <TableHead>{ui("تاريخ الإصدار")}</TableHead>
                    <TableHead>{ui("تاريخ الانتهاء")}</TableHead>
                    <TableHead>{ui("الأيام المتبقية")}</TableHead>
                    <TableHead>{ui("الحالة")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificationRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.type}</TableCell>
                      <TableCell>{row.issuer}</TableCell>
                      <TableCell>{row.issue_date}</TableCell>
                      <TableCell>{row.expiry_date}</TableCell>
                      <TableCell>{row.days_left > 0 ? ((row.days_left) + ui(" يوم")) : ((Math.abs(row.days_left)) + ui(" يوم متأخرة"))}</TableCell>
                      <TableCell>
                        <Badge className={statusText[row.status] === "سارية" ? "bg-emerald-600 text-white" : statusText[row.status] === "قريبة من الانتهاء" ? "bg-amber-500 text-white" : "bg-rose-600 text-white"}>
                          {ui(statusText[row.status]) || row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="tasks">
          <DataCard
            title={(ui("مهام الموظف — ") + (month))}
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
              <CardTitle>{ui("الأجر الأساسي ومعدل الإضافي")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Info
                icon={Banknote}
                label={ui("الأجر الأساسي")}
                value={fmtMoney(
                  Number(employee.base_salary || employee.wage_rates?.monthly_rate || 0),
                )}
              />
              <Info
                icon={WalletCards}
                label={ui("أجر التخصص")}
                value={employee.wage_rates?.title || "غير محدد"}
              />
              <Info
                icon={Clock3}
                label={ui("أجر ساعة إضافية")}
                value={fmtMoney(Number(employee.wage_rates?.overtime_hour_rate || 0))}
              />
            </CardContent>
          </Card>
          <DataCard
            title={ui("الإضافات والمكافآت")}
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
        <TabsContent value="identity" className="space-y-4">
          <EmployeeDocumentsTab key={employee.id} employee={employee} />
          <Card>
            <CardHeader>
              <CardTitle>{ui("البيانات الوظيفية والشخصية")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Info icon={Mail} label={ui("البريد الإلكتروني")} value={employee.email || "غير محدد"} />
              <Info icon={Phone} label={ui("الهاتف")} value={employee.phone1 || "غير محدد"} />
              <Info
                icon={UserRound}
                label={ui("الجنسية / الجنس")}
                value={`${employee.nationality || "—"} · ${employee.gender || "—"}`}
              />
              <Info
                icon={BriefcaseBusiness}
                label={ui("نوع العقد")}
                value={`${employee.contract_type || "غير محدد"}${employee.contract_end_date ? ` · ينتهي ${fmtDate(employee.contract_end_date)}` : ""}`}
              />
              <Info icon={ShieldAlert} label={ui("رقم الهوية")} value={employee.id_no || "غير محدد"} />
              <Info icon={MapPin} label={ui("العنوان")} value={employee.address || "غير محدد"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{ui("ملاحظات الموظف")}</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-muted-foreground">
              {employee.notes || ui("لا توجد ملاحظات محفوظة.")}
            </CardContent>
          </Card>
          {Object.entries(employee.employee_import_data ?? {}).some(([, value]) => value !== null && value !== "") && (
            <Card>
              <CardHeader>
                <CardTitle>{ui("البيانات المستوردة من الملف الأصلي")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(employee.employee_import_data ?? {})
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([label, value]) => (
                    <Info key={label} icon={ClipboardList} label={ui(label)} value={String(value)} />
                  ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        {canEnrollFace && (
          <TabsContent value="face" className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ScanFace className="h-5 w-5 text-primary" />{ui(" تسجيل بصمة الوجه")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{ui("تُحفظ بصمة رقمية للوجه داخل سجل الموظف لاستخدامها في مطابقة الحضور الذاتي. لا تُرفع صورة التسجيل المرجعية.")}</p>
                {employee.face_enrolled_at && <p className="text-sm text-emerald-700">{ui("آخر تسجيل: ")}{new Date(employee.face_enrolled_at).toLocaleString(displayLocale(), { timeZone: "Asia/Baghdad" })}</p>}
                <Button onClick={() => setFaceDialogOpen(true)} disabled={savingFace}>
                  <ScanFace className="ml-2 h-4 w-4" /> {savingFace ? ui("جارٍ حفظ البصمة...") : employee.face_descriptor ? ui("إعادة تسجيل بصمة الوجه") : ui("تسجيل بصمة الوجه")}
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
                  <Badge className="bg-red-600 text-white hover:bg-red-600">{ui("توجد عِدد في ذمة الموظف")}</Badge>
                ) : (
                  <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">{ui("الذمة بريئة - لا توجد عِهد مفتوحة")}</Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {custody.length}{ui(" بند عهدة مفتوح")}</span>
              </div>
              {canReturnCustody && custody.length > 0 && (
                <Button onClick={() => setReturnDialogOpen(true)}>
                  <RotateCcw className="ml-2 h-4 w-4" />{ui("تسجيل استرجاع عِهدة")}</Button>
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
                      ? ui("جارٍ الاعتماد...")
                      : ui("إصدار براءة ذمة رسمية")}
                  </Button>
                  {latestApprovedClearance && custody.length === 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!printClearanceDocument(employee, latestApprovedClearance))
                          toast.error(ui("اسمح بالنوافذ المنبثقة لطباعة الوثيقة"));
                      }}
                    >{ui("طباعة براءة الذمة")}</Button>
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
                <ShieldAlert className="h-4 w-4" />{ui("تعذر إصدار براءة الذمة قبل إغلاق العهد المفتوحة:")}</p>
              <ul className="mt-2 list-inside list-disc">
                {custody.map((row) => (
                  <li key={row.movement_id}>
                    {row.item_name} ({row.item_code || ui("دون كود")}{ui(") — المتبقي ")}{row.remaining_qty}{" "}
                    {row.unit}{ui(" في ")}{row.warehouse_name}
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
              <CardContent className="p-6 text-sm text-destructive">{ui("تعذر تحميل سجل العهدة أو براءة الذمة. تأكد من تطبيق ترحيل العهدة على قاعدة البيانات.")}</CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />{ui("العدد والأدوات الموجودة في الذمة")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ui("اسم الأداة")}</TableHead>
                      <TableHead>{ui("الكود")}</TableHead>
                      <TableHead>{ui("تاريخ الاستلام")}</TableHead>
                      <TableHead>{ui("المخزن التابع له")}</TableHead>
                      <TableHead>{ui("الكمية المتبقية")}</TableHead>
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
                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">{ui("لا توجد عِدد أو أدوات مفتوحة في ذمة الموظف.")}</TableCell>
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
                  <CheckCircle2 className="h-5 w-5" />{ui("سجل براءات الذمة")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{ui("تاريخ الإصدار")}</TableHead>
                      <TableHead>{ui("الحالة")}</TableHead>
                      <TableHead>{ui("الملاحظات")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clearances.map((clearance) => (
                      <TableRow key={clearance.id}>
                        <TableCell>
                          {new Date(clearance.created_at).toLocaleString(displayLocale())}
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
                              ? ui("معتمدة")
                              : clearance.clearance_status === "rejected"
                                ? ui("مرفوضة")
                                : ui("قيد الانتظار")}
                          </Badge>
                        </TableCell>
                        <TableCell>{clearance.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {!clearances.length && (
                      <TableRow>
                        <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">{ui("لا توجد براءات ذمة سابقة.")}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
            <DialogContent dir={direction()} className="max-w-md">
              <DialogHeader>
                <DialogTitle>{ui("تسجيل استرجاع عِهدة")}</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  returnCustodyMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label>{ui("الأداة والمخزن")}</Label>
                  <Select
                    value={selectedCustody}
                    onValueChange={(value) => {
                      setSelectedCustody(value);
                      const choice = returnChoices.find((row) => row.key === value);
                      setReturnQuantity(choice ? String(choice.remaining_qty) : "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={ui("اختر العهدة المراد إرجاعها")} />
                    </SelectTrigger>
                    <SelectContent>
                      {returnChoices.map((row) => (
                        <SelectItem key={row.key} value={row.key}>
                          {row.item_name} · {row.warehouse_name}{ui(" · المتبقي ")}{row.remaining_qty}{" "}
                          {row.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custody-return-quantity">{ui("الكمية المسترجعة")}</Label>
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
                  <Label htmlFor="custody-return-notes">{ui("ملاحظات")}</Label>
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
                  {returnCustodyMutation.isPending ? ui("جارٍ تسجيل الحركة...") : ui("تأكيد الاسترجاع")}
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
        {ui(label)}
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

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { addCalendarDays, instantAtMidnightInTimeZone, todayInBaghdad } from "@/lib/date-time";
import { workCenterDb } from "@/lib/work-center-db";
import type {
  TaskAuditEvent,
  TaskChecklistItem,
  WorkCenterTask,
  WorkCenterTaskUpdate,
  WorkCenterTemplate,
} from "@/lib/work-center-db";

export const Route = createFileRoute("/_authenticated/work-center")({
  head: () => ({
    meta: [
      { title: "مركز العمل — منظومة زِكت" },
      { name: "description", content: "إدارة وتنفيذ ومتابعة مهام وتوجيهات القسم." },
      { property: "og:title", content: "مركز العمل — منظومة زِكت" },
      { property: "og:description", content: "إدارة وتنفيذ ومتابعة مهام وتوجيهات القسم." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkCenterPage,
});

type Task = WorkCenterTask;
type Template = WorkCenterTemplate;
type Guidance = Database["public"]["Tables"]["employee_guidance_notes"]["Row"];
type Emp = { id: string; full_name: string; position: string | null; department_id: string | null };
type Dept = { id: string; name: string };
type LegacyRecipient = {
  id: string;
  read_at: string | null;
  user_id: string | null;
  employee_id: string | null;
  created_at: string;
  team_guidance_notes: { content: string; note_date: string; department_id: string } | null;
};
type AttendanceState = "present" | "absent" | "leave" | "holiday" | "rest" | "unknown";
type EmployeeCapacity = {
  attendance: AttendanceState;
  today: number;
  active: number;
  overdue: number;
  urgent: number;
  load: "low" | "medium" | "high";
  score: number;
};
const ATTENDANCE_LABELS: Record<AttendanceState, string> = {
  present: "حاضر",
  absent: "غائب",
  leave: "إجازة",
  holiday: "عطلة",
  rest: "راحة",
  unknown: "غير مسجل",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: "لم تبدأ", cls: "bg-muted text-muted-foreground" },
  in_progress: {
    label: "قيد التنفيذ",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  },
  completed: {
    label: "مكتملة",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  pending_review: {
    label: "بانتظار المراجعة",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  overdue: { label: "متأخرة", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  needs_follow_up: {
    label: "تحتاج متابعة",
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  },
  cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground line-through" },
};
const ALLOWED_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "overdue",
  "needs_follow_up",
  "cancelled",
];
const TYPES: Record<string, string> = {
  one_time: "لمرة واحدة",
  daily: "يومية",
  weekly: "أسبوعية",
  monthly: "شهرية",
  recurring: "متكررة",
  urgent: "لمرة واحدة",
  follow_up: "لمرة واحدة",
  guidance: "لمرة واحدة",
};
const PRIORITIES: Record<string, string> = {
  low: "منخفضة",
  normal: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const addDays = addCalendarDays;
const errText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : "خطأ غير معروف";

function effectiveStatus(t: Task, today: string) {
  if (t.status === "completed" || t.status === "cancelled") return t.status;
  const due = t.due_date ?? t.task_date;
  if (due < today && t.status !== "needs_follow_up" && t.status !== "pending_review")
    return "overdue";
  return t.status;
}
function StatusBadge({ s }: { s: string }) {
  const m = STATUS[s] ?? STATUS.not_started;
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}
function State({
  loading,
  error,
  empty,
  children,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  children: React.ReactNode;
}) {
  if (loading)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...
      </div>
    );
  if (error)
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
      >
        تعذر تحميل البيانات: {errText(error)}
      </div>
    );
  if (empty)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">لا توجد بيانات لعرضها.</div>
    );
  return <>{children}</>;
}
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="text-sm font-bold">{title}</h3>
        {action}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function WorkCenterPage() {
  const { user, roles, isAdmin, isHR, permissionsLoading } = useAuth();
  const qc = useQueryClient();
  const [today, setToday] = useState(todayInBaghdad);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayInBaghdad()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const isManager =
    isAdmin || isHR || roles.includes("department_manager") || roles.includes("supervisor");
  const uid = user?.id;

  const deptsQ = useQuery({
    queryKey: ["wc-depts", uid, isAdmin, isHR],
    enabled: !!uid && !permissionsLoading,
    queryFn: async (): Promise<Dept[]> => {
      if (isAdmin || isHR) {
        const { data, error } = await supabase.from("departments").select("id, name").order("name");
        if (error) throw error;
        return data ?? [];
      }
      const [a, b] = await Promise.all([
        supabase.from("user_departments").select("department_id").eq("user_id", uid!),
        supabase.from("department_managers").select("department_id").eq("user_id", uid!),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const ids = new Set([...(a.data ?? []), ...(b.data ?? [])].map((r) => r.department_id));
      if (!ids.size) return [];
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .in("id", [...ids])
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const scopeIds = useMemo(() => (deptsQ.data ?? []).map((d) => d.id), [deptsQ.data]);

  const meQ = useQuery({
    queryKey: ["wc-me", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_employee_id");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  const empsQ = useQuery({
    queryKey: ["wc-emps", scopeIds],
    enabled: isManager && scopeIds.length > 0,
    queryFn: async (): Promise<Emp[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, position, department_id")
        .in("department_id", scopeIds)
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const emps = useMemo(() => empsQ.data ?? [], [empsQ.data]);
  const empById = useMemo(() => new Map(emps.map((e) => [e.id, e])), [emps]);
  const attendanceQ = useQuery({
    queryKey: ["wc-attendance", scopeIds, emps.map((employee) => employee.id), today],
    enabled: isManager && emps.length > 0,
    queryFn: async (): Promise<Map<string, AttendanceState>> => {
      const employeeIds = emps.map((employee) => employee.id);
      const startAt = instantAtMidnightInTimeZone(today);
      const endAt = instantAtMidnightInTimeZone(addDays(today, 1));
      const [statuses, logs] = await Promise.all([
        supabase
          .from("attendance_day_status")
          .select("employee_id, status")
          .eq("work_date", today)
          .in("employee_id", employeeIds),
        supabase
          .from("attendance_logs")
          .select("employee_id")
          .gte("verify_time", startAt)
          .lt("verify_time", endAt)
          .in("employee_id", employeeIds),
      ]);
      if (statuses.error) throw statuses.error;
      if (logs.error) throw logs.error;
      const result = new Map<string, AttendanceState>();
      const hasDeviceLog = new Set(
        (logs.data ?? []).map((row) => row.employee_id).filter((id): id is string => !!id),
      );
      for (const employee of emps) {
        const recorded = statuses.data?.find((row) => row.employee_id === employee.id)?.status;
        result.set(
          employee.id,
          recorded ?? (hasDeviceLog.has(employee.id) ? "present" : "unknown"),
        );
      }
      return result;
    },
  });

  const genQ = useQuery({
    queryKey: ["wc-generate", uid, today],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("generate_recurring_tasks", {
        _from: today,
        _to: today,
      });
      if (error) throw error;
      return data ?? 0;
    },
  });

  const from = addDays(today, -120);
  const tasksQ = useQuery({
    queryKey: ["wc-tasks", uid, isManager, scopeIds, meQ.data, genQ.dataUpdatedAt],
    enabled: !!uid && meQ.isFetched && !genQ.isLoading && (!isManager || deptsQ.isFetched),
    queryFn: async (): Promise<Task[]> => {
      let q = workCenterDb
        .from("employee_tasks")
        .select("*")
        .gte("task_date", from)
        .order("task_date", { ascending: false })
        .limit(5000);
      if (isManager) {
        if (!(isAdmin || isHR)) {
          if (!scopeIds.length) return [];
          q = q.in("department_id", scopeIds);
        }
      } else {
        const me = meQ.data;
        q = me ? q.or(`employee_id.eq.${me},created_by.eq.${uid}`) : q.eq("created_by", uid!);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const tasks = tasksQ.data ?? [];

  const templatesQ = useQuery({
    queryKey: ["wc-templates", scopeIds],
    enabled: isManager && scopeIds.length > 0,
    queryFn: async (): Promise<Template[]> => {
      const { data, error } = await workCenterDb
        .from("team_task_templates")
        .select("*")
        .in("department_id", scopeIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const guidanceQ = useQuery({
    queryKey: ["wc-guidance", uid, isManager, scopeIds],
    enabled: !!uid && (!isManager || deptsQ.isFetched),
    queryFn: async () => {
      let q = supabase
        .from("employee_guidance_notes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (isManager) {
        if (!(isAdmin || isHR))
          q = scopeIds.length ? q.in("department_id", scopeIds) : q.eq("target_user_id", uid!);
      } else q = q.eq("target_user_id", uid!);
      const legacy = isManager
        ? supabase
            .from("team_guidance_recipients")
            .select(
              "id, read_at, user_id, employee_id, created_at, team_guidance_notes(content, note_date, department_id)",
            )
            .order("created_at", { ascending: false })
            .limit(1000)
        : supabase
            .from("team_guidance_recipients")
            .select(
              "id, read_at, user_id, employee_id, created_at, team_guidance_notes(content, note_date, department_id)",
            )
            .eq("user_id", uid!)
            .order("created_at", { ascending: false });
      const [a, b] = await Promise.all([q, legacy]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      return {
        notes: (a.data ?? []) as Guidance[],
        legacy: (b.data ?? []) as unknown as LegacyRecipient[],
      };
    },
  });

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`work-center-guidance-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "employee_guidance_notes" },
        () => qc.invalidateQueries({ queryKey: ["wc-guidance"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [uid, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wc-tasks"] });
    void qc.invalidateQueries({ queryKey: ["wc-templates"] });
    void qc.invalidateQueries({ queryKey: ["wc-guidance"] });
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [personalCreateOpen, setPersonalCreateOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [completeTask, setCompleteTask] = useState<Task | null>(null);
  const [detailsTask, setDetailsTask] = useState<Task | null>(null);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [delayTask, setDelayTask] = useState<Task | null>(null);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [historyEmp, setHistoryEmp] = useState<Emp | null>(null);

  const empName = (id: string | null) => (id ? (empById.get(id)?.full_name ?? "—") : "—");

  const canDelete = isAdmin || isHR || roles.includes("department_manager");
  const deleteTask = async (t: Task) => {
    if (!window.confirm(`حذف المهمة "${t.title}" نهائياً؟`)) return;
    const { error, count } = await workCenterDb
      .from("employee_tasks")
      .delete({ count: "exact" })
      .eq("id", t.id);
    if (error || !count) return toast.error(error?.message ?? "لا تملك صلاحية حذف هذه المهمة");
    toast.success("تم حذف المهمة");
    refresh();
  };
  const updateStatus = async (t: Task, status: string) => {
    try {
      const patch: WorkCenterTaskUpdate = { status };
      const { error } = await workCenterDb.from("employee_tasks").update(patch).eq("id", t.id);
      if (error) throw error;
      toast.success("تم تحديث الحالة");
      refresh();
    } catch (e) {
      toast.error(`تعذر التحديث: ${errText(e)}`);
    }
  };

  const notes = guidanceQ.data?.notes ?? [];
  const myNotes = notes.filter((n) => n.target_user_id === uid);
  const unreadMine =
    myNotes.filter((n) => !n.read_at).length +
    (guidanceQ.data?.legacy ?? []).filter((r) => r.user_id === uid && !r.read_at).length;
  const unreadSent = notes.filter((n) => n.target_user_id !== uid && !n.read_at).length;

  const withStatus = tasks.map((t) => ({ t, s: effectiveStatus(t, today) }));
  const capacityById = useMemo(() => {
    const result = new Map<string, EmployeeCapacity>();
    for (const employee of emps) {
      const employeeTasks = withStatus.filter(({ t }) => t.employee_id === employee.id);
      const todayCount = employeeTasks.filter(({ t }) => t.task_date === today).length;
      const active = employeeTasks.filter(
        ({ s, t }) =>
          !["completed", "cancelled", "pending_review"].includes(s) && t.task_date <= today,
      ).length;
      const overdue = employeeTasks.filter(({ s }) => s === "overdue").length;
      const urgent = employeeTasks.filter(
        ({ s, t }) =>
          !["completed", "cancelled", "pending_review"].includes(s) &&
          t.priority === "urgent" &&
          t.task_date <= today,
      ).length;
      // Workload score gives overdue and urgent work twice the weight of a regular active task.
      const score = active + overdue * 2 + urgent * 2;
      result.set(employee.id, {
        attendance: attendanceQ.data?.get(employee.id) ?? "unknown",
        today: todayCount,
        active,
        overdue,
        urgent,
        score,
        load: score >= 8 ? "high" : score >= 4 ? "medium" : "low",
      });
    }
    return result;
  }, [emps, withStatus, today, attendanceQ.data]);
  if (permissionsLoading) return <State loading>{null}</State>;
  const todays = withStatus.filter(({ t }) => t.task_date === today);
  const overdue = withStatus.filter(({ s }) => s === "overdue");
  const upcoming = withStatus
    .filter(({ t, s }) => t.task_date > today && s !== "cancelled")
    .sort((a, b) => a.t.task_date.localeCompare(b.t.task_date));
  const followUp = withStatus.filter(
    ({ s, t }) =>
      s === "overdue" ||
      s === "needs_follow_up" ||
      s === "pending_review" ||
      !!t.delay_reason ||
      (s === "not_started" && t.task_date <= today),
  );

  const taskRows = (rows: { t: Task; s: string }[], showEmp = isManager) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>المهمة</TableHead>
          {showEmp && <TableHead>الموظف</TableHead>}
          <TableHead>المصدر</TableHead>
          <TableHead>النوع</TableHead>
          <TableHead>الأولوية</TableHead>
          <TableHead>التاريخ</TableHead>
          <TableHead>الموعد النهائي</TableHead>
          <TableHead>الحالة</TableHead>
          <TableHead className="text-left">إجراء</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ t, s }) => (
          <TableRow key={t.id}>
            <TableCell className="max-w-[280px]">
              <div className="font-medium">{t.title}</div>
              {t.description && (
                <div className="truncate text-xs text-muted-foreground">{t.description}</div>
              )}
              {t.completion_note && (
                <div className="text-xs text-emerald-700 dark:text-emerald-300">
                  ملاحظة الإنجاز: {t.completion_note}
                </div>
              )}
            </TableCell>
            {showEmp && <TableCell>{empName(t.employee_id)}</TableCell>}
            <TableCell>
              <Badge variant="outline">
                {t.assignment_source === "personal" ? "شخصية" : "مسندة"}
              </Badge>
            </TableCell>
            <TableCell>{TYPES[t.task_type] ?? t.task_type}</TableCell>
            <TableCell>{PRIORITIES[t.priority] ?? t.priority}</TableCell>
            <TableCell className="whitespace-nowrap">{t.task_date}</TableCell>
            <TableCell className="whitespace-nowrap">{t.due_date ?? "—"}</TableCell>
            <TableCell>
              <StatusBadge s={s} />
            </TableCell>
            <TableCell className="text-left">
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setDetailsTask(t)}>
                  التفاصيل
                </Button>
                {s === "pending_review" && isManager && t.employee_id !== meQ.data && (
                  <Button size="sm" onClick={() => setReviewTask(t)}>
                    مراجعة
                  </Button>
                )}
                {s === "overdue" && (isManager || t.employee_id === meQ.data) && (
                  <Button size="sm" variant="outline" onClick={() => setDelayTask(t)}>
                    سبب التأخير
                  </Button>
                )}
                {s === "pending_review" && (
                  <span className="self-center text-xs text-orange-600">بانتظار المراجعة</span>
                )}
                {s !== "completed" &&
                  s !== "cancelled" &&
                  s !== "pending_review" &&
                  (t.employee_id === meQ.data ||
                    (t.assignment_source === "personal" && t.created_by === uid)) && (
                    <>
                      {s !== "in_progress" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus(t, "in_progress")}
                        >
                          بدء
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setCompleteTask(t)}>
                        تم الإنجاز
                      </Button>
                    </>
                  )}
                {isManager && (
                  <Button size="sm" variant="ghost" onClick={() => setEditTask(t)}>
                    تعديل
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => deleteTask(t)}
                  >
                    حذف
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مركز العمل</h1>
          <p className="text-sm text-muted-foreground">
            {isManager ? "إدارة ومتابعة مهام وتوجيهات القسم" : "مهامك والتوجيهات الموجهة إليك"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPersonalCreateOpen(true)}>
            <Plus className="ml-1 h-4 w-4" /> مهمة شخصية
          </Button>
          {isManager && (
            <>
              <Button onClick={() => setCreateOpen(true)} disabled={!scopeIds.length}>
                <Plus className="ml-1 h-4 w-4" /> إنشاء مهمة
              </Button>
              <Button
                variant="outline"
                onClick={() => setGuidanceOpen(true)}
                disabled={!scopeIds.length}
              >
                <Send className="ml-1 h-4 w-4" /> إرسال توجيه
              </Button>
            </>
          )}
        </div>
      </div>
      {isManager && deptsQ.isFetched && !scopeIds.length && (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          لا توجد أقسام مرتبطة بحسابك. تواصل مع مدير النظام.
        </div>
      )}
      {!isManager && meQ.isFetched && !meQ.data && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-100">
          لم يتم ربط حسابك بسجل موظف (البريد أو الاسم غير مطابق)، لذلك قد لا تظهر المهام المسندة
          إليك.
        </div>
      )}

      <Tabs defaultValue="today" className="space-y-4">
        <TabsList>
          <TabsTrigger value="today">اليوم</TabsTrigger>
          <TabsTrigger value="tasks">المهام</TabsTrigger>
          {isManager && <TabsTrigger value="team">الفريق</TabsTrigger>}
          <TabsTrigger value="guidance">التوجيهات</TabsTrigger>
          <TabsTrigger value="performance">الأداء</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          <State loading={tasksQ.isLoading || genQ.isLoading} error={tasksQ.error ?? genQ.error}>
            {isManager ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                  <Stat label="مهام الفريق اليوم" value={todays.length} />
                  <Stat
                    label="المكتملة"
                    value={todays.filter((x) => x.s === "completed").length}
                    tone="text-emerald-600"
                  />
                  <Stat
                    label="قيد التنفيذ"
                    value={todays.filter((x) => x.s === "in_progress").length}
                    tone="text-sky-600"
                  />
                  <Stat
                    label="لم تبدأ"
                    value={todays.filter((x) => x.s === "not_started").length}
                    tone="text-muted-foreground"
                  />
                  <Stat label="المتأخرة" value={overdue.length} tone="text-red-600" />
                  <Stat label="تحتاج متابعة" value={followUp.length} tone="text-orange-600" />
                  <Stat label="توجيهات غير مقروءة" value={unreadSent} tone="text-orange-600" />
                </div>
                <Section title="يحتاج متابعة">
                  <State empty={!followUp.length && !unreadSent}>
                    {followUp.length > 0 && taskRows(followUp)}
                    {unreadSent > 0 && (
                      <p className="px-3 py-2 text-sm text-orange-700 dark:text-orange-300">
                        {unreadSent} توجيه لم يُقرأ بعد — راجع تبويب التوجيهات.
                      </p>
                    )}
                  </State>
                </Section>
              </>
            ) : (
              <>
                <Section title="مهام اليوم">
                  <State empty={!todays.length}>{taskRows(todays, false)}</State>
                </Section>
                <Section title="المهام المتأخرة">
                  <State empty={!overdue.length}>{taskRows(overdue, false)}</State>
                </Section>
                <Section title="المهام القادمة">
                  <State empty={!upcoming.length}>{taskRows(upcoming.slice(0, 20), false)}</State>
                </Section>
                <Section title={`التوجيهات الجديدة (${unreadMine})`}>
                  <State loading={guidanceQ.isLoading} error={guidanceQ.error} empty={!unreadMine}>
                    <GuidanceInbox
                      notes={myNotes.filter((n) => !n.read_at)}
                      legacy={(guidanceQ.data?.legacy ?? []).filter((r) => !r.read_at)}
                      onRead={refresh}
                    />
                  </State>
                </Section>
              </>
            )}
          </State>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <TasksTab
            rows={withStatus}
            loading={tasksQ.isLoading}
            error={tasksQ.error}
            isManager={isManager}
            emps={emps}
            render={taskRows}
          />
          {isManager && (
            <Section title="المهام المتكررة">
              <State
                loading={templatesQ.isLoading}
                error={templatesQ.error}
                empty={!(templatesQ.data ?? []).length}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المهمة</TableHead>
                      <TableHead>التكرار</TableHead>
                      <TableHead>المسؤول</TableHead>
                      <TableHead>الفترة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead className="text-left">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(templatesQ.data ?? []).map((tp) => (
                      <TableRow key={tp.id}>
                        <TableCell className="font-medium">{tp.title}</TableCell>
                        <TableCell>{scheduleText(tp)}</TableCell>
                        <TableCell className="max-w-[220px] truncate">
                          {tp.assignee_employee_ids.length
                            ? tp.assignee_employee_ids.map(empName).join("، ")
                            : "جميع موظفي القسم"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {tp.start_date} ← {tp.end_date ?? "مفتوح"}
                        </TableCell>
                        <TableCell>
                          {tp.active ? (
                            <Badge variant="secondary">نشطة</Badge>
                          ) : (
                            <Badge variant="outline">موقوفة</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-left">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  const { error } = await workCenterDb
                                    .from("team_task_templates")
                                    .update({ active: !tp.active })
                                    .eq("id", tp.id);
                                  if (error) throw error;
                                  if (!tp.active)
                                    await supabase.rpc("generate_recurring_tasks", {
                                      _from: today,
                                      _to: today,
                                    });
                                  toast.success(
                                    tp.active ? "تم إيقاف التكرار" : "تم استئناف التكرار",
                                  );
                                  refresh();
                                } catch (e) {
                                  toast.error(errText(e));
                                }
                              }}
                            >
                              {tp.active ? "إيقاف" : "استئناف"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditTemplate(tp)}>
                              تعديل الجدول
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </State>
            </Section>
          )}
        </TabsContent>

        {isManager && (
          <TabsContent value="team">
            <Section title="أعضاء الفريق">
              <State
                loading={empsQ.isLoading || tasksQ.isLoading || attendanceQ.isLoading}
                error={empsQ.error ?? tasksQ.error ?? attendanceQ.error}
                empty={!emps.length}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الاسم</TableHead>
                      <TableHead>المسمى الوظيفي</TableHead>
                      <TableHead>الحضور</TableHead>
                      <TableHead>مهام اليوم</TableHead>
                      <TableHead>النشطة</TableHead>
                      <TableHead>المكتمل</TableHead>
                      <TableHead>قيد التنفيذ</TableHead>
                      <TableHead>المتأخر</TableHead>
                      <TableHead>العاجل</TableHead>
                      <TableHead>نسبة الإنجاز</TableHead>
                      <TableHead>الحمل</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emps.map((e) => {
                      const mine = withStatus.filter(({ t }) => t.employee_id === e.id);
                      const td = mine.filter(({ t }) => t.task_date === today);
                      const done = td.filter((x) => x.s === "completed").length;
                      const capacity = capacityById.get(e.id);
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.full_name}</TableCell>
                          <TableCell>{e.position ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={capacity?.attendance === "present" ? "secondary" : "outline"}
                            >
                              {ATTENDANCE_LABELS[capacity?.attendance ?? "unknown"]}
                            </Badge>
                          </TableCell>
                          <TableCell>{td.length}</TableCell>
                          <TableCell>{capacity?.active ?? 0}</TableCell>
                          <TableCell className="text-emerald-600">{done}</TableCell>
                          <TableCell className="text-sky-600">
                            {td.filter((x) => x.s === "in_progress").length}
                          </TableCell>
                          <TableCell className="text-red-600">{capacity?.overdue ?? 0}</TableCell>
                          <TableCell>{capacity?.urgent ?? 0}</TableCell>
                          <TableCell>
                            {td.length ? Math.round((done / td.length) * 100) : 0}%
                          </TableCell>
                          <TableCell>
                            <Badge variant={capacity?.load === "high" ? "destructive" : "outline"}>
                              {capacity?.load === "high"
                                ? "مرتفع"
                                : capacity?.load === "medium"
                                  ? "متوسط"
                                  : "منخفض"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-left">
                            <Button size="sm" variant="outline" onClick={() => setHistoryEmp(e)}>
                              عرض السجل
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </State>
            </Section>
          </TabsContent>
        )}

        <TabsContent value="guidance">
          <State loading={guidanceQ.isLoading} error={guidanceQ.error}>
            {isManager ? (
              <SentGuidance
                notes={notes.filter((n) => n.target_user_id !== uid)}
                legacy={guidanceQ.data?.legacy ?? []}
                empName={empName}
              />
            ) : (
              <Section title="التوجيهات الموجهة إليك">
                <State empty={!myNotes.length && !(guidanceQ.data?.legacy ?? []).length}>
                  <GuidanceInbox
                    notes={myNotes}
                    legacy={guidanceQ.data?.legacy ?? []}
                    onRead={refresh}
                  />
                </State>
              </Section>
            )}
          </State>
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab
            rows={withStatus}
            emps={isManager ? emps : []}
            isManager={isManager}
            loading={tasksQ.isLoading}
            error={tasksQ.error}
          />
        </TabsContent>
      </Tabs>

      {isManager && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          depts={deptsQ.data ?? []}
          emps={emps}
          capacities={capacityById}
          employeeLoading={empsQ.isLoading}
          employeeError={empsQ.error ?? attendanceQ.error}
          uid={uid ?? ""}
          today={today}
          onDone={refresh}
        />
      )}
      {uid && (
        <PersonalTaskDialog
          open={personalCreateOpen}
          onOpenChange={setPersonalCreateOpen}
          uid={uid}
          employeeId={meQ.data ?? null}
          today={today}
          onDone={refresh}
        />
      )}
      {isManager && (
        <SendGuidanceDialog
          open={guidanceOpen}
          onOpenChange={setGuidanceOpen}
          depts={deptsQ.data ?? []}
          emps={emps}
          capacities={capacityById}
          employeeLoading={empsQ.isLoading}
          employeeError={empsQ.error ?? attendanceQ.error}
          uid={uid ?? ""}
          today={today}
          onDone={refresh}
        />
      )}
      {editTask && (
        <EditTaskDialog task={editTask} onClose={() => setEditTask(null)} onDone={refresh} />
      )}
      {completeTask && (
        <CompleteDialog
          task={completeTask}
          onClose={() => setCompleteTask(null)}
          onDone={refresh}
        />
      )}
      {detailsTask && (
        <TaskDetailsDialog
          task={detailsTask}
          onClose={() => setDetailsTask(null)}
          onDone={refresh}
        />
      )}
      {reviewTask && (
        <ReviewTaskDialog task={reviewTask} onClose={() => setReviewTask(null)} onDone={refresh} />
      )}
      {delayTask && (
        <DelayReasonDialog task={delayTask} onClose={() => setDelayTask(null)} onDone={refresh} />
      )}
      {editTemplate && (
        <EditTemplateDialog
          tp={editTemplate}
          today={today}
          onClose={() => setEditTemplate(null)}
          onDone={refresh}
        />
      )}
      {historyEmp && (
        <HistoryDialog
          emp={historyEmp}
          rows={withStatus.filter(({ t }) => t.employee_id === historyEmp.id)}
          notes={notes}
          today={today}
          onClose={() => setHistoryEmp(null)}
          render={taskRows}
        />
      )}
    </div>
  );
}

function scheduleText(tp: Template) {
  if (tp.recurrence_rule === "weekly")
    return `أسبوعية: ${(tp.weekdays?.length ? tp.weekdays : [new Date(tp.start_date + "T00:00:00").getDay()]).map((d) => WEEKDAYS[d]).join("، ")}`;
  if (tp.recurrence_rule === "monthly")
    return `شهرية: يوم ${tp.month_day ?? Number(tp.start_date.slice(8, 10))}`;
  if (tp.recurrence_rule === "weekdays") return "أيام العمل";
  if (tp.recurrence_rule === "interval") return `كل ${tp.interval_days} أيام`;
  return "يومية";
}

function TasksTab({
  rows,
  loading,
  error,
  isManager,
  emps,
  render,
}: {
  rows: { t: Task; s: string }[];
  loading: boolean;
  error: unknown;
  isManager: boolean;
  emps: Emp[];
  render: (r: { t: Task; s: string }[], showEmp?: boolean) => React.ReactNode;
}) {
  const [emp, setEmp] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [prio, setPrio] = useState("all");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const names = new Map(emps.map((e) => [e.id, e.full_name]));
  const filtered = rows.filter(({ t, s }) => {
    if (emp !== "all" && t.employee_id !== emp) return false;
    if (
      status !== "all" &&
      s !== status &&
      !(status === "needs_follow_up" && s === "pending_review")
    )
      return false;
    if (type !== "all" && (TYPES[t.task_type] ?? "") !== TYPES[type]) return false;
    if (prio !== "all" && t.priority !== prio) return false;
    if (date && t.task_date !== date) return false;
    if (source !== "all" && t.assignment_source !== source) return false;
    const q = search.trim();
    if (q && !t.title.includes(q) && !(names.get(t.employee_id ?? "") ?? "").includes(q))
      return false;
    return true;
  });
  return (
    <Section title={`المهام (${filtered.length})`}>
      <div className="flex flex-wrap gap-2 p-2">
        <Input
          className="w-56"
          placeholder="بحث باسم المهمة أو الموظف"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isManager && (
          <Select value={emp} onValueChange={setEmp}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="الموظف" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الموظفين</SelectItem>
              {emps.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            <SelectItem value="assigned">المهام المسندة</SelectItem>
            <SelectItem value="personal">المهام الشخصية</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {ALLOWED_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            {["one_time", "daily", "weekly", "monthly"].map((k) => (
              <SelectItem key={k} value={k}>
                {TYPES[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={prio} onValueChange={setPrio}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأولويات</SelectItem>
            {Object.entries(PRIORITIES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-40"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <State loading={loading} error={error} empty={!filtered.length}>
        {render(filtered.slice(0, 300))}
      </State>
    </Section>
  );
}

function GuidanceInbox({
  notes,
  legacy,
  onRead,
}: {
  notes: Guidance[];
  legacy: LegacyRecipient[];
  onRead: () => void;
}) {
  const markRead = async (
    table: "employee_guidance_notes" | "team_guidance_recipients",
    id: string,
  ) => {
    try {
      const { error } = await supabase
        .from(table)
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      onRead();
    } catch (e) {
      toast.error(`تعذر التحديث: ${errText(e)}`);
    }
  };
  return (
    <div className="divide-y">
      {notes.map((n) => (
        <div key={n.id} className="flex items-start justify-between gap-3 px-3 py-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              {n.title}
              {!n.read_at && (
                <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                  جديد
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{n.content}</p>
            <div className="mt-1 text-xs text-muted-foreground">
              {n.guidance_date} ·{" "}
              {new Date(n.created_at).toLocaleTimeString("ar-IQ", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
          {!n.read_at ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markRead("employee_guidance_notes", n.id)}
            >
              تمت القراءة
            </Button>
          ) : (
            <span className="text-xs text-emerald-600">مقروء</span>
          )}
        </div>
      ))}
      {legacy.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-3 px-3 py-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              توجيه القسم
              {!r.read_at && (
                <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                  جديد
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{r.team_guidance_notes?.content}</p>
            <div className="mt-1 text-xs text-muted-foreground">
              {r.team_guidance_notes?.note_date}
            </div>
          </div>
          {!r.read_at ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markRead("team_guidance_recipients", r.id)}
            >
              تمت القراءة
            </Button>
          ) : (
            <span className="text-xs text-emerald-600">مقروء</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SentGuidance({
  notes,
  legacy,
  empName,
}: {
  notes: Guidance[];
  legacy: LegacyRecipient[];
  empName: (id: string | null) => string;
}) {
  const [filter, setFilter] = useState("all");
  const rows = notes.filter(
    (n) => filter === "all" || (filter === "read" ? !!n.read_at : !n.read_at),
  );
  return (
    <div className="space-y-4">
      <Section
        title={`التوجيهات المرسلة (${notes.length})`}
        action={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="read">مقروء</SelectItem>
              <SelectItem value="unread">غير مقروء</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <State empty={!rows.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العنوان</TableHead>
                <TableHead>النص</TableHead>
                <TableHead>المستلم</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>وقت الإرسال</TableHead>
                <TableHead>حالة القراءة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.title}</TableCell>
                  <TableCell className="max-w-[320px] truncate">{n.content}</TableCell>
                  <TableCell>{empName(n.target_employee_id)}</TableCell>
                  <TableCell>{n.guidance_date}</TableCell>
                  <TableCell>
                    {new Date(n.created_at).toLocaleTimeString("ar-IQ", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>
                    {n.read_at ? (
                      <span className="text-emerald-600">مقروء</span>
                    ) : (
                      <span className="text-orange-600">غير مقروء</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </State>
      </Section>
      {legacy.length > 0 && (
        <Section title="توجيهات القسم السابقة">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النص</TableHead>
                <TableHead>المستلم</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>حالة القراءة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {legacy.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[360px] truncate">
                    {r.team_guidance_notes?.content}
                  </TableCell>
                  <TableCell>{empName(r.employee_id)}</TableCell>
                  <TableCell>{r.team_guidance_notes?.note_date}</TableCell>
                  <TableCell>
                    {r.read_at ? (
                      <span className="text-emerald-600">مقروء</span>
                    ) : (
                      <span className="text-orange-600">غير مقروء</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function PerformanceTab({
  rows,
  emps,
  isManager,
  loading,
  error,
}: {
  rows: { t: Task; s: string }[];
  emps: Emp[];
  isManager: boolean;
  loading: boolean;
  error: unknown;
}) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => todayInBaghdad().slice(0, 7));
  const monthStart = `${month}-01`;
  const [year, monthNumber] = monthStart.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const inMonth = rows.filter(({ t }) => t.task_date.startsWith(month) && t.status !== "cancelled");
  const eventsQ = useQuery({
    queryKey: ["wc-performance-events", month],
    enabled: inMonth.length > 0,
    queryFn: async (): Promise<TaskAuditEvent[]> => {
      const { data, error } = await workCenterDb
        .from("employee_task_events")
        .select("*")
        .gte("created_at", instantAtMidnightInTimeZone(monthStart))
        .lt("created_at", instantAtMidnightInTimeZone(nextMonthStart))
        .eq("event_type", "status_changed")
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const evalQ = useQuery({
    queryKey: ["wc-evals", monthStart, emps.map((e) => e.id)],
    enabled: isManager && emps.length > 0,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from("employee_monthly_evaluations")
        .select("employee_id, score")
        .eq("evaluation_month", monthStart)
        .in(
          "employee_id",
          emps.map((x) => x.id),
        );
      if (e) throw e;
      return new Map((data ?? []).map((r) => [r.employee_id, r.score]));
    },
  });
  const [scores, setScores] = useState<Record<string, string>>({});
  const metrics = (list: { t: Task; s: string }[]) => {
    const done = list.filter((x) => x.s === "completed").length;
    const completed = list.filter((x) => x.s === "completed" && x.t.completed_at);
    const durations = completed
      .filter((x) => x.t.started_at)
      .map(
        (x) =>
          (new Date(x.t.completed_at!).getTime() - new Date(x.t.started_at!).getTime()) / 60_000,
      )
      .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
    const taskIds = new Set(list.map(({ t }) => t.id));
    const returned = (eventsQ.data ?? []).filter(
      (event) => taskIds.has(event.task_id) && event.details.to === "needs_follow_up",
    ).length;
    const onTime = completed.filter(
      ({ t }) => !t.due_date || t.completed_at!.slice(0, 10) <= t.due_date,
    ).length;
    return {
      total: list.length,
      done,
      late: list.filter((x) => x.s === "overdue").length,
      rate: list.length ? Math.round((done / list.length) * 100) : 0,
      recurring: list.filter((x) => x.t.template_id && x.s === "completed").length,
      returned,
      averageMinutes: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : 0,
      onTime,
    };
  };
  const submit = async (empId: string) => {
    const score = Number(scores[empId]);
    if (!Number.isInteger(score) || score < 0 || score > 100)
      return toast.error("أدخل درجة صحيحة من 0 إلى 100");
    try {
      const { data, error: e } = await supabase.rpc("submit_employee_monthly_evaluation", {
        _employee_id: empId,
        _evaluation_month: monthStart,
        _score: score,
      });
      if (e) throw e;
      toast.success(
        Number(data?.[0]?.bonus_added ?? 0) > 0
          ? "تم حفظ التقييم وإضافة المكافأة"
          : "تم حفظ التقييم",
      );
      await qc.invalidateQueries({ queryKey: ["wc-evals"] });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const list = isManager
    ? emps.map((e) => ({ e, m: metrics(inMonth.filter(({ t }) => t.employee_id === e.id)) }))
    : [];
  const own = metrics(inMonth);
  return (
    <Section
      title="مؤشرات العمل"
      action={
        <Input
          type="month"
          className="h-8 w-40"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      }
    >
      <State
        loading={loading || eventsQ.isLoading || (isManager && evalQ.isLoading)}
        error={error ?? eventsQ.error ?? (isManager ? evalQ.error : null)}
      >
        {isManager ? (
          <State empty={!list.length}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>عدد المهام</TableHead>
                  <TableHead>المكتملة</TableHead>
                  <TableHead>المتأخرة</TableHead>
                  <TableHead>المعادة</TableHead>
                  <TableHead>متوسط الإنجاز (دقيقة)</TableHead>
                  <TableHead>المكتملة ضمن الموعد</TableHead>
                  <TableHead>نسبة الإنجاز</TableHead>
                  <TableHead>المتكررة المنجزة</TableHead>
                  <TableHead>التقييم الشهري</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map(({ e, m }) => {
                  const existing = evalQ.data?.get(e.id);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.full_name}</TableCell>
                      <TableCell>{m.total}</TableCell>
                      <TableCell className="text-emerald-600">{m.done}</TableCell>
                      <TableCell className="text-red-600">{m.late}</TableCell>
                      <TableCell>{m.returned}</TableCell>
                      <TableCell>{m.averageMinutes}</TableCell>
                      <TableCell>{m.onTime}</TableCell>
                      <TableCell>{m.rate}%</TableCell>
                      <TableCell>{m.recurring}</TableCell>
                      <TableCell>
                        {existing !== undefined ? (
                          <span className="font-semibold">{existing}/100</span>
                        ) : (
                          <div className="flex gap-1">
                            <Input
                              className="h-8 w-20"
                              type="number"
                              min={0}
                              max={100}
                              value={scores[e.id] ?? ""}
                              onChange={(ev) =>
                                setScores((s) => ({ ...s, [e.id]: ev.target.value }))
                              }
                            />
                            <Button size="sm" variant="outline" onClick={() => submit(e.id)}>
                              حفظ
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </State>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-2 md:grid-cols-4">
            <Stat label="عدد المهام" value={own.total} />
            <Stat label="المكتملة" value={own.done} tone="text-emerald-600" />
            <Stat label="المتأخرة" value={own.late} tone="text-red-600" />
            <Stat label="المعادة" value={own.returned} />
            <Stat label="متوسط الإنجاز (دقيقة)" value={own.averageMinutes} />
            <Stat label="المكتملة ضمن الموعد" value={own.onTime} />
            <Stat label="نسبة الإنجاز %" value={own.rate} />
            <Stat label="المتكررة المنجزة" value={own.recurring} />
          </div>
        )}
      </State>
    </Section>
  );
}

function PersonalTaskDialog({
  open,
  onOpenChange,
  uid,
  employeeId,
  today,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uid: string;
  employeeId: string | null;
  today: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (title.trim().length < 2) return toast.error("أدخل عنوان المهمة");
    if (dueDate < today) return toast.error("تاريخ المهمة لا يمكن أن يكون في الماضي");
    setSaving(true);
    try {
      const { error } = await workCenterDb.from("employee_tasks").insert({
        employee_id: employeeId,
        task_date: dueDate,
        start_date: today,
        due_date: dueDate,
        title: title.trim(),
        description: description.trim() || null,
        status: "not_started",
        duration_minutes: 0,
        created_by: uid,
        task_type: "one_time",
        priority: "normal",
        assignment_source: "personal",
        closing_requirement: "none",
        require_review: false,
      });
      if (error) throw error;
      toast.success("تمت إضافة المهمة الشخصية");
      setTitle("");
      setDescription("");
      setDueDate(today);
      onDone();
      onOpenChange(false);
    } catch (error) {
      toast.error(`تعذر إنشاء المهمة: ${errText(error)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>مهمة شخصية</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>العنوان</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div>
            <Label>الوصف</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div>
            <Label>التاريخ</Label>
            <Input
              type="date"
              min={today}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeePicker({
  emps,
  deptId,
  selected,
  setSelected,
  all,
  setAll,
  capacities,
  loading,
  error,
}: {
  emps: Emp[];
  deptId: string;
  selected: string[];
  setSelected: (v: string[]) => void;
  all: boolean;
  setAll: (v: boolean) => void;
  capacities: Map<string, EmployeeCapacity>;
  loading: boolean;
  error: unknown;
}) {
  const list = emps.filter((e) => e.department_id === deptId);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} /> جميع موظفي القسم (
        {list.length})
      </label>
      {!!error && (
        <div role="alert" className="text-sm text-destructive">
          تعذر تحميل بيانات الموظفين أو الحضور: {errText(error)}
        </div>
      )}
      {!all && (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">جارٍ تحميل أعضاء القسم...</p>
          ) : list.length ? (
            list.map((e) => {
              const capacity = capacities.get(e.id);
              const attendance = capacity?.attendance ?? "unknown";
              return (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selected.includes(e.id)}
                    onCheckedChange={(v) =>
                      setSelected(
                        v === true ? [...selected, e.id] : selected.filter((x) => x !== e.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{e.full_name}</span>
                    <span className="mr-2 text-xs text-muted-foreground">{e.position ?? ""}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ATTENDANCE_LABELS[attendance]} · {capacity?.today ?? 0} مهام اليوم ·{" "}
                      {capacity?.active ?? 0} نشطة · {capacity?.overdue ?? 0} متأخرة ·{" "}
                      {capacity?.urgent ?? 0} عاجلة · حمل{" "}
                      {capacity?.load === "high"
                        ? "مرتفع"
                        : capacity?.load === "medium"
                          ? "متوسط"
                          : "منخفض"}
                    </span>
                    {selected.includes(e.id) && attendance !== "present" && (
                      <span className="block text-xs text-amber-700 dark:text-amber-300">
                        ⚠{" "}
                        {attendance === "unknown"
                          ? "لا يوجد تسجيل حضور لهذا اليوم"
                          : `هذا الموظف ${ATTENDANCE_LABELS[attendance]} اليوم`}
                      </span>
                    )}
                    {selected.includes(e.id) && capacity?.load === "high" && (
                      <span className="block text-xs text-amber-700 dark:text-amber-300">
                        ⚠ هذا الموظف لديه حمل مرتفع من المهام النشطة.
                      </span>
                    )}
                  </span>
                </label>
              );
            })
          ) : (
            <p className="text-xs text-muted-foreground">لا يوجد موظفون نشطون في هذا القسم.</p>
          )}
        </div>
      )}
      {all && list.some((e) => capacities.get(e.id)?.attendance !== "present") && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚠ الاختيار يشمل موظفين بإجازة أو غياب أو دون تسجيل حضور اليوم.
        </p>
      )}
      {all && list.some((e) => capacities.get(e.id)?.load === "high") && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚠ الاختيار يشمل موظفين بحمل عمل مرتفع.
        </p>
      )}
    </div>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  depts,
  emps,
  capacities,
  employeeLoading,
  employeeError,
  uid,
  today,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  depts: Dept[];
  emps: Emp[];
  capacities: Map<string, EmployeeCapacity>;
  employeeLoading: boolean;
  employeeError: unknown;
  uid: string;
  today: string;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    type: "one_time",
    priority: "normal",
    dept: "",
    start: today,
    due: "",
    notes: "",
    monthDay: "",
  });
  const [checklistText, setChecklistText] = useState("");
  const [closingRequirement, setClosingRequirement] = useState<
    "none" | "note" | "file" | "attachment" | "link" | "result"
  >("none");
  const [requireReview, setRequireReview] = useState(true);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const dept = f.dept || depts[0]?.id || "";
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (f.title.trim().length < 2) return toast.error("أدخل عنوان المهمة");
    if (!dept) return toast.error("اختر القسم");
    const deptEmps = emps.filter((e) => e.department_id === dept).map((e) => e.id);
    const targets = all ? deptEmps : selected;
    if (!targets.length) return toast.error("اختر موظفاً واحداً على الأقل");
    if (f.due && f.due < f.start) return toast.error("الموعد النهائي قبل تاريخ البداية");
    if (f.type === "weekly" && !weekdays.length) return toast.error("اختر أيام الأسبوع");
    const checklistItems = checklistText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (checklistItems.some((item) => item.length > 240))
      return toast.error("لا يتجاوز كل عنصر تحقق 240 حرفاً");
    if (checklistItems.length > 50) return toast.error("قائمة التحقق لا تتجاوز 50 عنصراً");
    setSaving(true);
    try {
      if (f.type === "one_time") {
        const { error } = await workCenterDb.rpc("create_work_task_assignments", {
          _department_id: dept,
          _employee_ids: targets,
          _task_date: f.start,
          _due_date: f.due || null,
          _title: f.title.trim(),
          _description: f.description.trim() || null,
          _manager_note: f.notes.trim() || null,
          _priority: f.priority,
          _closing_requirement: closingRequirement,
          _require_review: requireReview,
          _checklist_items: checklistItems,
        } as never);
        if (error) throw error;
      } else {
        const desc =
          [f.description.trim(), f.notes.trim() ? `ملاحظات: ${f.notes.trim()}` : ""]
            .filter(Boolean)
            .join("\n") || null;
        const { error } = await workCenterDb.from("team_task_templates").insert({
          department_id: dept,
          title: f.title.trim(),
          description: desc,
          task_type: "recurring",
          priority: f.priority,
          recurrence_rule: f.type,
          start_date: f.start,
          end_date: f.due || null,
          assignee_employee_ids: all ? [] : targets,
          active: true,
          created_by: uid,
          weekdays: f.type === "weekly" ? weekdays : null,
          month_day: f.type === "monthly" && f.monthDay ? Number(f.monthDay) : null,
          checklist_items: checklistItems,
          closing_requirement: closingRequirement,
          require_review: requireReview,
        });
        if (error) throw error;
        const g = await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
        if (g.error) throw g.error;
      }
      toast.success("تم إنشاء المهمة");
      onDone();
      onOpenChange(false);
      setF({
        title: "",
        description: "",
        type: "one_time",
        priority: "normal",
        dept: "",
        start: today,
        due: "",
        notes: "",
        monthDay: "",
      });
      setChecklistText("");
      setClosingRequirement("none");
      setRequireReview(true);
      setSelected([]);
      setAll(false);
      setWeekdays([]);
    } catch (e) {
      toast.error(`تعذر الإنشاء: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const recurring = f.type !== "one_time";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إنشاء مهمة</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>عنوان المهمة</Label>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>وصف المهمة</Label>
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <Label>نوع المهمة</Label>
            <Select value={f.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["one_time", "daily", "weekly", "monthly"].map((k) => (
                  <SelectItem key={k} value={k}>
                    {k === "one_time" ? "مهمة لمرة واحدة" : `مهمة ${TYPES[k]}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الأولوية</Label>
            <Select value={f.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITIES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {f.type === "weekly" && (
            <div className="sm:col-span-2">
              <Label>أيام الأسبوع</Label>
              <div className="mt-1 flex flex-wrap gap-3">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1 text-sm">
                    <Checkbox
                      checked={weekdays.includes(i)}
                      onCheckedChange={(v) =>
                        setWeekdays(v === true ? [...weekdays, i] : weekdays.filter((x) => x !== i))
                      }
                    />{" "}
                    {d}
                  </label>
                ))}
              </div>
            </div>
          )}
          {f.type === "monthly" && (
            <div>
              <Label>يوم الشهر</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={f.monthDay}
                placeholder={String(Number(f.start.slice(8, 10)))}
                onChange={(e) => set("monthDay", e.target.value)}
              />
            </div>
          )}
          <div>
            <Label>تاريخ البداية</Label>
            <Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} />
          </div>
          <div>
            <Label>{recurring ? "الموعد النهائي (نهاية التكرار)" : "الموعد النهائي"}</Label>
            <Input type="date" value={f.due} onChange={(e) => set("due", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>القسم</Label>
            <Select
              value={dept}
              onValueChange={(v) => {
                set("dept", v);
                setSelected([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر القسم" />
              </SelectTrigger>
              <SelectContent>
                {depts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>الموظف المسؤول</Label>
            <EmployeePicker
              emps={emps}
              deptId={dept}
              selected={selected}
              setSelected={setSelected}
              all={all}
              setAll={setAll}
              capacities={capacities}
              loading={employeeLoading}
              error={employeeError}
            />
          </div>
          <details className="sm:col-span-2 rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold">خيارات متقدمة</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>قائمة التحقق (عنصر واحد في كل سطر، اختيارية)</Label>
                <Textarea
                  rows={3}
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  placeholder="مراجعة البيانات&#10;إعداد التقرير"
                />
              </div>
              <div>
                <Label>متطلب الإغلاق</Label>
                <Select
                  value={closingRequirement}
                  onValueChange={(v) => setClosingRequirement(v as typeof closingRequirement)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">غير مطلوب</SelectItem>
                    <SelectItem value="note">ملاحظة</SelectItem>
                    <SelectItem value="file">ملف</SelectItem>
                    <SelectItem value="attachment">مرفق</SelectItem>
                    <SelectItem value="link">رابط</SelectItem>
                    <SelectItem value="result">نتيجة نصية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={requireReview}
                  onCheckedChange={(value) => setRequireReview(value === true)}
                />{" "}
                يتطلب اعتماد المدير عند الإنجاز
              </label>
              <div className="sm:col-span-2">
                <Label>ملاحظات</Label>
                <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>
            </div>
          </details>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendGuidanceDialog({
  open,
  onOpenChange,
  depts,
  emps,
  capacities,
  employeeLoading,
  employeeError,
  uid,
  today,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  depts: Dept[];
  emps: Emp[];
  capacities: Map<string, EmployeeCapacity>;
  employeeLoading: boolean;
  employeeError: unknown;
  uid: string;
  today: string;
  onDone: () => void;
}) {
  const [deptSel, setDept] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [createTask, setCreateTask] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [saving, setSaving] = useState(false);
  const dept = deptSel || depts[0]?.id || "";
  const send = async () => {
    if (title.trim().length < 2 || !content.trim()) return toast.error("أدخل العنوان والنص");
    const targets = all ? emps.filter((e) => e.department_id === dept).map((e) => e.id) : selected;
    if (!targets.length) return toast.error("اختر مستلماً واحداً على الأقل");
    setSaving(true);
    try {
      const { data, error } = await workCenterDb.rpc("send_work_guidance", {
        _department_id: dept,
        _employee_ids: targets,
        _title: title.trim(),
        _content: content.trim(),
        _guidance_date: today,
        _create_task: createTask,
        _task_due_date: dueDate || null,
        _task_priority: priority,
      } as never);
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error("لم يتم حفظ التوجيه");
      toast.success(
        createTask
          ? `تم إرسال ${result.guidances_sent} توجيهاً وإنشاء ${result.tasks_created} مهمة مرتبطة`
          : `تم إرسال التوجيه إلى ${result.guidances_sent} موظف`,
      );
      if (result.unlinked_employees)
        toast.warning(
          `تعذر إيصال التوجيه إلى ${result.unlinked_employees} موظف لعدم ربط حساباتهم، لكن تم إنشاء المهام المرتبطة لهم عند تفعيلها.`,
        );
      onDone();
      onOpenChange(false);
      setTitle("");
      setContent("");
      setSelected([]);
      setAll(false);
      setCreateTask(false);
      setDueDate("");
      setPriority("normal");
    } catch (e) {
      toast.error(`تعذر الإرسال: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إرسال توجيه</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>القسم</Label>
            <Select
              value={dept}
              onValueChange={(v) => {
                setDept(v);
                setSelected([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {depts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>المستلم</Label>
            <EmployeePicker
              emps={emps}
              deptId={dept}
              selected={selected}
              setSelected={setSelected}
              all={all}
              setAll={setAll}
              capacities={capacities}
              loading={employeeLoading}
              error={employeeError}
            />
          </div>
          <div>
            <Label>العنوان</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>النص</Label>
            <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div className="rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={createTask}
                onCheckedChange={(value) => setCreateTask(value === true)}
              />{" "}
              يحتاج هذا التوجيه إلى تنفيذ كمهمة
            </label>
            {createTask && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>الموعد النهائي</Label>
                  <Input
                    type="date"
                    min={today}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label>الأولوية</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITIES).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={send} disabled={saving}>
            {saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTaskDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    due: task.due_date ?? "",
    status: ALLOWED_STATUSES.includes(task.status) ? task.status : "needs_follow_up",
    note: task.manager_note ?? "",
  });
  const [scope, setScope] = useState<"one" | "future">("one");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (f.title.trim().length < 2) return toast.error("أدخل عنوان المهمة");
    setSaving(true);
    try {
      const patch: WorkCenterTaskUpdate = {
        title: f.title.trim(),
        description: f.description.trim() || null,
        priority: f.priority,
        due_date: f.due || null,
        status: f.status,
        manager_note: f.note.trim() || null,
      };
      if (f.status === "completed" && !task.completed_at)
        patch.completed_at = new Date().toISOString();
      const { error } = await workCenterDb.from("employee_tasks").update(patch).eq("id", task.id);
      if (error) throw error;
      if (scope === "future" && task.template_id) {
        const t1 = await workCenterDb
          .from("team_task_templates")
          .update({ title: patch.title!, description: patch.description, priority: f.priority })
          .eq("id", task.template_id);
        if (t1.error) throw t1.error;
        const t2 = await workCenterDb
          .from("employee_tasks")
          .update({ title: patch.title!, description: patch.description, priority: f.priority })
          .eq("template_id", task.template_id)
          .gt("task_date", task.task_date)
          .eq("status", "not_started");
        if (t2.error) throw t2.error;
      }
      toast.success("تم حفظ التعديل");
      onDone();
      onClose();
    } catch (e) {
      toast.error(`تعذر الحفظ: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>تعديل المهمة</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>الوصف</Label>
            <Textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <div>
            <Label>الأولوية</Label>
            <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITIES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الحالة</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALLOWED_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الموعد النهائي</Label>
            <Input
              type="date"
              value={f.due}
              onChange={(e) => setF({ ...f, due: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>ملاحظة المدير</Label>
            <Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
          {task.template_id && (
            <div className="sm:col-span-2 space-y-1 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={scope === "one"} onChange={() => setScope("one")} />{" "}
                تعديل هذا التنفيذ فقط
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={scope === "future"}
                  onChange={() => setScope("future")}
                />{" "}
                تعديل هذا التنفيذ وجميع التنفيذات المستقبلية
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [proofNote, setProofNote] = useState(task.proof_note ?? "");
  const [proofLink, setProofLink] = useState(task.proof_link ?? "");
  const [proofResult, setProofResult] = useState(task.proof_result ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (task.closing_requirement === "note" && !proofNote.trim())
      return toast.error("أضف ملاحظة الإثبات المطلوبة");
    if (
      ["file", "attachment"].includes(task.closing_requirement) &&
      !file &&
      !task.proof_storage_path
    )
      return toast.error("أرفق الملف المطلوب");
    if (task.closing_requirement === "link" && !/^https?:\/\//i.test(proofLink.trim()))
      return toast.error("أدخل رابطاً صحيحاً يبدأ بـ http أو https");
    if (task.closing_requirement === "result" && !proofResult.trim())
      return toast.error("أدخل نتيجة العمل");
    setSaving(true);
    try {
      let proofPath = task.proof_storage_path;
      if (file) {
        if (file.size > 20 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 20 ميغابايت");
        const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
        const path = `${task.id}/${crypto.randomUUID()}-${safeName}`;
        const upload = await supabase.storage
          .from("task-evidence")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error) throw upload.error;
        proofPath = upload.data.path;
      }
      const { error } = await workCenterDb
        .from("employee_tasks")
        .update({
          status: "completed",
          completed_at: task.require_review ? null : new Date().toISOString(),
          completion_note: note.trim() || null,
          proof_note: proofNote.trim() || null,
          proof_storage_path: proofPath,
          proof_link: proofLink.trim() || null,
          proof_result: proofResult.trim() || null,
        })
        .eq("id", task.id);
      if (error) throw error;
      toast.success(
        task.require_review ? "تم إرسال الإنجاز إلى المدير للمراجعة" : "تم تسجيل الإنجاز",
      );
      onDone();
      onClose();
    } catch (e) {
      toast.error(`تعذر التسجيل: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تم الإنجاز — {task.title}</DialogTitle>
        </DialogHeader>
        <Label>ملاحظة الإنجاز (اختيارية)</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        {task.closing_requirement !== "none" && (
          <div className="space-y-2 rounded-md border p-3">
            <Label>
              متطلب الإغلاق:{" "}
              {
                (
                  {
                    note: "ملاحظة",
                    file: "ملف",
                    attachment: "مرفق",
                    link: "رابط",
                    result: "نتيجة نصية",
                  } as const
                )[task.closing_requirement]
              }
            </Label>
            {task.closing_requirement === "note" && (
              <Textarea
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                placeholder="أدخل ملاحظة الإثبات"
              />
            )}
            {["file", "attachment"].includes(task.closing_requirement) && (
              <div>
                <Input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,text/plain"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF أو صورة أو ملف نصي، حتى 20 ميغابايت.
                </p>
                {task.proof_storage_path && !file && (
                  <p className="text-xs text-muted-foreground">يوجد ملف إثبات محفوظ مسبقاً.</p>
                )}
              </div>
            )}
            {task.closing_requirement === "link" && (
              <Input
                value={proofLink}
                onChange={(e) => setProofLink(e.target.value)}
                placeholder="https://"
              />
            )}
            {task.closing_requirement === "result" && (
              <Textarea
                value={proofResult}
                onChange={(e) => setProofResult(e.target.value)}
                placeholder="اكتب نتيجة العمل"
              />
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            تأكيد الإنجاز
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewTaskDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const review = async (approve: boolean) => {
    if (!approve && note.trim().length < 3) return toast.error("اكتب سبب إعادة المهمة للموظف");
    setSaving(true);
    try {
      const { error } = await workCenterDb
        .from("employee_tasks")
        .update({
          status: approve ? "completed" : "needs_follow_up",
          manager_note: approve ? task.manager_note : note.trim(),
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id ?? null,
          completed_at: approve ? new Date().toISOString() : null,
        })
        .eq("id", task.id);
      if (error) throw error;
      toast.success(approve ? "تم اعتماد الإنجاز" : "أعيدت المهمة للموظف مع ملاحظة المراجعة");
      onDone();
      onClose();
    } catch (error) {
      toast.error(`تعذرت المراجعة: ${errText(error)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>مراجعة المهمة: {task.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {task.completion_note || "لم يضف الموظف ملاحظة إنجاز."}
        </p>
        <Label>سبب الإعادة (مطلوب عند الإعادة)</Label>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="مثال: التقرير ناقص بيانات الموقع الثالث"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => review(false)} disabled={saving}>
            إعادة للموظف
          </Button>
          <Button onClick={() => review(true)} disabled={saving}>
            اعتماد الإنجاز
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DELAY_REASONS = {
  waiting_data: "بانتظار بيانات",
  waiting_approval: "بانتظار موافقة",
  resource_shortage: "نقص موارد",
  external_blocker: "عائق خارجي",
  other_priority: "أولوية أخرى",
  other: "سبب آخر",
} as const;
function DelayReasonDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState(task.delay_reason ?? "waiting_data");
  const [note, setNote] = useState(task.delay_reason_note ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (reason === "other" && note.trim().length < 3) return toast.error("اكتب سبب التأخير");
    setSaving(true);
    try {
      const { error } = await workCenterDb
        .from("employee_tasks")
        .update({ delay_reason: reason, delay_reason_note: note.trim() || null })
        .eq("id", task.id);
      if (error) throw error;
      toast.success("تم حفظ سبب التأخير");
      onDone();
      onClose();
    } catch (error) {
      toast.error(`تعذر حفظ السبب: ${errText(error)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>سبب التأخير — {task.title}</DialogTitle>
        </DialogHeader>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DELAY_REASONS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(reason === "other" || note) && (
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="تفاصيل إضافية"
          />
        )}
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            حفظ السبب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailsDialog({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const checklistQ = useQuery({
    queryKey: ["wc-checklist", task.id],
    queryFn: async (): Promise<TaskChecklistItem[]> => {
      const { data, error } = await workCenterDb
        .from("task_checklist_items")
        .select("*")
        .eq("task_id", task.id)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const eventsQ = useQuery({
    queryKey: ["wc-task-events", task.id],
    queryFn: async (): Promise<TaskAuditEvent[]> => {
      const { data, error } = await workCenterDb
        .from("employee_task_events")
        .select("*")
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const guidanceQ = useQuery({
    queryKey: ["wc-linked-guidance", task.guidance_id],
    enabled: !!task.guidance_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_guidance_notes")
        .select("title, content")
        .eq("id", task.guidance_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const proofQ = useQuery({
    queryKey: ["wc-task-proof", task.proof_storage_path],
    enabled: !!task.proof_storage_path,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("task-evidence")
        .createSignedUrl(task.proof_storage_path!, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  const checklist = checklistQ.data ?? [];
  const completeCount = checklist.filter((item) => item.is_completed).length;
  const toggleChecklist = async (item: TaskChecklistItem) => {
    try {
      const completed = !item.is_completed;
      const { error } = await workCenterDb
        .from("task_checklist_items")
        .update({
          is_completed: completed,
          completed_by: completed ? (user?.id ?? null) : null,
          completed_at: completed ? new Date().toISOString() : null,
        })
        .eq("id", item.id);
      if (error) throw error;
      await Promise.all([checklistQ.refetch(), eventsQ.refetch()]);
      onDone();
    } catch (error) {
      toast.error(`تعذر تحديث قائمة التحقق: ${errText(error)}`);
    }
  };
  const eventLabel = (event: TaskAuditEvent) => {
    const names: Record<string, string> = {
      created: "تم إنشاء المهمة",
      recurrence_generated: "أنشأ النظام تنفيذ التكرار",
      status_changed: "تغيرت حالة المهمة",
      assignment_changed: "تغير الإسناد",
      updated: "تم تعديل المهمة",
      checklist_added: "أضيف عنصر تحقق",
      checklist_removed: "حذف عنصر تحقق",
      checklist_updated: "عُدّل عنصر تحقق",
      checklist_completed: "اكتمل عنصر تحقق",
      checklist_reopened: "أعيد فتح عنصر تحقق",
    };
    const from = event.details.from;
    const to = event.details.to;
    if (event.event_type === "status_changed" && typeof from === "string" && typeof to === "string")
      return `${STATUS[from]?.label ?? from} ← ${STATUS[to]?.label ?? to}`;
    if (typeof event.details.item === "string")
      return `${names[event.event_type] ?? event.event_type}: ${event.details.item}`;
    return names[event.event_type] ?? event.event_type;
  };
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat("ar-IQ", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Baghdad",
    }).format(new Date(value));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {task.description && (
            <p className="whitespace-pre-wrap text-muted-foreground">{task.description}</p>
          )}
          {task.manager_note && (
            <p className="rounded-md border p-3">ملاحظة المدير: {task.manager_note}</p>
          )}
          {checklistQ.isLoading ? (
            <State loading>{null}</State>
          ) : checklistQ.error ? (
            <State error={checklistQ.error}>{null}</State>
          ) : (
            checklist.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">
                  قائمة التحقق · {completeCount} من {checklist.length} (
                  {Math.round((completeCount / checklist.length) * 100)}%)
                </h3>
                {checklist.map((item) => (
                  <label key={item.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={item.is_completed}
                      disabled={task.status === "completed" || task.status === "pending_review"}
                      onCheckedChange={() => toggleChecklist(item)}
                    />
                    {item.label}
                  </label>
                ))}
              </section>
            )
          )}
          <section className="rounded-md border p-3">
            <h3 className="mb-2 font-semibold">متطلبات الإغلاق والإثبات</h3>
            <p>
              {task.closing_requirement === "none"
                ? "لا يتطلب إثباتاً"
                : `المطلوب: ${task.closing_requirement}`}
            </p>
            {task.proof_note && <p className="mt-1">الملاحظة: {task.proof_note}</p>}
            {task.proof_result && <p className="mt-1">النتيجة: {task.proof_result}</p>}
            {task.proof_link && (
              <a
                className="text-primary underline"
                href={task.proof_link}
                target="_blank"
                rel="noreferrer"
              >
                فتح رابط الإثبات
              </a>
            )}
            {task.proof_storage_path &&
              (proofQ.data ? (
                <a
                  className="text-primary underline"
                  href={proofQ.data}
                  target="_blank"
                  rel="noreferrer"
                >
                  تنزيل ملف الإثبات
                </a>
              ) : proofQ.error ? (
                <p role="alert" className="text-destructive">
                  تعذر فتح ملف الإثبات.
                </p>
              ) : (
                <p className="text-muted-foreground">جارٍ تحميل ملف الإثبات...</p>
              ))}
          </section>
          {task.delay_reason && (
            <p className="rounded-md border border-amber-300 p-3">
              سبب التأخير:{" "}
              {DELAY_REASONS[task.delay_reason as keyof typeof DELAY_REASONS] ?? task.delay_reason}
              {task.delay_reason_note ? ` · ${task.delay_reason_note}` : ""}
            </p>
          )}
          {task.guidance_id && (
            <section className="rounded-md border p-3">
              <h3 className="font-semibold">توجيه مرتبط</h3>
              {guidanceQ.isLoading ? (
                <p>جارٍ تحميل التوجيه...</p>
              ) : guidanceQ.error ? (
                <p role="alert" className="text-destructive">
                  تعذر تحميل التوجيه.
                </p>
              ) : guidanceQ.data ? (
                <>
                  <p className="font-medium">{guidanceQ.data.title}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {guidanceQ.data.content}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">التوجيه غير متاح لهذا الحساب.</p>
              )}
            </section>
          )}
          <section>
            <h3 className="mb-2 font-semibold">سجل التغييرات</h3>
            {eventsQ.isLoading ? (
              <State loading>{null}</State>
            ) : eventsQ.error ? (
              <State error={eventsQ.error}>{null}</State>
            ) : (
              <State empty={!eventsQ.data?.length}>
                {
                  <ol className="space-y-2 border-r pr-4">
                    {eventsQ.data?.map((event) => (
                      <li key={event.id} className="relative">
                        <span className="absolute -right-[21px] top-1.5 h-2 w-2 rounded-full bg-muted-foreground" />
                        <span className="font-medium">{eventLabel(event)}</span>
                        <span className="mr-2 text-xs text-muted-foreground">
                          {event.actor_name || "النظام"} · {dateTime(event.created_at)}
                        </span>
                      </li>
                    ))}
                  </ol>
                }
              </State>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTemplateDialog({
  tp,
  today,
  onClose,
  onDone,
}: {
  tp: Template;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const rule = ["daily", "weekly", "monthly"].includes(tp.recurrence_rule)
    ? tp.recurrence_rule
    : "daily";
  const [f, setF] = useState({
    rule,
    end: tp.end_date ?? "",
    monthDay: tp.month_day ? String(tp.month_day) : "",
  });
  const [weekdays, setWeekdays] = useState<number[]>(tp.weekdays ?? []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (f.rule === "weekly" && !weekdays.length) return toast.error("اختر أيام الأسبوع");
    setSaving(true);
    try {
      const { error } = await workCenterDb
        .from("team_task_templates")
        .update({
          recurrence_rule: f.rule,
          end_date: f.end || null,
          weekdays: f.rule === "weekly" ? weekdays : null,
          month_day: f.rule === "monthly" && f.monthDay ? Number(f.monthDay) : null,
        })
        .eq("id", tp.id);
      if (error) throw error;
      const d = await workCenterDb
        .from("employee_tasks")
        .delete()
        .eq("template_id", tp.id)
        .eq("task_date", today)
        .eq("status", "not_started");
      if (d.error) throw d.error;
      const g = await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
      if (g.error) throw g.error;
      toast.success("تم تعديل الجدول وتحديث مهمة اليوم؛ سيُنشأ تنفيذ جديد في يوم التكرار التالي");
      onDone();
      onClose();
    } catch (e) {
      toast.error(`تعذر الحفظ: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل جدول: {tp.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>التكرار</Label>
            <Select value={f.rule} onValueChange={(v) => setF({ ...f, rule: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">يومي</SelectItem>
                <SelectItem value="weekly">أسبوعي</SelectItem>
                <SelectItem value="monthly">شهري</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.rule === "weekly" && (
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <Checkbox
                    checked={weekdays.includes(i)}
                    onCheckedChange={(v) =>
                      setWeekdays(v === true ? [...weekdays, i] : weekdays.filter((x) => x !== i))
                    }
                  />{" "}
                  {d}
                </label>
              ))}
            </div>
          )}
          {f.rule === "monthly" && (
            <div>
              <Label>يوم الشهر</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={f.monthDay}
                onChange={(e) => setF({ ...f, monthDay: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label>تاريخ النهاية</Label>
            <Input
              type="date"
              value={f.end}
              onChange={(e) => setF({ ...f, end: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            تُنشأ مهمة اليوم فقط، ويُنشأ سجل جديد تلقائياً في كل يوم تكرار قادم.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  emp,
  rows,
  notes,
  today,
  onClose,
  render,
}: {
  emp: Emp;
  rows: { t: Task; s: string }[];
  notes: Guidance[];
  today: string;
  onClose: () => void;
  render: (r: { t: Task; s: string }[], showEmp?: boolean) => React.ReactNode;
}) {
  const groups: [string, { t: Task; s: string }[]][] = [
    ["مهام اليوم", rows.filter(({ t }) => t.task_date === today)],
    ["المهام القادمة", rows.filter(({ t, s }) => t.task_date > today && s !== "cancelled")],
    ["المهام المتأخرة", rows.filter(({ s }) => s === "overdue")],
    ["المهام المكتملة", rows.filter(({ s }) => s === "completed").slice(0, 30)],
    ["المهام المتكررة", rows.filter(({ t }) => !!t.template_id).slice(0, 30)],
  ];
  const myNotes = notes.filter((n) => n.target_employee_id === emp.id);
  const managerNotes = rows.filter(({ t }) => t.manager_note);
  const done = rows.filter((x) => x.s === "completed").length;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            سجل {emp.full_name}
            {emp.position ? ` — ${emp.position}` : ""}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="إجمالي المهام" value={rows.length} />
          <Stat label="المكتملة" value={done} tone="text-emerald-600" />
          <Stat
            label="المتأخرة"
            value={rows.filter((x) => x.s === "overdue").length}
            tone="text-red-600"
          />
          <Stat
            label="نسبة الإنجاز %"
            value={rows.length ? Math.round((done / rows.length) * 100) : 0}
          />
        </div>
        {groups.map(([title, list]) => (
          <Section key={title} title={`${title} (${list.length})`}>
            <State empty={!list.length}>{render(list, false)}</State>
          </Section>
        ))}
        <Section title={`التوجيهات (${myNotes.length})`}>
          <State empty={!myNotes.length}>
            <div className="divide-y">
              {myNotes.map((n) => (
                <div key={n.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">{n.title}</span> — {n.content}
                  </div>
                  <span className={n.read_at ? "text-emerald-600" : "text-orange-600"}>
                    {n.read_at ? "مقروء" : "غير مقروء"}
                  </span>
                </div>
              ))}
            </div>
          </State>
        </Section>
        <Section title="ملاحظات المدير">
          <State empty={!managerNotes.length}>
            <div className="divide-y">
              {managerNotes.map(({ t }) => (
                <div key={t.id} className="px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t.task_date} · {t.title}:
                  </span>{" "}
                  {t.manager_note}
                </div>
              ))}
            </div>
          </State>
        </Section>
      </DialogContent>
    </Dialog>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { permissionsDb } from "@/lib/permissions-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Edit3,
  ListChecks,
  Loader2,
  Plus,
  Trash2,
  Send,
  Megaphone,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "مهامي اليومية" }] }),
  component: EmployeeTasksPage,
});

type TaskStatus = "completed" | "in_progress";
type Task = {
  id: string;
  employee_id: string | null;
  task_date: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  duration_minutes: number;
  archived_at: string | null;
  created_by: string;
  department_id: string | null;
};
type GuidanceNote = {
  id: string;
  title: string;
  content: string;
  guidance_date: string;
  created_at: string;
  read_at: string | null;
};

const today = new Date().toISOString().slice(0, 10);
const normalizePersonName = (value: string = "") =>
  value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
const emptyForm = {
  title: "",
  description: "",
  status: "completed" as TaskStatus,
  duration: "",
};

function playTaskSavedSound() {
  if (typeof window === "undefined") return;
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.12);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
  oscillator.addEventListener("ended", () => void context.close());
}

function EmployeeTasksPage() {
  const { user, isAdmin, isHR, roles, canCreateTasks } = useAuth();
  const queryClient = useQueryClient();
  const canManageAll = isAdmin || isHR || roles.includes("supervisor");
  const currentEmployeeQuery = useQuery({
    queryKey: ["employee-tasks", "current-employee", user?.id, user?.email],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, email, full_name, department_id")
        .eq("status", "active");
      if (error) throw error;
      const accountName = String(user?.user_metadata?.full_name ?? "");
      const email = user?.email?.trim().toLowerCase();
      return (
        (data ?? []).find((employee) => email && employee.email?.trim().toLowerCase() === email) ??
        (data ?? []).find(
          (employee) =>
            normalizePersonName(employee.full_name) === normalizePersonName(accountName),
        ) ??
        null
      );
    },
  });
  const currentEmployee = currentEmployeeQuery.data;
  const [activeTab, setActiveTab] = useState<"daily" | "archive" | "guidance">("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [guidanceDepartmentId, setGuidanceDepartmentId] = useState("");
  const [departmentGuidanceContent, setDepartmentGuidanceContent] = useState("");
  const [isSendingDepartmentGuidance, setIsSendingDepartmentGuidance] = useState(false);
  const departmentsQuery = useQuery({
    queryKey: ["employee-tasks", "assigned-departments", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await permissionsDb
        .from("user_departments")
        .select("department_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((item) => item.department_id as string);
    },
  });
  const assignedDepartmentId = departmentsQuery.data?.[0] ?? null;
  const guidanceDepartmentsQuery = useQuery({
    queryKey: ["employee-tasks", "guidance-departments"],
    enabled: isAdmin || isHR,
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const guidanceDepartments = guidanceDepartmentsQuery.data ?? [];
  const selectedGuidanceDepartmentId = guidanceDepartments.some((department) => department.id === guidanceDepartmentId)
    ? guidanceDepartmentId
    : guidanceDepartments[0]?.id ?? "";
  const departmentGuidanceQuery = useQuery({
    queryKey: ["employee-tasks", "department-guidance", selectedGuidanceDepartmentId, selectedDate],
    enabled: Boolean((isAdmin || isHR) && selectedGuidanceDepartmentId),
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("team_guidance_notes").select("id, content")
        .eq("department_id", selectedGuidanceDepartmentId).eq("note_date", selectedDate).maybeSingle();
      if (error) throw error;
      return data as { id: string; content: string } | null;
    },
  });
  useEffect(() => setDepartmentGuidanceContent(departmentGuidanceQuery.data?.content ?? ""), [departmentGuidanceQuery.data?.id, departmentGuidanceQuery.data?.content]);
  const sendDepartmentGuidance = async () => {
    const content = departmentGuidanceContent.trim();
    if (!selectedGuidanceDepartmentId) return toast.error("اختر القسم أولاً");
    if (!content) return toast.error("اكتب نص التوجيه قبل إرساله");
    if (content.length > 3000) return toast.error("يجب ألا يتجاوز التوجيه 3000 حرف");
    if (!user) return toast.error("يجب تسجيل الدخول أولاً");
    setIsSendingDepartmentGuidance(true);
    try {
      const client = supabase as any;
      const result = departmentGuidanceQuery.data?.id
        ? await client.from("team_guidance_notes").update({ content }).eq("id", departmentGuidanceQuery.data.id)
        : await client.from("team_guidance_notes").insert({ department_id: selectedGuidanceDepartmentId, note_date: selectedDate, content, author_id: user.id });
      if (result.error) return toast.error(`تعذر إرسال التوجيه: ${result.error.message}`);
      await queryClient.invalidateQueries({ queryKey: ["employee-tasks", "department-guidance"] });
      toast.success("تم إرسال التوجيه إلى القسم");
    } finally {
      setIsSendingDepartmentGuidance(false);
    }
  };
  const guidanceQuery = useQuery({
    queryKey: ["employee-guidance", user?.id],
    enabled: Boolean(user) && activeTab === "guidance",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employee_guidance_notes")
        .select("id, title, content, guidance_date, created_at, read_at")
        .eq("target_user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as GuidanceNote[];
    },
  });

  const activeTasksQuery = useQuery({
    queryKey: ["employee-tasks", "active", selectedDate],
    queryFn: async () => {
      let query = supabase
        .from("employee_tasks")
        .select(
          "id, employee_id, task_date, title, description, status, duration_minutes, archived_at, created_by, department_id",
        )
        .eq("task_date", selectedDate)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (!canManageAll && user?.id) query = query.eq("created_by", user.id);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
    enabled: Boolean(user),
  });

  const archiveQuery = useQuery({
    queryKey: ["employee-tasks", "archive", archiveFrom, archiveTo, canManageAll, user?.id],
    queryFn: async () => {
      let query = supabase
        .from("employee_tasks")
        .select(
          "id, employee_id, task_date, title, description, status, duration_minutes, archived_at, created_by, department_id",
        )
        .not("archived_at", "is", null)
        .order("task_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (archiveFrom) query = query.gte("task_date", archiveFrom);
      if (archiveTo) query = query.lte("task_date", archiveTo);
      if (!canManageAll && user?.id) query = query.eq("created_by", user.id);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Task[];
    },
    enabled: Boolean(user) && activeTab === "archive",
  });

  const activeTasks = useMemo(() => activeTasksQuery.data ?? [], [activeTasksQuery.data]);
  const archivedTasks = archiveQuery.data ?? [];
  const stats = useMemo(
    () => ({
      total: activeTasks.length,
      completed: activeTasks.filter((task) => task.status === "completed").length,
      inProgress: activeTasks.filter((task) => task.status === "in_progress").length,
      minutes: activeTasks.reduce((sum, task) => sum + Number(task.duration_minutes || 0), 0),
      completionRate: activeTasks.length
        ? Math.round(
            (activeTasks.filter((task) => task.status === "completed").length /
              activeTasks.length) *
              100,
          )
        : 0,
    }),
    [activeTasks],
  );

  const markGuidanceRead = async (note: GuidanceNote) => {
    if (note.read_at || !user) return;
    await (supabase as any)
      .from("employee_guidance_notes")
      .update({ read_at: new Date().toISOString() })
      .eq("id", note.id)
      .eq("target_user_id", user.id);
    await queryClient.invalidateQueries({ queryKey: ["employee-guidance", user.id] });
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["employee-tasks"] });
  };
  const resetForm = () => {
    setForm(emptyForm);
    setEditingTask(null);
  };
  const saveTask = async () => {
    if (!user) return toast.error("يجب تسجيل الدخول أولاً");
    if (!canCreateTasks)
      return toast.error(
        "لا يسمح لك بإضافة أو تعديل المهام. يسمح بذلك مدخل البيانات وإداري الموقع فقط.",
      );
    if (selectedDate > today) return toast.error("لا يمكن تسجيل مهمة بتاريخ مستقبلي");
    if (form.title.trim().length < 2) return toast.error("اكتب عنوان المهمة بوضوح");
    const payload = {
      task_date: selectedDate,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      duration_minutes: Math.max(0, Number(form.duration) || 0),
      created_by: editingTask?.created_by ?? user.id,
      employee_id: currentEmployee?.id ?? editingTask?.employee_id ?? null,
      department_id: editingTask?.department_id ?? assignedDepartmentId,
    };
    const result = editingTask
      ? await supabase
          .from("employee_tasks")
          .update(payload as never)
          .eq("id", editingTask.id)
      : await supabase.from("employee_tasks").insert(payload as never);
    if (result.error) {
      if (result.error.code === "23502" && result.error.message.includes("employee_id")) {
        return toast.error(
          "قاعدة البيانات ما زالت تشترط employee_id. نفّذ كود تحديث جدول employee_tasks في Lovable Cloud SQL editor ثم أعد المحاولة.",
        );
      }
      return toast.error(result.error.message);
    }
    await invalidate();
    resetForm();
    playTaskSavedSound();
    toast.success(editingTask ? "تم تعديل المهمة" : "تمت إضافة المهمة");
  };
  const editTask = (task: Task) => {
    setEditingTask(task);
    setSelectedDate(task.task_date);
    setForm({
      title: task.title,
      description: task.description ?? "",
      status: task.status,
      duration: String(task.duration_minutes || ""),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const archiveTask = async (task: Task, restore = false) => {
    if (!restore && !window.confirm("هل تريد أرشفة هذه المهمة؟ ستبقى محفوظة في الأرشيف.")) return;
    const { error } = await supabase
      .from("employee_tasks")
      .update({ archived_at: restore ? null : new Date().toISOString() })
      .eq("id", task.id);
    if (error) return toast.error(error.message);
    await invalidate();
    toast.success(restore ? "تمت استعادة المهمة" : "تمت أرشفة المهمة");
  };
  const deleteTask = async (task: Task) => {
    if (!window.confirm("سيتم حذف المهمة نهائياً. هل أنت متأكد؟")) return;
    const { error } = await supabase.from("employee_tasks").delete().eq("id", task.id);
    if (error) return toast.error(error.message);
    await invalidate();
    toast.success("تم حذف المهمة");
  };

  const renderTaskRow = (task: Task, archived = false) => (
    <div key={task.id} className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-base">{task.title}</h3>
            <Badge variant={task.status === "completed" ? "default" : "secondary"}>
              {task.status === "completed" ? "منجزة" : "قيد التنفيذ"}
            </Badge>
            {archived && <Badge variant="outline">مؤرشفة</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">مهمتي الشخصية · {task.task_date}</p>
          {task.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm">{task.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.duration_minutes > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock3 className="w-3.5 h-3.5" /> {task.duration_minutes} دقيقة
            </span>
          )}
          {!archived && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => editTask(task)}
              title="تعديل"
              aria-label="تعديل"
            >
              <Edit3 className="w-4 h-4" />
            </Button>
          )}
          {!archived && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void archiveTask(task)}
              title="أرشفة"
              aria-label="أرشفة"
            >
              <Archive className="w-4 h-4 text-warning" />
            </Button>
          )}
          {archived && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void archiveTask(task, true)}
              title="استعادة"
              aria-label="استعادة"
            >
              <ArchiveRestore className="w-4 h-4 text-success" />
            </Button>
          )}
          {(canManageAll || task.created_by === user?.id) && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void deleteTask(task)}
              title="حذف"
              aria-label="حذف"
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold">مهامي اليومية</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            سجل الأعمال المنجزة خلال اليوم مع متابعة وإرشفة كاملة
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="task-date" className="whitespace-nowrap">
            تاريخ المهام
          </Label>
          <Input
            id="task-date"
            type="date"
            max={today}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="إجمالي المهام" value={stats.total} icon={ListChecks} />
        <StatCard label="منجزة" value={stats.completed} icon={CheckCircle2} />
        <StatCard label="قيد التنفيذ" value={stats.inProgress} icon={Clock3} />
        <StatCard label="إجمالي الدقائق" value={stats.minutes} icon={Clock3} />
        <StatCard
          label="نسبة الإنجاز"
          value={stats.completionRate}
          suffix="%"
          icon={CheckCircle2}
        />
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "daily" | "archive" | "guidance")}
        dir="rtl"
      >
        <TabsList>
          <TabsTrigger value="daily">إدخال ومتابعة المهام</TabsTrigger>
          <TabsTrigger value="archive">أرشيف المهام</TabsTrigger>
          <TabsTrigger value="guidance">توجيهات مدير القسم</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="space-y-5">
          {(isAdmin || isHR) && <Card className="overflow-hidden rounded-2xl border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 shadow-sm dark:border-teal-900 dark:from-teal-950/40 dark:via-card dark:to-emerald-950/20">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-teal-700 dark:text-teal-300" /> إرسال توجيه للقسم</CardTitle><p className="text-sm text-muted-foreground">اكتب تعليمات اليوم لتظهر لأعضاء القسم في مهامي اليومية.</p></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(13rem,0.7fr)_1.5fr]">
              <div className="space-y-2"><Label htmlFor="guidance-department">القسم</Label><select id="guidance-department" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedGuidanceDepartmentId} onChange={(event) => setGuidanceDepartmentId(event.target.value)}><option value="" disabled>اختر القسم</option>{guidanceDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><p className="text-xs text-muted-foreground">التوجيه مرتبط بتاريخ {selectedDate}</p></div>
              <div className="space-y-2"><Label htmlFor="daily-guidance">نص التوجيه</Label><Textarea id="daily-guidance" value={departmentGuidanceContent} onChange={(event) => setDepartmentGuidanceContent(event.target.value)} maxLength={3000} placeholder="اكتب الأولويات والتعليمات المطلوبة من الفريق..." className="min-h-24 bg-background" /><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{departmentGuidanceContent.length}/3000{departmentGuidanceQuery.data ? " · توجيه محفوظ" : ""}</span><Button onClick={() => void sendDepartmentGuidance()} disabled={isSendingDepartmentGuidance || departmentGuidanceQuery.isLoading || !selectedGuidanceDepartmentId || guidanceDepartmentsQuery.isLoading}>{isSendingDepartmentGuidance ? <Clock3 className="ml-2 h-4 w-4 animate-spin" /> : <Send className="ml-2 h-4 w-4" />}{departmentGuidanceQuery.data ? "تحديث التوجيه" : "إرسال التوجيه"}</Button></div></div>
            </CardContent>
          </Card>}
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                {editingTask ? "تعديل مهمة" : "إضافة مهمة منجزة"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                <b className="text-foreground">السجل الشخصي:</b> سيتم حفظ المهمة تلقائياً باسم حسابك
                الحالي، ولا يمكن إدخال مهمة باسم موظف آخر.
              </div>
              <div>
                <Label>حالة المهمة</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                >
                  <option value="completed">منجزة</option>
                  <option value="in_progress">قيد التنفيذ</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>عنوان المهمة</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="مثال: إعداد التقرير اليومي للموقع"
                  maxLength={200}
                />
              </div>
              <div>
                <Label>المدة بالدقائق (اختياري)</Label>
                <Input
                  type="number"
                  min="0"
                  max="1440"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="md:col-span-2">
                <Label>تفاصيل المهمة (اختياري)</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="اكتب وصفاً مختصراً لما تم إنجازه..."
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button variant="outline" onClick={resetForm}>
                  تفريغ
                </Button>
                <Button onClick={() => void saveTask()} disabled={activeTasksQuery.isLoading}>
                  {activeTasksQuery.isLoading && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
                  {editingTask ? "حفظ التعديل" : "حفظ المهمة"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">مهام {selectedDate}</h2>
              <Badge variant="outline">{activeTasks.length} مهمة</Badge>
            </div>
            {activeTasksQuery.isLoading ? (
              <p className="text-muted-foreground">جارٍ تحميل المهام...</p>
            ) : activeTasksQuery.error ? (
              <p className="text-destructive">
                تعذر تحميل المهام: {activeTasksQuery.error.message}
              </p>
            ) : activeTasks.length ? (
              <div className="space-y-3">{activeTasks.map((task) => renderTaskRow(task))}</div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  لا توجد مهام مسجلة لهذا التاريخ. أضف أول مهمة من النموذج أعلاه.
                </CardContent>
              </Card>
            )}
          </section>
        </TabsContent>
        <TabsContent value="archive" className="space-y-5">
          <Card>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>من تاريخ</Label>
                <Input
                  type="date"
                  max={today}
                  value={archiveFrom}
                  onChange={(e) => setArchiveFrom(e.target.value)}
                />
              </div>
              <div>
                <Label>إلى تاريخ</Label>
                <Input
                  type="date"
                  max={today}
                  value={archiveTo}
                  onChange={(e) => setArchiveTo(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setArchiveFrom("");
                    setArchiveTo("");
                  }}
                >
                  إظهار كل الأرشيف
                </Button>
              </div>
            </CardContent>
          </Card>
          {archiveQuery.isLoading ? (
            <p className="text-muted-foreground">جارٍ تحميل الأرشيف...</p>
          ) : archiveQuery.error ? (
            <p className="text-destructive">تعذر تحميل الأرشيف: {archiveQuery.error.message}</p>
          ) : archivedTasks.length ? (
            <div className="space-y-3">
              {archivedTasks.map((task) => renderTaskRow(task, true))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                لا توجد مهام مؤرشفة ضمن الفلتر.
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="guidance" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>التوجيهات الواردة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {guidanceQuery.isLoading ? (
                <p className="text-muted-foreground">جارٍ تحميل التوجيهات...</p>
              ) : (guidanceQuery.data ?? []).length ? (
                (guidanceQuery.data ?? []).map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`w-full rounded-xl border p-4 text-right ${note.read_at ? "bg-card" : "border-primary/50 bg-primary/5"}`}
                    onClick={() => void markGuidanceRead(note)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong>{note.title}</strong>
                      {!note.read_at && <Badge>جديد</Badge>}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {note.content}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{note.guidance_date}</p>
                  </button>
                ))
              ) : (
                <p className="py-8 text-center text-muted-foreground">لا توجد توجيهات واردة.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix = "",
  icon: Icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: typeof ListChecks;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">
            {value.toLocaleString("ar-IQ")}
            {suffix}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

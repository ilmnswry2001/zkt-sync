import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
  Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "مهام الموظفين" }] }),
  component: EmployeeTasksPage,
});

type TaskStatus = "completed" | "in_progress";
type Employee = { id: string; employee_no: string; full_name: string; position: string | null };
type Task = {
  id: string;
  employee_id: string;
  task_date: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  duration_minutes: number;
  archived_at: string | null;
  created_by: string;
  employee?: Employee | null;
};

const today = new Date().toISOString().slice(0, 10);
const emptyForm = {
  employeeId: "",
  title: "",
  description: "",
  status: "completed" as TaskStatus,
  duration: "",
};

function EmployeeTasksPage() {
  const { user, isAdmin, isHR, roles } = useAuth();
  const queryClient = useQueryClient();
  const canManageAll = isAdmin || isHR || roles.includes("supervisor");
  const [activeTab, setActiveTab] = useState<"daily" | "archive">("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const employeesQuery = useQuery({
    queryKey: ["task-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
  const employees = employeesQuery.data ?? [];

  const activeTasksQuery = useQuery({
    queryKey: ["employee-tasks", "active", selectedDate],
    queryFn: async () => {
      let query = supabase
        .from("employee_tasks")
        .select(
          "id, employee_id, task_date, title, description, status, duration_minutes, archived_at, created_by, employees(id, employee_no, full_name, position)",
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
          "id, employee_id, task_date, title, description, status, duration_minutes, archived_at, created_by, employees(id, employee_no, full_name, position)",
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
      employees: new Set(activeTasks.map((task) => task.employee_id)).size,
    }),
    [activeTasks],
  );

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["employee-tasks"] });
  };
  const resetForm = () => {
    setForm({ ...emptyForm, employeeId: employees[0]?.id ?? "" });
    setEditingTask(null);
  };
  const saveTask = async () => {
    if (!user) return toast.error("يجب تسجيل الدخول أولاً");
    if (!form.employeeId) return toast.error("اختر اسم الموظف");
    if (selectedDate > today) return toast.error("لا يمكن تسجيل مهمة بتاريخ مستقبلي");
    if (form.title.trim().length < 2) return toast.error("اكتب عنوان المهمة بوضوح");
    const payload = {
      employee_id: form.employeeId,
      task_date: selectedDate,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      duration_minutes: Math.max(0, Number(form.duration) || 0),
      created_by: editingTask?.created_by ?? user.id,
    };
    const result = editingTask
      ? await supabase.from("employee_tasks").update(payload).eq("id", editingTask.id)
      : await supabase.from("employee_tasks").insert(payload);
    if (result.error) return toast.error(result.error.message);
    await invalidate();
    resetForm();
    toast.success(editingTask ? "تم تعديل المهمة" : "تمت إضافة المهمة");
  };
  const editTask = (task: Task) => {
    setEditingTask(task);
    setSelectedDate(task.task_date);
    setForm({
      employeeId: task.employee_id,
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
          <p className="mt-1 text-sm text-muted-foreground">
            {task.employee?.full_name ?? "موظف غير محدد"} · {task.employee?.employee_no ?? "—"} ·{" "}
            {task.task_date}
          </p>
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
            <h1 className="text-3xl font-bold">مهام الموظفين</h1>
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
        <StatCard label="الموظفون" value={stats.employees} icon={Users} />
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "daily" | "archive")}
        dir="rtl"
      >
        <TabsList>
          <TabsTrigger value="daily">إدخال ومتابعة المهام</TabsTrigger>
          <TabsTrigger value="archive">أرشيف المهام</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="space-y-5">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                {editingTask ? "تعديل مهمة" : "إضافة مهمة منجزة"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>الموظف</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                >
                  <option value="">اختر الموظف</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name} — {employee.employee_no}
                    </option>
                  ))}
                </select>
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
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
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
          <p className="text-2xl font-bold">{value.toLocaleString("ar-IQ")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

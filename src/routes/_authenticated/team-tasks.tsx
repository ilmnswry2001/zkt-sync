import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { permissionsDb } from "@/lib/permissions-client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, ClipboardList, Clock3, MessageSquare, Save, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/team-tasks")({
  head: () => ({ meta: [{ title: "مهام الفريق" }] }),
  component: TeamTasksPage,
});

type Department = { id: string; name: string };
type Profile = { id: string; full_name: string | null; email: string | null };
type TeamTask = {
  id: string;
  task_date: string;
  title: string;
  description: string | null;
  status: "completed" | "in_progress";
  duration_minutes: number;
  created_by: string;
  department_id: string | null;
  manager_note: string | null;
};

const today = todayInBaghdad();
const db = supabase as unknown as { from: (table: string) => any };

function TeamTasksPage() {
  const { isAdmin, isHR, roles } = useAuth();
  const queryClient = useQueryClient();
  const canSeeAll = isAdmin || isHR;
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("all");
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});

  const departmentsQuery = useQuery({
    queryKey: ["team-tasks", "departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const assignedDepartmentsQuery = useQuery({
    queryKey: ["team-tasks", "assigned-departments"],
    enabled: !canSeeAll,
    queryFn: async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return [] as string[];
      const { data, error } = await permissionsDb
        .from("user_departments")
        .select("department_id")
        .eq("user_id", authData.user.id);
      if (error) throw error;
      return (data ?? []).map((item) => item.department_id as string);
    },
  });
  const departments = departmentsQuery.data ?? [];
  const allowedIds = canSeeAll
    ? departments.map((item) => item.id)
    : (assignedDepartmentsQuery.data ?? []);
  const effectiveDepartmentId =
    departmentId === "all" || allowedIds.includes(departmentId) ? departmentId : "all";

  const tasksQuery = useQuery({
    queryKey: ["team-tasks", date, effectiveDepartmentId, allowedIds],
    enabled: canSeeAll || allowedIds.length > 0,
    queryFn: async () => {
      let query = db
        .from("employee_tasks")
        .select(
          "id, task_date, title, description, status, duration_minutes, created_by, department_id, manager_note",
        )
        .eq("task_date", date)
        .order("created_at", { ascending: false });
      if (effectiveDepartmentId !== "all") query = query.eq("department_id", effectiveDepartmentId);
      else if (!canSeeAll) query = query.in("department_id", allowedIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeamTask[];
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["team-tasks", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const profiles = profilesQuery.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const stats = useMemo(
    () => ({
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "completed").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      notes: tasks.filter((task) => task.manager_note?.trim()).length,
    }),
    [tasks],
  );

  const saveNote = async (task: TeamTask) => {
    const note = (draftNotes[task.id] ?? task.manager_note ?? "").trim() || null;
    const { error } = await db
      .from("employee_tasks")
      .update({ manager_note: note })
      .eq("id", task.id);
    if (error) return toast.error(formatErrorMessage(error));
    await queryClient.invalidateQueries({ queryKey: ["team-tasks"] });
    toast.success("تم حفظ ملاحظة المدير");
  };

  if (!canSeeAll && !allowedIds.length) {
    return (
      <Card className="border-warning/40">
        <CardContent className="p-8 text-center">
          <h1 className="text-2xl font-bold">مهام الفريق</h1>
          <p className="mt-2 text-muted-foreground">
            لم يتم تعيين أقسام لهذا الحساب. اطلب من مدير النظام تحديد نطاق الوصول.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">مهام الفريق</h1>
          <p className="mt-1 text-muted-foreground">
            متابعة مهام أعضاء الفريق وإضافة ملاحظات إدارية ضمن الأقسام المسموحة
          </p>
        </div>
        <Badge variant="outline">
          {canSeeAll
            ? "مدير النظام / الموارد البشرية"
            : roles.includes("department_manager")
              ? "مدير إدارة"
              : "مشاهدة محدودة"}
        </Badge>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="w-full sm:w-56">
            <Label>القسم</Label>
            <Select value={effectiveDepartmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="كل الأقسام المسموحة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام المسموحة</SelectItem>
                {departments
                  .filter((item) => allowedIds.includes(item.id))
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDate(today);
              setDepartmentId("all");
            }}
          >
            اليوم
          </Button>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={ClipboardList} label="كل المهام" value={stats.total} />
        <Stat icon={CheckCircle2} label="منجزة" value={stats.completed} tone="green" />
        <Stat icon={Clock3} label="قيد التنفيذ" value={stats.inProgress} tone="orange" />
        <Stat icon={MessageSquare} label="ملاحظات المدير" value={stats.notes} tone="blue" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>مهام الفريق — {date}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tasks.map((task) => {
            const profile = profileById.get(task.created_by);
            return (
              <div key={task.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{task.title}</h3>
                      <Badge variant={task.status === "completed" ? "default" : "secondary"}>
                        {task.status === "completed" ? "منجزة" : "قيد التنفيذ"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      <Users className="ml-1 inline h-4 w-4" />
                      {profile?.full_name ?? profile?.email ?? task.created_by}
                      {task.duration_minutes ? ` · ${task.duration_minutes} دقيقة` : ""}
                    </p>
                    {task.description && (
                      <p className="mt-3 whitespace-pre-wrap text-sm">{task.description}</p>
                    )}
                  </div>
                  <div className="w-full lg:max-w-md">
                    <Label>ملاحظة المدير</Label>
                    <Textarea
                      value={draftNotes[task.id] ?? task.manager_note ?? ""}
                      onChange={(event) =>
                        setDraftNotes((current) => ({ ...current, [task.id]: event.target.value }))
                      }
                      placeholder="أضف توجيهاً أو ملاحظة تقييمية..."
                      rows={2}
                    />
                    <Button size="sm" className="mt-2" onClick={() => void saveNote(task)}>
                      <Save className="ml-2 h-4 w-4" /> حفظ الملاحظة
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {!tasks.length && (
            <div className="py-12 text-center text-muted-foreground">
              لا توجد مهام ضمن القسم والتاريخ المحددين.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon
          className={`h-5 w-5 ${tone === "green" ? "text-emerald-600" : tone === "orange" ? "text-orange-600" : tone === "blue" ? "text-blue-600" : "text-primary"}`}
        />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

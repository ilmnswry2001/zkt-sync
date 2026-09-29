import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { permissionsDb } from "@/lib/permissions-client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
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
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  MessageSquare,
  Users,
  XCircle,
  Clock3,
  ListChecks,
  Eye,
  Save,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/team-follow-up")({
  head: () => ({ meta: [{ title: "متابعة الفريق" }] }),
  component: TeamFollowUpPage,
});

type Department = { id: string; name: string };
type Site = { id: string; name: string; ctr_code: string | null };
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  department_id: string | null;
  site_id: string | null;
  status: string;
};
type SiteReport = {
  id: string;
  site_id: string;
  report_date: string;
  notes: string | null;
  created_by: string | null;
};
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
type Profile = { id: string; full_name: string | null; email: string | null };
type GuidanceNote = { id: string; department_id: string | null; note_date: string; content: string; author_id: string; created_at: string };
type MemberTaskStats = { userId: string; profile: Profile | undefined; total: number; completed: number; minutes: number; today: number; tasks: TeamTask[] };

const today = new Date().toISOString().slice(0, 10);
const isSiteAdministrator = (employee: Employee) =>
  /ادار|إدار|site\s*admin|administrator/i.test(employee.position ?? "");

function TeamFollowUpPage() {
  const { isAdmin, isHR, roles } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("all");
  const [detailsMember, setDetailsMember] = useState<MemberTaskStats | null>(null);
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [generalNote, setGeneralNote] = useState("");
  const canSeeAll = isAdmin || isHR;

  const departmentsQuery = useQuery({
    queryKey: ["team-follow-up-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });
  const departments = departmentsQuery.data ?? [];
  const assignedDepartmentsQuery = useQuery({
    queryKey: ["team-follow-up-assigned-departments"],
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
  const allowedDepartmentIds = canSeeAll
    ? departments.map((department) => department.id)
    : assignedDepartmentsQuery.data ?? [];
  const effectiveDepartmentId =
    departmentId !== "all" && allowedDepartmentIds.includes(departmentId) ? departmentId : "all";

  const employeesQuery = useQuery({
    queryKey: ["team-follow-up-employees", allowedDepartmentIds],
    enabled: allowedDepartmentIds.length > 0,
    queryFn: async () => {
      const query = supabase
        .from("employees")
        .select("id, employee_no, full_name, position, department_id, site_id, status")
        .eq("status", "active");
      const { data, error } = await (canSeeAll
        ? query
        : query.in("department_id", allowedDepartmentIds));
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
  const employees = employeesQuery.data ?? [];
  const visibleEmployees =
    effectiveDepartmentId === "all"
      ? employees
      : employees.filter((employee) => employee.department_id === effectiveDepartmentId);
  const siteIds = [
    ...new Set(visibleEmployees.map((employee) => employee.site_id).filter(Boolean)),
  ] as string[];

  const sitesQuery = useQuery({
    queryKey: ["team-follow-up-sites", siteIds],
    enabled: siteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, ctr_code")
        .in("id", siteIds);
      if (error) throw error;
      return (data ?? []) as Site[];
    },
  });
  const reportsQuery = useQuery({
    queryKey: ["team-follow-up-reports", siteIds, date],
    enabled: siteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_daily_reports")
        .select("id, site_id, report_date, notes, created_by")
        .in("site_id", siteIds)
        .eq("report_date", date);
      if (error) throw error;
      return (data ?? []) as SiteReport[];
    },
  });
  const reports = reportsQuery.data ?? [];
  const sites = sitesQuery.data ?? [];
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const reportBySite = new Map(reports.map((report) => [report.site_id, report]));
  const departmentById = new Map(departments.map((department) => [department.id, department]));
  const siteAdminCount = visibleEmployees.filter(isSiteAdministrator).length;
  const coveredSites = siteIds.filter((siteId) => reportBySite.has(siteId)).length;
  const notesCount = reports.filter((report) => report.notes?.trim()).length;
  const reportCoverage = siteIds.length ? Math.round((coveredSites / siteIds.length) * 100) : 0;

  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEndDate = new Date(`${monthStart}T00:00:00`);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  const monthEnd = new Date(monthEndDate.getTime() - 86400000).toISOString().slice(0, 10);
  const teamTasksQuery = useQuery({
    queryKey: ["team-follow-up-tasks", allowedDepartmentIds, monthStart, monthEnd],
    enabled: allowedDepartmentIds.length > 0,
    queryFn: async () => {
      let query = (supabase as unknown as { from: (table: string) => any })
        .from("employee_tasks")
        .select("id, task_date, title, description, status, duration_minutes, created_by, department_id, manager_note")
        .gte("task_date", monthStart)
        .lte("task_date", monthEnd)
        .order("task_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!canSeeAll) query = query.in("department_id", allowedDepartmentIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeamTask[];
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["team-follow-up-task-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
  const teamTasks = teamTasksQuery.data ?? [];
  const profileById = new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile]));
  const dailyTasks = teamTasks.filter((task) => task.task_date === date);
  const monthlyTaskStats = [...new Set(teamTasks.map((task) => task.created_by))]
    .map((userId) => {
      const tasks = teamTasks.filter((task) => task.created_by === userId);
      return {
        userId,
        profile: profileById.get(userId),
        total: tasks.length,
        completed: tasks.filter((task) => task.status === "completed").length,
        minutes: tasks.reduce((sum, task) => sum + Number(task.duration_minutes || 0), 0),
        today: tasks.filter((task) => task.task_date === date).length,
        tasks,
      };
    })
    .sort((a, b) => b.total - a.total);
  const guidanceDepartmentId = effectiveDepartmentId === "all" ? allowedDepartmentIds[0] ?? null : effectiveDepartmentId;
  const guidanceQuery = useQuery({
    queryKey: ["team-follow-up-guidance", guidanceDepartmentId, date],
    enabled: Boolean(guidanceDepartmentId),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (table: string) => any })
        .from("team_guidance_notes")
        .select("id, department_id, note_date, content, author_id, created_at")
        .eq("department_id", guidanceDepartmentId)
        .eq("note_date", date)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as GuidanceNote | null;
    },
  });
  useEffect(() => {
    setGeneralNote(guidanceQuery.data?.content ?? "");
  }, [guidanceQuery.data?.id, guidanceQuery.data?.content]);
  const updateTaskNote = async (task: TeamTask) => {
    const managerNote = taskNotes[task.id] ?? task.manager_note ?? "";
    const { error } = await (supabase as unknown as { from: (table: string) => any })
      .from("employee_tasks")
      .update({ manager_note: managerNote.trim() || null })
      .eq("id", task.id);
    if (error) return toast.error(`تعذر حفظ ملاحظة المهمة: ${error.message}`);
    await queryClient.invalidateQueries({ queryKey: ["team-follow-up-tasks"] });
    toast.success("تم حفظ ملاحظة المهمة");
  };
  const saveGeneralNote = async () => {
    if (!guidanceDepartmentId) return toast.error("لا يوجد قسم محدد لحفظ التوجيه");
    const client = supabase as unknown as { from: (table: string) => any };
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return toast.error("يجب تسجيل الدخول أولاً");
    const payload = { department_id: guidanceDepartmentId, note_date: date, content: generalNote.trim(), author_id: authData.user.id };
    const result = guidanceQuery.data?.id
      ? await client.from("team_guidance_notes").update({ content: payload.content }).eq("id", guidanceQuery.data.id)
      : await client.from("team_guidance_notes").insert(payload);
    if (result.error) return toast.error(`تعذر حفظ التوجيه العام: ${result.error.message}`);
    await queryClient.invalidateQueries({ queryKey: ["team-follow-up-guidance"] });
    toast.success("تم حفظ التوجيه العام للفريق");
  };

  const siteRows = siteIds
    .map((siteId) => {
      const team = visibleEmployees.filter((employee) => employee.site_id === siteId);
      const administrators = team.filter(isSiteAdministrator);
      return { site: siteById.get(siteId), team, administrators, report: reportBySite.get(siteId) };
    })
    .sort((a, b) => (a.site?.name ?? "").localeCompare(b.site?.name ?? "", "ar"));

  if (!canSeeAll && !allowedDepartmentIds.length) {
    return (
      <div className="space-y-6">
        <Card className="border-warning/40">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="text-warning mt-1" />
            <div>
              <h1 className="text-2xl font-bold">متابعة الفريق</h1>
              <p className="text-muted-foreground mt-2">
                لم يتم تعيينك كرئيس لأي قسم بعد. اطلب من مدير النظام تعيين حسابك في حقل رئيس القسم
                من صفحة الأقسام.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">متابعة الفريق</h1>
          <p className="text-muted-foreground mt-1">
            لوحة متابعة الموظفين الإداريين وتقارير المواقع والملاحظات اليومية
          </p>
        </div>
        <Badge variant="outline">
          الصلاحية:{" "}
          {canSeeAll
            ? "مدير النظام / الموارد البشرية"
            : roles.includes("supervisor")
              ? "رئيس قسم"
              : "مشاهدة محدودة"}
        </Badge>
      </div>
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-64">
            <Label>القسم</Label>
            <Select value={effectiveDepartmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder="كل الأقسام المسموحة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام المسموحة</SelectItem>
                {departments
                  .filter((department) => allowedDepartmentIds.includes(department.id))
                  .map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Label>تاريخ التقارير</Label>
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
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <Stat icon={Users} label="موظفو الفريق" value={visibleEmployees.length} />
        <Stat icon={Users} label="إداريو المواقع" value={siteAdminCount} tone="blue" />
        <Stat icon={ClipboardList} label="المواقع" value={siteIds.length} tone="purple" />
        <Stat
          icon={CheckCircle2}
          label="تقارير مرفوعة"
          value={`${coveredSites} / ${siteIds.length}`}
          tone="green"
        />
        <Stat icon={MessageSquare} label="تقارير بها ملاحظات" value={notesCount} tone="orange" />
      </div>
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-primary" /> مهام الفريق</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">تقرير مهام اليوم مع ملخص أداء كل حساب خلال شهر {date.slice(0, 7)}</p>
            </div>
            <Badge variant="outline">{teamTasks.length} مهمة هذا الشهر</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={ListChecks} label="مهام الشهر" value={teamTasks.length} />
            <Stat icon={CheckCircle2} label="مهام منجزة" value={teamTasks.filter((task) => task.status === "completed").length} tone="green" />
            <Stat icon={Clock3} label="قيد التنفيذ" value={teamTasks.filter((task) => task.status === "in_progress").length} tone="orange" />
            <Stat icon={Users} label="حسابات نشطة" value={monthlyTaskStats.length} tone="blue" />
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div><h3 className="font-semibold">توجيه عام للفريق</h3><p className="text-xs text-muted-foreground">يُحفظ على قسم {departments.find((item) => item.id === guidanceDepartmentId)?.name ?? "المحدد"} بتاريخ {date}</p></div>
              <Button size="sm" onClick={() => void saveGeneralNote()}><Save className="ml-2 h-4 w-4" /> حفظ التوجيه</Button>
            </div>
            <Textarea value={generalNote} onChange={(event) => setGeneralNote(event.target.value)} placeholder="اكتب توجيهاً عاماً للفريق أو أهداف اليوم أو ملاحظات المتابعة..." rows={3} />
          </div>
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ClipboardList className="h-5 w-5" /> تقرير مهام اليوم — {date}</h3>
            <div className="space-y-2">
              {dailyTasks.map((task) => {
                const profile = profileById.get(task.created_by);
                return <div key={task.id} className="flex flex-col gap-2 rounded-lg border p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{task.title}</span><Badge variant={task.status === "completed" ? "default" : "secondary"}>{task.status === "completed" ? "منجزة" : "قيد التنفيذ"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{profile?.full_name ?? profile?.email ?? "حساب غير معروف"}{task.duration_minutes ? ` · ${task.duration_minutes} دقيقة` : ""}</p>{task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}</div>
                  {task.manager_note && <div className="max-w-md rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="font-medium">ملاحظة المدير: </span>{task.manager_note}</div>}
                </div>;
              })}
              {!dailyTasks.length && <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">لا توجد مهام مسجلة لهذا الفريق في التاريخ المحدد.</div>}
            </div>
          </div>
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5" /> إحصائيات الحسابات خلال الشهر</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {monthlyTaskStats.map((member) => <div key={member.userId} className="rounded-xl border bg-card p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{member.profile?.full_name ?? member.profile?.email ?? "حساب الفريق"}</p><p className="text-xs text-muted-foreground">{member.profile?.email ?? ""}</p></div><Badge variant="outline">{member.today} اليوم</Badge></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-md bg-muted/50 p-2"><p className="text-lg font-bold">{member.total}</p><p className="text-[11px] text-muted-foreground">كل المهام</p></div><div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/30"><p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{member.completed}</p><p className="text-[11px] text-muted-foreground">منجزة</p></div><div className="rounded-md bg-blue-50 p-2 dark:bg-blue-950/30"><p className="text-lg font-bold text-blue-700 dark:text-blue-400">{member.minutes}</p><p className="text-[11px] text-muted-foreground">دقيقة</p></div></div><div className="mt-3 space-y-1">{member.tasks.slice(0, 3).map((task) => <div key={task.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate">{task.title}</span><span className="shrink-0 text-muted-foreground">{task.task_date}</span></div>)}{member.tasks.length > 3 && <p className="text-xs text-muted-foreground">+ {member.tasks.length - 3} مهام أخرى</p>}<Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setDetailsMember(member)}><Eye className="ml-2 h-4 w-4" /> عرض التفاصيل ({member.tasks.length})</Button></div></div>)}
              {!monthlyTaskStats.length && <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground md:col-span-2 xl:col-span-3">لا توجد مهام مسجلة خلال هذا الشهر للأقسام المسموحة.</div>}
            </div>
          </div>
        </CardContent>
      </Card>
      <Dialog open={Boolean(detailsMember)} onOpenChange={(open) => !open && setDetailsMember(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تفاصيل مهام {detailsMember?.profile?.full_name ?? detailsMember?.profile?.email ?? "عضو الفريق"}</DialogTitle>
            <DialogDescription>جميع مهام العضو خلال شهر {date.slice(0, 7)} مع إمكانية إضافة ملاحظة لكل مهمة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {detailsMember?.tasks.map((task) => <div key={task.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{task.task_date}{task.duration_minutes ? ` · ${task.duration_minutes} دقيقة` : ""}</p></div><Badge variant={task.status === "completed" ? "default" : "secondary"}>{task.status === "completed" ? "منجزة" : "قيد التنفيذ"}</Badge></div>{task.description && <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>}<div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={taskNotes[task.id] ?? task.manager_note ?? ""} onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="ملاحظة على هذه المهمة..." /><Button size="sm" onClick={() => void updateTaskNote(task)}><Save className="ml-2 h-4 w-4" /> حفظ</Button></div></div>)}
            {!detailsMember?.tasks.length && <p className="py-8 text-center text-muted-foreground">لا توجد مهام لهذا العضو.</p>}
          </div>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader>
          <CardTitle>
            تغطية تقارير المواقع — {date} ({reportCoverage}%)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${reportCoverage}%` }}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>حالة المواقع والفرق الإدارية</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموقع</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>إداريو الموقع</TableHead>
                <TableHead>إجمالي الفريق</TableHead>
                <TableHead>التقرير اليومي</TableHead>
                <TableHead>الملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteRows.map(({ site, team, administrators, report }) => (
                <TableRow key={site?.id}>
                  <TableCell className="font-medium">
                    {site?.name ?? "موقع غير محدد"}
                    <div className="text-xs text-muted-foreground">{site?.ctr_code ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    {[
                      ...new Set(
                        team
                          .map((employee) => departmentById.get(employee.department_id ?? "")?.name)
                          .filter(Boolean),
                      ),
                    ].join("، ") || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {administrators.length ? (
                        administrators.map((employee) => (
                          <div key={employee.id}>
                            {employee.full_name}
                            <span className="text-xs text-muted-foreground mr-2">
                              {employee.position}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-warning">لم يُصنف إداري موقع</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{team.length}</TableCell>
                  <TableCell>
                    {report ? (
                      <Badge>
                        <CheckCircle2 className="w-3 h-3 ml-1" /> مرفوع
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="w-3 h-3 ml-1" /> لم يرفع
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {report?.notes?.trim() ? (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-4 h-4 text-primary" />
                        {report.notes}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">لا توجد ملاحظات</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!siteRows.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    لا توجد مواقع أو موظفون تابعون للنطاق المحدد
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الموظفون التابعون للقسم</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الرقم</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>التخصص</TableHead>
                <TableHead>الموقع</TableHead>
                <TableHead>حالة تقرير الموقع</TableHead>
                <TableHead>دور المتابعة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleEmployees.map((employee) => {
                const report = employee.site_id ? reportBySite.get(employee.site_id) : undefined;
                return (
                  <TableRow key={employee.id}>
                    <TableCell>{employee.employee_no}</TableCell>
                    <TableCell className="font-medium">{employee.full_name}</TableCell>
                    <TableCell>{employee.position ?? "-"}</TableCell>
                    <TableCell>
                      {siteById.get(employee.site_id ?? "")?.name ?? "غير محدد"}
                    </TableCell>
                    <TableCell>
                      {report ? (
                        <Badge>
                          <CheckCircle2 className="w-3 h-3 ml-1" /> مرفوع
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="w-3 h-3 ml-1" /> لم يرفع
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isSiteAdministrator(employee) ? (
                        <Badge variant="outline">رافع تقرير الموقع</Badge>
                      ) : (
                        <span className="text-muted-foreground">عضو فريق</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "green",
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone?: string;
}) {
  const toneClass =
    {
      green: "bg-green-600",
      blue: "bg-blue-600",
      purple: "bg-purple-600",
      orange: "bg-orange-600",
    }[tone] ?? "bg-green-600";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-xl p-3 ${toneClass}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  head: () => ({
    meta: [
      { title: "متابعة الفريق | ZKT Sync" },
      {
        name: "description",
        content: "لوحة متابعة الفريق، مهام الموظفين اليومية، تقارير المواقع، ومؤشرات الأداء الإدارية.",
      },
      { property: "og:title", content: "متابعة الفريق | ZKT Sync" },
      {
        property: "og:description",
        content: "تابع مهام الموظفين اليومية، حالة مواقع المشاريع، ومؤشرات الفريق في نظام الحضور والتقارير.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeamFollowUpPage,
});

type Department = { id: string; name: string };
type Site = { id: string; name: string; ctr_code: string | null };
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  email: string | null;
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
type Evaluation = { id: string; employee_id: string; evaluation_month: string; score: number; created_by: string; created_at: string };

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
  const [activeTab, setActiveTab] = useState("tasks");
  const [evaluationEmployee, setEvaluationEmployee] = useState<Employee | null>(null);
  const [evaluationScore, setEvaluationScore] = useState("");
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
        .select("id, employee_no, full_name, email, position, department_id, site_id, status")
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
  const siteRecords = sitesQuery.data ?? [];
  const siteById = new Map(siteRecords.map((site) => [site.id, site]));
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
  const employeeIds = visibleEmployees.map((employee) => employee.id);
  const attendanceMonthQuery = useQuery({
    queryKey: ["team-follow-up-attendance", employeeIds, monthStart, monthEnd],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_logs").select("employee_id, verify_time").in("employee_id", employeeIds).gte("verify_time", `${monthStart}T00:00:00`).lte("verify_time", `${monthEnd}T23:59:59`);
      if (error) throw error;
      return (data ?? []) as { employee_id: string | null; verify_time: string }[];
    },
  });
  const evaluationsQuery = useQuery({
    queryKey: ["team-follow-up-evaluations", employeeIds, monthStart],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { from: (table: string) => any }).from("employee_monthly_evaluations").select("id, employee_id, evaluation_month, score, created_by, created_at").in("employee_id", employeeIds).eq("evaluation_month", monthStart);
      if (error) throw error;
      return (data ?? []) as Evaluation[];
    },
  });
  const attendanceByEmployee = new Map<string, Set<string>>();
  (attendanceMonthQuery.data ?? []).forEach((row) => { if (!row.employee_id) return; const days = attendanceByEmployee.get(row.employee_id) ?? new Set<string>(); days.add(row.verify_time.slice(0, 10)); attendanceByEmployee.set(row.employee_id, days); });
  const evaluationByEmployee = new Map((evaluationsQuery.data ?? []).map((evaluation) => [evaluation.employee_id, evaluation]));
  const profileByEmail = new Map((profilesQuery.data ?? []).filter((profile) => profile.email).map((profile) => [profile.email!.toLowerCase(), profile]));
  const employeeTaskStats = visibleEmployees.map((employee) => {
    const profile = employee.email ? profileByEmail.get(employee.email.toLowerCase()) : undefined;
    const tasks = profile ? teamTasks.filter((task) => task.created_by === profile.id) : [];
    return { employee, profile, tasks, total: tasks.length, today: tasks.filter((task) => task.task_date === date).length, completed: tasks.filter((task) => task.status === "completed").length, daysPresent: attendanceByEmployee.get(employee.id)?.size ?? 0, evaluation: evaluationByEmployee.get(employee.id) };
  });
  const submitEvaluation = async () => {
    if (!evaluationEmployee) return;
    const score = Number(evaluationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) return toast.error("أدخل درجة صحيحة من 0 إلى 100");
    if (evaluationByEmployee.has(evaluationEmployee.id)) return toast.error("تم تقييم هذا الموظف هذا الشهر بالفعل");
    const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any }).rpc("submit_employee_monthly_evaluation", { _employee_id: evaluationEmployee.id, _evaluation_month: monthStart, _score: score });
    if (error) return toast.error(error.message.includes("تم تقييم") ? "تم تقييم هذا الموظف هذا الشهر بالفعل" : error.message);
    await queryClient.invalidateQueries({ queryKey: ["team-follow-up-evaluations"] });
    setEvaluationEmployee(null); setEvaluationScore("");
    toast.success(Number(data?.[0]?.bonus_added ?? 0) > 0 ? "تم حفظ التقييم وإضافة مكافأة 100,000 دينار عراقي" : "تم حفظ التقييم بدون مكافأة");
  };
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

  const queryErrors = [
    departmentsQuery,
    assignedDepartmentsQuery,
    employeesQuery,
    sitesQuery,
    reportsQuery,
    teamTasksQuery,
    profilesQuery,
    attendanceMonthQuery,
    evaluationsQuery,
    guidanceQuery,
  ];
  const pageError = queryErrors.find((query) => query.isError);
  const isPageLoading = queryErrors.some((query) => query.isLoading);

  useEffect(() => {
    if (pageError?.error) {
      const message = pageError.error instanceof Error ? pageError.error.message : "تعذر تحميل بيانات متابعة الفريق.";
      toast.error(`تعذرت قراءة بيانات متابعة الفريق: ${message}`);
    }
  }, [pageError]);

  const retryPageLoad = async () => {
    await Promise.allSettled([
      departmentsQuery.refetch(),
      assignedDepartmentsQuery.refetch(),
      employeesQuery.refetch(),
      sitesQuery.refetch(),
      reportsQuery.refetch(),
      teamTasksQuery.refetch(),
      profilesQuery.refetch(),
      attendanceMonthQuery.refetch(),
      evaluationsQuery.refetch(),
      guidanceQuery.refetch(),
    ]);
  };

  const tasks = (
    <div className="space-y-4">
      {dailyTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          لا توجد مهام يومية في هذا التاريخ. يمكنك اختيار يوم آخر أو إضافة مهمة لاحقاً.
        </div>
      ) : (
        dailyTasks.map((task) => {
          const owner = profileById.get(task.created_by);
          const managerNoteValue = taskNotes[task.id] ?? task.manager_note ?? "";

          return (
            <div key={task.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{task.title}</h3>
                  <p className="text-xs text-muted-foreground">{owner?.full_name ?? "مستخدم"}</p>
                </div>
                <Badge variant={task.status === "completed" ? "default" : "secondary"}>
                  {task.status === "completed" ? "منجزة" : "قيد التنفيذ"}
                </Badge>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">
                {task.description || "لا يوجد وصف إضافي لهذه المهمة."}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {task.duration_minutes} دقيقة</span>
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {owner?.full_name ?? "مستخدم"}</span>
                <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {task.task_date}</span>
              </div>

              <div className="mt-4 space-y-2">
                <Label>ملاحظة المدير</Label>
                <Textarea
                  value={managerNoteValue}
                  onChange={(event) => setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                  placeholder="أضف ملاحظة أو توجيه لهذا الموظف..."
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => updateTaskNote(task)}>
                    <Save className="ml-2 h-4 w-4" /> حفظ الملاحظة
                  </Button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const top_stats = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      <Stat icon={Users} label="عدد الموظفين الظاهرين" value={visibleEmployees.length} tone="blue" />
      <Stat icon={ClipboardList} label="عدد مسؤولي المواقع" value={siteAdminCount} tone="green" />
      <Stat icon={FileText} label="عدد المواقع" value={siteRows.length} tone="purple" />
      <Stat icon={CheckCircle2} label="نسبة تغطية تقارير المواقع" value={`${reportCoverage}%`} tone="orange" />
      <Stat icon={MessageSquare} label="عدد الملاحظات المسجلة" value={notesCount} tone="green" />
    </div>
  );

  const sites = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" /> مواقع القسم
        </CardTitle>
      </CardHeader>
      <CardContent>
        {siteRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            لا توجد مواقع ضمن القسم المحدد. اختر قسماً آخر أو جرّب تاريخاً مختلفاً.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم الموقع</TableHead>
                  <TableHead>رمز العقد</TableHead>
                  <TableHead>عدد الموظفين</TableHead>
                  <TableHead>مسؤول الموقع</TableHead>
                  <TableHead>حالة التقرير</TableHead>
                  <TableHead>ملاحظات التقرير</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siteRows.map(({ site, team, administrators, report }) => (
                  <TableRow key={site?.id ?? `site-${Math.random()}`}>
                    <TableCell className="font-medium">{site?.name ?? "غير معروف"}</TableCell>
                    <TableCell>{site?.ctr_code ?? "—"}</TableCell>
                    <TableCell>{team.length}</TableCell>
                    <TableCell>
                      {administrators.length ? administrators.map((emp) => emp.full_name).join("، ") : "—"}
                    </TableCell>
                    <TableCell>
                      {report ? (
                        <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                          تم التحديث
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">
                          غير مكتمل
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {report?.notes?.trim() ? report.notes : "لا توجد ملاحظات."}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const evaluation = (
    <TabsContent value="evaluation" className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" /> تقييم الموظفين
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {visibleEmployees.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              لا يوجد موظفون في هذا النطاق ليتم تقييمهم.
            </div>
          ) : (
            visibleEmployees.map((employee) => {
              const existingEvaluation = evaluationByEmployee.get(employee.id);
              const employeeTaskCount = (profileByEmail.get(employee.email?.toLowerCase() ?? "")?.id
                ? teamTasks.filter((task) => task.created_by === profileByEmail.get(employee.email?.toLowerCase() ?? "")?.id).length
                : 0);

              return (
                <div key={employee.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{employee.full_name}</h3>
                      <p className="text-xs text-muted-foreground">{employee.employee_no}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {existingEvaluation ? (
                        <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                          التقييم الحالي: {existingEvaluation.score}
                        </Badge>
                      ) : (
                        <Badge variant="outline">لا يوجد تقييم</Badge>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEvaluationEmployee(employee);
                          setEvaluationScore(existingEvaluation ? String(existingEvaluation.score) : "90");
                        }}
                        disabled={Boolean(existingEvaluation)}
                      >
                        <Save className="ml-2 h-4 w-4" /> تقييم الموظف
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                    <span>أيام الحضور: {attendanceByEmployee.get(employee.id)?.size ?? 0}</span>
                    <span>مهام هذا الشهر: {employeeTaskCount}</span>
                    <span>القسم: {departmentById.get(employee.department_id ?? "")?.name ?? "غير محدد"}</span>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(evaluationEmployee)}
        onOpenChange={(open) => {
          if (!open) {
            setEvaluationEmployee(null);
            setEvaluationScore("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تقييم الموظف</DialogTitle>
            <DialogDescription>
              {evaluationEmployee ? `تقييم ${evaluationEmployee.full_name}` : "تقييم الموظف"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>الدرجة</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={evaluationScore}
                onChange={(event) => setEvaluationScore(event.target.value)}
                placeholder="أدخل درجة من 0 إلى 100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setEvaluationEmployee(null);
                setEvaluationScore("");
              }}>
                إلغاء
              </Button>
              <Button onClick={submitEvaluation}>حفظ التقييم</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );

  if (isPageLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex min-h-[220px] items-center justify-center gap-3 p-8 text-muted-foreground">
            <Clock3 className="h-5 w-5 animate-pulse" />
            جاري تحميل بيانات متابعة الفريق...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="space-y-6">
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="text-xl font-bold">تعذرت قراءة البيانات</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              لا يمكن عرض متابعة الفريق حالياً. حاول إعادة المحاولة بعد قليل.
            </p>
            <Button onClick={retryPageLoad}>إعادة المحاولة</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="tasks">مهام الفريق</TabsTrigger>
          <TabsTrigger value="stats">الإحصائيات</TabsTrigger>
          <TabsTrigger value="evaluation">تقييم الموظفين</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks" className="space-y-5">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-primary" /> مهام الفريق اليومية
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                مهام اليوم الحالي مع إمكانية الاطلاع وإضافة الملاحظات.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">{tasks}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>إحصائيات الموظفين — {date.slice(0, 7)}</CardTitle>
              <p className="text-sm text-muted-foreground">
                عدد مهام اليوم، تفاصيل مهام اليوم، والمهام المنجزة لكل موظف.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {employeeTaskStats.map(({ employee, profile, tasks, today: todayCount, completed, total }) => (
                <Card key={employee.id} className="border-muted">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{employee.full_name}</h3>
                        <p className="text-xs text-muted-foreground">{employee.employee_no} · {profile?.email ?? employee.email ?? ""}</p>
                      </div>
                      <Badge variant="outline">{todayCount} اليوم</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-xl font-bold">{todayCount}</p>
                        <p className="text-[11px] text-muted-foreground">مهام اليوم</p>
                      </div>
                      <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/30">
                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{completed}</p>
                        <p className="text-[11px] text-muted-foreground">منجزة الشهر</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-md border p-2">
                      {tasks.filter((task) => task.task_date === date).length ? (
                        tasks.filter((task) => task.task_date === date).map((task) => (
                          <p key={task.id} className="truncate text-sm">• {task.title}</p>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">لا توجد مهام اليوم</p>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">إجمالي الشهر: {total} مهمة</p>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() =>
                        setDetailsMember({
                          userId: employee.id,
                          profile,
                          total,
                          completed,
                          minutes: tasks.reduce((sum, task) => sum + Number(task.duration_minutes || 0), 0),
                          today: todayCount,
                          tasks,
                        })
                      }
                    >
                      <Eye className="ml-2 h-4 w-4" /> عرض سجل الموظف
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {!employeeTaskStats.length && (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground md:col-span-2 xl:col-span-3">
                  لا يوجد موظفون ضمن نطاق الأقسام المحدد.
                </div>
              )}
            </CardContent>
          </Card>
          {top_stats}
          {sites}
        </TabsContent>
        {evaluation}
      </Tabs>
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

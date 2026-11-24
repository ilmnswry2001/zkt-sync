import { ui } from "@/lib/ui-language";
import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getTeamAttendance } from "@/lib/team-attendance.functions";
import { permissionsDb } from "@/lib/permissions-client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Send,
  Sparkles,
  Megaphone,
  CalendarDays,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/team-follow-up")({
  head: () => ({
    meta: [
      { title: ui("متابعة الفريق | ZKT Sync") },
      {
        name: "description",
        content:
          "لوحة متابعة الفريق، مهام الموظفين اليومية، تقارير المواقع، ومؤشرات الأداء الإدارية.",
      },
      { property: "og:title", content: "متابعة الفريق | ZKT Sync" },
      {
        property: "og:description",
        content:
          "تابع مهام الموظفين اليومية، حالة مواقع المشاريع، ومؤشرات الفريق في نظام الحضور والتقارير.",
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
  status: "not_started" | "in_progress" | "completed" | "overdue" | "cancelled" | "pending_review" | "needs_follow_up";
  duration_minutes: number;
  created_by: string;
  employee_id: string | null;
  department_id: string | null;
  manager_note: string | null;
  task_type?: string | null;
  priority?: string | null;
  due_date?: string | null;
};
type TeamTaskTemplate = {
  id: string;
  title: string;
  description: string | null;
  recurrence_rule: string;
  priority: string;
  start_date: string;
  end_date: string | null;
  scheduled_time: string | null;
  active: boolean;
  department_id: string;
};
type Profile = { id: string; full_name: string | null; email: string | null };
type MemberTaskStats = {
  userId: string;
  profile: Profile | undefined;
  total: number;
  completed: number;
  minutes: number;
  today: number;
  tasks: TeamTask[];
};
type MemberDetails = {
  employee: Employee;
  profile: Profile | undefined;
  total: number;
  completed: number;
  minutes: number;
  today: number;
  tasks: TeamTask[];
  daysPresent: number;
  evaluation?: Evaluation;
  departmentName: string;
  siteName: string | null;
};
type Evaluation = {
  id: string;
  employee_id: string;
  evaluation_month: string;
  score: number;
  created_by: string;
  created_at: string;
};

const today = new Date().toISOString().slice(0, 10);
function playNewTaskAlert() {
  if (typeof window === "undefined") return;
  const AudioContextClass =
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.setValueAtTime(990, context.currentTime + 0.14);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.32);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.34);
  oscillator.addEventListener("ended", () => void context.close());
}
function normalizeArabic(str: string = "") {
  return str
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}
function isNameMatch(nameA: string, nameB: string) {
  const a = normalizeArabic(nameA);
  const b = normalizeArabic(nameB);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const partsA = a.split(" ").slice(0, 2).join(" ");
  const partsB = b.split(" ").slice(0, 2).join(" ");
  return partsA.length > 3 && partsA === partsB;
}
const isSiteAdministrator = (employee: Employee) =>
  /ادار|إدار|site\s*admin|administrator/i.test(employee.position ?? "");

function TeamFollowUpPage() {
  const { user, isAdmin, isHR, roles, isDepartmentManager, permissionsLoading } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState("all");
  const [detailsMember, setDetailsMember] = useState<MemberDetails | null>(null);
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [guidanceRecipient, setGuidanceRecipient] = useState("all");
  const [guidanceTitle, setGuidanceTitle] = useState("");
  const [guidanceContent, setGuidanceContent] = useState("");
  const [isSendingGuidance, setIsSendingGuidance] = useState(false);
  const [activeTab, setActiveTab] = useState("tasks");
  const [evaluationEmployee, setEvaluationEmployee] = useState<Employee | null>(null);
  const [evaluationScore, setEvaluationScore] = useState("");
  const [templateForm, setTemplateForm] = useState({
    title: "",
    description: "",
    recurrenceRule: "daily",
    priority: "normal",
    startDate: today,
    endDate: "",
    scheduledTime: "",
  });
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
    queryKey: ["team-follow-up-assigned-departments", user?.id],
    enabled: !!user && !permissionsLoading && !canSeeAll,
    queryFn: async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return [] as string[];

      const [userDepartmentsResult, departmentManagersResult] = await Promise.all([
        permissionsDb
          .from("user_departments")
          .select("department_id")
          .eq("user_id", authData.user.id),
        permissionsDb
          .from("department_managers")
          .select("department_id")
          .eq("user_id", authData.user.id),
      ]);

      if (userDepartmentsResult.error) throw userDepartmentsResult.error;
      if (departmentManagersResult.error) throw departmentManagersResult.error;

      const departmentIds = new Set<string>();
      (userDepartmentsResult.data ?? []).forEach((item) =>
        departmentIds.add(item.department_id as string),
      );
      (departmentManagersResult.data ?? []).forEach((item) =>
        departmentIds.add(item.department_id as string),
      );
      return [...departmentIds];
    },
  });
  const allowedDepartmentIds = useMemo(() => canSeeAll
    ? (departmentsQuery.data ?? []).map((department) => department.id)
    : (assignedDepartmentsQuery.data ?? []), [canSeeAll, departmentsQuery.data, assignedDepartmentsQuery.data]);
  const effectiveDepartmentId =
    departmentId !== "all" && allowedDepartmentIds.includes(departmentId) ? departmentId : "all";

  const employeesQuery = useQuery({
    queryKey: ["team-follow-up-employees", user?.id, effectiveDepartmentId, canSeeAll, allowedDepartmentIds],
    enabled: allowedDepartmentIds.length > 0,
    queryFn: async () => {
      const query = supabase
        .from("employees")
        .select("id, employee_no, full_name, email, position, department_id, site_id, status")
        .eq("status", "active");
      const { data, error } = await (effectiveDepartmentId !== "all" ? query.eq("department_id", effectiveDepartmentId) : canSeeAll
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
  const monthEnd = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const needsMonthlyStats = ["stats", "team", "evaluation"].includes(activeTab);
  const taskStart = needsMonthlyStats ? monthStart : date;
  const taskEnd = needsMonthlyStats ? monthEnd : date;
  const teamTasksQuery = useQuery({
    queryKey: ["team-follow-up-tasks", user?.id, allowedDepartmentIds, taskStart, taskEnd],
    enabled: allowedDepartmentIds.length > 0,
    queryFn: async () => {
      let query = (supabase as unknown as { from: (table: string) => any })
        .from("employee_tasks")
        .select(
          "id, task_date, title, description, status, duration_minutes, created_by, employee_id, department_id, manager_note, task_type, priority, due_date",
        )
        .gte("task_date", taskStart)
        .lte("task_date", taskEnd)
        .order("task_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (!canSeeAll) query = query.in("department_id", allowedDepartmentIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeamTask[];
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["team-follow-up-task-profiles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
  const taskTemplatesQuery = useQuery({
    queryKey: ["team-follow-up-task-templates", allowedDepartmentIds, effectiveDepartmentId],
    enabled: activeTab === "scheduled" && allowedDepartmentIds.length > 0,
    queryFn: async () => {
      let query = (supabase as unknown as { from: (table: string) => any })
        .from("team_task_templates")
        .select("id, title, description, recurrence_rule, priority, start_date, end_date, scheduled_time, active, department_id")
        .eq("active", true)
        .order("start_date", { ascending: false });
      if (effectiveDepartmentId !== "all") query = query.eq("department_id", effectiveDepartmentId);
      else query = query.in("department_id", allowedDepartmentIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as TeamTaskTemplate[];
    },
  });
  const teamTasks = teamTasksQuery.data ?? [];
  useEffect(() => {
    const channel = supabase
      .channel(`team-task-alert-${user?.id ?? "guest"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "employee_tasks" },
        (payload) => {
          const departmentId = (payload.new as { department_id?: string | null }).department_id;
          if (canSeeAll || (departmentId && allowedDepartmentIds.includes(departmentId))) {
            playNewTaskAlert();
            void queryClient.invalidateQueries({ queryKey: ["team-follow-up-tasks"] });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [allowedDepartmentIds, canSeeAll, queryClient, user?.id]);
  const profileById = new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile]));
  const profileByEmail = new Map(
    (profilesQuery.data ?? [])
      .filter((profile) => profile.email)
      .map((profile) => [profile.email!.trim().toLowerCase(), profile]),
  );
  const findProfileForEmployee = (employee: Employee) => {
    const emailProfile = employee.email
      ? profileByEmail.get(employee.email.trim().toLowerCase())
      : undefined;
    return (
      emailProfile ??
      profilesQuery.data?.find((profile) =>
        isNameMatch(employee.full_name, profile.full_name ?? ""),
      )
    );
  };
  const teamVisibleEmployees = visibleEmployees.filter((employee) => {
    if (canSeeAll || !isDepartmentManager) return true;
    return findProfileForEmployee(employee)?.id !== user?.id;
  });
  const visibleEmployeeIds = new Set(teamVisibleEmployees.map((employee) => employee.id));
  const visibleEmployeeProfileIds = new Set(
    teamVisibleEmployees.map((employee) => findProfileForEmployee(employee)?.id).filter(Boolean),
  );
  const scopedTeamTasks = teamTasks.filter((task) =>
    task.employee_id ? visibleEmployeeIds.has(task.employee_id) : visibleEmployeeProfileIds.has(task.created_by),
  );
  const dailyTasks = scopedTeamTasks.filter((task) => task.task_date === date);
  const guidanceRecipients = [...new Map(
    teamVisibleEmployees.flatMap((employee) => {
      const emailProfile = employee.email
        ? profileByEmail.get(employee.email.trim().toLowerCase())
        : undefined;
      const normalizedName = normalizeArabic(employee.full_name);
      const sameNameEmployees = employees.filter(
        (candidate) =>
          candidate.department_id === employee.department_id &&
          normalizeArabic(candidate.full_name) === normalizedName,
      );
      const sameNameProfiles = (profilesQuery.data ?? []).filter(
        (candidate) => normalizeArabic(candidate.full_name ?? "") === normalizedName,
      );
      const profile = emailProfile ?? (
        normalizedName && sameNameEmployees.length === 1 && sameNameProfiles.length === 1
          ? sameNameProfiles[0]
          : undefined
      );
      return profile && profile.id !== user?.id
        ? [[profile.id, {
            employeeId: employee.id,
            userId: profile.id,
            name: employee.full_name,
            departmentId: employee.department_id,
          }] as const]
        : [];
    }),
  ).values()];
  const guidanceDepartmentForView = effectiveDepartmentId === "all"
    ? allowedDepartmentIds.length === 1 ? allowedDepartmentIds[0] : null
    : effectiveDepartmentId;
  const employeeIds = visibleEmployees.map((employee) => employee.id);
  const fetchAttendance = useServerFn(getTeamAttendance);
  const attendanceMonthQuery = useQuery({
    queryKey: ["team-follow-up-attendance", employeeIds, monthStart, monthEnd],
    enabled: needsMonthlyStats && employeeIds.length > 0,
    queryFn: async () => {
      const summary: Record<string, number> = {};
      for (let offset = 0; offset < employeeIds.length; offset += 100) {
        Object.assign(summary, await fetchAttendance({ data: {
          month: monthStart.slice(0, 7), employeeIds: employeeIds.slice(offset, offset + 100),
        } }));
      }
      return summary;
    },
  });
  const evaluationsQuery = useQuery({
    queryKey: ["team-follow-up-evaluations", employeeIds, monthStart],
    enabled: needsMonthlyStats && employeeIds.length > 0,
    queryFn: async () => {
      const evaluations: Evaluation[] = [];
      for (let offset = 0; offset < employeeIds.length; offset += 80) {
        const { data, error } = await supabase.from("employee_monthly_evaluations")
          .select("id, employee_id, evaluation_month, score, created_by, created_at")
          .in("employee_id", employeeIds.slice(offset, offset + 80))
          .eq("evaluation_month", monthStart);
        if (error) throw error;
        evaluations.push(...data);
      }
      return evaluations;
    },
  });
  // يحتسب الحضور من دخول وخروج متوافقين، لا من مجرد عدد الحركات.
  const attendanceByEmployee = attendanceMonthQuery.data ?? {};
  const evaluationByEmployee = new Map(
    (evaluationsQuery.data ?? []).map((evaluation) => [evaluation.employee_id, evaluation]),
  );
  const employeeTaskStats = teamVisibleEmployees.map((employee) => {
    const profile = findProfileForEmployee(employee);
    const tasks = teamTasks.filter((task) => {
      const taskOwner = profileById.get(task.created_by);
      return (
        task.employee_id === employee.id ||
        Boolean(profile && task.created_by === profile.id) ||
        Boolean(taskOwner && isNameMatch(employee.full_name, taskOwner.full_name ?? ""))
      );
    });
    return {
      employee,
      profile,
      tasks,
      total: tasks.length,
      today: tasks.filter((task) => task.task_date === date).length,
      completed: tasks.filter((task) => task.status === "completed").length,
      daysPresent: attendanceByEmployee[employee.id] ?? 0,
      evaluation: evaluationByEmployee.get(employee.id),
      departmentName: departmentById.get(employee.department_id ?? "")?.name ?? "غير محدد",
      siteName: siteById.get(employee.site_id ?? "")?.name ?? "غير محدد",
    };
  });
  const submitEvaluation = async () => {
    if (!evaluationEmployee) return;
    const score = Number(evaluationScore);
    if (!Number.isInteger(score) || score < 0 || score > 100)
      return toast.error(ui("أدخل درجة صحيحة من 0 إلى 100"));
    if (evaluationByEmployee.has(evaluationEmployee.id))
      return toast.error(ui("تم تقييم هذا الموظف هذا الشهر بالفعل"));
    const { data, error } = await (
      supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any }
    ).rpc("submit_employee_monthly_evaluation", {
      _employee_id: evaluationEmployee.id,
      _evaluation_month: monthStart,
      _score: score,
    });
    if (error)
      return toast.error(
        error.message.includes("تم تقييم") ? ui("تم تقييم هذا الموظف هذا الشهر بالفعل") : ui(error.message),
      );
    await queryClient.invalidateQueries({ queryKey: ["team-follow-up-evaluations"] });
    setEvaluationEmployee(null);
    setEvaluationScore("");
    toast.success(
      Number(data?.[0]?.bonus_added ?? 0) > 0
        ? ui("تم حفظ التقييم وإضافة مكافأة 100,000 دينار عراقي")
        : ui("تم حفظ التقييم بدون مكافأة"),
    );
  };
  const sendGuidance = async () => {
    if (!user || !isDepartmentManager) return toast.error(ui("إرسال التوجيه متاح لرئيس القسم فقط"));
    const title = guidanceTitle.trim();
    const content = guidanceContent.trim();
    if (title.length < 2) return toast.error(ui("اكتب عنوان التوجيه بوضوح"));
    if (!content) return toast.error(ui("اكتب محتوى التوجيه قبل الإرسال"));
    if (content.length > 5000) return toast.error(ui("يجب ألا يتجاوز التوجيه 5000 حرف"));
    const selected = guidanceRecipient === "all"
      ? guidanceRecipients
      : guidanceRecipients.filter((recipient) => recipient.userId === guidanceRecipient);
    if (!selected.length) return toast.error(ui("لا توجد حسابات موظفين مرتبطة بالقسم المحدد"));

    setIsSendingGuidance(true);
    try {
      const payload = selected.map((recipient) => ({
        department_id: recipient.departmentId,
        target_user_id: recipient.userId,
        target_employee_id: recipient.employeeId,
        title,
        content,
        guidance_date: date,
        author_id: user.id,
      }));
      const guidanceClient = supabase as unknown as {
        from: (table: "employee_guidance_notes") => {
          insert: (rows: typeof payload) => {
            select: (columns: "id") => Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
      const { data, error } = await guidanceClient
        .from("employee_guidance_notes")
        .insert(payload)
        .select("id");
      if (error) return toast.error((ui("تعذر إرسال التوجيه: ") + (formatErrorMessage(error))));
      if (!data || data.length !== selected.length) {
        return toast.error(ui("لم يتم تأكيد حفظ التوجيه لكل المستلمين؛ تحقق من ربط حسابات الموظفين."));
      }
      setGuidanceTitle("");
      setGuidanceContent("");
      await queryClient.invalidateQueries({ queryKey: ["employee-guidance"] });
      toast.success(guidanceRecipient === "all"
        ? (ui("تم إرسال التوجيه إلى ") + (selected.length) + ui(" من موظفي النطاق المحدد"))
        : ui("تم إرسال التوجيه إلى الموظف المحدد"));
    } catch (error) {
      toast.error((ui("تعذر إرسال التوجيه: ") + (formatErrorMessage(error, "حدث خطأ غير متوقع"))));
    } finally {
      setIsSendingGuidance(false);
    }
  };
  const updateTaskNote = async (task: TeamTask) => {
    const managerNote = taskNotes[task.id] ?? task.manager_note ?? "";
    const { error } = await (supabase as unknown as { from: (table: string) => any })
      .from("employee_tasks")
      .update({ manager_note: managerNote.trim() || null })
      .eq("id", task.id);
    if (error) return toast.error((ui("تعذر حفظ ملاحظة المهمة: ") + (formatErrorMessage(error))));
    await queryClient.invalidateQueries({ queryKey: ["team-follow-up-tasks"] });
    toast.success(ui("تم حفظ ملاحظة المهمة"));
  };
  const createTaskTemplate = async () => {
    const title = templateForm.title.trim();
    const targetDepartment = effectiveDepartmentId === "all" ? allowedDepartmentIds[0] : effectiveDepartmentId;
    if (!title || title.length < 2) return toast.error(ui("اكتب اسم القالب بوضوح"));
    if (!targetDepartment) return toast.error(ui("اختر قسماً لإنشاء القالب"));
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return toast.error(ui("يجب تسجيل الدخول أولاً"));
    const client = supabase as unknown as { from: (table: string) => any };
    const { error } = await client.from("team_task_templates").insert({
      department_id: targetDepartment,
      title,
      description: templateForm.description.trim() || null,
      recurrence_rule: templateForm.recurrenceRule,
      priority: templateForm.priority,
      start_date: templateForm.startDate,
      end_date: templateForm.endDate || null,
      scheduled_time: templateForm.scheduledTime || null,
      assignee_employee_ids: [],
      created_by: authData.user.id,
    });
    if (error) return toast.error((ui("تعذر حفظ القالب: ") + (formatErrorMessage(error))));
    setTemplateForm({ title: "", description: "", recurrenceRule: "daily", priority: "normal", startDate: today, endDate: "", scheduledTime: "" });
    await taskTemplatesQuery.refetch();
    toast.success(ui("تم حفظ المهمة المجدولة"));
  };
  const siteRows = siteIds
    .map((siteId) => {
      const team = visibleEmployees.filter((employee) => employee.site_id === siteId);
      const administrators = team.filter(isSiteAdministrator);
      return { site: siteById.get(siteId), team, administrators, report: reportBySite.get(siteId) };
    })
    .sort((a, b) => (a.site?.name ?? "").localeCompare(b.site?.name ?? "", "ar"));

  const queries = [
    { label: "الأقسام", query: departmentsQuery },
    ...(!canSeeAll ? [{ label: "الأقسام المسموحة", query: assignedDepartmentsQuery }] : []),
    ...(activeTab !== "scheduled" ? [
      { label: "الموظفون", query: employeesQuery },
      { label: "حسابات الفريق", query: profilesQuery },
    ] : []),
    ...(activeTab === "team" ? [{ label: "تقارير المواقع", query: reportsQuery }] : []),
    ...(activeTab === "team" || activeTab === "stats" ? [{ label: "المواقع", query: sitesQuery }] : []),
    ...(activeTab === "tasks" || needsMonthlyStats ? [{ label: "المهام", query: teamTasksQuery }] : []),
    ...(needsMonthlyStats ? [
      { label: "الحضور الشهري", query: attendanceMonthQuery },
      { label: "التقييمات", query: evaluationsQuery },
    ] : []),
    ...(activeTab === "scheduled" ? [{ label: "المهام المجدولة", query: taskTemplatesQuery }] : []),
  ];
  const failures = queries.filter(({ query }) => query.isError);
  const isTabLoading = queries.some(({ query }) => query.isLoading);
  const retryPageLoad = () => Promise.allSettled(failures.map(({ query }) => query.refetch()));

  const tasks = (
    <div className="space-y-4">
      {dailyTasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-6 text-center text-sm text-muted-foreground">{ui("لا توجد مهام يومية في هذا التاريخ. يمكنك اختيار يوم آخر أو إضافة مهمة لاحقاً.")}</div>
      ) : (
        dailyTasks.map((task) => {
          const owner = profileById.get(task.created_by);
          const managerNoteValue = taskNotes[task.id] ?? task.manager_note ?? "";

          return (
            <div key={task.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{task.title}</h3>
                  <p className="text-xs text-muted-foreground">{owner?.full_name ?? ui("مستخدم")}</p>
                </div>
                <Badge variant={task.status === "completed" ? "default" : "secondary"}>
                  {task.status === "completed" ? ui("منجزة") : ui("قيد التنفيذ")}
                </Badge>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">
                {task.description || ui("لا يوجد وصف إضافي لهذه المهمة.")}
              </p>

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5" /> {task.duration_minutes}{ui(" دقيقة")}</span>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> {owner?.full_name ?? ui("مستخدم")}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> {task.task_date}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                <Label>{ui("ملاحظة المدير")}</Label>
                <Textarea
                  value={managerNoteValue}
                  onChange={(event) =>
                    setTaskNotes((current) => ({ ...current, [task.id]: event.target.value }))
                  }
                  placeholder={ui("أضف ملاحظة أو توجيه لهذا الموظف...")}
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => updateTaskNote(task)}>
                    <Save className="ml-2 h-4 w-4" />{ui(" حفظ الملاحظة")}</Button>
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
      <Stat
        icon={Users}
        label={ui("عدد الموظفين الظاهرين")}
        value={teamVisibleEmployees.length}
        tone="blue"
      />
      <Stat icon={ClipboardList} label={ui("عدد مسؤولي المواقع")} value={siteAdminCount} tone="green" />
      <Stat icon={FileText} label={ui("عدد المواقع")} value={siteRows.length} tone="purple" />
      <Stat
        icon={CheckCircle2}
        label={ui("نسبة تغطية تقارير المواقع")}
        value={`${reportCoverage}%`}
        tone="orange"
      />
      <Stat icon={MessageSquare} label={ui("عدد الملاحظات المسجلة")} value={notesCount} tone="green" />
    </div>
  );

  const sites = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />{ui(" مواقع القسم")}</CardTitle>
      </CardHeader>
      <CardContent>
        {siteRows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{ui("لا توجد مواقع ضمن القسم المحدد. اختر قسماً آخر أو جرّب تاريخاً مختلفاً.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ui("اسم الموقع")}</TableHead>
                  <TableHead>{ui("رمز العقد")}</TableHead>
                  <TableHead>{ui("عدد الموظفين")}</TableHead>
                  <TableHead>{ui("مسؤول الموقع")}</TableHead>
                  <TableHead>{ui("حالة التقرير")}</TableHead>
                  <TableHead>{ui("ملاحظات التقرير")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {siteRows.map(({ site, team, administrators, report }) => (
                  <TableRow key={site?.id ?? `site-${Math.random()}`}>
                    <TableCell className="font-medium">{site?.name ?? ui("غير معروف")}</TableCell>
                    <TableCell>{site?.ctr_code ?? "—"}</TableCell>
                    <TableCell>{team.length}</TableCell>
                    <TableCell>
                      {administrators.length
                        ? administrators.map((emp) => emp.full_name).join("، ")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {report ? (
                        <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">{ui("تم التحديث")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300">{ui("غير مكتمل")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      {report?.notes?.trim() ? report.notes : ui("لا توجد ملاحظات.")}
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
            <CheckCircle2 className="h-5 w-5 text-primary" />{ui(" تقييم الموظفين")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {teamVisibleEmployees.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{ui("لا يوجد موظفون في هذا النطاق ليتم تقييمهم.")}</div>
          ) : (
            teamVisibleEmployees.map((employee) => {
              const existingEvaluation = evaluationByEmployee.get(employee.id);
              const matchedProfile = findProfileForEmployee(employee);
              const employeeTaskCount = teamTasks.filter((task) => {
                const taskOwner = profileById.get(task.created_by);
                return (
                  task.employee_id === employee.id ||
                  Boolean(matchedProfile && task.created_by === matchedProfile.id) ||
                  Boolean(taskOwner && isNameMatch(employee.full_name, taskOwner.full_name ?? ""))
                );
              }).length;

              return (
                <div key={employee.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{employee.full_name}</h3>
                      <p className="text-xs text-muted-foreground">{employee.employee_no}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {existingEvaluation ? (
                        <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">{ui("التقييم الحالي: ")}{existingEvaluation.score}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{ui("لا يوجد تقييم")}</Badge>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEvaluationEmployee(employee);
                          setEvaluationScore(
                            existingEvaluation ? String(existingEvaluation.score) : "90",
                          );
                        }}
                        disabled={Boolean(existingEvaluation)}
                      >
                        <Save className="ml-2 h-4 w-4" />{ui(" تقييم الموظف")}</Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                    <span>{ui("أيام الحضور: ")}{attendanceByEmployee[employee.id] ?? 0}</span>
                    <span>{ui("مهام هذا الشهر: ")}{employeeTaskCount}</span>
                    <span>{ui("القسم: ")}{departmentById.get(employee.department_id ?? "")?.name ?? ui("غير محدد")}
                    </span>
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
            <DialogTitle>{ui("تقييم الموظف")}</DialogTitle>
            <DialogDescription>
              {evaluationEmployee ? (ui("تقييم ") + (evaluationEmployee.full_name)) : ui("تقييم الموظف")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>{ui("الدرجة")}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={evaluationScore}
                onChange={(event) => setEvaluationScore(event.target.value)}
                placeholder={ui("أدخل درجة من 0 إلى 100")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEvaluationEmployee(null);
                  setEvaluationScore("");
                }}
              >{ui("إلغاء")}</Button>
              <Button onClick={submitEvaluation}>{ui("حفظ التقييم")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );

  if (permissionsLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex min-h-[220px] items-center justify-center gap-3 p-8 text-muted-foreground">
            <Clock3 className="h-5 w-5 animate-pulse" />{ui("جاري تحميل بيانات متابعة الفريق...")}</CardContent>
        </Card>
      </div>
    );
  }

  if (!isTabLoading && !failures.length && !canSeeAll && !allowedDepartmentIds.length) {
    return (
      <div className="space-y-6">
        <Card className="border-warning/40">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertTriangle className="text-warning mt-1" />
            <div>
              <h1 className="text-2xl font-bold">{ui("متابعة الفريق")}</h1>
              <p className="text-muted-foreground mt-2">{ui("لم يتم تعيينك كرئيس لأي قسم بعد. اطلب من مدير النظام تعيين حسابك في حقل رئيس القسم من صفحة الأقسام.")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-teal-950 to-emerald-900 px-6 py-7 text-white shadow-xl shadow-teal-950/10 sm:px-8">
        <div className="pointer-events-none absolute -left-10 -top-24 h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 right-1/4 h-72 w-72 rounded-full bg-emerald-300/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <Badge className="mb-3 border-white/20 bg-white/10 text-white hover:bg-white/10"><Sparkles className="ml-1.5 h-3.5 w-3.5" />{ui(" مركز قيادة الفريق")}</Badge>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{ui("متابعة الفريق")}</h1>
            <p className="mt-2 max-w-2xl text-sm text-teal-50/80 sm:text-base">{ui("صورة يومية واضحة للمهام والإنجازات والحضور، مع أدوات عملية لتوجيه الفريق ومتابعة المواقع.")}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
            <p className="text-xs text-teal-50/70">{ui("صلاحية العرض")}</p>
            <p className="mt-1 font-semibold">{canSeeAll ? ui("مدير النظام / الموارد البشرية") : isDepartmentManager ? ui("رئيس القسم") : roles.includes("supervisor") ? ui("مشرف") : ui("مشاهدة محدودة")}</p>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 sm:grid-cols-4">
          {[["أفراد الفريق", teamVisibleEmployees.length], ["مهام اليوم", dailyTasks.length], ["المواقع", siteIds.length], ["تغطية التقارير", `${reportCoverage}%`]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white/[0.07] px-4 py-3"><p className="text-xs text-teal-50/70">{ui(label)}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
        </div>
      </section>
      <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-end gap-4 p-4 sm:p-5">
          <div className="w-full sm:w-64">
            <Label>{ui("القسم")}</Label>
            <Select value={effectiveDepartmentId} onValueChange={setDepartmentId}>
              <SelectTrigger>
                <SelectValue placeholder={ui("كل الأقسام المسموحة")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ui("كل الأقسام المسموحة")}</SelectItem>
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
            <Label>{ui("تاريخ التقارير")}</Label>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value || today)} />
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDate(today);
              setDepartmentId("all");
            }}
          >{ui("اليوم")}</Button>
        </CardContent>
      </Card>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className={`grid h-auto w-full ${isDepartmentManager ? "grid-cols-2 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-5"} gap-1 rounded-2xl border bg-muted/60 p-1.5`}>
          <TabsTrigger className="rounded-xl py-2.5" value="tasks">{ui("مهام الفريق")}</TabsTrigger>
          <TabsTrigger className="rounded-xl py-2.5" value="scheduled">{ui("المهام المجدولة")}</TabsTrigger>
          <TabsTrigger className="rounded-xl py-2.5" value="stats">{ui("الإحصائيات")}</TabsTrigger>
          <TabsTrigger className="rounded-xl py-2.5" value="team">{ui("المتابعة اليومية")}</TabsTrigger>
          <TabsTrigger className="rounded-xl py-2.5" value="evaluation">{ui("تقييم الموظفين")}</TabsTrigger>
          {isDepartmentManager && <TabsTrigger className="rounded-xl py-2.5" value="guidance">{ui("إرسال التوجيه")}</TabsTrigger>}
        </TabsList>
        {failures.length > 0 ? <Card role="alert"><CardContent className="space-y-3 p-5">
          {failures.map(({ label, query }) => <p key={label}>{ui("تعذر تحميل ")}{ui(label)}: {ui(formatErrorMessage(query.error))}</p>)}
          <Button variant="outline" onClick={retryPageLoad}>{ui("إعادة المحاولة")}</Button>
        </CardContent></Card> : isTabLoading ? (
          <Card><CardContent className="flex items-center gap-3 p-5 text-muted-foreground" role="status">
            <Clock3 className="h-5 w-5 animate-pulse" />{ui(" جارٍ تحميل بيانات التبويب…")}</CardContent></Card>
        ) : <>
        <TabsContent value="tasks" className="space-y-5">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5 text-primary" />{ui(" مهام الفريق اليومية")}</CardTitle>
              <p className="text-sm text-muted-foreground">{ui("مهام اليوم الحالي مع إمكانية الاطلاع وإضافة الملاحظات.")}</p>
            </CardHeader>
            <CardContent className="space-y-5">{tasks}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduled" className="space-y-5">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" />{ui(" إنشاء مهمة متكررة")}</CardTitle>
              <p className="text-sm text-muted-foreground">{ui("أنشئ قالباً يومياً أو أسبوعياً ليظهر ضمن جدول مهام القسم.")}</p>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2"><Label>{ui("اسم المهمة")}</Label><Input className="mt-2" value={templateForm.title} onChange={(event) => setTemplateForm((current) => ({ ...current, title: event.target.value }))} placeholder={ui("مثال: مراجعة التقرير اليومي")} /></div>
              <div><Label>{ui("التكرار")}</Label><select className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={templateForm.recurrenceRule} onChange={(event) => setTemplateForm((current) => ({ ...current, recurrenceRule: event.target.value }))}><option value="daily">{ui("يومياً")}</option><option value="weekdays">{ui("أيام العمل")}</option><option value="weekly">{ui("أسبوعياً")}</option><option value="monthly">{ui("شهرياً")}</option><option value="interval">{ui("كل فترة")}</option></select></div>
              <div><Label>{ui("الأولوية")}</Label><select className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 text-sm" value={templateForm.priority} onChange={(event) => setTemplateForm((current) => ({ ...current, priority: event.target.value }))}><option value="normal">{ui("عادية")}</option><option value="low">{ui("منخفضة")}</option><option value="high">{ui("عالية")}</option><option value="urgent">{ui("عاجلة")}</option></select></div>
              <div className="lg:col-span-2"><Label>{ui("الوصف")}</Label><Textarea className="mt-2" value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} placeholder={ui("تفاصيل المهمة المتكررة")} rows={2} /></div>
              <div><Label>{ui("تاريخ البدء")}</Label><Input className="mt-2" type="date" value={templateForm.startDate} onChange={(event) => setTemplateForm((current) => ({ ...current, startDate: event.target.value }))} /></div>
              <div><Label>{ui("تاريخ الانتهاء")}</Label><Input className="mt-2" type="date" value={templateForm.endDate} onChange={(event) => setTemplateForm((current) => ({ ...current, endDate: event.target.value }))} /></div>
              <div><Label>{ui("الوقت")}</Label><Input className="mt-2" type="time" value={templateForm.scheduledTime} onChange={(event) => setTemplateForm((current) => ({ ...current, scheduledTime: event.target.value }))} /></div>
              <div className="flex items-end"><Button className="w-full" onClick={() => void createTaskTemplate()} disabled={!canSeeAll && !isDepartmentManager}><CalendarDays className="ml-2 h-4 w-4" />{ui(" حفظ الجدولة")}</Button></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{ui("القوالب النشطة")}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(taskTemplatesQuery.data ?? []).map((template) => <div key={template.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{template.title}</h3><p className="mt-1 text-xs text-muted-foreground">{template.description || ui("بدون وصف")}</p></div><Badge variant="outline">{template.recurrence_rule === "daily" ? ui("يومي") : template.recurrence_rule === "weekly" ? ui("أسبوعي") : template.recurrence_rule === "monthly" ? ui("شهري") : template.recurrence_rule}</Badge></div><p className="mt-3 text-xs text-muted-foreground">{ui("يبدأ ")}{template.start_date}{template.end_date ? (ui(" وينتهي ") + (template.end_date)) : ""}{template.scheduled_time ? (ui(" · الساعة ") + (template.scheduled_time)) : ""}</p></div>)}
              {!taskTemplatesQuery.isLoading && !taskTemplatesQuery.data?.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{ui("لا توجد مهام مجدولة لهذا النطاق. أنشئ أول قالب من النموذج أعلاه.")}</div>}
              {taskTemplatesQuery.isError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-2 xl:col-span-3">{ui("تعذر قراءة القوالب. تأكد من تنفيذ Migration `20261004120000_team_management_workflow.sql` في Lovable/Supabase.")}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        {isDepartmentManager && <TabsContent value="guidance" className="space-y-5">
          <Card className="overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-teal-950 via-teal-900 to-emerald-800 text-white shadow-xl">
            <CardHeader className="border-b border-white/10 pb-5">
              <Badge className="w-fit border-white/20 bg-white/10 text-white hover:bg-white/10"><Megaphone className="ml-1.5 h-3.5 w-3.5" />{ui(" توجيه رئيس القسم")}</Badge>
              <CardTitle className="mt-3 text-2xl">{ui("وجّه فريقك بوضوح")}</CardTitle>
              <p className="text-sm text-teal-50/75">{ui("أرسل تعليمات اليوم إلى كامل الفريق أو موظف محدد. ستظهر الرسالة في تبويب التوجيهات ضمن مهامي اليومية.")}</p>
            </CardHeader>
            <CardContent className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div><p className="text-xs text-teal-50/70">{ui("نطاق الإرسال")}</p><p className="mt-1 font-semibold">{guidanceDepartmentForView ? departmentById.get(guidanceDepartmentForView)?.name ?? ui("القسم المعيّن") : ui("الأقسام المعيّنة لك")}</p></div>
                <div><Label htmlFor="team-guidance-recipient" className="text-white">{ui("إرسال إلى")}</Label><select id="team-guidance-recipient" className="mt-2 flex h-11 w-full rounded-xl border border-white/15 bg-slate-950/35 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-emerald-300" value={guidanceRecipient} onChange={(event) => setGuidanceRecipient(event.target.value)}><option className="text-slate-900" value="all">{ui("جميع موظفي النطاق (")}{guidanceRecipients.length})</option>{guidanceRecipients.map((recipient) => <option className="text-slate-900" key={recipient.userId} value={recipient.userId}>{recipient.name}</option>)}</select></div>
                <div className="rounded-xl bg-white/[0.07] p-3 text-sm text-teal-50/80"><Users className="ml-2 inline h-4 w-4" />{guidanceRecipient === "all" ? ((guidanceRecipients.length) + ui(" موظف مرتبط بحساب")) : ui("سيصل التوجيه إلى الموظف المحدد")}</div>
                {!profilesQuery.isLoading && !employeesQuery.isLoading && guidanceRecipients.length === 0 && <p className="text-xs leading-5 text-amber-100">{ui("تعذر ربط حسابات الموظفين بهذا النطاق. يلزم تطابق البريد أو اسم فريد بين حساب المستخدم وسجل الموظف.")}</p>}
                {teamVisibleEmployees.length > guidanceRecipients.length && <p className="text-xs leading-5 text-amber-100">{ui("لن تظهر التوجيهات إلا للحسابات المرتبطة ببريد مطابق أو باسم فريد؛ الأسماء المتكررة تحتاج ربط البريد لتجنب إرسالها إلى حساب خاطئ.")}</p>}
              </div>
              <div className="space-y-4 rounded-2xl bg-white p-4 text-slate-900 sm:p-5">
                <div><Label htmlFor="team-guidance-title">{ui("عنوان التوجيه")}</Label><Input id="team-guidance-title" value={guidanceTitle} onChange={(event) => setGuidanceTitle(event.target.value)} placeholder={ui("مثال: أولويات العمل لهذا اليوم")} maxLength={200} className="mt-2 h-11 rounded-xl" /></div>
                <div><div className="flex items-center justify-between gap-2"><Label htmlFor="team-guidance-content">{ui("التعليمات")}</Label><span className="text-xs text-muted-foreground">{guidanceContent.length}/5000</span></div><Textarea id="team-guidance-content" value={guidanceContent} onChange={(event) => setGuidanceContent(event.target.value)} placeholder={ui("اكتب التوجيه بوضوح، وحدد الأولويات والإجراءات المطلوبة...")} maxLength={5000} className="mt-2 min-h-36 resize-y rounded-xl" /></div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span className="text-xs text-muted-foreground">{ui("سيُحفظ بتاريخ ")}{date}</span><Button onClick={() => void sendGuidance()} disabled={isSendingGuidance || profilesQuery.isLoading || employeesQuery.isLoading || !guidanceRecipients.length} className="bg-gradient-to-l from-teal-700 to-emerald-600 font-semibold text-white shadow-md shadow-teal-900/15 hover:from-teal-800 hover:to-emerald-700">{isSendingGuidance ? <><Clock3 className="ml-2 h-4 w-4 animate-spin" />{ui(" جارٍ الإرسال")}</> : <><Send className="ml-2 h-4 w-4" />{ui(" إرسال التوجيه")}</>}</Button></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>}

        <TabsContent value="stats" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{ui("إحصائيات الموظفين — ")}{date.slice(0, 7)}</CardTitle>
              <p className="text-sm text-muted-foreground">{ui("عدد مهام اليوم، تفاصيل مهام اليوم، والمهام المنجزة لكل موظف.")}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {employeeTaskStats.map(
                ({
                  employee,
                  profile,
                  tasks,
                  today: todayCount,
                  completed,
                  total,
                  daysPresent,
                  evaluation,
                  departmentName,
                  siteName,
                }) => {
                  const taskCompletion = total ? Math.round((completed / total) * 100) : 0;
                  const taskMinutes = tasks.reduce(
                    (sum, task) => sum + Number(task.duration_minutes || 0),
                    0,
                  );
                  return (
                    <Card
                      key={employee.id}
                      className="group overflow-hidden border-slate-200 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800"
                    >
                      <div className="h-1.5 bg-gradient-to-l from-cyan-500 via-teal-500 to-emerald-400" />
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{employee.full_name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {employee.employee_no} · {profile?.email ?? employee.email ?? ""}
                            </p>
                          </div>
                          <Badge variant="outline">{todayCount}{ui(" اليوم")}</Badge>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/70">
                            <p className="text-xl font-bold">{todayCount}</p>
                            <p className="text-[11px] text-muted-foreground">{ui("مهام اليوم")}</p>
                          </div>
                          <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
                            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                              {completed}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{ui("مكتملة")}</p>
                          </div>
                          <div className="rounded-xl bg-cyan-50 p-3 dark:bg-cyan-950/30">
                            <p className="text-xl font-bold text-cyan-800 dark:text-cyan-300">
                              {total}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{ui("إجمالي الشهر")}</p>
                          </div>
                        </div>
                        <div className="mt-3 rounded-xl border bg-background/70 p-3">
                          <div className="mb-2 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{ui("إنجاز المهام الشهرية")}</span>
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              {taskCompletion}%
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-teal-400 transition-all"
                              style={{ width: `${taskCompletion}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{ui("الوقت المسجل: ")}{Math.floor(taskMinutes / 60)}{ui(" س ")}{taskMinutes % 60}{ui(" د · الحضور: ")}{daysPresent}{ui(" يوم")}</p>
                        </div>
                        <div className="mt-3 rounded-xl border p-3">
                          {tasks.filter((task) => task.task_date === date).length ? (
                            tasks
                              .filter((task) => task.task_date === date)
                              .map((task) => (
                                <p key={task.id} className="truncate text-sm">
                                  • {task.title}
                                </p>
                              ))
                          ) : (
                            <p className="text-sm text-muted-foreground">{ui("لا توجد مهام اليوم")}</p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          className="mt-3 w-full"
                          onClick={() =>
                            setDetailsMember({
                              employee,
                              profile,
                              total,
                              completed,
                              minutes: tasks.reduce(
                                (sum, task) => sum + Number(task.duration_minutes || 0),
                                0,
                              ),
                              today: todayCount,
                              tasks,
                              daysPresent,
                              evaluation,
                              departmentName,
                              siteName,
                            })
                          }
                        >
                          <Eye className="ml-2 h-4 w-4" />{ui(" عرض سجل الموظف")}</Button>
                      </CardContent>
                    </Card>
                  );
                },
              )}
              {!employeeTaskStats.length && (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground md:col-span-2 xl:col-span-3">{ui("لا يوجد موظفون ضمن نطاق الأقسام المحدد.")}</div>
              )}
            </CardContent>
          </Card>
          {top_stats}
          {sites}
        </TabsContent>

        <TabsContent value="team" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />{ui(" المتابعة اليومية للفريق")}</CardTitle>
              <p className="text-sm text-muted-foreground">{ui("أسماء الموظفين المسندين إلى هذا القسم فقط، مع بطاقة مختصرة وتقييمهم وسجل مهامهم.")}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {teamVisibleEmployees.map((employee) => {
                const employeeProfile = findProfileForEmployee(employee);
                const employeeTasks = teamTasks.filter((task) => {
                  const taskOwner = profileById.get(task.created_by);
                  return (
                    task.employee_id === employee.id ||
                    Boolean(employeeProfile && task.created_by === employeeProfile.id) ||
                    Boolean(taskOwner && isNameMatch(employee.full_name, taskOwner.full_name ?? ""))
                  );
                });
                const employeeDays = attendanceByEmployee[employee.id] ?? 0;
                const existingEvaluation = evaluationByEmployee.get(employee.id);
                return (
                  <div
                    key={employee.id}
                    className="rounded-2xl border bg-gradient-to-br from-background via-muted/30 to-primary/5 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">{employee.full_name}</h3>
                        <p className="text-xs text-muted-foreground">{employee.employee_no}</p>
                      </div>
                      <Badge variant="outline">{employee.status}</Badge>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                      <p>{ui("القسم:")}{" "}
                        {departmentById.get(employee.department_id ?? "")?.name ?? ui("غير محدد")}
                      </p>
                      <p>{ui("الموقع: ")}{siteById.get(employee.site_id ?? "")?.name ?? ui("غير محدد")}</p>
                      <p>{ui("المنصب: ")}{employee.position ?? ui("غير محدد")}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-muted/50 p-2">
                        <p className="text-lg font-bold">{employeeDays}</p>
                        <p className="text-[10px] text-muted-foreground">{ui("أيام الحضور")}</p>
                      </div>
                      <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/30">
                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                          {existingEvaluation?.score ?? "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{ui("التقييم")}</p>
                      </div>
                      <div className="rounded-md bg-purple-50 p-2 dark:bg-purple-950/30">
                        <p className="text-lg font-bold text-purple-700 dark:text-purple-400">
                          {employeeTasks.length}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{ui("المهام")}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="mt-4 w-full"
                      onClick={() =>
                        setDetailsMember({
                          employee,
                          profile: employeeProfile,
                          total: employeeTasks.length,
                          completed: employeeTasks.filter((task) => task.status === "completed")
                            .length,
                          minutes: employeeTasks.reduce(
                            (sum, task) => sum + Number(task.duration_minutes || 0),
                            0,
                          ),
                          today: employeeTasks.filter((task) => task.task_date === date).length,
                          tasks: employeeTasks,
                          daysPresent: employeeDays,
                          evaluation: existingEvaluation,
                          departmentName:
                            departmentById.get(employee.department_id ?? "")?.name ?? "غير محدد",
                          siteName: siteById.get(employee.site_id ?? "")?.name ?? "غير محدد",
                        })
                      }
                    >
                      <Eye className="ml-2 h-4 w-4" />{ui(" عرض التفاصيل")}</Button>
                  </div>
                );
              })}
              {!teamVisibleEmployees.length && (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground lg:col-span-2 xl:col-span-3">{ui("لا يوجد موظفون مسندون لهذا القسم حاليًا.")}</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {evaluation}
        </>}
      </Tabs>

      <Dialog
        open={Boolean(detailsMember)}
        onOpenChange={(open) => {
          if (!open) setDetailsMember(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{ui("تفاصيل الموظف — ")}{detailsMember?.employee.full_name}</DialogTitle>
            <DialogDescription>
              {detailsMember?.employee.employee_no} · {detailsMember?.departmentName} ·{" "}
              {detailsMember?.siteName ?? ui("غير محدد")}
            </DialogDescription>
          </DialogHeader>
          {detailsMember && (
            <div className="space-y-5 pt-2">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{ui("البريد الإلكتروني")}</p>
                  <p className="font-medium">
                    {detailsMember.profile?.email ?? detailsMember.employee.email ?? ui("غير متوفر")}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{ui("المنصب")}</p>
                  <p className="font-medium">{detailsMember.employee.position ?? ui("غير محدد")}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{ui("أيام الحضور")}</p>
                  <p className="font-medium">{detailsMember.daysPresent}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{ui("التقييم الشهري")}</p>
                  <p className="font-medium">
                    {detailsMember.evaluation?.score ?? ui("لا يوجد تقييم")}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-bold">{detailsMember.total}</p>
                  <p className="text-xs text-muted-foreground">{ui("إجمالي المهام")}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 text-center dark:bg-emerald-950/30">
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                    {detailsMember.completed}
                  </p>
                  <p className="text-xs text-muted-foreground">{ui("منجزة")}</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-3 text-center dark:bg-amber-950/30">
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                    {detailsMember.minutes}
                  </p>
                  <p className="text-xs text-muted-foreground">{ui("دقائق")}</p>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 font-medium">{ui("مهام الموظف")}</p>
                {detailsMember.tasks.length ? (
                  <div className="space-y-2">
                    {detailsMember.tasks.slice(0, 6).map((task) => (
                      <div key={task.id} className="rounded-md border p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{task.title}</span>
                          <Badge variant={task.status === "completed" ? "default" : "secondary"}>
                            {task.status === "completed" ? ui("منجزة") : ui("قيد التنفيذ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {task.task_date} · {task.duration_minutes}{ui(" دقيقة")}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{ui("لا توجد مهام مسجلة لهذا الموظف.")}</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
          <p className="text-sm text-muted-foreground">{ui(label)}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

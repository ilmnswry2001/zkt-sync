import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { todayInBaghdad } from "@/lib/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  CalendarCheck2,
  CalendarClock,
  Check,
  CircleCheck,
  ClipboardList,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Repeat2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/work-center")({
  head: () => ({ meta: [{ title: "مركز العمل | منظومة زِكت" }] }),
  component: WorkCenterPage,
});

type DbError = { message: string };
type DbResult<T> = { data: T | null; error: DbError | null };
type FilterValue = string | number | boolean | null;

interface QueryBuilder<Row> extends PromiseLike<DbResult<Row[]>> {
  select(columns?: string): QueryBuilder<Row>;
  insert(values: object | object[]): QueryBuilder<Row>;
  update(values: object): QueryBuilder<Row>;
  eq(column: string, value: FilterValue): QueryBuilder<Row>;
  gte(column: string, value: FilterValue): QueryBuilder<Row>;
  lte(column: string, value: FilterValue): QueryBuilder<Row>;
  or(filters: string): QueryBuilder<Row>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<Row>;
}

interface WorkCenterClient {
  from<Row = unknown>(table: string): QueryBuilder<Row>;
  rpc<Result = unknown>(
    functionName: string,
    args?: Record<string, unknown>,
  ): PromiseLike<DbResult<Result>>;
}

const db = supabase as unknown as WorkCenterClient;
const today = todayInBaghdad();
const todayWeekday = new Date(`${today}T00:00:00Z`).getUTCDay();
const weekdayNames = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

type WorkTask = {
  id: string;
  task_date: string;
  title: string;
  description: string | null;
  status: "completed" | "in_progress";
  duration_minutes: number;
  assigned_user_id: string | null;
  task_source_schedule_id: string | null;
};

type Guidance = {
  id: string;
  title: string;
  content: string;
  guidance_date: string;
  created_at: string;
  read_at: string | null;
};

type Employee = {
  id: string;
  full_name: string;
  employee_no: string;
  email: string | null;
  department_id: string | null;
};

type Profile = { id: string; full_name: string | null; email: string | null };

type Schedule = {
  id: string;
  employee_id: string;
  target_user_id: string;
  department_id: string | null;
  title: string;
  description: string | null;
  frequency: "daily" | "weekly";
  weekday: number | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
};

type ScheduleOption = { employee: Employee; profile: Profile };
const EMPTY_SCHEDULE_OPTIONS: ScheduleOption[] = [];

function normalizedEmail(value: string | null) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function WorkCenterPage() {
  const { user, isAdmin, isHR, roles } = useAuth();
  const queryClient = useQueryClient();
  const canManageSchedules =
    isAdmin || isHR || roles.includes("supervisor") || roles.includes("department_manager");
  const [employeeId, setEmployeeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [weekday, setWeekday] = useState(String(todayWeekday));
  const [startsOn, setStartsOn] = useState(today);

  const workQuery = useQuery({
    queryKey: ["work-center", user?.id, today],
    enabled: Boolean(user),
    queryFn: async () => {
      const { error: generationError } = await db.rpc<number>(
        "generate_my_scheduled_employee_tasks",
        { _for_date: today },
      );
      if (generationError) throw new Error(generationError.message);

      const [tasksResult, guidanceResult, schedulesResult] = await Promise.all([
        db
          .from<WorkTask>("employee_tasks")
          .select(
            "id, task_date, title, description, status, duration_minutes, assigned_user_id, task_source_schedule_id",
          )
          .eq("task_date", today)
          .or(`created_by.eq.${user!.id},assigned_user_id.eq.${user!.id}`)
          .order("created_at", { ascending: false }),
        db
          .from<Guidance>("employee_guidance_notes")
          .select("id, title, content, guidance_date, created_at, read_at")
          .eq("target_user_id", user!.id)
          .order("created_at", { ascending: false }),
        db
          .from<Schedule>("employee_task_schedules")
          .select(
            "id, employee_id, target_user_id, department_id, title, description, frequency, weekday, starts_on, ends_on, is_active",
          )
          .eq("target_user_id", user!.id)
          .eq("is_active", true)
          .order("frequency"),
      ]);
      if (tasksResult.error) throw new Error(tasksResult.error.message);
      if (guidanceResult.error) throw new Error(guidanceResult.error.message);
      if (schedulesResult.error) throw new Error(schedulesResult.error.message);
      return {
        tasks: tasksResult.data ?? [],
        guidance: guidanceResult.data ?? [],
        schedules: schedulesResult.data ?? [],
      };
    },
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["work-center", "schedule-options"],
    enabled: canManageSchedules,
    queryFn: async () => {
      const [employeesResult, profilesResult] = await Promise.all([
        db
          .from<Employee>("employees")
          .select("id, full_name, employee_no, email, department_id")
          .eq("status", "active")
          .order("full_name"),
        db.from<Profile>("profiles").select("id, full_name, email").order("full_name"),
      ]);
      if (employeesResult.error) throw new Error(employeesResult.error.message);
      if (profilesResult.error) throw new Error(profilesResult.error.message);
      const profilesByEmail = new Map(
        (profilesResult.data ?? [])
          .map((profile) => [normalizedEmail(profile.email), profile] as const)
          .filter(([email]) => email),
      );
      return (employeesResult.data ?? []).flatMap((employee) => {
        const profile = profilesByEmail.get(normalizedEmail(employee.email));
        return profile ? [{ employee, profile }] : [];
      });
    },
  });

  const schedulesQuery = useQuery({
    queryKey: ["work-center", "managed-schedules", user?.id],
    enabled: canManageSchedules,
    queryFn: async () => {
      const { data, error } = await db
        .from<Schedule>("employee_task_schedules")
        .select(
          "id, employee_id, target_user_id, department_id, title, description, frequency, weekday, starts_on, ends_on, is_active",
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const employeeOptions = employeeOptionsQuery.data ?? EMPTY_SCHEDULE_OPTIONS;
  const employeeOptionById = useMemo(
    () => new Map(employeeOptions.map((option) => [option.employee.id, option])),
    [employeeOptions],
  );
  const tasks = workQuery.data?.tasks ?? [];
  const guidance = workQuery.data?.guidance ?? [];
  const schedules = schedulesQuery.data ?? [];
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const pendingTasks = tasks.filter((task) => task.status !== "completed");
  const unreadGuidanceCount = guidance.filter((note) => !note.read_at).length;
  const completionPercent = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  const createSchedule = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("يجب تسجيل الدخول أولاً");
      const option = employeeOptionById.get(employeeId);
      if (!option) throw new Error("اختر موظفاً لديه حساب مرتبط بالنظام");
      const cleanTitle = title.trim();
      if (cleanTitle.length < 2) throw new Error("اكتب عنواناً واضحاً للمهمة");
      const { error } = await db.from<Schedule>("employee_task_schedules").insert({
        employee_id: option.employee.id,
        target_user_id: option.profile.id,
        department_id: option.employee.department_id,
        title: cleanTitle,
        description: description.trim() || null,
        frequency,
        weekday: frequency === "weekly" ? Number(weekday) : null,
        starts_on: startsOn,
        created_by: user.id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-center", "managed-schedules"] }),
        queryClient.invalidateQueries({ queryKey: ["work-center", user?.id] }),
      ]);
      toast.success("تم حفظ المهمة الدورية، وستظهر للموظف في يوم استحقاقها");
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleSchedule = useMutation({
    mutationFn: async (schedule: Schedule) => {
      const { error } = await db
        .from<Schedule>("employee_task_schedules")
        .update({ is_active: !schedule.is_active })
        .eq("id", schedule.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-center", "managed-schedules"] });
      toast.success("تم تحديث حالة المهمة الدورية");
    },
    onError: (error) => toast.error(error.message),
  });

  const completeTask = useMutation({
    mutationFn: async (task: WorkTask) => {
      const { error } = await db.rpc<void>("complete_my_work_center_task", {
        _task_id: task.id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-center", user?.id, today] });
      toast.success("تم تأكيد إنجاز المهمة");
    },
    onError: (error) => toast.error(error.message),
  });

  const markGuidanceRead = useMutation({
    mutationFn: async (note: Guidance) => {
      const { error } = await db
        .from<Guidance>("employee_guidance_notes")
        .update({ read_at: new Date().toISOString() })
        .eq("id", note.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["work-center", user?.id, today] });
    },
    onError: (error) => toast.error(error.message),
  });

  const submitSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createSchedule.mutate();
  };

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["work-center"] });

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarCheck2 className="h-4 w-4" /> مساحة المهام والإرشادات
          </div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">مركز العمل</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            مهام اليوم، الجداول الدورية، وتوجيهات فريقك.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="px-3 py-1.5">
            {today}
          </Badge>
          <Button variant="outline" size="icon" onClick={refresh} aria-label="تحديث مركز العمل">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="إحصائيات الإنجاز">
        <StatCard
          icon={ClipboardList}
          label="مهام اليوم"
          value={tasks.length}
          detail={`${pendingTasks.length} متبقية`}
        />
        <StatCard
          icon={CircleCheck}
          label="الإنجاز"
          value={`${completionPercent}%`}
          detail={`${completedCount} من ${tasks.length} مهام`}
        />
        <StatCard
          icon={Repeat2}
          label="المهام الدورية"
          value={workQuery.data?.schedules.length ?? 0}
          detail="يومية وأسبوعية فعّالة"
        />
        <StatCard
          icon={MessageSquareText}
          label="توجيهات جديدة"
          value={unreadGuidanceCount}
          detail={`${guidance.length} توجيه في السجل`}
        />
      </section>

      {workQuery.isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-5 text-sm text-destructive">
            تعذر تحميل مركز العمل: {(workQuery.error as Error).message}
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b bg-muted/20">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" /> قائمة مهام اليوم
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                تُنشأ المهام الدورية تلقائياً مرة واحدة في يوم استحقاقها.
              </p>
            </div>
            <Badge variant="outline">{pendingTasks.length} متبقية</Badge>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {workQuery.isLoading ? (
              <LoadingState />
            ) : tasks.length ? (
              tasks.map((task) => (
                <article
                  key={task.id}
                  className="flex flex-col gap-3 rounded-xl border bg-background p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{task.title}</h2>
                      <Badge variant={task.status === "completed" ? "default" : "secondary"}>
                        {task.status === "completed" ? "مكتملة" : "بانتظار الإنجاز"}
                      </Badge>
                      {task.task_source_schedule_id && (
                        <Badge variant="outline">
                          <Repeat2 className="ml-1 h-3 w-3" /> دورية
                        </Badge>
                      )}
                    </div>
                    {task.description && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                    {task.duration_minutes > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        المدة المسجلة: {task.duration_minutes} دقيقة
                      </p>
                    )}
                  </div>
                  {task.status !== "completed" && (
                    <Button
                      size="sm"
                      onClick={() => completeTask.mutate(task)}
                      disabled={completeTask.isPending}
                    >
                      {completeTask.isPending ? (
                        <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="ml-2 h-4 w-4" />
                      )}
                      تأكيد الإنجاز
                    </Button>
                  )}
                </article>
              ))
            ) : (
              <EmptyState
                icon={CalendarCheck2}
                title="لا توجد مهام لهذا اليوم"
                description="ستظهر هنا مهامك الشخصية والمهام الدورية المستحقة اليوم."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" /> الجدول الدوري
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {workQuery.isLoading ? (
              <LoadingState />
            ) : workQuery.data?.schedules.length ? (
              workQuery.data.schedules.map((schedule) => (
                <div key={schedule.id} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{schedule.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {schedule.frequency === "daily"
                          ? "يومياً"
                          : `أسبوعياً · ${weekdayNames[schedule.weekday ?? 0]}`}
                      </p>
                    </div>
                    <Badge variant="outline">من {schedule.starts_on}</Badge>
                  </div>
                  {schedule.description && (
                    <p className="mt-2 text-sm text-muted-foreground">{schedule.description}</p>
                  )}
                </div>
              ))
            ) : (
              <EmptyState
                icon={Repeat2}
                title="لا توجد مهام دورية"
                description="عند إسناد جدول يومي أو أسبوعي لحسابك سيظهر هنا."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" /> توجيهات الفريق
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          {workQuery.isLoading ? (
            <LoadingState />
          ) : guidance.length ? (
            guidance.map((note) => (
              <article key={note.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{note.title}</h2>
                      {!note.read_at && <Badge>جديد</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{note.guidance_date}</p>
                  </div>
                  {!note.read_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markGuidanceRead.mutate(note)}
                      disabled={markGuidanceRead.isPending}
                    >
                      تم الاطلاع
                    </Button>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{note.content}</p>
              </article>
            ))
          ) : (
            <EmptyState
              icon={MessageSquareText}
              title="لا توجد توجيهات"
              description="ستظهر توجيهات الإدارة المرسلة إليك في هذا القسم."
            />
          )}
        </CardContent>
      </Card>

      {canManageSchedules && (
        <section className="grid items-start gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" /> إسناد مهمة دورية
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {employeeOptionsQuery.isLoading ? (
                <LoadingState />
              ) : employeeOptions.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  لا توجد حسابات موظفين نشطة مرتبطة بالبريد الإلكتروني. اربط حساب الموظف ببريده في
                  ملفه أولاً.
                </p>
              ) : (
                <form className="space-y-4" onSubmit={submitSchedule}>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-employee">الموظف</Label>
                    <Select value={employeeId} onValueChange={setEmployeeId}>
                      <SelectTrigger id="schedule-employee">
                        <SelectValue placeholder="اختر الموظف" />
                      </SelectTrigger>
                      <SelectContent>
                        {employeeOptions.map(({ employee, profile }) => (
                          <SelectItem key={employee.id} value={employee.id}>
                            {profile.full_name || employee.full_name} · {employee.employee_no}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-title">عنوان المهمة</Label>
                    <Input
                      id="schedule-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={200}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-description">التفاصيل</Label>
                    <Textarea
                      id="schedule-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={2000}
                      rows={3}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>التكرار</Label>
                      <Select
                        value={frequency}
                        onValueChange={(value) => setFrequency(value as "daily" | "weekly")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">يومي</SelectItem>
                          <SelectItem value="weekly">أسبوعي</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {frequency === "weekly" && (
                      <div className="space-y-2">
                        <Label>يوم الاستحقاق</Label>
                        <Select value={weekday} onValueChange={setWeekday}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {weekdayNames.map((name, index) => (
                              <SelectItem key={name} value={String(index)}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="schedule-start">يبدأ من</Label>
                    <Input
                      id="schedule-start"
                      type="date"
                      value={startsOn}
                      min={today}
                      onChange={(event) => setStartsOn(event.target.value)}
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createSchedule.isPending || !employeeId}
                  >
                    {createSchedule.isPending ? (
                      <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="ml-2 h-4 w-4" />
                    )}{" "}
                    حفظ الجدول
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" /> جداول الفريق
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {schedulesQuery.isLoading ? (
                <LoadingState />
              ) : schedules.length ? (
                schedules.map((schedule) => {
                  const option = employeeOptionById.get(schedule.employee_id);
                  return (
                    <article
                      key={schedule.id}
                      className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{schedule.title}</h2>
                          <Badge variant={schedule.is_active ? "secondary" : "outline"}>
                            {schedule.is_active ? "نشطة" : "متوقفة"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {option?.profile.full_name || option?.employee.full_name || "الموظف"} ·{" "}
                          {schedule.frequency === "daily"
                            ? "يومياً"
                            : `أسبوعياً · ${weekdayNames[schedule.weekday ?? 0]}`}{" "}
                          · تبدأ {schedule.starts_on}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleSchedule.mutate(schedule)}
                        disabled={toggleSchedule.isPending}
                      >
                        {schedule.is_active ? "إيقاف" : "تفعيل"}
                      </Button>
                    </article>
                  );
                })
              ) : (
                <EmptyState
                  icon={Repeat2}
                  title="لا توجد جداول محفوظة"
                  description="أنشئ جدولاً يومياً أو أسبوعياً ليولّد النظام مهاماً لكل موظف في يوم الاستحقاق."
                />
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" /> جارٍ التحميل…
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CalendarCheck2;
  title: string;
  description: string;
}) {
  return (
    <div className="col-span-full flex flex-col items-center rounded-xl border border-dashed px-5 py-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/60" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

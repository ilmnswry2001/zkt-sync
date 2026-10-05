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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { addCalendarDays, todayInBaghdad } from "@/lib/date-time";

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

type Task = Database["public"]["Tables"]["employee_tasks"]["Row"];
type Template = Database["public"]["Tables"]["team_task_templates"]["Row"];
type Guidance = Database["public"]["Tables"]["employee_guidance_notes"]["Row"];
type Emp = { id: string; full_name: string; position: string | null; department_id: string | null };
type Dept = { id: string; name: string };
type LegacyRecipient = { id: string; read_at: string | null; user_id: string | null; employee_id: string | null; created_at: string; team_guidance_notes: { content: string; note_date: string; department_id: string } | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  not_started: { label: "لم تبدأ", cls: "bg-muted text-muted-foreground" },
  in_progress: { label: "قيد التنفيذ", cls: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
  completed: { label: "مكتملة", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  overdue: { label: "متأخرة", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  needs_follow_up: { label: "تحتاج متابعة", cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200" },
  pending_review: { label: "تحتاج متابعة", cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200" },
  cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground line-through" },
};
const ALLOWED_STATUSES = ["not_started", "in_progress", "completed", "overdue", "needs_follow_up", "cancelled"];
const TYPES: Record<string, string> = { one_time: "لمرة واحدة", daily: "يومية", weekly: "أسبوعية", monthly: "شهرية", recurring: "متكررة", urgent: "لمرة واحدة", follow_up: "لمرة واحدة", guidance: "لمرة واحدة" };
const PRIORITIES: Record<string, string> = { low: "منخفضة", normal: "متوسطة", high: "عالية", urgent: "عاجلة" };
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const addDays = addCalendarDays;
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "خطأ غير معروف");

function effectiveStatus(t: Task, today: string) {
  if (t.status === "completed" || t.status === "cancelled") return t.status;
  const due = t.due_date ?? t.task_date;
  if (due < today && t.status !== "needs_follow_up" && t.status !== "pending_review") return "overdue";
  return t.status;
}
function StatusBadge({ s }: { s: string }) {
  const m = STATUS[s] ?? STATUS.not_started;
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
function State({ loading, error, empty, children }: { loading?: boolean; error?: unknown; empty?: boolean; children: React.ReactNode }) {
  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</div>;
  if (error) return <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">تعذر تحميل البيانات: {errText(error)}</div>;
  if (empty) return <div className="p-6 text-center text-sm text-muted-foreground">لا توجد بيانات لعرضها.</div>;
  return <>{children}</>;
}
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><h3 className="text-sm font-bold">{title}</h3>{action}</div>
      <div className="p-2">{children}</div>
    </section>
  );
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg border bg-card px-4 py-3"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-bold ${tone ?? ""}`}>{value}</div></div>;
}

function WorkCenterPage() {
  const { user, roles, isAdmin, isHR, permissionsLoading } = useAuth();
  const qc = useQueryClient();
  const [today, setToday] = useState(todayInBaghdad);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayInBaghdad()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const isManager = isAdmin || isHR || roles.includes("department_manager") || roles.includes("supervisor");
  const uid = user?.id;

  const deptsQ = useQuery({
    queryKey: ["wc-depts", uid, isAdmin, isHR],
    enabled: !!uid && !permissionsLoading,
    queryFn: async (): Promise<Dept[]> => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      if (isAdmin || isHR) return data ?? [];
      const [a, b] = await Promise.all([
        supabase.from("user_departments").select("department_id").eq("user_id", uid!),
        supabase.from("department_managers").select("department_id").eq("user_id", uid!),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const ids = new Set([...(a.data ?? []), ...(b.data ?? [])].map((r) => r.department_id));
      return (data ?? []).filter((d) => ids.has(d.id));
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
      const { data, error } = await supabase.from("employees").select("id, full_name, position, department_id").in("department_id", scopeIds).eq("status", "active").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const emps = empsQ.data ?? [];
  const empById = useMemo(() => new Map(emps.map((e) => [e.id, e])), [emps]);

  const genQ = useQuery({
    queryKey: ["wc-generate", uid, today],
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
      if (error) throw error;
      return data ?? 0;
    },
  });

  const from = addDays(today, -120);
  const tasksQ = useQuery({
    queryKey: ["wc-tasks", uid, isManager, scopeIds, meQ.data, genQ.dataUpdatedAt],
    enabled: !!uid && meQ.isFetched && !genQ.isLoading && (!isManager || deptsQ.isFetched),
    queryFn: async (): Promise<Task[]> => {
      let q = supabase.from("employee_tasks").select("*").gte("task_date", from).order("task_date", { ascending: false }).limit(5000);
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
      const { data, error } = await supabase.from("team_task_templates").select("*").in("department_id", scopeIds).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const guidanceQ = useQuery({
    queryKey: ["wc-guidance", uid, isManager, scopeIds],
    enabled: !!uid && (!isManager || deptsQ.isFetched),
    queryFn: async () => {
      let q = supabase.from("employee_guidance_notes").select("*").order("created_at", { ascending: false }).limit(1000);
      if (isManager) {
        if (!(isAdmin || isHR)) q = scopeIds.length ? q.in("department_id", scopeIds) : q.eq("target_user_id", uid!);
      } else q = q.eq("target_user_id", uid!);
      const legacy = isManager
        ? supabase.from("team_guidance_recipients").select("id, read_at, user_id, employee_id, created_at, team_guidance_notes(content, note_date, department_id)").order("created_at", { ascending: false }).limit(1000)
        : supabase.from("team_guidance_recipients").select("id, read_at, user_id, employee_id, created_at, team_guidance_notes(content, note_date, department_id)").eq("user_id", uid!).order("created_at", { ascending: false });
      const [a, b] = await Promise.all([q, legacy]);
      if (a.error) throw a.error;
      return { notes: (a.data ?? []) as Guidance[], legacy: b.error ? [] : ((b.data ?? []) as unknown as LegacyRecipient[]) };
    },
  });

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`work-center-guidance-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "employee_guidance_notes" }, () => qc.invalidateQueries({ queryKey: ["wc-guidance"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, qc]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wc-tasks"] });
    void qc.invalidateQueries({ queryKey: ["wc-templates"] });
    void qc.invalidateQueries({ queryKey: ["wc-guidance"] });
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [completeTask, setCompleteTask] = useState<Task | null>(null);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [historyEmp, setHistoryEmp] = useState<Emp | null>(null);

  const empName = (id: string | null) => (id ? empById.get(id)?.full_name ?? "—" : "—");

  const updateStatus = async (t: Task, status: string) => {
    try {
      const patch: Database["public"]["Tables"]["employee_tasks"]["Update"] = { status };
      if (status === "in_progress" && !t.started_at) patch.started_at = new Date().toISOString();
      const { error } = await supabase.from("employee_tasks").update(patch).eq("id", t.id);
      if (error) throw error;
      toast.success("تم تحديث الحالة");
      refresh();
    } catch (e) { toast.error(`تعذر التحديث: ${errText(e)}`); }
  };

  if (permissionsLoading) return <State loading>{null}</State>;

  const notes = guidanceQ.data?.notes ?? [];
  const myNotes = notes.filter((n) => n.target_user_id === uid);
  const unreadMine = myNotes.filter((n) => !n.read_at).length + (guidanceQ.data?.legacy ?? []).filter((r) => r.user_id === uid && !r.read_at).length;
  const unreadSent = notes.filter((n) => n.target_user_id !== uid && !n.read_at).length;

  const withStatus = tasks.map((t) => ({ t, s: effectiveStatus(t, today) }));
  const todays = withStatus.filter(({ t }) => t.task_date === today);
  const overdue = withStatus.filter(({ s }) => s === "overdue");
  const upcoming = withStatus.filter(({ t, s }) => t.task_date > today && s !== "cancelled").sort((a, b) => a.t.task_date.localeCompare(b.t.task_date));
  const followUp = withStatus.filter(({ s, t }) => s === "overdue" || s === "needs_follow_up" || s === "pending_review" || (s === "not_started" && (t.task_date <= today)));

  const taskRows = (rows: { t: Task; s: string }[], showEmp = isManager) => (
    <Table>
      <TableHeader><TableRow><TableHead>المهمة</TableHead>{showEmp && <TableHead>الموظف</TableHead>}<TableHead>النوع</TableHead><TableHead>الأولوية</TableHead><TableHead>التاريخ</TableHead><TableHead>الموعد النهائي</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">إجراء</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map(({ t, s }) => (
          <TableRow key={t.id}>
            <TableCell className="max-w-[280px]"><div className="font-medium">{t.title}</div>{t.description && <div className="truncate text-xs text-muted-foreground">{t.description}</div>}{t.completion_note && <div className="text-xs text-emerald-700 dark:text-emerald-300">ملاحظة الإنجاز: {t.completion_note}</div>}</TableCell>
            {showEmp && <TableCell>{empName(t.employee_id)}</TableCell>}
            <TableCell>{TYPES[t.task_type] ?? t.task_type}</TableCell>
            <TableCell>{PRIORITIES[t.priority] ?? t.priority}</TableCell>
            <TableCell className="whitespace-nowrap">{t.task_date}</TableCell>
            <TableCell className="whitespace-nowrap">{t.due_date ?? "—"}</TableCell>
            <TableCell><StatusBadge s={s} /></TableCell>
            <TableCell className="text-left">
              <div className="flex justify-end gap-1">
                {s !== "completed" && s !== "cancelled" && t.employee_id && t.employee_id === meQ.data && (
                  <>
                    {s !== "in_progress" && <Button size="sm" variant="outline" onClick={() => updateStatus(t, "in_progress")}>بدء</Button>}
                    <Button size="sm" onClick={() => setCompleteTask(t)}>تم الإنجاز</Button>
                  </>
                )}
                {isManager && <Button size="sm" variant="ghost" onClick={() => setEditTask(t)}>تعديل</Button>}
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
        <div><h1 className="text-xl font-bold">مركز العمل</h1><p className="text-sm text-muted-foreground">{isManager ? "إدارة ومتابعة مهام وتوجيهات القسم" : "مهامك والتوجيهات الموجهة إليك"}</p></div>
        {isManager && (
          <div className="flex gap-2">
            <Button onClick={() => setCreateOpen(true)} disabled={!scopeIds.length}><Plus className="ml-1 h-4 w-4" /> إنشاء مهمة</Button>
            <Button variant="outline" onClick={() => setGuidanceOpen(true)} disabled={!scopeIds.length}><Send className="ml-1 h-4 w-4" /> إرسال توجيه</Button>
          </div>
        )}
      </div>
      {isManager && deptsQ.isFetched && !scopeIds.length && <div className="rounded-lg border p-4 text-sm text-muted-foreground">لا توجد أقسام مرتبطة بحسابك. تواصل مع مدير النظام.</div>}
      {!isManager && meQ.isFetched && !meQ.data && <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-100">لم يتم ربط حسابك بسجل موظف (البريد أو الاسم غير مطابق)، لذلك قد لا تظهر المهام المسندة إليك.</div>}

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
                  <Stat label="المكتملة" value={todays.filter((x) => x.s === "completed").length} tone="text-emerald-600" />
                  <Stat label="قيد التنفيذ" value={todays.filter((x) => x.s === "in_progress").length} tone="text-sky-600" />
                  <Stat label="لم تبدأ" value={todays.filter((x) => x.s === "not_started").length} tone="text-muted-foreground" />
                  <Stat label="المتأخرة" value={overdue.length} tone="text-red-600" />
                  <Stat label="تحتاج متابعة" value={followUp.length} tone="text-orange-600" />
                  <Stat label="توجيهات غير مقروءة" value={unreadSent} tone="text-orange-600" />
                </div>
                <Section title="يحتاج متابعة">
                  <State empty={!followUp.length && !unreadSent}>
                    {followUp.length > 0 && taskRows(followUp)}
                    {unreadSent > 0 && <p className="px-3 py-2 text-sm text-orange-700 dark:text-orange-300">{unreadSent} توجيه لم يُقرأ بعد — راجع تبويب التوجيهات.</p>}
                  </State>
                </Section>
              </>
            ) : (
              <>
                <Section title="مهام اليوم"><State empty={!todays.length}>{taskRows(todays, false)}</State></Section>
                <Section title="المهام المتأخرة"><State empty={!overdue.length}>{taskRows(overdue, false)}</State></Section>
                <Section title="المهام القادمة"><State empty={!upcoming.length}>{taskRows(upcoming.slice(0, 20), false)}</State></Section>
                <Section title={`التوجيهات الجديدة (${unreadMine})`}>
                  <State loading={guidanceQ.isLoading} error={guidanceQ.error} empty={!unreadMine}>
                    <GuidanceInbox notes={myNotes.filter((n) => !n.read_at)} legacy={(guidanceQ.data?.legacy ?? []).filter((r) => !r.read_at)} onRead={refresh} />
                  </State>
                </Section>
              </>
            )}
          </State>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <TasksTab rows={withStatus} loading={tasksQ.isLoading} error={tasksQ.error} isManager={isManager} emps={emps} render={taskRows} />
          {isManager && (
            <Section title="المهام المتكررة">
              <State loading={templatesQ.isLoading} error={templatesQ.error} empty={!(templatesQ.data ?? []).length}>
                <Table>
                  <TableHeader><TableRow><TableHead>المهمة</TableHead><TableHead>التكرار</TableHead><TableHead>المسؤول</TableHead><TableHead>الفترة</TableHead><TableHead>الحالة</TableHead><TableHead className="text-left">إجراء</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(templatesQ.data ?? []).map((tp) => (
                      <TableRow key={tp.id}>
                        <TableCell className="font-medium">{tp.title}</TableCell>
                        <TableCell>{scheduleText(tp)}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{tp.assignee_employee_ids.length ? tp.assignee_employee_ids.map(empName).join("، ") : "جميع موظفي القسم"}</TableCell>
                        <TableCell className="whitespace-nowrap">{tp.start_date} ← {tp.end_date ?? "مفتوح"}</TableCell>
                        <TableCell>{tp.active ? <Badge variant="secondary">نشطة</Badge> : <Badge variant="outline">موقوفة</Badge>}</TableCell>
                        <TableCell className="text-left">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={async () => {
                              try {
                                const { error } = await supabase.from("team_task_templates").update({ active: !tp.active }).eq("id", tp.id);
                                if (error) throw error;
                                if (!tp.active) await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
                                toast.success(tp.active ? "تم إيقاف التكرار" : "تم استئناف التكرار");
                                refresh();
                              } catch (e) { toast.error(errText(e)); }
                            }}>{tp.active ? "إيقاف" : "استئناف"}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditTemplate(tp)}>تعديل الجدول</Button>
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
              <State loading={empsQ.isLoading || tasksQ.isLoading} error={empsQ.error ?? tasksQ.error} empty={!emps.length}>
                <Table>
                  <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>المسمى الوظيفي</TableHead><TableHead>مهام اليوم</TableHead><TableHead>المكتمل</TableHead><TableHead>قيد التنفيذ</TableHead><TableHead>المتأخر</TableHead><TableHead>نسبة الإنجاز</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {emps.map((e) => {
                      const mine = withStatus.filter(({ t }) => t.employee_id === e.id);
                      const td = mine.filter(({ t }) => t.task_date === today);
                      const done = td.filter((x) => x.s === "completed").length;
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.full_name}</TableCell>
                          <TableCell>{e.position ?? "—"}</TableCell>
                          <TableCell>{td.length}</TableCell>
                          <TableCell className="text-emerald-600">{done}</TableCell>
                          <TableCell className="text-sky-600">{td.filter((x) => x.s === "in_progress").length}</TableCell>
                          <TableCell className="text-red-600">{mine.filter((x) => x.s === "overdue").length}</TableCell>
                          <TableCell>{td.length ? Math.round((done / td.length) * 100) : 0}%</TableCell>
                          <TableCell className="text-left"><Button size="sm" variant="outline" onClick={() => setHistoryEmp(e)}>عرض السجل</Button></TableCell>
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
              <SentGuidance notes={notes.filter((n) => n.target_user_id !== uid)} legacy={guidanceQ.data?.legacy ?? []} empName={empName} />
            ) : (
              <Section title="التوجيهات الموجهة إليك">
                <State empty={!myNotes.length && !(guidanceQ.data?.legacy ?? []).length}>
                  <GuidanceInbox notes={myNotes} legacy={guidanceQ.data?.legacy ?? []} onRead={refresh} />
                </State>
              </Section>
            )}
          </State>
        </TabsContent>

        <TabsContent value="performance">
          <PerformanceTab rows={withStatus} emps={isManager ? emps : []} isManager={isManager} loading={tasksQ.isLoading} error={tasksQ.error} />
        </TabsContent>
      </Tabs>

      {isManager && <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} depts={deptsQ.data ?? []} emps={emps} uid={uid ?? ""} today={today} onDone={refresh} />}
      {isManager && <SendGuidanceDialog open={guidanceOpen} onOpenChange={setGuidanceOpen} depts={deptsQ.data ?? []} emps={emps} uid={uid ?? ""} today={today} onDone={refresh} />}
      {editTask && <EditTaskDialog task={editTask} onClose={() => setEditTask(null)} onDone={refresh} />}
      {completeTask && <CompleteDialog task={completeTask} onClose={() => setCompleteTask(null)} onDone={refresh} />}
      {editTemplate && <EditTemplateDialog tp={editTemplate} today={today} onClose={() => setEditTemplate(null)} onDone={refresh} />}
      {historyEmp && (
        <HistoryDialog emp={historyEmp} rows={withStatus.filter(({ t }) => t.employee_id === historyEmp.id)} notes={notes} today={today} onClose={() => setHistoryEmp(null)} render={taskRows} />
      )}
    </div>
  );
}

function scheduleText(tp: Template) {
  if (tp.recurrence_rule === "weekly") return `أسبوعية: ${(tp.weekdays?.length ? tp.weekdays : [new Date(tp.start_date + "T00:00:00").getDay()]).map((d) => WEEKDAYS[d]).join("، ")}`;
  if (tp.recurrence_rule === "monthly") return `شهرية: يوم ${tp.month_day ?? Number(tp.start_date.slice(8, 10))}`;
  if (tp.recurrence_rule === "weekdays") return "أيام العمل";
  if (tp.recurrence_rule === "interval") return `كل ${tp.interval_days} أيام`;
  return "يومية";
}

function TasksTab({ rows, loading, error, isManager, emps, render }: { rows: { t: Task; s: string }[]; loading: boolean; error: unknown; isManager: boolean; emps: Emp[]; render: (r: { t: Task; s: string }[], showEmp?: boolean) => React.ReactNode }) {
  const [emp, setEmp] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [prio, setPrio] = useState("all");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const names = new Map(emps.map((e) => [e.id, e.full_name]));
  const filtered = rows.filter(({ t, s }) => {
    if (emp !== "all" && t.employee_id !== emp) return false;
    if (status !== "all" && s !== status && !(status === "needs_follow_up" && s === "pending_review")) return false;
    if (type !== "all" && (TYPES[t.task_type] ?? "") !== TYPES[type]) return false;
    if (prio !== "all" && t.priority !== prio) return false;
    if (date && t.task_date !== date) return false;
    const q = search.trim();
    if (q && !t.title.includes(q) && !(names.get(t.employee_id ?? "") ?? "").includes(q)) return false;
    return true;
  });
  return (
    <Section title={`المهام (${filtered.length})`}>
      <div className="flex flex-wrap gap-2 p-2">
        <Input className="w-56" placeholder="بحث باسم المهمة أو الموظف" value={search} onChange={(e) => setSearch(e.target.value)} />
        {isManager && (
          <Select value={emp} onValueChange={setEmp}><SelectTrigger className="w-44"><SelectValue placeholder="الموظف" /></SelectTrigger><SelectContent><SelectItem value="all">كل الموظفين</SelectItem>{emps.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select>
        )}
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{ALLOWED_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}</SelectContent></Select>
        <Select value={type} onValueChange={setType}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الأنواع</SelectItem>{["one_time", "daily", "weekly", "monthly"].map((k) => <SelectItem key={k} value={k}>{TYPES[k]}</SelectItem>)}</SelectContent></Select>
        <Select value={prio} onValueChange={setPrio}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الأولويات</SelectItem>{Object.entries(PRIORITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
        <Input type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <State loading={loading} error={error} empty={!filtered.length}>{render(filtered.slice(0, 300))}</State>
    </Section>
  );
}

function GuidanceInbox({ notes, legacy, onRead }: { notes: Guidance[]; legacy: LegacyRecipient[]; onRead: () => void }) {
  const markRead = async (table: "employee_guidance_notes" | "team_guidance_recipients", id: string) => {
    try {
      const { error } = await supabase.from(table).update({ read_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      onRead();
    } catch (e) { toast.error(`تعذر التحديث: ${errText(e)}`); }
  };
  return (
    <div className="divide-y">
      {notes.map((n) => (
        <div key={n.id} className="flex items-start justify-between gap-3 px-3 py-3">
          <div><div className="flex items-center gap-2 font-semibold">{n.title}{!n.read_at && <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">جديد</span>}</div><p className="mt-1 whitespace-pre-wrap text-sm">{n.content}</p><div className="mt-1 text-xs text-muted-foreground">{n.guidance_date} · {new Date(n.created_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</div></div>
          {!n.read_at ? <Button size="sm" variant="outline" onClick={() => markRead("employee_guidance_notes", n.id)}>تمت القراءة</Button> : <span className="text-xs text-emerald-600">مقروء</span>}
        </div>
      ))}
      {legacy.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-3 px-3 py-3">
          <div><div className="flex items-center gap-2 font-semibold">توجيه القسم{!r.read_at && <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">جديد</span>}</div><p className="mt-1 whitespace-pre-wrap text-sm">{r.team_guidance_notes?.content}</p><div className="mt-1 text-xs text-muted-foreground">{r.team_guidance_notes?.note_date}</div></div>
          {!r.read_at ? <Button size="sm" variant="outline" onClick={() => markRead("team_guidance_recipients", r.id)}>تمت القراءة</Button> : <span className="text-xs text-emerald-600">مقروء</span>}
        </div>
      ))}
    </div>
  );
}

function SentGuidance({ notes, legacy, empName }: { notes: Guidance[]; legacy: LegacyRecipient[]; empName: (id: string | null) => string }) {
  const [filter, setFilter] = useState("all");
  const rows = notes.filter((n) => filter === "all" || (filter === "read" ? !!n.read_at : !n.read_at));
  return (
    <div className="space-y-4">
      <Section title={`التوجيهات المرسلة (${notes.length})`} action={
        <Select value={filter} onValueChange={setFilter}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="read">مقروء</SelectItem><SelectItem value="unread">غير مقروء</SelectItem></SelectContent></Select>
      }>
        <State empty={!rows.length}>
          <Table>
            <TableHeader><TableRow><TableHead>العنوان</TableHead><TableHead>النص</TableHead><TableHead>المستلم</TableHead><TableHead>التاريخ</TableHead><TableHead>وقت الإرسال</TableHead><TableHead>حالة القراءة</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.title}</TableCell>
                  <TableCell className="max-w-[320px] truncate">{n.content}</TableCell>
                  <TableCell>{empName(n.target_employee_id)}</TableCell>
                  <TableCell>{n.guidance_date}</TableCell>
                  <TableCell>{new Date(n.created_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell>{n.read_at ? <span className="text-emerald-600">مقروء</span> : <span className="text-orange-600">غير مقروء</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </State>
      </Section>
      {legacy.length > 0 && (
        <Section title="توجيهات القسم السابقة">
          <Table>
            <TableHeader><TableRow><TableHead>النص</TableHead><TableHead>المستلم</TableHead><TableHead>التاريخ</TableHead><TableHead>حالة القراءة</TableHead></TableRow></TableHeader>
            <TableBody>
              {legacy.map((r) => (
                <TableRow key={r.id}><TableCell className="max-w-[360px] truncate">{r.team_guidance_notes?.content}</TableCell><TableCell>{empName(r.employee_id)}</TableCell><TableCell>{r.team_guidance_notes?.note_date}</TableCell><TableCell>{r.read_at ? <span className="text-emerald-600">مقروء</span> : <span className="text-orange-600">غير مقروء</span>}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function PerformanceTab({ rows, emps, isManager, loading, error }: { rows: { t: Task; s: string }[]; emps: Emp[]; isManager: boolean; loading: boolean; error: unknown }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => todayInBaghdad().slice(0, 7));
  const monthStart = `${month}-01`;
  const inMonth = rows.filter(({ t }) => t.task_date.startsWith(month) && t.status !== "cancelled");
  const evalQ = useQuery({
    queryKey: ["wc-evals", monthStart, emps.map((e) => e.id)],
    enabled: isManager && emps.length > 0,
    queryFn: async () => {
      const { data, error: e } = await supabase.from("employee_monthly_evaluations").select("employee_id, score").eq("evaluation_month", monthStart).in("employee_id", emps.map((x) => x.id));
      if (e) throw e;
      return new Map((data ?? []).map((r) => [r.employee_id, r.score]));
    },
  });
  const [scores, setScores] = useState<Record<string, string>>({});
  const metrics = (list: { t: Task; s: string }[]) => {
    const done = list.filter((x) => x.s === "completed").length;
    return { total: list.length, done, late: list.filter((x) => x.s === "overdue").length, rate: list.length ? Math.round((done / list.length) * 100) : 0, recurring: list.filter((x) => x.t.template_id && x.s === "completed").length };
  };
  const submit = async (empId: string) => {
    const score = Number(scores[empId]);
    if (!Number.isInteger(score) || score < 0 || score > 100) return toast.error("أدخل درجة صحيحة من 0 إلى 100");
    try {
      const { data, error: e } = await supabase.rpc("submit_employee_monthly_evaluation", { _employee_id: empId, _evaluation_month: monthStart, _score: score });
      if (e) throw e;
      toast.success(Number(data?.[0]?.bonus_added ?? 0) > 0 ? "تم حفظ التقييم وإضافة المكافأة" : "تم حفظ التقييم");
      await qc.invalidateQueries({ queryKey: ["wc-evals"] });
    } catch (e) { toast.error(errText(e)); }
  };
  const list = isManager ? emps.map((e) => ({ e, m: metrics(inMonth.filter(({ t }) => t.employee_id === e.id)) })) : [];
  const own = metrics(inMonth);
  return (
    <Section title="مؤشرات العمل" action={<Input type="month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />}>
      <State loading={loading} error={error}>
        {isManager ? (
          <State empty={!list.length}>
            <Table>
              <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>عدد المهام</TableHead><TableHead>المكتملة</TableHead><TableHead>المتأخرة</TableHead><TableHead>نسبة الإنجاز</TableHead><TableHead>المتكررة المنجزة</TableHead><TableHead>التقييم الشهري</TableHead></TableRow></TableHeader>
              <TableBody>
                {list.map(({ e, m }) => {
                  const existing = evalQ.data?.get(e.id);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.full_name}</TableCell><TableCell>{m.total}</TableCell><TableCell className="text-emerald-600">{m.done}</TableCell><TableCell className="text-red-600">{m.late}</TableCell><TableCell>{m.rate}%</TableCell><TableCell>{m.recurring}</TableCell>
                      <TableCell>{existing !== undefined ? <span className="font-semibold">{existing}/100</span> : (
                        <div className="flex gap-1"><Input className="h-8 w-20" type="number" min={0} max={100} value={scores[e.id] ?? ""} onChange={(ev) => setScores((s) => ({ ...s, [e.id]: ev.target.value }))} /><Button size="sm" variant="outline" onClick={() => submit(e.id)}>حفظ</Button></div>
                      )}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </State>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-2 md:grid-cols-5"><Stat label="عدد المهام" value={own.total} /><Stat label="المكتملة" value={own.done} tone="text-emerald-600" /><Stat label="المتأخرة" value={own.late} tone="text-red-600" /><Stat label="نسبة الإنجاز %" value={own.rate} /><Stat label="المتكررة المنجزة" value={own.recurring} /></div>
        )}
      </State>
    </Section>
  );
}

function EmployeePicker({ emps, deptId, selected, setSelected, all, setAll }: { emps: Emp[]; deptId: string; selected: string[]; setSelected: (v: string[]) => void; all: boolean; setAll: (v: boolean) => void }) {
  const list = emps.filter((e) => e.department_id === deptId);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-semibold"><Checkbox checked={all} onCheckedChange={(v) => setAll(v === true)} /> جميع موظفي القسم ({list.length})</label>
      {!all && (
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
          {list.length ? list.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm"><Checkbox checked={selected.includes(e.id)} onCheckedChange={(v) => setSelected(v === true ? [...selected, e.id] : selected.filter((x) => x !== e.id))} /> {e.full_name}</label>
          )) : <p className="text-xs text-muted-foreground">لا يوجد موظفون نشطون في هذا القسم.</p>}
        </div>
      )}
    </div>
  );
}

function CreateTaskDialog({ open, onOpenChange, depts, emps, uid, today, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; depts: Dept[]; emps: Emp[]; uid: string; today: string; onDone: () => void }) {
  const [f, setF] = useState({ title: "", description: "", type: "one_time", priority: "normal", dept: "", start: today, due: "", notes: "", monthDay: "" });
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
    setSaving(true);
    try {
      if (f.type === "one_time") {
        const { error } = await supabase.from("employee_tasks").insert(targets.map((employee_id) => ({
          employee_id, department_id: dept, task_date: f.start, start_date: f.start, due_date: f.due || null, title: f.title.trim(), description: f.description.trim() || null,
          manager_note: f.notes.trim() || null, status: "not_started", duration_minutes: 0, created_by: uid, task_type: "one_time", priority: f.priority,
        })));
        if (error) throw error;
      } else {
        const desc = [f.description.trim(), f.notes.trim() ? `ملاحظات: ${f.notes.trim()}` : ""].filter(Boolean).join("\n") || null;
        const { error } = await supabase.from("team_task_templates").insert({
          department_id: dept, title: f.title.trim(), description: desc, task_type: "recurring", priority: f.priority, recurrence_rule: f.type,
          start_date: f.start, end_date: f.due || null, assignee_employee_ids: all ? [] : targets, active: true, created_by: uid,
          weekdays: f.type === "weekly" ? weekdays : null, month_day: f.type === "monthly" && f.monthDay ? Number(f.monthDay) : null,
        });
        if (error) throw error;
        const g = await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
        if (g.error) throw g.error;
      }
      toast.success("تم إنشاء المهمة");
      onDone();
      onOpenChange(false);
      setF({ title: "", description: "", type: "one_time", priority: "normal", dept: "", start: today, due: "", notes: "", monthDay: "" });
      setSelected([]); setAll(false); setWeekdays([]);
    } catch (e) { toast.error(`تعذر الإنشاء: ${errText(e)}`); } finally { setSaving(false); }
  };
  const recurring = f.type !== "one_time";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>إنشاء مهمة</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>عنوان المهمة</Label><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>وصف المهمة</Label><Textarea value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
          <div><Label>نوع المهمة</Label><Select value={f.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["one_time", "daily", "weekly", "monthly"].map((k) => <SelectItem key={k} value={k}>{k === "one_time" ? "مهمة لمرة واحدة" : `مهمة ${TYPES[k]}`}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>الأولوية</Label><Select value={f.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          {f.type === "weekly" && (
            <div className="sm:col-span-2"><Label>أيام الأسبوع</Label><div className="mt-1 flex flex-wrap gap-3">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><Checkbox checked={weekdays.includes(i)} onCheckedChange={(v) => setWeekdays(v === true ? [...weekdays, i] : weekdays.filter((x) => x !== i))} /> {d}</label>)}</div></div>
          )}
          {f.type === "monthly" && <div><Label>يوم الشهر</Label><Input type="number" min={1} max={31} value={f.monthDay} placeholder={String(Number(f.start.slice(8, 10)))} onChange={(e) => set("monthDay", e.target.value)} /></div>}
          <div><Label>تاريخ البداية</Label><Input type="date" value={f.start} onChange={(e) => set("start", e.target.value)} /></div>
          <div><Label>{recurring ? "الموعد النهائي (نهاية التكرار)" : "الموعد النهائي"}</Label><Input type="date" value={f.due} onChange={(e) => set("due", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label>القسم</Label><Select value={dept} onValueChange={(v) => { set("dept", v); setSelected([]); }}><SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger><SelectContent>{depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="sm:col-span-2"><Label>الموظف المسؤول</Label><EmployeePicker emps={emps} deptId={dept} selected={selected} setSelected={setSelected} all={all} setAll={setAll} /></div>
          <div className="sm:col-span-2"><Label>ملاحظات</Label><Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendGuidanceDialog({ open, onOpenChange, depts, emps, uid, today, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; depts: Dept[]; emps: Emp[]; uid: string; today: string; onDone: () => void }) {
  const [deptSel, setDept] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const dept = deptSel || depts[0]?.id || "";
  const send = async () => {
    if (title.trim().length < 2 || !content.trim()) return toast.error("أدخل العنوان والنص");
    const targets = all ? emps.filter((e) => e.department_id === dept).map((e) => e.id) : selected;
    if (!targets.length) return toast.error("اختر مستلماً واحداً على الأقل");
    setSaving(true);
    try {
      const resolved = await Promise.all(targets.map(async (id) => { const { data, error } = await supabase.rpc("employee_user_id", { _employee_id: id }); if (error) throw error; return { id, user: data as string | null }; }));
      const ok = resolved.filter((r) => r.user);
      const missing = resolved.filter((r) => !r.user).map((r) => emps.find((e) => e.id === r.id)?.full_name ?? "");
      if (!ok.length) throw new Error("لا يملك أي من المستلمين حساباً مرتبطاً في النظام");
      const { error } = await supabase.from("employee_guidance_notes").insert(ok.map((r) => ({ department_id: dept, target_user_id: r.user!, target_employee_id: r.id, title: title.trim(), content: content.trim(), guidance_date: today, author_id: uid })));
      if (error) throw error;
      toast.success(`تم إرسال التوجيه إلى ${ok.length} موظف`);
      if (missing.length) toast.warning(`لم يُرسل إلى (لا يوجد حساب مرتبط): ${missing.join("، ")}`);
      onDone();
      onOpenChange(false);
      setTitle(""); setContent(""); setSelected([]); setAll(false);
    } catch (e) { toast.error(`تعذر الإرسال: ${errText(e)}`); } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>إرسال توجيه</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>القسم</Label><Select value={dept} onValueChange={(v) => { setDept(v); setSelected([]); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{depts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>المستلم</Label><EmployeePicker emps={emps} deptId={dept} selected={selected} setSelected={setSelected} all={all} setAll={setAll} /></div>
          <div><Label>العنوان</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>النص</Label><Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={send} disabled={saving}>{saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} إرسال</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTaskDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: task.title, description: task.description ?? "", priority: task.priority, due: task.due_date ?? "", status: ALLOWED_STATUSES.includes(task.status) ? task.status : "needs_follow_up", note: task.manager_note ?? "" });
  const [scope, setScope] = useState<"one" | "future">("one");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (f.title.trim().length < 2) return toast.error("أدخل عنوان المهمة");
    setSaving(true);
    try {
      const patch: Database["public"]["Tables"]["employee_tasks"]["Update"] = { title: f.title.trim(), description: f.description.trim() || null, priority: f.priority, due_date: f.due || null, status: f.status, manager_note: f.note.trim() || null };
      if (f.status === "completed" && !task.completed_at) patch.completed_at = new Date().toISOString();
      const { error } = await supabase.from("employee_tasks").update(patch).eq("id", task.id);
      if (error) throw error;
      if (scope === "future" && task.template_id) {
        const t1 = await supabase.from("team_task_templates").update({ title: patch.title!, description: patch.description, priority: f.priority }).eq("id", task.template_id);
        if (t1.error) throw t1.error;
        const t2 = await supabase.from("employee_tasks").update({ title: patch.title!, description: patch.description, priority: f.priority }).eq("template_id", task.template_id).gt("task_date", task.task_date).eq("status", "not_started");
        if (t2.error) throw t2.error;
      }
      toast.success("تم حفظ التعديل");
      onDone();
      onClose();
    } catch (e) { toast.error(`تعذر الحفظ: ${errText(e)}`); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader><DialogTitle>تعديل المهمة</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>العنوان</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>الوصف</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div><Label>الأولوية</Label><Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORITIES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>الحالة</Label><Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ALLOWED_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>الموعد النهائي</Label><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>ملاحظة المدير</Label><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          {task.template_id && (
            <div className="sm:col-span-2 space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={scope === "one"} onChange={() => setScope("one")} /> تعديل هذا التنفيذ فقط</label>
              <label className="flex items-center gap-2"><input type="radio" checked={scope === "future"} onChange={() => setScope("future")} /> تعديل هذا التنفيذ وجميع التنفيذات المستقبلية</label>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("employee_tasks").update({ status: "completed", completed_at: new Date().toISOString(), completion_note: note.trim() || null }).eq("id", task.id);
      if (error) throw error;
      toast.success("تم تسجيل الإنجاز");
      onDone();
      onClose();
    } catch (e) { toast.error(`تعذر التسجيل: ${errText(e)}`); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>تم الإنجاز — {task.title}</DialogTitle></DialogHeader>
        <Label>ملاحظة الإنجاز (اختيارية)</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter><Button onClick={save} disabled={saving}>تأكيد الإنجاز</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTemplateDialog({ tp, today, onClose, onDone }: { tp: Template; today: string; onClose: () => void; onDone: () => void }) {
  const rule = ["daily", "weekly", "monthly"].includes(tp.recurrence_rule) ? tp.recurrence_rule : "daily";
  const [f, setF] = useState({ rule, end: tp.end_date ?? "", monthDay: tp.month_day ? String(tp.month_day) : "" });
  const [weekdays, setWeekdays] = useState<number[]>(tp.weekdays ?? []);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (f.rule === "weekly" && !weekdays.length) return toast.error("اختر أيام الأسبوع");
    setSaving(true);
    try {
      const { error } = await supabase.from("team_task_templates").update({ recurrence_rule: f.rule, end_date: f.end || null, weekdays: f.rule === "weekly" ? weekdays : null, month_day: f.rule === "monthly" && f.monthDay ? Number(f.monthDay) : null }).eq("id", tp.id);
      if (error) throw error;
      const d = await supabase.from("employee_tasks").delete().eq("template_id", tp.id).eq("task_date", today).eq("status", "not_started");
      if (d.error) throw d.error;
      const g = await supabase.rpc("generate_recurring_tasks", { _from: today, _to: today });
      if (g.error) throw g.error;
      toast.success("تم تعديل الجدول وتحديث مهمة اليوم؛ سيُنشأ تنفيذ جديد في يوم التكرار التالي");
      onDone();
      onClose();
    } catch (e) { toast.error(`تعذر الحفظ: ${errText(e)}`); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>تعديل جدول: {tp.title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>التكرار</Label><Select value={f.rule} onValueChange={(v) => setF({ ...f, rule: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">يومي</SelectItem><SelectItem value="weekly">أسبوعي</SelectItem><SelectItem value="monthly">شهري</SelectItem></SelectContent></Select></div>
          {f.rule === "weekly" && <div className="flex flex-wrap gap-3">{WEEKDAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><Checkbox checked={weekdays.includes(i)} onCheckedChange={(v) => setWeekdays(v === true ? [...weekdays, i] : weekdays.filter((x) => x !== i))} /> {d}</label>)}</div>}
          {f.rule === "monthly" && <div><Label>يوم الشهر</Label><Input type="number" min={1} max={31} value={f.monthDay} onChange={(e) => setF({ ...f, monthDay: e.target.value })} /></div>}
          <div><Label>تاريخ النهاية</Label><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          <p className="text-xs text-muted-foreground">تُنشأ مهمة اليوم فقط، ويُنشأ سجل جديد تلقائياً في كل يوم تكرار قادم.</p>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ emp, rows, notes, today, onClose, render }: { emp: Emp; rows: { t: Task; s: string }[]; notes: Guidance[]; today: string; onClose: () => void; render: (r: { t: Task; s: string }[], showEmp?: boolean) => React.ReactNode }) {
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
        <DialogHeader><DialogTitle>سجل {emp.full_name}{emp.position ? ` — ${emp.position}` : ""}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="إجمالي المهام" value={rows.length} /><Stat label="المكتملة" value={done} tone="text-emerald-600" /><Stat label="المتأخرة" value={rows.filter((x) => x.s === "overdue").length} tone="text-red-600" /><Stat label="نسبة الإنجاز %" value={rows.length ? Math.round((done / rows.length) * 100) : 0} /></div>
        {groups.map(([title, list]) => <Section key={title} title={`${title} (${list.length})`}><State empty={!list.length}>{render(list, false)}</State></Section>)}
        <Section title={`التوجيهات (${myNotes.length})`}>
          <State empty={!myNotes.length}>
            <div className="divide-y">{myNotes.map((n) => <div key={n.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><div><span className="font-semibold">{n.title}</span> — {n.content}</div><span className={n.read_at ? "text-emerald-600" : "text-orange-600"}>{n.read_at ? "مقروء" : "غير مقروء"}</span></div>)}</div>
          </State>
        </Section>
        <Section title="ملاحظات المدير">
          <State empty={!managerNotes.length}><div className="divide-y">{managerNotes.map(({ t }) => <div key={t.id} className="px-3 py-2 text-sm"><span className="text-muted-foreground">{t.task_date} · {t.title}:</span> {t.manager_note}</div>)}</div></State>
        </Section>
      </DialogContent>
    </Dialog>
  );
}

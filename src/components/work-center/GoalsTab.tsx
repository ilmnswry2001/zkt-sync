import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { workCenterDb, type EmployeeGoal, type EmployeeGoalEvent, type EmployeeGoalStep, type EmployeeGoalUpdate } from "@/lib/work-center-db";
import { todayInBaghdad } from "@/lib/date-time";
import { formatErrorMessage } from "@/lib/error-message";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Employee = { id: string; full_name: string; department_id: string | null };
type Department = { id: string; name: string };
type LinkedTask = { id: string; goal_id: string | null; title: string; status: string; due_date: string | null };
const STATUS: Record<string, string> = {
  draft: "مسودة", pending_review: "بانتظار المراجعة", needs_changes: "بحاجة إلى تعديل",
  rejected: "مرفوض", approved: "معتمد ولم يبدأ", in_progress: "قيد التنفيذ",
  at_risk: "متعثر", completed_pending_review: "مكتمل بانتظار التقييم", completed: "مكتمل ومعتمد",
  incomplete: "غير مكتمل", cancelled: "ملغى", postponed: "مؤجل",
};
const EVENT_LABEL: Record<string, string> = { created: "إنشاء الهدف", proposed: "اقتراح هدف", updated: "تعديل الهدف", approved: "اعتماد الهدف", pending_review: "بانتظار المراجعة", needs_changes: "طلب تعديل", rejected: "رفض الاقتراح", completed: "اعتماد الإنجاز", at_risk: "تسجيل التعثر", incomplete: "تسجيل عدم الاكتمال", postponed: "تأجيل الهدف", cancelled: "إلغاء الهدف", step_insert: "إضافة مرحلة", step_update: "تحديث مرحلة", step_delete: "حذف مرحلة" };
const TERMINAL = new Set(["rejected", "completed", "incomplete", "cancelled"]);
const CATEGORIES = ["تطوير مهني", "تعلم لغة", "تطوير مهارة تقنية", "تحسين الأداء", "إنجاز مشروع", "هدف مخصص"];
const METHODS = ["مرحلي", "رقمي", "دوري", "مخرجات", "تقييم المدير"];
const emptyForm = {
  title: "", description: "", desired_result: "", category: "هدف مخصص", start_date: todayInBaghdad(),
  due_date: "", priority: "normal", success_metric: "", target_value: "", current_value: "", unit: "",
  tracking_frequency: "weekly", action_plan: "", support_needed: "", manager_note: "", proposal_reason: "",
  reminder_days_before: "3", reminders_enabled: true,
};

export function GoalsTab({ uid, employeeId, employees, departments, isManager, scopeIds }: {
  uid: string; employeeId: string | null; employees: Employee[]; departments: Department[];
  isManager: boolean; scopeIds: string[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [targetEmployee, setTargetEmployee] = useState("");
  const [targetEmployees, setTargetEmployees] = useState<string[]>([]);
  const [methods, setMethods] = useState<string[]>(["دوري"]);
  const [showForm, setShowForm] = useState(false);
  const [editingProposal, setEditingProposal] = useState<string | null>(null);
  const [updateGoal, setUpdateGoal] = useState("");
  const [progress, setProgress] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [remaining, setRemaining] = useState("");
  const [obstacles, setObstacles] = useState("");
  const [help, setHelp] = useState("");
  const [note, setNote] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [stepGoal, setStepGoal] = useState("");
  const [stepTitle, setStepTitle] = useState("");
  const [stepDate, setStepDate] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterDepartment, setFilterDepartment] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [formFeedback, setFormFeedback] = useState("");
  const manager = isManager && scopeIds.length > 0;
  const selfEmployeeQ = useQuery({
    queryKey: ["wc-goals-self-employee", employeeId], enabled: !!employeeId && !manager,
    queryFn: async (): Promise<Employee | null> => {
      const { data, error } = await supabase.from("employees").select("id,full_name,department_id").eq("id", employeeId!).maybeSingle();
      if (error) throw error; return data;
    },
  });
  const allEmployees = useMemo(() => employeeId && selfEmployeeQ.data && !employees.some((e) => e.id === employeeId) ? [...employees, selfEmployeeQ.data] : employees, [employees, employeeId, selfEmployeeQ.data]);

  const goalsQ = useQuery({
    queryKey: ["wc-goals", uid, employeeId, scopeIds],
    enabled: !!uid,
    queryFn: async (): Promise<EmployeeGoal[]> => {
      let q = workCenterDb.from("employee_goals").select("*").order("due_date");
      if (manager) q = q.in("department_id", scopeIds);
      else if (employeeId) q = q.eq("employee_id", employeeId);
      else q = q.eq("created_by", uid);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
  const goals = goalsQ.data ?? [];
  const ids = goals.map((g) => g.id);
  const stepsQ = useQuery({
    queryKey: ["wc-goal-steps", ids], enabled: ids.length > 0,
    queryFn: async (): Promise<EmployeeGoalStep[]> => {
      const { data, error } = await workCenterDb.from("employee_goal_steps").select("*").in("goal_id", ids).order("sort_order");
      if (error) throw error; return data ?? [];
    },
  });
  const updatesQ = useQuery({
    queryKey: ["wc-goal-updates", ids], enabled: ids.length > 0,
    queryFn: async (): Promise<EmployeeGoalUpdate[]> => {
      const { data, error } = await workCenterDb.from("employee_goal_updates").select("*").in("goal_id", ids).order("created_at", { ascending: false });
      if (error) throw error; return data ?? [];
    },
  });
  const eventsQ = useQuery({
    queryKey: ["wc-goal-events", ids], enabled: ids.length > 0,
    queryFn: async (): Promise<EmployeeGoalEvent[]> => { const { data, error } = await workCenterDb.from("employee_goal_events").select("*").in("goal_id", ids).order("created_at", { ascending: false }); if (error) throw error; return data ?? []; },
  });
  const linkedTasksQ = useQuery({
    queryKey: ["wc-goal-tasks", ids], enabled: ids.length > 0,
    queryFn: async (): Promise<LinkedTask[]> => { const { data, error } = await workCenterDb.from("employee_tasks").select("id,goal_id,title,status,due_date").in("goal_id", ids); if (error) throw error; return data ?? []; },
  });
  const steps = stepsQ.data ?? [];
  const updates = updatesQ.data ?? [];
  const events = eventsQ.data ?? [];
  const linkedTasks = linkedTasksQ.data ?? [];
  const employeeById = useMemo(() => new Map(allEmployees.map((e) => [e.id, e])), [allEmployees]);
  const departmentById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["wc-goals"] });
    void qc.invalidateQueries({ queryKey: ["wc-goal-steps"] });
    void qc.invalidateQueries({ queryKey: ["wc-goal-updates"] });
    void qc.invalidateQueries({ queryKey: ["wc-goal-events"] });
    void qc.invalidateQueries({ queryKey: ["wc-goal-tasks"] });
  };
  const notificationsQ = useQuery({
    queryKey: ["wc-goal-notifications", uid], enabled: !!uid,
    queryFn: async () => { const { data, error } = await workCenterDb.from("employee_goal_notifications").select("*").order("created_at", { ascending: false }).limit(30); if (error) throw error; return data ?? []; },
  });
  const notifications = notificationsQ.data ?? [];
  const remindersQ = useQuery({
    queryKey: ["wc-goal-reminders", uid], enabled: !!uid,
    queryFn: async () => { const { data, error } = await workCenterDb.rpc("generate_employee_goal_reminders"); if (error) throw error; return data; },
  });
  useEffect(() => {
    if (remindersQ.isSuccess) void qc.invalidateQueries({ queryKey: ["wc-goal-notifications", uid] });
  }, [remindersQ.dataUpdatedAt, remindersQ.isSuccess, qc, uid]);
  const filtered = (predicate: (goal: EmployeeGoal) => boolean) => goals.filter(predicate);
  const isMyGoal = (goal: EmployeeGoal) => goal.employee_id === employeeId || (!employeeId && !manager && goal.created_by === uid);
  const departmentGoals = goals.filter((goal) => {
    if (filterEmployee !== "all" && goal.employee_id !== filterEmployee) return false;
    if (filterDepartment !== "all" && goal.department_id !== filterDepartment) return false;
    if (filterStatus !== "all" && goal.status !== filterStatus) return false;
    if (filterCategory !== "all" && goal.category !== filterCategory) return false;
    if (filterFrom && goal.due_date < filterFrom) return false;
    if (filterTo && goal.due_date > filterTo) return false;
    return true;
  });
  const progressByEmployee = employees.map((employee) => {
    const assigned = goals.filter((goal) => goal.employee_id === employee.id && !TERMINAL.has(goal.status));
    return { employee, total: assigned.length, completed: goals.filter((goal) => goal.employee_id === employee.id && goal.status === "completed").length };
  }).filter((row) => row.total || row.completed).map((row) => ({ ...row, percent: row.total + row.completed ? Math.round((row.completed / (row.total + row.completed)) * 100) : 0 }));
  const isOverdue = (g: EmployeeGoal) => g.due_date < todayInBaghdad() && ["approved", "in_progress", "at_risk"].includes(g.status);
  const risk = (g: EmployeeGoal) => g.status === "at_risk" || isOverdue(g) || (g.status === "in_progress" && g.due_date <= todayInBaghdad());

  const submitGoal = async () => {
    const fail = (message: string) => { setFormFeedback(message); toast.error(message); };
    setFormFeedback("");
    if (form.title.trim().length < 2 || !form.due_date) return fail("أدخل عنوان الهدف والموعد النهائي");
    if (form.due_date < form.start_date) return fail("الموعد النهائي يجب أن يأتي بعد تاريخ البداية");
    if (!methods.length) return fail("اختر طريقة متابعة واحدة على الأقل");
    if (form.target_value && (!Number.isFinite(Number(form.target_value)) || Number(form.target_value) <= 0)) return fail("القيمة المستهدفة يجب أن تكون رقماً موجباً");
    if (form.reminder_days_before && (Number(form.reminder_days_before) < 0 || Number(form.reminder_days_before) > 30)) return fail("مدة التذكير يجب أن تكون بين 0 و30 يوماً");
    const targetRows = manager ? targetEmployees.map((id) => employeeById.get(id)).filter((employee): employee is Employee => !!employee) : [employeeById.get(employeeId ?? "")].filter((employee): employee is Employee => !!employee);
    if (!targetRows.length || targetRows.some((employee) => !employee.department_id)) return fail("لم يتم تحديد الموظف أو القسم. اختر الموظف أولاً ثم اضغط «إضافة».");
    setSaving(true);
    const proposal = !manager;
    const record = {
      employee_id: targetRows[0].id, department_id: targetRows[0].department_id!, created_by: uid,
      title: form.title.trim(), description: form.description.trim() || null,
      desired_result: form.desired_result.trim() || null, category: form.category,
      status: proposal ? "pending_review" : "approved", start_date: form.start_date || todayInBaghdad(),
      due_date: form.due_date, priority: form.priority, success_metric: form.success_metric.trim() || null,
      target_value: form.target_value ? Number(form.target_value) : null,
      current_value: form.current_value ? Number(form.current_value) : null,
      unit: form.unit.trim() || null, tracking_methods: methods,
      tracking_frequency: form.tracking_frequency, action_plan: form.action_plan.trim() || null,
      reminder_days_before: Number(form.reminder_days_before), reminders_enabled: form.reminders_enabled,
      support_needed: form.support_needed.trim() || null, manager_note: form.manager_note.trim() || null,
      proposal_reason: proposal ? form.proposal_reason.trim() || null : null,
      proposal_original: proposal ? { ...form, tracking_methods: methods } : null,
      approved_by: proposal ? null : uid, approved_at: proposal ? null : new Date().toISOString(),
    };
    try {
      let error;
      if (editingProposal && proposal) {
        ({ error } = await workCenterDb.from("employee_goals").update({
            title: record.title, description: record.description, desired_result: record.desired_result,
            category: record.category, start_date: record.start_date, due_date: record.due_date,
            priority: record.priority, success_metric: record.success_metric, target_value: record.target_value,
            current_value: record.current_value, unit: record.unit, tracking_methods: record.tracking_methods,
            tracking_frequency: record.tracking_frequency, action_plan: record.action_plan,
            support_needed: record.support_needed, manager_note: record.manager_note,
            reminder_days_before: record.reminder_days_before, reminders_enabled: record.reminders_enabled,
            proposal_reason: record.proposal_reason, status: "pending_review",
          }).eq("id", editingProposal));
      } else if (manager) {
        ({ error } = await workCenterDb.from("employee_goals").insert(targetRows.map((employee) => ({ ...record, employee_id: employee.id, department_id: employee.department_id! }))));
      } else {
        ({ error } = await workCenterDb.from("employee_goals").insert(record));
      }
      if (error) throw error;
      toast.success(editingProposal ? "تم تحديث الاقتراح وإعادة إرساله" : proposal ? "تم إرسال اقتراح الهدف للمراجعة" : "تم إسناد الهدف للموظف");
      setFormFeedback("");
      setEditingProposal(null); setForm(emptyForm); setMethods(["دوري"]); setTargetEmployee(""); setTargetEmployees([]); setShowForm(false); refresh();
    } catch (e) {
      const message = `تعذر حفظ الهدف: ${formatErrorMessage(e)}`;
      setFormFeedback(message);
      toast.error(message);
    }
    finally { setSaving(false); }
  };

  const review = async (goal: EmployeeGoal, status: "approved" | "needs_changes" | "rejected", feedback: string, edits?: Partial<EmployeeGoal>) => {
    if ((status === "needs_changes" || status === "rejected") && !feedback.trim()) { toast.error("اكتب ملاحظة المراجعة أو سبب الرفض"); return; }
    const { error } = await workCenterDb.from("employee_goals").update({
      ...edits, status, manager_feedback: feedback.trim() || null,
      approved_by: status === "approved" ? uid : null, approved_at: status === "approved" ? new Date().toISOString() : null,
    }).eq("id", goal.id);
    if (error) { toast.error(`تعذرت مراجعة الهدف: ${formatErrorMessage(error)}`); return; }
    toast.success(status === "approved" ? "تم اعتماد الهدف" : status === "rejected" ? "تم رفض الاقتراح" : "أعيد الاقتراح للموظف للتعديل"); refresh();
  };

  const addUpdate = async () => {
    const goal = goals.find((g) => g.id === updateGoal);
    if (!goal) return;
    const amount = progress.trim() ? Number(progress) : goal.target_value && currentValue.trim() ? Math.min(100, Math.round((Number(currentValue) / goal.target_value) * 100)) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100)) return toast.error("نسبة الإنجاز يجب أن تكون بين 0 و100");
    let proofPath: string | null = null;
    if (proofFile) {
      if (proofFile.size > 20 * 1024 * 1024) return toast.error("حجم المرفق يتجاوز 20 ميغابايت");
      const safeName = proofFile.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
      proofPath = `${goal.id}/${uid}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from("goal-evidence").upload(proofPath, proofFile, { contentType: proofFile.type, upsert: false });
      if (uploadError) return toast.error(`تعذر رفع الدليل: ${formatErrorMessage(uploadError)}`);
    }
    const { error } = await workCenterDb.from("employee_goal_updates").insert({
      goal_id: goal.id, actor_id: uid, update_type: "progress", progress_percent: amount,
      current_value: currentValue.trim() ? Number(currentValue) : null,
      completed_work: workDone.trim() || null, remaining_work: remaining.trim() || null,
      obstacles: obstacles.trim() || null, help_requested: help.trim() || null, note: note.trim() || null, proof_storage_path: proofPath,
    });
    if (error) return toast.error(`تعذر تسجيل التقدم: ${formatErrorMessage(error)}`);
    const nextStatus = amount === 100 ? "completed_pending_review" : goal.status === "approved" ? "in_progress" : goal.status;
    const goalPatch: Partial<EmployeeGoal> = { status: nextStatus };
    if (currentValue.trim()) goalPatch.current_value = Number(currentValue);
    const { error: goalError } = await workCenterDb.from("employee_goals").update(goalPatch).eq("id", goal.id);
    if (goalError) toast.error(formatErrorMessage(goalError));
    else toast.success("تم حفظ تحديث التقدم في السجل");
    setUpdateGoal(""); setProgress(""); setCurrentValue(""); setProofFile(null); setWorkDone(""); setRemaining(""); setObstacles(""); setHelp(""); setNote(""); refresh();
  };

  const addStep = async (goal: EmployeeGoal) => {
    if (stepTitle.trim().length < 2) return toast.error("اكتب عنوان المرحلة");
    const { error } = await workCenterDb.from("employee_goal_steps").insert({ goal_id: goal.id, title: stepTitle.trim(), due_date: stepDate || null, created_by: uid, sort_order: steps.filter((s) => s.goal_id === goal.id).length });
    if (error) return toast.error(`تعذر إضافة المرحلة: ${formatErrorMessage(error)}`);
    setStepTitle(""); setStepDate(""); setStepGoal(""); refresh();
  };
  const setStepStatus = async (step: EmployeeGoalStep, status: string) => {
    const { error } = await workCenterDb.from("employee_goal_steps").update({ status }).eq("id", step.id);
    if (error) toast.error(`تعذر تحديث المرحلة: ${formatErrorMessage(error)}`); else refresh();
  };
  const createTask = async (goal: EmployeeGoal) => {
    const title = window.prompt("عنوان المهمة", goal.title);
    if (!title?.trim()) return;
    const description = window.prompt("وصف المهمة", goal.description ?? "");
    const dueDate = window.prompt("تاريخ الاستحقاق (YYYY-MM-DD)", goal.due_date) || goal.due_date;
    const { error } = await workCenterDb.rpc("create_employee_goal_task", {
      _goal_id: goal.id, _title: title.trim(), _description: description?.trim() || null,
      _due_date: dueDate, _priority: goal.priority,
    });
    if (error) toast.error(`تعذر ربط المهمة بالهدف: ${formatErrorMessage(error)}`); else { toast.success("تم إنشاء مهمة مرتبطة بالهدف"); void qc.invalidateQueries({ queryKey: ["wc-tasks"] }); void qc.invalidateQueries({ queryKey: ["wc-goal-tasks"] }); }
  };
  const markNotificationRead = async (id: string) => {
    const { error } = await workCenterDb.from("employee_goal_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(formatErrorMessage(error)); else void qc.invalidateQueries({ queryKey: ["wc-goal-notifications", uid] });
  };
  const addManagerComment = async (goal: EmployeeGoal, text: string) => {
    if (!text.trim()) return;
    const { error } = await workCenterDb.from("employee_goal_updates").insert({ goal_id: goal.id, actor_id: uid, update_type: "manager_comment", note: text.trim() });
    if (error) toast.error(`تعذر إضافة التعليق: ${formatErrorMessage(error)}`); else { toast.success("تمت إضافة التعليق"); refresh(); }
  };
  const changeManagerStatus = async (goal: EmployeeGoal, status: string, prompt: string) => {
    const reason = window.prompt(prompt);
    if (!reason?.trim()) return;
    const { error } = await workCenterDb.from("employee_goals").update({ status, manager_feedback: reason.trim() }).eq("id", goal.id);
    if (error) toast.error(`تعذر تحديث الحالة: ${formatErrorMessage(error)}`); else { toast.success("تم تحديث حالة الهدف"); refresh(); }
  };
  const openEvidence = async (path: string) => {
    const { data, error } = await supabase.storage.from("goal-evidence").createSignedUrl(path, 60);
    if (error) toast.error(`تعذر فتح الدليل: ${formatErrorMessage(error)}`); else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const renderGoal = (goal: EmployeeGoal, reviewMode = false, archive = false) => {
    const goalSteps = steps.filter((s) => s.goal_id === goal.id);
    const goalUpdates = updates.filter((u) => u.goal_id === goal.id);
    const goalEvents = events.filter((event) => event.goal_id === goal.id);
    const goalTasks = linkedTasks.filter((task) => task.goal_id === goal.id);
    const employee = employeeById.get(goal.employee_id);
    const myGoal = goal.employee_id === employeeId;
    const canEditProgress = myGoal && ["approved", "in_progress", "at_risk"].includes(goal.status);
    const reviewText = reviewMode && goal.status === "pending_review" ? <ReviewActions goal={goal} onReview={review} /> : null;
    return <Card key={goal.id} className={risk(goal) ? "border-amber-300" : ""}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><CardTitle className="text-base">{goal.title}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{goal.desired_result || goal.description || "لا يوجد وصف"}</p></div><Badge variant={goal.status === "rejected" ? "destructive" : goal.status === "completed" ? "default" : "secondary"}>{STATUS[goal.status] ?? goal.status}{isOverdue(goal) ? " · متأخر" : ""}</Badge></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{employee?.full_name || "الموظف"}</span><span>{departmentById.get(goal.department_id) || "القسم"}</span><span>{goal.category}</span><span>من {goal.start_date} إلى {goal.due_date}</span><span>الأولوية: {goal.priority}</span></div>
      </CardHeader>
      <CardContent className="space-y-3">
        {goal.success_metric && <p className="text-sm"><b>معيار النجاح:</b> {goal.success_metric}</p>}
        {goal.target_value !== null && <p className="text-sm"><b>القياس:</b> {goal.current_value ?? 0} / {goal.target_value} {goal.unit || ""}</p>}
        {(() => { const percent = goal.target_value && goal.current_value !== null ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100)) : goalUpdatesProgress(goalUpdates); return percent !== null ? <div><div className="mb-1 flex justify-between text-xs"><span>التقدم المسجل</span><span>{percent}%</span></div><div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div></div> : null; })()}
        {goal.manager_note && <p className="text-sm"><b>ملاحظة المدير:</b> {goal.manager_note}</p>}
        {goal.proposal_original && <details className="rounded border p-2 text-sm"><summary className="cursor-pointer">الاقتراح الأصلي</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(goal.proposal_original, null, 2)}</pre></details>}
        {goal.manager_feedback && <p className="rounded bg-muted p-2 text-sm"><b>ملاحظات المراجعة:</b> {goal.manager_feedback}</p>}
        {goal.manager_evaluation && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-900"><b>التقييم النهائي ({goal.manager_rating ?? "—"}/5):</b> {goal.manager_evaluation}</p>}
        {(goal.tracking_methods.length > 0 || goal.tracking_frequency) && <p className="text-xs text-muted-foreground">طريقة المتابعة: {goal.tracking_methods.join("، ")} · دورية التحديث: {goal.tracking_frequency}</p>}
        {goalSteps.length > 0 && <div className="space-y-1 rounded border p-2"><b className="text-sm">المراحل</b>{goalSteps.map((step) => <div key={step.id} className="flex items-center justify-between gap-2 text-sm"><span>{step.title}{step.due_date ? ` · ${step.due_date}` : ""}</span>{!archive && manager ? <Select value={step.status} onValueChange={(v) => void setStepStatus(step, v)}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_started">لم تبدأ</SelectItem><SelectItem value="in_progress">قيد التنفيذ</SelectItem><SelectItem value="completed">مكتملة</SelectItem><SelectItem value="cancelled">ملغاة</SelectItem></SelectContent></Select> : <Badge variant="outline">{step.status}</Badge>}</div>)}</div>}
        {goalTasks.length > 0 && <div className="rounded border p-2"><b className="text-sm">المهام المرتبطة</b><div className="mt-1 space-y-1">{goalTasks.map((task) => <div key={task.id} className="flex justify-between gap-2 text-sm"><span>{task.title}{task.due_date ? ` · ${task.due_date}` : ""}</span><Badge variant="outline">{task.status === "completed" ? "مكتملة" : task.status === "in_progress" ? "قيد التنفيذ" : task.status === "pending_review" ? "بانتظار المراجعة" : "لم تبدأ"}</Badge></div>)}</div></div>}
        {!archive && !reviewMode && (manager || myGoal) && !TERMINAL.has(goal.status) && <div className="flex flex-wrap gap-2">
          {goal.status === "needs_changes" && myGoal && <Button size="sm" variant="outline" onClick={() => { setEditingProposal(goal.id); setForm({ title: goal.title, description: goal.description ?? "", desired_result: goal.desired_result ?? "", category: goal.category, start_date: goal.start_date, due_date: goal.due_date, priority: goal.priority, success_metric: goal.success_metric ?? "", target_value: goal.target_value === null ? "" : String(goal.target_value), current_value: goal.current_value === null ? "" : String(goal.current_value), unit: goal.unit ?? "", tracking_frequency: goal.tracking_frequency, action_plan: goal.action_plan ?? "", support_needed: goal.support_needed ?? "", manager_note: goal.manager_note ?? "", proposal_reason: goal.proposal_reason ?? "", reminder_days_before: String(goal.reminder_days_before), reminders_enabled: goal.reminders_enabled }); setMethods(goal.tracking_methods); setShowForm(true); }}>تعديل وإعادة الإرسال</Button>}
          {canEditProgress && <Button size="sm" variant="outline" onClick={() => setUpdateGoal(updateGoal === goal.id ? "" : goal.id)}>تحديث التقدم</Button>}
          {manager && <Button size="sm" variant="outline" onClick={() => { setStepGoal(stepGoal === goal.id ? "" : goal.id); setStepTitle(""); }}>إضافة مرحلة</Button>}
          {manager && <Button size="sm" variant="outline" onClick={() => void createTask(goal)}>إنشاء مهمة مرتبطة</Button>}
          {manager && <Button size="sm" variant="outline" onClick={() => { const text = window.prompt("أدخل تعليق المدير"); if (text) void addManagerComment(goal, text); }}>تعليق المدير</Button>}
          {manager && ["approved", "in_progress"].includes(goal.status) && <Button size="sm" variant="outline" onClick={() => void changeManagerStatus(goal, "at_risk", "اذكر سبب تعثر الهدف")}>تمييز متعثر</Button>}
          {manager && ["approved", "in_progress", "at_risk"].includes(goal.status) && <Button size="sm" variant="outline" onClick={() => void changeManagerStatus(goal, "postponed", "اذكر سبب تأجيل الهدف")}>تأجيل</Button>}
          {manager && ["approved", "in_progress", "at_risk", "postponed"].includes(goal.status) && <Button size="sm" variant="destructive" onClick={() => void changeManagerStatus(goal, "cancelled", "اذكر سبب إلغاء الهدف")}>إلغاء</Button>}
          {manager && goal.status === "completed_pending_review" && <Button size="sm" onClick={() => { const score = Number(window.prompt("تقييم الإنجاز من 1 إلى 5", "5")); const evaluation = window.prompt("ملاحظات التقييم"); if (!Number.isInteger(score) || score < 1 || score > 5 || !evaluation?.trim()) return toast.error("أدخل تقييماً من 1 إلى 5 وملاحظات التقييم"); void workCenterDb.from("employee_goals").update({ status: "completed", manager_rating: score, manager_evaluation: evaluation.trim(), approved_by: uid, approved_at: new Date().toISOString() }).eq("id", goal.id).then(({ error }) => { if (error) toast.error(formatErrorMessage(error)); else { toast.success("تم اعتماد الإنجاز"); refresh(); } }); }}>تقييم واعتماد</Button>}
          {manager && risk(goal) && <Button size="sm" variant="outline" onClick={() => void changeManagerStatus(goal, "incomplete", "اكتب سبب اعتبار الهدف غير مكتمل")}>تسجيل غير مكتمل</Button>}
        </div>}
        {updateGoal === goal.id && <div className="grid gap-2 rounded border p-3 md:grid-cols-2"><div><Label>نسبة الإنجاز (٪)</Label><Input type="number" min="0" max="100" value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="0–100" /></div><div><Label>قيمة القياس الحالية</Label><Input type="number" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} /></div><div><Label>ما أُنجز</Label><Textarea value={workDone} onChange={(e) => setWorkDone(e.target.value)} /></div><div><Label>المتبقي</Label><Textarea value={remaining} onChange={(e) => setRemaining(e.target.value)} /></div><div><Label>المعوقات</Label><Textarea value={obstacles} onChange={(e) => setObstacles(e.target.value)} /></div><div><Label>المساعدة المطلوبة</Label><Textarea value={help} onChange={(e) => setHelp(e.target.value)} /></div><div className="md:col-span-2"><Label>ملاحظات</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /><Input className="mt-2" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/plain" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} /></div><Button className="md:col-span-2" onClick={() => void addUpdate()}>حفظ التحديث</Button></div>}
        {stepGoal === goal.id && <div className="flex flex-wrap items-end gap-2 rounded border p-3"><div className="min-w-48 flex-1"><Label>المرحلة</Label><Input value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} /></div><div><Label>موعد المرحلة</Label><Input type="date" value={stepDate} onChange={(e) => setStepDate(e.target.value)} /></div><Button onClick={() => void addStep(goal)}>حفظ المرحلة</Button></div>}
        {goalUpdates.length > 0 && <details className="rounded border p-2"><summary className="cursor-pointer text-sm font-medium">سجل التقدم والتعليقات ({goalUpdates.length})</summary><div className="mt-2 space-y-2">{goalUpdates.map((u) => <div key={u.id} className="rounded bg-muted/50 p-2 text-sm"><div className="flex justify-between text-xs text-muted-foreground"><span>{u.update_type === "manager_comment" ? "تعليق المدير" : "تحديث تقدم"}</span><time>{new Date(u.created_at).toLocaleString("ar-IQ")}</time></div>{u.progress_percent !== null && <p>الإنجاز: {u.progress_percent}%</p>}{u.current_value !== null && <p>القيمة الحالية: {u.current_value}</p>}{u.completed_work && <p>أُنجز: {u.completed_work}</p>}{u.remaining_work && <p>متبقي: {u.remaining_work}</p>}{u.obstacles && <p>معوقات: {u.obstacles}</p>}{u.help_requested && <p>مطلوب: {u.help_requested}</p>}{u.note && <p>{u.note}</p>}{u.proof_storage_path && <Button size="sm" variant="link" onClick={() => void openEvidence(u.proof_storage_path!)}>فتح دليل الإنجاز</Button>}</div>)}</div></details>}
        {goalEvents.length > 0 && <details className="rounded border p-2"><summary className="cursor-pointer text-sm font-medium">سجل التعديلات والاعتماد ({goalEvents.length})</summary><div className="mt-2 space-y-1">{goalEvents.map((event) => <div key={event.id} className="rounded bg-muted/40 p-2 text-xs"><div className="flex justify-between"><span>{EVENT_LABEL[event.event_type] || STATUS[event.event_type] || event.event_type}</span><time>{new Date(event.created_at).toLocaleString("ar-IQ")}</time></div>{event.reason && <p>{event.reason}</p>}{event.old_values && event.new_values && <details className="mt-1"><summary className="cursor-pointer">عرض القيم السابقة والجديدة</summary><pre className="mt-1 whitespace-pre-wrap">قبل: {JSON.stringify(event.old_values, null, 2)}{"\n"}بعد: {JSON.stringify(event.new_values, null, 2)}</pre></details>}</div>)}</div></details>}
        {reviewText}
      </CardContent>
    </Card>;
  };

  return <div className="space-y-4" dir="rtl">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Metric label="إجمالي الأهداف" value={goals.length} /><Metric label="بانتظار الاعتماد" value={goals.filter((g) => g.status === "pending_review").length} /><Metric label="قيد التنفيذ" value={goals.filter((g) => ["approved", "in_progress"].includes(g.status)).length} /><Metric label="مكتملة" value={goals.filter((g) => g.status === "completed").length} /><Metric label="متأخرة / متعثرة" value={goals.filter((g) => risk(g)).length} /></div>
    {notifications.length > 0 && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">إشعارات الأهداف ({notifications.filter((n) => !n.read_at).length} غير مقروءة)</CardTitle></CardHeader><CardContent className="space-y-2">{notifications.slice(0,5).map((n) => <div key={n.id} className="flex items-start justify-between gap-2 rounded border p-2"><div><p className="text-sm font-medium">{n.title}</p><p className="text-xs text-muted-foreground">{n.body}</p></div>{!n.read_at && <Button size="sm" variant="ghost" onClick={() => void markNotificationRead(n.id)}>قراءة</Button>}</div>)}</CardContent></Card>}
    <Tabs defaultValue="mine" dir="rtl"><TabsList className="flex h-auto flex-wrap"><TabsTrigger value="mine">أهدافي</TabsTrigger>{manager && <TabsTrigger value="department">أهداف القسم</TabsTrigger>}{manager && <TabsTrigger value="approvals">طلبات الاعتماد</TabsTrigger>}<TabsTrigger value="progress">متابعة الإنجاز</TabsTrigger><TabsTrigger value="history">سجل الأهداف</TabsTrigger></TabsList>
      <TabsContent value="mine" className="space-y-3"><div className="flex justify-between gap-3"><h3 className="font-semibold">الأهداف المسندة والمقترحة</h3><Button type="button" onClick={() => { setEditingProposal(null); setFormFeedback(""); setTargetEmployees([]); setForm({ ...emptyForm, start_date: todayInBaghdad() }); setShowForm(!showForm); }}>{manager ? "إنشاء هدف" : "اقتراح هدف جديد"}</Button></div>{showForm && <GoalForm manager={manager && !editingProposal} employees={employees.filter((e) => scopeIds.includes(e.department_id ?? "") && e.id !== employeeId)} departments={departments} targetEmployee={targetEmployee} setTargetEmployee={setTargetEmployee} targetEmployees={targetEmployees} setTargetEmployees={setTargetEmployees} form={form} setForm={setForm} methods={methods} setMethods={setMethods} saving={saving} feedback={formFeedback} onSubmit={submitGoal} onCancel={() => { setShowForm(false); setEditingProposal(null); }} />}{goalsQ.isLoading ? <div className="p-6 text-center">جارٍ تحميل الأهداف…</div> : filtered((g) => isMyGoal(g) && !TERMINAL.has(g.status)).map((g) => renderGoal(g))}{!goalsQ.isLoading && !filtered((g) => isMyGoal(g) && !TERMINAL.has(g.status)).length && <Empty text="لا توجد أهداف حالية. يمكنك اقتراح هدف جديد." />}</TabsContent>
      {manager && <TabsContent value="department" className="space-y-3"><Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"><div><Label>الموظف</Label><Select value={filterEmployee} onValueChange={setFilterEmployee}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">جميع الموظفين</SelectItem>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select></div><div><Label>القسم</Label><Select value={filterDepartment} onValueChange={setFilterDepartment}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">جميع الأقسام</SelectItem>{departments.filter((d) => scopeIds.includes(d.id)).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></div><div><Label>الحالة</Label><Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">جميع الحالات</SelectItem>{Object.entries(STATUS).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>التصنيف</Label><Select value={filterCategory} onValueChange={setFilterCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">جميع التصنيفات</SelectItem>{CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></div><div><Label>من تاريخ الاستحقاق</Label><Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} /></div><div><Label>إلى تاريخ الاستحقاق</Label><Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} /></div></CardContent></Card>{progressByEmployee.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{progressByEmployee.map(({ employee, total, completed, percent }) => <div key={employee.id} className="rounded-lg border p-3 text-sm"><b>{employee.full_name}</b><p className="text-muted-foreground">نسبة الأهداف المعتمدة المكتملة: {percent}% · جارية: {total} · مكتملة: {completed}</p></div>)}</div>}{departmentGoals.map((g) => renderGoal(g))}{!departmentGoals.length && <Empty text="لا توجد أهداف مطابقة لعوامل التصفية." />}</TabsContent>}
      {manager && <TabsContent value="approvals" className="space-y-3">{goals.filter((g) => g.status === "pending_review" || g.status === "completed_pending_review").map((g) => renderGoal(g, g.status === "pending_review"))}{!goals.some((g) => g.status === "pending_review" || g.status === "completed_pending_review") && <Empty text="لا توجد طلبات اعتماد معلقة." />}</TabsContent>}
      <TabsContent value="progress" className="space-y-3">{goals.filter((g) => risk(g) || ["in_progress", "completed_pending_review"].includes(g.status)).map((g) => renderGoal(g))}{!goals.some((g) => risk(g) || ["in_progress", "completed_pending_review"].includes(g.status)) && <Empty text="لا توجد أهداف متعثرة أو تحتاج إلى متابعة." />}</TabsContent>
      <TabsContent value="history" className="space-y-3">{goals.filter((g) => TERMINAL.has(g.status)).map((g) => renderGoal(g, false, true))}{!goals.some((g) => TERMINAL.has(g.status)) && <Empty text="لا يوجد سجل أهداف مكتمل أو مؤرشف." />}</TabsContent>
    </Tabs>
  </div>;
}

function GoalForm({ manager, employees, departments, targetEmployee, setTargetEmployee, targetEmployees, setTargetEmployees, form, setForm, methods, setMethods, saving, feedback, onSubmit, onCancel }: any) {
  return <Card><CardHeader><CardTitle>{manager ? "إسناد هدف لموظف" : "اقتراح هدف جديد"}</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
    {manager && <div className="space-y-2"><Label>الموظف أو الموظفون المستهدفون</Label><div className="flex gap-2"><Select value={targetEmployee} onValueChange={setTargetEmployee}><SelectTrigger><SelectValue placeholder="اختر موظفاً لإضافته" /></SelectTrigger><SelectContent>{employees.filter((e: Employee) => !targetEmployees.includes(e.id)).map((e: Employee) => <SelectItem key={e.id} value={e.id}>{e.full_name} · {departments.find((d: Department) => d.id === e.department_id)?.name || ""}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" onClick={() => { if (targetEmployee) { setTargetEmployees([...targetEmployees, targetEmployee]); setTargetEmployee(""); } }}>إضافة</Button></div><div className="flex flex-wrap gap-1">{targetEmployees.map((id: string) => <Button key={id} type="button" size="sm" variant="secondary" onClick={() => setTargetEmployees(targetEmployees.filter((item: string) => item !== id))}>{employees.find((e: Employee) => e.id === id)?.full_name} ×</Button>)}</div><p className="text-xs text-muted-foreground">عند اختيار عدة موظفين، ينشئ النظام سجلاً وتقدماً مستقلين لكل موظف.</p></div>}
    <div><Label>عنوان الهدف</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
    {!manager && <div><Label>سبب اقتراح الهدف وأهميته</Label><Input value={form.proposal_reason} onChange={(e) => setForm({ ...form, proposal_reason: e.target.value })} /></div>}
    <div><Label>تصنيف الهدف</Label><Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>الأولوية</Label><Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[["low","منخفضة"],["normal","عادية"],["high","عالية"],["urgent","عاجلة"]].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>تاريخ البداية</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div><div><Label>الموعد النهائي</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
    <div><Label>النتيجة المطلوبة</Label><Textarea value={form.desired_result} onChange={(e) => setForm({ ...form, desired_result: e.target.value })} /></div><div><Label>الوصف</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
    <div><Label>معيار النجاح ومؤشر القياس</Label><Textarea value={form.success_metric} onChange={(e) => setForm({ ...form, success_metric: e.target.value })} /></div><div><Label>خطة العمل والخطوات</Label><Textarea value={form.action_plan} onChange={(e) => setForm({ ...form, action_plan: e.target.value })} /></div>
    <div><Label>القيمة المستهدفة (اختياري)</Label><Input type="number" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} /></div><div><Label>القيمة الحالية / الوحدة</Label><div className="flex gap-2"><Input type="number" value={form.current_value} onChange={(e) => setForm({ ...form, current_value: e.target.value })} /><Input placeholder="الوحدة" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div></div>
    <div><Label>دورية المتابعة</Label><Select value={form.tracking_frequency} onValueChange={(v) => setForm({ ...form, tracking_frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[["daily","يومي"],["weekly","أسبوعي"],["monthly","شهري"],["custom","حسب الاتفاق"]].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
    <div><Label>طرق التتبع (يمكن اختيار أكثر من طريقة)</Label><div className="mt-2 flex flex-wrap gap-2">{METHODS.map((m) => <Button key={m} type="button" size="sm" variant={methods.includes(m) ? "default" : "outline"} onClick={() => setMethods(methods.includes(m) ? methods.filter((v: string) => v !== m) : [...methods, m])}>{m}</Button>)}</div></div>
    <div><Label>التدريب أو الدعم المطلوب</Label><Textarea value={form.support_needed} onChange={(e) => setForm({ ...form, support_needed: e.target.value })} /></div><div><Label>{manager ? "تعليمات المدير" : "ملاحظات إضافية"}</Label><Textarea value={form.manager_note} onChange={(e) => setForm({ ...form, manager_note: e.target.value })} /></div>
    <div><Label>تذكير قبل الموعد (أيام)</Label><Input type="number" min="0" max="30" value={form.reminder_days_before} onChange={(e) => setForm({ ...form, reminder_days_before: e.target.value })} /></div><div className="flex items-center gap-2"><input id="goal-reminders" type="checkbox" checked={form.reminders_enabled} onChange={(e) => setForm({ ...form, reminders_enabled: e.target.checked })} /><Label htmlFor="goal-reminders">تفعيل إشعارات الموعد والتأخر</Label></div>
    {feedback && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive md:col-span-2">{feedback}</div>}
    <div className="flex gap-2 md:col-span-2"><Button type="button" disabled={saving} onClick={() => { void onSubmit(); }}>{saving ? "جارٍ الحفظ…" : manager ? "إسناد الهدف" : "إرسال الاقتراح"}</Button><Button type="button" variant="outline" onClick={onCancel}>إلغاء</Button></div>
  </CardContent></Card>;
}

function ReviewActions({ goal, onReview }: { goal: EmployeeGoal; onReview: (g: EmployeeGoal, status: "approved"|"needs_changes"|"rejected", feedback: string, edits?: Partial<EmployeeGoal>) => Promise<void> }) {
  const [feedback, setFeedback] = useState(""); const [title, setTitle] = useState(goal.title); const [description, setDescription] = useState(goal.description ?? ""); const [result, setResult] = useState(goal.desired_result ?? ""); const [dueDate, setDueDate] = useState(goal.due_date); const [metric, setMetric] = useState(goal.success_metric || ""); const [plan, setPlan] = useState(goal.action_plan ?? ""); const [support, setSupport] = useState(goal.support_needed ?? ""); const [priority, setPriority] = useState(goal.priority); const [target, setTarget] = useState(goal.target_value === null ? "" : String(goal.target_value)); const [frequency, setFrequency] = useState(goal.tracking_frequency);
  return <div className="space-y-2 rounded border border-primary/20 p-3"><p className="text-sm font-semibold">مراجعة الاقتراح وتعديله قبل الاعتماد</p><div className="grid gap-2 md:grid-cols-2"><div><Label>العنوان المعتمد</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div><div><Label>الموعد النهائي</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div><div><Label>النتيجة المطلوبة</Label><Textarea value={result} onChange={(e) => setResult(e.target.value)} /></div><div><Label>الوصف</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div><div><Label>معيار النجاح</Label><Textarea value={metric} onChange={(e) => setMetric(e.target.value)} /></div><div><Label>خطة العمل</Label><Textarea value={plan} onChange={(e) => setPlan(e.target.value)} /></div><div><Label>التدريب أو الدعم</Label><Textarea value={support} onChange={(e) => setSupport(e.target.value)} /></div><div><Label>الأولوية</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">منخفضة</SelectItem><SelectItem value="normal">عادية</SelectItem><SelectItem value="high">عالية</SelectItem><SelectItem value="urgent">عاجلة</SelectItem></SelectContent></Select></div><div><Label>القيمة المستهدفة</Label><Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></div><div><Label>دورية التحديث</Label><Select value={frequency} onValueChange={setFrequency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">يومي</SelectItem><SelectItem value="weekly">أسبوعي</SelectItem><SelectItem value="monthly">شهري</SelectItem></SelectContent></Select></div></div><div><Label>ملاحظات للموظف / سبب الرفض أو التعديل</Label><Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} /></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void onReview(goal,"approved",feedback,{title:title.trim(),description:description||null,desired_result:result||null,due_date:dueDate,success_metric:metric||null,action_plan:plan||null,support_needed:support||null,priority,target_value:target ? Number(target) : null,tracking_frequency:frequency})}>اعتماد الهدف</Button><Button size="sm" variant="outline" onClick={() => void onReview(goal,"needs_changes",feedback)}>طلب تعديل</Button><Button size="sm" variant="destructive" onClick={() => void onReview(goal,"rejected",feedback)}>رفض الاقتراح</Button></div></div>;
}
function Metric({ label, value }: { label: string; value: number }) { return <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>; }
function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>; }
function goalUpdatesProgress(updates: EmployeeGoalUpdate[]): number | null {
  return updates.find((update) => update.update_type === "progress" && update.progress_percent !== null)?.progress_percent ?? null;
}

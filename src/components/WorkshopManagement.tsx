import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { formatErrorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  GripVertical,
  ArrowUp,
  ArrowDown,
  Pencil,
  Plus,
  Building2,
  UsersRound,
  HardHat,
  Archive,
  RotateCcw,
} from "lucide-react";
import { WorkshopRoster, WorkshopSitePicker } from "@/components/WorkshopManagementFields";
import {
  reorderWorkshopIds,
  workshopPeriodDays,
  workshopSiteLabel,
  type WorkshopSiteOption,
} from "@/lib/workshop-management";
import { toast } from "sonner";

type Workshop = {
  id: string;
  name: string;
  is_active: boolean;
  home_site_id: string | null;
  supervisor_name: string;
  specialty: string;
  description: string;
  sort_order: number;
};
type Report = {
  id: string;
  workshop_id: string;
  work_site_id: string | null;
  work_activity: string;
};
type Line = {
  report_id: string;
  employee_id: string | null;
  attended: boolean;
  site_id: string | null;
};
const db = supabase as any;

const blank = { name: "", home_site_id: "", supervisor_name: "", specialty: "", description: "" };

// Read full collections, including sites with more than Supabase's default page size.
async function pages(table: string, columns: string, filter?: [string, string | boolean]) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let request = db
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + 999);
    if (filter) request = request.eq(...filter);
    const { data, error } = await request;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export function WorkshopManagement({
  date: controlledDate,
  onDateChange,
  siteId,
  onSelect,
}: {
  date?: string;
  onDateChange?: (date: string) => void;
  siteId?: string;
  onSelect?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [localDate, setLocalDate] = useState(todayInBaghdad());
  const date = controlledDate ?? localDate;
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Workshop | "new" | null>(null);
  const [form, setForm] = useState(blank);
  const [task, setTask] = useState<Workshop | null>(null);
  const [roster, setRoster] = useState<Workshop | null>(null);
  const [periodTask, setPeriodTask] = useState(false);
  const [taskStart, setTaskStart] = useState(date);
  const [taskEnd, setTaskEnd] = useState(date);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [taskSite, setTaskSite] = useState("");
  const [applyTask, setApplyTask] = useState(true);
  const [activity, setActivity] = useState("");
  const permission = useQuery({
    queryKey: ["workshop-management-permission"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", auth.user.id);
      if (error) throw error;
      return (
        data?.some((r) => ["admin", "hr", "supervisor", "data_entry"].includes(r.role)) ?? false
      );
    },
  });
  const query = useQuery({
    queryKey: ["workshop-management", date],
    queryFn: async () => {
      const [workshops, sites, members, reports] = await Promise.all([
        pages(
          "daily_workshops",
          "id,name,is_active,home_site_id,supervisor_name,specialty,description,sort_order",
        ),
        pages("sites", "id,name,ctr_code"),
        pages(
          "daily_workshop_members",
          "id,workshop_id,employee_id,role_label,employees(full_name,employee_no)",
          ["is_active", true],
        ),
        pages("daily_workshop_reports", "id,workshop_id,work_site_id,work_activity", [
          "report_date",
          date,
        ]),
      ]);
      const lines: Line[] = [];
      for (let i = 0; i < reports.length; i += 100) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db
            .from("daily_workshop_report_lines")
            .select("id,report_id,employee_id,attended,site_id")
            .in(
              "report_id",
              reports.slice(i, i + 100).map((r) => r.id),
            )
            .order("id")
            .range(from, from + 999);
          if (error) throw error;
          lines.push(...data);
          if (data.length < 1000) break;
        }
      }
      return {
        workshops: workshops as Workshop[],
        sites: sites as WorkshopSiteOption[],
        members,
        reports: reports as Report[],
        lines,
      };
    },
  });
  const data = query.data;
  const invalidate = async () => {
    await Promise.all(
      [
        "workshop-management",
        "daily-workshops",
        "daily-workshop-reports",
        "daily-crew-assignments",
        "projects-dashboard",
      ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
    );
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await invalidate();
      toast.success("تم حفظ التغييرات");
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر حفظ إعدادات الورش"));
    } finally {
      setBusy(false);
    }
  };
  const reports = new Map(data?.reports.map((r) => [r.workshop_id, r]) ?? []);
  const all = [...(data?.workshops ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ar"),
  );
  const scoped = all.filter(
    (w) =>
      !siteId ||
      w.home_site_id === siteId ||
      reports.get(w.id)?.work_site_id === siteId ||
      data?.lines.some(
        (l) => l.report_id === reports.get(w.id)?.id && l.site_id === siteId && l.attended,
      ),
  );
  const visible = scoped.filter(
    (w) =>
      w.is_active !== archived && `${w.name} ${w.supervisor_name} ${w.specialty}`.includes(search),
  );
  const siteName = (id?: string | null) =>
    data?.sites.find((s) => s.id === id)
      ? workshopSiteLabel(data.sites.find((s) => s.id === id)!)
      : "غير محدد";
  const scopedReportIds = new Set(scoped.map((w) => reports.get(w.id)?.id).filter(Boolean));
  const homeReportIds = new Set(
    scoped.filter((w) => w.home_site_id === siteId).map((w) => reports.get(w.id)?.id),
  );
  const present = new Set(
    data?.lines
      .filter(
        (l) =>
          scopedReportIds.has(l.report_id) &&
          l.attended &&
          l.employee_id &&
          (!siteId || homeReportIds.has(l.report_id) || l.site_id === siteId),
      )
      .map((l) => l.employee_id),
  );
  const members = new Set(
    data?.members
      .filter((m) => scoped.some((w) => w.id === m.workshop_id))
      .map((m) => m.employee_id),
  );
  const reorder = (source: string, target: string) => {
    if (source === target || busy || !permission.data) return;
    const order = reorderWorkshopIds(
      all.map((w) => w.id),
      source,
      target,
    );
    void run(async () => {
      const { error } = await supabase.rpc("reorder_daily_workshops", { p_ids: order });
      if (error) throw error;
    });
  };
  const openEdit = (w?: Workshop) => {
    setForm(
      w ? { ...w, home_site_id: w.home_site_id ?? "" } : { ...blank, home_site_id: siteId ?? "" },
    );
    setEditing(w ?? "new");
  };
  if (query.isPending) return <p className="p-6 text-muted-foreground">جارٍ تحميل بيئة الورش...</p>;
  if (query.isError)
    return (
      <div className="rounded-xl border border-destructive p-4 text-destructive">
        تعذر تحميل إعدادات الورش. تأكد من تطبيق ترحيل قاعدة البيانات.
        <Button variant="outline" onClick={() => void query.refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  return (
    <section dir="rtl" className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
            إدارة التشغيل / الورش
          </p>
          <h2 className="text-2xl font-semibold">الورش وفرق العمل</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            هوية ثابتة للفريق، وتكليف يتغير مع العمل. المقر يجمع الورش؛ وموقع التنفيذ يحدد وجهة عمل
            اليوم.
          </p>
        </div>
        <div className="flex gap-2">
          {(!controlledDate || onDateChange) && (
            <Input
              aria-label="تاريخ الإحصاءات والتكليف"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) (onDateChange ?? setLocalDate)(e.target.value);
              }}
            />
          )}
          {permission.data && (
            <Button onClick={() => openEdit()}>
              <Plus className="ml-2 h-4 w-4" />
              ورشة جديدة
            </Button>
          )}
        </div>
      </header>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
        {[
          ["الورش النشطة", scoped.filter((w) => w.is_active).length],
          ["الكادر المسجل · أفراد فريدون", members.size],
          ["الحضور المبلغ لليوم · أفراد فريدون", present.size],
          ["ورش لها تكليف اليوم", scoped.filter((w) => reports.get(w.id)?.work_activity).length],
        ].map(([label, value]) => (
          <div key={label} className="bg-card p-5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-sm"
          aria-label="البحث في الورش"
          placeholder="ابحث بالورشة، المسؤول أو التخصص…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="outline" onClick={() => setArchived(!archived)}>
          {archived ? "عرض الورش النشطة" : "الأرشيف"}
        </Button>
      </div>
      {permission.data && (
        <p className="text-xs text-muted-foreground">
          اسحب البطاقة لترتيب الورش، أو استخدم أسهم الترتيب. يُحفظ الترتيب لجميع المستخدمين.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((w, index) => {
          const report = reports.get(w.id);
          const lines = data!.lines.filter((l) => l.report_id === report?.id);
          const count = new Set(
            data!.members.filter((m) => m.workshop_id === w.id).map((m) => m.employee_id),
          ).size;
          const attended = new Set(
            lines.filter((l) => l.attended && l.employee_id).map((l) => l.employee_id),
          ).size;
          return (
            <article
              key={w.id}
              draggable={permission.data && !busy}
              onDragStart={(e) => {
                setDragId(w.id);
                e.dataTransfer.setData("text/plain", w.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                reorder(dragId ?? e.dataTransfer.getData("text/plain"), w.id);
                setDragId(null);
              }}
              className={`flex flex-col rounded-xl border bg-card shadow-sm transition-colors ${dragId === w.id ? "opacity-40" : "hover:border-primary/40"}`}
            >
              <div className="flex items-start justify-between gap-3 border-b p-5">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {w.specialty || "فريق متعدد الأعمال"}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{w.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {w.supervisor_name || "لم يُحدد مسؤول الفريق"}
                  </p>
                </div>
                {permission.data && (
                  <GripVertical className="h-5 w-5 shrink-0 cursor-grab text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-4 p-5">
                <p className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  المقر: {siteName(w.home_site_id)}
                </p>
                {w.description && <p className="text-sm text-muted-foreground">{w.description}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">الكادر المسجل</p>
                    <p className="mt-1 text-xl font-semibold">{count}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">الحضور المبلغ اليوم</p>
                    <p className="mt-1 text-xl font-semibold">{attended}</p>
                  </div>
                </div>
                <div className="border-r-2 border-primary pr-3">
                  <p className="text-xs text-muted-foreground">تكليف {date}</p>
                  <p className="mt-1 text-sm font-medium">
                    {report?.work_activity || "لم يُحدد عمل لهذا اليوم"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    وجهة التنفيذ: {siteName(report?.work_site_id)}
                  </p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setRoster(w)}>
                  عرض الكادر والحضور ({count})
                </Button>
                {siteId && (
                  <Badge variant="outline">
                    {w.home_site_id === siteId ? "ورشة تابعة للمقر" : "فريق مكلف بالعمل في الموقع"}
                  </Badge>
                )}
              </div>
              <footer className="flex flex-wrap gap-1 border-t p-3">
                {onSelect && (
                  <Button size="sm" variant="outline" onClick={() => onSelect(w.id)}>
                    <UsersRound className="ml-1 h-4 w-4" />
                    إدارة الكادر
                  </Button>
                )}
                {permission.data && (
                  <>
                    <Button disabled={busy} size="sm" variant="ghost" onClick={() => openEdit(w)}>
                      <Pencil className="ml-1 h-4 w-4" />
                      تعديل
                    </Button>
                    <Button
                      disabled={busy || !w.is_active}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTask(w);
                        setPeriodTask(false);
                        setTaskStart(date);
                        setTaskEnd(date);
                        setTaskIds([w.id]);
                        setTaskSite(report?.work_site_id ?? "");
                        setActivity(report?.work_activity ?? "");
                      }}
                    >
                      <HardHat className="ml-1 h-4 w-4" />
                      تكليف اليوم
                    </Button>
                    <Button
                      aria-label="تقديم الورشة"
                      title="تقديم الورشة"
                      disabled={busy || index === 0}
                      size="icon"
                      variant="ghost"
                      onClick={() => reorder(w.id, visible[index - 1].id)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="تأخير الورشة"
                      title="تأخير الورشة"
                      disabled={busy || index === visible.length - 1}
                      size="icon"
                      variant="ghost"
                      onClick={() => reorder(w.id, visible[index + 1].id)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          لا توجد ورش مطابقة. اربط الورش بالمقر من إعدادات كل ورشة لتظهر هنا.
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto gap-6 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "إضافة ورشة" : "هوية الورشة وإعداداتها"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const payload = {
                  name: form.name.trim(),
                  home_site_id: form.home_site_id || null,
                  supervisor_name: form.supervisor_name.trim(),
                  specialty: form.specialty.trim(),
                  description: form.description.trim(),
                };
                const result =
                  editing === "new"
                    ? await db.from("daily_workshops").insert(payload)
                    : await db
                        .from("daily_workshops")
                        .update(payload)
                        .eq("id", (editing as Workshop).id);
                if (result.error) throw result.error;
                setEditing(null);
              });
            }}
          >
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>اسم الورشة</span>
              <Input
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>المقر الدائم / الموقع الحاضن</span>
              <WorkshopSitePicker
                label="المقر الدائم"
                sites={data!.sites}
                value={form.home_site_id}
                onChange={(id) => setForm({ ...form, home_site_id: id })}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>مسؤول الفريق</span>
              <Input
                maxLength={120}
                value={form.supervisor_name}
                onChange={(e) => setForm({ ...form, supervisor_name: e.target.value })}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>التخصص الأساسي</span>
              <Input
                maxLength={120}
                placeholder="مثال: ستيل / صيانة / تصنيع"
                value={form.specialty}
                onChange={(e) => setForm({ ...form, specialty: e.target.value })}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>وصف وإمكانات الورشة</span>
              <Textarea
                maxLength={1000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Label>
            <div className="flex justify-between gap-2">
              <Button disabled={busy || form.name.trim().length < 2} type="submit">
                {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
              </Button>
              {editing && editing !== "new" && (
                <Button
                  disabled={busy}
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void run(async () => {
                      const { error } = await db
                        .from("daily_workshops")
                        .update({ is_active: !editing.is_active })
                        .eq("id", editing.id);
                      if (error) throw error;
                      setEditing(null);
                    })
                  }
                >
                  {editing.is_active ? (
                    <Archive className="ml-2 h-4 w-4" />
                  ) : (
                    <RotateCcw className="ml-2 h-4 w-4" />
                  )}
                  {editing.is_active ? "أرشفة الورشة" : "إعادة تفعيل"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              تعديل الاسم لا يغير هوية الورشة أو كادرها. الأرشفة تحتفظ بسجلاتها السابقة.
            </p>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!task}
        onOpenChange={(open) => {
          if (!open && !busy) setTask(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto gap-6 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>تكليف {task?.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!workshopPeriodDays(periodTask ? taskStart : date, periodTask ? taskEnd : date)) {
                toast.error("اختر فترة صحيحة بحد أقصى 366 يوماً");
                return;
              }
              void run(async () => {
                const { error } = await supabase.rpc("set_workshop_period_tasks", {
                  p_ids: taskIds,
                  p_start: periodTask ? taskStart : date,
                  p_end: periodTask ? taskEnd : date,
                  p_site: taskSite || null,
                  p_activity: activity.trim(),
                  p_apply: applyTask,
                });
                if (error) throw error;
                setTask(null);
              });
            }}
          >
            <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={periodTask}
                  onChange={(e) => setPeriodTask(e.target.checked)}
                />
                إسناد مستمر لفترة محددة
              </label>
              {periodTask ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Label className="flex flex-col gap-3 leading-6">
                    من تاريخ
                    <Input
                      type="date"
                      required
                      value={taskStart}
                      onChange={(e) => setTaskStart(e.target.value)}
                    />
                  </Label>
                  <Label className="flex flex-col gap-3 leading-6">
                    إلى تاريخ
                    <Input
                      type="date"
                      required
                      min={taskStart}
                      value={taskEnd}
                      onChange={(e) => setTaskEnd(e.target.value)}
                    />
                  </Label>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">ليوم {date} فقط</p>
              )}
              {periodTask && (
                <p className="text-xs text-muted-foreground">
                  يشمل يوم البداية والنهاية ·{" "}
                  {workshopPeriodDays(taskStart, taskEnd) || "فترة غير صحيحة"} يوم · الحد الأقصى 366
                  يوماً
                </p>
              )}
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">تطبيق التكليف على الورش</legend>
              <div className="max-h-36 space-y-2 overflow-auto rounded-lg border p-3">
                {all
                  .filter((w) => w.is_active)
                  .map((w) => (
                    <label key={w.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={taskIds.includes(w.id)}
                        onChange={(e) =>
                          setTaskIds((ids) =>
                            e.target.checked ? [...ids, w.id] : ids.filter((id) => id !== w.id),
                          )
                        }
                      />
                      {w.name}
                      <span className="text-xs text-muted-foreground">{w.supervisor_name}</span>
                    </label>
                  ))}
              </div>
            </fieldset>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>موقع التنفيذ / مركز التكلفة</span>
              <WorkshopSitePicker
                label="موقع التنفيذ / مركز التكلفة"
                sites={data!.sites}
                value={taskSite}
                onChange={setTaskSite}
              />
            </Label>
            <Label className="flex flex-col items-stretch gap-3 leading-6">
              <span>وصف الأعمال المسندة</span>
              <Input
                maxLength={200}
                placeholder="مثال: المحطة الخامسة — أعمال الستيل"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
              />
            </Label>
            <p className="text-sm text-muted-foreground">
              يُحفظ التكليف لكل يوم ضمن الفترة المختارة، وتظهر وجهته تلقائياً عند تسجيل الحضور. يمكن
              تطبيقه على الحاضرين غير المسندين. الإسنادات الفردية السابقة محفوظة؛ عدّلها من توزيع
              العمل عند الحاجة.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={applyTask}
                onChange={(e) => setApplyTask(e.target.checked)}
              />
              تطبيق على الحاضرين غير المسندين حالياً
            </label>
            <Button
              type="submit"
              disabled={
                busy ||
                !taskIds.length ||
                !workshopPeriodDays(periodTask ? taskStart : date, periodTask ? taskEnd : date)
              }
            >
              {busy
                ? "جارٍ الحفظ…"
                : `حفظ ${periodTask ? "تكليف الفترة" : "تكليف اليوم"} (${taskIds.length})`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!roster}
        onOpenChange={(open) => {
          if (!open) setRoster(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto gap-6 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              كادر {roster?.name} · {date}
            </DialogTitle>
          </DialogHeader>
          {roster && (
            <WorkshopRoster
              key={roster.id}
              members={data!.members.filter((m) => m.workshop_id === roster.id)}
              lines={data!.lines.filter((l) => l.report_id === reports.get(roster.id)?.id)}
              sites={data!.sites}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

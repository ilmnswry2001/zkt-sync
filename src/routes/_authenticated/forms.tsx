import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { actOnForm, createForm, getMyFormPowers } from "@/lib/forms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Clock3, Eye, FileSignature, ListChecks, Plus, Play, Printer, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/forms")({
  head: () => ({
    meta: [
      { title: "الاستمارات الإلكترونية — موافقات الحضور والوقت الإضافي" },
      {
        name: "description",
        content:
          "إنشاء استمارات الحضور والوقت الإضافي والإجازات وتمريرها لمدير القسم ثم مدير الشركة ثم قسم التنفيذ لاحتسابها في التقرير الشهري.",
      },
      { property: "og:title", content: "الاستمارات الإلكترونية" },
      {
        property: "og:description",
        content: "دورة موافقات إلكترونية مرتبطة بالحضور الشهري والوقت الإضافي.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FormsPage,
});

type FormRow = {
  id: string;
  form_no: number;
  work_date: string;
  kind: "attendance" | "overtime" | "leave";
  day_status: string | null;
  overtime_hours: number;
  check_in: string | null;
  check_out: string | null;
  reason: string;
  status: "pending_manager" | "pending_ceo" | "pending_execution" | "executed" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  employees: { employee_no: string; full_name: string } | null;
  department: { name: string } | null;
  target: { name: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  attendance: "حضور",
  overtime: "وقت إضافي",
  leave: "إجازة",
};
const STATUS_LABEL: Record<string, string> = {
  pending_manager: "بانتظار مدير القسم",
  pending_ceo: "بانتظار مدير الشركة",
  pending_execution: "بانتظار التنفيذ",
  executed: "منفذة",
  rejected: "مرفوضة",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending_manager: "secondary",
  pending_ceo: "secondary",
  pending_execution: "outline",
  executed: "default",
  rejected: "destructive",
};

function printForm(row: FormRow) {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
  const details = row.kind === "overtime" ? `${row.overtime_hours} ساعة` : `${row.check_in ?? "—"} → ${row.check_out ?? "—"}`;
  const popup = window.open("", "_blank", "width=900,height=800");
  if (!popup) {
    toast.error("تعذر فتح نافذة الطباعة؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى");
    return;
  }
  popup.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"/><title>استمارة رقم ${row.form_no}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:40px;line-height:1.8}h1{text-align:center;margin-bottom:4px}h2{text-align:center;font-weight:normal;color:#555;margin-top:0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0}.item{border:1px solid #ddd;padding:12px;border-radius:8px}.label{display:block;color:#666;font-size:12px}.reason{border:1px solid #ddd;border-radius:8px;padding:16px;min-height:90px}.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:70px;text-align:center}.line{border-top:1px solid #555;margin-top:45px}@media print{body{padding:0}}</style></head><body><h1>الاستمارة الإلكترونية</h1><h2>رقم الاستمارة: ${row.form_no}</h2><div class="meta"><div class="item"><span class="label">الموظف</span>${escapeHtml(`${row.employees?.employee_no ?? "—"} — ${row.employees?.full_name ?? "—"}`)}</div><div class="item"><span class="label">نوع الاستمارة</span>${escapeHtml(KIND_LABEL[row.kind])}</div><div class="item"><span class="label">تاريخ الاستحقاق</span>${escapeHtml(row.work_date)}</div><div class="item"><span class="label">القسم</span>${escapeHtml(row.department?.name ?? "—")}</div><div class="item"><span class="label">مرسلة إلى</span>${escapeHtml(row.target?.name ?? "—")}</div><div class="item"><span class="label">التفاصيل</span>${escapeHtml(details)}</div></div><h3>السبب والتفاصيل</h3><div class="reason">${escapeHtml(row.reason)}</div><div class="signatures"><div>مقدم الطلب<div class="line"></div></div><div>الاعتماد<div class="line"></div></div><div>التنفيذ<div class="line"></div></div></div><script>window.onload=()=>{window.print();}</script></body></html>`);
  popup.document.close();
}

function StatCard({ title, value, icon: Icon, tone }: { title: string; value: number | string; icon: typeof Clock3; tone: string }) {
  return <Card><CardContent className="p-4 flex items-center gap-3"><div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tone}`}><Icon className="w-5 h-5 text-white" /></div><div><p className="text-xs text-muted-foreground">{title}</p><p className="text-2xl font-bold">{value}</p></div></CardContent></Card>;
}

function FormsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [kind, setKind] = useState<"attendance" | "overtime" | "leave">("attendance");
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedForm, setSelectedForm] = useState<FormRow | null>(null);

  const powersFn = useServerFn(getMyFormPowers);
  const createFn = useServerFn(createForm);
  const actFn = useServerFn(actOnForm);

  const { data: powers } = useQuery({ queryKey: ["form-powers"], queryFn: () => powersFn() });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-search", search],
    queryFn: async () => {
      let q = supabase
        .from("employees")
        .select("id, employee_no, full_name")
        .order("employee_no")
        .limit(30);
      if (search.trim()) q = q.or(`full_name.ilike.%${search.trim()}%,employee_no.ilike.%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as { id: string; employee_no: string; full_name: string }[];
    },
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["forms", filter],
    queryFn: async () => {
      let q = supabase
        .from("forms")
        .select(
          "id, form_no, work_date, kind, day_status, overtime_hours, check_in, check_out, reason, status, rejection_reason, created_at, employees(employee_no, full_name), department:departments!forms_department_id_fkey(name), target:departments!forms_target_department_id_fkey(name)",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") q = q.eq("status", filter as FormRow["status"]);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as FormRow[];
    },
  });

  const { data: statsRows = [] } = useQuery({
    queryKey: ["forms", "statistics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("forms").select("status, kind, overtime_hours").limit(1000);
      if (error) throw error;
      return data as { status: FormRow["status"]; kind: FormRow["kind"]; overtime_hours: number }[];
    },
  });

  const statistics = useMemo(() => ({
    total: statsRows.length,
    pending: statsRows.filter((f) => f.status.startsWith("pending_")).length,
    executed: statsRows.filter((f) => f.status === "executed").length,
    rejected: statsRows.filter((f) => f.status === "rejected").length,
    overtime: statsRows.filter((f) => f.kind === "overtime").reduce((sum, f) => sum + Number(f.overtime_hours || 0), 0),
  }), [statsRows]);

  const create = useMutation({
    mutationFn: (payload: Parameters<typeof createForm>[0] extends never ? never : any) =>
      createFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      setOpen(false);
      setEmployeeId("");
      toast.success("تم إرسال الاستمارة إلى قائمة التنفيذ");
    },
    onError: (e: any) => toast.error(e.message ?? "فشل إرسال الاستمارة"),
  });

  const act = useMutation({
    mutationFn: (payload: { form_id: string; action: "approve" | "reject" | "execute"; note?: string | null }) =>
      actFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["forms"] });
      toast.success("تم تحديث الاستمارة");
    },
    onError: (e: any) => toast.error(e.message ?? "تعذر تنفيذ الإجراء"),
  });

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    forms.forEach((f) => (map[f.status] = (map[f.status] ?? 0) + 1));
    return map;
  }, [forms]);

  const canAct = (row: FormRow) =>
    (row.status === "pending_manager" && powers?.manager) ||
    (row.status === "pending_ceo" && powers?.ceo) ||
    (row.status === "pending_execution" && powers?.executor);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileSignature className="w-7 h-7" /> الاستمارات الإلكترونية
          </h1>
          <p className="text-muted-foreground mt-1">
            استمارات الحضور والوقت الإضافي والإجازات — تمر على مدير القسم ثم مدير الشركة ثم قسم
            التنفيذ، وبعد التنفيذ تُحتسب في التقرير الشهري.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 ml-2" /> استمارة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl" className="max-w-xl">
            <DialogHeader>
              <DialogTitle>استمارة إلكترونية جديدة</DialogTitle>
            </DialogHeader>
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (!employeeId) {
                  toast.error("اختر الموظف");
                  return;
                }
                create.mutate({
                  employee_id: employeeId,
                  target_department_id: (f.get("target_department_id") as string) || null,
                  work_date: f.get("work_date") as string,
                  kind,
                  day_status: kind === "leave" ? "leave" : kind === "attendance" ? "present" : null,
                  overtime_hours: kind === "overtime" ? Number(f.get("overtime_hours") || 0) : 0,
                  check_in: (f.get("check_in") as string) || null,
                  check_out: (f.get("check_out") as string) || null,
                  reason: f.get("reason") as string,
                });
              }}
            >
              <div className="col-span-2">
                <Label>بحث الموظف (رقم أو اسم)</Label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اكتب للبحث..." />
              </div>
              <div className="col-span-2">
                <Label>الموظف</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر الموظف من قاعدة البيانات" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.employee_no} — {e.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>نوع الاستمارة</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="attendance">إثبات حضور</SelectItem>
                    <SelectItem value="overtime">وقت إضافي</SelectItem>
                    <SelectItem value="leave">إجازة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>التاريخ</Label>
                <Input type="date" name="work_date" required />
              </div>
              <div className="col-span-2">
                <Label>القسم المرسل إليه للموافقة</Label>
                <Select name="target_department_id">
                  <SelectTrigger>
                    <SelectValue placeholder="اختر القسم" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {kind === "overtime" ? (
                <div>
                  <Label>ساعات الوقت الإضافي</Label>
                  <Input type="number" step="0.5" min="0" max="24" name="overtime_hours" defaultValue="1" />
                </div>
              ) : (
                <>
                  <div>
                    <Label>وقت الدخول</Label>
                    <Input type="time" name="check_in" />
                  </div>
                  <div>
                    <Label>وقت الخروج</Label>
                    <Input type="time" name="check_out" />
                  </div>
                </>
              )}
              <div className="col-span-2">
                <Label>السبب</Label>
                <Textarea name="reason" required minLength={3} maxLength={1000} rows={3} placeholder="مثال: تعذر تسجيل بصمة الخروج بسبب عمل ميداني" />
              </div>
              <Button type="submit" className="col-span-2" disabled={create.isPending}>
                {create.isPending ? "جارٍ الإرسال..." : "إرسال الاستمارة"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard title="إجمالي الاستمارات" value={statistics.total} icon={ListChecks} tone="bg-primary" />
        <StatCard title="معلّقة" value={statistics.pending} icon={Clock3} tone="bg-warning" />
        <StatCard title="منفذة" value={statistics.executed} icon={Check} tone="bg-success" />
        <StatCard title="مرفوضة" value={statistics.rejected} icon={X} tone="bg-destructive" />
        <StatCard title="ساعات إضافية" value={statistics.overtime.toLocaleString("ar")} icon={FileSignature} tone="bg-accent-foreground" />
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "pending_manager", "pending_ceo", "pending_execution", "executed", "rejected"].map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
            {s === "all" ? "الكل" : STATUS_LABEL[s]}
            {s !== "all" && counts[s] ? ` (${counts[s]})` : ""}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الاستمارات ({forms.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>الموظف</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>مرسلة إلى</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>التفاصيل</TableHead>
                <TableHead>السبب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">{row.form_no}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    {row.employees?.employee_no} — {row.employees?.full_name}
                  </TableCell>
                  <TableCell>{row.department?.name ?? "-"}</TableCell>
                  <TableCell>{row.target?.name ?? "-"}</TableCell>
                  <TableCell className="font-mono">{row.work_date}</TableCell>
                  <TableCell>{KIND_LABEL[row.kind]}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {row.kind === "overtime"
                      ? `${row.overtime_hours} ساعة`
                      : `${row.check_in ?? "—"} → ${row.check_out ?? "—"}`}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-xs" title={row.reason}>
                    {row.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    {row.rejection_reason && (
                      <div className="text-[10px] text-destructive mt-1">{row.rejection_reason}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="استعراض الاستمارة" onClick={() => setSelectedForm(row)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="طباعة / تصدير PDF" onClick={() => printForm(row)}>
                        <Printer className="w-4 h-4" />
                      </Button>
                      {canAct(row) ? (
                        <>
                          <Button
                          size="icon"
                          variant="ghost"
                          title={row.status === "pending_execution" ? "تنفيذ" : "موافقة"}
                          onClick={() =>
                            act.mutate({
                              form_id: row.id,
                              action: row.status === "pending_execution" ? "execute" : "approve",
                            })
                          }
                        >
                          {row.status === "pending_execution" ? (
                            <Play className="w-4 h-4 text-primary" />
                          ) : (
                            <Check className="w-4 h-4 text-primary" />
                          )}
                          </Button>
                          <Button
                          size="icon"
                          variant="ghost"
                          title="رفض"
                          onClick={() => {
                            const note = prompt("سبب الرفض؟") ?? "";
                            act.mutate({ form_id: row.id, action: "reject", note });
                          }}
                        >
                          <X className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!forms.length && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    لا توجد استمارات
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selectedForm} onOpenChange={(value) => !value && setSelectedForm(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>استعراض الاستمارة الإلكترونية</DialogTitle></DialogHeader>
          {selectedForm && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3"><div><p className="text-sm text-muted-foreground">رقم الاستمارة</p><p className="text-2xl font-bold">#{selectedForm.form_no}</p></div><Badge variant={STATUS_VARIANT[selectedForm.status]}>{STATUS_LABEL[selectedForm.status]}</Badge></div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">الموظف:</span> {selectedForm.employees?.employee_no} — {selectedForm.employees?.full_name}</div>
                <div><span className="text-muted-foreground">النوع:</span> {KIND_LABEL[selectedForm.kind]}</div>
                <div><span className="text-muted-foreground">التاريخ:</span> {selectedForm.work_date}</div>
                <div><span className="text-muted-foreground">القسم:</span> {selectedForm.department?.name ?? "—"}</div>
                <div><span className="text-muted-foreground">مرسلة إلى:</span> {selectedForm.target?.name ?? "—"}</div>
                <div><span className="text-muted-foreground">التفاصيل:</span> {selectedForm.kind === "overtime" ? `${selectedForm.overtime_hours} ساعة` : `${selectedForm.check_in ?? "—"} → ${selectedForm.check_out ?? "—"}`}</div>
              </div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-sm font-semibold mb-1">السبب والتفاصيل</p><p className="whitespace-pre-wrap">{selectedForm.reason}</p></div>
              {selectedForm.rejection_reason && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive"><p className="text-sm font-semibold mb-1">سبب الرفض</p><p>{selectedForm.rejection_reason}</p></div>}
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => printForm(selectedForm)}><Printer className="w-4 h-4 ml-2" /> طباعة / حفظ PDF</Button><Button onClick={() => setSelectedForm(null)}>إغلاق</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {powers?.admin && <FormRolesCard />}
    </div>
  );
}

function FormRolesCard() {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({
    queryKey: ["profiles-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email").order("email");
      if (error) throw error;
      return data as { id: string; full_name: string | null; email: string | null }[];
    },
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["form-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("form_role_assignments").select("id, user_id, role");
      if (error) throw error;
      return data as { id: string; user_id: string; role: string }[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (p: { user_id: string; role: string; existing?: string }) => {
      if (p.existing) {
        const { error } = await supabase.from("form_role_assignments").delete().eq("id", p.existing);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("form_role_assignments")
          .insert({ user_id: p.user_id, role: p.role as any });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["form-roles"] });
      toast.success("تم تحديث الصلاحيات");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const roles = [
    { key: "dept_manager", label: "مدير قسم" },
    { key: "ceo", label: "مدير الشركة" },
    { key: "executor", label: "تنفيذ الاستمارات" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>صلاحيات دورة الاستمارات</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المستخدم</TableHead>
              {roles.map((r) => (
                <TableHead key={r.key}>{r.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="text-sm">{u.full_name ?? u.email}</TableCell>
                {roles.map((r) => {
                  const existing = assignments.find((a) => a.user_id === u.id && a.role === r.key);
                  return (
                    <TableCell key={r.key}>
                      <Button
                        size="sm"
                        variant={existing ? "default" : "outline"}
                        onClick={() => toggle.mutate({ user_id: u.id, role: r.key, existing: existing?.id })}
                      >
                        {existing ? "مفعّل" : "تعيين"}
                      </Button>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

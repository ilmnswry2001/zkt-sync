import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatErrorMessage } from "@/lib/error-message";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Building2,
  Users,
  Search,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  BriefcaseBusiness,
  UserRoundCog,
  UserPlus,
  UserMinus,
  ClipboardList,
  FileClock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/departments")({
  head: () => ({ meta: [{ title: "الأقسام" }] }),
  component: DepartmentsPage,
});

type Department = { id: string; name: string; description: string | null; manager_user_id: string | null };
type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  email: string | null;
  position: string | null;
  status: string | null;
  department_id: string | null;
};
type Profile = { id: string; full_name: string | null; email: string | null };
type DepartmentTask = { id: string; title: string; status: string; task_date: string; employee_id: string | null };
type DepartmentForm = { id: string; kind: string; status: string; work_date: string; employee_id: string };
const db = supabase as typeof supabase & { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };
const normalizeEmail = (email: string | null | undefined) => email?.trim().toLocaleLowerCase() ?? "";
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function DepartmentsPage() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<Department | null>(null);
  const [employeeToAdd, setEmployeeToAdd] = useState("");

  const query = useQuery({
    queryKey: ["departments", "overview"],
    queryFn: async () => {
      const departmentsResult = await db.from("departments").select("id, name, description").order("name");
      if (departmentsResult.error) throw departmentsResult.error;
      const departmentIds = (departmentsResult.data ?? []).map((department: { id: string }) => department.id);
      const [employeesResult, profilesResult, managersResult] = await Promise.all([
        db.from("employees").select("id, employee_no, full_name, email, position, status, department_id").order("full_name"),
        db.from("profiles").select("id, full_name, email").limit(3000),
        departmentIds.length
          ? db.from("department_managers").select("department_id, user_id").in("department_id", departmentIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (profilesResult.error) throw profilesResult.error;
      if (managersResult.error) throw managersResult.error;
      const managerByDepartment = new Map<string, string>();
      for (const row of managersResult.data ?? []) managerByDepartment.set(row.department_id, row.user_id);
      return {
        departments: (departmentsResult.data ?? []).map((department: Omit<Department, "manager_user_id">) => ({
          ...department,
          manager_user_id: managerByDepartment.get(department.id) ?? null,
        })) as Department[],
        employees: (employeesResult.data ?? []) as Employee[],
        profiles: (profilesResult.data ?? []) as Profile[],
      };
    },
  });
  const departments = query.data?.departments ?? [];
  const employees = query.data?.employees ?? [];
  const profiles = query.data?.profiles ?? [];
  const profileByEmail = useMemo(() => {
    const map = new Map<string, Profile[]>();
    for (const profile of profiles) {
      const email = normalizeEmail(profile.email);
      if (email) map.set(email, [...(map.get(email) ?? []), profile]);
    }
    return map;
  }, [profiles]);
  const employeesByDepartment = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const employee of employees) {
      if (!employee.department_id) continue;
      map.set(employee.department_id, [...(map.get(employee.department_id) ?? []), employee]);
    }
    return map;
  }, [employees]);
  const filtered = departments.filter((department) =>
    `${department.name} ${department.description ?? ""}`.toLocaleLowerCase("ar").includes(search.trim().toLocaleLowerCase("ar")),
  );
  const assignedEmployees = employees.filter((employee) => employee.department_id).length;
  const save = useMutation({
    mutationFn: async (value: { name: string; description: string | null }) => {
      const payload = { name: value.name.trim(), description: value.description?.trim() || null };
      const result = editing
        ? await db.from("departments").update(payload).eq("id", editing.id)
        : await db.from("departments").upsert(payload, { onConflict: "name" });
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["departments"] });
      setOpen(false);
      setEditing(null);
      toast.success("تم حفظ بيانات القسم");
    },
    onError: (error: unknown) => toast.error(`تعذر حفظ القسم: ${formatErrorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: async (department: Department) => {
      const count = employeesByDepartment.get(department.id)?.length ?? 0;
      if (count) throw new Error(`لا يمكن حذف القسم لارتباط ${count} موظفاً به. انقل الموظفين أولاً.`);
      const { error } = await db.from("departments").delete().eq("id", department.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["departments"] });
      toast.success("تم حذف القسم");
    },
    onError: (error: unknown) => toast.error(`تعذر حذف القسم: ${formatErrorMessage(error)}`),
  });
  const updateEmployeeDepartment = useMutation({
    mutationFn: async ({ employeeId, departmentId }: { employeeId: string; departmentId: string | null }) => {
      const { error } = await db.from("employees").update({ department_id: departmentId }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: async (_result, variables) => {
      setEmployeeToAdd("");
      await qc.invalidateQueries({ queryKey: ["departments"] });
      await qc.invalidateQueries({ queryKey: ["employees"] });
      await qc.invalidateQueries({ queryKey: ["monthly"] });
      await qc.invalidateQueries({ queryKey: ["team-follow-up"] });
      if (details && variables.departmentId === details.id) toast.success("تمت إضافة الموظف إلى القسم");
      else toast.success("تم نقل الموظف من القسم");
    },
    onError: (error: unknown) => toast.error(`تعذر تحديث القسم: ${formatErrorMessage(error)}`),
  });
  const setManager = useMutation({
    mutationFn: async ({ departmentId, employeeId }: { departmentId: string; employeeId: string | null }) => {
      const { error } = await db.rpc("set_department_manager", {
        _department_id: departmentId,
        _employee_id: employeeId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["departments"] }),
        qc.invalidateQueries({ queryKey: ["accounts", "roles"] }),
        qc.invalidateQueries({ queryKey: ["accounts", "user-departments"] }),
        qc.invalidateQueries({ queryKey: ["team-follow-up"] }),
      ]);
      toast.success("تم تحديث مسؤول القسم وصلاحيات حسابه");
    },
    onError: (error: unknown) => toast.error(`تعذر تعيين مسؤول القسم: ${formatErrorMessage(error)}`),
  });

  return (
    <main dir="rtl" className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-slate-950 via-slate-900 to-teal-950 p-6 text-white shadow-lg sm:p-8">
        <div className="absolute -left-10 -top-16 h-56 w-56 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3"><Building2 className="h-7 w-7" /></div>
            <div><p className="text-sm text-teal-100">الهيكل التنظيمي</p><h1 className="mt-1 text-3xl font-bold">إدارة الأقسام</h1><p className="mt-2 max-w-xl text-sm text-slate-300">أدر أعضاء كل قسم ومسؤوله، وراجع المهام والطلبات من صفحة تفاصيل موحّدة.</p></div>
          </div>
          <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setEditing(null); }}>
            <DialogTrigger asChild><Button className="bg-white text-slate-900 hover:bg-slate-100" onClick={() => setEditing(null)}><Plus className="ml-2 h-4 w-4" /> إضافة قسم</Button></DialogTrigger>
            <DialogContent dir="rtl" className="sm:max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "تعديل بيانات القسم" : "إضافة قسم جديد"}</DialogTitle></DialogHeader>
              <form key={editing?.id ?? "new"} className="space-y-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); save.mutate({ name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") || null }); }}>
                <div className="space-y-2"><Label htmlFor="department-name">اسم القسم</Label><Input id="department-name" name="name" required maxLength={100} defaultValue={editing?.name} placeholder="مثال: الموارد البشرية" /></div>
                <div className="space-y-2"><Label htmlFor="department-description">الوصف والمهام</Label><textarea id="department-description" name="description" maxLength={500} defaultValue={editing?.description ?? ""} placeholder="نبذة مختصرة عن مسؤوليات القسم" className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
                <Button type="submit" className="w-full" disabled={save.isPending}>{save.isPending ? "جارٍ الحفظ…" : "حفظ القسم"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "إجمالي الأقسام", value: departments.length, icon: Building2, tone: "text-teal-700 bg-teal-50" },
          { label: "الموظفون المنتسبون", value: assignedEmployees, icon: Users, tone: "text-blue-700 bg-blue-50" },
          { label: "موظفون بلا قسم", value: Math.max(0, employees.length - assignedEmployees), icon: BriefcaseBusiness, tone: "text-amber-700 bg-amber-50" },
        ].map((stat) => <Card key={stat.label} className="rounded-2xl"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{stat.label}</p><p className="mt-1 text-3xl font-bold tabular-nums">{query.isPending ? "—" : stat.value.toLocaleString("ar")}</p></div><div className={`rounded-2xl p-3 ${stat.tone}`}><stat.icon className="h-5 w-5" /></div></CardContent></Card>)}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:p-5">
          <div><h2 className="font-semibold">دليل الأقسام</h2><p className="mt-1 text-sm text-muted-foreground">إجمالي {filtered.length.toLocaleString("ar")} قسم</p></div>
          <div className="flex gap-2"><div className="relative w-full sm:w-72"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pr-9" placeholder="ابحث باسم القسم أو وصفه" aria-label="بحث في الأقسام" /></div><Button variant="outline" size="icon" aria-label="تحديث الأقسام" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /></Button></div>
        </div>
        {query.isError ? <div role="alert" className="space-y-3 p-10 text-center"><p className="text-destructive">تعذر تحميل الأقسام وبيانات الربط: {formatErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}>إعادة المحاولة</Button></div> : query.isPending ? <p role="status" className="p-12 text-center text-muted-foreground">جارٍ تحميل الهيكل التنظيمي…</p> : !filtered.length ? <div className="p-12 text-center"><div className="mx-auto mb-3 w-fit rounded-full bg-muted p-3"><Building2 className="h-6 w-6 text-muted-foreground" /></div><p className="font-medium">{search ? "لا توجد أقسام مطابقة للبحث" : "لا توجد أقسام مسجلة بعد"}</p><p className="mt-1 text-sm text-muted-foreground">{search ? "جرّب كلمة بحث أخرى." : "أضف القسم الأول لبدء تنظيم الموظفين."}</p></div> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">
          {filtered.map((department) => {
            const members = employeesByDepartment.get(department.id) ?? [];
            const activeCount = members.filter((employee) => !employee.status || employee.status === "active").length;
            const manager = profiles.find((profile) => profile.id === department.manager_user_id);
            return <article key={department.id} className="group rounded-2xl border bg-background p-4 transition hover:border-teal-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="rounded-xl bg-teal-50 p-2.5 text-teal-700"><Building2 className="h-5 w-5" /></div><div className="min-w-0"><h3 className="truncate font-semibold" title={department.name}>{department.name}</h3><p className="mt-0.5 text-xs text-muted-foreground">{activeCount.toLocaleString("ar")} موظف نشط</p></div></div><div className="flex shrink-0 gap-1"><Button size="icon" variant="ghost" aria-label={`تعديل ${department.name}`} onClick={() => { setEditing(department); setOpen(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label={`حذف ${department.name}`} disabled={members.length > 0 || remove.isPending} title={members.length > 0 ? "انقل الموظفين المرتبطين قبل الحذف" : "حذف القسم"} onClick={() => { if (confirm(`حذف القسم «${department.name}»؟`)) remove.mutate(department); }}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>
              <p className="mt-4 min-h-10 text-sm leading-6 text-muted-foreground">{department.description || "لا يوجد وصف لهذا القسم."}</p>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/40 p-2.5 text-sm"><UserRoundCog className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{manager?.full_name || (manager?.email ? manager.email : "لم يُعيّن مسؤول للقسم")}</span></div>
              <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs"><span className="text-muted-foreground">الأعضاء</span><span className="rounded-full bg-muted px-2.5 py-1 font-semibold tabular-nums">{members.length.toLocaleString("ar")}</span></div>
              <Button className="mt-3 w-full" variant="outline" onClick={() => { setDetails(department); setEmployeeToAdd(""); }}><Building2 className="ml-2 h-4 w-4" /> عرض جميع تفاصيل القسم</Button>
            </article>;
          })}
        </div>}
      </section>

      <DepartmentDetailsDialog
        department={details}
        employees={employees}
        profiles={profiles}
        isAdmin={isAdmin}
        employeeToAdd={employeeToAdd}
        setEmployeeToAdd={setEmployeeToAdd}
        onClose={() => setDetails(null)}
        onAdd={(employeeId) => updateEmployeeDepartment.mutate({ employeeId, departmentId: details?.id ?? null })}
        onRemove={(employeeId) => updateEmployeeDepartment.mutate({ employeeId, departmentId: null })}
        onUpdateManager={(employeeId) => details && setManager.mutate({ departmentId: details.id, employeeId })}
        addPending={updateEmployeeDepartment.isPending}
        managerPending={setManager.isPending}
      />
    </main>
  );
}

function DepartmentDetailsDialog({
  department,
  employees,
  profiles,
  isAdmin,
  employeeToAdd,
  setEmployeeToAdd,
  onClose,
  onAdd,
  onRemove,
  onUpdateManager,
  addPending,
  managerPending,
}: {
  department: Department | null;
  employees: Employee[];
  profiles: Profile[];
  isAdmin: boolean;
  employeeToAdd: string;
  setEmployeeToAdd: (id: string) => void;
  onClose: () => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateManager: (id: string | null) => void;
  addPending: boolean;
  managerPending: boolean;
}) {
  const members = employees.filter((employee) => employee.department_id === department?.id);
  const availableEmployees = employees.filter((employee) => employee.id && employee.department_id !== department?.id);
  const profileByEmail = new Map(profiles.filter((profile) => normalizeEmail(profile.email)).map((profile) => [normalizeEmail(profile.email), profile]));
  const managerOptions = members.map((employee) => ({ employee, profile: profileByEmail.get(normalizeEmail(employee.email)) })).filter((item) => item.profile);
  const managerProfile = profiles.find((profile) => profile.id === department?.manager_user_id);
  const currentManager = managerOptions.find((item) => item.profile?.id === department?.manager_user_id)?.employee;
  const report = useQuery({
    queryKey: ["departments", "detail", department?.id],
    enabled: !!department,
    queryFn: async () => {
      if (!department) return { tasks: [] as DepartmentTask[], forms: [] as DepartmentForm[] };
      const [tasksResult, formsResult] = await Promise.all([
        db.from("employee_tasks").select("id, title, status, task_date, employee_id").eq("department_id", department.id).order("task_date", { ascending: false }).limit(50),
        db.from("forms").select("id, kind, status, work_date, employee_id").eq("department_id", department.id).order("work_date", { ascending: false }).limit(50),
      ]);
      if (tasksResult.error) throw tasksResult.error;
      if (formsResult.error) throw formsResult.error;
      return { tasks: (tasksResult.data ?? []) as DepartmentTask[], forms: (formsResult.data ?? []) as DepartmentForm[] };
    },
  });
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const pendingForms = (report.data?.forms ?? []).filter((form) => !["executed", "rejected"].includes(form.status)).length;
  const activeTasks = (report.data?.tasks ?? []).filter((task) => !["completed", "cancelled"].includes(task.status)).length;

  return <Dialog open={!!department} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
      {department && <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl"><Building2 className="h-5 w-5 text-primary" /> تفاصيل قسم {department.name}</DialogTitle>
          <DialogDescription>{department.description || "لا يوجد وصف مسجل للقسم."}</DialogDescription>
        </DialogHeader>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={Users} label="عدد الأعضاء" value={members.length} />
          <Metric icon={ShieldCheck} label="الموظفون النشطون" value={members.filter((employee) => !employee.status || employee.status === "active").length} />
          <Metric icon={ClipboardList} label="مهام غير منجزة" value={report.isPending ? "…" : activeTasks} />
          <Metric icon={FileClock} label="طلبات قيد الإجراء" value={report.isPending ? "…" : pendingForms} />
        </section>

        <section className="space-y-3 rounded-2xl border p-4">
          <div className="flex items-center gap-2 font-semibold"><UserRoundCog className="h-4 w-4 text-primary" /> مسؤول القسم وصلاحياته</div>
          {isAdmin ? <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5"><Label htmlFor="department-manager">اختر المسؤول من موظفي القسم المرتبطين بحساب دخول</Label><select id="department-manager" className={selectClass} value={currentManager?.id ?? ""} disabled={managerPending} onChange={(event) => onUpdateManager(event.target.value || null)}><option value="">بدون مسؤول</option>{managerOptions.map(({ employee, profile }) => <option key={employee.id} value={employee.id}>{employee.full_name} · {profile?.email}</option>)}</select></div>
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><ShieldCheck className="ml-1 inline h-4 w-4" />{managerProfile ? `صلاحية مدير قسم مفعلة للحساب ${managerProfile.email}` : "تعيين المسؤول يضيف صلاحية مدير قسم تلقائياً"}</div>
          </div> : <p className="rounded-xl bg-muted/40 p-3 text-sm">{managerProfile ? `المسؤول: ${managerProfile.full_name || managerProfile.email} · حسابه يحمل صلاحية مدير قسم.` : "لم يُعيّن مسؤول لهذا القسم."} تعديل المسؤول متاح لمدير النظام.</p>}
          {isAdmin && !managerOptions.length && <p className="text-xs text-amber-700">للتعيين، أضف الموظف إلى القسم أولاً واربط بريده الإلكتروني بحساب دخول من صفحة الموظفين.</p>}
        </section>

        <section className="space-y-3 rounded-2xl border p-4">
          <div><h3 className="font-semibold">موظفو القسم</h3><p className="mt-1 text-xs text-muted-foreground">إضافة موظف ينقله من قسمه الحالي إلى هذا القسم.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className={selectClass} value={employeeToAdd} onChange={(event) => setEmployeeToAdd(event.target.value)}><option value="">اختر موظفاً للإضافة</option>{availableEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} · {employee.full_name}{employee.department_id ? " · سينتقل من قسمه الحالي" : " · بلا قسم"}</option>)}</select>
            <Button onClick={() => employeeToAdd && onAdd(employeeToAdd)} disabled={!employeeToAdd || addPending} className="shrink-0"><UserPlus className="ml-2 h-4 w-4" /> إضافة للقسم</Button>
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b bg-muted/40 text-right"><th className="p-3">الموظف</th><th className="p-3">المسمى</th><th className="p-3">الحالة</th><th className="p-3">البريد / الحساب</th><th className="p-3">الإجراء</th></tr></thead>
              <tbody>{members.map((employee) => <tr key={employee.id} className="border-b last:border-0"><td className="p-3"><b>{employee.full_name}</b><div className="text-xs text-muted-foreground">{employee.employee_no}</div></td><td className="p-3">{employee.position || "—"}</td><td className="p-3">{employee.status || "نشط"}</td><td className="p-3">{profileByEmail.get(normalizeEmail(employee.email))?.email ?? employee.email ?? "لا يوجد بريد مرتبط"}</td><td className="p-3"><Button size="sm" variant="ghost" title={employee.id === currentManager?.id ? "عيّن مسؤولاً آخر قبل نقل هذا الموظف" : undefined} onClick={() => { if (confirm(`نقل ${employee.full_name} خارج هذا القسم؟`)) onRemove(employee.id); }} disabled={addPending || employee.id === currentManager?.id}><UserMinus className="ml-2 h-4 w-4 text-destructive" /> نقل من القسم</Button></td></tr>)}
                {!members.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">لا يوجد موظفون مرتبطون بهذا القسم.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border p-4"><div className="flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4 text-primary" /> مهام القسم</div>{report.isError ? <p className="text-sm text-destructive">تعذر تحميل المهام: {formatErrorMessage(report.error)}</p> : report.isPending ? <p className="text-sm text-muted-foreground">جارٍ تحميل المهام…</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{(report.data?.tasks ?? []).map((task) => <div key={task.id} className="rounded-lg bg-muted/40 p-3"><div className="flex justify-between gap-2"><span className="font-medium">{task.title}</span><span className="text-xs text-muted-foreground">{task.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{task.task_date} · {employeeById.get(task.employee_id ?? "")?.full_name ?? "غير مسند"}</p></div>)}{!report.data?.tasks.length && <p className="py-4 text-center text-sm text-muted-foreground">لا توجد مهام مسجلة للقسم.</p>}</div>}</div>
          <div className="space-y-3 rounded-2xl border p-4"><div className="flex items-center gap-2 font-semibold"><FileClock className="h-4 w-4 text-primary" /> طلبات واستمارات القسم</div>{report.isError ? <p className="text-sm text-destructive">تعذر تحميل الطلبات: {formatErrorMessage(report.error)}</p> : report.isPending ? <p className="text-sm text-muted-foreground">جارٍ تحميل الطلبات…</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{(report.data?.forms ?? []).map((form) => <div key={form.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-3"><div><p className="font-medium">{form.kind}</p><p className="mt-1 text-xs text-muted-foreground">{form.work_date} · {employeeById.get(form.employee_id)?.full_name ?? "موظف"}</p></div><span className="rounded-full bg-background px-2 py-1 text-xs">{form.status}</span></div>)}{!report.data?.forms.length && <p className="py-4 text-center text-sm text-muted-foreground">لا توجد طلبات مسجلة للقسم.</p>}</div>}</div>
        </section>
      </>}
    </DialogContent>
  </Dialog>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number | string }) {
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString("ar") : value}</p></div></div>;
}

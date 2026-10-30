import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { loadAllRows } from "@/lib/monthly-report";

export const Route = createFileRoute("/_authenticated/shift-schedules")({
  head: () => ({ meta: [{ title: "جداول الورديات" }] }), component: ShiftSchedulesPage,
});
const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
function ShiftSchedulesPage() {
  const { isAdmin, isHR } = useAuth();
  const client = useQueryClient();
  const [targetType, setTargetType] = useState<"employee" | "department" | "all">("employee");
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [weekday, setWeekday] = useState("0");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [grace, setGrace] = useState("0");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const employees = useQuery({ queryKey: ["shift-schedule-employees"], queryFn: async () => {
    const { data, error } = await supabase.from("employees").select("id, employee_no, full_name, department_id").eq("status", "active").order("full_name");
    if (error) throw error; return data ?? [];
  }, enabled: isAdmin || isHR });
  const departments = useQuery({ queryKey: ["shift-schedule-departments"], queryFn: async () => {
    const { data, error } = await supabase.from("departments").select("id, name").order("name");
    if (error) throw error; return data ?? [];
  }, enabled: isAdmin || isHR });
  const schedules = useQuery({ queryKey: ["employee-weekly-schedules"], queryFn: async () => {
    return await loadAllRows((from, to) => (supabase as any).from("employee_weekly_schedules")
      .select("id, employee_id, weekday, start_time, end_time, grace_minutes, effective_from, employees(full_name, employee_no)")
      .order("effective_from", { ascending: false }).order("weekday").range(from, to)) as any[];
  }, enabled: isAdmin || isHR });
  const save = async () => {
    const targetEmployees = targetType === "all"
      ? employees.data ?? []
      : targetType === "department"
        ? (employees.data ?? []).filter((employee) => employee.department_id === departmentId)
        : (employees.data ?? []).filter((employee) => employee.id === employeeId);
    if (targetType === "employee" && !employeeId) return toast.error("اختر الموظف");
    if (targetType === "department" && !departmentId) return toast.error("اختر القسم");
    if (!targetEmployees.length) return toast.error("لا يوجد موظفون نشطون ضمن النطاق المحدد");
    const days = weekday === "all" ? weekdays.map((_, index) => index) : [Number(weekday)];
    const rows = targetEmployees.flatMap((employee) => days.map((day) => ({
      employee_id: employee.id, weekday: day, start_time: start, end_time: end,
      grace_minutes: Number(grace), effective_from: from,
    })));
    const { error } = await (supabase as any).from("employee_weekly_schedules")
      .upsert(rows, { onConflict: "employee_id,weekday,effective_from" });
    if (error) return toast.error(formatErrorMessage(error));
    toast.success(`تم تطبيق الوردية على ${targetEmployees.length} موظف · ${days.length} يوم`);
    client.invalidateQueries({ queryKey: ["employee-weekly-schedules"] });
  };
  const removeMany = async (ids: string[]) => {
    if (!ids.length || !window.confirm(`حذف ${ids.length} سجل وردية؟`)) return;
    for (let index = 0; index < ids.length; index += 500) {
      const { error } = await (supabase as any).from("employee_weekly_schedules").delete().in("id", ids.slice(index, index + 500));
      if (error) return toast.error(formatErrorMessage(error));
    }
    toast.success("تم حذف الورديات المحددة");
    await client.invalidateQueries({ queryKey: ["employee-weekly-schedules"] });
  };
  const groupedSchedules = (() => {
    const bySignature = new Map<string, any[]>();
    for (const item of schedules.data ?? []) {
      const key = [item.start_time, item.end_time, item.grace_minutes, item.effective_from].join("|");
      bySignature.set(key, [...(bySignature.get(key) ?? []), item]);
    }
    return [...bySignature.entries()].map(([key, items]) => {
      const employeeIds = [...new Set(items.map((item) => item.employee_id))].sort();
      const employeeSignature = employeeIds.join(",");
      const days = [...new Set(items.map((item) => item.weekday))].sort((a, b) => a - b);
      return { key: `${key}|${employeeSignature}`, items, days, employeeIds,
        employees: employeeIds.map((id) => items.find((item) => item.employee_id === id)).filter(Boolean) };
    });
  })();
  if (!isAdmin && !isHR) return <p className="p-8 text-center">هذه الصفحة مخصصة للإدارة والموارد البشرية.</p>;
  return <div dir="rtl" className="space-y-5 p-4">
    <div><h1 className="text-2xl font-bold">جداول الورديات الأسبوعية</h1><p className="text-sm text-muted-foreground">حدد وقت بداية ونهاية دوام كل موظف لكل يوم. تُستخدم أوقات الوردية لحساب التأخير.</p></div>
    <Card><CardHeader><CardTitle>إضافة أو تعديل وردية</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Label>نطاق التطبيق<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={targetType} onChange={(e) => setTargetType(e.target.value as typeof targetType)}><option value="employee">موظف واحد</option><option value="department">قسم كامل</option><option value="all">جميع الموظفين النشطين</option></select></Label>
      {targetType === "employee" && <Label>الموظف<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">اختر موظفاً</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} — {employee.full_name}</option>)}</select></Label>}
      {targetType === "department" && <Label>القسم<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">اختر القسم</option>{(departments.data ?? []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Label>}
      <Label>اليوم<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={weekday} onChange={(e) => setWeekday(e.target.value)}><option value="all">جميع الأيام</option>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></Label>
      <Label>بداية الدوام<Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Label><Label>نهاية الدوام<Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Label>
      <Label>سماح التأخير بالدقائق<Input type="number" min="0" max="240" value={grace} onChange={(e) => setGrace(e.target.value)} /></Label><Label>ساري من تاريخ<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Label>
      <div className="flex items-end"><Button onClick={() => void save()}>حفظ الوردية</Button></div>
    </CardContent></Card>
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>الورديات المسجلة ({groupedSchedules.length})</CardTitle><Button variant="destructive" size="sm" disabled={!schedules.data?.length} onClick={() => void removeMany((schedules.data ?? []).map((item: any) => item.id))}>حذف جميع الورديات</Button></CardHeader><CardContent className="space-y-3">
      {groupedSchedules.map((group) => <section key={group.key} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">وردية {group.items[0].start_time} – {group.items[0].end_time}</h3><p className="mt-1 text-sm text-muted-foreground">الأيام: {group.days.map((day) => weekdays[day]).join("، ")} · سماح {group.items[0].grace_minutes} د · سارية من {group.items[0].effective_from}</p><p className="mt-1 text-sm">مطبقة على {group.employees.length} موظف</p></div><Button variant="destructive" size="sm" onClick={() => void removeMany(group.items.map((item: any) => item.id))}>حذف المجموعة</Button></div>
        <details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-sm font-medium text-primary">عرض الموظفين</summary><ul className="mt-2 grid gap-2 sm:grid-cols-2">{group.employees.map((item: any) => <li key={item.employee_id} className="flex items-center justify-between gap-2 rounded bg-muted/30 px-3 py-2 text-sm"><span>{item.employees?.employee_no} — {item.employees?.full_name}</span><Button variant="ghost" size="sm" onClick={() => void removeMany(group.items.filter((row: any) => row.employee_id === item.employee_id).map((row: any) => row.id))}>حذف الموظف</Button></li>)}</ul></details>
      </section>)}
      {!groupedSchedules.length && <p className="py-8 text-center text-muted-foreground">لا توجد ورديات مسجلة.</p>}
    </CardContent></Card>
  </div>;
}

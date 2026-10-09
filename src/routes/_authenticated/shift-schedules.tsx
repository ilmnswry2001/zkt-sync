import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shift-schedules")({
  head: () => ({ meta: [{ title: "جداول الورديات" }] }), component: ShiftSchedulesPage,
});
const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
function ShiftSchedulesPage() {
  const { isAdmin, isHR } = useAuth();
  const client = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [weekday, setWeekday] = useState("0");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [grace, setGrace] = useState("0");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const employees = useQuery({ queryKey: ["shift-schedule-employees"], queryFn: async () => {
    const { data, error } = await supabase.from("employees").select("id, employee_no, full_name").eq("status", "active").order("full_name");
    if (error) throw error; return data ?? [];
  }, enabled: isAdmin || isHR });
  const schedules = useQuery({ queryKey: ["employee-weekly-schedules"], queryFn: async () => {
    const { data, error } = await (supabase as any).from("employee_weekly_schedules")
      .select("id, employee_id, weekday, start_time, end_time, grace_minutes, effective_from, employees(full_name, employee_no)")
      .order("effective_from", { ascending: false }).order("weekday");
    if (error) throw error; return data ?? [];
  }, enabled: isAdmin || isHR });
  const save = async () => {
    if (!employeeId) return toast.error("اختر الموظف");
    const { error } = await (supabase as any).from("employee_weekly_schedules").upsert({
      employee_id: employeeId, weekday: Number(weekday), start_time: start, end_time: end,
      grace_minutes: Number(grace), effective_from: from,
    }, { onConflict: "employee_id,weekday,effective_from" });
    if (error) return toast.error(error.message);
    toast.success("تم حفظ الوردية"); client.invalidateQueries({ queryKey: ["employee-weekly-schedules"] });
  };
  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("employee_weekly_schedules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    client.invalidateQueries({ queryKey: ["employee-weekly-schedules"] });
  };
  if (!isAdmin && !isHR) return <p className="p-8 text-center">هذه الصفحة مخصصة للإدارة والموارد البشرية.</p>;
  return <div dir="rtl" className="space-y-5 p-4">
    <div><h1 className="text-2xl font-bold">جداول الورديات الأسبوعية</h1><p className="text-sm text-muted-foreground">حدد وقت بداية ونهاية دوام كل موظف لكل يوم. تُستخدم أوقات الوردية لحساب التأخير.</p></div>
    <Card><CardHeader><CardTitle>إضافة أو تعديل وردية</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Label>الموظف<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">اختر موظفاً</option>{(employees.data ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_no} — {employee.full_name}</option>)}</select></Label>
      <Label>اليوم<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={weekday} onChange={(e) => setWeekday(e.target.value)}>{weekdays.map((day, i) => <option key={day} value={i}>{day}</option>)}</select></Label>
      <Label>بداية الدوام<Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Label><Label>نهاية الدوام<Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Label>
      <Label>سماح التأخير بالدقائق<Input type="number" min="0" max="240" value={grace} onChange={(e) => setGrace(e.target.value)} /></Label><Label>ساري من تاريخ<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Label>
      <div className="flex items-end"><Button onClick={() => void save()}>حفظ الوردية</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>الورديات المسجلة</CardTitle></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>اليوم</TableHead><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>السماح</TableHead><TableHead>ساري من</TableHead><TableHead /></TableRow></TableHeader><TableBody>{(schedules.data ?? []).map((item: any) => <TableRow key={item.id}><TableCell>{item.employees?.employee_no} — {item.employees?.full_name}</TableCell><TableCell>{weekdays[item.weekday]}</TableCell><TableCell>{item.start_time}</TableCell><TableCell>{item.end_time}</TableCell><TableCell>{item.grace_minutes} د</TableCell><TableCell>{item.effective_from}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => void remove(item.id)}>حذف</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </div>;
}

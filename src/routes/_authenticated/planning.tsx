import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Banknote, Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { getDefaultWage } from "@/lib/wage-defaults";

export const Route = createFileRoute("/_authenticated/planning")({
  head: () => ({
    meta: [
      { title: "التخطيط — مواقع العمل وأكواد التكلفة" },
      { name: "description", content: "إنشاء مواقع العمل وتحديد كود التكلفة CTR لكل موقع وربط الموظفين به." },
      { property: "og:title", content: "التخطيط — مواقع العمل وأكواد التكلفة" },
      { property: "og:description", content: "إدارة مواقع العمل وأكواد التكلفة CTR." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanningPage,
});

type Site = {
  id: string; name: string; ctr_code: string; client: string | null; location: string | null;
  description: string | null; start_date: string | null; end_date: string | null; status: string; site_admin_employee_id: string | null;
};

function PlanningPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("name");
      if (error) throw error;
      return data as Site[];
    },
  });

  const { data: counts = {} } = useQuery({
    queryKey: ["site-emp-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("site_id");
      const map: Record<string, number> = {};
      (data ?? []).forEach((e: any) => { if (e.site_id) map[e.site_id] = (map[e.site_id] ?? 0) + 1; });
      return map;
    },
  });
  const { data: siteAdmins = [] } = useQuery({
    queryKey: ["site-administrators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, full_name, employee_no, position, site_id").eq("status", "active").order("full_name");
      if (error) throw error;
      return (data ?? []).filter((employee: any) => /ادار|إدار|site\s*admin|administrator/i.test(employee.position ?? ""));
    },
  });
  const { data: costData = { employees: [], rates: [] } } = useQuery({
    queryKey: ["site-employee-costs"],
    queryFn: async () => {
      const [employeesResult, ratesResult] = await Promise.all([
        (supabase as any).from("employees").select("id, site_id, position, wage_rate_id, base_salary, wage_rates(title, monthly_rate, daily_rate, currency)").eq("status", "active"),
        supabase.from("wage_rates").select("title, monthly_rate, daily_rate, currency"),
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (ratesResult.error) throw ratesResult.error;
      return { employees: (employeesResult.data ?? []) as any[], rates: (ratesResult.data ?? []) as any[] };
    },
  });
  const siteEmployees = costData.employees;
  const siteSummary = useMemo(() => {
    const result: Record<string, { employees: number; monthly: number; daily: number; specialties: Record<string, number> }> = {};
    const wagesByTitle = new Map(costData.rates.map((rate: any) => [rate.title.trim(), rate]));
    for (const employee of siteEmployees) {
      if (!employee.site_id) continue;
      const linkedWage = Array.isArray(employee.wage_rates) ? employee.wage_rates[0] : employee.wage_rates;
      const rawWage = linkedWage ?? wagesByTitle.get(employee.position?.trim());
      const defaults = getDefaultWage(rawWage?.title ?? employee.position ?? "");
      const wage = rawWage ? {
        ...rawWage,
        daily_rate: Number(rawWage.daily_rate) > 0 ? rawWage.daily_rate : defaults.daily_rate,
        monthly_rate: Number(rawWage.monthly_rate) > 0 ? rawWage.monthly_rate : defaults.monthly_rate,
      } : defaults;
      const monthly = Number(employee.base_salary) > 0 ? Number(employee.base_salary) : Number(wage.monthly_rate);
      const daily = Number(wage.daily_rate ?? (monthly ? monthly / 26 : 0));
      const current = result[employee.site_id] ?? { employees: 0, monthly: 0, daily: 0, specialties: {} };
      current.employees += 1;
      current.monthly += monthly;
      current.daily += daily;
      const specialty = wage?.title ?? employee.position ?? "بدون تخصص / أجر";
      current.specialties[specialty] = (current.specialties[specialty] ?? 0) + 1;
      result[employee.site_id] = current;
    }
    return result;
  }, [costData.rates, siteEmployees]);
  const totalMonthly = Object.values(siteSummary).reduce((sum, item) => sum + item.monthly, 0);

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editing) { const { error } = await supabase.from("sites").update(d).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("sites").insert(d); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("sites").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">التخطيط</h1>
          <p className="text-muted-foreground mt-1">مواقع العمل وأكواد التكلفة (CTR) — {sites.length} موقع</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" /> موقع جديد</Button></DialogTrigger>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "تعديل موقع" : "موقع عمل جديد"}</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => (f.get(k) as string)?.trim() || null;
                const siteAdminId = v("site_admin_employee_id");
                if (!siteAdminId) { toast.error("اختيار إداري الموقع مطلوب"); return; }
                save.mutate({
                  name: f.get("name") as string,
                  ctr_code: (f.get("ctr_code") as string).trim(),
                  client: v("client"), location: v("location"), description: v("description"),
                  start_date: v("start_date"), end_date: v("end_date"),
                  status: f.get("status") as string,
                  site_admin_employee_id: siteAdminId,
                });
              }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="col-span-2"><Label>اسم الموقع</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div><Label>كود التكلفة CTR</Label><Input name="ctr_code" required defaultValue={editing?.ctr_code} className="font-mono" /></div>
              <div><Label>الجهة / العميل</Label><Input name="client" defaultValue={editing?.client ?? ""} /></div>
              <div><Label>الموقع الجغرافي</Label><Input name="location" defaultValue={editing?.location ?? ""} /></div>
              <div>
                <Label>الحالة</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="planned">مخطط</SelectItem>
                    <SelectItem value="completed">منتهي</SelectItem>
                    <SelectItem value="suspended">متوقف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>تاريخ البدء</Label><Input type="date" name="start_date" defaultValue={editing?.start_date ?? ""} /></div>
              <div><Label>تاريخ الانتهاء</Label><Input type="date" name="end_date" defaultValue={editing?.end_date ?? ""} /></div>
              <div className="col-span-2">
                <Label>إداري الموقع المسؤول عن التقرير *</Label>
                <Select name="site_admin_employee_id" defaultValue={editing?.site_admin_employee_id ?? "none"}>
                  <SelectTrigger><SelectValue placeholder="اختر إداري الموقع" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر إداري الموقع —</SelectItem>
                    {siteAdmins.map((employee: any) => <SelectItem key={employee.id} value={employee.id}>{employee.full_name} — {employee.employee_no}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!siteAdmins.length && <p className="text-xs text-warning mt-1">لا يوجد موظف مصنف كمسمى «إداري موقع».</p>}
              </div>
              <div className="col-span-2"><Label>وصف</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
              <Button type="submit" className="col-span-2">حفظ</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="rounded-xl bg-primary p-3"><Users className="w-5 h-5 text-white" /></div><div><p className="text-sm text-muted-foreground">إجمالي الموظفين بالمواقع</p><p className="text-2xl font-bold">{Object.values(siteSummary).reduce((sum, item) => sum + item.employees, 0)}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><div className="rounded-xl bg-emerald-600 p-3"><Banknote className="w-5 h-5 text-white" /></div><div><p className="text-sm text-muted-foreground">التكلفة الشهرية التقديرية</p><p className="text-2xl font-bold">{totalMonthly.toLocaleString()} د.ع</p></div></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">قاعدة الحساب</p><p className="font-semibold mt-1">الراتب الأساسي، ثم أجر التخصص الافتراضي عند عدم وجود راتب خاص</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>مواقع العمل</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>كود التكلفة</TableHead><TableHead>الموقع</TableHead><TableHead>التخصصات العاملة</TableHead>
                <TableHead>إداري الموقع</TableHead><TableHead>الموظفون</TableHead><TableHead>التكلفة الشهرية</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-semibold">{s.ctr_code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-1 max-w-xs">{Object.entries(siteSummary[s.id]?.specialties ?? {}).map(([title, count]) => <Badge key={title} variant="outline">{title} ({count})</Badge>)}{!siteSummary[s.id]?.employees && <span className="text-muted-foreground">لا يوجد موظفون</span>}</div></TableCell>
                  <TableCell>{(siteAdmins as any[]).find((employee) => employee.id === s.site_admin_employee_id)?.full_name ?? <span className="text-warning">غير محدد</span>}</TableCell>
                  <TableCell>{siteSummary[s.id]?.employees ?? (counts as any)[s.id] ?? 0}</TableCell>
                  <TableCell className="font-semibold">{(siteSummary[s.id]?.monthly ?? 0).toLocaleString()} د.ع</TableCell>
                  <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف الموقع؟")) del.mutate(s.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!sites.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لا توجد مواقع بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

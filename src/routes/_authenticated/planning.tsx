import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, ClipboardList, Loader2, MapPinned, Users, WalletCards } from "lucide-react";
import { getEmployeeSiteCost, createWageRateTitleMap } from "@/lib/site-costs";

export const Route = createFileRoute("/_authenticated/planning")({
  head: () => ({ meta: [{ title: "التخطيط وتكلفة المشاريع" }] }),
  component: PlanningDashboard,
});

type Site = { id: string; name: string; ctr_code: string; client: string | null; location: string | null; description: string | null; status: string; site_admin_employee_id: string | null };
type Employee = { id: string; site_id: string | null; full_name: string; position: string | null; wage_rate_id: string | null; base_salary: number | null; daily_wage: number | null };
type Plan = { id: string; site_id: string; site_name: string; request_date: string; status: string; requested_by_name: string | null; specialties: any[]; final_plan: any; };
type Wage = { title: string; monthly_rate: number | null; daily_rate: number | null; currency: string | null };

const statusLabel: Record<string, string> = { requested: "مرسلة", planning_approved: "معتمدة تخطيطياً", management_review: "قيد توزيع الكوادر", finalized: "نهائية" };

function Stat({ title, value, icon: Icon, tone }: { title: string; value: string | number; icon: typeof Users; tone: string }) {
  return <Card><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-xl p-3 ${tone}`}><Icon className="h-5 w-5 text-white" /></div><div><p className="text-xs text-muted-foreground">{title}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>;
}

function PlanningDashboard() {
  const { roles, canAccessSection, isAdmin, isHR } = useAuth();
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const canViewCosts = canAccessSection("/planning") && (isAdmin || isHR || roles.some((role) => ["supervisor", "department_manager"].includes(role)));
  const query = useQuery({
    queryKey: ["planning-cost-dashboard"],
    queryFn: async () => {
      const [sitesResult, employeesResult, wagesResult, plansResult] = await Promise.all([
        supabase.from("sites").select("id, name, ctr_code, client, location, description, status, site_admin_employee_id").order("name"),
        (supabase as any).from("employees").select("id, site_id, full_name, position, wage_rate_id, base_salary, daily_wage").eq("status", "active"),
        supabase.from("wage_rates").select("title, monthly_rate, daily_rate, currency").order("title"),
        supabase.from("site_work_plans").select("id, site_id, site_name, request_date, status, requested_by_name, specialties, final_plan").order("request_date", { ascending: false }),
      ]);
      if (sitesResult.error) throw sitesResult.error;
      if (employeesResult.error) throw employeesResult.error;
      if (wagesResult.error) throw wagesResult.error;
      if (plansResult.error) throw plansResult.error;
      return { sites: (sitesResult.data ?? []) as Site[], employees: (employeesResult.data ?? []) as Employee[], wages: (wagesResult.data ?? []) as Wage[], plans: (plansResult.data ?? []) as Plan[] };
    },
    enabled: canViewCosts,
  });
  const data = query.data ?? { sites: [], employees: [], wages: [], plans: [] };
  const wageMap = useMemo(() => createWageRateTitleMap(data.wages), [data.wages]);
  const employeesBySite = useMemo(() => {
    const map = new Map<string, Employee[]>();
    for (const employee of data.employees) if (employee.site_id) map.set(employee.site_id, [...(map.get(employee.site_id) ?? []), employee]);
    return map;
  }, [data.employees]);
  const plansBySite = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const plan of data.plans) map.set(plan.site_id, [...(map.get(plan.site_id) ?? []), plan]);
    return map;
  }, [data.plans]);
  const siteCards = useMemo(() => data.sites.map((site) => {
    const employees = employeesBySite.get(site.id) ?? [];
    const cost = employees.reduce((sum, employee) => sum + getEmployeeSiteCost({ ...employee, wage_rates: null }, wageMap).monthly, 0);
    const daily = employees.reduce((sum, employee) => sum + getEmployeeSiteCost({ ...employee, wage_rates: null }, wageMap).daily, 0);
    return { site, employees, monthly: cost, daily, plans: plansBySite.get(site.id) ?? [] };
  }), [data.sites, employeesBySite, plansBySite, wageMap]);
  const totalMonthly = siteCards.reduce((sum, card) => sum + card.monthly, 0);
  const totalDaily = siteCards.reduce((sum, card) => sum + card.daily, 0);

  if (!canViewCosts) return <Card><CardContent className="p-8 text-center text-muted-foreground">لا تملك صلاحية الدخول إلى قسم التخطيط وتكلفة المشاريع.</CardContent></Card>;
  return <div dir="rtl" className="space-y-6">
    <div><div className="flex items-center gap-2"><BarChart3 className="h-7 w-7 text-primary" /><h1 className="text-3xl font-bold">التخطيط</h1></div><p className="mt-1 text-muted-foreground">متابعة الخطط المرسلة وتكلفة المشاريع والمواقع التابعة لها.</p></div>
    <Tabs defaultValue="plans" className="space-y-5">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:w-fit sm:grid-cols-2"><TabsTrigger value="plans" className="min-h-11 rounded-full border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><ClipboardList className="ml-2 h-4 w-4" /> الخطط المرسلة</TabsTrigger><TabsTrigger value="costs" className="min-h-11 rounded-full border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"><WalletCards className="ml-2 h-4 w-4" /> تكلفة المشاريع</TabsTrigger></TabsList>
      <TabsContent value="plans" className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat title="إجمالي الخطط" value={data.plans.length} icon={ClipboardList} tone="bg-primary" /><Stat title="خطط مرسلة" value={data.plans.filter((p) => p.status === "requested").length} icon={BarChart3} tone="bg-amber-600" /><Stat title="خطط نهائية" value={data.plans.filter((p) => p.status === "finalized").length} icon={ClipboardList} tone="bg-emerald-600" /><Stat title="المواقع" value={data.sites.length} icon={MapPinned} tone="bg-indigo-600" /></div>
        {query.isLoading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.plans.map((plan) => <Card key={plan.id}><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="font-bold">{plan.site_name}</h3><p className="text-xs text-muted-foreground">{plan.request_date} · {plan.requested_by_name || "حساب غير محدد"}</p></div><Badge>{statusLabel[plan.status] ?? plan.status}</Badge></div><p className="text-sm text-muted-foreground">التخصصات المطلوبة: {Array.isArray(plan.specialties) ? plan.specialties.filter((item) => Number(item.quantity) > 0).length : 0}</p></CardContent></Card>)}</div>}
      </TabsContent>
      <TabsContent value="costs" className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat title="المواقع" value={siteCards.length} icon={MapPinned} tone="bg-primary" /><Stat title="الموظفون بالمواقع" value={data.employees.length} icon={Users} tone="bg-indigo-600" /><Stat title="التكلفة الشهرية" value={`${totalMonthly.toLocaleString()} د.ع`} icon={WalletCards} tone="bg-emerald-600" /><Stat title="التكلفة اليومية" value={`${totalDaily.toLocaleString()} د.ع`} icon={BarChart3} tone="bg-amber-600" /></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{siteCards.map((card) => <button key={card.site.id} type="button" className="text-right" onClick={() => setSelectedSite(card.site)}><Card className="h-full transition hover:-translate-y-1 hover:border-primary hover:shadow-lg"><CardHeader><div className="flex items-start justify-between gap-2"><CardTitle className="text-lg">{card.site.name}</CardTitle><Badge variant="outline">{card.site.ctr_code}</Badge></div><p className="text-sm text-muted-foreground">المهندس المسؤول: {data.employees.find((e) => e.id === card.site.site_admin_employee_id)?.full_name || "غير محدد"}</p></CardHeader><CardContent className="grid grid-cols-3 gap-2 text-center text-sm"><div><Users className="mx-auto mb-1 h-4 w-4 text-primary" /><b>{card.employees.length}</b><p className="text-xs text-muted-foreground">موظف</p></div><div><WalletCards className="mx-auto mb-1 h-4 w-4 text-emerald-600" /><b>{card.monthly.toLocaleString()}</b><p className="text-xs text-muted-foreground">شهري</p></div><div><ClipboardList className="mx-auto mb-1 h-4 w-4 text-amber-600" /><b>{card.plans.length}</b><p className="text-xs text-muted-foreground">خطط</p></div></CardContent></Card></button>)}</div></TabsContent>
    </Tabs>
    <Dialog open={!!selectedSite} onOpenChange={(open) => !open && setSelectedSite(null)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{selectedSite?.name} — تفاصيل المشروع</DialogTitle></DialogHeader>{selectedSite && (() => { const card = siteCards.find((item) => item.site.id === selectedSite.id); if (!card) return null; return <div className="space-y-5"><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat title="الموظفون" value={card.employees.length} icon={Users} tone="bg-primary" /><Stat title="شهري" value={`${card.monthly.toLocaleString()} د.ع`} icon={WalletCards} tone="bg-emerald-600" /><Stat title="يومي" value={`${card.daily.toLocaleString()} د.ع`} icon={BarChart3} tone="bg-amber-600" /><Stat title="الخطط" value={card.plans.length} icon={ClipboardList} tone="bg-indigo-600" /></div><div className="rounded-xl border p-4"><p><b>CTR:</b> {card.site.ctr_code}</p><p><b>العميل:</b> {card.site.client || "غير محدد"}</p><p><b>الموقع الجغرافي:</b> {card.site.location || "غير محدد"}</p><p><b>الوصف:</b> {card.site.description || "لا يوجد"}</p><p><b>المهندس المسؤول:</b> {data.employees.find((e) => e.id === card.site.site_admin_employee_id)?.full_name || "غير محدد"}</p></div><div><h3 className="mb-2 font-bold">خطط الموقع</h3><div className="space-y-2">{card.plans.length ? card.plans.map((plan) => <div key={plan.id} className="flex items-center justify-between rounded-lg border p-3"><span>{plan.request_date} · {plan.requested_by_name || "حساب غير محدد"}</span><Badge>{statusLabel[plan.status] ?? plan.status}</Badge></div>) : <p className="text-sm text-muted-foreground">لا توجد خطط مرسلة لهذا الموقع.</p>}</div></div></div>; })()}</DialogContent></Dialog>
  </div>;
}

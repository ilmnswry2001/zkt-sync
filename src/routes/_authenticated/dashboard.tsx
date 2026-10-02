import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getDailyReport } from "@/lib/attendance.functions";
import { getMonthlySheet } from "@/lib/reports.functions";
import { loadAllRows } from "@/lib/monthly-report";
import { createWageRateTitleMap, getEmployeeSiteCost, type EmployeeCostRow, type WageRateCostRow } from "@/lib/site-costs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Activity, AlertTriangle, Banknote, CalendarClock, CircleDollarSign, ClipboardCheck, FileSignature, Fingerprint, MapPinned, RefreshCw, ShieldAlert, Users, UserCheck } from "lucide-react";
import { ResponsiveContainer, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "لوحة التحكم" }] }),
  beforeLoad: async () => {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw redirect({ to: "/auth" });

    const [rolesResult, formRoleResult] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userData.user.id),
      supabase.from("form_role_assignments").select("role").eq("user_id", userData.user.id).eq("role", "ceo"),
    ]);
    const isAdmin = (rolesResult.data ?? []).some((item) => item.role === "admin");
    const isCompanyManager = (formRoleResult.data ?? []).some((item) => item.role === "ceo");
    if (!isAdmin && !isCompanyManager) throw redirect({ to: "/attendance" });
  },
  component: Dashboard,
});

function StatCard({ title, value, icon: Icon, detail, loading }: {
  title: string;
  value: number | string;
  icon: typeof Users;
  detail?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex min-h-28 items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{title}</p>
          {loading ? <div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" /> : <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>}
          {!loading && detail && <div className="mt-2">{detail}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

const refreshInterval = 120_000;
const formatCount = (value: number) => value.toLocaleString("ar-IQ");
const formatIQD = (value: number) => `${Math.round(value).toLocaleString("ar-IQ")} د.ع`;
const formatDateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" })
  : "لم تتم المزامنة بعد";
const monthStart = (value: string) => `${value}-01`;
const monthEnd = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};
const isDeviceConnected = (status: string, lastSyncAt: string | null, nowMs: number) => {
  if (status !== "active" || !lastSyncAt) return false;
  const syncTime = new Date(lastSyncAt).getTime();
  return Number.isFinite(syncTime) && nowMs - syncTime <= 86400000;
};

function Dashboard() {
  const { isAdmin, isCompanyManager, permissionsLoading } = useAuth();
  const canView = isAdmin || isCompanyManager;
  const dailyFn = useServerFn(getDailyReport);
  const monthlyFn = useServerFn(getMonthlySheet);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const month = today.slice(0, 7);
  const activeEmployeesQuery = useQuery({
    queryKey: ["executive-dashboard", "active-employees"],
    queryFn: async () => {
      const [employees, ratesResult] = await Promise.all([
        loadAllRows((from, to) => supabase
          .from("employees")
          .select("id, employee_no, pay_type, site_id, position, base_salary, wage_rates(title, monthly_rate, daily_rate)")
          .eq("status", "active")
          .order("id")
          .range(from, to)),
        supabase.from("wage_rates").select("title, monthly_rate, daily_rate"),
      ]);
      if (ratesResult.error) throw ratesResult.error;
      const wageMap = createWageRateTitleMap((ratesResult.data ?? []) as WageRateCostRow[]);
      const active = employees as (EmployeeCostRow & { id: string; employee_no: string; pay_type: string; site_id: string | null })[];
      return {
        total: active.length,
        monthly: active.filter((employee) => employee.pay_type !== "daily").length,
        daily: active.filter((employee) => employee.pay_type === "daily").length,
        monthlySiteCost: active.filter((employee) => employee.site_id)
          .reduce((sum, employee) => sum + getEmployeeSiteCost(employee, wageMap).monthly, 0),
      };
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const dailyQuery = useQuery({
    queryKey: ["daily", today],
    queryFn: () => dailyFn({ data: { date: today } }),
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const monthlyQuery = useQuery({
    queryKey: ["monthly", "sheet", month],
    queryFn: () => monthlyFn({ data: { month } }),
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const previousMonth = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 7);
  const needsPreviousMonth = Number(today.slice(8, 10)) <= 6;
  const previousMonthQuery = useQuery({
    queryKey: ["monthly", "sheet", previousMonth],
    queryFn: () => monthlyFn({ data: { month: previousMonth } }),
    enabled: canView && needsPreviousMonth,
    refetchInterval: refreshInterval,
  });
  const trendDates = useMemo(() => Array.from({ length: 7 }, (_, index) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (6 - index) * 86400000).toISOString().slice(0, 10),
  ), [today]);
  const trend = useMemo(() => trendDates.map((date) => {
    const report = date.slice(0, 7) === month ? monthlyQuery.data : previousMonthQuery.data;
    const dayIndex = report?.dates.indexOf(date) ?? -1;
    const activeRows = report?.rows.filter((row) => row.employee.status === "active") ?? [];
    const present = activeRows.filter((row) => row.days[dayIndex]?.status === "present").length;
    return {
      day: new Date(`${date}T00:00:00Z`).toLocaleDateString("ar-IQ", { weekday: "short", day: "numeric", timeZone: "UTC" }),
      rate: activeRows.length ? Math.round((present / activeRows.length) * 100) : 0,
      hasData: dayIndex >= 0 && activeRows.some((row) => row.days[dayIndex]?.status !== null),
    };
  }), [month, monthlyQuery.data, previousMonthQuery.data, trendDates]);
  const trendIsLoading = monthlyQuery.isLoading || (needsPreviousMonth && previousMonthQuery.isLoading);
  const sitesQuery = useQuery({
    queryKey: ["executive-dashboard", "sites-reports", today],
    queryFn: async () => {
      const [sitesResult, reportsResult] = await Promise.all([
        supabase.from("sites").select("id").eq("status", "active"),
        supabase.from("site_daily_reports").select("site_id").eq("report_date", today),
      ]);
      if (sitesResult.error) throw sitesResult.error;
      if (reportsResult.error) throw reportsResult.error;
      const activeIds = new Set((sitesResult.data ?? []).map((site) => site.id));
      const reportedIds = new Set((reportsResult.data ?? []).map((report) => report.site_id).filter((id) => activeIds.has(id)));
      return { active: activeIds.size, reported: reportedIds.size, missing: Math.max(0, activeIds.size - reportedIds.size) };
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const devicesQuery = useQuery({
    queryKey: ["executive-dashboard", "devices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("devices").select("id, name, status, last_sync_at").order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const formsQuery = useQuery({
    queryKey: ["executive-dashboard", "pending-forms"],
    queryFn: async () => {
      const { count, error } = await supabase.from("forms").select("id", { count: "exact", head: true }).in("status", ["pending_manager", "pending_ceo", "pending_execution"]);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const tasksQuery = useQuery({
    queryKey: ["executive-dashboard", "team-tasks", today],
    queryFn: async () => {
      const [totalResult, completedResult] = await Promise.all([
        supabase.from("employee_tasks").select("id", { count: "exact", head: true }).eq("task_date", today).is("archived_at", null),
        supabase.from("employee_tasks").select("id", { count: "exact", head: true }).eq("task_date", today).is("archived_at", null).eq("status", "completed"),
      ]);
      if (totalResult.error) throw totalResult.error;
      if (completedResult.error) throw completedResult.error;
      return { total: totalResult.count ?? 0, completed: completedResult.count ?? 0 };
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const penaltiesQuery = useQuery({
    queryKey: ["executive-dashboard", "penalties", month],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("employee_penalties")
        .select("id, penalty_type, executed_at")
        .gte("penalty_date", monthStart(month))
        .lte("penalty_date", monthEnd(month));
      if (error) throw error;
      const rows = (data ?? []) as { penalty_type: string; executed_at: string | null }[];
      return {
        total: rows.length,
        absence: rows.filter((row) => row.penalty_type === "absence").length,
        deduction: rows.filter((row) => row.penalty_type === "deduction").length,
        warning: rows.filter((row) => row.penalty_type === "warning").length,
        executed: rows.filter((row) => row.executed_at).length,
        pending: rows.filter((row) => !row.executed_at).length,
      };
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });
  const companyReportQuery = useQuery({
    queryKey: ["executive-dashboard", "company-report-latest"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_daily_reports")
        .select("report_date, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
    enabled: canView,
    refetchInterval: refreshInterval,
  });

  const queryList = [activeEmployeesQuery, dailyQuery, monthlyQuery, previousMonthQuery, sitesQuery, devicesQuery, formsQuery, tasksQuery, penaltiesQuery, companyReportQuery];
  const updatedAt = Math.max(0, ...queryList.map((query) => query.dataUpdatedAt));
  const activeDevices = (devicesQuery.data ?? []).filter((device) => device.status === "active");
  const staleDevices = activeDevices.filter((device) => !isDeviceConnected(device.status, device.last_sync_at, now.getTime()));
  const connectedDevices = activeDevices.length - staleDevices.length;
  const inactiveDevices = (devicesQuery.data ?? []).length - activeDevices.length;
  const dailyRows = dailyQuery.data?.rows ?? [];
  const presentToday = dailyRows.filter((row) => row.status === "present").length;
  const absentToday = dailyRows.filter((row) => row.status === "absent").length;
  const lateToday = dailyRows.filter((row) => row.late).length;
  const overtimeThisMonth = monthlyQuery.data?.rows.reduce((sum, row) => sum + row.summary.totalOvertimeHours, 0) ?? 0;
  const trendHasData = trend.some((item) => item.hasData);
  const hasQueryError = queryList.some((query) => query.error);
  const errorMessage = queryList.find((query) => query.error)?.error?.message;

  if (permissionsLoading) {
    return <div className="space-y-4"><div className="h-10 w-48 animate-pulse rounded bg-muted" /><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border bg-muted/40" />)}</div></div>;
  }
  if (!canView) {
    return <Card role="alert"><CardContent className="p-8 text-center"><ShieldAlert className="mx-auto mb-3 h-8 w-8 text-destructive" /><h1 className="text-xl font-bold">غير مصرح بالوصول</h1><p className="mt-2 text-sm text-muted-foreground">لوحة التحكم متاحة لمدير النظام ومدير الشركة فقط.</p></CardContent></Card>;
  }

  return (
    <div dir="rtl" className="space-y-6 pb-6">
      <header className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-l from-[#102b46] via-[#12465a] to-[#087d78] px-5 py-6 text-white shadow-xl shadow-teal-950/10 sm:px-8 sm:py-8">
        <div aria-hidden="true" className="absolute -left-16 -top-24 -z-10 h-64 w-64 rounded-full border-[38px] border-white/5" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-teal-100"><Activity className="h-3.5 w-3.5" /> مركز القيادة</div><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">نظرة شاملة على النظام</h1><p className="mt-2 text-sm text-white/70">ملخص تشغيلي محدث للحضور والموارد والمواقع</p></div>
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/80 backdrop-blur"><RefreshCw className="h-4 w-4 text-teal-200" /> آخر تحديث: {updatedAt ? formatDateTime(new Date(updatedAt).toISOString()) : "جارٍ التحميل"}</div>
        </div>
      </header>

      {hasQueryError && <Card role="alert" className="border-destructive/40 bg-destructive/5"><CardContent className="flex items-start gap-2 p-4 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>تعذر تحميل جزء من بيانات اللوحة: {errorMessage ?? "تحقق من اتصال قاعدة البيانات والصلاحيات"}. بقية الأقسام تستمر بعرض بياناتها.</span></CardContent></Card>}

      <section aria-label="إحصاءات سريعة" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="الموظفون النشطون" value={formatCount(activeEmployeesQuery.data?.total ?? 0)} icon={Users} loading={activeEmployeesQuery.isLoading} detail={<div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">شهري: {formatCount(activeEmployeesQuery.data?.monthly ?? 0)}</Badge><Badge variant="outline">أجر يومي: {formatCount(activeEmployeesQuery.data?.daily ?? 0)}</Badge></div>} />
        <StatCard title="حضور اليوم" value={formatCount(presentToday)} icon={UserCheck} loading={dailyQuery.isLoading} detail={<div className="flex flex-wrap gap-2 text-xs"><Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">غائب: {formatCount(absentToday)}</Badge><Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">متأخر: {formatCount(lateToday)}</Badge></div>} />
        <StatCard title="المواقع النشطة" value={formatCount(sitesQuery.data?.active ?? 0)} icon={MapPinned} loading={sitesQuery.isLoading} detail={<div className="space-y-1 text-xs text-muted-foreground"><p>رفع تقرير اليوم: {formatCount(sitesQuery.data?.reported ?? 0)}</p><p>لم ترفع: {formatCount(sitesQuery.data?.missing ?? 0)}</p></div>} />
        <StatCard title="التكلفة الشهرية التقديرية" value={formatIQD(activeEmployeesQuery.data?.monthlySiteCost ?? 0)} icon={CircleDollarSign} loading={activeEmployeesQuery.isLoading} detail={<span className="text-xs text-muted-foreground">بنفس أساس الأجر في التخطيط والمواقع</span>} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]" aria-label="الحضور والأداء">
        <Card className="min-w-0"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-5 w-5 text-primary" /> نسبة الحضور · آخر 7 أيام</CardTitle></CardHeader><CardContent className="h-72">
          {trendIsLoading ? <div className="h-full animate-pulse rounded-lg bg-muted/40" /> : trendHasData ? (
            <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 8, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => [`${value}%`, "الحضور"]} /><Line type="monotone" dataKey="rate" name="الحضور" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: "var(--primary)" }} /></LineChart></ResponsiveContainer>
          ) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">لا توجد سجلات حضور خلال آخر 7 أيام.</div>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-5 w-5 text-primary" /> الوقت الإضافي هذا الشهر</CardTitle></CardHeader><CardContent>
          {monthlyQuery.isLoading ? <div className="h-14 w-28 animate-pulse rounded bg-muted/40" /> : overtimeThisMonth > 0 ? <><p className="text-4xl font-bold tabular-nums">{overtimeThisMonth.toLocaleString("ar-IQ")} <span className="text-lg font-medium">ساعة</span></p><p className="mt-2 text-sm text-muted-foreground">مجموع التقرير الشهري المحسوب من البصمات والاعتمادات لهذا الشهر.</p></> : <p className="text-sm text-muted-foreground">لا توجد ساعات إضافية مسجلة هذا الشهر.</p>}
        </CardContent></Card>
      </section>

      <section aria-label="الأجهزة" className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">الأجهزة</h2><Link to="/devices" className="text-sm font-medium text-primary hover:underline">إدارة الأجهزة</Link></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><StatCard title="متصلة خلال آخر 24 ساعة" value={formatCount(connectedDevices)} icon={Fingerprint} loading={devicesQuery.isLoading} detail={<span className="text-xs text-muted-foreground">حالة نشطة ومزامنة حديثة</span>} /><StatCard title="نشطة ولم تزامن خلال 24 ساعة" value={formatCount(staleDevices.length)} icon={AlertTriangle} loading={devicesQuery.isLoading} detail={<span className="text-xs text-muted-foreground">أجهزة غير نشطة: {formatCount(inactiveDevices)}</span>} /></div>
        {devicesQuery.data?.length === 0 && !devicesQuery.isLoading ? <Card><CardContent className="p-4 text-sm text-muted-foreground">لا توجد أجهزة مسجلة بعد.</CardContent></Card> : staleDevices.length > 0 && <Card className="border-amber-400/60 bg-amber-50/70 dark:bg-amber-950/20"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-200"><AlertTriangle className="h-5 w-5" /> أجهزة لم تزامن منذ أكثر من 24 ساعة</CardTitle></CardHeader><CardContent className="space-y-2">{staleDevices.map((device) => <div key={device.id} className="flex flex-col justify-between gap-1 border-b border-amber-200/70 pb-2 last:border-0 sm:flex-row sm:items-center"><span className="font-medium">{device.name}</span><span className="text-sm text-muted-foreground">آخر مزامنة: {formatDateTime(device.last_sync_at)}</span></div>)}</CardContent></Card>}
        {(devicesQuery.data?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">حالة المزامنة لكل جهاز</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(devicesQuery.data ?? []).map((device) => {
                const isConnected = isDeviceConnected(device.status, device.last_sync_at, now.getTime());
                const isStale = staleDevices.some((staleDevice) => staleDevice.id === device.id);
                return (
                  <div key={device.id} className={`flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center ${isStale ? "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20" : "bg-card"}`}>
                    <div className="flex items-center gap-2"><Badge variant={isConnected ? "default" : "secondary"}>{isConnected ? "متصل" : device.status === "active" ? "غير متصل" : "غير نشط"}</Badge><span className="font-medium">{device.name}</span></div>
                    <span className="text-sm text-muted-foreground">آخر مزامنة: {formatDateTime(device.last_sync_at)}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="العقوبات والموافقات">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-primary" /> العقوبات والتغييب · هذا الشهر</CardTitle></CardHeader><CardContent className="space-y-4">
          {penaltiesQuery.isLoading ? <div className="h-20 animate-pulse rounded bg-muted/40" /> : penaltiesQuery.data?.total ? <><div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">استقطاع</p><p className="mt-1 text-xl font-bold">{formatCount(penaltiesQuery.data.deduction)}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">غياب</p><p className="mt-1 text-xl font-bold">{formatCount(penaltiesQuery.data.absence)}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">إنذار</p><p className="mt-1 text-xl font-bold">{formatCount(penaltiesQuery.data.warning)}</p></div></div><div className="flex flex-wrap gap-2"><Badge className="bg-emerald-600 text-white">منفذة: {formatCount(penaltiesQuery.data.executed)}</Badge><Badge variant="outline">غير منفذة: {formatCount(penaltiesQuery.data.pending)}</Badge></div></> : <p className="text-sm text-muted-foreground">لا توجد عقوبات هذا الشهر.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSignature className="h-5 w-5 text-primary" /> الاستمارات والموافقات</CardTitle></CardHeader><CardContent>
          {formsQuery.isLoading ? <div className="h-14 w-24 animate-pulse rounded bg-muted/40" /> : (formsQuery.data ?? 0) > 0 ? <><p className="text-4xl font-bold tabular-nums">{formatCount(formsQuery.data ?? 0)}</p><p className="mt-2 text-sm text-muted-foreground">استمارة بانتظار موافقة</p></> : <p className="text-sm text-muted-foreground">لا توجد استمارات معلقة بانتظار الموافقة.</p>}
        </CardContent></Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="الفريق والتقارير">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-5 w-5 text-primary" /> مهام الفريق اليوم</CardTitle></CardHeader><CardContent>
          {tasksQuery.isLoading ? <div className="h-14 w-24 animate-pulse rounded bg-muted/40" /> : tasksQuery.data?.total ? <div className="space-y-3"><div className="flex items-baseline gap-2"><strong className="text-4xl">{formatCount(tasksQuery.data.total)}</strong><span className="text-sm text-muted-foreground">مهمة</span><Badge variant="secondary">منجزة {formatCount(tasksQuery.data.completed)}</Badge></div><Progress value={tasksQuery.data.total ? tasksQuery.data.completed / tasksQuery.data.total * 100 : 0} aria-label="نسبة إنجاز مهام اليوم" /></div> : <p className="text-sm text-muted-foreground">لا توجد مهام مسجلة للفريق اليوم.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Banknote className="h-5 w-5 text-primary" /> تقرير الشركة الكامل</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>{companyReportQuery.data ? <><p className="text-sm text-muted-foreground">آخر تقرير موقع تم تحديثه</p><p className="mt-1 font-semibold">{formatDateTime(companyReportQuery.data.updated_at)} · تاريخ التقرير {companyReportQuery.data.report_date}</p></> : companyReportQuery.isLoading ? <p className="text-sm text-muted-foreground">جارٍ قراءة آخر تحديث...</p> : <p className="text-sm text-muted-foreground">لا توجد تقارير مواقع مرفوعة بعد.</p>}</div>
          <Button asChild variant="outline" className="min-h-11"><Link to="/company-report">فتح التقرير الكامل</Link></Button>
        </CardContent></Card>
      </section>
    </div>
  );
}

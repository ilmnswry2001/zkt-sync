import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPinned,
  RefreshCw,
  TriangleAlert,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { getDefaultWage } from "@/lib/wage-defaults";
import { todayInBaghdad } from "@/lib/date-time";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "تكلفة المشاريع" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!data?.some((role) => role.role === "admin" || role.role === "hr")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ProjectsPage,
});

type Project = { id: string; name: string; ctr_code: string };
type ProjectReport = { id: string; site_id: string; report_date: string; notes: string | null };
type ProjectLine = {
  report_id: string;
  kind: string;
  item_name: string;
  total_count: number;
};
type WageRate = { title: string; daily_rate: number; monthly_rate: number; currency: string };
type PlanSpecialty = { specialty: string; quantity: number };
type ProjectPlan = {
  id: string;
  site_id: string;
  status: string;
  specialties: PlanSpecialty[];
  final_plan: { specialties?: PlanSpecialty[] } | null;
  request_date: string;
};
type CrewAssignment = { site_id: string; role_label: string | null };

const today = todayInBaghdad();

function StatCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number | string;
  icon: typeof Users;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectsPage() {
  const [reportDate, setReportDate] = useState(today);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const query = useQuery({
    queryKey: ["projects-dashboard", reportDate],
    queryFn: async () => {
      const [projectsResult, reportsResult, wagesResult, plansResult, crewReportsResult] = await Promise.all([
        supabase.from("sites").select("id, name, ctr_code").order("name").limit(500),
        supabase
          .from("site_daily_reports")
          .select("id, site_id, report_date, notes")
          .eq("report_date", reportDate)
          .order("site_id")
          .limit(500),
        supabase
          .from("wage_rates")
          .select("title, daily_rate, monthly_rate, currency")
          .order("title")
          .limit(500),
        supabase
          .from("site_work_plans")
          .select("id, site_id, status, specialties, final_plan, request_date")
          .eq("status", "finalized")
          .order("request_date", { ascending: false })
          .limit(1000),
        supabase.from("daily_workshop_reports").select("id").eq("report_date", reportDate).limit(1000),
      ]);
      if (projectsResult.error) throw projectsResult.error;
      if (reportsResult.error) throw reportsResult.error;
      if (wagesResult.error) throw wagesResult.error;
      if (plansResult.error) throw plansResult.error;
      if (crewReportsResult.error) throw crewReportsResult.error;

      const reports = (reportsResult.data ?? []) as ProjectReport[];
      const reportIds = reports.map((report) => report.id);
      let lines: ProjectLine[] = [];
      if (reportIds.length) {
        const linesResult = await supabase
          .from("site_daily_report_lines")
          .select("report_id, kind, item_name, total_count")
          .in("report_id", reportIds)
          .limit(5000);
        if (linesResult.error) throw linesResult.error;
        lines = (linesResult.data ?? []) as ProjectLine[];
      }
      const crewReportIds = (crewReportsResult.data ?? []).map((report) => report.id);
      let crewAssignments: CrewAssignment[] = [];
      if (crewReportIds.length) {
        const crewResult = await (supabase as any)
          .from("daily_workshop_report_lines")
          .select("site_id, role_label")
          .in("report_id", crewReportIds)
          .eq("attended", true)
          .not("site_id", "is", null)
          .limit(5000);
        if (crewResult.error) throw crewResult.error;
        crewAssignments = (crewResult.data ?? []) as CrewAssignment[];
      }
      return {
        projects: (projectsResult.data ?? []) as Project[],
        reports,
        lines,
        wages: (wagesResult.data ?? []) as WageRate[],
        plans: (plansResult.data ?? []) as ProjectPlan[],
        crewAssignments,
      };
    },
  });

  const data = query.data ?? {
    projects: [],
    reports: [],
    lines: [],
    wages: [] as WageRate[],
    plans: [] as ProjectPlan[],
    crewAssignments: [] as CrewAssignment[],
  };
  const wageByTitle = useMemo(
    () => new Map(data.wages.map((wage) => [wage.title.trim(), wage])),
    [data.wages],
  );
  const reportByProject = useMemo(
    () => new Map(data.reports.map((report) => [report.site_id, report])),
    [data.reports],
  );
  const linesByReport = useMemo(() => {
    const grouped = new Map<string, ProjectLine[]>();
    for (const line of data.lines) {
      const current = grouped.get(line.report_id) ?? [];
      current.push(line);
      grouped.set(line.report_id, current);
    }
    return grouped;
  }, [data.lines]);
  const finalPlanByProject = useMemo(() => {
    const grouped = new Map<string, ProjectPlan>();
    for (const plan of data.plans) {
      if (!grouped.has(plan.site_id)) grouped.set(plan.site_id, plan);
    }
    return grouped;
  }, [data.plans]);
  const visibleProjects = useMemo(
    () =>
      selectedProjectId === "all"
        ? data.projects
        : data.projects.filter((project) => project.id === selectedProjectId),
    [data.projects, selectedProjectId],
  );
  const projectCards = useMemo(
    () =>
      visibleProjects.map((project) => {
        const report = reportByProject.get(project.id);
        const lines = report ? (linesByReport.get(report.id) ?? []) : [];
        const workerTotal = lines
          .filter((line) => line.kind === "worker_specialty")
          .reduce((sum, line) => sum + Number(line.total_count || 0), 0);
        const equipmentTotal = lines
          .filter((line) => line.kind === "equipment_type")
          .reduce((sum, line) => sum + Number(line.total_count || 0), 0);
        const workerLines = lines.filter((line) => line.kind === "worker_specialty");
        const assignedSpecialties = new Map<string, number>();
        data.crewAssignments
          .filter((line) => line.site_id === project.id)
          .forEach((line) => {
            const name = line.role_label?.trim() || "بدون صفة";
            assignedSpecialties.set(name, (assignedSpecialties.get(name) ?? 0) + 1);
          });
        const specialtyCosts = data.crewAssignments.length > 0
          ? Array.from(assignedSpecialties, ([name, count]) => {
              const wage = wageByTitle.get(name);
              const fallback = getDefaultWage(name);
              const dailyRate = Number(wage?.daily_rate) > 0 ? Number(wage.daily_rate) : Number(wage?.monthly_rate) > 0 ? Number(wage.monthly_rate) / 26 : fallback.daily_rate;
              return { name, count, dailyRate, cost: count * dailyRate, hasRate: Boolean(wage), usedDefault: !wage && fallback.daily_rate > 0 };
            })
          : workerLines.map((line) => {
          const count = Number(line.total_count || 0);
          const wage = wageByTitle.get(line.item_name.trim());
          const fallback = getDefaultWage(line.item_name);
          const dailyRate =
            Number(wage?.daily_rate) > 0
              ? Number(wage.daily_rate)
              : Number(wage?.monthly_rate) > 0
                ? Number(wage.monthly_rate) / 26
                : fallback.daily_rate;
          return {
            name: line.item_name,
            count,
            dailyRate,
            cost: count * dailyRate,
            hasRate: Boolean(wage),
            usedDefault: !wage && fallback.daily_rate > 0,
          };
          });
        const siteDailyCost = specialtyCosts.reduce((sum, item) => sum + item.cost, 0);
        const plan = finalPlanByProject.get(project.id);
        const plannedSpecialties = plan?.final_plan?.specialties?.length
          ? plan.final_plan.specialties
          : (plan?.specialties ?? []);
        const plannedSpecialtyCosts = plannedSpecialties.map((item) => {
          const wage = wageByTitle.get(item.specialty.trim());
          const fallback = getDefaultWage(item.specialty);
          const dailyRate =
            Number(wage?.daily_rate) > 0
              ? Number(wage.daily_rate)
              : Number(wage?.monthly_rate) > 0
                ? Number(wage.monthly_rate) / 26
                : fallback.daily_rate;
          return {
            name: item.specialty,
            count: Number(item.quantity || 0),
            cost: Number(item.quantity || 0) * dailyRate,
          };
        });
        return {
          project,
          report,
          lines,
          workerTotal,
          equipmentTotal,
          specialtyCosts,
          siteDailyCost,
          plan,
          plannedSpecialtyCosts,
          plannedWorkerTotal: plannedSpecialtyCosts.reduce((sum, item) => sum + item.count, 0),
          plannedDailyCost: plannedSpecialtyCosts.reduce((sum, item) => sum + item.cost, 0),
        };
      }),
    [data.crewAssignments, finalPlanByProject, linesByReport, reportByProject, visibleProjects, wageByTitle],
  );
  const workerSpecialties = useMemo(
    () =>
      Array.from(
        new Set(
          projectCards.flatMap((card) =>
            card.lines
              .filter((line) => line.kind === "worker_specialty")
              .map((line) => line.item_name.trim()),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b, "ar")),
    [projectCards],
  );
  const equipmentTypes = useMemo(
    () =>
      Array.from(
        new Set(
          projectCards.flatMap((card) =>
            card.lines
              .filter((line) => line.kind === "equipment_type")
              .map((line) => line.item_name.trim()),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b, "ar")),
    [projectCards],
  );
  const reportedCount = projectCards.filter((card) => card.report).length;
  const missingCount = projectCards.length - reportedCount;
  const workerTotal = projectCards.reduce((sum, card) => sum + card.workerTotal, 0);
  const equipmentTotal = projectCards.reduce((sum, card) => sum + card.equipmentTotal, 0);
  const companyDailyCost = projectCards.reduce((sum, card) => sum + card.siteDailyCost, 0);
  const missingWageCount = projectCards.reduce(
    (sum, card) =>
      sum + card.specialtyCosts.filter((item) => item.count > 0 && !item.hasRate).length,
    0,
  );
  const comparableProjects = projectCards.filter((card) => card.plan && card.report);
  const plannedDailyCost = comparableProjects.reduce((sum, card) => sum + card.plannedDailyCost, 0);
  const comparableDailyCost = comparableProjects.reduce((sum, card) => sum + card.siteDailyCost, 0);
  const dailyCostVariance = comparableDailyCost - plannedDailyCost;
  const sitesWithFinalPlan = projectCards.filter((card) => card.plan).length;

  const refresh = async () => {
    await query.refetch();
    if (!query.error) toast.success("تم تحديث لوحة المشاريع");
  };

  return (
    <div className="space-y-6">
      <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-l from-emerald-950 via-teal-900 to-cyan-900 p-6 text-white shadow-xl shadow-teal-950/15 sm:p-8">
        <div className="pointer-events-none absolute -left-10 -top-16 -z-10 h-64 w-64 rounded-full border border-white/10" />
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-teal-100">
              <WalletCards className="h-4 w-4" /> لوحة التكاليف والتقارير اليومية
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">تكلفة المشاريع</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/70 sm:text-base">
              قارن العمالة المعتمدة في الخطة النهائية بالواقع المسجل في التقارير اليومية لكل مشروع.
            </p>
          </div>
          <Button
            variant="outline"
            className="min-h-11 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            onClick={refresh}
            disabled={query.isFetching}
          >
            {query.isFetching ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="ml-2 h-4 w-4" />
            )}
            {query.isFetching ? "جارٍ التحديث..." : "تحديث البيانات"}
          </Button>
        </div>
      </section>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <div>
            <Label htmlFor="projects-report-date">تاريخ التقرير اليومي</Label>
            <Input
              id="projects-report-date"
              className="mt-1"
              type="date"
              max={today}
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="projects-filter">المشروع / الموقع</Label>
            <select
              id="projects-filter"
              className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              <option value="all">كل المشاريع</option>
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.ctr_code})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {query.error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 p-4 text-destructive">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">تعذر تحميل تقارير المشاريع</p>
              <p className="mt-1 text-sm">{(query.error as Error).message}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                تحقق من تنفيذ Migration تقارير المواقع في Lovable Cloud ثم اضغط تحديث.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          title="إجمالي المشاريع"
          value={projectCards.length}
          icon={MapPinned}
          tone="bg-primary"
        />
        <StatCard
          title="تقارير مرفوعة"
          value={reportedCount}
          icon={CheckCircle2}
          tone="bg-emerald-600"
        />
        <StatCard
          title="لم ترفع تقريراً"
          value={missingCount}
          icon={TriangleAlert}
          tone="bg-amber-600"
        />
        <StatCard title="إجمالي العاملين" value={workerTotal} icon={Users} tone="bg-indigo-600" />
      </div>
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletCards className="h-5 w-5 text-primary" /> مقارنة التكلفة المخططة والمنفذة —{" "}
            {reportDate}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            تقارن الخطة النهائية بتقرير اليوم للمشاريع التي يتوفر لها الاثنان (
            {comparableProjects.length}). تتوفر خطة نهائية لـ {sitesWithFinalPlan} من أصل{" "}
            {projectCards.length} مشاريع.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <StatCard
            title="التكلفة المخططة للعمالة"
            value={`${plannedDailyCost.toLocaleString("ar-IQ")} د.ع`}
            icon={ClipboardList}
            tone="bg-sky-700"
          />
          <StatCard
            title="المنفذة في المشاريع المقارنة"
            value={`${comparableDailyCost.toLocaleString("ar-IQ")} د.ع`}
            icon={WalletCards}
            tone="bg-rose-600"
          />
          <StatCard
            title={
              comparableProjects.length
                ? dailyCostVariance > 0
                  ? "تجاوز عن الخطة"
                  : "أقل من الخطة"
                : "لا توجد مقارنة متاحة"
            }
            value={
              comparableProjects.length
                ? `${Math.abs(dailyCostVariance).toLocaleString("ar-IQ")} د.ع`
                : "—"
            }
            icon={dailyCostVariance > 0 ? TriangleAlert : CheckCircle2}
            tone={dailyCostVariance > 0 ? "bg-amber-600" : "bg-emerald-600"}
          />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          title="إجمالي الآليات والمركبات"
          value={equipmentTotal}
          icon={Truck}
          tone="bg-slate-700"
        />
        <StatCard
          title="نسبة رفع التقارير"
          value={`${projectCards.length ? Math.round((reportedCount / projectCards.length) * 100) : 0}%`}
          icon={ClipboardList}
          tone="bg-teal-600"
        />
      </div>
      {missingWageCount > 0 && (
        <Card className="border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm text-amber-900 dark:text-amber-200">
            توجد {missingWageCount} تخصصات بلا أجر مسجل؛ احتُسبت تكلفتها بالسعر الافتراضي عند توفره.
            حدّث قيمتها من قسم الأجور لتحسين دقة المقارنة.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>التكلفة والتشغيل حسب المشروع — {reportDate}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-8 text-center text-muted-foreground">جارٍ تحميل تقارير المشاريع...</p>
          ) : projectCards.length ? (
            <div dir="rtl" className="space-y-6">
              <div>
                <h3 className="mb-3 text-base font-semibold">مقارنة التكلفة حسب المشروع</h3>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[780px] w-full text-sm">
                    <thead className="bg-muted/60">
                      <tr className="border-b text-right">
                        <th className="px-4 py-3 font-semibold">المشروع</th>
                        <th className="px-4 py-3 text-center font-semibold">الخطة النهائية</th>
                        <th className="px-4 py-3 text-center font-semibold">العمالة المخططة</th>
                        <th className="px-4 py-3 text-center font-semibold">العمالة الفعلية</th>
                        <th className="px-4 py-3 text-center font-semibold">الفرق</th>
                        <th className="px-4 py-3 text-center font-semibold">التقرير اليومي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectCards.map((card) => {
                        const variance = card.siteDailyCost - card.plannedDailyCost;
                        return (
                          <tr
                            key={card.project.id}
                            className="border-b last:border-0 hover:bg-muted/30"
                          >
                            <th className="px-4 py-3 text-right font-medium">
                              {card.project.name}
                              <span className="mr-2 text-xs text-muted-foreground">
                                CTR {card.project.ctr_code}
                              </span>
                            </th>
                            <td className="px-4 py-3 text-center">
                              {card.plan ? (
                                <Badge className="bg-emerald-600">نهائية</Badge>
                              ) : (
                                <Badge variant="outline">غير متوفرة</Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums">
                              {card.plan ? (
                                <>
                                  <b>{card.plannedWorkerTotal}</b>
                                  <span className="block text-xs text-muted-foreground">
                                    {card.plannedDailyCost.toLocaleString("ar-IQ")} د.ع/يوم
                                  </span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums">
                              {card.report ? (
                                <>
                                  <b>{card.workerTotal}</b>
                                  <span className="block text-xs text-muted-foreground">
                                    {card.siteDailyCost.toLocaleString("ar-IQ")} د.ع/يوم
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">لا يوجد تقرير</span>
                              )}
                            </td>
                            <td
                              className={`px-4 py-3 text-center font-semibold tabular-nums ${variance > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}
                            >
                              {card.plan && card.report
                                ? `${variance > 0 ? "+" : "−"}${Math.abs(variance).toLocaleString("ar-IQ")} د.ع`
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {card.report ? (
                                <Badge>مرفوع</Badge>
                              ) : (
                                <Badge variant="destructive">لم يرفع</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-muted/60">
                    <tr className="border-b text-right">
                      <th className="sticky right-0 z-10 min-w-[190px] bg-muted/90 px-4 py-3 text-right font-semibold">
                        التخصص / الموقع
                      </th>
                      {projectCards.map((card) => (
                        <th
                          key={card.project.id}
                          className="min-w-[150px] px-4 py-3 text-center font-semibold"
                        >
                          <div>{card.project.name}</div>
                          <div className="mt-1 text-[11px] font-normal text-muted-foreground">
                            CTR: {card.project.ctr_code}
                          </div>
                          <div className="mt-2">
                            {card.report ? (
                              <Badge className="text-[10px]">تم الرفع</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">
                                لم يرفع
                              </Badge>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="min-w-[130px] px-4 py-3 text-center font-semibold">
                        إجمالي التخصص
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {workerSpecialties.map((specialty) => (
                      <tr
                        key={specialty}
                        className="border-b transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <th className="sticky right-0 z-10 bg-background px-4 py-3 text-right font-medium">
                          {specialty}
                        </th>
                        {projectCards.map((card) => {
                          const item = card.specialtyCosts.find(
                            (cost) => cost.name.trim() === specialty,
                          );
                          return (
                            <td key={card.project.id} className="px-4 py-3 text-center align-top">
                              {item ? (
                                <>
                                  <div className="text-lg font-bold text-indigo-700 dark:text-indigo-300">
                                    {item.count}
                                  </div>
                                  <div
                                    className={
                                      item.hasRate
                                        ? "text-[11px] text-emerald-700 dark:text-emerald-300"
                                        : "text-[11px] text-amber-700 dark:text-amber-300"
                                    }
                                  >
                                    {item.hasRate
                                      ? `${item.cost.toLocaleString()} د.ع`
                                      : item.usedDefault
                                        ? `${item.cost.toLocaleString()} د.ع (افتراضي)`
                                        : "لا يوجد أجر"}
                                  </div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center font-bold">
                          {projectCards.reduce(
                            (sum, card) =>
                              sum +
                              (card.specialtyCosts.find((cost) => cost.name.trim() === specialty)
                                ?.count ?? 0),
                            0,
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-indigo-50/60 font-bold dark:bg-indigo-950/20">
                      <th className="sticky right-0 z-10 bg-indigo-50/90 px-4 py-3 text-right dark:bg-indigo-950/40">
                        إجمالي العاملين
                      </th>
                      {projectCards.map((card) => (
                        <td
                          key={card.project.id}
                          className="px-4 py-3 text-center text-indigo-700 dark:text-indigo-300"
                        >
                          {card.workerTotal}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center text-indigo-700 dark:text-indigo-300">
                        {workerTotal}
                      </td>
                    </tr>
                    <tr className="bg-rose-50/60 font-bold dark:bg-rose-950/20">
                      <th className="sticky right-0 z-10 bg-rose-50/90 px-4 py-3 text-right dark:bg-rose-950/40">
                        تكلفة العاملين اليومية
                      </th>
                      {projectCards.map((card) => (
                        <td
                          key={card.project.id}
                          className="px-4 py-3 text-center text-rose-700 dark:text-rose-300"
                        >
                          {card.siteDailyCost.toLocaleString()} د.ع
                        </td>
                      ))}
                      <td className="px-4 py-3 text-center text-rose-700 dark:text-rose-300">
                        {companyDailyCost.toLocaleString()} د.ع
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Truck className="h-5 w-5" /> الآليات والمركبات
                </h3>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-[700px] w-full text-sm">
                    <thead className="bg-muted/60">
                      <tr className="border-b">
                        <th className="sticky right-0 z-10 min-w-[190px] bg-muted/90 px-4 py-3 text-right font-semibold">
                          الآلية / الموقع
                        </th>
                        {projectCards.map((card) => (
                          <th
                            key={card.project.id}
                            className="min-w-[140px] px-4 py-3 text-center font-semibold"
                          >
                            {card.project.name}
                          </th>
                        ))}
                        <th className="min-w-[120px] px-4 py-3 text-center font-semibold">
                          الإجمالي
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipmentTypes.map((equipment) => (
                        <tr key={equipment} className="border-b last:border-0 hover:bg-muted/30">
                          <th className="sticky right-0 z-10 bg-background px-4 py-3 text-right font-medium">
                            {equipment}
                          </th>
                          {projectCards.map((card) => {
                            const line = card.lines.find(
                              (item) =>
                                item.kind === "equipment_type" &&
                                item.item_name.trim() === equipment,
                            );
                            return (
                              <td
                                key={card.project.id}
                                className="px-4 py-3 text-center text-lg font-bold text-slate-700 dark:text-slate-300"
                              >
                                {line ? Number(line.total_count || 0) : "—"}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-center font-bold">
                            {projectCards.reduce(
                              (sum, card) =>
                                sum +
                                Number(
                                  card.lines.find(
                                    (line) =>
                                      line.kind === "equipment_type" &&
                                      line.item_name.trim() === equipment,
                                  )?.total_count || 0,
                                ),
                              0,
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 bg-slate-50/70 font-bold dark:bg-slate-900/40">
                        <th className="sticky right-0 z-10 bg-slate-50/90 px-4 py-3 text-right dark:bg-slate-900/60">
                          إجمالي الآليات
                        </th>
                        {projectCards.map((card) => (
                          <td key={card.project.id} className="px-4 py-3 text-center">
                            {card.equipmentTotal}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center">{equipmentTotal}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">لا توجد مشاريع أو مواقع متاحة.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

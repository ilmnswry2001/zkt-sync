import { useProjectExecution } from "@/lib/use-project-execution";
import {
  verifiedSpecialtyCosts,
  projectDailyRate,
  projectCostCrew,
} from "@/lib/project-execution-costs";
import { loadAllRows } from "@/lib/monthly-report";
import { ProjectExecutionPanel } from "@/components/ProjectExecutionPanel";
import { WorkshopSitePicker } from "@/components/WorkshopManagementFields";
import { Link } from "@tanstack/react-router";
import { MetricCard, type MetricTone } from "@/components/MetricCard";
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
  MapPinned,
  RefreshCw,
  TriangleAlert,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
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
  const metricTone: MetricTone =
    tone.includes("destructive") || tone.includes("rose")
      ? "destructive"
      : tone.includes("amber")
        ? "warning"
        : tone.includes("emerald")
          ? "success"
          : tone.includes("indigo") || tone.includes("sky") || tone.includes("slate")
            ? "info"
            : "primary";
  return <MetricCard title={title} value={value} icon={Icon} tone={metricTone} />;
}

function ProjectsPage() {
  const [reportDate, setReportDate] = useState(today);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const execution = useProjectExecution(reportDate);
  const query = useQuery({
    queryKey: ["projects-dashboard", reportDate],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [projectsResult, reportsResult, wagesResult, plansResult, workshopAttendance] =
        await Promise.all([
          loadAllRows((a, b) =>
            supabase.from("sites").select("id, name, ctr_code").order("id").range(a, b),
          ).then((data) => ({ data, error: null })),
          loadAllRows((a, b) =>
            supabase
              .from("site_daily_reports")
              .select("id, site_id, report_date, notes")
              .eq("report_date", reportDate)
              .order("site_id")
              .order("id")
              .range(a, b),
          ).then((data) => ({ data, error: null })),
          loadAllRows((a, b) =>
            supabase
              .from("wage_rates")
              .select("title, daily_rate, monthly_rate, currency")
              .order("title")
              .order("id")
              .range(a, b),
          ).then((data) => ({ data, error: null })),
          loadAllRows((a, b) =>
            supabase
              .from("site_work_plans")
              .select("id, site_id, status, specialties, final_plan, request_date")
              .eq("status", "finalized")
              .lte("request_date", reportDate)
              .order("request_date", { ascending: false })
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(a, b),
          ).then((data) => ({ data, error: null })),
          loadAllRows((a, b) =>
            supabase
              .from("daily_workshop_report_lines")
              .select(
                "employee_id,site_id,role_label,daily_workshop_reports!inner(report_date,work_site_id)",
              )
              .eq("attended", true)
              .eq("daily_workshop_reports.report_date", reportDate)
              .order("id")
              .range(a, b),
          ),
        ]);
      if (projectsResult.error) throw projectsResult.error;
      if (reportsResult.error) throw reportsResult.error;
      if (wagesResult.error) throw wagesResult.error;
      if (plansResult.error) throw plansResult.error;

      const reports = (reportsResult.data ?? []) as ProjectReport[];
      const reportIds = reports.map((report) => report.id);
      const lines: ProjectLine[] = [];
      if (reportIds.length) {
        for (let offset = 0; offset < reportIds.length; offset += 100) {
          lines.push(
            ...((await loadAllRows((a, b) =>
              supabase
                .from("site_daily_report_lines")
                .select("report_id,kind,item_name,total_count")
                .in("report_id", reportIds.slice(offset, offset + 100))
                .order("id")
                .range(a, b),
            )) as ProjectLine[]),
          );
        }
      }

      return {
        workshopAttendance,
        projects: (projectsResult.data ?? []) as Project[],
        reports,
        lines,
        wages: (wagesResult.data ?? []) as WageRate[],
        plans: (plansResult.data ?? []) as ProjectPlan[],
      };
    },
  });

  const data = query.data ?? {
    workshopAttendance: [],
    projects: [],
    reports: [],
    lines: [],
    wages: [] as WageRate[],
    plans: [] as ProjectPlan[],
  };
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
  const costCrew = useMemo(
    () => projectCostCrew(execution.data ?? [], data.workshopAttendance),
    [execution.data, data.workshopAttendance],
  );
  const projectCards = useMemo(
    () =>
      visibleProjects.map((project) => {
        const report = reportByProject.get(project.id);
        const lines = report ? (linesByReport.get(report.id) ?? []) : [];
        const equipmentTotal = lines
          .filter((line) => line.kind === "equipment_type")
          .reduce((sum, line) => sum + Number(line.total_count || 0), 0);
        const siteCrewAssignments = costCrew.filter(
          (person) => person.site_id === project.id && !person.conflicting,
        );
        const specialtyCosts = verifiedSpecialtyCosts(siteCrewAssignments, data.wages);
        const siteDailyCost = specialtyCosts.reduce((sum, item) => sum + item.cost, 0);
        const plan = finalPlanByProject.get(project.id);
        const plannedSpecialties = plan?.final_plan?.specialties?.length
          ? plan.final_plan.specialties
          : (plan?.specialties ?? []);
        const plannedSpecialtyCosts = plannedSpecialties.map((item) => {
          const dailyRate = projectDailyRate(item.specialty, data.wages);
          return {
            name: item.specialty,
            count: Number(item.quantity || 0),
            dailyRate,
            cost: Number(item.quantity || 0) * dailyRate,
          };
        });
        const actualBySpecialty = new Map(
          specialtyCosts.map((item) => [item.name.trim().toLocaleLowerCase("ar"), item.count]),
        );
        const plannedCoverage = plannedSpecialtyCosts.map((item) => {
          const actualCount = actualBySpecialty.get(item.name.trim().toLocaleLowerCase("ar")) ?? 0;
          return {
            ...item,
            actualCount,
            coveragePercent:
              item.count > 0 ? Math.min(100, Math.round((actualCount / item.count) * 100)) : 0,
          };
        });
        return {
          project,
          report,
          actualAvailable: execution.isSuccess,
          lines,
          workerTotal: specialtyCosts.reduce((sum, item) => sum + item.count, 0),
          reportedWorkerTotal: lines
            .filter((l) => l.kind === "worker_specialty")
            .reduce((s, l) => s + Number(l.total_count || 0), 0),
          actualWorkerTotal: specialtyCosts.reduce((sum, item) => sum + item.count, 0),
          equipmentTotal,
          specialtyCosts,
          siteDailyCost,
          plan,
          plannedSpecialtyCosts: plannedCoverage,
          plannedWorkerTotal: plannedSpecialtyCosts.reduce((sum, item) => sum + item.count, 0),
          plannedDailyCost: plannedSpecialtyCosts.reduce((sum, item) => sum + item.cost, 0),
        };
      }),
    [
      costCrew,
      execution.isSuccess,
      data.wages,
      finalPlanByProject,
      linesByReport,
      reportByProject,
      visibleProjects,
    ],
  );
  const workerSpecialties = useMemo(
    () =>
      Array.from(
        new Set(projectCards.flatMap((card) => card.specialtyCosts.map((item) => item.name))),
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
  const comparableProjects = projectCards.filter((card) => card.plan && card.actualAvailable);
  const plannedDailyCost = comparableProjects.reduce((sum, card) => sum + card.plannedDailyCost, 0);
  const comparableDailyCost = comparableProjects.reduce((sum, card) => sum + card.siteDailyCost, 0);
  const dailyCostVariance = comparableDailyCost - plannedDailyCost;
  const sitesWithFinalPlan = projectCards.filter((card) => card.plan).length;

  const refresh = async () => {
    const results = await Promise.all([query.refetch(), execution.refetch()]);
    if (results.every((result) => !result.error)) toast.success("تم تحديث لوحة المشاريع");
  };

  if (query.isPending || execution.isPending)
    return (
      <p className="p-8 text-muted-foreground">جارٍ ربط البصمات بالتكليفات والخطط والتكاليف...</p>
    );
  if (query.isError || execution.isError)
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <p className="text-destructive">
            تعذر تحميل بيانات التنفيذ؛ لا يمكن عرض تكلفة موثوقة.{" "}
            {String((query.error ?? execution.error)?.message ?? "")}
          </p>
          <Button onClick={refresh}>إعادة المحاولة</Button>
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-6">
      <header className="operations-banner flex flex-wrap items-center justify-between gap-5 rounded-2xl border bg-card p-6">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">التخطيط / التنفيذ / مراكز التكلفة</p>
          <h1 className="text-3xl font-bold">المشاريع والتكلفة الفعلية</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            تُحمّل أجور الحاضرين على موقع العمل حسب جرد الورش المحفوظ أو الحضور المتحقق بالبصمة.
            تقارير الموقع مرجع للمقارنة ولا تُجمع مرة ثانية مع الأفراد.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/planning">الخطط المعتمدة</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/attendance">الورش وتوزيع الكادر</Link>
          </Button>
          <Button onClick={refresh} disabled={query.isFetching || execution.isFetching}>
            <RefreshCw className="h-4 w-4" />
            تحديث البيانات
          </Button>
        </div>
      </header>

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
            <WorkshopSitePicker
              label="المشروع / الموقع"
              sites={data.projects}
              emptyLabel="كل المشاريع"
              value={selectedProjectId === "all" ? "" : selectedProjectId}
              onChange={(id) => setSelectedProjectId(id || "all")}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              عدم اختيار موقع يعرض جميع المشاريع.
            </p>
          </div>
        </CardContent>
      </Card>

      <ProjectExecutionPanel
        date={reportDate}
        sites={data.projects}
        siteId={selectedProjectId === "all" ? undefined : selectedProjectId}
      />
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
        <StatCard title="الحاضرون المسندون" value={workerTotal} icon={Users} tone="bg-indigo-600" />
      </div>
      <p className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-xs leading-6">
        التكلفة المعروضة تخص الحاضرين المسندين من الجرد أو البصمة وفق جدول الأجور الحالي أو الأجر
        الافتراضي الموضح، ولا تشمل الآليات والمواد. تأخر مزامنة الأجهزة قد يخفض العدد مؤقتاً؛ فرق
        التكلفة لا يثبت وفراً نهائياً قبل اكتمال الحضور.
      </p>
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletCards className="h-5 w-5 text-primary" /> مقارنة التكلفة المخططة والمنفذة —{" "}
            {reportDate}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            تقارن أحدث خطة معتمدة لا تتجاوز التاريخ المحدد بالحضور المسند للموقع (
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
            title="الفعلية في المشاريع المقارنة"
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
            tone={dailyCostVariance > 0 ? "bg-destructive" : "bg-emerald-600"}
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

      <section
        aria-label="مراكز التكلفة وتنفيذ المشاريع"
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {projectCards.map((card) => {
          const variance = card.siteDailyCost - card.plannedDailyCost;
          return (
            <Card key={card.project.id} className="min-w-0 overflow-hidden">
              <CardHeader className="border-b pb-4">
                <p className="font-mono text-xs text-primary" dir="ltr">
                  {card.project.ctr_code || "CTR غير محدد"}
                </p>
                <CardTitle className="pt-2 text-lg leading-7">{card.project.name}</CardTitle>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Badge variant="outline">حضور مسند: {card.actualWorkerTotal}</Badge>
                  <Badge variant="secondary">
                    تقرير الموقع: {card.report ? card.reportedWorkerTotal : "غير مرفوع"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">الخطة المعتمدة</p>
                    <p className="mt-2 font-semibold">
                      {card.plan
                        ? `${card.plannedDailyCost.toLocaleString("ar-IQ")} د.ع`
                        : "لا توجد خطة سارية"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">تكلفة العمالة الفعلية</p>
                    <p className="mt-2 font-bold text-primary">
                      {card.siteDailyCost.toLocaleString("ar-IQ")} د.ع
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                  <span className="text-muted-foreground">
                    المطلوب: {card.plan ? card.plannedWorkerTotal : "—"} · الحضور المسند:{" "}
                    {card.actualWorkerTotal}
                  </span>
                  {card.plan && (
                    <span
                      className={
                        variance > 0
                          ? "text-destructive"
                          : variance < 0
                            ? "text-success"
                            : "text-muted-foreground"
                      }
                    >
                      {variance > 0 ? "زيادة" : variance < 0 ? "فرق أقل من الخطة" : "مطابق للخطة"}:{" "}
                      {Math.abs(variance).toLocaleString("ar-IQ")} د.ع
                    </span>
                  )}
                </div>
                {card.specialtyCosts.some((item) => item.usedDefault) && (
                  <p className="text-xs text-warning">
                    يشمل أجوراً افتراضية؛ راجع جدول الأجور قبل الاعتماد المالي.
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSelectedProjectId(card.project.id);
                    document
                      .getElementById("project-execution-ledger")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  تصفية وتدقيق أفراد CTR
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <details className="space-y-4 rounded-xl border p-3">
        <summary className="cursor-pointer p-2 text-sm font-semibold">
          تفاصيل مقارنة التخصصات والآليات بين المشاريع
        </summary>
        <Card>
          <CardHeader>
            <CardTitle>التكلفة والتشغيل حسب المشروع — {reportDate}</CardTitle>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <p className="py-8 text-center text-muted-foreground">
                جارٍ تحميل تقارير المشاريع...
              </p>
            ) : projectCards.length ? (
              <div dir="rtl" className="space-y-6">
                <div>
                  <h3 className="mb-3 text-base font-semibold">مقارنة التكلفة حسب المشروع</h3>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="min-w-[980px] w-full text-sm">
                      <thead className="bg-muted/60">
                        <tr className="border-b text-right">
                          <th className="px-4 py-3 font-semibold">المشروع</th>
                          <th className="px-4 py-3 text-center font-semibold">الخطة النهائية</th>
                          <th className="px-4 py-3 text-center font-semibold">العمالة المخططة</th>
                          <th className="px-4 py-3 text-center font-semibold">العمالة الفعلية</th>
                          <th className="px-4 py-3 text-center font-semibold">تغطية التخصصات</th>
                          <th className="px-4 py-3 text-center font-semibold">الفرق</th>
                          <th className="px-4 py-3 text-center font-semibold">
                            الحضور المسند والتكلفة
                          </th>
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
                                {card.actualAvailable ? (
                                  <>
                                    <b>{card.actualWorkerTotal}</b>
                                    <span className="block text-xs text-muted-foreground">
                                      تقرير الموقع (مرجع):{" "}
                                      {card.report ? card.reportedWorkerTotal : "غير مرفوع"}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      {card.siteDailyCost.toLocaleString("ar-IQ")} د.ع/يوم
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">لا يوجد حضور مسجل</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {card.plan && card.actualAvailable ? (
                                  <div className="flex min-w-36 flex-col gap-1">
                                    {card.plannedSpecialtyCosts.map((item) => (
                                      <div
                                        key={item.name}
                                        className="flex items-center justify-between gap-2 text-xs"
                                      >
                                        <span className="truncate">{item.name}</span>
                                        <Badge
                                          variant="outline"
                                          className={
                                            item.coveragePercent === 100
                                              ? "shrink-0 text-emerald-700 dark:text-emerald-300"
                                              : "shrink-0 text-amber-700 dark:text-amber-300"
                                          }
                                        >
                                          {item.actualCount}/{item.count} · {item.coveragePercent}%
                                        </Badge>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td
                                className={`px-4 py-3 text-center font-semibold tabular-nums ${variance > 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}
                              >
                                {card.plan && card.actualAvailable
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
              <p className="py-8 text-center text-muted-foreground">
                لا توجد مشاريع أو مواقع متاحة.
              </p>
            )}
          </CardContent>
        </Card>
      </details>
    </div>
  );
}

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
  BarChart3,
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

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "المشاريع" }] }),
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
type WageRate = { title: string; daily_rate: number; currency: string };

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const today = isoDate(new Date());

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
      const [projectsResult, reportsResult, wagesResult] = await Promise.all([
        supabase.from("sites").select("id, name, ctr_code").order("name").limit(500),
        supabase
          .from("site_daily_reports")
          .select("id, site_id, report_date, notes")
          .eq("report_date", reportDate)
          .order("site_id")
          .limit(500),
        supabase.from("wage_rates").select("title, daily_rate, currency").order("title").limit(500),
      ]);
      if (projectsResult.error) throw projectsResult.error;
      if (reportsResult.error) throw reportsResult.error;
      if (wagesResult.error) throw wagesResult.error;

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
      return {
        projects: (projectsResult.data ?? []) as Project[],
        reports,
        lines,
        wages: (wagesResult.data ?? []) as WageRate[],
      };
    },
  });

  const data = query.data ?? { projects: [], reports: [], lines: [], wages: [] as WageRate[] };
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
        const specialtyCosts = workerLines.map((line) => {
          const count = Number(line.total_count || 0);
          const wage = wageByTitle.get(line.item_name.trim());
          return {
            name: line.item_name,
            count,
            dailyRate: Number(wage?.daily_rate ?? 0),
            cost: count * Number(wage?.daily_rate ?? 0),
            hasRate: Boolean(wage),
          };
        });
        const siteDailyCost = specialtyCosts.reduce((sum, item) => sum + item.cost, 0);
        return {
          project,
          report,
          lines,
          workerTotal,
          equipmentTotal,
          specialtyCosts,
          siteDailyCost,
        };
      }),
    [linesByReport, reportByProject, visibleProjects, wageByTitle],
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

  const refresh = async () => {
    await query.refetch();
    if (!query.error) toast.success("تم تحديث لوحة المشاريع");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold">المشاريع</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            لوحة متابعة المشاريع وتقارير المواقع اليومية بشكل مستقل.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
          {query.isFetching ? (
            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="ml-2 h-4 w-4" />
          )}
          {query.isFetching ? "جارٍ التحديث..." : "تحديث"}
        </Button>
      </div>

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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        <StatCard
          title="تكلفة العاملين اليومية"
          value={`${companyDailyCost.toLocaleString()} د.ع`}
          icon={WalletCards}
          tone="bg-rose-600"
        />
      </div>
      {missingWageCount > 0 && (
        <Card className="border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm text-amber-900 dark:text-amber-200">
            توجد {missingWageCount} تخصصات لها أعداد مسجلة دون أجر يومي. افتح قسم الأجور والمكافآت
            ثم اضغط «تهيئة الأجور الافتراضية» أو أضف الأجر يدوياً.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>تقارير المشاريع اليومية — {reportDate}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-8 text-center text-muted-foreground">جارٍ تحميل تقارير المشاريع...</p>
          ) : projectCards.length ? (
            <div dir="rtl" className="space-y-6">
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

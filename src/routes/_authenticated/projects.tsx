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
      const [projectsResult, reportsResult] = await Promise.all([
        supabase.from("sites").select("id, name, ctr_code").order("name").limit(500),
        supabase
          .from("site_daily_reports")
          .select("id, site_id, report_date, notes")
          .eq("report_date", reportDate)
          .order("site_id")
          .limit(500),
      ]);
      if (projectsResult.error) throw projectsResult.error;
      if (reportsResult.error) throw reportsResult.error;

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
      };
    },
  });

  const data = query.data ?? { projects: [], reports: [], lines: [] };
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
        return { project, report, lines, workerTotal, equipmentTotal };
      }),
    [linesByReport, reportByProject, visibleProjects],
  );
  const reportedCount = projectCards.filter((card) => card.report).length;
  const missingCount = projectCards.length - reportedCount;
  const workerTotal = projectCards.reduce((sum, card) => sum + card.workerTotal, 0);
  const equipmentTotal = projectCards.reduce((sum, card) => sum + card.equipmentTotal, 0);

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تقارير المشاريع اليومية — {reportDate}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.isLoading ? (
            <p className="py-8 text-center text-muted-foreground">جارٍ تحميل تقارير المشاريع...</p>
          ) : projectCards.length ? (
            projectCards.map((card) => (
              <div key={card.project.id} className="rounded-xl border p-4">
                <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                  <div>
                    <h2 className="font-semibold">{card.project.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      كود المشروع: {card.project.ctr_code}
                    </p>
                  </div>
                  {card.report ? (
                    <Badge className="w-fit">تم رفع التقرير</Badge>
                  ) : (
                    <Badge variant="destructive" className="w-fit">
                      لم يرفع تقريراً
                    </Badge>
                  )}
                </div>
                {card.report ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right text-muted-foreground">
                          <th className="px-2 py-2">النوع</th>
                          <th className="px-2 py-2">التخصص / الآلية</th>
                          <th className="px-2 py-2">العدد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.lines.map((line) => (
                          <tr
                            key={`${card.project.id}-${line.kind}-${line.item_name}`}
                            className="border-b last:border-0"
                          >
                            <td className="px-2 py-2">
                              {line.kind === "worker_specialty" ? "عاملون" : "آليات ومركبات"}
                            </td>
                            <td className="px-2 py-2 font-medium">{line.item_name}</td>
                            <td className="px-2 py-2">{Number(line.total_count || 0)}</td>
                          </tr>
                        ))}
                        {!card.lines.length && (
                          <tr>
                            <td colSpan={3} className="px-2 py-5 text-center text-muted-foreground">
                              التقرير محفوظ بدون بنود.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {card.report.notes && (
                      <p className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
                        <span className="font-semibold">الملاحظات:</span> {card.report.notes}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    لا يوجد تقرير لهذا المشروع في التاريخ المحدد.
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-muted-foreground">لا توجد مشاريع أو مواقع متاحة.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

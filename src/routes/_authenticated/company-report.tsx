import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart3, FileDown, TriangleAlert } from "lucide-react";
import { printReport } from "@/lib/report-print";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/company-report")({
  head: () => ({ meta: [{ title: "تقرير الشركة الكامل" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!data?.some((role) => role.role === "admin" || role.role === "hr"))
      throw redirect({ to: "/dashboard" });
  },
  component: CompanyReportPage,
});

type Site = { id: string; name: string; ctr_code: string };
type Report = { id: string; site_id: string; report_date: string; notes: string | null };
type Line = {
  report_id: string;
  kind: string;
  item_name: string;
  total_count: number;
  working_count: number;
  idle_count: number;
};
type Aggregate = { kind: string; itemName: string; total: number; working: number; idle: number };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const today = isoDate(new Date());
const addDays = (value: string, amount: number) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
};
const dateList = (from: string, to: string) => {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) dates.push(current);
  return dates;
};

function CompanyReportPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [siteFilter, setSiteFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const query = useQuery({
    queryKey: ["company-report-data", from, to],
    queryFn: async () => {
      const [sitesResult, reportsResult, linesResult] = await Promise.all([
        supabase.from("sites").select("id, name, ctr_code").order("name"),
        supabase
          .from("site_daily_reports")
          .select("id, site_id, report_date, notes")
          .gte("report_date", from)
          .lte("report_date", to),
        supabase
          .from("site_daily_report_lines")
          .select("report_id, kind, item_name, total_count, working_count, idle_count"),
      ]);
      if (sitesResult.error) throw sitesResult.error;
      if (reportsResult.error) throw reportsResult.error;
      if (linesResult.error) throw linesResult.error;
      return {
        sites: (sitesResult.data ?? []) as Site[],
        reports: (reportsResult.data ?? []) as Report[],
        lines: (linesResult.data ?? []) as Line[],
      };
    },
  });
  const data = query.data ?? { sites: [], reports: [], lines: [] };
  const reportsById = useMemo(
    () => new Map(data.reports.map((report) => [report.id, report])),
    [data.reports],
  );
  const filteredReports = useMemo(
    () => data.reports.filter((report) => siteFilter === "all" || report.site_id === siteFilter),
    [data.reports, siteFilter],
  );
  const reportIds = useMemo(
    () => new Set(filteredReports.map((report) => report.id)),
    [filteredReports],
  );
  const aggregate = useMemo<Aggregate[]>(() => {
    const map = new Map<string, Aggregate>();
    data.lines
      .filter(
        (line) =>
          reportIds.has(line.report_id) && (kindFilter === "all" || line.kind === kindFilter),
      )
      .forEach((line) => {
        const key = `${line.kind}:${line.item_name}`;
        const current = map.get(key) ?? {
          kind: line.kind,
          itemName: line.item_name,
          total: 0,
          working: 0,
          idle: 0,
        };
        current.total += Number(line.total_count ?? 0);
        current.working += Number(line.working_count ?? 0);
        current.idle += Number(line.idle_count ?? 0);
        map.set(key, current);
      });
    return [...map.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.itemName.localeCompare(b.itemName, "ar"),
    );
  }, [data.lines, reportIds, kindFilter]);
  const missing = useMemo(
    () =>
      data.sites
        .flatMap((site) =>
          dateList(from, to)
            .filter(
              (date) =>
                !data.reports.some(
                  (report) => report.site_id === site.id && report.report_date === date,
                ),
            )
            .map((date) => ({ site, date })),
        )
        .filter(({ site }) => siteFilter === "all" || site.id === siteFilter),
    [data.sites, data.reports, from, to, siteFilter],
  );
  const total = aggregate.reduce((sum, row) => sum + row.total, 0);
  const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("ar-IQ");
  const exportPdf = () => {
    const rows = aggregate
      .map(
        (row) =>
          `<tr><td>${row.kind === "worker_specialty" ? "عاملون" : "آليات ومركبات"}</td><td>${row.itemName}</td><td>${row.total}</td></tr>`,
      )
      .join("");
    const missingRows = missing
      .map((entry) => `<tr><td>${entry.site.name}</td><td>${formatDate(entry.date)}</td></tr>`)
      .join("");
    const ok = printReport(
      "تقرير الشركة الكامل",
      `<div class="meta"><span><b>من:</b> ${formatDate(from)}</span><span><b>إلى:</b> ${formatDate(to)}</span><span><b>الموقع:</b> ${siteFilter === "all" ? "كل المواقع" : (data.sites.find((site) => site.id === siteFilter)?.name ?? "-")}</span><span><b>النوع:</b> ${kindFilter === "all" ? "الكل" : kindFilter === "worker_specialty" ? "عاملون" : "آليات ومركبات"}</span></div><h2>الجدول المجمّع</h2><table><thead><tr><th>النوع</th><th>البند</th><th>الإجمالي</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="2">الإجمالي الكلي</td><td>${total}</td></tr></tbody></table><h2>مواقع لم ترفع تقرير</h2><table><thead><tr><th>الموقع</th><th>التاريخ</th></tr></thead><tbody>${missingRows || "<tr><td colspan=2>لا توجد مواقع متأخرة</td></tr>"}</tbody></table>`,
    );
    if (!ok) toast.error("اسمح للنوافذ المنبثقة لتصدير التقرير");
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold">تقرير الشركة الكامل</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            تجميع أعداد العاملين والآليات عبر المواقع والفترة المختارة
          </p>
        </div>
        <Button variant="outline" onClick={exportPdf} disabled={query.isLoading}>
          <FileDown className="w-4 h-4 ml-2" />
          تصدير PDF
        </Button>
      </div>
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>من تاريخ</Label>
            <Input type="date" max={today} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>إلى تاريخ</Label>
            <Input type="date" max={today} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>الموقع</Label>
            <select
              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
            >
              <option value="all">كل المواقع</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>نوع البند</Label>
            <select
              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="all">الكل</option>
              <option value="worker_specialty">عاملون</option>
              <option value="equipment_type">آليات ومركبات</option>
            </select>
          </div>
        </CardContent>
      </Card>
      {from > to && (
        <p className="text-destructive">يجب أن يكون تاريخ البداية قبل تاريخ النهاية.</p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>الجدول المجمّع</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-muted-foreground">جارٍ التحميل...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>التخصص / الآلية</TableHead>
                  <TableHead>الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregate.map((row) => (
                  <TableRow key={`${row.kind}-${row.itemName}`}>
                    <TableCell>
                      <Badge variant="outline">
                        {row.kind === "worker_specialty" ? "عاملون" : "آليات"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.itemName}</TableCell>
                    <TableCell>{row.total}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-accent">
                  <TableCell colSpan={2}>الإجمالي الكلي</TableCell>
                  <TableCell>{total}</TableCell>
                </TableRow>
                {!aggregate.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      لا توجد تقارير ضمن الفلاتر الحالية
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card className="border-warning/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-warning-foreground">
            <TriangleAlert className="w-5 h-5 text-warning" /> مواقع لم ترفع تقرير ({missing.length}
            )
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            تظهر كل حالة غياب تقرير حسب الموقع والتاريخ، ولا يتم تجاهلها ضمن التجميع.
          </p>
        </CardHeader>
        <CardContent>
          {missing.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموقع</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missing.map((entry) => (
                  <TableRow key={`${entry.site.id}-${entry.date}`}>
                    <TableCell className="font-medium">{entry.site.name}</TableCell>
                    <TableCell>{formatDate(entry.date)}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">لم يرفع</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-success">
              كل المواقع رفعت تقاريرها خلال الفترة المحددة.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

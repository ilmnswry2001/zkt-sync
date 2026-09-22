import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDailyReport } from "@/lib/attendance.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ClipboardList,
  FileDown,
  FileText,
  HardHat,
  Pencil,
  Save,
  Trash2,
  Truck,
  UsersRound,
} from "lucide-react";
import { printReport } from "@/lib/report-print";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "التقارير اليومية" }] }),
  component: AttendancePage,
});

type ReportType = "workers" | "equipment";
type CatalogKind = "worker_specialty" | "equipment_type";
type Site = { id: string; name: string; ctr_code?: string | null };
type CatalogItem = {
  id: string;
  kind: CatalogKind;
  name: string;
  sort_order: number;
  is_archived: boolean;
};
type ReportLine = {
  id: string;
  catalog_item_id: string | null;
  kind: CatalogKind;
  item_name: string;
  total_count: number;
  working_count: number;
  idle_count: number;
};
type SiteReport = {
  id: string;
  site_id: string;
  report_date: string;
  notes: string | null;
  lines: ReportLine[];
};
type AttendanceRow = {
  employee_no: string;
  full_name: string;
  department?: string | null;
  check_in: string | null;
  check_out: string | null;
  hours: number;
  devices?: number | string | null;
  status: string;
};
const today = new Date().toISOString().slice(0, 10);

function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"attendance" | "sites">("sites");
  const [date, setDate] = useState(today);
  const [siteId, setSiteId] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ReportLine[]>([]);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const fn = useServerFn(getDailyReport);
  const sitesQuery = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites")
        .select("id, name, ctr_code")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Site[];
    },
  });
  const catalogQuery = useQuery({
    queryKey: ["report-catalogs", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_catalog_items")
        .select("id, kind, name, sort_order, is_archived")
        .order("kind")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
  });
  const reportsQuery = useQuery({
    queryKey: ["site-daily-reports"],
    queryFn: async () => {
      const { data: reports, error } = await supabase
        .from("site_daily_reports")
        .select("id, site_id, report_date, notes")
        .order("report_date", { ascending: false });
      if (error) throw error;
      const ids = (reports ?? []).map((report) => report.id);
      if (!ids.length) return [] as SiteReport[];
      const { data: lines, error: linesError } = await supabase
        .from("site_daily_report_lines")
        .select(
          "id, report_id, catalog_item_id, kind, item_name, total_count, working_count, idle_count",
        )
        .in("report_id", ids);
      if (linesError) throw linesError;
      return (reports ?? []).map((report) => ({
        ...report,
        lines: ((lines ?? []) as (ReportLine & { report_id: string })[]).filter(
          (line) => line.report_id === report.id,
        ),
      })) as SiteReport[];
    },
  });
  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const catalogs = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const reports = reportsQuery.data ?? [];
  const activeWorkers = useMemo(
    () => catalogs.filter((item) => item.kind === "worker_specialty" && !item.is_archived),
    [catalogs],
  );
  const activeEquipment = useMemo(
    () => catalogs.filter((item) => item.kind === "equipment_type" && !item.is_archived),
    [catalogs],
  );
  const selectedSite = sites.find((site) => site.id === siteId);
  const existingReport = reports.find(
    (report) => report.site_id === siteId && report.report_date === date,
  );

  const buildRows = useCallback(
    (report?: SiteReport) => {
      const source = [...activeWorkers, ...activeEquipment];
      const existingLines = report?.lines ?? [];
      const result = source.map((item) => {
        const line = existingLines.find(
          (entry) =>
            entry.catalog_item_id === item.id ||
            (entry.kind === item.kind && entry.item_name === item.name),
        );
        return {
          id: line?.id ?? `${item.kind}-${item.id}`,
          catalog_item_id: item.id,
          kind: item.kind,
          item_name: item.name,
          total_count: line?.total_count ?? 0,
          working_count: line?.working_count ?? 0,
          idle_count: line?.idle_count ?? 0,
        };
      });
      existingLines
        .filter(
          (line) =>
            !result.some(
              (entry) =>
                entry.id === line.id ||
                (entry.kind === line.kind && entry.item_name === line.item_name),
            ),
        )
        .forEach((line) => result.push(line));
      return result;
    },
    [activeEquipment, activeWorkers],
  );
  useEffect(() => {
    if (siteId && !catalogQuery.isLoading && !reportsQuery.isLoading) {
      setRows(buildRows(existingReport));
      setNotes(existingReport?.notes ?? "");
      setEditingReportId(existingReport?.id ?? null);
    }
  }, [buildRows, catalogQuery.isLoading, date, existingReport, reportsQuery.isLoading, siteId]);
  useEffect(() => {
    if (!siteId && sites[0]) setSiteId(sites[0].id);
  }, [sites, siteId]);

  const updateCount = (
    id: string,
    field: "total_count" | "working_count" | "idle_count",
    value: string,
  ) =>
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, [field]: Math.max(0, Number(value) || 0) } : row,
      ),
    );
  const saveReport = async () => {
    if (!siteId) return toast.error("اختر الموقع أولاً");
    const { data: header, error: headerError } = await supabase
      .from("site_daily_reports")
      .upsert(
        {
          id: editingReportId ?? undefined,
          site_id: siteId,
          report_date: date,
          notes: notes.trim() || null,
        },
        { onConflict: "site_id,report_date" },
      )
      .select("id")
      .single();
    if (headerError || !header) return toast.error(headerError?.message ?? "تعذر حفظ التقرير");
    const { error: deleteError } = await supabase
      .from("site_daily_report_lines")
      .delete()
      .eq("report_id", header.id);
    if (deleteError) return toast.error(deleteError.message);
    const { error: linesError } = await supabase.from("site_daily_report_lines").insert(
      rows.map((row) => ({
        report_id: header.id,
        catalog_item_id: row.catalog_item_id,
        kind: row.kind,
        item_name: row.item_name,
        total_count: row.total_count,
        working_count: row.kind === "equipment_type" ? row.working_count : 0,
        idle_count: row.kind === "equipment_type" ? row.idle_count : 0,
      })),
    );
    if (linesError) return toast.error(linesError.message);
    setEditingReportId(header.id);
    await queryClient.invalidateQueries({ queryKey: ["site-daily-reports"] });
    toast.success("تم حفظ التقرير بنجاح");
  };
  const editReport = (report: SiteReport) => {
    setSiteId(report.site_id);
    setDate(report.report_date);
    setNotes(report.notes ?? "");
    setRows(buildRows(report));
    setEditingReportId(report.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const deleteReport = async (report: SiteReport) => {
    const reportSite = sites.find((site) => site.id === report.site_id);
    if (
      !window.confirm(
        `هل أنت متأكد من حذف تقرير ${reportSite?.name ?? "الموقع"} بتاريخ ${report.report_date}؟ سيتم حذف جميع بنوده.`,
      )
    )
      return;
    const { error } = await supabase.from("site_daily_reports").delete().eq("id", report.id);
    if (error) return toast.error(error.message);
    await queryClient.invalidateQueries({ queryKey: ["site-daily-reports"] });
    if (editingReportId === report.id) {
      setEditingReportId(null);
      setRows(buildRows());
      setNotes("");
    }
    toast.success("تم حذف التقرير وبنوده");
  };
  const exportDailyPdf = (report: SiteReport | null = existingReport ?? null) => {
    const reportSite = report ? sites.find((site) => site.id === report.site_id) : selectedSite;
    const reportDate = report?.report_date ?? date;
    const reportNotes = report?.notes ?? notes;
    const sourceRows = report?.lines ?? rows;
    const workers = sourceRows.filter((row) => row.kind === "worker_specialty");
    const equipment = sourceRows.filter((row) => row.kind === "equipment_type");
    const table = (list: ReportLine[], label: string) =>
      `<table><thead><tr><th>${label}</th><th>العدد</th></tr></thead><tbody>${list.map((row) => `<tr><td>${row.item_name}</td><td>${row.total_count}</td></tr>`).join("")}</tbody></table>`;
    const ok = printReport(
      "تقرير الموقع اليومي",
      `<div class="meta"><span><b>الموقع:</b> ${reportSite?.name ?? "-"}</span><span><b>التاريخ:</b> ${reportDate}</span></div><h2>العاملون</h2>${table(workers, "التخصص")}<h2>الآليات والمركبات</h2>${table(equipment, "الآلية / المركبة")}${reportNotes ? `<div class="note"><b>الملاحظات:</b> ${reportNotes}</div>` : ""}`,
    );
    if (!ok) toast.error("اسمح للنوافذ المنبثقة لتصدير التقرير");
  };
  const attendance = useQuery({
    queryKey: ["daily", date],
    queryFn: () => fn({ data: { date } }),
    enabled: activeTab === "attendance",
  });
  const attendanceRows = (attendance.data?.rows ?? []) as AttendanceRow[];
  const fmtTime = (value: string | null) =>
    value ? new Date(value).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—";
  const renderRows = (kind: CatalogKind) =>
    rows
      .filter((row) => row.kind === kind)
      .map((row) => (
        <TableRow
          key={row.id}
          className={
            row.catalog_item_id &&
            catalogs.find((item) => item.id === row.catalog_item_id)?.is_archived
              ? "bg-muted/40"
              : ""
          }
        >
          <TableCell className="font-medium">
            {row.item_name}
            {row.catalog_item_id &&
              catalogs.find((item) => item.id === row.catalog_item_id)?.is_archived && (
                <Badge variant="secondary" className="mr-2">
                  قديم مؤرشف
                </Badge>
              )}
          </TableCell>
          <TableCell>
            <Input
              aria-label={`عدد ${row.item_name}`}
              type="number"
              min="0"
              value={row.total_count || ""}
              onChange={(e) => updateCount(row.id, "total_count", e.target.value)}
            />
          </TableCell>
        </TableRow>
      ));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">التقارير اليومية</h1>
        <p className="text-muted-foreground mt-1">تقارير الحضور وأعمال المواقع حسب التاريخ</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => setActiveTab("sites")}
          className={`rounded-xl border p-4 text-right transition ${activeTab === "sites" ? "border-primary bg-accent shadow-sm" : "bg-card hover:bg-muted/50"}`}
        >
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">تقرير المواقع</div>
              <div className="text-xs text-muted-foreground">العاملون والآليات والمركبات</div>
            </div>
          </div>
        </button>
        <button
          onClick={() => setActiveTab("attendance")}
          className={`rounded-xl border p-4 text-right transition ${activeTab === "attendance" ? "border-primary bg-accent shadow-sm" : "bg-card hover:bg-muted/50"}`}
        >
          <div className="flex items-center gap-3">
            <UsersRound className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">الحضور والانصراف</div>
              <div className="text-xs text-muted-foreground">سجلات أجهزة البصمة اليومية</div>
            </div>
          </div>
        </button>
      </div>
      {activeTab === "sites" ? (
        <>
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  {editingReportId ? "تعديل تقرير الموقع" : "إدخال تقرير موقع"}
                </CardTitle>
                {existingReport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportDailyPdf(existingReport)}
                  >
                    <FileDown className="w-4 h-4 ml-2" />
                    تصدير PDF
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>الموقع</Label>
                  <select
                    className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                  >
                    <option value="">اختر الموقع</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                        {site.ctr_code ? ` — ${site.ctr_code}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>تاريخ التقرير</Label>
                  <Input
                    type="date"
                    max={today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <HardHat className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">العاملون</h2>
                  <span className="text-xs text-muted-foreground">كل تخصص نشط يظهر تلقائياً</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التخصص</TableHead>
                      <TableHead className="w-48">العدد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderRows("worker_specialty")}
                    {!activeWorkers.length && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-muted-foreground">
                          أضف التخصصات من إعدادات التقارير
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Truck className="w-5 h-5 text-primary" />
                  <h2 className="font-semibold">الآليات والمركبات</h2>
                  <span className="text-xs text-muted-foreground">
                    الأعداد غير المعبأة تُحفظ كصفر
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الآلية / المركبة</TableHead>
                      <TableHead>العدد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderRows("equipment_type")}
                    {!activeEquipment.length && (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-muted-foreground">
                          أضف أنواع الآليات من إعدادات التقارير
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <div>
                <Label>ملاحظات الموقع (اختياري)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="الأعمال المنجزة أو الملاحظات التشغيلية..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => exportDailyPdf()}>
                  <FileDown className="w-4 h-4 ml-2" />
                  تصدير PDF
                </Button>
                <Button onClick={() => void saveReport()}>
                  <Save className="w-4 h-4 ml-2" />
                  {editingReportId ? "حفظ التعديلات" : "حفظ التقرير"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>التقارير المحفوظة</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموقع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الملاحظات</TableHead>
                    <TableHead className="w-44">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium">
                        {sites.find((site) => site.id === report.site_id)?.name ?? "موقع غير معروف"}
                      </TableCell>
                      <TableCell>{report.report_date}</TableCell>
                      <TableCell className="max-w-xs truncate">{report.notes || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => editReport(report)}
                            aria-label="تعديل"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => exportDailyPdf(report)}
                            aria-label="تصدير PDF"
                          >
                            <FileDown className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void deleteReport(report)}
                            aria-label="حذف"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!reports.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        لا توجد تقارير محفوظة
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 flex items-end gap-4">
              <div>
                <Label>التاريخ</Label>
                <Input
                  type="date"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="flex gap-3 mr-auto">
                <Badge className="bg-success">
                  حاضر: {attendanceRows.filter((row) => row.status === "present").length}
                </Badge>
                <Badge variant="destructive">
                  غائب:{" "}
                  {attendanceRows.length -
                    attendanceRows.filter((row) => row.status === "present").length}
                </Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>تقرير الحضور والانصراف — {date}</CardTitle>
            </CardHeader>
            <CardContent>
              {attendance.isLoading ? (
                <p className="text-muted-foreground">جارٍ التحميل...</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الرقم</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>القسم</TableHead>
                      <TableHead>أول دخول</TableHead>
                      <TableHead>آخر خروج</TableHead>
                      <TableHead>الساعات</TableHead>
                      <TableHead>أجهزة</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceRows.map((row) => (
                      <TableRow key={row.employee_no}>
                        <TableCell>{row.employee_no}</TableCell>
                        <TableCell className="font-medium">{row.full_name}</TableCell>
                        <TableCell>{row.department ?? "-"}</TableCell>
                        <TableCell>{fmtTime(row.check_in)}</TableCell>
                        <TableCell>{fmtTime(row.check_out)}</TableCell>
                        <TableCell>{row.hours > 0 ? row.hours.toFixed(2) : "—"}</TableCell>
                        <TableCell>{row.devices || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={row.status === "present" ? "default" : "destructive"}
                            className={row.status === "present" ? "bg-success" : ""}
                          >
                            {row.status === "present" ? "حاضر" : "غائب"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!attendanceRows.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          لا توجد بيانات لهذا التاريخ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

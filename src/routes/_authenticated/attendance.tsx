import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDailyReport } from "@/lib/attendance.functions";
import { todayInBaghdad } from "@/lib/date-time";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StaffNameChips } from "@/components/StaffNameChips";
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
  ClipboardCheck,
  AlertTriangle,
  FileDown,
  FileText,
  HardHat,
  Pencil,
  Save,
  Trash2,
  Truck,
  UsersRound,
  Smartphone,
} from "lucide-react";
import { printReport } from "@/lib/report-print";
import { toast } from "sonner";
import { readLocalCatalog, type CatalogItem, type CatalogKind } from "@/lib/report-catalog";
import { normalizeStaffAssignments } from "@/lib/planning-staff";
import { DailyWorkshopInventory } from "@/components/DailyWorkshopInventory";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "التقارير اليومية" }] }),
  component: AttendancePage,
});

type ReportType = "workers" | "equipment";
type Site = { id: string; name: string; ctr_code?: string | null };
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
type PublishSummaryItem = {
  specialty: string;
  quantity: number;
  reported: number;
  missing: number;
  color: string;
};
type DailyCrewAssignment = { site_id: string | null; role_label: string | null; attended: boolean };
type AttendanceRow = {
  employee_no: string;
  full_name: string;
  active?: boolean;
  department?: string | null;
  check_in: string | null;
  check_out: string | null;
  hours: number;
  devices?: number | string | null;
  mobile_self?: boolean;
  sources?: string[];
  suspicious?: boolean;
  suspicious_reason?: string | null;
  selfie_url?: string | null;
  late?: boolean;
  status: string;
};
const today = todayInBaghdad();

function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"attendance" | "sites" | "publish" | "inventory">("sites");
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
      if (error || !data?.length) return { items: readLocalCatalog(), usingFallback: true };
      return { items: (data ?? []) as CatalogItem[], usingFallback: false };
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
  const catalogs = useMemo(() => catalogQuery.data?.items ?? [], [catalogQuery.data]);
  const usingCatalogFallback = catalogQuery.data?.usingFallback ?? false;
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
  const finalizedPlanQuery = useQuery({
    queryKey: ["site-finalized-plan-follow-up", siteId],
    queryFn: async () => {
      if (!siteId) return null;
      const { data, error } = await supabase
        .from("site_work_plans")
        .select("*")
        .eq("site_id", siteId)
        .eq("status", "finalized")
        .order("request_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = data?.[0];
      if (!row) return null;
      return {
        id: row.id,
        site_id: row.site_id,
        site_name: row.site_name,
        request_date: row.request_date,
        assigned_staff: normalizeStaffAssignments(row.assigned_staff),
        final_plan: row.final_plan ?? null,
        specialtySummary: Array.isArray((row.final_plan as any)?.specialties)
          ? (row.final_plan as any).specialties
          : Array.isArray(row.specialties)
            ? row.specialties
            : [],
      };
    },
    enabled: activeTab === "publish" && !!siteId,
  });
  const dailyCrewQuery = useQuery<DailyCrewAssignment[]>({
    queryKey: ["daily-crew-assignments", date],
    queryFn: async () => {
      const { data: reports, error } = await supabase
        .from("daily_workshop_reports")
        .select("id")
        .eq("report_date", date);
      if (error) throw error;
      const ids = (reports ?? []).map((report) => report.id);
      if (!ids.length) return [];
      const { data, error: linesError } = await (supabase as any)
        .from("daily_workshop_report_lines")
        .select("site_id, role_label, attended")
        .in("report_id", ids)
        .eq("attended", true)
        .not("site_id", "is", null);
      if (linesError) throw linesError;
      return (data ?? []) as DailyCrewAssignment[];
    },
    enabled: activeTab === "publish" && !!date,
  });

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
        .forEach((line) =>
          result.push({ ...line, catalog_item_id: line.catalog_item_id ?? line.id }),
        );
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
    if (headerError || !header) return toast.error(formatErrorMessage(headerError, "تعذر حفظ التقرير"));
    const { error: deleteError } = await supabase
      .from("site_daily_report_lines")
      .delete()
      .eq("report_id", header.id);
    if (deleteError) return toast.error(formatErrorMessage(deleteError));
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
    if (linesError) return toast.error(formatErrorMessage(linesError));
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
    if (error) return toast.error(formatErrorMessage(error));
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

  const publishSummary = useMemo<PublishSummaryItem[]>(() => {
    const finalizedPlan = finalizedPlanQuery.data;
    if (!finalizedPlan) return [];
    const requiredItems = Array.isArray(finalizedPlan.specialtySummary)
      ? finalizedPlan.specialtySummary
      : [];
    const reportLines = existingReport?.lines ?? [];
    const assignedBySpecialty = new Map<string, number>();
    (dailyCrewQuery.data ?? [])
      .filter((line) => line.site_id === siteId)
      .forEach((line) => {
        const key = line.role_label?.trim() || "بدون صفة";
        assignedBySpecialty.set(key, (assignedBySpecialty.get(key) ?? 0) + 1);
      });
    const totalsByName = new Map<string, number>();
    reportLines.forEach((line) => {
      const key = line.item_name.trim();
      totalsByName.set(key, (totalsByName.get(key) ?? 0) + Number(line.total_count || 0));
    });
    return requiredItems.map((item: any) => {
      const requestedCount = Number(item.quantity ?? 0);
      const reportedCount = (dailyCrewQuery.data?.length ?? 0) > 0
        ? assignedBySpecialty.get(item.specialty?.trim() ?? item.name?.trim() ?? "") ?? 0
        : totalsByName.get(item.specialty?.trim() ?? item.name?.trim() ?? "") ?? 0;
      return {
        specialty: item.specialty ?? item.name ?? "غير محدد",
        quantity: requestedCount,
        reported: reportedCount,
        missing: Math.max(0, requestedCount - reportedCount),
        color: item.color ?? "#ef4444",
      };
    });
  }, [dailyCrewQuery.data, existingReport, finalizedPlanQuery.data, siteId]);
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
      {usingCatalogFallback && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <b>قائمة التخصصات جاهزة:</b> يتم عرض التخصصات المحفوظة محلياً مؤقتاً إلى أن تتم مزامنة
            جداول التقارير مع قاعدة البيانات.
          </div>
        </div>
      )}
      {catalogQuery.error && (
        <p className="text-destructive">تعذر تحميل التخصصات: {catalogQuery.error.message}</p>
      )}
      {reportsQuery.error && (
        <p className="text-destructive">
          تعذر تحميل التقارير المحفوظة: {reportsQuery.error.message}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <button
          onClick={() => setActiveTab("sites")}
          className={`rounded-xl border p-4 text-right transition ${activeTab === "sites" ? "border-primary bg-accent shadow-sm" : "bg-card hover:bg-muted/50"}`}
        >
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">تقرير المواقع</div>
              <div className="text-xs text-muted-foreground">العاملون والآليات</div>
            </div>
          </div>
        </button>
        <button
          onClick={() => setActiveTab("publish")}
          className={`rounded-xl border p-4 text-right transition ${activeTab === "publish" ? "border-primary bg-accent shadow-sm" : "bg-card hover:bg-muted/50"}`}
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">متابعة النشر</div>
              <div className="text-xs text-muted-foreground">
                مقارنة الخطة النهائية بالتقرير اليومي
              </div>
            </div>
          </div>
        </button>
        <button
          onClick={() => setActiveTab("inventory")}
          className={`rounded-xl border p-4 text-right transition ${activeTab === "inventory" ? "border-primary bg-accent shadow-sm" : "bg-card hover:bg-muted/50"}`}
        >
          <div className="flex items-center gap-3">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">الجرد اليومي</div>
              <div className="text-xs text-muted-foreground">حضور كوادر الورش</div>
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
              <div className="text-xs text-muted-foreground">سجلات البصمة</div>
            </div>
          </div>
        </button>
      </div>
      {activeTab === "inventory" ? (
        <DailyWorkshopInventory />
      ) : activeTab === "publish" ? (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              متابعة النشر
            </CardTitle>
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
                      {site.name} {site.ctr_code ? `— ${site.ctr_code}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>تاريخ المتابعة</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            {!siteId ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                اختر موقعًا لعرض متابعة النشر.
              </div>
            ) : finalizedPlanQuery.isLoading ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                جارٍ تحميل الخطة النهائية...
              </div>
            ) : !finalizedPlanQuery.data ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                لا توجد خطة نهائية معتمدة لهذا الموقع حتى الآن.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">الموقع</div>
                    <div className="font-bold mt-1">{finalizedPlanQuery.data.site_name}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">تاريخ الخطة</div>
                    <div className="font-bold mt-1">{finalizedPlanQuery.data.request_date}</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">مطلوب</div>
                    <div className="font-bold mt-1">
                      {publishSummary.reduce((sum, item) => sum + item.quantity, 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">منشور</div>
                    <div className="font-bold mt-1">
                      {publishSummary.reduce((sum, item) => sum + item.reported, 0)}
                    </div>
                  </div>
                </div>

                {(() => {
                  const req = publishSummary.reduce((s, i) => s + i.quantity, 0);
                  const rep = publishSummary.reduce(
                    (s, i) => s + Math.min(i.reported, i.quantity),
                    0,
                  );
                  const extra = publishSummary.reduce(
                    (s, i) => s + Math.max(0, i.reported - i.quantity),
                    0,
                  );
                  const pct = req ? Math.round((rep / req) * 100) : 0;
                  return (
                    <div className="rounded-2xl border bg-card p-4 shadow-sm">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold">مقارنة الخطة النهائية والتقرير المرفوع</h3>
                          <p className="text-xs text-muted-foreground">
                            {existingReport
                              ? `تقرير يوم ${date}`
                              : `لا يوجد تقرير مرفوع ليوم ${date}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-16 w-16 items-center justify-center rounded-full text-sm font-bold"
                            style={{
                              background: `conic-gradient(var(--primary) ${pct * 3.6}deg, var(--muted) 0deg)`,
                            }}
                          >
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card">
                              {pct}%
                            </span>
                          </div>
                          <div className="text-xs space-y-1">
                            <div>نسبة الالتزام بالخطة</div>
                            {extra > 0 && (
                              <div className="text-primary font-semibold">زيادة: {extra}</div>
                            )}
                            <Badge
                              variant={
                                publishSummary.some((i) => i.missing > 0)
                                  ? "destructive"
                                  : "default"
                              }
                            >
                              {publishSummary.some((i) => i.missing > 0) ? "يوجد نقص" : "مكتمل"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {publishSummary.map((item) => {
                          const p = item.quantity
                            ? Math.min(100, Math.round((item.reported / item.quantity) * 100))
                            : 100;
                          const over = item.reported - item.quantity;
                          return (
                            <div
                              key={`${item.specialty}-${item.quantity}`}
                              className="rounded-xl border p-3"
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-medium">{item.specialty}</span>
                                <span
                                  className={
                                    item.missing > 0
                                      ? "text-destructive text-sm font-bold"
                                      : "text-success text-sm font-bold"
                                  }
                                >
                                  {item.missing > 0
                                    ? `ناقص ${item.missing}`
                                    : over > 0
                                      ? `زيادة ${over}`
                                      : "مطابق"}
                                </span>
                              </div>
                              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className={
                                    item.missing > 0
                                      ? "h-full rounded-full bg-destructive"
                                      : "h-full rounded-full bg-success"
                                  }
                                  style={{ width: `${p}%` }}
                                />
                              </div>
                              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                                <span>
                                  الخطة: <b className="text-foreground">{item.quantity}</b>
                                </span>
                                <span>
                                  المرفوع: <b className="text-foreground">{item.reported}</b>
                                </span>
                                <span>{p}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const staffGroups = (finalizedPlanQuery.data.assigned_staff ?? []).filter(
                    (group) => group.names.length > 0,
                  );
                  const staffCount = staffGroups.reduce(
                    (total, group) => total + group.names.length,
                    0,
                  );
                  return (
                    <section className="overflow-hidden rounded-2xl border bg-gradient-to-l from-emerald-50/70 via-background to-teal-50/60 shadow-sm dark:from-emerald-950/20 dark:via-card dark:to-teal-950/20">
                      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                            <UsersRound className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-bold">الكادر المعتمد في الخطة النهائية</h3>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              توزيع الأسماء حسب الاختصاص
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className="w-fit gap-1.5 rounded-full px-3 py-1.5 text-sm"
                        >
                          <UsersRound className="h-4 w-4" />
                          {staffCount.toLocaleString("ar-IQ")} فرد
                        </Badge>
                      </div>
                      {staffGroups.length ? (
                        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">
                          {staffGroups.map((group) => (
                            <article
                              key={group.specialty}
                              className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
                            >
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <h4 className="font-semibold leading-6">{group.specialty}</h4>
                                <Badge variant="outline" className="shrink-0 rounded-full">
                                  {group.names.length.toLocaleString("ar-IQ")} أفراد
                                </Badge>
                              </div>
                              <StaffNameChips names={group.names} />
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="m-4 flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/70 px-4 py-8 text-center sm:m-5">
                          <UsersRound className="mb-2 h-8 w-8 text-muted-foreground/60" />
                          <p className="font-medium">لا يوجد كادر مضاف إلى الخطة النهائية</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            ستظهر الأسماء هنا عند اعتماد توزيع الموظفين.
                          </p>
                        </div>
                      )}
                    </section>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      ) : activeTab === "sites" ? (
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
                <Badge className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                  متأخر: {attendanceRows.filter((row) => row.late).length}
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
                      <TableHead>مصدر الحركة</TableHead>
                      <TableHead>التحقق</TableHead>
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
                        <TableCell><span className="inline-flex items-center gap-1">{row.devices || "—"}{row.mobile_self && <Smartphone className="h-4 w-4 text-cyan-600" aria-label="حضور ذاتي من الهاتف" />}</span></TableCell>
                        <TableCell className="text-xs">{(row.sources ?? []).map((source) => source === "mobile_self" ? "الهاتف" : source === "zk_agent" || source === "zkteco_auto_agent" ? "البرنامج المحلي" : source === "manual" ? "يدوي" : "جهاز البصمة").join("، ") || "—"}</TableCell>
                        <TableCell>{row.suspicious && <div><Badge variant="destructive">مشبوه</Badge>{row.suspicious_reason && <p className="mt-1 max-w-40 text-xs text-destructive">{row.suspicious_reason}</p>}</div>}{row.selfie_url && <a className="mr-1 text-primary underline" href={row.selfie_url} target="_blank" rel="noreferrer">عرض الصورة</a>}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant={row.status === "present" ? "default" : "destructive"}
                              className={row.status === "present" ? "bg-success" : ""}
                            >
                              {row.status === "present" ? "حاضر" : "غائب"}
                            </Badge>
                            {row.late && <Badge className="bg-amber-500 text-white">متأخر</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!attendanceRows.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
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

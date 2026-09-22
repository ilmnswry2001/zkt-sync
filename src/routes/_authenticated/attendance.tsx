import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
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
  HardHat,
  Truck,
  UsersRound,
  Plus,
  Trash2,
  Save,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "التقارير اليومية" }] }),
  component: AttendancePage,
});

type ReportType = "workers" | "equipment";
type Site = { id: string; name: string; ctr_code?: string | null };
type ReportLine = { id: string; category: string; count: number; working?: number; idle?: number };
type SiteReport = {
  id: string;
  siteId: string;
  siteName: string;
  date: string;
  type: ReportType;
  lines: ReportLine[];
  notes: string;
  createdAt: string;
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

const STORAGE_KEY = "zkt-site-daily-reports";
const fallbackSites: Site[] = [
  { id: "site-main", name: "المقر الرئيسي", ctr_code: "HQ" },
  { id: "site-field", name: "موقع الحقل النفطي", ctr_code: "OIL-01" },
  { id: "site-workshop", name: "الورشة المركزية", ctr_code: "WRK-01" },
];
const workerSpecialties = [
  "إدارة وإشراف",
  "مهندس موقع",
  "مهندس ميكانيك",
  "مهندس كهرباء",
  "مهندس مدني",
  "جيولوجي / فني مختبر",
  "فني أجهزة وتحكم",
  "فني صيانة",
  "لحام وفابريكيشن",
  "سائق",
  "مشغل آلية",
  "عامل حفر",
  "عامل خدمات / نظافة",
  "حراسة وأمن",
  "إسعاف وسلامة HSE",
  "أخرى",
];
const equipmentTypes = [
  "حفارة",
  "رافعة",
  "شيول / لودر",
  "بلدوزر",
  "كريدر",
  "قلّاب",
  "صهريج ماء",
  "صهريج وقود",
  "مركبة دفع رباعي",
  "باص نقل",
  "مولدة كهرباء",
  "ضاغطة هواء",
  "معدات رفع",
  "أخرى",
];

function readReports(): SiteReport[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"attendance" | "sites">("sites");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [siteFilter, setSiteFilter] = useState("all");
  const [reportType, setReportType] = useState<ReportType>("workers");
  const [siteId, setSiteId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReportLine[]>([
    { id: crypto.randomUUID(), category: "", count: 0, working: 0, idle: 0 },
  ]);
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [sites, setSites] = useState<Site[]>(fallbackSites);
  const fn = useServerFn(getDailyReport);

  useEffect(() => setReports(readReports()), []);
  useEffect(() => {
    supabase
      .from("sites")
      .select("id, name, ctr_code")
      .order("name")
      .then(({ data }) => {
        if (data?.length) {
          setSites(data as Site[]);
          setSiteId((current) => current || data[0].id);
        }
      });
  }, []);

  const attendance = useQuery({
    queryKey: ["daily", date],
    queryFn: () => fn({ data: { date } }),
    enabled: activeTab === "attendance",
  });
  const attendanceRows = (attendance.data?.rows ?? []) as AttendanceRow[];
  const present = attendanceRows.filter((r) => r.status === "present").length;
  const absent = attendanceRows.length - present;
  const visibleReports = useMemo(
    () =>
      reports.filter((r) => (siteFilter === "all" || r.siteId === siteFilter) && r.date === date),
    [reports, siteFilter, date],
  );
  const selectedSite = sites.find((site) => site.id === siteId);
  const categories = reportType === "workers" ? workerSpecialties : equipmentTypes;

  const addLine = () =>
    setLines((current) => [
      ...current,
      { id: crypto.randomUUID(), category: "", count: 0, working: 0, idle: 0 },
    ]);
  const updateLine = (id: string, patch: Partial<ReportLine>) =>
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  const changeType = (type: ReportType) => {
    setReportType(type);
    setLines([{ id: crypto.randomUUID(), category: "", count: 0, working: 0, idle: 0 }]);
  };
  const saveReport = () => {
    if (!siteId) return toast.error("اختر الموقع أولاً");
    const validLines = lines
      .filter((line) => line.category && line.count > 0)
      .map((line) => ({
        ...line,
        count: Number(line.count),
        working: Number(line.working ?? 0),
        idle: Number(line.idle ?? 0),
      }));
    if (!validLines.length) return toast.error("أضف تخصصاً أو آلية واحدة على الأقل مع العدد");
    const report: SiteReport = {
      id: crypto.randomUUID(),
      siteId,
      siteName: selectedSite?.name ?? "موقع غير معروف",
      date,
      type: reportType,
      lines: validLines,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [report, ...reports];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setReports(next);
    setNotes("");
    setLines([{ id: crypto.randomUUID(), category: "", count: 0, working: 0, idle: 0 }]);
    toast.success("تم حفظ تقرير الموقع بنجاح");
  };
  const fmtTime = (t: string | null) =>
    t ? new Date(t).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">التقارير اليومية</h1>
        <p className="text-muted-foreground mt-1">
          متابعة الحضور وتجميع أعمال المواقع حسب التاريخ والتخصص
        </p>
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
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> إدخال تقرير موقع جديد
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>نوع التقرير</Label>
                  <div className="flex gap-2 mt-1">
                    <Button
                      type="button"
                      variant={reportType === "workers" ? "default" : "outline"}
                      onClick={() => changeType("workers")}
                      className="flex-1"
                    >
                      <HardHat className="w-4 h-4 ml-2" />
                      العاملون
                    </Button>
                    <Button
                      type="button"
                      variant={reportType === "equipment" ? "default" : "outline"}
                      onClick={() => changeType("equipment")}
                      className="flex-1"
                    >
                      <Truck className="w-4 h-4 ml-2" />
                      الآليات والمركبات
                    </Button>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">
                      {reportType === "workers"
                        ? "أعداد العاملين حسب التخصص"
                        : "أعداد الآليات والمركبات"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      يمكنك إضافة أكثر من بند للتقرير نفسه
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="w-4 h-4 ml-1" /> إضافة بند
                  </Button>
                </div>
                {lines.map((line) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_140px_40px] gap-2 items-end"
                  >
                    <div>
                      <Label>{reportType === "workers" ? "التخصص" : "نوع الآلية / المركبة"}</Label>
                      <select
                        className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={line.category}
                        onChange={(e) => updateLine(line.id, { category: e.target.value })}
                      >
                        <option value="">اختر من القائمة</option>
                        {categories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>العدد الكلي</Label>
                      <Input
                        type="number"
                        min="0"
                        value={line.count || ""}
                        onChange={(e) => updateLine(line.id, { count: Number(e.target.value) })}
                      />
                    </div>
                    {reportType === "equipment" && (
                      <>
                        <div>
                          <Label>يعمل</Label>
                          <Input
                            type="number"
                            min="0"
                            value={line.working || ""}
                            onChange={(e) =>
                              updateLine(line.id, { working: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div>
                          <Label>متوقف</Label>
                          <Input
                            type="number"
                            min="0"
                            value={line.idle || ""}
                            onChange={(e) => updateLine(line.id, { idle: Number(e.target.value) })}
                          />
                        </div>
                      </>
                    )}
                    {reportType === "workers" && <div className="hidden md:block" />}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="حذف البند"
                      onClick={() =>
                        setLines((current) => current.filter((item) => item.id !== line.id))
                      }
                      disabled={lines.length === 1}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div>
                <Label>ملاحظات الموقع (اختياري)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="اذكر الأعمال المنجزة أو الملاحظات التشغيلية..."
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={saveReport}>
                  <Save className="w-4 h-4 ml-2" /> حفظ التقرير
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <CardTitle>التقرير الشامل للمواقع — {date}</CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-sm whitespace-nowrap">تصفية حسب الموقع</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={siteFilter}
                    onChange={(e) => setSiteFilter(e.target.value)}
                  >
                    <option value="all">كل المواقع</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {visibleReports.length ? (
                <div className="space-y-4">
                  {visibleReports.map((report) => (
                    <div key={report.id} className="rounded-lg border overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-3">
                        <div className="flex items-center gap-2 font-semibold">
                          {report.type === "workers" ? (
                            <HardHat className="w-4 h-4 text-primary" />
                          ) : (
                            <Truck className="w-4 h-4 text-primary" />
                          )}
                          {report.siteName}
                          <Badge variant="outline">
                            {report.type === "workers" ? "العاملون" : "الآليات والمركبات"}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(report.createdAt).toLocaleTimeString("ar", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              {report.type === "workers" ? "التخصص" : "الآلية / المركبة"}
                            </TableHead>
                            <TableHead>العدد الكلي</TableHead>
                            {report.type === "equipment" && (
                              <>
                                <TableHead>يعمل</TableHead>
                                <TableHead>متوقف</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.lines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell className="font-medium">{line.category}</TableCell>
                              <TableCell>{line.count}</TableCell>
                              {report.type === "equipment" && (
                                <>
                                  <TableCell>
                                    <Badge className="bg-success">{line.working || 0}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary">{line.idle || 0}</Badge>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {report.notes && (
                        <p className="px-4 py-3 text-sm text-muted-foreground border-t">
                          ملاحظات: {report.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-muted-foreground">
                  <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p>لا توجد تقارير مواقع لهذا التاريخ</p>
                  <p className="text-xs mt-1">
                    ابدأ باختيار الموقع وإضافة أعداد العاملين أو الآليات
                  </p>
                </div>
              )}
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
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="flex gap-3 mr-auto">
                <Badge variant="default" className="bg-success">
                  حاضر: {present}
                </Badge>
                <Badge variant="destructive">غائب: {absent}</Badge>
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
                    {attendanceRows.map((r) => (
                      <TableRow key={r.employee_no}>
                        <TableCell className="font-mono">{r.employee_no}</TableCell>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell>{r.department ?? "-"}</TableCell>
                        <TableCell>{fmtTime(r.check_in)}</TableCell>
                        <TableCell>{fmtTime(r.check_out)}</TableCell>
                        <TableCell>{r.hours > 0 ? r.hours.toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-center">{r.devices || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={r.status === "present" ? "default" : "destructive"}
                            className={r.status === "present" ? "bg-success" : ""}
                          >
                            {r.status === "present" ? "حاضر" : "غائب"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!attendanceRows.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  Check,
  Clock3,
  Expand,
  Fingerprint,
  Medal,
  RefreshCw,
  Shield,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { dateKeyInTimeZone } from "@/lib/date-time";

const BADGES = {
  hse_guardian: { label: "نجم السلامة", icon: Shield, tone: "text-emerald-300" },
  punctuality_champion: { label: "بطل الانضباط", icon: Clock3, tone: "text-sky-300" },
  field_hero: { label: "أسد الميدان", icon: Sparkles, tone: "text-amber-300" },
  top_workshop: { label: "الورشة المتصدرة", icon: Trophy, tone: "text-yellow-300" },
} as const;

type BadgeType = keyof typeof BADGES;

const baghdadDate = (date: Date) => dateKeyInTimeZone(date);
const toArabicNumber = (value: number) => value.toLocaleString("ar-IQ");
const formatIQD = (value: number) => `${Math.round(value).toLocaleString("ar-IQ")} د.ع`;
const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
const getDayStart = (date: string) => new Date(`${date}T00:00:00+03:00`).toISOString();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const Route = createFileRoute("/_authenticated/command-center")({
  head: () => ({ meta: [{ title: "مركز العمليات الحي" }] }),
  beforeLoad: async () => {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) throw redirect({ to: "/auth" });

    const [rolesResult, formRoleResult] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userData.user.id),
      supabase
        .from("form_role_assignments")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("role", "ceo"),
    ]);
    const hasAccess =
      !rolesResult.error &&
      !formRoleResult.error &&
      ((rolesResult.data ?? []).some((item) =>
        ["admin", "hr", "supervisor", "data_entry"].includes(item.role),
      ) ||
        (formRoleResult.data ?? []).length > 0);
    if (!hasAccess) throw redirect({ to: "/attendance" });
  },
  component: CommandCenter,
});

function CommandCenter() {
  const { isAdmin, isHR, isCompanyManager, roles, user, permissionsLoading } = useAuth();
  const queryClient = useQueryClient();
  const canView =
    isAdmin ||
    isHR ||
    isCompanyManager ||
    roles.includes("supervisor") ||
    roles.includes("data_entry");
  const canAward = isAdmin || isHR;
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);
  const [targetType, setTargetType] = useState<"employee" | "workshop">("employee");
  const [targetId, setTargetId] = useState("");
  const [badgeType, setBadgeType] = useState<BadgeType>("punctuality_champion");
  const [incentive, setIncentive] = useState("");
  const [notes, setNotes] = useState("");
  const today = baghdadDate(new Date());
  const weekStart = addDays(today, -6);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const boardQuery = useQuery({
    queryKey: ["command-center", today],
    enabled: canView,
    refetchInterval: autoRefresh ? 30_000 : false,
    queryFn: async () => {
      const [
        employeesResult,
        workshopsResult,
        todayLogsResult,
        reportsResult,
        badgesResult,
        sitesResult,
      ] = await Promise.all([
        supabase
          .from("employees")
          .select("id, full_name, position, site_id")
          .eq("status", "active")
          .order("full_name"),
        supabase.from("daily_workshops").select("id, name").eq("is_active", true).order("name"),
        supabase
          .from("attendance_logs")
          .select(
            "id, employee_id, employee_no, site_id, verify_time, source, self_event_type, verify_type, is_liveness_verified",
          )
          .gte("verify_time", getDayStart(today))
          .lt("verify_time", getDayStart(addDays(today, 1)))
          .order("verify_time", { ascending: false }),
        supabase
          .from("daily_workshop_reports")
          .select("id, workshop_id, report_date, created_at, updated_at")
          .gte("report_date", weekStart)
          .lte("report_date", today)
          .order("created_at", { ascending: false }),
        supabase
          .from("gamification_badges")
          .select(
            "id, target_type, target_id, target_name, badge_type, period_month, awarded_at, incentive_iqd, salary_addition_id, notes",
          )
          .order("awarded_at", { ascending: false })
          .limit(30),
        supabase.from("sites").select("id, name").order("name"),
      ]);
      const results = [
        employeesResult,
        workshopsResult,
        todayLogsResult,
        reportsResult,
        badgesResult,
        sitesResult,
      ];
      const queryError = results.find((result) => result.error)?.error;
      if (queryError) throw queryError;

      const workshopIds = (workshopsResult.data ?? []).map((workshop) => workshop.id);
      const reportIds = (reportsResult.data ?? []).map((report) => report.id);
      const [membersResult, linesResult] = await Promise.all([
        workshopIds.length
          ? supabase
              .from("daily_workshop_members")
              .select("workshop_id, employee_id, role_label")
              .eq("is_active", true)
              .in("workshop_id", workshopIds)
          : Promise.resolve({ data: [], error: null }),
        reportIds.length
          ? supabase
              .from("daily_workshop_report_lines")
              .select("report_id, employee_id, employee_name_snapshot, role_label, attended")
              .in("report_id", reportIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (membersResult.error) throw membersResult.error;
      if (linesResult.error) throw linesResult.error;

      return {
        employees: employeesResult.data ?? [],
        workshops: workshopsResult.data ?? [],
        members: membersResult.data ?? [],
        logs: todayLogsResult.data ?? [],
        reports: reportsResult.data ?? [],
        reportLines: linesResult.data ?? [],
        badges: badgesResult.data ?? [],
        sites: sitesResult.data ?? [],
      };
    },
  });

  const awardMutation = useMutation({
    mutationFn: async () => {
      const targetName =
        targetType === "employee"
          ? boardQuery.data?.employees.find((employee) => employee.id === targetId)?.full_name
          : boardQuery.data?.workshops.find((workshop) => workshop.id === targetId)?.name;
      const amount = incentive.trim() ? Number(incentive) : 0;
      if (!targetName) throw new Error("اختر المستهدف أولاً");
      if (targetType === "workshop" && amount > 0) {
        throw new Error("الحافز المالي يصرف لموظف محدد فقط");
      }
      if (!Number.isFinite(amount) || amount < 0) throw new Error("أدخل مبلغ حافز صحيحاً");
      const { data: badge, error: insertError } = await supabase
        .from("gamification_badges")
        .insert({
          target_type: targetType,
          target_id: targetId,
          target_name: targetName,
          badge_type: targetType === "workshop" ? "top_workshop" : badgeType,
          period_month: today.slice(0, 7),
          awarded_by: user?.id,
          incentive_iqd: amount,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      if (amount > 0) {
        const { error: awardError } = await supabase.rpc("award_badge_incentive", {
          p_badge_id: badge.id,
        });
        if (awardError) throw awardError;
      }
    },
    onSuccess: async () => {
      toast.success(
        incentive.trim() && Number(incentive) > 0
          ? "تم تسجيل الوسام وإضافة الحافز إلى سجل الراتب"
          : "تم تسجيل الوسام",
      );
      setAwardOpen(false);
      setTargetId("");
      setIncentive("");
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
    onError: (error) => {
      toast.error(`تعذر إكمال منح الوسام أو الحافز: ${error.message}`);
      void queryClient.invalidateQueries({ queryKey: ["command-center"] });
    },
  });

  const data = boardQuery.data;
  const employees = data?.employees ?? [];
  const workshops = data?.workshops ?? [];
  const members = data?.members ?? [];
  const reportLines = data?.reportLines ?? [];
  const reports = data?.reports ?? [];
  const logs = data?.logs ?? [];
  const activeFieldIds = new Set(
    employees.filter((employee) => employee.site_id).map((employee) => employee.id),
  );
  const presentToday = new Set(
    logs
      .filter(
        (log) =>
          log.employee_id &&
          activeFieldIds.has(log.employee_id) &&
          (log.self_event_type === "check_in" || log.verify_type === 0),
      )
      .map((log) => log.employee_id),
  );
  const fieldAttendance = activeFieldIds.size
    ? Math.round((presentToday.size / activeFieldIds.size) * 100)
    : 0;
  const facialLogs = logs.filter((log) => log.source === "mobile_self");
  const livenessRate = facialLogs.length
    ? Math.round(
        (facialLogs.filter((log) => log.is_liveness_verified).length / facialLogs.length) * 100,
      )
    : 0;
  const todayReports = reports.filter((report) => report.report_date === today);
  const todayCompleted = todayReports.filter((report) => {
    const lineCount = reportLines.filter((line) => line.report_id === report.id).length;
    const rosterCount = members.filter(
      (member) => member.workshop_id === report.workshop_id,
    ).length;
    return rosterCount > 0 && lineCount >= rosterCount;
  }).length;
  const disciplineRate = fieldAttendance;
  const podium = useMemo(() => {
    if (!data) return [];
    return data.workshops
      .map((workshop) => {
        const workshopMembers = data.members.filter((member) => member.workshop_id === workshop.id);
        const workshopReports = data.reports.filter((report) => report.workshop_id === workshop.id);
        const linesByReport = workshopReports.map((report) =>
          data.reportLines.filter((line) => line.report_id === report.id),
        );
        const totalLines = linesByReport.reduce((sum, lines) => sum + lines.length, 0);
        const attendedLines = linesByReport.reduce(
          (sum, lines) => sum + lines.filter((line) => line.attended).length,
          0,
        );
        const attendanceRate = totalLines ? attendedLines / totalLines : 0;
        const rosterSize = workshopMembers.length;
        const reportingCoverage = rosterSize
          ? Math.min(
              1,
              workshopReports.reduce(
                (sum, report, index) => sum + Math.min(1, linesByReport[index].length / rosterSize),
                0,
              ) / 7,
            )
          : 0;
        const reportingSpeed = workshopReports.length
          ? workshopReports.reduce((sum, report) => {
              const reportStart = Date.parse(`${report.report_date}T00:00:00+03:00`);
              const delay = Math.max(0, Date.parse(report.created_at) - reportStart);
              return sum + Math.max(0, 1 - delay / 86_400_000);
            }, 0) / workshopReports.length
          : 0;
        return {
          ...workshop,
          attendanceRate,
          reportingCoverage,
          reportingSpeed,
          score: Math.round(
            (attendanceRate * 0.65 + reportingCoverage * 0.15 + reportingSpeed * 0.2) * 100,
          ),
        };
      })
      .filter((workshop) => workshop.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
  }, [data]);

  const events = useMemo(() => {
    if (!data) return [];
    const siteNames = new Map(data.sites.map((site) => [site.id, site.name]));
    const employeesById = new Map(
      data.employees.map((employee) => [employee.id, employee.full_name]),
    );
    const attendanceEvents = data.logs.slice(0, 12).map((log) => ({
      id: log.id,
      time: log.verify_time,
      text: `${log.source === "mobile_self" ? "حضور ذاتي بالوجه" : "حركة حضور"}: ${employeesById.get(log.employee_id ?? "") ?? log.employee_no}${log.site_id ? ` · ${siteNames.get(log.site_id) ?? "موقع ميداني"}` : ""}`,
      kind: "attendance",
    }));
    const reportEvents = data.reports.slice(0, 12).map((report) => {
      const workshop = data.workshops.find((item) => item.id === report.workshop_id);
      const completed = data.reportLines.filter(
        (line) => line.report_id === report.id && line.attended,
      ).length;
      const total = data.reportLines.filter((line) => line.report_id === report.id).length;
      return {
        id: report.id,
        time: report.updated_at,
        text: `تحديث جرد ${workshop?.name ?? "ورشة"} · ${completed}/${total} عامل`,
        kind: "inventory",
      };
    });
    return [...attendanceEvents, ...reportEvents]
      .sort((left, right) => right.time.localeCompare(left.time))
      .slice(0, 14);
  }, [data]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      toast.error(
        `تعذر تغيير وضع الشاشة الكاملة: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      );
    }
  };

  if (permissionsLoading || (canView && boardQuery.isLoading)) {
    return <div dir="rtl" className="h-72 animate-pulse rounded-3xl bg-slate-900" />;
  }
  if (!canView) {
    return (
      <Card role="alert">
        <CardContent className="p-8 text-center">غير مصرح بالوصول إلى مركز العمليات.</CardContent>
      </Card>
    );
  }

  return (
    <div
      dir="rtl"
      className="command-ticker min-h-[calc(100vh-7rem)] space-y-5 rounded-3xl bg-[#07111d] p-4 text-slate-100 sm:p-6"
    >
      <style>{`@keyframes command-ticker { from { transform: translateX(0); } to { transform: translateX(50%); } } .command-ticker-track { animation: command-ticker 36s linear infinite; } .command-ticker-track:hover { animation-play-state: paused; }`}</style>
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-300/15 bg-slate-900/80 p-4 shadow-[0_0_40px_rgba(8,145,178,0.12)]">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            النظام متصل · {autoRefresh ? "التحديث كل 30 ثانية" : "التحديث التلقائي متوقف"}
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
            مركز العمليات الحي
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            صورة تشغيلية مستندة إلى سجلات الحضور والجرد الفعلية
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            onClick={() => setAutoRefresh((enabled) => !enabled)}
          >
            <Activity className="ms-2 h-4 w-4" />
            التحديث التلقائي {autoRefresh ? "مفعّل" : "متوقف"}
          </Button>
          <Button
            variant="outline"
            className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
            onClick={() => void boardQuery.refetch()}
            aria-label="تحديث البيانات الآن"
          >
            <RefreshCw className={`ms-2 h-4 w-4 ${boardQuery.isFetching ? "animate-spin" : ""}`} />
            تحديث الآن
          </Button>
          <Button
            className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <X className="ms-2 h-4 w-4" /> : <Expand className="ms-2 h-4 w-4" />}
            {isFullscreen ? "إنهاء التكبير" : "شاشة كاملة"}
          </Button>
        </div>
      </header>

      {boardQuery.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/30 bg-rose-950/40 p-3 text-sm text-rose-200"
        >
          تعذر تحميل بيانات مركز العمليات: {boardQuery.error.message}
        </div>
      )}

      <section aria-label="مؤشرات العمليات" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="حضور الكادر الميداني اليوم"
          value={`${toArabicNumber(presentToday.size)} / ${toArabicNumber(activeFieldIds.size)}`}
          detail={`${toArabicNumber(fieldAttendance)}٪ من الموظفين النشطين المخصصين للمواقع`}
          icon={Users}
          progress={fieldAttendance}
          tone="cyan"
        />
        <MetricCard
          title="جرد الورش المكتمل اليوم"
          value={`${toArabicNumber(todayCompleted)} / ${toArabicNumber(workshops.length)}`}
          detail={`${toArabicNumber(todayReports.length)} تقرير جرد مسجل`}
          icon={Check}
          progress={workshops.length ? (todayCompleted / workshops.length) * 100 : 0}
          tone="emerald"
        />
        <MetricCard
          title="حركات الحضور الذاتي بالوجه"
          value={toArabicNumber(facialLogs.length)}
          detail={`نسبة التحقق من الحيوية: ${toArabicNumber(livenessRate)}٪`}
          icon={Fingerprint}
          progress={livenessRate}
          tone="violet"
        />
        <MetricCard
          title="معدل الانضباط اليوم"
          value={`${toArabicNumber(disciplineRate)}٪`}
          detail="مؤشر الحضور للكادر الميداني"
          icon={Activity}
          progress={disciplineRate}
          tone="amber"
          circular
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.55fr_0.85fr]">
        <Card className="border-slate-800 bg-slate-900/75 text-slate-100">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-cyan-300" />
              مصفوفة الورش الميدانية
            </CardTitle>
            <Badge className="border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              {toArabicNumber(workshops.length)} ورشة نشطة
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {workshops.length ? (
              workshops.map((workshop) => {
                const roster = members.filter((member) => member.workshop_id === workshop.id);
                const report = todayReports.find((item) => item.workshop_id === workshop.id);
                const lines = reportLines.filter((line) => line.report_id === report?.id);
                const attended = lines.filter((line) => line.attended).length;
                const progress = roster.length
                  ? Math.min(100, (lines.length / roster.length) * 100)
                  : 0;
                const complete = roster.length > 0 && progress >= 100;
                const specialties = new Map<string, number>();
                for (const member of roster) {
                  const role = member.role_label?.trim() || "غير محدد";
                  specialties.set(role, (specialties.get(role) ?? 0) + 1);
                }
                const latestAttendance = logs.find((log) =>
                  roster.some((member) => member.employee_id === log.employee_id),
                );
                return (
                  <article
                    key={workshop.id}
                    className="rounded-xl border border-slate-800 bg-[#0b1725] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{workshop.name}</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          {report
                            ? `آخر جرد ${formatTime(report.updated_at)}`
                            : latestAttendance
                              ? `آخر حضور ${formatTime(latestAttendance.verify_time)}`
                              : "بانتظار أول حركة"}
                        </p>
                      </div>
                      <Badge
                        className={
                          complete
                            ? "bg-emerald-400/15 text-emerald-300"
                            : lines.length
                              ? "bg-amber-400/15 text-amber-200"
                              : "bg-slate-700 text-slate-300"
                        }
                      >
                        {complete ? "مكتمل" : lines.length ? "جزئي" : "بانتظار الجرد"}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-slate-400">الحضور المسجل</span>
                      <span className="font-semibold tabular-nums">
                        {toArabicNumber(attended)} / {toArabicNumber(roster.length)}
                      </span>
                    </div>
                    <Progress value={progress} className="mt-2 h-2 bg-slate-800" />
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Array.from(specialties, ([label, count]) => (
                        <span
                          key={label}
                          className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
                        >
                          {toArabicNumber(count)} {label}
                        </span>
                      ))}
                      {!roster.length && (
                        <span className="text-xs text-slate-500">لا يوجد كادر مسجل للورشة</span>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">لا توجد ورش نشطة مسجلة.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/75 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-amber-300" />
              منصة الشرف · آخر 7 أيام
            </CardTitle>
            <p className="text-xs text-slate-400">
              الترتيب يجمع حضور تقارير الورش وتغطية الجرد الأسبوعية
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {podium.length ? (
              podium.map((workshop, index) => {
                const medals = ["🥇", "🥈", "🥉"];
                const colors = [
                  "border-amber-300/40 bg-amber-300/10",
                  "border-slate-300/30 bg-slate-300/5",
                  "border-orange-400/30 bg-orange-400/5",
                ];
                return (
                  <div
                    key={workshop.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 ${colors[index]}`}
                  >
                    <span className="text-2xl" aria-label={`المركز ${index + 1}`}>
                      {medals[index]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{workshop.name}</p>
                      <p className="text-xs text-slate-400">
                        الحضور {toArabicNumber(Math.round(workshop.attendanceRate * 100))}٪ · الجرد{" "}
                        {toArabicNumber(Math.round(workshop.reportingCoverage * 100))}٪ · سرعة الرفع{" "}
                        {toArabicNumber(Math.round(workshop.reportingSpeed * 100))}٪
                      </p>
                    </div>
                    <span className="text-lg font-black tabular-nums text-cyan-200">
                      {toArabicNumber(workshop.score)}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="py-7 text-center text-sm text-slate-400">
                تظهر المراكز بعد تسجيل تقارير جرد خلال الأسبوع.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-slate-800 bg-slate-900/75 text-slate-100">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Medal className="h-5 w-5 text-amber-300" />
              أوسمة الأبطال الميدانيين
            </CardTitle>
            {canAward && (
              <Button
                size="sm"
                className="bg-amber-400 text-slate-950 hover:bg-amber-300"
                onClick={() => setAwardOpen(true)}
              >
                <Award className="ms-2 h-4 w-4" />
                منح وسام / حافز
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(data?.badges ?? []).length ? (
              data!.badges.map((badge) => {
                const badgeInfo = BADGES[badge.badge_type as BadgeType];
                const BadgeIcon = badgeInfo?.icon ?? Award;
                return (
                  <article
                    key={badge.id}
                    className="rounded-xl border border-slate-800 bg-[#0b1725] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <BadgeIcon
                        className={`mt-0.5 h-5 w-5 shrink-0 ${badgeInfo?.tone ?? "text-slate-300"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold">{badge.target_name}</p>
                        <p className="mt-1 text-sm text-slate-300">{badgeInfo?.label ?? "وسام"}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          الفترة {badge.period_month} ·{" "}
                          {new Date(badge.awarded_at).toLocaleDateString("ar-IQ")}
                        </p>
                        {badge.notes && (
                          <p className="mt-2 text-xs text-slate-400">{badge.notes}</p>
                        )}
                      </div>
                    </div>
                    {badge.incentive_iqd > 0 && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                        <span className="text-sm font-semibold text-emerald-300">
                          {formatIQD(badge.incentive_iqd)}
                        </span>
                        {badge.salary_addition_id ? (
                          <Badge className="bg-emerald-400/15 text-emerald-300">أضيف للراتب</Badge>
                        ) : canAward && badge.target_type === "employee" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-slate-700 text-slate-100 hover:bg-slate-800"
                            onClick={async () => {
                              const { error } = await supabase.rpc("award_badge_incentive", {
                                p_badge_id: badge.id,
                              });
                              if (error) toast.error(`تعذر صرف الحافز: ${error.message}`);
                              else {
                                toast.success("تمت إضافة الحافز إلى سجل الراتب");
                                await queryClient.invalidateQueries({
                                  queryKey: ["command-center"],
                                });
                              }
                            }}
                          >
                            صرف الحافز
                          </Button>
                        ) : (
                          <Badge className="bg-amber-400/15 text-amber-200">بانتظار الصرف</Badge>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="py-7 text-center text-sm text-slate-400">لا توجد أوسمة مسجلة بعد.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/75 text-slate-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock3 className="h-5 w-5 text-cyan-300" />
              سجل البث الميداني
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {events.length ? (
              events.slice(0, 7).map((event) => (
                <div
                  key={`${event.kind}-${event.id}`}
                  className="flex gap-3 border-r border-cyan-400/30 pr-3"
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
                  <div className="min-w-0">
                    <p className="text-sm leading-6 text-slate-200">{event.text}</p>
                    <p className="text-xs text-slate-500">{formatTime(event.time)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-7 text-center text-sm text-slate-400">
                لا توجد حركات أو تقارير مسجلة اليوم.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="overflow-hidden rounded-xl border border-cyan-300/15 bg-[#0b1725] py-3">
        <div className="command-ticker-track flex w-max items-center gap-8 whitespace-nowrap px-4">
          {[...events, ...events].map((event, index) => (
            <span
              key={`${event.id}-${index}`}
              className="flex items-center gap-2 text-sm text-slate-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              {event.text}
              <span className="text-xs text-slate-500">{formatTime(event.time)}</span>
            </span>
          ))}
          {!events.length && (
            <span className="text-sm text-slate-400">
              مركز العمليات جاهز لاستقبال التحديثات الميدانية.
            </span>
          )}
        </div>
      </div>

      <Dialog open={awardOpen} onOpenChange={setAwardOpen}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>منح وسام ميداني</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="command-center-target-type">نوع المستهدف</Label>
              <Select
                value={targetType}
                onValueChange={(value) => {
                  const nextType = value as "employee" | "workshop";
                  setTargetType(nextType);
                  setTargetId("");
                  setIncentive("");
                  setBadgeType(nextType === "workshop" ? "top_workshop" : "punctuality_champion");
                }}
              >
                <SelectTrigger id="command-center-target-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">موظف</SelectItem>
                  <SelectItem value="workshop">ورشة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="command-center-target">
                {targetType === "employee" ? "الموظف" : "الورشة"}
              </Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="command-center-target">
                  <SelectValue
                    placeholder={targetType === "employee" ? "اختر موظفاً نشطاً" : "اختر ورشة نشطة"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {targetType === "employee"
                    ? employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.full_name}
                        </SelectItem>
                      ))
                    : workshops.map((workshop) => (
                        <SelectItem key={workshop.id} value={workshop.id}>
                          {workshop.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            {targetType === "employee" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="command-center-badge">الوسام</Label>
                  <Select
                    value={badgeType}
                    onValueChange={(value) => setBadgeType(value as BadgeType)}
                  >
                    <SelectTrigger id="command-center-badge">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hse_guardian">نجم السلامة</SelectItem>
                      <SelectItem value="punctuality_champion">بطل الانضباط</SelectItem>
                      <SelectItem value="field_hero">أسد الميدان</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="command-center-incentive">
                    الحافز المالي (د.ع) · اتركه فارغاً لمنح الوسام فقط
                  </Label>
                  <Input
                    id="command-center-incentive"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={incentive}
                    onChange={(event) => setIncentive(event.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="command-center-notes">ملاحظات</Label>
              <Input
                id="command-center-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
              />
            </div>
            <Button
              className="w-full"
              disabled={awardMutation.isPending || !targetId}
              onClick={() => awardMutation.mutate()}
            >
              {awardMutation.isPending ? "جارٍ تسجيل الوسام..." : "تأكيد المنح"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  progress,
  tone,
  circular = false,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Users;
  progress: number;
  tone: "cyan" | "emerald" | "violet" | "amber";
  circular?: boolean;
}) {
  const tones = {
    cyan: "text-cyan-300 bg-cyan-400/10",
    emerald: "text-emerald-300 bg-emerald-400/10",
    violet: "text-violet-300 bg-violet-400/10",
    amber: "text-amber-300 bg-amber-400/10",
  };
  return (
    <Card className="border-slate-800 bg-slate-900/75 text-slate-100">
      <CardContent className="flex min-h-36 items-center gap-4 p-4">
        {circular ? (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-[5px] border-amber-300/70 bg-amber-300/5 text-center">
            <span className="text-sm font-black tabular-nums">
              {toArabicNumber(Math.round(progress))}٪
            </span>
          </div>
        ) : (
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-400">{title}</p>
          <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
          {!circular && <Progress value={progress} className="mt-3 h-1.5 bg-slate-800" />}
        </div>
      </CardContent>
    </Card>
  );
}

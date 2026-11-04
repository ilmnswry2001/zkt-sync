import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCheck, Gauge, ShieldAlert, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { dateKeyInTimeZone } from "@/lib/date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type ExecutiveBrief = {
  attendance_percentage: number;
  active_employees: number;
  present_employees: number;
  critical_anomalies: number;
  unresolved_anomalies: number;
  overdue_maintenance: number;
  summary_ar: string;
};

const anomalyLabels: Record<string, string> = {
  SUSPICIOUS_FUEL: "استهلاك وقود مشبوه",
  SUSPICIOUS_FUEL_RATE: "معدل استهلاك وقود مرتفع",
  DRIVER_ABSENT_ON_FUELING: "السائق غائب عند التزود بالوقود",
  ODOMETER_ROLLBACK: "تراجع قراءة عداد المركبة",
  PHANTOM_PRESENCE: "حضور ورشة بلا حركة حضور",
  UNASSIGNED_PRESENCE: "موظف حاضر دون تخصيص لورشة",
  EXCESSIVE_OVERTIME: "إضافي يتجاوز الحد دون تسجيل انصراف",
  DAILY_WAGE_DURING_LEAVE: "حضور وأجر يومي خلال إجازة معتمدة",
  MAINTENANCE_OVERDUE: "صيانة مركبة متجاوزة للاستحقاق",
};

const severityStyles: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-200",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  low: "border-slate-500/30 bg-slate-500/10 text-slate-200",
};

export function ExecutiveIntelligenceCard({ className = "" }: { className?: string }) {
  const { isAdmin, isHR, isCompanyManager } = useAuth();
  const queryClient = useQueryClient();
  const today = dateKeyInTimeZone(new Date());
  const query = useQuery({
    queryKey: ["executive-intelligence", today],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [{ data: briefData, error: briefError }, { data: anomalies, error: anomaliesError }] =
        await Promise.all([
          supabase.rpc("get_executive_daily_brief", { p_date: today }),
          supabase
            .from("operational_anomalies")
            .select("id, anomaly_type, severity, entity_type, entity_name, details, created_at")
            .eq("is_resolved", false)
            .order("created_at", { ascending: false })
            .limit(8),
        ]);
      if (briefError) throw briefError;
      if (anomaliesError) throw anomaliesError;
      return {
        brief: briefData as ExecutiveBrief,
        anomalies: anomalies ?? [],
      };
    },
  });
  const resolveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("انتهت جلسة الدخول، أعد تسجيل الدخول");
      const { error } = await supabase
        .from("operational_anomalies")
        .update({
          is_resolved: true,
          resolved_by: authData.user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("is_resolved", false);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تمت تسوية التنبيه");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["executive-intelligence"] }),
        queryClient.invalidateQueries({ queryKey: ["command-center"] }),
      ]);
    },
    onError: (error) => toast.error(`تعذر تسوية التنبيه: ${error.message}`),
  });

  const brief = query.data?.brief;
  const canResolve = isAdmin || isHR;
  const visibleAnomalies = isAdmin || isHR || isCompanyManager ? (query.data?.anomalies ?? []) : [];

  return (
    <Card
      dir="rtl"
      className={`overflow-hidden border-amber-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-[#142131] text-slate-100 shadow-[0_12px_42px_rgba(2,8,23,0.28)] ${className}`}
    >
      <CardHeader className="gap-3 border-b border-white/10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldAlert className="h-5 w-5 text-amber-300" />
            الملخص التنفيذي الذكي
          </CardTitle>
          <p className="mt-1 text-xs text-slate-400">
            مؤشرات الحضور والمخاطر والصيانة · تحديث تلقائي كل دقيقة
          </p>
        </div>
        <Badge className="border border-amber-500/30 bg-amber-500/10 text-amber-200">
          {query.isFetching ? "جارٍ التحديث" : "مباشر"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-5">
        {query.isError ? (
          <div
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
          >
            تعذر تحميل الملخص التنفيذي: {(query.error as Error).message}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <IntelligenceMetric
                icon={Gauge}
                label="نسبة الحضور اليوم"
                value={`${Number(brief?.attendance_percentage ?? 0).toLocaleString("ar-IQ")}٪`}
                detail={`${Number(brief?.present_employees ?? 0).toLocaleString("ar-IQ")} من ${Number(brief?.active_employees ?? 0).toLocaleString("ar-IQ")}`}
              />
              <IntelligenceMetric
                icon={AlertTriangle}
                label="تنبيهات حرجة"
                value={Number(brief?.critical_anomalies ?? 0).toLocaleString("ar-IQ")}
                detail={`${Number(brief?.unresolved_anomalies ?? 0).toLocaleString("ar-IQ")} تنبيه غير مسوّى`}
                critical={Number(brief?.critical_anomalies ?? 0) > 0}
              />
              <IntelligenceMetric
                icon={Wrench}
                label="صيانة متجاوزة"
                value={Number(brief?.overdue_maintenance ?? 0).toLocaleString("ar-IQ")}
                detail="مركبات بلغت قراءة الاستحقاق"
                critical={Number(brief?.overdue_maintenance ?? 0) > 0}
              />
            </div>
            <Progress
              value={Number(brief?.attendance_percentage ?? 0)}
              className="h-2 bg-white/10"
              aria-label="نسبة الحضور اليوم"
            />
            <p className="text-sm leading-7 text-slate-300">
              {brief?.summary_ar ?? "جارٍ إنشاء الملخص اليومي."}
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold">التنبيهات المفتوحة</h3>
                <span className="text-xs text-slate-400">
                  {Number(brief?.unresolved_anomalies ?? 0).toLocaleString("ar-IQ")}
                </span>
              </div>
              {visibleAnomalies.length ? (
                visibleAnomalies.map((anomaly) => (
                  <article
                    key={anomaly.id}
                    className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${severityStyles[anomaly.severity] ?? severityStyles.low}`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {anomalyLabels[anomaly.anomaly_type] ?? "تنبيه تشغيلي"}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {anomaly.entity_name || anomaly.entity_type}
                        {typeof anomaly.details === "object" &&
                        anomaly.details !== null &&
                        "work_date" in anomaly.details &&
                        typeof anomaly.details.work_date === "string"
                          ? ` · ${anomaly.details.work_date}`
                          : ""}
                      </p>
                    </div>
                    {canResolve && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-current bg-black/10 text-current hover:bg-black/20"
                        disabled={resolveMutation.isPending}
                        onClick={() => resolveMutation.mutate(anomaly.id)}
                      >
                        <CheckCheck className="ms-2 h-4 w-4" />
                        تسوية
                      </Button>
                    )}
                  </article>
                ))
              ) : (
                <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">
                  لا توجد تنبيهات مفتوحة ضمن صلاحيات حسابك.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IntelligenceMetric({
  icon: Icon,
  label,
  value,
  detail,
  critical = false,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  detail: string;
  critical?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${critical ? "border-red-500/30 bg-red-500/10" : "border-white/10 bg-white/[0.04]"}`}
    >
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Icon className={`h-4 w-4 ${critical ? "text-red-300" : "text-cyan-300"}`} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

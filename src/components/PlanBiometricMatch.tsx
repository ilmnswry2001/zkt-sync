import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StaffAssignmentGroup } from "@/lib/planning-staff";

type Punch = {
  employee_id: string | null;
  employee_no: string | null;
  verify_time: string;
  device_id: string | null;
  is_suspicious: boolean | null;
};

/** Read-only comparison of plan staff against fingerprint punches on the plan day. */
export function PlanBiometricMatch({
  planDate,
  assignments,
}: {
  planDate: string;
  assignments: StaffAssignmentGroup[];
}) {
  const [enabled, setEnabled] = useState(false);
  const employees = useMemo(
    () => assignments.flatMap((g) => g.employees.map((e) => ({ ...e, specialty: g.specialty }))),
    [assignments],
  );
  const ids = employees.map((e) => e.id);

  const query = useQuery({
    queryKey: ["plan-biometric-match", planDate, ids.join(",")],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const start = new Date(`${planDate.slice(0, 10)}T00:00:00+03:00`);
      const end = new Date(start.getTime() + 86_400_000);
      const [{ data, error }, devices] = await Promise.all([
        (supabase as any)
          .from("attendance_logs")
          .select("employee_id, employee_no, verify_time, device_id, is_suspicious")
          .in("employee_id", ids)
          .gte("verify_time", start.toISOString())
          .lt("verify_time", end.toISOString())
          .order("verify_time"),
        supabase.from("devices").select("id, name"),
      ]);
      if (error) throw error;
      const names = new Map((devices.data ?? []).map((d: any) => [d.id, d.name as string]));
      const first = new Map<string, { time: string; device: string }>();
      for (const p of (data ?? []) as Punch[]) {
        if (p.is_suspicious || !p.employee_id || first.has(p.employee_id)) continue;
        first.set(p.employee_id, {
          time: new Date(p.verify_time).toLocaleTimeString("ar-IQ", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Baghdad",
          }),
          device: (p.device_id && names.get(p.device_id)) || "جهاز غير معروف",
        });
      }
      return first;
    },
  });

  if (!employees.length) return null;
  const present = query.data ? employees.filter((e) => query.data!.has(e.id)).length : 0;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold">
          <Fingerprint className="h-4 w-4 text-primary" />
          مطابقة الخطة مع البصمة ليوم {planDate.slice(0, 10)}
        </div>
        <Button
          type="button"
          size="sm"
          variant={enabled ? "outline" : "default"}
          onClick={() => (enabled ? query.refetch() : setEnabled(true))}
          disabled={query.isFetching}
        >
          {query.isFetching ? "جارٍ المطابقة..." : enabled ? "تحديث المطابقة" : "مطابقة مع البصمة"}
        </Button>
      </div>
      {query.error && <p className="mt-2 text-sm text-destructive">تعذر قراءة حركات البصمة.</p>}
      {query.data && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge>ملتزم بالخطة: {present}</Badge>
            <Badge variant="destructive">لم يبصم: {employees.length - present}</Badge>
            <Badge variant="outline">
              نسبة التنفيذ: {Math.round((present / employees.length) * 100)}%
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {employees.map((e) => {
              const hit = query.data!.get(e.id);
              return (
                <div
                  key={e.id}
                  className={`rounded-lg border p-2 text-sm ${hit ? "border-primary/40 bg-background" : "border-destructive/40 bg-destructive/5"}`}
                >
                  <p className="truncate font-semibold">{e.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.specialty} · {e.employee_no || "—"}
                  </p>
                  <p className={`mt-1 text-xs font-medium ${hit ? "text-primary" : "text-destructive"}`}>
                    {hit ? `حاضر ${hit.time} · ${hit.device}` : "لم يُسجّل بصمة"}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

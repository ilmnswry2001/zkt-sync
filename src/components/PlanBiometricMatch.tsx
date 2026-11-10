import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StaffAssignmentGroup } from "@/lib/planning-staff";
import { summarizeBiometricMatch, type BiometricMatchResults } from "@/lib/biometric-match";

type Punch = {
  employee_id: string | null;
  employee_no: string | null;
  verify_time: string;
  device_id: string | null;
  is_suspicious: boolean | null;
};

export type { BiometricMatchResults } from "@/lib/biometric-match";

/** Read-only comparison of plan staff against fingerprint punches on the plan day. */
export function PlanBiometricMatch({
  planDate,
  assignments,
  autoLoad = false,
  onMatchChange,
}: {
  planDate: string;
  assignments: StaffAssignmentGroup[];
  autoLoad?: boolean;
  onMatchChange?: (results: BiometricMatchResults | null) => void;
}) {
  const [enabled, setEnabled] = useState(autoLoad);
  const employees = useMemo(
    () => Array.from(new Map(assignments.flatMap((g) => g.employees.map((e) => [e.id, { ...e, specialty: g.specialty }] as const))).values()),
    [assignments],
  );
  const ids = employees.map((e) => e.id);

  const query = useQuery({
    queryKey: ["plan-biometric-match", planDate, ids.join(",")],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const start = new Date(`${planDate.slice(0, 10)}T00:00:00+03:00`);
      const end = new Date(start.getTime() + 86_400_000);
      const data: Punch[] = [];
      for (let offset = 0; offset < ids.length; offset += 100) {
        for (let from = 0; ; from += 1000) {
          const page = await supabase.from("attendance_logs")
            .select("employee_id, employee_no, verify_time, device_id, is_suspicious")
            .in("employee_id", ids.slice(offset, offset + 100))
            .gte("verify_time", start.toISOString()).lt("verify_time", end.toISOString())
            .order("verify_time").order("id").range(from, from + 999);
          if (page.error) throw page.error;
          data.push(...(page.data as Punch[]));
          if (page.data.length < 1000) break;
        }
      }
      const devices = await supabase.from("devices").select("id, name");
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

  useEffect(() => {
    if (!query.data || query.isFetching || query.isError || !employees.length) {
      onMatchChange?.(null);
      return;
    }
    onMatchChange?.(summarizeBiometricMatch(employees, new Set(query.data.keys())));
  }, [query.data, query.isFetching, query.isError, employees, onMatchChange]);

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

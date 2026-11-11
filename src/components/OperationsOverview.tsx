import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadAllRows } from "@/lib/monthly-report";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const number = (value?: number) => (value == null ? "—" : value.toLocaleString("ar-IQ"));
const time = (value: string | number) =>
  new Date(value).toLocaleString("ar-IQ", {
    timeZone: "Asia/Baghdad",
    dateStyle: "short",
    timeStyle: "short",
  });
type Props = {
  today: string;
  updatedAt: number;
  refresh: () => void;
  fetching: boolean;
  attendance?: { present: number; absent: number; late: number; incomplete: number };
  trend: {
    date: string;
    day: string;
    rate: number | null;
    present: number;
    total: number;
    hasData: boolean;
  }[];
  devices?: { id: string; name: string; last_sync_at: string | null }[];
  sites?: { active: number; reported: number; outstanding: { id: string; name: string }[] };
  overtime?: number;
  tasks?: { completed: number; total: number };
  forms?: number;
};
export function OperationsOverview({
  today,
  updatedAt,
  refresh,
  fetching,
  attendance,
  trend,
  devices,
  sites,
  overtime,
  tasks,
  forms,
}: Props) {
  const { canAccessSection } = useAuth();
  const [selectedDay, setSelectedDay] = useState("");
  const selected = trend.find((day) => day.date === selectedDay) ?? trend[trend.length - 1];
  const workshops = useQuery({
    queryKey: ["executive-dashboard", "workshops", today],
    enabled: canAccessSection("/attendance"),
    refetchInterval: 120000,
    queryFn: async () => {
      const [active, members, reports, lines] = await Promise.all([
        loadAllRows((a, b) =>
          supabase
            .from("daily_workshops")
            .select("id,name")
            .eq("is_active", true)
            .order("name")
            .order("id")
            .range(a, b),
        ),
        loadAllRows((a, b) =>
          supabase
            .from("daily_workshop_members")
            .select("workshop_id")
            .eq("is_active", true)
            .order("id")
            .range(a, b),
        ),
        loadAllRows((a, b) =>
          supabase
            .from("daily_workshop_reports")
            .select("id,workshop_id")
            .eq("report_date", today)
            .order("id")
            .range(a, b),
        ),
        loadAllRows((a, b) =>
          supabase
            .from("daily_workshop_report_lines")
            .select("report_id,daily_workshop_reports!inner(report_date)")
            .eq("daily_workshop_reports.report_date", today)
            .eq("attended", true)
            .order("id")
            .range(a, b),
        ),
      ]);
      const counts = (ids: string[]) =>
        ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>());
      const roster = counts(members.map((m) => m.workshop_id)),
        present = counts(lines.map((l) => l.report_id));
      const saved = new Map(reports.map((r) => [r.workshop_id, r.id]));
      return active.map((w) => ({
        ...w,
        roster: roster.get(w.id) ?? 0,
        saved: saved.has(w.id),
        present: present.get(saved.get(w.id) ?? "") ?? 0,
      }));
    },
  });
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-900 p-6 text-white">
        <div>
          <p className="text-sm text-slate-300">
            {new Date(today + "T12:00:00+03:00").toLocaleDateString("ar-IQ", {
              dateStyle: "full",
              timeZone: "Asia/Baghdad",
            })}
          </p>
          <h1 className="mt-1 text-3xl font-bold">متابعة التشغيل اليومي</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs">
            آخر تحديث {updatedAt ? time(Math.max(updatedAt, workshops.dataUpdatedAt)) : "—"}
          </span>
          <Button
            variant="secondary"
            disabled={fetching || workshops.isFetching}
            onClick={() => {
              refresh();
              if (workshops.isEnabled) void workshops.refetch();
            }}
          >
            <RefreshCw className="ml-2 size-4" />
            تحديث
          </Button>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>حضور اليوم</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-baseline gap-5">
              <span>
                <strong className="text-5xl tabular-nums text-teal-700 dark:text-teal-300">
                  {number(attendance?.present)}
                </strong>{" "}
                حاضر
              </span>
              <span>غائب · {number(attendance?.absent)}</span>
              <span>متأخر · {number(attendance?.late)}</span>
              <span>دوام غير مكتمل · {number(attendance?.incomplete)}</span>
            </div>
            {!!devices?.length && (
              <p className="mt-4 rounded-md bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="ml-2 inline size-4" />
                قد تتأخر بعض البصمات. {devices[0].name} ·{" "}
                {devices[0].last_sync_at ? time(devices[0].last_sync_at) : "لم تتم المزامنة بعد"}
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-start-2 lg:row-span-2">
          <CardHeader>
            <CardTitle>يحتاج متابعة</CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 space-y-5 overflow-y-auto">
            <section>
              <h3 className="mb-2 font-semibold">الأجهزة المتأخرة</h3>
              {devices?.map((d) => (
                <div key={d.id} className="flex justify-between gap-3 border-t py-2">
                  <div>
                    {d.name}
                    <small className="block text-muted-foreground">
                      {d.last_sync_at ? time(d.last_sync_at) : "لم تتم المزامنة بعد"}
                    </small>
                  </div>
                  {canAccessSection("/devices") && (
                    <Link
                      to="/devices"
                      hash={`device-${d.id}`}
                      className="text-sm text-primary underline"
                    >
                      فتح الجهاز
                    </Link>
                  )}
                </div>
              ))}
              {devices?.length === 0 && "لا توجد أجهزة نشطة متأخرة"}
            </section>
            <section>
              <h3 className="font-semibold">تقارير المواقع اليوم</h3>
              {sites && (
                <p className="py-2 text-sm text-emerald-700">
                  رُفع {number(sites.reported)} من {number(sites.active)}
                </p>
              )}
              {sites?.outstanding.map((site) => (
                <div key={site.id} className="flex justify-between gap-2 border-t py-2">
                  <span>
                    {site.name}
                    <small className="block text-muted-foreground">بانتظار التقرير</small>
                  </span>
                  {canAccessSection("/attendance") && (
                    <Link
                      to="/attendance"
                      search={{ site: site.id }}
                      className="text-sm text-primary underline"
                    >
                      مراجعة التقرير
                    </Link>
                  )}
                </div>
              ))}
            </section>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>اتجاه الحضور · آخر سبعة أيام</CardTitle>
          </CardHeader>
          <CardContent>
            {trend.some((d) => d.hasData) ? (
              <div className="h-44" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(v) => [`${v}%`, "الحضور"]} />
                    <Line dataKey="rate" stroke="#0f766e" strokeWidth={3} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>{fetching ? "جارٍ تحميل الحضور…" : "لا توجد بيانات حضور للفترة"}</p>
            )}
            <label className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              تفاصيل اليوم
              <select
                className="rounded border bg-background p-1"
                value={selected?.date}
                onChange={(e) => setSelectedDay(e.target.value)}
              >
                {trend.map((d) => (
                  <option key={d.date} value={d.date}>
                    {d.day}
                  </option>
                ))}
              </select>
              {selected?.hasData
                ? `${number(selected.present)} حاضر من ${number(selected.total)} موظف نشط`
                : "—"}
            </label>
          </CardContent>
        </Card>
      </div>
      {canAccessSection("/attendance") && (
        <Card>
          <CardHeader>
            <CardTitle>جرد الورش اليوم</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted">
                <tr>
                  {["الورشة", "الكادر", "الحاضرون", "حالة الجرد"].map((t) => (
                    <th className="p-3" key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workshops.data?.map((w) => (
                  <tr className="border-b" key={w.id}>
                    <td className="p-3">
                      <Link
                        to="/attendance"
                        search={{ workshop: w.id }}
                        className="font-medium text-primary underline"
                      >
                        {w.name}
                      </Link>
                    </td>
                    <td>{number(w.roster)}</td>
                    <td>{w.saved ? number(w.present) : "—"}</td>
                    <td className={w.saved ? "text-emerald-700" : "text-amber-700"}>
                      {w.saved ? "تم حفظ الجرد" : "بانتظار الجرد"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!workshops.data?.length && (
              <p className="p-3">
                {workshops.isLoading
                  ? "جارٍ تحميل الورش…"
                  : workshops.isError
                    ? "تعذر تحميل الجرد"
                    : "لا توجد ورش نشطة"}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <section>
        <h2 className="mb-3 text-lg font-bold">ملخص التشغيل</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["/monthly", "الإضافي هذا الشهر", number(overtime) + " ساعة"],
              [
                "/tasks",
                "المهام المنجزة اليوم",
                number(tasks?.completed) + " من " + number(tasks?.total),
              ],
              ["/forms", "استمارات بانتظار التنفيذ", number(forms)],
            ] as const
          ).map(([to, label, value]) => (
            <Card key={to}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <strong className="block py-2 text-2xl">{value}</strong>
                {canAccessSection(to) && (
                  <Link className="text-sm text-primary underline" to={to}>
                    عرض التفاصيل
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

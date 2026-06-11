import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/attendance.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Fingerprint, ClockIcon, UserCheck, UserX, FileText } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "لوحة التحكم" }] }),
  component: Dashboard,
});

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number | string; icon: any; color: string }) {
  return (
    <Card>
      <CardContent className="p-6 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-6 h-6 text-white" /></div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => fn() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">لوحة التحكم</h1>
        <p className="text-muted-foreground mt-1">نظرة عامة على حضور اليوم وإحصاءات النظام</p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">جارٍ التحميل…</p>
      ) : data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard title="إجمالي الموظفين" value={data.totalEmployees} icon={Users} color="bg-primary" />
            <StatCard title="الحاضرون اليوم" value={data.presentToday} icon={UserCheck} color="bg-success" />
            <StatCard title="الغائبون اليوم" value={data.absentToday} icon={UserX} color="bg-destructive" />
            <StatCard title="عدد الأجهزة" value={data.totalDevices} icon={Fingerprint} color="bg-warning" />
            <StatCard title="إجمالي سجلات البصمة" value={data.totalLogs.toLocaleString()} icon={ClockIcon} color="bg-primary" />
            <StatCard title="نسبة الحضور" value={data.totalEmployees ? Math.round((data.presentToday / data.totalEmployees) * 100) + "%" : "0%"} icon={FileText} color="bg-success" />
          </div>
          <Card>
            <CardHeader><CardTitle>الحضور خلال آخر 7 أيام</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.chart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="present" fill="oklch(0.55 0.15 170)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

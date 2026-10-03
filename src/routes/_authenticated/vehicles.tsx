import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/vehicles")({
  head: () => ({ meta: [{ title: "المركبات" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    if (!roles?.some((item) => item.role === "admin" || item.role === "hr")) throw redirect({ to: "/dashboard" });
  },
  component: VehiclesPage,
});

type Vehicle = { id: string; vehicle_no: string; name: string; vehicle_class: "light" | "heavy"; daily_rate: number; currency: string; is_active: boolean };

function VehiclesPage() {
  const client = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const monthDayCount = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const [vehicleNo, setVehicleNo] = useState("");
  const [name, setName] = useState("");
  const [vehicleClass, setVehicleClass] = useState<"light" | "heavy">("light");
  const [dailyRate, setDailyRate] = useState("");
  const [days, setDays] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["vehicles", month],
    queryFn: async () => {
      const [{ data: vehicles, error: vehicleError }, { data: operations, error: operationError }] = await Promise.all([
        supabase.from("vehicles").select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active").order("vehicle_no"),
        supabase.from("vehicle_monthly_operations").select("vehicle_id, operating_days").eq("month", `${month}-01`),
      ]);
      if (vehicleError) throw vehicleError;
      if (operationError) throw operationError;
      const initial: Record<string, string> = {};
      for (const row of operations ?? []) initial[row.vehicle_id] = String(row.operating_days);
      setDays(initial);
      return { vehicles: (vehicles ?? []) as Vehicle[], operations: operations ?? [] };
    },
  });
  const createVehicle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("vehicles").insert({ vehicle_no: vehicleNo.trim(), name: name.trim(), vehicle_class: vehicleClass, daily_rate: Number(dailyRate), currency: "IQD" });
      if (error) throw error;
    },
    onSuccess: async () => { setVehicleNo(""); setName(""); setDailyRate(""); toast.success("تم تسجيل المركبة"); await client.invalidateQueries({ queryKey: ["vehicles"] }); await client.invalidateQueries({ queryKey: ["payroll"] }); },
    onError: (error: Error) => toast.error(`تعذر تسجيل المركبة: ${error.message}`),
  });
  const saveDays = useMutation({
    mutationFn: async (vehicleId: string) => {
      const operatingDays = Number(days[vehicleId] ?? 0);
      if (!Number.isInteger(operatingDays) || operatingDays < 0 || operatingDays > monthDayCount) throw new Error(`أدخل عدداً بين 0 و${monthDayCount}`);
      const { error } = await supabase.from("vehicle_monthly_operations").upsert({ vehicle_id: vehicleId, month: `${month}-01`, operating_days: operatingDays }, { onConflict: "vehicle_id,month" });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("تم حفظ أيام التشغيل"); await client.invalidateQueries({ queryKey: ["vehicles"] }); await client.invalidateQueries({ queryKey: ["payroll"] }); },
    onError: (error: Error) => toast.error(`تعذر حفظ التشغيل: ${error.message}`),
  });
  const deleteVehicle = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("vehicles").delete().eq("id", id); if (error) throw error; },
    onSuccess: async () => { toast.success("تم حذف المركبة وسجل تشغيلها"); await client.invalidateQueries({ queryKey: ["vehicles"] }); await client.invalidateQueries({ queryKey: ["payroll"] }); },
    onError: (error: Error) => toast.error(`تعذر حذف المركبة: ${error.message}`),
  });
  return <div dir="rtl" className="space-y-6">
    <div className="flex items-center gap-3"><div className="rounded-2xl bg-primary/10 p-3"><Truck className="h-6 w-6 text-primary" /></div><div><h1 className="text-3xl font-bold">إدارة المركبات</h1><p className="text-muted-foreground">سجل المركبات وأجورها اليومية وأيام تشغيلها الشهرية.</p></div></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> تسجيل مركبة جديدة</CardTitle></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-2"><Label htmlFor="vehicle-no">رقم المركبة / اللوحة</Label><Input id="vehicle-no" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="vehicle-name">الاسم أو النوع</Label><Input id="vehicle-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-2"><Label>الفئة</Label><Select value={vehicleClass} onValueChange={(value) => setVehicleClass(value as "light" | "heavy")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">مركبة خفيفة</SelectItem><SelectItem value="heavy">مركبة ثقيلة</SelectItem></SelectContent></Select></div>
      <div className="space-y-2"><Label htmlFor="vehicle-rate">الأجر اليومي (د.ع)</Label><Input id="vehicle-rate" type="number" min="0" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} /></div>
      <div className="flex items-end"><Button className="w-full" onClick={() => createVehicle.mutate()} disabled={createVehicle.isPending || !vehicleNo.trim() || !name.trim() || !dailyRate || Number(dailyRate) < 0}><Plus className="ml-2 h-4 w-4" /> إضافة</Button></div>
    </div></CardContent></Card>
    <Card><CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>سجل المركبات</CardTitle><p className="mt-1 text-sm text-muted-foreground">أدخل عدد أيام العمل الفعلية لكل مركبة خلال الشهر المحدد.</p></div><div className="flex items-center gap-3"><Input aria-label="شهر التشغيل" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-44" /><Badge variant="secondary">{query.data?.vehicles.length ?? 0} مركبة</Badge></div></CardHeader><CardContent className="overflow-x-auto p-0">
      {query.isError ? <p className="p-8 text-center text-destructive">تعذر تحميل المركبات: {(query.error as Error).message}</p> : query.isLoading ? <p className="p-8 text-center text-muted-foreground">جارٍ تحميل السجل…</p> : <table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b bg-muted/40 text-right"><th className="p-3">المركبة</th><th className="p-3">التصنيف</th><th className="p-3">الأجر اليومي</th><th className="p-3">أيام التشغيل لهذا الشهر</th><th className="p-3">الإجراء</th></tr></thead><tbody>{query.data?.vehicles.map((vehicle) => <tr key={vehicle.id} className="border-b"><td className="p-3"><b>{vehicle.name}</b><div className="text-xs text-muted-foreground">{vehicle.vehicle_no}</div></td><td className="p-3">{vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}</td><td className="p-3">{Number(vehicle.daily_rate).toLocaleString()} د.ع</td><td className="p-3"><Input aria-label={`أيام تشغيل ${vehicle.name}`} className="max-w-36" type="number" min="0" max={monthDayCount} value={days[vehicle.id] ?? "0"} onChange={(e) => setDays((state) => ({ ...state, [vehicle.id]: e.target.value }))} /></td><td className="flex gap-2 p-3"><Button size="sm" variant="outline" onClick={() => saveDays.mutate(vehicle.id)} disabled={saveDays.isPending}><Save className="ml-2 h-4 w-4" /> حفظ التشغيل</Button><Button size="icon" variant="ghost" aria-label="حذف المركبة" onClick={() => { if (confirm(`حذف المركبة ${vehicle.name} وسجل تشغيلها؟`)) deleteVehicle.mutate(vehicle.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button></td></tr>)}</tbody></table>}
      {query.data?.vehicles.length === 0 && <p className="p-8 text-center text-muted-foreground">لا توجد مركبات مسجلة بعد.</p>}
    </CardContent></Card>
  </div>;
}

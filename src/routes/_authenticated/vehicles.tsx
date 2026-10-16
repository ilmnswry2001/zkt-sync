import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Check, Plus, Save, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { currentMonthInBaghdad } from "@/lib/date-time";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/vehicles")({
  head: () => ({ meta: [{ title: "المركبات" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    if (!roles?.some((item) => item.role === "admin" || item.role === "hr"))
      throw redirect({ to: "/dashboard" });
  },
  component: VehiclesPage,
});

type Vehicle = {
  id: string;
  vehicle_no: string;
  name: string;
  vehicle_class: "light" | "heavy";
  daily_rate: number;
  currency: string;
  is_active: boolean;
};

function VehiclesPage() {
  const client = useQueryClient();
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const monthDayCount = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const [vehicleNo, setVehicleNo] = useState("");
  const [name, setName] = useState("");
  const [vehicleClass, setVehicleClass] = useState<"light" | "heavy">("light");
  const [dailyRate, setDailyRate] = useState("");
  const [dates, setDates] = useState<Record<string, string[]>>({});
  const [legacyDays, setLegacyDays] = useState<Record<string, number>>({});
  const [activeVehicle, setActiveVehicle] = useState<Vehicle | null>(null);
  const query = useQuery({
    queryKey: ["vehicles", month],
    queryFn: async () => {
      const [{ data: vehicles, error: vehicleError }, operationsResult] = await Promise.all([
          (supabase as any)
            .from("vehicles")
            .select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active")
            .order("vehicle_no"),
          (supabase as any)
            .from("vehicle_monthly_operations")
            .select("vehicle_id, operating_days, operating_dates")
            .eq("month", `${month}-01`),
        ]);
      let operations = operationsResult.data;
      let operationError = operationsResult.error;
      if (operationError && /operating_dates|column/i.test(operationError.message)) {
        const fallback = await (supabase as any)
          .from("vehicle_monthly_operations")
          .select("vehicle_id, operating_days")
          .eq("month", `${month}-01`);
        operations = (fallback.data ?? []).map((row: { vehicle_id: string; operating_days: number }) => ({ ...row, operating_dates: [] }));
        operationError = fallback.error;
      }
      if (vehicleError) throw vehicleError;
      if (operationError) throw operationError;
      const initial: Record<string, string[]> = {};
      const legacy: Record<string, number> = {};
      for (const row of operations ?? []) {
        initial[row.vehicle_id] = (row.operating_dates ?? []).map((date: string) => date.slice(0, 10));
        legacy[row.vehicle_id] = Number(row.operating_days ?? 0);
      }
      setDates(initial);
      setLegacyDays(legacy);
      return { vehicles: (vehicles ?? []) as Vehicle[], operations: operations ?? [] };
    },
  });
  const createVehicle = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("vehicles")
        .insert({
          vehicle_no: vehicleNo.trim(),
          name: name.trim(),
          vehicle_class: vehicleClass,
          daily_rate: Number(dailyRate),
          currency: "IQD",
        });
      if (error) throw error;
    },
    onSuccess: async () => {
      setVehicleNo("");
      setName("");
      setDailyRate("");
      toast.success("تم تسجيل المركبة");
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["payroll"] });
      await client.invalidateQueries({ queryKey: ["monthly", "vehicle-report"] });
    },
    onError: (error: Error) => toast.error(`تعذر تسجيل المركبة: ${formatErrorMessage(error)}`),
  });
  const monthDates = useMemo(() => Array.from({ length: monthDayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
  }), [month, monthDayCount]);
  const saveDays = useMutation({
    mutationFn: async ({ vehicleId, operatingDates }: { vehicleId: string; operatingDates: string[] }) => {
      const normalizedDates = [...new Set(operatingDates)].filter((date) => date.startsWith(`${month}-`)).sort();
      const operatingDays = normalizedDates.length;
      if (!Number.isInteger(operatingDays) || operatingDays < 0 || operatingDays > monthDayCount)
        throw new Error(`أدخل عدداً بين 0 و${monthDayCount}`);
      const { error } = await (supabase as any)
        .from("vehicle_monthly_operations")
        .upsert(
          { vehicle_id: vehicleId, month: `${month}-01`, operating_days: operatingDays, operating_dates: normalizedDates },
          { onConflict: "vehicle_id,month" },
        );
      if (error) throw error;
    },
    onSuccess: async () => {
      setActiveVehicle(null);
      toast.success("تم حفظ أيام حضور المركبة");
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["payroll"] });
      await client.invalidateQueries({ queryKey: ["monthly", "vehicle-report"] });
    },
    onError: (error: Error) => toast.error(`تعذر حفظ التشغيل: ${formatErrorMessage(error)}`),
  });
  const deleteVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("vehicles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف المركبة وسجل تشغيلها");
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["payroll"] });
    },
    onError: (error: Error) => toast.error(`تعذر حذف المركبة: ${formatErrorMessage(error)}`),
  });
  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-primary/10 p-3">
          <Truck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">إدارة المركبات</h1>
          <p className="text-muted-foreground">
            سجل المركبات وأجورها اليومية وأيام تشغيلها الشهرية.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> تسجيل مركبة جديدة
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="vehicle-no">رقم المركبة / اللوحة</Label>
              <Input
                id="vehicle-no"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-name">الاسم أو النوع</Label>
              <Input id="vehicle-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>الفئة</Label>
              <Select
                value={vehicleClass}
                onValueChange={(value) => setVehicleClass(value as "light" | "heavy")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">مركبة خفيفة</SelectItem>
                  <SelectItem value="heavy">مركبة ثقيلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicle-rate">الأجر اليومي (د.ع)</Label>
              <Input
                id="vehicle-rate"
                type="number"
                min="0"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => createVehicle.mutate()}
                disabled={
                  createVehicle.isPending ||
                  !vehicleNo.trim() ||
                  !name.trim() ||
                  !dailyRate ||
                  Number(dailyRate) < 0
                }
              >
                <Plus className="ml-2 h-4 w-4" /> إضافة
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>سجل المركبات</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              سجّل تواريخ عمل كل مركبة خلال الشهر، وسيُحسب عدد الأيام والمستحق تلقائياً.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              aria-label="شهر التشغيل"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-44"
            />
            <Badge variant="secondary">{query.data?.vehicles.length ?? 0} مركبة</Badge>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {query.isError ? (
            <p className="p-8 text-center text-destructive">
              تعذر تحميل المركبات: {(query.error as Error).message}
            </p>
          ) : query.isLoading ? (
            <p className="p-8 text-center text-muted-foreground">جارٍ تحميل السجل…</p>
          ) : (
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-right">
                  <th className="p-3">المركبة</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">الأجر اليومي</th>
                  <th className="p-3">أيام الحضور المسجلة</th>
                  <th className="p-3">إجراء التسجيل</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b">
                    <td className="p-3">
                      <b>{vehicle.name}</b>
                      <div className="text-xs text-muted-foreground">{vehicle.vehicle_no}</div>
                    </td>
                    <td className="p-3">{vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}</td>
                    <td className="p-3">{Number(vehicle.daily_rate).toLocaleString()} د.ع</td>
                    <td className="p-3">
                      <span className="font-semibold tabular-nums">{(dates[vehicle.id] ?? []).length || legacyDays[vehicle.id] || 0}</span> يوم
                      <div className="mt-1 max-w-64 text-xs text-muted-foreground">
                        {(dates[vehicle.id] ?? []).length ? (dates[vehicle.id] ?? []).map((date) => Number(date.slice(8))).join("، ") : legacyDays[vehicle.id] ? "العدد السابق محفوظ دون تحديد التواريخ" : "لم تُسجّل تواريخ بعد"}
                      </div>
                    </td>
                    <td className="flex gap-2 p-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActiveVehicle(vehicle)}
                      >
                        <CalendarDays className="ml-2 h-4 w-4" /> تسجيل الحضور
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="حذف المركبة"
                        onClick={() => {
                          if (confirm(`حذف المركبة ${vehicle.name} وسجل تشغيلها؟`))
                            deleteVehicle.mutate(vehicle.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {query.data?.vehicles.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">لا توجد مركبات مسجلة بعد.</p>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!activeVehicle} onOpenChange={(open) => { if (!open) setActiveVehicle(null); }}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeVehicle && <>
            <DialogHeader>
              <DialogTitle>تسجيل أيام حضور المركبة</DialogTitle>
              <DialogDescription>{activeVehicle.name} · {activeVehicle.vehicle_no} · شهر {month}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
              <p className="text-sm">حدد الأيام التي عملت فيها المركبة. الأيام المحددة: <b>{(dates[activeVehicle.id] ?? []).length}</b></p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDates((state) => ({ ...state, [activeVehicle.id]: [...monthDates] }))}>تحديد الشهر كله</Button>
                <Button size="sm" variant="ghost" onClick={() => setDates((state) => ({ ...state, [activeVehicle.id]: [] }))}>مسح التحديد</Button>
              </div>
            </div>
            {!dates[activeVehicle.id]?.length && legacyDays[activeVehicle.id] > 0 && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">السجل السابق يحفظ عدد {legacyDays[activeVehicle.id]} أيام دون تواريخ محددة. حدّد الأيام الفعلية الآن لحفظ التقرير التفصيلي.</p>}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="أيام الشهر">
              {monthDates.map((date) => {
                const selected = (dates[activeVehicle.id] ?? []).includes(date);
                const dayNumber = Number(date.slice(8));
                const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("ar-IQ", { weekday: "short" });
                return <button key={date} type="button" aria-pressed={selected} onClick={() => setDates((state) => {
                  const current = state[activeVehicle.id] ?? [];
                  return { ...state, [activeVehicle.id]: selected ? current.filter((value) => value !== date) : [...current, date].sort() };
                })} className={`flex min-h-16 flex-col items-center justify-center rounded-xl border p-2 text-sm transition ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/50 hover:bg-primary/5"}`}>
                  <span className="text-[11px] opacity-80">{weekday}</span><span className="font-bold">{dayNumber}</span>{selected && <Check className="h-3.5 w-3.5" />}
                </button>;
              })}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setActiveVehicle(null)}>إلغاء</Button>
              <Button onClick={() => saveDays.mutate({ vehicleId: activeVehicle.id, operatingDates: dates[activeVehicle.id] ?? [] })} disabled={saveDays.isPending}>
                <Save className="ml-2 h-4 w-4" /> {saveDays.isPending ? "جارٍ الحفظ…" : "حفظ أيام الحضور"}
              </Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

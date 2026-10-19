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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VehicleDiagram, DEFAULT_VEHICLE_IMAGE } from "@/components/vehicles/VehicleDiagram";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CarFront,
  Check,
  ListChecks,
  PencilLine,
  Plus,
  Save,
  Trash2,
  Truck,
  Upload,
} from "lucide-react";
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
  notes: string | null;
  last_fuel_date: string | null;
  security_permit_expiry: string | null;
  vehicle_image_url: string | null;
};

async function uploadVehicleImage(file: File, vehicleId: string) {
  if (!file.type.startsWith("image/")) throw new Error("اختر ملف صورة صالحاً");
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم الصورة يتجاوز 5 ميغابايت");
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const path = `${vehicleId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("vehicle-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("vehicle-images").getPublicUrl(path);
  return data.publicUrl;
}

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
      let vehicles: Vehicle[] = [];
      let vehicleError: any = null;
      const [{ data: vehiclesData, error: vehiclesErr }, operationsResult] = await Promise.all([
        (supabase as any)
          .from("vehicles")
          .select(
            "id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active, notes, last_fuel_date, security_permit_expiry, vehicle_image_url",
          )
          .order("vehicle_no"),
        (supabase as any)
          .from("vehicle_monthly_operations")
          .select("vehicle_id, operating_days, operating_dates")
          .eq("month", `${month}-01`),
      ]);
      vehicleError = vehiclesErr;
      if (vehiclesErr && /last_fuel_date|security_permit_expiry|vehicle_image_url|column/i.test(vehiclesErr.message)) {
        const fallback = await (supabase as any)
          .from("vehicles")
          .select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active, notes")
          .order("vehicle_no");
        vehicles = (fallback.data ?? []).map((row: any) => ({
          ...row,
          last_fuel_date: null,
          security_permit_expiry: null,
          vehicle_image_url: null,
        }));
        vehicleError = fallback.error;
      } else {
        vehicles = (vehiclesData ?? []) as Vehicle[];
      }
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
      return { vehicles, operations: operations ?? [] };
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
      <Tabs defaultValue="list" className="space-y-6">
        <TabsList className="glass-card h-auto w-full justify-start gap-1 rounded-full p-1 sm:w-auto sm:justify-center">
          <TabsTrigger
            value="list"
            className="gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:bg-white/70 data-[state=active]:text-teal-800 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white"
          >
            <ListChecks className="h-4 w-4" /> سجل المركبات
          </TabsTrigger>
          <TabsTrigger
            value="details"
            className="gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:bg-white/70 data-[state=active]:text-teal-800 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white"
          >
            <CarFront className="h-4 w-4" /> تفاصيل المركبة
          </TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="space-y-6">
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
        </TabsContent>
        <TabsContent value="details">
          <VehicleDetailsTab vehicles={query.data?.vehicles ?? []} isLoading={query.isLoading} />
        </TabsContent>
      </Tabs>
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

function VehicleDetailsTab({ vehicles, isLoading }: { vehicles: Vehicle[]; isLoading: boolean }) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0] ?? null;

  const attachDefault = useMutation({
    mutationFn: async (vehicleId: string) => {
      const { error } = await (supabase as any)
        .from("vehicles")
        .update({ vehicle_image_url: DEFAULT_VEHICLE_IMAGE })
        .eq("id", vehicleId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم اعتماد شكل المركبة");
      await client.invalidateQueries({ queryKey: ["vehicles"] });
    },
    onError: (error: Error) => toast.error(`تعذر اعتماد الشكل: ${formatErrorMessage(error)}`),
  });

  const attachImage = async (file: File) => {
    if (!selected) return;
    setAttaching(true);
    try {
      const url = await uploadVehicleImage(file, selected.id);
      const { error } = await (supabase as any)
        .from("vehicles")
        .update({ vehicle_image_url: url })
        .eq("id", selected.id);
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("تم إرفاق شكل المركبة");
    } catch (error) {
      toast.error(`تعذر إرفاق الصورة: ${formatErrorMessage(error)}`);
    } finally {
      setAttaching(false);
    }
  };

  if (isLoading) {
    return <p className="p-8 text-center text-muted-foreground">جارٍ تحميل تفاصيل المركبات…</p>;
  }
  if (!selected) {
    return (
      <div className="glass-card rounded-3xl p-8 text-center text-muted-foreground">
        لا توجد مركبات مسجلة بعد. أضف مركبة من تبويب «سجل المركبات» أولاً.
      </div>
    );
  }

  const hasImage = Boolean(selected.vehicle_image_url?.trim());

  return (
    <div className="space-y-6">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {vehicles.map((vehicle) => {
          const isSelected = selected.id === vehicle.id;
          return (
            <button
              key={vehicle.id}
              type="button"
              onClick={() => {
                setSelectedId(vehicle.id);
                setEditing(false);
              }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold backdrop-blur-xl backdrop-saturate-150 transition-all duration-200",
                isSelected
                  ? "border-transparent bg-teal-500/90 text-white shadow-lg shadow-teal-900/20"
                  : "border-white/40 bg-white/40 text-muted-foreground hover:bg-white/70 hover:text-foreground dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
              )}
            >
              <CarFront className="h-4 w-4" />
              {vehicle.name}
              <span className={cn("text-[11px] font-normal", isSelected ? "text-white/80" : "text-muted-foreground/70")}>
                {vehicle.vehicle_no}
              </span>
            </button>
          );
        })}
      </div>

      {hasImage ? (
        <div className="glass-card rounded-3xl p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <CarFront className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-lg font-bold">{selected.name}</h2>
                <p className="text-xs text-muted-foreground">
                  لوحة {selected.vehicle_no} ·{" "}
                  {selected.vehicle_class === "light" ? "مركبة خفيفة" : "مركبة ثقيلة"}
                </p>
              </div>
            </div>
            <Badge variant={selected.is_active ? "default" : "secondary"}>
              {selected.is_active ? "نشطة" : "موقوفة"}
            </Badge>
          </div>
          <VehicleDiagram
            data={{
              plate: selected.vehicle_no,
              vehicleClass: selected.vehicle_class,
              lastFuelDate: selected.last_fuel_date,
              permitExpiry: selected.security_permit_expiry,
              imageUrl: selected.vehicle_image_url,
            }}
          />
        </div>
      ) : !editing ? (
        <div className="glass-card flex flex-col items-center justify-center gap-4 rounded-3xl px-6 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
            <CarFront className="h-8 w-8" />
          </span>
          <div>
            <h3 className="text-base font-bold">أرفق شكل المركبة</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              لم تُرفق صورة لهذه المركبة بعد. أضف شكلها لعرض رقم اللوحة وآخر تعبئة وقود وتاريخ انتهاء
              التصريح الأمني على الرسم.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90",
                attaching && "pointer-events-none opacity-60",
              )}
            >
              <Upload className="h-4 w-4" />
              {attaching ? "جارٍ الرفع…" : "إرفاق شكل المركبة"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attachImage(file);
                  event.target.value = "";
                }}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => attachDefault.mutate(selected.id)}
              disabled={attachDefault.isPending}
            >
              اعتماد الشكل الافتراضي
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
              تعديل التفاصيل
            </Button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <VehicleDetailForm
          key={selected.id}
          vehicle={selected}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : hasImage ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilLine className="ml-2 h-4 w-4" /> تعديل التفاصيل
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function VehicleDetailForm({
  vehicle,
  onCancel,
  onSaved,
}: {
  vehicle: Vehicle;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(vehicle.name);
  const [vehicleClass, setVehicleClass] = useState<"light" | "heavy">(vehicle.vehicle_class);
  const [dailyRate, setDailyRate] = useState(String(vehicle.daily_rate));
  const [lastFuelDate, setLastFuelDate] = useState(vehicle.last_fuel_date ?? "");
  const [permitExpiry, setPermitExpiry] = useState(vehicle.security_permit_expiry ?? "");
  const [notes, setNotes] = useState(vehicle.notes ?? "");
  const [isActive, setIsActive] = useState(vehicle.is_active);
  const [imageUrl, setImageUrl] = useState(vehicle.vehicle_image_url ?? "");
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadVehicleImage(file, vehicle.id);
      setImageUrl(url);
      toast.success("تم رفع صورة المركبة، اضغط «حفظ التفاصيل» لتثبيتها");
    } catch (error) {
      toast.error(`تعذر رفع الصورة: ${formatErrorMessage(error)}`);
    } finally {
      setUploading(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const rate = Number(dailyRate);
      if (!name.trim()) throw new Error("اسم المركبة مطلوب");
      if (!Number.isFinite(rate) || rate < 0) throw new Error("أدخل أجراً يومياً صحيحاً");
      const { error } = await (supabase as any)
        .from("vehicles")
        .update({
          name: name.trim(),
          vehicle_class: vehicleClass,
          daily_rate: rate,
          last_fuel_date: lastFuelDate || null,
          security_permit_expiry: permitExpiry || null,
          notes: notes.trim() || null,
          is_active: isActive,
          vehicle_image_url: imageUrl.trim() || null,
        })
        .eq("id", vehicle.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حفظ تفاصيل المركبة");
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["payroll"] });
      await client.invalidateQueries({ queryKey: ["monthly", "vehicle-report"] });
      onSaved();
    },
    onError: (error: Error) => toast.error(`تعذر حفظ التفاصيل: ${formatErrorMessage(error)}`),
  });

  return (
    <div className="glass-card rounded-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <PencilLine className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">تحرير تفاصيل المركبة</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="d-name">الاسم / النوع</Label>
          <Input id="d-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>الفئة</Label>
          <Select value={vehicleClass} onValueChange={(value) => setVehicleClass(value as "light" | "heavy")}>
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
          <Label htmlFor="d-rate">الأجر اليومي (د.ع)</Label>
          <Input
            id="d-rate"
            type="number"
            min="0"
            value={dailyRate}
            onChange={(event) => setDailyRate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-fuel">آخر تعبئة وقود</Label>
          <Input id="d-fuel" type="date" value={lastFuelDate} onChange={(event) => setLastFuelDate(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-permit">انتهاء التصريح الأمني</Label>
          <Input id="d-permit" type="date" value={permitExpiry} onChange={(event) => setPermitExpiry(event.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="d-notes">ملاحظات</Label>
          <Textarea id="d-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <Label>شكل المركبة</Label>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-accent",
                uploading && "pointer-events-none opacity-60",
              )}
            >
              <Upload className="h-4 w-4" />
              {uploading ? "جارٍ الرفع…" : imageUrl ? "استبدال الصورة" : "إرفاق شكل المركبة"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImageUpload(file);
                  event.target.value = "";
                }}
              />
            </label>
            {!imageUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImageUrl(DEFAULT_VEHICLE_IMAGE)}
              >
                اعتماد الشكل الافتراضي
              </Button>
            )}
            {imageUrl && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl("")}>
                إزالة الصورة
              </Button>
            )}
            <span className="text-xs text-muted-foreground">PNG أو JPG أو WebP — حتى 5MB</span>
          </div>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="معاينة شكل المركبة"
              className="mt-1 h-24 w-auto rounded-lg border bg-white object-contain p-1"
            />
          ) : (
            <div className="mt-1 flex h-24 w-44 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              لم تُرفق صورة بعد
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          {isActive ? "المركبة نشطة" : "المركبة موقوفة"}
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="ml-2 h-4 w-4" /> {save.isPending ? "جارٍ الحفظ…" : "حفظ التفاصيل"}
          </Button>
        </div>
      </div>
    </div>
  );
}

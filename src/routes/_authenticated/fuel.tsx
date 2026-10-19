import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currentMonthInBaghdad, todayInBaghdad } from "@/lib/date-time";
import {
  Banknote,
  Droplet,
  Fuel,
  ImageIcon,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fuel")({
  head: () => ({ meta: [{ title: "إدارة الوقود" }] }),
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
  component: FuelPage,
});

type FuelType = "diesel" | "gasoline";

type VehicleLite = {
  id: string;
  vehicle_no: string;
  name: string;
  fuel_type: FuelType;
  current_driver_id: string | null;
  current_odometer: number;
};

type DriverLite = { id: string; full_name: string };

type Voucher = {
  id: string;
  voucher_no: string;
  vehicle_id: string;
  driver_id: string | null;
  fuel_type: FuelType;
  liters: number;
  price_per_liter: number;
  total_cost: number;
  odometer_reading: number | null;
  fuel_station: string | null;
  voucher_date: string;
  receipt_image_url: string | null;
  notes: string | null;
  created_at: string;
};

const FUEL_LABEL: Record<FuelType, string> = { diesel: "كاز (ديزل)", gasoline: "بنزين" };
const fuelLabel = (type: FuelType) => FUEL_LABEL[type] ?? type;

function money(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return (Number.isFinite(number) ? Math.round(number) : 0).toLocaleString("ar-IQ");
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-IQ", { day: "numeric", month: "long", year: "numeric" });
}

function monthKeyFromDate(date: string) {
  return date.slice(0, 7).replace("-", "");
}

async function nextVoucherNumber(date: string) {
  const monthKey = monthKeyFromDate(date);
  const { data, error } = await (supabase as any)
    .from("vehicle_fuel_vouchers")
    .select("voucher_no")
    .like("voucher_no", `VOUCH-${monthKey}-%`);
  if (error) return `VOUCH-${monthKey}-0001`;
  const max = (data ?? []).reduce((acc: number, row: { voucher_no: string }) => {
    const match = String(row.voucher_no).match(/(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `VOUCH-${monthKey}-${String(max + 1).padStart(4, "0")}`;
}

async function uploadFuelReceipt(file: File, voucherNo: string) {
  if (!file.type.startsWith("image/")) throw new Error("اختر صورة صالحة للوصل");
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم صورة الوصل يتجاوز 5 ميغابايت");
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const path = `${voucherNo || "voucher"}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("fuel-receipts")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error(
        "مخزن وصولات الوقود (fuel-receipts) غير موجود. شغّل ترحيل 20261019150000_vehicle_fuel_module.sql لإنشائه.",
      );
    }
    throw error;
  }
  const { data } = supabase.storage.from("fuel-receipts").getPublicUrl(path);
  return data.publicUrl;
}

const printCell: CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  textAlign: "right",
  verticalAlign: "top",
};

function FuelPage() {
  const client = useQueryClient();
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonthInBaghdad);
  const [fuelTypeFilter, setFuelTypeFilter] = useState<"all" | FuelType>("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("");
  const [search, setSearch] = useState("");

  const vehiclesQuery = useQuery({
    queryKey: ["fuel-vehicles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("id, vehicle_no, name, fuel_type, current_driver_id, current_odometer")
        .order("vehicle_no");
      if (error) throw error;
      return (data ?? []) as VehicleLite[];
    },
  });
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const vehicleById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);

  const driversQuery = useQuery({
    queryKey: ["fuel-drivers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("id, full_name")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as DriverLite[];
    },
  });
  const drivers = useMemo(() => driversQuery.data ?? [], [driversQuery.data]);
  const driverById = useMemo(() => new Map(drivers.map((driver) => [driver.id, driver])), [drivers]);

  const vouchersQuery = useQuery({
    queryKey: ["fuel-vouchers", month],
    queryFn: async () => {
      const [year, monthNumber] = month.split("-").map(Number);
      const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("vehicle_fuel_vouchers")
        .select("*")
        .gte("voucher_date", `${month}-01`)
        .lt("voucher_date", nextMonth)
        .order("voucher_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Voucher[];
    },
  });

  const filteredVouchers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const station = stationFilter.trim().toLowerCase();
    return (vouchersQuery.data ?? []).filter((voucher) => {
      if (fuelTypeFilter !== "all" && voucher.fuel_type !== fuelTypeFilter) return false;
      if (vehicleFilter !== "all" && voucher.vehicle_id !== vehicleFilter) return false;
      if (station && !(voucher.fuel_station ?? "").toLowerCase().includes(station)) return false;
      if (term) {
        const haystack = [
          voucher.voucher_no,
          voucher.fuel_station,
          vehicleById.get(voucher.vehicle_id)?.name,
          vehicleById.get(voucher.vehicle_id)?.vehicle_no,
          driverById.get(voucher.driver_id ?? "")?.full_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [vouchersQuery.data, fuelTypeFilter, vehicleFilter, stationFilter, search, vehicleById, driverById]);

  const stats = useMemo(() => {
    const totalLiters = filteredVouchers.reduce((sum, row) => sum + Number(row.liters || 0), 0);
    const dieselLiters = filteredVouchers
      .filter((row) => row.fuel_type === "diesel")
      .reduce((sum, row) => sum + Number(row.liters || 0), 0);
    const gasolineLiters = filteredVouchers
      .filter((row) => row.fuel_type === "gasoline")
      .reduce((sum, row) => sum + Number(row.liters || 0), 0);
    const totalCost = filteredVouchers.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
    return { totalLiters, dieselLiters, gasolineLiters, totalCost, count: filteredVouchers.length };
  }, [filteredVouchers]);

  const [open, setOpen] = useState(false);
  const [voucherNo, setVoucherNo] = useState("");
  const [voucherDate, setVoucherDate] = useState(todayInBaghdad());
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [fuelType, setFuelType] = useState<FuelType>("diesel");
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [odometer, setOdometer] = useState("");
  const [station, setStation] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  const total = useMemo(() => {
    const litersNumber = Number(liters);
    const priceNumber = Number(pricePerLiter);
    if (!Number.isFinite(litersNumber) || !Number.isFinite(priceNumber)) return 0;
    return Math.round(litersNumber * priceNumber * 100) / 100;
  }, [liters, pricePerLiter]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    nextVoucherNumber(voucherDate).then((value) => {
      if (active) setVoucherNo(value);
    });
    return () => {
      active = false;
    };
  }, [open, voucherDate]);

  const resetForm = () => {
    setVoucherNo("");
    setVoucherDate(todayInBaghdad());
    setVehicleId("");
    setDriverId("");
    setFuelType("diesel");
    setLiters("");
    setPricePerLiter("");
    setOdometer("");
    setStation("");
    setNotes("");
    setReceiptFile(null);
    setReceiptPreview(null);
  };

  const handleVehicleChange = (id: string) => {
    setVehicleId(id);
    const vehicle = vehicles.find((item) => item.id === id);
    if (vehicle) {
      setFuelType(vehicle.fuel_type);
      setDriverId(vehicle.current_driver_id ?? "");
      setOdometer(String(vehicle.current_odometer ?? 0));
    }
  };

  const createVoucher = useMutation({
    mutationFn: async () => {
      const litersNumber = Number(liters);
      const priceNumber = Number(pricePerLiter);
      if (!vehicleId) throw new Error("اختر المركبة أولاً");
      if (!Number.isFinite(litersNumber) || litersNumber <= 0) throw new Error("أدخل كمية لترات صحيحة");
      if (!Number.isFinite(priceNumber) || priceNumber < 0) throw new Error("أدخل سعر لتر صحيحاً");
      const odometerNumber = odometer.trim() ? Number(odometer) : null;
      if (odometerNumber !== null && (!Number.isFinite(odometerNumber) || odometerNumber < 0))
        throw new Error("أدخل قراءة عداد صحيحة");
      let receiptUrl: string | null = null;
      if (receiptFile) receiptUrl = await uploadFuelReceipt(receiptFile, voucherNo);
      const { error } = await (supabase as any).from("vehicle_fuel_vouchers").insert({
        voucher_no: voucherNo.trim(),
        vehicle_id: vehicleId,
        driver_id: driverId || null,
        fuel_type: fuelType,
        liters: litersNumber,
        price_per_liter: priceNumber,
        total_cost: Math.round(litersNumber * priceNumber * 100) / 100,
        odometer_reading: odometerNumber,
        fuel_station: station.trim() || null,
        voucher_date: voucherDate,
        receipt_image_url: receiptUrl,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم إصدار وصل الوقود");
      setOpen(false);
      resetForm();
      await client.invalidateQueries({ queryKey: ["fuel-vouchers"] });
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["vehicle-month-fuel"] });
      await client.invalidateQueries({ queryKey: ["fuel-vehicles"] });
    },
    onError: (error: Error) => toast.error(`تعذر حفظ الوصل: ${formatErrorMessage(error)}`),
  });

  const deleteVoucher = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("vehicle_fuel_vouchers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف الوصل");
      await client.invalidateQueries({ queryKey: ["fuel-vouchers"] });
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      await client.invalidateQueries({ queryKey: ["vehicle-month-fuel"] });
    },
    onError: (error: Error) => toast.error(`تعذر حذف الوصل: ${formatErrorMessage(error)}`),
  });

  const handlePrint = (voucher: Voucher) => {
    setPrintVoucher(voucher);
    window.setTimeout(() => window.print(), 150);
  };

  const workspaceName =
    (typeof window !== "undefined" && window.localStorage.getItem("zkt-workspace-name")) || "منظومة زِكت";

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-primary/10 p-3">
          <Fuel className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">إدارة الوقود</h1>
          <p className="text-muted-foreground">
            وصولات الوقود الشهرية، الكميات والكلفة وإحصاءات الصرف لكل مركبة.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="شهر الوصولات"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="w-44"
          />
          <Badge variant="secondary">{filteredVouchers.length} وصل</Badge>
        </div>
        <Button
          onClick={() => {
            resetForm();
            const first = vehicles[0];
            if (first) {
              setVehicleId(first.id);
              setFuelType(first.fuel_type);
              setDriverId(first.current_driver_id ?? "");
              setOdometer(String(first.current_odometer ?? 0));
            }
            setOpen(true);
          }}
        >
          <Plus className="ml-2 h-4 w-4" /> إصدار وصل وقود
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Droplet className="h-4 w-4 text-primary" /> إجمالي اللترات المصروفة
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {stats.totalLiters.toLocaleString()} <span className="text-sm font-normal">لتر</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            كاز {stats.dieselLiters.toLocaleString()} لتر · بنزين {stats.gasolineLiters.toLocaleString()} لتر
          </p>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Banknote className="h-4 w-4 text-primary" /> إجمالي المبالغ المصروفة
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {money(stats.totalCost)} <span className="text-sm font-normal">د.ع</span>
          </p>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ReceiptText className="h-4 w-4 text-primary" /> عدد الوصولات الصادرة
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">{stats.count}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>سجل وصولات الوقود</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              فلترة حسب الشهر ونوع الوقود والمركبة ومحطة التعبئة.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="بحث سريع"
              className="pr-9"
              placeholder="بحث برقم الوصل / المركبة / السائق…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>نوع الوقود</Label>
              <Select value={fuelTypeFilter} onValueChange={(value) => setFuelTypeFilter(value as "all" | FuelType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="diesel">كاز (ديزل)</SelectItem>
                  <SelectItem value="gasoline">بنزين</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>المركبة</Label>
              <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المركبات</SelectItem>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name} · {vehicle.vehicle_no}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>محطة التعبئة</Label>
              <Input
                placeholder="اسم المحطة أو المستودع"
                value={stationFilter}
                onChange={(event) => setStationFilter(event.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {vouchersQuery.isError ? (
              <p className="p-8 text-center text-destructive">
                تعذر تحميل وصولات الوقود: {(vouchersQuery.error as Error).message}
              </p>
            ) : vouchersQuery.isLoading ? (
              <p className="p-8 text-center text-muted-foreground">جارٍ تحميل الوصولات…</p>
            ) : (
              <table className="w-full min-w-[1050px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-right">
                    <th className="p-3">رقم الوصل</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">المركبة</th>
                    <th className="p-3">السائق</th>
                    <th className="p-3">نوع الوقود</th>
                    <th className="p-3">الكمية (لتر)</th>
                    <th className="p-3">السعر/لتر</th>
                    <th className="p-3">الإجمالي (د.ع)</th>
                    <th className="p-3">العداد</th>
                    <th className="p-3">الوصل الورقي</th>
                    <th className="p-3">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVouchers.map((voucher) => {
                    const vehicle = vehicleById.get(voucher.vehicle_id);
                    const driverName = driverById.get(voucher.driver_id ?? "")?.full_name;
                    return (
                      <tr key={voucher.id} className="border-b">
                        <td className="p-3 font-mono text-xs">{voucher.voucher_no}</td>
                        <td className="p-3 whitespace-nowrap">{dateLabel(voucher.voucher_date)}</td>
                        <td className="p-3">
                          <b>{vehicle?.name ?? "—"}</b>
                          <div className="text-xs text-muted-foreground">{vehicle?.vehicle_no ?? ""}</div>
                        </td>
                        <td className="p-3">{driverName ?? "—"}</td>
                        <td className="p-3">
                          <Badge variant={voucher.fuel_type === "diesel" ? "secondary" : "outline"}>
                            {fuelLabel(voucher.fuel_type)}
                          </Badge>
                        </td>
                        <td className="p-3 tabular-nums">{Number(voucher.liters).toLocaleString()}</td>
                        <td className="p-3 tabular-nums">{money(voucher.price_per_liter)} د.ع</td>
                        <td className="p-3 font-semibold tabular-nums">{money(voucher.total_cost)} د.ع</td>
                        <td className="p-3 tabular-nums">
                          {voucher.odometer_reading === null ? "—" : `${Number(voucher.odometer_reading).toLocaleString()} كم`}
                        </td>
                        <td className="p-3">
                          {voucher.receipt_image_url ? (
                            <a href={voucher.receipt_image_url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={voucher.receipt_image_url}
                                alt={`وصل ${voucher.voucher_no}`}
                                className="h-10 w-10 rounded-md border object-cover"
                              />
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <ImageIcon className="h-4 w-4" /> لا يوجد
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`طباعة وصل ${voucher.voucher_no}`}
                              onClick={() => handlePrint(voucher)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`حذف وصل ${voucher.voucher_no}`}
                              onClick={() => {
                                if (confirm(`حذف الوصل ${voucher.voucher_no}؟`)) deleteVoucher.mutate(voucher.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!vouchersQuery.isLoading && filteredVouchers.length === 0 && (
              <p className="p-8 text-center text-muted-foreground">لا توجد وصولات وقود لهذا الشهر.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) resetForm(); }}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>إصدار وصل وقود جديد</DialogTitle>
            <DialogDescription>سند صرف وقود للمركبة والسائق مع إمكانية الطباعة.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="v-no">رقم الوصل</Label>
              <Input id="v-no" value={voucherNo} readOnly className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-date">التاريخ</Label>
              <Input id="v-date" type="date" value={voucherDate} onChange={(event) => setVoucherDate(event.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>المركبة</Label>
              <Select value={vehicleId} onValueChange={handleVehicleChange}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر المركبة" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name} · {vehicle.vehicle_no}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>السائق</Label>
              <Select value={driverId || "none"} onValueChange={(value) => setDriverId(value === "none" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر السائق" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون سائق</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>نوع الوقود</Label>
              <Select value={fuelType} onValueChange={(value) => setFuelType(value as FuelType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diesel">كاز (ديزل)</SelectItem>
                  <SelectItem value="gasoline">بنزين</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-liters">الكمية (لتر)</Label>
              <Input
                id="v-liters"
                type="number"
                min="0"
                step="0.01"
                value={liters}
                onChange={(event) => setLiters(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-price">سعر اللتر (د.ع)</Label>
              <Input
                id="v-price"
                type="number"
                min="0"
                step="0.01"
                value={pricePerLiter}
                onChange={(event) => setPricePerLiter(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>الإجمالي (د.ع)</Label>
              <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-bold tabular-nums">
                {money(total)} د.ع
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-odo">قراءة العداد (كم)</Label>
              <Input
                id="v-odo"
                type="number"
                min="0"
                step="0.01"
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="v-station">محطة التعبئة / المستودع</Label>
              <Input id="v-station" value={station} onChange={(event) => setStation(event.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>صورة الوصل الورقي (اختياري)</Label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
                  <ImageIcon className="h-4 w-4" />
                  {receiptFile ? receiptFile.name : "اختيار صورة الوصل"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setReceiptFile(file);
                      if (file) setReceiptPreview(URL.createObjectURL(file));
                      event.target.value = "";
                    }}
                  />
                </label>
                {receiptFile && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}>
                    إزالة
                  </Button>
                )}
              </div>
              {receiptPreview && (
                <img src={receiptPreview} alt="معاينة الوصل" className="mt-1 h-24 w-auto rounded-lg border object-contain p-1" />
              )}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="v-notes">ملاحظات</Label>
              <Textarea id="v-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => createVoucher.mutate()} disabled={createVoucher.isPending}>
              <Save className="ml-2 h-4 w-4" /> {createVoucher.isPending ? "جارٍ الحفظ…" : "إصدار الوصل"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {printVoucher && (
        <div className="fuel-voucher-print" dir="rtl">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #0f172a", paddingBottom: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{workspaceName}</h1>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>سند صرف وقود</p>
            </div>
            <div style={{ textAlign: "left", fontSize: 12, lineHeight: 1.7 }}>
              <p style={{ margin: 0 }}>رقم الوصل: <b>{printVoucher.voucher_no}</b></p>
              <p style={{ margin: 0 }}>التاريخ: <b>{dateLabel(printVoucher.voucher_date)}</b></p>
            </div>
          </div>
          <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <tr>
                <td style={printCell}>المركبة</td>
                <td style={printCell}>
                  {vehicleById.get(printVoucher.vehicle_id)?.name ?? "—"} ·{" "}
                  {vehicleById.get(printVoucher.vehicle_id)?.vehicle_no ?? ""}
                </td>
              </tr>
              <tr>
                <td style={printCell}>السائق</td>
                <td style={printCell}>{driverById.get(printVoucher.driver_id ?? "")?.full_name ?? "—"}</td>
              </tr>
              <tr>
                <td style={printCell}>نوع الوقود</td>
                <td style={printCell}>{fuelLabel(printVoucher.fuel_type)}</td>
              </tr>
              <tr>
                <td style={printCell}>الكمية</td>
                <td style={printCell}>{Number(printVoucher.liters).toLocaleString()} لتر</td>
              </tr>
              <tr>
                <td style={printCell}>سعر اللتر</td>
                <td style={printCell}>{money(printVoucher.price_per_liter)} د.ع</td>
              </tr>
              <tr>
                <td style={printCell}>الإجمالي</td>
                <td style={printCell}>
                  <b>{money(printVoucher.total_cost)} د.ع</b>
                </td>
              </tr>
              <tr>
                <td style={printCell}>قراءة العداد</td>
                <td style={printCell}>
                  {printVoucher.odometer_reading === null ? "—" : `${Number(printVoucher.odometer_reading).toLocaleString()} كم`}
                </td>
              </tr>
              <tr>
                <td style={printCell}>محطة التعبئة / المستودع</td>
                <td style={printCell}>{printVoucher.fuel_station || "—"}</td>
              </tr>
              <tr>
                <td style={printCell}>ملاحظات</td>
                <td style={printCell}>{printVoucher.notes || "—"}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 56 }}>
            {["توقيع السائق", "توقيع المستلم", "توقيع المخوّل"].map((label) => (
              <div key={label} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ borderTop: "1px solid #0f172a", paddingTop: 8, fontSize: 12 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

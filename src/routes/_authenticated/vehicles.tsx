import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
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
  Building2,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CarFront,
  Check,
  Fuel,
  Eye,
  FileUp,
  Gauge,
  ListChecks,
  Loader2,
  PencilLine,
  Phone,
  Plus,
  Save,
  Trash2,
  Truck,
  Upload,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { currentMonthInBaghdad } from "@/lib/date-time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/vehicles")({
  head: () => ({ meta: [{ title: "المركبات" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    if (
      !roles?.some((item) =>
        ["admin", "hr", "maintenance_manager", "maintenance_admin"].includes(item.role),
      )
    )
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
  fuel_type: "gasoline" | "diesel";
  current_driver_id: string | null;
  current_odometer: number;
};

type Driver = {
  id: string;
  full_name: string;
  position: string | null;
  phone1: string | null;
  department_id: string | null;
  departments?: { name: string } | null;
};
type Machinery = {
  id: string;
  code: string;
  name: string;
  asset_number: string | null;
  owner_name: string | null;
  category: string | null;
  plate_no: string | null;
  model: string | null;
  year: number | null;
  status: "active" | "maintenance" | "inactive";
  current_hours: number;
  current_odometer: number;
  daily_rent?: number;
  document_status?: string | null;
  ato_status?: string | null;
  security_permit_status?: string | null;
  source_row?: number | null;
  color?: string | null;
  driver_name?: string | null;
  document_days_remaining?: string | null;
  requires_ato?: boolean;
  ato_expiry?: string | null;
  security_permit_no?: string | null;
  security_permit_expiry?: string | null;
  driver_daily_cost?: number;
  extra_hourly_rate?: number;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MachineryImportRow = Record<string, unknown>;
const MACHINERY_IMPORT_COLUMNS = [
  "#",
  "رقم المركبة",
  "كود المركبة",
  "نوع المركبة",
  "الموديل",
  "سنة الصنع",
  "اللون",
  "حالة المركبة",
  "السائق",
  "حالة المستندات",
  "الأيام المتبقية للمستندات",
  "يتطلب ATO",
  "حالة ATO",
  "تاريخ انتهاء ATO",
  "التصريح الأمني",
  "حالة التصريح الأمني",
  "انتهاء التصريح الأمني",
  "سعر الإيجار اليومي",
  "تكلفة السائق اليومية",
  "سعر الساعة الإضافية",
  "جهة الملكية",
  "ملاحظات",
];

function excelValue(row: MachineryImportRow, key: string) {
  const value = row[key];
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function excelDate(value: unknown) {
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function meaningful(value: string | null | undefined) {
  return Boolean(value?.trim() && value.trim() !== "-");
}

function mapMachineryImportRow(row: MachineryImportRow) {
  const code = excelValue(row, "كود المركبة");
  const name = excelValue(row, "نوع المركبة");
  const assetNumber = excelValue(row, "رقم المركبة");
  if (!code || !name || !assetNumber) return null;
  const state = excelValue(row, "حالة المركبة") ?? "";
  const modelYear = Number(row["سنة الصنع"]);
  const amount = (key: string) => Number(row[key] ?? 0) || 0;
  return {
    source_row: Number(row["#"]) || null,
    code,
    name,
    asset_number: assetNumber,
    owner_name: excelValue(row, "جهة الملكية"),
    category: name,
    model: excelValue(row, "الموديل"),
    year: Number.isInteger(modelYear) && modelYear > 0 ? modelYear : null,
    color: excelValue(row, "اللون"),
    status: /صيانة/.test(state) ? "maintenance" : /نشط/.test(state) ? "active" : "inactive",
    driver_name: excelValue(row, "السائق"),
    document_status: excelValue(row, "حالة المستندات"),
    document_days_remaining: excelValue(row, "الأيام المتبقية للمستندات"),
    requires_ato: /نعم|yes|true/i.test(String(row["يتطلب ATO"] ?? "")),
    ato_status: excelValue(row, "حالة ATO"),
    ato_expiry: excelDate(row["تاريخ انتهاء ATO"]),
    security_permit_no: excelValue(row, "التصريح الأمني"),
    security_permit_status: excelValue(row, "حالة التصريح الأمني"),
    security_permit_expiry: excelDate(row["انتهاء التصريح الأمني"]),
    daily_rent: amount("سعر الإيجار اليومي"),
    driver_daily_cost: amount("تكلفة السائق اليومية"),
    extra_hourly_rate: amount("سعر الساعة الإضافية"),
    notes: excelValue(row, "ملاحظات"),
  };
}

type MachineryImportItem = NonNullable<ReturnType<typeof mapMachineryImportRow>>;

const EMPTY_VEHICLE_COLUMNS = {
  notes: null,
  last_fuel_date: null,
  security_permit_expiry: null,
  vehicle_image_url: null,
  fuel_type: "diesel",
  current_driver_id: null,
  current_odometer: 0,
} as const;

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

function describeVehicleImageError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  if (/bucket not found/i.test(message)) {
    return "مخزن صور المركبات (vehicle-images) غير موجود على قاعدة البيانات. شغّل ترحيل 20261019130000_vehicle_images.sql لإنشائه ثم أعد المحاولة.";
  }
  if (/vehicle_image_url/i.test(message) && /column|does not exist/i.test(message)) {
    return "عمود صورة المركبة (vehicle_image_url) غير موجود. شغّل ترحيل 20261019130000_vehicle_images.sql.";
  }
  return formatErrorMessage(error);
}

type MonthlyFuelStats = {
  liters: number;
  cost: number;
  count: number;
  lastDate: string | null;
};

function formatArabicDate(value: string | null) {
  if (!value) return "غير مسجل";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "غير مسجل";
  return date.toLocaleDateString("ar-IQ", { day: "numeric", month: "long", year: "numeric" });
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/50 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}

function VehicleMonthlyReport({
  month,
  vehicle,
  driver,
  operatingDays,
  operatingDates,
  wage,
  fuel,
}: {
  month: string;
  vehicle: Vehicle;
  driver: Driver | null;
  operatingDays: number;
  operatingDates: string[];
  wage: number;
  fuel: MonthlyFuelStats;
}) {
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("ar-IQ", {
    month: "long",
    year: "numeric",
  });
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">تقرير شهر {monthLabel}</h3>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <UserRound className="h-4 w-4 text-primary" /> السائق الحالي
          </div>
          {driver ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-base font-bold">{driver.full_name}</p>
              <p className="text-muted-foreground">{driver.position || "بدون مسمى وظيفي"}</p>
              <p className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {driver.phone1 || "لا يوجد هاتف"}
              </p>
              <p className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {driver.departments?.name || "بدون قسم"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">لم يُحدَّد سائق لهذه المركبة بعد.</p>
          )}
        </div>

        <div className="glass-card rounded-3xl p-5">
          <div className="flex items-center gap-2 text-sm font-bold">
            <CalendarDays className="h-4 w-4 text-primary" /> أيام التشغيل والأجر
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ReportStat label="أيام التشغيل" value={`${operatingDays} يوم`} />
            <ReportStat label="الأجر المستحق" value={`${Math.round(wage).toLocaleString()} د.ع`} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {operatingDates.length
              ? `التواريخ: ${operatingDates.map((date) => Number(date.slice(8))).join("، ")}`
              : operatingDays
                ? "عدد الأيام محفوظ دون تواريخ."
                : "لم تُسجَّل أيام تشغيل."}
          </p>
        </div>

        <div className="glass-card rounded-3xl p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Fuel className="h-4 w-4 text-primary" /> استهلاك الوقود
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ReportStat label="إجمالي اللترات" value={`${fuel.liters.toLocaleString()} لتر`} />
            <ReportStat
              label="إجمالي الكلفة"
              value={`${Math.round(fuel.cost).toLocaleString()} د.ع`}
            />
            <ReportStat label="عدد الوصولات" value={`${fuel.count}`} />
            <ReportStat label="آخر تعبئة" value={formatArabicDate(fuel.lastDate)} />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" />
            نوع الوقود: {vehicle.fuel_type === "diesel" ? "كاز (ديزل)" : "بنزين"} · العداد الحالي:{" "}
            {Number(vehicle.current_odometer).toLocaleString()} كم
          </p>
        </div>
      </div>
    </section>
  );
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
  const [machineryImport, setMachineryImport] = useState<MachineryImportItem[] | null>(null);
  const [invalidMachineryRows, setInvalidMachineryRows] = useState(0);
  const [machineryLimit, setMachineryLimit] = useState(20);
  const [machineryDates, setMachineryDates] = useState<Record<string, string[]>>({});
  const [activeMachinery, setActiveMachinery] = useState<Machinery | null>(null);
  const [machineryDetails, setMachineryDetails] = useState<Machinery | null>(null);
  const machineryQuery = useQuery({
    queryKey: ["maintenance-machinery", machineryLimit],
    queryFn: async () => {
      const { data, error, count } = await (supabase as any)
        .from("machinery")
        .select(
          "id, code, name, asset_number, owner_name, category, plate_no, model, year, status, current_hours, current_odometer, daily_rent, document_status, ato_status, security_permit_status, source_row, color, driver_name, document_days_remaining, requires_ato, ato_expiry, security_permit_no, security_permit_expiry, driver_daily_cost, extra_hourly_rate, notes, created_at, updated_at",
          { count: "exact" },
        )
        .order("code")
        .range(0, machineryLimit - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Machinery[], total: count ?? 0 };
    },
  });
  const machineryOperationsQuery = useQuery({
    queryKey: ["machinery-monthly-operations", month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("machinery_monthly_operations")
        .select("machinery_id, operating_dates")
        .eq("month", `${month}-01`);
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((row: { machinery_id: string; operating_dates: string[] }) => [
          row.machinery_id,
          (row.operating_dates ?? []).map((date) => date.slice(0, 10)),
        ]),
      ) as Record<string, string[]>;
    },
  });
  useEffect(() => {
    setMachineryDates({});
  }, [month]);
  useEffect(() => {
    if (machineryOperationsQuery.data) setMachineryDates(machineryOperationsQuery.data);
  }, [machineryOperationsQuery.data]);
  const saveMachineryAttendance = useMutation({
    mutationFn: async ({
      machineId,
      dates: selectedDates,
    }: {
      machineId: string;
      dates: string[];
    }) => {
      const normalizedDates = [...new Set(selectedDates)]
        .filter((date) => date.startsWith(`${month}-`))
        .sort();
      const { error } = await (supabase as any).from("machinery_monthly_operations").upsert(
        {
          machinery_id: machineId,
          month: `${month}-01`,
          operating_days: normalizedDates.length,
          operating_dates: normalizedDates,
        },
        { onConflict: "machinery_id,month" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      setActiveMachinery(null);
      toast.success("تم حفظ حضور الآلية");
      await client.invalidateQueries({ queryKey: ["machinery-monthly-operations", month] });
      await client.invalidateQueries({ queryKey: ["monthly", "machinery-report", month] });
    },
    onError: (error: Error) => toast.error(`تعذر حفظ حضور الآلية: ${formatErrorMessage(error)}`),
  });
  const machineryMaintenanceQuery = useQuery({
    queryKey: ["machinery-maintenance-statistics"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_records")
        .select("id, status, total_cost, maintenance_date")
        .eq("record_type", "machinery");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        status: string;
        total_cost: number;
        maintenance_date: string;
      }>;
    },
  });
  const importMachinery = useMutation({
    mutationFn: async (rows: MachineryImportItem[]) => {
      const { data: existing, error: existingError } = await (supabase as any)
        .from("machinery")
        .select("code, asset_number");
      if (existingError) throw existingError;
      const seenCodes = new Set<string>(
        (existing ?? []).map((item: { code: string }) => item.code.trim().toLowerCase()),
      );
      const seenNumbers = new Set<string>(
        (existing ?? [])
          .map((item: { asset_number: string | null }) => item.asset_number?.trim().toLowerCase())
          .filter(Boolean),
      );
      const toInsert: MachineryImportItem[] = [];
      let skipped = 0;
      for (const row of rows) {
        const codeKey = row.code.trim().toLowerCase();
        const numberKey = row.asset_number.trim().toLowerCase();
        if (seenCodes.has(codeKey) || seenNumbers.has(numberKey)) {
          skipped += 1;
          continue;
        }
        seenCodes.add(codeKey);
        seenNumbers.add(numberKey);
        toInsert.push(row);
      }
      for (let index = 0; index < toInsert.length; index += 50) {
        const { error } = await (supabase as any)
          .from("machinery")
          .insert(toInsert.slice(index, index + 50));
        if (error) throw error;
      }
      return { imported: toInsert.length, skipped };
    },
    onSuccess: async ({ imported, skipped }) => {
      toast.success(`تم استيراد ${imported} آلية${skipped ? `، وتجاوز ${skipped} سجل مكرر` : ""}`);
      setMachineryImport(null);
      await client.invalidateQueries({ queryKey: ["maintenance-machinery"] });
    },
    onError: (error: Error) => toast.error(`تعذر استيراد الآليات: ${formatErrorMessage(error)}`),
  });
  const handleMachineryFile = async (file: File) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("الملف لا يحتوي على ورقة بيانات");
      const rawRows = XLSX.utils.sheet_to_json<MachineryImportRow>(sheet, {
        defval: null,
        raw: true,
      });
      const headers = Object.keys(rawRows[0] ?? {});
      const missingHeaders = MACHINERY_IMPORT_COLUMNS.filter((header) => !headers.includes(header));
      if (missingHeaders.length)
        throw new Error(`الأعمدة غير الموجودة: ${missingHeaders.join("، ")}`);
      const rows = rawRows
        .map(mapMachineryImportRow)
        .filter((row): row is MachineryImportItem => row !== null);
      if (!rows.length) throw new Error("لم أجد أعمدة رقم المركبة وكودها ونوعها في الورقة الأولى");
      setMachineryImport(rows);
      setInvalidMachineryRows(rawRows.length - rows.length);
    } catch (error) {
      toast.error(`تعذر قراءة ملف Excel: ${formatErrorMessage(error)}`);
    }
  };
  const query = useQuery({
    queryKey: ["vehicles", month],
    queryFn: async () => {
      let vehicles: Vehicle[] = [];
      let vehicleError: any = null;
      const [{ data: vehiclesData, error: vehiclesErr }, operationsResult] = await Promise.all([
        (supabase as any)
          .from("vehicles")
          .select(
            "id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active, notes, last_fuel_date, security_permit_expiry, vehicle_image_url, fuel_type, current_driver_id, current_odometer",
          )
          .order("vehicle_no"),
        (supabase as any)
          .from("vehicle_monthly_operations")
          .select("vehicle_id, operating_days, operating_dates")
          .eq("month", `${month}-01`),
      ]);
      vehicleError = vehiclesErr;
      if (
        vehiclesErr &&
        /last_fuel_date|security_permit_expiry|vehicle_image_url|fuel_type|current_driver_id|current_odometer|column/i.test(
          vehiclesErr.message,
        )
      ) {
        const fallback = await (supabase as any)
          .from("vehicles")
          .select("id, vehicle_no, name, vehicle_class, daily_rate, currency, is_active")
          .order("vehicle_no");
        vehicles = (fallback.data ?? []).map((row: any) => ({
          ...row,
          ...EMPTY_VEHICLE_COLUMNS,
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
        operations = (fallback.data ?? []).map(
          (row: { vehicle_id: string; operating_days: number }) => ({
            ...row,
            operating_dates: [],
          }),
        );
        operationError = fallback.error;
      }
      if (vehicleError) throw vehicleError;
      if (operationError) throw operationError;
      const initial: Record<string, string[]> = {};
      const legacy: Record<string, number> = {};
      for (const row of operations ?? []) {
        initial[row.vehicle_id] = (row.operating_dates ?? []).map((date: string) =>
          date.slice(0, 10),
        );
        legacy[row.vehicle_id] = Number(row.operating_days ?? 0);
      }
      setDates(initial);
      setLegacyDays(legacy);
      return { vehicles, operations: operations ?? [] };
    },
  });
  const createVehicle = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("vehicles").insert({
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
  const monthDates = useMemo(
    () =>
      Array.from({ length: monthDayCount }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${month}-${day}`;
      }),
    [month, monthDayCount],
  );
  const saveDays = useMutation({
    mutationFn: async ({
      vehicleId,
      operatingDates,
    }: {
      vehicleId: string;
      operatingDates: string[];
    }) => {
      const normalizedDates = [...new Set(operatingDates)]
        .filter((date) => date.startsWith(`${month}-`))
        .sort();
      const operatingDays = normalizedDates.length;
      if (!Number.isInteger(operatingDays) || operatingDays < 0 || operatingDays > monthDayCount)
        throw new Error(`أدخل عدداً بين 0 و${monthDayCount}`);
      const { error } = await (supabase as any).from("vehicle_monthly_operations").upsert(
        {
          vehicle_id: vehicleId,
          month: `${month}-01`,
          operating_days: operatingDays,
          operating_dates: normalizedDates,
        },
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
  const machineryRows = machineryQuery.data?.rows ?? [];
  const machineryMaintenanceRows = machineryMaintenanceQuery.data ?? [];
  const machineMonth = currentMonthInBaghdad();
  const monthMaintenanceRows = machineryMaintenanceRows.filter((row) =>
    row.maintenance_date.startsWith(machineMonth),
  );
  const existingMachineCodes = new Set(machineryRows.map((row) => row.code.trim().toLowerCase()));
  const existingMachineNumbers = new Set(
    machineryRows.map((row) => row.asset_number?.trim().toLowerCase()).filter(Boolean),
  );
  const duplicateMachineryImportCount =
    machineryImport?.filter(
      (row) =>
        existingMachineCodes.has(row.code.trim().toLowerCase()) ||
        existingMachineNumbers.has(row.asset_number.trim().toLowerCase()),
  ).length ?? 0;
  const incompleteMachineryCount = machineryRows.filter(
    (row) => !meaningful(row.name) || !meaningful(row.asset_number) || !meaningful(row.owner_name),
  ).length;
  const machineryDailyRent = machineryRows.reduce(
    (sum, row) => sum + Number(row.daily_rent ?? 0),
    0,
  );
  return (
    <div dir="rtl" className="space-y-6">
      <p className="text-sm font-medium text-muted-foreground">
        سجل المركبات والآليات وتشغيلها الشهري
      </p>
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
          <TabsTrigger
            value="machinery"
            className="gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground data-[state=active]:bg-white/70 data-[state=active]:text-teal-800 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/10 dark:data-[state=active]:text-white"
          >
            <Wrench className="h-4 w-4" /> الآليات
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
                        <td className="p-3">
                          {vehicle.vehicle_class === "light" ? "خفيفة" : "ثقيلة"}
                        </td>
                        <td className="p-3">{Number(vehicle.daily_rate).toLocaleString()} د.ع</td>
                        <td className="p-3">
                          <span className="font-semibold tabular-nums">
                            {(dates[vehicle.id] ?? []).length || legacyDays[vehicle.id] || 0}
                          </span>{" "}
                          يوم
                          <div className="mt-1 max-w-64 text-xs text-muted-foreground">
                            {(dates[vehicle.id] ?? []).length
                              ? (dates[vehicle.id] ?? [])
                                  .map((date) => Number(date.slice(8)))
                                  .join("، ")
                              : legacyDays[vehicle.id]
                                ? "العدد السابق محفوظ دون تحديد التواريخ"
                                : "لم تُسجّل تواريخ بعد"}
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
          <VehicleDetailsTab
            vehicles={query.data?.vehicles ?? []}
            isLoading={query.isLoading}
            month={month}
            dates={dates}
            legacyDays={legacyDays}
          />
        </TabsContent>
        <TabsContent value="machinery" className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>سجل الآليات</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  الهياب والكرين واللودر وغيرها، مع العدادات وساعات التشغيل.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <label className="cursor-pointer">
                    <FileUp className="ml-2 h-4 w-4" /> استيراد Excel
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void handleMachineryFile(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </Button>
                <Button asChild>
                  <a href="/maintenance">
                    <Wrench className="ml-2 h-4 w-4" /> إدارة وصيانة الآليات
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="border-t p-4">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" /> إحصائيات الآليات
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">إجمالي الآليات</p>
                  <p className="mt-1 text-xl font-bold">
                    {machineryQuery.data?.total ?? machineryRows.length}
                  </p>
                </div>
                <div className="rounded-xl border bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">نشطة ضمن المعروض</p>
                  <p className="mt-1 text-xl font-bold text-emerald-600">
                    {machineryRows.filter((row) => row.status === "active").length}
                  </p>
                </div>
                <div className="rounded-xl border bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">قيد الصيانة ضمن المعروض</p>
                  <p className="mt-1 text-xl font-bold text-amber-600">
                    {machineryRows.filter((row) => row.status === "maintenance").length}
                  </p>
              </div>
                <div className="rounded-xl border bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">بيانات ناقصة ضمن المعروض</p>
                  <p className="mt-1 text-xl font-bold text-rose-600">{incompleteMachineryCount}</p>
                </div>
                <div className="rounded-xl border bg-background/60 p-3">
                  <p className="text-xs text-muted-foreground">صيانة هذا الشهر · التكلفة</p>
                  <p className="mt-1 text-xl font-bold">
                    {monthMaintenanceRows.length} ·{" "}
                    {Math.round(
                      monthMaintenanceRows.reduce(
                        (sum, row) => sum + Number(row.total_cost ?? 0),
                        0,
                      ),
                    ).toLocaleString("ar-IQ")}{" "}
                    د.ع
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                مجموع الإيجار اليومي للآليات المعروضة:{" "}
                {Math.round(machineryDailyRent).toLocaleString("ar-IQ")} د.ع
              </p>
            </CardContent>
            {machineryOperationsQuery.isError && (
              <p role="alert" className="border-t bg-destructive/5 p-3 text-sm text-destructive">
                تعذر تحميل حضور الآليات. طبّق ترحيل machinery_monthly_operations في قاعدة البيانات.
              </p>
            )}
            <CardContent className="overflow-x-auto p-0">
              {machineryQuery.isLoading ? (
                <p className="p-8 text-center text-muted-foreground">جارٍ تحميل الآليات…</p>
              ) : (
                <table className="w-full min-w-[1050px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-right">
                      <th className="p-3">الآلية</th>
                      <th className="p-3">الرقم / الكود</th>
                      <th className="p-3">المالك</th>
                      <th className="p-3">الحالة</th>
                      <th className="p-3">البيانات</th>
                      <th className="p-3">ساعات التشغيل</th>
                      <th className="p-3">العداد</th>
                      <th className="p-3">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineryRows.map((machine) => (
                      <tr key={machine.id} className="border-b">
                        <td className="p-3 font-medium">
                          {machine.name}
                          <div className="text-xs text-muted-foreground">
                            {machine.category ?? "—"} · {machine.model ?? "—"} {machine.year ?? ""}
                          </div>
                        </td>
                        <td className="p-3">
                          {machine.asset_number || "—"}
                          <div className="text-xs text-muted-foreground">
                            {machine.code}
                            {machine.plate_no ? ` · ${machine.plate_no}` : ""}
                          </div>
                        </td>
                        <td className="p-3">{machine.owner_name || "غير مسجل"}</td>
                        <td className="p-3">
                          <Badge variant={machine.status === "active" ? "secondary" : "outline"}>
                            {machine.status === "active"
                              ? "نشطة"
                              : machine.status === "maintenance"
                                ? "قيد الصيانة"
                                : "متوقفة"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {!machine.name || !machine.asset_number || !machine.owner_name ? (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                              بيانات أساسية ناقصة
                            </Badge>
                          ) : (
                            <Badge variant="secondary">مكتملة</Badge>
                          )}
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(machine.current_hours ?? 0).toLocaleString()}
                        </td>
                        <td className="p-3 tabular-nums">
                          {Number(machine.current_odometer ?? 0).toLocaleString()} كم
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveMachinery(machine)}
                              disabled={
                                machineryOperationsQuery.isLoading ||
                                machineryOperationsQuery.isError
                              }
                            >
                              <CalendarDays className="ml-1 h-4 w-4" /> حضور
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`عرض تفاصيل ${machine.name}`}
                              title="عرض التفاصيل"
                              onClick={() => setMachineryDetails(machine)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!machineryQuery.isLoading && !machineryRows.length && (
                <p className="p-8 text-center text-muted-foreground">
                  أضف الآليات من كتالوج الصيانة.
                </p>
              )}
              {machineryRows.length < (machineryQuery.data?.total ?? 0) && (
                <div className="border-t p-4 text-center">
                  <Button
                    variant="outline"
                    onClick={() => setMachineryLimit((limit) => limit + 20)}
                  >
                    عرض 20 آلية إضافية · المعروض {machineryRows.length} من{" "}
                    {machineryQuery.data?.total}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={Boolean(machineryImport)}
        onOpenChange={(open) => {
          if (!open && !importMachinery.isPending) setMachineryImport(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>معاينة استيراد الآليات</DialogTitle>
            <DialogDescription>
              سيتم استيراد بيانات الورقة الأولى وربط كل سجل بقسم الصيانة. السجلات الموجودة مسبقاً
              برقم أو كود مطابق ستُتجاوز دون استبدال بياناتها.
            </DialogDescription>
          </DialogHeader>
          {machineryImport && (
            <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">جاهزة للاستيراد</p>
                  <p className="text-xl font-bold">{machineryImport.length}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">موجودة مسبقاً وستُتجاوز</p>
                  <p className="text-xl font-bold">{duplicateMachineryImportCount}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">
                    صفوف لا تحتوي الرقم أو الكود أو النوع
                  </p>
                  <p className="text-xl font-bold">{invalidMachineryRows}</p>
                </div>
                <div className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">مالك غير مسجل في الملف</p>
                  <p className="text-xl font-bold">
                    {machineryImport.filter((row) => !meaningful(row.owner_name)).length}
                  </p>
                </div>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="p-2 text-right">الرقم</th>
                      <th className="p-2 text-right">الآلية</th>
                      <th className="p-2 text-right">المالك</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineryImport.slice(0, 10).map((row) => (
                      <tr key={`${row.code}-${row.asset_number}`} className="border-t">
                        <td className="p-2">{row.asset_number}</td>
                        <td className="p-2">{row.name}</td>
                        <td className="p-2">
                          {meaningful(row.owner_name) ? (
                            row.owner_name
                          ) : (
                            <span className="text-amber-600">غير مسجل</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </table>
                {machineryImport.length > 10 && (
                  <p className="p-2 text-center text-xs text-muted-foreground">
                    معاينة 10 من {machineryImport.length} سجلاً
                  </p>
                )}
            </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setMachineryImport(null)}
                  disabled={importMachinery.isPending}
                >
                  إلغاء
                </Button>
                <Button
                  onClick={() => importMachinery.mutate(machineryImport)}
                  disabled={importMachinery.isPending}
                >
                  {importMachinery.isPending
                    ? "جارٍ الاستيراد…"
                    : `استيراد ${machineryImport.length} سجلاً`}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeVehicle}
        onOpenChange={(open) => {
          if (!open) setActiveVehicle(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeVehicle && (
            <>
            <DialogHeader>
              <DialogTitle>تسجيل أيام حضور المركبة</DialogTitle>
                <DialogDescription>
                  {activeVehicle.name} · {activeVehicle.vehicle_no} · شهر {month}
                </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
                <p className="text-sm">
                  حدد الأيام التي عملت فيها المركبة. الأيام المحددة:{" "}
                  <b>{(dates[activeVehicle.id] ?? []).length}</b>
                </p>
              <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDates((state) => ({ ...state, [activeVehicle.id]: [...monthDates] }))
                    }
                  >
                    تحديد الشهر كله
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDates((state) => ({ ...state, [activeVehicle.id]: [] }))}
                  >
                    مسح التحديد
                  </Button>
              </div>
            </div>
              {!dates[activeVehicle.id]?.length && legacyDays[activeVehicle.id] > 0 && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  السجل السابق يحفظ عدد {legacyDays[activeVehicle.id]} أيام دون تواريخ محددة. حدّد
                  الأيام الفعلية الآن لحفظ التقرير التفصيلي.
                </p>
              )}
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="أيام الشهر">
              {monthDates.map((date) => {
                const selected = (dates[activeVehicle.id] ?? []).includes(date);
                const dayNumber = Number(date.slice(8));
                  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("ar-IQ", {
                    weekday: "short",
                  });
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setDates((state) => {
                  const current = state[activeVehicle.id] ?? [];
                          return {
                            ...state,
                            [activeVehicle.id]: selected
                              ? current.filter((value) => value !== date)
                              : [...current, date].sort(),
                          };
                        })
                      }
                      className={`flex min-h-16 flex-col items-center justify-center rounded-xl border p-2 text-sm transition ${selected ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-background hover:border-primary/50 hover:bg-primary/5"}`}
                    >
                      <span className="text-[11px] opacity-80">{weekday}</span>
                      <span className="font-bold">{dayNumber}</span>
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setActiveVehicle(null)}>
                  إلغاء
                </Button>
                <Button
                  onClick={() =>
                    saveDays.mutate({
                      vehicleId: activeVehicle.id,
                      operatingDates: dates[activeVehicle.id] ?? [],
                    })
                  }
                  disabled={saveDays.isPending}
                >
                  <Save className="ml-2 h-4 w-4" />{" "}
                  {saveDays.isPending ? "جارٍ الحفظ…" : "حفظ أيام الحضور"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!activeMachinery}
        onOpenChange={(open) => {
          if (!open) setActiveMachinery(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {activeMachinery && (
            <>
              <DialogHeader>
                <DialogTitle>تسجيل حضور الآلية</DialogTitle>
                <DialogDescription>
                  {activeMachinery.name} · {activeMachinery.asset_number || activeMachinery.code} ·
                  شهر {month}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
                <p className="text-sm">
                  أيام التشغيل المحددة: <b>{(machineryDates[activeMachinery.id] ?? []).length}</b>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMachineryDates((state) => ({
                        ...state,
                        [activeMachinery.id]: [...monthDates],
                      }))
                    }
                  >
                    تحديد كل الأيام
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setMachineryDates((state) => ({ ...state, [activeMachinery.id]: [] }))
                    }
                  >
                    مسح التحديد
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7" aria-label="أيام الشهر">
                {monthDates.map((date) => {
                  const selected = (machineryDates[activeMachinery.id] ?? []).includes(date);
                  const day = Number(date.slice(8));
                  const dayName = new Date(`${date}T12:00:00`).toLocaleDateString("ar-IQ", {
                    weekday: "short",
                  });
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setMachineryDates((state) => {
                          const current = state[activeMachinery.id] ?? [];
                          return {
                            ...state,
                            [activeMachinery.id]: selected
                              ? current.filter((item) => item !== date)
                              : [...current, date].sort(),
                          };
                        })
                      }
                      className={`flex min-h-16 flex-col items-center justify-center rounded-xl border p-2 text-sm transition ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:border-primary/50 hover:bg-primary/5"}`}
                    >
                      <span className="text-[11px] opacity-80">{dayName}</span>
                      <span className="font-bold">{day}</span>
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
              })}
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setActiveMachinery(null)}>
                  إلغاء
              </Button>
                <Button
                  onClick={() =>
                    saveMachineryAttendance.mutate({
                      machineId: activeMachinery.id,
                      dates: machineryDates[activeMachinery.id] ?? [],
                    })
                  }
                  disabled={saveMachineryAttendance.isPending}
                >
                  <Save className="ml-2 h-4 w-4" />
                  {saveMachineryAttendance.isPending ? "جارٍ الحفظ…" : "حفظ الحضور"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!machineryDetails}
        onOpenChange={(open) => {
          if (!open) setMachineryDetails(null);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {machineryDetails && (
            <>
              <DialogHeader>
                <DialogTitle>{machineryDetails.name}</DialogTitle>
                <DialogDescription>
                  التفاصيل الكاملة للآلية · {machineryDetails.asset_number || machineryDetails.code}
                </DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["رقم الأصل", machineryDetails.asset_number],
                    ["الكود", machineryDetails.code],
                    ["المالك", machineryDetails.owner_name],
                    ["الصنف", machineryDetails.category],
                    ["رقم اللوحة", machineryDetails.plate_no],
                    ["الموديل", machineryDetails.model],
                    ["سنة الصنع", machineryDetails.year],
                    ["اللون", machineryDetails.color],
                    ["السائق", machineryDetails.driver_name],
                    [
                      "الحالة",
                      machineryDetails.status === "active"
                        ? "نشطة"
                        : machineryDetails.status === "maintenance"
                          ? "قيد الصيانة"
                          : "متوقفة",
                    ],
                    ["ساعات التشغيل", machineryDetails.current_hours],
                    ["قراءة العداد", machineryDetails.current_odometer],
                    [
                      "الإيجار اليومي",
                      `${Number(machineryDetails.daily_rent ?? 0).toLocaleString("ar-IQ")} د.ع`,
                    ],
                    [
                      "كلفة السائق اليومية",
                      `${Number(machineryDetails.driver_daily_cost ?? 0).toLocaleString("ar-IQ")} د.ع`,
                    ],
                    [
                      "كلفة الساعة الإضافية",
                      `${Number(machineryDetails.extra_hourly_rate ?? 0).toLocaleString("ar-IQ")} د.ع`,
                    ],
                    ["حالة المستندات", machineryDetails.document_status],
                    ["الأيام المتبقية للمستندات", machineryDetails.document_days_remaining],
                    ["يتطلب ATO", machineryDetails.requires_ato ? "نعم" : "لا"],
                    ["حالة ATO", machineryDetails.ato_status],
                    ["انتهاء ATO", machineryDetails.ato_expiry],
                    ["رقم التصريح الأمني", machineryDetails.security_permit_no],
                    ["حالة التصريح الأمني", machineryDetails.security_permit_status],
                    ["انتهاء التصريح الأمني", machineryDetails.security_permit_expiry],
                    ["ملاحظات", machineryDetails.notes],
                    ["صف المصدر", machineryDetails.source_row],
                    ["تاريخ الإضافة", machineryDetails.created_at],
                    ["آخر تحديث", machineryDetails.updated_at],
                  ] as Array<[string, string | number | boolean | null | undefined]>
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl border bg-muted/20 p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-medium">
                      {value == null || value === "" ? "—" : value}
                    </dd>
            </div>
                ))}
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VehicleDetailsTab({
  vehicles,
  isLoading,
  month,
  dates,
  legacyDays,
}: {
  vehicles: Vehicle[];
  isLoading: boolean;
  month: string;
  dates: Record<string, string[]>;
  legacyDays: Record<string, number>;
}) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0] ?? null;

  const driversQuery = useQuery({
    queryKey: ["vehicle-drivers"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("id, full_name, position, phone1, department_id, departments(name)")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Driver[];
    },
  });
  const drivers = driversQuery.data ?? [];

  const vouchersQuery = useQuery({
    queryKey: ["vehicle-month-fuel", selected?.id ?? null, month],
    enabled: Boolean(selected),
    queryFn: async () => {
      if (!selected) return [];
      const [year, monthNumber] = month.split("-").map(Number);
      const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("vehicle_fuel_vouchers")
        .select(
          "voucher_no, voucher_date, liters, price_per_liter, total_cost, odometer_reading, fuel_type",
        )
        .eq("vehicle_id", selected.id)
        .gte("voucher_date", `${month}-01`)
        .lt("voucher_date", nextMonth)
        .order("voucher_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        voucher_no: string;
        voucher_date: string;
        liters: number;
        price_per_liter: number;
        total_cost: number;
        odometer_reading: number | null;
        fuel_type: "gasoline" | "diesel";
      }>;
    },
  });

  const fuelStats = useMemo<MonthlyFuelStats>(() => {
    const rows = vouchersQuery.data ?? [];
    return {
      liters: rows.reduce((total, row) => total + Number(row.liters ?? 0), 0),
      cost: rows.reduce((total, row) => total + Number(row.total_cost ?? 0), 0),
      count: rows.length,
      lastDate: rows[0]?.voucher_date ?? selected?.last_fuel_date ?? null,
    };
  }, [vouchersQuery.data, selected?.last_fuel_date]);

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
    onError: (error: Error) =>
      toast.error(`تعذر اعتماد الشكل: ${describeVehicleImageError(error)}`),
  });

  const attachImage = async (file: File) => {
    if (!selected) return;
    setAttaching(true);
    try {
      setAttachStatus("جارٍ رفع الصورة…");
      const url = await uploadVehicleImage(file, selected.id);
      const { error } = await (supabase as any)
        .from("vehicles")
        .update({ vehicle_image_url: url })
        .eq("id", selected.id);
      if (error) throw error;
      await client.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("تم إرفاق شكل المركبة");
    } catch (error) {
      toast.error(`تعذر إرفاق الصورة: ${describeVehicleImageError(error)}`);
    } finally {
      setAttaching(false);
      setAttachStatus(null);
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
  const operatingDates = dates[selected.id] ?? [];
  const operatingDays = operatingDates.length || legacyDays[selected.id] || 0;
  const driver = drivers.find((item) => item.id === selected.current_driver_id) ?? null;

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
              <span
                className={cn(
                  "text-[11px] font-normal",
                  isSelected ? "text-white/80" : "text-muted-foreground/70",
                )}
              >
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
              لم تُرفق صورة لهذه المركبة بعد. أضف شكلها لعرض رقم اللوحة وآخر تعبئة وقود وتاريخ
              انتهاء التصريح الأمني على الرسم.
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
              {attaching ? "جارٍ المعالجة…" : "إرفاق شكل المركبة"}
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
          {attaching && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              {attachStatus ?? "جارٍ معالجة الصورة…"}
            </p>
          )}
        </div>
      ) : null}

      {editing ? (
        <VehicleDetailForm
          key={selected.id}
          vehicle={selected}
          drivers={drivers}
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

      <VehicleMonthlyReport
        month={month}
        vehicle={selected}
        driver={driver}
        operatingDays={operatingDays}
        operatingDates={operatingDates}
        wage={operatingDays * Number(selected.daily_rate || 0)}
        fuel={fuelStats}
      />
    </div>
  );
}

function VehicleDetailForm({
  vehicle,
  drivers,
  onCancel,
  onSaved,
}: {
  vehicle: Vehicle;
  drivers: Driver[];
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
  const [fuelType, setFuelType] = useState<"gasoline" | "diesel">(vehicle.fuel_type ?? "diesel");
  const [driverId, setDriverId] = useState(vehicle.current_driver_id ?? "");
  const [odometer, setOdometer] = useState(String(vehicle.current_odometer ?? 0));
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      setUploadStatus("جارٍ رفع الصورة…");
      const url = await uploadVehicleImage(file, vehicle.id);
      setImageUrl(url);
      toast.success("تم رفع صورة المركبة، اضغط «حفظ التفاصيل» لتثبيتها");
    } catch (error) {
      toast.error(`تعذر رفع الصورة: ${describeVehicleImageError(error)}`);
    } finally {
      setUploading(false);
      setUploadStatus(null);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const rate = Number(dailyRate);
      const odo = Number(odometer);
      if (!name.trim()) throw new Error("اسم المركبة مطلوب");
      if (!Number.isFinite(rate) || rate < 0) throw new Error("أدخل أجراً يومياً صحيحاً");
      if (!Number.isFinite(odo) || odo < 0) throw new Error("أدخل قراءة عداد صحيحة");
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
          fuel_type: fuelType,
          current_driver_id: driverId || null,
          current_odometer: odo,
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
    onError: (error: Error) =>
      toast.error(`تعذر حفظ التفاصيل: ${describeVehicleImageError(error)}`),
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
          <Label>نوع الوقود</Label>
          <Select
            value={fuelType}
            onValueChange={(value) => setFuelType(value as "gasoline" | "diesel")}
          >
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
          <Label>السائق الحالي</Label>
          <Select
            value={driverId || "none"}
            onValueChange={(value) => setDriverId(value === "none" ? "" : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="اختر السائق" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون سائق</SelectItem>
              {drivers.map((driver) => (
                <SelectItem key={driver.id} value={driver.id}>
                  {driver.full_name}
                  {driver.position ? ` · ${driver.position}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-odo">عداد الكيلومترات الحالي</Label>
          <Input
            id="d-odo"
            type="number"
            min="0"
            step="0.01"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
          />
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
          <Input
            id="d-fuel"
            type="date"
            value={lastFuelDate}
            onChange={(event) => setLastFuelDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-permit">انتهاء التصريح الأمني</Label>
          <Input
            id="d-permit"
            type="date"
            value={permitExpiry}
            onChange={(event) => setPermitExpiry(event.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="d-notes">ملاحظات</Label>
          <Textarea
            id="d-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
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
              {uploading ? "جارٍ المعالجة…" : imageUrl ? "استبدال الصورة" : "إرفاق شكل المركبة"}
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
          {uploading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              {uploadStatus ?? "جارٍ معالجة الصورة…"}
            </p>
          )}
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

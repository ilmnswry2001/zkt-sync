import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export type RecordType = "machinery" | "vehicle" | "equipment";
export type MaintenanceStatus = "pending" | "in_progress" | "waiting_parts" | "completed" | "cancelled";

export type Machinery = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  plate_no: string | null;
  model: string | null;
  year: number | null;
  status: string;
  current_hours: number;
  current_odometer: number;
  notes: string | null;
};

export type VehicleLite = {
  id: string;
  vehicle_no: string;
  name: string;
  current_odometer: number;
};

export type EquipmentLite = {
  id: string;
  code: string | null;
  name: string;
  unit: string;
};

export type MaintenanceType = {
  id: string;
  name: string;
  category: string | null;
  is_active: boolean;
};

export type Workshop = {
  id: string;
  name: string;
  kind: "workshop" | "technician";
  phone: string | null;
  is_active: boolean;
};

export type MaintenancePart = {
  id?: string;
  warehouse_item_id?: string | null;
  part_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  notes?: string | null;
};

export type MaintenanceAttachment = {
  id?: string;
  file_url: string;
  file_path: string | null;
  file_type: string | null;
};

export type MaintenanceRecord = {
  id: string;
  record_no: string;
  record_type: RecordType;
  machinery_id: string | null;
  vehicle_id: string | null;
  equipment_id: string | null;
  entity_name: string | null;
  maintenance_type_id: string | null;
  maintenance_type_name: string | null;
  description: string | null;
  workshop_id: string | null;
  workshop_name: string | null;
  technician: string | null;
  maintenance_date: string;
  odometer_reading: number | null;
  hours_reading: number | null;
  labor_cost: number;
  parts_total: number;
  total_cost: number;
  status: MaintenanceStatus;
  next_maintenance_date: string | null;
  notes: string | null;
  created_at: string;
  maintenance_record_parts?: MaintenancePart[];
  maintenance_record_attachments?: MaintenanceAttachment[];
};

export const MAINTENANCE_TABS: { key: RecordType; label: string }[] = [
  { key: "machinery", label: "صيانة الآليات" },
  { key: "vehicle", label: "صيانة المركبات" },
  { key: "equipment", label: "صيانة المعدات" },
];

export const STATUS_OPTIONS: { key: MaintenanceStatus; label: string }[] = [
  { key: "pending", label: "قيد الانتظار" },
  { key: "in_progress", label: "قيد التنفيذ" },
  { key: "waiting_parts", label: "متوقفة بانتظار قطعة" },
  { key: "completed", label: "مكتملة" },
  { key: "cancelled", label: "ملغاة" },
];

export const recordTypeLabel = (type: RecordType) =>
  MAINTENANCE_TABS.find((tab) => tab.key === type)?.label ?? type;

export const statusLabel = (status: MaintenanceStatus) =>
  STATUS_OPTIONS.find((option) => option.key === status)?.label ?? status;

export function statusClass(status: MaintenanceStatus) {
  if (status === "completed") return "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (status === "in_progress") return "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300";
  if (status === "waiting_parts") return "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-300";
  if (status === "cancelled") return "border-transparent bg-rose-500/15 text-rose-700 dark:text-rose-300";
  return "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

export function money(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return (Number.isFinite(number) ? Math.round(number) : 0).toLocaleString("ar-IQ");
}

export function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-IQ", { day: "numeric", month: "long", year: "numeric" });
}

export async function nextMaintenanceRecordNo(date: string) {
  const monthKey = date.slice(0, 7).replace("-", "");
  const { data, error } = await (supabase as any)
    .from("maintenance_records")
    .select("record_no")
    .like("record_no", `MNT-${monthKey}-%`);
  if (error) return `MNT-${monthKey}-0001`;
  const max = (data ?? []).reduce((acc: number, row: { record_no: string }) => {
    const match = String(row.record_no).match(/(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `MNT-${monthKey}-${String(max + 1).padStart(4, "0")}`;
}

export async function uploadMaintenanceAttachment(file: File, recordNo: string) {
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(file.type)) throw new Error("الملف يجب أن يكون صورة أو PDF");
  if (file.size > 10 * 1024 * 1024) throw new Error("حجم الملف يتجاوز 10 ميغابايت");
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const path = `${recordNo || "maintenance"}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("maintenance-attachments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error(
        "مخزن مرفقات الصيانة غير موجود. طبّق ترحيل 20261020130000_maintenance_module.sql أولاً.",
      );
    }
    throw error;
  }
  const { data } = supabase.storage.from("maintenance-attachments").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export function writeXlsx(rows: Record<string, unknown>[], sheetName: string, fileName: string) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, fileName);
}

import { useState } from "react";
import type { CSSProperties } from "react";
import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MaintenanceCatalogDialog } from "@/components/maintenance/MaintenanceCatalogDialog";
import { todayInBaghdad } from "@/lib/date-time";
import {
  MAINTENANCE_TABS,
  STATUS_OPTIONS,
  dateLabel,
  money,
  nextMaintenanceRecordNo,
  recordTypeLabel,
  statusClass,
  statusLabel,
  uploadMaintenanceAttachment,
  writeXlsx,
} from "@/lib/maintenance";
import type {
  EquipmentLite,
  Machinery,
  MaintenanceAttachment,
  MaintenanceRecord,
  MaintenanceStatus,
  MaintenanceType,
  RecordType,
  VehicleLite,
  Workshop,
} from "@/lib/maintenance";
import {
  AlertTriangle,
  Download,
  ImageIcon,
  Package,
  PencilLine,
  Plus,
  Printer,
  Search,
  Settings2,
  Trash2,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/maintenance")({
  head: () => ({ meta: [{ title: "الصيانة" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    if (
      !roles?.some((item) =>
        ["admin", "maintenance_manager", "maintenance_admin"].includes(item.role),
      )
    )
      throw redirect({ to: "/dashboard" });
  },
  component: MaintenancePage,
});

type FormPart = { warehouse_item_id: string; part_name: string; quantity: string; unit_cost: string };

type FormState = {
  id: string | null;
  recordNo: string;
  entityId: string;
  typeId: string;
  typeName: string;
  workshopId: string;
  technician: string;
  date: string;
  odometer: string;
  hours: string;
  labor: string;
  status: MaintenanceStatus;
  nextDate: string;
  notes: string;
  parts: FormPart[];
  newFiles: File[];
  existingAttachments: MaintenanceAttachment[];
};

const printCell: CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #cbd5e1",
  textAlign: "right",
  verticalAlign: "top",
};

function MaintenancePage() {
  const client = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<RecordType>("machinery");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MaintenanceStatus>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [printRecord, setPrintRecord] = useState<MaintenanceRecord | null>(null);

  const machineryQuery = useQuery({
    queryKey: ["maintenance-machinery"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("machinery")
        .select("id, code, name, category, current_odometer, current_hours")
        .order("code");
      if (error) throw error;
      return (data ?? []) as Machinery[];
    },
  });
  const vehiclesQuery = useQuery({
    queryKey: ["maintenance-vehicles"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("vehicles")
        .select("id, vehicle_no, name, current_odometer")
        .order("vehicle_no");
      if (error) throw error;
      return (data ?? []) as VehicleLite[];
    },
  });
  const equipmentQuery = useQuery({
    queryKey: ["maintenance-equipment"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("warehouse_items")
        .select("id, code, name, unit")
        .eq("kind", "tool")
        .order("name");
      if (error) throw error;
      return (data ?? []) as EquipmentLite[];
    },
  });
  const stockItemsQuery = useQuery({
    queryKey: ["maintenance-stock-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouse_items")
        .select("id, name, code, unit, unit_cost")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const typesQuery = useQuery({
    queryKey: ["maintenance-types-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_types")
        .select("id, name, category, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as MaintenanceType[];
    },
  });
  const workshopsQuery = useQuery({
    queryKey: ["maintenance-workshops-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_workshops")
        .select("id, name, kind, phone, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Workshop[];
    },
  });
  const recordsQuery = useQuery({
    queryKey: ["maintenance-records", activeTab],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_records")
        .select("*, maintenance_record_parts(*), maintenance_record_attachments(*)")
        .eq("record_type", activeTab)
        .order("maintenance_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaintenanceRecord[];
    },
  });

  const machinery = machineryQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const equipment = equipmentQuery.data ?? [];
  const stockItems = stockItemsQuery.data ?? [];
  const types = typesQuery.data ?? [];
  const workshops = workshopsQuery.data ?? [];
  const records = recordsQuery.data ?? [];

  const entityOptions =
    activeTab === "machinery"
      ? machinery.map((item) => ({
          id: item.id,
          label: `${item.name} · ${item.code}`,
          reading: Number(item.current_odometer ?? 0),
          hours: Number(item.current_hours ?? 0),
        }))
      : activeTab === "vehicle"
        ? vehicles.map((item) => ({
            id: item.id,
            label: `${item.name} · ${item.vehicle_no}`,
            reading: Number(item.current_odometer ?? 0),
            hours: 0,
          }))
        : equipment.map((item) => ({
            id: item.id,
            label: `${item.name}${item.code ? ` · ${item.code}` : ""}`,
            reading: 0,
            hours: 0,
          }));

  const entityLabel = (record: MaintenanceRecord) => {
    if (record.record_type === "machinery") {
      const match = machinery.find((item) => item.id === record.machinery_id);
      return match ? `${match.name} · ${match.code}` : record.entity_name ?? "—";
    }
    if (record.record_type === "vehicle") {
      const match = vehicles.find((item) => item.id === record.vehicle_id);
      return match ? `${match.name} · ${match.vehicle_no}` : record.entity_name ?? "—";
    }
    const match = equipment.find((item) => item.id === record.equipment_id);
    return match ? `${match.name}${match.code ? ` · ${match.code}` : ""}` : record.entity_name ?? "—";
  };

  const entitySnapshot = () => {
    const entity = entityOptions.find((option) => option.id === form.entityId);
    return entity?.label ?? null;
  };

  const filteredRecords = records.filter((record) => {
    if (statusFilter !== "all" && record.status !== statusFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const haystack = [
      record.record_no,
      record.maintenance_type_name,
      record.workshop_name,
      record.technician,
      record.notes,
      entityLabel(record),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  const today = todayInBaghdad();
  const upcomingLimitDate = (() => {
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  })();
  const overdueCount = records.filter(
    (record) => record.next_maintenance_date && record.next_maintenance_date < today,
  ).length;
  const upcomingCount = records.filter(
    (record) =>
      record.next_maintenance_date &&
      record.next_maintenance_date >= today &&
      record.next_maintenance_date <= upcomingLimitDate,
  ).length;
  const totalCost = filteredRecords.reduce((sum, record) => sum + Number(record.total_cost ?? 0), 0);

  const emptyForm = (recordNo: string, date: string): FormState => ({
    id: null,
    recordNo,
    entityId: "",
    typeId: "",
    typeName: "",
    workshopId: "",
    technician: "",
    date,
    odometer: "",
    hours: "",
    labor: "",
    status: "completed",
    nextDate: "",
    notes: "",
    parts: [{ warehouse_item_id: "", part_name: "", quantity: "1", unit_cost: "" }],
    newFiles: [],
    existingAttachments: [],
  });

  const [form, setForm] = useState<FormState>(emptyForm("", todayInBaghdad()));

  const openCreate = async () => {
    const date = todayInBaghdad();
    const recordNo = await nextMaintenanceRecordNo(date);
    setForm(emptyForm(recordNo, date));
    setFormOpen(true);
  };

  const openEdit = (record: MaintenanceRecord) => {
    const parts = (record.maintenance_record_parts ?? []).map((part) => ({
      warehouse_item_id: part.warehouse_item_id ?? "",
      part_name: part.part_name,
      quantity: String(part.quantity),
      unit_cost: String(part.unit_cost),
    }));
    setForm({
      id: record.id,
      recordNo: record.record_no,
      entityId: record.machinery_id ?? record.vehicle_id ?? record.equipment_id ?? "",
      typeId: record.maintenance_type_id ?? "",
      typeName: record.maintenance_type_name ?? "",
      workshopId: record.workshop_id ?? "",
      technician: record.technician ?? "",
      date: record.maintenance_date,
      odometer: record.odometer_reading != null ? String(record.odometer_reading) : "",
      hours: record.hours_reading != null ? String(record.hours_reading) : "",
      labor: String(record.labor_cost ?? 0),
      status: record.status,
      nextDate: record.next_maintenance_date ?? "",
      notes: record.notes ?? "",
      parts: parts.length ? parts : [{ warehouse_item_id: "", part_name: "", quantity: "1", unit_cost: "" }],
      newFiles: [],
      existingAttachments: record.maintenance_record_attachments ?? [],
    });
    setFormOpen(true);
  };

  const handleEntityChange = (id: string) => {
    const entity = entityOptions.find((option) => option.id === id);
    setForm((current) => ({
      ...current,
      entityId: id,
      odometer: entity && entity.reading > 0 ? String(entity.reading) : current.odometer,
      hours: entity && entity.hours > 0 ? String(entity.hours) : current.hours,
    }));
  };

  const handleTypeChange = (id: string) => {
    setForm((current) => ({
      ...current,
      typeId: id,
      typeName: types.find((type) => type.id === id)?.name ?? current.typeName,
    }));
  };

  const partsTotal = form.parts.reduce(
    (sum, part) => sum + (Number(part.quantity) || 0) * (Number(part.unit_cost) || 0),
    0,
  );
  const formTotal = (Number(form.labor) || 0) + partsTotal;

  const saveRecord = useMutation({
    mutationFn: async () => {
      if (!form.entityId) throw new Error("اختر الجهة التي تمت لها الصيانة");
      if (!form.typeName.trim() && !form.typeId) throw new Error("حدد نوع الصيانة");
      const labor = Number(form.labor) || 0;
      if (labor < 0) throw new Error("أدخل أجرة يد صحيحة");
      const base = {
        record_type: activeTab,
        machinery_id: activeTab === "machinery" ? form.entityId : null,
        vehicle_id: activeTab === "vehicle" ? form.entityId : null,
        equipment_id: activeTab === "equipment" ? form.entityId : null,
        entity_name: entitySnapshot(),
        maintenance_type_id: form.typeId || null,
        maintenance_type_name: form.typeName.trim() || null,
        workshop_id: form.workshopId || null,
        workshop_name: workshops.find((workshop) => workshop.id === form.workshopId)?.name ?? null,
        technician: form.technician.trim() || null,
        maintenance_date: form.date,
        odometer_reading: form.odometer.trim() ? Number(form.odometer) : null,
        hours_reading: form.hours.trim() ? Number(form.hours) : null,
        labor_cost: labor,
        status: form.status,
        next_maintenance_date: form.nextDate || null,
        notes: form.notes.trim() || null,
      };
      let recordId = form.id;
      if (recordId) {
        const { error } = await (supabase as any)
          .from("maintenance_records")
          .update(base)
          .eq("id", recordId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("maintenance_records")
          .insert({ ...base, record_no: form.recordNo, created_by: user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
        recordId = data.id;
      }
      const parts = form.parts
        .filter((part) => part.part_name.trim())
        .map((part) => ({
          warehouse_item_id: part.warehouse_item_id || null,
          part_name: part.part_name.trim(),
          quantity: Number(part.quantity) || 0,
          unit_cost: Number(part.unit_cost) || 0,
          line_total: (Number(part.quantity) || 0) * (Number(part.unit_cost) || 0),
        }));
      const { error: partsError } = await (supabase as any).rpc("replace_maintenance_record_parts", {
        _record_id: recordId,
        _parts: parts,
      });
      if (partsError) throw partsError;
      for (const file of form.newFiles) {
        const uploaded = await uploadMaintenanceAttachment(file, form.recordNo);
        const { error } = await (supabase as any).from("maintenance_record_attachments").insert({
          record_id: recordId,
          file_url: uploaded.url,
          file_path: uploaded.path,
          file_type: file.type,
        });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("تم حفظ سجل الصيانة");
      setFormOpen(false);
      await client.invalidateQueries({ queryKey: ["maintenance-records"] });
      await client.invalidateQueries({ queryKey: ["maintenance-machinery"] });
      await client.invalidateQueries({ queryKey: ["maintenance-vehicles"] });
    },
    onError: (error: Error) => toast.error(`تعذر حفظ السجل: ${formatErrorMessage(error)}`),
  });

  const deleteRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maintenance_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف سجل الصيانة");
      await client.invalidateQueries({ queryKey: ["maintenance-records"] });
    },
    onError: (error: Error) => toast.error(`تعذر الحذف: ${formatErrorMessage(error)}`),
  });

  const removeAttachment = async (attachment: MaintenanceAttachment) => {
    if (attachment.id) {
      await (supabase as any).from("maintenance_record_attachments").delete().eq("id", attachment.id);
    }
    if (attachment.file_path) {
      await supabase.storage.from("maintenance-attachments").remove([attachment.file_path]);
    }
    setForm((current) => ({
      ...current,
      existingAttachments: current.existingAttachments.filter((item) => item.id !== attachment.id),
    }));
  };

  const handlePrint = (record: MaintenanceRecord) => {
    setPrintRecord(record);
    window.setTimeout(() => window.print(), 150);
  };

  const exportExcel = () => {
    if (!filteredRecords.length) {
      toast.error("لا توجد سجلات للتصدير");
      return;
    }
    const rows = filteredRecords.map((record) => ({
      "رقم السجل": record.record_no,
      "التاريخ": record.maintenance_date,
      "الجهة": entityLabel(record),
      "نوع الصيانة": record.maintenance_type_name ?? "—",
      "الورشة": record.workshop_name ?? "—",
      "الفني": record.technician ?? "—",
      "الحالة": statusLabel(record.status),
      "أجرة اليد": Number(record.labor_cost),
      "كلفة القطع": Number(record.parts_total),
      "الإجمالي": Number(record.total_cost),
      "العداد": record.odometer_reading ?? "",
      "ساعات التشغيل": record.hours_reading ?? "",
      "الصيانة القادمة": record.next_maintenance_date ?? "",
      "ملاحظات": record.notes ?? "",
    }));
    writeXlsx(
      rows,
      recordTypeLabel(activeTab),
      `صيانة-${recordTypeLabel(activeTab)}-${today}.xlsx`,
    );
  };

  const workspaceName =
    (typeof window !== "undefined" && window.localStorage.getItem("zkt-workspace-name")) || "منظومة زِكت";

  const activeTabLabel = recordTypeLabel(activeTab);

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3">
            <Wrench className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">سجلات الصيانة والقطع والكلف</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <a href="/warehouses"><Package className="ml-2 h-4 w-4" /> مخزن الصيانة</a>
          </Button>
          <Button variant="outline" onClick={() => setCatalogOpen(true)}>
            <Settings2 className="ml-2 h-4 w-4" /> كتالوج الصيانة
          </Button>
          <Button onClick={() => void openCreate()}>
            <Plus className="ml-2 h-4 w-4" /> إضافة سجل صيانة
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RecordType)}>
        <TabsList className="glass-card h-auto w-full justify-start gap-1 rounded-full p-1 sm:w-auto">
          {MAINTENANCE_TABS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            >
              {tab.key === "machinery" ? (
                <Wrench className="h-4 w-4" />
              ) : tab.key === "vehicle" ? (
                <Truck className="h-4 w-4" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card rounded-3xl p-5">
          <p className="text-xs text-muted-foreground">سجلات {activeTabLabel}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{filteredRecords.length}</p>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <p className="text-xs text-muted-foreground">إجمالي الكلفة</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{money(totalCost)} د.ع</p>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <p className="text-xs text-muted-foreground">صيانة قادمة خلال 30 يومًا</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{upcomingCount}</p>
        </div>
        <div className="glass-card rounded-3xl p-5">
          <p className="text-xs text-muted-foreground">صيانة متأخرة</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-destructive">{overdueCount}</p>
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          توجد {overdueCount} عملية صيانة متأخرة في {activeTabLabel}. راجع سجلات الصيانة القادمة.
        </div>
      )}

      <Card>
        <CardHeader className="flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <CardTitle>سجل {activeTabLabel}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="بحث في سجلات الصيانة"
                className="pr-9"
                placeholder="بحث برقم السجل / الجهة / النوع…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | MaintenanceStatus)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportExcel}>
              <Download className="ml-2 h-4 w-4" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {recordsQuery.isError ? (
            <p className="p-8 text-center text-destructive">
              تعذر تحميل سجلات الصيانة: {(recordsQuery.error as Error).message}
            </p>
          ) : recordsQuery.isLoading ? (
            <p className="p-8 text-center text-muted-foreground">جارٍ تحميل السجلات…</p>
          ) : (
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-right">
                  <th className="p-3">رقم السجل</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">الجهة</th>
                  <th className="p-3">نوع الصيانة</th>
                  <th className="p-3">الورشة</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">القطع</th>
                  <th className="p-3">الإجمالي</th>
                  <th className="p-3">الصيانة القادمة</th>
                  <th className="p-3">مرفقات</th>
                  <th className="p-3">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b">
                    <td className="p-3 font-mono text-xs">{record.record_no}</td>
                    <td className="p-3 whitespace-nowrap">{dateLabel(record.maintenance_date)}</td>
                    <td className="p-3">{entityLabel(record)}</td>
                    <td className="p-3">{record.maintenance_type_name ?? "—"}</td>
                    <td className="p-3">{record.workshop_name ?? "—"}</td>
                    <td className="p-3">
                      <Badge className={statusClass(record.status)}>{statusLabel(record.status)}</Badge>
                    </td>
                    <td className="p-3 tabular-nums">{record.maintenance_record_parts?.length ?? 0}</td>
                    <td className="p-3 font-semibold tabular-nums">{money(record.total_cost)} د.ع</td>
                    <td className="p-3 whitespace-nowrap">
                      {record.next_maintenance_date ? (
                        <span
                          className={
                            record.next_maintenance_date < today
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {dateLabel(record.next_maintenance_date)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3">
                      {record.maintenance_record_attachments?.length ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <ImageIcon className="h-4 w-4" /> {record.maintenance_record_attachments.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" aria-label={`تعديل ${record.record_no}`} onClick={() => openEdit(record)}>
                          <PencilLine className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`طباعة ${record.record_no}`} onClick={() => handlePrint(record)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`حذف ${record.record_no}`}
                          onClick={() => {
                            if (confirm(`حذف سجل الصيانة ${record.record_no}؟`)) deleteRecord.mutate(record.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!recordsQuery.isLoading && filteredRecords.length === 0 && (
            <p className="p-8 text-center text-muted-foreground">لا توجد سجلات صيانة لهذا التبويب بعد.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? `تعديل سجل ${form.recordNo}` : "إضافة سجل صيانة"}</DialogTitle>
            <DialogDescription>سجل {activeTabLabel} بتفاصيل القطع والكلفة والمرفقات.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="r-no">رقم السجل</Label>
              <Input id="r-no" value={form.recordNo} readOnly className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-date">تاريخ الصيانة</Label>
              <Input
                id="r-date"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>الجهة</Label>
              <Select value={form.entityId} onValueChange={handleEntityChange}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الجهة" />
                </SelectTrigger>
                <SelectContent>
                  {entityOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {entityOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  لا توجد جهات مسجلة لهذا التبويب. أضفها من «كتالوج الصيانة».
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>نوع الصيانة</Label>
              <Select value={form.typeId || "other"} onValueChange={(value) => handleTypeChange(value === "other" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="other">نوع آخر (إدخال يدوي)</SelectItem>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.typeId && (
                <Input
                  placeholder="اكتب نوع الصيانة"
                  value={form.typeName}
                  onChange={(event) => setForm({ ...form, typeName: event.target.value })}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>الورشة / الفني</Label>
              <Select value={form.workshopId || "none"} onValueChange={(value) => setForm({ ...form, workshopId: value === "none" ? "" : value })}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الورشة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  {workshops.map((workshop) => (
                    <SelectItem key={workshop.id} value={workshop.id}>
                      {workshop.name} · {workshop.kind === "workshop" ? "ورشة" : "فني"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-tech">اسم الفني المسؤول</Label>
              <Input
                id="r-tech"
                value={form.technician}
                onChange={(event) => setForm({ ...form, technician: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-odo">قراءة العداد (كم)</Label>
              <Input
                id="r-odo"
                type="number"
                min="0"
                step="0.01"
                value={form.odometer}
                onChange={(event) => setForm({ ...form, odometer: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-hours">ساعات التشغيل</Label>
              <Input
                id="r-hours"
                type="number"
                min="0"
                step="0.01"
                value={form.hours}
                onChange={(event) => setForm({ ...form, hours: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as MaintenanceStatus })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-next">الصيانة القادمة</Label>
              <Input
                id="r-next"
                type="date"
                value={form.nextDate}
                onChange={(event) => setForm({ ...form, nextDate: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="r-desc">وصف الأعمال</Label>
              <Textarea
                id="r-desc"
                rows={2}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </div>
          </div>

          <section className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">القطع والأعمال</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({
                    ...form,
                    parts: [...form.parts, { warehouse_item_id: "", part_name: "", quantity: "1", unit_cost: "" }],
                  })
                }
              >
                <Plus className="ml-1 h-4 w-4" /> إضافة قطعة
              </Button>
            </div>
            <div className="space-y-2">
              {form.parts.map((part, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[220px_1fr_100px_140px_120px_40px]">
                  <Select
                    value={part.warehouse_item_id || "manual"}
                    onValueChange={(value) => {
                      const stockItem = stockItems.find((item) => item.id === value);
                      setForm({
                        ...form,
                        parts: form.parts.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                warehouse_item_id: stockItem?.id ?? "",
                                part_name: stockItem?.name ?? item.part_name,
                                unit_cost: stockItem ? String(stockItem.unit_cost ?? 0) : item.unit_cost,
                              }
                            : item,
                        ),
                      });
                    }}
                  >
                    <SelectTrigger aria-label="صنف مخزن الصيانة"><SelectValue placeholder="قطعة من المخزن" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">قطعة خارج المخزن</SelectItem>
                      {stockItems.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label="اسم القطعة أو العمل"
                    placeholder="اسم القطعة أو العمل"
                    value={part.part_name}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        parts: form.parts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, part_name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label="الكمية"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="الكمية"
                    value={part.quantity}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        parts: form.parts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, quantity: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label="كلفة الوحدة"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="كلفة الوحدة"
                    value={part.unit_cost}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        parts: form.parts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, unit_cost: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums">
                    {money((Number(part.quantity) || 0) * (Number(part.unit_cost) || 0))} د.ع
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="حذف القطعة"
                    onClick={() => setForm({ ...form, parts: form.parts.filter((_, itemIndex) => itemIndex !== index) })}
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              اختيار قطعة من مخزن الصيانة يصرف كميتها تلقائياً عند حفظ سجل بحالة «مكتملة». القطعة الخارجية تبقى للتوثيق والكلفة فقط.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="r-labor">أجرة اليد (د.ع)</Label>
                <Input
                  id="r-labor"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.labor}
                  onChange={(event) => setForm({ ...form, labor: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>كلفة القطع</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-semibold tabular-nums">
                  {money(partsTotal)} د.ع
                </div>
              </div>
              <div className="space-y-2">
                <Label>الإجمالي</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-bold tabular-nums">
                  {money(formTotal)} د.ع
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 space-y-3">
            <h3 className="text-sm font-bold">المرفقات (صور / فواتير)</h3>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-medium transition-colors hover:bg-accent">
              <ImageIcon className="h-4 w-4" /> إرفاق ملفات
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setForm({ ...form, newFiles: [...form.newFiles, ...files] });
                  event.target.value = "";
                }}
              />
            </label>
            {(form.newFiles.length > 0 || form.existingAttachments.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {form.existingAttachments.map((attachment) => (
                  <div key={attachment.id ?? attachment.file_url} className="relative">
                    <a href={attachment.file_url} target="_blank" rel="noopener noreferrer">
                      {attachment.file_type === "application/pdf" ? (
                        <span className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted text-xs">
                          PDF
                        </span>
                      ) : (
                        <img src={attachment.file_url} alt="مرفق الصيانة" className="h-16 w-16 rounded-lg border object-cover" />
                      )}
                    </a>
                    <button
                      type="button"
                      aria-label="حذف المرفق"
                      onClick={() => void removeAttachment(attachment)}
                      className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {form.newFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="relative">
                    <span className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted px-1 text-center text-[10px]">
                      {file.name.length > 18 ? `${file.name.slice(0, 18)}…` : file.name}
                    </span>
                    <button
                      type="button"
                      aria-label="إزالة الملف"
                      onClick={() =>
                        setForm({ ...form, newFiles: form.newFiles.filter((_, fileIndex) => fileIndex !== index) })
                      }
                      className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => saveRecord.mutate()} disabled={saveRecord.isPending}>
              <Save className="ml-2 h-4 w-4" /> {saveRecord.isPending ? "جارٍ الحفظ…" : "حفظ السجل"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {catalogOpen && <MaintenanceCatalogDialog onClose={() => setCatalogOpen(false)} />}

      {printRecord && (
        <div className="maintenance-print" dir="rtl">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "2px solid #0f172a",
              paddingBottom: 12,
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{workspaceName}</h1>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>تقرير صيانة — {recordTypeLabel(printRecord.record_type)}</p>
            </div>
            <div style={{ textAlign: "left", fontSize: 12, lineHeight: 1.7 }}>
              <p style={{ margin: 0 }}>رقم السجل: <b>{printRecord.record_no}</b></p>
              <p style={{ margin: 0 }}>التاريخ: <b>{dateLabel(printRecord.maintenance_date)}</b></p>
            </div>
          </div>

          <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <tr><td style={printCell}>الجهة</td><td style={printCell}>{entityLabel(printRecord)}</td></tr>
              <tr><td style={printCell}>نوع الصيانة</td><td style={printCell}>{printRecord.maintenance_type_name ?? "—"}</td></tr>
              <tr><td style={printCell}>الورشة / الفني</td><td style={printCell}>{printRecord.workshop_name ?? "—"}{printRecord.technician ? ` · ${printRecord.technician}` : ""}</td></tr>
              <tr><td style={printCell}>الحالة</td><td style={printCell}>{statusLabel(printRecord.status)}</td></tr>
              <tr><td style={printCell}>العداد / ساعات التشغيل</td><td style={printCell}>{printRecord.odometer_reading ?? "—"} كم{printRecord.hours_reading != null ? ` · ${printRecord.hours_reading} ساعة` : ""}</td></tr>
              <tr><td style={printCell}>الصيانة القادمة</td><td style={printCell}>{dateLabel(printRecord.next_maintenance_date)}</td></tr>
              <tr><td style={printCell}>وصف الأعمال</td><td style={printCell}>{printRecord.notes ?? "—"}</td></tr>
            </tbody>
          </table>

          <h3 style={{ margin: "18px 0 8px", fontSize: 14 }}>القطع والأعمال</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={printCell}>#</th>
                <th style={printCell}>القطعة / العمل</th>
                <th style={printCell}>الكمية</th>
                <th style={printCell}>كلفة الوحدة</th>
                <th style={printCell}>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {(printRecord.maintenance_record_parts ?? []).map((part, index) => (
                <tr key={part.id ?? index}>
                  <td style={printCell}>{index + 1}</td>
                  <td style={printCell}>{part.part_name}</td>
                  <td style={printCell}>{Number(part.quantity).toLocaleString()}</td>
                  <td style={printCell}>{money(part.unit_cost)} د.ع</td>
                  <td style={printCell}>{money(part.line_total)} د.ع</td>
                </tr>
              ))}
              {(printRecord.maintenance_record_parts ?? []).length === 0 && (
                <tr>
                  <td style={printCell} colSpan={5}>لا توجد قطع مسجلة.</td>
                </tr>
              )}
            </tbody>
          </table>

          <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              <tr><td style={printCell}>أجرة اليد</td><td style={printCell}>{money(printRecord.labor_cost)} د.ع</td></tr>
              <tr><td style={printCell}>كلفة القطع</td><td style={printCell}>{money(printRecord.parts_total)} د.ع</td></tr>
              <tr><td style={printCell}><b>الإجمالي</b></td><td style={printCell}><b>{money(printRecord.total_cost)} د.ع</b></td></tr>
            </tbody>
          </table>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 56 }}>
            {["توقيع الفني", "توقيع المسؤول", "توقيع مدير الصيانة"].map((label) => (
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

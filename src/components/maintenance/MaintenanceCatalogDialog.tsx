import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatErrorMessage } from "@/lib/error-message";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { Machinery, MaintenanceType, Workshop } from "@/lib/maintenance";

export function MaintenanceCatalogDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();

  const machineryQuery = useQuery({
    queryKey: ["maintenance-machinery"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("machinery")
        .select("id, code, name, category, plate_no, model, year, status, current_hours, current_odometer, notes")
        .order("code");
      if (error) throw error;
      return (data ?? []) as Machinery[];
    },
  });
  const typesQuery = useQuery({
    queryKey: ["maintenance-types"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_types")
        .select("id, name, category, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as MaintenanceType[];
    },
  });
  const workshopsQuery = useQuery({
    queryKey: ["maintenance-workshops"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("maintenance_workshops")
        .select("id, name, kind, phone, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Workshop[];
    },
  });

  const machinery = machineryQuery.data ?? [];
  const types = typesQuery.data ?? [];
  const workshops = workshopsQuery.data ?? [];

  const [machineForm, setMachineForm] = useState({
    code: "",
    name: "",
    category: "",
    plate_no: "",
    model: "",
    year: "",
    notes: "",
  });
  const [typeForm, setTypeForm] = useState({ name: "", category: "" });
  const [workshopForm, setWorkshopForm] = useState({ name: "", kind: "workshop", phone: "" });

  const invalidate = async (key: string) => {
    await client.invalidateQueries({ queryKey: [key] });
  };

  const addMachine = useMutation({
    mutationFn: async () => {
      if (!machineForm.code.trim() || !machineForm.name.trim()) throw new Error("رقم الآلية واسمها مطلوبان");
      const { error } = await (supabase as any).from("machinery").insert({
        code: machineForm.code.trim(),
        name: machineForm.name.trim(),
        category: machineForm.category.trim() || null,
        plate_no: machineForm.plate_no.trim() || null,
        model: machineForm.model.trim() || null,
        year: machineForm.year.trim() ? Number(machineForm.year) : null,
        notes: machineForm.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تمت إضافة الآلية");
      setMachineForm({ code: "", name: "", category: "", plate_no: "", model: "", year: "", notes: "" });
      await invalidate("maintenance-machinery");
    },
    onError: (error: Error) => toast.error(`تعذر إضافة الآلية: ${formatErrorMessage(error)}`),
  });

  const deleteMachine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("machinery").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف الآلية");
      await invalidate("maintenance-machinery");
    },
    onError: (error: Error) => toast.error(`تعذر الحذف: ${formatErrorMessage(error)}`),
  });

  const addType = useMutation({
    mutationFn: async () => {
      if (!typeForm.name.trim()) throw new Error("اسم نوع الصيانة مطلوب");
      const { error } = await (supabase as any).from("maintenance_types").insert({
        name: typeForm.name.trim(),
        category: typeForm.category.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تمت إضافة نوع الصيانة");
      setTypeForm({ name: "", category: "" });
      await invalidate("maintenance-types");
    },
    onError: (error: Error) => toast.error(`تعذر الإضافة: ${formatErrorMessage(error)}`),
  });

  const toggleType = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as any).from("maintenance_types").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate("maintenance-types");
    },
    onError: (error: Error) => toast.error(`تعذر التحديث: ${formatErrorMessage(error)}`),
  });

  const deleteType = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maintenance_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم حذف النوع");
      await invalidate("maintenance-types");
    },
    onError: (error: Error) => toast.error(`تعذر الحذف: ${formatErrorMessage(error)}`),
  });

  const addWorkshop = useMutation({
    mutationFn: async () => {
      if (!workshopForm.name.trim()) throw new Error("اسم الورشة أو الفني مطلوب");
      const { error } = await (supabase as any).from("maintenance_workshops").insert({
        name: workshopForm.name.trim(),
        kind: workshopForm.kind,
        phone: workshopForm.phone.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تمت الإضافة");
      setWorkshopForm({ name: "", kind: "workshop", phone: "" });
      await invalidate("maintenance-workshops");
    },
    onError: (error: Error) => toast.error(`تعذر الإضافة: ${formatErrorMessage(error)}`),
  });

  const deleteWorkshop = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("maintenance_workshops").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم الحذف");
      await invalidate("maintenance-workshops");
    },
    onError: (error: Error) => toast.error(`تعذر الحذف: ${formatErrorMessage(error)}`),
  });

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>كتالوج الصيانة</DialogTitle>
          <DialogDescription>إدارة الآليات وأنواع الصيانة والورش والفنيين.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="machinery" className="space-y-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="machinery">الآليات</TabsTrigger>
            <TabsTrigger value="types">أنواع الصيانة</TabsTrigger>
            <TabsTrigger value="workshops">الورش والفنيون</TabsTrigger>
          </TabsList>

          <TabsContent value="machinery" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="m-code">رقم الآلية *</Label>
                <Input id="m-code" value={machineForm.code} onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-name">الاسم / النوع *</Label>
                <Input id="m-name" value={machineForm.name} onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-cat">التصنيف</Label>
                <Input id="m-cat" value={machineForm.category} onChange={(e) => setMachineForm({ ...machineForm, category: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-plate">رقم اللوحة / التسلسل</Label>
                <Input id="m-plate" value={machineForm.plate_no} onChange={(e) => setMachineForm({ ...machineForm, plate_no: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-model">الطراز</Label>
                <Input id="m-model" value={machineForm.model} onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-year">سنة الصنع</Label>
                <Input id="m-year" type="number" value={machineForm.year} onChange={(e) => setMachineForm({ ...machineForm, year: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label htmlFor="m-notes">ملاحظات</Label>
                <Input id="m-notes" value={machineForm.notes} onChange={(e) => setMachineForm({ ...machineForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => addMachine.mutate()} disabled={addMachine.isPending}>
                <Plus className="ml-2 h-4 w-4" /> إضافة آلية
              </Button>
            </div>
            <div className="space-y-2">
              {machinery.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                  <div>
                    <b>{item.name}</b>
                    <span className="mr-2 text-xs text-muted-foreground">#{item.code}{item.category ? ` · ${item.category}` : ""}</span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`حذف ${item.name}`}
                    onClick={() => {
                      if (confirm(`حذف الآلية ${item.name}؟`)) deleteMachine.mutate(item.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {machinery.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد آليات مسجلة بعد.</p>}
            </div>
          </TabsContent>

          <TabsContent value="types" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">اسم نوع الصيانة *</Label>
                <Input id="t-name" value={typeForm.name} onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-cat">التصنيف</Label>
                <Input id="t-cat" value={typeForm.category} onChange={(e) => setTypeForm({ ...typeForm, category: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => addType.mutate()} disabled={addType.isPending}>
                <Plus className="ml-2 h-4 w-4" /> إضافة نوع
              </Button>
            </div>
            <div className="space-y-2">
              {types.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                  <div>
                    <b>{item.name}</b>
                    {item.category && <span className="mr-2 text-xs text-muted-foreground">· {item.category}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={item.is_active}
                        onCheckedChange={(active) => toggleType.mutate({ id: item.id, active })}
                      />
                      {item.is_active ? "مفعّل" : "موقوف"}
                    </label>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`حذف ${item.name}`}
                      onClick={() => {
                        if (confirm(`حذف نوع الصيانة ${item.name}؟`)) deleteType.mutate(item.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {types.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد أنواع مسجلة.</p>}
            </div>
          </TabsContent>

          <TabsContent value="workshops" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="w-name">الاسم *</Label>
                <Input id="w-name" value={workshopForm.name} onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>النوع</Label>
                <Select value={workshopForm.kind} onValueChange={(value) => setWorkshopForm({ ...workshopForm, kind: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workshop">ورشة</SelectItem>
                    <SelectItem value="technician">فني</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="w-phone">الهاتف</Label>
                <Input id="w-phone" value={workshopForm.phone} onChange={(e) => setWorkshopForm({ ...workshopForm, phone: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => addWorkshop.mutate()} disabled={addWorkshop.isPending}>
                <Plus className="ml-2 h-4 w-4" /> إضافة
              </Button>
            </div>
            <div className="space-y-2">
              {workshops.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                  <div>
                    <b>{item.name}</b>
                    <span className="mr-2 text-xs text-muted-foreground">
                      {item.kind === "workshop" ? "ورشة" : "فني"}
                      {item.phone ? ` · ${item.phone}` : ""}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`حذف ${item.name}`}
                    onClick={() => {
                      if (confirm(`حذف ${item.name}؟`)) deleteWorkshop.mutate(item.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {workshops.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد ورش أو فنيون مسجلون.</p>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

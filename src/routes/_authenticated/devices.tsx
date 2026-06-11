import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "الأجهزة" }] }),
  component: DevicesPage,
});

type Device = { id: string; name: string; serial_number: string | null; ip_address: string | null; location: string | null; description: string | null; status: string; last_sync_at: string | null };

function DevicesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("devices").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Device[];
    },
  });

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editing) {
        const { error } = await supabase.from("devices").update(d).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("devices").insert(d);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("devices").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      name: f.get("name") as string,
      serial_number: (f.get("serial_number") as string) || null,
      ip_address: (f.get("ip_address") as string) || null,
      location: (f.get("location") as string) || null,
      description: (f.get("description") as string) || null,
      status: f.get("status") as any,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">الأجهزة</h1>
          <p className="text-muted-foreground mt-1">إدارة أجهزة البصمة ZKTeco</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button onClick={() => setEditing(null)}><Plus className="w-4 h-4 ml-2" /> إضافة جهاز</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>{editing ? "تعديل الجهاز" : "جهاز جديد"}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>اسم الجهاز</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div><Label>الرقم التسلسلي</Label><Input name="serial_number" defaultValue={editing?.serial_number ?? ""} /></div>
              <div><Label>عنوان IP</Label><Input name="ip_address" defaultValue={editing?.ip_address ?? ""} /></div>
              <div><Label>الموقع</Label><Input name="location" defaultValue={editing?.location ?? ""} /></div>
              <div><Label>الوصف</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
              <div>
                <Label>الحالة</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="inactive">معطل</SelectItem>
                    <SelectItem value="maintenance">صيانة</SelectItem>
                  </SelectContent>
                </Select>
                <input type="hidden" name="status_hidden" />
              </div>
              <Button type="submit" className="w-full" disabled={save.isPending}>حفظ</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>قائمة الأجهزة ({devices.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الرقم التسلسلي</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>الموقع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر مزامنة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="font-mono text-sm">{d.serial_number ?? "-"}</TableCell>
                  <TableCell>{d.ip_address ?? "-"}</TableCell>
                  <TableCell>{d.location ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={d.status === "active" ? "default" : "secondary"}>
                      {d.status === "active" ? "نشط" : d.status === "maintenance" ? "صيانة" : "معطل"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.last_sync_at ? new Date(d.last_sync_at).toLocaleString("ar") : "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف الجهاز؟")) del.mutate(d.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!devices.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا توجد أجهزة بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

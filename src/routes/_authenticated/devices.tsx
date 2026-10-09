import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createZktecoSyncKey, getZktecoSyncStatus } from "@/lib/zkteco-sync.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Pencil, KeyRound, Copy, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "الأجهزة" }] }),
  component: DevicesPage,
});

type Device = { id: string; name: string; serial_number: string | null; ip_address: string | null; location: string | null; description: string | null; status: string; last_sync_at: string | null };
type SyncStatus = { device_id: string; auto_last_sync_at: string | null; auto_synced_logs_total: number; has_active_key: boolean; key_prefix: string | null };

function DevicesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [createdKey, setCreatedKey] = useState<{ deviceId: string; key: string; serial: string } | null>(null);
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

  const { data: syncStatuses = [], error: syncStatusError } = useQuery({
    queryKey: ["zkteco-sync-status"],
    queryFn: () => getZktecoSyncStatus(),
    enabled: isAdmin,
    refetchInterval: 30_000,
  });
  const syncByDevice = new Map((syncStatuses as SyncStatus[]).map((status) => [status.device_id, status]));

  const createKey = useMutation({
    mutationFn: (deviceId: string) => createZktecoSyncKey({ data: { device_id: deviceId } }),
    onSuccess: (result, deviceId) => {
      setCreatedKey({ deviceId, key: result.key, serial: result.device_sn });
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      toast.success("تم إنشاء المفتاح. انسخه الآن أو نزّل إعداد الوكيل؛ لن يظهر المفتاح مرة أخرى.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copySyncKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      toast.success("تم نسخ مفتاح الربط");
    } catch {
      toast.error("تعذر النسخ؛ انسخ المفتاح من الحقل الظاهر");
    }
  };

  const downloadAgentConfig = (device: Device) => {
    if (!createdKey || createdKey.deviceId !== device.id) return;
    const config = [
      "[agent]",
      `device_ip = ${device.ip_address || "192.168.1.201"}`,
      "device_port = 4370",
      "device_password = 0",
      "device_timeout_seconds = 10",
      `device_sn = ${createdKey.serial}`,
      `sync_url = ${window.location.origin}/api/public/zkteco-sync`,
      `sync_key = ${createdKey.key}`,
      "site_id =",
      "interval_seconds = 60",
      "state_file = sync_state.json",
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([config], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agent_config.ini";
    anchor.click();
    URL.revokeObjectURL(url);
  };

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

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" /> المزامنة السحابية التلقائية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>أنشئ مفتاحاً لكل جهاز، ثم نزّل ملف الإعدادات وضعه بجانب وكيل Python على حاسوب متصل بشبكة الجهاز.</p>
          <a className="inline-flex items-center gap-2 font-semibold text-primary underline" href="https://raw.githubusercontent.com/ilmnswry2001/zkt-sync/main/scripts/zkteco_sync_agent.py" download>
            <Download className="h-4 w-4" /> تنزيل وكيل المزامنة
          </a>
          {syncStatusError && isAdmin && <p role="alert" className="text-destructive">تعذر تحميل حالة المزامنة. تحقق من تطبيق migration الخاصة بالمزامنة.</p>}
          {createdKey && (
            <div className="space-y-2 rounded-lg border bg-background p-3">
              <p className="font-semibold">مفتاح جديد للجهاز {createdKey.serial} — يظهر مرة واحدة فقط:</p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly value={createdKey.key} className="min-w-[18rem] flex-1 font-mono" aria-label="مفتاح مزامنة الجهاز" />
                <Button type="button" variant="outline" onClick={copySyncKey}><Copy className="ml-2 h-4 w-4" /> نسخ المفتاح</Button>
                {devices.find((device) => device.id === createdKey.deviceId) && (
                  <Button type="button" variant="outline" onClick={() => downloadAgentConfig(devices.find((device) => device.id === createdKey.deviceId)!)}><Download className="ml-2 h-4 w-4" /> تنزيل الإعدادات</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                <TableHead>الربط التلقائي</TableHead>
                <TableHead>الحركات المرفوعة</TableHead>
                <TableHead>إعداد الوكيل</TableHead>
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
                  {(() => {
                    const sync = syncByDevice.get(d.id);
                    const connected = !!sync?.auto_last_sync_at && Date.now() - Date.parse(sync.auto_last_sync_at) <= 3 * 60_000;
                    return <TableCell><Badge variant={connected ? "default" : "secondary"}>{connected ? "متصل" : sync?.has_active_key ? "بانتظار الاتصال" : "غير مربوط"}</Badge>{sync?.auto_last_sync_at && <div className="mt-1 text-xs text-muted-foreground">{new Date(sync.auto_last_sync_at).toLocaleString("ar")}</div>}</TableCell>;
                  })()}
                  <TableCell>{(syncByDevice.get(d.id)?.auto_synced_logs_total ?? 0).toLocaleString("ar-IQ")}</TableCell>
                  <TableCell>
                    {isAdmin && <div className="flex min-w-40 flex-col gap-1">
                      <Button size="sm" variant="outline" disabled={!d.serial_number || createKey.isPending} onClick={() => createKey.mutate(d.id)}>
                        <KeyRound className="ml-2 h-4 w-4" /> {syncByDevice.get(d.id)?.has_active_key ? "تدوير المفتاح" : "إنشاء مفتاح"}
                      </Button>
                      {createdKey?.deviceId === d.id && <Button size="sm" variant="ghost" onClick={() => downloadAgentConfig(d)}><Download className="ml-2 h-4 w-4" /> تنزيل agent_config.ini</Button>}
                      {syncByDevice.get(d.id)?.has_active_key && createdKey?.deviceId !== d.id && <span className="text-xs text-muted-foreground">مفتاح فعّال محفوظ كـ {syncByDevice.get(d.id)?.key_prefix}…</span>}
                    </div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف الجهاز؟")) del.mutate(d.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!devices.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">لا توجد أجهزة بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

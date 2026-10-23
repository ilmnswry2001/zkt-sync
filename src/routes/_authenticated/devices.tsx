import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createZktecoSyncKey, getZktecoSyncStatus, requestZktecoSync, revokeZktecoSyncKey } from "@/lib/zkteco-sync.functions";
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
import { Trash2, Plus, Pencil, KeyRound, Copy, Download, RefreshCw, Ban } from "lucide-react";
import { toast } from "sonner";
import agentScript from "../../../scripts/agent.py?raw";
import agentRequirements from "../../../scripts/requirements.txt?raw";
import agentInstaller from "../../../scripts/install_agent_background.ps1?raw";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: "الأجهزة" }] }),
  component: DevicesPage,
});

type Device = { id: string; name: string; serial_number: string | null; ip_address: string | null; location: string | null; description: string | null; status: string; last_sync_at: string | null };
type SyncStatus = { device_id: string; auto_last_sync_at: string | null; auto_synced_logs_total: number; has_active_key: boolean; key_prefix: string | null; batches: { id: string; received_at: string; record_count: number; inserted_count: number; duplicate_count: number; unmatched_count: number; error_count: number; error_details: { message?: string }[] }[]; commands: { id: string; requested_at: string; started_at: string | null; completed_at: string | null; status: "pending" | "running" | "succeeded" | "failed"; result: { inserted?: number; duplicates?: number; unmatched?: number }; error_message: string | null }[] };

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
    refetchInterval: 5_000,
  });
  const syncByDevice = new Map((syncStatuses as SyncStatus[]).map((status) => [status.device_id, status]));

  const createKey = useMutation({
    mutationFn: (deviceId: string) => createZktecoSyncKey({ data: { device_id: deviceId } }),
    onSuccess: (result, deviceId) => {
      setCreatedKey({ deviceId, key: result.key, serial: result.device_sn });
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      toast.success("تم إنشاء المفتاح. انسخه الآن أو نزّل إعداد الوكيل؛ لن يظهر المفتاح مرة أخرى.");
    },
    onError: (error: Error) => toast.error(formatErrorMessage(error)),
  });
  const revokeKey = useMutation({
    mutationFn: (deviceId: string) => revokeZktecoSyncKey({ data: { device_id: deviceId } }),
    onSuccess: () => { setCreatedKey(null); qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] }); toast.success("تم إلغاء مفتاح الجهاز"); },
    onError: (error: Error) => toast.error(formatErrorMessage(error)),
  });
  const syncNow = useMutation({
    mutationFn: (deviceId: string) => requestZktecoSync({ data: { device_id: deviceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      toast.success("أرسلنا طلب السحب إلى الوكيل. ستظهر النتيجة هنا عند اكتماله.");
    },
    onError: (error: Error) => toast.error(formatErrorMessage(error)),
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
      "timeout_seconds = 10",
      `serial = ${createdKey.serial}`,
      `sync_url = ${window.location.origin}/api/public/zk-sync`,
      `device_key = ${createdKey.key}`,
      "interval_seconds = 300",
      "queue_db = agent_queue.sqlite3",
      "state_file = state.json",
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([config], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agent_config.ini";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadTextFile = (filename: string, contents: string, contentType: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type: contentType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    onError: (e: any) => toast.error(formatErrorMessage(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("devices").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(formatErrorMessage(e)),
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
          <p>ضع ملفات الوكيل والإعدادات في مجلد ثابت على حاسوب متصل بشبكة جهاز البصمة والإنترنت، ثم شغّل مثبت الخلفية مرة واحدة. بعد تشغيل الوكيل، استخدم «سحب الآن» بجانب الجهاز لطلب قراءة السجلات دون أوامر يدوية.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("agent.py", agentScript, "text/x-python;charset=utf-8")}>
              <Download className="h-4 w-4" /> تنزيل وكيل المزامنة
            </button>
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("requirements.txt", agentRequirements, "text/plain;charset=utf-8")}>
              <Download className="h-4 w-4" /> تنزيل متطلبات Python
            </button>
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("install_agent_background.ps1", agentInstaller, "text/plain;charset=utf-8")}>
              <Download className="h-4 w-4" /> تنزيل مثبت التشغيل التلقائي
            </button>
          </div>
          <p className="text-muted-foreground">نزّل ملفات الوكيل والإعدادات إلى مجلد ثابت على حاسوب الشبكة، ثم شغّل مثبت التشغيل التلقائي مرة واحدة. بعد ذلك استخدم زر «سحب الآن» من هذه الصفحة.</p>
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
                  <TableCell className="font-medium">
                    {(() => {
                      const sync = syncByDevice.get(d.id);
                      const command = sync?.commands?.[0];
                      const pendingExpired = command?.status === "pending" && Date.now() - Date.parse(command.requested_at) > 2 * 60_000;
                      const runningExpired = command?.status === "running" && command.started_at && Date.now() - Date.parse(command.started_at) > 15 * 60_000;
                      const active = (command?.status === "pending" && !pendingExpired) || (command?.status === "running" && !runningExpired);
                      return <div className="flex min-w-40 flex-col items-start gap-1">
                        <span>{d.name}</span>
                        {isAdmin && <Button size="sm" variant="outline" disabled={!sync?.has_active_key || !d.serial_number || active || syncNow.isPending} onClick={() => syncNow.mutate(d.id)}>
                          <RefreshCw className={`ml-2 h-4 w-4 ${active ? "animate-spin" : ""}`} /> {active ? "الوكيل ينفذ الطلب" : "سحب الآن"}
                        </Button>}
                        {command && <span className="text-xs text-muted-foreground">
                          {command.status === "pending" ? pendingExpired ? "لم يتصل الوكيل؛ شغّله وأعد الطلب" : "بانتظار اتصال الوكيل" : command.status === "running" ? runningExpired ? "تجاوز الطلب المهلة؛ يمكنك إعادة المحاولة" : "جارٍ سحب السجلات" : command.status === "succeeded" ? `اكتمل: ${command.result?.inserted ?? 0} جديد، ${command.result?.duplicates ?? 0} مكرر` : command.error_message ?? "فشل السحب"}
                        </span>}
                      </div>;
                    })()}
                  </TableCell>
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
                    const connected = !!sync?.auto_last_sync_at && Date.now() - Date.parse(sync.auto_last_sync_at) <= 15 * 60_000;
                    return <TableCell><Badge variant={connected ? "default" : "destructive"}>{connected ? "متصل" : sync?.has_active_key ? "متوقف" : "غير مربوط"}</Badge>{sync?.auto_last_sync_at && <div className="mt-1 text-xs text-muted-foreground">{new Date(sync.auto_last_sync_at).toLocaleString("ar")}</div>}</TableCell>;
                  })()}
                  <TableCell>{(syncByDevice.get(d.id)?.auto_synced_logs_total ?? 0).toLocaleString("ar-IQ")}</TableCell>
                  <TableCell>
                    {isAdmin && <div className="flex min-w-40 flex-col gap-1">
                      <Button size="sm" variant="outline" disabled={!d.serial_number || createKey.isPending} onClick={() => createKey.mutate(d.id)}>
                        <KeyRound className="ml-2 h-4 w-4" /> {syncByDevice.get(d.id)?.has_active_key ? "تدوير المفتاح" : "إنشاء مفتاح"}
                      </Button>
                      {createdKey?.deviceId === d.id && <Button size="sm" variant="ghost" onClick={() => downloadAgentConfig(d)}><Download className="ml-2 h-4 w-4" /> تنزيل agent_config.ini</Button>}
                      {syncByDevice.get(d.id)?.has_active_key && createdKey?.deviceId !== d.id && <span className="text-xs text-muted-foreground">مفتاح فعّال محفوظ كـ {syncByDevice.get(d.id)?.key_prefix}…</span>}
                      {syncByDevice.get(d.id)?.has_active_key && <Button size="sm" variant="ghost" disabled={revokeKey.isPending} onClick={() => revokeKey.mutate(d.id)}><Ban className="ml-2 h-4 w-4" /> إلغاء المفتاح</Button>}
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
      <Card>
        <CardHeader><CardTitle>آخر دفعات المزامنة</CardTitle></CardHeader>
        <CardContent><Table><TableHeader><TableRow><TableHead>الجهاز</TableHead><TableHead>الوقت</TableHead><TableHead>الواردة</TableHead><TableHead>أُدرجت</TableHead><TableHead>مكررة</TableHead><TableHead>غير مطابقة</TableHead><TableHead>أخطاء</TableHead></TableRow></TableHeader>
          <TableBody>{(syncStatuses as SyncStatus[]).flatMap((sync) => sync.batches.map((batch) => <TableRow key={batch.id}><TableCell>{devices.find((device) => device.id === sync.device_id)?.name ?? "—"}</TableCell><TableCell>{new Date(batch.received_at).toLocaleString("ar-IQ")}</TableCell><TableCell>{batch.record_count}</TableCell><TableCell>{batch.inserted_count}</TableCell><TableCell>{batch.duplicate_count}</TableCell><TableCell>{batch.unmatched_count}</TableCell><TableCell title={batch.error_details?.map((item) => item.message).filter(Boolean).join(" | ")}>{batch.error_count}</TableCell></TableRow>))}{!(syncStatuses as SyncStatus[]).some((sync) => sync.batches.length) && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد دفعات بعد</TableCell></TableRow>}</TableBody>
        </Table></CardContent>
      </Card>
    </div>
  );
}

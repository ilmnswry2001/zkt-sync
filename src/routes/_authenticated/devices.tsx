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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const { isAdmin, isHR } = useAuth();
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
    <Tabs defaultValue="devices" dir="rtl" className="space-y-5">
      <TabsList className="h-auto flex-wrap bg-transparent p-0">
        <TabsTrigger value="devices" className="min-h-10 rounded-xl border bg-card">الأجهزة والمزامنة</TabsTrigger>
        <TabsTrigger value="verification" className="min-h-10 rounded-xl border bg-card">سجلات التحقق</TabsTrigger>
      </TabsList>
      <TabsContent value="devices" className="mt-0">
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
          <TableBody>{(syncStatuses as SyncStatus[]).flatMap((sync) => sync.batches.map((batch) => <TableRow key={batch.id}><TableCell>{devices.find((device) => device.id === sync.device_id)?.name ?? "—"}</TableCell><TableCell>{new Date(batch.received_at).toLocaleString("ar-IQ")}</TableCell><TableCell>{batch.record_count}</TableCell><TableCell>{batch.inserted_count}</TableCell><TableCell>{batch.duplicate_count}</TableCell><TableCell>{batch.unmatched_count}</TableCell><TableCell>
            <span>{batch.error_count}</span>
            {!!batch.error_details?.length && <details className="mt-1 min-w-48 text-xs">
              <summary className="cursor-pointer text-primary underline">عرض سبب الخطأ</summary>
              <div dir="auto" className="mt-1 max-w-sm whitespace-normal break-words rounded border bg-background p-2 text-destructive">
                {batch.error_details.map((detail, index) => <p key={index}>{detail.message ?? "خطأ غير محدد"}</p>)}
              </div>
            </details>}
          </TableCell></TableRow>))}{!(syncStatuses as SyncStatus[]).some((sync) => sync.batches.length) && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد دفعات بعد</TableCell></TableRow>}</TableBody>
        </Table></CardContent>
      </Card>
    </div>
      </TabsContent>
      <TabsContent value="verification" className="mt-0">
        <DeviceSyncRecords devices={devices} canView={isAdmin || isHR} />
      </TabsContent>
    </Tabs>
  );
}

type SyncRecordStatus = "all" | "inserted" | "duplicate" | "unmatched" | "unprocessed";
function DeviceSyncRecords({ devices, canView }: { devices: Device[]; canView: boolean }) {
  const [status, setStatus] = useState<SyncRecordStatus>("all");
  const [deviceId, setDeviceId] = useState("all");
  const [search, setSearch] = useState("");
  const [externalId, setExternalId] = useState("");
  const [verifyType, setVerifyType] = useState("");
  const [deviceStatus, setDeviceStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const query = useQuery({
    queryKey: ["device-sync-records", status, deviceId, search, externalId, verifyType, deviceStatus, dateFrom, dateTo, page],
    enabled: canView,
    refetchInterval: 15_000,
    queryFn: async () => {
      const db = supabase as any;
      let request = db.from("device_sync_records")
        .select("id, device_id, user_pin, employee_no, employee_id, verify_time, verify_type, status, external_log_id, processing_status, error_message, sync_batch_id, employee:employees(full_name), device:devices(name), batch:sync_batches(received_at)", { count: "exact" })
        .order("verify_time", { ascending: false });
      if (deviceId !== "all") request = request.eq("device_id", deviceId);
      if (status === "unprocessed") request = request.in("processing_status", ["pending", "error"]);
      else if (status !== "all") request = request.eq("processing_status", status);
      const term = search.trim().replace(/[,()%\\]/g, " ");
      if (term) request = request.or(`user_pin.ilike.%${term}%,employee_no.ilike.%${term}%`);
      if (externalId.trim()) request = request.eq("external_log_id", Number(externalId));
      if (verifyType.trim()) request = request.eq("verify_type", Number(verifyType));
      if (deviceStatus.trim()) request = request.eq("status", Number(deviceStatus));
      if (dateFrom) request = request.gte("verify_time", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) {
        const until = new Date(`${dateTo}T00:00:00`);
        until.setDate(until.getDate() + 1);
        request = request.lt("verify_time", until.toISOString());
      }
      const { data, error, count } = await request.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const rows = query.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.count ?? 0) / pageSize));
  const resetFilters = () => { setStatus("all"); setDeviceId("all"); setSearch(""); setExternalId(""); setVerifyType(""); setDeviceStatus(""); setDateFrom(""); setDateTo(""); setPage(0); };
  const statusLabel = (value: string) => ({ inserted: "مسجلة", duplicate: "مكررة", unmatched: "رقم غير معرف", pending: "قيد المعالجة", error: "خطأ" }[value] ?? value);

  return <Card>
    <CardHeader><CardTitle>سجلات التحقق من حركات الأجهزة</CardTitle><p className="text-sm text-muted-foreground">تفاصيل كل حركة مرفوعة، ونتيجة مطابقتها بالموظف وسجل الحضور. تبدأ التفاصيل من أول مزامنة بعد تطبيق تحديث النظام وترحيل قاعدة البيانات؛ الدفعات السابقة تحتفظ بإجمالياتها فقط.</p></CardHeader>
    <CardContent className="space-y-4">
      {!canView ? <p className="text-sm text-muted-foreground">هذا السجل متاح لمدير النظام والموارد البشرية فقط.</p> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="رقم الجهاز أو الرقم الوظيفي" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
          <Input aria-label="معرف الحركة في الجهاز" placeholder="معرف الحركة بالجهاز" inputMode="numeric" value={externalId} onChange={(event) => { setExternalId(event.target.value.replace(/\D/g, "")); setPage(0); }} />
          <Select value={deviceId} onValueChange={(value) => { setDeviceId(value); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="كل الأجهزة" /></SelectTrigger><SelectContent><SelectItem value="all">كل الأجهزة</SelectItem>{devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => { setStatus(value as SyncRecordStatus); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="كل الحالات" /></SelectTrigger><SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem><SelectItem value="inserted">تم تسجيلها</SelectItem><SelectItem value="duplicate">مكررة</SelectItem>
              <SelectItem value="unmatched">رقم غير معرف بالنظام</SelectItem><SelectItem value="unprocessed">لم تعالج أو بها خطأ</SelectItem>
            </SelectContent>
          </Select>
          <Input aria-label="نوع التحقق" placeholder="نوع التحقق (رقم)" inputMode="numeric" value={verifyType} onChange={(event) => { setVerifyType(event.target.value.replace(/\D/g, "")); setPage(0); }} />
          <Input aria-label="حالة الحركة بالجهاز" placeholder="حالة الحركة بالجهاز" inputMode="numeric" value={deviceStatus} onChange={(event) => { setDeviceStatus(event.target.value.replace(/\D/g, "")); setPage(0); }} />
          <Input aria-label="من تاريخ الحركة" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(0); }} />
          <div className="flex gap-2"><Input aria-label="إلى تاريخ الحركة" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(0); }} /><Button variant="outline" onClick={resetFilters}>مسح</Button></div>
        </div>
        {query.error && <p role="alert" className="text-sm text-destructive">تعذر تحميل السجلات. تحقق من تطبيق ترحيل سجلات التحقق.</p>}
        <div className="overflow-x-auto rounded-md border">
          <Table><TableHeader><TableRow><TableHead>وقت الحركة</TableHead><TableHead>وقت الرفع</TableHead><TableHead>الجهاز</TableHead><TableHead>معرف الجهاز</TableHead><TableHead>الموظف المطابق</TableHead><TableHead>التحقق / الحالة</TableHead><TableHead>معرف الحركة</TableHead><TableHead>حالة المعالجة</TableHead><TableHead>الخطأ</TableHead><TableHead>معرف الدفعة</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row: any) => <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">{new Date(row.verify_time).toLocaleString("ar-IQ")}</TableCell>
              <TableCell className="whitespace-nowrap">{row.batch?.received_at ? new Date(row.batch.received_at).toLocaleString("ar-IQ") : "—"}</TableCell>
              <TableCell>{row.device?.name ?? devices.find((device) => device.id === row.device_id)?.name ?? "—"}</TableCell>
              <TableCell className="font-mono">{row.user_pin}</TableCell>
              <TableCell>{row.employee_id ? <div>{row.employee?.full_name ?? "موظف مرتبط"}<div className="text-xs text-muted-foreground">{row.employee_no ?? ""}</div></div> : <span className="text-amber-600">غير مرتبط</span>}</TableCell>
              <TableCell>{row.verify_type ?? "—"} / {row.status ?? "—"}</TableCell>
              <TableCell>{row.external_log_id ?? "—"}</TableCell>
              <TableCell><Badge variant={row.processing_status === "inserted" ? "default" : row.processing_status === "unmatched" || row.processing_status === "error" ? "destructive" : "secondary"}>{statusLabel(row.processing_status)}</Badge></TableCell>
              <TableCell className="max-w-64 whitespace-normal break-words text-xs text-muted-foreground">{row.error_message ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{row.sync_batch_id.slice(0, 8)}</TableCell>
            </TableRow>)}
              {!rows.length && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">{query.isLoading ? "جارٍ تحميل السجلات…" : query.error ? "تعذر جلب السجلات؛ راجع صلاحية الحساب وترحيل قاعدة البيانات." : query.data?.count === 0 && status === "all" && deviceId === "all" && !search && !externalId && !verifyType && !deviceStatus && !dateFrom && !dateTo ? "لا توجد تفاصيل مسجلة بعد. انتقل إلى تبويب الأجهزة والمزامنة واضغط «سحب الآن» لتسجيل تفاصيل الحركات الجديدة." : "لا توجد حركات مطابقة للفلاتر الحالية؛ امسح الفلاتر لعرض جميع السجلات."}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between text-sm"><span>عدد النتائج: {(query.data?.count ?? 0).toLocaleString("ar-IQ")}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>السابق</Button><span>صفحة {(page + 1).toLocaleString("ar-IQ")} من {totalPages.toLocaleString("ar-IQ")}</span><Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي</Button></div></div>
      </>}
    </CardContent>
  </Card>;
}

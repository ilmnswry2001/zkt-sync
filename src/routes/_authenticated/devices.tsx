import { direction, displayLocale, ui } from "@/lib/ui-language";
import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createZktecoSyncKey, getZktecoSyncStatus, requestZktecoSync, revokeZktecoSyncKey, reprocessZktecoSyncRecords } from "@/lib/zkteco-sync.functions";
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
import { MetricCard } from "@/components/MetricCard";
import { AssignDevicePinDialog } from "@/components/AssignDevicePinDialog";
import { Trash2, Plus, Pencil, KeyRound, Copy, Download, RefreshCw, Ban, Smartphone } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import agentScript from "../../../scripts/agent.py?raw";
import agentRequirements from "../../../scripts/requirements.txt?raw";
import agentInstaller from "../../../scripts/install_agent_background.ps1?raw";
import multiAgentTemplate from "../../../scripts/multi_agent_bundle.py?raw";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({ meta: [{ title: ui("الأجهزة وسجلات التحقق | إدارة الحضور") }, { name: "description", content: "إدارة أجهزة البصمة وتدقيق الحركات المكررة والمعرفات غير المرتبطة." }, { property: "og:title", content: "الأجهزة وسجلات التحقق | إدارة الحضور" }, { property: "og:description", content: "متابعة نتائج مطابقة حركات الأجهزة وملفات البصمة." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: DevicesPage,
});

type Device = { id: string; name: string; serial_number: string | null; ip_address: string | null; location: string | null; description: string | null; status: string; last_sync_at: string | null; auto_last_sync_at: string | null };
type SyncStatus = { device_id: string; auto_last_sync_at: string | null; auto_synced_logs_total: number; has_active_key: boolean; key_prefix: string | null; batches: { id: string; received_at: string; record_count: number; inserted_count: number; duplicate_count: number; unmatched_count: number; error_count: number; error_details: { message?: string }[] }[]; commands: { id: string; requested_at: string; started_at: string | null; completed_at: string | null; status: "pending" | "running" | "succeeded" | "failed"; result: { inserted?: number; duplicates?: number; unmatched?: number }; error_message: string | null }[] };

function DevicesPage() {
  const qc = useQueryClient();
  const { isAdmin, isHR, roles } = useAuth();
  const [createdKey, setCreatedKey] = useState<{ deviceId: string; key: string; serial: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Device | null>(null);

  const { data: devices = [], isPending: devicesLoading, isError: devicesError } = useQuery({
    queryKey: ["devices"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("devices").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Device[];
    },
  });

  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (devices.some(device => target === `device-${device.id}`)) {
      document.getElementById(target)?.scrollIntoView({ block: "center" });
    }
  }, [devices]);
  const { data: syncStatuses = [], error: syncStatusError } = useQuery({
    queryKey: ["zkteco-sync-status"],
    queryFn: () => getZktecoSyncStatus(),
    enabled: isAdmin,
    refetchInterval: 5_000,
  });
  const syncByDevice = new Map((syncStatuses as SyncStatus[]).map((status) => [status.device_id, status]));
  const now = Date.now();
  const lastContact = (device: Device) => Math.max(
    Date.parse(device.auto_last_sync_at ?? "") || 0,
    Date.parse(device.last_sync_at ?? "") || 0,
    Date.parse(syncByDevice.get(device.id)?.auto_last_sync_at ?? "") || 0,
  );
  const isConnected = (device: Device) => now - lastContact(device) <= 15 * 60_000;
  const onlineCount = devices.filter(isConnected).length;

  const createKey = useMutation({
    mutationFn: (deviceId: string) => createZktecoSyncKey({ data: { device_id: deviceId } }),
    onSuccess: (result, deviceId) => {
      setCreatedKey({ deviceId, key: result.key, serial: result.device_sn });
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      toast.success(ui("تم إنشاء المفتاح. انسخه الآن أو نزّل إعداد الوكيل؛ لن يظهر المفتاح مرة أخرى."));
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });
  const revokeKey = useMutation({
    mutationFn: (deviceId: string) => revokeZktecoSyncKey({ data: { device_id: deviceId } }),
    onSuccess: () => { setCreatedKey(null); qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] }); toast.success(ui("تم إلغاء مفتاح الجهاز")); },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });
  const syncNow = useMutation({
    mutationFn: (deviceId: string) => requestZktecoSync({ data: { device_id: deviceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      toast.success(ui("أرسلنا طلب السحب إلى الوكيل. ستظهر النتيجة هنا عند اكتماله."));
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });

  const encodeBase64 = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };

  const downloadMultiDeviceAgent = (agents: { id: string; name: string; ip_address: string; serial: string; device_key: string }[]) => {
    const syncOrigin = window.location.hostname.startsWith("id-preview--")
      ? "https://zkt-sync.lovable.app"
      : window.location.origin;
    const configs = agents.map((device) => ({
      ...device,
      device_ip: device.ip_address,
      sync_url: `${syncOrigin}/api/public/zk-sync`,
      device_port: 4370,
      device_password: 0,
    }));
    const source = multiAgentTemplate
      .replace("__DEVICE_CONFIGS_B64__", encodeBase64(JSON.stringify(configs)))
      .replace("__AGENT_SOURCE_B64__", encodeBase64(agentScript));
    downloadTextFile("zkteco_multi_agent.py", source, "text/x-python;charset=utf-8");
  };

  const downloadAllAgents = useMutation({
    mutationFn: async () => {
      const eligible = devices.filter((device) => device.status === "active" && device.serial_number && device.ip_address);
      if (!eligible.length) throw new Error("لا توجد أجهزة نشطة مكتملة الاسم التسلسلي وعنوان IP");
      const agents: { id: string; name: string; ip_address: string; serial: string; device_key: string }[] = [];
      const failed: string[] = [];
      for (const device of eligible) {
        try {
          const result = await createZktecoSyncKey({ data: { device_id: device.id } });
          agents.push({ id: device.id, name: device.name, ip_address: device.ip_address!, serial: result.device_sn, device_key: result.key });
        } catch {
          failed.push(device.name);
        }
      }
      if (!agents.length) throw new Error("تعذر إنشاء مفاتيح ربط الأجهزة");
      return { agents, failed, excluded: devices.length - eligible.length };
    },
    onSuccess: ({ agents, failed, excluded }) => {
      downloadMultiDeviceAgent(agents);
      setCreatedKey(null);
      qc.invalidateQueries({ queryKey: ["zkteco-sync-status"] });
      const skipped = failed.length + excluded;
      toast.success((ui("تم تنزيل الوكيل لـ ") + (agents.length) + ui(" جهاز") + (skipped ? `؛ تم تجاوز ${skipped} جهاز` : "")));
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });

  const copySyncKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      toast.success(ui("تم نسخ مفتاح الربط"));
    } catch {
      toast.error(ui("تعذر النسخ؛ انسخ المفتاح من الحقل الظاهر"));
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices"] }); setOpen(false); setEditing(null); toast.success(ui("تم الحفظ")); },
    onError: (e: any) => toast.error(ui(formatErrorMessage(e))),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("devices").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["devices"] }); toast.success(ui("تم الحذف")); },
    onError: (e: any) => toast.error(ui(formatErrorMessage(e))),
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
    <Tabs defaultValue="devices" dir={direction()} className="space-y-5">
      {(isHR || roles.some((role) => role === "supervisor" || role === "site_admin")) && (
        <Button asChild variant="outline"><Link to="/mobile-sync"><Smartphone className="size-4" />{ui(" سحب البصمة بالهاتف")}</Link></Button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard title={ui("الأجهزة المتصلة")} value={devicesError ? "—" : onlineCount} loading={devicesLoading} tone="success" detail="آخر مزامنة خلال 15 دقيقة" />
        <MetricCard title={ui("الأجهزة غير المتصلة")} value={devicesError ? "—" : devices.length - onlineCount} loading={devicesLoading} tone="warning" detail="تشمل الأجهزة التي لم تزامن بعد" />
      </div>
      <TabsList className="h-auto flex-wrap bg-transparent p-0">
        <TabsTrigger value="devices" className="min-h-10 rounded-xl border bg-card">{ui("الأجهزة والمزامنة")}</TabsTrigger>
        <TabsTrigger value="verification" className="min-h-10 rounded-xl border bg-card">{ui("سجلات التحقق")}</TabsTrigger>
      </TabsList>
      <TabsContent value="devices" className="mt-0">
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{ui("الأجهزة")}</h1>
          <p className="text-muted-foreground mt-1">{ui("إدارة أجهزة البصمة ZKTeco")}</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button onClick={() => setEditing(null)}><Plus className="w-4 h-4 ml-2" />{ui(" إضافة جهاز")}</Button></DialogTrigger>
          <DialogContent dir={direction()}>
            <DialogHeader><DialogTitle>{editing ? ui("تعديل الجهاز") : ui("جهاز جديد")}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div><Label>{ui("اسم الجهاز")}</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div><Label>{ui("الرقم التسلسلي")}</Label><Input name="serial_number" defaultValue={editing?.serial_number ?? ""} /></div>
              <div><Label>{ui("عنوان IP")}</Label><Input name="ip_address" defaultValue={editing?.ip_address ?? ""} /></div>
              <div><Label>{ui("الموقع")}</Label><Input name="location" defaultValue={editing?.location ?? ""} /></div>
              <div><Label>{ui("الوصف")}</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
              <div>
                <Label>{ui("الحالة")}</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{ui("نشط")}</SelectItem>
                    <SelectItem value="inactive">{ui("معطل")}</SelectItem>
                    <SelectItem value="maintenance">{ui("صيانة")}</SelectItem>
                  </SelectContent>
                </Select>
                <input type="hidden" name="status_hidden" />
              </div>
              <Button type="submit" className="w-full" disabled={save.isPending}>{ui("حفظ")}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />{ui(" المزامنة السحابية التلقائية")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{ui("ضع ملفات الوكيل والإعدادات في مجلد ثابت على حاسوب متصل بشبكة جهاز البصمة والإنترنت، ثم شغّل مثبت الخلفية مرة واحدة. بعد تشغيل الوكيل، استخدم «سحب الآن» بجانب الجهاز لطلب قراءة السجلات دون أوامر يدوية.")}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {isAdmin && <Button type="button" variant="outline" disabled={downloadAllAgents.isPending || createKey.isPending || !devices.some((device) => device.status === "active" && device.serial_number && device.ip_address)} onClick={() => {
              if (confirm(ui("سيتم تدوير مفاتيح ربط الأجهزة النشطة المكتملة، وستتوقف ملفات الوكلاء القديمة عن العمل. سيحتوي الملف المنزّل على المفاتيح الجديدة؛ احتفظ به سرياً. متابعة؟"))) downloadAllAgents.mutate();
            }}>
              <Download className="ml-2 h-4 w-4" /> {downloadAllAgents.isPending ? ui("جارٍ تجهيز الوكيل…") : ui("تنزيل وكيل جميع الأجهزة")}
            </Button>}
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("agent.py", agentScript, "text/x-python;charset=utf-8")}>
              <Download className="h-4 w-4" />{ui(" تنزيل وكيل المزامنة")}</button>
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("requirements.txt", agentRequirements, "text/plain;charset=utf-8")}>
              <Download className="h-4 w-4" />{ui(" تنزيل متطلبات Python")}</button>
            <button type="button" className="inline-flex items-center gap-2 font-semibold text-primary underline" onClick={() => downloadTextFile("install_agent_background.ps1", agentInstaller, "text/plain;charset=utf-8")}>
              <Download className="h-4 w-4" />{ui(" تنزيل مثبت التشغيل التلقائي")}</button>
          </div>
          <p className="text-muted-foreground">{ui("وكيل جميع الأجهزة ملف واحد يتضمن إعدادات الربط. شغّله على حاسوب الشبكة؛ سيبدأ بالأجهزة المتاحة ويتجاوز غير المتاح مع إعادة المحاولة تلقائياً. بعد ذلك استخدم زر «سحب الآن» بجانب الجهاز من هذه الصفحة.")}</p>
          {syncStatusError && isAdmin && <p role="alert" className="text-destructive">{ui("تعذر تحميل حالة المزامنة. تحقق من تطبيق migration الخاصة بالمزامنة.")}</p>}
          {createdKey && (
            <div className="space-y-2 rounded-lg border bg-background p-3">
              <p className="font-semibold">{ui("مفتاح جديد للجهاز ")}{createdKey.serial}{ui(" — يظهر مرة واحدة فقط:")}</p>
              <div className="flex flex-wrap gap-2">
                <Input readOnly value={createdKey.key} className="min-w-[18rem] flex-1 font-mono" aria-label={ui("مفتاح مزامنة الجهاز")} />
                <Button type="button" variant="outline" onClick={copySyncKey}><Copy className="ml-2 h-4 w-4" />{ui(" نسخ المفتاح")}</Button>
                {devices.find((device) => device.id === createdKey.deviceId) && (
                  <Button type="button" variant="outline" onClick={() => downloadAgentConfig(devices.find((device) => device.id === createdKey.deviceId)!)}><Download className="ml-2 h-4 w-4" />{ui(" تنزيل الإعدادات")}</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{ui("قائمة الأجهزة (")}{devices.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ui("الاسم")}</TableHead>
                <TableHead>{ui("الرقم التسلسلي")}</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>{ui("الموقع")}</TableHead>
                <TableHead>{ui("الحالة")}</TableHead>
                <TableHead>{ui("آخر مزامنة")}</TableHead>
                <TableHead>{ui("الربط التلقائي")}</TableHead>
                <TableHead>{ui("الحركات المرفوعة")}</TableHead>
                <TableHead>{ui("إعداد الوكيل")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id} id={`device-${d.id}`} className="target:bg-accent">
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
                          <RefreshCw className={`ml-2 h-4 w-4 ${active ? "animate-spin" : ""}`} /> {active ? ui("الوكيل ينفذ الطلب") : ui("سحب الآن")}
                        </Button>}
                        {command && <span className="text-xs text-muted-foreground">
                          {command.status === "pending" ? pendingExpired ? ui("لم يتصل الوكيل؛ شغّله وأعد الطلب") : ui("بانتظار اتصال الوكيل") : command.status === "running" ? runningExpired ? ui("تجاوز الطلب المهلة؛ يمكنك إعادة المحاولة") : ui("جارٍ سحب السجلات") : command.status === "succeeded" ? (ui("اكتمل: ") + (command.result?.inserted ?? 0) + ui(" جديد، ") + (command.result?.duplicates ?? 0) + ui(" مكرر")) : command.error_message ?? ui("فشل السحب")}
                        </span>}
                      </div>;
                    })()}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{d.serial_number ?? "-"}</TableCell>
                  <TableCell>{d.ip_address ?? "-"}</TableCell>
                  <TableCell>{d.location ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={d.status === "active" ? "default" : "secondary"}>
                      {d.status === "active" ? ui("نشط") : d.status === "maintenance" ? ui("صيانة") : ui("معطل")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.last_sync_at ? new Date(d.last_sync_at).toLocaleString("ar") : "—"}</TableCell>
                  {(() => {
                    const sync = syncByDevice.get(d.id);
                    const connected = isConnected(d);
                    return <TableCell><Badge variant={connected ? "default" : "destructive"}>{connected ? ui("متصل") : !sync ? ui("غير متصل") : sync.has_active_key ? ui("متوقف") : ui("غير مربوط")}</Badge>{lastContact(d) > 0 && <div className="mt-1 text-xs text-muted-foreground">{new Date(lastContact(d)).toLocaleString("ar")}</div>}</TableCell>;
                  })()}
                  <TableCell>{(syncByDevice.get(d.id)?.auto_synced_logs_total ?? 0).toLocaleString(displayLocale())}</TableCell>
                  <TableCell>
                    {isAdmin && <div className="flex min-w-40 flex-col gap-1">
                      <Button size="sm" variant="outline" disabled={!d.serial_number || createKey.isPending || downloadAllAgents.isPending} onClick={() => createKey.mutate(d.id)}>
                        <KeyRound className="ml-2 h-4 w-4" /> {syncByDevice.get(d.id)?.has_active_key ? ui("تدوير المفتاح") : ui("إنشاء مفتاح")}
                      </Button>
                      {createdKey?.deviceId === d.id && <Button size="sm" variant="ghost" onClick={() => downloadAgentConfig(d)}><Download className="ml-2 h-4 w-4" />{ui(" تنزيل agent_config.ini")}</Button>}
                      {syncByDevice.get(d.id)?.has_active_key && createdKey?.deviceId !== d.id && <span className="text-xs text-muted-foreground">{ui("مفتاح فعّال محفوظ كـ ")}{syncByDevice.get(d.id)?.key_prefix}…</span>}
                      {syncByDevice.get(d.id)?.has_active_key && <Button size="sm" variant="ghost" disabled={revokeKey.isPending} onClick={() => revokeKey.mutate(d.id)}><Ban className="ml-2 h-4 w-4" />{ui(" إلغاء المفتاح")}</Button>}
                    </div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm(ui("حذف الجهاز؟"))) del.mutate(d.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!devices.length && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">{ui("لا توجد أجهزة بعد")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{ui("آخر دفعات المزامنة")}</CardTitle></CardHeader>
        <CardContent><Table><TableHeader><TableRow><TableHead>{ui("الجهاز")}</TableHead><TableHead>{ui("الوقت")}</TableHead><TableHead>{ui("الواردة")}</TableHead><TableHead>{ui("أُدرجت")}</TableHead><TableHead>{ui("مكررة")}</TableHead><TableHead>{ui("غير مطابقة")}</TableHead><TableHead>{ui("أخطاء")}</TableHead></TableRow></TableHeader>
          <TableBody>{(syncStatuses as SyncStatus[]).flatMap((sync) => sync.batches.map((batch) => <TableRow key={batch.id}><TableCell>{devices.find((device) => device.id === sync.device_id)?.name ?? "—"}</TableCell><TableCell>{new Date(batch.received_at).toLocaleString(displayLocale())}</TableCell><TableCell>{batch.record_count}</TableCell><TableCell>{batch.inserted_count}</TableCell><TableCell>{batch.duplicate_count}</TableCell><TableCell>{batch.unmatched_count}</TableCell><TableCell>
            <span>{batch.error_count}</span>
            {!!batch.error_details?.length && <details className="mt-1 min-w-48 text-xs">
              <summary className="cursor-pointer text-primary underline">{ui("عرض سبب الخطأ")}</summary>
              <div dir="auto" className="mt-1 max-w-sm whitespace-normal break-words rounded border bg-background p-2 text-destructive">
                {batch.error_details.map((detail, index) => <p key={index}>{detail.message ?? ui("خطأ غير محدد")}</p>)}
              </div>
            </details>}
          </TableCell></TableRow>))}{!(syncStatuses as SyncStatus[]).some((sync) => sync.batches.length) && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{ui("لا توجد دفعات بعد")}</TableCell></TableRow>}</TableBody>
        </Table></CardContent>
      </Card>
    </div>
      </TabsContent>
      <TabsContent value="verification" className="mt-0">
        <DeviceSyncRecords devices={devices} canView={isAdmin || isHR} canDelete={isAdmin} />
      </TabsContent>
    </Tabs>
  );
}

type SyncRecordStatus = "all" | "inserted" | "duplicate" | "unmatched" | "unprocessed" | "pending" | "error";
const verificationFields = "id, device_id, user_pin, employee_no, employee_id, verify_time, verify_type, status, external_log_id, processing_status, error_message, sync_batch_id, employee:employees(full_name), device:devices(name), batch:sync_batches(received_at), upload:uploaded_files(file_name)";
function DeviceSyncRecords({ devices, canView, canDelete }: { devices: Device[]; canView: boolean; canDelete: boolean }) {
  const [assignment, setAssignment] = useState<{ id: string; pin: string } | null>(null);
  const qc = useQueryClient();
  const [status, setStatus] = useState<SyncRecordStatus>("all");
  const [deviceId, setDeviceId] = useState("all");
  const [search, setSearch] = useState("");
  const [externalId, setExternalId] = useState("");
  const [pair,setPair] = useState("");
  const [extra,setExtra] = useState({employee:"", file:"", batch:"", error:"", receivedFrom:"", receivedUntil:""});
  const normalized = pair.replace(/[٠-٩۰-۹]/g,c => String(c.charCodeAt(0)%16));
  const parts = normalized.split("/").map(value => value.trim());
  const [verifyType="", deviceStatus=""] = parts;
  const validPair = parts.length <= 2 && parts.every(value => !value || value === "—" || (/^-?\d+$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  function boundary(value: string, end = false) {
    if (!value) return undefined;
    return new Date(new Date(`${value}T00:00:00+03:00`).getTime() + (end ? 86400000 : 0)).toISOString();
  }
  const filters = {
    verify: verifyType === "—" ? null : verifyType || undefined,
    status: deviceStatus === "—" ? null : deviceStatus || undefined,
    processing: status === "all" ? undefined : status, device: deviceId === "all" ? undefined : deviceId,
    search: search.trim().replaceAll("*", "%") || undefined, external: externalId || undefined,
    from: boundary(dateFrom), until: boundary(dateTo,true),
    employee: extra.employee.trim().replaceAll("*", "%") || undefined, file: extra.file.trim().replaceAll("*", "%") || undefined,
    error: extra.error.trim().replaceAll("*", "%") || undefined, batch: extra.batch.trim() || undefined,
    receivedFrom: boundary(extra.receivedFrom), receivedUntil: boundary(extra.receivedUntil,true),
  };
  const archive = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("archive_filtered_verification_records", { f: filters });
      if (error) throw error;
      return data;
    },
    onSuccess: (count) => {
      setPage(0);
      qc.invalidateQueries({ queryKey: ["device-sync-records"] });
      toast.success((ui("تم حذف ") + (count) + ui(" حركة من سجل التحقق")));
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });
  const reprocess = useMutation({
    mutationFn: () => reprocessZktecoSyncRecords({ data: deviceId === "all" ? {} : { device_id: deviceId } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["device-sync-records"] });
      toast.success((ui("اكتملت إعادة المعالجة: ") + (result.inserted) + ui(" مسجلة، ") + (result.duplicates) + ui(" مكررة، ") + (result.unmatched) + ui(" غير مطابقة")));
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error))),
  });
  const batchPrefix = filters.batch?.toLowerCase();
  const uuidLayout = "00000000-0000-0000-0000-000000000000";
  const invalidBatch = !!batchPrefix && (batchPrefix.length > uuidLayout.length || [...batchPrefix].some((c, i) =>
    uuidLayout[i] === "-" ? c !== "-" : !/[0-9a-f]/.test(c)));
  const needsBatch = !!(filters.receivedFrom || filters.receivedUntil);

  const buildRequest = (countOnly: boolean) => {
    const related = [
      filters.employee && "employee:employees!inner(id)",
      filters.file && "upload:uploaded_files!inner(id)",
      needsBatch && "batch:sync_batches(id)",
    ].filter(Boolean);
    let fields = countOnly ? ["id", ...related].join(",") : verificationFields;
    if (!countOnly) {
      if (filters.employee) fields = fields.replace("employee:employees(", "employee:employees!inner(");
      if (filters.file) fields = fields.replace("upload:uploaded_files(", "upload:uploaded_files!inner(");
    }
    let request = supabase.from("device_sync_records")
      .select(fields, countOnly ? { count: "exact", head: true } : undefined).is("archived_at", null);
    if (filters.verify === null) request = request.is("verify_type", null);
    else if (filters.verify !== undefined) request = request.eq("verify_type", Number(filters.verify));
    if (filters.status === null) request = request.is("status", null);
    else if (filters.status !== undefined) request = request.eq("status", Number(filters.status));
    if (filters.device) request = request.eq("device_id", filters.device);
    if (filters.processing === "unprocessed") request = request.in("processing_status", ["pending", "error", "unmatched"]);
    else if (filters.processing) request = request.eq("processing_status", filters.processing);
    if (filters.external) request = request.eq("external_log_id", Number(filters.external));
    if (filters.search) {
      const pattern = JSON.stringify(`%${filters.search}%`);
      request = request.or(`user_pin.ilike.${pattern},employee_no.ilike.${pattern}`);
    }
    if (filters.from) request = request.gte("verify_time", filters.from);
    if (filters.until) request = request.lt("verify_time", filters.until);
    if (filters.error) request = request.ilike("error_message", `%${filters.error}%`);
    if (filters.employee) request = request.ilike("employee.full_name", `%${filters.employee}%`);
    if (filters.file) request = request.ilike("upload.file_name", `%${filters.file}%`);
    if (filters.receivedFrom) request = request.gte("batch.received_at", filters.receivedFrom);
    if (filters.receivedUntil) request = request.lt("batch.received_at", filters.receivedUntil);
    if (needsBatch) request = request.not("batch", "is", null);
    if (batchPrefix) {
      const suffix = uuidLayout.slice(batchPrefix.length);
      request = request.gte("sync_batch_id", batchPrefix + suffix)
        .lte("sync_batch_id", batchPrefix + suffix.replaceAll("0", "f"));
    }
    return request;
  };
  const query = useQuery({
    queryKey: ["device-sync-records", "page", filters, page],
    enabled: canView && validPair,
    refetchInterval: 15_000,
    queryFn: async ({ signal }) => {
      if (invalidBatch) return [];
      const { data, error } = await buildRequest(false).order("verify_time", { ascending: false })
        .order("id", { ascending: false }).range(page * pageSize, (page + 1) * pageSize)
        .abortSignal(signal);
      if (error) throw error;
      return data ?? [];
    },
  });
  const countQuery = useQuery({
    queryKey: ["device-sync-records", "count", filters],
    enabled: canView && validPair,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (invalidBatch) return 0;
      const { count, error } = await buildRequest(true).abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const rows = (query.data ?? []).slice(0, pageSize);
  const count = countQuery.data;
  const totalPages = count === undefined ? undefined : Math.max(1, Math.ceil(count / pageSize));
  const hasNextPage = (query.data?.length ?? 0) > pageSize;
  const resetFilters = () => { setStatus("all"); setDeviceId("all"); setSearch(""); setExternalId(""); setPair(""); setExtra({employee:"", file:"", batch:"", error:"", receivedFrom:"", receivedUntil:""}); setDateFrom(""); setDateTo(""); setPage(0); };
  const statusLabel = (value: string) => ({ inserted: "مسجلة", duplicate: "مكررة", unmatched: "رقم غير معرف", pending: "قيد المعالجة", error: "خطأ" }[value] ?? value);
  const exportMovements = useMutation({
    mutationFn: async () => {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      workbook.Workbook = { Views: [{ RTL: true }] };
      const headings = ["وقت الحركة (بغداد)", "وقت الرفع (بغداد)", "الجهاز", "الملف", "معرف الجهاز", "الموظف المطابق", "الرقم الوظيفي", "التحقق", "الحالة", "معرف الحركة", "حالة المعالجة", "الخطأ", "معرف الدفعة"];
      const dateFormat = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Baghdad" });
      let cursor: string | undefined;
      let count = 0;
      let sheet = XLSX.utils.aoa_to_sheet([headings]);
      const sheetCapacity = 1048575;
      for (;;) {
        let request = supabase.from("device_sync_records").select(verificationFields)
          .is("archived_at", null).order("id").limit(Math.min(1000, sheetCapacity - count % sheetCapacity));
        if (cursor) request = request.gt("id", cursor);
        const { data, error } = await request;
        if (error) throw error;
        if (!data?.length) break;
        if (count % sheetCapacity === 0) {
          sheet = XLSX.utils.aoa_to_sheet([headings]);
          sheet["!cols"] = headings.map((_, index) => ({ wch: index === 12 ? 38 : 23 }));
          XLSX.utils.book_append_sheet(workbook, sheet, `الحركات ${workbook.SheetNames.length + 1}`);
        }
        XLSX.utils.sheet_add_aoa(sheet, data.map((row: any) => [
          dateFormat.format(new Date(row.verify_time)), row.batch?.received_at ? dateFormat.format(new Date(row.batch.received_at)) : "",
          row.device?.name, row.upload?.file_name, row.user_pin, row.employee?.full_name, row.employee_no,
          row.verify_type, row.status, row.external_log_id, statusLabel(row.processing_status), row.error_message, row.sync_batch_id,
        ]), { origin: -1 });
        count += data.length;
        cursor = data[data.length - 1].id;
      }
      if (!count) return toast.info(ui("لا توجد حركات للتصدير"));
      XLSX.writeFile(workbook, "سجلات-التحقق.xlsx");
      toast.success(`تم تصدير ${count.toLocaleString(displayLocale())} حركة`);
    },
    onError: (error: Error) => toast.error(ui(formatErrorMessage(error, "تعذر تصدير الحركات"))),
  });

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-4">
      <div className="space-y-1"><CardTitle>{ui("سجلات التحقق من حركات الأجهزة والملفات")}</CardTitle></div>
      {canView && <Button variant="outline" disabled={exportMovements.isPending} onClick={() => exportMovements.mutate()}>
        <Download className="ml-2 h-4 w-4" />{exportMovements.isPending ? ui("جارٍ تصدير الحركات…") : ui("تصدير جميع الحركات إلى Excel")}
      </Button>}
      {canView && <Button type="button" variant="outline" disabled={reprocess.isPending} onClick={() => {
        if (confirm(ui("ستعاد مطابقة الحركات غير المعالجة والأخطاء والأرقام غير المعرفة باستخدام أرقام أجهزة البصمة والرقم الوظيفي الحالية. سيتم تجاهل الحركات المكررة. متابعة؟"))) reprocess.mutate();
      }}>
        <RefreshCw className={`ml-2 h-4 w-4 ${reprocess.isPending ? "animate-spin" : ""}`} /> {reprocess.isPending ? ui("جارٍ إعادة المعالجة…") : ui("إعادة معالجة الحركات")}
      </Button>}
    </CardHeader>
    <CardContent className="space-y-4">
      {!canView ? <p className="text-sm text-muted-foreground">{ui("هذا السجل متاح لمدير النظام والموارد البشرية فقط.")}</p> : <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder={ui("رقم الجهاز أو الرقم الوظيفي")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
          <Input aria-label={ui("معرف الحركة في الجهاز")} placeholder={ui("معرف الحركة بالجهاز")} inputMode="numeric" value={externalId} onChange={(event) => { setExternalId(event.target.value.replace(/\D/g, "")); setPage(0); }} />
          <Select value={deviceId} onValueChange={(value) => { setDeviceId(value); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder={ui("كل الأجهزة")} /></SelectTrigger><SelectContent><SelectItem value="all">{ui("كل الأجهزة")}</SelectItem>{devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => { setStatus(value as SyncRecordStatus); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder={ui("كل الحالات")} /></SelectTrigger><SelectContent>
              <SelectItem value="all">{ui("كل الحالات")}</SelectItem><SelectItem value="inserted">{ui("تم تسجيلها")}</SelectItem><SelectItem value="duplicate">{ui("مكررة")}</SelectItem>
              <SelectItem value="unmatched">{ui("رقم غير معرف بالنظام")}</SelectItem><SelectItem value="unprocessed">{ui("لم تعالج أو بها خطأ")}</SelectItem>
              <SelectItem value="pending">{ui("قيد المعالجة")}</SelectItem><SelectItem value="error">{ui("خطأ")}</SelectItem>
            </SelectContent>
          </Select>
          <label className="space-y-1">{ui("التحقق / الحالة")}<Input dir="ltr" placeholder="1 / 0" value={pair} onChange={event => {setPair(event.target.value); setPage(0);}} />
            <span className="text-xs text-muted-foreground">{ui("اكتب القيمة أو اضغط عليها في الجدول. للحالة وحدها أدخل ")}<bdi>/ 0</bdi>.</span>
            {!validPair && <span role="alert" className="block text-xs text-destructive">{ui("أدخل رقماً أو شرطة (—) لكل جزء.")}</span>}
          </label>
          {([["employee","اسم الموظف المطابق"],["file","اسم الملف"],["batch","بداية معرف الدفعة"],["error","نص الخطأ"],["receivedFrom","وقت الرفع من"],["receivedUntil","وقت الرفع إلى"]] as const).map(([key,label]) =>
            <label key={key}>{ui(label)}<Input type={key.startsWith("received") ? "date" : "text"} value={extra[key]} onChange={event => {setExtra({...extra,[key]:event.target.value}); setPage(0);}} /></label>)}
          <label>{ui("وقت الحركة من")}<Input type="date" value={dateFrom} onChange={event => {setDateFrom(event.target.value);setPage(0);}} /></label>
          <div className="flex gap-2"><label>{ui("وقت الحركة إلى")}<Input aria-label={ui("إلى تاريخ الحركة")} type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(0); }} /></label><Button variant="outline" onClick={resetFilters}>{ui("مسح")}</Button></div>
        </div>
        {query.error && <p role="alert" className="text-sm text-destructive">{ui("تعذر تحميل السجلات. تحقق من تطبيق ترحيل سجلات التحقق.")}</p>}
        {canDelete && <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive" disabled={!validPair || (!verifyType && !deviceStatus) || !count || query.isError || archive.isPending || reprocess.isPending}
            onClick={() => {
              if (confirm((ui("حذف الحركات المطابقة من سجل التحقق في جميع الصفحات؟\nنوع التحقق: ") + (verifyType || "الكل") + ui(" · حالة الجهاز: ") + (deviceStatus || "الكل") + ui("\nعدد النتائج: ") + (count) + ui(" حسب الفلاتر الحالية. ستُحفظ نسخة للتدقيق ولن تتغير سجلات الحضور.")))) archive.mutate();
            }}><Trash2 className="ml-2 h-4 w-4" />{archive.isPending ? ui("جارٍ الحذف…") : ui("حذف الحركات المطابقة")}</Button>
          {!verifyType && !deviceStatus && <span className="text-sm text-muted-foreground">{ui("حدد نوع التحقق أو حالة الحركة بالجهاز لتفعيل الحذف.")}</span>}
        </div>}
        <div className="overflow-x-auto rounded-md border">
          <Table><TableHeader><TableRow><TableHead>{ui("وقت الحركة")}</TableHead><TableHead>{ui("وقت الرفع")}</TableHead><TableHead>{ui("الجهاز")}</TableHead><TableHead>{ui("معرف الجهاز")}</TableHead><TableHead>{ui("الموظف المطابق")}</TableHead><TableHead>{ui("التحقق / الحالة")}</TableHead><TableHead>{ui("معرف الحركة")}</TableHead><TableHead>{ui("حالة المعالجة")}</TableHead><TableHead>{ui("الخطأ")}</TableHead><TableHead>{ui("معرف الدفعة")}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row: any) => <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">{new Date(row.verify_time).toLocaleString(displayLocale())}</TableCell>
              <TableCell className="whitespace-nowrap">{row.batch?.received_at ? new Date(row.batch.received_at).toLocaleString(displayLocale()) : "—"}</TableCell>
              <TableCell>{row.device?.name ?? devices.find((device) => device.id === row.device_id)?.name ?? "—"}{row.upload?.file_name && <div className="text-xs text-muted-foreground break-all">{row.upload.file_name}</div>}</TableCell>
              <TableCell className="font-mono">{row.user_pin}</TableCell>
              <TableCell>{row.employee_id ? <div>{row.employee?.full_name ?? ui("موظف مرتبط")}<div className="text-xs text-muted-foreground">{row.employee_no ?? ""}</div></div> : <span className="text-warning">{ui("غير مرتبط")}</span>}</TableCell>
              <TableCell><button type="button" dir="ltr" className="text-primary underline" title={ui("تصفية بهذه القيمة")} onClick={() => {setPair(`${row.verify_type ?? "—"} / ${row.status ?? "—"}`); setPage(0);}}>{row.verify_type ?? "—"} / {row.status ?? "—"}</button></TableCell>
              <TableCell>{row.external_log_id ?? "—"}</TableCell>
              <TableCell><Badge variant={row.processing_status === "inserted" ? "default" : row.processing_status === "unmatched" || row.processing_status === "error" ? "destructive" : "secondary"}>{ui(statusLabel(row.processing_status))}</Badge>
                {row.processing_status === "unmatched" && row.user_pin?.trim() && row.user_pin.trim() !== "0" && <Button size="sm" variant="outline" className="mt-1 block" onClick={() => setAssignment({id:row.id,pin:row.user_pin.trim()})}>{ui("تنسيب لموظف")}</Button>}
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal break-words text-xs text-muted-foreground">{row.error_message ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{row.sync_batch_id?.slice(0, 8) ?? "—"}</TableCell>
            </TableRow>)}
              {!rows.length && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">{query.isLoading ? ui("جارٍ تحميل السجلات…") : query.error ? ui("تعذر جلب السجلات؛ راجع صلاحية الحساب وترحيل قاعدة البيانات.") : count === 0 && status === "all" && deviceId === "all" && !search && !externalId && !verifyType && !deviceStatus && !dateFrom && !dateTo ? ui("لا توجد تفاصيل مسجلة بعد. انتقل إلى تبويب الأجهزة والمزامنة واضغط «سحب الآن» لتسجيل تفاصيل الحركات الجديدة.") : ui("لا توجد حركات مطابقة للفلاتر الحالية؛ امسح الفلاتر لعرض جميع السجلات.")}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between text-sm"><span>{count === undefined
          ? countQuery.isError ? ui("تعذر حساب عدد النتائج") : ui("جارٍ حساب عدد النتائج…")
          : `عدد النتائج: ${count.toLocaleString(displayLocale())}`}</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 0} onClick={() => setPage((value) => value - 1)}>{ui("السابق")}</Button><span>{ui("صفحة ")}{(page + 1).toLocaleString(displayLocale())}{totalPages === undefined ? "" : ` من ${totalPages.toLocaleString(displayLocale())}`}</span><Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage((value) => value + 1)}>{ui("التالي")}</Button></div></div>
      </>}
    </CardContent>
    {assignment && canView && <AssignDevicePinDialog record={assignment} close={() => setAssignment(null)} />}
  </Card>;
}

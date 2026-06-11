import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { parseZkBackup } from "@/lib/zk-parser";
import { ingestZkData } from "@/lib/attendance.functions";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, FileCheck2, AlertCircle, Database } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "رفع ملفات البصمة" }] }),
  component: UploadPage,
});

function UploadPage() {
  const { user } = useAuth();
  const ingest = useServerFn(ingestZkData);
  const [file, setFile] = useState<File | null>(null);
  const [deviceId, setDeviceId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const [result, setResult] = useState<{ users: number; logs: number; inserted: number; departments: number } | null>(null);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => (await supabase.from("devices").select("id, name, serial_number").order("name")).data ?? [],
  });

  const handleUpload = async () => {
    if (!file || !user) return;
    setBusy(true); setResult(null); setProgress(5); setStep("قراءة الملف...");

    try {
      const buffer = await file.arrayBuffer();
      setProgress(20); setStep("فك ضغط GZIP واستخراج TAR...");
      const parsed = await parseZkBackup(buffer);
      setProgress(55); setStep(`استخرج ${parsed.users.length} مستخدم و ${parsed.logs.length} سجل بصمة.`);

      // upload original file to storage
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("zk-backups").upload(path, file);
      if (upErr) throw upErr;
      setProgress(65); setStep("حفظ ملف النسخة الاحتياطية...");

      const { data: row, error: rowErr } = await supabase.from("uploaded_files").insert({
        device_id: deviceId === "none" ? null : deviceId,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        status: "processing",
        uploaded_by: user.id,
        device_serial: parsed.serial,
      }).select().single();
      if (rowErr) throw rowErr;

      setProgress(75); setStep("إدراج البيانات في قاعدة البيانات...");
      const res = await ingest({ data: {
        upload_id: row.id,
        device_id: deviceId === "none" ? null : deviceId,
        serial: parsed.serial,
        users: parsed.users,
        departments: parsed.departments,
        logs: parsed.logs,
      }});

      setProgress(100); setStep("اكتمل!");
      setResult({ users: res.users, logs: parsed.logs.length, inserted: res.inserted, departments: res.departments });
      toast.success(`تم إدراج ${res.inserted} سجل حضور جديد`);
      setFile(null);
    } catch (e: any) {
      toast.error("فشل: " + (e?.message ?? e));
      setStep("فشل: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">رفع ملف البصمة</h1>
        <p className="text-muted-foreground mt-1">ارفع ملف <code>backupdata.dat</code> الصادر من جهاز ZKTeco</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> الملف</CardTitle>
          <CardDescription>الصيغة المدعومة: ZK format 1.0.0.0 (GZIP + TAR + SQLite)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>الجهاز (اختياري — لربط السجلات)</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— غير محدد —</SelectItem>
                {devices.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name} {d.serial_number ? `(${d.serial_number})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>اختر الملف</Label>
            <label className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:bg-accent/30 transition-colors">
              <Upload className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{file ? file.name : "اضغط لاختيار ملف .dat"}</p>
              {file && <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} ميجا</p>}
              <input type="file" accept=".dat,application/octet-stream" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          {busy && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground">{step}</p>
            </div>
          )}

          <Button onClick={handleUpload} disabled={!file || busy} className="w-full" size="lg">
            {busy ? "جارٍ المعالجة..." : "رفع ومعالجة الملف"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-success">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success"><FileCheck2 className="w-5 h-5" /> اكتملت المعالجة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-4 rounded-lg bg-accent/40">
                <Database className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="text-2xl font-bold">{result.users}</p>
                <p className="text-xs text-muted-foreground">موظف</p>
              </div>
              <div className="p-4 rounded-lg bg-accent/40">
                <p className="text-2xl font-bold">{result.departments}</p>
                <p className="text-xs text-muted-foreground">قسم</p>
              </div>
              <div className="p-4 rounded-lg bg-accent/40">
                <p className="text-2xl font-bold">{result.logs.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">سجل بصمة</p>
              </div>
              <div className="p-4 rounded-lg bg-success/10">
                <p className="text-2xl font-bold text-success">{result.inserted.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">سجل جديد مُدرَج</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/30">
        <CardContent className="p-4 flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">ملاحظة:</p>
            <p>السجلات المكررة (نفس الموظف + نفس الوقت + نفس الجهاز) تُتجاهل تلقائياً. يمكنك رفع ملفات من أجهزة متعددة وسيتم دمج السجلات.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

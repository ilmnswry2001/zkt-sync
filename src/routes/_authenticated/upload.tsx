import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, AlertCircle, FileCheck2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "رفع ملفات البصمة" },
      { name: "description", content: "رفع ملفات النسخ الاحتياطي لأجهزة البصمة ZKTeco قبل معالجتها." },
    ],
  }),
  component: UploadPage,
});

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function UploadPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [deviceId, setDeviceId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const [duplicate, setDuplicate] = useState<{ hash: string; name: string } | null>(null);
  const [done, setDone] = useState(false);

  const { data: devices = [] } = useQuery({
    queryKey: ["devices"],
    queryFn: async () =>
      (await supabase.from("devices").select("id, name, serial_number").order("name")).data ?? [],
  });

  const doUpload = async (hash: string, isDuplicate: boolean) => {
    if (!file || !user) return;
    setBusy(true);
    setDone(false);
    setProgress(30);
    setStep("رفع الملف إلى المخزن...");
    try {
      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("zk-backups").upload(path, file);
      if (upErr) throw upErr;
      setProgress(70);
      setStep("حفظ سجل الملف...");
      const { error: rowErr } = await supabase.from("uploaded_files").insert({
        device_id: deviceId === "none" ? null : deviceId,
        file_name: file.name,
        storage_path: path,
        file_size: file.size,
        status: "pending",
        uploaded_by: user.id,
        content_hash: hash,
        is_duplicate: isDuplicate,
      });
      if (rowErr) throw rowErr;
      setProgress(100);
      setStep("تم الرفع — ابدأ المعالجة من صفحة سجل الملفات");
      setDone(true);
      setFile(null);
      toast.success("تم رفع الملف. اذهب إلى سجل الملفات واضغط «بدء معالجة البصمة»");
    } catch (e: any) {
      toast.error("فشل الرفع: " + (e?.message ?? e));
      setStep("فشل: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!file || !user) return;
    setBusy(true);
    setProgress(10);
    setStep("حساب بصمة المحتوى...");
    try {
      const hash = await sha256(await file.arrayBuffer());
      const { data: existing } = await supabase
        .from("uploaded_files")
        .select("id, file_name")
        .eq("content_hash", hash)
        .limit(1);
      if (existing?.length) {
        setBusy(false);
        setStep("");
        setDuplicate({ hash, name: existing[0].file_name });
        return;
      }
      await doUpload(hash, false);
    } catch (e: any) {
      setBusy(false);
      toast.error("فشل: " + (e?.message ?? e));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">رفع ملف البصمة</h1>
        <p className="text-muted-foreground mt-1">
          ارفع ملف <code>backupdata.dat</code> الصادر من جهاز ZKTeco — المعالجة تبدأ يدوياً من صفحة سجل
          الملفات
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" /> الملف
          </CardTitle>
          <CardDescription>الصيغة المدعومة: ZK format 1.0.0.0 (GZIP + TAR + SQLite)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>الجهاز (اختياري — لربط السجلات)</Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— غير محدد —</SelectItem>
                {devices.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} {d.serial_number ? `(${d.serial_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>اختر الملف</Label>
            <label className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:bg-accent/30 transition-colors">
              <Upload className="w-10 h-10 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{file ? file.name : "اضغط لاختيار ملف .dat"}</p>
              {file && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} ميجا
                </p>
              )}
              <input
                type="file"
                accept=".dat,application/octet-stream"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {(busy || step) && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground">{step}</p>
            </div>
          )}

          <Button onClick={handleUpload} disabled={!file || busy} className="w-full" size="lg">
            {busy ? "جارٍ الرفع..." : "رفع الملف"}
          </Button>
          {done && (
            <Button asChild variant="outline" className="w-full">
              <Link to="/files">
                <FileCheck2 className="w-4 h-4 ml-2" /> اذهب إلى سجل الملفات وابدأ المعالجة
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardContent className="p-4 flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">ملاحظة:</p>
            <p>
              الرفع لا يعالج الملف تلقائياً. بعد الرفع اضغط «بدء معالجة البصمة» في سجل الملفات ليتم
              احتساب الحضور واعتماده في التقرير الشهري. البصمات المكررة (نفس الموظف ونفس الوقت) لا
              تُحتسب مرتين.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!duplicate} onOpenChange={(open) => !open && setDuplicate(null)}>
        <DialogContent dir="rtl">
          <DialogHeader className="sm:text-right">
            <DialogTitle>هذا الملف مكرر، هل تريد الاستمرار؟</DialogTitle>
            <DialogDescription>
              تم رفع ملف بنفس المحتوى سابقاً ({duplicate?.name}). عند الاستمرار سيُرفع الملف مع وسم
              «مكرر» ولن تُحتسب بصماته مرتين.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              onClick={() => {
                const hash = duplicate!.hash;
                setDuplicate(null);
                void doUpload(hash, true);
              }}
            >
              استمرار
            </Button>
            <Button variant="outline" onClick={() => setDuplicate(null)}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

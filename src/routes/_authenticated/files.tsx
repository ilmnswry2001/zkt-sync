import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ingestZkData } from "@/lib/attendance.functions";
import { parseZkBackup } from "@/lib/zk-parser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/files")({
  head: () => ({ meta: [{ title: "سجل الملفات" }] }),
  component: FilesPage,
});

function FilesPage() {
  const queryClient = useQueryClient();
  const ingest = useServerFn(ingestZkData);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["uploaded_files"],
    queryFn: async () => {
      const { data, error } = await supabase.from("uploaded_files")
        .select("*, devices(name)").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

  const processFile = async (row: any) => {
    if (processingId) return;
    setProcessingId(row.id);
    try {
      const { data: file, error: downloadError } = await supabase.storage
        .from("zk-backups")
        .download(row.storage_path);
      if (downloadError) throw downloadError;
      if (!file) throw new Error("تعذر تنزيل الملف من التخزين");

      const parsed = await parseZkBackup(await file.arrayBuffer());
      if (!parsed.logs.length) throw new Error("لم يتم العثور على سجلات بصمة داخل الملف");

      const result = await ingest({
        data: {
          upload_id: row.id,
          device_id: row.device_id ?? null,
          serial: parsed.serial || row.device_serial || "",
          users: parsed.users,
          departments: parsed.departments,
          logs: parsed.logs,
        },
      });
      toast.success(`تمت المعالجة وحفظ ${result.inserted} سجل بصمة`);
      await queryClient.invalidateQueries({ queryKey: ["uploaded_files"] });
    } catch (error) {
      toast.error(`فشلت معالجة الملف: ${formatErrorMessage(error, "حدث خطأ غير متوقع")}`);
      await queryClient.invalidateQueries({ queryKey: ["uploaded_files"] });
    } finally {
      setProcessingId(null);
    }
  };

  const statusColor: Record<string, string> = {
    completed: "bg-success",
    processing: "bg-warning",
    failed: "bg-destructive",
    pending: "bg-muted",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">سجل الملفات المرفوعة</h1>
        <p className="text-muted-foreground mt-1">آخر 100 ملف</p>
      </div>
      <Card>
        <CardHeader><CardTitle>الملفات</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الملف</TableHead>
                <TableHead>الجهاز</TableHead>
                <TableHead>الرقم التسلسلي</TableHead>
                <TableHead>الموظفون</TableHead>
                <TableHead>السجلات</TableHead>
                <TableHead>المُدرَج</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm">{r.file_name}</TableCell>
                  <TableCell>{r.devices?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{r.device_serial ?? "—"}</TableCell>
                  <TableCell>{r.users_count ?? 0}</TableCell>
                  <TableCell>{r.logs_count ?? 0}</TableCell>
                  <TableCell className="font-semibold text-success">{r.inserted_logs ?? 0}</TableCell>
                  <TableCell><Badge className={statusColor[r.status] ?? ""}>{r.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(r.created_at).toLocaleString("ar")}</TableCell>
                  <TableCell>
                    {r.status !== "completed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={processingId !== null}
                        onClick={() => void processFile(r)}
                      >
                        {processingId === r.id ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Play className="ml-2 h-4 w-4" />}
                        {processingId === r.id ? "جارٍ المعالجة" : "بدء المعالجة"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">لم يتم رفع أي ملفات بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

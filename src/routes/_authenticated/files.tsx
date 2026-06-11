import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/files")({
  head: () => ({ meta: [{ title: "سجل الملفات" }] }),
  component: FilesPage,
});

function FilesPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ["uploaded_files"],
    queryFn: async () => {
      const { data, error } = await supabase.from("uploaded_files")
        .select("*, devices(name)").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

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
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لم يتم رفع أي ملفات بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

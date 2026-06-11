import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getDailyReport } from "@/lib/attendance.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({ meta: [{ title: "الحضور والانصراف" }] }),
  component: AttendancePage,
});

function AttendancePage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const fn = useServerFn(getDailyReport);
  const { data, isLoading } = useQuery({
    queryKey: ["daily", date],
    queryFn: () => fn({ data: { date } }),
  });

  const rows = data?.rows ?? [];
  const present = rows.filter((r: any) => r.status === "present").length;
  const absent = rows.length - present;

  const fmtTime = (t: string | null) => t ? new Date(t).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">الحضور والانصراف</h1>
        <p className="text-muted-foreground mt-1">تقرير يومي يدمج السجلات من جميع الأجهزة</p>
      </div>

      <Card>
        <CardContent className="p-4 flex items-end gap-4">
          <div>
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
          </div>
          <div className="flex gap-3 mr-auto">
            <Badge variant="default" className="bg-success">حاضر: {present}</Badge>
            <Badge variant="destructive">غائب: {absent}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>تقرير {date}</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="text-muted-foreground">جارٍ التحميل...</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>أول دخول</TableHead>
                  <TableHead>آخر خروج</TableHead>
                  <TableHead>الساعات</TableHead>
                  <TableHead>أجهزة</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: any) => (
                  <TableRow key={r.employee_no}>
                    <TableCell className="font-mono">{r.employee_no}</TableCell>
                    <TableCell className="font-medium">{r.full_name}</TableCell>
                    <TableCell>{r.department ?? "-"}</TableCell>
                    <TableCell>{fmtTime(r.check_in)}</TableCell>
                    <TableCell>{fmtTime(r.check_out)}</TableCell>
                    <TableCell>{r.hours > 0 ? r.hours.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-center">{r.devices || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "present" ? "default" : "destructive"} className={r.status === "present" ? "bg-success" : ""}>
                        {r.status === "present" ? "حاضر" : "غائب"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">لا توجد بيانات لهذا التاريخ</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

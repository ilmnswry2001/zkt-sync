import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getEmployeeMonthly, setDayStatus } from "@/lib/reports.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/monthly")({
  head: () => ({
    meta: [
      { title: "التقرير الشهري للموظف" },
      { name: "description", content: "عرض حضور الموظف لشهر كامل مع تعديل حالة كل يوم: حضور، غياب، إجازة أو عطلة." },
      { property: "og:title", content: "التقرير الشهري للموظف" },
      { property: "og:description", content: "حضور شهر كامل مع تعديل حالة كل يوم وحساب الأجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonthlyPage,
});

const STATUS_LABEL: Record<string, string> = {
  present: "حاضر", absent: "غائب", leave: "إجازة", holiday: "عطلة", rest: "راحة",
};
const STATUS_CLASS: Record<string, string> = {
  present: "bg-success", absent: "", leave: "bg-primary", holiday: "bg-muted text-foreground", rest: "bg-muted text-foreground",
};

function MonthlyPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [search, setSearch] = useState("");
  const [empId, setEmpId] = useState<string>("");

  const { data: emps = [] } = useQuery({
    queryKey: ["emp-list"],
    queryFn: async () => (await supabase.from("employees").select("id, employee_no, full_name").order("employee_no")).data ?? [],
  });

  const fetchMonthly = useServerFn(getEmployeeMonthly);
  const saveDay = useServerFn(setDayStatus);

  const { data, isLoading } = useQuery({
    queryKey: ["monthly", empId, month],
    queryFn: () => fetchMonthly({ data: { employee_id: empId, month } }),
    enabled: !!empId,
  });

  const mut = useMutation({
    mutationFn: (v: { work_date: string; status: string | null }) =>
      saveDay({ data: { employee_id: empId, work_date: v.work_date, status: v.status as any, notes: null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["monthly", empId, month] }); toast.success("تم تحديث اليوم"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = (emps as any[]).filter((e) =>
    !search || e.employee_no.includes(search) || e.full_name.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 100);

  const fmt = (t: string | null) => (t ? new Date(t).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }) : "—");
  const s = data?.summary;
  const p = data?.payroll;
  const emp: any = data?.employee;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">التقرير الشهري</h1>
        <p className="text-muted-foreground mt-1">حضور شهر كامل لكل موظف مع تعديل حالة كل يوم</p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div>
            <Label>الشهر</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
          </div>
          <div>
            <Label>بحث عن موظف</Label>
            <Input placeholder="الرقم أو الاسم" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          </div>
          <div>
            <Label>الموظف</Label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger className="w-72"><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
              <SelectContent>
                {filtered.map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.employee_no} — {e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!empId && <Card><CardContent className="py-10 text-center text-muted-foreground">اختر موظفاً لعرض تقريره الشهري</CardContent></Card>}

      {empId && isLoading && <Card><CardContent className="py-10 text-center text-muted-foreground">جارٍ التحميل...</CardContent></Card>}

      {data && s && p && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { l: "أيام الحضور", v: s.presentDays },
              { l: "أيام الغياب", v: s.absentDays },
              { l: "الإجازات", v: s.leaveDays },
              { l: "العطل", v: s.holidayDays },
              { l: "مجموع الساعات", v: s.totalHours },
              { l: "أيام الشهر", v: s.workDays },
            ].map((c) => (
              <Card key={c.l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{c.l}</p><p className="text-2xl font-bold">{c.v}</p></CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {emp?.employee_no} — {emp?.full_name}
                <span className="text-sm font-normal text-muted-foreground mr-3">
                  {emp?.position ?? "—"} · {emp?.departments?.name ?? "بدون قسم"}
                  {emp?.sites ? ` · ${emp.sites.name} (${emp.sites.ctr_code})` : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-4 gap-4 text-sm">
              <div><p className="text-muted-foreground">الأجر اليومي</p><p className="font-semibold">{p.dailyRate.toLocaleString()} {p.currency}</p></div>
              <div><p className="text-muted-foreground">أجر الحضور</p><p className="font-semibold">{p.basePay.toLocaleString()} {p.currency}</p></div>
              <div><p className="text-muted-foreground">الإضافات والمكافآت</p><p className="font-semibold">{p.additionsTotal.toLocaleString()} {p.currency}</p></div>
              <div><p className="text-muted-foreground">الإجمالي المستحق</p><p className="font-bold text-lg">{p.total.toLocaleString()} {p.currency}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>أيام شهر {month}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>اليوم</TableHead><TableHead>أول دخول</TableHead>
                    <TableHead>آخر خروج</TableHead><TableHead>الساعات</TableHead><TableHead>الحالة</TableHead>
                    <TableHead>تعديل الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.days.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="font-mono">{d.date}</TableCell>
                      <TableCell>{new Date(d.date + "T00:00:00Z").toLocaleDateString("ar", { weekday: "long", timeZone: "UTC" })}</TableCell>
                      <TableCell>{fmt(d.check_in)}</TableCell>
                      <TableCell>{fmt(d.check_out)}</TableCell>
                      <TableCell>{d.hours > 0 ? d.hours.toFixed(2) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={d.status === "absent" ? "destructive" : "default"} className={STATUS_CLASS[d.status] ?? ""}>
                          {STATUS_LABEL[d.status] ?? d.status}
                        </Badge>
                        {d.manual && <span className="text-[10px] text-muted-foreground mr-2">يدوي</span>}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={d.manual ? d.status : "auto"}
                          onValueChange={(v) => mut.mutate({ work_date: d.date, status: v === "auto" ? null : v })}
                        >
                          <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">تلقائي (البصمة)</SelectItem>
                            <SelectItem value="present">حاضر</SelectItem>
                            <SelectItem value="absent">غائب</SelectItem>
                            <SelectItem value="leave">إجازة</SelectItem>
                            <SelectItem value="holiday">عطلة</SelectItem>
                            <SelectItem value="rest">راحة</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

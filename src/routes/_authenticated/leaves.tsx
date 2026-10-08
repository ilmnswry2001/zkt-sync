import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { actOnForm, createForm } from "@/lib/forms.functions";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarCheck2, Check, Clock3, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leaves")({
  head: () => ({ meta: [{ title: "إدارة الإجازات" }] }),
  component: LeavesPage,
});

type LeaveRow = {
  id: string;
  form_no: number;
  employee_id: string;
  work_date: string;
  leave_end_date: string | null;
  leave_days: number;
  reason: string;
  status: string;
  rejection_reason: string | null;
  employees: { employee_no: string; full_name: string; department_id: string | null } | null;
};

type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  department_id: string | null;
};

const statusLabel: Record<string, string> = {
  pending_manager: "بانتظار مدير القسم",
  pending_ceo: "بانتظار مدير الشركة",
  pending_execution: "بانتظار التنفيذ",
  executed: "منفذة",
  rejected: "مرفوضة",
};

function LeavesPage() {
  const { isAdmin, isHR, isCompanyManager, roles } = useAuth();
  const qc = useQueryClient();
  const createFn = useServerFn(createForm);
  const actFn = useServerFn(actOnForm);
  const canManage = isAdmin || isHR;
  const canCreate = canManage || roles.includes("data_entry");
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("all");

  const employeesQuery = useQuery({
    queryKey: ["leaves", "employees"],
    enabled: canCreate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, department_id")
        .eq("status", "active")
        .order("employee_no");
      if (error) throw error;
      return (data ?? []) as Employee[];
    },
  });
  const formsQuery = useQuery({
    queryKey: ["leaves", "forms", filter],
    queryFn: async () => {
      let query = (supabase as any)
        .from("forms")
        .select(
          "id, form_no, employee_id, work_date, leave_end_date, leave_days, reason, status, rejection_reason, employees(employee_no, full_name, department_id)",
        )
        .eq("kind", "leave")
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter !== "all") query = query.eq("status", filter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
  });
  const settingsQuery = useQuery({
    queryKey: ["leaves", "settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_settings")
        .select("annual_allowance_days")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.annual_allowance_days ?? 21);
    },
  });
  const rows = formsQuery.data ?? [];
  const allowance = settingsQuery.data ?? 21;
  const stats = useMemo(() => {
    const yearRows = rows.filter((row) => row.work_date.startsWith(String(year)));
    return {
      total: rows.length,
      pending: rows.filter((row) => row.status.startsWith("pending_")).length,
      executed: yearRows.filter((row) => row.status === "executed").length,
      days: yearRows
        .filter((row) => row.status !== "rejected")
        .reduce((sum, row) => sum + Number(row.leave_days || 1), 0),
    };
  }, [rows, year]);
  const balances = useMemo(() => {
    const map = new Map<string, { employee: Employee; used: number; reserved: number }>();
    for (const employee of employeesQuery.data ?? [])
      map.set(employee.id, { employee, used: 0, reserved: 0 });
    for (const row of rows.filter(
      (item) => item.work_date.startsWith(String(year)) && item.status !== "rejected",
    )) {
      const entry = map.get(row.employee_id);
      if (!entry) continue;
      const days = Number(row.leave_days || 1);
      if (row.status === "executed") entry.used += days;
      else entry.reserved += days;
    }
    return [...map.values()];
  }, [employeesQuery.data, rows, year]);
  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          employee_id: employeeId,
          work_date: startDate,
          leave_end_date: endDate,
          kind: "leave",
          day_status: "leave",
          overtime_hours: 0,
          check_in: null,
          check_out: null,
          target_department_id: null,
          reason,
        } as never,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leaves"] });
      setOpen(false);
      setReason("");
      toast.success("تم إرسال طلب الإجازة للموافقة");
    },
    onError: (error: Error) => toast.error(error.message || "تعذر إرسال طلب الإجازة"),
  });
  const act = useMutation({
    mutationFn: (payload: { form_id: string; action: "approve" | "reject" | "execute" }) =>
      actFn({ data: payload }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leaves"] });
      toast.success("تم تحديث طلب الإجازة");
    },
    onError: (error: Error) => toast.error(error.message || "تعذر تنفيذ الإجراء"),
  });

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <CalendarCheck2 className="h-8 w-8 text-primary" /> إدارة الإجازات
          </h1>
          <p className="mt-1 text-muted-foreground">طلبات الإجازات والاعتمادات والأرصدة السنوية</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="ml-2 h-4 w-4" /> تقديم طلب إجازة
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="إجمالي الطلبات" value={stats.total} icon={CalendarCheck2} />
        <Kpi label="طلبات معلقة" value={stats.pending} icon={Clock3} />
        <Kpi label="منفذة هذا العام" value={stats.executed} icon={Check} />
        <Kpi label="الأيام المستهلكة" value={stats.days} icon={CalendarCheck2} />
      </div>
      {open && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>طلب إجازة جديد</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label>الموظف</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف" />
                </SelectTrigger>
                <SelectContent>
                  {(employeesQuery.data ?? []).map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.employee_no} — {employee.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>من تاريخ</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>إلى تاريخ</Label>
              <Input
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>السبب</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="سبب الإجازة"
                maxLength={1000}
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                إلغاء
              </Button>
              <Button
                disabled={create.isPending || !employeeId || !reason.trim()}
                onClick={() => create.mutate()}
              >
                {create.isPending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />} إرسال الطلب
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Tabs defaultValue="requests" dir="rtl">
        <TabsList>
          <TabsTrigger value="requests">الطلبات والاعتمادات</TabsTrigger>
          <TabsTrigger value="balances">أرصدة الموظفين</TabsTrigger>
        </TabsList>
        <TabsContent value="requests" className="space-y-4">
          <div className="flex justify-end">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الطلبات</SelectItem>
                {Object.entries(statusLabel).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-right">
                    <th className="p-3">الموظف</th>
                    <th className="p-3">الفترة</th>
                    <th className="p-3">الأيام</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="p-3">
                        {row.employees?.employee_no} — {row.employees?.full_name}
                      </td>
                      <td className="p-3">
                        {row.work_date} إلى {row.leave_end_date ?? row.work_date}
                      </td>
                      <td className="p-3">{row.leave_days || 1}</td>
                      <td className="p-3">
                        <Badge
                          variant={
                            row.status === "rejected"
                              ? "destructive"
                              : row.status === "executed"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {statusLabel[row.status] ?? row.status}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          {row.status === "pending_manager" &&
                            (roles.includes("department_manager") || canManage) && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => act.mutate({ form_id: row.id, action: "approve" })}
                                >
                                  <Check className="ml-1 h-3 w-3" /> موافقة
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => act.mutate({ form_id: row.id, action: "reject" })}
                                >
                                  <X className="ml-1 h-3 w-3" /> رفض
                                </Button>
                              </>
                            )}
                          {row.status === "pending_ceo" && (isAdmin || isCompanyManager) && (
                            <Button
                              size="sm"
                              onClick={() => act.mutate({ form_id: row.id, action: "approve" })}
                            >
                              اعتماد الإدارة
                            </Button>
                          )}
                          {row.status === "pending_execution" &&
                            (canManage || roles.includes("data_entry")) && (
                              <Button
                                size="sm"
                                onClick={() => act.mutate({ form_id: row.id, action: "execute" })}
                              >
                                تنفيذ
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-muted-foreground">
                        لا توجد طلبات إجازة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="balances">
          <Card>
            <CardHeader>
              <CardTitle>الرصيد السنوي — {allowance} يوماً لكل موظف</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-right">
                    <th className="p-3">الموظف</th>
                    <th className="p-3">المتاح السنوي</th>
                    <th className="p-3">المستهلك</th>
                    <th className="p-3">محجوز</th>
                    <th className="p-3">المتبقي</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((entry) => (
                    <tr key={entry.employee.id} className="border-b">
                      <td className="p-3">
                        {entry.employee.employee_no} — {entry.employee.full_name}
                      </td>
                      <td className="p-3">{allowance}</td>
                      <td className="p-3">{entry.used}</td>
                      <td className="p-3">{entry.reserved}</td>
                      <td className="p-3 font-bold text-primary">
                        {Math.max(0, allowance - entry.used - entry.reserved)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof CalendarCheck2;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-6 w-6 text-primary" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value.toLocaleString("ar-IQ")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

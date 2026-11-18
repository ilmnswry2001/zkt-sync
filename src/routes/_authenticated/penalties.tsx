import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Check,
  FileWarning,
  Download,
  Plus,
  Search,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { todayInBaghdad } from "@/lib/date-time";

export const Route = createFileRoute("/_authenticated/penalties")({
  head: () => ({ meta: [{ title: "العقوبات والتغييب" }] }),
  component: PenaltiesPage,
});

type Employee = {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
};
type Penalty = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  penalty_type: "absence" | "deduction" | "warning";
  penalty_date: string;
  deduction_amount: number;
  notes: string | null;
  executed_at: string | null;
  executed_by: string | null;
};
const today = todayInBaghdad();
const monthStart = (month: string) => `${month}-01`;
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
};
const typeLabel: Record<Penalty["penalty_type"], string> = {
  absence: "غياب",
  deduction: "استقطاع",
  warning: "إنذار",
};

function PenaltiesPage() {
  const qc = useQueryClient();
  const { isAdmin, isHR } = useAuth();
  const canManageFinancialPenalties = isAdmin || isHR;
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [penaltyType, setPenaltyType] = useState<Penalty["penalty_type"]>("absence");
  const [penaltyDate, setPenaltyDate] = useState(today);

  const employeesQuery = useQuery({
    queryKey: ["penalty-employees"],
    enabled: open,
    queryFn: async () => {
      const directory: Employee[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("employees")
          .select("id, employee_no, full_name, position")
          .order("full_name")
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        directory.push(...data);
        if (data.length < pageSize) return directory;
      }
    },
  });
  const employees = employeesQuery.data ?? [];
  const employeeSearchTerms = employeeSearch.trim().toLocaleLowerCase("ar").split(/\s+/).filter(Boolean);
  const matchingEmployees = employees.filter((employee) => {
    const searchable = `${employee.full_name} ${employee.employee_no} ${employee.position ?? ""}`.toLocaleLowerCase("ar");
    return employeeSearchTerms.every((term) => searchable.includes(term));
  }).slice(0, 50);
  const penaltiesQuery = useQuery({
    queryKey: ["employee-penalties", month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employee_penalties")
        .select(
          "id, employee_id, employee_name, penalty_type, penalty_date, deduction_amount, notes, executed_at, executed_by",
        )
        .gte("penalty_date", monthStart(month))
        .lte("penalty_date", monthEnd(month))
        .order("penalty_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Penalty[];
    },
  });
  const penalties = useMemo(() => penaltiesQuery.data ?? [], [penaltiesQuery.data]);
  const visiblePenalties = penalties.filter(
    (penalty) =>
      (typeFilter === "all" || penalty.penalty_type === typeFilter) &&
      penalty.employee_name.includes(search.trim()),
  );
  const exportPenalties = async () => {
    setExporting(true);
    try {
      const { downloadPenaltiesExcel } = await import("@/lib/penalties-export");
      await downloadPenaltiesExcel(
        visiblePenalties.map((penalty) => ({
          employee: penalty.employee_name,
          type: typeLabel[penalty.penalty_type],
          date: penalty.penalty_date,
          amount: Number(penalty.deduction_amount || 0),
          status: penalty.executed_at
            ? "تم التنفيذ"
            : penalty.penalty_type === "absence"
              ? "لم يُنفذ"
              : "مسجلة",
          notes: penalty.notes,
        })),
        {
          month,
          type: typeFilter === "all" ? "الكل" : typeLabel[typeFilter as Penalty["penalty_type"]],
          search: search.trim(),
        },
      );
    } catch (error) {
      toast.error(formatErrorMessage(error, "تعذر تصدير العقوبات إلى Excel"));
    } finally {
      setExporting(false);
    }
  };
  const stats = useMemo(
    () => ({
      total: penalties.length,
      absence: penalties.filter((item) => item.penalty_type === "absence").length,
      deduction: penalties.filter((item) => item.penalty_type === "deduction").length,
      warning: penalties.filter((item) => item.penalty_type === "warning").length,
      amount: penalties.reduce((sum, item) => sum + Number(item.deduction_amount || 0), 0),
    }),
    [penalties],
  );

  const addPenalty = useMutation({
    mutationFn: async (payload: {
      employeeIds: string[];
      directName: string;
      type: Penalty["penalty_type"];
      date: string;
      amount: number;
      notes: string;
    }) => {
      const chosen = payload.employeeIds.length
        ? employees
            .filter((employee) => payload.employeeIds.includes(employee.id))
            .map((employee) => ({ employee_id: employee.id, employee_name: employee.full_name }))
        : [{ employee_id: null, employee_name: payload.directName.trim() }];
      const rows = chosen.map((person) => ({
        ...person,
        penalty_type: payload.type,
        penalty_date: payload.date,
        deduction_amount: payload.type === "deduction" ? payload.amount : 0,
        notes: payload.notes.trim() || null,
      }));
      if (payload.type === "deduction" && !canManageFinancialPenalties) {
        throw new Error("صلاحية إنشاء الاستقطاعات المالية مقتصرة على الموارد البشرية ومدير النظام");
      }
      const { error } = await (supabase as any).from("employee_penalties").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-penalties"] });
      setOpen(false);
      setSelectedEmployees([]);
      setPenaltyType("absence");
      setPenaltyDate(today);
      toast.success("تمت إضافة العقوبة بنجاح");
    },
    onError: (error: any) =>
      toast.error(
        error.message?.includes("employee_penalties")
          ? "جدول العقوبات غير موجود في قاعدة Lovable Cloud. طبّق ملف Migration أولاً."
          : (error.message ?? "تعذر إضافة العقوبة"),
      ),
  });
  const deletePenalty = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("employee_penalties").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee-penalties"] });
      toast.success("تم حذف السجل");
    },
    onError: (error: any) => toast.error(formatErrorMessage(error)),
  });
  const executePenalty = useMutation({
    mutationFn: async (penalty: Penalty) => {
      if (penalty.executed_at) throw new Error("تم تنفيذ هذه العقوبة مسبقاً");
      if (!penalty.employee_id) {
        throw new Error("لا يمكن تنفيذ العقوبة إلا على موظف مرتبط بقاعدة البيانات");
      }
      if (penalty.penalty_type !== "absence")
        throw new Error("تنفيذ سجل الحضور متاح لعقوبة الغياب فقط");
      // The database function locks the penalty and writes attendance plus execution status in one transaction.
      const { error } = await (supabase as any).rpc("execute_absence_penalty", {
        _penalty_id: penalty.id,
      });
      if (error) throw error;
      return { executed: true };
    },
    onSuccess: (_data, penalty) => {
      qc.invalidateQueries({ queryKey: ["employee-penalties"] });
      if (penalty.penalty_type === "absence") {
        toast.success("تم تنفيذ العقوبة وتغييب الموظف في التاريخ المحدد في التقرير الشهري");
      } else {
        toast.info("تم تسجيل العقوبة في السجل فقط لأن نوعها لا يغيّر يوم الحضور");
      }
    },
    onError: (error: any) => toast.error(formatErrorMessage(error) ?? "تعذر تنفيذ العقوبة"),
  });

  return (
    <div className="space-y-6">
      {penaltiesQuery.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          تعذر قراءة سجل العقوبات:{" "}
          {(penaltiesQuery.error as any).message ?? "تحقق من جدول employee_penalties وصلاحيات RLS"}
        </div>
      )}
      {employeesQuery.error && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          تعذر قراءة الموظفين:{" "}
          {(employeesQuery.error as any).message ?? "تحقق من اتصال قاعدة البيانات وصلاحية القراءة"}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">العقوبات والتغييب</h1>
          <p className="text-muted-foreground mt-1">
            سجل شهري منظم للغياب والاستقطاعات والإنذارات مع تواريخها
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 ml-2" /> إدخال عقوبة
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <Stat icon={FileWarning} label="كل السجلات" value={stats.total} color="bg-slate-700" />
        <Stat icon={UserMinus} label="غياب" value={stats.absence} color="bg-red-600" />
        <Stat
          icon={CircleDollarSign}
          label="استقطاع"
          value={stats.deduction}
          color="bg-amber-600"
        />
        <Stat icon={AlertTriangle} label="إنذارات" value={stats.warning} color="bg-orange-600" />
        <Stat
          icon={CircleDollarSign}
          label="إجمالي الاستقطاعات"
          value={`${stats.amount.toLocaleString()} د.ع`}
          color="bg-emerald-600"
        />
      </div>
      <Card className="border-primary/20 bg-gradient-to-l from-primary/5 to-transparent">
        <CardContent className="p-5 flex flex-wrap items-end gap-4">
          <div>
            <Label>شهر التقرير</Label>
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </div>
          <div className="w-44">
            <Label>التصنيف</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التصنيفات</SelectItem>
                <SelectItem value="absence">غياب</SelectItem>
                <SelectItem value="deduction">استقطاع</SelectItem>
                <SelectItem value="warning">إنذار</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-60 flex-1">
            <Label>بحث باسم الموظف</Label>
            <div className="relative">
              <Search className="absolute right-3 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                className="pr-9"
                placeholder="ابحث في التقرير..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <CalendarDays className="w-4 h-4" /> {visiblePenalties.length} سجل في التقرير
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={exporting || penaltiesQuery.isError || !visiblePenalties.length}
            onClick={exportPenalties}
          >
            <Download className="h-4 w-4" />
            {exporting ? "جارٍ التصدير..." : "تصدير Excel"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>تقرير العقوبات والتغييب — {month}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-right">
                  <th className="p-3">الموظف</th>
                  <th className="p-3">نوع العقوبة</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">الملاحظات</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {visiblePenalties.map((penalty) => (
                  <tr key={penalty.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{penalty.employee_name}</td>
                    <td className="p-3">
                      <Badge
                        variant={
                          penalty.penalty_type === "absence"
                            ? "destructive"
                            : penalty.penalty_type === "deduction"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {typeLabel[penalty.penalty_type]}
                      </Badge>
                    </td>
                    <td className="p-3">{penalty.penalty_date}</td>
                    <td className="p-3">
                      {Number(penalty.deduction_amount)
                        ? `${Number(penalty.deduction_amount).toLocaleString()} د.ع`
                        : "—"}
                    </td>
                    <td className="p-3 max-w-md">{penalty.notes || "—"}</td>
                    <td className="p-3 flex items-center gap-2">
                      <div className="flex flex-col gap-2">
                        {penalty.executed_at && (
                          <Badge className="bg-success text-success-foreground">
                            نُفذت {new Date(penalty.executed_at).toLocaleDateString("ar-IQ")}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant={penalty.penalty_type === "absence" ? "default" : "secondary"}
                          disabled={
                            !penalty.employee_id ||
                            penalty.penalty_type !== "absence" ||
                            Boolean(penalty.executed_at) ||
                            executePenalty.isPending
                          }
                          onClick={() => executePenalty.mutate(penalty)}
                        >
                          <CheckCircle2 className="w-4 h-4 ml-1" />{" "}
                          {penalty.executed_at ? "تم التنفيذ" : "تنفيذ"}
                        </Button>
                        {(canManageFinancialPenalties ||
                          (penalty.penalty_type !== "deduction" && !penalty.executed_at)) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`حذف سجل ${typeLabel[penalty.penalty_type]} للموظف ${penalty.employee_name}`}
                            onClick={() => {
                              if (
                                confirm(
                                  `حذف سجل ${typeLabel[penalty.penalty_type]} للموظف ${penalty.employee_name}؟`,
                                )
                              )
                                deletePenalty.mutate(penalty.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!visiblePenalties.length && (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-muted-foreground">
                      لا توجد عقوبات أو تغيبات في الشهر المحدد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSelectedEmployees([]);
          if (!value) setEmployeeSearch("");
        }}
      >
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>إدخال عقوبة أو تغيّب</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const directName = String(form.get("direct_name") || "").trim();
              if (!selectedEmployees.length && !directName)
                return toast.error("اختر موظفاً واحداً على الأقل أو أدخل الاسم مباشرة");
              const amount = Number(form.get("deduction_amount") || 0);
              if (penaltyType === "deduction" && amount <= 0)
                return toast.error("أدخل مبلغ الاستقطاع");
              if (!penaltyDate) return toast.error("حدد تاريخ العقوبة");
              addPenalty.mutate({
                employeeIds: selectedEmployees,
                directName,
                type: penaltyType,
                date: penaltyDate,
                amount,
                notes: String(form.get("notes") || ""),
              });
            }}
            className="space-y-5"
          >
            <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label>الموظف المرتبط بالعقوبة</Label>
                <Badge variant="outline">{selectedEmployees.length} محدد</Badge>
              </div>
              <Popover open={employeePickerOpen} onOpenChange={setEmployeePickerOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-start min-h-11" disabled={employeesQuery.isLoading}>
                    <Search className="ml-2 h-4 w-4" />
                    {employeesQuery.isLoading ? "جارٍ تحميل الموظفين..." : "ابحث واختر موظفاً مسجلاً"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent dir="rtl" align="start" className="w-[min(32rem,calc(100vw-2rem))] p-0">
                  <Command shouldFilter={false}>
                    <CommandInput value={employeeSearch} onValueChange={setEmployeeSearch} placeholder="ابحث بالاسم أو الرقم الوظيفي أو المسمى..." />
                    <CommandList className="max-h-64">
                      <CommandEmpty>{employeesQuery.isError ? "تعذر تحميل الموظفين." : "لا يوجد موظف مطابق للبحث."}</CommandEmpty>
                      <CommandGroup>
                        {matchingEmployees.map((employee) => {
                          const selected = selectedEmployees.includes(employee.id);
                          return <CommandItem key={employee.id} value={employee.id} onSelect={() => {
                            setSelectedEmployees((current) => selected ? current.filter((id) => id !== employee.id) : [...current, employee.id]);
                          }}>
                            <div className="min-w-0 flex-1 text-right"><p className="font-semibold">{employee.full_name}</p><p className="text-xs text-muted-foreground">{employee.employee_no} · {employee.position || "بدون مسمى"}</p></div>
                            {selected && <Check className="h-4 w-4 text-primary" />}
                          </CommandItem>;
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {!!selectedEmployees.length && <div className="flex flex-wrap gap-2">{employees.filter((employee) => selectedEmployees.includes(employee.id)).map((employee) => <Badge key={employee.id} variant="secondary" className="gap-2 py-1">{employee.full_name} · {employee.employee_no}<button type="button" aria-label={`إزالة ${employee.full_name}`} onClick={() => setSelectedEmployees((current) => current.filter((id) => id !== employee.id))}>×</button></Badge>)}</div>}
              <div className="text-center text-xs text-muted-foreground">أو</div>
              <div>
                <Label>إدخال اسم مباشر</Label>
                <Input
                  name="direct_name"
                  placeholder="للموظف غير المسجل في قاعدة البيانات"
                  onChange={() => setSelectedEmployees([])}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>نوع العقوبة</Label>
                <Select
                  value={penaltyType}
                  onValueChange={(value) => setPenaltyType(value as Penalty["penalty_type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="absence">غياب</SelectItem>
                    {canManageFinancialPenalties && (
                      <SelectItem value="deduction">استقطاع</SelectItem>
                    )}
                    <SelectItem value="warning">إنذار</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>تاريخ العقوبة</Label>
                <Input
                  name="penalty_date"
                  type="date"
                  value={penaltyDate}
                  onChange={(event) => setPenaltyDate(event.target.value)}
                  required
                />
              </div>
              {canManageFinancialPenalties && (
                <div>
                  <Label>مبلغ الاستقطاع</Label>
                  <Input
                    name="deduction_amount"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="يطبق على الاستقطاع فقط"
                  />
                </div>
              )}
            </div>
            <div>
              <Label>الملاحظات والتفاصيل</Label>
              <Textarea name="notes" placeholder="سبب العقوبة أو تفاصيل الغياب..." rows={3} />
            </div>
            <Button type="submit" className="w-full" disabled={addPenalty.isPending}>
              <CheckCircle2 className="w-4 h-4 ml-2" />{" "}
              {addPenalty.isPending ? "جارٍ الحفظ..." : "تأكيد الإضافة"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-xl p-3 ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

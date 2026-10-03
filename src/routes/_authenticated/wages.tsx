import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_REPORT_CATALOG } from "@/lib/report-catalog";
import { currentMonthInBaghdad } from "@/lib/date-time";

export const Route = createFileRoute("/_authenticated/wages")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!data?.some((role) => role.role === "admin" || role.role === "hr")) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({
    meta: [
      { title: "الأجور" },
      {
        name: "description",
        content: "تحديد أجر كل تخصص وإضافة المكافآت والمهام الإضافية على راتب الموظف.",
      },
      { property: "og:title", content: "الأجور والمكافآت" },
      { property: "og:description", content: "أجور التخصصات والمكافآت والمهام الإضافية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WagesPage,
});

type Rate = {
  id: string;
  title: string;
  daily_rate: number;
  monthly_rate: number;
  overtime_hour_rate: number;
  currency: string;
  notes: string | null;
};
type Employee = { id: string; employee_no: string; full_name: string };
type AdditionEmployee = { employee_no: string; full_name: string };
type Addition = {
  id: string;
  amount: number;
  kind: string;
  description: string | null;
  employees?: AdditionEmployee | null;
};
type DefaultWage = {
  title: string;
  daily_rate: number;
  monthly_rate: number;
  overtime_hour_rate: number;
};
type RatePayload = Omit<Rate, "id">;
type AdditionPayload = {
  employee_id: string;
  month: string;
  kind: string;
  description: string | null;
  amount: number;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const DEFAULT_SPECIALTY_WAGES: DefaultWage[] = [
  { title: "إدارة وإشراف", daily_rate: 75000, monthly_rate: 1950000, overtime_hour_rate: 10000 },
  { title: "مهندس موقع", daily_rate: 100000, monthly_rate: 2600000, overtime_hour_rate: 15000 },
  { title: "مهندس ميكانيك", daily_rate: 80000, monthly_rate: 2100000, overtime_hour_rate: 12000 },
  { title: "مهندس كهرباء", daily_rate: 80000, monthly_rate: 2100000, overtime_hour_rate: 12000 },
  { title: "مهندس مدني", daily_rate: 80000, monthly_rate: 2100000, overtime_hour_rate: 12000 },
  {
    title: "جيولوجي / فني مختبر",
    daily_rate: 70000,
    monthly_rate: 1850000,
    overtime_hour_rate: 10000,
  },
  { title: "فني أجهزة وتحكم", daily_rate: 65000, monthly_rate: 1700000, overtime_hour_rate: 9000 },
  { title: "فني صيانة", daily_rate: 55000, monthly_rate: 1450000, overtime_hour_rate: 7500 },
  { title: "لحام وفابريكيشن", daily_rate: 45000, monthly_rate: 1200000, overtime_hour_rate: 6500 },
  { title: "سائق", daily_rate: 35000, monthly_rate: 950000, overtime_hour_rate: 5000 },
  { title: "مشغل آلية", daily_rate: 45000, monthly_rate: 1200000, overtime_hour_rate: 6500 },
  { title: "عامل حفر", daily_rate: 40000, monthly_rate: 1050000, overtime_hour_rate: 5500 },
  {
    title: "عامل خدمات / نظافة",
    daily_rate: 28000,
    monthly_rate: 750000,
    overtime_hour_rate: 4000,
  },
  { title: "حراسة وأمن", daily_rate: 30000, monthly_rate: 800000, overtime_hour_rate: 4000 },
  { title: "إسعاف وسلامة HSE", daily_rate: 65000, monthly_rate: 1700000, overtime_hour_rate: 9000 },
];
const genericWage = (title: string): DefaultWage => ({
  title,
  daily_rate: 30000,
  monthly_rate: 800000,
  overtime_hour_rate: 4000,
});

function WagesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rate | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [month, setMonth] = useState(currentMonthInBaghdad);

  const { data: rates = [] } = useQuery({
    queryKey: ["wage-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wage_rates").select("*").order("title");
      if (error) throw error;
      return data as Rate[];
    },
  });
  const { data: emps = [] } = useQuery<Employee[]>({
    queryKey: ["emp-list"],
    queryFn: async () =>
      ((await supabase.from("employees").select("id, employee_no, full_name").order("employee_no"))
        .data ?? []) as Employee[],
  });
  const { data: catalog = [] } = useQuery<string[]>({
    queryKey: ["worker-specialties-for-wages"],
    queryFn: async () => {
      const { data } = await supabase
        .from("report_catalog_items")
        .select("name")
        .eq("kind", "worker_specialty")
        .eq("is_archived", false)
        .order("sort_order");
      return (
        data?.map((item) => item.name) ??
        DEFAULT_REPORT_CATALOG.filter((item) => item.kind === "worker_specialty").map(
          (item) => item.name,
        )
      );
    },
  });
  const { data: additions = [] } = useQuery({
    queryKey: ["salary-additions", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_additions")
        .select("*, employees(employee_no, full_name)")
        .eq("month", `${month}-01`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Addition[];
    },
  });

  const saveRate = useMutation({
    mutationFn: async (d: RatePayload) => {
      if (editing) {
        const { error } = await supabase.from("wage_rates").update(d).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("wage_rates").insert(d);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wage-rates"] });
      setOpen(false);
      setEditing(null);
      toast.success("تم الحفظ");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const delRate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("wage_rates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wage-rates"] });
      toast.success("تم الحذف");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const saveAddition = useMutation({
    mutationFn: async (d: AdditionPayload) => {
      const { error } = await supabase.from("salary_additions").insert(d);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-additions"] });
      setAddOpen(false);
      toast.success("تمت الإضافة");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const delAddition = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("salary_additions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-additions"] });
      toast.success("تم الحذف");
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const specialtyNames = Array.from(
    new Set([...DEFAULT_SPECIALTY_WAGES.map((wage) => wage.title), ...catalog]),
  );
  const ratesByTitle = new Map(rates.map((rate) => [rate.title.trim(), rate]));
  const missingSpecialties = specialtyNames.filter((name) => !ratesByTitle.has(name));
  const seedDefaultRates = useMutation({
    mutationFn: async () => {
      const rows = missingSpecialties.map((title) => {
        const baseline =
          DEFAULT_SPECIALTY_WAGES.find((wage) => wage.title === title) ?? genericWage(title);
        return {
          ...baseline,
          currency: "IQD",
          notes: "أجر افتراضي ابتدائي قابل للتعديل حسب سياسة الشركة",
        };
      });
      if (!rows.length) return 0;
      const { error } = await supabase.from("wage_rates").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      void qc.invalidateQueries({ queryKey: ["wage-rates"] });
      toast.success(`تمت تهيئة أجور ${count} تخصص`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const KINDS: Record<string, string> = {
    bonus: "مكافأة",
    extra_task: "مهمة إضافية",
    overtime: "عمل إضافي",
    allowance: "بدل",
    deduction: "استقطاع",
  };
  const totalAdditions = additions.reduce((s, a) => s + Number(a.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">الأجور</h1>
        <p className="text-muted-foreground mt-1">تحديد أجور الكوادر ومعدلات العمل الإضافي</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>أجور التخصصات</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              الأجور الافتراضية أدناه قيم ابتدائية قابلة للتعديل وفق سياسة الشركة والعقد.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {missingSpecialties.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => seedDefaultRates.mutate()}
                disabled={seedDefaultRates.isPending}
              >
                {seedDefaultRates.isPending
                  ? "جارٍ التهيئة..."
                  : `تهيئة ${missingSpecialties.length} أجر افتراضي`}
              </Button>
            )}
            <Dialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) setEditing(null);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 ml-2" /> تخصص جديد
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader>
                  <DialogTitle>{editing ? "تعديل أجر تخصص" : "أجر تخصص جديد"}</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    saveRate.mutate({
                      title: (f.get("title") as string).trim(),
                      daily_rate: Number(f.get("daily_rate") || 0),
                      monthly_rate: Number(f.get("monthly_rate") || 0),
                      overtime_hour_rate: Number(f.get("overtime_hour_rate") || 0),
                      currency: (f.get("currency") as string) || "IQD",
                      notes: (f.get("notes") as string)?.trim() || null,
                    });
                  }}
                  className="grid grid-cols-2 gap-3"
                >
                  <div className="col-span-2">
                    <Label>التخصص / المسمى الوظيفي</Label>
                    <Input name="title" required defaultValue={editing?.title} />
                  </div>
                  <div>
                    <Label>الأجر اليومي</Label>
                    <Input
                      type="number"
                      step="0.01"
                      name="daily_rate"
                      defaultValue={editing?.daily_rate ?? 0}
                    />
                  </div>
                  <div>
                    <Label>الراتب الشهري</Label>
                    <Input
                      type="number"
                      step="0.01"
                      name="monthly_rate"
                      defaultValue={editing?.monthly_rate ?? 0}
                    />
                  </div>
                  <div>
                    <Label>أجر ساعة العمل الإضافي</Label>
                    <Input
                      type="number"
                      step="0.01"
                      name="overtime_hour_rate"
                      defaultValue={editing?.overtime_hour_rate ?? 0}
                    />
                  </div>
                  <div>
                    <Label>العملة</Label>
                    <Select name="currency" defaultValue={editing?.currency ?? "IQD"}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IQD">دينار عراقي</SelectItem>
                        <SelectItem value="USD">دولار</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>ملاحظات</Label>
                    <Input name="notes" defaultValue={editing?.notes ?? ""} />
                  </div>
                  <Button type="submit" className="col-span-2">
                    حفظ
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        {missingSpecialties.length > 0 && (
          <CardContent className="border-t bg-amber-50/50 pt-4 text-sm dark:bg-amber-950/20">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              تخصصات بلا أجر مسجل: {missingSpecialties.join("، ")}
            </p>
            <p className="mt-1 text-muted-foreground">
              اضغط زر التهيئة لإضافة أجر يومي وشهري وأجر ساعة إضافية لكل تخصص، ويمكن تعديل القيم بعد
              ذلك.
            </p>
          </CardContent>
        )}
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التخصص</TableHead>
                <TableHead>يومي</TableHead>
                <TableHead>شهري</TableHead>
                <TableHead>ساعة إضافية</TableHead>
                <TableHead>العملة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{Number(r.daily_rate).toLocaleString()}</TableCell>
                  <TableCell>{Number(r.monthly_rate).toLocaleString()}</TableCell>
                  <TableCell>{Number(r.overtime_hour_rate).toLocaleString()}</TableCell>
                  <TableCell>{r.currency}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(r);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("حذف؟")) delRate.mutate(r.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!rates.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    لا توجد تخصصات بعد
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>
            الإضافات على الراتب — {month} (المجموع: {totalAdditions.toLocaleString()})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-40"
            />
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 ml-2" /> إضافة
                </Button>
              </DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader>
                  <DialogTitle>إضافة على الراتب</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    saveAddition.mutate({
                      employee_id: f.get("employee_id") as string,
                      month: `${f.get("month")}-01`,
                      kind: f.get("kind") as string,
                      description: (f.get("description") as string)?.trim() || null,
                      amount: Number(f.get("amount") || 0),
                    });
                  }}
                  className="space-y-3"
                >
                  <div>
                    <Label>الموظف</Label>
                    <Select name="employee_id" required>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر موظفاً" />
                      </SelectTrigger>
                      <SelectContent>
                        {emps.slice(0, 300).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.employee_no} — {e.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>الشهر</Label>
                    <Input type="month" name="month" defaultValue={month} required />
                  </div>
                  <div>
                    <Label>النوع</Label>
                    <Select name="kind" defaultValue="bonus">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(KINDS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>المبلغ</Label>
                    <Input type="number" step="0.01" name="amount" required />
                  </div>
                  <div>
                    <Label>الوصف</Label>
                    <Input name="description" />
                  </div>
                  <Button type="submit" className="w-full">
                    حفظ
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {additions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.employees?.employee_no} — {a.employees?.full_name}
                  </TableCell>
                  <TableCell>{KINDS[a.kind] ?? a.kind}</TableCell>
                  <TableCell>{a.description ?? "-"}</TableCell>
                  <TableCell className="font-semibold">
                    {Number(a.amount).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("حذف؟")) delAddition.mutate(a.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!additions.length && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    لا توجد إضافات لهذا الشهر
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

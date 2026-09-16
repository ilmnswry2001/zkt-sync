import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/wages")({
  head: () => ({
    meta: [
      { title: "الأجور والمكافآت" },
      { name: "description", content: "تحديد أجر كل تخصص وإضافة المكافآت والمهام الإضافية على راتب الموظف." },
      { property: "og:title", content: "الأجور والمكافآت" },
      { property: "og:description", content: "أجور التخصصات والمكافآت والمهام الإضافية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WagesPage,
});

type Rate = { id: string; title: string; daily_rate: number; monthly_rate: number; overtime_hour_rate: number; currency: string; notes: string | null };

function WagesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Rate | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const { data: rates = [] } = useQuery({
    queryKey: ["wage-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wage_rates").select("*").order("title");
      if (error) throw error;
      return data as Rate[];
    },
  });
  const { data: emps = [] } = useQuery({
    queryKey: ["emp-list"],
    queryFn: async () => (await supabase.from("employees").select("id, employee_no, full_name").order("employee_no")).data ?? [],
  });
  const { data: additions = [] } = useQuery({
    queryKey: ["salary-additions", month],
    queryFn: async () => {
      const { data, error } = await supabase.from("salary_additions")
        .select("*, employees(employee_no, full_name)")
        .eq("month", `${month}-01`).order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const saveRate = useMutation({
    mutationFn: async (d: any) => {
      if (editing) { const { error } = await supabase.from("wage_rates").update(d).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("wage_rates").insert(d); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wage-rates"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });
  const delRate = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("wage_rates").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wage-rates"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });
  const saveAddition = useMutation({
    mutationFn: async (d: any) => { const { error } = await supabase.from("salary_additions").insert(d); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["salary-additions"] }); setAddOpen(false); toast.success("تمت الإضافة"); },
    onError: (e: any) => toast.error(e.message),
  });
  const delAddition = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("salary_additions").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["salary-additions"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  const KINDS: Record<string, string> = { bonus: "مكافأة", extra_task: "مهمة إضافية", overtime: "عمل إضافي", allowance: "بدل", deduction: "استقطاع" };
  const totalAdditions = additions.reduce((s, a) => s + Number(a.amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">الأجور والمكافآت</h1>
        <p className="text-muted-foreground mt-1">أجر كل تخصص + الإضافات على الراتب</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>أجور التخصصات</CardTitle>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-2" /> تخصص جديد</Button></DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader><DialogTitle>{editing ? "تعديل أجر تخصص" : "أجر تخصص جديد"}</DialogTitle></DialogHeader>
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
                <div className="col-span-2"><Label>التخصص / المسمى الوظيفي</Label><Input name="title" required defaultValue={editing?.title} /></div>
                <div><Label>الأجر اليومي</Label><Input type="number" step="0.01" name="daily_rate" defaultValue={editing?.daily_rate ?? 0} /></div>
                <div><Label>الراتب الشهري</Label><Input type="number" step="0.01" name="monthly_rate" defaultValue={editing?.monthly_rate ?? 0} /></div>
                <div><Label>أجر ساعة العمل الإضافي</Label><Input type="number" step="0.01" name="overtime_hour_rate" defaultValue={editing?.overtime_hour_rate ?? 0} /></div>
                <div>
                  <Label>العملة</Label>
                  <Select name="currency" defaultValue={editing?.currency ?? "IQD"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IQD">دينار عراقي</SelectItem>
                      <SelectItem value="USD">دولار</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label>ملاحظات</Label><Input name="notes" defaultValue={editing?.notes ?? ""} /></div>
                <Button type="submit" className="col-span-2">حفظ</Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>التخصص</TableHead><TableHead>يومي</TableHead><TableHead>شهري</TableHead><TableHead>ساعة إضافية</TableHead><TableHead>العملة</TableHead><TableHead></TableHead></TableRow></TableHeader>
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
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف؟")) delRate.mutate(r.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!rates.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">لا توجد تخصصات بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>الإضافات على الراتب — {month} (المجموع: {totalAdditions.toLocaleString()})</CardTitle>
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-2" /> إضافة</Button></DialogTrigger>
              <DialogContent dir="rtl">
                <DialogHeader><DialogTitle>إضافة على الراتب</DialogTitle></DialogHeader>
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
                      <SelectTrigger><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
                      <SelectContent>
                        {(emps as any[]).slice(0, 300).map((e) => <SelectItem key={e.id} value={e.id}>{e.employee_no} — {e.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>الشهر</Label><Input type="month" name="month" defaultValue={month} required /></div>
                  <div>
                    <Label>النوع</Label>
                    <Select name="kind" defaultValue="bonus">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>المبلغ</Label><Input type="number" step="0.01" name="amount" required /></div>
                  <div><Label>الوصف</Label><Input name="description" /></div>
                  <Button type="submit" className="w-full">حفظ</Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>النوع</TableHead><TableHead>الوصف</TableHead><TableHead>المبلغ</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {additions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.employees?.employee_no} — {a.employees?.full_name}</TableCell>
                  <TableCell>{KINDS[a.kind] ?? a.kind}</TableCell>
                  <TableCell>{a.description ?? "-"}</TableCell>
                  <TableCell className="font-semibold">{Number(a.amount).toLocaleString()}</TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف؟")) delAddition.mutate(a.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {!additions.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">لا توجد إضافات لهذا الشهر</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

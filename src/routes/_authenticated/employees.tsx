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
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Pencil, Search, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { useServerFn } from "@tanstack/react-start";
import { importEmployees } from "@/lib/employees.functions";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "الموظفون" }] }),
  component: EmployeesPage,
});

type Emp = { id: string; employee_no: string; full_name: string; department_id: string | null; position: string | null; status: string; departments?: { name: string } | null };

function EmployeesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [search, setSearch] = useState("");
  const doImport = useServerFn(importEmployees);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function handleExcel(file: File) {
    setImporting(true); setProgress(0); setImportMsg("جاري قراءة الملف...");
    try {
      const { parseEmployeesWorkbook } = await import("@/lib/excel-employees");
      const buf = await file.arrayBuffer();
      const { rows: parsed, skipped } = parseEmployeesWorkbook(buf);
      if (!parsed.length) throw new Error("لم يتم العثور على صفوف صالحة — تأكد من وجود أعمدة «التسلسل» و«اسم الموظف»");
      const CHUNK = 500;
      let done = 0;
      for (let i = 0; i < parsed.length; i += CHUNK) {
        const chunk = parsed.slice(i, i + CHUNK);
        await doImport({ data: { rows: chunk } });
        done += chunk.length;
        setProgress(Math.round((done / parsed.length) * 100));
        setImportMsg(`تم استيراد ${done} من ${parsed.length}...`);
      }
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      setImportMsg(`تم استيراد ${done} موظف${skipped ? ` (تم تجاهل ${skipped} صف بدون رقم/اسم أو مكرر)` : ""}`);
      toast.success(`تم استيراد ${done} موظف`);
    } catch (e: any) {
      setImportMsg(null);
      toast.error(e?.message ?? "فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  }


  const { data: rows = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("*, departments(name)").order("employee_no");
      if (error) throw error;
      return data as Emp[];
    },
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await supabase.from("departments").select("id, name").order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editing) { const { error } = await supabase.from("employees").update(d).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("employees").insert(d); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("employees").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = rows.filter((r) => !search || r.employee_no.includes(search) || r.full_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">الموظفون</h1>
          <p className="text-muted-foreground mt-1">إجمالي: {rows.length} موظف</p>
        </div>
        <div className="flex items-center gap-2">
          <input id="emp-excel" type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) handleExcel(f); }} />
          <Button variant="outline" disabled={importing} onClick={() => document.getElementById("emp-excel")?.click()}>
            {importing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
            استيراد من Excel
          </Button>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" /> موظف جديد</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>{editing ? "تعديل موظف" : "موظف جديد"}</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
              save.mutate({
                employee_no: f.get("employee_no") as string,
                full_name: f.get("full_name") as string,
                department_id: (f.get("department_id") as string) || null,
                position: (f.get("position") as string) || null,
                status: f.get("status") as any,
              });
            }} className="space-y-3">
              <div><Label>الرقم الوظيفي</Label><Input name="employee_no" required defaultValue={editing?.employee_no} /></div>
              <div><Label>الاسم الكامل</Label><Input name="full_name" required defaultValue={editing?.full_name} /></div>
              <div>
                <Label>القسم</Label>
                <Select name="department_id" defaultValue={editing?.department_id ?? "none"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون —</SelectItem>
                    {depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>المنصب</Label><Input name="position" defaultValue={editing?.position ?? ""} /></div>
              <div>
                <Label>الحالة</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="inactive">معطل</SelectItem>
                    <SelectItem value="terminated">منتهي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full">حفظ</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>القائمة</CardTitle>
          <div className="relative w-72">
            <Search className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input placeholder="بحث بالرقم أو الاسم..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>الاسم</TableHead><TableHead>القسم</TableHead><TableHead>المنصب</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.employee_no}</TableCell>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell>{e.departments?.name ?? "-"}</TableCell>
                  <TableCell>{e.position ?? "-"}</TableCell>
                  <TableCell><Badge variant={e.status === "active" ? "default" : "secondary"}>{e.status === "active" ? "نشط" : "معطل"}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف؟")) del.mutate(e.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>}
            </TableBody>
          </Table>
          {filtered.length > 200 && <p className="text-xs text-muted-foreground mt-3">يتم عرض أول 200 نتيجة فقط — استخدم البحث للتصفية.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

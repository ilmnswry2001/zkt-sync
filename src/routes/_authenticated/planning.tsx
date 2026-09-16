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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/planning")({
  head: () => ({
    meta: [
      { title: "التخطيط — مواقع العمل وأكواد التكلفة" },
      { name: "description", content: "إنشاء مواقع العمل وتحديد كود التكلفة CTR لكل موقع وربط الموظفين به." },
      { property: "og:title", content: "التخطيط — مواقع العمل وأكواد التكلفة" },
      { property: "og:description", content: "إدارة مواقع العمل وأكواد التكلفة CTR." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanningPage,
});

type Site = {
  id: string; name: string; ctr_code: string; client: string | null; location: string | null;
  description: string | null; start_date: string | null; end_date: string | null; status: string;
};

function PlanningPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("name");
      if (error) throw error;
      return data as Site[];
    },
  });

  const { data: counts = {} } = useQuery({
    queryKey: ["site-emp-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("employees").select("site_id");
      const map: Record<string, number> = {};
      (data ?? []).forEach((e: any) => { if (e.site_id) map[e.site_id] = (map[e.site_id] ?? 0) + 1; });
      return map;
    },
  });

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editing) { const { error } = await supabase.from("sites").update(d).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("sites").insert(d); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("sites").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sites"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">التخطيط</h1>
          <p className="text-muted-foreground mt-1">مواقع العمل وأكواد التكلفة (CTR) — {sites.length} موقع</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" /> موقع جديد</Button></DialogTrigger>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "تعديل موقع" : "موقع عمل جديد"}</DialogTitle></DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => (f.get(k) as string)?.trim() || null;
                save.mutate({
                  name: f.get("name") as string,
                  ctr_code: (f.get("ctr_code") as string).trim(),
                  client: v("client"), location: v("location"), description: v("description"),
                  start_date: v("start_date"), end_date: v("end_date"),
                  status: f.get("status") as string,
                });
              }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="col-span-2"><Label>اسم الموقع</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div><Label>كود التكلفة CTR</Label><Input name="ctr_code" required defaultValue={editing?.ctr_code} className="font-mono" /></div>
              <div><Label>الجهة / العميل</Label><Input name="client" defaultValue={editing?.client ?? ""} /></div>
              <div><Label>الموقع الجغرافي</Label><Input name="location" defaultValue={editing?.location ?? ""} /></div>
              <div>
                <Label>الحالة</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="planned">مخطط</SelectItem>
                    <SelectItem value="completed">منتهي</SelectItem>
                    <SelectItem value="suspended">متوقف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>تاريخ البدء</Label><Input type="date" name="start_date" defaultValue={editing?.start_date ?? ""} /></div>
              <div><Label>تاريخ الانتهاء</Label><Input type="date" name="end_date" defaultValue={editing?.end_date ?? ""} /></div>
              <div className="col-span-2"><Label>وصف</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
              <Button type="submit" className="col-span-2">حفظ</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>مواقع العمل</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>كود التكلفة</TableHead><TableHead>الموقع</TableHead><TableHead>العميل</TableHead>
                <TableHead>الفترة</TableHead><TableHead>الموظفون</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-semibold">{s.ctr_code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.client ?? "-"}</TableCell>
                  <TableCell className="text-xs">{s.start_date ?? "—"} → {s.end_date ?? "—"}</TableCell>
                  <TableCell>{(counts as any)[s.id] ?? 0}</TableCell>
                  <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(s); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف الموقع؟")) del.mutate(s.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!sites.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">لا توجد مواقع بعد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

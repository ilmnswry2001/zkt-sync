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
import { Trash2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/departments")({
  head: () => ({ meta: [{ title: "الأقسام" }] }),
  component: DepartmentsPage,
});

type Dept = { id: string; name: string; description: string | null };

function DepartmentsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dept | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      return data as Dept[];
    },
  });

  const save = useMutation({
    mutationFn: async (d: Partial<Dept>) => {
      if (editing) { const { error } = await supabase.from("departments").update(d).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("departments").insert(d as any); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("departments").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">الأقسام</h1>
          <p className="text-muted-foreground mt-1">إدارة أقسام الشركة</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" /> قسم جديد</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>{editing ? "تعديل" : "قسم جديد"}</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ name: f.get("name") as string, description: (f.get("description") as string) || null }); }} className="space-y-3">
              <div><Label>اسم القسم</Label><Input name="name" required defaultValue={editing?.name} /></div>
              <div><Label>الوصف</Label><Input name="description" defaultValue={editing?.description ?? ""} /></div>
              <Button type="submit" className="w-full">حفظ</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader><CardTitle>عدد الأقسام: {rows.length}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>الوصف</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{d.description ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(d); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف؟")) del.mutate(d.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">لا توجد أقسام</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

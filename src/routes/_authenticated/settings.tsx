import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "إعدادات التقارير" }] }),
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    if (!data?.some((role) => role.role === "admin")) throw redirect({ to: "/dashboard" });
  },
  component: SettingsPage,
});

type CatalogKind = "worker_specialty" | "equipment_type";
type CatalogItem = {
  id: string;
  kind: CatalogKind;
  name: string;
  sort_order: number;
  is_archived: boolean;
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const [newNames, setNewNames] = useState<Record<CatalogKind, string>>({
    worker_specialty: "",
    equipment_type: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const catalogQuery = useQuery({
    queryKey: ["report-catalogs", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_catalog_items")
        .select("id, kind, name, sort_order, is_archived")
        .order("kind")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
  });
  const items = catalogQuery.data ?? [];
  const workers = items.filter((item) => item.kind === "worker_specialty");
  const equipment = items.filter((item) => item.kind === "equipment_type");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["report-catalogs"] });

  const addItem = async (kind: CatalogKind) => {
    const name = newNames[kind].trim();
    if (!name) return toast.error("اكتب اسم البند أولاً");
    const maxOrder = Math.max(
      0,
      ...items.filter((item) => item.kind === kind).map((item) => item.sort_order),
    );
    const { error } = await supabase
      .from("report_catalog_items")
      .insert({ kind, name, sort_order: maxOrder + 10 });
    if (error)
      return toast.error(
        error.message.includes("duplicate") ? "هذا الاسم موجود مسبقاً" : error.message,
      );
    setNewNames((current) => ({ ...current, [kind]: "" }));
    await refresh();
    toast.success("تمت إضافة البند");
  };
  const saveName = async (item: CatalogItem) => {
    const name = editingName.trim();
    if (!name) return toast.error("لا يمكن ترك الاسم فارغاً");
    const { error } = await supabase
      .from("report_catalog_items")
      .update({ name })
      .eq("id", item.id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    await refresh();
    toast.success("تم تعديل الاسم");
  };
  const archive = async (item: CatalogItem) => {
    const { error } = await supabase
      .from("report_catalog_items")
      .update({ is_archived: !item.is_archived })
      .eq("id", item.id);
    if (error) return toast.error(error.message);
    await refresh();
    toast.success(item.is_archived ? "تمت إعادة تفعيل البند" : "تمت أرشفة البند");
  };
  const move = async (list: CatalogItem[], item: CatalogItem, direction: -1 | 1) => {
    const index = list.findIndex((entry) => entry.id === item.id);
    const target = list[index + direction];
    if (!target) return;
    const { error } = await supabase.from("report_catalog_items").upsert([
      {
        id: item.id,
        kind: item.kind,
        name: item.name,
        sort_order: target.sort_order,
        is_archived: item.is_archived,
      },
      {
        id: target.id,
        kind: target.kind,
        name: target.name,
        sort_order: item.sort_order,
        is_archived: target.is_archived,
      },
    ]);
    if (error) return toast.error(error.message);
    await refresh();
  };
  const renderCatalog = (title: string, kind: CatalogKind, list: CatalogItem[]) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          رتّب البنود كما تريد ظهورها في نموذج التقرير اليومي. الأرشفة لا تحذفها من التقارير
          السابقة.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label>إضافة بند جديد</Label>
            <Input
              value={newNames[kind]}
              onChange={(e) => setNewNames((current) => ({ ...current, [kind]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addItem(kind);
              }}
              placeholder="اكتب الاسم..."
            />
          </div>
          <Button className="mt-6" onClick={() => void addItem(kind)}>
            <Plus className="w-4 h-4 ml-2" />
            إضافة
          </Button>
        </div>
        <div className="divide-y rounded-lg border">
          {list.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 p-3 ${item.is_archived ? "opacity-60 bg-muted/30" : ""}`}
            >
              <div className="w-8 text-center text-sm text-muted-foreground">{index + 1}</div>
              {editingId === item.id ? (
                <>
                  <Input
                    className="flex-1"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void saveName(item)}
                    aria-label="حفظ"
                  >
                    <Check className="w-4 h-4 text-success" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    aria-label="إلغاء"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium">{item.name}</span>
                  {item.is_archived && <Badge variant="secondary">مؤرشف</Badge>}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void move(list, item, -1)}
                    disabled={index === 0}
                    aria-label="تحريك للأعلى"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void move(list, item, 1)}
                    disabled={index === list.length - 1}
                    aria-label="تحريك للأسفل"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingName(item.name);
                    }}
                    aria-label="تعديل"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void archive(item)}
                    aria-label={item.is_archived ? "إعادة تفعيل" : "أرشفة"}
                  >
                    {item.is_archived ? (
                      <RotateCcw className="w-4 h-4 text-success" />
                    ) : (
                      <Archive className="w-4 h-4 text-warning" />
                    )}
                  </Button>
                </>
              )}
            </div>
          ))}
          {!list.length && (
            <p className="p-6 text-center text-muted-foreground">لا توجد بنود بعد</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Settings2 className="w-7 h-7 text-primary" />
          <h1 className="text-3xl font-bold">إعدادات التقارير</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          إدارة القوائم التي تظهر في تقارير المواقع اليومية
        </p>
      </div>
      {catalogQuery.isLoading ? (
        <p className="text-muted-foreground">جارٍ التحميل...</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {renderCatalog("التخصصات — العاملون", "worker_specialty", workers)}
          {renderCatalog("أنواع الآليات والمركبات", "equipment_type", equipment)}
        </div>
      )}
    </div>
  );
}

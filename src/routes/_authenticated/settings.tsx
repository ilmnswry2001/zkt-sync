import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
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
import {
  newCatalogId,
  readLocalCatalog,
  writeLocalCatalog,
  type CatalogItem,
  type CatalogKind,
} from "@/lib/report-catalog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "الإعدادات" }] }),
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

const BASIC_SETTINGS_KEY = "zkt-basic-settings";

type BasicSettings = {
  systemName: string;
  companyManager: string;
};

function readBasicSettings(): BasicSettings {
  if (typeof window === "undefined") return { systemName: "نظام الحضور", companyManager: "" };
  try {
    const value = JSON.parse(window.localStorage.getItem(BASIC_SETTINGS_KEY) ?? "null");
    return {
      systemName: typeof value?.systemName === "string" ? value.systemName : "نظام الحضور",
      companyManager: typeof value?.companyManager === "string" ? value.companyManager : "",
    };
  } catch {
    return { systemName: "نظام الحضور", companyManager: "" };
  }
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const [newNames, setNewNames] = useState<Record<CatalogKind, string>>({
    worker_specialty: "",
    equipment_type: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [basicSettings, setBasicSettings] = useState<BasicSettings>(readBasicSettings);
  const catalogQuery = useQuery({
    queryKey: ["report-catalogs", "all"],
    queryFn: async (): Promise<{ items: CatalogItem[]; usingFallback: boolean }> => {
      const { data, error } = await supabase
        .from("report_catalog_items")
        .select("id, kind, name, sort_order, is_archived")
        .order("kind")
        .order("sort_order")
        .order("name");
      if (error || !data?.length) return { items: readLocalCatalog(), usingFallback: true };
      return { items: (data ?? []) as CatalogItem[], usingFallback: false };
    },
  });
  const items = catalogQuery.data?.items ?? [];
  const usingFallback = catalogQuery.data?.usingFallback ?? false;
  const workers = items.filter((item) => item.kind === "worker_specialty");
  const equipment = items.filter((item) => item.kind === "equipment_type");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["report-catalogs"] });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BASIC_SETTINGS_KEY, JSON.stringify(basicSettings));
    }
  }, [basicSettings]);

  const addItem = async (kind: CatalogKind) => {
    const name = newNames[kind].trim();
    if (!name) return toast.error("اكتب اسم التخصص أو البند أولاً");
    if (items.some((item) => item.kind === kind && item.name.trim() === name)) {
      return toast.error("هذا الاسم موجود مسبقاً");
    }
    const maxOrder = Math.max(
      0,
      ...items.filter((item) => item.kind === kind).map((item) => item.sort_order),
    );
    if (usingFallback) {
      writeLocalCatalog([
        ...items,
        { id: newCatalogId(), kind, name, sort_order: maxOrder + 10, is_archived: false },
      ]);
    } else {
      const { error } = await supabase
        .from("report_catalog_items")
        .insert({ kind, name, sort_order: maxOrder + 10 });
      if (error) return toast.error(error.message);
    }
    setNewNames((current) => ({ ...current, [kind]: "" }));
    await refresh();
    toast.success("تمت إضافة البند وسيظهر فوراً في تقرير المواقع");
  };

  const saveName = async (item: CatalogItem) => {
    const name = editingName.trim();
    if (!name) return toast.error("لا يمكن ترك الاسم فارغاً");
    if (usingFallback) {
      writeLocalCatalog(items.map((entry) => (entry.id === item.id ? { ...entry, name } : entry)));
    } else {
      const { error } = await supabase
        .from("report_catalog_items")
        .update({ name })
        .eq("id", item.id);
      if (error) return toast.error(error.message);
    }
    setEditingId(null);
    await refresh();
    toast.success("تم تعديل الاسم");
  };

  const archive = async (item: CatalogItem) => {
    if (usingFallback) {
      writeLocalCatalog(
        items.map((entry) =>
          entry.id === item.id ? { ...entry, is_archived: !item.is_archived } : entry,
        ),
      );
    } else {
      const { error } = await supabase
        .from("report_catalog_items")
        .update({ is_archived: !item.is_archived })
        .eq("id", item.id);
      if (error) return toast.error(error.message);
    }
    await refresh();
    toast.success(item.is_archived ? "تمت إعادة تفعيل البند" : "تمت أرشفة البند");
  };

  const move = async (list: CatalogItem[], item: CatalogItem, direction: -1 | 1) => {
    const index = list.findIndex((entry) => entry.id === item.id);
    const target = list[index + direction];
    if (!target) return;
    if (usingFallback) {
      writeLocalCatalog(
        items.map((entry) => {
          if (entry.id === item.id) return { ...entry, sort_order: target.sort_order };
          if (entry.id === target.id) return { ...entry, sort_order: item.sort_order };
          return entry;
        }),
      );
    } else {
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
    }
    await refresh();
  };

  const renderCatalog = (title: string, kind: CatalogKind, list: CatalogItem[]) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          كل بند نشط يظهر تلقائياً في نموذج تقرير المواقع اليومية. الأرشفة لا تحذف البند من التقارير
          السابقة.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label>
              {kind === "worker_specialty" ? "إضافة تخصص جديد" : "إضافة نوع آلية أو مركبة"}
            </Label>
            <Input
              value={newNames[kind]}
              onChange={(e) => setNewNames((current) => ({ ...current, [kind]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addItem(kind);
              }}
              placeholder={
                kind === "worker_specialty" ? "مثال: مهندس اتصالات" : "مثال: سيارة صالون"
              }
            />
          </div>
          <Button className="mt-6" onClick={() => void addItem(kind)}>
            <Plus className="w-4 h-4 ml-2" /> إضافة
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
          <h1 className="text-3xl font-bold">الإعدادات</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          إدارة التقارير اليومية والإعدادات الأساسية للنظام
        </p>
      </div>
      <Tabs defaultValue="reports" dir="rtl">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="reports">إعدادات التقارير اليومية</TabsTrigger>
          <TabsTrigger value="basic">الإعدادات الأساسية</TabsTrigger>
        </TabsList>
        <TabsContent value="reports" className="space-y-5">
          {usingFallback && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <b>وضع توافق مؤقت:</b> جدول الإعدادات لم تتم مزامنته بعد مع قاعدة البيانات؛ التخصصات
                المعروضة والإضافات محفوظة في هذا المتصفح وستظهر فوراً في التقارير اليومية.
              </div>
            </div>
          )}
          {catalogQuery.error && (
            <p className="text-destructive">
              تعذر تحميل قائمة التخصصات: {catalogQuery.error.message}
            </p>
          )}
          {catalogQuery.isLoading ? (
            <p className="text-muted-foreground">جارٍ تحميل التخصصات والآليات...</p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {renderCatalog("التخصصات — العاملون", "worker_specialty", workers)}
              {renderCatalog("أنواع الآليات والمركبات", "equipment_type", equipment)}
            </div>
          )}
        </TabsContent>
        <TabsContent value="basic">
          <Card>
            <CardHeader>
              <CardTitle>الإعدادات الأساسية</CardTitle>
              <p className="text-sm text-muted-foreground">
                هذه البيانات تحفظ محلياً حالياً إلى أن تتم مزامنة جدول إعدادات النظام.
              </p>
            </CardHeader>
            <CardContent className="max-w-xl space-y-5">
              <div>
                <Label>اسم النظام</Label>
                <Input
                  value={basicSettings.systemName}
                  onChange={(e) =>
                    setBasicSettings((current) => ({ ...current, systemName: e.target.value }))
                  }
                  placeholder="نظام الحضور"
                />
              </div>
              <div>
                <Label>اسم مدير الشركة</Label>
                <Input
                  value={basicSettings.companyManager}
                  onChange={(e) =>
                    setBasicSettings((current) => ({ ...current, companyManager: e.target.value }))
                  }
                  placeholder="اكتب اسم مدير الشركة"
                />
              </div>
              <Button onClick={() => toast.success("تم حفظ الإعدادات الأساسية")}>
                حفظ الإعدادات
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

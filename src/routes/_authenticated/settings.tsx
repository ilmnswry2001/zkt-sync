import { formatErrorMessage } from "@/lib/error-message";
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
  Clock3,
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
import { getDefaultWage } from "@/lib/wage-defaults";

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

type ShiftRule = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
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
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftForm, setShiftForm] = useState({
    name: "",
    start_time: "08:00",
    end_time: "17:00",
    grace_minutes: "0",
  });
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
  const shiftsQuery = useQuery({
    queryKey: ["settings", "shift-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("id, name, start_time, end_time, grace_minutes")
        .order("name");
      if (error) throw error;
      return (data ?? []) as ShiftRule[];
    },
  });
  const shifts = shiftsQuery.data ?? [];

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
      if (error) return toast.error(formatErrorMessage(error));
      if (kind === "worker_specialty") {
        const wage = getDefaultWage(name);
        const { error: wageError } = await supabase.from("wage_rates").upsert(
          { title: name, ...wage },
          { onConflict: "title", ignoreDuplicates: true },
        );
        if (wageError) return toast.error(`تمت إضافة التخصص لكن تعذر إنشاء أجره الافتراضي: ${formatErrorMessage(wageError)}`);
      }
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
      if (error) return toast.error(formatErrorMessage(error));
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
      if (error) return toast.error(formatErrorMessage(error));
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
      if (error) return toast.error(formatErrorMessage(error));
    }
    await refresh();
  };

  const saveShift = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = shiftForm.name.trim();
    if (!name || !shiftForm.start_time || !shiftForm.end_time) {
      return toast.error("أدخل اسم الدوام ووقت البداية والنهاية");
    }
    const payload = {
      name,
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      grace_minutes: Math.max(0, Number(shiftForm.grace_minutes) || 0),
    };
    const result = editingShiftId
      ? await supabase.from("shifts").update(payload).eq("id", editingShiftId)
      : await supabase.from("shifts").insert(payload);
    if (result.error) return toast.error(formatErrorMessage(result.error));
    setEditingShiftId(null);
    setShiftForm({ name: "", start_time: "08:00", end_time: "17:00", grace_minutes: "0" });
    await queryClient.invalidateQueries({ queryKey: ["settings", "shift-rules"] });
    toast.success("تم حفظ قاعدة الدوام");
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
          <TabsTrigger value="work-rules">أوقات الدوام والإضافي</TabsTrigger>
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
        <TabsContent value="work-rules" className="space-y-5">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="h-5 w-5 text-primary" />
                قواعد الدوام الرسمي واحتساب الإضافي
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                يحدد وقت النهاية الحد الذي يبدأ بعده احتساب الوقت الإضافي من سجلات البصمة. ويُضاف
                هامش السماح قبل بدء الاحتساب. يجب تحديد أجر الساعة الإضافية لكل فئة من قسم الأجور
                والمكافآت.
              </p>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{editingShiftId ? "تعديل قاعدة دوام" : "إضافة قاعدة دوام"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveShift} className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <Label>اسم الدوام</Label>
                  <Input
                    required
                    value={shiftForm.name}
                    onChange={(e) => setShiftForm((v) => ({ ...v, name: e.target.value }))}
                    placeholder="الدوام الرسمي"
                  />
                </div>
                <div>
                  <Label>بداية الدوام</Label>
                  <Input
                    required
                    type="time"
                    value={shiftForm.start_time}
                    onChange={(e) => setShiftForm((v) => ({ ...v, start_time: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>نهاية الدوام</Label>
                  <Input
                    required
                    type="time"
                    value={shiftForm.end_time}
                    onChange={(e) => setShiftForm((v) => ({ ...v, end_time: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>هامش السماح بالدقائق</Label>
                  <Input
                    type="number"
                    min="0"
                    max="180"
                    value={shiftForm.grace_minutes}
                    onChange={(e) => setShiftForm((v) => ({ ...v, grace_minutes: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2 md:col-span-4">
                  <Button type="submit">{editingShiftId ? "حفظ التعديل" : "إضافة قاعدة"}</Button>
                  {editingShiftId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingShiftId(null);
                        setShiftForm({
                          name: "",
                          start_time: "08:00",
                          end_time: "17:00",
                          grace_minutes: "0",
                        });
                      }}
                    >
                      إلغاء
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>قواعد الدوام المسجلة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {shiftsQuery.isLoading && (
                <p className="text-muted-foreground">جارٍ تحميل قواعد الدوام...</p>
              )}
              {shiftsQuery.error && (
                <p className="text-destructive">
                  تعذر تحميل قواعد الدوام: {shiftsQuery.error.message}
                </p>
              )}
              {shifts.map((shift) => (
                <div
                  key={shift.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-semibold">{shift.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {shift.start_time.slice(0, 5)} — {shift.end_time.slice(0, 5)} · هامش السماح{" "}
                      {shift.grace_minutes} دقيقة
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingShiftId(shift.id);
                      setShiftForm({
                        name: shift.name,
                        start_time: shift.start_time.slice(0, 5),
                        end_time: shift.end_time.slice(0, 5),
                        grace_minutes: String(shift.grace_minutes),
                      });
                    }}
                  >
                    تعديل
                  </Button>
                </div>
              ))}
              {!shiftsQuery.isLoading && !shifts.length && (
                <p className="py-6 text-center text-muted-foreground">
                  لا توجد قواعد دوام. أضف أول قاعدة الآن.
                </p>
              )}
            </CardContent>
          </Card>
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

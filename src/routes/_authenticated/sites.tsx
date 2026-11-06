import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Banknote,
  ClipboardList,
  Copy,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { getDefaultWage } from "@/lib/wage-defaults";

export const Route = createFileRoute("/_authenticated/sites")({
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", auth.user.id);
    if (error) throw redirect({ to: "/attendance" });
    const roles = new Set<string>((data ?? []).map((row) => row.role));
    if (!["admin", "hr", "supervisor", "department_manager"].some((role) => roles.has(role))) throw redirect({ to: "/attendance" });
  },
  head: () => ({
    meta: [
      { title: "المواقع — إدارة مواقع العمل وأكواد التكلفة" },
      {
        name: "description",
        content: "إدارة مواقع العمل وتحديد كود التكلفة CTR وربط الموظفين وإداريي المواقع بها.",
      },
      { property: "og:title", content: "المواقع — إدارة مواقع العمل وأكواد التكلفة" },
      { property: "og:description", content: "إدارة مواقع العمل وأكواد التكلفة وإداريي المواقع." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanningPage,
});

type Site = {
  id: string;
  name: string;
  ctr_code: string;
  client: string | null;
  location: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  site_admin_employee_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function PlanningPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").order("name");
      if (error) throw error;
      return data as Site[];
    },
  });

  const { data: siteAdmins = [], error: siteAdminsError } = useQuery({
    queryKey: ["site-administrators"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, employee_no, position, site_id")
        .eq("status", "active")
        .order("full_name");
      if (error) throw error;
      // لا نرشح حسب المسمى؛ قاعدة البيانات لا تضمن أن كلمة إداري موجودة في position.
      // كل موظف نشط يمكن تعيينه كإداري موقع، ثم يُحفظ UUID الخاص به في sites.
      return data ?? [];
    },
  });
  const { data: costData = { employees: [], rates: [] } } = useQuery({
    queryKey: ["site-employee-costs"],
    queryFn: async () => {
      const [employeesResult, ratesResult] = await Promise.all([
        (supabase as any)
          .from("employees")
          .select(
            "id, site_id, position, wage_rate_id, base_salary, wage_rates(title, monthly_rate, daily_rate, currency)",
          )
          .eq("status", "active"),
        supabase.from("wage_rates").select("title, monthly_rate, daily_rate, currency"),
      ]);
      if (employeesResult.error) throw employeesResult.error;
      if (ratesResult.error) throw ratesResult.error;
      return {
        employees: (employeesResult.data ?? []) as any[],
        rates: (ratesResult.data ?? []) as any[],
      };
    },
  });
  const { data: sitePlans = [] } = useQuery({
    queryKey: ["site-work-plan-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_work_plans")
        .select("id, site_id, status, assigned_staff")
        .neq("status", "finalized")
        .limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });
  const siteEmployees = costData.employees;
  const siteSummary = useMemo(() => {
    const result: Record<
      string,
      { employees: number; monthly: number; daily: number; specialties: Record<string, number> }
    > = {};
    const wagesByTitle = new Map(costData.rates.map((rate: any) => [rate.title.trim(), rate]));
    for (const employee of siteEmployees) {
      if (!employee.site_id) continue;
      const linkedWage = Array.isArray(employee.wage_rates)
        ? employee.wage_rates[0]
        : employee.wage_rates;
      const rawWage = linkedWage ?? wagesByTitle.get(employee.position?.trim());
      const defaults = getDefaultWage(rawWage?.title ?? employee.position ?? "");
      const wage = rawWage
        ? {
            ...rawWage,
            daily_rate: Number(rawWage.daily_rate) > 0 ? rawWage.daily_rate : defaults.daily_rate,
            monthly_rate:
              Number(rawWage.monthly_rate) > 0 ? rawWage.monthly_rate : defaults.monthly_rate,
          }
        : defaults;
      const monthly =
        Number(employee.base_salary) > 0 ? Number(employee.base_salary) : Number(wage.monthly_rate);
      const daily = Number(wage.daily_rate ?? (monthly ? monthly / 26 : 0));
      const current = result[employee.site_id] ?? {
        employees: 0,
        monthly: 0,
        daily: 0,
        specialties: {},
      };
      current.employees += 1;
      current.monthly += monthly;
      current.daily += daily;
      const specialty = wage?.title ?? employee.position ?? "بدون تخصص / أجر";
      current.specialties[specialty] = (current.specialties[specialty] ?? 0) + 1;
      result[employee.site_id] = current;
    }
    return result;
  }, [costData.rates, siteEmployees]);
  const plansBySite = useMemo(() => {
    const result: Record<string, { plans: number; workers: number }> = {};
    for (const plan of sitePlans) {
      const summary = result[plan.site_id] ?? { plans: 0, workers: 0 };
      summary.plans += 1;
      if (Array.isArray(plan.assigned_staff)) {
        for (const assignment of plan.assigned_staff) {
          if (!assignment || typeof assignment !== "object") continue;
          const item = assignment as { names?: unknown; employees?: unknown };
          if (Array.isArray(item.names)) summary.workers += item.names.length;
          else if (Array.isArray(item.employees)) summary.workers += item.employees.length;
        }
      }
      result[plan.site_id] = summary;
    }
    return result;
  }, [sitePlans]);
  const filteredSites = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar");
    return sites.filter((site) => {
      const matchesTerm = !term ||
        `${site.name} ${site.ctr_code} ${site.status}`.toLocaleLowerCase("ar").includes(term);
      return matchesTerm && (statusFilter === "all" || site.status === statusFilter);
    });
  }, [search, sites, statusFilter]);
  const activeSiteCount = sites.filter((site) => site.status === "active").length;
  const ctrSiteCount = sites.filter((site) => site.ctr_code?.trim()).length;
  const geoSiteCount = sites.filter((site) => site.latitude != null && site.longitude != null).length;

  const save = useMutation({
    mutationFn: async (d: any) => {
      if (editing) {
        const { error } = await supabase.from("sites").update(d).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sites").insert(d);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites"] });
      setOpen(false);
      setEditing(null);
      toast.success("تم الحفظ");
    },
    onError: (e: any) => toast.error(formatErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites"] });
      toast.success("تم الحذف");
    },
    onError: (e: any) => toast.error(formatErrorMessage(e)),
  });

  return (
    <div className="space-y-6">
      {siteAdminsError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          تعذر تحميل أسماء الإداريين من قاعدة البيانات:{" "}
          {(siteAdminsError as any).message ?? "تحقق من اتصال Lovable Cloud"}
        </div>
      )}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">المواقع</h1>
          <p className="text-muted-foreground mt-1">
            إدارة مواقع العمل وأكواد التكلفة (CTR) — {sites.length} موقع
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 ml-2" /> إضافة موقع
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "تعديل موقع" : "موقع عمل جديد"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const v = (k: string) => (f.get(k) as string)?.trim() || null;
                const siteAdminId = v("site_admin_employee_id");
                const latitudeValue = v("latitude");
                const longitudeValue = v("longitude");
                if (!siteAdminId || siteAdminId === "none") {
                  toast.error("اختيار إداري الموقع مطلوب");
                  return;
                }
                if (Boolean(latitudeValue) !== Boolean(longitudeValue)) {
                  toast.error("أدخل خط العرض والطول معًا");
                  return;
                }
                const latitude = latitudeValue === null ? null : Number(latitudeValue);
                const longitude = longitudeValue === null ? null : Number(longitudeValue);
                if (
                  (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
                  (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
                ) {
                  toast.error("إحداثيات GPS خارج النطاق الصحيح");
                  return;
                }
                save.mutate({
                  name: f.get("name") as string,
                  ctr_code: (f.get("ctr_code") as string).trim(),
                  client: v("client"),
                  location: v("location"),
                  description: v("description"),
                  start_date: v("start_date"),
                  end_date: v("end_date"),
                  status: f.get("status") as string,
                  site_admin_employee_id: siteAdminId,
                  latitude,
                  longitude,
                });
              }}
              className="grid grid-cols-2 gap-3"
            >
              <div className="col-span-2">
                <Label>اسم الموقع</Label>
                <Input name="name" required defaultValue={editing?.name} />
              </div>
              <div>
                <Label>كود التكلفة CTR</Label>
                <Input
                  name="ctr_code"
                  required
                  defaultValue={editing?.ctr_code}
                  className="font-mono"
                />
              </div>
              <div>
                <Label>الجهة / العميل</Label>
                <Input name="client" defaultValue={editing?.client ?? ""} />
              </div>
              <div>
                <Label>الموقع الجغرافي</Label>
                <Input name="location" defaultValue={editing?.location ?? ""} />
              </div>
              <div>
                <Label>خط العرض</Label>
                <Input
                  type="number"
                  step="any"
                  name="latitude"
                  defaultValue={editing?.latitude ?? ""}
                  dir="ltr"
                  placeholder="33.3152"
                />
              </div>
              <div>
                <Label>خط الطول</Label>
                <Input
                  type="number"
                  step="any"
                  name="longitude"
                  defaultValue={editing?.longitude ?? ""}
                  dir="ltr"
                  placeholder="44.3661"
                />
              </div>
              <div>
                <Label>الحالة</Label>
                <Select name="status" defaultValue={editing?.status ?? "active"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="planned">مخطط</SelectItem>
                    <SelectItem value="completed">منتهي</SelectItem>
                    <SelectItem value="suspended">متوقف</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>تاريخ البدء</Label>
                <Input type="date" name="start_date" defaultValue={editing?.start_date ?? ""} />
              </div>
              <div>
                <Label>تاريخ الانتهاء</Label>
                <Input type="date" name="end_date" defaultValue={editing?.end_date ?? ""} />
              </div>
              <div className="col-span-2">
                <Label>إداري الموقع المسؤول عن التقرير *</Label>
                <Select
                  name="site_admin_employee_id"
                  defaultValue={editing?.site_admin_employee_id ?? "none"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="اختر إداري الموقع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— اختر إداري الموقع —</SelectItem>
                    {siteAdmins.map((employee: any) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.full_name} — {employee.employee_no}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!siteAdmins.length && (
                  <p className="text-xs text-warning mt-1">
                    لا توجد أسماء موظفين نشطين متاحة. تحقق من اتصال قاعدة البيانات وصلاحية القراءة.
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <Label>وصف</Label>
                <Input name="description" defaultValue={editing?.description ?? ""} />
              </div>
              <Button type="submit" className="col-span-2">
                حفظ
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "إجمالي المواقع", value: sites.length, icon: MapPin },
          { label: "المواقع النشطة", value: activeSiteCount, icon: Activity },
          { label: "مرتبطة بكود CTR", value: ctrSiteCount, icon: Banknote },
          { label: "بإحداثيات GPS", value: geoSiteCount, icon: MapPin },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <stat.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold tabular-nums">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="min-h-11 pr-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث باسم الموقع أو كود CTR..."
            aria-label="البحث في المواقع"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="min-h-11 sm:w-48">
            <SelectValue placeholder="كل الحالات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="planned">مخطط</SelectItem>
            <SelectItem value="suspended">معلق</SelectItem>
            <SelectItem value="completed">منتهي</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredSites.map((site) => {
          const coordinates =
            site.latitude != null && site.longitude != null
              ? `${site.latitude}, ${site.longitude}`
              : null;
          const manager = siteAdmins.find(
            (employee: any) => employee.id === site.site_admin_employee_id,
          );
          const sitePlanSummary = plansBySite[site.id] ?? { plans: 0, workers: 0 };
          const statusLabel =
            site.status === "active"
              ? "نشط"
              : site.status === "suspended"
                ? "معلق"
                : site.status === "planned"
                  ? "مخطط"
                  : site.status === "completed"
                    ? "منتهي"
                    : site.status;
          return (
            <Card key={site.id} className="overflow-hidden">
              <CardHeader className="space-y-3 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-lg">{site.name}</CardTitle>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {site.client || "موقع عمل"}
                    </p>
                  </div>
                  <Badge variant={site.status === "active" ? "default" : "secondary"}>
                    {statusLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground">كود التكلفة CTR</span>
                  <Badge variant="outline" className="font-mono text-sm font-bold text-primary">
                    {site.ctr_code || "غير محدد"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground">إحداثيات GPS</p>
                    {coordinates ? (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span dir="ltr" className="truncate font-mono text-xs">{coordinates}</span>
                        <div className="flex shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="نسخ الإحداثيات"
                            title="نسخ الإحداثيات"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(coordinates);
                                toast.success("تم نسخ الإحداثيات");
                              } catch {
                                toast.error("تعذر نسخ الإحداثيات");
                              }
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button asChild type="button" variant="ghost" size="icon" className="h-8 w-8">
                            <a
                              href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="فتح الموقع على الخريطة"
                              title="فتح الموقع على الخريطة"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">الإحداثيات غير محددة</p>
                    )}
                    {site.location && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">{site.location}</p>
                    )}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground">المشرف المسؤول</p>
                    <p className="mt-2 truncate text-sm font-medium">
                      {manager?.full_name || "غير محدد"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {site.start_date || "—"} {site.end_date ? ` إلى ${site.end_date}` : ""}
                    </p>
                  </div>
                </div>
                {site.description && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">وصف العمل / النطاق</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{site.description}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(siteSummary[site.id]?.specialties ?? {}).map(([title, count]) => (
                    <Badge key={title} variant="outline">{title} · {count}</Badge>
                  ))}
                  {!siteSummary[site.id]?.employees && (
                    <span className="text-xs text-muted-foreground">لا يوجد موظفون مسجلون للموقع</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-primary" />
                    <span>{sitePlanSummary.plans} خطة جارية</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span>{sitePlanSummary.workers} كادر مسكّن</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-2 border-t pt-2 font-semibold">
                    <Banknote className="h-4 w-4 text-primary" />
                    <span>التكلفة الشهرية: {(siteSummary[site.id]?.monthly ?? 0).toLocaleString("ar-IQ")} د.ع</span>
                  </div>
                </div>
                <div className="flex justify-end gap-1 border-t pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`تعديل ${site.name}`}
                    title="تعديل الموقع"
                    onClick={() => {
                      setEditing(site);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`حذف ${site.name}`}
                    title="حذف الموقع"
                    onClick={() => {
                      if (confirm(`حذف موقع ${site.name}؟`)) del.mutate(site.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!filteredSites.length && (
          <Card className="xl:col-span-2">
            <CardContent className="p-8 text-center text-muted-foreground">
              {sites.length ? "لا توجد مواقع مطابقة للتصفية" : "لا توجد مواقع بعد"}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Banknote, Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { getDefaultWage } from "@/lib/wage-defaults";

export const Route = createFileRoute("/_authenticated/planning")({
  head: () => ({
    meta: [
      { title: "التخطيط — مواقع العمل وأكواد التكلفة" },
      {
        name: "description",
        content: "إنشاء مواقع العمل وتحديد كود التكلفة CTR لكل موقع وربط الموظفين به.",
      },
      { property: "og:title", content: "التخطيط — مواقع العمل وأكواد التكلفة" },
      { property: "og:description", content: "إدارة مواقع العمل وأكواد التكلفة CTR." },
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
};

type WorkPlanSpecialty = {
  specialty: string;
  quantity: number;
  heavy_equipment: boolean;
  notes: string;
  color: string;
};

type WorkPlanAssignment = {
  name: string;
  specialty: string;
  notes: string;
  source: "internal" | "manual";
};

type SiteWorkPlan = {
  id: string;
  site_id: string;
  site_name: string;
  requested_by_name: string;
  request_date: string;
  status: "requested" | "planning_approved" | "management_review" | "finalized";
  request_notes: string | null;
  planning_notes: string | null;
  management_notes: string | null;
  specialties: WorkPlanSpecialty[];
  assigned_staff: WorkPlanAssignment[];
  final_plan: {
    title: string;
    summary: string;
    notes: string;
    specialties: WorkPlanSpecialty[];
  } | null;
  created_at: string;
  updated_at: string;
};

const WORK_PLAN_SPECIALTIES = [
  "عامل بناء",
  "حداد",
  "نجار",
  "كهربائي",
  "سباك",
  "عامل تجهيز",
  "مقاول/مشرف",
  "مشرف موقع",
  "مهندس موقع",
  "آليات ثقيلة",
  "عامل خراطة",
  "مدخل بيانات",
];

type WorkPlanTab = "request" | "requested" | "management" | "final";

const WORK_PLAN_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
  "#f97316",
  "#0ea5e9",
  "#84cc16",
  "#a855f7",
  "#ec4899",
];

const planStatusLabel: Record<SiteWorkPlan["status"], string> = {
  requested: "في انتظار التخطيط",
  planning_approved: "موافق عليه من التخطيط",
  management_review: "قيد إدراج الكوادر",
  finalized: "الخطة النهائية",
};

function newPlanSpecialty(index = 0): WorkPlanSpecialty {
  return {
    specialty: WORK_PLAN_SPECIALTIES[index % WORK_PLAN_SPECIALTIES.length],
    quantity: 1,
    heavy_equipment: index === 9,
    notes: "",
    color: WORK_PLAN_COLORS[index % WORK_PLAN_COLORS.length],
  };
}

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
      (data ?? []).forEach((e: any) => {
        if (e.site_id) map[e.site_id] = (map[e.site_id] ?? 0) + 1;
      });
      return map;
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
  const totalMonthly = Object.values(siteSummary).reduce((sum, item) => sum + item.monthly, 0);

  const [activeWorkPlanTab, setActiveWorkPlanTab] = useState<WorkPlanTab>("request");
  const [requestSiteId, setRequestSiteId] = useState<string>(sites[0]?.id ?? "");
  const [requestDate, setRequestDate] = useState(new Date().toISOString().slice(0, 10));
  const [requestNotes, setRequestNotes] = useState("");
  const [draftSpecialties, setDraftSpecialties] = useState<WorkPlanSpecialty[]>([
    newPlanSpecialty(0),
    newPlanSpecialty(1),
    newPlanSpecialty(2),
  ]);
  const [managementNote, setManagementNote] = useState<Record<string, string>>({});
  const [managementDraft, setManagementDraft] = useState<Record<string, WorkPlanAssignment>>({});
  const [finalPlanTitle, setFinalPlanTitle] = useState<Record<string, string>>({});
  const [finalPlanNotes, setFinalPlanNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (sites.length && !requestSiteId) setRequestSiteId(sites[0].id);
  }, [sites, requestSiteId]);

  const workPlansQuery = useQuery({
    queryKey: ["site-work-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_work_plans").select("*").order("request_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        site_id: row.site_id,
        site_name: (row.site_name ?? row.site?.name ?? "موقع غير محدد"),
        requested_by_name: row.requested_by_name ?? "غير محدد",
        request_date: row.request_date,
        status: row.status,
        request_notes: row.request_notes ?? null,
        planning_notes: row.planning_notes ?? null,
        management_notes: row.management_notes ?? null,
        specialties: Array.isArray(row.specialties) ? row.specialties : [],
        assigned_staff: Array.isArray(row.assigned_staff) ? row.assigned_staff : [],
        final_plan: row.final_plan ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })) as SiteWorkPlan[];
    },
    retry: 1,
  });

  const workPlans = workPlansQuery.data ?? [];
  const requestedPlans = workPlans.filter((plan) => plan.status === "requested");
  const planningApprovedPlans = workPlans.filter((plan) => plan.status === "planning_approved");
  const managementReviewPlans = workPlans.filter((plan) => plan.status === "management_review");
  const finalPlans = workPlans.filter((plan) => plan.status === "finalized");

  const createWorkPlanRequest = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      const validSpecialties = draftSpecialties.filter(
        (item) => item.specialty.trim() && Number(item.quantity) > 0,
      );
      if (!requestSiteId) throw new Error("اختر موقعاً أولاً");
      if (!validSpecialties.length) throw new Error("أدخل تخصص واحد على الأقل");
      if (!user) throw new Error("يجب تسجيل الدخول أولاً");

      const selectedSite = sites.find((site) => site.id === requestSiteId);
      const payload = {
        site_id: requestSiteId,
        site_name: selectedSite?.name ?? "موقع غير محدد",
        requested_by: user.id,
        requested_by_name: user.user_metadata?.full_name || user.email || "مهندس مسؤول",
        request_date: requestDate,
        status: "requested",
        request_notes: requestNotes.trim() || null,
        planning_notes: null,
        management_notes: null,
        specialties: validSpecialties.map((item) => ({
          specialty: item.specialty.trim(),
          quantity: Number(item.quantity),
          heavy_equipment: Boolean(item.heavy_equipment),
          notes: item.notes.trim(),
          color: item.color,
        })),
        assigned_staff: [],
        final_plan: null,
      };

      const { error } = await supabase.from("site_work_plans").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      setActiveWorkPlanTab("requested");
      setRequestNotes("");
      setDraftSpecialties([newPlanSpecialty(0), newPlanSpecialty(1), newPlanSpecialty(2)]);
      toast.success("تم إرسال الخطة إلى قسم التخطيط");
    },
    onError: (error: any) =>
      toast.error(
        error?.message?.includes("site_work_plans")
          ? "جدول خطط الأعمال غير موجود في قاعدة البيانات. نفّذ Migration الخاص به أولاً في Lovable Cloud."
          : error?.message ?? "تعذر إرسال الخطة",
      ),
  });

  const updatePlanStatus = useMutation({
    mutationFn: async ({ id, status, planningNotes, managementNotes }: { id: string; status: SiteWorkPlan["status"]; planningNotes?: string; managementNotes?: string }) => {
      const payload: Record<string, string | null> = {};
      if (planningNotes !== undefined) payload.planning_notes = planningNotes.trim() || null;
      if (managementNotes !== undefined) payload.management_notes = managementNotes.trim() || null;
      payload.status = status;

      const { error } = await supabase.from("site_work_plans").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      toast.success("تم تحديث حالة الخطة");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر تحديث الخطة"),
  });

  const finalizePlan = useMutation({
    mutationFn: async ({ id, finalTitle, finalNotes }: { id: string; finalTitle: string; finalNotes: string }) => {
      const plan = workPlans.find((item) => item.id === id);
      const payload = {
        status: "finalized",
        management_notes: plan?.management_notes ?? null,
        final_plan: {
          title: finalTitle.trim() || `الخطة النهائية - ${plan?.site_name ?? "الموقع"}`,
          summary: finalTitle.trim() || `الخطة النهائية - ${plan?.site_name ?? "الموقع"}`,
          notes: finalNotes.trim() || "-",
          specialties: plan?.specialties ?? [],
        },
      };
      const { error } = await supabase.from("site_work_plans").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      setActiveWorkPlanTab("final");
      toast.success("تم تأكيد الخطة النهائية واستعراضها في قسم الخطة النهائية");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر إغلاق الخطة النهائية"),
  });

  const addPlanSpecialty = () => {
    setDraftSpecialties((current) => [...current, newPlanSpecialty(current.length)]);
  };

  const updateDraftSpecialty = (
    index: number,
    field: keyof WorkPlanSpecialty,
    value: string | number | boolean,
  ) => {
    setDraftSpecialties((current) =>
      current.map((item, idx) => {
        if (idx !== index) return item;
        return { ...item, [field]: value } as WorkPlanSpecialty;
      }),
    );
  };

  const removeDraftSpecialty = (index: number) => {
    setDraftSpecialties((current) => current.filter((_, idx) => idx !== index));
  };

  const addManagementAssignment = (planId: string) => {
    const draft = managementDraft[planId] ?? { name: "", specialty: "", notes: "", source: "manual" as const };
    if (!draft.name.trim() || !draft.specialty.trim()) {
      toast.error("أدخل اسم الكادر والتخصص أولاً");
      return;
    }
    const plan = workPlans.find((item) => item.id === planId);
    const nextAssignments = [...(plan?.assigned_staff ?? []), { ...draft, name: draft.name.trim(), specialty: draft.specialty.trim(), notes: draft.notes.trim() }];
    supabase
      .from("site_work_plans")
      .update({ assigned_staff: nextAssignments, status: "management_review" })
      .eq("id", planId)
      .then(({ error }) => {
        if (error) throw error;
        qc.invalidateQueries({ queryKey: ["site-work-plans"] });
        setManagementDraft((current) => ({ ...current, [planId]: { name: "", specialty: "", notes: "", source: "manual" } }));
        toast.success("تم إدراج الكادر في الخطة");
      })
      .catch((error: any) => toast.error(error?.message ?? "تعذر إدراج الكادر"));
  };

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
    onError: (e: any) => toast.error(e.message),
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
    onError: (e: any) => toast.error(e.message),
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
          <h1 className="text-3xl font-bold">التخطيط</h1>
          <p className="text-muted-foreground mt-1">
            مواقع العمل وأكواد التكلفة (CTR) — {sites.length} موقع
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
              <Plus className="w-4 h-4 ml-2" /> موقع جديد
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
                if (!siteAdminId) {
                  toast.error("اختيار إداري الموقع مطلوب");
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-primary p-3">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الموظفين بالمواقع</p>
              <p className="text-2xl font-bold">
                {Object.values(siteSummary).reduce((sum, item) => sum + item.employees, 0)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-600 p-3">
              <Banknote className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">التكلفة الشهرية التقديرية</p>
              <p className="text-2xl font-bold">{totalMonthly.toLocaleString()} د.ع</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">قاعدة الحساب</p>
            <p className="font-semibold mt-1">
              الراتب الأساسي، ثم أجر التخصص الافتراضي عند عدم وجود راتب خاص
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle>خطط الأعمال</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {(["request", "requested", "management", "final"] as WorkPlanTab[]).map((tab) => (
              <Button
                key={tab}
                type="button"
                variant={activeWorkPlanTab === tab ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveWorkPlanTab(tab)}
              >
                {tab === "request" && "طلب خطة"}
                {tab === "requested" && "الخطط المطلوبة"}
                {tab === "management" && "الخطط المرسلة للإدارة"}
                {tab === "final" && "الخطة النهائية ليوم"}
              </Button>
            ))}
          </div>

          {activeWorkPlanTab === "request" && (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>الموقع</Label>
                  <Select value={requestSiteId} onValueChange={setRequestSiteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الموقع" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name} ({site.ctr_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>تاريخ الخطة</Label>
                  <Input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>ملاحظات الطلب</Label>
                <Input
                  value={requestNotes}
                  onChange={(e) => setRequestNotes(e.target.value)}
                  placeholder="هدف الخطة، أولويات الموقع، ملاحظات خاصة..."
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>التخصصات المطلوبة</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addPlanSpecialty}>
                    <Plus className="w-4 h-4 ml-1" /> إضافة تخصص
                  </Button>
                </div>

                {draftSpecialties.map((item, index) => (
                  <div key={`${item.specialty}-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 rounded-lg border bg-background p-3">
                    <div className="md:col-span-2">
                      <Label>التخصص</Label>
                      <Input
                        value={item.specialty}
                        onChange={(e) => updateDraftSpecialty(index, "specialty", e.target.value)}
                        placeholder="مثل: كهربائي"
                      />
                    </div>
                    <div>
                      <Label>العدد</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateDraftSpecialty(index, "quantity", Number(e.target.value || 0))}
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 rounded-md border px-2 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={item.heavy_equipment}
                          onChange={(e) => updateDraftSpecialty(index, "heavy_equipment", e.target.checked)}
                        />
                        آليات ثقيلة
                      </label>
                    </div>
                    <div className="flex items-end justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeDraftSpecialty(index)}>
                        حذف
                      </Button>
                    </div>
                    <div className="md:col-span-5">
                      <Label>ملاحظات التخصص</Label>
                      <Input
                        value={item.notes}
                        onChange={(e) => updateDraftSpecialty(index, "notes", e.target.value)}
                        placeholder="ملاحظات خاصة أو متطلبات إضافية"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <Button type="button" className="w-full" onClick={() => createWorkPlanRequest.mutate()} disabled={createWorkPlanRequest.isPending}>
                {createWorkPlanRequest.isPending ? "جارٍ الإرسال..." : "إرسال الخطة إلى قسم التخطيط"}
              </Button>
            </div>
          )}

          {activeWorkPlanTab === "requested" && (
            <div className="space-y-3">
              {requestedPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  لا توجد خطط جديدة في انتظار اعتماد قسم التخطيط.
                </div>
              ) : (
                requestedPlans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{plan.site_name}</h3>
                        <p className="text-sm text-muted-foreground">بواسطة {plan.requested_by_name} · {plan.request_date}</p>
                      </div>
                      <Badge variant="secondary">{planStatusLabel[plan.status]}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {plan.specialties.map((item) => (
                        <Badge key={`${plan.id}-${item.specialty}`} style={{ backgroundColor: `${item.color}22`, color: item.color, borderColor: item.color }}>
                          {item.specialty} ({item.quantity})
                        </Badge>
                      ))}
                    </div>
                    <div className="rounded-lg bg-muted/20 p-3 text-sm whitespace-pre-line">{plan.request_notes || "لا توجد ملاحظات"}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={plan.planning_notes ?? ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          setManagementNote((current) => ({ ...current, [plan.id]: next }));
                        }}
                        placeholder="ملاحظة التخطيط..."
                      />
                      <Button
                        type="button"
                        onClick={() => updatePlanStatus.mutate({ id: plan.id, status: "planning_approved", planningNotes: managementNote[plan.id] ?? "" })}
                      >
                        اعتماد من قسم التخطيط
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeWorkPlanTab === "management" && (
            <div className="space-y-3">
              {planningApprovedPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  لا توجد خطط تمت الموافقة عليها من قسم التخطيط حتى الآن.
                </div>
              ) : (
                planningApprovedPlans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{plan.site_name}</h3>
                        <p className="text-sm text-muted-foreground">الطلب: {plan.request_date}</p>
                      </div>
                      <Badge variant="outline">موافق عليه</Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Input
                        value={(managementDraft[plan.id]?.name ?? "")}
                        onChange={(e) =>
                          setManagementDraft((current) => ({
                            ...current,
                            [plan.id]: {
                              name: e.target.value,
                              specialty: current[plan.id]?.specialty ?? "",
                              notes: current[plan.id]?.notes ?? "",
                              source: "manual",
                            },
                          }))
                        }
                        placeholder="اسم الكادر أو الموظف"
                      />
                      <Input
                        value={(managementDraft[plan.id]?.specialty ?? "")}
                        onChange={(e) =>
                          setManagementDraft((current) => ({
                            ...current,
                            [plan.id]: {
                              name: current[plan.id]?.name ?? "",
                              specialty: e.target.value,
                              notes: current[plan.id]?.notes ?? "",
                              source: "manual",
                            },
                          }))
                        }
                        placeholder="التخصص"
                      />
                      <Input
                        value={(managementDraft[plan.id]?.notes ?? "")}
                        onChange={(e) =>
                          setManagementDraft((current) => ({
                            ...current,
                            [plan.id]: {
                              name: current[plan.id]?.name ?? "",
                              specialty: current[plan.id]?.specialty ?? "",
                              notes: e.target.value,
                              source: "manual",
                            },
                          }))
                        }
                        placeholder="ملاحظات الكادر"
                      />
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      <Button type="button" onClick={() => addManagementAssignment(plan.id)}>
                        إضافة الكادر إلى الخطة
                      </Button>
                      <Input
                        value={managementNote[plan.id] ?? ""}
                        onChange={(e) => setManagementNote((current) => ({ ...current, [plan.id]: e.target.value }))}
                        placeholder="ملاحظات الإدارة..."
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updatePlanStatus.mutate({
                            id: plan.id,
                            status: "management_review",
                            managementNotes: managementNote[plan.id] ?? "",
                          })
                        }
                      >
                        إرسال إلى الإدارة
                      </Button>
                    </div>

                    {(plan.assigned_staff ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(plan.assigned_staff ?? []).map((member, index) => (
                          <Badge key={`${plan.id}-${member.name}-${index}`} className="px-3 py-1" style={{ backgroundColor: "#1d4ed8", color: "white" }}>
                            {member.name} · {member.specialty}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeWorkPlanTab === "final" && (
            <div className="space-y-3">
              {managementReviewPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  لا توجد خطط في مرحلة التحضير أو الإغلاق النهائي بعد إدراج الكوادر.
                </div>
              ) : (
                managementReviewPlans.map((plan) => (
                  <div key={plan.id} className="rounded-xl border bg-background p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{plan.site_name}</h3>
                        <p className="text-sm text-muted-foreground">{plan.request_date}</p>
                      </div>
                      <Badge>{planStatusLabel[plan.status]}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {(plan.specialties ?? []).map((item) => (
                        <Badge key={`${plan.id}-final-${item.specialty}`} style={{ backgroundColor: `${item.color}22`, color: item.color, borderColor: item.color }}>
                          {item.specialty} ({item.quantity})
                        </Badge>
                      ))}
                    </div>

                    {(plan.assigned_staff ?? []).length > 0 && (
                      <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                        <div className="font-semibold">الكوادر المخصصة</div>
                        <div className="flex flex-wrap gap-2">
                          {(plan.assigned_staff ?? []).map((member, index) => (
                            <Badge key={`${plan.id}-member-${index}`} variant="outline">
                              {member.name} · {member.specialty}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={finalPlanTitle[plan.id] ?? ""}
                        onChange={(e) => setFinalPlanTitle((current) => ({ ...current, [plan.id]: e.target.value }))}
                        placeholder="عنوان الخطة النهائية"
                      />
                      <Input
                        value={finalPlanNotes[plan.id] ?? ""}
                        onChange={(e) => setFinalPlanNotes((current) => ({ ...current, [plan.id]: e.target.value }))}
                        placeholder="ملاحظات الخطة النهائية"
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={() => finalizePlan.mutate({ id: plan.id, finalTitle: finalPlanTitle[plan.id] ?? `الخطة النهائية - ${plan.site_name}`, finalNotes: finalPlanNotes[plan.id] ?? "" })}
                    >
                      تأكيد الخطة النهائية ليوم
                    </Button>
                  </div>
                ))
              )}

              {finalPlans.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-bold">الخطة النهائية المعتمدة</h3>
                  {finalPlans.map((plan) => (
                    <div key={plan.id} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold">{plan.final_plan?.title ?? `الخطة النهائية - ${plan.site_name}`}</div>
                          <div className="text-sm text-muted-foreground">{plan.site_name} · {plan.request_date}</div>
                        </div>
                        <Badge className="bg-emerald-600 text-white">{planStatusLabel[plan.status]}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(plan.final_plan?.specialties ?? plan.specialties ?? []).map((item) => (
                          <Badge key={`${plan.id}-${item.specialty}`} style={{ backgroundColor: `${item.color}22`, color: item.color, borderColor: item.color }}>
                            {item.specialty} ({item.quantity})
                          </Badge>
                        ))}
                      </div>
                      <div className="rounded-lg border bg-background p-3 text-sm whitespace-pre-line">
                        {plan.final_plan?.notes ?? plan.management_notes ?? "لا توجد ملاحظات"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>مواقع العمل</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>كود التكلفة</TableHead>
                <TableHead>الموقع</TableHead>
                <TableHead>التخصصات العاملة</TableHead>
                <TableHead>إداري الموقع</TableHead>
                <TableHead>الموظفون</TableHead>
                <TableHead>التكلفة الشهرية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono font-semibold">{s.ctr_code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {Object.entries(siteSummary[s.id]?.specialties ?? {}).map(
                        ([title, count]) => (
                          <Badge key={title} variant="outline">
                            {title} ({count})
                          </Badge>
                        ),
                      )}
                      {!siteSummary[s.id]?.employees && (
                        <span className="text-muted-foreground">لا يوجد موظفون</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(siteAdmins as any[]).find(
                      (employee) => employee.id === s.site_admin_employee_id,
                    )?.full_name ?? <span className="text-warning">غير محدد</span>}
                  </TableCell>
                  <TableCell>
                    {siteSummary[s.id]?.employees ?? (counts as any)[s.id] ?? 0}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {(siteSummary[s.id]?.monthly ?? 0).toLocaleString()} د.ع
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.status === "active" ? "default" : "secondary"}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(s);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("حذف الموقع؟")) del.mutate(s.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!sites.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    لا توجد مواقع بعد
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

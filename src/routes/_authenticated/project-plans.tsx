import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayInBaghdad } from "@/lib/date-time";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StaffNameChips } from "@/components/StaffNameChips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Banknote,
  ChevronDown,
  MapPin,
  MoreHorizontal,
  Minus,
  NotebookPen,
  Plus,
  Printer,
  Search,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { createWageRateTitleMap, getEmployeeSiteCost } from "@/lib/site-costs";
import { getDefaultWage } from "@/lib/wage-defaults";
import {
  appendStaffNames,
  normalizeStaffAssignments,
  parsePersonNames,
  type StaffAssignmentGroup,
} from "@/lib/planning-staff";
import { escapeHtml, printReport } from "@/lib/report-print";

export const Route = createFileRoute("/_authenticated/project-plans")({
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id);
    if (error) throw redirect({ to: "/attendance" });
    const roles = new Set<string>((data ?? []).map((row) => row.role));
    if (
      !["admin", "hr", "supervisor", "department_manager", "engineer", "site_admin"].some((role) =>
        roles.has(role),
      )
    )
      throw redirect({ to: "/attendance" });
  },
  head: () => ({
    meta: [
      { title: "خطط المشاريع" },
      {
        name: "description",
        content: "إنشاء مواقع العمل وتحديد كود التكلفة CTR لكل موقع وربط الموظفين به.",
      },
      { property: "og:title", content: "خطط المشاريع" },
      { property: "og:description", content: "إدارة طلبات خطط المشاريع واعتمادها." },
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
  equipment_name: string;
  notes: string;
  color: string;
};

type SiteWorkPlan = {
  id: string;
  site_id: string;
  site_name: string;
  requested_by: string | null;
  requested_by_name: string;
  applicant_name: string;
  request_date: string;
  status: "requested" | "planning_approved" | "management_review" | "finalized";
  request_notes: string | null;
  planning_notes: string | null;
  management_notes: string | null;
  engineer_notes: string | null;
  specialties: WorkPlanSpecialty[];
  assigned_staff: StaffAssignmentGroup[];
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
const EMPTY_SPECIALTY_CATALOG: string[] = [];
const EMPTY_EQUIPMENT_CATALOG: string[] = [];

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
const siteStatusLabel: Record<string, string> = {
  active: "نشط",
  planned: "مخطط",
  completed: "منتهي",
  suspended: "متوقف",
};

function planCreatorLabel(plan: SiteWorkPlan) {
  return plan.requested_by_name?.trim() || "حساب غير محدد";
}

function planPdfMarkup(plan: SiteWorkPlan, site?: Site) {
  const specialties = plan.final_plan?.specialties ?? plan.specialties ?? [];
  const assigned = new Map(plan.assigned_staff.map((group) => [group.specialty, group.names]));
  const totalRequired = specialties.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalAssigned = specialties.reduce(
    (sum, item) => sum + (assigned.get(item.specialty)?.length ?? 0),
    0,
  );
  const rows = specialties
    .map((item) => {
      const names = assigned.get(item.specialty) ?? [];
      const color = item.color || "#0f766e";
      return `<tr>
      <td style="border-right:5px solid ${escapeHtml(color)}"><strong>${escapeHtml(item.specialty)}</strong><br><span style="color:#64748b;font-size:11px">${item.heavy_equipment ? `آلية: ${escapeHtml(item.equipment_name || "مطلوبة")}` : ""}</span></td>
      <td style="text-align:center;font-weight:700">${Number(item.quantity || 0)}</td>
      <td>${names.length ? names.map((name) => `<span class="name-chip" style="border-color:${escapeHtml(color)};color:${escapeHtml(color)}">${escapeHtml(name)}</span>`).join(" ") : '<span style="color:#94a3b8">لم يتم تخصيص أسماء</span>'}</td>
    </tr>`;
    })
    .join("");

  return `<section class="plan-sheet">
    <header class="plan-header">
      <div><div class="eyebrow">الخطة النهائية المعتمدة</div><h2>${escapeHtml(plan.final_plan?.title || `الخطة النهائية - ${plan.site_name}`)}</h2><p>${escapeHtml(plan.site_name)}${site?.ctr_code ? ` · CTR ${escapeHtml(site.ctr_code)}` : ""}</p></div>
      <div class="status">${escapeHtml(planStatusLabel[plan.status])}</div>
    </header>
    <div class="meta-grid">
      <div><span>تاريخ الخطة</span><strong>${escapeHtml(plan.request_date)}</strong></div>
      <div><span>منشئ الخطة</span><strong>${escapeHtml(planCreatorLabel(plan))}</strong></div>
      <div><span>طالب الخطة</span><strong>${escapeHtml(plan.applicant_name || "غير محدد")}</strong></div>
      <div><span>إجمالي المطلوب</span><strong>${totalRequired}</strong></div>
      <div><span>الأسماء المخصصة</span><strong>${totalAssigned}</strong></div>
    </div>
    <table class="plan-table"><thead><tr><th>التخصص</th><th>المطلوب</th><th>الأسماء المخصصة</th></tr></thead><tbody>${rows || `<tr><td colspan="3">لا توجد تخصصات</td></tr>`}</tbody></table>
    <div class="note"><strong>ملاحظات المهندس:</strong> ${escapeHtml(plan.engineer_notes || plan.final_plan?.notes || plan.management_notes || plan.planning_notes || "لا توجد ملاحظات")}</div>
  </section>`;
}

function newPlanSpecialty(index = 0): WorkPlanSpecialty {
  return {
    specialty: WORK_PLAN_SPECIALTIES[index % WORK_PLAN_SPECIALTIES.length],
    quantity: 0,
    heavy_equipment: false,
    equipment_name: "",
    notes: "",
    color: WORK_PLAN_COLORS[index % WORK_PLAN_COLORS.length],
  };
}

function ResponsivePlanAction({
  label,
  onAction,
  variant = "default",
}: {
  label: string;
  onAction: () => void;
  variant?: "default" | "outline";
}) {
  return (
    <>
      <Button
        type="button"
        variant={variant}
        className="hidden min-h-11 sm:inline-flex"
        onClick={onAction}
      >
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 sm:hidden"
            aria-label={label}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-h-11" onSelect={onAction}>
            {label}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ColoredNameChips({ names, color }: { names: string[]; color: string }) {
  if (!names.length)
    return <span className="text-sm text-muted-foreground">لم يتم تخصيص أسماء</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <span
          key={name}
          className="rounded-full border px-2.5 py-1 text-xs font-medium"
          style={{ borderColor: `${color}66`, backgroundColor: `${color}12`, color }}
        >
          {name}
        </span>
      ))}
    </div>
  );
}

export function PlanningPage() {
  const qc = useQueryClient();
  const { isEngineer } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [siteSearch, setSiteSearch] = useState("");
  const [siteStatusFilter, setSiteStatusFilter] = useState("all");
  const [requestSiteSearch, setRequestSiteSearch] = useState("");
  const [planSearch, setPlanSearch] = useState("");
  const [planDateFilter, setPlanDateFilter] = useState("");
  const [planCreatorFilter, setPlanCreatorFilter] = useState("all");
  const [planApplicantFilter, setPlanApplicantFilter] = useState("all");
  const [planSiteFilter, setPlanSiteFilter] = useState("all");
  const [finalStaffSearch, setFinalStaffSearch] = useState("");
  const [specialtySearch, setSpecialtySearch] = useState("");
  const [visibleSpecialtyNotes, setVisibleSpecialtyNotes] = useState<Record<string, boolean>>({});

  const {
    data: sites = [],
    isLoading: sitesLoading,
    error: sitesError,
  } = useQuery({
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
        .ilike("position", "%مهندس%")
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
    const wagesByTitle = createWageRateTitleMap(costData.rates);
    for (const employee of siteEmployees) {
      if (!employee.site_id) continue;
      const { monthly, daily, specialty } = getEmployeeSiteCost(employee, wagesByTitle);
      const current = result[employee.site_id] ?? {
        employees: 0,
        monthly: 0,
        daily: 0,
        specialties: {},
      };
      current.employees += 1;
      current.monthly += monthly;
      current.daily += daily;
      current.specialties[specialty] = (current.specialties[specialty] ?? 0) + 1;
      result[employee.site_id] = current;
    }
    return result;
  }, [costData.rates, siteEmployees]);
  const totalMonthly = Object.values(siteSummary).reduce((sum, item) => sum + item.monthly, 0);

  const [activeWorkPlanTab, setActiveWorkPlanTab] = useState<WorkPlanTab>(
    isEngineer ? "request" : "management",
  );
  const [requestSiteId, setRequestSiteId] = useState<string>(sites[0]?.id ?? "");
  const [requestDate, setRequestDate] = useState(todayInBaghdad);
  const [applicantName, setApplicantName] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const { data: specialtyCatalog = EMPTY_SPECIALTY_CATALOG } = useQuery({
    queryKey: ["work-plan-specialty-catalog", "wage-rates"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.from("wage_rates").select("title").order("title");
      if (error) throw error;
      return Array.from(
        new Set((data ?? []).map((item: any) => String(item.title ?? "").trim()).filter(Boolean)),
      );
    },
  });
  const { data: equipmentCatalog = EMPTY_EQUIPMENT_CATALOG } = useQuery({
    queryKey: ["work-plan-equipment-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_catalog_items")
        .select("name")
        .eq("kind", "equipment_type")
        .eq("is_archived", false)
        .order("sort_order");
      if (error || !data?.length) {
        return ["حفارة", "جرافة", "لودر", "سيارة حمل", "مقطورة", "آلة رصف", "مكبس"].filter(Boolean);
      }
      return Array.from(new Set([...data.map((item: any) => item.name)]));
    },
  });
  const specialtyOptions = useMemo(() => specialtyCatalog ?? [], [specialtyCatalog]);
  const equipmentOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(equipmentCatalog ?? []),
          "حفارة",
          "جرافة",
          "لودر",
          "سيارة حمل",
          "مقطورة",
          "آلة رصف",
          "مكبس",
        ]),
      ).filter(Boolean),
    [equipmentCatalog],
  );
  const [draftSpecialties, setDraftSpecialties] = useState<WorkPlanSpecialty[]>([]);
  const [managementNote, setManagementNote] = useState<Record<string, string>>({});
  const [managementAssignments, setManagementAssignments] = useState<
    Record<string, Record<string, string>>
  >({});
  const assignmentSaveQueue = useRef(new Map<string, Promise<void>>());
  const staffInputRefs = useRef(new Map<string, HTMLInputElement>());
  const [finalPlanTitle, setFinalPlanTitle] = useState<Record<string, string>>({});
  const [finalPlanNotes, setFinalPlanNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (sites.length && !requestSiteId) setRequestSiteId(sites[0].id);
  }, [sites, requestSiteId]);

  useEffect(() => {
    if (!specialtyOptions.length) return;
    setDraftSpecialties((current) => {
      const currentNames = current.map((item) => item.specialty);
      const hasSameItems =
        currentNames.length === specialtyOptions.length &&
        currentNames.every((name, index) => name === specialtyOptions[index]);

      if (hasSameItems) return current;

      const previousByName = new Map(current.map((item) => [item.specialty, item]));
      return specialtyOptions.map(
        (specialty, index) =>
          previousByName.get(specialty) ?? { ...newPlanSpecialty(index), specialty },
      );
    });
  }, [specialtyOptions]);

  const workPlansQuery = useQuery({
    queryKey: ["site-work-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_work_plans")
        .select("*")
        .order("request_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        site_id: row.site_id,
        site_name: row.site_name ?? row.site?.name ?? "موقع غير محدد",
        requested_by: row.requested_by ?? null,
        requested_by_name: row.requested_by_name ?? "غير محدد",
        applicant_name: row.applicant_name ?? row.requested_by_name ?? "غير محدد",
        request_date: row.request_date,
        status: row.status,
        request_notes: row.request_notes ?? null,
        planning_notes: row.planning_notes ?? null,
        management_notes: row.management_notes ?? null,
        engineer_notes: row.engineer_notes ?? row.final_plan?.notes ?? null,
        specialties: Array.isArray(row.specialties) ? row.specialties : [],
        assigned_staff: normalizeStaffAssignments(row.assigned_staff),
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
  const visiblePlans = (plans: SiteWorkPlan[]) =>
    plans.filter((plan) => {
      const matchesSearch = `${plan.site_name} ${plan.requested_by_name} ${plan.applicant_name}`
        .toLocaleLowerCase("ar")
        .includes(planSearch.trim().toLocaleLowerCase("ar"));
      return (
        matchesSearch &&
        (!planDateFilter || plan.request_date === planDateFilter) &&
        (planCreatorFilter === "all" || plan.requested_by_name === planCreatorFilter) &&
        (planApplicantFilter === "all" || plan.applicant_name === planApplicantFilter) &&
        (planSiteFilter === "all" || plan.site_id === planSiteFilter)
      );
    });
  const filteredSites = sites.filter(
    (site) =>
      (siteStatusFilter === "all" || site.status === siteStatusFilter) &&
      `${site.name} ${site.ctr_code} ${site.client ?? ""}`
        .toLocaleLowerCase("ar")
        .includes(siteSearch.trim().toLocaleLowerCase("ar")),
  );
  const visibleRequestedPlans = visiblePlans(requestedPlans);
  const visiblePlanningApprovedPlans = visiblePlans(planningApprovedPlans);
  const visibleManagementReviewPlans = visiblePlans(managementReviewPlans);
  const visibleFinalPlans = visiblePlans(finalPlans);
  const planCreators = Array.from(new Set(workPlans.map((plan) => plan.requested_by_name)))
    .filter(Boolean)
    .sort();
  const planApplicants = Array.from(new Set(workPlans.map((plan) => plan.applicant_name)))
    .filter(Boolean)
    .sort();
  const filteredSpecialties = draftSpecialties.filter((item) =>
    item.specialty.toLocaleLowerCase("ar").includes(specialtySearch.trim().toLocaleLowerCase("ar")),
  );
  const selectedSpecialties = draftSpecialties.filter((item) => Number(item.quantity) > 0);
  const workPlanTabCounts: Record<WorkPlanTab, number> = {
    request: selectedSpecialties.length,
    requested: requestedPlans.length,
    management: planningApprovedPlans.length,
    final: managementReviewPlans.length + finalPlans.length,
  };
  const requestedHeadcount = selectedSpecialties.reduce(
    (sum, item) => sum + Number(item.quantity),
    0,
  );
  const estimatedPlanCost = selectedSpecialties.reduce((sum, item) => {
    const rate = costData.rates.find((entry: any) => entry.title?.trim() === item.specialty.trim());
    const defaults = getDefaultWage(item.specialty);
    const dailyRate =
      Number(rate?.daily_rate) > 0
        ? Number(rate.daily_rate)
        : Number(rate?.monthly_rate) > 0
          ? Number(rate.monthly_rate) / 26
          : defaults.daily_rate;
    return sum + dailyRate * Number(item.quantity);
  }, 0);
  const getFinalSpecialtyRows = (plan: SiteWorkPlan) =>
    (plan.final_plan?.specialties ?? plan.specialties ?? [])
      .map((item) => ({
        item,
        names: plan.assigned_staff.find((group) => group.specialty === item.specialty)?.names ?? [],
      }))
      .filter(({ item, names }) => {
        const search = finalStaffSearch.trim().toLocaleLowerCase("ar");
        return (
          !search || `${item.specialty} ${names.join(" ")}`.toLocaleLowerCase("ar").includes(search)
        );
      });

  const exportPlanPdf = (plan: SiteWorkPlan) => {
    const ok = printReport(
      `الخطة النهائية - ${plan.site_name}`,
      `<div class="pdf-report">${planPdfMarkup(
        plan,
        sites.find((site) => site.id === plan.site_id),
      )}</div>`,
    );
    if (!ok) toast.error("تعذر فتح نافذة تصدير PDF؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.");
  };

  const exportAllPlansPdf = () => {
    if (!finalPlans.length) {
      toast.info("لا توجد خطط نهائية لتصديرها");
      return;
    }
    const ok = printReport(
      "الخطط النهائية المعتمدة",
      `<div class="pdf-report">${finalPlans
        .map((plan) =>
          planPdfMarkup(
            plan,
            sites.find((site) => site.id === plan.site_id),
          ),
        )
        .join("")}</div>`,
    );
    if (!ok) toast.error("تعذر فتح نافذة تصدير PDF؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.");
  };

  const createWorkPlanRequest = useMutation({
    mutationFn: async () => {
      if (!isEngineer) throw new Error("إنشاء الخطط متاح للمهندس فقط من قسم خطط المشاريع");
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
        applicant_name:
          applicantName.trim() || user.user_metadata?.full_name || user.email || "غير محدد",
        request_date: requestDate,
        status: "requested",
        request_notes: requestNotes.trim() || null,
        planning_notes: null,
        management_notes: null,
        engineer_notes: null,
        specialties: validSpecialties.map((item) => ({
          specialty: item.specialty.trim(),
          quantity: Number(item.quantity),
          heavy_equipment: Boolean(item.heavy_equipment),
          equipment_name: item.heavy_equipment ? item.equipment_name || "آلة" : "",
          notes: item.notes.trim(),
          color: item.color,
        })),
        assigned_staff: [],
        final_plan: null,
      };

      // جرّب المخطط الكامل أولاً، ثم أعد الإرسال بالحقول الأساسية إذا لم تُطبّق Migration بعد.
      let { error } = await (supabase as any).from("site_work_plans").insert(payload);
      if (
        error &&
        /(applicant_name|engineer_notes|column .* does not exist|schema cache)/i.test(
          error.message ?? "",
        )
      ) {
        const legacyPayload = { ...payload } as Record<string, unknown>;
        delete legacyPayload.applicant_name;
        delete legacyPayload.engineer_notes;
        const retry = await (supabase as any).from("site_work_plans").insert(legacyPayload);
        error = retry.error;
      }
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      setActiveWorkPlanTab(isEngineer ? "request" : "management");
      setRequestNotes("");
      setRequestDate(todayInBaghdad());
      setRequestSiteSearch("");
      setDraftSpecialties(
        specialtyOptions.map((specialty, index) => ({
          ...newPlanSpecialty(index),
          specialty,
        })),
      );
      setSpecialtySearch("");
      setVisibleSpecialtyNotes({});
      toast.success("تم إرسال الخطة إلى قسم التخطيط");
    },
    onError: (error: any) =>
      toast.error(
        error?.message?.includes("site_work_plans")
          ? "جدول خطط الأعمال غير موجود في قاعدة البيانات. نفّذ Migration الخاص به أولاً في Lovable Cloud."
          : (error?.message ?? "تعذر إرسال الخطة"),
      ),
  });

  const updatePlanStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      planningNotes,
      managementNotes,
    }: {
      id: string;
      status: SiteWorkPlan["status"];
      planningNotes?: string;
      managementNotes?: string;
    }) => {
      const payload: any = {};
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
  const deleteWorkPlan = useMutation({
    mutationFn: async (plan: SiteWorkPlan) => {
      const { error } = await supabase.from("site_work_plans").delete().eq("id", plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      toast.success("تم حذف خطة العمل");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر حذف خطة العمل"),
  });

  const finalizePlan = useMutation({
    mutationFn: async ({
      id,
      finalTitle,
      finalNotes,
    }: {
      id: string;
      finalTitle: string;
      finalNotes: string;
    }) => {
      const plan = workPlans.find((item) => item.id === id);
      const payload = {
        status: "finalized",
        engineer_notes: finalNotes.trim() || null,
        final_plan: {
          title: finalTitle.trim() || `الخطة النهائية - ${plan?.site_name ?? "الموقع"}`,
          summary: finalTitle.trim() || `الخطة النهائية - ${plan?.site_name ?? "الموقع"}`,
          notes: finalNotes.trim() || "-",
          specialties: plan?.specialties ?? [],
        },
      };
      // جرّب الحقول الكاملة أولاً، ثم أعد الحفظ بالحقول الأساسية إذا لم تُطبّق Migration بعد.
      let { data, error } = await (supabase as any)
        .from("site_work_plans")
        .update(payload)
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (
        error &&
        /(engineer_notes|column .* does not exist|schema cache)/i.test(error.message ?? "")
      ) {
        const legacyPayload = { ...payload } as Record<string, unknown>;
        delete legacyPayload.engineer_notes;
        const retry = await (supabase as any)
          .from("site_work_plans")
          .update(legacyPayload)
          .eq("id", id)
          .select("id")
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;
      if (!data)
        throw new Error("لم يتم تحديث الخطة. تحقق من صلاحية الاعتماد وحالة الخطة الحالية.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site-work-plans"] });
      setActiveWorkPlanTab("final");
      toast.success("تم تأكيد الخطة النهائية واستعراضها في قسم الخطة النهائية");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر إغلاق الخطة النهائية"),
  });

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

  const queueStaffAssignmentUpdate = (
    planId: string,
    update: (current: StaffAssignmentGroup[]) => StaffAssignmentGroup[],
    successMessage: string | (() => string),
  ) => {
    const previous = assignmentSaveQueue.current.get(planId) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        const cachedPlans = qc.getQueryData<SiteWorkPlan[]>(["site-work-plans"]);
        const plan =
          cachedPlans?.find((item) => item.id === planId) ??
          workPlans.find((item) => item.id === planId);
        const current = normalizeStaffAssignments(plan?.assigned_staff);
        const nextAssignments = update(current);
        if (nextAssignments === current) return;
        const { error } = await supabase
          .from("site_work_plans")
          .update({ assigned_staff: nextAssignments })
          .eq("id", planId);
        if (error) throw error;

        qc.setQueryData<SiteWorkPlan[]>(["site-work-plans"], (plans) =>
          plans?.map((item) =>
            item.id === planId ? { ...item, assigned_staff: nextAssignments } : item,
          ),
        );
        toast.success(typeof successMessage === "function" ? successMessage() : successMessage);
      })
      .catch((error: any) => {
        void qc.invalidateQueries({ queryKey: ["site-work-plans"] });
        toast.error(error?.message ?? "تعذر حفظ الكوادر");
      });

    assignmentSaveQueue.current.set(planId, queued);
    void queued.finally(() => {
      if (assignmentSaveQueue.current.get(planId) === queued) {
        assignmentSaveQueue.current.delete(planId);
      }
    });
  };

  const addManagementAssignment = (planId: string, specialtyName: string, rawNames: string) => {
    const names = parsePersonNames(rawNames);
    if (!names.length) {
      toast.error("اكتب اسمًا واحدًا على الأقل؛ افصل الأسماء المتعددة بفاصلة أو سطر جديد");
      return;
    }

    const inputKey = `${planId}::${specialtyName}`;
    setManagementAssignments((current) => ({
      ...current,
      [planId]: { ...(current[planId] ?? {}), [specialtyName]: "" },
    }));
    requestAnimationFrame(() => staffInputRefs.current.get(inputKey)?.focus());

    let addedCount = 0;
    queueStaffAssignmentUpdate(
      planId,
      (current) => {
        const result = appendStaffNames(current, specialtyName, rawNames);
        const duplicateCount = result.duplicates.length;
        if (!result.added.length) {
          toast.warning("هذا الاسم مضاف مسبقًا لهذا التخصص");
          return current;
        }
        addedCount = result.added.length;
        if (duplicateCount) toast.warning("تم تجاهل الاسم المكرر");

        const required = Number(
          workPlans
            .find((item) => item.id === planId)
            ?.specialties.find((item) => item.specialty === specialtyName)?.quantity ?? 0,
        );
        const assigned =
          result.assignments.find((item) => item.specialty === specialtyName)?.names.length ?? 0;
        if (assigned > required)
          toast.warning(`تم تجاوز العدد المطلوب بمقدار ${assigned - required}`);
        return result.assignments;
      },
      () => `تمت إضافة ${addedCount} اسم إلى ${specialtyName}`,
    );
  };

  const removeManagementName = (planId: string, specialtyName: string, name: string) => {
    queueStaffAssignmentUpdate(
      planId,
      (current) =>
        current
          .map((group) =>
            group.specialty === specialtyName
              ? { ...group, names: group.names.filter((item) => item !== name) }
              : group,
          )
          .filter((group) => group.names.length > 0),
      "تم حذف الاسم من التخصص",
    );
  };

  const clearManagementNames = (planId: string, specialtyName: string) => {
    const group = workPlans
      .find((item) => item.id === planId)
      ?.assigned_staff.find((item) => item.specialty === specialtyName);
    if (!group?.names.length) return;
    if (!window.confirm(`مسح جميع الأسماء المضافة لتخصص ${specialtyName}؟`)) return;

    queueStaffAssignmentUpdate(
      planId,
      (current) => current.filter((item) => item.specialty !== specialtyName),
      `تم مسح أسماء ${specialtyName}`,
    );
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

  const siteForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const value = (key: string) => (formData.get(key) as string)?.trim() || null;
        const siteAdminId = value("site_admin_employee_id");
        if (!siteAdminId || siteAdminId === "none") {
          toast.error("اختيار إداري الموقع مطلوب");
          return;
        }
        save.mutate({
          name: formData.get("name") as string,
          ctr_code: (formData.get("ctr_code") as string).trim(),
          client: value("client"),
          location: value("location"),
          description: value("description"),
          start_date: value("start_date"),
          end_date: value("end_date"),
          status: formData.get("status") as string,
          site_admin_employee_id: siteAdminId,
        });
      }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <Label>اسم الموقع</Label>
        <Input name="name" required defaultValue={editing?.name} className="mt-1 min-h-11" />
      </div>
      <div>
        <Label>كود التكلفة CTR</Label>
        <Input
          name="ctr_code"
          required
          defaultValue={editing?.ctr_code}
          className="mt-1 min-h-11 font-mono"
        />
      </div>
      <div>
        <Label>الجهة / العميل</Label>
        <Input name="client" defaultValue={editing?.client ?? ""} className="mt-1 min-h-11" />
      </div>
      <div>
        <Label>الموقع الجغرافي</Label>
        <Input name="location" defaultValue={editing?.location ?? ""} className="mt-1 min-h-11" />
      </div>
      <div>
        <Label>الحالة</Label>
        <Select name="status" defaultValue={editing?.status ?? "active"}>
          <SelectTrigger className="mt-1 min-h-11">
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
        <Input
          type="date"
          name="start_date"
          defaultValue={editing?.start_date ?? ""}
          className="mt-1 min-h-11"
        />
      </div>
      <div>
        <Label>تاريخ الانتهاء</Label>
        <Input
          type="date"
          name="end_date"
          defaultValue={editing?.end_date ?? ""}
          className="mt-1 min-h-11"
        />
      </div>
      <div className="sm:col-span-2">
        <Label>إداري الموقع المسؤول عن التقرير *</Label>
        <Select
          name="site_admin_employee_id"
          defaultValue={editing?.site_admin_employee_id ?? "none"}
        >
          <SelectTrigger className="mt-1 min-h-11">
            <SelectValue placeholder="اختر إداري الموقع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— اختر إداري الموقع —</SelectItem>
            {(siteAdmins as any[]).map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.full_name} — {employee.employee_no}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!siteAdmins.length && (
          <p className="mt-1 text-xs text-warning">لا توجد أسماء موظفين نشطين متاحة.</p>
        )}
      </div>
      <div className="sm:col-span-2">
        <Label>وصف</Label>
        <Input
          name="description"
          defaultValue={editing?.description ?? ""}
          className="mt-1 min-h-11"
        />
      </div>
      <Button type="submit" className="min-h-11 sm:col-span-2" disabled={save.isPending}>
        {save.isPending ? "جارٍ الحفظ..." : "حفظ الموقع"}
      </Button>
    </form>
  );
  const planFilters = (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          className="min-h-11 pr-9"
          value={planSearch}
          onChange={(event) => setPlanSearch(event.target.value)}
          placeholder="بحث شامل في الخطط..."
          aria-label="بحث في الخطط"
        />
      </div>
      <Input
        className="min-h-11"
        type="date"
        value={planDateFilter}
        onChange={(event) => setPlanDateFilter(event.target.value)}
        aria-label="تصفية الخطط حسب التاريخ"
      />
      <select
        className="min-h-11 rounded-md border bg-background px-3 text-sm"
        value={planCreatorFilter}
        onChange={(event) => setPlanCreatorFilter(event.target.value)}
      >
        <option value="all">كل منشئي الخطط</option>
        {planCreators.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        className="min-h-11 rounded-md border bg-background px-3 text-sm"
        value={planApplicantFilter}
        onChange={(event) => setPlanApplicantFilter(event.target.value)}
      >
        <option value="all">كل طالبي الخطط</option>
        {planApplicants.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        className="min-h-11 rounded-md border bg-background px-3 text-sm"
        value={planSiteFilter}
        onChange={(event) => setPlanSiteFilter(event.target.value)}
      >
        <option value="all">كل المواقع</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div dir="rtl" className="space-y-6">
      {siteAdminsError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          تعذر تحميل أسماء الإداريين من قاعدة البيانات:{" "}
          {(siteAdminsError as any).message ?? "تحقق من اتصال Lovable Cloud"}
        </div>
      )}
      {sitesError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          تعذر تحميل المواقع: {(sitesError as any).message ?? "تحقق من اتصال قاعدة البيانات"}
        </div>
      )}
      <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-indigo-950 via-slate-900 to-violet-950 p-6 text-white shadow-xl shadow-indigo-950/20 sm:p-8">
        <div className="pointer-events-none absolute -left-12 -top-20 -z-10 h-64 w-64 rounded-full border border-white/10" />
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-100/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-100">
              <NotebookPen className="h-4 w-4" /> بوابة إعداد خطط المشاريع
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">خطط المشاريع</h1>
            <p className="mt-2 text-sm leading-7 text-white/70 sm:text-base">
              جهّز احتياج الموقع وأرسله للاعتماد. بعد موافقة التخطيط، عيّن الكوادر حسب التخصص وأكمل
              الخطة التنفيذية.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "بانتظار المراجعة", value: requestedPlans.length },
              { label: "بانتظار الكوادر", value: planningApprovedPlans.length },
              { label: "قيد التنفيذ", value: managementReviewPlans.length + finalPlans.length },
            ].map((item) => (
              <div
                key={item.label}
                className="min-w-24 rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur"
              >
                <strong className="block text-2xl tabular-nums">
                  {item.value.toLocaleString("ar-IQ")}
                </strong>
                <span className="text-[11px] text-white/65">{item.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4 text-sm text-indigo-100/80">
          <span className="rounded-full bg-white/10 px-3 py-1.5">١ · إعداد الطلب</span>
          <span aria-hidden="true">←</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">٢ · اعتماد التخطيط</span>
          <span aria-hidden="true">←</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">٣ · توزيع الكوادر</span>
        </div>
      </section>

      <Card className="overflow-hidden border-indigo-200/70 shadow-lg shadow-indigo-950/5 dark:border-indigo-900">
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-[.16em] text-indigo-600 dark:text-indigo-300">
                إعداد ومتابعة الطلبات
              </p>
              <CardTitle className="text-xl sm:text-2xl">مسار خطط المشاريع</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                أرسل الاحتياج، استلمه بعد الاعتماد، ثم وزّع الكوادر.
              </p>
            </div>
            <Badge variant="outline" className="rounded-full px-3 py-1">
              {workPlans.length.toLocaleString("ar-IQ")} خطة
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="sticky top-0 z-20 -mx-6 flex snap-x gap-2 overflow-x-auto border-b bg-card px-4 py-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            {(isEngineer ? (["request"] as WorkPlanTab[]) : (["management"] as WorkPlanTab[])).map(
              (tab) => (
                <Button
                  key={tab}
                  type="button"
                  variant={activeWorkPlanTab === tab ? "default" : "ghost"}
                  size="sm"
                  className="min-h-11 shrink-0 snap-start gap-2 rounded-full"
                  onClick={() => setActiveWorkPlanTab(tab)}
                >
                  {tab === "request" && "طلب خطة"}
                  {tab === "management" && "تعيين الكوادر"}
                  <Badge
                    variant={activeWorkPlanTab === tab ? "secondary" : "outline"}
                    className="min-w-6 justify-center px-1.5"
                  >
                    {workPlanTabCounts[tab]}
                  </Badge>
                </Button>
              ),
            )}
          </div>
          {workPlansQuery.error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              تعذر تحميل خطط الأعمال:{" "}
              {(workPlansQuery.error as any).message ?? "تحقق من الاتصال بقاعدة البيانات"}
            </div>
          )}
          {workPlansQuery.isLoading && activeWorkPlanTab !== "request" && (
            <div className="space-y-2" aria-label="جارٍ تحميل الخطط">
              {[0, 1].map((item) => (
                <div key={item} className="h-20 animate-pulse rounded-xl border bg-muted/40" />
              ))}
            </div>
          )}

          {activeWorkPlanTab === "request" && isEngineer && (
            <div className="space-y-5 pb-28 md:pb-4">
              <div className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr_1.5fr]">
                <div className="space-y-2">
                  <Label>موقع العمل</Label>
                  <Input
                    value={requestSiteSearch}
                    onChange={(event) => setRequestSiteSearch(event.target.value)}
                    placeholder="ابحث عن موقع..."
                    aria-label="ابحث عن موقع للخطة"
                  />
                  <Select value={requestSiteId} onValueChange={setRequestSiteId}>
                    <SelectTrigger className="min-h-11">
                      <SelectValue placeholder="اختر الموقع" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites
                        .filter((site) =>
                          `${site.name} ${site.ctr_code}`
                            .toLocaleLowerCase("ar")
                            .includes(requestSiteSearch.trim().toLocaleLowerCase("ar")),
                        )
                        .map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name} ({site.ctr_code})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>تاريخ الخطة</Label>
                  <Input
                    className="min-h-11"
                    type="date"
                    value={requestDate}
                    onChange={(event) => setRequestDate(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>طالب الخطة</Label>
                  <Input
                    className="min-h-11"
                    value={applicantName}
                    onChange={(event) => setApplicantName(event.target.value)}
                    placeholder="اسم طالب الخطة"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                  <Label>ملاحظات الطلب</Label>
                  <Input
                    className="min-h-11"
                    value={requestNotes}
                    onChange={(event) => setRequestNotes(event.target.value)}
                    placeholder="الأولويات أو متطلبات الموقع..."
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">التخصصات والآليات</h2>
                  <p className="text-sm text-muted-foreground">
                    أدخل العدد المطلوب، واترك الباقي صفرًا.
                  </p>
                </div>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="min-h-11 pr-9"
                    value={specialtySearch}
                    onChange={(event) => setSpecialtySearch(event.target.value)}
                    placeholder="تصفية التخصصات..."
                    aria-label="تصفية التخصصات"
                  />
                </div>
              </div>

              {specialtyOptions.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  لا توجد تخصصات نشطة في دليل النظام.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredSpecialties.map((item) => {
                    const index = draftSpecialties.findIndex(
                      (entry) => entry.specialty === item.specialty,
                    );
                    const chosen = Number(item.quantity) > 0;
                    return (
                      <div
                        key={item.specialty}
                        className={`rounded-xl border p-3 transition-colors ${chosen ? "border-primary/50 bg-primary/5" : "bg-card"}`}
                      >
                        <div className="flex min-h-11 items-center justify-between gap-2">
                          <span className="font-semibold leading-snug">{item.specialty}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            aria-label={`${visibleSpecialtyNotes[item.specialty] ? "إخفاء" : "إظهار"} ملاحظات ${item.specialty}`}
                            onClick={() =>
                              setVisibleSpecialtyNotes((current) => ({
                                ...current,
                                [item.specialty]: !current[item.specialty],
                              }))
                            }
                          >
                            <NotebookPen className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1" dir="ltr">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-11 w-11"
                              aria-label={`تقليل عدد ${item.specialty}`}
                              disabled={item.quantity <= 0}
                              onClick={() =>
                                updateDraftSpecialty(
                                  index,
                                  "quantity",
                                  Math.max(0, item.quantity - 1),
                                )
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <Input
                              className="h-11 w-16 text-center text-lg font-bold tabular-nums"
                              aria-label={`العدد المطلوب من ${item.specialty}`}
                              type="number"
                              min={0}
                              value={item.quantity}
                              onChange={(event) =>
                                updateDraftSpecialty(
                                  index,
                                  "quantity",
                                  Math.max(0, Number(event.target.value) || 0),
                                )
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-11 w-11"
                              aria-label={`زيادة عدد ${item.specialty}`}
                              onClick={() =>
                                updateDraftSpecialty(index, "quantity", item.quantity + 1)
                              }
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                            <input
                              type="checkbox"
                              checked={item.heavy_equipment}
                              onChange={(event) =>
                                updateDraftSpecialty(index, "heavy_equipment", event.target.checked)
                              }
                            />
                            آلية
                          </label>
                        </div>
                        {item.heavy_equipment && (
                          <Select
                            value={item.equipment_name || equipmentOptions[0]}
                            onValueChange={(value) =>
                              updateDraftSpecialty(index, "equipment_name", value)
                            }
                          >
                            <SelectTrigger className="mt-2 min-h-11">
                              <SelectValue placeholder="نوع الآلية" />
                            </SelectTrigger>
                            <SelectContent>
                              {equipmentOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {visibleSpecialtyNotes[item.specialty] && (
                          <Input
                            className="mt-2 min-h-11"
                            value={item.notes}
                            onChange={(event) =>
                              updateDraftSpecialty(index, "notes", event.target.value)
                            }
                            placeholder="ملاحظات اختيارية لهذا التخصص"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur md:sticky md:bottom-0 md:rounded-xl md:border md:px-4">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="text-sm">
                    <span className="text-muted-foreground">التخصصات:</span>{" "}
                    <b>{selectedSpecialties.length}</b>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">إجمالي العدد:</span>{" "}
                    <b>{requestedHeadcount}</b>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">التكلفة اليومية التقديرية:</span>{" "}
                    <b>{estimatedPlanCost.toLocaleString()} د.ع</b>
                  </div>
                  <Button
                    type="button"
                    className="min-h-11 w-full sm:mr-auto sm:w-auto"
                    onClick={() => createWorkPlanRequest.mutate()}
                    disabled={
                      !requestSiteId ||
                      selectedSpecialties.length === 0 ||
                      createWorkPlanRequest.isPending
                    }
                  >
                    {createWorkPlanRequest.isPending
                      ? "جارٍ الإرسال..."
                      : "إرسال الخطة إلى التخطيط"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeWorkPlanTab === "requested" && !workPlansQuery.isLoading && (
            <div className="space-y-3">
              {planFilters}
              {visibleRequestedPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  {requestedPlans.length
                    ? "لا توجد نتائج مطابقة للبحث والتاريخ."
                    : "لا توجد خطط جديدة في انتظار اعتماد قسم التخطيط."}
                </div>
              ) : (
                visibleRequestedPlans.map((plan) => (
                  <details key={plan.id} className="group rounded-xl border bg-card shadow-sm">
                    <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <div className="flex min-w-0 items-center gap-3">
                        <MapPin className="h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <h3 className="truncate font-bold">{plan.site_name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {plan.request_date} · {plan.requested_by_name}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(plan.specialties ?? []).slice(0, 2).map((item) => (
                              <Badge
                                key={`${plan.id}-summary-${item.specialty}`}
                                variant="outline"
                                className="text-xs"
                              >
                                {item.specialty} · {item.quantity}
                              </Badge>
                            ))}
                            {(plan.specialties?.length ?? 0) > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{(plan.specialties?.length ?? 0) - 2}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{planStatusLabel[plan.status]}</Badge>
                        <Badge variant="outline">
                          {(plan.specialties ?? []).reduce(
                            (sum, item) => sum + Number(item.quantity || 0),
                            0,
                          )}{" "}
                          فرد
                        </Badge>
                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    <div className="space-y-4 border-t p-4">
                      <div className="overflow-x-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>التخصص</TableHead>
                              <TableHead>العدد</TableHead>
                              <TableHead>الآلية</TableHead>
                              <TableHead>الملاحظات</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(plan.specialties ?? []).map((item, index) => (
                              <TableRow key={`${plan.id}-${item.specialty}-${index}`}>
                                <TableCell className="font-medium">{item.specialty}</TableCell>
                                <TableCell>{item.quantity}</TableCell>
                                <TableCell>
                                  {item.heavy_equipment ? item.equipment_name || "آلية" : "—"}
                                </TableCell>
                                <TableCell>{item.notes || "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-3 text-sm">
                        {plan.request_notes || "لا توجد ملاحظات للطلب."}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                        <Input
                          className="min-h-11"
                          value={managementNote[plan.id] ?? plan.planning_notes ?? ""}
                          onChange={(event) =>
                            setManagementNote((current) => ({
                              ...current,
                              [plan.id]: event.target.value,
                            }))
                          }
                          placeholder="ملاحظة التخطيط..."
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 text-destructive"
                          disabled={deleteWorkPlan.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `حذف خطة «${plan.site_name}»؟ لا يمكن التراجع عن هذا الإجراء.`,
                              )
                            ) {
                              deleteWorkPlan.mutate(plan);
                            }
                          }}
                        >
                          <Trash2 className="ml-2 h-4 w-4" /> حذف الخطة
                        </Button>
                      </div>
                    </div>
                  </details>
                ))
              )}
            </div>
          )}

          {activeWorkPlanTab === "management" && !workPlansQuery.isLoading && (
            <div className="space-y-3">
              {planFilters}
              {visiblePlanningApprovedPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  {planningApprovedPlans.length
                    ? "لا توجد نتائج مطابقة للبحث والتاريخ."
                    : "لا توجد خطط تمت الموافقة عليها من قسم التخطيط حتى الآن."}
                </div>
              ) : (
                visiblePlanningApprovedPlans.map((plan) => (
                  <details key={plan.id} className="group rounded-xl border bg-card shadow-sm">
                    <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <div className="flex min-w-0 items-center gap-3">
                        <MapPin className="h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <h3 className="truncate font-bold">{plan.site_name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {plan.request_date} ·{" "}
                            {(plan.specialties ?? []).reduce(
                              (sum, item) => sum + Number(item.quantity || 0),
                              0,
                            )}{" "}
                            مطلوب
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(plan.specialties ?? []).slice(0, 2).map((item) => (
                              <Badge
                                key={`${plan.id}-summary-${item.specialty}`}
                                variant="outline"
                                className="text-xs"
                              >
                                {item.specialty} · {item.quantity}
                              </Badge>
                            ))}
                            {(plan.specialties?.length ?? 0) > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{(plan.specialties?.length ?? 0) - 2}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">موافق عليه</Badge>
                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    <div className="space-y-4 border-t p-4">
                      <div className="space-y-3">
                        {(plan.specialties ?? []).map((item) => {
                          const names =
                            plan.assigned_staff.find((group) => group.specialty === item.specialty)
                              ?.names ?? [];
                          const required = Number(item.quantity) || 0;
                          const complete = names.length >= required;
                          const inputKey = `${plan.id}::${item.specialty}`;

                          return (
                            <div
                              key={`${plan.id}-${item.specialty}`}
                              className="rounded-xl border bg-background p-3"
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="font-bold">{item.specialty}</div>
                                <Badge
                                  className={
                                    complete
                                      ? "bg-emerald-600 text-white"
                                      : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                  }
                                >
                                  {names.length} / {required}
                                </Badge>
                              </div>

                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                                <div>
                                  <Label>أسماء الكوادر لهذا التخصص</Label>
                                  <Input
                                    ref={(element) => {
                                      if (element) staffInputRefs.current.set(inputKey, element);
                                      else staffInputRefs.current.delete(inputKey);
                                    }}
                                    value={managementAssignments[plan.id]?.[item.specialty] ?? ""}
                                    onChange={(event) =>
                                      setManagementAssignments((current) => ({
                                        ...current,
                                        [plan.id]: {
                                          ...(current[plan.id] ?? {}),
                                          [item.specialty]: event.target.value,
                                        },
                                      }))
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        addManagementAssignment(
                                          plan.id,
                                          item.specialty,
                                          managementAssignments[plan.id]?.[item.specialty] ?? "",
                                        );
                                      }
                                    }}
                                    placeholder="اكتب اسمًا، أو افصل الأسماء بفاصلة / سطر جديد"
                                    className="min-h-11"
                                  />
                                </div>

                                <div className="flex items-end">
                                  <Button
                                    className="min-h-11 w-full sm:w-auto"
                                    type="button"
                                    onClick={() =>
                                      addManagementAssignment(
                                        plan.id,
                                        item.specialty,
                                        managementAssignments[plan.id]?.[item.specialty] ?? "",
                                      )
                                    }
                                  >
                                    <Plus className="ml-2 h-4 w-4" /> إضافة هذا الشخص
                                  </Button>
                                </div>
                              </div>

                              {names.length > 0 ? (
                                <div className="mt-3 space-y-2">
                                  <StaffNameChips
                                    names={names}
                                    onRemove={(name) =>
                                      removeManagementName(plan.id, item.specialty, name)
                                    }
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="min-h-11 px-2 text-destructive"
                                    onClick={() => clearManagementNames(plan.id, item.specialty)}
                                  >
                                    مسح الكل
                                  </Button>
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  لم تُضف أسماء بعد
                                </p>
                              )}
                              {names.length > required && (
                                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                                  تم تجاوز العدد المطلوب بمقدار {names.length - required}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="rounded-xl border bg-muted/30 p-3">
                        <div className="mb-2 font-bold">تأكيد توزيع الكوادر</div>
                        <div className="flex flex-col md:flex-row gap-2">
                          <Input
                            className="min-h-11"
                            value={managementNote[plan.id] ?? ""}
                            onChange={(e) =>
                              setManagementNote((current) => ({
                                ...current,
                                [plan.id]: e.target.value,
                              }))
                            }
                            placeholder="ملاحظات الإدارة..."
                          />
                          <ResponsivePlanAction
                            label="تأكيد توزيع الكوادر"
                            onAction={() =>
                              updatePlanStatus.mutate({
                                id: plan.id,
                                status: "management_review",
                                managementNotes: managementNote[plan.id] ?? "",
                              })
                            }
                          />
                        </div>
                      </div>

                      {(plan.assigned_staff ?? []).some((group) => group.names.length > 0) && (
                        <div className="rounded-xl border bg-background p-3">
                          <div className="mb-2 font-bold">الكوادر الحالية</div>
                          <div className="space-y-3">
                            {(plan.assigned_staff ?? [])
                              .filter((group) => group.names.length > 0)
                              .map((group) => (
                                <div key={`${plan.id}-${group.specialty}`}>
                                  <div className="mb-1 text-sm font-medium">{group.specialty}</div>
                                  <ColoredNameChips
                                    color={
                                      plan.specialties.find(
                                        (item) => item.specialty === group.specialty,
                                      )?.color ?? "#0f766e"
                                    }
                                    names={group.names}
                                  />
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                ))
              )}
            </div>
          )}

          {activeWorkPlanTab === "final" && !workPlansQuery.isLoading && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                    تصدير الخطط النهائية
                  </p>
                  <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                    يتم إنشاء نافذة PDF تحتوي الخطط فقط، مع مقاس A4 وفاصل مستقل لكل خطة.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0 bg-background"
                  onClick={exportAllPlansPdf}
                >
                  <Printer className="ml-2 h-4 w-4" /> تصدير جميع الخطط
                </Button>
              </div>
              {planFilters}
              {visibleManagementReviewPlans.length === 0 && visibleFinalPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  {managementReviewPlans.length || finalPlans.length
                    ? "لا توجد نتائج مطابقة للبحث والتاريخ."
                    : "لا توجد خطط في مرحلة التحضير أو الإغلاق النهائي بعد إدراج الكوادر."}
                </div>
              ) : (
                visibleManagementReviewPlans.map((plan) => (
                  <details key={plan.id} className="group rounded-xl border bg-card shadow-sm">
                    <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <div className="flex min-w-0 items-center gap-3">
                        <MapPin className="h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <h3 className="truncate font-bold">{plan.site_name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {plan.request_date} ·{" "}
                            {(plan.specialties ?? []).reduce(
                              (sum, item) => sum + Number(item.quantity || 0),
                              0,
                            )}{" "}
                            مطلوب
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{planStatusLabel[plan.status]}</Badge>
                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </div>
                    </summary>
                    <div className="space-y-3 border-t p-4">
                      <div className="flex flex-wrap gap-2">
                        {(plan.specialties ?? []).map((item) => (
                          <Badge
                            key={`${plan.id}-final-${item.specialty}`}
                            style={{
                              backgroundColor: `${item.color}22`,
                              color: item.color,
                              borderColor: item.color,
                            }}
                          >
                            {item.specialty} ({item.quantity})
                          </Badge>
                        ))}
                      </div>

                      {(plan.assigned_staff ?? []).some((group) => group.names.length > 0) && (
                        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                          <div className="font-semibold">الكوادر المخصصة</div>
                          <div className="space-y-3">
                            {(plan.assigned_staff ?? [])
                              .filter((group) => group.names.length > 0)
                              .map((group) => (
                                <div key={`${plan.id}-${group.specialty}`}>
                                  <div className="mb-1 text-sm font-medium">{group.specialty}</div>
                                  <ColoredNameChips
                                    color={
                                      plan.specialties.find(
                                        (item) => item.specialty === group.specialty,
                                      )?.color ?? "#0f766e"
                                    }
                                    names={group.names}
                                  />
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <Input
                          value={finalPlanTitle[plan.id] ?? ""}
                          onChange={(e) =>
                            setFinalPlanTitle((current) => ({
                              ...current,
                              [plan.id]: e.target.value,
                            }))
                          }
                          placeholder="عنوان الخطة النهائية"
                        />
                        <Input
                          value={finalPlanNotes[plan.id] ?? ""}
                          onChange={(e) =>
                            setFinalPlanNotes((current) => ({
                              ...current,
                              [plan.id]: e.target.value,
                            }))
                          }
                          placeholder="ملاحظات الخطة النهائية"
                        />
                      </div>

                      <ResponsivePlanAction
                        label="تأكيد الخطة النهائية ليوم"
                        onAction={() =>
                          finalizePlan.mutate({
                            id: plan.id,
                            finalTitle:
                              finalPlanTitle[plan.id] ?? `الخطة النهائية - ${plan.site_name}`,
                            finalNotes: finalPlanNotes[plan.id] ?? "",
                          })
                        }
                      />
                    </div>
                  </details>
                ))
              )}

              {visibleFinalPlans.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-bold">الخطة النهائية المعتمدة</h3>
                  {visibleFinalPlans.map((plan) =>
                    (() => {
                      const rows = getFinalSpecialtyRows(plan);
                      const specialties = plan.final_plan?.specialties ?? plan.specialties ?? [];
                      const requiredTotal = specialties.reduce(
                        (sum, item) => sum + Number(item.quantity || 0),
                        0,
                      );
                      const assignedTotal = plan.assigned_staff.reduce(
                        (sum, group) => sum + group.names.length,
                        0,
                      );
                      const ctrCode = sites.find((site) => site.id === plan.site_id)?.ctr_code;

                      return (
                        <section
                          key={plan.id}
                          dir="rtl"
                          className="planning-final-print overflow-hidden rounded-xl border bg-card shadow-sm"
                        >
                          <header className="flex flex-col gap-4 bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                            <div className="min-w-0">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="border-emerald-700/30 bg-background/70 font-mono text-emerald-900 dark:text-emerald-100"
                                >
                                  {ctrCode || plan.site_name}
                                </Badge>
                                <span className="text-sm">{plan.request_date}</span>
                                <Badge className="bg-emerald-700 text-white">
                                  {planStatusLabel[plan.status]}
                                </Badge>
                              </div>
                              <h4 className="truncate text-xl font-bold">
                                {plan.final_plan?.title ?? `الخطة النهائية - ${plan.site_name}`}
                              </h4>
                              <p className="mt-1 text-sm opacity-80">{plan.site_name}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                                <Badge variant="outline">
                                  منشئ الخطة: {planCreatorLabel(plan)}
                                </Badge>
                                <Badge variant="outline">
                                  طالب الخطة: {plan.applicant_name || "غير محدد"}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="rounded-lg bg-white/70 px-3 py-2 text-sm dark:bg-black/20">
                                <span className="opacity-75">إجمالي المطلوب</span>
                                <strong className="mr-2 text-lg">{requiredTotal}</strong>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="planning-final-controls min-h-11 shrink-0 bg-background"
                                onClick={() => exportPlanPdf(plan)}
                              >
                                <Printer className="ml-2 h-4 w-4" /> تصدير PDF
                              </Button>
                            </div>
                          </header>

                          <div className="space-y-4 p-4 sm:p-5">
                            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                              <span className="font-semibold">ملاحظات المهندس:</span>{" "}
                              {plan.engineer_notes || plan.final_plan?.notes || "لا توجد ملاحظات"}
                            </div>
                            <div className="planning-final-controls flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h5 className="font-bold">التخصصات والكوادر المخصصة</h5>
                                <p className="text-sm text-muted-foreground">
                                  {rows.length} تخصص ظاهر
                                </p>
                              </div>
                              <div className="relative w-full sm:max-w-xs">
                                <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                  className="min-h-11 pr-9"
                                  value={finalStaffSearch}
                                  onChange={(event) => setFinalStaffSearch(event.target.value)}
                                  placeholder="ابحث عن تخصص أو اسم..."
                                  aria-label="بحث في الخطة النهائية"
                                />
                              </div>
                            </div>

                            {!rows.length ? (
                              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                                {specialties.length
                                  ? "لا توجد تخصصات مطابقة للبحث."
                                  : "لا توجد تخصصات في الخطة النهائية."}
                              </div>
                            ) : (
                              <>
                                <div className="planning-final-desktop hidden max-h-[70vh] overflow-auto rounded-lg border md:block">
                                  <table className="planning-final-table w-full min-w-[700px] text-right text-sm">
                                    <thead className="sticky top-0 z-10 bg-muted text-foreground">
                                      <tr>
                                        <th className="px-4 py-3">التخصص</th>
                                        <th className="w-44 px-4 py-3">العدد المطلوب</th>
                                        <th className="px-4 py-3">الأسماء المضافة</th>
                                        <th className="px-4 py-3">ملاحظات التخصص</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map(({ item, names }, index) => {
                                        const required = Number(item.quantity) || 0;
                                        const missing = Math.max(0, required - names.length);
                                        const complete = missing === 0;
                                        const progress =
                                          required > 0
                                            ? Math.min(100, (names.length / required) * 100)
                                            : 100;
                                        return (
                                          <tr
                                            key={`${plan.id}-${item.specialty}`}
                                            className={`${missing ? "bg-amber-50 dark:bg-amber-950/25" : "bg-background"} ${index % 2 ? "planning-final-stripe" : ""}`}
                                          >
                                            <td className="px-4 py-4">
                                              <Badge
                                                variant="outline"
                                                className="min-w-32 justify-center px-3 py-1.5 text-sm"
                                              >
                                                {item.specialty}
                                              </Badge>
                                            </td>
                                            <td className="px-4 py-4">
                                              <div className="font-bold">{required}</div>
                                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                                <div
                                                  className={`h-full rounded-full ${complete ? "bg-emerald-600" : "bg-amber-500"}`}
                                                  style={{ width: `${progress}%` }}
                                                />
                                              </div>
                                              <div
                                                className={`mt-1 text-xs font-medium ${complete ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}
                                              >
                                                {complete
                                                  ? `✓ مكتمل · ${names.length}/${required}`
                                                  : `ينقص ${missing} · ${names.length}/${required}`}
                                              </div>
                                            </td>
                                            <td className="px-4 py-4">
                                              <ColoredNameChips
                                                color={item.color || "#0f766e"}
                                                names={names}
                                              />
                                            </td>
                                            <td className="max-w-xs px-4 py-4 text-xs text-muted-foreground">
                                              {item.notes || "—"}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="planning-final-mobile space-y-3 md:hidden">
                                  {rows.map(({ item, names }) => {
                                    const required = Number(item.quantity) || 0;
                                    const missing = Math.max(0, required - names.length);
                                    const complete = missing === 0;
                                    const progress =
                                      required > 0
                                        ? Math.min(100, (names.length / required) * 100)
                                        : 100;
                                    return (
                                      <article
                                        key={`${plan.id}-mobile-${item.specialty}`}
                                        className={`rounded-lg border p-3 ${missing ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/25" : "bg-card"}`}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <Badge
                                            variant="outline"
                                            className="max-w-[70%] truncate px-3 py-1.5"
                                          >
                                            {item.specialty}
                                          </Badge>
                                          <div className="text-sm">
                                            <span className="text-muted-foreground">مطلوب</span>{" "}
                                            <strong className="text-lg">{required}</strong>
                                          </div>
                                        </div>
                                        <div className="mt-3">
                                          <ColoredNameChips
                                            color={item.color || "#0f766e"}
                                            names={names}
                                          />
                                        </div>
                                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                                          <div
                                            className={`h-full rounded-full ${complete ? "bg-emerald-600" : "bg-amber-500"}`}
                                            style={{ width: `${progress}%` }}
                                          />
                                        </div>
                                        <div
                                          className={`mt-1 text-xs font-medium ${complete ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}
                                        >
                                          {complete
                                            ? `✓ مكتمل · ${names.length}/${required}`
                                            : `ينقص ${missing} · ${names.length}/${required}`}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              </>
                            )}

                            <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-line">
                              <span className="font-semibold">ملاحظات الخطة: </span>
                              {plan.final_plan?.notes ?? plan.management_notes ?? "لا توجد ملاحظات"}
                            </div>
                            <div className="sr-only">إجمالي الأسماء المضافة: {assignedTotal}</div>
                          </div>
                        </section>
                      );
                    })(),
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        لإدارة بيانات المواقع والتكاليف وإداريي المواقع، استخدم قسم «المواقع» المستقل من القائمة
        الجانبية.
      </p>
    </div>
  );
}

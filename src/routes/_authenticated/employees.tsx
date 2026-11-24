import { direction, displayLocale, ui } from "@/lib/ui-language";
import { useDebouncedValue } from "@/hooks/use-directory-search";
import { EmployeeDocumentsTab } from "@/components/EmployeeDocumentsTab";
import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Pencil, Search, Upload, Loader2, RotateCcw, X, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeProfileContent } from "@/components/EmployeeProfileContent";
import { useServerFn } from "@tanstack/react-start";
import { importEmployees } from "@/lib/employees.functions";
import { useAuth } from "@/hooks/use-auth";
import { attendanceDeviceCodeField, parseEmployeeMessage, requiresDailyOnboardingPay, resolveOnboardingWage, type OnboardingPayType } from "@/lib/employee-onboarding";
import { resolvePayrollWage } from "@/lib/payroll-wage-resolution";
import {
  EMPLOYEE_EXTRA_SOURCE_FIELDS,
  EMPLOYEE_IMPORT_FIELDS,
  EMPLOYEE_SOURCE_BINDINGS,
  getDefaultEmployeeImportField,
  mapEmployeeImportRows,
  readEmployeesWorkbook,
  type EmployeeImportMapping,
  type EmployeeWorkbook,
} from "@/lib/excel-employees";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: ui("الموظفون") }] }),
  component: EmployeesPage,
});

type Emp = { id: string; employee_no: string; attendance_device_id?: string | null; id_no?: string | null; employee_import_data?: Record<string, string | number | boolean | null> | null; full_name: string; email?: string | null; department_id: string | null; position: string | null; status: string; departments?: { name: string } | null };
const directoryColumns = {
  employee_no: "الرقم الوظيفي", full_name: "اسم الموظف", department: "القسم", id_no: "رقم الهوية",
  position: "التخصص / المسمى", device: "رقم جهاز البصمة", pay: "تصنيف الأجر", status: "الحالة",
  email: "البريد الإلكتروني", phone1: "رقم الهاتف", hire_date: "تاريخ المباشرة",
};
type DirectoryColumn = keyof typeof directoryColumns;
const emptyOnboarding = {
  fullName: "", position: "", pin: "", deviceCode: "", wageRateId: "none",
  payType: "monthly" as OnboardingPayType, preferredPayType: "monthly" as OnboardingPayType,
  salaryType: "", wagePosition: "",
};
const iqd = new Intl.NumberFormat("ar-IQ", { style: "currency", currency: "IQD", maximumFractionDigits: 2 });
const columnKeys = Object.keys(directoryColumns) as DirectoryColumn[];
const defaultColumns = columnKeys.slice(0, 8);
const textFields = ["employee_no", "full_name", "id_no", "position", "email", "phone1"] as const;
const emptyFilters = { search: "", employee_no: "", full_name: "", id_no: "", device: "", email: "", phone1: "", department: "", status: "", pay: "", position: "", from: "", to: "" };

function EmployeesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [createdEmployee, setCreatedEmployee] = useState<{ id: string; employee_no: string } | null>(null);
  const [blockedDeletion, setBlockedDeletion] = useState<{ employee: Emp; payroll: boolean } | null>(null);
  const [allowAllAttendanceSites, setAllowAllAttendanceSites] = useState(false);
  const [attendanceSiteIds, setAttendanceSiteIds] = useState<string[]>([]);
  const [checkInGraceHours, setCheckInGraceHours] = useState("0");
  const [profileSearch, setProfileSearch] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [activeTab, setActiveTab] = useState("directory");
  const doImport = useServerFn(importEmployees);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<(EmployeeWorkbook & { fileName: string; mapping: EmployeeImportMapping }) | null>(null);
  const importPlan = useMemo(
    () => importPreview ? mapEmployeeImportRows(importPreview.rows, importPreview.mapping) : { rows: [], skipped: 0, invalidDates: {} },
    [importPreview],
  );
  const invalidDateCount = Object.values(importPlan.invalidDates).reduce((total, count) => total + (count ?? 0), 0);
  const invalidDateDetails = Object.entries(importPlan.invalidDates)
    .filter(([, count]) => !!count)
    .map(([field, count]) => `${EMPLOYEE_IMPORT_FIELDS.find((item) => item.key === field)?.label ?? field}: ${count?.toLocaleString(displayLocale())}`)
    .join("، ");

  async function handleExcel(file: File) {
    setImportMsg("جاري قراءة الملف...");
    try {
      const buf = await file.arrayBuffer();
      const workbook = readEmployeesWorkbook(buf);
      if (!workbook.rows.length) throw new Error("الورقة الأولى لا تحتوي على بيانات موظفين");
      const mapping = Object.fromEntries(workbook.headers.map((header) => [header, getDefaultEmployeeImportField(header)]));
      setImportPreview({ ...workbook, fileName: file.name, mapping });
      setImportDialogOpen(true);
      setImportMsg(null);
    } catch (error) {
      setImportMsg(null);
      toast.error(ui(formatErrorMessage(error, "تعذرت قراءة ملف Excel")));
    }
  }

  async function confirmExcelImport() {
    if (!importPreview) return;
    const { rows: parsed, skipped } = importPlan;
    const targets = Object.values(importPreview.mapping).filter(Boolean);
    const duplicateTargets = new Set(targets.filter((target, index) => targets.indexOf(target) !== index));
    if (duplicateTargets.size) return toast.error(ui("لا يمكن ربط أكثر من عمود مصدر بالحقل النظامي نفسه"));
    if (!Object.values(importPreview.mapping).includes("employee_no") || !Object.values(importPreview.mapping).includes("full_name")) {
      return toast.error(ui("اربط عمود الرقم الوظيفي وعمود اسم الموظف قبل المتابعة"));
    }
    if (!parsed.length) return toast.error(ui("لا توجد صفوف صالحة؛ تحقق من مطابقة الرقم الوظيفي واسم الموظف"));

    setImporting(true); setProgress(0); setImportMsg("جاري استيراد البيانات...");
    try {
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
      setImportDialogOpen(false);
      setImportPreview(null);
      toast.success((ui("تم استيراد ") + (done) + ui(" موظف")));
    } catch (e: unknown) {
      setImportMsg(null);
      toast.error(ui(formatErrorMessage(e, "فشل الاستيراد")));
    } finally {
      setImporting(false);
    }
  }


  const [filters, setFilters] = useState(emptyFilters);
  const [columns, setColumns] = useState<DirectoryColumn[]>(defaultColumns);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("employee-directory-columns") ?? "null");
      const valid = columnKeys.filter(key => Array.isArray(saved) && saved.includes(key));
      if (valid.length) setColumns(valid);
    } catch { /* Use defaults when storage is unavailable. */ }
  }, []);
  function chooseColumns(next: DirectoryColumn[]) {
    setColumns(next);
    setFilters(current => {
      const updated = { ...current };
      for (const key of columnKeys) {
        if (next.includes(key)) continue;
        if (key === "hire_date") {
          updated.from = "";
          updated.to = "";
        } else {
          updated[key] = "";
        }
      }
      return updated;
    });
    try { localStorage.setItem("employee-directory-columns", JSON.stringify(next)); } catch { /* Keep the session preference. */ }
  }
  function changeFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters(current => ({ ...current, [key]: value }));
  }
  const applied = useDebouncedValue(filters);
  const profileTerm = useDebouncedValue(profileSearch.trim());
  const directoryQuery = useInfiniteQuery({
    queryKey: ["employees", "directory", applied],
    enabled: activeTab === "directory",
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      let q = supabase.from("employees").select(
        "id, employee_no, full_name, department_id, departments(name), id_no, position, attendance_device_id, pay_type, status, email, phone1, hire_date",
        { count: pageParam === 0 ? "exact" : undefined },
      );
      const term = applied.search.trim();
      if (term) {
        const pattern = JSON.stringify(`%${term}%`);
        q = q.or(["employee_no","full_name","id_no","attendance_device_id","phone1","email"].map(field => `${field}.ilike.${pattern}`).join(","));
      }
      for (const field of textFields) {
        const value = applied[field].trim();
        if (value) q = q.ilike(field, `%${value}%`);
      }
      if (applied.device.trim()) q = q.ilike("attendance_device_id", `%${applied.device.trim()}%`);
      if (applied.department) q = q.eq("department_id", applied.department);
      if (applied.status) q = q.eq("status", applied.status as "active" | "inactive" | "terminated");
      if (applied.pay) q = q.eq("pay_type", applied.pay);
      if (applied.from) q = q.gte("hire_date", applied.from);
      if (applied.to) q = q.lte("hire_date", applied.to);
      const { data, error, count } = await q.order("created_at", { ascending: false })
        .order("employee_no").range(pageParam, pageParam + 49).abortSignal(signal);
      if (error) throw error;
      return { rows: data, count };
    },
    getNextPageParam: (last, pages, offset) => {
      const next = offset + last.rows.length;
      return last.rows.length && next < (pages[0].count ?? 0) ? next : undefined;
    },
  });
  const { isFetching, isError: directoryError } = directoryQuery;
  const profileWaiting = profileTerm !== profileSearch.trim();
  const { data: matches = [], isFetching: fetchingMatches } = useQuery({
    queryKey: ["employee-profile-search", profileTerm],
    enabled: activeTab === "personal" && !profileWaiting && profileTerm.length >= 2,
    queryFn: async ({ signal }) => {
      const pattern = JSON.stringify(`%${profileTerm}%`);
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position, status, departments(name)")
        .or(`employee_no.ilike.${pattern},full_name.ilike.${pattern}`)
        .order("full_name").limit(20).abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const profileSearching = profileWaiting || fetchingMatches;
  const profileMatches = profileWaiting ? [] : matches;
  const activeProfileId = selectedProfileId || (profileMatches.length === 1 ? profileMatches[0].id : "");
  const openPersonalReport = (employee: Emp) => {
    setProfileSearch(employee.full_name);
    setSelectedProfileId(employee.id);
    setActiveTab("personal");
  };
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["employees_count"],
    queryFn: async () => (await supabase.from("employees").select("id", { count: "exact", head: true })).count ?? 0,
  });
  const { data: depts = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await supabase.from("departments").select("id, name").order("name")).data ?? [],
  });
  const departmentsToCreate = useMemo(() => {
    if (!importPreview || !Object.values(importPreview.mapping).includes("department")) return [];
    const existingNames = new Set(depts.map((department) => department.name.trim()));
    return [...new Set(importPlan.rows.map((row) => row.department?.trim()).filter((name): name is string => !!name && !existingNames.has(name)))];
  }, [depts, importPlan.rows, importPreview]);
  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => (await supabase.from("sites").select("id, name, ctr_code").order("name")).data ?? [],
  });
  const employeeSiteAccessQuery = useQuery({
    queryKey: ["employee-self-attendance-site-access", editing?.id],
    enabled: isAdmin && open && !!editing?.id,
    queryFn: async () => {
      const client = supabase as any;
      const [accessResult, sitesResult] = await Promise.all([
        client.from("employee_self_attendance_access").select("allow_all_sites, check_in_grace_hours").eq("employee_id", editing!.id).maybeSingle(),
        client.from("employee_self_attendance_sites").select("site_id").eq("employee_id", editing!.id),
      ]);
      if (accessResult.error) throw accessResult.error;
      if (sitesResult.error) throw sitesResult.error;
      return {
        allowAll: Boolean(accessResult.data?.allow_all_sites),
        checkInGraceHours: String(accessResult.data?.check_in_grace_hours ?? 0),
        siteIds: (sitesResult.data ?? []).map((row: { site_id: string }) => row.site_id),
      };
    },
  });
  useEffect(() => {
    if (!open) return;
    setAllowAllAttendanceSites(false);
    setAttendanceSiteIds([]);
    setCheckInGraceHours("0");
  }, [open, editing?.id]);
  useEffect(() => {
    if (!employeeSiteAccessQuery.data) return;
    setAllowAllAttendanceSites(employeeSiteAccessQuery.data.allowAll);
    setAttendanceSiteIds(employeeSiteAccessQuery.data.siteIds);
    setCheckInGraceHours(employeeSiteAccessQuery.data.checkInGraceHours);
  }, [employeeSiteAccessQuery.data]);
  const wageQuery = useQuery({
    queryKey: ["wage_rates", "employee-form"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("wage_rates").select("id, title, daily_rate, monthly_rate, overtime_hour_rate, currency").order("title");
      if (error) throw error;
      return data;
    },
  });
  const wages = wageQuery.data ?? [];
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [onboarding, setOnboarding] = useState(emptyOnboarding);
  const needsDaily = !editing && requiresDailyOnboardingPay(onboarding.position);
  const selectedWage = wages.find((wage) => wage.id === onboarding.wageRateId);
  const newPayType = needsDaily ? "daily" : onboarding.payType;
  const wagePreview = selectedWage && resolvePayrollWage({ position: onboarding.position, pay_type: newPayType, wage_rates: selectedWage }, []);
  const wageAmount = wagePreview?.source === "linked" ? (newPayType === "daily" ? wagePreview.dailyRate : wagePreview.monthlySalary) : null;
  const ed = editing as any;

  const applyEmployeeMessage = () => {
    try {
      const parsed = parseEmployeeMessage(employeeMessage);
      const preferredPayType = parsed.payType ?? "monthly";
      const wage = resolveOnboardingWage(parsed.position, preferredPayType, wages);
      setOnboarding({ ...parsed, preferredPayType, wagePosition: parsed.position, wageRateId: wage.wageRateId ?? "none", payType: wage.payType,
        salaryType: wage.payType === "daily" ? "أجر يومي" : "أجر شهري" });
      toast.success(ui("تمت تعبئة البيانات للمراجعة قبل الحفظ"));
    } catch (error) {
      toast.error(ui(formatErrorMessage(error, "تعذر قراءة رسالة الموظف")));
    }
  };


  const sanitizeEmployeePayload = (raw: Record<string, any>) => {
    const toNull = (value: any) => {
      if (value === undefined || value === null) return null;
      const str = String(value).trim();
      return str === "" || str === "none" ? null : str;
    };
    const toNumber = (value: any) => {
      const str = toNull(value);
      return str === null ? null : Number(str);
    };

    return {
      ...(editing ? { employee_no: String(raw.employee_no ?? "").trim() } : {}),
      full_name: String(raw.full_name ?? "").trim(),
      department_id: toNull(raw.department_id),
      site_id: toNull(raw.site_id),
      wage_rate_id: toNull(raw.wage_rate_id),
      position: toNull(raw.position),
      status: raw.status && ["active", "inactive", "terminated"].includes(raw.status) ? raw.status : "active",
      base_salary: toNumber(raw.base_salary),
      pay_type: raw.pay_type === "daily" ? "daily" : "monthly",
      erp_no: toNull(raw.erp_no),
      attendance_device_id: toNull(raw.attendance_device_id),
      id_no: toNull(raw.id_no),
      ctr_code: toNull(raw.ctr_code),
      nationality: toNull(raw.nationality),
      gender: toNull(raw.gender),
      marital_status: toNull(raw.marital_status),
      blood_type: toNull(raw.blood_type),
      education: toNull(raw.education),
      birth_date: toNull(raw.birth_date),
      hire_date: toNull(raw.hire_date),
      last_working_day: toNull(raw.last_working_day),
      contract_type: toNull(raw.contract_type),
      contract_end_date: toNull(raw.contract_end_date),
      email: toNull(raw.email),
      phone1: toNull(raw.phone1),
      phone2: toNull(raw.phone2),
      address: toNull(raw.address),
      salary_type: toNull(raw.salary_type),
      salary_structure: toNull(raw.salary_structure),
      project: toNull(raw.project),
      passport_no: toNull(raw.passport_no),
      passport_expiry: toNull(raw.passport_expiry),
      residency_no: toNull(raw.residency_no),
      residency_expiry: toNull(raw.residency_expiry),
      safety_passport_no: toNull(raw.safety_passport_no),
      safety_passport_expiry: toNull(raw.safety_passport_expiry),
      bank_name: toNull(raw.bank_name),
      bank_account: toNull(raw.bank_account),
      iban: toNull(raw.iban),
      emergency_contact_name: toNull(raw.emergency_contact_name),
      emergency_contact_phone: toNull(raw.emergency_contact_phone),
      notes: toNull(raw.notes),
      employee_import_data: raw.employee_import_data ?? {},
      department_name: toNull(raw.department_name),
      ...Object.fromEntries(EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ column }) => [column, toNull(raw[column])])),
    };
  };

  const closeEmployeeDialog = () => {
    setEmployeeMessage("");
    setOnboarding(emptyOnboarding);
    setCreatedEmployee(null);
    setOpen(false);
    setEditing(null);
  };

  const save = useMutation({
    mutationFn: async (d: any) => {
      const payload = sanitizeEmployeePayload(d);
      const client = supabase as any;
      const graceHours = Number(d.checkInGraceHours);
      if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > 24) {
        throw new Error("مهلة التأخير يجب أن تكون بين صفر و24 ساعة");
      }
      if (isAdmin && editing && employeeSiteAccessQuery.isLoading) {
        throw new Error("انتظر اكتمال تحميل إعدادات الحضور قبل الحفظ");
      }
      if (isAdmin && editing && employeeSiteAccessQuery.isError) {
        throw new Error("تعذر تحميل إعدادات الحضور السابقة؛ أعد فتح ملف الموظف قبل الحفظ");
      }
      let employeeNo = createdEmployee?.employee_no;
      let employeeId = editing?.id ?? createdEmployee?.id;
      if (employeeId) {
        const { error } = await client.from("employees").update(payload).eq("id", employeeId);
        if (error) throw error;
      } else {
        const { data, error } = await client.from("employees").insert(payload).select("id, employee_no").single();
        if (error) throw error;
        // Retry attendance settings against the same employee if a later request fails.
        setCreatedEmployee(data);
        employeeNo = data.employee_no;
        employeeId = data.id;
      }
      if (isAdmin) {
        const { error: accessError } = await client.rpc("set_employee_self_attendance_site_access", {
          p_employee_id: employeeId,
          p_allow_all_sites: d.allowAllAttendanceSites,
          p_site_ids: d.allowAllAttendanceSites ? [] : d.attendanceSiteIds,
        });
        if (accessError) throw accessError;
        const { error: graceError } = await client.rpc("set_employee_self_attendance_check_in_grace", {
          p_employee_id: employeeId,
          p_hours: graceHours,
        });
        if (graceError) throw graceError;
      }
      return employeeNo;
    },
    onSuccess: (employeeNo) => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employees_count"] });
      qc.invalidateQueries({ queryKey: ["employee-self-attendance-site-access"] });
      closeEmployeeDialog();
      toast.success(employeeNo ? (ui("تم الحفظ · الرقم الوظيفي ") + (employeeNo)) : ui("تم الحفظ"));
    },
    onError: (e: any) => toast.error(ui(formatErrorMessage(e))),
  });
  const del = useMutation({
    mutationFn: async (employee: Emp) => {
      const { error } = await supabase.from("employees").delete().eq("id", employee.id).select("id").single();
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["employees_count"] }); toast.success(ui("تم الحذف")); },
    onError: (error: { code?: string; message: string }, employee) => {
      if (error.code === "23503") {
        setBlockedDeletion({ employee, payroll: error.message.includes("payroll_run_lines") });
      } else toast.error(ui(formatErrorMessage(error)));
    },
  });
  const updateStatus = useMutation({
    mutationFn: async ({ employeeId, status }: { employeeId: string; status: "active" | "inactive" | "terminated" }) => {
      const { error } = await supabase.from("employees").update({ status }).eq("id", employeeId).select("id").single();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-profile"] });
      qc.invalidateQueries({ queryKey: ["employee-profile-search"] });
      setBlockedDeletion(null);
      toast.success(ui("تم تحديث حالة الموظف"));
    },
    onError: (error: unknown) => toast.error(ui(formatErrorMessage(error))),
  });

  const filtered = directoryQuery.data?.pages.flatMap(page => page.rows) ?? [];
  const matchCount = directoryQuery.data?.pages[0]?.count ?? 0;
  const visibleColumns = columnKeys.filter(key => columns.includes(key));
  const options = {
    department: depts.map(d => [d.id, d.name]),
    pay: [["daily", "يومي"], ["monthly", "شهري"]],
    status: [["active", "نشط"], ["inactive", "معطل"], ["terminated", "منتهي"]],
  };
  const editEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("employees").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    onSuccess: data => { setEditing(data as Emp); setOpen(true); },
    onError: error => toast.error(ui(formatErrorMessage(error))),
  });

  return (
    <div className="space-y-6">
      <Dialog open={!!blockedDeletion} onOpenChange={open => { if (!open && !updateStatus.isPending) setBlockedDeletion(null); }}>
        <DialogContent dir={direction()}>
          <DialogHeader><DialogTitle>{ui("تعذّر حذف ملف الموظف")}</DialogTitle></DialogHeader>
          {blockedDeletion && <>
            <p className="font-medium">{blockedDeletion.employee.full_name}{ui(" · الرقم الوظيفي ")}{blockedDeletion.employee.employee_no}</p>
            <p>{blockedDeletion.payroll ? ui("هذا الملف مرتبط بمسير رواتب محفوظ.") : ui("هذا الملف مرتبط بسجلات أخرى في النظام.")}{ui(" إذا كان الملف مكرراً، يمكنك تعطيله مع الاحتفاظ بسجلاته.")}</p>
            <div className="flex flex-wrap gap-2">
              {blockedDeletion.employee.status === "active" && <Button disabled={updateStatus.isPending} onClick={() => updateStatus.mutate({employeeId:blockedDeletion.employee.id,status:"inactive"})}>
                {updateStatus.isPending ? ui("جارٍ التعطيل…") : ui("تعطيل هذا الملف")}
              </Button>}
              <Button variant="outline" disabled={updateStatus.isPending} onClick={() => setBlockedDeletion(null)}>{ui("إغلاق")}</Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent sm:w-fit sm:grid-cols-3">
          <TabsTrigger value="directory" className="min-h-11 rounded-xl border">{ui("دليل الموظفين")}</TabsTrigger>
          <TabsTrigger value="personal" className="min-h-11 rounded-xl border">{ui("التقرير الشخصي")}</TabsTrigger>
          <TabsTrigger value="documents" className="min-h-11 whitespace-normal rounded-xl border">{ui("المستندات والأوامر الإدارية")}</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="mt-0 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{ui("الموظفون")}</h1>
          <p className="text-muted-foreground mt-1">{ui("إجمالي: ")}{totalCount}{ui(" موظف")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input id="emp-excel" type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) handleExcel(f); }} />
          <Button variant="outline" disabled={importing} onClick={() => document.getElementById("emp-excel")?.click()}>
            {importing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}{ui("استيراد من Excel")}</Button>
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogContent dir={direction()} className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle>{ui("مطابقة حقول ملف الموظفين")}</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {importPreview?.fileName} · {importPreview?.sheetName} · {importPreview?.rows.length.toLocaleString(displayLocale())}{ui(" صفوف")}</p>
              </DialogHeader>
              {importPreview && (
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">{ui("اربط الأعمدة التي تطابق حقول النظام. تُحفظ جميع أعمدة الملف وقيمها الأصلية في ملف الموظف حتى إن لم يكن لها حقل نظامي مباشر، والخلايا الفارغة لا تمسح بيانات موجودة.")}<div className="mt-1 text-muted-foreground">{ui("تمت مطابقة ")}{Object.values(importPreview.mapping).filter(Boolean).length}{ui(" عموداً مع الحقول النظامية، وستُحفظ بقية الأعمدة ضمن بيانات الملف ·")}{" "}{ui("صفوف صالحة ")}{importPlan.rows.length.toLocaleString(displayLocale())}{ui(" · متجاهلة ")}{importPlan.skipped.toLocaleString(displayLocale())}
                    </div>
                    {invalidDateCount > 0 && <p role="alert" className="mt-2 text-amber-700">{ui("تعذر تحويل ")}{invalidDateCount.toLocaleString(displayLocale())}{ui(" قيمة إلى تاريخ (")}{invalidDateDetails}{ui(")؛ لن تُستورد كتاريخ. الخلايا الفارغة أو غير الصالحة لا تمسح التاريخ الموجود.")}</p>}
                    {departmentsToCreate.length > 0 && <p className="mt-2 text-amber-700">{ui("توجد ")}{departmentsToCreate.length.toLocaleString(displayLocale())}{ui(" أسماء أقسام غير مطابقة للأقسام الحالية؛ سيُنشئها النظام تلقائياً عند الاستيراد.")}</p>}
                  </div>
                  <div className="space-y-2">
                    {importPreview.headers.map((header, index) => (
                      <div key={index} className="grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={header}>{header || ui("عمود بلا عنوان")}</p>
                          <p className="text-xs text-muted-foreground">{ui("عمود الملف")}</p>
                        </div>
                        <Select
                          value={importPreview.mapping[header] || "__ignore__"}
                          onValueChange={(value) => setImportPreview((current) => current ? {
                            ...current,
                            mapping: { ...current.mapping, [header]: value === "__ignore__" ? "" : value as EmployeeImportMapping[string] },
                          } : current)}
                        >
                          <SelectTrigger><SelectValue placeholder={ui("تجاهل هذا العمود")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__ignore__">{ui("تجاهل هذا العمود")}</SelectItem>
                            {EMPLOYEE_IMPORT_FIELDS.map((field) => {
                              const usedElsewhere = Object.entries(importPreview.mapping)
                                .some(([source, target]) => source !== header && target === field.key);
                              return <SelectItem key={field.key} value={field.key} disabled={usedElsewhere}>{ui(field.label)}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="mb-2 text-sm font-semibold">{ui("معاينة السجلات بعد المطابقة")}</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>{ui("الرقم الوظيفي")}</TableHead><TableHead>{ui("اسم الموظف")}</TableHead><TableHead>{ui("القسم")}</TableHead><TableHead>{ui("رقم جهاز البصمة")}</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {importPlan.rows.slice(0, 5).map((row) => (
                            <TableRow key={row.employee_no}>
                              <TableCell>{row.employee_no}</TableCell><TableCell>{row.full_name}</TableCell>
                              <TableCell>{row.department || "—"}</TableCell><TableCell>{row.attendance_device_id || "—"}</TableCell>
                            </TableRow>
                          ))}
                          {!importPlan.rows.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{ui("اربط الرقم الوظيفي واسم الموظف لعرض المعاينة.")}</TableCell></TableRow>}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
                <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importing}>{ui("إلغاء")}</Button>
                <Button type="button" onClick={confirmExcelImport} disabled={importing || !importPlan.rows.length}>
                  {importing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Upload className="ml-2 h-4 w-4" />}{ui("استيراد ")}{importPlan.rows.length.toLocaleString(displayLocale())}{ui(" سجل")}</Button>
              </div>
            </DialogContent>
          </Dialog>
        <Dialog open={open} onOpenChange={(o) => {
          if (o) setOpen(true);
          else if (!save.isPending) closeEmployeeDialog();
        }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" />{ui(" موظف جديد")}</Button></DialogTrigger>
          <DialogContent dir={direction()} className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-2xl border-0 p-0 shadow-2xl">
            <DialogHeader className="shrink-0 border-b bg-gradient-to-l from-teal-950 via-teal-800 to-cyan-700 px-6 py-5 text-white">
              <DialogTitle className="text-xl text-white">{editing ? ui("تحديث بيانات الموظف") : ui("إضافة موظف جديد")}</DialogTitle>
              <p className="text-sm text-teal-50/80">{ui("ابدأ بالبيانات الأساسية والتكليف؛ بقية التفاصيل اختيارية ويمكن إضافتها لاحقاً.")}</p>
            </DialogHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (save.isPending) return;
              if (isAdmin && editing && (employeeSiteAccessQuery.isLoading || employeeSiteAccessQuery.isError)) {
                toast.error(ui("تعذر تحميل صلاحيات المواقع؛ أعد فتح ملف الموظف قبل الحفظ"));
                return;
              }
              const f = new FormData(e.currentTarget);
              const g = (k: string) => { const v = (f.get(k) as string ?? "").trim(); return v === "" || v === "none" ? null : v; };
              const n = (k: string) => { const v = g(k); return v === null ? null : Number(v); };
              const selectedDepartment = depts.find((department: any) => department.id === g("department_id"));
              const sourceFields = Object.fromEntries([
                ...Object.entries(EMPLOYEE_SOURCE_BINDINGS).map(([header, field]) => [
                  header,
                  field === "department_name" ? selectedDepartment?.name ?? null : g(field),
                ]),
                ...EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header }) => [header, g(`source_${header}`)]),
              ]);
              sourceFields[attendanceDeviceCodeField] = g("attendance_device_code");
              const sourceColumns = Object.fromEntries([
                ["department_name", selectedDepartment?.name ?? null],
                ...EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header, column }) => [column, g(`source_${header}`)]),
              ]);
              save.mutate({
                employee_no: f.get("employee_no") as string,
                full_name: f.get("full_name") as string,
                department_id: g("department_id"),
                site_id: g("site_id"),
                wage_rate_id: g("wage_rate_id"),
                attendance_device_id: g("attendance_device_id"),
                position: g("position"),
                status: f.get("status") as any,
                base_salary: n("base_salary"),
                pay_type: needsDaily ? "daily" : (f.get("pay_type") as string) || "monthly",
                erp_no: g("erp_no"), id_no: g("id_no"), ctr_code: g("ctr_code"),
                nationality: g("nationality"), gender: g("gender"), marital_status: g("marital_status"),
                blood_type: g("blood_type"), education: g("education"),
                birth_date: g("birth_date"), hire_date: g("hire_date"), last_working_day: g("last_working_day"),
                contract_type: g("contract_type"), contract_end_date: g("contract_end_date"),
                email: g("email"), phone1: g("phone1"), phone2: g("phone2"), address: g("address"),
                allowAllAttendanceSites,
                attendanceSiteIds,
                checkInGraceHours,
                salary_type: needsDaily ? "أجر يومي" : g("salary_type"), salary_structure: g("salary_structure"), project: g("project"),
                passport_no: g("passport_no"), passport_expiry: g("passport_expiry"),
                residency_no: g("residency_no"), residency_expiry: g("residency_expiry"),
                safety_passport_no: g("safety_passport_no"), safety_passport_expiry: g("safety_passport_expiry"),
                bank_name: g("bank_name"), bank_account: g("bank_account"), iban: g("iban"),
                emergency_contact_name: g("emergency_contact_name"), emergency_contact_phone: g("emergency_contact_phone"),
                notes: g("notes"),
                employee_import_data: { ...(editing?.employee_import_data ?? {}), ...sourceFields },
                ...sourceColumns,
              });
            }} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              {!editing && (
                <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                  <Label htmlFor="employee-message" className="font-semibold">{ui("لصق رسالة الموظف")}</Label>
                  <Textarea id="employee-message" value={employeeMessage} onChange={(event) => setEmployeeMessage(event.target.value)} maxLength={2000} rows={5}
                    placeholder={ui("إضافة جديدة\nالاسم الكامل\nالمسمى الوظيفي\nأجر يومي أو شهري\nID-6\nAK D25")} />
                  <Button type="button" variant="outline" disabled={!employeeMessage.trim() || wageQuery.isPending || save.isPending} onClick={applyEmployeeMessage}>{ui("تعبئة البيانات من الرسالة")}</Button>
                </section>
              )}
              <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div><h3 className="font-semibold">{ui("البيانات الأساسية")}</h3><p className="text-xs text-muted-foreground">{ui("الحقول ذات النجمة مطلوبة لإتمام الحفظ.")}</p></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="employee-no">{ui("الرقم الوظيفي")}{editing && " *"}</Label>
                    <Input
                      key={editing?.id ?? "new"}
                      id="employee-no"
                      name="employee_no"
                      required={!!editing}
                      autoFocus={!!editing}
                      readOnly={!editing}
                      placeholder={ui("يُعيّن تلقائيًا عند الحفظ")}
                      {...(editing
                        ? { defaultValue: editing.employee_no }
                        : { value: createdEmployee?.employee_no ?? "" })}
                    />
                  </div>
                  <div><Label htmlFor="employee-attendance-pin">{ui("معرّف الموظف في جهاز البصمة")}</Label><Input id="employee-attendance-pin" name="attendance_device_id" {...(editing ? { defaultValue: ed?.attendance_device_id ?? "" } : { value: onboarding.pin, onChange: (event) => setOnboarding((previous) => ({ ...previous, pin: event.target.value })) })} /></div>
                  <div><Label htmlFor="employee-attendance-device">{ui("رمز جهاز البصمة")}</Label><Input id="employee-attendance-device" name="attendance_device_code" maxLength={64} {...(editing ? { defaultValue: editing.employee_import_data?.[attendanceDeviceCodeField]?.toString() ?? "" } : { value: onboarding.deviceCode, onChange: (event) => setOnboarding((previous) => ({ ...previous, deviceCode: event.target.value })) })} /></div>
                  <div className="md:col-span-2"><Label htmlFor="employee-full-name">{ui("الاسم الكامل *")}</Label><Input id="employee-full-name" name="full_name" required autoFocus={!editing} placeholder={ui("الاسم كما في المستندات الرسمية")} {...(editing ? { defaultValue: ed?.full_name ?? "" } : { value: onboarding.fullName, onChange: (event) => setOnboarding((previous) => ({ ...previous, fullName: event.target.value })) })} /></div>
                  <div><Label htmlFor="employee-position">{ui("المسمى الوظيفي")}</Label><Input id="employee-position" name="position" {...(editing ? { defaultValue: ed?.position ?? "" } : {
                    value: onboarding.position,
                    onChange: (event) => setOnboarding((previous) => ({ ...previous, position: event.target.value })),
                    onBlur: () => setOnboarding((previous) => {
                      if (!previous.position.trim() || previous.wagePosition === previous.position) return previous;
                      const wage = resolveOnboardingWage(previous.position, previous.preferredPayType, wages);
                      return { ...previous, wagePosition: previous.position, wageRateId: wage.wageRateId ?? "none", payType: wage.payType, salaryType: wage.payType === "daily" ? "أجر يومي" : "أجر شهري" };
                    }),
                  })} /></div>
                  <div>
                    <Label>{ui("القسم")}</Label>
                    <Select name="department_id" defaultValue={ed?.department_id ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{ui("— بدون —")}</SelectItem>
                        {depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{ui("الحالة")}</Label>
                    <Select name="status" defaultValue={ed?.status ?? "active"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{ui("نشط")}</SelectItem>
                        <SelectItem value="inactive">{ui("معطل")}</SelectItem>
                        <SelectItem value="terminated">{ui("منتهي")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>NO EM ERP</Label><Input name="erp_no" defaultValue={ed?.erp_no ?? ""} /></div>
                  <div><Label>{ui("رقم الهوية")}</Label><Input name="id_no" defaultValue={ed?.id_no ?? ""} /></div>
                  <div><Label>{ui("المشروع")}</Label><Input name="project" defaultValue={ed?.project ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-teal-900/10 bg-teal-50/40 p-4 shadow-sm dark:bg-teal-950/10">
                <div><h3 className="font-semibold">{ui("التكليف والأجر")}</h3><p className="text-xs text-muted-foreground">{ui("حدد القسم وموقع العمل ونوع الأجر لتسهيل توزيع الموظف واحتساب التكلفة.")}</p></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>{ui("موقع العمل")}</Label>
                    <Select name="site_id" defaultValue={ed?.site_id ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{ui("— بدون —")}</SelectItem>
                        {sites.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.ctr_code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>{ui("كود التكلفة CTR")}</Label><Input name="ctr_code" defaultValue={ed?.ctr_code ?? ""} /></div>
                  <div>
                    <Label>{ui("أجر التخصص")}</Label>
                    <Select name="wage_rate_id" {...(editing ? { defaultValue: ed?.wage_rate_id ?? "none" } : {
                      value: onboarding.wageRateId,
                      onValueChange: (value: string) => setOnboarding((previous) => ({ ...previous, wageRateId: value })),
                    })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{ui("— بدون —")}</SelectItem>
                        {wages.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!editing && onboarding.position.trim() && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {wageAmount && wageAmount > 0
                          ? ((iqd.format(wageAmount)) + " " + (newPayType === "daily" ? "يوميًا" : "شهريًا"))
                          : ui("لم يُحدد أجر معتمد لهذا التخصص. راجع الأجر قبل الحفظ.")}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>{ui("تصنيف الأجر *")}</Label>
                    <Select name="pay_type" {...(editing ? { defaultValue: ed?.pay_type ?? "monthly" } : {
                      value: newPayType,
                      onValueChange: (value: string) => {
                        const payType = value === "daily" ? "daily" : "monthly";
                        setOnboarding((previous) => ({ ...previous, payType, preferredPayType: payType, salaryType: payType === "daily" ? "أجر يومي" : "أجر شهري" }));
                      },
                    })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly" disabled={needsDaily}>{ui("شهري")}</SelectItem>
                        <SelectItem value="daily">{ui("يومي (تُحتسب أيام الجمعة بأجر)")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {needsDaily && <p className="mt-1 text-xs text-muted-foreground">{ui("هذا التخصص يُسجّل بأجر يومي.")}</p>}
                  </div>
                  <div><Label>{ui("الراتب الأساسي")}</Label><Input name="base_salary" type="number" step="0.01" defaultValue={ed?.base_salary ?? ""} /></div>
                  <div><Label>{ui("نوع الراتب")}</Label><Input name="salary_type" {...(editing ? { defaultValue: ed?.salary_type ?? "" } : { value: needsDaily ? "أجر يومي" : onboarding.salaryType, readOnly: needsDaily, onChange: (event) => setOnboarding((previous) => ({ ...previous, salaryType: event.target.value })) })} /></div>
                  <div><Label>{ui("هيكل الراتب")}</Label><Input name="salary_structure" defaultValue={ed?.salary_structure ?? ""} /></div>
                </div>
              </section>

              {isAdmin && (
                <section className="space-y-3 rounded-xl border border-cyan-900/10 bg-cyan-50/40 p-4 shadow-sm dark:bg-cyan-950/10">
                  <div>
                    <h3 className="font-semibold">{ui("إعدادات الحضور الذاتي")}</h3>
                    <p className="text-xs text-muted-foreground">{ui("اختر المواقع المسموحة وحدد مهلة تجاوز حد تسجيل الدخول لهذا الموظف.")}</p>
                  </div>
                  <div className="max-w-xs space-y-2 rounded-lg border bg-background p-3">
                    <Label htmlFor="employee-check-in-grace">{ui("مهلة تجاوز حد تسجيل الدخول (ساعات)")}</Label>
                    <Input
                      id="employee-check-in-grace"
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      value={checkInGraceHours}
                      onChange={(event) => setCheckInGraceHours(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{ui("صفر: لا توجد مهلة إضافية. الحد الأعلى 24 ساعة بعد وقت الدخول المحدد في إعدادات الحضور.")}</p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-3">
                    <Checkbox
                      checked={allowAllAttendanceSites}
                      onCheckedChange={(checked) => setAllowAllAttendanceSites(checked === true)}
                    />
                    <span>
                      <span className="block text-sm font-medium">{ui("السماح بالتسجيل من كل المواقع")}</span>
                      <span className="block text-xs text-muted-foreground">{ui("يُحدد الموقع تلقائياً من GPS ضمن نطاقه الجغرافي.")}</span>
                    </span>
                  </label>
                  {!allowAllAttendanceSites && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {sites.map((site: any) => (
                        <label key={site.id} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background p-2 text-sm">
                          <Checkbox
                            checked={attendanceSiteIds.includes(site.id)}
                            onCheckedChange={(checked) => setAttendanceSiteIds((current) =>
                              checked === true
                                ? [...new Set([...current, site.id])]
                                : current.filter((id) => id !== site.id),
                            )}
                          />
                          <span>{site.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {employeeSiteAccessQuery.isLoading && editing && (
                    <p className="text-xs text-muted-foreground">{ui("جارٍ تحميل سماح المواقع...")}</p>
                  )}
                  {employeeSiteAccessQuery.isError && editing && (
                    <p role="alert" className="text-xs text-destructive">{ui("تعذر تحميل سماح المواقع: ")}{ui(formatErrorMessage(employeeSiteAccessQuery.error))}</p>
                  )}
                </section>
              )}

              <details className="group rounded-xl border bg-card p-4 shadow-sm">
                <summary className="cursor-pointer list-none font-semibold marker:hidden"><span className="flex items-center justify-between">{ui("البيانات الإضافية ")}<span className="text-xs font-normal text-muted-foreground group-open:hidden">{ui("الجنسية، التواصل، العقد والحساب البنكي")}</span><span className="hidden text-xs font-normal text-muted-foreground group-open:inline">{ui("إخفاء التفاصيل")}</span></span></summary>
                <div className="mt-4 space-y-5 border-t pt-4">
              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">{ui("البيانات الشخصية")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>{ui("الجنسية")}</Label><Input name="nationality" defaultValue={ed?.nationality ?? ""} /></div>
                  <div>
                    <Label>{ui("الجنس")}</Label>
                    <Select name="gender" defaultValue={ed?.gender ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{ui("— غير محدد —")}</SelectItem>
                        <SelectItem value="male">{ui("ذكر")}</SelectItem>
                        <SelectItem value="female">{ui("أنثى")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>{ui("الحالة الاجتماعية")}</Label><Input name="marital_status" defaultValue={ed?.marital_status ?? ""} /></div>
                  <div><Label>{ui("فصيلة الدم")}</Label><Input name="blood_type" defaultValue={ed?.blood_type ?? ""} /></div>
                  <div><Label>{ui("التعليم")}</Label><Input name="education" defaultValue={ed?.education ?? ""} /></div>
                  <div><Label>{ui("تاريخ الميلاد")}</Label><Input name="birth_date" type="date" defaultValue={ed?.birth_date ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">{ui("التواصل")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>{ui("البريد الإلكتروني")}</Label><Input name="email" type="email" defaultValue={ed?.email ?? ""} /></div>
                  <div><Label>{ui("هاتف 1")}</Label><Input name="phone1" defaultValue={ed?.phone1 ?? ""} /></div>
                  <div><Label>{ui("هاتف 2")}</Label><Input name="phone2" defaultValue={ed?.phone2 ?? ""} /></div>
                  <div className="md:col-span-3"><Label>{ui("عنوان السكن")}</Label><Input name="address" defaultValue={ed?.address ?? ""} /></div>
                  <div><Label>{ui("جهة اتصال الطوارئ")}</Label><Input name="emergency_contact_name" defaultValue={ed?.emergency_contact_name ?? ""} /></div>
                  <div><Label>{ui("هاتف الطوارئ")}</Label><Input name="emergency_contact_phone" defaultValue={ed?.emergency_contact_phone ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">{ui("العقد والوثائق")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>{ui("تاريخ المباشرة")}</Label><Input name="hire_date" type="date" defaultValue={ed?.hire_date ?? ""} /></div>
                  <div><Label>{ui("آخر يوم عمل")}</Label><Input name="last_working_day" type="date" defaultValue={ed?.last_working_day ?? ""} /></div>
                  <div><Label>{ui("نوع العقد")}</Label><Input name="contract_type" defaultValue={ed?.contract_type ?? ""} /></div>
                  <div><Label>{ui("انتهاء العقد")}</Label><Input name="contract_end_date" type="date" defaultValue={ed?.contract_end_date ?? ""} /></div>
                  <div><Label>{ui("رقم الجواز")}</Label><Input name="passport_no" defaultValue={ed?.passport_no ?? ""} /></div>
                  <div><Label>{ui("انتهاء الجواز")}</Label><Input name="passport_expiry" type="date" defaultValue={ed?.passport_expiry ?? ""} /></div>
                  <div><Label>{ui("رقم الإقامة")}</Label><Input name="residency_no" defaultValue={ed?.residency_no ?? ""} /></div>
                  <div><Label>{ui("انتهاء الإقامة")}</Label><Input name="residency_expiry" type="date" defaultValue={ed?.residency_expiry ?? ""} /></div>
                  <div><Label>{ui("رقم جواز السلامة")}</Label><Input name="safety_passport_no" defaultValue={ed?.safety_passport_no ?? ""} /></div>
                  <div><Label>{ui("انتهاء جواز السلامة")}</Label><Input name="safety_passport_expiry" type="date" defaultValue={ed?.safety_passport_expiry ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">{ui("حقول الملف الشامل الإضافية")}</h3>
                <p className="text-xs text-muted-foreground">{ui("تُحفظ هذه الحقول كما وردت في قاعدة البيانات الشاملة، وتظهر في ملف الموظف.")}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {EMPLOYEE_EXTRA_SOURCE_FIELDS.map(({ header, column }) => (
                    <div key={column}>
                      <Label htmlFor={`source_${header}`}>{header}</Label>
                      <Input id={`source_${header}`} name={`source_${header}`} defaultValue={String(ed?.[column] ?? ed?.employee_import_data?.[header] ?? "")} />
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">{ui("المعلومات البنكية والملاحظات")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>{ui("اسم البنك")}</Label><Input name="bank_name" defaultValue={ed?.bank_name ?? ""} /></div>
                  <div><Label>{ui("رقم الحساب")}</Label><Input name="bank_account" defaultValue={ed?.bank_account ?? ""} /></div>
                  <div><Label>IBAN</Label><Input name="iban" defaultValue={ed?.iban ?? ""} /></div>
                  <div className="md:col-span-3"><Label>{ui("ملاحظات")}</Label><Textarea name="notes" defaultValue={ed?.notes ?? ""} /></div>
                </div>
              </section>
                </div>
              </details>
              <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-background/95 p-4 backdrop-blur sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={save.isPending} onClick={closeEmployeeDialog}>{ui("إلغاء")}</Button>
                <Button type="submit" className="min-w-36 bg-gradient-to-l from-teal-800 to-emerald-600 shadow-md" disabled={save.isPending || (isAdmin && !!editing && (employeeSiteAccessQuery.isLoading || employeeSiteAccessQuery.isError))}>{save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}{save.isPending ? ui("جارٍ الحفظ...") : editing ? ui("حفظ التعديلات") : ui("حفظ بيانات الموظف")}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>
      {(importing || importMsg) && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <p className="text-sm">{importMsg}</p>
            {importing && <Progress value={progress} />}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{ui("القائمة")}</CardTitle>
          <div className="relative w-full max-w-80">
            <Search className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input aria-label={ui("بحث في دليل الموظفين")} placeholder={ui("الاسم، الرقم، الهوية، البصمة، الهاتف أو البريد")} className="pr-9" value={filters.search} onChange={e => changeFilter("search", e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-start gap-4">
            <details><summary className="cursor-pointer py-2 font-medium">{ui("تخصيص الأعمدة")}</summary><div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              {columnKeys.map(key => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={columns.includes(key)} disabled={columns.length === 1 && columns[0] === key} onChange={e => chooseColumns(e.target.checked ? [...columns,key] : columns.filter(col => col !== key))} />{ui(directoryColumns[key])}</label>)}
              <Button variant="ghost" onClick={() => chooseColumns(defaultColumns)}>{ui("استعادة الأعمدة الافتراضية")}</Button>
            </div></details>
          </div>
          <Table dir={direction()} aria-busy={isFetching}>
            <TableHeader>
              <TableRow>{visibleColumns.map(key => <TableHead key={key}>{ui(directoryColumns[key])}</TableHead>)}
                <TableHead>{ui("الإجراءات ")}{isFetching && <Loader2 aria-label={ui("جارٍ تحديث النتائج")} className="inline size-3.5 animate-spin text-muted-foreground" />}</TableHead>
              </TableRow>
              <TableRow>
                {visibleColumns.map(key => {
                  const label = `تصفية حسب ${directoryColumns[key]}`;
                  let control;
                  if (key === "department" || key === "pay" || key === "status") {
                    control = <select aria-label={ui(label)} className="h-8 w-full rounded-md border border-input bg-background px-1 text-xs" value={filters[key]} onChange={e => changeFilter(key, e.target.value)}>
                      <option value="">{ui("الكل")}</option>
                      {options[key].map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                    </select>;
                  } else if (key === "hire_date") {
                    control = <div className="flex gap-1">{(["from", "to"] as const).map(edge =>
                      <Input key={edge} type="date" aria-label={edge === "from" ? ui("تاريخ المباشرة من") : ui("تاريخ المباشرة إلى")} className="h-8 w-32 px-1 text-xs" value={filters[edge]} onChange={e => changeFilter(edge, e.target.value)} />
                    )}</div>;
                  } else {
                    control = <div className="relative">
                      <Input aria-label={ui(label)} placeholder={ui("بحث…")} inputMode={key === "device" ? "numeric" : undefined} className="h-8 ps-2 pe-6 text-xs" value={filters[key]} onChange={e => changeFilter(key, e.target.value)} />
                      {filters[key] && <button type="button" aria-label={(ui("مسح فلتر ") + (directoryColumns[key]))} className="absolute end-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground" onClick={() => changeFilter(key, "")}><X className="size-3.5" /></button>}
                    </div>;
                  }
                  return <TableHead key={key} className="h-10 min-w-24 px-2">{control}</TableHead>;
                })}
                <TableHead><Button size="sm" variant="ghost" onClick={() => setFilters(emptyFilters)}><RotateCcw className="size-3.5" />{ui("مسح كل الفلاتر")}</Button></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody showAllRows>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  {columns.includes("employee_no") && <TableCell className="font-mono">{e.employee_no}</TableCell>}
                  {columns.includes("full_name") && <TableCell className="font-medium"><button type="button" onClick={() => openPersonalReport(e)} className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline" aria-label={(ui("فتح التقرير الشخصي لـ ") + (e.full_name))}>{e.full_name}</button></TableCell>}
                  {columns.includes("department") && <TableCell>{e.departments?.name ?? "-"}</TableCell>}
                  {columns.includes("id_no") && <TableCell className="font-mono">{e.id_no || "-"}</TableCell>}
                  {columns.includes("position") && <TableCell>{e.position ?? "-"}</TableCell>}
                  {columns.includes("device") && <TableCell className="font-mono">{e.attendance_device_id || "-"}</TableCell>}
                  {columns.includes("pay") && <TableCell>{e.pay_type === "daily" ? ui("يومي") : ui("شهري")}</TableCell>}
                  {columns.includes("status") && <TableCell>
                    <Select value={e.status} onValueChange={(status: "active" | "inactive" | "terminated") => updateStatus.mutate({ employeeId: e.id, status })}>
                      <SelectTrigger className="h-9 min-w-28" aria-label={(ui("حالة ") + (e.full_name))}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{ui("نشط")}</SelectItem>
                        <SelectItem value="inactive">{ui("معطل")}</SelectItem>
                        <SelectItem value="terminated">{ui("منتهي")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>}
                  {columns.includes("email") && <TableCell>{e.email || "—"}</TableCell>}
                  {columns.includes("phone1") && <TableCell>{e.phone1 || "—"}</TableCell>}
                  {columns.includes("hire_date") && <TableCell>{e.hire_date || "—"}</TableCell>}
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title={ui("فتح التقرير الشخصي")} aria-label={ui("فتح التقرير الشخصي")} onClick={() => openPersonalReport(e)}><UserRound className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" title={ui("تعديل الموظف")} aria-label={ui("تعديل الموظف")} disabled={editEmployee.isPending} onClick={() => editEmployee.mutate(e.id)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" disabled={del.isPending} aria-label={(ui("حذف ملف ") + (e.full_name) + ui(" رقم ") + (e.employee_no))} onClick={() => { if (confirm((ui("حذف ملف ") + (e.full_name) + ui(" ذي الرقم الوظيفي ") + (e.employee_no) + "؟"))) del.mutate(e); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(directoryError || !filtered.length) && <TableRow><TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground py-8">{directoryError ? ui("تعذر تحميل الموظفين") : isFetching ? ui("جارٍ تحميل الموظفين…") : ui("لا يوجد موظفون مطابقون")}</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-center gap-3">
            <p className="text-xs text-muted-foreground">{ui("يتم عرض ")}{filtered.length}{ui(" من إجمالي ")}{matchCount}{ui(" موظف مطابق للفلترة")}</p>
            {directoryQuery.hasNextPage && (
              <Button variant="outline" size="sm" disabled={isFetching} onClick={() => directoryQuery.fetchNextPage()}>
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : ui("عرض المزيد")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="personal" className="mt-0 space-y-5">
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
            <CardContent className="p-5 md:p-6">
              <div className="mb-4"><h2 className="text-2xl font-bold">{ui("التقرير الشخصي")}</h2><p className="mt-1 text-sm text-muted-foreground">{ui("ابحث بالاسم أو الرقم الوظيفي لعرض كل ما يتعلق بالموظف في مكان واحد.")}</p></div>
              <div className="relative max-w-2xl"><Search className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-muted-foreground" /><Input value={profileSearch} onChange={(event) => { setProfileSearch(event.target.value); setSelectedProfileId(""); }} placeholder={ui("ابحث عن موظف بالاسم أو الرقم الوظيفي...")} className="min-h-12 pr-11 text-base" /></div>
              {profileSearching && <p className="mt-3 text-sm text-muted-foreground">{ui("جاري البحث...")}</p>}
              {profileSearch.trim().length >= 2 && !profileSearching && profileMatches.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{profileMatches.map((employee) => <button key={employee.id} type="button" onClick={() => setSelectedProfileId(employee.id)} className={`rounded-xl border p-3 text-right transition hover:border-primary hover:bg-primary/5 ${activeProfileId === employee.id ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "bg-background"}`}><div className="font-semibold">{employee.full_name}</div><div className="mt-1 text-xs text-muted-foreground">#{employee.employee_no} · {employee.position || ui("بدون مسمى")}</div><div className="mt-1 text-xs text-muted-foreground">{employee.departments?.name || ui("بدون قسم")}</div></button>)}</div>}
              {profileSearch.trim().length >= 2 && !profileSearching && !profileMatches.length && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{ui("لم يتم العثور على موظف مطابق للبحث.")}</p>}
            </CardContent>
          </Card>
          {activeProfileId ? <EmployeeProfileContent employeeId={activeProfileId} embedded /> : <Card><CardContent className="p-10 text-center text-muted-foreground">{ui("اختر موظفاً من نتائج البحث لعرض التقرير الشخصي الكامل.")}</CardContent></Card>}
        </TabsContent>
        <TabsContent value="documents" className="mt-0"><EmployeeDocumentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}


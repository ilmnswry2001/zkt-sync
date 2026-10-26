import { formatErrorMessage } from "@/lib/error-message";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Pencil, Search, Upload, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeProfileContent } from "@/components/EmployeeProfileContent";
import { useServerFn } from "@tanstack/react-start";
import { importEmployees } from "@/lib/employees.functions";
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
  head: () => ({ meta: [{ title: "الموظفون" }] }),
  component: EmployeesPage,
});

type Emp = { id: string; employee_no: string; attendance_device_id?: string | null; id_no?: string | null; employee_import_data?: Record<string, string | number | boolean | null> | null; full_name: string; email?: string | null; department_id: string | null; position: string | null; status: string; departments?: { name: string } | null };
function EmployeesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [search, setSearch] = useState("");
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
    .map(([field, count]) => `${EMPLOYEE_IMPORT_FIELDS.find((item) => item.key === field)?.label ?? field}: ${count?.toLocaleString("ar-IQ")}`)
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
      toast.error(formatErrorMessage(error, "تعذرت قراءة ملف Excel"));
    }
  }

  async function confirmExcelImport() {
    if (!importPreview) return;
    const { rows: parsed, skipped } = importPlan;
    const targets = Object.values(importPreview.mapping).filter(Boolean);
    const duplicateTargets = new Set(targets.filter((target, index) => targets.indexOf(target) !== index));
    if (duplicateTargets.size) return toast.error("لا يمكن ربط أكثر من عمود مصدر بالحقل النظامي نفسه");
    if (!Object.values(importPreview.mapping).includes("employee_no") || !Object.values(importPreview.mapping).includes("full_name")) {
      return toast.error("اربط عمود الرقم الوظيفي وعمود اسم الموظف قبل المتابعة");
    }
    if (!parsed.length) return toast.error("لا توجد صفوف صالحة؛ تحقق من مطابقة الرقم الوظيفي واسم الموظف");

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
      toast.success(`تم استيراد ${done} موظف`);
    } catch (e: unknown) {
      setImportMsg(null);
      toast.error(formatErrorMessage(e, "فشل الاستيراد"));
    } finally {
      setImporting(false);
    }
  }


  const [limit, setLimit] = useState(50);
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["employees", search, limit],
    queryFn: async () => {
      let q = supabase.from("employees").select("*, departments(name)");
      const term = search.trim();
      if (term) q = q.or(`employee_no.ilike.%${term}%,full_name.ilike.%${term}%`);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("employee_no")
        .limit(limit);
      if (error) throw error;
      return data as Emp[];
    },
  });
  const { data: profileMatches = [], isFetching: profileSearching } = useQuery({
    queryKey: ["employee-profile-search", profileSearch],
    enabled: profileSearch.trim().length >= 2,
    queryFn: async () => {
      const term = profileSearch.trim();
      const { data, error } = await supabase
        .from("employees")
        .select("id, employee_no, full_name, position, status, departments(name)")
        .or(`employee_no.ilike.%${term}%,full_name.ilike.%${term}%`)
        .order("full_name")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Emp[];
    },
  });
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
  const { data: wages = [] } = useQuery({
    queryKey: ["wage_rates"],
    queryFn: async () => (await supabase.from("wage_rates").select("id, title").order("title")).data ?? [],
  });
  const ed = editing as any;


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
      employee_no: String(raw.employee_no ?? "").trim(),
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

  const save = useMutation({
    mutationFn: async (d: any) => {
      const payload = sanitizeEmployeePayload(d);
      if (editing) { const { error } = await supabase.from("employees").update(payload).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("employees").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["employees_count"] }); setOpen(false); setEditing(null); toast.success("تم الحفظ"); },
    onError: (e: any) => toast.error(formatErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("employees").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["employees_count"] }); toast.success("تم الحذف"); },
    onError: (e: any) => toast.error(formatErrorMessage(e)),
  });
  const updateStatus = useMutation({
    mutationFn: async ({ employeeId, status }: { employeeId: string; status: "active" | "inactive" | "terminated" }) => {
      const { error } = await supabase.from("employees").update({ status }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("تم تحديث حالة الموظف");
    },
    onError: (error: unknown) => toast.error(formatErrorMessage(error)),
  });

  const filtered = rows;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent sm:w-fit">
          <TabsTrigger value="directory" className="min-h-11 rounded-xl border">دليل الموظفين</TabsTrigger>
          <TabsTrigger value="personal" className="min-h-11 rounded-xl border">التقرير الشخصي</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="mt-0 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">الموظفون</h1>
          <p className="text-muted-foreground mt-1">إجمالي: {totalCount} موظف</p>
        </div>
        <div className="flex items-center gap-2">
          <input id="emp-excel" type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) handleExcel(f); }} />
          <Button variant="outline" disabled={importing} onClick={() => document.getElementById("emp-excel")?.click()}>
            {importing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
            استيراد من Excel
          </Button>
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogContent dir="rtl" className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden">
              <DialogHeader>
                <DialogTitle>مطابقة حقول ملف الموظفين</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {importPreview?.fileName} · {importPreview?.sheetName} · {importPreview?.rows.length.toLocaleString("ar-IQ")} صفوف
                </p>
              </DialogHeader>
              {importPreview && (
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                    اربط الأعمدة التي تطابق حقول النظام. تُحفظ جميع أعمدة الملف وقيمها الأصلية في ملف الموظف حتى إن لم يكن لها حقل نظامي مباشر، والخلايا الفارغة لا تمسح بيانات موجودة.
                    <div className="mt-1 text-muted-foreground">
                      تمت مطابقة {Object.values(importPreview.mapping).filter(Boolean).length} عموداً مع الحقول النظامية، وستُحفظ بقية الأعمدة ضمن بيانات الملف ·
                      {" "}صفوف صالحة {importPlan.rows.length.toLocaleString("ar-IQ")} · متجاهلة {importPlan.skipped.toLocaleString("ar-IQ")}
                    </div>
                    {invalidDateCount > 0 && <p role="alert" className="mt-2 text-amber-700">تعذر تحويل {invalidDateCount.toLocaleString("ar-IQ")} قيمة إلى تاريخ ({invalidDateDetails})؛ لن تُستورد كتاريخ. الخلايا الفارغة أو غير الصالحة لا تمسح التاريخ الموجود.</p>}
                    {departmentsToCreate.length > 0 && <p className="mt-2 text-amber-700">توجد {departmentsToCreate.length.toLocaleString("ar-IQ")} أسماء أقسام غير مطابقة للأقسام الحالية؛ سيُنشئها النظام تلقائياً عند الاستيراد.</p>}
                  </div>
                  <div className="space-y-2">
                    {importPreview.headers.map((header, index) => (
                      <div key={index} className="grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={header}>{header || "عمود بلا عنوان"}</p>
                          <p className="text-xs text-muted-foreground">عمود الملف</p>
                        </div>
                        <Select
                          value={importPreview.mapping[header] || "__ignore__"}
                          onValueChange={(value) => setImportPreview((current) => current ? {
                            ...current,
                            mapping: { ...current.mapping, [header]: value === "__ignore__" ? "" : value as EmployeeImportMapping[string] },
                          } : current)}
                        >
                          <SelectTrigger><SelectValue placeholder="تجاهل هذا العمود" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__ignore__">تجاهل هذا العمود</SelectItem>
                            {EMPLOYEE_IMPORT_FIELDS.map((field) => {
                              const usedElsewhere = Object.entries(importPreview.mapping)
                                .some(([source, target]) => source !== header && target === field.key);
                              return <SelectItem key={field.key} value={field.key} disabled={usedElsewhere}>{field.label}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="mb-2 text-sm font-semibold">معاينة السجلات بعد المطابقة</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>الرقم الوظيفي</TableHead><TableHead>اسم الموظف</TableHead><TableHead>القسم</TableHead><TableHead>رقم جهاز البصمة</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {importPlan.rows.slice(0, 5).map((row) => (
                            <TableRow key={row.employee_no}>
                              <TableCell>{row.employee_no}</TableCell><TableCell>{row.full_name}</TableCell>
                              <TableCell>{row.department || "—"}</TableCell><TableCell>{row.attendance_device_id || "—"}</TableCell>
                            </TableRow>
                          ))}
                          {!importPlan.rows.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">اربط الرقم الوظيفي واسم الموظف لعرض المعاينة.</TableCell></TableRow>}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
                <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importing}>إلغاء</Button>
                <Button type="button" onClick={confirmExcelImport} disabled={importing || !importPlan.rows.length}>
                  {importing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Upload className="ml-2 h-4 w-4" />}
                  استيراد {importPlan.rows.length.toLocaleString("ar-IQ")} سجل
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-2" /> موظف جديد</Button></DialogTrigger>
          <DialogContent dir="rtl" className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-2xl border-0 p-0 shadow-2xl">
            <DialogHeader className="shrink-0 border-b bg-gradient-to-l from-teal-950 via-teal-800 to-cyan-700 px-6 py-5 text-white">
              <DialogTitle className="text-xl text-white">{editing ? "تحديث بيانات الموظف" : "إضافة موظف جديد"}</DialogTitle>
              <p className="text-sm text-teal-50/80">ابدأ بالبيانات الأساسية والتكليف؛ بقية التفاصيل اختيارية ويمكن إضافتها لاحقاً.</p>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
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
                pay_type: (f.get("pay_type") as string) || "monthly",
                erp_no: g("erp_no"), id_no: g("id_no"), ctr_code: g("ctr_code"),
                nationality: g("nationality"), gender: g("gender"), marital_status: g("marital_status"),
                blood_type: g("blood_type"), education: g("education"),
                birth_date: g("birth_date"), hire_date: g("hire_date"), last_working_day: g("last_working_day"),
                contract_type: g("contract_type"), contract_end_date: g("contract_end_date"),
                email: g("email"), phone1: g("phone1"), phone2: g("phone2"), address: g("address"),
                salary_type: g("salary_type"), salary_structure: g("salary_structure"), project: g("project"),
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
              <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div><h3 className="font-semibold">البيانات الأساسية</h3><p className="text-xs text-muted-foreground">الحقول ذات النجمة مطلوبة لإتمام الحفظ.</p></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>الرقم الوظيفي *</Label><Input name="employee_no" required autoFocus placeholder="مثال: 10428" defaultValue={ed?.employee_no ?? ""} /></div>
                  <div><Label>رقم جهاز البصمة</Label><Input name="attendance_device_id" defaultValue={ed?.attendance_device_id ?? ""} /></div>
                  <div className="md:col-span-2"><Label>الاسم الكامل *</Label><Input name="full_name" required placeholder="الاسم كما في المستندات الرسمية" defaultValue={ed?.full_name ?? ""} /></div>
                  <div><Label>المسمى الوظيفي</Label><Input name="position" defaultValue={ed?.position ?? ""} /></div>
                  <div>
                    <Label>القسم</Label>
                    <Select name="department_id" defaultValue={ed?.department_id ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— بدون —</SelectItem>
                        {depts.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>الحالة</Label>
                    <Select name="status" defaultValue={ed?.status ?? "active"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">نشط</SelectItem>
                        <SelectItem value="inactive">معطل</SelectItem>
                        <SelectItem value="terminated">منتهي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>NO EM ERP</Label><Input name="erp_no" defaultValue={ed?.erp_no ?? ""} /></div>
                  <div><Label>رقم الهوية</Label><Input name="id_no" defaultValue={ed?.id_no ?? ""} /></div>
                  <div><Label>المشروع</Label><Input name="project" defaultValue={ed?.project ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-teal-900/10 bg-teal-50/40 p-4 shadow-sm dark:bg-teal-950/10">
                <div><h3 className="font-semibold">التكليف والأجر</h3><p className="text-xs text-muted-foreground">حدد القسم وموقع العمل ونوع الأجر لتسهيل توزيع الموظف واحتساب التكلفة.</p></div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label>موقع العمل</Label>
                    <Select name="site_id" defaultValue={ed?.site_id ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— بدون —</SelectItem>
                        {sites.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.ctr_code})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>كود التكلفة CTR</Label><Input name="ctr_code" defaultValue={ed?.ctr_code ?? ""} /></div>
                  <div>
                    <Label>أجر التخصص</Label>
                    <Select name="wage_rate_id" defaultValue={ed?.wage_rate_id ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— بدون —</SelectItem>
                        {wages.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>تصنيف الأجر *</Label>
                    <Select name="pay_type" defaultValue={ed?.pay_type ?? "monthly"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">شهري</SelectItem>
                        <SelectItem value="daily">يومي (تُحتسب أيام الجمعة بأجر)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>الراتب الأساسي</Label><Input name="base_salary" type="number" step="0.01" defaultValue={ed?.base_salary ?? ""} /></div>
                  <div><Label>نوع الراتب</Label><Input name="salary_type" defaultValue={ed?.salary_type ?? ""} /></div>
                  <div><Label>هيكل الراتب</Label><Input name="salary_structure" defaultValue={ed?.salary_structure ?? ""} /></div>
                </div>
              </section>

              <details className="group rounded-xl border bg-card p-4 shadow-sm">
                <summary className="cursor-pointer list-none font-semibold marker:hidden"><span className="flex items-center justify-between">البيانات الإضافية <span className="text-xs font-normal text-muted-foreground group-open:hidden">الجنسية، التواصل، العقد والحساب البنكي</span><span className="hidden text-xs font-normal text-muted-foreground group-open:inline">إخفاء التفاصيل</span></span></summary>
                <div className="mt-4 space-y-5 border-t pt-4">
              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">البيانات الشخصية</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>الجنسية</Label><Input name="nationality" defaultValue={ed?.nationality ?? ""} /></div>
                  <div>
                    <Label>الجنس</Label>
                    <Select name="gender" defaultValue={ed?.gender ?? "none"}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— غير محدد —</SelectItem>
                        <SelectItem value="male">ذكر</SelectItem>
                        <SelectItem value="female">أنثى</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>الحالة الاجتماعية</Label><Input name="marital_status" defaultValue={ed?.marital_status ?? ""} /></div>
                  <div><Label>فصيلة الدم</Label><Input name="blood_type" defaultValue={ed?.blood_type ?? ""} /></div>
                  <div><Label>التعليم</Label><Input name="education" defaultValue={ed?.education ?? ""} /></div>
                  <div><Label>تاريخ الميلاد</Label><Input name="birth_date" type="date" defaultValue={ed?.birth_date ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">التواصل</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>البريد الإلكتروني</Label><Input name="email" type="email" defaultValue={ed?.email ?? ""} /></div>
                  <div><Label>هاتف 1</Label><Input name="phone1" defaultValue={ed?.phone1 ?? ""} /></div>
                  <div><Label>هاتف 2</Label><Input name="phone2" defaultValue={ed?.phone2 ?? ""} /></div>
                  <div className="md:col-span-3"><Label>عنوان السكن</Label><Input name="address" defaultValue={ed?.address ?? ""} /></div>
                  <div><Label>جهة اتصال الطوارئ</Label><Input name="emergency_contact_name" defaultValue={ed?.emergency_contact_name ?? ""} /></div>
                  <div><Label>هاتف الطوارئ</Label><Input name="emergency_contact_phone" defaultValue={ed?.emergency_contact_phone ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">العقد والوثائق</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>تاريخ المباشرة</Label><Input name="hire_date" type="date" defaultValue={ed?.hire_date ?? ""} /></div>
                  <div><Label>آخر يوم عمل</Label><Input name="last_working_day" type="date" defaultValue={ed?.last_working_day ?? ""} /></div>
                  <div><Label>نوع العقد</Label><Input name="contract_type" defaultValue={ed?.contract_type ?? ""} /></div>
                  <div><Label>انتهاء العقد</Label><Input name="contract_end_date" type="date" defaultValue={ed?.contract_end_date ?? ""} /></div>
                  <div><Label>رقم الجواز</Label><Input name="passport_no" defaultValue={ed?.passport_no ?? ""} /></div>
                  <div><Label>انتهاء الجواز</Label><Input name="passport_expiry" type="date" defaultValue={ed?.passport_expiry ?? ""} /></div>
                  <div><Label>رقم الإقامة</Label><Input name="residency_no" defaultValue={ed?.residency_no ?? ""} /></div>
                  <div><Label>انتهاء الإقامة</Label><Input name="residency_expiry" type="date" defaultValue={ed?.residency_expiry ?? ""} /></div>
                  <div><Label>رقم جواز السلامة</Label><Input name="safety_passport_no" defaultValue={ed?.safety_passport_no ?? ""} /></div>
                  <div><Label>انتهاء جواز السلامة</Label><Input name="safety_passport_expiry" type="date" defaultValue={ed?.safety_passport_expiry ?? ""} /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold text-sm text-muted-foreground">حقول الملف الشامل الإضافية</h3>
                <p className="text-xs text-muted-foreground">تُحفظ هذه الحقول كما وردت في قاعدة البيانات الشاملة، وتظهر في ملف الموظف.</p>
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
                <h3 className="font-semibold text-sm text-muted-foreground">المعلومات البنكية والملاحظات</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><Label>اسم البنك</Label><Input name="bank_name" defaultValue={ed?.bank_name ?? ""} /></div>
                  <div><Label>رقم الحساب</Label><Input name="bank_account" defaultValue={ed?.bank_account ?? ""} /></div>
                  <div><Label>IBAN</Label><Input name="iban" defaultValue={ed?.iban ?? ""} /></div>
                  <div className="md:col-span-3"><Label>ملاحظات</Label><Textarea name="notes" defaultValue={ed?.notes ?? ""} /></div>
                </div>
              </section>
                </div>
              </details>
              <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t bg-background/95 p-4 backdrop-blur sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>إلغاء</Button>
                <Button type="submit" className="min-w-36 bg-gradient-to-l from-teal-800 to-emerald-600 shadow-md" disabled={save.isPending}>{save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}{save.isPending ? "جارٍ الحفظ..." : editing ? "حفظ التعديلات" : "حفظ بيانات الموظف"}</Button>
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
          <CardTitle>القائمة</CardTitle>
          <div className="relative w-72">
            <Search className="absolute right-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input placeholder="بحث بالرقم أو الاسم..." className="pr-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>الرقم الوظيفي</TableHead><TableHead>اسم الموظف</TableHead><TableHead>القسم</TableHead><TableHead>رقم الهوية</TableHead><TableHead>التخصص / المسمى</TableHead><TableHead>رقم جهاز البصمة</TableHead><TableHead>تصنيف الأجر</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody showAllRows>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.employee_no}</TableCell>
                  <TableCell className="font-medium"><button type="button" onClick={() => openPersonalReport(e)} className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline" aria-label={`فتح التقرير الشخصي لـ ${e.full_name}`}>{e.full_name}</button></TableCell>
                  <TableCell>{e.departments?.name ?? "-"}</TableCell>
                  <TableCell className="font-mono">{e.id_no || "-"}</TableCell>
                  <TableCell>{e.position ?? "-"}</TableCell>
                  <TableCell className="font-mono">{e.attendance_device_id || "-"}</TableCell>
                  <TableCell>{(e as any).pay_type === "daily" ? "يومي" : "شهري"}</TableCell>
                  <TableCell>
                    <Select value={e.status} onValueChange={(status: "active" | "inactive" | "terminated") => updateStatus.mutate({ employeeId: e.id, status })}>
                      <SelectTrigger className="h-9 min-w-28" aria-label={`حالة ${e.full_name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">نشط</SelectItem>
                        <SelectItem value="inactive">معطل</SelectItem>
                        <SelectItem value="terminated">منتهي</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" title="فتح التقرير الشخصي" aria-label="فتح التقرير الشخصي" onClick={() => openPersonalReport(e)}><UserRound className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" title="تعديل الموظف" aria-label="تعديل الموظف" onClick={() => { setEditing(e); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف؟")) del.mutate(e.id); }}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">لا توجد بيانات</TableCell></TableRow>}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-center gap-3">
            <p className="text-xs text-muted-foreground">يتم عرض {filtered.length} من {totalCount}</p>
            {filtered.length >= limit && (
              <Button variant="outline" size="sm" disabled={isFetching} onClick={() => setLimit(limit + 50)}>
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "عرض المزيد"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="personal" className="mt-0 space-y-5">
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
            <CardContent className="p-5 md:p-6">
              <div className="mb-4"><h2 className="text-2xl font-bold">التقرير الشخصي</h2><p className="mt-1 text-sm text-muted-foreground">ابحث بالاسم أو الرقم الوظيفي لعرض كل ما يتعلق بالموظف في مكان واحد.</p></div>
              <div className="relative max-w-2xl"><Search className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-muted-foreground" /><Input value={profileSearch} onChange={(event) => { setProfileSearch(event.target.value); setSelectedProfileId(""); }} placeholder="ابحث عن موظف بالاسم أو الرقم الوظيفي..." className="min-h-12 pr-11 text-base" /></div>
              {profileSearching && <p className="mt-3 text-sm text-muted-foreground">جاري البحث...</p>}
              {profileSearch.trim().length >= 2 && !profileSearching && profileMatches.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{profileMatches.map((employee) => <button key={employee.id} type="button" onClick={() => setSelectedProfileId(employee.id)} className={`rounded-xl border p-3 text-right transition hover:border-primary hover:bg-primary/5 ${activeProfileId === employee.id ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "bg-background"}`}><div className="font-semibold">{employee.full_name}</div><div className="mt-1 text-xs text-muted-foreground">#{employee.employee_no} · {employee.position || "بدون مسمى"}</div><div className="mt-1 text-xs text-muted-foreground">{employee.departments?.name || "بدون قسم"}</div></button>)}</div>}
              {profileSearch.trim().length >= 2 && !profileSearching && !profileMatches.length && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">لم يتم العثور على موظف مطابق للبحث.</p>}
            </CardContent>
          </Card>
          {activeProfileId ? <EmployeeProfileContent employeeId={activeProfileId} embedded /> : <Card><CardContent className="p-10 text-center text-muted-foreground">اختر موظفاً من نتائج البحث لعرض التقرير الشخصي الكامل.</CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}


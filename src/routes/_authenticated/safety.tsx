import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Activity, AlertTriangle, Bus, CheckCircle2, ClipboardCheck, FileWarning, HardHat, Plus, ShieldCheck, Ticket, Trash2, Users, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/safety")({
  head: () => ({ meta: [{ title: "السلامة المهنية والبلاغات" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: SafetyCenter,
});

type Site = { id: string; name: string; ctr_code?: string };
type Employee = { id: string; full_name: string; employee_no: string; department_id?: string | null; email?: string | null; phone1?: string | null; driving_license?: string | null; safety_passport_no?: string | null; safety_passport_expiry?: string | null; safety_passport_status?: string | null; status?: string };
type Department = { id: string; name: string };
type Member = { id: string; employee_id: string; role: string; team_leader_id: string | null; site_id: string | null; area: string; active: boolean; employees?: Employee; sites?: { name: string } | null };
type ChecklistItem = { key: string; label: string; id?: string };

const HSE_ITEMS: ChecklistItem[] = [
  { key: "tbt", label: "تم تنفيذ Toolbox Talk (TBT) للطاقم" },
  { key: "ppe", label: "الالتزام بمعدات الوقاية الشخصية (PPE)" },
  { key: "ptw", label: "التصاريح (PTW) معلقة وسارية في موقع العمل" },
  { key: "gas", label: "فحص الغاز (H2S / LEL) وأجهزة الكشف تعمل" },
  { key: "housekeeping", label: "النظافة والترتيب (Housekeeping)" },
  { key: "lifting", label: "عمليات الرفع آمنة ومخططة" },
  { key: "journey", label: "سلامة القيادة والمركبات (Journey Management)" },
  { key: "fire", label: "معدات الإطفاء ونقاط التجمع جاهزة" },
  { key: "environment", label: "لا توجد تسربات أو انسكابات بيئية" },
  { key: "incident", label: "لم تسجل حوادث أو Near Miss" },
  { key: "driver", label: "وثائق السائقين الجدد مكتملة" },
];
const PA_ITEMS: ChecklistItem[] = [
  { key: "ptw_valid", label: "تصاريح العمل سارية وموقعة" },
  { key: "jsa", label: "JSA وتقييم المخاطر مرفقان ومشروحان للطاقم" },
  { key: "loto", label: "العزل (LOTO / Isolation Certificate) مطبق" },
  { key: "gas_test", label: "فحص الغاز قبل البدء ومسجل على التصريح" },
  { key: "hot_work", label: "الأماكن المحصورة والأعمال الساخنة تحت إشراف" },
  { key: "handover", label: "تسليم واستلام التصاريح بين الشفتات" },
  { key: "closeout", label: "إغلاق التصاريح المنتهية وإعادة الموقع آمناً" },
  { key: "equipment", label: "فحص المعدات وصلاحية الشهادات" },
  { key: "emergency", label: "الفريق يعرف إجراءات الطوارئ ونقاط التجمع" },
  { key: "site_safe", label: "ترك موقع العمل آمناً ومرتباً عند التعليق أو الإكمال" },
];
const ROLE_LABEL: Record<string, string> = { manager: "مدير السلامة", team_leader: "قائد فريق", officer: "مشرف سلامة", permit_authorizer: "مخول تصاريح (PA)" };
const ROLE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { manager: "default", team_leader: "secondary", officer: "outline", permit_authorizer: "outline" };
const STATUS_LABEL: Record<string, string> = { submitted: "بانتظار المراجعة", approved: "معتمد", needs_changes: "بحاجة إلى متابعة", open: "مفتوحة", in_progress: "قيد المعالجة", closed: "مغلقة" };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baghdad" });
const monthStart = () => `${today().slice(0, 7)}-01`;
const errText = (error: unknown) => error instanceof Error ? error.message : "حدث خطأ غير متوقع";
const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function SafetyCenter() {
  const auth = useAuth();
  const qc = useQueryClient();
  const isPrivileged = auth.isAdmin || auth.isHR;
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [reportKind, setReportKind] = useState<"hse" | "permit_authorizer">("hse");
  const [reportDepartmentId, setReportDepartmentId] = useState("");
  const [newTemplateLabel, setNewTemplateLabel] = useState("");
  const [reportDate, setReportDate] = useState(today());
  const [shift, setShift] = useState("day");
  const [siteId, setSiteId] = useState("");
  const [workforce, setWorkforce] = useState("0");
  const [permitCount, setPermitCount] = useState("0");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, { result: string; issue: string; action: string }>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [ticketDraft, setTicketDraft] = useState({ subject: "", details: "", target_department_id: "", priority: "normal", due_date: "" });
  const [ticketReply, setTicketReply] = useState("");
  const [violationDraft, setViolationDraft] = useState({ title: "", details: "", department_id: "", anonymous: true });
  const [memberDraft, setMemberDraft] = useState({ employee_id: "", role: "officer", team_leader_id: "", site_id: "", area: "all" });
  const [scoreDraft, setScoreDraft] = useState({ employee_id: "", points: "1", reason: "" });
  const [vehicleSearch, setVehicleSearch] = useState("");

  const sitesQ = useQuery({ queryKey: ["safety-sites"], queryFn: async () => { const { data, error } = await (supabase as any).from("sites").select("id,name,ctr_code").eq("status", "active").order("name"); if (error) throw error; return (data ?? []) as Site[]; } });
  const deptsQ = useQuery({ queryKey: ["safety-departments"], queryFn: async () => { const { data, error } = await (supabase as any).from("departments").select("id,name").order("name"); if (error) throw error; return (data ?? []) as Department[]; } });
  const managedDepartmentsQ = useQuery({ queryKey: ["safety-managed-departments", auth.user?.id], enabled: !!auth.user?.id && auth.isDepartmentManager && !isPrivileged, queryFn: async () => {
    const [assigned, managed] = await Promise.all([
      (supabase as any).from("user_departments").select("department_id").eq("user_id", auth.user!.id),
      (supabase as any).from("department_managers").select("department_id").eq("user_id", auth.user!.id),
    ]);
    if (assigned.error) throw assigned.error; if (managed.error) throw managed.error;
    return [...new Set([...(assigned.data ?? []), ...(managed.data ?? [])].map((row: any) => row.department_id))] as string[];
  } });
  const employeesQ = useQuery({ queryKey: ["safety-employees"], queryFn: async () => { const { data, error } = await (supabase as any).from("employees").select("id,full_name,employee_no,department_id,email,phone1,driving_license,safety_passport_no,safety_passport_expiry,safety_passport_status,status").eq("status", "active").order("full_name"); if (error) throw error; return (data ?? []) as Employee[]; } });
  const membersQ = useQuery({ queryKey: ["hse-memberships"], queryFn: async () => { const { data, error } = await (supabase as any).from("hse_memberships").select("*,employees(id,full_name,employee_no,email),sites(name)").order("created_at", { ascending: false }); if (error) throw error; return (data ?? []) as Member[]; } });
  const members = membersQ.data ?? [];
  const myEmployee = useMemo(() => (employeesQ.data ?? []).find((e) => e.email?.toLowerCase() === auth.user?.email?.toLowerCase()) ?? null, [employeesQ.data, auth.user?.email]);
  const myMembership = members.find((m) => m.employee_id === myEmployee?.id && m.active);
  const isHseStaff = isPrivileged || !!myMembership;
  const canManageChecklist = isPrivileged || auth.isDepartmentManager;
  const isHseManager = isPrivileged || members.some((m) => m.employee_id === myEmployee?.id && m.active && m.role === "manager");
  const canSubmitHse = isPrivileged || myMembership?.role === "manager" || myMembership?.role === "officer" || myMembership?.role === "team_leader";
  const canSubmitPa = isPrivileged || myMembership?.role === "manager" || myMembership?.role === "permit_authorizer";
  useEffect(() => {
    if (myMembership?.role === "permit_authorizer" && !isPrivileged) setReportKind("permit_authorizer");
  }, [myMembership?.role, isPrivileged]);

  const reportsQ = useQuery({ queryKey: ["hse-reports"], enabled: isHseStaff, queryFn: async () => { const { data, error } = await (supabase as any).from("hse_reports").select("*,employees(full_name,employee_no),departments(name),sites(name),hse_report_items(*),hse_report_attachments(*)").order("work_date", { ascending: false }).limit(300); if (error) throw error; return data ?? []; } });
  const reports = reportsQ.data ?? [];
  const risksQ = useQuery({ queryKey: ["hse-risks"], enabled: isHseManager, queryFn: async () => { const { data, error } = await (supabase as any).from("hse_risks").select("*,report_item:hse_report_items(item_key,item_label,issue_description,corrective_action,report:hse_reports(id,work_date,shift,sites(name),employees(full_name)))").order("due_date", { ascending: true, nullsFirst: false }); if (error) throw error; return data ?? []; } });
  const risks = risksQ.data ?? [];
  const ticketsQ = useQuery({ queryKey: ["department-tickets"], queryFn: async () => { const { data, error } = await (supabase as any).from("department_tickets").select("*, target_department:departments!department_tickets_target_department_id_fkey(name), source_department:departments!department_tickets_source_department_id_fkey(name)").order("created_at", { ascending: false }).limit(200); if (error) throw error; return data ?? []; } });
  const tickets = ticketsQ.data ?? [];
  const violationsQ = useQuery({ queryKey: ["violation-reports"], queryFn: async () => { const { data, error } = await (supabase as any).from("violation_reports").select("*,departments(name)").order("created_at", { ascending: false }).limit(200); if (error) throw error; return data ?? []; } });
  const violations = violationsQ.data ?? [];
  const scoresQ = useQuery({ queryKey: ["hse-score-events", monthStart()], enabled: isHseManager, queryFn: async () => { const { data, error } = await (supabase as any).from("hse_score_events").select("*").eq("score_month", monthStart()); if (error) throw error; return data ?? []; } });
  const vehiclesQ = useQuery({ queryKey: ["safety-vehicles"], enabled: vehicleSearch.trim().length >= 2, queryFn: async () => { const term = `%${vehicleSearch.trim().replace(/[,%_]/g, "\\$&")}%`; const { data, error } = await (supabase as any).from("vehicles").select("id,vehicle_no,name,vehicle_class,is_active,security_permit_expiry,current_driver_id,employees:employees!vehicles_current_driver_id_fkey(full_name,phone1,driving_license,safety_passport_no,safety_passport_expiry,safety_passport_status)").or(`vehicle_no.ilike.${term},name.ilike.${term}`).limit(25); if (error) throw error; return data ?? []; } });
  const employeeOptions = employeesQ.data ?? [];
  const siteOptions = sitesQ.data ?? [];
  const departmentOptions = deptsQ.data ?? [];
  const manageableDepartments = isPrivileged ? departmentOptions : departmentOptions.filter((d) => (managedDepartmentsQ.data ?? []).includes(d.id));
  const firstManageableDepartmentId = manageableDepartments[0]?.id ?? departmentOptions[0]?.id ?? "";
  const templatesQ = useQuery({ queryKey: ["hse-report-templates", reportDepartmentId, reportKind], enabled: !!reportDepartmentId && (isHseStaff || canManageChecklist), queryFn: async () => {
    const { data, error } = await (supabase as any).from("hse_report_template_items").select("id,item_key,item_label,sort_order,active,created_at").eq("department_id", reportDepartmentId).eq("report_kind", reportKind).order("sort_order").order("created_at");
    if (error) throw error; return data ?? [];
  } });
  const items: ChecklistItem[] = templatesQ.data?.length
    ? templatesQ.data.filter((item: any) => item.active).map((item: any) => ({ key: item.item_key, label: item.item_label, id: item.id }))
    : reportKind === "hse" ? HSE_ITEMS : PA_ITEMS;
  useEffect(() => {
    if (!reportDepartmentId && !employeesQ.isLoading) setReportDepartmentId(myEmployee?.department_id ?? firstManageableDepartmentId);
  }, [reportDepartmentId, employeesQ.isLoading, myEmployee?.department_id, firstManageableDepartmentId]);
  const invalid = items.filter((item) => !answers[item.key]?.result || (answers[item.key]?.result === "issue" && answers[item.key].issue.trim().length < 3));

  const refresh = async (...keys: string[][]) => { await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))); };
  const addTemplateItem = async () => {
    const label = newTemplateLabel.trim();
    if (!canManageChecklist || !reportDepartmentId || label.length < 2) { toast.error("اختر القسم واكتب بنداً من حرفين على الأقل"); return; }
    const existing = templatesQ.data ?? [];
    const defaults = reportKind === "hse" ? HSE_ITEMS : PA_ITEMS;
    const nextOrder = existing.reduce((max: number, item: any) => Math.max(max, item.sort_order ?? 0), 0) + 10;
    const additions = existing.length
      ? [{ department_id: reportDepartmentId, report_kind: reportKind, item_key: `custom-${crypto.randomUUID()}`, item_label: label, sort_order: nextOrder, created_by: auth.user?.id }]
      : [...defaults.map((item, index) => ({ department_id: reportDepartmentId, report_kind: reportKind, item_key: item.key, item_label: item.label, sort_order: (index + 1) * 10, created_by: auth.user?.id })), { department_id: reportDepartmentId, report_kind: reportKind, item_key: `custom-${crypto.randomUUID()}`, item_label: label, sort_order: (defaults.length + 1) * 10, created_by: auth.user?.id }];
    const { error } = await (supabase as any).from("hse_report_template_items").insert(additions);
    if (error) toast.error(errText(error)); else { toast.success("تمت إضافة البند إلى نموذج هذا القسم"); setNewTemplateLabel(""); await refresh(["hse-report-templates", reportDepartmentId, reportKind]); }
  };
  const toggleTemplateItem = async (item: any) => {
    const { error } = await (supabase as any).from("hse_report_template_items").update({ active: !item.active }).eq("id", item.id);
    if (error) toast.error(errText(error)); else { toast.success(item.active ? "تم حذف البند من النماذج الجديدة" : "تمت استعادة البند"); await refresh(["hse-report-templates", reportDepartmentId, reportKind]); }
  };
  const saveTemplateLabel = async (item: any, label: string) => {
    const nextLabel = label.trim();
    if (nextLabel.length < 2 || nextLabel === item.item_label) return;
    const { error } = await (supabase as any).from("hse_report_template_items").update({ item_label: nextLabel }).eq("id", item.id);
    if (error) toast.error(errText(error)); else { toast.success("تم تحديث البند"); await refresh(["hse-report-templates", reportDepartmentId, reportKind]); }
  };
  const submitReport = async () => {
    if (!myEmployee || !myMembership) { toast.error("يجب ربط حسابك بعضوية فعّالة في فريق السلامة أولاً"); return; }
    if (!(reportKind === "hse" ? canSubmitHse : canSubmitPa)) { toast.error("صلاحية حسابك لا تسمح بإرسال هذا النوع من التقارير"); return; }
    if (!reportDepartmentId || !siteId || !items.length || invalid.length) { toast.error(!reportDepartmentId ? "اختر القسم" : !siteId ? "اختر الموقع الميداني" : !items.length ? "لا توجد بنود في هذا النموذج؛ أبلغ مدير القسم لإضافة البنود" : "أكمل جميع بنود الفحص ووصف كل مشكلة"); return; }
    if (photos.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)) { toast.error("الصور يجب أن تكون JPG أو PNG أو WebP وبحجم 8 ميغابايت كحد أقصى"); return; }
    try {
      const { data: report, error } = await (supabase as any).from("hse_reports").insert({ employee_id: myEmployee.id, department_id: reportDepartmentId, site_id: siteId, work_date: reportDate, shift, workforce_count: Number(workforce) || 0, permit_count: Number(permitCount) || 0, report_kind: reportKind, notes: notes.trim() || null, created_by: auth.user?.id }).select("id").single();
      if (error) throw error;
      const { data: insertedItems, error: itemError } = await (supabase as any).from("hse_report_items").insert(items.map((item) => ({ report_id: report.id, item_key: item.key, item_label: item.label, result: answers[item.key].result, issue_description: answers[item.key].result === "issue" ? answers[item.key].issue.trim() : null, corrective_action: answers[item.key].result === "issue" ? answers[item.key].action.trim() || null : null }))).select("id,item_key,result");
      if (itemError) throw itemError;
      const issueRows = (insertedItems ?? []).filter((row: any) => row.result === "issue");
      if (issueRows.length) { const { error: riskError } = await (supabase as any).from("hse_risks").insert(issueRows.map((row: any) => ({ report_item_id: row.id }))); if (riskError) throw riskError; }
      for (const file of photos) {
        const path = `${auth.user!.id}/${report.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error: uploadError } = await supabase.storage.from("hse-report-photos").upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: attachmentError } = await (supabase as any).from("hse_report_attachments").insert({ report_id: report.id, storage_path: path, file_name: file.name, created_by: auth.user?.id });
        if (attachmentError) throw attachmentError;
      }
      toast.success("تم إرسال تقرير السلامة وتسجيل المشكلات للمتابعة");
      setAnswers({}); setNotes(""); setPhotos([]); setWorkforce("0"); setPermitCount("0");
      await refresh(["hse-reports"], ["hse-risks"], ["hse-score-events", monthStart()]);
    } catch (error) { toast.error(`تعذر إرسال التقرير: ${errText(error)}`); }
  };

  const reviewReport = async (report: any, status: string) => {
    const { error } = await (supabase as any).from("hse_reports").update({ status, reviewed_by: auth.user?.id, reviewed_at: new Date().toISOString() }).eq("id", report.id);
    if (error) toast.error(errText(error)); else { toast.success("تم تحديث حالة التقرير"); await refresh(["hse-reports"]); }
  };
  const saveRisk = async (riskId: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase as any).from("hse_risks").update({ ...patch, updated_by: auth.user?.id }).eq("id", riskId);
    if (error) toast.error(errText(error)); else { toast.success("تم تحديث متابعة المشكلة"); await refresh(["hse-risks"], ["hse-reports"]); }
  };
  const addMember = async () => {
    if (!memberDraft.employee_id) { toast.error("اختر الموظف"); return; }
    const { error } = await (supabase as any).from("hse_memberships").insert({ employee_id: memberDraft.employee_id, role: memberDraft.role, team_leader_id: memberDraft.team_leader_id || null, site_id: memberDraft.site_id || null, area: memberDraft.area, active: true });
    if (error) toast.error(errText(error)); else { toast.success("تمت إضافة عضو السلامة"); setMemberDraft({ employee_id: "", role: "officer", team_leader_id: "", site_id: "", area: "all" }); await refresh(["hse-memberships"]); }
  };
  const toggleMember = async (member: Member) => {
    const { error } = await (supabase as any).from("hse_memberships").update({ active: !member.active }).eq("id", member.id);
    if (error) toast.error(errText(error)); else { toast.success(member.active ? "تم تعطيل العضوية" : "تم تفعيل العضوية"); await refresh(["hse-memberships"]); }
  };
  const addScore = async () => {
    if (!scoreDraft.employee_id || !scoreDraft.reason.trim()) { toast.error("اختر الموظف واكتب سبب النقاط"); return; }
    const { error } = await (supabase as any).from("hse_score_events").insert({ employee_id: scoreDraft.employee_id, score_month: monthStart(), points: Number(scoreDraft.points), reason: scoreDraft.reason.trim(), created_by: auth.user?.id });
    if (error) toast.error(errText(error)); else { toast.success("تم تسجيل التقييم"); setScoreDraft({ employee_id: "", points: "1", reason: "" }); await refresh(["hse-score-events", monthStart()]); }
  };
  const createTicket = async () => {
    if (!ticketDraft.subject.trim() || !ticketDraft.details.trim() || !ticketDraft.target_department_id) { toast.error("أكمل عنوان التذكرة وتفاصيلها والقسم المستلم"); return; }
    const { data: departments } = await (supabase as any).from("user_departments").select("department_id").eq("user_id", auth.user?.id);
    const sourceId = departments?.[0]?.department_id ?? null;
    const { error } = await (supabase as any).from("department_tickets").insert({ subject: ticketDraft.subject.trim(), details: ticketDraft.details.trim(), source_department_id: sourceId, target_department_id: ticketDraft.target_department_id, priority: ticketDraft.priority, due_at: ticketDraft.due_date ? new Date(`${ticketDraft.due_date}T23:59:00+03:00`).toISOString() : null, created_by: auth.user?.id });
    if (error) toast.error(errText(error)); else { toast.success("تم إرسال التذكرة للقسم"); setTicketDraft({ subject: "", details: "", target_department_id: "", priority: "normal", due_date: "" }); await refresh(["department-tickets"]); }
  };
  const updateTicket = async (ticket: any, status: string) => {
    const { error } = await (supabase as any).from("department_tickets").update({ status, assigned_to: ticket.assigned_to ?? auth.user?.id }).eq("id", ticket.id);
    if (error) toast.error(errText(error)); else { toast.success("تم تحديث التذكرة"); await refresh(["department-tickets"]); }
  };
  const replyTicket = async () => {
    if (!selectedTicket || !ticketReply.trim()) return;
    const { error } = await (supabase as any).from("department_ticket_messages").insert({ ticket_id: selectedTicket.id, author_id: auth.user?.id, message: ticketReply.trim() });
    if (error) toast.error(errText(error)); else { setTicketReply(""); await refresh(["ticket-messages", selectedTicket.id]); }
  };
  const createViolation = async () => {
    if (!violationDraft.title.trim() || !violationDraft.details.trim() || !violationDraft.department_id) { toast.error("أكمل عنوان البلاغ والتفاصيل والقسم المعني"); return; }
    const { error } = await (supabase as any).from("violation_reports").insert({ ...violationDraft, created_by: auth.user?.id });
    if (error) toast.error(errText(error)); else { toast.success("تم إرسال البلاغ بسرية إلى القسم المختص"); setViolationDraft({ title: "", details: "", department_id: "", anonymous: true }); await refresh(["violation-reports"]); }
  };

  const reportCount = reports.length;
  const issueCount = reports.reduce((sum: number, row: any) => sum + (row.hse_report_items ?? []).filter((item: any) => item.result === "issue").length, 0);
  const openRisks = risks.filter((risk: any) => risk.status !== "closed");
  const scoreRows = useMemo(() => {
    const metrics = new Map<string, { sent: number; issues: number; score: number }>();
    for (const report of reports) { const row = metrics.get(report.employee_id) ?? { sent: 0, issues: 0, score: 0 }; row.sent++; row.issues += (report.hse_report_items ?? []).filter((item: any) => item.result === "issue").length; metrics.set(report.employee_id, row); }
    for (const event of scoresQ.data ?? []) { const row = metrics.get(event.employee_id) ?? { sent: 0, issues: 0, score: 0 }; row.score += Number(event.points); metrics.set(event.employee_id, row); }
    return [...metrics.entries()].map(([employeeId, metrics]) => ({ employee: employeeOptions.find((e) => e.id === employeeId), ...metrics })).filter((row) => row.employee).sort((a, b) => b.sent - a.sent || b.score - a.score);
  }, [reports, scoresQ.data, employeeOptions]);
  const messagesQ = useQuery({ queryKey: ["ticket-messages", selectedTicket?.id], enabled: !!selectedTicket, queryFn: async () => { const { data, error } = await (supabase as any).from("department_ticket_messages").select("*").eq("ticket_id", selectedTicket.id).order("created_at"); if (error) throw error; return data ?? []; } });

  return <div dir="rtl" className="mx-auto max-w-7xl space-y-5 pb-10">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><HardHat className="h-7 w-7 text-primary"/><h1 className="text-2xl font-bold">السلامة المهنية والبلاغات</h1></div><p className="mt-1 text-sm text-muted-foreground">التقارير الميدانية، متابعة المخاطر، التذاكر وفحص المركبات في مساحة واحدة.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/planning"><ClipboardCheck className="ml-2 h-4 w-4"/>الخطط اليومية</Link></Button><Button variant="outline" asChild><Link to="/forms"><Activity className="ml-2 h-4 w-4"/>الاستمارات</Link></Button></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={ClipboardCheck} title="تقارير HSE المستلمة" value={isHseStaff ? reportCount : "—"} note="حسب صلاحيات حسابك"/>
      <Stat icon={AlertTriangle} title="مشكلات مسجلة" value={isHseManager ? issueCount : "—"} note="تظهر لمدير السلامة"/>
      <Stat icon={Activity} title="مخاطر مفتوحة" value={isHseManager ? openRisks.length : "—"} note="تحتاج مسؤولاً أو إجراءً"/>
      <Stat icon={Ticket} title="تذاكر الأقسام" value={tickets.length} note={`${tickets.filter((t: any) => t.status !== "closed").length} مفتوحة`}/>
    </div>

    <Tabs defaultValue={isHseStaff ? "reports" : "tickets"} className="space-y-4">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 overflow-x-auto bg-muted/70 p-1 sm:grid-cols-4 lg:grid-cols-8">
        {(isHseStaff || canManageChecklist) && <TabsTrigger value="reports">التقارير</TabsTrigger>}
        {isHseManager && <TabsTrigger value="risks">المخاطر</TabsTrigger>}
        {isHseManager && <TabsTrigger value="team">الفريق والمواقع</TabsTrigger>}
        {isHseManager && <TabsTrigger value="performance">الأداء</TabsTrigger>}
        <TabsTrigger value="tickets">التذاكر</TabsTrigger><TabsTrigger value="violations">البلاغات</TabsTrigger><TabsTrigger value="vehicles">فحص المركبات</TabsTrigger><TabsTrigger value="guidance">دليل السلامة</TabsTrigger>
      </TabsList>

      {(isHseStaff || canManageChecklist) && <TabsContent value="reports" className="space-y-4">
        {canManageChecklist && <Card><CardHeader><CardTitle>إدارة بنود تقارير الأقسام</CardTitle><p className="text-sm text-muted-foreground">تُطبّق التعديلات على التقارير الجديدة فقط، وتبقى البنود المحفوظة في التقارير السابقة كما أُرسلت.</p></CardHeader><CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><Field label="القسم"><select className={inputClass} value={reportDepartmentId} onChange={(e) => { setReportDepartmentId(e.target.value); setAnswers({}); }}><option value="">اختر القسم</option>{manageableDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="نموذج التقرير"><select className={inputClass} value={reportKind} onChange={(e) => { setReportKind(e.target.value as any); setAnswers({}); }}><option value="hse">تقرير مشرف السلامة (HSE)</option><option value="permit_authorizer">تقرير مخول تصاريح العمل (PA)</option></select></Field><div className="flex items-end gap-2"><Input value={newTemplateLabel} onChange={(e) => setNewTemplateLabel(e.target.value)} placeholder="اسم البند الجديد"/><Button onClick={() => void addTemplateItem()} disabled={!reportDepartmentId || newTemplateLabel.trim().length < 2}><Plus className="ml-1 h-4 w-4"/>إضافة بند</Button></div></div>
          {!manageableDepartments.length && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">لا توجد أقسام مرتبطة بصلاحيتك؛ راجع مدير النظام لتعيين قسمك.</p>}
          {reportDepartmentId && <div className="space-y-2">{(templatesQ.data ?? []).map((item: any, index: number) => <div key={item.id} className={`flex items-center gap-2 rounded-lg border p-2 ${item.active ? "" : "opacity-60"}`}><span className="w-8 text-center text-xs text-muted-foreground">{index + 1}</span><Input defaultValue={item.item_label} disabled={!item.active} onBlur={(e) => void saveTemplateLabel(item, e.target.value)}/>{item.active ? <Button size="icon" variant="outline" aria-label="حذف البند" onClick={() => void toggleTemplateItem(item)}><Trash2 className="h-4 w-4"/></Button> : <Button size="sm" variant="outline" onClick={() => void toggleTemplateItem(item)}>استعادة</Button>}</div>)}{templatesQ.isLoading && <p className="text-sm text-muted-foreground">جارٍ تحميل بنود النموذج…</p>}{!templatesQ.isLoading && !(templatesQ.data ?? []).length && <p className="text-sm text-muted-foreground">سيتم إنشاء البنود الافتراضية لهذا القسم عند إضافة أول بند.</p>}</div>}
        </CardContent></Card>}
        {isHseStaff && <>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5"/>تقرير سلامة ميداني جديد</CardTitle></CardHeader><CardContent className="space-y-5">
          {!myMembership && !isPrivileged ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">يجب أن يضيفك مدير النظام إلى فريق السلامة قبل إرسال التقارير.</p> : <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="نوع التقرير"><select className={inputClass} value={reportKind} onChange={(e) => { setReportKind(e.target.value as any); setAnswers({}); }}>{canSubmitHse && <option value="hse">مشرف السلامة (HSE)</option>}{canSubmitPa && <option value="permit_authorizer">مخول تصاريح العمل (PA)</option>}</select></Field><Field label="القسم المعني *"><select className={inputClass} value={reportDepartmentId} onChange={(e) => { setReportDepartmentId(e.target.value); setAnswers({}); }}><option value="">اختر القسم</option>{departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="التاريخ"><Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}/></Field><Field label="الموقع الميداني *"><select className={inputClass} value={siteId} onChange={(e) => setSiteId(e.target.value)}><option value="">اختر الموقع</option>{siteOptions.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field><Field label="الشفت"><select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}><option value="day">نهاري</option><option value="night">ليلي</option></select></Field><Field label="عدد العاملين"><Input type="number" min="0" value={workforce} onChange={(e) => setWorkforce(e.target.value)}/></Field><Field label="تصاريح العمل (PTW)"><Input type="number" min="0" value={permitCount} onChange={(e) => setPermitCount(e.target.value)}/></Field></div>
            <div className="space-y-3"><div><h3 className="font-semibold">قائمة الفحص الميداني</h3><p className="text-sm text-muted-foreground">اختر حالة كل بند؛ عند تسجيل مشكلة اكتب وصفاً واضحاً لتُضاف تلقائياً إلى سجل المخاطر.</p></div>
              {items.map((item, index) => <div key={item.key} className="rounded-xl border p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{index + 1}. {item.label}</p><select aria-label={`حالة ${item.label}`} className={`${inputClass} w-full sm:w-44`} value={answers[item.key]?.result ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [item.key]: { result: e.target.value, issue: current[item.key]?.issue ?? "", action: current[item.key]?.action ?? "" } }))}><option value="">حدد الحالة</option><option value="compliant">مطابق</option><option value="issue">غير مطابق</option><option value="not_applicable">لا ينطبق</option></select></div>{answers[item.key]?.result === "issue" && <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="وصف المشكلة *"><Textarea value={answers[item.key]?.issue ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [item.key]: { ...current[item.key], result: "issue", issue: e.target.value, action: current[item.key]?.action ?? "" } }))}/></Field><Field label="الإجراء التصحيحي المقترح"><Textarea value={answers[item.key]?.action ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [item.key]: { ...current[item.key], result: "issue", issue: current[item.key]?.issue ?? "", action: e.target.value } }))}/></Field></div>}</div>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="صور التوثيق (حتى 8MB للصورة)"><Input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}/></Field><Field label="ملاحظات ختامية"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات أو محاور الاجتماع الميداني"/></Field></div>
            <div className="flex items-center justify-between gap-3 border-t pt-4"><span className="text-sm text-muted-foreground">{items.length - invalid.length} / {items.length} بنود مكتملة</span><Button onClick={() => void submitReport()} disabled={!myEmployee || !myMembership || !reportDepartmentId || !items.length || invalid.length > 0}>إرسال التقرير وإنشاء سجل المتابعة</Button></div>
          </>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>أرشيف التقارير ومراجعتها</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">التاريخ</th><th className="p-2">الموظف</th><th className="p-2">القسم</th><th className="p-2">الموقع</th><th className="p-2">النوع / الشفت</th><th className="p-2">الفحص والمشاكل</th><th className="p-2">الحالة</th><th className="p-2">إجراءات</th></tr></thead><tbody>{reports.map((report: any) => <tr key={report.id} className="border-b align-top"><td className="p-2">{report.work_date}</td><td className="p-2">{report.employees?.full_name ?? "—"}</td><td className="p-2">{report.departments?.name ?? "—"}</td><td className="p-2">{report.sites?.name ?? "—"}</td><td className="p-2">{report.report_kind === "hse" ? "HSE" : "PA"} · {report.shift === "day" ? "نهاري" : "ليلي"}</td><td className="p-2">{(report.hse_report_items ?? []).filter((item: any) => item.result === "issue").length} مشكلة · {(report.hse_report_attachments ?? []).length} صورة</td><td className="p-2"><Badge variant={report.status === "approved" ? "default" : report.status === "needs_changes" ? "destructive" : "secondary"}>{STATUS_LABEL[report.status]}</Badge></td><td className="p-2"><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setSelectedReport(report)}>التفاصيل</Button>{isHseManager && report.status !== "approved" && <Button size="sm" onClick={() => void reviewReport(report, "approved")}>اعتماد</Button>}</div></td></tr>)}{!reports.length && <EmptyRow columns={8} text="لا توجد تقارير ظاهرة لهذا الحساب."/>}</tbody></table></div></CardContent></Card>
        </>}
      </TabsContent>}

      {isHseManager && <TabsContent value="risks" className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Stat icon={AlertTriangle} title="إجمالي المخاطر" value={risks.length}/><Stat icon={Activity} title="قيد المعالجة" value={risks.filter((r: any) => r.status === "in_progress").length}/><Stat icon={CheckCircle2} title="مغلقة" value={risks.filter((r: any) => r.status === "closed").length}/></div><Card><CardHeader><CardTitle>سجل المشكلات والإجراءات التصحيحية</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-right text-sm"><thead><tr className="border-b text-muted-foreground">{["التاريخ والموقع","البند / وصف المشكلة","الموظف","المسؤول","موعد الإغلاق","الحالة","ملاحظة الإغلاق"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{risks.map((risk: any) => <tr key={risk.id} className="border-b align-top"><td className="p-2">{risk.report_item?.report?.work_date}<br/>{risk.report_item?.report?.sites?.name} · {risk.report_item?.report?.shift === "day" ? "نهاري" : "ليلي"}</td><td className="max-w-sm p-2"><strong>{risk.report_item?.item_label}</strong><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{risk.report_item?.issue_description}</p></td><td className="p-2">{risk.report_item?.report?.employees?.full_name}</td><td className="p-2"><select className={`${inputClass} min-w-48`} value={risk.assigned_employee_id ?? ""} onChange={(e) => void saveRisk(risk.id, { assigned_employee_id: e.target.value || null })}><option value="">بدون مسؤول</option>{employeeOptions.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></td><td className="p-2"><Input type="date" value={risk.due_date ?? ""} onChange={(e) => void saveRisk(risk.id, { due_date: e.target.value || null })}/></td><td className="p-2"><select className={inputClass} value={risk.status} onChange={(e) => void saveRisk(risk.id, { status: e.target.value })}><option value="open">مفتوحة</option><option value="in_progress">قيد المعالجة</option><option value="closed">مغلقة</option></select></td><td className="p-2"><Input placeholder="ملاحظة الإغلاق" defaultValue={risk.closure_note ?? ""} onBlur={(e) => { if (e.target.value !== (risk.closure_note ?? "")) void saveRisk(risk.id, { closure_note: e.target.value || null }); }}/></td></tr>)}{!risks.length && <EmptyRow columns={7} text="لا توجد مشكلات مسجلة."/>}</tbody></table></div></CardContent></Card></TabsContent>}

      {isHseManager && <TabsContent value="team" className="space-y-4"><Card><CardHeader><CardTitle>إضافة عضو وتحديد نطاق عمله</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Field label="الموظف"><select className={inputClass} value={memberDraft.employee_id} onChange={(e) => setMemberDraft({ ...memberDraft, employee_id: e.target.value })}><option value="">اختر الموظف</option>{employeeOptions.filter((e) => !members.some((m) => m.employee_id === e.id)).map((e) => <option key={e.id} value={e.id}>{e.full_name} · {e.employee_no}</option>)}</select></Field><Field label="الدور"><select className={inputClass} value={memberDraft.role} onChange={(e) => setMemberDraft({ ...memberDraft, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field><Field label="قائد الفريق"><select className={inputClass} value={memberDraft.team_leader_id} onChange={(e) => setMemberDraft({ ...memberDraft, team_leader_id: e.target.value })}><option value="">إشراف المدير</option>{members.filter((m) => m.active && ["manager", "team_leader"].includes(m.role)).map((m) => <option key={m.id} value={m.id}>{m.employees?.full_name}</option>)}</select></Field><Field label="الموقع"><select className={inputClass} value={memberDraft.site_id} onChange={(e) => setMemberDraft({ ...memberDraft, site_id: e.target.value })}><option value="">كل المواقع</option>{siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="الرقعة"><select className={inputClass} value={memberDraft.area} onChange={(e) => setMemberDraft({ ...memberDraft, area: e.target.value })}><option value="all">الشمال والجنوب</option><option value="north">الشمال</option><option value="south">الجنوب</option></select></Field><div className="flex items-end"><Button className="w-full" onClick={() => void addMember()}><Plus className="ml-2 h-4 w-4"/>إضافة</Button></div></CardContent></Card><Card><CardHeader><CardTitle>فريق السلامة ({members.length})</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead><tr className="border-b text-muted-foreground">{["الموظف","الدور","قائد الفريق","الموقع / الرقعة","الحالة","الإجراء"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{members.map((member) => <tr key={member.id} className="border-b"><td className="p-2">{member.employees?.full_name ?? "—"}<div className="text-xs text-muted-foreground">{member.employees?.employee_no}</div></td><td className="p-2"><Badge variant={ROLE_VARIANT[member.role]}>{ROLE_LABEL[member.role]}</Badge></td><td className="p-2">{members.find((m) => m.id === member.team_leader_id)?.employees?.full_name ?? "إشراف المدير"}</td><td className="p-2">{member.sites?.name ?? "كل المواقع"} · {member.area === "all" ? "شامل" : member.area === "north" ? "شمال" : "جنوب"}</td><td className="p-2">{member.active ? "فعّال" : "معطّل"}</td><td className="p-2"><Button size="sm" variant="outline" onClick={() => void toggleMember(member)}>{member.active ? "تعطيل" : "تفعيل"}</Button></td></tr>)}{!members.length && <EmptyRow columns={6} text="لا يوجد أعضاء؛ أضف مدير سلامة أولاً."/>}</tbody></table></div></CardContent></Card></TabsContent>}

      {isHseManager && <TabsContent value="performance" className="space-y-4"><Card><CardHeader><CardTitle>إضافة نقاط تميز أو مخالفة — {monthStart().slice(0, 7)}</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><Field label="الموظف"><select className={inputClass} value={scoreDraft.employee_id} onChange={(e) => setScoreDraft({ ...scoreDraft, employee_id: e.target.value })}><option value="">اختر الموظف</option>{members.filter((m) => m.active).map((m) => <option key={m.employee_id} value={m.employee_id}>{m.employees?.full_name}</option>)}</select></Field><Field label="النقاط (السالب مخالفة)"><Input type="number" min="-100" max="100" value={scoreDraft.points} onChange={(e) => setScoreDraft({ ...scoreDraft, points: e.target.value })}/></Field><Field label="السبب"><Input value={scoreDraft.reason} onChange={(e) => setScoreDraft({ ...scoreDraft, reason: e.target.value })}/></Field><div className="sm:col-span-3"><Button onClick={() => void addScore()}>تسجيل النقاط</Button></div></CardContent></Card><Card><CardHeader><CardTitle>التزام الكادر هذا الشهر</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-right text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">الموظف</th><th className="p-2">الدور</th><th className="p-2">تقارير مرسلة</th><th className="p-2">مشكلات مسجلة</th><th className="p-2">نقاط التميز/المخالفات</th><th className="p-2">التقييم</th></tr></thead><tbody>{scoreRows.map((row) => <tr className="border-b" key={row.employee?.id}><td className="p-2">{row.employee?.full_name}</td><td className="p-2">{ROLE_LABEL[members.find((m) => m.employee_id === row.employee?.id)?.role ?? "officer"]}</td><td className="p-2">{row.sent}</td><td className="p-2">{row.issues}</td><td className="p-2">{row.score > 0 ? "+" : ""}{row.score}</td><td className="p-2">{row.sent === 0 ? "لا توجد تقارير" : row.issues === 0 ? "ملتزم" : "توجد متابعة"}</td></tr>)}{!scoreRows.length && <EmptyRow columns={6} text="لا توجد تقارير أو نقاط مسجلة لهذا الشهر."/>}</tbody></table></div></CardContent></Card></TabsContent>}

      <TabsContent value="tickets" className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Ticket className="h-5 w-5"/>تذكرة جديدة إلى قسم</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Field label="عنوان التذكرة"><Input value={ticketDraft.subject} onChange={(e) => setTicketDraft({ ...ticketDraft, subject: e.target.value })}/></Field><Field label="القسم المستلم"><select className={inputClass} value={ticketDraft.target_department_id} onChange={(e) => setTicketDraft({ ...ticketDraft, target_department_id: e.target.value })}><option value="">اختر القسم</option>{departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="الأولوية"><select className={inputClass} value={ticketDraft.priority} onChange={(e) => setTicketDraft({ ...ticketDraft, priority: e.target.value })}><option value="low">منخفضة</option><option value="normal">عادية</option><option value="high">عالية</option><option value="urgent">عاجلة</option></select></Field><Field label="المهلة"><Input type="date" value={ticketDraft.due_date} onChange={(e) => setTicketDraft({ ...ticketDraft, due_date: e.target.value })}/></Field><Field label="التفاصيل"><Textarea value={ticketDraft.details} onChange={(e) => setTicketDraft({ ...ticketDraft, details: e.target.value })}/></Field><div className="sm:col-span-2 lg:col-span-5"><Button onClick={() => void createTicket()}>إرسال التذكرة</Button></div></CardContent></Card><Card><CardHeader><CardTitle>تذاكر واردة ومرسلة ({tickets.length})</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-right text-sm"><thead><tr className="border-b text-muted-foreground">{["رقم","العنوان","من ← إلى","الأولوية","الحالة","المهلة","التاريخ","المحادثة"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{tickets.map((ticket: any) => <tr className="border-b" key={ticket.id}><td className="p-2">{ticket.ticket_no}</td><td className="p-2">{ticket.subject}<div className="max-w-sm truncate text-xs text-muted-foreground">{ticket.details}</div></td><td className="p-2">{ticket.source_department?.name ?? "مباشر"} ← {ticket.target_department?.name}</td><td className="p-2">{ticket.priority === "urgent" ? "عاجلة" : ticket.priority === "high" ? "عالية" : ticket.priority === "low" ? "منخفضة" : "عادية"}</td><td className="p-2"><select className={`${inputClass} w-36`} value={ticket.status} onChange={(e) => void updateTicket(ticket, e.target.value)}><option value="open">مفتوحة</option><option value="in_progress">قيد المعالجة</option><option value="closed">مغلقة</option></select></td><td className="p-2">{ticket.due_at ? new Date(ticket.due_at).toLocaleDateString("ar-IQ") : "—"}</td><td className="p-2">{new Date(ticket.created_at).toLocaleDateString("ar-IQ")}</td><td className="p-2"><Button size="sm" variant="outline" onClick={() => setSelectedTicket(ticket)}>فتح</Button></td></tr>)}{!tickets.length && <EmptyRow columns={8} text="لا توجد تذاكر ظاهرة لحسابك."/>}</tbody></table></div></CardContent></Card></TabsContent>

      <TabsContent value="violations" className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><FileWarning className="h-5 w-5"/>إرسال بلاغ مخالفة</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="عنوان البلاغ"><Input value={violationDraft.title} onChange={(e) => setViolationDraft({ ...violationDraft, title: e.target.value })}/></Field><Field label="القسم المعني"><select className={inputClass} value={violationDraft.department_id} onChange={(e) => setViolationDraft({ ...violationDraft, department_id: e.target.value })}><option value="">اختر القسم</option>{departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="تفاصيل المخالفة"><Textarea value={violationDraft.details} onChange={(e) => setViolationDraft({ ...violationDraft, details: e.target.value })}/></Field><div className="space-y-2"><Label className="flex items-center gap-2"><input type="checkbox" checked={violationDraft.anonymous} onChange={(e) => setViolationDraft({ ...violationDraft, anonymous: e.target.checked })}/>إخفاء اسم المبلّغ عند عرض البلاغ</Label><p className="text-xs text-muted-foreground">تظل هوية المرسل محمية بسياسات الوصول، ويُخفى اسمه في واجهة البلاغ عند تفعيل هذا الخيار.</p></div><div className="sm:col-span-2"><Button onClick={() => void createViolation()}>إرسال البلاغ</Button></div></CardContent></Card><Card><CardHeader><CardTitle>البلاغات التي يمكنك متابعتها</CardTitle></CardHeader><CardContent><div className="space-y-3">{violations.map((report: any) => <div key={report.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3"><div><div className="flex flex-wrap items-center gap-2"><strong>{report.title}</strong><Badge variant={report.status === "closed" ? "default" : "secondary"}>{STATUS_LABEL[report.status]}</Badge></div><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{report.details}</p><p className="mt-1 text-xs text-muted-foreground">{report.departments?.name} · {new Date(report.created_at).toLocaleDateString("ar-IQ")} · {report.anonymous ? "بلاغ مجهول" : "بلاغ معلن"}</p></div>{(isPrivileged || isHseManager) && <select className={`${inputClass} w-40`} value={report.status} onChange={async (e) => { const { error } = await (supabase as any).from("violation_reports").update({ status: e.target.value }).eq("id", report.id); if (error) toast.error(errText(error)); else await refresh(["violation-reports"]); }}><option value="open">مفتوح</option><option value="in_progress">قيد المعالجة</option><option value="closed">مغلق</option></select>}</div>)}{!violations.length && <p className="py-8 text-center text-sm text-muted-foreground">لا توجد بلاغات يمكن عرضها.</p>}</div></CardContent></Card></TabsContent>

      <TabsContent value="vehicles" className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Bus className="h-5 w-5"/>التحقق من بيانات المركبات والسائقين</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">ابحث برقم المركبة أو اسمها. تظهر حالة التصريح الأمني والسائق ورخصته وجواز السلامة من سجلّات ERP الحالية.</p><Input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="رقم المركبة أو اسمها — اكتب حرفين على الأقل"/><div className="grid gap-3 md:grid-cols-2">{(vehiclesQ.data ?? []).map((v: any) => <div key={v.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{v.name}</h3><p className="text-sm text-muted-foreground">{v.vehicle_no} · {v.vehicle_class === "heavy" ? "ثقيلة" : "خفيفة"}</p></div><Badge variant={v.is_active ? "default" : "secondary"}>{v.is_active ? "نشطة" : "غير نشطة"}</Badge></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p>السائق: <strong>{v.employees?.full_name ?? "غير محدد"}</strong></p><p>الهاتف: {v.employees?.phone1 ?? "—"}</p><p>رخصة السوق: {v.employees?.driving_license ?? "غير مسجلة"}</p><p>جواز السلامة: {v.employees?.safety_passport_no ?? "غير مسجل"}</p><p>انتهاء جواز السلامة: {v.employees?.safety_passport_expiry ?? "—"}</p><p>التصريح الأمني: {v.security_permit_expiry ?? "غير مسجل"}</p></div></div>)}{vehicleSearch.trim().length >= 2 && !vehiclesQ.isLoading && !(vehiclesQ.data ?? []).length && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">لا توجد مركبات مطابقة للبحث.</p>}</div></CardContent></Card><Card><CardHeader><CardTitle>فحص بيانات السائقين</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead><tr className="border-b text-muted-foreground">{["الموظف","الهاتف","رخصة القيادة","رقم جواز السلامة","انتهاء الجواز","الحالة"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{employeeOptions.filter((e) => e.driving_license || e.safety_passport_no || e.safety_passport_expiry).slice(0, 50).map((e) => <tr className="border-b" key={e.id}><td className="p-2">{e.full_name} · {e.employee_no}</td><td className="p-2">{e.phone1 ?? "—"}</td><td className="p-2">{e.driving_license ?? "غير مسجلة"}</td><td className="p-2">{e.safety_passport_no ?? "—"}</td><td className="p-2">{e.safety_passport_expiry ?? "—"}</td><td className="p-2">{e.safety_passport_status ?? "—"}</td></tr>)}</tbody></table></div><Button className="mt-3" variant="outline" asChild><Link to="/vehicles">فتح سجل المركبات الكامل</Link></Button></CardContent></Card></TabsContent>

      <TabsContent value="guidance"><div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/>قواعد الحفاظ على الحياة</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{["المكان المحصور: لا تدخل دون تصريح ومراقب.","تجاوز ضوابط السلامة: لا تعطل حاجزاً دون اعتماد.","عزل الطاقة: تحقق من العزل وانعدام الطاقة.","القيادة: التزم بالسرعات وقواعد الرحلات.","العمل الساخن: اضبط مصادر الاشتعال والمواد القابلة للاشتعال.","الحفريات: تحقق من الخدمات والمخاطر تحت الأرض.","الرفع: خطط للرفع واعزل منطقة العمل.","خط النار: أبعد نفسك والآخرين عن مسار الخطر.","العمل على ارتفاع: استخدم الوقاية من السقوط.","تصريح العمل: اعمل بتصريح ساري عند الحاجة."].map((rule, index) => <div className="rounded-lg border p-3 text-sm" key={rule}><span className="ml-2 font-bold text-primary">{index + 1}.</span>{rule}</div>)}</CardContent></Card><Card><CardHeader><CardTitle>إرشادات الاستجابة الميدانية</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-7"><p>أوقف العمل عند خطر وشيك، وأبعد العاملين عن منطقة الخطر، وأبلغ مشرف الموقع ومدير السلامة فوراً.</p><p>وثّق الموقع والوقت والأشخاص المعنيين والإجراء الفوري، ثم افتح سجل متابعة بمسؤول وموعد إغلاق.</p><p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">استخدم أرقام الطوارئ المعتمدة داخلياً في موقعك. لم تُضف أرقام اتصال إلى هذا الدليل لعدم توفر مصدر موثق ضمن نظام المشروع.</p></CardContent></Card></div></TabsContent>
    </Tabs>

    <Dialog open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}><DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>تفاصيل تقرير السلامة</DialogTitle></DialogHeader>{selectedReport && <div className="space-y-4"><div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-sm sm:grid-cols-3"><p>الموظف: {selectedReport.employees?.full_name}</p><p>القسم: {selectedReport.departments?.name ?? "—"}</p><p>الموقع: {selectedReport.sites?.name}</p><p>التاريخ: {selectedReport.work_date} · {selectedReport.shift === "day" ? "نهاري" : "ليلي"}</p><p>نوع التقرير: {selectedReport.report_kind === "hse" ? "HSE" : "PA"}</p><p>عدد العاملين: {selectedReport.workforce_count}</p><p>تصاريح العمل: {selectedReport.permit_count}</p></div><div className="space-y-2">{(selectedReport.hse_report_items ?? []).map((item: any) => <div className="rounded-lg border p-3" key={item.id}><div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.item_label}</strong><Badge variant={item.result === "issue" ? "destructive" : item.result === "compliant" ? "default" : "secondary"}>{item.result === "issue" ? "غير مطابق" : item.result === "compliant" ? "مطابق" : "لا ينطبق"}</Badge></div>{item.issue_description && <p className="mt-2 text-sm">المشكلة: {item.issue_description}</p>}{item.corrective_action && <p className="mt-1 text-sm text-muted-foreground">الإجراء المقترح: {item.corrective_action}</p>}</div>)}</div>{selectedReport.notes && <p className="rounded-lg bg-muted/50 p-3 text-sm">{selectedReport.notes}</p>}<div className="flex flex-wrap gap-2">{(selectedReport.hse_report_attachments ?? []).map((attachment: any) => <PhotoLink key={attachment.id} attachment={attachment}/>)}</div>{isHseManager && <div className="flex gap-2 border-t pt-3"><Button onClick={() => { void reviewReport(selectedReport, "approved"); setSelectedReport(null); }}>اعتماد التقرير</Button><Button variant="outline" onClick={() => { void reviewReport(selectedReport, "needs_changes"); setSelectedReport(null); }}>طلب متابعة</Button></div>}</div>}</DialogContent></Dialog>

    <TicketDialog ticket={selectedTicket} setTicket={setSelectedTicket} messages={messagesQ.data ?? []} reply={ticketReply} setReply={setTicketReply} onSend={() => void replyTicket()}/>
  </div>;
}

function PhotoLink({ attachment }: { attachment: any }) {
  const [url, setUrl] = useState("");
  const open = async () => { const { data, error } = await supabase.storage.from("hse-report-photos").createSignedUrl(attachment.storage_path, 120); if (error) toast.error(errText(error)); else { setUrl(data.signedUrl); window.open(data.signedUrl, "_blank", "noopener,noreferrer"); } };
  return <Button type="button" size="sm" variant="outline" onClick={() => void open()}>{attachment.file_name}{url ? " · فتح" : " · عرض الصورة"}</Button>;
}

function TicketDialog({ ticket, setTicket, messages, reply, setReply, onSend }: { ticket: any; setTicket: (value: any) => void; messages: any[]; reply: string; setReply: (value: string) => void; onSend: () => void }) {
  return <Dialog open={!!ticket} onOpenChange={(open) => !open && setTicket(null)}><DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>محادثة التذكرة {ticket?.ticket_no}: {ticket?.subject}</DialogTitle></DialogHeader>{ticket && <div className="space-y-4"><p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{ticket.details}</p><div className="max-h-72 space-y-2 overflow-y-auto">{messages.map((message: any) => <div key={message.id} className="rounded-lg border p-3"><div className="text-left text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString("ar-IQ")}</div><p className="mt-2 whitespace-pre-wrap text-sm">{message.message}</p></div>)}{!messages.length && <p className="text-sm text-muted-foreground">لا توجد ردود بعد.</p>}</div><Textarea placeholder="اكتب رداً للقسم" value={reply} onChange={(e) => setReply(e.target.value)}/><Button onClick={onSend} disabled={!reply.trim()}>إرسال الرد</Button></div>}</DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function Stat({ icon: Icon, title, value, note }: { icon: typeof Users; title: string; value: string | number; note?: string }) { return <Card><CardContent className="flex items-start gap-3 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5"/></div><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-2xl font-bold tabular-nums">{value}</p>{note && <p className="text-xs text-muted-foreground">{note}</p>}</div></CardContent></Card>; }
function EmptyRow({ columns, text }: { columns: number; text: string }) { return <tr><td colSpan={columns} className="p-8 text-center text-muted-foreground">{text}</td></tr>; }

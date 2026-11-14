import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { loadAllRows } from "@/lib/monthly-report";

// These tables are newer than the generated database types.
export const certificationDb: SupabaseClient = supabase;
type Department = { id: string; name: string; manager_user_id: string | null };
type Course = {
  id: string;
  name_ar: string;
  code: string;
  department_id: string | null;
  is_active: boolean;
  default_validity_months: number;
};
type Employee = {
  full_name: string;
  employee_no: string;
  department_name: string | null;
  position: string | null;
  departments: { name: string } | null;
};
type Related = { id: string; employee: Employee | null; course: { name_ar: string } | null };
type Certificate = Related & {
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  attachment_url: string | null;
};
type Request = Related & {
  status: string;
  request_type: string;
  department: { name: string } | null;
  target_approver_id: string | null;
  notes: string | null;
  created_at: string;
};
export type Template = {
  id: string;
  title: string;
  category: string | null;
  description: string | null;
  target_audience: string | null;
  fields_schema: { name: string; label: string; type: string; options?: string[] }[];
};
type Submission = {
  id: string;
  employee: { full_name: string } | null;
  form: { title: string } | null;
  status: string;
  submitted_at: string;
  form_data: Record<string, unknown>;
};
function rows<T>(table: string, columns: string, activeOnly = false) {
  return loadAllRows<T>((from, to) => {
    let query = certificationDb.from(table).select(columns);
    if (activeOnly) query = query.eq("is_active", true);
    return query.order("id").range(from, to).returns<T[]>();
  });
}
export async function loadCenter() {
  const employee = "full_name,employee_no,department_name,departments(name),position";
  const [certs, training, courses, departments] = await Promise.all([
    rows<Certificate>(
      "employee_certifications",
      `id,issue_date,expiry_date,status,attachment_url,employee:employees(${employee}),course:training_course_types(name_ar)`,
    ),
    rows<Request>(
      "training_requests",
      `id,request_type,status,notes,created_at,target_approver_id,employee:employees!employee_id(${employee}),course:training_course_types(name_ar),department:departments(name)`,
    ),
    rows<Course>("training_course_types", "*"),
    rows<Department>("departments", "id,name,manager_user_id"),
  ]);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Baghdad" });
  return {
    courses,
    departments,
    certifications: certs.map((c) => {
      const days = c.expiry_date
        ? (Date.parse(c.expiry_date) - Date.parse(today)) / 86400000
        : null;
      return {
        ...c,
        employee_name: c.employee?.full_name ?? "—",
        employee_no: c.employee?.employee_no ?? "",
        department: c.employee?.departments?.name ?? c.employee?.department_name ?? "—",
        specialty: c.employee?.position ?? "—",
        course_type: c.course?.name_ar ?? "—",
        days_remaining: days,
        status:
          days === null ? c.status : days < 0 ? "expired" : days <= 30 ? "expiring_soon" : "active",
      };
    }),
    requests: training
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((r) => ({
        ...r,
        employee_name: r.employee?.full_name ?? "—",
        employee_no: r.employee?.employee_no ?? "",
        course_type: r.course?.name_ar ?? "—",
        approver: r.department?.name ?? "—",
      })),
  };
}

export async function loadFormsCenter() {
  const [templates, forms] = await Promise.all([
    rows<Template>("digital_form_templates", "*", true),
    rows<Submission>(
      "digital_form_submissions",
      "id,status,submitted_at,form_data,employee:employees(full_name),form:digital_form_templates(title)",
    ),
  ]);
  return {
    templates,
    submissions: forms
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
      .map((s) => ({
        ...s,
        employee_name: s.employee?.full_name ?? "—",
        template: s.form?.title ?? "—",
      })),
  };
}

export const formUrl = (id: string) =>
  new URL("/digital-form/" + encodeURIComponent(id), window.location.origin).href;
export async function copyForm(id: string) {
  try {
    await navigator.clipboard.writeText(formUrl(id));
    toast.success("تم نسخ رابط الاستمارة");
  } catch {
    toast.error("تعذر النسخ إلى الحافظة");
  }
}

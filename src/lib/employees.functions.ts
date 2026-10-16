import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const nullableText = z.string().max(400).nullable().optional();
const nullableDate = z.string().max(20).nullable().optional();
const nullableNumber = z.coerce.number().nullable().optional();

const toNull = (value: string | null | undefined) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === "none" ? null : trimmed;
};

const rowSchema = z.object({
  employee_no: z.string().min(1).max(48),
  full_name: z.string().min(1).max(200),
  position: nullableText,
  department: nullableText,
  pay_type: z.enum(["daily", "monthly"]).optional(),
  base_salary: nullableNumber,
  department_id: nullableText.optional().default(null),
  site_id: nullableText.optional().default(null),
  wage_rate_id: nullableText.optional().default(null),
  erp_no: nullableText,
  attendance_device_id: nullableText,
  id_no: nullableText,
  ctr_code: nullableText,
  status: z.enum(["active", "inactive", "terminated"]).optional(),
  nationality: nullableText,
  birth_date: nullableDate,
  hire_date: nullableDate,
  last_working_day: nullableDate,
  contract_end_date: nullableDate,
  phone1: nullableText,
  phone2: nullableText,
  email: nullableText,
  address: nullableText,
  salary_type: nullableText,
  salary_structure: nullableText,
  project: nullableText,
  passport_no: nullableText,
  passport_expiry: nullableDate,
  residency_no: nullableText,
  residency_expiry: nullableDate,
  safety_passport_no: nullableText,
  safety_passport_expiry: nullableDate,
  bank_name: nullableText,
  bank_account: nullableText,
  iban: nullableText,
  emergency_contact_name: nullableText,
  emergency_contact_phone: nullableText,
  notes: nullableText,
  employee_import_data: z.record(z.string(), z.union([z.string().max(32767), z.number(), z.boolean(), z.null()])).optional(),
});

const schema = z.object({ rows: z.array(rowSchema).min(1).max(1000) });

export const importEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const employeeNos = [...new Set(data.rows.map((row) => row.employee_no.trim()))];
    const { data: existingEmployees, error: existingError } = await supabase
      .from("employees").select("*").in("employee_no", employeeNos);
    if (existingError) throw new Error(`فشل فحص الموظفين الموجودين: ${existingError.message}`);
    const existingByNo = new Map((existingEmployees ?? []).map((employee) => [employee.employee_no, employee]));

    const names = [...new Set(data.rows.map((r) => toNull(r.department)).filter((name): name is string => !!name))];
    const deptIdByName = new Map<string, string>();
    if (names.length) {
      const { data: existing } = await supabase.from("departments").select("id, name").in("name", names);
      for (const d of existing ?? []) deptIdByName.set(d.name, d.id);
      const missing = names.filter((name) => !deptIdByName.has(name));
      if (missing.length) {
        const { data: created, error } = await supabase
          .from("departments")
          .upsert(
            missing.map((name) => ({ name: name.trim(), description: null })),
            { onConflict: "name" },
          )
          .select("id, name");
        if (error) throw new Error(`فشل إنشاء الأقسام: ${error.message}`);
        for (const d of created ?? []) deptIdByName.set(d.name, d.id);
      }
    }

    const keepExisting = <T,>(value: T | null | undefined, current: T | null | undefined): T | null =>
      value === null || value === undefined || (typeof value === "string" && !value.trim()) ? current ?? null : value;
    const payload = data.rows.map((r) => {
      const employeeNo = String(r.employee_no).trim();
      const existing = existingByNo.get(employeeNo);
      const departmentName = toNull(r.department);
      return {
        employee_no: employeeNo,
        full_name: String(r.full_name).trim(),
        position: keepExisting(r.position, existing?.position),
        department_id: departmentName
          ? deptIdByName.get(departmentName) ?? existing?.department_id ?? null
          : keepExisting(r.department_id, existing?.department_id),
        site_id: keepExisting(r.site_id, existing?.site_id),
        wage_rate_id: keepExisting(r.wage_rate_id, existing?.wage_rate_id),
        status: r.status ?? existing?.status ?? "active",
        pay_type: r.pay_type ?? existing?.pay_type ?? "monthly",
        base_salary: keepExisting(r.base_salary, existing?.base_salary),
        erp_no: keepExisting(r.erp_no, existing?.erp_no),
        attendance_device_id: keepExisting(r.attendance_device_id, existing?.attendance_device_id),
        id_no: keepExisting(r.id_no, existing?.id_no),
        ctr_code: keepExisting(r.ctr_code, existing?.ctr_code),
        nationality: keepExisting(r.nationality, existing?.nationality),
        birth_date: keepExisting(r.birth_date, existing?.birth_date),
        hire_date: keepExisting(r.hire_date, existing?.hire_date),
        last_working_day: keepExisting(r.last_working_day, existing?.last_working_day),
        contract_end_date: keepExisting(r.contract_end_date, existing?.contract_end_date),
        phone1: keepExisting(r.phone1, existing?.phone1),
        phone2: keepExisting(r.phone2, existing?.phone2),
        email: keepExisting(r.email, existing?.email),
        address: keepExisting(r.address, existing?.address),
        salary_type: keepExisting(r.salary_type, existing?.salary_type),
        salary_structure: keepExisting(r.salary_structure, existing?.salary_structure),
        project: keepExisting(r.project, existing?.project),
        passport_no: keepExisting(r.passport_no, existing?.passport_no),
        passport_expiry: keepExisting(r.passport_expiry, existing?.passport_expiry),
        residency_no: keepExisting(r.residency_no, existing?.residency_no),
        residency_expiry: keepExisting(r.residency_expiry, existing?.residency_expiry),
        safety_passport_no: keepExisting(r.safety_passport_no, existing?.safety_passport_no),
        safety_passport_expiry: keepExisting(r.safety_passport_expiry, existing?.safety_passport_expiry),
        bank_name: existing?.bank_name ?? null,
        bank_account: existing?.bank_account ?? null,
        iban: existing?.iban ?? null,
        emergency_contact_name: existing?.emergency_contact_name ?? null,
        emergency_contact_phone: existing?.emergency_contact_phone ?? null,
        notes: keepExisting(r.notes, existing?.notes),
        employee_import_data: {
          ...(existing?.employee_import_data ?? {}),
          ...Object.fromEntries(Object.entries(r.employee_import_data ?? {}).filter(([, value]) => value !== null && value !== "")),
        },
        updated_at: new Date().toISOString(),
      };
    });

    const { error, count } = await supabase.from("employees").upsert(payload, { onConflict: "employee_no", count: "exact" });
    if (error) throw new Error(`فشل استيراد الموظفين: ${error.message}`);

    return { imported: count ?? payload.length, departments: deptIdByName.size };
  });

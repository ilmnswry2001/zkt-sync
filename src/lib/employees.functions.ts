import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const nullableText = z.string().max(400).nullable();
const nullableDate = z.string().max(20).nullable();
const nullableNumber = z.coerce.number().nullable();

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
  pay_type: z.enum(["daily", "monthly"]).optional().default("monthly"),
  base_salary: nullableNumber.optional().default(null),
  department_id: nullableText.optional().default(null),
  site_id: nullableText.optional().default(null),
  wage_rate_id: nullableText.optional().default(null),
  erp_no: nullableText,
  id_no: nullableText,
  ctr_code: nullableText,
  status: z.enum(["active", "inactive", "terminated"]).optional().default("active"),
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
});

const schema = z.object({ rows: z.array(rowSchema).min(1).max(1000) });

export const importEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

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

    const payload = data.rows.map((r) => ({
      employee_no: String(r.employee_no).trim(),
      full_name: String(r.full_name).trim(),
      position: toNull(r.position),
      department_id: r.department ? deptIdByName.get(String(r.department).trim()) ?? null : toNull(r.department_id),
      site_id: toNull(r.site_id),
      wage_rate_id: toNull(r.wage_rate_id),
      status: r.status ?? "active",
      pay_type: r.pay_type ?? "monthly",
      base_salary: r.base_salary ?? null,
      erp_no: toNull(r.erp_no),
      id_no: toNull(r.id_no),
      ctr_code: toNull(r.ctr_code),
      nationality: toNull(r.nationality),
      birth_date: toNull(r.birth_date),
      hire_date: toNull(r.hire_date),
      last_working_day: toNull(r.last_working_day),
      contract_end_date: toNull(r.contract_end_date),
      phone1: toNull(r.phone1),
      phone2: toNull(r.phone2),
      email: toNull(r.email),
      address: toNull(r.address),
      salary_type: toNull(r.salary_type),
      salary_structure: toNull(r.salary_structure),
      project: toNull(r.project),
      passport_no: toNull(r.passport_no),
      passport_expiry: toNull(r.passport_expiry),
      residency_no: toNull(r.residency_no),
      residency_expiry: toNull(r.residency_expiry),
      safety_passport_no: toNull(r.safety_passport_no),
      safety_passport_expiry: toNull(r.safety_passport_expiry),
      bank_name: toNull(r.bank_name),
      bank_account: toNull(r.bank_account),
      iban: toNull(r.iban),
      emergency_contact_name: toNull(r.emergency_contact_name),
      emergency_contact_phone: toNull(r.emergency_contact_phone),
      notes: toNull(r.notes),
      updated_at: new Date().toISOString(),
    }));

    const { error, count } = await supabase.from("employees").upsert(payload, { onConflict: "employee_no", count: "exact" });
    if (error) throw new Error(`فشل استيراد الموظفين: ${error.message}`);

    return { imported: count ?? payload.length, departments: deptIdByName.size };
  });

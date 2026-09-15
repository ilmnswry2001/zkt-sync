import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const nullableText = z.string().max(400).nullable();
const nullableDate = z.string().max(20).nullable();

const rowSchema = z.object({
  employee_no: z.string().min(1).max(48),
  full_name: z.string().min(1).max(200),
  position: nullableText,
  department: nullableText,
  erp_no: nullableText,
  id_no: nullableText,
  status: z.enum(["active", "inactive"]),
  nationality: nullableText,
  birth_date: nullableDate,
  hire_date: nullableDate,
  last_working_day: nullableDate,
  phone1: nullableText,
  phone2: nullableText,
  address: nullableText,
  salary_type: nullableText,
  salary_structure: nullableText,
  project: nullableText,
  safety_passport_no: nullableText,
  safety_passport_expiry: nullableDate,
  notes: nullableText,
});

const schema = z.object({ rows: z.array(rowSchema).min(1).max(1000) });

export const importEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // 1. Resolve / create departments referenced in this batch
    const names = [...new Set(data.rows.map((r) => r.department).filter((n): n is string => !!n))];
    const deptIdByName = new Map<string, string>();
    if (names.length) {
      const { data: existing } = await supabase.from("departments").select("id, name").in("name", names);
      for (const d of existing ?? []) deptIdByName.set(d.name, d.id);
      const missing = names.filter((n) => !deptIdByName.has(n));
      if (missing.length) {
        const { data: created, error } = await supabase.from("departments")
          .upsert(missing.map((name) => ({ name })), { onConflict: "name" })
          .select("id, name");
        if (error) throw new Error(`فشل إنشاء الأقسام: ${error.message}`);
        for (const d of created ?? []) deptIdByName.set(d.name, d.id);
      }
    }

    // 2. Upsert employees by employee_no
    const payload = data.rows.map((r) => ({
      employee_no: r.employee_no,
      full_name: r.full_name,
      position: r.position,
      department_id: r.department ? deptIdByName.get(r.department) ?? null : null,
      status: r.status,
      erp_no: r.erp_no,
      id_no: r.id_no,
      nationality: r.nationality,
      birth_date: r.birth_date,
      hire_date: r.hire_date,
      last_working_day: r.last_working_day,
      phone1: r.phone1,
      phone2: r.phone2,
      address: r.address,
      salary_type: r.salary_type,
      salary_structure: r.salary_structure,
      project: r.project,
      safety_passport_no: r.safety_passport_no,
      safety_passport_expiry: r.safety_passport_expiry,
      notes: r.notes,
      updated_at: new Date().toISOString(),
    }));

    const { error, count } = await supabase.from("employees")
      .upsert(payload, { onConflict: "employee_no", count: "exact" });
    if (error) throw new Error(`فشل استيراد الموظفين: ${error.message}`);

    return { imported: count ?? payload.length, departments: deptIdByName.size };
  });

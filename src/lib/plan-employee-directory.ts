import { supabase } from "@/integrations/supabase/client";
import type { AssignedStaffEmployee } from "./planning-staff";

export const planEmployeeDirectoryOptions = {
  queryKey: ["plan-employee-directory"],
  staleTime: 60_000,
  queryFn: async (): Promise<AssignedStaffEmployee[]> => {
    const employees: AssignedStaffEmployee[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("employees")
        .select("id, full_name, employee_no, phone1, position, department_name")
        .order("id").range(offset, offset + pageSize - 1);
      if (error) throw error;
      employees.push(...(data ?? []).map(({ phone1, ...employee }) => ({ ...employee, phone: phone1 })));
      if (!data || data.length < pageSize) return employees;
    }
  },
};
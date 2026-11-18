import { supabase } from "@/integrations/supabase/client";
import type { AssignedStaffEmployee } from "./planning-staff";

export function planEmployeeDirectoryOptions(search: string, specialty: string) {
  return {
    queryKey: ["plan-employee-directory", search, specialty],
    staleTime: 60_000,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<AssignedStaffEmployee[]> => {
      let query = supabase.from("employees").select("id, full_name, employee_no, phone1, position, department_name");
      if (search) {
        for (const term of search.split(" ")) {
          query = query.or(`full_name.ilike.%${term}%,employee_no.ilike.%${term}%,position.ilike.%${term}%,department_name.ilike.%${term}%`);
        }
      } else if (specialty.trim()) {
        query = query.ilike("position", `%${specialty.trim().replace(/[\\%_]/g, "\\$&")}%`);
      }
      const { data, error } = await query.order("full_name").order("id").limit(20).abortSignal(signal);
      if (error) throw error;
      return data.map(({ phone1, ...employee }) => ({ ...employee, phone: phone1 }));
    },
  };
}

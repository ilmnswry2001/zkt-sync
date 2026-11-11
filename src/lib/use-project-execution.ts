import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { loadAllRows } from "@/lib/monthly-report";
export type VerifiedExecution = {
  employee_id: string;
  full_name: string;
  employee_no: string;
  site_id: string | null;
  specialty: string;
  assignment_source: string;
  first_punch: string;
  conflicting: boolean;
};
export function useProjectExecution(date: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["project-execution", date],
    refetchInterval: 30_000,
    queryFn: async () => {
      const rows = await loadAllRows((from, to) =>
        supabase.rpc("project_verified_execution", { p_date: date }).range(from, to),
      );
      return Array.from(new Map(rows.map((person) => [person.employee_id, person])).values());
    },
  });
}

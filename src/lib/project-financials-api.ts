import { supabase } from "@/integrations/supabase/client";
import { loadAllRows } from "@/lib/monthly-report";
import type { FinancialSnapshot } from "@/lib/project-financials";
import type { MaterialIssueRow } from "@/lib/site-material-costs";

type Scope = { p_site_id: string; p_start: string | null; p_end: string };

export async function readProjectFinancials(scope: Scope, signal: AbortSignal) {
  const { data, error } = await supabase
    .rpc("read_project_financials" as never, scope as never)
    .abortSignal(signal);
  if (error) throw error;
  return data as FinancialSnapshot;
}

export async function readProjectMaterialIssues(
  scope: Scope,
  offset: number,
  limit: number,
  signal?: AbortSignal,
) {
  const request = supabase.rpc(
    "read_project_material_issues" as never,
    {
      ...scope,
      p_offset: offset,
      p_limit: limit,
    } as never,
  );
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return data as MaterialIssueRow[];
}

export function readAllProjectMaterialIssues(scope: Scope) {
  return loadAllRows<MaterialIssueRow>(async (from, to) => ({
    data: await readProjectMaterialIssues(scope, from, to - from + 1),
    error: null,
  }));
}

export async function updateSiteBudget(siteId: string, budget: number) {
  const { error } = await supabase.rpc(
    "set_site_ctr_budget" as never,
    {
      p_site_id: siteId,
      p_budget: budget,
    } as never,
  );
  if (error) throw error;
}

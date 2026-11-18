import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export async function requireFinanceRouteAccess() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw redirect({ to: "/auth" });

  const [{ data: roles }, { data: companyRoles }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("form_role_assignments").select("role").eq("user_id", user.id).eq("role", "ceo"),
  ]);
  const canManageAdvances = !!roles?.some(
    ({ role }) => role === "admin" || role === "hr" || role === "accountant",
  );
  if (!canManageAdvances && !companyRoles?.length) throw redirect({ to: "/dashboard" });
  return { financeUserId: user.id, canManageAdvances };
}

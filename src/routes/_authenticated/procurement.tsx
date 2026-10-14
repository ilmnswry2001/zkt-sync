import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/procurement")({
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const [rolesResult, companyResult] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", auth.user.id),
      supabase.from("form_role_assignments").select("role").eq("user_id", auth.user.id).eq("role", "ceo"),
    ]);
    if (rolesResult.error || companyResult.error) throw redirect({ to: "/attendance" });
    const roles = new Set<string>((rolesResult.data ?? []).map((assignment) => assignment.role));
    const allowed = roles.has("admin") || roles.has("procurement_officer") || (companyResult.data?.length ?? 0) > 0;
    if (!allowed) throw redirect({ to: "/attendance" });
    throw redirect({ to: "/requests" });
  },
  head: () => ({
    meta: [
      { title: "المشتريات | منظومة زِكت" },
      { name: "description", content: "إدارة شراء طلبات المواد والمعدات وإرسالها للاستلام." },
    ],
  }),
});

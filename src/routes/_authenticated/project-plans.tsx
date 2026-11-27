import { createFileRoute, redirect } from "@tanstack/react-router";
import { ui } from "@/lib/ui-language";
import { supabase } from "@/integrations/supabase/client";
import PlanningPage from "@/components/ProjectPlansPage";

export const Route = createFileRoute("/_authenticated/project-plans")({
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.user.id);
    if (error) throw redirect({ to: "/attendance" });
    const roles = new Set<string>((data ?? []).map((row) => row.role));
    if (
      !["admin", "hr", "supervisor", "department_manager", "engineer", "site_admin"].some((role) =>
        roles.has(role),
      )
    )
      throw redirect({ to: "/attendance" });
  },
  head: () => ({
    meta: [
      { title: ui("خطط المشاريع") },
      {
        name: "description",
        content: "إنشاء مواقع العمل وتحديد كود التكلفة CTR لكل موقع وربط الموظفين به.",
      },
      { property: "og:title", content: "خطط المشاريع" },
      { property: "og:description", content: "إدارة طلبات خطط المشاريع واعتمادها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanningPage,
});

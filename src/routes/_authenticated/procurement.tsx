import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MaterialRequestWorkflow } from "@/components/material-requests/MaterialRequestWorkflow";

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
  },
  head: () => ({
    meta: [
      { title: "المشتريات | منظومة زِكت" },
      { name: "description", content: "إدارة شراء طلبات المواد والمعدات وإرسالها للاستلام." },
    ],
  }),
  component: ProcurementPage,
});

function ProcurementPage() {
  return (
    <div dir="rtl" className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">دورة طلبات المواد والمعدات</p>
          <h1 className="mt-1 text-2xl font-bold">المشتريات</h1>
        </div>
      </header>
      <MaterialRequestWorkflow stage="procurement" />
    </div>
  );
}

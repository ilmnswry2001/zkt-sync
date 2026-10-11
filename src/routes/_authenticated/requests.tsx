import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MaterialRequestWorkflow } from "@/components/material-requests/MaterialRequestWorkflow";
import { canAccessMaterialRequests } from "@/lib/material-requests-domain";

export const Route = createFileRoute("/_authenticated/requests" as never)({
  beforeLoad: async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw redirect({ to: "/auth" });
    const [rolesResult, companyResult] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", auth.user.id),
      supabase
        .from("form_role_assignments")
        .select("role")
        .eq("user_id", auth.user.id)
        .eq("role", "ceo"),
    ]);
    if (rolesResult.error || companyResult.error) throw redirect({ to: "/attendance" });
    const roles = (rolesResult.data ?? []).map((row) => row.role);
    const companyManager = (companyResult.data ?? []).length > 0;
    if (!canAccessMaterialRequests(roles, companyManager)) throw redirect({ to: "/attendance" });
  },
  head: () => ({
    meta: [
      { title: "الطلبات — مواد ومعدات" },
      { name: "description", content: "إنشاء ومتابعة طلبات المواد والمعدات بحسب صلاحية الحساب." },
    ],
  }),
  component: RequestsPage,
});

function RequestsPage() {
  return (
    <div dir="rtl" className="space-y-5">
      <header className="border-b pb-4">
        <p className="text-xs font-semibold text-muted-foreground">دورة طلبات المواد والمعدات</p>
        <h1 className="mt-1 text-2xl font-bold">الطلبات</h1>
      </header>
      <MaterialRequestWorkflow stage="requests" />
    </div>
  );
}

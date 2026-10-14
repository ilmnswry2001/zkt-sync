import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { ClipboardList } from "lucide-react";
import { MaterialRequestWorkflow } from "@/components/material-requests/MaterialRequestWorkflow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

type RequestStage = "planning" | "warehouse" | "procurement";
const ProjectPlansView = lazy(() =>
  import("./project-plans").then(({ PlanningPage }) => ({ default: PlanningPage })),
);

export const Route = createFileRoute("/_authenticated/requests")({
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
    const roles = new Set<string>((rolesResult.data ?? []).map((assignment) => assignment.role));
    const canAccess =
      (companyResult.data?.length ?? 0) > 0 ||
      [
        "admin",
        "hr",
        "supervisor",
        "department_manager",
        "engineer",
        "site_admin",
        "planning_officer",
        "warehouse_keeper",
        "procurement_officer",
      ].some((role) => roles.has(role));
    if (!canAccess) throw redirect({ to: "/attendance" });
  },
  head: () => ({
    meta: [
      { title: "الطلبات | منظومة زِكت" },
      { name: "description", content: "طلبات المواد والمعدات وخطط المشاريع." },
    ],
  }),
  component: RequestsPage,
});

function RequestsPage() {
  const { roles, isAdmin, isHR, isCompanyManager } = useAuth();
  const [stage, setStage] = useState<RequestStage>("planning");
  const canPlan =
    isAdmin ||
    isHR ||
    isCompanyManager ||
    roles.some((role) =>
      [
        "engineer",
        "department_manager",
        "supervisor",
        "site_admin",
        "planning_officer",
      ].includes(role),
    );
  const canUseWarehouse = isAdmin || isCompanyManager || roles.includes("warehouse_keeper");
  const canUseProcurement = isAdmin || isCompanyManager || roles.includes("procurement_officer");
  const canViewPlans =
    isAdmin ||
    isHR ||
    isCompanyManager ||
    roles.some((role) =>
      ["supervisor", "department_manager", "engineer", "site_admin"].includes(role),
    );
  const availableStages: RequestStage[] = [
    ...(canPlan ? (["planning"] as const) : []),
    ...(canUseWarehouse ? (["warehouse"] as const) : []),
    ...(canUseProcurement ? (["procurement"] as const) : []),
  ];

  const activeStage = availableStages.includes(stage) ? stage : (availableStages[0] ?? "planning");

  return (
    <div dir="rtl" className="space-y-5">
      <header className="flex flex-wrap items-end gap-3 border-b pb-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold text-muted-foreground">المواد والمعدات وخطط المشاريع</p>
          <h1 className="mt-1 text-2xl font-bold">الطلبات</h1>
        </div>
      </header>

      <Tabs defaultValue="materials" dir="rtl">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="materials">طلبات المواد</TabsTrigger>
          <TabsTrigger value="equipment">طلبات المعدات</TabsTrigger>
          {canViewPlans && <TabsTrigger value="plans">الخطط</TabsTrigger>}
        </TabsList>
        {(["materials", "equipment"] as const).map((requestType) => (
          <TabsContent key={requestType} value={requestType} className="space-y-4">
            {availableStages.length > 1 && (
              <Tabs value={activeStage} onValueChange={(value) => setStage(value as RequestStage)} dir="rtl">
                <TabsList>
                  {canPlan && <TabsTrigger value="planning">التخطيط</TabsTrigger>}
                  {canUseWarehouse && <TabsTrigger value="warehouse">المخازن والاستلام</TabsTrigger>}
                  {canUseProcurement && <TabsTrigger value="procurement">المشتريات</TabsTrigger>}
                </TabsList>
              </Tabs>
            )}
            <MaterialRequestWorkflow
              key={`${requestType}-${activeStage}`}
              stage={activeStage}
              requestType={requestType === "materials" ? "material" : "equipment"}
            />
          </TabsContent>
        ))}
        {canViewPlans && (
          <TabsContent value="plans">
            <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">جارٍ تحميل الخطط...</p>}>
              <ProjectPlansView />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
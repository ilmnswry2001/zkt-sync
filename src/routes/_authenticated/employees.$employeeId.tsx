import { ui } from "@/lib/ui-language";
import { createFileRoute } from "@tanstack/react-router";
import { EmployeeProfileContent } from "@/components/EmployeeProfileContent";

export const Route = createFileRoute("/_authenticated/employees/$employeeId")({
  head: () => ({ meta: [{ title: ui("ملف الموظف") }] }),
  component: EmployeeProfilePage,
});

function EmployeeProfilePage() {
  const { employeeId } = Route.useParams();
  return <EmployeeProfileContent employeeId={employeeId} />;
}

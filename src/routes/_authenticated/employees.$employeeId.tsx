import { createFileRoute } from "@tanstack/react-router";
import { EmployeeProfileContent } from "@/components/EmployeeProfileContent";

export const Route = createFileRoute("/_authenticated/employees/$employeeId")({
  head: () => ({ meta: [{ title: "ملف الموظف" }] }),
  component: () => <EmployeeProfileContent employeeId={Route.useParams().employeeId} />,
});

import { createFileRoute } from "@tanstack/react-router";
import { ElectronicFormsWorkspace } from "@/components/ElectronicFormsWorkspace";
export const Route = createFileRoute("/_authenticated/forms/submissions/$id")({
  component: Submission,
});
function Submission() {
  const { id } = Route.useParams();
  return <ElectronicFormsWorkspace submissionId={id} />;
}

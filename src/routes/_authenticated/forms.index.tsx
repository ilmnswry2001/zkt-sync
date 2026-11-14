import { createFileRoute } from "@tanstack/react-router";
import { ElectronicFormsWorkspace } from "@/components/ElectronicFormsWorkspace";
export const Route = createFileRoute("/_authenticated/forms/")({
  component: ElectronicFormsWorkspace,
});

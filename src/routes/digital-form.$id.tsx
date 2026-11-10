import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { certificationDb, type Template } from "@/lib/certification-center";
import { CertificationFormsDialog } from "@/components/CertificationFormsDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/digital-form/$id")({
  ssr: false,
  beforeLoad: async ({ params }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { form: params.id } });
    return { employeeUser: data.user.id };
  },
  component: FillForm,
});
function FillForm() {
  const { id } = Route.useParams();
  const { employeeUser } = Route.useRouteContext();
  const [sent, setSent] = useState(false);
  const template = useQuery({
    queryKey: ["digital-form", id, employeeUser],
    queryFn: async () => {
      const { data, error } = await certificationDb
        .from("digital_form_templates")
        .select("*")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle<Template>();
      if (error) throw error;
      return data;
    },
  });
  const send = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("employee_id")
        .eq("id", employeeUser)
        .single();
      if (error || !data?.employee_id) throw Error("تعذر تحديد ملف الموظف المرتبط بحسابك");
      const result = await certificationDb
        .from("digital_form_submissions")
        .insert({ template_id: id, employee_id: data.employee_id, form_data: values });
      if (result.error) throw Error(result.error.message);
    },
    onSuccess: () => setSent(true),
    onError: (e) => toast.error(e.message),
  });
  return (
    <main dir="rtl" className="mx-auto max-w-xl p-8">
      {sent ? (
        "تم إرسال الاستمارة للمراجعة"
      ) : template.isPending ? (
        "جارٍ تحميل الاستمارة…"
      ) : template.error ? (
        "تعذر تحميل الاستمارة"
      ) : !template.data ? (
        "هذه الاستمارة غير متاحة"
      ) : (
        <CertificationFormsDialog
          mode="fill"
          selected={template.data}
          templates={[]}
          close={() => window.location.assign("/profile")}
          busy={send.isPending}
          submit={(v) => send.mutate(v)}
        />
      )}
    </main>
  );
}

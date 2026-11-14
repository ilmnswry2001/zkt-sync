import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Award, CheckCircle2, Clock3, FileText, QrCode } from "lucide-react";
import { toast } from "sonner";
import { CertificationFormsDialog } from "@/components/CertificationFormsDialog";
import { StatCard } from "@/components/CertificationStatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { certificationDb as db, copyForm, loadFormsCenter } from "@/lib/certification-center";

export const Route = createFileRoute("/_authenticated/form-center")({
  head: () => ({ meta: [{ title: "النماذج السابقة — الموارد البشرية" }] }),
  component: FormsCenter,
});

function FormsCenter() {
  const { user, isHR, isCompanyManager } = useAuth();
  const canManage = isHR || isCompanyManager;
  const center = useQuery({
    queryKey: ["forms-center", user?.id],
    queryFn: loadFormsCenter,
    enabled: !!user,
  });
  const { templates = [], submissions = [] } = center.data ?? {};
  const [dialog, setDialog] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const selected = templates.find((t) => t.id === selectedTemplate);
  function close() {
    setDialog("");
  }
  async function save(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    after?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await action();
      if (error) throw Error(error.message);
      after?.();
      await center.refetch();
      toast.success("تم الحفظ");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }
  function handleSubmissionDecision(id: string, status: string) {
    void save(() =>
      db
        .from("digital_form_submissions")
        .update({ status, reviewer_id: user?.id, reviewed_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending_review")
        .select("id")
        .single(),
    );
  }
  if (center.error)
    return (
      <Card dir="rtl" className="p-6">
        تعذر تحميل النماذج السابقة <Button onClick={() => center.refetch()}>إعادة المحاولة</Button>
      </Card>
    );
  if (!center.data)
    return (
      <p dir="rtl" className="p-6">
        جارٍ تحميل النماذج السابقة…
      </p>
    );
  return (
    <main dir="rtl" className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">النماذج السابقة</h1>
        <Button variant="outline" onClick={() => setDialog("quick")}>
          <QrCode className="ml-2 h-4 w-4" />
          رابط النموذج السريع
        </Button>
      </header>
      {isHR && <Button onClick={() => setDialog("new")}>+ إضافة نوع استمارة جديدة</Button>}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="إجمالي القوالب"
          value={templates.length}
          icon={FileText}
          tone="bg-sky-600"
        />
        <StatCard
          title="قيد المراجعة"
          value={submissions.filter((row) => row.status === "pending_review").length}
          icon={Clock3}
          tone="bg-amber-500"
        />
        <StatCard
          title="معتمدة"
          value={submissions.filter((row) => row.status === "approved").length}
          icon={CheckCircle2}
          tone="bg-emerald-600"
        />
        <StatCard
          title="نسبة الإنجاز"
          value={
            Math.round(
              (100 * submissions.filter((s) => s.status !== "pending_review").length) /
                (submissions.length || 1),
            ) + "%"
          }
          icon={Award}
          tone="bg-violet-600"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>قوالب النماذج الرقمية</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!templates.length && <p>لا توجد قوالب نشطة.</p>}
            {templates.map((template) => (
              <div key={template.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{template.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {template.category} · {template.target_audience}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedTemplate(template.id)}
                  >
                    اختر
                  </Button>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>توليد رابط النموذج</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted/30 p-4 text-sm">
              <p className="font-semibold">النموذج المختار</p>
              <p className="mt-2">{selected?.title ?? "اختر استمارة"}</p>
            </div>
            <Button
              disabled={!selected}
              onClick={() => copyForm(selectedTemplate)}
              className="w-full"
            >
              <QrCode className="ml-2 h-4 w-4" /> إنشاء رابط مباشر
            </Button>
            <Button
              disabled={!selected}
              onClick={() => setDialog("qr")}
              className="w-full"
              variant="outline"
            >
              <QrCode className="ml-2 h-4 w-4" /> إنشاء رمز QR
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>طلبات المراجعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!submissions.length && <p>لا توجد استمارات مرسلة للمراجعة.</p>}
          {submissions.map((submission) => (
            <div key={submission.id} className="rounded-xl border p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold">{submission.employee_name}</p>
                  <dl>
                    {Object.entries(submission.form_data ?? {}).map(([key, v]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    {submission.template} · {submission.submitted_at}
                  </p>
                </div>
                <Badge
                  className={
                    submission.status === "rejected"
                      ? "bg-destructive text-destructive-foreground"
                      : undefined
                  }
                >
                  {(
                    {
                      pending_review: "قيد المراجعة",
                      approved: "معتمدة",
                      rejected: "مرفوضة",
                    } as Record<string, string>
                  )[submission.status] ?? submission.status}
                </Badge>
              </div>
              {canManage && submission.status === "pending_review" && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleSubmissionDecision(submission.id, "approved")}
                  >
                    اعتماد
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSubmissionDecision(submission.id, "rejected")}
                  >
                    رفض
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <CertificationFormsDialog
        mode={dialog}
        busy={busy}
        selected={selected}
        templates={templates}
        close={close}
        saveTemplate={(values) =>
          void save(() => db.from("digital_form_templates").insert(values as never), close)
        }
      />
    </main>
  );
}

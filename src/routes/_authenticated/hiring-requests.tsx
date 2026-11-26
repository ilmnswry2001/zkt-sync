import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { direction, displayLocale, ui } from "@/lib/ui-language";

export const Route = createFileRoute("/_authenticated/hiring-requests")({
  component: HiringRequestsPage,
});

const pageSize = 15;
type HiringRequest = { id: string; candidate_name: string; phone: string; job_title: string; created_at: string };
type RequestPage = { total: number; rows: HiringRequest[] };

function HiringRequestsPage() {
  const { user, isHR, loading, permissionsLoading, canAccessSection } = useAuth();
  if (loading || permissionsLoading) return <p role="status">{ui("جارٍ التحميل")}</p>;
  if (!user || !isHR || !canAccessSection("/hiring-requests")) {
    return <p role="alert">{ui("ليس لديك صلاحية الوصول إلى هذا القسم.")}</p>;
  }
  return <HiringRequests key={user.id} userId={user.id} />;
}

function HiringRequests({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phoneError, setPhoneError] = useState(false);
  const [page, setPage] = useState(0);
  const client = useQueryClient();
  const requests = useQuery({
    queryKey: ["hiring-requests", userId, page],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("list_hiring_requests" as never, { p_offset: page * pageSize } as never).abortSignal(signal);
      if (error) throw error;
      return data as RequestPage;
    },
  });
  const submitRequest = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("submit_hiring_request" as never, {
        p_name: name.trim(), p_phone: phone, p_job_title: jobTitle.trim(),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      setName(""); setPhone(""); setJobTitle(""); setPage(0);
      void client.invalidateQueries({ queryKey: ["hiring-requests", userId] });
      toast.success(ui("تم تسجيل طلب التعيين."));
    },
    onError: () => toast.error(ui("تعذر تسجيل طلب التعيين.")),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitRequest.isPending) return;
    const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
    const normalizedPhone = phone.replace(/[٠-٩۰-۹]/g, (digit) => String(digits.indexOf(digit) % 10)).replace(/[\s()-]/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(normalizedPhone)) {
      setPhoneError(true);
      return;
    }
    submitRequest.mutate();
  };

  const dateFormat = new Intl.DateTimeFormat(displayLocale(), { dateStyle: "medium", timeZone: "Asia/Baghdad" });

  return <section aria-labelledby="hiring-requests-heading" dir={direction()} className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5 sm:p-7">
      <div className="rounded-xl bg-primary/10 p-3 text-primary"><UserPlus aria-hidden className="size-6" /></div>
      <div className="space-y-1">
        <h1 id="hiring-requests-heading" className="text-2xl font-bold">{ui("طلبات التعيين")}</h1>
        <p className="text-sm text-muted-foreground">{ui("سجّل بيانات المتقدم للوظيفة وراجع الطلبات المسجلة.")}</p>
      </div>
    </header>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>{ui("طلب تعيين جديد")}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <fieldset disabled={submitRequest.isPending} className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
                <Label htmlFor="candidate-name">{ui("اسم المتقدم الكامل")}</Label>
                <Input id="candidate-name" autoComplete="off" minLength={2} maxLength={160} required
                  value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <Label htmlFor="candidate-phone">{ui("رقم الهاتف")}</Label>
                <Input id="candidate-phone" type="tel" inputMode="tel" dir="ltr" maxLength={30} required
                  aria-invalid={phoneError} aria-describedby={phoneError ? "candidate-phone-error" : undefined}
                  value={phone} onChange={(event) => { setPhone(event.target.value); setPhoneError(false); }} />
                {phoneError && <p id="candidate-phone-error" role="alert" className="text-sm text-destructive">{ui("أدخل رقم هاتف من 7 إلى 15 رقمًا.")}</p>}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <Label htmlFor="candidate-job">{ui("الصفة الوظيفية")}</Label>
                <Input id="candidate-job" minLength={2} maxLength={120} required
                  value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
              </div>
              <Button type="submit" className="w-full sm:col-span-2 sm:w-fit" disabled={name.trim().length < 2 || jobTitle.trim().length < 2 || !phone.trim()}>
                <UserPlus aria-hidden />{ui(submitRequest.isPending ? "جارٍ الحفظ…" : "تسجيل الطلب")}
              </Button>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <MetricCard title={ui("إجمالي طلبات التعيين")} value={requests.data?.total ?? "—"} loading={requests.isPending} icon={ClipboardList} />
    </div>

    <Card>
      <CardHeader><CardTitle>{ui("الطلبات المسجلة")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {requests.isPending ? <p role="status" className="text-sm text-muted-foreground">{ui("جارٍ التحميل")}</p>
          : requests.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
            {ui("تعذر تحميل النتائج.")}<Button variant="outline" size="sm" onClick={() => void requests.refetch()}>{ui("إعادة المحاولة")}</Button>
          </div>
          : !requests.data?.rows.length ? <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{ui("لا توجد طلبات تعيين مسجلة.")}</p>
          : <ul className="divide-y rounded-xl border">
            {requests.data.rows.map((request) => <li key={request.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0 space-y-1">
                <p className="break-words font-semibold">{request.candidate_name}</p>
                <p className="break-words text-sm text-muted-foreground">{request.job_title}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a className="font-medium text-primary hover:underline" dir="ltr" href={`tel:${request.phone}`}>{request.phone}</a>
                <time dateTime={request.created_at} className="text-muted-foreground">{dateFormat.format(new Date(request.created_at))}</time>
              </div>
            </li>)}
          </ul>}
        {!requests.isError && (page > 0 || (requests.data?.total ?? 0) > pageSize) && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{ui("السابق")}</Button>
          <Button variant="outline" size="sm" disabled={(requests.data?.total ?? 0) <= (page + 1) * pageSize} onClick={() => setPage(page + 1)}>{ui("التالي")}</Button>
        </div>}
      </CardContent>
    </Card>
  </section>;
}

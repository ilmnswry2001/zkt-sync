import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Paperclip, Plus, UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { direction, displayLocale, ui } from "@/lib/ui-language";

export const Route = createFileRoute("/_authenticated/hiring-requests")({
  component: HiringRequestsPage,
});

const pageSize = 15;
type HiringStatus = "pending" | "hired" | "rejected";
type Decision = { id: string; name: string; status: Exclude<HiringStatus, "pending"> };
const statusLabels: Record<HiringStatus, string> = { pending: "قيد المراجعة", hired: "تم التعيين", rejected: "مرفوض" };
type HiringRequest = { id: string; candidate_name: string; phone: string; job_title: string; created_at: string; status: HiringStatus };
type HiringDetails = HiringRequest & { details: string; has_passport: boolean; certificates: string[] };
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [details, setDetails] = useState("");
  const [passport, setPassport] = useState(false);
  const [certificates, setCertificates] = useState<string[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
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
      const { data, error } = await supabase.rpc("save_hiring_request" as never, {
        p_id: editingId, p_name: name.trim(), p_phone: phone, p_job_title: jobTitle.trim(),
        p_details: details, p_has_passport: passport, p_certificates: certificates.map((value) => value.trim()),
      } as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      if (!editingId) setPage(0);
      setEditingId(id);
      void client.invalidateQueries({ queryKey: ["hiring-requests", userId] });
      toast.success(ui(editingId ? "تم تحديث طلب التعيين." : "تم تسجيل طلب التعيين."));
    },
    onError: () => toast.error(ui("تعذر تسجيل طلب التعيين.")),
  });

  const decide = useMutation({
    mutationFn: async (selected: Decision) => {
      const { error } = await supabase.rpc("decide_hiring_request" as never, { p_id: selected.id, p_status: selected.status } as never);
      if (error) throw error;
    },
    onSuccess: (_, selected) => {
      setDecision(null);
      void client.invalidateQueries({ queryKey: ["hiring-requests", userId] });
      toast.success(ui(statusLabels[selected.status]));
    },
    onError: (error) => {
      if ((error as { code?: string }).code === "40001") {
        setDecision(null);
        void client.invalidateQueries({ queryKey: ["hiring-requests", userId] });
        toast.error(ui("تم البت في الطلب مسبقًا."));
      } else toast.error(ui("تعذر حفظ القرار."));
    },
  });

  const newRequest = () => {
    setEditingId(null); setName(""); setPhone(""); setJobTitle(""); setDetails(""); setPassport(false);
    setCertificates([]); setPhoneError(false);
  };

  const openRequest = async (id: string) => {
    if (loadingDetails || submitRequest.isPending) return;
    setLoadingDetails(true);
    try {
      const { data, error } = await supabase.rpc("get_hiring_request" as never, { p_id: id } as never);
      if (error || !data) throw error ?? new Error("Request unavailable");
      const record = data as HiringDetails;
      setEditingId(id); setName(record.candidate_name); setPhone(record.phone); setJobTitle(record.job_title);
      setDetails(record.details); setPassport(record.has_passport); setCertificates(record.certificates); setPhoneError(false);
      document.getElementById("hiring-editor")?.scrollIntoView({ block: "start" });
    } catch {
      toast.error(ui("تعذر فتح طلب التعيين."));
    } finally {
      setLoadingDetails(false);
    }
  };

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
        <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
          <CardTitle>{ui(editingId ? "تعديل طلب التعيين" : "طلب تعيين جديد")}</CardTitle>
          {editingId && <Button type="button" size="sm" variant="outline" disabled={loadingDetails || submitRequest.isPending} onClick={newRequest}>
            <Plus aria-hidden />{ui("طلب تعيين جديد")}
          </Button>}
        </CardHeader>
        <CardContent>
          <form id="hiring-editor" className="scroll-mt-20" onSubmit={submit}>
            <fieldset disabled={submitRequest.isPending || loadingDetails} className="grid min-w-0 gap-5 sm:grid-cols-2">
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
              <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
                <Label htmlFor="candidate-details">{ui("التفاصيل")}</Label>
                <Textarea id="candidate-details" maxLength={4000} value={details} onChange={(event) => setDetails(event.target.value)} />
              </div>
              <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={passport} onChange={(event) => setPassport(event.target.checked)} />
                  {ui("يمتلك جواز سفر")}
                </label>
                <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                  <input type="checkbox" className="size-4 accent-primary" checked={certificates.length > 0}
                    onChange={(event) => setCertificates(event.target.checked ? [""] : [])} />
                  {ui("يمتلك شهادة")}
                </label>
              </div>
              {certificates.length > 0 && <div className="flex min-w-0 flex-col gap-3 sm:col-span-2">
                {certificates.map((certificate, index) => <div key={index} className="flex flex-col gap-2">
                  <Label htmlFor={`hiring-certificate-${index}`}>{ui("اسم الشهادة")} {index + 1}</Label>
                  <div className="flex items-center gap-2">
                    <Input id={`hiring-certificate-${index}`} maxLength={120} required value={certificate}
                      onChange={(event) => setCertificates((items) => items.map((item, i) => i === index ? event.target.value : item))} />
                    <Button type="button" size="icon" variant="ghost" aria-label={ui("حذف الشهادة")}
                      onClick={() => setCertificates((items) => items.filter((_, i) => i !== index))}><X /></Button>
                  </div>
                </div>)}
                <Button type="button" size="sm" variant="outline" className="self-start" disabled={certificates.length >= 20}
                  onClick={() => setCertificates((items) => [...items, ""])}><Plus />{ui("إضافة شهادة")}</Button>
              </div>}
              <Button type="submit" className="w-full sm:col-span-2 sm:w-fit"
                disabled={name.trim().length < 2 || jobTitle.trim().length < 2 || !phone.trim() || certificates.some((value) => !value.trim())}>
                <UserPlus aria-hidden />{ui(submitRequest.isPending ? "جارٍ الحفظ…" : editingId ? "حفظ التعديلات" : "تسجيل الطلب")}
              </Button>
            </fieldset>
          </form>
          {editingId ? <HiringAttachments key={editingId} id={editingId} userId={userId} />
            : <p className="mt-4 text-sm text-muted-foreground">{ui("احفظ الطلب أولًا لإرفاق الصور أو الاستمارات.")}</p>}
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
            {requests.data.rows.map((request) => <li key={request.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold">{request.candidate_name}</p>
                  <Badge variant={request.status === "rejected" ? "destructive" : request.status === "hired" ? "default" : "secondary"}>
                    {ui(statusLabels[request.status ?? "pending"])}
                  </Badge>
                </div>
                <p className="break-words text-sm text-muted-foreground">{request.job_title}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a className="font-medium text-primary hover:underline" dir="ltr" href={`tel:${request.phone}`}>{request.phone}</a>
                <time dateTime={request.created_at} className="text-muted-foreground">{dateFormat.format(new Date(request.created_at))}</time>
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button size="sm" variant="outline" disabled={loadingDetails || submitRequest.isPending}
                  onClick={() => void openRequest(request.id)}>{ui("تعديل الطلب")}</Button>
                {(request.status ?? "pending") === "pending" && <>
                  <Button size="sm" onClick={() => setDecision({ id: request.id, name: request.candidate_name, status: "hired" })}>{ui("تعيين")}</Button>
                  <Button size="sm" variant="outline" className="text-destructive"
                    onClick={() => setDecision({ id: request.id, name: request.candidate_name, status: "rejected" })}>{ui("رفض")}</Button>
                </>}
              </div>
            </li>)}
          </ul>}
        {!requests.isError && (page > 0 || (requests.data?.total ?? 0) > pageSize) && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{ui("السابق")}</Button>
          <Button variant="outline" size="sm" disabled={(requests.data?.total ?? 0) <= (page + 1) * pageSize} onClick={() => setPage(page + 1)}>{ui("التالي")}</Button>
        </div>}
      </CardContent>
    </Card>
    <AlertDialog open={!!decision} onOpenChange={(open) => { if (!open && !decide.isPending) setDecision(null); }}>
      <AlertDialogContent dir={direction()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{ui(decision?.status === "hired" ? "تأكيد التعيين" : "تأكيد الرفض")}</AlertDialogTitle>
          <AlertDialogDescription>{decision?.name}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={decide.isPending}>{ui("إلغاء")}</AlertDialogCancel>
          <Button disabled={!decision || decide.isPending} variant={decision?.status === "rejected" ? "destructive" : "default"}
            onClick={() => { if (decision) decide.mutate(decision); }}>
            {ui(decide.isPending ? "جارٍ الحفظ…" : "تأكيد القرار")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

const bucket = "hiring-request-files";
const fileTypes: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function attachmentName(key: string) {
  const encoded = key.slice(37).split(".")[0];
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))) || key;
  } catch {
    return key;
  }
}

function HiringAttachments({ id, userId }: { id: string; userId: string }) {
  const [page, setPage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const client = useQueryClient();
  const prefix = ["hiring-attachments", userId, id];
  const files = useQuery({
    queryKey: [...prefix, page],
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).list(id, {
        offset: page * pageSize, limit: pageSize + 1, sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw error;
      return data;
    },
  });

  const upload = async (selected: File[]) => {
    if (!selected.length || uploading) return;
    if (selected.length > 10 || selected.some((file) => !fileTypes[file.type] || file.size > 10 * 1024 * 1024 || !file.size)) {
      toast.error(ui("اختر حتى 10 ملفات من الأنواع المدعومة، بحجم لا يتجاوز 10 ميغابايت لكل ملف."));
      return;
    }
    setUploading(true);
    let count = 0;
    try {
      for (const file of selected) {
        const bytes = new TextEncoder().encode(Array.from(file.name).slice(0, 100).join(""));
        const label = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const key = `${crypto.randomUUID()}-${label}.${fileTypes[file.type]}`;
        const { error } = await supabase.storage.from(bucket).upload(`${id}/${key}`, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        count++;
      }
      toast.success(ui("تم رفع المرفقات."));
    } catch {
      toast.error(ui(count ? "رُفع بعض المرفقات. أعد محاولة رفع الملفات المتبقية." : "تعذر رفع المرفقات."));
    } finally {
      if (count) {
        setPage(0);
        void client.invalidateQueries({ queryKey: prefix });
      }
      setUploading(false);
    }
  };

  const download = async (key: string) => {
    setDownloading(key);
    try {
      const label = attachmentName(key);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(`${id}/${key}`, 60, { download: label });
      if (error) throw error;
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.download = label;
      link.click();
    } catch {
      toast.error(ui("تعذر تنزيل المرفق."));
    } finally {
      setDownloading(null);
    }
  };

  return <section className="mt-5 space-y-3 border-t pt-5" aria-label={ui("المرفقات")}>
    <Label htmlFor="hiring-files" className="flex items-center gap-2"><Paperclip className="size-4" />{ui("إرفاق صور أو استمارات")}</Label>
    <Input id="hiring-files" type="file" accept={Object.keys(fileTypes).join(",")} multiple disabled={uploading}
      onChange={(event) => {
        const selected = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        void upload(selected);
      }} />
    <p className="text-xs text-muted-foreground">{ui("صور JPG وPNG وWebP أو ملفات PDF وDOCX، حتى 10 ميغابايت لكل ملف.")}</p>
    {uploading && <p role="status" className="text-sm">{ui("جارٍ رفع المرفقات…")}</p>}
    {files.isPending ? <p role="status" className="text-sm text-muted-foreground">{ui("جارٍ التحميل")}</p>
      : files.isError ? <Button variant="outline" size="sm" onClick={() => void files.refetch()}>{ui("إعادة تحميل المرفقات")}</Button>
      : !!files.data?.length && <ul className="divide-y rounded-lg border">
        {files.data.slice(0, pageSize).map((file) => <li key={file.name} className="flex flex-wrap items-center justify-between gap-2 p-2">
          <span className="min-w-0 break-all text-sm">{attachmentName(file.name)}</span>
          <Button variant="outline" size="sm" disabled={!!downloading} onClick={() => void download(file.name)}>
            {ui(downloading === file.name ? "جارٍ التحميل" : "تنزيل")}
          </Button>
        </li>)}
      </ul>}
    {(page > 0 || (files.data?.length ?? 0) > pageSize) && <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>{ui("السابق")}</Button>
      <Button variant="outline" size="sm" disabled={(files.data?.length ?? 0) <= pageSize} onClick={() => setPage(page + 1)}>{ui("التالي")}</Button>
    </div>}
  </section>;
}

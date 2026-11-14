import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { certificationDb as db } from "@/lib/certification-center";
import { ElectronicFormFields } from "@/components/ElectronicFormFields";
import { printForms, type FormDocument } from "@/components/ElectronicFormDocument";
import { validate, type Values } from "../../supabase/functions/_shared/form-schema";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/f/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex,nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: PublicForm,
});
type Public = FormDocument & { prefill: Values; locked_fields: string[]; allow_print: boolean };
function PublicForm() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["public-form", token],
    queryFn: async () => {
      const r = await db.rpc("get_public_form", { token });
      if (r.error) throw r.error;
      return r.data as Public | null;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return (
    <main dir="rtl" lang="ar" className="mx-auto max-w-[640px] p-4">
      {q.isPending ? (
        "جارٍ تحميل الاستمارة…"
      ) : q.error ? (
        <Button onClick={() => q.refetch()}>تعذر الاتصال · إعادة المحاولة</Button>
      ) : q.data ? (
        <Fill key={token} token={token} form={q.data} />
      ) : (
        "الرابط غير متاح، ربما انتهت صلاحيته أو اكتمل عدد الاستمارات."
      )}
    </main>
  );
}
function Fill({ token, form }: { token: string; form: Public }) {
  const storage = "ef-draft:" + token + ":" + form.version;
  const [initial] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storage) ?? "null");
    } catch {
      return null;
    }
  });
  const [data, setData] = useState<Values>({
    ...form.prefill,
    ...initial?.data,
    ...Object.fromEntries(form.locked_fields.map((k) => [k, form.prefill[k]])),
  });
  const [request] = useState(() => initial?.request ?? crypto.randomUUID()),
    [dirty, setDirty] = useState(!!initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ref, setRef] = useState("");
  const honey = useRef<HTMLInputElement>(null),
    widget = useRef<HTMLDivElement>(null),
    challenge = useRef("");
  const captcha = () =>
    (
      window as Window & {
        turnstile?: {
          render: (el: HTMLElement, opts: Record<string, unknown>) => string;
          reset: (el: HTMLElement) => void;
        };
      }
    ).turnstile;
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!key || !widget.current || ref) return;
    const host = widget.current;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => {
      if (host.isConnected)
        captcha()?.render(host, {
          sitekey: key,
          callback: (v: string) => (challenge.current = v),
          "expired-callback": () => (challenge.current = ""),
        });
    };
    document.head.append(script);
    return () => {
      script.remove();
    };
  }, [key, ref]);
  useEffect(() => {
    if (!dirty || ref) return;
    try {
      localStorage.setItem(storage, JSON.stringify({ data, request }));
    } catch {}
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [data, dirty, ref, storage, request]);
  return (
    <>
      <header
        className="mb-5 border-b-2 py-4"
        style={{ borderColor: form.branding.brand_primary_color ?? undefined }}
      >
        {form.branding.logo_url && (
          <img src={form.branding.logo_url} alt="" className="h-14 object-contain" />
        )}
        <strong>{form.branding.company_name_ar}</strong>
        <p>{form.branding.company_name_en}</p>
        <h1 className="text-2xl font-bold">{form.title_ar}</h1>
      </header>
      {ref ? (
        <section>
          <h2>شكراً، تم إرسال الاستمارة للمراجعة</h2>
          <p dir="ltr">{ref}</p>
          {form.allow_print && (
            <Button onClick={() => printForms([{ ...form, data, reference_code: ref }])}>
              طباعة / حفظ PDF
            </Button>
          )}
        </section>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setError("");
            setBusy(true);
            try {
              if (!navigator.onLine) throw Error("أعد الاتصال بالإنترنت ثم أرسل المسودة");
              const clean = validate(form.schema, data, form.prefill, form.locked_fields);
              if (key && !challenge.current) throw Error("أكمل التحقق أولاً");
              const response = await fetch("/api/public/submit-form", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  token,
                  version: form.version,
                  data: clean,
                  request_id: request,
                  website: honey.current?.value,
                  challenge: challenge.current,
                }),
              });
              const result = await response.json().catch(() => null);
              if (
                !response.ok ||
                typeof result?.reference_code !== "string" ||
                !result.reference_code
              )
                throw Error(result?.error ?? "تعذر تأكيد حفظ الاستمارة، حاول مرة أخرى");
              setRef(result.reference_code);
              setData(clean);
              try {
                localStorage.removeItem(storage);
              } catch {}
            } catch (err) {
              setError((err as Error).message);
              if (key && widget.current) captcha()?.reset(widget.current);
            } finally {
              setBusy(false);
            }
          }}
        >
          <ElectronicFormFields
            schema={form.schema}
            data={data}
            locked={form.locked_fields}
            change={(v) => {
              setData(v);
              setDirty(true);
            }}
          />
          <input hidden tabIndex={-1} autoComplete="off" ref={honey} aria-hidden="true" />
          <div ref={widget} />
          <div className="sticky bottom-0 mt-4 border-t bg-background py-3">
            {error && <p role="alert">{error}</p>}
            <Button disabled={busy} className="min-h-12 w-full">
              {busy ? "جارٍ الإرسال…" : "إرسال الاستمارة"}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

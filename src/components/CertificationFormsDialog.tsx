import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Template } from "@/lib/certification-center";
import { toast } from "sonner";

import { copyForm, formUrl } from "@/lib/certification-center";
export function CertificationFormsDialog({
  mode,
  close,
  templates,
  selected,
  saveTemplate,
  submit,
  busy,
}: {
  mode: string;
  close: () => void;
  templates: Template[];
  selected?: Template;
  busy: boolean;
  saveTemplate?: (data: Record<string, string>) => void;
  submit?: (data: Record<string, string>) => void;
}) {
  const qr = useRef<SVGSVGElement>(null);
  const fields = selected?.fields_schema?.length
    ? selected.fields_schema
    : [{ name: "details", label: "التفاصيل", type: "textarea" }];
  return (
    <Dialog
      open={!!mode}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent dir="rtl">
        <DialogTitle>
          {mode === "quick"
            ? "روابط الاستمارات النشطة"
            : mode === "new"
              ? "إضافة نوع استمارة جديدة"
              : (selected?.title ?? "الاستمارة غير متاحة")}
        </DialogTitle>
        {mode === "quick" && (
          <div className="grid gap-3">
            {templates.length
              ? templates.map((t) => (
                  <div className="flex items-center justify-between border p-2" key={t.id}>
                    <a className="underline" href={formUrl(t.id)}>
                      {t.title}
                    </a>
                    <Button onClick={() => copyForm(t.id)}>نسخ الرابط</Button>
                  </div>
                ))
              : "لا توجد استمارات نشطة"}
          </div>
        )}
        {mode === "qr" && selected && (
          <>
            <QRCodeSVG
              ref={qr}
              value={formUrl(selected.id)}
              size={240}
              marginSize={4}
              className="mx-auto"
            />
            <Button onClick={() => copyForm(selected.id)}>نسخ الرابط</Button>
            <Button
              onClick={() => {
                if (!qr.current) return;
                const url = URL.createObjectURL(
                  new Blob([new XMLSerializer().serializeToString(qr.current)], {
                    type: "image/svg+xml",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = selected.title + ".svg";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              تحميل الرمز
            </Button>
          </>
        )}
        {(mode === "new" || (mode === "fill" && selected)) && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(
                Array.from(new FormData(e.currentTarget), ([key, v]) => [key, String(v).trim()]),
              );
              if (Object.values(values).some((v) => !v)) return toast.error("أكمل الحقول المطلوبة");
              if (mode === "new") saveTemplate?.(values);
              else submit?.(values);
            }}
          >
            {(mode === "new"
              ? [
                  { name: "title", label: "عنوان الاستمارة", type: "text" },
                  { name: "category", label: "الفئة أو الاختصاص", type: "text" },
                  { name: "description", label: "الوصف", type: "textarea" },
                  { name: "target_audience", label: "الكوادر المستهدفة", type: "text" },
                ]
              : fields
            ).map((f) => (
              <label key={f.name}>
                {f.label}
                {f.type === "textarea" ? (
                  <textarea required name={f.name} className="w-full border p-2" />
                ) : f.options?.length ? (
                  <select name={f.name} required>
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <Input required name={f.name} />
                )}
              </label>
            ))}
            <Button disabled={busy}>{mode === "new" ? "حفظ القالب" : "إرسال للمراجعة"}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/use-auth";
import { certificationDb as db } from "@/lib/certification-center";
import { loadAllRows } from "@/lib/monthly-report";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ElectronicFormFields } from "./ElectronicFormFields";
import {
  ElectronicFormDocument,
  printForms,
  type FormDocument,
  type Brand,
} from "./ElectronicFormDocument";
import { FormTemplateEditor, newField } from "./FormTemplateEditor";
import { fields, validate, type Values } from "../../supabase/functions/_shared/form-schema";
import { toast } from "sonner";

type Template = Omit<FormDocument, "data" | "branding"> & { id: string; is_active: boolean };
type Share = {
  id: string;
  template_id: string;
  label: string;
  token: string;
  is_active: boolean;
  submissions_count: number;
};
type Submission = {
  id: string;
  reference_code: string;
  template_id: string;
  template_version: number;
  link_id: string | null;
  status: string;
  data: Values;
  created_at: string;
  review_note: string | null;
  form_template_versions: Template;
};
const statuses: Record<string, string> = {
  pending_review: "قيد المراجعة",
  approved: "معتمدة",
  rejected: "مرفوضة",
  draft: "مسودة",
};
const all = <T,>(table: string, cols = "*") =>
  loadAllRows<T>((a, b) => db.from(table).select(cols).order("id").range(a, b).returns<T[]>());
const brandFields = {
  company_name_ar: "اسم الشركة بالعربية",
  company_name_en: "اسم الشركة بالإنجليزية",
  company_subtitle_ar: "الوصف بالعربية",
  company_subtitle_en: "الوصف بالإنجليزية",
  forms_header_line_ar: "ترويسة عربية",
  forms_header_line_en: "ترويسة إنجليزية",
  brand_primary_color: "لون الهوية",
};
export function ElectronicFormsWorkspace({
  inbox = false,
  submissionId,
}: {
  inbox?: boolean;
  submissionId?: string;
}) {
  const navigate = useNavigate();
  const { isAdmin, isHR, user } = useAuth(),
    qc = useQueryClient();
  const q = useQuery({
    queryKey: ["electronic-forms", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      const [templates, links, rows, settings] = await Promise.all([
        all<Template>("form_templates"),
        isAdmin ? all<Share>("form_links") : [],
        all<Submission>(
          "form_submissions",
          "id,reference_code,template_id,template_version,link_id,status,data,created_at,review_note,form_template_versions(code,title_ar,schema,version)",
        ),
        db.from("site_settings").select("*").single(),
      ]);
      if (settings.error) throw settings.error;
      return { templates, links, rows, brand: settings.data as Brand };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["electronic-forms"] });
  useEffect(() => {
    if (!isAdmin) return;
    const ch = db
      .channel("forms-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "form_submissions" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [isAdmin, qc]);
  const [internalId, setInternalId] = useState("");
  const [mode, setMode] = useState(""),
    [tpl, setTemplate] = useState<Template | null>(null),
    [row, setSubmission] = useState<Submission | null>(null),
    [data, setData] = useState<Values>({}),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [status, setStatus] = useState("pending_review"),
    [brand, setBrand] = useState<Brand>({});
  const [label, setLabel] = useState(""),
    [locks, setLockedFields] = useState<string[]>([]),
    [max, setLimit] = useState(""),
    [expires, setExpiry] = useState(""),
    [allow, setAllowPrint] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [filter, setFilter] = useState({ text: "", status: "", date: "", template: "", link: "" });
  async function action(fn: () => Promise<void>, close = true) {
    if (busy) return;
    setBusy(true);
    try {
      if (!navigator.onLine) throw Error("أعد الاتصال بالإنترنت");
      await fn();
      await refresh();
      if (close) closeDialog();
      toast.success("تم الحفظ");
    } catch (e) {
      toast.error((e as Error).message || "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }
  async function check(query: PromiseLike<{ error: { message: string } | null }>) {
    const r = await query;
    if (r.error) throw Error(r.error.message);
  }
  const { templates = [], links = [], rows = [], brand: branding = {} } = q.data ?? {};
  function open(mode: string, t: Template | null = null, r: Submission | null = null) {
    setMode(mode);
    if (mode === "fill") setInternalId(crypto.randomUUID());
    setTemplate(t);
    setSubmission(r);
    setData(r?.data ?? {});
    setStatus(r?.status ?? "pending_review");
    setNote(r?.review_note ?? "");
    setBrand(branding);
    setLockedFields([]);
    setLabel("");
    setExpiry("");
    setLimit("");
    setAllowPrint(false);
  }
  const submission = rows.find((r) => r.id === submissionId);
  useEffect(() => {
    if (submission)
      open(
        "view",
        { ...submission.form_template_versions, id: submission.template_id },
        submission,
      );
  }, [submissionId, submission?.id]);
  function closeDialog() {
    setMode("");
    if (submissionId) void navigate({ to: isAdmin ? "/forms/inbox" : "/forms" });
  }
  function document(r: Submission): FormDocument {
    return {
      ...r.form_template_versions,
      data: r.data,
      branding,
      reference_code: r.reference_code,
    };
  }
  const filtered = rows
    .filter(
      (r) =>
        (!filter.status || r.status === filter.status) &&
        (!filter.template || r.template_id === filter.template) &&
        (!filter.link || r.link_id === filter.link) &&
        (!filter.date || r.created_at.slice(0, 10) === filter.date) &&
        JSON.stringify([r.reference_code, r.data])
          .toLowerCase()
          .includes(filter.text.toLowerCase()),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const chosen = filtered.filter((r) => selected.includes(r.id));
  const inputClass = "min-h-11 rounded border bg-background p-2";
  async function decision(v: string) {
    await action(async () => {
      await check(
        db
          .from("form_submissions")
          .update({
            status: v,
            review_note: null,
            reviewed_by: user!.id,
            reviewed_at: new Date().toISOString(),
          })
          .in(
            "id",
            chosen.map((r) => r.id),
          ),
      );
      setSelected([]);
    }, false);
  }
  if (q.isPending) return <p className="p-6">جارٍ تحميل النماذج…</p>;
  if (q.error)
    return <Button onClick={() => q.refetch()}>تعذر تحميل النماذج · إعادة المحاولة</Button>;
  if (submissionId && !submission) return <p className="p-6">الاستمارة غير متاحة.</p>;
  if (inbox && !isAdmin) return <p className="p-6">صندوق المراجعة مخصص لمدير النظام.</p>;
  return (
    <main dir="rtl" className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{inbox ? "صندوق مراجعة النماذج" : "مركز النماذج"}</h1>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button asChild variant="outline">
              <Link to={inbox ? "/forms" : "/forms/inbox"}>
                {inbox ? "القوالب" : "صندوق المراجعة"}
              </Link>
            </Button>
          )}
          {isHR && (
            <Button asChild variant="outline">
              <Link to="/form-center">النماذج السابقة</Link>
            </Button>
          )}
          {!inbox && isAdmin && (
            <>
              <Button onClick={() => open("template")}>قالب جديد</Button>
              <Button variant="outline" onClick={() => open("brand")}>
                هوية الطباعة
              </Button>
            </>
          )}
        </div>
      </header>
      {!inbox && (
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} className="space-y-3 p-4">
              <h2 className="text-lg font-bold">{t.title_ar}</h2>
              <p>
                <bdi>{t.code}</bdi> · الإصدار {t.version}
                {isAdmin && (
                  <>
                    {" "}
                    · {links.filter((l) => l.template_id === t.id).length} روابط ·{" "}
                    {
                      rows.filter((r) => r.template_id === t.id && r.status === "pending_review")
                        .length
                    }{" "}
                    قيد المراجعة
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => open("fill", t)}>تعبئة استمارة</Button>
                <Button
                  variant="outline"
                  onClick={() => printForms([{ ...t, data: {}, branding }])}
                >
                  طباعة فارغة
                </Button>
                {isAdmin && (
                  <>
                    <Button variant="outline" onClick={() => open("link", t)}>
                      الروابط
                    </Button>
                    <Button variant="outline" onClick={() => open("template", t)}>
                      تعديل القالب
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
          {!templates.length && <p>لا توجد قوالب.</p>}
        </div>
      )}
      {(inbox || !isAdmin) && (
        <Card className="space-y-3 p-4">
          <h2>{isAdmin ? "الاستمارات المرسلة" : "استماراتي"}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="بحث في الرقم أو أي حقل"
              value={filter.text}
              onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            />
            <Input
              aria-label="تاريخ الإرسال"
              type="date"
              value={filter.date}
              onChange={(e) => setFilter({ ...filter, date: e.target.value })}
            />
            {(["template", "status", "link"] as const).map((k, i) => (
              <select
                key={k}
                aria-label={k}
                className={inputClass}
                value={filter[k]}
                onChange={(e) => setFilter({ ...filter, [k]: e.target.value })}
              >
                <option value="">{["كل القوالب", "كل الحالات", "كل الروابط"][i]}</option>
                {(k === "status"
                  ? Object.entries(statuses)
                  : k === "template"
                    ? templates.map((t) => [t.id, t.title_ar])
                    : links.map((l) => [l.id, l.label || l.id])
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            ))}
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  setSelected(chosen.length === filtered.length ? [] : filtered.map((r) => r.id))
                }
              >
                تحديد الكل / إلغاء
              </Button>
              {["approved", "rejected"].map((s) => (
                <Button key={s} disabled={!chosen.length || busy} onClick={() => decision(s)}>
                  {s === "approved" ? "اعتماد" : "رفض"} المحدد
                </Button>
              ))}
              <Button disabled={!chosen.length} onClick={() => printForms(chosen.map(document))}>
                PDF
              </Button>
              {(["csv", "xlsx"] as const).map((ext) => (
                <Button
                  key={ext}
                  disabled={!chosen.length}
                  onClick={async () => {
                    const x = await import("xlsx");
                    const ws = x.utils.json_to_sheet(
                      chosen.map((r) => ({
                        المرجع: r.reference_code,
                        الحالة: statuses[r.status],
                        ...Object.fromEntries(
                          Object.entries(r.data).map(([k, v]) => [
                            k,
                            typeof v === "object" ? JSON.stringify(v) : String(v),
                          ]),
                        ),
                      })),
                    );
                    const book = x.utils.book_new();
                    x.utils.book_append_sheet(book, ws, "Forms");
                    x.writeFile(book, "forms." + ext);
                  }}
                >
                  {ext.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
          <div className="overflow-auto">
            <table className="w-full text-start">
              <thead>
                <tr>
                  {["", "المرجع", "النموذج", "الحالة", ""].map((v, i) => (
                    <th key={i}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td>
                      {isAdmin && (
                        <input
                          aria-label={r.reference_code}
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, r.id]
                                : selected.filter((id) => id !== r.id),
                            )
                          }
                        />
                      )}
                    </td>
                    <td dir="ltr">{r.reference_code}</td>
                    <td>{r.form_template_versions.title_ar}</td>
                    <td>{statuses[r.status]}</td>
                    <td>
                      <Button variant="outline" asChild>
                        <Link to="/forms/submissions/$id" params={{ id: r.id }}>
                          فتح
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <p>لا توجد استمارات مطابقة.</p>}
        </Card>
      )}
      <Dialog
        open={!!mode}
        onOpenChange={(v) => {
          if (!v && !busy) closeDialog();
        }}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogTitle>
            {
              {
                template: "تحرير قالب",
                brand: "هوية الطباعة",
                link: "روابط الاستمارة",
                fill: "تعبئة استمارة",
                view: "مراجعة الاستمارة",
              }[mode]
            }
          </DialogTitle>
          {mode === "template" && (
            <FormTemplateEditor
              initial={
                tpl ?? {
                  title_ar: "",
                  code: "",
                  version: 1,
                  schema: { sections: [{ type: "info_grid", fields: [newField()] }] },
                }
              }
              brand={branding}
              busy={busy}
              save={(v) =>
                action(async () => {
                  await check(
                    tpl
                      ? db.from("form_templates").update(v).eq("id", tpl.id)
                      : db.from("form_templates").insert(v),
                  );
                })
              }
            />
          )}
          {mode === "brand" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(brandFields).map(([k, v]) => (
                  <label key={k}>
                    {v}
                    <Input
                      type={k === "brand_primary_color" ? "color" : "text"}
                      value={brand[k as keyof Brand] ?? ""}
                      onChange={(e) => setBrand({ ...brand, [k]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label>
                شعار الشركة
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (
                      !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
                      f.size > 250000
                    )
                      return toast.error("اختر صورة بحجم أقل من 250 كيلوبايت");
                    const reader = new FileReader();
                    reader.onload = () =>
                      setBrand((v) => ({ ...v, logo_url: String(reader.result) }));
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
              {brand.logo_url && (
                <Button variant="outline" onClick={() => setBrand({ ...brand, logo_url: null })}>
                  إزالة الشعار
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await check(db.from("site_settings").update(brand).eq("id", true));
                  })
                }
              >
                حفظ الهوية
              </Button>
            </>
          )}
          {mode === "link" && tpl && (
            <>
              <label>
                اسم الرابط
                <Input value={label} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label>
                الحد الأقصى للإرسال
                <Input
                  type="number"
                  min={1}
                  value={max}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <label>
                انتهاء الصلاحية
                <Input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allow}
                  onChange={(e) => setAllowPrint(e.target.checked)}
                />{" "}
                السماح بالطباعة بعد الإرسال
              </label>
              <details>
                <summary>قيم مسبقة وقفل الحقول</summary>
                <ElectronicFormFields schema={tpl.schema} data={data} change={setData} />
                {tpl.schema.sections
                  .flatMap((s) =>
                    s.type === "repeating_table"
                      ? [{ key: s.key!, label_ar: s.title_ar }]
                      : fields(s),
                  )
                  .map((f) => (
                    <label key={f.key} className="block">
                      <input
                        type="checkbox"
                        checked={locks.includes(f.key)}
                        onChange={(e) =>
                          setLockedFields(
                            e.target.checked ? [...locks, f.key] : locks.filter((k) => k !== f.key),
                          )
                        }
                      />{" "}
                      قفل {f.label_ar}
                    </label>
                  ))}
              </details>
              <Button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    if (locks.some((k) => data[k] == null || data[k] === ""))
                      throw Error("أدخل قيمة لكل حقل مقفل");
                    await check(
                      db.from("form_links").insert({
                        template_id: tpl.id,
                        label,
                        prefill: data,
                        locked_fields: locks,
                        max_submissions: max ? Number(max) : null,
                        expires_at: expires ? new Date(expires).toISOString() : null,
                        allow_print: allow,
                      }),
                    );
                  }, false)
                }
              >
                إنشاء رابط
              </Button>
              {links
                .filter((l) => l.template_id === tpl.id)
                .map((l) => {
                  const url = location.origin + "/f/" + l.token;
                  return (
                    <Card className="space-y-2 p-3" key={l.id}>
                      <strong>{l.label || tpl.title_ar}</strong>
                      <p>
                        {l.submissions_count} استمارات · {l.is_active ? "نشط" : "متوقف"}
                      </p>
                      <QRCodeSVG value={url} size={96} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(url)
                              .then(() => toast.success("تم نسخ الرابط"))
                              .catch(() => toast.error("تعذر نسخ الرابط"))
                          }
                        >
                          نسخ الرابط
                        </Button>
                        <Button asChild variant="outline">
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={
                              "https://wa.me/?text=" +
                              encodeURIComponent("يرجى تعبئة " + tpl.title_ar + " " + url)
                            }
                          >
                            واتساب
                          </a>
                        </Button>
                        <Button
                          disabled={busy}
                          variant="outline"
                          onClick={() =>
                            action(async () => {
                              await check(
                                db
                                  .from("form_links")
                                  .update({ is_active: !l.is_active })
                                  .eq("id", l.id),
                              );
                            }, false)
                          }
                        >
                          {l.is_active ? "تعطيل" : "تفعيل"}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
            </>
          )}
          {(mode === "fill" || mode === "view") && tpl && (
            <>
              {(mode === "fill" || isAdmin) && (
                <ElectronicFormFields schema={tpl.schema} data={data} change={setData} />
              )}
              {mode === "view" && isAdmin && (
                <>
                  <label>
                    قرار المراجعة
                    <select
                      className={inputClass}
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {Object.entries(statuses).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    ملاحظة المراجعة
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {(mode === "fill" || isAdmin) && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        const clean = validate(tpl.schema, data);
                        await check(
                          row
                            ? db
                                .from("form_submissions")
                                .update({
                                  data: clean,
                                  status,
                                  review_note: note,
                                  reviewed_at: new Date().toISOString(),
                                  reviewed_by: user!.id,
                                  updated_at: new Date().toISOString(),
                                })
                                .eq("id", row.id)
                            : db.from("form_submissions").insert({
                                template_id: tpl.id,
                                id: internalId,
                                template_version: tpl.version,
                                data: clean,
                              }),
                        );
                      })
                    }
                  >
                    حفظ الاستمارة
                  </Button>
                )}
                {row && (
                  <>
                    <Button variant="outline" onClick={() => printForms([document(row)])}>
                      طباعة / حفظ PDF
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const current = templates.find((t) => t.id === tpl.id);
                        if (!current) return toast.error("القالب غير متاح");
                        open("fill", current);
                        setData(
                          Object.fromEntries(
                            current.schema.sections
                              .filter((s) => s.type === "info_grid")
                              .flatMap((s) => fields(s).map((f) => [f.key, row.data[f.key]])),
                          ),
                        );
                      }}
                    >
                      نسخ البيانات لاستمارة جديدة
                    </Button>
                  </>
                )}
              </div>
              <ElectronicFormDocument
                doc={{ ...tpl, branding, data, reference_code: row?.reference_code }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fields,
  checkSchema,
  type Field,
  type Section,
  type Schema,
} from "../../supabase/functions/_shared/form-schema";
import { ElectronicFormDocument, type Brand } from "./ElectronicFormDocument";
import "./electronic-form-print.css";
export const newField = (): Field => ({
  key: "f_" + crypto.randomUUID().slice(0, 8),
  label_ar: "حقل جديد",
  input: "text",
});
export function FormTemplateEditor({
  initial,
  brand,
  save,
  busy,
}: {
  initial: { code: string; title_ar: string; schema: Schema; version: number };
  brand: Brand;
  save: (v: { code: string; title_ar: string; schema: Schema }) => void;
  busy: boolean;
}) {
  const [doc, set] = useState(initial),
    [error, fail] = useState("");
  const sections = doc.schema.sections;
  const update = (ss: Section[]) => set({ ...doc, schema: { sections: ss } });
  function section(i: number, s: Section) {
    update(sections.map((x, j) => (i === j ? s : x)));
  }
  function move<T>(list: T[], i: number, delta: number) {
    const copy = [...list];
    [copy[i], copy[i + delta]] = [copy[i + delta], copy[i]];
    return copy;
  }
  return (
    <div className="space-y-4">
      <label>
        عنوان القالب
        <Input value={doc.title_ar} onChange={(e) => set({ ...doc, title_ar: e.target.value })} />
      </label>
      <label>
        رمز القالب
        <Input dir="ltr" value={doc.code} onChange={(e) => set({ ...doc, code: e.target.value })} />
      </label>
      {sections.map((s, i) => (
        <fieldset className="space-y-3 rounded border p-3" key={i}>
          <legend>
            {
              {
                info_grid: "بيانات",
                repeating_table: "جدول",
                text_block: "نص",
                signature: "توقيع",
              }[s.type]
            }
          </legend>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!i} onClick={() => update(move(sections, i, -1))}>
              رفع القسم
            </Button>
            <Button
              variant="outline"
              disabled={i === sections.length - 1}
              onClick={() => update(move(sections, i, 1))}
            >
              خفض القسم
            </Button>
            <Button variant="outline" onClick={() => update(sections.filter((_, j) => i !== j))}>
              حذف القسم
            </Button>
          </div>
          {s.type === "repeating_table" && (
            <>
              <label>
                عنوان الجدول
                <Input
                  value={s.title_ar ?? ""}
                  onChange={(e) => section(i, { ...s, title_ar: e.target.value })}
                />
              </label>
              {(["min_rows", "max_rows"] as const).map((k) => (
                <label key={k}>
                  {k === "min_rows" ? "صفوف الطباعة" : "الحد الأعلى"}
                  <Input
                    type="number"
                    value={s[k]}
                    onChange={(e) => section(i, { ...s, [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </>
          )}
          {s.type === "signature" || s.type === "text_block" ? (
            <Input
              aria-label="عنوان القسم"
              value={s.label_ar}
              onChange={(e) => section(i, { ...s, label_ar: e.target.value })}
            />
          ) : (
            <>
              {fields(s).map((f, j) => {
                const fs = fields(s);
                const replace = (list: Field[]) =>
                  section(i, { ...s, [s.type === "info_grid" ? "fields" : "columns"]: list });
                const patch = (p: Partial<Field>) =>
                  replace(fs.map((x, n) => (n === j ? { ...x, ...p } : x)));
                return (
                  <div className="grid gap-2 border-t pt-2 sm:grid-cols-2" key={f.key}>
                    <label>
                      اسم الحقل
                      <Input
                        value={f.label_ar}
                        onChange={(e) => patch({ label_ar: e.target.value })}
                      />
                    </label>
                    <label>
                      نوع البيانات
                      <select
                        className="block w-full border bg-background p-2"
                        value={f.input}
                        onChange={(e) => patch({ input: e.target.value as Field["input"] })}
                      >
                        {Object.entries({
                          text: "نص",
                          number: "رقم",
                          date: "تاريخ",
                          phone: "هاتف",
                          select: "قائمة",
                          textarea: "نص طويل",
                          checkbox: "تأشير",
                        }).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    {f.input === "select" && (
                      <label>
                        الخيارات مفصولة بفاصلة
                        <Input
                          value={f.options?.join(",") ?? ""}
                          onChange={(e) => patch({ options: e.target.value.split(",") })}
                        />
                      </label>
                    )}
                    {s.type === "repeating_table" && (
                      <label>
                        عرض العمود DXA
                        <Input
                          type="number"
                          value={f.width ?? 0}
                          onChange={(e) => patch({ width: Number(e.target.value) })}
                        />
                      </label>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        onChange={(e) => patch({ required: e.target.checked })}
                      />{" "}
                      مطلوب
                    </label>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        disabled={!j}
                        onClick={() => replace(move(fs, j, -1))}
                      >
                        رفع
                      </Button>
                      <Button
                        variant="outline"
                        disabled={j === fs.length - 1}
                        onClick={() => replace(move(fs, j, 1))}
                      >
                        خفض
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => replace(fs.filter((_, n) => j !== n))}
                      >
                        حذف الحقل
                      </Button>
                    </div>
                  </div>
                );
              })}
              <Button
                variant="outline"
                onClick={() =>
                  section(i, {
                    ...s,
                    [s.type === "info_grid" ? "fields" : "columns"]: [...fields(s), newField()],
                  })
                }
              >
                إضافة حقل
              </Button>
            </>
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        {(["info_grid", "repeating_table", "text_block", "signature"] as const).map((type, i) => (
          <Button
            variant="outline"
            key={type}
            onClick={() =>
              update([
                ...sections,
                type === "info_grid"
                  ? { type, fields: [newField()] }
                  : type === "repeating_table"
                    ? {
                        type,
                        key: newField().key,
                        title_ar: "الجدول",
                        columns: [{ ...newField(), width: 9766 }],
                        min_rows: 15,
                        max_rows: 30,
                      }
                    : {
                        type,
                        key: newField().key,
                        label_ar: type === "signature" ? "التوقيع" : "ملاحظات",
                      },
              ])
            }
          >
            {["إضافة بيانات", "إضافة جدول", "إضافة نص", "إضافة توقيع"][i]}
          </Button>
        ))}
      </div>
      <Button
        disabled={busy}
        onClick={() => {
          try {
            checkSchema(doc.schema);
            if (!doc.title_ar.trim() || !doc.code.trim()) throw Error("أكمل عنوان ورمز القالب");
            fail("");
            save({ code: doc.code, title_ar: doc.title_ar, schema: doc.schema });
          } catch (e) {
            fail((e as Error).message);
          }
        }}
      >
        حفظ القالب
      </Button>
      <p role="alert">{error}</p>
      <ElectronicFormDocument doc={{ ...doc, data: {}, branding: brand }} />
    </div>
  );
}

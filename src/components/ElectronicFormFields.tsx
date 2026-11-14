import {
  fields,
  latin,
  type Field,
  type Values,
  type Schema,
} from "../../supabase/functions/_shared/form-schema";
import { Button } from "@/components/ui/button";
export function ElectronicFormFields({
  schema,
  data,
  locked = [],
  change,
}: {
  schema: Schema;
  data: Values;
  locked?: string[];
  change: (v: Values) => void;
}) {
  function control(f: Field, v: unknown, set: (v: unknown) => void, disabled: boolean) {
    const style = "min-h-11 w-full rounded-md border bg-background px-3 py-2 text-base";
    const numeric =
      f.input === "phone" ||
      f.input === "number" ||
      /plate/i.test(f.key) ||
      /^\d+$/.test(String(v ?? ""));
    const props = {
      className: style + (numeric ? " text-center" : ""),
      disabled,
      required: f.required,
      "aria-label": f.label_ar,
      onInvalid: (
        event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
      ) => event.currentTarget.setCustomValidity("تحقق من الحقل · " + f.label_ar),
      onInput: (
        event: React.FormEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
      ) => event.currentTarget.setCustomValidity(""),
    };
    return (
      <label key={f.key} className="grid gap-2">
        <span>
          {f.label_ar}
          {f.required ? " *" : ""}
        </span>
        {f.input === "checkbox" ? (
          <input
            {...props}
            className="size-6"
            type="checkbox"
            checked={v === true}
            onChange={(e) => set(e.target.checked)}
          />
        ) : f.input === "select" ? (
          <select {...props} value={String(v ?? "")} onChange={(e) => set(e.target.value)}>
            <option value="">اختر</option>
            {f.options?.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : f.input === "textarea" ? (
          <textarea
            {...props}
            maxLength={4000}
            value={String(v ?? "")}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            {...props}
            dir={
              f.input === "phone" || f.input === "number" || /plate/i.test(f.key) ? "ltr" : "auto"
            }
            type={
              f.input === "phone"
                ? "tel"
                : f.input === "date"
                  ? "date"
                  : f.input === "number"
                    ? "number"
                    : "text"
            }
            maxLength={250}
            value={String(v ?? "")}
            onChange={(e) => set(latin(e.target.value))}
          />
        )}
        {f.input === "phone" && !!v && !/^\d{11}$/.test(String(v)) && (
          <small>تحقق من الرقم، المعتاد 11 رقماً.</small>
        )}
      </label>
    );
  }
  return (
    <div className="space-y-5">
      {schema.sections.map((s, i) => {
        const fs = fields(s);
        if (s.type !== "repeating_table")
          return (
            <section key={i} className="grid gap-4">
              {fs.map((f) =>
                control(
                  f,
                  data[f.key],
                  (v) => change({ ...data, [f.key]: v }),
                  locked.includes(f.key),
                ),
              )}
            </section>
          );
        const key = s.key!,
          rows = (data[key] ?? []) as Values[],
          disabled = locked.includes(key);
        return (
          <fieldset key={i} className="space-y-3">
            <legend className="font-bold">{s.title_ar}</legend>
            {rows.map((row, index) => (
              <div key={index} className="grid gap-3 rounded-lg border p-3">
                {fs.map((f) =>
                  control(
                    f,
                    row[f.key],
                    (v) =>
                      change({
                        ...data,
                        [key]: rows.map((r, j) => (j === index ? { ...r, [f.key]: v } : r)),
                      }),
                    disabled,
                  ),
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => change({ ...data, [key]: rows.filter((_, j) => j !== index) })}
                >
                  حذف الصف {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={disabled || rows.length >= s.max_rows!}
              onClick={() => change({ ...data, [key]: [...rows, {}] })}
            >
              إضافة شخص
            </Button>
          </fieldset>
        );
      })}
    </div>
  );
}

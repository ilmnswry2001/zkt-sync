export type Field = {
  key: string;
  label_ar: string;
  input: "text" | "number" | "phone" | "date" | "select" | "textarea" | "checkbox";
  required?: boolean;
  width?: number;
  options?: string[];
};
export type Section = {
  type: "info_grid" | "text_block" | "signature" | "repeating_table";
  key?: string;
  title_ar?: string;
  label_ar?: string;
  fields?: Field[];
  columns?: Field[] | number;
  min_rows?: number;
  max_rows?: number;
  show_row_number?: boolean;
};
export type Schema = { sections: Section[] };
export type Values = Record<string, unknown>;
export function fields(s: Section): Field[] {
  if (s.type === "info_grid") return s.fields ?? [];
  if (s.type === "repeating_table") return Array.isArray(s.columns) ? s.columns : [];
  return [
    {
      key: s.key!,
      label_ar: s.label_ar ?? "",
      input: s.type === "signature" ? "text" : "textarea",
    },
  ];
}
export const latin = (s: string) => s.replace(/[٠-٩۰-۹]/g, (c) => String(c.charCodeAt(0) % 16));
export function checkSchema(schema: Schema) {
  if (!Array.isArray(schema?.sections) || !schema.sections.length || schema.sections.length > 30)
    throw Error("تحقق من أقسام القالب");
  const keys = new Set<string>();
  function key(k: unknown, set: Set<string>) {
    if (typeof k !== "string" || !/^\w{1,64}$/.test(k) || k in Object.prototype || set.has(k))
      throw Error("معرّف حقل مكرر أو غير صالح");
    set.add(k);
  }
  for (const s of schema.sections) {
    if (!["info_grid", "repeating_table", "text_block", "signature"].includes(s.type))
      throw Error("نوع قسم غير صالح");
    const table = s.type === "repeating_table",
      scope = table ? new Set<string>() : keys;
    if (table) {
      key(s.key, keys);
      if (
        !Number.isInteger(s.max_rows) ||
        !Number.isInteger(s.min_rows) ||
        s.min_rows! < 0 ||
        s.max_rows! < 1 ||
        s.max_rows! > 100 ||
        s.min_rows! > s.max_rows!
      )
        throw Error("تحقق من عدد الصفوف");
    }
    const fs = fields(s);
    if (!fs.length || fs.length > 50) throw Error("أضف حقول القسم");
    for (const f of fs) {
      key(f.key, scope);
      if (
        !f.label_ar?.trim() ||
        !["text", "number", "phone", "date", "select", "textarea", "checkbox"].includes(f.input)
      )
        throw Error("تحقق من تسمية الحقل ونوعه");
      if (
        f.input === "select" &&
        (!Array.isArray(f.options) ||
          !f.options.length ||
          !f.options.every((x) => typeof x === "string"))
      )
        throw Error("أدخل خيارات القائمة");
    }
    if (
      table &&
      (fs.some((f) => !Number.isInteger(f.width) || f.width! <= 0) ||
        fs.reduce((sum, f) => sum + f.width!, s.show_row_number === false ? 0 : 700) !== 10466)
    )
      throw Error("مجموع عرض أعمدة الجدول مع الترقيم يجب أن يكون 10466");
  }
}
export function validate(
  schema: Schema,
  input: Values,
  prefill: Values = {},
  locked: string[] = [],
): Values {
  checkSchema(schema);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("قيم الاستمارة غير صالحة");
  const values = { ...input };
  for (const k of locked) values[k] = prefill[k];
  const result: Values = {};
  function value(f: Field, raw: unknown) {
    if (f.input === "checkbox") {
      if (raw !== undefined && typeof raw !== "boolean") throw Error(f.label_ar);
      if (f.required && raw !== true) throw Error("الحقل مطلوب · " + f.label_ar);
      return raw === true;
    }
    if (raw == null) raw = "";
    if (typeof raw !== "string" && !(f.input === "number" && typeof raw === "number"))
      throw Error(f.label_ar);
    const v = latin(String(raw).trim());
    if (f.required && !v) throw Error("الحقل مطلوب · " + f.label_ar);
    if (v.length > (f.input === "textarea" ? 4000 : 250)) throw Error("النص طويل · " + f.label_ar);
    if (
      v &&
      ((f.input === "number" && !/^-?\d+(\.\d+)?$/.test(v)) ||
        (f.input === "date" &&
          (!/^\d{4}-\d\d-\d\d$/.test(v) ||
            !Number.isFinite(Date.parse(v)) ||
            new Date(v).toISOString().slice(0, 10) !== v)) ||
        (f.input === "select" && !f.options?.includes(v)))
    )
      throw Error("قيمة غير صالحة · " + f.label_ar);
    return v;
  }
  for (const s of schema.sections) {
    if (s.type === "repeating_table") {
      const rows = values[s.key!] ?? [];
      if (!Array.isArray(rows) || rows.length > s.max_rows!) throw Error("عدد الصفوف غير صالح");
      result[s.key!] = rows.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw Error("صف غير صالح");
        return Object.fromEntries(fields(s).map((f) => [f.key, value(f, row[f.key])]));
      });
    } else for (const f of fields(s)) result[f.key] = value(f, values[f.key]);
  }
  return result;
}

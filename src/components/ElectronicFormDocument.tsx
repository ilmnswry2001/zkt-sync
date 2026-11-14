import { toast } from "sonner";
import {
  fields,
  latin,
  type Schema,
  type Values,
} from "../../supabase/functions/_shared/form-schema";
import css from "./electronic-form-print.css?inline";
export type Brand = Partial<
  Record<
    | "logo_url"
    | "company_name_ar"
    | "company_name_en"
    | "company_subtitle_ar"
    | "company_subtitle_en"
    | "forms_header_line_ar"
    | "forms_header_line_en"
    | "brand_primary_color",
    string | null
  >
>;
export type FormDocument = {
  title_ar: string;
  code: string;
  version: number;
  schema: Schema;
  data: Values;
  branding: Brand;
  reference_code?: string;
};
export function ElectronicFormDocument({ doc }: { doc: FormDocument }) {
  const { schema, data, branding: b } = doc;
  const pages: { section: number; start: number; count: number }[][] = [[]];
  let units = 0;
  const page = () => pages[pages.length - 1];
  schema.sections.forEach((s, i) => {
    if (s.type !== "repeating_table") {
      const cost = s.type === "info_grid" ? Math.ceil(fields(s).length / 2) : 2;
      if (units + cost > 17) {
        pages.push([]);
        units = 0;
      }
      page().push({ section: i, start: 0, count: 0 });
      units += cost;
      return;
    }
    const rows = Array.isArray(data[s.key!]) ? (data[s.key!] as Values[]) : [];
    const n = Math.max(1, s.min_rows ?? 1, rows.length);
    let start = 0;
    while (start < n) {
      if (units >= 17) {
        pages.push([]);
        units = 0;
      }
      const count = Math.min(17 - units, n - start);
      page().push({ section: i, start, count });
      units += count + 2;
      start += count;
    }
  });
  const display = (v: unknown) =>
    typeof v === "boolean" ? (v ? "نعم" : "لا") : latin(String(v ?? ""));
  const logo =
    b.logo_url && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(b.logo_url)
      ? b.logo_url
      : undefined;
  return (
    <div
      className="ef-document"
      dir="rtl"
      style={{ "--ink": b.brand_primary_color || "#548235" } as React.CSSProperties}
    >
      {pages.map((parts, p) => (
        <article className="ef-sheet" key={p}>
          {logo && <img alt="" className="ef-watermark" src={logo} />}
          <header>
            <div>
              <strong>{b.company_name_ar}</strong>
              <span>{b.company_subtitle_ar}</span>
              <span>{b.forms_header_line_ar}</span>
            </div>
            {logo ? <img alt="" src={logo} /> : <span />}
            <div dir="ltr">
              <strong>{b.company_name_en}</strong>
              <span>{b.company_subtitle_en}</span>
              <span>{b.forms_header_line_en}</span>
            </div>
          </header>
          <h1>{doc.title_ar}</h1>
          {parts.map(({ section, start, count }) => {
            const s = schema.sections[section],
              fs = fields(s);
            if (s.type !== "repeating_table")
              return (
                <table key={section}>
                  <tbody>
                    {Array.from({ length: Math.ceil(fs.length / 2) }, (_, i) => (
                      <tr key={i}>
                        {fs.slice(i * 2, i * 2 + 2).map((f) => (
                          <FieldPair
                            key={f.key}
                            label={f.label_ar}
                            value={display(data[f.key])}
                            numeric={
                              f.input === "phone" ||
                              f.input === "number" ||
                              /phone|plate|iban/i.test(f.key)
                            }
                          />
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            const rows = (data[s.key!] ?? []) as Values[];
            return (
              <table key={section}>
                <colgroup>
                  {s.show_row_number !== false && <col style={{ width: "6.69%" }} />}
                  {fs.map((f) => (
                    <col key={f.key} style={{ width: ((f.width ?? 0) / 10466) * 100 + "%" }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={fs.length + (s.show_row_number !== false ? 1 : 0)}>
                      {s.title_ar}
                    </th>
                  </tr>
                  <tr>
                    {s.show_row_number !== false && <th>ت</th>}
                    {fs.map((f) => (
                      <th key={f.key}>{f.label_ar}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: count }, (_, i) => (
                    <tr key={i}>
                      {s.show_row_number !== false && <td>{start + i + 1}</td>}
                      {fs.map((f) => (
                        <td
                          key={f.key}
                          dir={f.input === "phone" || f.input === "number" ? "ltr" : "auto"}
                        >
                          {display(rows[start + i]?.[f.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
          <footer>
            <bdi>
              {doc.code} · v{doc.version}
            </bdi>
            <bdi>{doc.reference_code}</bdi>
            <bdi>{new Date().toLocaleDateString("en-GB")}</bdi>
            <span>
              صفحة {p + 1} من {pages.length}
            </span>
          </footer>
        </article>
      ))}
    </div>
  );
}
function FieldPair({ label, value, numeric }: { label: string; value: string; numeric: boolean }) {
  return (
    <>
      <th>{label}</th>
      <td dir={numeric || /^\d+$/.test(value) ? "ltr" : "auto"}>{value}</td>
    </>
  );
}
export async function printForms(docs: FormDocument[]) {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("اسمح بفتح نافذة الطباعة");
    return;
  }
  w.opener = null;
  const { renderToStaticMarkup } = await import("react-dom/server");
  w.document.open();
  w.document.write(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:12.7mm}html,body{margin:0;padding:0}' +
      css +
      "</style></head><body>" +
      renderToStaticMarkup(
        <>
          {docs.map((doc, i) => (
            <ElectronicFormDocument key={i} doc={doc} />
          ))}
        </>,
      ) +
      "</body></html>",
  );
  w.document.close();
  w.document.title = docs[0].title_ar + "_" + (docs[0].reference_code ?? docs[0].code);
  Promise.all(Array.from(w.document.images, (img) => img.decode().catch(() => undefined))).then(
    () => {
      w.focus();
      w.print();
    },
  );
}

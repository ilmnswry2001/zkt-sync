import * as XLSX from "xlsx";

export type ImportRow = {
  employee_no: string;
  full_name: string;
  position: string | null;
  department: string | null;
  erp_no: string | null;
  id_no: string | null;
  status: "active" | "inactive";
  nationality: string | null;
  birth_date: string | null;
  hire_date: string | null;
  last_working_day: string | null;
  phone1: string | null;
  phone2: string | null;
  address: string | null;
  salary_type: string | null;
  salary_structure: string | null;
  project: string | null;
  safety_passport_no: string | null;
  safety_passport_expiry: string | null;
  notes: string | null;
};

/** Arabic (and English) header aliases → internal field */
const HEADERS: Record<string, keyof ImportRow | "department"> = {
  "التسلسل": "employee_no",
  "الرقم الوظيفي": "employee_no",
  "اسم الموظف": "full_name",
  "الاسم الكامل": "full_name",
  "المسمى الوظيفي": "position",
  "المنصب": "position",
  "القسم": "department",
  "NO EM ERP": "erp_no",
  "ID NO.": "id_no",
  "مستمر بالعمل؟": "status",
  "الجنسية": "nationality",
  "المواليد": "birth_date",
  "تاريخ المباشرة": "hire_date",
  "آخر يوم عمل": "last_working_day",
  "هاتف 1": "phone1",
  "هاتف 2": "phone2",
  "عنوان السكن": "address",
  "نوع الراتب": "salary_type",
  "Salary Structure": "salary_structure",
  "المشاريع": "project",
  "رقم جواز السلامة": "safety_passport_no",
  "تاريخ انتهاء جواز السلامة": "safety_passport_expiry",
  "ملاحظات 1": "notes",
};

const norm = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "nan" ? s : null;
};

const toDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    if (y < 1920 || y > 2100) return null;
    return `${y}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || d.y < 1920 || d.y > 2100) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const t = Date.parse(s);
  if (isNaN(t)) return null;
  const d = new Date(t);
  if (d.getFullYear() < 1920 || d.getFullYear() > 2100) return null;
  return d.toISOString().slice(0, 10);
};

const toStatus = (v: unknown): "active" | "inactive" => {
  const s = norm(v)?.toLowerCase() ?? "";
  return ["yes", "y", "true", "1", "نعم", "مستمر"].includes(s) ? "active" : "inactive";
};

export type ParseResult = { rows: ImportRow[]; skipped: number; headers: string[] };

export function parseEmployeesWorkbook(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  const headers = raw.length ? Object.keys(raw[0]) : [];

  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const r of raw) {
    const picked: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(r)) {
      const field = HEADERS[key.trim()];
      if (field) picked[field] = val;
    }
    const employee_no = norm(picked.employee_no);
    const full_name = norm(picked.full_name);
    if (!employee_no || !full_name || seen.has(employee_no)) {
      skipped++;
      continue;
    }
    seen.add(employee_no);
    rows.push({
      employee_no,
      full_name,
      position: norm(picked.position),
      department: norm(picked.department),
      erp_no: norm(picked.erp_no),
      id_no: norm(picked.id_no),
      status: toStatus(picked.status),
      nationality: norm(picked.nationality),
      birth_date: toDate(picked.birth_date),
      hire_date: toDate(picked.hire_date),
      last_working_day: toDate(picked.last_working_day),
      phone1: norm(picked.phone1),
      phone2: norm(picked.phone2),
      address: norm(picked.address),
      salary_type: norm(picked.salary_type),
      salary_structure: norm(picked.salary_structure),
      project: norm(picked.project),
      safety_passport_no: norm(picked.safety_passport_no),
      safety_passport_expiry: toDate(picked.safety_passport_expiry),
      notes: norm(picked.notes),
    });
  }

  return { rows, skipped, headers };
}

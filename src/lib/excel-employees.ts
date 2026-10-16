import * as XLSX from "xlsx";

export const EMPLOYEE_IMPORT_FIELDS = [
  { key: "employee_no", label: "الرقم الوظيفي (مفتاح المطابقة)" },
  { key: "full_name", label: "اسم الموظف" },
  { key: "attendance_device_id", label: "رقم الموظف في جهاز البصمة" },
  { key: "position", label: "المسمى الوظيفي" },
  { key: "department", label: "القسم" },
  { key: "erp_no", label: "رقم ERP" },
  { key: "id_no", label: "رقم الهوية" },
  { key: "ctr_code", label: "رمز العقد" },
  { key: "status", label: "حالة الموظف" },
  { key: "nationality", label: "الجنسية" },
  { key: "birth_date", label: "تاريخ الميلاد" },
  { key: "hire_date", label: "تاريخ المباشرة" },
  { key: "last_working_day", label: "آخر يوم عمل" },
  { key: "contract_end_date", label: "تاريخ انتهاء العقد" },
  { key: "phone1", label: "الهاتف الأول" },
  { key: "phone2", label: "الهاتف الثاني" },
  { key: "email", label: "البريد الإلكتروني" },
  { key: "address", label: "عنوان السكن" },
  { key: "salary_type", label: "نوع الراتب" },
  { key: "salary_structure", label: "هيكل الراتب" },
  { key: "project", label: "المشروع" },
  { key: "passport_no", label: "رقم جواز السفر" },
  { key: "passport_expiry", label: "انتهاء جواز السفر" },
  { key: "residency_no", label: "رقم الإقامة" },
  { key: "residency_expiry", label: "انتهاء الإقامة" },
  { key: "safety_passport_no", label: "رقم جواز السلامة" },
  { key: "safety_passport_expiry", label: "انتهاء جواز السلامة" },
  { key: "notes", label: "ملاحظات" },
] as const;

// Columns represented by regular employee form fields are saved under their source headings too.
export const EMPLOYEE_SOURCE_BINDINGS: Record<string, string> = {
  "التسلسل": "employee_no",
  "اسم الموظف": "full_name",
  "المسمى الوظيفي": "position",
  "القسم": "department_name",
  "NO EM ERP": "erp_no",
  "مستمر بالعمل؟": "status",
  "ID NO.": "id_no",
  "Salary Structure": "salary_structure",
  "نوع الراتب": "salary_type",
  "المشاريع": "project",
  "رقم جواز السلامة": "safety_passport_no",
  "تاريخ انتهاء جواز السلامة": "safety_passport_expiry",
  "تاريخ المباشرة": "hire_date",
  "رقم العقد الموظف": "ctr_code",
  "الجنسية": "nationality",
  "آخر يوم عمل": "last_working_day",
  "هاتف 1": "phone1",
  "هاتف 2": "phone2",
  "عنوان السكن": "address",
  "المواليد": "birth_date",
  "Attendance Device ID": "attendance_device_id",
  "ملاحظات 1": "notes",
};

export const EMPLOYEE_EXTRA_SOURCE_FIELDS = [
  ["استمارة ترشيح دورة", "course_nomination_form"], ["تاريخ الاستمارة", "course_nomination_date"],
  ["متابعة توجيهات الادارة العليا", "executive_guidance_follow_up"], ["ملاحظات توجيهات الادارة", "executive_guidance_notes"],
  ["قرار التعيين", "appointment_decision"], ["تاريخ كتاب القرار", "appointment_decision_date"],
  ["حالة جواز السلامة", "safety_passport_status"], ["الاسم في الجواز", "passport_name"],
  ["رقم الجنسية", "nationality_number"], ["رقم الهوية / الجواز", "identity_or_passport_number"],
  ["رقم العقد الضمان الاجتماعي", "social_security_contract_number"], ["تاريخ الرفع بالإيميل", "email_submission_date"],
  ["ترشيح للاضافة في الضمان الاجتماعي", "social_security_addition_nomination"],
  ["ترشيح لعمل عقد الموظف", "employee_contract_nomination"], ["تاريخ براءة الذمة", "clearance_date"],
  ["استمارة التوظيف", "employment_form"], ["دورة السلامة الأساسية", "basic_safety_course"],
  ["تعهد السياسات", "policies_undertaking"], ["نسخة الهوية+السكن", "identity_residence_copy"],
  ["صور ورقية والكترونية", "paper_electronic_photos"], ["نسخة جواز السلامة", "safety_passport_copy"],
  ["نسخة جواز السفر", "passport_copy"], ["نسخة الفيزة", "visa_copy"], ["السيرة الذاتية", "cv_copy"],
  ["جواز قيادة", "driving_license"], ["وثيقة التخرج", "graduation_certificate"],
  ["مدخل البيانات", "data_entry_by"], ["حقل الترشيح", "nomination_field"],
  ["الدورات الرميلة التي حصل عليها", "rumaila_courses"], ["ملاحظات الرفع", "upload_notes"],
  ["تاريخ آخر مراجعة", "last_review_date"], ["ملاحظات آخر مراجعة", "last_review_notes"],
  ["ملاحظات 2", "notes_2"], ["تاريخ آخر تقييم", "last_evaluation_date"],
  ["درجة آخر تقييم", "last_evaluation_score"],
].map(([header, column]) => ({ header, column })) as { header: string; column: string }[];

export type EmployeeImportField = (typeof EMPLOYEE_IMPORT_FIELDS)[number]["key"];
export type EmployeeImportMapping = Record<string, EmployeeImportField | "">;
export type EmployeeImportRow = {
  employee_no: string;
  full_name: string;
  employee_import_data: Record<string, string | number | boolean | null>;
} & Partial<Record<Exclude<EmployeeImportField, "employee_no" | "full_name">, string | null | "active" | "inactive" | "terminated">>;

const HEADERS: Record<string, EmployeeImportField> = {
  "التسلسل": "employee_no",
  "الرقم الوظيفي": "employee_no",
  "اسم الموظف": "full_name",
  "الاسم الكامل": "full_name",
  "Attendance Device ID": "attendance_device_id",
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
  "رقم العقد الموظف": "ctr_code",
  "ملاحظات 1": "notes",
};

const norm = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toLowerCase() !== "nan" ? text : null;
};

const toDate = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    if (year < 1920 || year > 2100) return null;
    return `${year}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date || date.y < 1920 || date.y > 2100) return null;
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value).trim().replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const parts = text.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (parts) {
    const [, first, second, third] = parts;
    const yearFirst = first.length === 4;
    const year = Number(yearFirst ? first : third);
    const month = Number(second);
    const day = Number(yearFirst ? third : first);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1920 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 1920 || parsed.getFullYear() > 2100) return null;
  return parsed.toISOString().slice(0, 10);
};

const toStatus = (value: unknown): "active" | "inactive" | "terminated" | null => {
  const text = norm(value)?.toLowerCase();
  if (!text) return null;
  if (["yes", "y", "true", "1", "نعم", "مستمر", "active", "نشط"].includes(text)) return "active";
  if (["terminated", "مفصول", "منتهي الخدمة", "منتهية خدمته"].includes(text)) return "terminated";
  if (["no", "n", "false", "0", "لا", "غير مستمر", "inactive", "غير نشط"].includes(text)) return "inactive";
  return null;
};

export type EmployeeWorkbook = { headers: string[]; rows: Record<string, unknown>[]; sheetName: string };

export function readEmployeesWorkbook(buffer: ArrayBuffer): EmployeeWorkbook {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("المصنف لا يحتوي على أوراق بيانات");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  return { headers: rows.length ? Object.keys(rows[0]) : [], rows, sheetName };
}

export function guessEmployeeImportMapping(headers: string[]): EmployeeImportMapping {
  const mapping: EmployeeImportMapping = {};
  const used = new Set<EmployeeImportField>();
  for (const header of headers) {
    const target = HEADERS[header.trim()];
    mapping[header] = target && !used.has(target) ? target : "";
    if (target && mapping[header]) used.add(target);
  }
  return mapping;
}

export function mapEmployeeImportRows(
  rows: Record<string, unknown>[],
  mapping: EmployeeImportMapping,
): { rows: EmployeeImportRow[]; skipped: number; invalidDates: Partial<Record<EmployeeImportField, number>> } {
  const mappedRows: EmployeeImportRow[] = [];
  const seen = new Set<string>();
  const invalidDates: Partial<Record<EmployeeImportField, number>> = {};
  let skipped = 0;
  const dateFields = new Set<EmployeeImportField>([
    "birth_date", "hire_date", "last_working_day", "contract_end_date", "passport_expiry",
    "residency_expiry", "safety_passport_expiry",
  ]);

  for (const sourceRow of rows) {
    const selected: Partial<Record<EmployeeImportField, unknown>> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) selected[field] = sourceRow[header];
    }
    const employeeNo = norm(selected.employee_no);
    const fullName = norm(selected.full_name);
    if (!employeeNo || !fullName || seen.has(employeeNo)) {
      skipped++;
      continue;
    }
    seen.add(employeeNo);

    const sourceData = Object.fromEntries(Object.entries(sourceRow).map(([header, value]) => {
      if (value === null || value === undefined || value === "") return [header, null];
      if (value instanceof Date && !Number.isNaN(value.getTime())) return [header, value.toISOString().slice(0, 10)];
      if (typeof value === "string") return [header, value.trim() || null];
      if (typeof value === "number" || typeof value === "boolean") return [header, value];
      return [header, String(value).trim() || null];
    }));
    const result: EmployeeImportRow = { employee_no: employeeNo, full_name: fullName, employee_import_data: sourceData };
    for (const [field, value] of Object.entries(selected) as [EmployeeImportField, unknown][]) {
      if (field === "employee_no" || field === "full_name") continue;
      if (field === "status") result.status = toStatus(value) ?? undefined;
      else if (dateFields.has(field)) {
        const parsed = toDate(value);
        if (norm(value) && !parsed) invalidDates[field] = (invalidDates[field] ?? 0) + 1;
        result[field] = parsed;
      }
      else result[field] = norm(value);
    }
    mappedRows.push(result);
  }

  return { rows: mappedRows, skipped, invalidDates };
}

export function getDefaultEmployeeImportField(header: string): EmployeeImportField | "" {
  return HEADERS[header.trim()] ?? "";
}

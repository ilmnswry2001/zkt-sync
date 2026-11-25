import type { sectionGuide } from "./section-guide";

type Section = keyof typeof sectionGuide;
type Workflow = { title: string; links: ReadonlyArray<readonly [Section, Section, string]> };

export const systemWorkflows: readonly Workflow[] = [
  { title: "مسار الموظف والراتب", links: [
    ["/departments", "/employees", "القسم الوظيفي"],
    ["/attendance", "/monthly", "الحضور الفعلي ومتابعة النشر"],
    ["/leaves", "/monthly", "التسويات الشهرية"],
    ["/monthly", "/payroll", "الحضور والاستحقاق"],
    ["/advances", "/payroll", "دفعات السلف"],
    ["/penalties", "/payroll", "سجل العقوبات"],
    ["/wages", "/payroll", "أسعار التخصصات"],
  ] },
  { title: "مصادر الحضور", links: [
    ["/mobile-sync", "/devices", "سجلات البصمة"],
    ["/upload", "/files", "سجلات الحضور المستوردة"],
    ["/devices", "/attendance", "سجلات البصمة"],
    ["/self-attendance", "/attendance", "الحضور الفعلي"],
  ] },
  { title: "مسار الخطط والتكلفة", links: [
    ["/sites", "/planning", "موقع التنفيذ"],
    ["/planning", "/attendance", "توزيع الكادر على المواقع"],
    ["/attendance", "/projects", "تكلفة الكادر المعتمد"],
    ["/warehouses", "/projects", "تكلفة المواد المصروفة"],
  ] },
  { title: "مسار الأصول والصيانة", links: [
    ["/vehicles", "/maintenance", "سجل الأصل وصيانته"],
    ["/maintenance", "/warehouses", "صرف قطع الغيار"],
  ] },
  { title: "حوكمة النظام", links: [
    ["/accounts", "/employees", "حسابات الوصول"],
    ["/accounts", "/warehouses", "الأدوار والصلاحيات"],
  ] },
];

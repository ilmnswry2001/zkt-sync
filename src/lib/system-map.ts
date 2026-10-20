import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  Boxes,
  Building2,
  CalendarCheck2,
  ClipboardList,
  Fingerprint,
  ListChecks,
  Network,
  Settings2,
  Truck,
  Users,
  Wrench,
} from "lucide-react";

export type SystemModule = {
  id: string;
  title: string;
  group: string;
  href: string;
  icon: LucideIcon;
  summary: string;
  pages: string[];
};

export type SystemRelation = {
  from: string;
  to: string;
  label: string;
};

export type SystemFlow = {
  title: string;
  relations: SystemRelation[];
};

export const SYSTEM_MODULES: SystemModule[] = [
  { id: "departments", title: "الأقسام", group: "الموارد البشرية", href: "/departments", icon: Building2, summary: "تنظيم الهيكل والأقسام التي ينتمي إليها الموظفون.", pages: ["الأقسام"] },
  { id: "employees", title: "الموظفون", group: "الموارد البشرية", href: "/employees", icon: Users, summary: "ملفات الموظفين وبياناتهم الوظيفية التي تعتمد عليها عمليات الحضور والرواتب والتكليفات.", pages: ["دليل الموظفين", "ملف الموظف"] },
  { id: "attendance", title: "الحضور والدوام", group: "الحضور والدوام", href: "/attendance", icon: CalendarCheck2, summary: "تجميع سجلات الحضور ومراجعتها واستخدامها في التقارير والتكاليف.", pages: ["التقارير اليومية", "الحضور الذاتي", "جداول الورديات"] },
  { id: "devices", title: "أجهزة البصمة", group: "الحضور والدوام", href: "/devices", icon: Fingerprint, summary: "الأجهزة ووكيل المزامنة ورفع سجلات البصمة إلى النظام.", pages: ["الأجهزة", "رفع ملفات البصمة"] },
  { id: "payroll", title: "الأجور والرواتب", group: "الموارد البشرية", href: "/payroll", icon: BadgeDollarSign, summary: "احتساب المستحقات والخصومات اعتماداً على بيانات الموارد البشرية والحضور.", pages: ["الأجور", "الرواتب", "العقوبات", "الإجازات"] },
  { id: "work-center", title: "مركز العمل", group: "المهام والفريق", href: "/work-center", icon: ListChecks, summary: "المهام والتوجيهات والأهداف ومتابعة تقدم الموظفين.", pages: ["المهام", "التوجيهات", "الأهداف"] },
  { id: "planning", title: "الخطط والمشاريع", group: "المشاريع والخطط", href: "/planning", icon: ClipboardList, summary: "إعداد الخطط والمواقع ومتابعة نشر الكوادر والتكاليف التشغيلية.", pages: ["الخطط", "المواقع", "الخطط النهائية", "تكلفة المشاريع"] },
  { id: "vehicles", title: "المركبات والآليات", group: "الأصول", href: "/vehicles", icon: Truck, summary: "سجل المركبات والآليات والتشغيل والوقود.", pages: ["المركبات", "الآليات", "إدارة الوقود"] },
  { id: "maintenance", title: "الصيانة", group: "الأصول", href: "/maintenance", icon: Wrench, summary: "سجلات صيانة المركبات والآليات والمعدات وقطع الغيار.", pages: ["صيانة الآليات", "صيانة المركبات", "صيانة المعدات"] },
  { id: "warehouses", title: "المخازن", group: "الأصول", href: "/warehouses", icon: Boxes, summary: "المخزون وحركات الصرف والاستلام، بما فيها مخزن الصيانة.", pages: ["المخزون", "الحركات", "مخزن الصيانة"] },
  { id: "reports", title: "التقارير", group: "المتابعة", href: "/monthly", icon: Activity, summary: "تقارير الحضور والرواتب والتشغيل والمتابعة الشهرية.", pages: ["التقرير الشهري", "التقارير اليومية", "متابعة النشر"] },
  { id: "accounts", title: "الحسابات والصلاحيات", group: "الإدارة", href: "/accounts", icon: Settings2, summary: "حسابات الدخول والأدوار ونطاق الوصول إلى الأقسام.", pages: ["الحسابات", "الأدوار", "صلاحيات الأقسام"] },
];

export const SYSTEM_FLOWS: SystemFlow[] = [
  { title: "مسار الموظف والراتب", relations: [
    { from: "departments", to: "employees", label: "الهيكل الوظيفي" },
    { from: "employees", to: "attendance", label: "بيانات الكادر" },
    { from: "attendance", to: "payroll", label: "الحضور والاستحقاق" },
    { from: "payroll", to: "reports", label: "نتائج الرواتب" },
  ] },
  { title: "مصادر الحضور", relations: [
    { from: "devices", to: "attendance", label: "سجلات البصمة" },
    { from: "employees", to: "work-center", label: "الموظفون والمهام والأهداف" },
  ] },
  { title: "مسار الخطط والتكلفة", relations: [
    { from: "planning", to: "attendance", label: "توزيع الكادر على المواقع" },
    { from: "attendance", to: "reports", label: "الحضور الفعلي ومتابعة النشر" },
  ] },
  { title: "مسار الأصول والصيانة", relations: [
    { from: "vehicles", to: "maintenance", label: "سجل الأصل وصيانته" },
    { from: "maintenance", to: "warehouses", label: "صرف قطع الغيار" },
  ] },
  { title: "حوكمة النظام", relations: [
    { from: "accounts", to: "employees", label: "حسابات الوصول" },
    { from: "accounts", to: "warehouses", label: "الأدوار والصلاحيات" },
  ] },
];

export function getSystemModule(id: string) {
  return SYSTEM_MODULES.find((module) => module.id === id);
}

export function getModuleRelations(id: string) {
  return SYSTEM_FLOWS.flatMap((flow) => flow.relations
    .filter((relation) => relation.from === id || relation.to === id)
    .map((relation) => ({ ...relation, direction: relation.from === id ? "outgoing" as const : "incoming" as const })));
}

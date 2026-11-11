import { normalizeWageTitle } from "./employee-pay-type.ts";
export type DefaultWage = {
  daily_rate: number;
  monthly_rate: number;
  overtime_hour_rate: number;
  currency: "IQD";
  notes: string;
};

const DEFAULTS: Record<string, DefaultWage> = {
  "إدارة وإشراف": { daily_rate: 80000, monthly_rate: 2000000, overtime_hour_rate: 12000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب عقد الموقع" },
  "مهندس موقع": { daily_rate: 70000, monthly_rate: 1800000, overtime_hour_rate: 10000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "مهندس ميكانيك": { daily_rate: 68000, monthly_rate: 1700000, overtime_hour_rate: 10000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "مهندس كهرباء": { daily_rate: 68000, monthly_rate: 1700000, overtime_hour_rate: 10000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "مهندس مدني": { daily_rate: 68000, monthly_rate: 1700000, overtime_hour_rate: 10000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "جيولوجي / فني مختبر": { daily_rate: 64000, monthly_rate: 1600000, overtime_hour_rate: 9000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "فني أجهزة وتحكم": { daily_rate: 52000, monthly_rate: 1300000, overtime_hour_rate: 8000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "فني صيانة": { daily_rate: 48000, monthly_rate: 1200000, overtime_hour_rate: 7500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "لحام وفابريكيشن": { daily_rate: 44000, monthly_rate: 1100000, overtime_hour_rate: 7000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "سائق": { daily_rate: 36000, monthly_rate: 900000, overtime_hour_rate: 6000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "مشغل آلية": { daily_rate: 40000, monthly_rate: 1000000, overtime_hour_rate: 6500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "عامل حفر": { daily_rate: 30000, monthly_rate: 780000, overtime_hour_rate: 6000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "عامل خدمات / نظافة": { daily_rate: 28000, monthly_rate: 700000, overtime_hour_rate: 4500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "حراسة وأمن": { daily_rate: 30000, monthly_rate: 750000, overtime_hour_rate: 5000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "إسعاف وسلامة HSE": { daily_rate: 56000, monthly_rate: 1400000, overtime_hour_rate: 8500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
};

export function getDefaultWage(title: string): DefaultWage {
  const normalized=normalizeWageTitle(title);
  const words=normalized.split(" ");
  const exact=Object.entries(DEFAULTS).find(([name])=>normalizeWageTitle(name)===normalized)?.[1];
  if (exact) return exact;
  const rates: [string[],number][] = [
    [["ريكر","ريكور"],30000],[["مسعف","انقاذ","منقذ"],25000],[["كوسرجي","نجار"],35000],[["حداد"],50000],[["عامل"],25000],[["سائق"],36000],[["اسعاف"],56000],
  ];
  const rate=rates.find(([names])=>names.some(name=>words.some(word=>word.startsWith(name))))?.[1];
  if (rate) return {daily_rate:rate,monthly_rate:rate*26,overtime_hour_rate:Math.round(rate/8),currency:"IQD",notes:"أجر افتراضي مستنتج من التخصص؛ يحتاج مراجعة قبل الاعتماد"};
  return {
    daily_rate: 30000,
    monthly_rate: 750000,
    overtime_hour_rate: 5000,
    currency: "IQD",
    notes: "أجر افتراضي عام قابل للتعديل حسب التخصص والعقد",
  };
}

export function getKnownDefaultWages() {
  return DEFAULTS;
}

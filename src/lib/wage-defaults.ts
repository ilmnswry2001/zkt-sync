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
  "عامل حفر": { daily_rate: 36000, monthly_rate: 900000, overtime_hour_rate: 6000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "عامل خدمات / نظافة": { daily_rate: 28000, monthly_rate: 700000, overtime_hour_rate: 4500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "حراسة وأمن": { daily_rate: 30000, monthly_rate: 750000, overtime_hour_rate: 5000, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
  "إسعاف وسلامة HSE": { daily_rate: 56000, monthly_rate: 1400000, overtime_hour_rate: 8500, currency: "IQD", notes: "أجر افتراضي قابل للتعديل حسب الخبرة والعقد" },
};

export function getDefaultWage(title: string): DefaultWage {
  return DEFAULTS[title.trim()] ?? {
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

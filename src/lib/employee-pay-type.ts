export const DAILY_ROLE_NAMES = [
  "ريكر",
  "ريكور",
  "مسعف",
  "اسعاف",
  "انقاذ",
  "منقذ",
  "عامل",
  "نجار",
  "كوسرجي",
  "حداد",
  "سقالات",
  "صباغ",
  "فابريكيشن",
];
export function normalizeWageTitle(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^ال/, ""))
    .join(" ");
}
export function isDailyPosition(position?: string | null): boolean {
  const words = normalizeWageTitle(position).split(" ");
  return DAILY_ROLE_NAMES.some((name) => words.some(word=>word.startsWith(name)));
}
export function getEmployeePayType(employee: {
  pay_type?: string | null;
  salary_type?: string | null;
  position?: string | null;
  wage_rates?: {
    title?: string | null;
    daily_rate?: number | null;
    monthly_rate?: number | null;
  } | null;
}): "daily" | "monthly" {
  if (
    /daily|يومي/i.test(employee.salary_type ?? "") ||
    isDailyPosition(employee.position) ||
    isDailyPosition(employee.wage_rates?.title) ||
    (Number(employee.wage_rates?.daily_rate) > 0 &&
      Number(employee.wage_rates?.monthly_rate ?? 0) <= 0)
  )
    return "daily";
  return employee.pay_type === "daily" ? "daily" : "monthly";
}

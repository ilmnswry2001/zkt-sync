import { getEmployeePayType, normalizeWageTitle } from "./employee-pay-type.ts";
import { getDefaultWage } from "./wage-defaults.ts";
export type PayrollWageRate = {
  id?: string;
  title: string | null;
  daily_rate: number | null;
  monthly_rate: number | null;
  overtime_hour_rate: number | null;
  currency: string;
};
export function resolvePayrollWage(
  employee: {
    base_salary?: number | null;
    position?: string | null;
    pay_type?: string | null;
    salary_type?: string | null;
    wage_rates?: PayrollWageRate | null;
  },
  rates: PayrollWageRate[],
) {
  const title = normalizeWageTitle(employee.position);
  const candidates = rates
    .filter(
      (rate) =>
        rate.currency === "IQD" && (Number(rate.daily_rate) > 0 || Number(rate.monthly_rate) > 0),
    )
    .map((rate) => {
      const name = normalizeWageTitle(rate.title);
      const words = name.split(" ").filter(Boolean);
      const score =
        name && name === title
          ? 10000
          : words.length && words.every((w) => title.split(" ").includes(w))
            ? words.length * 100
            : 0;
      return { rate, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || String(a.rate.id).localeCompare(String(b.rate.id)));
  const matched =
    candidates[0] && (!candidates[1] || candidates[0].score > candidates[1].score)
      ? candidates[0].rate
      : undefined;
  const linked =
    employee.wage_rates?.currency === "IQD" &&
    (Number(employee.wage_rates.daily_rate) > 0 || Number(employee.wage_rates.monthly_rate) > 0)
      ? employee.wage_rates
      : null;
  const wage = linked ?? matched;
  const fallback = getDefaultWage(employee.position ?? "");
  const payType = getEmployeePayType({ ...employee, wage_rates: wage });
  const base = Number(employee.base_salary) || 0;
  const monthlySalary =
    base > 0
      ? base
      : Number(wage?.monthly_rate) > 0
        ? Number(wage!.monthly_rate)
        : Number(wage?.daily_rate) > 0
          ? Number(wage!.daily_rate) * 26
          : fallback.monthly_rate;
  const dailyRate =
    Number(wage?.daily_rate) > 0
      ? Number(wage!.daily_rate)
      : base > 0
        ? base / 26
        : Number(wage?.monthly_rate) > 0
          ? Number(wage!.monthly_rate) / 26
          : fallback.daily_rate;
  const overtimeHourlyRate =
    Number(wage?.overtime_hour_rate) > 0
      ? Number(wage!.overtime_hour_rate)
      : fallback.overtime_hour_rate;
  return {
    payType,
    monthlySalary,
    dailyRate,
    overtimeHourlyRate,
    source:
      base > 0 && (payType === "monthly" || !(Number(wage?.daily_rate) > 0))
        ? "base"
        : linked
          ? "linked"
          : matched
            ? "specialty"
            : "default",
    wageTitle: wage?.title ?? employee.position ?? "غير محدد",
  };
}
export function allocateAdvanceInstallments(
  net: number,
  installments: { id: string; amount: number; deducted_amount?: number }[],
) {
  let available = Math.max(0, net);
  return [...installments]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item) => {
      const amount =
        Math.round(
          Math.min(
            available,
            Math.max(0, Number(item.amount) - Number(item.deducted_amount || 0)),
          ) * 100,
        ) / 100;
      available = Math.max(0, available - amount);
      return amount > 0 ? [{ id: item.id, amount }] : [];
    });
}

import { getDefaultWage } from "./wage-defaults.ts";

export type WageRateCostRow = {
  title: string;
  monthly_rate: number | string | null;
  daily_rate: number | string | null;
};

export type EmployeeCostRow = {
  position: string | null;
  base_salary: number | string | null;
  wage_rates: WageRateCostRow | WageRateCostRow[] | null;
};

export function createWageRateTitleMap(rates: WageRateCostRow[]) {
  return new Map(rates.map((rate) => [rate.title.trim(), rate]));
}

export function getEmployeeSiteCost(
  employee: EmployeeCostRow,
  wagesByTitle: Map<string, WageRateCostRow>,
) {
  const linkedWage = Array.isArray(employee.wage_rates)
    ? employee.wage_rates[0]
    : employee.wage_rates;
  const rawWage = linkedWage ?? wagesByTitle.get(employee.position?.trim() ?? "");
  const defaults = getDefaultWage(rawWage?.title ?? employee.position ?? "");
  const wage = rawWage
    ? {
        ...rawWage,
        daily_rate: Number(rawWage.daily_rate) > 0 ? rawWage.daily_rate : defaults.daily_rate,
        monthly_rate: Number(rawWage.monthly_rate) > 0 ? rawWage.monthly_rate : defaults.monthly_rate,
      }
    : defaults;
  const monthly = Number(employee.base_salary) > 0
    ? Number(employee.base_salary)
    : Number(wage.monthly_rate);

  return {
    monthly,
    daily: Number(wage.daily_rate ?? (monthly ? monthly / 26 : 0)),
    specialty: rawWage?.title ?? employee.position ?? "بدون تخصص / أجر",
  };
}
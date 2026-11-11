import { getDefaultWage } from "./wage-defaults.ts";
export function verifiedSpecialtyCosts(
  crew: { employee_id: string; specialty: string }[],
  wages: { title: string; daily_rate: number; monthly_rate: number; currency: string }[],
) {
  const counts = new Map<string, { name: string; count: number }>();
  const seen = new Set<string>();
  for (const person of crew) {
    if (seen.has(person.employee_id)) continue;
    seen.add(person.employee_id);
    const name = person.specialty.trim() || "بدون صفة";
    const key = name.toLocaleLowerCase("ar");
    const item = counts.get(key) ?? { name, count: 0 };
    item.count++;
    counts.set(key, item);
  }
  return Array.from(counts, ([key, item]) => {
    const wage = wages.find(
      (w) => w.title.trim().toLocaleLowerCase("ar") === key && w.currency === "IQD",
    );
    const hasRate = Number(wage?.daily_rate) > 0 || Number(wage?.monthly_rate) > 0;
    const dailyRate =
      Number(wage?.daily_rate) > 0
        ? Number(wage!.daily_rate)
        : Number(wage?.monthly_rate) > 0
          ? Number(wage!.monthly_rate) / 26
          : getDefaultWage(item.name).daily_rate;
    return { ...item, dailyRate, cost: item.count * dailyRate, hasRate, usedDefault: !hasRate };
  });
}

export function projectDailyRate(
  specialty: string,
  wages: { title: string; daily_rate: number; monthly_rate: number; currency: string }[],
) {
  return verifiedSpecialtyCosts([{ employee_id: "rate", specialty }], wages)[0].dailyRate;
}

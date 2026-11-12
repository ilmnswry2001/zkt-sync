import { getDefaultWage } from "./wage-defaults.ts";

type CostAssignment = {
  employee_id: string;
  site_id: string | null;
  specialty: string;
  conflicting: boolean;
};
type WorkshopAttendance = {
  employee_id: string | null;
  site_id: string | null;
  role_label: string | null;
  daily_workshop_reports: { work_site_id: string | null };
};

export function projectCostCrew(verified: CostAssignment[], attendance: WorkshopAttendance[]) {
  const crew = new Map(verified.map((person) => [person.employee_id, person]));
  const saved = new Map<string, { individual: boolean; assignment: CostAssignment }>();
  for (const line of attendance) {
    // The biometric ledger already resolves these same assignments for employees with punches.
    if (!line.employee_id || crew.has(line.employee_id)) continue;
    const site = line.site_id ?? line.daily_workshop_reports.work_site_id;
    if (!site) continue;
    const individual = line.site_id !== null;
    const previous = saved.get(line.employee_id);
    if (!previous || (individual && !previous.individual)) {
      saved.set(line.employee_id, {
        individual,
        assignment: {
          employee_id: line.employee_id,
          site_id: site,
          specialty: line.role_label?.trim() || "بدون صفة",
          conflicting: false,
        },
      });
    } else if (individual === previous.individual && site !== previous.assignment.site_id) {
      previous.assignment.conflicting = true;
    }
  }
  return [...crew.values(), ...Array.from(saved.values(), (item) => item.assignment)];
}
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

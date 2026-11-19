import { getDefaultWage } from "./wage-defaults.ts";
import { normalizeWageTitle } from "./employee-pay-type.ts";

const biometricApprovalNote = "تم الاعتماد آلياً من مطابقة البصمة";
type Wage = { title: string; daily_rate: number; monthly_rate: number; currency: string };
type SpecialtyCount = { name: string; count: number };

export function isBiometricApprovedReport(notes?: string | null) {
  return notes?.split("\n").some((line) => line.trim() === biometricApprovalNote) ?? false;
}

export function clearBiometricApproval(notes: string) {
  return notes.split("\n").filter((line) => line.trim() !== biometricApprovalNote).join("\n").trim();
}

function specialtyCosts(entries: SpecialtyCount[], wages: Wage[]) {
  const counts = new Map<string, SpecialtyCount>();
  for (const entry of entries) {
    const key = normalizeWageTitle(entry.name);
    const item = counts.get(key) ?? { name: entry.name, count: 0 };
    item.count += entry.count;
    counts.set(key, item);
  }
  return Array.from(counts, ([key, item]) => {
    const matches = wages.filter((w) => w.currency === "IQD" && normalizeWageTitle(w.title) === key);
    const wage = matches.find((w) => Number(w.daily_rate) > 0) ??
      matches.find((w) => Number(w.monthly_rate) > 0);
    const dailyRate = wage
      ? Number(wage.daily_rate) > 0 ? Number(wage.daily_rate) : Number(wage.monthly_rate) / 26
      : getDefaultWage(item.name).daily_rate;
    return { ...item, dailyRate, cost: item.count * dailyRate, hasRate: !!wage, usedDefault: !wage };
  });
}

export function approvedBiometricCosts(
  lines: { kind: string; item_name: string; working_count: number | null; total_count: number }[],
  wages: Wage[],
) {
  return specialtyCosts(
    lines.filter((line) => line.kind === "worker_specialty").map((line) => ({
      name: line.item_name.trim() || "بدون صفة",
      count: Math.max(0, Number(line.working_count ?? line.total_count) || 0),
    })),
    wages,
  );
}

export const projectCostVariancePercent = (actual: number, planned: number) =>
  planned > 0 ? ((actual - planned) / planned) * 100 : null;

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
  wages: Wage[],
) {
  const seen = new Set<string>();
  const entries: SpecialtyCount[] = [];
  for (const person of crew) {
    if (seen.has(person.employee_id)) continue;
    seen.add(person.employee_id);
    entries.push({ name: person.specialty.trim() || "بدون صفة", count: 1 });
  }
  return specialtyCosts(entries, wages);
}

export function projectDailyRate(
  specialty: string,
  wages: Wage[],
) {
  return verifiedSpecialtyCosts([{ employee_id: "rate", specialty }], wages)[0].dailyRate;
}

import { approvedBiometricCosts, projectCostVariancePercent } from "./project-execution-costs.ts";
import { roundIqd } from "./site-material-costs.ts";

type WageRates = Parameters<typeof approvedBiometricCosts>[1];
export type FinancialSnapshot = {
  budget: number | null;
  canEditBudget: boolean;
  syncedAt: string;
  approvedReports: number;
  crew: { name: string; period_count: number; cumulative_count: number }[];
  materials: {
    period_cost: number;
    cumulative_cost: number;
    period_unpriced: number;
    cumulative_unpriced: number;
  };
};

export function calculateProjectFinancials(snapshot: FinancialSnapshot, wages: WageRates) {
  const costCrew = (field: "period_count" | "cumulative_count") =>
    approvedBiometricCosts(
      snapshot.crew
        .filter((row) => row[field] > 0)
        .map((row) => ({
          item_name: row.name,
          kind: "worker_specialty",
          total_count: row[field],
          working_count: row[field],
        })),
      wages,
    );
  const crew = costCrew("period_count");
  const labor = roundIqd(crew.reduce((sum, item) => sum + item.cost, 0));
  const material = snapshot.materials.period_cost;
  const cumulativeLabor = roundIqd(
    costCrew("cumulative_count").reduce((sum, item) => sum + item.cost, 0),
  );
  const cumulativeMaterial = snapshot.materials.cumulative_cost;
  const cumulativeActual = roundIqd(cumulativeLabor + cumulativeMaterial);
  const budget = snapshot.budget && snapshot.budget > 0 ? snapshot.budget : null;
  return {
    crew,
    budget,
    labor,
    material,
    actual: roundIqd(labor + material),
    cumulativeLabor,
    cumulativeMaterial,
    cumulativeActual,
    varianceAmount: budget === null ? null : roundIqd(cumulativeActual - budget),
    variancePercent: budget === null ? null : projectCostVariancePercent(cumulativeActual, budget),
    status:
      budget === null
        ? ("unbudgeted" as const)
        : cumulativeActual > budget
          ? ("over" as const)
          : cumulativeActual >= budget * 0.8
            ? ("warning" as const)
            : ("safe" as const),
  };
}

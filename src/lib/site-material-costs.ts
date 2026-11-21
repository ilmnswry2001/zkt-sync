export type MaterialIssueRow = {
  id: string;
  movement_date: string;
  item_name: string;
  item_code: string | null;
  unit: string;
  quantity: number;
  unit_cost: number | null;
  cost: number | null;
  warehouse_name: string;
  notes: string | null;
};

export const roundIqd = (value: number) =>
  (Math.sign(value) *
    Math.round((Math.abs(value) + Math.max(1, Math.abs(value)) * Number.EPSILON) * 100)) /
  100;

export function calculateSiteMaterialCosts<
  T extends { quantity: number; unit_cost: number | null; cost?: number | null },
>(issues: T[]) {
  const items = issues.map((issue) => {
    const quantity = Math.abs(Number(issue.quantity));
    const price = Number(issue.unit_cost);
    const unit_cost = Number.isFinite(price) && price > 0 ? price : null;
    return {
      ...issue,
      quantity,
      unit_cost,
      cost: unit_cost === null ? null : (issue.cost ?? roundIqd(quantity * unit_cost)),
    };
  });
  return {
    items,
    total: roundIqd(items.reduce((sum, item) => sum + (item.cost ?? 0), 0)),
    unpriced: items.filter((item) => item.quantity > 0 && item.unit_cost === null).length,
  };
}

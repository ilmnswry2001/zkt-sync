export type MaterialRequestStatus =
  | "draft"
  | "pending_planning"
  | "returned"
  | "rejected"
  | "pending_warehouse"
  | "pending_procurement"
  | "purchasing"
  | "pending_receipt"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export type MaterialRequestItemState =
  | "pending"
  | "issue_from_stock"
  | "for_purchase"
  | "purchased"
  | "received_full"
  | "received_partial"
  | "not_arrived"
  | "excluded"
  | "not_purchased";

export function defaultStockAllocation(approved: number, available: number) {
  if (!Number.isFinite(approved) || approved < 0 || !Number.isFinite(available) || available < 0) {
    throw new Error("الكميات يجب أن تكون أرقاماً غير سالبة");
  }
  const issue = Math.min(approved, available);
  return { issue, purchase: approved - issue };
}

export function validateStockAllocation(
  approved: number,
  issue: number,
  purchase: number,
  reason: string,
) {
  if ([approved, issue, purchase].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("كميات الصرف والشراء يجب أن تكون أرقاماً غير سالبة");
  }
  if (issue + purchase > approved) {
    throw new Error("مجموع الصرف والشراء يتجاوز الكمية المعتمدة");
  }
  if (issue + purchase < approved && reason.trim().length < 3) {
    throw new Error("سبب إلزامي عند ترك جزء من الكمية المعتمدة");
  }
}

export function validatePurchaseQuantity(required: number, alreadyPurchased: number, next: number) {
  if ([required, alreadyPurchased, next].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("كميات الشراء يجب أن تكون أرقاماً غير سالبة");
  }
  if (alreadyPurchased + next > required) {
    throw new Error("الكمية المشتراة تتجاوز الكمية المطلوبة");
  }
}

export function receiptStatus(
  approved: number,
  issue: number,
  received: number,
  receivedNow: number,
): MaterialRequestItemState {
  if ([approved, issue, received, receivedNow].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("كميات الاستلام يجب أن تكون أرقاماً غير سالبة");
  }
  if (issue + received + receivedNow > approved) {
    throw new Error("الكمية المستلمة تتجاوز الكمية المعتمدة");
  }
  const total = issue + received + receivedNow;
  if (total === 0) return "not_arrived";
  return total >= approved ? "received_full" : "received_partial";
}

export function requestReceiptStatus(
  items: Array<{ approved: number; issue: number; received: number; excluded: boolean }>,
): MaterialRequestStatus {
  const activeItems = items.filter((item) => !item.excluded);
  if (activeItems.every((item) => item.issue + item.received >= item.approved)) return "received";
  return activeItems.some((item) => item.issue + item.received > 0)
    ? "partially_received"
    : "pending_receipt";
}

const allowedTransitions: Record<MaterialRequestStatus, MaterialRequestStatus[]> = {
  draft: ["pending_planning"],
  pending_planning: ["returned", "rejected", "pending_warehouse", "cancelled"],
  returned: ["pending_planning"],
  rejected: ["closed"],
  pending_warehouse: ["pending_procurement", "received"],
  pending_procurement: ["purchasing", "pending_receipt"],
  purchasing: ["pending_receipt"],
  pending_receipt: ["partially_received", "received"],
  partially_received: ["received"],
  received: ["closed"],
  closed: [],
  cancelled: ["closed"],
};

export function canTransitionMaterialRequest(from: MaterialRequestStatus, to: MaterialRequestStatus) {
  return allowedTransitions[from].includes(to);
}
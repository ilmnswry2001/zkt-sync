import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessMaterialRequests,
  canCreateMaterialRequests,
  canTransitionMaterialRequest,
  defaultStockAllocation,
  receiptStatus,
  requestReceiptStatus,
  validatePurchaseQuantity,
  validateStockAllocation,
} from "./material-requests-domain.ts";

test("requests access is limited to requesters, admin, and company manager", () => {
  for (const role of ["engineer", "department_manager", "supervisor", "site_admin"]) {
    assert.equal(canAccessMaterialRequests([role]), true);
    assert.equal(canCreateMaterialRequests([role]), true);
  }
  assert.equal(canAccessMaterialRequests(["admin"]), true);
  assert.equal(canAccessMaterialRequests([], true), true);
  for (const role of [
    "hr",
    "data_entry",
    "planning_officer",
    "warehouse_keeper",
    "procurement_officer",
  ]) {
    assert.equal(canAccessMaterialRequests([role]), false);
    assert.equal(canCreateMaterialRequests([role]), false);
  }
});

test("stock review allocates available stock before procurement", () => {
  assert.deepEqual(defaultStockAllocation(10, 4), { issue: 4, purchase: 6 });
  assert.deepEqual(defaultStockAllocation(3, 9), { issue: 3, purchase: 0 });
});

test("stock allocation enforces approved quantity and a reason for shortages", () => {
  assert.throws(() => validateStockAllocation(10, 7, 4, ""), /يتجاوز/);
  assert.throws(() => validateStockAllocation(10, 4, 4, " "), /سبب إلزامي/);
  assert.doesNotThrow(() => validateStockAllocation(10, 4, 4, "غير متوفر"));
});

test("procurement cannot exceed the outstanding approved quantity", () => {
  assert.doesNotThrow(() => validatePurchaseQuantity(5, 2, 3));
  assert.throws(() => validatePurchaseQuantity(5, 2, 4), /تتجاوز/);
});

test("receipts add only actual quantities and support repeated partial deliveries", () => {
  assert.equal(receiptStatus(5, 0, 0, 2), "received_partial");
  assert.equal(receiptStatus(5, 0, 2, 3), "received_full");
  assert.equal(receiptStatus(5, 0, 0, 0), "not_arrived");
  assert.throws(() => receiptStatus(5, 0, 3, 3), /تتجاوز/);
});

test("request status reflects all lines without losing shortage history", () => {
  assert.equal(
    requestReceiptStatus([
      { approved: 2, issue: 0, received: 2, excluded: false },
      { approved: 3, issue: 0, received: 0, excluded: false },
    ]),
    "partially_received",
  );
  assert.equal(
    requestReceiptStatus([{ approved: 2, issue: 2, received: 0, excluded: false }]),
    "received",
  );
});

test("only documented request transitions are accepted", () => {
  assert.equal(canTransitionMaterialRequest("pending_planning", "pending_warehouse"), true);
  assert.equal(canTransitionMaterialRequest("pending_warehouse", "purchasing"), false);
  assert.equal(canTransitionMaterialRequest("closed", "pending_receipt"), false);
});
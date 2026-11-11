import test from "node:test";
import assert from "node:assert/strict";
import { reorderWorkshopIds } from "./workshop-management.ts";

test("reorders across filtered workshops without dropping hidden workshops", () => {
  const original = ["a", "hidden", "b", "c"];
  assert.deepEqual(reorderWorkshopIds(original, "c", "a"), ["c", "a", "hidden", "b"]);
  assert.deepEqual(original, ["a", "hidden", "b", "c"]);
});
test("moves downward and safely ignores stale drag targets", () => {
  assert.deepEqual(reorderWorkshopIds(["a", "b", "c"], "a", "c"), ["b", "c", "a"]);
  assert.deepEqual(reorderWorkshopIds(["a", "b"], "missing", "b"), ["a", "b"]);
});

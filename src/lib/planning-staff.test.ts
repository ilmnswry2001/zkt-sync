import assert from "node:assert/strict";
import test from "node:test";
import {
  appendStaffNames,
  normalizePersonName,
  normalizeStaffAssignments,
} from "./planning-staff.ts";

test("normalizes only the edges and repeated whitespace of a name", () => {
  assert.equal(normalizePersonName("علي عماد"), "علي عماد");
  assert.equal(normalizePersonName("  علي   عماد "), "علي عماد");
});

test("appends consecutive names to the same specialty", () => {
  const first = appendStaffNames([], "نجار", "علي عماد");
  const second = appendStaffNames(first.assignments, "نجار", "سالم خليل");

  assert.deepEqual(second.assignments, [
    { specialty: "نجار", names: ["علي عماد", "سالم خليل"] },
  ]);
});

test("reads legacy flat assignments and avoids duplicate names", () => {
  const legacy = normalizeStaffAssignments([
    { name: "  علي   عماد ", specialty: "نجار" },
    { name: "علي عماد", specialty: "نجار" },
  ]);

  assert.deepEqual(legacy, [{ specialty: "نجار", names: ["علي عماد"] }]);
});
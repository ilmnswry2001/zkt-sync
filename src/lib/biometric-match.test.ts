import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBiometricMatch } from "./biometric-match.ts";

test("counts one person once and uses the final assigned specialty", () => {
  const result = summarizeBiometricMatch([
    { id: "a", specialty: "old" }, { id: "a", specialty: " new " },
    { id: "b", specialty: "new" }, { id: "c", specialty: "other" },
  ], new Set(["a", "b", "outsider"]));
  assert.equal(result.totalPresent, 2);
  assert.equal(result.totalPlanned, 3);
  assert.deepEqual([...result.presentBySpecialty], [["new", 2]]);
  assert.deepEqual([...result.presentIds], ["a", "b"]);
});

test("a completed match with no punches reports zero attendance", () => {
  const result = summarizeBiometricMatch([{ id: "a", specialty: "worker" }], new Set());
  assert.equal(result.totalPresent, 0);
  assert.equal(result.totalPlanned, 1);
  assert.equal(result.presentBySpecialty.size, 0);
});

test("an empty plan cannot acquire attendance from unrelated punches", () => {
  const result = summarizeBiometricMatch([], new Set(["unassigned"]));
  assert.equal(result.totalPresent, 0);
  assert.equal(result.totalPlanned, 0);
});

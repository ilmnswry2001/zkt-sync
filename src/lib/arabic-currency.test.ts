import assert from "node:assert/strict";
import test from "node:test";
import { amountInArabicIqd } from "./arabic-currency.ts";

test("writes whole dinar values in Arabic words", () => {
  assert.equal(amountInArabicIqd(0), "صفر دينار عراقي فقط لا غير");
  assert.equal(amountInArabicIqd(1250), "ألف ومائتان وخمسون دينار عراقي فقط لا غير");
});

test("includes fractional amounts to match payroll precision", () => {
  assert.equal(amountInArabicIqd(1250.5), "ألف ومائتان وخمسون دينار عراقي وخمسون من مائة دينار فقط لا غير");
});

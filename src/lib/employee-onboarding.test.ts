import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEmployeeMessage,
  requiresDailyOnboardingPay,
  resolveOnboardingWage,
} from "./employee-onboarding.ts";

test("reads an employee message and keeps the device code separate from its PIN", () => {
  const message = "إضافة جديدة\n\nاسم موظف تجريبي\nسائق بيك اب\nاجر شهري\n\nID-٠٦\nAK D25";
  assert.deepEqual(parseEmployeeMessage(message), {
    fullName: "اسم موظف تجريبي",
    position: "سائق بيك اب",
    pin: "06",
    deviceCode: "AK D25",
    payType: "monthly",
  });
  assert.equal(
    parseEmployeeMessage("الاسم: اسم تجريبي\nالتخصص: عامل\nرقم الجهاز: AK D25\nID:۶").pin,
    "6",
  );
  assert.throws(() => parseEmployeeMessage(`${message}\nID-7`), /أكثر من معرف/);
  assert.throws(() => parseEmployeeMessage("اسم تجريبي\nعامل\nID-A6"), /معرّف البصمة/);
});

test("uses daily pay for field specialties and prefers the specific IQD wage", () => {
  for (const title of ["عامل", "الريكر", "مسعفة", "منقذ", "السائقين", "سائق بيك اب"]) {
    assert.equal(requiresDailyOnboardingPay(title), true, title);
  }
  assert.equal(requiresDailyOnboardingPay("محاسب"), false);
  const rates = [
    {
      id: "generic",
      title: "سائق",
      daily_rate: 30000,
      monthly_rate: 780000,
      overtime_hour_rate: null,
      currency: "IQD",
    },
    {
      id: "exact",
      title: "سائق بيك أب",
      daily_rate: 45000,
      monthly_rate: 1100000,
      overtime_hour_rate: null,
      currency: "IQD",
    },
  ];
  const result = resolveOnboardingWage("سائق بيك اب", "monthly", rates);
  assert.equal(result.payType, "daily");
  assert.equal(result.wageRateId, "exact");
  assert.equal(result.amount, 45000);
  assert.equal(resolveOnboardingWage("محاسب", "monthly", []).wageRateId, null);
});

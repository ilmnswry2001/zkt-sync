import test from "node:test";
import assert from "node:assert/strict";
import { getEmployeePayType } from "./employee-pay-type.ts";
import { getDefaultWage } from "./wage-defaults.ts";
import { resolvePayrollWage, allocateAdvanceInstallments } from "./payroll-wage-resolution.ts";
import {
  calculatePayroll,
  buildAttendanceDays,
  summarizeDays,
  monthDates,
} from "./monthly-report.ts";
test("daily specialty detection handles Arabic normalization, separators and rate-only grades", () => {
  for (const position of [
    "عامل/مدني",
    "عاملة نظافة",
    "عاملين سقالات",
    "مسعف+انقاذ",
    "عامل سقالات",
    "الريكر",
    "إِنْقَاذ",
    "نجار",
    "كوسرجي",
    "حداد",
    "صباغ",
    "لحام فابريكيشن",
  ])
    assert.equal(getEmployeePayType({ position, pay_type: "monthly" }), "daily", position);
  assert.equal(getEmployeePayType({ position: "مهندس", salary_type: "DAILY worker" }), "daily");
  assert.equal(getEmployeePayType({ wage_rates: { daily_rate: 30000, monthly_rate: 0 } }), "daily");
  assert.equal(getEmployeePayType({ position: "متعامل تجاري" }), "monthly");
});
test("specialty resolution replaces missing and zero salaries without overriding a positive base", () => {
  const rates = [
    {
      id: "a",
      title: "نجار",
      daily_rate: 40000,
      monthly_rate: 0,
      overtime_hour_rate: 6000,
      currency: "IQD",
    },
  ];
  const wage = resolvePayrollWage({ position: "النجار / مدني", base_salary: 0 }, rates);
  assert.equal(wage.dailyRate, 40000);
  assert.equal(wage.payType, "daily");
  assert.equal(wage.source, "specialty");
  assert.equal(wage.overtimeHourlyRate, 6000);
  assert.equal(
    resolvePayrollWage({ position: "مهندس", base_salary: 900000 }, []).monthlySalary,
    900000,
  );
  assert.equal(
    resolvePayrollWage({ position: "نجار" }, [...rates, { ...rates[0], id: "b" }]).source,
    "default",
    "ambiguous grades require fallback review",
  );
  for (const [role, rate] of [
    ["ريكر", 30000],
    ["مسعف+انقاذ", 25000],
    ["عامل/مدني", 25000],
    ["كوسرجي", 35000],
    ["حداد", 50000],
    ["سائق آلية", 36000],
  ])
    assert.equal(getDefaultWage(String(role)).daily_rate, rate);
});
test("October daily payroll pays only worked days, not WO, holidays or leave", () => {
  const days = buildAttendanceDays(
    monthDates("2026-10"),
    [
      { verify_time: "2026-10-01T05:00:00Z", status: 0 },
      { verify_time: "2026-10-01T14:00:00Z", status: 1 },
    ],
    [
      { work_date: "2026-10-02", status: "rest", notes: null },
      { work_date: "2026-10-03", status: "holiday", notes: null },
      { work_date: "2026-10-04", status: "leave", notes: null, is_paid: true },
    ],
    "17:00",
    "2026-11-11",
    "daily",
  );
  const summary = summarizeDays(days);
  const pay = calculatePayroll({
    payType: "daily",
    dailyRate: 30000,
    monthlySalary: 0,
    daysInMonth: 31,
    summary,
    holidayDays: 1,
  });
  assert.equal(pay.basePay, 30000);
  assert.equal(pay.woDays, 0);
  assert.equal(pay.holidayDays, 0);
  assert.equal(pay.leaveDays, 0);
});
test("advance allocations stop at net salary and retain outstanding installments", () => {
  assert.deepEqual(allocateAdvanceInstallments(0, [{ id: "a", amount: 200 }]), []);
  assert.deepEqual(
    allocateAdvanceInstallments(150, [
      { id: "a", amount: 200, deducted_amount: 100 },
      { id: "b", amount: 100 },
    ]),
    [
      { id: "a", amount: 100 },
      { id: "b", amount: 50 },
    ],
  );
});

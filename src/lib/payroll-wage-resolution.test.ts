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
  payrollAttendancePenalties,
} from "./monthly-report.ts";
test("daily specialty detection handles Arabic normalization, separators and rate-only grades", () => {
  for (const position of [
    "عامل/مدني",
    "عاملة نظافة",
    "عاملين سقالات",
    "العمال",
    "مسعف+انقاذ",
    "مسعفون ميدانيون",
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
test("field workers use the normalized specialty day rate ahead of a legacy monthly grade", () => {
  const grade = { title: "عامل", daily_rate: 44000, monthly_rate: 0, overtime_hour_rate: 5000, currency: "IQD" };
  const wage = resolvePayrollWage({
    position: "العمال / تجهيز", pay_type: "monthly", salary_type: "راتب شهري", base_salary: 800000,
    wage_rates: { ...grade, title: "اداري", daily_rate: 0, monthly_rate: 800000 },
  }, [grade]);
  assert.equal(wage.payType, "daily");
  assert.equal(wage.dailyRate, 44000);
  assert.equal(wage.source, "specialty");
});
test("unworked Fridays and recorded holidays do not generate daily absences or absence deductions", () => {
  const dates = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-13", "2026-11-14"];
  const overrides = [
    { work_date: dates[0], status: "absent", notes: "Old override" },
    { work_date: dates[1], status: "holiday", notes: null },
    { work_date: dates[4], status: "holiday", notes: null },
  ] as const;
  const punches = dates.slice(3).flatMap((date) => [
    { verify_time: `${date}T05:00:00Z`, status: 0 },
    { verify_time: `${date}T13:00:00Z`, status: 1 },
  ]);
  const days = buildAttendanceDays(dates, punches, [...overrides], "16:00", "2026-11-15", "daily");
  assert.deepEqual(days.map(({ status }) => status), ["rest", "holiday", "absent", "present", "present"]);
  assert.ok(days[3].overtime_hours > 0);
  const penalties = payrollAttendancePenalties([
    ...dates.slice(0, 3).map((date) => ({ penalty_date: date, penalty_type: "absence", amount: 1000 })),
    { penalty_date: dates[0], penalty_type: "deduction", amount: 500 },
  ], "daily", [...overrides]);
  assert.deepEqual(penalties.map(({ amount }) => amount), [1000, 500]);
  const summary = summarizeDays(days);
  assert.equal(summary.absentDays, 1);
  const pay = calculatePayroll({
    payType: "daily", monthlySalary: 0, dailyRate: 30000, daysInMonth: 30, summary,
    overtimeHourlyRate: 1000, deductions: penalties.reduce((sum, row) => sum + row.amount, 0),
  });
  assert.equal(pay.basePay, 60000);
  assert.equal(pay.netPay, 60000 + pay.overtimePay - 1500);
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

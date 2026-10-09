import { dateKeyInTimeZone } from "./date-time.ts";

export type DayStatus = "present" | "absent" | "leave" | "holiday" | "rest";
export type ComputedStatus = DayStatus | "incomplete";
export type PayType = "daily" | "monthly";

export const FRIDAY_OVERTIME_HOURS = 10;

export type AttendanceDay = {
  date: string;
  check_in: string | null;
  check_out: string | null;
  hours: number;
  overtime_hours: number;
  status: ComputedStatus | null;
  manual: boolean;
  notes: string | null;
  punches: number;
  is_paid_leave?: boolean;
};

export function buildPenaltyAttendanceOverride(
  penaltyType: "absence" | "deduction" | "warning",
  workDate: string,
  notes?: string | null,
) {
  if (penaltyType !== "absence") return null;

  return {
    work_date: workDate,
    status: "absent" as const,
    notes: (notes ?? "عقوبة غياب").trim() || "عقوبة غياب",
    overtime_hours: 0,
  };
}

export function monthDates(month: string) {
  const [year, number] = month.split("-").map(Number);
  const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function buildAttendanceDays(
  dates: string[],
  logs: { verify_time: string }[],
  overrides: {
    work_date: string;
    status: DayStatus;
    notes: string | null;
    overtime_hours?: number | null;
    is_paid?: boolean;
  }[],
  shiftEnd: string | null | undefined,
  today: string,
  payType: PayType = "monthly",
  graceMinutes = 0,
): AttendanceDay[] {
  const byDay = new Map<string, string[]>();
  for (const log of logs) {
    // UTC string slicing shifted Baghdad after-midnight punches into the previous wage day;
    // assign a punch to the company's civil date before attendance and payroll are counted.
    const date = dateKeyInTimeZone(log.verify_time);
    const times = byDay.get(date) ?? [];
    times.push(log.verify_time);
    byDay.set(date, times);
  }
  const manualDays = new Map(overrides.map((day) => [day.work_date, day]));
  return dates.map((date) => {
    const times = (byDay.get(date) ?? []).sort();
    const first = times[0] ?? null;
    const last = times.length > 1 ? times[times.length - 1] : null;
    // بصمة واحدة فقط (دخول أو خروج) = يوم غير مكتمل ولا يُحتسب حضوراً
    const complete = times.length > 1;
    const friday = isFriday(date);
    const override = manualDays.get(date);
    const hours = complete && first && last ? (Date.parse(last) - Date.parse(first)) / 3600000 : 0;
    const manualOvertime = Number(override?.overtime_hours ?? 0);
    let overtime =
      manualOvertime > 0
        ? manualOvertime
        : complete && last && shiftEnd
          ? (Date.parse(last) - Date.parse(`${date}T${shiftEnd}Z`)) / 3600000 -
            Math.max(0, graceMinutes) / 60
          : 0;
    if (!Number.isFinite(overtime)) overtime = 0;
    // دوام فعلي يوم الجمعة يُمنح 10 ساعات وقت إضافي لأي موظف
    if (friday && complete && manualOvertime <= 0) overtime = FRIDAY_OVERTIME_HOURS;
    const hasAnyPunch = times.length > 0;
    const auto: ComputedStatus | null =
      date > today
        ? null
        : hasAnyPunch
          ? "present"
          : friday && payType === "monthly"
            ? "rest" // WO: راحة أسبوعية للشهري فقط؛ اليومي يُعامل الجمعة كيوم عادي
            : date <= today
              ? "absent"
              : null;
    return {
      date,
      check_in: first,
      check_out: complete ? last : null,
      hours: Math.max(0, Math.round(hours * 100) / 100),
      overtime_hours: Math.max(0, Math.round(overtime * 100) / 100),
      status: override?.status ?? auto,
      manual: !!override,
      notes: override?.notes ?? null,
      punches: times.length,
      is_paid_leave: override?.status === "leave" ? override.is_paid !== false : undefined,
    };
  });
}

export const isFriday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5;

export const roundMoney = (value: number) =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

export function summarizeDays(days: AttendanceDay[]) {
  const summary = {
    presentDays: days.filter((d) => d.status === "present").length,
    absentDays: days.filter((d) => d.status === "absent").length,
    leaveDays: days.filter((d) => d.status === "leave").length,
    unpaidLeaveDays: days.filter((d) => d.status === "leave" && d.is_paid_leave === false).length,
    holidayDays: days.filter((d) => d.status === "holiday" || d.status === "rest").length,
    totalHours: Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 100) / 100,
    totalOvertimeHours: Math.round(days.reduce((sum, d) => sum + d.overtime_hours, 0) * 100) / 100,
    workDays: days.length,
  } as {
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    unpaidLeaveDays: number;
    holidayDays: number;
    totalHours: number;
    totalOvertimeHours: number;
    workDays: number;
    incompleteDays?: number;
    woDays?: number;
    fridayDays?: number;
  };
  Object.defineProperties(summary, {
    incompleteDays: {
      value: days.filter((d) => d.status === "incomplete").length,
      enumerable: false,
    },
    woDays: {
      value: days.filter((d) => isFriday(d.date) && d.status === "rest").length,
      enumerable: false,
    },
    fridayDays: { value: days.filter((d) => isFriday(d.date)).length, enumerable: false },
  });
  return summary;
}

// احتساب الأجر الموحد: الشهري يُقسم على أيام الشهر ويضم الحضور وWO والعطل المعتمدة؛ اليومي يُحتسب على الحضور المكتمل فقط.
export function calculatePayroll(options: {
  payType: PayType;
  monthlySalary: number;
  dailyRate: number;
  daysInMonth: number;
  summary: ReturnType<typeof summarizeDays>;
  holidayDays?: number;
  overtimeHourlyRate?: number;
  additions?: number;
  deductions?: number;
}) {
  const {
    payType,
    monthlySalary,
    dailyRate,
    daysInMonth,
    summary,
    holidayDays = 0,
    overtimeHourlyRate = 0,
    additions = 0,
    deductions = 0,
  } = options;
  const isDaily = payType === "daily";
  const dayRate = isDaily
    ? dailyRate
    : daysInMonth
      ? Math.round((monthlySalary / daysInMonth) * 100) / 100
      : 0;
  const woDays = isDaily ? 0 : (summary.woDays ?? 0);
  const workedDays = summary.presentDays;
  const paidHolidays = isDaily ? 0 : Math.max(0, holidayDays);
  const paidLeaveDays = summary.leaveDays - summary.unpaidLeaveDays;
  const paidDays = workedDays + woDays + paidHolidays + paidLeaveDays;
  const overtimePay = roundMoney(summary.totalOvertimeHours * Math.max(0, overtimeHourlyRate));
  const basePay = roundMoney(dayRate * paidDays);
  // سابقاً كانت صفحات الرواتب تعيد جمع الأساسي والإضافي والإضافات والخصومات كلٌ بطريقته؛ أصبحت المعادلة هنا مصدراً واحداً لمنع اختلاف صافي الراتب بين التقارير.
  const grossPay = roundMoney(basePay + overtimePay);
  const additionsTotal = roundMoney(additions);
  const deductionsTotal = roundMoney(Math.max(0, deductions));
  return {
    payType,
    dayRate,
    workedDays,
    woDays,
    holidayDays: paidHolidays,
    leaveDays: paidLeaveDays,
    unpaidLeaveDays: summary.unpaidLeaveDays,
    paidDays,
    overtimeHours: summary.totalOvertimeHours,
    overtimePay,
    basePay,
    grossPay,
    additions: additionsTotal,
    deductions: deductionsTotal,
    netPay: roundMoney(grossPay + additionsTotal - deductionsTotal),
  };
}

export function dailyTotals(dates: string[], rows: { days: AttendanceDay[] }[], today: string) {
  return dates.map((date, index) => {
    const days = rows.map((row) => row.days[index]);
    const hasStatus = days.some((day) => day.status !== null);
    const count = (status: DayStatus) =>
      date > today && !hasStatus ? null : days.filter((day) => day.status === status).length;
    return { date, present: count("present"), absent: count("absent"), leave: count("leave") };
  });
}

export async function loadAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

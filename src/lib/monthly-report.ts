import { dateKeyInTimeZone, instantAtTimeInTimeZone } from "./date-time.ts";

export type DayStatus = "present" | "absent" | "leave" | "holiday" | "rest";
export type ComputedStatus = DayStatus | "incomplete";
export type PayType = "daily" | "monthly";

export const FRIDAY_OVERTIME_HOURS = 10;

export type AttendancePunch = {
  verify_time: string;
  status?: number | null;
  source?: string | null;
  self_event_type?: string | null;
};

export function summarizeAttendancePunches(
  punches: AttendancePunch[],
  shiftEnd?: string | null,
  graceMinutes = 0,
) {
  const ordered = [...punches].sort((a, b) => Date.parse(a.verify_time) - Date.parse(b.verify_time));
  const events = ordered.map((punch) => {
    if (punch.self_event_type === "check_in") return { punch, type: "in" as const };
    if (punch.self_event_type === "check_out") return { punch, type: "out" as const };
    switch (punch.status) {
      case 0: return { punch, type: "in" as const };
      case 1: return { punch, type: "out" as const };
      case 2: return { punch, type: "break_out" as const };
      case 3: return { punch, type: "break_in" as const };
      case 4: return { punch, type: "overtime_in" as const };
      case 5: return { punch, type: "overtime_out" as const };
      default: return { punch, type: null };
    }
  });
  const hasStructuredEvents = events.some(({ punch }) => punch.status != null || punch.self_event_type != null);
  const pairs = (inType: string, outType: string) => {
    const pending: string[] = [];
    const result: [string, string][] = [];
    for (const { punch, type } of events) {
      if (type === inType) pending.push(punch.verify_time);
      else if (type === outType && pending.length) result.push([pending.shift()!, punch.verify_time]);
    }
    return result;
  };

  // Legacy/manual records without a punch state can only use first/last when both exist.
  const attendancePairs = hasStructuredEvents
    ? pairs("in", "out")
    : ordered.length >= 2 ? [[ordered[0].verify_time, ordered.at(-1)!.verify_time] as [string, string]] : [];
  const breakPairs = hasStructuredEvents ? pairs("break_out", "break_in") : [];
  const overtimePairs = hasStructuredEvents ? pairs("overtime_in", "overtime_out") : [];
  const checkIn = hasStructuredEvents
    ? events.find(({ type }) => type === "in")?.punch.verify_time ?? null
    : ordered[0]?.verify_time ?? null;
  const checkOut = hasStructuredEvents
    ? [...events].reverse().find(({ type }) => type === "out")?.punch.verify_time ?? null
    : ordered.length > 1 ? ordered.at(-1)!.verify_time : null;
  const overlapHours = (start: string, end: string, intervalStart: string, intervalEnd: string) =>
    Math.max(0, Math.min(Date.parse(end), Date.parse(intervalEnd)) - Math.max(Date.parse(start), Date.parse(intervalStart))) / 3600000;
  let hours = attendancePairs.reduce((sum, [start, end]) => sum + (Date.parse(end) - Date.parse(start)) / 3600000, 0);
  for (const [breakStart, breakEnd] of breakPairs) {
    hours -= attendancePairs.reduce((sum, [start, end]) => sum + overlapHours(start, end, breakStart, breakEnd), 0);
  }

  const shiftEndAt = shiftEnd && checkOut
    ? instantAtTimeInTimeZone(dateKeyInTimeZone(checkOut), shiftEnd)
    : null;
  let overtime = overtimePairs.reduce((sum, [start, end]) => {
    const billableStart = shiftEndAt ? Math.max(Date.parse(start), Date.parse(shiftEndAt)) : Date.parse(start);
    return sum + Math.max(0, Date.parse(end) - billableStart) / 3600000;
  }, 0);
  if (attendancePairs.length && !overtimePairs.length && checkOut && shiftEndAt) {
    overtime = Math.max(0, (Date.parse(checkOut) - Date.parse(shiftEndAt)) / 3600000 - Math.max(0, graceMinutes) / 60);
  }
  return {
    check_in: checkIn,
    check_out: checkOut,
    hours: Math.max(0, hours),
    overtime_hours: Math.max(0, overtime),
    complete: attendancePairs.length > 0,
    has_punch: ordered.length > 0,
    punches: ordered.length,
    event_details: events.map(({ punch, type }) => ({ verify_time: punch.verify_time, type })),
  };
}

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

export type WeeklyShiftSchedule = {
  employee_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  effective_from: string;
  effective_until: string | null;
};

export type AttendanceDailyOvertime = {
  employee_id: string;
  work_date: string;
  overtime_hours: number;
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
  logs: AttendancePunch[],
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
  weeklySchedules: WeeklyShiftSchedule[] = [],
  storedOvertime: AttendanceDailyOvertime[] = [],
): AttendanceDay[] {
  const byDay = new Map<string, AttendancePunch[]>();
  for (const log of logs) {
    // UTC string slicing shifted Baghdad after-midnight punches into the previous wage day;
    // assign a punch to the company's civil date before attendance and payroll are counted.
    const date = dateKeyInTimeZone(log.verify_time);
    const dayPunches = byDay.get(date) ?? [];
    dayPunches.push(log);
    byDay.set(date, dayPunches);
  }
  const manualDays = new Map(overrides.map((day) => [day.work_date, day]));
  const storedOvertimeByDate = new Map(storedOvertime.map((item) => [item.work_date, item.overtime_hours]));
  return dates.map((date) => {
    const times = byDay.get(date) ?? [];
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const schedule = weeklySchedules
      .filter((item) => item.weekday === weekday && item.effective_from <= date &&
        (item.effective_until == null || item.effective_until >= date))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    const attendance = summarizeAttendancePunches(
      times,
      schedule?.end_time ?? shiftEnd,
      schedule?.grace_minutes ?? graceMinutes,
    );
    const complete = attendance.complete;
    const friday = isFriday(date);
    const override = manualDays.get(date);
    const manualOvertime = Number(override?.overtime_hours ?? 0);
    const calculatedOvertime = storedOvertimeByDate.get(date);
    let overtime = manualOvertime > 0
      ? manualOvertime
      : complete
        ? calculatedOvertime == null ? attendance.overtime_hours : Number(calculatedOvertime)
        : 0;
    // دوام فعلي يوم الجمعة يُمنح 10 ساعات وقت إضافي لأي موظف
    if (friday && complete && manualOvertime <= 0) overtime = FRIDAY_OVERTIME_HOURS;
    const hasAnyPunch = attendance.has_punch;
    const auto: ComputedStatus | null =
      date > today
        ? null
        : hasAnyPunch
          ? complete ? "present" : "incomplete"
          : friday && payType === "monthly"
            ? "rest" // WO: راحة أسبوعية للشهري فقط؛ اليومي يُعامل الجمعة كيوم عادي
            : date <= today
              ? "absent"
              : null;
    return {
      date,
      check_in: attendance.check_in,
      check_out: attendance.check_out,
      hours: Math.round(attendance.hours * 100) / 100,
      overtime_hours: Math.max(0, Math.round(overtime * 100) / 100),
      status: override?.status ?? auto,
      manual: !!override,
      notes: override?.notes ?? null,
      punches: attendance.punches,
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

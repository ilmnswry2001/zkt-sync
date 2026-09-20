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
};

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
  }[],
  shiftEnd: string | null | undefined,
  today: string,
): AttendanceDay[] {
  const byDay = new Map<string, string[]>();
  for (const log of logs) {
    const date = log.verify_time.slice(0, 10);
    const times = byDay.get(date) ?? [];
    times.push(log.verify_time);
    byDay.set(date, times);
  }
  const manualDays = new Map(overrides.map((day) => [day.work_date, day]));
  return dates.map((date) => {
    const times = (byDay.get(date) ?? []).sort();
    const first = times[0] ?? null;
    const last = times.length > 1 ? times[times.length - 1] : null;
    const override = manualDays.get(date);
    const hours = first && last ? (Date.parse(last) - Date.parse(first)) / 3600000 : 0;
    const manualOvertime = Number(override?.overtime_hours ?? 0);
    const overtime =
      manualOvertime > 0
        ? manualOvertime
        : last && shiftEnd
          ? (Date.parse(last) - Date.parse(`${date}T${shiftEnd}Z`)) / 3600000
          : 0;
    return {
      date,
      check_in: first,
      check_out: last,
      hours: Math.max(0, Math.round(hours * 100) / 100),
      overtime_hours: Number.isFinite(overtime) ? Math.max(0, Math.round(overtime * 100) / 100) : 0,
      status: override?.status ?? (times.length ? "present" : date <= today ? "absent" : null),
      manual: !!override,
      notes: override?.notes ?? null,
      punches: times.length,
    };
  });
}

export const isFriday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5;

export function summarizeDays(days: AttendanceDay[]) {
  return {
    presentDays: days.filter((d) => d.status === "present").length,
    absentDays: days.filter((d) => d.status === "absent").length,
    leaveDays: days.filter((d) => d.status === "leave").length,
    holidayDays: days.filter((d) => d.status === "holiday" || d.status === "rest").length,
    fridayDays: days.filter((d) => isFriday(d.date)).length,
    totalHours: Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 100) / 100,
    totalOvertimeHours: Math.round(days.reduce((sum, d) => sum + d.overtime_hours, 0) * 100) / 100,
    workDays: days.length,
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

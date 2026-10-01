import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAttendanceDays,
  buildPenaltyAttendanceOverride,
  dailyTotals,
  loadAllRows,
  monthDates,
  summarizeDays,
} from "./monthly-report.ts";

test("calendar handles leap years, short months, and December", () => {
  assert.equal(monthDates("2024-02").length, 29);
  assert.equal(monthDates("2026-02").length, 28);
  assert.equal(monthDates("2026-09").at(-1), "2026-09-30");
  assert.equal(monthDates("2026-12").at(-1), "2026-12-31");
});

test("absence penalties override live punches and show as absent in month summary", () => {
  const override = buildPenaltyAttendanceOverride("absence", "2026-09-01", "عقوبة غياب");
  const days = buildAttendanceDays(
    ["2026-09-01"],
    [{ verify_time: "2026-09-01T08:00:00Z" }, { verify_time: "2026-09-01T17:00:00Z" }],
    [override!],
    "16:00:00",
    "2026-09-01",
  );

  assert.deepEqual(override, {
    work_date: "2026-09-01",
    status: "absent",
    notes: "عقوبة غياب",
    overtime_hours: 0,
  });
  assert.equal(days[0].status, "absent");
  assert.equal(days[0].manual, true);
  assert.equal(summarizeDays(days).absentDays, 1);
});

test("merged punches use first entry and last exit, and manual status takes precedence", () => {
  const days = buildAttendanceDays(
    ["2026-09-01", "2026-09-02", "2026-09-03"],
    [
      { verify_time: "2026-09-01T17:30:00Z" },
      { verify_time: "2026-09-01T08:00:00Z" },
      { verify_time: "2026-09-02T09:00:00Z" },
      { verify_time: "2026-09-01T12:00:00Z" },
    ],
    [{ work_date: "2026-09-01", status: "leave", notes: "إجازة معتمدة" }],
    "16:00:00",
    "2026-09-03",
  );
  assert.equal(days[0].check_in, "2026-09-01T08:00:00Z");
  assert.equal(days[0].check_out, "2026-09-01T17:30:00Z");
  assert.equal(days[0].hours, 9.5);
  assert.equal(days[0].overtime_hours, 1.5);
  assert.equal(days[0].status, "leave");
  assert.equal(days[0].manual, true);
  assert.equal(days[0].notes, "إجازة معتمدة");
  assert.equal(days[1].status, "present");
  assert.equal(days[1].check_out, null);
  assert.equal(days[1].hours, 0);
  assert.equal(days[2].status, "absent");
  assert.deepEqual(summarizeDays(days), {
    presentDays: 1,
    absentDays: 1,
    leaveDays: 1,
    holidayDays: 0,
    totalHours: 9.5,
    totalOvertimeHours: 1.5,
    workDays: 3,
  });
});

test("future days remain blank, while planned leave and rest remain visible", () => {
  const dates = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"];
  const days = buildAttendanceDays(
    dates,
    [],
    [
      { work_date: "2026-09-18", status: "leave", notes: null },
      { work_date: "2026-09-19", status: "rest", notes: null },
    ],
    null,
    "2026-09-16",
  );
  assert.deepEqual(
    days.map((d) => d.status),
    ["absent", null, "leave", "rest"],
  );
  assert.equal(summarizeDays(days).absentDays, 1);
  assert.equal(summarizeDays(days).holidayDays, 1);
  assert.equal(dailyTotals(dates, [{ days }], "2026-09-16")[1].absent, null);
  assert.equal(dailyTotals(dates, [{ days }], "2026-09-16")[2].leave, 1);
});

test("removing a manual override restores the punch-derived status", () => {
  const dates = ["2026-09-01"];
  const logs = [{ verify_time: "2026-09-01T08:00:00Z" }];
  const manual = buildAttendanceDays(
    dates,
    logs,
    [{ work_date: dates[0], status: "absent", notes: null }],
    null,
    dates[0],
  );
  const automatic = buildAttendanceDays(dates, logs, [], null, dates[0]);
  assert.equal(manual[0].status, "absent");
  assert.equal(automatic[0].status, "present");
  assert.equal(automatic[0].manual, false);
});

test("chart counts the supplied filtered employees, including employees with no punches", () => {
  const dates = ["2026-09-01", "2026-09-02"];
  const present = {
    days: buildAttendanceDays(dates, [{ verify_time: "2026-09-01T08:00:00Z" }], [], null, dates[1]),
  };
  const absent = { days: buildAttendanceDays(dates, [], [], null, dates[1]) };
  assert.deepEqual(dailyTotals(dates, [present, absent], dates[1]), [
    { date: dates[0], present: 1, absent: 1, leave: 0 },
    { date: dates[1], present: 0, absent: 2, leave: 0 },
  ]);
  assert.equal(dailyTotals(dates, [present], dates[1])[0].absent, 0);
});

test("pagination reads beyond Supabase's default 1000-row limit", async () => {
  const source = Array.from({ length: 2031 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const rows = await loadAllRows(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });
  assert.deepEqual(rows, source);
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("pagination propagates database failures instead of returning a partial report", async () => {
  await assert.rejects(
    loadAllRows(async (from) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
        : { data: null, error: { message: "تعذر قراءة البيانات" } },
    ),
    /تعذر قراءة البيانات/,
  );
});

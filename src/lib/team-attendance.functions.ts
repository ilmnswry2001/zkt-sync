import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dateKeyInTimeZone, monthInstantRangeInBaghdad } from "@/lib/date-time";
import { summarizeAttendancePunches, type AttendancePunch } from "@/lib/monthly-report";

export const getTeamAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        employeeIds: z.array(z.string().uuid()).min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data: { month, employeeIds }, context: { supabase } }) => {
    const range = monthInstantRangeInBaghdad(month);
    const punchesByEmployeeDay = new Map<string, Map<string, AttendancePunch[]>>();
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("employee_id, verify_time, status, source, self_event_type")
        .in("employee_id", employeeIds)
        .gte("verify_time", range.start)
        .lt("verify_time", range.end)
        .order("verify_time")
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      for (const row of data) {
        if (!row.employee_id) continue;
        const days =
          punchesByEmployeeDay.get(row.employee_id) ?? new Map<string, AttendancePunch[]>();
        const date = dateKeyInTimeZone(row.verify_time);
        const punches = days.get(date) ?? [];
        punches.push(row);
        days.set(date, punches);
        punchesByEmployeeDay.set(row.employee_id, days);
      }
      if (data.length < pageSize) break;
    }
    return Object.fromEntries(
      [...punchesByEmployeeDay].map(([id, days]) => [
        id,
        [...days.values()].filter((punches) => summarizeAttendancePunches(punches).complete).length,
      ]),
    );
  });

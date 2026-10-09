import { createFileRoute } from "@tanstack/react-router";
import webpush from "web-push";

function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function localDateParts(date: Date) {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key: string) => values.find((part) => part.type === key)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const Route = createFileRoute("/api/public/attendance-reminders")({
  server: { handlers: { POST: async ({ request }) => {
    const supplied = request.headers.get("X-Cron-Secret") ?? "";
    const secret = process.env.ATTENDANCE_CRON_SECRET ?? "";
    if (!sameSecret(supplied, secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) return Response.json({ error: "Web Push is not configured" }, { status: 503 });
    webpush.setVapidDetails(subject, publicKey, privateKey);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const now = new Date();
      const local = localDateParts(now);
      const { data: shifts, error: shiftsError } = await admin.from("employee_weekly_schedules")
        .select("employee_id, start_time, end_time, effective_from, effective_until, employees!inner(id, email)")
        .eq("weekday", local.weekday).lte("effective_from", local.date)
        .or(`effective_until.is.null,effective_until.gte.${local.date}`);
      if (shiftsError) throw shiftsError;
      const { data: subscriptions, error: subscriptionsError } = await admin.from("attendance_push_subscriptions")
        .select("employee_id, subscription");
      if (subscriptionsError) throw subscriptionsError;
      const subscriptionsByEmployee = new Map<string, any[]>();
      for (const item of subscriptions ?? []) subscriptionsByEmployee.set(item.employee_id, [...(subscriptionsByEmployee.get(item.employee_id) ?? []), item.subscription]);
      let sent = 0;
      for (const shift of shifts ?? []) {
        const employeeId = shift.employee_id;
        const subs = subscriptionsByEmployee.get(employeeId) ?? [];
        if (!subs.length) continue;
        const { data: leave } = await admin.from("forms").select("id").eq("employee_id", employeeId).eq("kind", "leave")
          .in("status", ["pending_execution", "executed"]).lte("work_date", local.date).gte("leave_end_date", local.date).limit(1);
        if (leave?.length) continue;
        const startMinutes = Number(String(shift.start_time).slice(0, 2)) * 60 + Number(String(shift.start_time).slice(3, 5));
        const endMinutes = Number(String(shift.end_time).slice(0, 2)) * 60 + Number(String(shift.end_time).slice(3, 5));
        const beforeShift = startMinutes - local.minutes > 0 && startMinutes - local.minutes <= 10;
        const afterShift = local.minutes >= endMinutes;
        const kind: "before_shift" | "missing_checkout" | null = beforeShift ? "before_shift" : afterShift ? "missing_checkout" : null;
        if (!kind) continue;
        if (kind === "missing_checkout") {
          const { data: checkout } = await admin.from("attendance_logs").select("id").eq("employee_id", employeeId)
            .gte("verify_time", `${local.date}T00:00:00+03:00`).lt("verify_time", `${local.date}T23:59:59+03:00`)
            .or("self_event_type.eq.check_out,verify_type.eq.1").limit(1);
          if (checkout?.length) continue;
        }
        const { data: alreadySent } = await admin.from("attendance_push_reminders").select("id").eq("employee_id", employeeId)
          .eq("reminder_date", local.date).eq("reminder_type", kind).maybeSingle();
        if (alreadySent) continue;
        const message = kind === "before_shift" ? "يبدأ دوامك خلال 10 دقائق. سجّل حضورك عند الوصول." : "انتهى وقت الدوام ولم يُسجّل انصرافك بعد.";
        let delivered = false;
        for (const subscription of subs) {
          try { await webpush.sendNotification(subscription, JSON.stringify({ title: "تذكير الحضور والانصراف", body: message, url: "/self-attendance", tag: `${kind}-${local.date}` })); delivered = true; }
          catch (error: any) { if (error.statusCode === 404 || error.statusCode === 410) await admin.from("attendance_push_subscriptions").delete().eq("employee_id", employeeId).eq("endpoint", subscription.endpoint); }
        }
        if (delivered) {
          const { error } = await admin.from("attendance_push_reminders").insert({ employee_id: employeeId, reminder_date: local.date, reminder_type: kind });
          if (!error) sent++;
        }
      }
      return Response.json({ sent, evaluated: (shifts ?? []).length });
    } catch (error) {
      console.error("Attendance reminder job failed", error);
      return Response.json({ error: "Reminder service unavailable" }, { status: 503 });
    }
  } } },
});

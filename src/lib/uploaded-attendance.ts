export type UploadPunch = { user_pin: string; verify_time: string; external_id: number; verify_type: number; status: number };

export const punchTimeZones = ["Asia/Baghdad", "UTC"] as const;
export type PunchTimeZone = (typeof punchTimeZones)[number];

export function parsePunchTime(input: string, timeZone: PunchTimeZone = "Asia/Baghdad") {
  const value = input.trim();
  const timestamp = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value
    : `${value.replace(" ", "T")}${timeZone === "UTC" ? "Z" : "+03:00"}`;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`وقت بصمة غير صالح: ${value}`);
  }
  return timestamp;
}

export function resolveUploadPunchTimeZone(
  configured: PunchTimeZone | null,
  status: string,
): PunchTimeZone {
  // Older interrupted imports already used UTC. Keep their batch retries consistent.
  return configured ?? (status === "pending" ? "Asia/Baghdad" : "UTC");
}

export async function processUploadedAttendance(
  logs: UploadPunch[],
  submit: (offset: number, logs: UploadPunch[]) => Promise<{ inserted: number; duplicates: number; unmatched: number }>,
  timeZone: PunchTimeZone = "Asia/Baghdad",
) {
  const total = { inserted: 0, duplicates: 0, unmatched: 0 };
  for (let offset = 0; offset < logs.length; offset += 1000) {
    const chunk = logs.slice(offset, offset + 1000).map((log) => {
      return { ...log, user_pin: log.user_pin.trim(), verify_time: parsePunchTime(log.verify_time, timeZone) };
    });
    const result = await submit(offset, chunk);
    total.inserted += result.inserted;
    total.duplicates += result.duplicates;
    total.unmatched += result.unmatched;
  }
  return total;
}

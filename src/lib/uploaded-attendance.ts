export type UploadPunch = { user_pin: string; verify_time: string; external_id: number; verify_type: number; status: number };

export async function processUploadedAttendance(
  logs: UploadPunch[],
  submit: (offset: number, logs: UploadPunch[]) => Promise<{ inserted: number; duplicates: number; unmatched: number }>,
) {
  const total = { inserted: 0, duplicates: 0, unmatched: 0 };
  for (let offset = 0; offset < logs.length; offset += 1000) {
    const chunk = logs.slice(offset, offset + 1000).map((log) => {
      const value = log.verify_time.trim();
      const time = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
      if (Number.isNaN(time.getTime())) throw new Error(`وقت بصمة غير صالح: ${value}`);
      return { ...log, user_pin: log.user_pin.trim(), verify_time: time.toISOString() };
    });
    const result = await submit(offset, chunk);
    total.inserted += result.inserted;
    total.duplicates += result.duplicates;
    total.unmatched += result.unmatched;
  }
  return total;
}
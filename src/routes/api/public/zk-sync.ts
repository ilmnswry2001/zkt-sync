import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  serial: z.string().trim().min(1).max(64),
  logs: z.array(z.object({
    user_pin: z.string().trim().min(1).max(48),
    verify_time: z.string().datetime({ offset: true }),
    verify_type: z.number().int().optional().default(0),
    status: z.number().int().nullable().optional(),
    external_id: z.number().int().optional().nullable(),
  }).strict()).max(5000),
}).strict();

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function hmac(key: string, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value))));
}
function safeEqual(a: string, b: string) {
  if (!/^[a-f\d]{64}$/i.test(a) || !/^[a-f\d]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function describeIngestionError(error: unknown): string {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof value.message === "string" ? value.message : error instanceof Error ? error.message : String(error);
  const code = typeof value.code === "string" ? `[${value.code}] ` : "";
  const details = typeof value.details === "string" ? ` — ${value.details}` : "";
  const hint = typeof value.hint === "string" ? ` — Hint: ${value.hint}` : "";
  return `${code}${message}${details}${hint}`.replace(/\s+/g, " ").slice(0, 700) || "Unknown ingestion error";
}

export const Route = createFileRoute("/api/public/zk-sync")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = request.headers.get("X-Device-Key") ?? "";
    const signature = request.headers.get("X-Signature") ?? "";
    const timestamp = request.headers.get("X-Timestamp") ?? "";
    if (!secret || secret.length > 256 || !/^\d{10,13}$/.test(timestamp)) return json({ error: "Unauthorized" }, 401);
    const timeMs = Number(timestamp) * (timestamp.length === 10 ? 1000 : 1);
    if (!Number.isFinite(timeMs) || Math.abs(Date.now() - timeMs) > 5 * 60_000) return json({ error: "Expired request" }, 401);
    const size = Number(request.headers.get("content-length") ?? 0);
    if (size > 2_000_000) return json({ error: "Payload too large" }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2_000_000) return json({ error: "Payload too large" }, 413);
    if (!safeEqual(signature, await hmac(secret, `${timestamp}.${raw}`))) return json({ error: "Unauthorized" }, 401);
    let payload: z.infer<typeof schema>;
    try { payload = schema.parse(JSON.parse(raw)); } catch { return json({ error: "Invalid payload" }, 400); }
    let batchDeviceId: string | null = null;
    let syncBatchId: string | null = null;
    let syncRecordIds: string[] = [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const { data: key, error: keyError } = await admin.from("device_sync_keys").select("device_id")
        .eq("key_hash", await sha256(secret)).is("revoked_at", null).maybeSingle();
      if (keyError) throw keyError;
      if (!key) return json({ error: "Unauthorized" }, 401);
      const { data: device, error: deviceError } = await admin.from("devices").select("id, serial_number, status, auto_synced_logs_total")
        .eq("id", key.device_id).maybeSingle();
      if (deviceError) throw deviceError;
      if (!device || device.serial_number !== payload.serial || device.status !== "active") return json({ error: "Unauthorized" }, 401);
      batchDeviceId = device.id;

      const { data: batch, error: batchError } = await admin.from("sync_batches")
        .insert({ device_id: device.id, record_count: payload.logs.length, inserted_count: 0, duplicate_count: 0, unmatched_count: 0, error_count: 0, error_details: [] })
        .select("id").single();
      if (batchError) throw batchError;
      syncBatchId = batch.id;
      const rawRecords = payload.logs.map((log) => ({
        id: crypto.randomUUID(), sync_batch_id: syncBatchId, device_id: device.id, user_pin: log.user_pin,
        verify_time: new Date(log.verify_time).toISOString(), verify_type: log.verify_type, status: log.status ?? null,
        external_log_id: log.external_id ?? null, processing_status: "pending",
      }));
      syncRecordIds = rawRecords.map((record) => record.id);
      for (let i = 0; i < rawRecords.length; i += 500) {
        const { error } = await admin.from("device_sync_records").insert(rawRecords.slice(i, i + 500));
        if (error) throw error;
      }

      const pins = [...new Set(payload.logs.map((log) => log.user_pin))];
      const byEmployeeNo = new Map<string, { id: string; employee_no: string; attendance_device_id: string | null }>();
      const byDeviceId = new Map<string, { id: string; employee_no: string; attendance_device_id: string | null }>();
      const ambiguousDeviceIds = new Set<string>();
      let hasAttendanceDeviceId = true;
      for (let i = 0; i < pins.length; i += 500) {
        const chunk = pins.slice(i, i + 500);
        const { data: numberMatches, error: numberError } = await admin.from("employees")
          .select("id, employee_no").in("employee_no", chunk);
        if (numberError) throw numberError;
        for (const row of numberMatches ?? []) byEmployeeNo.set(row.employee_no, { ...row, attendance_device_id: null });
        if (hasAttendanceDeviceId) {
          const { data: deviceMatches, error: deviceError } = await admin.from("employees")
            .select("id, employee_no, attendance_device_id").in("attendance_device_id", chunk);
          if (deviceError) {
            const missingOptionalColumn = deviceError.code === "PGRST204" || deviceError.code === "42703" ||
              /attendance_device_id.*(schema cache|does not exist|not found)|column .*attendance_device_id/i.test(deviceError.message ?? "");
            if (!missingOptionalColumn) throw deviceError;
            hasAttendanceDeviceId = false;
            console.warn("[ZKTeco sync] employees.attendance_device_id is not available; matching attendance by employee_no only.");
            continue;
          }
          for (const row of deviceMatches ?? []) {
            const pin = String(row.attendance_device_id ?? "").trim();
            const previous = byDeviceId.get(pin);
            if (previous && previous.id !== row.id) ambiguousDeviceIds.add(pin);
            else byDeviceId.set(pin, row);
          }
        }
      }
      const employeeByPin = new Map<string, { id: string; employee_no: string }>();
      for (const pin of pins) {
        if (ambiguousDeviceIds.has(pin)) continue;
        const employee = byDeviceId.get(pin) ?? byEmployeeNo.get(pin);
        if (employee) employeeByPin.set(pin, employee);
      }
      const unmatched = payload.logs.filter((log) => !employeeByPin.has(log.user_pin)).length;
      const logRows = payload.logs.flatMap((log, index) => {
        const employee = employeeByPin.get(log.user_pin);
        return employee ? [{ sync_record_id: syncRecordIds[index], employee_no: employee.employee_no, employee_id: employee.id, device_id: device.id, upload_id: null,
          verify_time: new Date(log.verify_time).toISOString(), verify_type: log.verify_type, status: log.status ?? null,
          external_log_id: log.external_id ?? null, source: "zk_agent" }] : [];
      });
      const logKey = (row: { employee_no: string; verify_time: string; device_id: string }) => `${row.employee_no}|${Date.parse(row.verify_time)}|${row.device_id}`;
      const uniqueLogRows: typeof logRows = [];
      const duplicateInputIds = new Set<string>();
      const logIndexByKey = new Map<string, number>();
      for (const row of logRows) {
        const key = logKey(row);
        const existingIndex = logIndexByKey.get(key);
        if (existingIndex === undefined) {
          logIndexByKey.set(key, uniqueLogRows.length);
          uniqueLogRows.push(row);
        } else {
          duplicateInputIds.add(uniqueLogRows[existingIndex].sync_record_id);
          uniqueLogRows[existingIndex] = row;
        }
      }
      let inserted = 0;
      const insertedLogKeys = new Set<string>();
      for (let i = 0; i < uniqueLogRows.length; i += 500) {
        const chunk = uniqueLogRows.slice(i, i + 500);
        const { data, error } = await admin.from("attendance_logs")
          .upsert(chunk.map(({ sync_record_id: _syncRecordId, ...row }) => row), {
            onConflict: "employee_no,verify_time",
            ignoreDuplicates: true,
          })
          .select("employee_no, verify_time, device_id");
        if (error) throw error;
        for (const row of data ?? []) {
          const key = logKey(row);
          inserted++;
          insertedLogKeys.add(key);
        }
      }
      const duplicates = logRows.length - inserted;
      const logRowByRecordId = new Map(logRows.map((row) => [row.sync_record_id, row]));
      const updates = payload.logs.map((log, index) => {
        const employee = employeeByPin.get(log.user_pin);
        const rawRecord = rawRecords[index];
        if (!employee) return { ...rawRecord, processing_status: "unmatched", error_message: "رقم المستخدم في الجهاز غير مرتبط بموظف" };
        const row = logRowByRecordId.get(syncRecordIds[index])!;
        const isInserted = !duplicateInputIds.has(syncRecordIds[index]) && insertedLogKeys.has(logKey(row));
        return { ...rawRecord, employee_no: employee.employee_no, employee_id: employee.id, processing_status: isInserted ? "inserted" : "duplicate", error_message: null };
      });
      for (let i = 0; i < updates.length; i += 500) {
        const { error } = await admin.from("device_sync_records").upsert(updates.slice(i, i + 500), { onConflict: "id" });
        if (error) throw error;
      }
      const { error: syncError } = await admin.from("devices").update({ last_sync_at: new Date().toISOString(), auto_last_sync_at: new Date().toISOString(), auto_synced_logs_total: Number(device.auto_synced_logs_total ?? 0) + inserted }).eq("id", device.id);
      if (syncError) throw syncError;
      const { error: batchUpdateError } = await admin.from("sync_batches").update({
        inserted_count: inserted, duplicate_count: duplicates, unmatched_count: unmatched, error_count: 0, error_details: [],
      }).eq("id", syncBatchId);
      if (batchUpdateError) throw batchUpdateError;
      return json({ inserted, duplicates, unmatched });
    } catch (error) {
      const requestId = crypto.randomUUID();
      console.error(`[ZKTeco sync v2] failed (request ${requestId})`, error);
      if (syncRecordIds.length) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as any;
          for (let i = 0; i < syncRecordIds.length; i += 500) {
            const { error: recordError } = await admin.from("device_sync_records").update({ processing_status: "error", error_message: describeIngestionError(error) })
              .in("id", syncRecordIds.slice(i, i + 500)).eq("processing_status", "pending");
            if (recordError) console.error(`[ZKTeco sync v2] failed to annotate records (request ${requestId})`, recordError);
          }
        } catch { /* preserve the original response */ }
      }
      if (syncBatchId) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error: batchError } = await (supabaseAdmin as any).from("sync_batches").update({ error_count: payload.logs.length,
            error_details: [{ message: describeIngestionError(error), request_id: requestId }] }).eq("id", syncBatchId);
          if (batchError) console.error(`[ZKTeco sync v2] failed to annotate batch (request ${requestId})`, batchError);
        } catch { /* preserve the original response */ }
      } else if (batchDeviceId) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await (supabaseAdmin as any).from("sync_batches").insert({ device_id: batchDeviceId, record_count: payload.logs.length,
            inserted_count: 0, duplicate_count: 0, unmatched_count: 0, error_count: payload.logs.length,
            error_details: [{ message: describeIngestionError(error), request_id: requestId }] });
        } catch { /* keep the original API error response */ }
      }
      return json({ error: "Sync service unavailable", request_id: requestId }, 503);
    }
  } } },
});

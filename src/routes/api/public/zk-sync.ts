import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  serial: z.string().trim().min(1).max(64),
  logs: z.array(z.object({
    user_pin: z.string().trim().min(1).max(48),
    verify_time: z.string().datetime({ offset: true }),
    verify_type: z.number().int().optional().default(0),
    status: z.number().int().optional().default(0),
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

      const pins = [...new Set(payload.logs.map((log) => log.user_pin))];
      const employees = new Map<string, string>();
      for (let i = 0; i < pins.length; i += 500) {
        const { data, error } = await admin.from("employees").select("id, employee_no").in("employee_no", pins.slice(i, i + 500));
        if (error) throw error;
        for (const row of data ?? []) employees.set(row.employee_no, row.id);
      }
      const knownPins = new Set(employees.keys());
      const unmatched = payload.logs.filter((log) => !knownPins.has(log.user_pin)).length;
      const logRows = payload.logs.filter((log) => knownPins.has(log.user_pin)).map((log) => ({
        employee_no: log.user_pin, employee_id: employees.get(log.user_pin), device_id: device.id, upload_id: null,
        verify_time: new Date(log.verify_time).toISOString(), verify_type: log.verify_type, status: log.status,
        external_log_id: log.external_id ?? null, source: "zk_agent",
      }));
      let inserted = 0;
      for (let i = 0; i < logRows.length; i += 500) {
        const { data, error } = await admin.from("attendance_logs")
          .upsert(logRows.slice(i, i + 500), { onConflict: "employee_no,verify_time,device_id", ignoreDuplicates: true }).select("id");
        if (error) throw error;
        inserted += data?.length ?? 0;
      }
      const duplicates = logRows.length - inserted;
      const { error: syncError } = await admin.from("devices").update({ last_sync_at: new Date().toISOString(), auto_last_sync_at: new Date().toISOString(), auto_synced_logs_total: Number(device.auto_synced_logs_total ?? 0) + inserted }).eq("id", device.id);
      if (syncError) throw syncError;
      const { error: batchError } = await admin.from("sync_batches").insert({
        device_id: device.id, record_count: payload.logs.length, inserted_count: inserted,
        duplicate_count: duplicates, unmatched_count: unmatched, error_count: 0, error_details: [],
      });
      if (batchError) throw batchError;
      return json({ inserted, duplicates, unmatched });
    } catch (error) {
      console.error("[ZKTeco sync v2] failed", error);
      if (batchDeviceId) {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await (supabaseAdmin as any).from("sync_batches").insert({ device_id: batchDeviceId, record_count: payload.logs.length,
            inserted_count: 0, duplicate_count: 0, unmatched_count: 0, error_count: payload.logs.length,
            error_details: [{ message: error instanceof Error ? error.message.slice(0, 300) : "ingestion error" }] });
        } catch { /* keep the original API error response */ }
      }
      return json({ error: "Sync service unavailable" }, 503);
    }
  } } },
});

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("poll"), serial: z.string().trim().min(1).max(64) }).strict(),
  z.object({
    action: z.literal("complete"), serial: z.string().trim().min(1).max(64),
    command_id: z.string().uuid(), status: z.enum(["succeeded", "failed"]),
    result: z.object({ inserted: z.number().int().nonnegative().optional(), duplicates: z.number().int().nonnegative().optional(), unmatched: z.number().int().nonnegative().optional() }).optional(),
    error: z.string().max(300).optional(),
  }).strict(),
]);

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: string, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (!/^[a-f\d]{64}$/i.test(a) || !/^[a-f\d]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/zk-sync-command")({
  server: { handlers: { POST: async ({ request }) => {
    const secret = request.headers.get("X-Device-Key") ?? "";
    const signature = request.headers.get("X-Signature") ?? "";
    const timestamp = request.headers.get("X-Timestamp") ?? "";
    if (!secret || secret.length > 256 || !/^\d{10,13}$/.test(timestamp)) return json({ error: "Unauthorized" }, 401);
    const timeMs = Number(timestamp) * (timestamp.length === 10 ? 1000 : 1);
    if (!Number.isFinite(timeMs) || Math.abs(Date.now() - timeMs) > 5 * 60_000) return json({ error: "Expired request" }, 401);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return json({ error: "Payload too large" }, 413);
    if (!safeEqual(signature, await hmac(secret, `${timestamp}.${raw}`))) return json({ error: "Unauthorized" }, 401);
    let payload: z.infer<typeof commandSchema>;
    try { payload = commandSchema.parse(JSON.parse(raw)); } catch { return json({ error: "Invalid payload" }, 400); }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const { data: key, error: keyError } = await admin.from("device_sync_keys").select("device_id")
        .eq("key_hash", await sha256(secret)).is("revoked_at", null).maybeSingle();
      if (keyError) throw keyError;
      if (!key) return json({ error: "Unauthorized" }, 401);
      const { data: device, error: deviceError } = await admin.from("devices").select("id, serial_number, status")
        .eq("id", key.device_id).maybeSingle();
      if (deviceError) throw deviceError;
      if (!device || device.serial_number !== payload.serial || device.status !== "active") return json({ error: "Unauthorized" }, 401);

      if (payload.action === "poll") {
        const { data: pending, error } = await admin.from("device_sync_commands").select("id, requested_at")
          .eq("device_id", device.id).eq("status", "pending").order("requested_at").limit(1).maybeSingle();
        if (error) throw error;
        if (!pending) return json({ command: null });
        const { data: claimed, error: claimError } = await admin.from("device_sync_commands")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", pending.id).eq("status", "pending").select("id").maybeSingle();
        if (claimError) throw claimError;
        return json({ command: claimed ? { id: claimed.id } : null });
      }

      const { data: updated, error } = await admin.from("device_sync_commands").update({
        status: payload.status,
        completed_at: new Date().toISOString(),
        result: payload.result ?? {},
        error_message: payload.status === "failed" ? payload.error ?? "Sync failed" : null,
      }).eq("id", payload.command_id).eq("device_id", device.id).eq("status", "running").select("id").maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: "Command not found or already completed" }, 404);
      return json({ ok: true });
    } catch (error) {
      console.error("[ZKTeco command service] failed", error);
      return json({ error: "Sync command service unavailable" }, 503);
    }
  } } },
});

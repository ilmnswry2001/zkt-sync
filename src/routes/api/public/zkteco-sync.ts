import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { matchZktecoPins } from "@/lib/zkteco-employee-matching";

const payloadSchema = z.object({
  device_sn: z.string().trim().min(1).max(64),
  site_id: z.string().uuid().nullable().optional(),
  logs: z.array(z.object({
    employee_no: z.string().trim().min(1).max(48),
    timestamp: z.string().datetime({ offset: true }),
    punch_type: z.enum(["check_in", "check_out"]),
    verify_mode: z.enum(["fingerprint", "face", "card", "pin", "password", "unknown"]).optional(),
    status: z.number().int().optional(),
  })).max(5000),
}).strict();

async function hashKey(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/zkteco-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("X-ZKT-SYNC-KEY") ?? "";
        if (!key || key.length > 256) return json({ error: "Unauthorized" }, 401);
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return json({ error: "Payload too large" }, 413);

        let payload: z.infer<typeof payloadSchema>;
        try {
          const raw = await request.text();
          if (new TextEncoder().encode(raw).byteLength > 1_000_000) return json({ error: "Payload too large" }, 413);
          payload = payloadSchema.parse(JSON.parse(raw));
        } catch {
          return json({ error: "Invalid payload" }, 400);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const keyHash = await hashKey(key);
          const { data: keyRow, error: keyError } = await (supabaseAdmin as any)
            .from("zkteco_sync_keys").select("device_id").eq("key_hash", keyHash).is("revoked_at", null).maybeSingle();
          if (keyError) throw keyError;
          if (!keyRow) return json({ error: "Unauthorized" }, 401);

          const { data: device, error: deviceError } = await (supabaseAdmin as any)
            .from("devices").select("id, serial_number, status").eq("id", keyRow.device_id).maybeSingle();
          if (deviceError) throw deviceError;
          if (!device || device.serial_number !== payload.device_sn || device.status !== "active") {
            return json({ error: "Device is not authorized" }, 401);
          }

          if (payload.site_id) {
            const { data: site, error: siteError } = await (supabaseAdmin as any)
              .from("sites").select("id").eq("id", payload.site_id).maybeSingle();
            if (siteError) throw siteError;
            if (!site) return json({ error: "Unknown site_id" }, 422);
          }

          const pins = [...new Set(payload.logs.map((log) => log.employee_no))];
          const employeeByPin = await matchZktecoPins(supabaseAdmin as any, pins);
          const unmatchedPins = payload.logs.filter((log) => !employeeByPin.has(log.employee_no)).length;
          const logs = payload.logs.flatMap((log) => {
            const employee = employeeByPin.get(log.employee_no);
            if (!employee) return [];
            const date = new Date(log.timestamp);
            date.setUTCMilliseconds(0);
            const verifyTypes: Record<string, number> = { fingerprint: 1, face: 15, card: 2, pin: 0, password: 0, unknown: 0 };
            return [{
              employee_no: employee.employee_no,
              timestamp: date.toISOString(),
              punch_type: log.punch_type,
              verify_type: verifyTypes[log.verify_mode ?? "unknown"],
              status: log.status ?? 0,
            }];
          });
          const { data, error } = await (supabaseAdmin as any).rpc("ingest_zkteco_sync", {
            p_device_id: device.id, p_site_id: payload.site_id ?? null, p_logs: logs,
          });
          if (error) throw error;
          const result = Array.isArray(data) ? data[0] : data;
          return json({
            success: true,
            received: payload.logs.length,
            inserted: Number(result?.inserted_count ?? 0),
            unmatched: unmatchedPins + Number(result?.unmatched_count ?? 0),
            synced_at: new Date().toISOString(),
          });
        } catch (error) {
          console.error("[ZKTeco sync] ingestion failed", error);
          return json({ error: "Sync service unavailable" }, 503);
        }
      },
    },
  },
});

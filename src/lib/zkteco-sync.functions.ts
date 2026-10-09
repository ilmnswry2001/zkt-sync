import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("غير مصرح: هذه العملية لمدير النظام فقط");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const getZktecoSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: devices, error } = await (supabaseAdmin as any)
      .from("devices").select("id, auto_last_sync_at, auto_synced_logs_total");
    if (error) throw new Error(error.message);
    const { data: keys, error: keysError } = await (supabaseAdmin as any)
      .from("zkteco_sync_keys").select("device_id, key_prefix").is("revoked_at", null);
    if (keysError) throw new Error(keysError.message);
    const activeByDevice = new Map((keys ?? []).map((key: any) => [key.device_id, key.key_prefix]));
    return (devices ?? []).map((device: any) => ({
      device_id: device.id,
      auto_last_sync_at: device.auto_last_sync_at,
      auto_synced_logs_total: Number(device.auto_synced_logs_total ?? 0),
      has_active_key: activeByDevice.has(device.id),
      key_prefix: activeByDevice.get(device.id) ?? null,
    }));
  });

export const createZktecoSyncKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: device, error: deviceError } = await (supabaseAdmin as any)
      .from("devices").select("id, serial_number").eq("id", data.device_id).maybeSingle();
    if (deviceError) throw new Error(deviceError.message);
    if (!device?.serial_number) throw new Error("أضف الرقم التسلسلي للجهاز أولاً");

    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = `zkt_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const keyHash = await sha256(key);
    const now = new Date().toISOString();
    const { error: revokeError } = await (supabaseAdmin as any)
      .from("zkteco_sync_keys").update({ revoked_at: now }).eq("device_id", data.device_id).is("revoked_at", null);
    if (revokeError) throw new Error(revokeError.message);
    const { error: insertError } = await (supabaseAdmin as any).from("zkteco_sync_keys").insert({
      device_id: data.device_id, key_hash: keyHash, key_prefix: key.slice(0, 12), created_by: context.userId,
    });
    if (insertError) throw new Error(insertError.message);
    return { key, device_sn: device.serial_number };
  });
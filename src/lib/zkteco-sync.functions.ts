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
      .from("devices").select("id, auto_last_sync_at, auto_synced_logs_total, last_sync_at");
    if (error) throw new Error(error.message);
    const { data: keys, error: keysError } = await (supabaseAdmin as any)
      .from("device_sync_keys").select("device_id, key_prefix").is("revoked_at", null);
    if (keysError) throw new Error(keysError.message);
    const activeByDevice = new Map((keys ?? []).map((key: any) => [key.device_id, key.key_prefix]));
    const { data: batches, error: batchError } = await (supabaseAdmin as any).from("sync_batches")
      .select("id, device_id, received_at, record_count, inserted_count, duplicate_count, unmatched_count, error_count, error_details")
      .order("received_at", { ascending: false }).limit(50);
    if (batchError) throw new Error(batchError.message);
    const { data: commands, error: commandError } = await (supabaseAdmin as any).from("device_sync_commands")
      .select("id, device_id, requested_at, started_at, completed_at, status, result, error_message")
      .order("requested_at", { ascending: false }).limit(50);
    if (commandError) throw new Error(commandError.message);
    const batchesByDevice = new Map<string, any[]>();
    for (const batch of batches ?? []) {
      const list = batchesByDevice.get(batch.device_id) ?? [];
      if (list.length < 50) list.push(batch);
      batchesByDevice.set(batch.device_id, list);
    }
    return (devices ?? []).map((device: any) => ({
      device_id: device.id,
      auto_last_sync_at: !device.auto_last_sync_at || (device.last_sync_at && device.last_sync_at > device.auto_last_sync_at) ? device.last_sync_at : device.auto_last_sync_at,
      auto_synced_logs_total: Number(device.auto_synced_logs_total ?? 0),
      has_active_key: activeByDevice.has(device.id),
      key_prefix: activeByDevice.get(device.id) ?? null,
      batches: batchesByDevice.get(device.id) ?? [],
      commands: (commands ?? []).filter((command: any) => command.device_id === device.id).slice(0, 5),
    }));
  });

export const requestZktecoSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
    const { error: staleError } = await admin.from("device_sync_commands").update({ status: "failed", completed_at: new Date().toISOString(), error_message: "انتهت مهلة انتظار الوكيل" })
      .eq("device_id", data.device_id).eq("status", "running").lt("started_at", staleBefore);
    if (staleError) throw new Error(staleError.message);
    const pendingBefore = new Date(Date.now() - 2 * 60_000).toISOString();
    const { error: pendingError } = await admin.from("device_sync_commands").update({ status: "failed", completed_at: new Date().toISOString(), error_message: "لم يستلم الوكيل طلب المزامنة؛ تحقق من تشغيله" })
      .eq("device_id", data.device_id).eq("status", "pending").lt("requested_at", pendingBefore);
    if (pendingError) throw new Error(pendingError.message);
    const { data: device, error: deviceError } = await admin.from("devices")
      .select("id, serial_number, status").eq("id", data.device_id).maybeSingle();
    if (deviceError) throw new Error(deviceError.message);
    if (!device || device.status !== "active" || !device.serial_number) throw new Error("الجهاز غير نشط أو ينقصه الرقم التسلسلي");
    const { data: key, error: keyError } = await admin.from("device_sync_keys")
      .select("id").eq("device_id", data.device_id).is("revoked_at", null).limit(1).maybeSingle();
    if (keyError) throw new Error(keyError.message);
    if (!key) throw new Error("أنشئ مفتاح ربط للجهاز أولاً");
    const { data: command, error } = await admin.from("device_sync_commands").insert({
      device_id: data.device_id, requested_by: context.userId,
    }).select("id, requested_at, status").single();
    if (error?.code === "23505") throw new Error("يوجد طلب مزامنة قيد التنفيذ لهذا الجهاز");
    if (error) throw new Error(error.message);
    return command;
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
    const { error: insertError } = await (supabaseAdmin as any).from("device_sync_keys").insert({
      device_id: data.device_id, key_hash: keyHash, key_prefix: key.slice(0, 12), created_by: context.userId,
    });
    if (insertError) throw new Error(insertError.message);
    const { error: revokeError } = await (supabaseAdmin as any)
      .from("device_sync_keys").update({ revoked_at: now }).eq("device_id", data.device_id).neq("key_hash", keyHash).is("revoked_at", null);
    if (revokeError) throw new Error(revokeError.message);
    return { key, device_sn: device.serial_number };
  });

export const revokeZktecoSyncKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("device_sync_keys")
      .update({ revoked_at: new Date().toISOString() }).eq("device_id", data.device_id).is("revoked_at", null);
    if (error) throw new Error(error.message);
    return { success: true };
  });

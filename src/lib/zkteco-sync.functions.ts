import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { matchZktecoPins, unmatchedZktecoPinMessage } from "@/lib/zkteco-employee-matching";

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

export const reprocessZktecoSyncRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ device_id: z.string().uuid().optional() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { data: role, error: roleError } = await context.supabase.from("user_roles").select("role")
      .eq("user_id", context.userId).in("role", ["admin", "hr"]).limit(1).maybeSingle();
    if (roleError) throw new Error(roleError.message);
    if (!role) throw new Error("غير مصرح: إعادة المعالجة متاحة لمدير النظام والموارد البشرية فقط");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const records: any[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = admin.from("device_sync_records")
        .select("id, sync_batch_id, device_id, user_pin, employee_no, employee_id, verify_time, verify_type, status, external_log_id, processing_status")
        .in("processing_status", ["pending", "error", "unmatched"])
        .order("created_at", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + 499);
      if (data.device_id) query = query.eq("device_id", data.device_id);
      const { data: page, error } = await query;
      if (error) throw new Error(error.message);
      records.push(...(page ?? []));
      if ((page ?? []).length < 500) break;
      if (records.length >= 10_000) throw new Error("تجاوزت السجلات غير المعالجة 10,000 حركة؛ اختر جهازاً محدداً ثم أعد المحاولة");
    }
    if (!records.length) return { processed: 0, inserted: 0, duplicates: 0, unmatched: 0 };

    const pins = [...new Set(records.map((record) => String(record.user_pin ?? "").trim()).filter(Boolean))];
    const employeeByPin = await matchZktecoPins(admin, pins);
    const candidates = new Map<string, { record: any; employee: { id: string; employee_no: string } }>();
    const recordKey = (employeeNo: string, verifyTime: string) => `${employeeNo}|${Date.parse(verifyTime)}`;
    for (const record of records) {
      const employee = employeeByPin.get(String(record.user_pin ?? "").trim());
      if (!employee) continue;
      const key = recordKey(employee.employee_no, record.verify_time);
      if (!candidates.has(key)) candidates.set(key, { record, employee });
    }

    const insertedKeys = new Set<string>();
    const candidateEntries = [...candidates.entries()];
    for (let offset = 0; offset < candidateEntries.length; offset += 500) {
      const items = candidateEntries.slice(offset, offset + 500);
      const { data: insertedRows, error } = await admin.from("attendance_logs").upsert(items.map(([_, item]) => ({
        employee_no: item.employee.employee_no,
        employee_id: item.employee.id,
        device_id: item.record.device_id,
        upload_id: null,
        verify_time: new Date(item.record.verify_time).toISOString(),
        verify_type: item.record.verify_type ?? 0,
        status: item.record.status ?? null,
        external_log_id: item.record.external_log_id ?? null,
        source: "zk_agent",
      })), { onConflict: "employee_no,verify_time", ignoreDuplicates: true })
        .select("employee_no, verify_time");
      if (error) throw new Error(error.message);
      for (const row of insertedRows ?? []) insertedKeys.add(recordKey(row.employee_no, row.verify_time));
    }

    const updates = records.map((record) => {
      const employee = employeeByPin.get(String(record.user_pin ?? "").trim());
      if (!employee) return { ...record, processing_status: "unmatched", error_message: unmatchedZktecoPinMessage(String(record.user_pin ?? "")) };
      const key = recordKey(employee.employee_no, record.verify_time);
      const candidate = candidates.get(key);
      const inserted = candidate?.record.id === record.id && insertedKeys.has(key);
      return { ...record, employee_no: employee.employee_no, employee_id: employee.id,
        processing_status: inserted ? "inserted" : "duplicate", error_message: null };
    });
    for (let offset = 0; offset < updates.length; offset += 500) {
      const { error } = await admin.from("device_sync_records").upsert(updates.slice(offset, offset + 500), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }

    const batchDeltas = new Map<string, { inserted: number; duplicate: number; unmatched: number; error: number }>();
    const deviceInserts = new Map<string, number>();
    const previousStatusById = new Map(records.map((record) => [record.id, record.processing_status]));
    for (const update of updates) {
      const delta = batchDeltas.get(update.sync_batch_id) ?? { inserted: 0, duplicate: 0, unmatched: 0, error: 0 };
      if (update.processing_status === "inserted") delta.inserted++;
      else if (update.processing_status === "duplicate") delta.duplicate++;
      else delta.unmatched++;
      const previous = previousStatusById.get(update.id);
      if (previous === "error") delta.error--;
      if (previous === "unmatched" && update.processing_status !== "unmatched") delta.unmatched--;
      batchDeltas.set(update.sync_batch_id, delta);
      if (update.processing_status === "inserted") deviceInserts.set(update.device_id, (deviceInserts.get(update.device_id) ?? 0) + 1);
    }

    const batchIds = [...batchDeltas.keys()];
    for (let offset = 0; offset < batchIds.length; offset += 500) {
      const ids = batchIds.slice(offset, offset + 500);
      const { data: batches, error } = await admin.from("sync_batches")
        .select("id, inserted_count, duplicate_count, unmatched_count, error_count")
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const batch of batches ?? []) {
        const delta = batchDeltas.get(batch.id)!;
        const errorCount = Math.max(0, Number(batch.error_count ?? 0) + delta.error);
        const { error: updateError } = await admin.from("sync_batches").update({
          inserted_count: Number(batch.inserted_count ?? 0) + delta.inserted,
          duplicate_count: Number(batch.duplicate_count ?? 0) + delta.duplicate,
          unmatched_count: Math.max(0, Number(batch.unmatched_count ?? 0) + delta.unmatched),
          error_count: errorCount,
          ...(errorCount === 0 ? { error_details: [] } : {}),
        }).eq("id", batch.id);
        if (updateError) throw new Error(updateError.message);
      }
    }

    const deviceIds = [...deviceInserts.keys()];
    if (deviceIds.length) {
      const { data: deviceRows, error } = await admin.from("devices").select("id, auto_synced_logs_total").in("id", deviceIds);
      if (error) throw new Error(error.message);
      for (const device of deviceRows ?? []) {
        const now = new Date().toISOString();
        const { error: updateError } = await admin.from("devices").update({
          auto_synced_logs_total: Number(device.auto_synced_logs_total ?? 0) + (deviceInserts.get(device.id) ?? 0),
          last_sync_at: now,
          auto_last_sync_at: now,
        }).eq("id", device.id);
        if (updateError) throw new Error(updateError.message);
      }
    }

    return {
      processed: records.length,
      inserted: updates.filter((record) => record.processing_status === "inserted").length,
      duplicates: updates.filter((record) => record.processing_status === "duplicate").length,
      unmatched: updates.filter((record) => record.processing_status === "unmatched").length,
    };
  });

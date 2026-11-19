import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isLanDeviceIp,
  mobileKeyPrefix,
  mobileOperators,
  syncDigest,
  toHex,
} from "@/lib/mobile-sync";

const binding = z.object({
  device_id: z.string().uuid(),
  operator_email: z.string().trim().email().max(254).optional(),
});

export const listMobileSyncDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ search: z.string().trim().max(80) }))
  .handler(async ({ context, data }) => {
    const { data: isAdmin, error: permissionError } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (permissionError || !isAdmin) throw new Error("الربط متاح لمدير النظام فقط");
    let query = context.supabase
      .from("devices")
      .select("id, name, serial_number, ip_address")
      .eq("status", "active")
      .not("serial_number", "is", null)
      .not("ip_address", "is", null);
    if (data.search) query = query.ilike("name", `%${data.search.replace(/[\\%_]/g, "\\$&")}%`);
    const { data: devices, error } = await query.order("name").order("id").limit(50);
    if (error) throw error;
    return devices.filter(
      (device) => device.serial_number && device.ip_address && isLanDeviceIp(device.ip_address),
    );
  });

export const configureMobileSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(binding.extend({ action: z.enum(["provision", "revoke"]) }))
  .handler(async ({ context, data }) => {
    const { data: isAdmin, error: permissionError } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (permissionError || !isAdmin) throw new Error("الربط متاح لمدير النظام فقط");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let operatorId = context.userId;
    if (data.operator_email) {
      const { data: operator, error } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", data.operator_email.toLowerCase())
        .maybeSingle();
      if (error || !operator) throw new Error("تعذر العثور على حساب المشرف بالبريد المدخل");
      operatorId = operator.id;
    }
    if (data.action === "revoke") {
      const { error } = await supabaseAdmin
        .from("mobile_device_sync_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("device_id", data.device_id)
        .eq("operator_id", operatorId)
        .is("revoked_at", null);
      if (error) throw error;
      return null;
    }

    const { data: role, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", operatorId)
      .in("role", mobileOperators)
      .limit(1)
      .maybeSingle();
    if (roleError || !role) throw new Error("الحساب المحدد لا يملك دوراً ميدانياً معتمداً");
    const { data: device, error: deviceError } = await supabaseAdmin
      .from("devices")
      .select("id, serial_number, ip_address")
      .eq("id", data.device_id)
      .eq("status", "active")
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device?.serial_number || !device.ip_address || !isLanDeviceIp(device.ip_address)) {
      throw new Error("أضف رقماً تسلسلياً وعنوان شبكة محلية صالحاً لجهاز نشط");
    }
    const key = `${mobileKeyPrefix}${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const { error } = await supabaseAdmin.from("mobile_device_sync_keys").insert({
      key_hash: await syncDigest(key),
      device_id: device.id,
      operator_id: operatorId,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    if (error) throw error;
    return {
      device_id: device.id,
      operator_id: operatorId,
      serial: device.serial_number,
      device_ip: device.ip_address,
      sync_key: key,
    };
  });

export const listMobileSyncHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", mobileOperators);
    if (roleError || !roles?.length) throw new Error("غير مصرح بقراءة سجل المزامنة الميدانية");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("sync_batches")
      .select(
        "id, mobile_operator_name, mobile_status, mobile_pulled_at, received_at, record_count, inserted_count, device:devices(name)",
      )
      .not("mobile_status", "is", null);
    if (!roles.some(({ role }) => role === "admin" || role === "hr"))
      query = query.eq("mobile_operator_id", context.userId);
    const { data, error } = await query
      .order("received_at", { ascending: false })
      .order("id")
      .limit(30);
    if (error) throw error;
    return data;
  });

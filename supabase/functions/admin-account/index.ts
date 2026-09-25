import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Role = "admin" | "hr" | "supervisor" | "data_entry";
type RequestBody =
  | { action: "create"; email: string; password: string; full_name: string; role: Role }
  | { action: "set_password"; user_id: string; password: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isValidPassword = (password: string) => password.length >= 8 && password.length <= 72;

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server is not configured" }, 500);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "يجب تسجيل الدخول" }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "جلسة الدخول غير صالحة" }, 401);

  const { data: adminRole, error: roleError } = await adminClient
    .from("user_roles")
    .select("id")
    .eq("user_id", authData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError || !adminRole) return json({ error: "هذه العملية متاحة لمدير النظام فقط" }, 403);

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json({ error: "بيانات الطلب غير صالحة" }, 400);
  }

  if (body.action === "create") {
    const email = body.email.trim().toLowerCase();
    const fullName = body.full_name.trim();
    if (!email || !fullName || !isValidPassword(body.password)) {
      return json({ error: "أدخل الاسم والبريد وكلمة مرور من 8 إلى 72 حرفاً" }, 400);
    }
    const allowedRoles: Role[] = ["admin", "hr", "supervisor", "data_entry"];
    if (!allowedRoles.includes(body.role)) return json({ error: "الصلاحية غير صالحة" }, 400);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createError || !created.user) {
      return json({ error: createError?.message ?? "تعذر إنشاء الحساب" }, createError?.status ?? 400);
    }

    await adminClient.from("user_roles").delete().eq("user_id", created.user.id);
    const { error: assignError } = await adminClient
      .from("user_roles")
      .insert({ user_id: created.user.id, role: body.role });
    if (assignError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: `تم التراجع عن إنشاء الحساب: ${assignError.message}` }, 400);
    }
    return json({ user_id: created.user.id });
  }

  if (body.action === "set_password") {
    if (!body.user_id || !isValidPassword(body.password)) {
      return json({ error: "كلمة المرور يجب أن تكون من 8 إلى 72 حرفاً" }, 400);
    }
    const { error } = await adminClient.auth.admin.updateUserById(body.user_id, {
      password: body.password,
    });
    if (error) return json({ error: error.message }, error.status ?? 400);
    return json({ user_id: body.user_id });
  }

  return json({ error: "العملية غير معروفة" }, 400);
});

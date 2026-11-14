import { createClient } from "npm:@supabase/supabase-js@2";
import { validate } from "../_shared/form-schema.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, { error: "طلب غير مدعوم" });
  try {
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: "طلب فارغ" });
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 262144) {
        await reader.cancel();
        return reply(413, { error: "الطلب كبير جداً" });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (
      body.website ||
      !/^\w{64}$/.test(body.token) ||
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(body.request_id)
    )
      return reply(400, { error: "طلب غير صالح" });
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, secret, {
      auth: { persistSession: false },
    });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
    if (!ip) return reply(503, { error: "تعذر التحقق من الاتصال" });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const prior = await db.rpc("public_form_receipt", {
      p_token: body.token,
      p_request: body.request_id,
      p_hash: hash,
    });
    if (prior.data) return reply(200, { reference_code: prior.data });
    const turnstile = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (turnstile) {
      const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({
          secret: turnstile,
          response: String(body.challenge ?? ""),
          remoteip: ip,
        }),
      });
      if (!(await check.json()).success) return reply(403, { error: "أعد التحقق وأرسل الاستمارة" });
    }
    const { data: form, error } = await db.rpc("get_public_form", { token: body.token });
    if (error) throw Error("load");
    if (!form || form.version !== body.version)
      return reply(409, { error: "الرابط غير متاح أو تغير القالب" });
    let data;
    try {
      data = validate(form.schema, body.data, form.prefill, form.locked_fields);
    } catch (e) {
      return reply(422, { error: (e as Error).message });
    }
    const saved = await db.rpc("commit_public_form", {
      p_token: body.token,
      p_version: form.version,
      p_locked: form.prefill,
      p_locks: form.locked_fields,
      p_data: data,
      p_hash: hash,
      p_request: body.request_id,
    });
    if (saved.error) {
      console.warn("Form submission refused", saved.error.code);
      return reply(saved.error.message === "rate limit" ? 429 : 409, {
        error:
          saved.error.message === "rate limit"
            ? "بلغت حد الإرسال خلال الساعة"
            : "تعذر قبول الإرسال، تحقق من صلاحية الرابط",
      });
    }
    return reply(200, { reference_code: saved.data });
  } catch {
    console.error("Form submission failed");
    return reply(400, { error: "تعذر إكمال الطلب" });
  }
});

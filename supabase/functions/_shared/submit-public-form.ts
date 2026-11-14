import { validate } from "./form-schema.ts";

export const formHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: formHeaders });
type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: { code: string; message: string } | null }>;
};
export async function submitPublicForm(
  req: Request,
  db: RpcClient,
  secret: string | undefined,
  turnstile: string | undefined,
) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: formHeaders });
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
    let body;
    try {
      body = JSON.parse(text + decoder.decode());
    } catch {
      return reply(400, { error: "صيغة الطلب غير صالحة" });
    }
    if (
      !body ||
      typeof body.token !== "string" ||
      typeof body.request_id !== "string" ||
      !Number.isInteger(body.version) ||
      body.website ||
      !/^\w{64}$/.test(body.token) ||
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(body.request_id)
    )
      return reply(400, { error: "طلب غير صالح" });
    if (!secret) return reply(503, { error: "خدمة الحفظ غير مهيأة على الخادم" });
    const ip =
      req.headers.get("cf-connecting-ip")?.trim() ||
      req.headers.get("x-forwarded-for")?.split(",")[0].trim();
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
    if (prior.error && prior.error.code !== "PGRST202") {
      console.error("public_form_receipt", prior.error.code, prior.error.message);
      throw Error("receipt lookup failed");
    }
    if (prior.data) return reply(200, { reference_code: prior.data });

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
    if (error) {
      console.error("get_public_form", error.code, error.message);
      throw Error("template lookup failed");
    }
    if (!form)
      return reply(409, { error: "الرابط غير متاح، ربما انتهت صلاحيته أو اكتمل عدد الإرسالات" });
    if (form.version !== body.version)
      return reply(409, { error: "الرابط غير متاح أو تغير القالب" });
    let data;
    try {
      data = validate(form.schema, body.data, form.prefill, form.locked_fields);
    } catch (e) {
      return reply(422, { error: (e as Error).message });
    }
    const args = {
      p_token: body.token,
      p_version: form.version,
      p_data: data,
      p_hash: hash,
      p_request: body.request_id,
    };
    let saved = await db.rpc("commit_public_form", args);
    // The repository migration also ships a signature that checks the lock snapshot.
    // PostgREST returns PGRST202 before executing a function with an unmatched signature.
    if (saved.error?.code === "PGRST202") {
      console.error("commit_public_form signature lookup", saved.error.code, saved.error.message);
      saved = await db.rpc("commit_public_form", {
        ...args,
        p_locked: form.prefill,
        p_locks: form.locked_fields,
      });
    }
    if (saved.error) {
      console.error("commit_public_form", saved.error.code, saved.error.message);
      return reply(saved.error.message === "rate limit" ? 429 : 409, {
        error:
          saved.error.message === "rate limit"
            ? "بلغت حد الإرسال خلال الساعة"
            : "تعذر قبول الإرسال، تحقق من صلاحية الرابط",
      });
    }
    if (typeof saved.data !== "string" || !saved.data) throw Error("receipt");
    return reply(200, { reference_code: saved.data });
  } catch {
    console.error("Form submission failed");
    return reply(503, { error: "تعذر الاتصال بخدمة الحفظ، حاول مرة أخرى" });
  }
}

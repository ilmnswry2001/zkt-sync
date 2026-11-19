import { test, expect, mock } from "bun:test";
import { createHmac, webcrypto } from "node:crypto";
import { encryptMobilePairing } from "./mobile-sync";

const device = "00000000-0000-4000-8000-000000000002";
const batch = "00000000-0000-4000-8000-000000000003";
const key = `zkm_${"a".repeat(64)}`;
const instant = "2026-11-19T07:15:00+03:00";

test("pairing QR encrypts credentials and needs the separate unlock code", async () => {
  const payload = {
    server_url: "https://erp.example.test",
    device_id: device,
    operator_id: batch,
    serial: "TEST-001",
    device_ip: "192.168.1.201",
    sync_key: key,
    pair_until: Date.now() + 300_000,
  };
  const { qr, code } = await encryptMobilePairing(payload);
  const [format, salt64, iv64, data64] = qr.split(".");
  expect(format).toBe("ZKT1");
  expect(code).toMatch(/^\d{12}$/);
  expect(qr).not.toContain(payload.sync_key);
  const params = { name: "AES-GCM", iv: Buffer.from(iv64, "base64url") };
  async function decrypt(pin) {
    const root = await webcrypto.subtle.importKey("raw", Buffer.from(pin), "PBKDF2", false, [
      "deriveKey",
    ]);
    const secret = await webcrypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: Buffer.from(salt64, "base64url"),
        iterations: 150_000,
      },
      root,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    return webcrypto.subtle.decrypt(params, secret, Buffer.from(data64, "base64url"));
  }
  expect(JSON.parse(new TextDecoder().decode(await decrypt(code)))).toEqual(payload);
  await expect(decrypt(code === "000000000000" ? "000000000001" : "000000000000")).rejects.toThrow();
});

test("the actual public POST handler enforces signatures and routes mobile batches to the scoped RPC", async () => {
  const rpc = mock(async () => ({
    data: { inserted: 1, duplicates: 0, unmatched: 0 },
    error: null,
  }));
  mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc } }));
  const { Route } = await import("@/routes/api/public/zk-sync");
  // The router supplies only the Request to this handler.
  const handlers = Route.options.server.handlers;
  const body = JSON.stringify({
    device_id: device,
    batch_id: batch,
    serial: "TEST-001",
    pulled_at: instant,
    logs: [{ user_pin: "003", verify_time: instant, verify_type: 1, status: 0 }],
  });
  const post = (raw, timestamp = String(Date.now()), signedBody = raw) =>
    handlers.POST({
      request: new Request("https://erp.example.test/api/public/zk-sync", {
        method: "POST",
        body: raw,
        headers: {
          "X-Device-Key": key,
          "X-Timestamp": timestamp,
          "X-Signature": createHmac("sha256", key)
            .update(`${timestamp}.${signedBody}`)
            .digest("hex"),
        },
      }),
    });
  expect((await post(body, String(Date.now()), "{}")).status).toBe(401);
  expect((await post(body, String(Date.now() - 600_000))).status).toBe(401);
  expect((await post("{}")).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  const response = await post(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ inserted: 1, duplicates: 0, unmatched: 0 });
  expect(rpc).toHaveBeenCalledWith(
    "ingest_mobile_device_sync",
    expect.objectContaining({ p_device_id: device, p_batch_id: batch, p_serial: "TEST-001" }),
  );
  rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect((await post(body)).status).toBe(401);
  rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
  expect((await post(body)).status).toBe(409);
  rpc.mockResolvedValueOnce({ data: { failed: true }, error: null });
  expect((await post(body)).status).toBe(503);
});

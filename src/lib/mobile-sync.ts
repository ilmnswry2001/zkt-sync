import { z } from "zod";

export const mobileOperators = ["admin", "hr", "supervisor", "site_admin"] as const;
export const mobileKeyPrefix = "zkm_";
export const mobileApk = "/downloads/ZKTeco-Mobile-Companion.apk";
export const mobileVersion = "1.0.0";

export function isLanDeviceIp(ip: string) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [a, b, c, d] = ip.split(".").map(Number);
  return (
    [a, b, c, d].every((part) => part <= 255) &&
    d > 0 &&
    d < 255 &&
    (a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254))
  );
}

const movement = z
  .object({
    user_pin: z.string().trim().min(1).max(48),
    verify_time: z.string().datetime({ offset: true }),
    verify_type: z.number().int().min(0).max(255),
    status: z.number().int().min(0).max(255),
  })
  .strict();

export const mobileBatch = z
  .object({
    device_id: z.string().uuid(),
    serial: z.string().trim().min(1).max(64),
    batch_id: z.string().uuid(),
    pulled_at: z.string().datetime({ offset: true }),
    logs: z.array(movement).min(1).max(500),
  })
  .strict();

export type MobilePairing = {
  server_url: string;
  device_id: string;
  operator_id: string;
  serial: string;
  device_ip: string;
  sync_key: string;
  pair_until: number;
};

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export async function syncDigest(value: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

export async function encryptMobilePairing(pairing: MobilePairing) {
  const code = Array.from(crypto.getRandomValues(new Uint32Array(3)), (value) =>
    String(value % 10_000).padStart(4, "0"),
  ).join("");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const pin = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, [
    "deriveKey",
  ]);
  const cipher = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 150_000 },
    pin,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cipher,
    encoder.encode(JSON.stringify(pairing)),
  );
  const encode = (value: Uint8Array) =>
    btoa(String.fromCharCode(...value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return { code, qr: ["ZKT1", encode(salt), encode(iv), encode(new Uint8Array(bytes))].join(".") };
}

import { z } from "zod";

export const mobileOperators = ["admin", "hr", "supervisor", "site_admin"] as const;
export const mobileKeyPrefix = "zkm_";
export const mobileApk = "/downloads/ZKTeco-Mobile-Companion.apk";
export const mobileVersion = "1.3.0";
export const mobileAgentBundleLimit = 2000;

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

type MobileCredential = {
  device_id: string;
  operator_id: string;
  serial: string;
  device_ip: string;
  sync_key: string;
};

function mobileSyncUrl(origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error("افتح النظام عبر HTTPS لتنزيل ملف الوكيل");
  return `${url.origin}/api/public/zk-sync`;
}

function mobileAgentConfig(credential: MobileCredential, syncUrl: string) {
  return {
    format: "zkteco-mobile-agent-v1",
    sync_url: syncUrl,
    device_id: credential.device_id,
    operator_id: credential.operator_id,
    device_ip: credential.device_ip,
    serial: credential.serial,
    device_key: credential.sync_key,
    device_port: 4370,
    device_password: 0,
    transport: "auto",
    time_zone: "Asia/Baghdad",
  };
}

export function mobileAgentFile(credential: MobileCredential, origin: string) {
  return JSON.stringify(mobileAgentConfig(credential, mobileSyncUrl(origin)), null, 2);
}

export function mobileAgentBundle(credentials: MobileCredential[], origin: string) {
  const syncUrl = mobileSyncUrl(origin);
  return JSON.stringify({
    format: "zkteco-mobile-agent-bundle-v1",
    devices: credentials.map((credential) => mobileAgentConfig(credential, syncUrl)),
  });
}

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export async function syncDigest(value: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  );
}

// Client-side parser for ZKTeco backupdata.dat files.
// Format: 3072-byte ZK header → GZIP → TAR → ZKDB.db (SQLite).
import { inflate } from "pako";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

export interface ZkUser {
  user_pin: string;
  name: string;
  privilege: number;
  dept_id: number;
}
export interface ZkAttLog {
  external_id: number;
  user_pin: string;
  verify_time: string; // ISO
  verify_type: number;
  status: number;
}
export interface ZkDepartment {
  external_id: number;
  name: string;
}
export interface ZkParseResult {
  serial: string;
  users: ZkUser[];
  logs: ZkAttLog[];
  departments: ZkDepartment[];
}

function readZkHeader(buf: Uint8Array): { serial: string; gzipOffset: number } {
  // first 18 bytes: "ZK format 1.0.0.0\0"
  const td = new TextDecoder("utf-8");
  const headerStr = td.decode(buf.slice(0, 64)).replace(/\0/g, " ");
  const serialMatch = headerStr.match(/([0-9]{5,15})/);
  const serial = serialMatch ? serialMatch[1] : "";
  // Find GZIP magic 1f 8b 08
  let off = -1;
  for (let i = 0; i < Math.min(buf.length - 3, 8192); i++) {
    if (buf[i] === 0x1f && buf[i + 1] === 0x8b && buf[i + 2] === 0x08) {
      off = i;
      break;
    }
  }
  if (off < 0) throw new Error("GZIP block not found in backup file");
  return { serial, gzipOffset: off };
}

// Minimal USTAR parser
function parseTar(buf: Uint8Array): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = [];
  const td = new TextDecoder("utf-8");
  let p = 0;
  while (p + 512 <= buf.length) {
    const block = buf.slice(p, p + 512);
    // empty block = end
    let empty = true;
    for (let i = 0; i < 512; i++) if (block[i] !== 0) { empty = false; break; }
    if (empty) break;
    const name = td.decode(block.slice(0, 100)).replace(/\0.*$/, "");
    const sizeStr = td.decode(block.slice(124, 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    p += 512;
    if (name && size > 0) {
      files.push({ name, data: buf.slice(p, p + size) });
    }
    p += Math.ceil(size / 512) * 512;
  }
  return files;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  }
  return sqlPromise;
}

function queryAll(db: Database, sql: string): Record<string, unknown>[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((row: unknown[]) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((c: string, i: number) => (obj[c] = row[i]));
    return obj;
  });
}

export async function parseZkBackup(buffer: ArrayBuffer): Promise<ZkParseResult> {
  const all = new Uint8Array(buffer);
  const { serial, gzipOffset } = readZkHeader(all);
  const gz = all.slice(gzipOffset);
  const tarBuf = inflate(gz);
  const files = parseTar(tarBuf);
  const dbFile = files.find((f) => f.name.toLowerCase().endsWith("zkdb.db"));
  if (!dbFile) throw new Error("ZKDB.db not found in TAR archive");

  const SQL = await getSql();
  const db = new SQL.Database(dbFile.data);
  try {
    const users = queryAll(db, "SELECT User_PIN, Name, Privilege, Dept_ID FROM USER_INFO").map((r) => ({
      user_pin: String(r.User_PIN ?? ""),
      name: String(r.Name ?? r.User_PIN ?? "").trim() || String(r.User_PIN ?? ""),
      privilege: Number(r.Privilege ?? 0),
      dept_id: Number(r.Dept_ID ?? 0),
    }));
    const logs = queryAll(
      db,
      "SELECT ID, User_PIN, Verify_Time, Verify_Type, Status FROM ATT_LOG WHERE User_PIN IS NOT NULL AND User_PIN <> '0'",
    ).map((r) => ({
      external_id: Number(r.ID ?? 0),
      user_pin: String(r.User_PIN ?? ""),
      verify_time: String(r.Verify_Time ?? ""),
      verify_type: Number(r.Verify_Type ?? 0),
      status: Number(r.Status ?? 0),
    }));
    let departments: ZkDepartment[] = [];
    try {
      departments = queryAll(db, "SELECT DEPT_ID, DEPT_NAME FROM DEPARTMENT").map((r) => ({
        external_id: Number(r.DEPT_ID ?? 0),
        name: String(r.DEPT_NAME ?? "").trim(),
      })).filter((d) => d.name);
    } catch {
      // table may not exist or different schema; ignore
    }
    return { serial, users, logs, departments };
  } finally {
    db.close();
  }
}

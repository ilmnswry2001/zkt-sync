import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const uid = (num) => `00000000-0000-4000-8000-${String(num).padStart(12, "0")}`;
const keyHash = "a".repeat(64);
const batchHash = "b".repeat(64);

test("mobile batches are scoped, atomic and replayable without adding audit duplicates", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
    CREATE TABLE public.devices (id uuid PRIMARY KEY, status text, serial_number text, last_sync_at timestamptz);
    CREATE TABLE public.employees (id uuid PRIMARY KEY, attendance_device_id text, employee_no text);
    CREATE TABLE public.user_roles (user_id uuid, role text);
    CREATE FUNCTION public.is_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$
      SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = $2)
    $$;
    CREATE TABLE public.sync_batches (id uuid PRIMARY KEY, device_id uuid, record_count integer DEFAULT 0,
      inserted_count integer DEFAULT 0, duplicate_count integer DEFAULT 0, unmatched_count integer DEFAULT 0,
      error_count integer DEFAULT 0, error_details jsonb DEFAULT '[]', received_at timestamptz DEFAULT now());
    CREATE TABLE public.attendance_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid, employee_no text,
      device_id uuid, verify_time timestamptz, verify_type integer, status integer, external_log_id integer, source text,
      UNIQUE(employee_no, verify_time));
    CREATE TABLE public.device_sync_records (sync_batch_id uuid, device_id uuid, user_pin text, employee_id uuid,
      employee_no text, attendance_log_id uuid REFERENCES public.attendance_logs(id), verify_time timestamptz,
      verify_type integer, status integer, external_log_id integer, processing_status text NOT NULL
      CHECK (processing_status IN ('inserted', 'duplicate', 'unmatched', 'pending', 'error')), error_message text);
    CREATE UNIQUE INDEX device_sync_records_attendance_backfill_idx ON public.device_sync_records(attendance_log_id)
      WHERE attendance_log_id IS NOT NULL;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO auth.users VALUES ('${uid(1)}');
    INSERT INTO public.profiles VALUES ('${uid(1)}', 'مشرف تجريبي');
    INSERT INTO public.devices VALUES ('${uid(2)}', 'active', 'T1', null), ('${uid(3)}', 'active', 'T2', null);
    INSERT INTO public.employees VALUES ('${uid(4)}', '001', '700'), ('${uid(5)}', '002', '701'), ('${uid(6)}', '002', '702');
    INSERT INTO public.user_roles VALUES ('${uid(1)}', 'supervisor');
  `);
  await db.exec(
    await readFile(
      new URL("../migrations/20261119160000_mobile_device_sync.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "INSERT INTO mobile_device_sync_keys VALUES ($1,$2,$3,now()+interval '1 day',null)",
    [keyHash, uid(2), uid(1)],
  );
  const time = "2026-11-19T07:15:00+03:00";
  const item = { user_pin: "001", verify_time: time, verify_type: 1, status: 0 };
  const records = [item, { ...item, status: 1 }, { ...item, user_pin: "002" }];
  const run = async (
    device = uid(2),
    serial = "T1",
    batch = uid(10),
    hash = batchHash,
    logs = records,
    key = keyHash,
  ) =>
    (
      await db.query("SELECT public.ingest_mobile_device_sync($1,$2,$3,$4,$5,$6,$7) AS result", [
        key,
        device,
        serial,
        batch,
        hash,
        time,
        JSON.stringify(logs),
      ])
    ).rows[0].result;

  await db.exec("SET ROLE authenticated");
  await assert.rejects(run(), { code: "42501" });
  await db.exec("RESET ROLE; SET ROLE service_role");
  await assert.rejects(run(uid(3), "T2"), { code: "42501" });
  await assert.rejects(run(uid(2), "T2"), { code: "42501" });
  await assert.rejects(run(uid(2), "T1", uid(10), batchHash, records, "z".repeat(64)), {
    code: "42501",
  });
  const expected = { inserted: 1, duplicates: 1, unmatched: 1 };
  assert.deepEqual(await run(), expected);
  assert.deepEqual(await run(), expected);
  await assert.rejects(run(uid(2), "T1", uid(10), "c".repeat(64)), { code: "23505" });
  const mapped = await db.query(
    "SELECT processing_status, status, attendance_log_id IS NOT NULL AS linked FROM device_sync_records ORDER BY user_pin,status",
  );
  assert.deepEqual(mapped.rows, [
    { processing_status: "inserted", status: 0, linked: true },
    { processing_status: "duplicate", status: 1, linked: false },
    { processing_status: "unmatched", status: 0, linked: false },
  ]);
  assert.equal(
    (await db.query("SELECT extract(hour FROM verify_time)::int AS hour FROM attendance_logs"))
      .rows[0].hour,
    4,
  );

  // A rejected audit write rolls back its attendance insert before a retry.
  const retryLog = { ...item, verify_time: "2026-11-19T08:15:00+03:00" };
  await db.exec(
    "RESET ROLE; ALTER TABLE device_sync_records ADD CONSTRAINT simulate_error CHECK (verify_time < '2026-11-19T05:00:00Z'); SET ROLE service_role",
  );
  assert.deepEqual(await run(uid(2), "T1", uid(11), batchHash, [retryLog]), { failed: true });
  assert.equal(
    (await db.query("SELECT count(*)::int AS count FROM attendance_logs")).rows[0].count,
    1,
  );
  assert.equal(
    (await db.query("SELECT mobile_status FROM sync_batches WHERE id=$1", [uid(11)])).rows[0]
      .mobile_status,
    "failed",
  );
  await db.exec(
    "RESET ROLE; ALTER TABLE device_sync_records DROP CONSTRAINT simulate_error; SET ROLE service_role",
  );
  assert.deepEqual(await run(uid(2), "T1", uid(11), batchHash, [retryLog]), {
    inserted: 1,
    duplicates: 0,
    unmatched: 0,
  });
  await db.exec("UPDATE mobile_device_sync_keys SET revoked_at = now()");
  await assert.rejects(run(), { code: "42501" });
});

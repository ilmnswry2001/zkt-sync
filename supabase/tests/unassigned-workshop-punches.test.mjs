import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

test("unassigned workshop punches include all devices by default and paginate eligible employees", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE TABLE employees(id uuid PRIMARY KEY, employee_no text UNIQUE, full_name text, position text, status text);
    CREATE TABLE daily_workshops(id uuid PRIMARY KEY, is_active boolean);
    CREATE TABLE daily_workshop_members(workshop_id uuid, employee_id uuid, is_active boolean);
    CREATE TABLE attendance_logs(id uuid DEFAULT gen_random_uuid(), employee_id uuid, employee_no text,
      verify_time timestamptz, device_id uuid, is_suspicious boolean DEFAULT false, self_event_type text,
      status integer, verify_type integer);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY test_scope ON attendance_logs TO authenticated USING (current_setting('test.can_read', true) = 'on');
    INSERT INTO employees SELECT lpad(n::text, 32, '0')::uuid, n::text, 'Employee ' || n, NULL,
      CASE WHEN n = 25 THEN 'inactive' ELSE 'active' END FROM generate_series(1,26) n;
    INSERT INTO daily_workshops VALUES (lpad('101',32,'0')::uuid, true), (lpad('102',32,'0')::uuid, false);
    INSERT INTO daily_workshop_members SELECT lpad('101',32,'0')::uuid,id,true FROM employees WHERE employee_no='22';
    INSERT INTO daily_workshop_members SELECT lpad('102',32,'0')::uuid,id,true FROM employees WHERE employee_no='23';
    INSERT INTO attendance_logs(employee_id,employee_no,verify_time,device_id,status,is_suspicious)
    SELECT CASE WHEN employee_no='21' THEN NULL ELSE id END,employee_no,'2026-11-20 22:00Z',
      lpad(CASE WHEN employee_no='21' THEN '201' ELSE '202' END,32,'0')::uuid,
      CASE WHEN employee_no='24' THEN 1 ELSE 0 END, employee_no='26' FROM employees;
    INSERT INTO attendance_logs(employee_id,employee_no,verify_time,device_id,status)
      SELECT id,employee_no,'2026-11-21 07:00Z',lpad('201',32,'0')::uuid,0 FROM employees WHERE employee_no='21';
    INSERT INTO attendance_logs(employee_id,employee_no,verify_time,status)
      SELECT id,employee_no,'2026-11-21 21:00Z',0 FROM employees WHERE employee_no='24';
  `);
  await db.exec(await readFile(new URL("../migrations/20261121100000_unassigned_workshop_punches.sql", import.meta.url), "utf8"));
  const read = async (page = 0, devices = null, excluded = null) =>
    (await db.query("SELECT list_unassigned_workshop_punches('2026-11-21',$1,$2,$3) AS result", [devices, excluded, page])).rows[0].result;
  await db.exec("SET ROLE anon");
  await assert.rejects(read(), { code: "42501" });
  await db.exec("RESET ROLE; SET ROLE authenticated");
  assert.deepEqual(await read(), { totalCount: 0, rows: [] });
  await db.exec("SET test.can_read='on'");
  const first = await read();
  assert.equal(first.totalCount, 22);
  assert.equal(first.rows.length, 20);
  const second = await read(1);
  assert.deepEqual(second.rows.map(({ employee }) => employee.employee_no), ["21", "23"]);
  const device = second.rows[0].punch.device_id;
  const selected = await read(0, [device]);
  assert.equal(selected.totalCount, 1);
  assert.equal(selected.rows[0].punch.verify_time, "2026-11-20T22:00:00+00:00");
  assert.deepEqual(await read(0, [device], [selected.rows[0].employee.id]), { totalCount: 0, rows: [] });
  await db.exec("RESET ROLE");
  await db.query("INSERT INTO daily_workshop_members VALUES (lpad('101',32,'0')::uuid, $1, true)", [selected.rows[0].employee.id]);
  await db.exec("SET ROLE authenticated");
  assert.deepEqual(await read(0, [device]), { totalCount: 0, rows: [] });
});

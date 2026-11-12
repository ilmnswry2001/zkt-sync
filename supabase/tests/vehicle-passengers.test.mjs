import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("vehicle seats, driver separation, date overlaps and attendance windows are enforced in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(99)}'::uuid $$;
 CREATE FUNCTION public.is_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.role',true)='admin' $$;CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.role',true)=$2 $$;
 CREATE TABLE employees(id uuid PRIMARY KEY,full_name text,employee_no text);
 CREATE TABLE vehicles(id uuid PRIMARY KEY,vehicle_class text,is_active boolean,current_driver_id uuid);
 CREATE TABLE attendance_logs(employee_id uuid,verify_time timestamptz,is_suspicious boolean);
 ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;CREATE POLICY vehicle_read ON vehicles FOR SELECT TO authenticated USING(true);CREATE POLICY vehicle_write ON vehicles FOR ALL TO authenticated USING(public.is_admin(auth.uid())) WITH CHECK(public.is_admin(auth.uid()));
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT SELECT,INSERT,UPDATE ON vehicles TO authenticated;GRANT SELECT ON employees,attendance_logs TO authenticated;SET test.role='admin';`);
    await db.exec(
      await readFile(
        new URL("../migrations/20261112200000_vehicle_passenger_utilization.sql", import.meta.url),
        "utf8",
      ),
    );
    for (let n = 1; n <= 4; n++)
      await db.query("INSERT INTO employees VALUES($1,$2,$3)", [id(n), `Employee ${n}`, String(n)]);
    await db.query("INSERT INTO vehicles VALUES($1,'light',true,$2,2),($3,'light',true,NULL,2)", [
      id(10),
      id(3),
      id(11),
    ]);
    const today = (
      await db.query("SELECT to_char(now() AT TIME ZONE 'Asia/Baghdad','YYYY-MM-DD') AS day")
    ).rows[0].day;
    const shift = (n) =>
      new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
    await db.exec("SET ROLE authenticated");
    await db.query(
      "INSERT INTO vehicle_passenger_assignments(id,vehicle_id,employee_id,starts_on) VALUES($1,$2,$3,$4)",
      [id(20), id(10), id(1), shift(-7)],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
        [id(11), id(1), today],
      ),
      /منسب/,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
        [id(10), id(3), today],
      ),
      /السائق/,
    );
    await db.query(
      "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
      [id(10), id(2), today],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
        [id(10), id(4), today],
      ),
      /يتجاوز/,
    );
    await assert.rejects(
      db.query("UPDATE vehicles SET passenger_capacity=1 WHERE id=$1", [id(10)]),
      /تكفي/,
    );
    await assert.rejects(
      db.query("UPDATE vehicles SET current_driver_id=$1 WHERE id=$2", [id(1), id(10)]),
      /السائق/,
    );
    await db.exec("RESET ROLE");
    for (const offset of [-8, -7, -6, 0])
      await db.query("INSERT INTO attendance_logs VALUES($1,$2,false),($1,$2,false)", [
        id(1),
        shift(offset) + "T05:00:00Z",
      ]);
    await db.query("INSERT INTO attendance_logs VALUES($1,$2,true)", [
      id(1),
      shift(-1) + "T05:00:00Z",
    ]);
    await db.exec("SET ROLE authenticated");
    let rows = (await db.query("SELECT * FROM vehicle_passenger_attendance($1)", [today])).rows;
    const person = rows.find((p) => p.employee_id === id(1));
    assert.equal(person.week_days, 2);
    assert.equal(person.month_days, 3);
    assert.equal(person.present_today, true);
    assert.equal(rows.length, 2, "driver excluded from passenger occupancy");
    await db.query("UPDATE vehicle_passenger_assignments SET ends_on=$1 WHERE id=$2", [
      today,
      id(20),
    ]);
    await db.query(
      "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
      [id(11), id(1), shift(1)],
    );
    rows = (await db.query("SELECT * FROM vehicle_passenger_attendance($1)", [shift(1)])).rows;
    assert.equal(
      rows.find((p) => p.vehicle_id === id(10) && p.employee_id === id(1)).assigned,
      false,
      "history retained after transfer",
    );
    await db.exec("SET test.role='viewer'");
    await assert.rejects(
      db.query(
        "INSERT INTO vehicle_passenger_assignments(vehicle_id,employee_id,starts_on) VALUES($1,$2,$3)",
        [id(11), id(4), today],
      ),
      /row-level security/,
    );
  } finally {
    await db.close();
  }
});

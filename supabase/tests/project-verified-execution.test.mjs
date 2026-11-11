// Run with PGLITE_MODULE pointing to a separately installed @electric-sql/pglite module.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("verified execution reconciles priorities, conflicts, time boundaries and RLS in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(99)}'::uuid $$;
 CREATE TABLE employees(id uuid PRIMARY KEY,full_name text,employee_no text,position text);
 CREATE TABLE attendance_logs(employee_id uuid,verify_time timestamptz,is_suspicious boolean);
 CREATE TABLE site_work_plans(id uuid,site_id uuid,assigned_staff jsonb,status text,request_date date,created_at timestamptz,specialties jsonb DEFAULT '[]',final_plan jsonb);
 CREATE TABLE daily_workshop_reports(id uuid,workshop_id uuid,report_date date,work_site_id uuid);
 CREATE TABLE daily_workshop_report_lines(id uuid,report_id uuid,employee_id uuid,site_id uuid,role_label text,attended boolean);
 CREATE TABLE daily_workshop_members(workshop_id uuid,employee_id uuid,role_label text,is_active boolean);
 CREATE TABLE daily_workshops(id uuid,is_active boolean);
 CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 CREATE TABLE site_daily_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid,report_date date,notes text,created_by uuid,UNIQUE(site_id,report_date));
 CREATE TABLE report_catalog_items(id uuid,kind text,name text);
 CREATE TABLE site_daily_report_lines(id uuid DEFAULT gen_random_uuid(),report_id uuid,kind text,item_name text,total_count integer,working_count integer,idle_count integer,catalog_item_id uuid);
 GRANT INSERT,UPDATE,DELETE ON site_daily_reports,site_daily_report_lines TO authenticated; GRANT UPDATE ON site_work_plans TO authenticated;
 GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
 ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
 CREATE POLICY punches_visible ON attendance_logs FOR SELECT TO authenticated USING(employee_id <> '${id(8)}');`);
    await db.exec(
      await readFile(
        new URL("../migrations/20261111190000_project_verified_execution.sql", import.meta.url),
        "utf8",
      ),
    );
    for (let n = 1; n <= 9; n++)
      await db.query("INSERT INTO employees VALUES($1,$2,$3,$4)", [
        id(n),
        `Person ${n}`,
        String(n),
        "worker",
      ]);
    for (let n = 1; n <= 8; n++)
      await db.query("INSERT INTO attendance_logs VALUES($1,$2,$3)", [
        id(n),
        "2026-11-11T06:00:00Z",
        n === 7,
      ]);
    await db.query("INSERT INTO attendance_logs VALUES($1,$2,false),($1,$3,false),($4,$5,false)", [
      id(1),
      "2026-11-11T07:00:00Z",
      "2026-11-10T21:00:00Z",
      id(9),
      "2026-11-11T21:00:00Z",
    ]);
    await db.query("INSERT INTO daily_workshops VALUES($1,true)", [id(30)]);
    await db.query("INSERT INTO daily_workshop_reports VALUES($1,$2,$3,$4)", [
      id(40),
      id(30),
      "2026-11-11",
      id(101),
    ]);
    for (const n of [1, 2])
      await db.query("INSERT INTO daily_workshop_report_lines VALUES($1,$2,$3,$4,$5,true)", [
        id(50 + n),
        id(40),
        id(n),
        n === 1 ? id(102) : null,
        "steel",
      ]);
    // A conflicting explicit allocation must not be arbitrarily charged to either CTR.
    for (const site of [101, 102])
      await db.query("INSERT INTO daily_workshop_report_lines VALUES($1,$2,$3,$4,$5,true)", [
        id(site),
        id(40),
        id(3),
        id(site),
        "steel",
      ]);
    const staff = [{ specialty: "engineer", employees: [{ id: id(1) }, { id: id(4) }] }];
    await db.query(
      "INSERT INTO site_work_plans(id,site_id,assigned_staff,status,request_date,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [id(60), id(103), JSON.stringify(staff), "finalized", "2026-11-10", "2026-11-10T00:00:00Z"],
    );
    await db.query(
      "INSERT INTO site_work_plans(id,site_id,assigned_staff,status,request_date,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [id(61), id(103), "[]", "finalized", "2026-11-12", "2026-11-12T00:00:00Z"],
    );
    // Unsaved workshop attendance may use roster + task + actual punch, not roster alone.
    await db.query("INSERT INTO daily_workshop_reports VALUES($1,$2,$3,$4)", [
      id(41),
      id(31),
      "2026-11-11",
      id(104),
    ]);
    await db.query("INSERT INTO daily_workshops VALUES($1,true)", [id(31)]);
    await db.query("INSERT INTO daily_workshop_members VALUES($1,$2,$3,true)", [
      id(31),
      id(5),
      "welder",
    ]);
    await db.query("INSERT INTO site_work_plans(id,site_id,assigned_staff,status,request_date,created_at) VALUES($1,$2,'[]','finalized','2026-11-10','2026-11-10T00:00:00Z')",[id(62),id(101)]);
    await db.exec("SET ROLE authenticated");
    const { rows } = await db.query("SELECT * FROM project_verified_execution('2026-11-11')");
    assert.equal(rows.length, 6, "suspicious, RLS-hidden and next-day punches excluded");
    const byId = new Map(rows.map((r) => [r.employee_id, r]));
    assert.equal(byId.get(id(1)).site_id, id(102), "saved allocation overrides task and plan");
    assert.equal(byId.get(id(1)).first_punch.toISOString(), "2026-11-10T21:00:00.000Z");
    assert.equal(byId.get(id(2)).site_id, id(101), "unallocated saved attendance inherits task");
    assert.equal(byId.get(id(3)).site_id, null);
    assert.equal(byId.get(id(3)).conflicting, true);
    assert.equal(byId.get(id(4)).site_id, id(103), "future plan cannot replace historical plan");
    assert.equal(byId.get(id(5)).site_id, id(104), "punch plus unsaved task roster counts");
    assert.equal(byId.get(id(6)).assignment_source, "unallocated");
    assert.equal(new Set(rows.map((r) => r.employee_id)).size, rows.length);
    await db.query("INSERT INTO site_daily_reports VALUES($1,$2,$3,$4,$5)", [
      id(70),
      id(103),
      "2026-11-11",
      "manual note",
      id(99),
    ]);
    await db.query(
      "INSERT INTO site_daily_report_lines(report_id,kind,item_name,total_count) VALUES($1,'equipment_type','truck',2)",
      [id(70)],
    );
    await db.query("SELECT approve_site_report_from_biometrics($1,'2026-11-11')", [id(60)]);
    await db.query("SELECT approve_site_report_from_biometrics($1,'2026-11-11')", [id(60)]);
    const saved = await db.query(
      "SELECT kind,total_count FROM site_daily_report_lines WHERE report_id=$1 ORDER BY kind",
      [id(70)],
    );
    assert.deepEqual(
      saved.rows.map((r) => [r.kind, r.total_count]),
      [
        ["equipment_type", 2],
        ["worker_specialty", 1],
      ],
      "approval uses same ledger, retains equipment and is idempotent",
    );
    const note = await db.query("SELECT notes FROM site_daily_reports WHERE id=$1", [id(70)]);
    assert.ok(note.rows[0].notes.startsWith("manual note"));
    const approvedWorkshop=await db.query("SELECT approve_site_report_from_biometrics($1,'2026-11-11') AS id",[id(62)]);
    const workshopCount=await db.query("SELECT sum(total_count)::integer AS count FROM site_daily_report_lines WHERE report_id=$1 AND kind='worker_specialty'",[approvedWorkshop.rows[0].id]);
    assert.equal(workshopCount.rows[0].count,1,'approval includes workshop staff even when the plan has no named employees');
  } finally {
    await db.close();
  }
});

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const migration = new URL("../migrations/20261121160000_project_live_financials.sql", import.meta.url);

test("custody authorization fails closed and project financials honor site and dates", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid STABLE LANGUAGE sql AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE TABLE public.account_roles (user_id uuid, role text);
    CREATE FUNCTION public.has_role(uid uuid, access_role text) RETURNS boolean STABLE LANGUAGE sql AS
      'SELECT EXISTS (SELECT FROM public.account_roles WHERE user_id = uid AND role = access_role)';
    CREATE FUNCTION public.is_admin(uid uuid) RETURNS boolean STABLE LANGUAGE sql AS
      'SELECT public.has_role(uid, ''admin'')';
    CREATE FUNCTION public.erp_own_employee_id() RETURNS uuid STABLE LANGUAGE sql AS
      'SELECT CASE WHEN auth.uid() = ''${id(4)}'' THEN ''${id(40)}''::uuid END';
    CREATE TABLE public.sites (id uuid PRIMARY KEY);
    CREATE TABLE public.warehouses (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE public.warehouse_items (id uuid PRIMARY KEY, code text, name text, unit text, unit_cost numeric);
    CREATE TABLE public.stock_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, warehouse_id uuid, employee_id uuid,
      site_id uuid, movement_type text, movement_date date, qty_delta numeric, notes text
    );
    CREATE TABLE public.site_daily_reports (id uuid PRIMARY KEY, site_id uuid, report_date date, notes text);
    CREATE TABLE public.site_daily_report_lines (report_id uuid, kind text, item_name text, working_count int, total_count int);
    INSERT INTO auth.users VALUES ('${id(1)}'), ('${id(2)}'), ('${id(3)}'), ('${id(4)}'), ('${id(5)}');
    INSERT INTO account_roles VALUES ('${id(1)}', 'admin'), ('${id(2)}', 'hr'), ('${id(3)}', 'warehouse_keeper');
    INSERT INTO sites VALUES ('${id(100)}'), ('${id(101)}');
    INSERT INTO warehouses VALUES ('${id(10)}', 'المخزن الأول');
    INSERT INTO warehouse_items VALUES ('${id(11)}', 'MAT-1', 'مادة أولى', 'قطعة', 100.25), ('${id(12)}', null, 'مادة بلا سعر', 'قطعة', null);
    INSERT INTO stock_movements(item_id, warehouse_id, employee_id, site_id, movement_type, movement_date, qty_delta, notes) VALUES
      ('${id(11)}', '${id(10)}', null, '${id(100)}', 'issue', '2026-11-20', 2, 'صرف سابق'),
      ('${id(11)}', '${id(10)}', null, '${id(100)}', 'issue', '2026-11-21', -3, 'صرف للموقع'),
      ('${id(12)}', '${id(10)}', null, '${id(100)}', 'issue', '2026-11-21', -1, null),
      ('${id(11)}', '${id(10)}', null, '${id(100)}', 'transfer_out', '2026-11-21', -100, null),
      ('${id(11)}', '${id(10)}', null, '${id(101)}', 'issue', '2026-11-21', -100, null),
      ('${id(11)}', '${id(10)}', '${id(40)}', null, 'tool_out', '2026-11-20', 2, null);
    INSERT INTO site_daily_reports VALUES
      ('${id(21)}', '${id(100)}', '2026-11-20', 'تم الاعتماد آلياً من مطابقة البصمة'),
      ('${id(22)}', '${id(100)}', '2026-11-21', 'تم الاعتماد آلياً من مطابقة البصمة'),
      ('${id(23)}', '${id(100)}', '2026-11-19', 'تقرير يدوي'),
      ('${id(24)}', '${id(101)}', '2026-11-21', 'تم الاعتماد آلياً من مطابقة البصمة');
    INSERT INTO site_daily_report_lines VALUES
      ('${id(21)}','worker_specialty','عامل',2,50), ('${id(22)}','worker_specialty','عامل',3,50),
      ('${id(22)}','equipment_type','عامل',90,90), ('${id(23)}','worker_specialty','عامل',90,90),
      ('${id(24)}','worker_specialty','عامل',90,90);
  `);
  await db.exec(await readFile(migration, "utf8"));
  const grants = (await db.query(`SELECT role, has_function_privilege(role, 'public.get_employee_custody(uuid)', 'EXECUTE') AS allowed
      FROM unnest(ARRAY['anon','authenticated','service_role']) role`)).rows;
  assert.deepEqual(grants.map(({ allowed }) => allowed), [false, true, false]);
  const custody = (employee = id(40)) => db.query("SELECT * FROM public.get_employee_custody($1)", [employee]);
  const login = (person) => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [person]);
  const scope = [id(100), "2026-11-21", "2026-11-21"];
  const summary = async (params = scope) =>
    (await db.query("SELECT public.read_project_financials($1,$2,$3) AS value", params)).rows[0].value;
  const setBudget = () => db.query("SELECT public.set_site_ctr_budget($1, $2)", [id(100), 50_000]);
  await db.exec("SET ROLE anon");
  await assert.rejects(custody(), { code: "42501" });
  await db.exec("SET ROLE authenticated");
  await assert.rejects(custody(), { code: "42501" });
  for (const person of [1, 2, 3, 4]) {
    await login(id(person));
    assert.equal((await custody()).rows.length, 1);
  }
  await assert.rejects(custody(id(41)), { code: "42501" });
  await login(id(5));
  await assert.rejects(custody(), { code: "42501" });
  await assert.rejects(summary(), { code: "42501" });
  await login(id(2));
  await assert.rejects(setBudget(), { code: "42501" });
  await login(id(1));
  await setBudget();
  const daily = await summary();
  assert.equal(daily.budget, 50_000);
  assert.equal(daily.approvedReports, 1);
  assert.deepEqual(daily.crew, [{ name: "عامل", period_count: 3, cumulative_count: 5 }]);
  assert.deepEqual(daily.materials, { period_cost: 300.75, cumulative_cost: 501.25, period_unpriced: 1, cumulative_unpriced: 1 });
  const total = await summary([id(100), null, "2026-11-21"]);
  assert.equal(total.materials.period_cost, total.materials.cumulative_cost);
  const page = (offset) => db.query("SELECT public.read_project_material_issues($1,$2,$3,$4,1) AS value", [...scope, offset]);
  const first = (await page(0)).rows[0].value[0];
  const second = (await page(1)).rows[0].value[0];
  assert.notEqual(first.id, second.id);
  assert.equal(first.warehouse_name, "المخزن الأول");
  assert.equal([first, second].find((row) => row.unit_cost !== null).notes, "صرف للموقع");
  assert.deepEqual((await page(2)).rows[0].value, []);
});

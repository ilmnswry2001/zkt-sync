import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (sequence) => `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

test("account directory stays scoped and access changes commit together", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    CREATE TYPE public.app_role AS ENUM ('admin', 'hr', 'supervisor', 'data_entry', 'site_admin',
      'department_manager', 'engineer', 'planning_officer', 'warehouse_keeper',
      'procurement_officer', 'maintenance_manager', 'maintenance_admin', 'accountant');
    CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name text, email text, created_at timestamptz DEFAULT now(), allowed_sections text[]);
    CREATE TABLE public.user_roles (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, role public.app_role, UNIQUE(user_id, role));
    CREATE TABLE public.departments (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.user_departments (user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE, UNIQUE(user_id, department_id));
    CREATE FUNCTION public.is_admin(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
      'SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = ''admin'')';
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_profile ON public.profiles TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
    INSERT INTO auth.users SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(1,27) n;
    INSERT INTO public.profiles(id, full_name, email) SELECT id, 'موظف ' || right(id::text, 2), lower(right(id::text, 2)) || '@erp.example' FROM auth.users;
    INSERT INTO public.user_roles(user_id, role) VALUES ('${id(1)}', 'admin'), ('${id(2)}', 'data_entry'), ('${id(3)}', 'admin');
    INSERT INTO public.departments VALUES ('${id(40)}', 'المخازن'), ('${id(41)}', 'الموارد البشرية');
  `);
  await db.exec(await readFile(new URL("../migrations/20261121153000_account_access_management.sql", import.meta.url), "utf8"));

  await db.exec("SET ROLE anon");
  await assert.rejects(db.query("SELECT public.read_account_directory()"), { code: "42501" });
  await db.exec("SET ROLE authenticated");
  const login = (user) => db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user]);
  const result = async (sql, params) => (await db.query(sql, params)).rows[0].result;
  const directory = (search = "", role = "", page = 0) => result("SELECT public.read_account_directory($1,$2,$3) AS result", [search, role, page]);
  const access = () => result("SELECT public.read_account_access($1) AS result", [id(2)]);
  const save = ({ user = id(2), roles = ["department_manager"], departments = [id(40)], expected = null } = {}) =>
    db.query("SELECT public.save_account_access($1,$2,$3,$4,$5,true,false,false,$6,$7)", [
      user, "حساب المخازن", "{" + roles.join(",") + "}", departments, ["/warehouses"], ["HSE"], expected,
    ]);

  await login(id(2));
  await assert.rejects(directory(), { code: "42501" });
  await assert.rejects(access(), { code: "42501" });
  await assert.rejects(save(), { code: "42501" });
  await assert.rejects(db.query("UPDATE public.profiles SET allowed_sections = ARRAY['/payroll']"), { code: "42501" });
  await db.query("UPDATE public.profiles SET full_name = 'موظف المخازن'");

  await login(id(1));
  const first = await directory();
  const second = await directory("", "", 1);
  assert.equal(first.total, 27);
  assert.equal(first.admins, 2);
  assert.equal(first.unassigned, 24);
  assert.equal(first.accounts.length, 20);
  assert.equal(second.accounts.length, 7);
  assert.equal(new Set([...first.accounts, ...second.accounts].map((row) => row.id)).size, 27);
  assert.equal((await directory("27@ERP.EXAMPLE")).accounts[0].id, id(27));
  assert.equal((await directory("موظف المخازن", "data_entry")).filteredCount, 1);
  assert.equal((await directory("", "unassigned")).filteredCount, 24);

  const original = await access();
  await assert.rejects(save({ user: id(1), roles: [] }), { code: "42501" });
  await assert.rejects(save({ departments: [id(40), id(41)], expected: original }), { code: "22023" });
  await assert.rejects(save({ departments: [id(99)], expected: original }), { code: "23503" });
  assert.deepEqual(await access(), original);

  await save({ expected: original });
  const updated = await access();
  assert.equal(updated.fullName, "حساب المخازن");
  assert.deepEqual(updated.roles, ["department_manager"]);
  assert.deepEqual(updated.departments, [{ id: id(40), name: "المخازن" }]);
  assert.deepEqual(updated.allowedSections, ["/warehouses"]);
  assert.deepEqual(updated.plan, { canRequest: true, canApprove: false, canStaffAll: false, specialties: ["HSE"] });
  await assert.rejects(save({ roles: ["admin"], expected: original }), { code: "40001" });
  assert.deepEqual(await access(), updated);

  await login(id(2));
  assert.equal((await db.query("SELECT * FROM public.plan_staffing_permissions")).rows.length, 1);
  await assert.rejects(db.query("UPDATE public.plan_staffing_permissions SET can_approve = true"), { code: "42501" });
  await login(id(3));
  assert.equal((await db.query("SELECT * FROM public.plan_staffing_permissions")).rows.length, 1);

  await db.exec("RESET ROLE");
  await login("");
  await db.query("DELETE FROM auth.users WHERE id = $1", [id(3)]);
  await assert.rejects(db.query("DELETE FROM auth.users WHERE id = $1", [id(1)]), { code: "23514" });
});

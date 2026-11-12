import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const memberTables =
  "daily_workshops daily_workshop_members daily_workshop_reports daily_workshop_report_lines attendance_logs attendance_day_status site_daily_reports site_daily_report_lines site_work_plans departments shifts sites leave_types leave_settings warehouses warehouse_items machinery maintenance_types navigation_settings".split(
    " ",
  );
const financeTables = ["salary_additions", "employee_penalties", "wage_rates"];
test("ERP roles, payroll projections, owner records and storage boundaries", async () => {
  const db = new PGlite();
  const extras = {
    employees:
      "email text, employee_no text, full_name text, position text, base_salary numeric, pay_type text,salary_type text, contract_type text, bank_name text, bank_account text, iban text,site_id uuid,department_id uuid,wage_rate_id uuid,shift_id uuid",
    departments: "name text",
    sites: "name text",
    shifts: "end_time time,grace_minutes int",
    wage_rates:
      "title text, monthly_rate numeric,daily_rate numeric,overtime_hour_rate numeric,currency text",
    attendance_logs:
      "employee_no text,verify_time timestamptz,status int,source text,self_event_type text",
    attendance_day_status:
      "employee_id uuid,work_date date,status text,notes text,overtime_hours numeric",
    machinery: "code text,asset_number text,name text,category text,status text,daily_rent numeric",
    leave_types: "is_paid boolean,count_non_working_days boolean",
  };
  const count = async (table, where = "") =>
    Number((await db.query("select count(*) n from " + table + " " + where)).rows[0].n);
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create schema storage;
      create table auth.users(id uuid,email text,email_confirmed_at timestamptz);create table user_roles(user_id uuid,role text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function has_role(uuid,text) returns boolean language sql stable security definer as $$select exists(select from public.user_roles where user_id=$1 and role=$2)$$;
      create function is_admin(uuid) returns boolean language sql stable as $$select public.has_role($1,'admin')$$;
      create function has_form_role(uuid,text) returns boolean language sql stable as $$select $1='${id(9)}'::uuid and $2='ceo'$$;
      create table storage.buckets(id text,public boolean);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,owner_id text);
      alter table storage.objects enable row level security;
      grant usage on schema auth,storage to authenticated,anon;
      grant select on user_roles to authenticated;
      grant select,insert,update,delete on storage.objects to authenticated,anon;
      insert into storage.buckets values ('zk-backups',true),('fuel-receipts',true),('maintenance-attachments',true),('vehicle-images',true);
      insert into auth.users values ('${id(1)}','owner@test.invalid',now());
    `);
    for (const [n, r] of Object.entries({
      2: "supervisor",
      3: "admin",
      4: "hr",
      5: "accountant",
      6: "department_manager",
      7: "site_admin",
      8: "data_entry",
    }))
      await db.query("insert into user_roles values ($1,$2)", [id(n), r]);
    for (const t of ["employees", "profiles", ...financeTables, ...memberTables]) {
      await db.exec(`create table public.${t}(id uuid default gen_random_uuid() primary key${extras[t] ? ", " + extras[t] : ""});
        alter table public.${t} enable row level security;grant all on ${t} to authenticated;
        create policy old_read on ${t} for select to authenticated using(true);
        insert into ${t}(id) values('${id(1)}');`);
    }
    await db.exec(`update attendance_logs set verify_time='2026-11-02';update attendance_day_status set work_date='2026-11-02';
      insert into employees(id) values('${id(2)}');update employees set email='owner@test.invalid' where id='${id(1)}';
      insert into profiles values ('${id(2)}');
      create policy roster_write on daily_workshop_members for all to authenticated using(has_role(auth.uid(),'supervisor')) with check(has_role(auth.uid(),'supervisor'));
      create policy old_upload on attendance_logs for insert to authenticated with check(true);`);
    await db.exec(
      await readFile(
        new URL("../migrations/20261112130000_erp_rls_storage_hardening.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(`alter table auth.users add column raw_user_meta_data jsonb;alter table profiles add column full_name text;alter table profiles add column email text;
      create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
      insert into auth.users(id,email) values('${id(30)}','new@test.invalid');
      create policy unrelated_legacy_grant on storage.objects for all using(true) with check(true);`);
    assert.equal(await count("public.user_roles", `where user_id='${id(30)}'`), 0);
    assert.equal(await count("storage.buckets", "where public"), 0);
    await db.exec("set role authenticated");
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await db.exec(`set test.uid='${id(n)}'`);
      const finance = [3, 4, 5, 9].includes(n),
        member = n >= 2 && n <= 8;
      assert.equal(await count("employees"), [2, 3, 4, 6, 7, 8].includes(n) ? 2 : n === 1 ? 1 : 0);
      assert.equal(await count("profiles"), [3, 4].includes(n) ? 3 : [1, 2].includes(n) ? 1 : 0);
      for (const t of financeTables) {
        assert.equal(await count(t), Number(finance));
        if (finance)
          await db.exec(
            `insert into ${t}(id) values('${id(99)}');delete from ${t} where id='${id(99)}'`,
          );
        else await assert.rejects(db.exec(`insert into ${t} default values`));
      }
      for (const t of memberTables) assert.equal(await count(t), Number(member));
      assert.equal(await count("payroll_employee_directory()"), finance ? 2 : 0);
      for (const f of ["logs", "days"])
        assert.equal(
          await count("payroll_read_" + f + "('2026-11-01','2026-12-01')"),
          Number(finance),
        );
      for (const f of ["machinery", "leave_types"])
        assert.equal(await count("payroll_read_" + f + "()"), Number(finance));
      if (n === 2)
        await db.exec(
          `insert into daily_workshop_members(id) values('${id(99)}');delete from daily_workshop_members where id='${id(99)}'`,
        );
      if (!member) await assert.rejects(db.exec("insert into attendance_logs default values"));
    }
    await db.exec(
      `set test.uid='${id(3)}';insert into storage.objects(bucket_id,owner_id) values ('zk-backups','${id(3)}'),('fuel-receipts','${id(3)}');set test.uid='${id(1)}'`,
    );
    assert.equal(await count("storage.objects"), 1);
    await assert.rejects(db.exec("insert into storage.objects(bucket_id) values ('zk-backups')"));
    await assert.rejects(
      db.exec(
        `insert into storage.objects(bucket_id,owner_id) values ('vehicle-images','${id(3)}')`,
      ),
    );
    await db.exec(
      `insert into storage.objects(bucket_id,owner_id) values ('vehicle-images','${id(1)}');delete from storage.objects`,
    );
    assert.equal(await count("storage.objects"), 1);
    await db.exec(`set test.uid='${id(2)}';delete from storage.objects`);
    assert.equal(await count("storage.objects"), 0);
    await db.exec("reset role;set role anon");
    await assert.rejects(db.query("select * from employees"));
    await assert.rejects(db.query("select * from payroll_employee_directory()"));
    assert.equal(await count("storage.objects"), 0);
  } finally {
    await db.close();
  }
});

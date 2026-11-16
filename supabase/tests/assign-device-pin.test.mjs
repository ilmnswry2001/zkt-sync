import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

test("assigning an unmatched PIN updates the profile and counts each distinct punch once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create function is_admin(uuid) returns boolean language sql as $$select false$$;
      create function has_role(uuid,text) returns boolean language sql as $$select current_setting('test.role',true)=$2$$;
      create table employees(id uuid primary key default gen_random_uuid(),employee_no text,attendance_device_id text);
      create table devices(id uuid primary key default gen_random_uuid(),auto_synced_logs_total bigint default 0);
      create table sync_batches(id uuid primary key default gen_random_uuid(),inserted_count int default 0,duplicate_count int default 0,unmatched_count int default 3);
      create table attendance_logs(id uuid primary key default gen_random_uuid(),employee_no text,employee_id uuid,device_id uuid,upload_id uuid,verify_time timestamptz,verify_type int,status int,external_log_id int,source text,unique(employee_no,verify_time));
      create table device_sync_records(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),employee_no text,employee_id uuid,device_id uuid,upload_id uuid,sync_batch_id uuid,attendance_log_id uuid,verify_time timestamptz,verify_type int,status int,external_log_id int,processing_status text default 'unmatched',error_message text,user_pin text,archived_at timestamptz);
      insert into employees(employee_no) values('E1'),('E2'); insert into devices default values; insert into sync_batches default values;
      insert into device_sync_records(user_pin,device_id,sync_batch_id,verify_time,archived_at)
        select '0012',d.id,b.id,now()+make_interval(hours=>n),case when n=2 then now() end from devices d,sync_batches b,unnest(array[0,0,1,2]) n;
    `);
    await db.exec(await readFile(new URL("../migrations/20261116120000_assign_unmatched_device_pin.sql", import.meta.url), "utf8"));
    const assign = () => db.query("select assign_unmatched_device_pin((select id from device_sync_records where archived_at is null limit 1),(select id from employees where employee_no='E1'),null) n");
    await assert.rejects(assign(), /التنسيب/);
    await db.exec("set test.role='hr';update employees set attendance_device_id='0012' where employee_no='E2'");
    await assert.rejects(assign(), /موظف آخر/);
    await db.exec("update employees set attendance_device_id=null where employee_no='E2'");
    assert.equal((await assign()).rows[0].n, 3);
    assert.equal((await db.query("select attendance_device_id from employees where employee_no='E1'")).rows[0].attendance_device_id, "0012");
    assert.deepEqual((await db.query("select inserted_count,duplicate_count,unmatched_count from sync_batches")).rows[0],
      {inserted_count:2,duplicate_count:1,unmatched_count:0});
    assert.equal((await db.query("select count(*)::int n from attendance_logs")).rows[0].n, 2);
    await assert.rejects(assign(), /غير متاحة/);
  } finally { await db.close(); }
});

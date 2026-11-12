import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

test("profile transfers update the active daily roster atomically", async () => {
  const db = new PGlite();
  const employee = "00000000-0000-4000-8000-000000000010";
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  const transfer = (target, role = null) => db.query(
    "select public.set_employee_profile_workshop($1,$2,$3)", [employee,target,role]);
  const roster = async target => (await db.query(
    "select employee_id,role_label from daily_workshop_members where workshop_id=$1 and is_active", [target])).rows;
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '${employee}'::uuid $$;
      create function public.has_role(uuid,text) returns boolean language sql as $$ select $2=current_setting('test.actor') $$;
      create table daily_workshops(id uuid primary key,is_active boolean not null);
      create table daily_workshop_members(employee_id uuid,workshop_id uuid references daily_workshops,role_label text check(length(role_label)<=120),is_active boolean,unique(workshop_id,employee_id));
      insert into daily_workshops values('${a}',true),('${b}',true);
      insert into daily_workshop_members values('${employee}','${a}',null,true),('${employee}','${b}',null,true);
      set test.actor='supervisor';`);
    await db.exec(await readFile(new URL("../migrations/20261112120000_employee_profile_workshop.sql",import.meta.url),"utf8"));
    await assert.rejects(transfer(b,"x".repeat(121)));
    assert.equal((await roster(a)).length,1);
    await transfer(b,"فني");
    assert.deepEqual(await roster(a),[]);
    assert.deepEqual(await roster(b),[{employee_id:employee,role_label:"فني"}]);
    await db.exec("set test.actor='data_entry'");
    await assert.rejects(transfer(null));
    assert.equal((await roster(b)).length,1);
    await db.exec("set test.actor='hr'");
    await transfer(null);
    assert.deepEqual(await roster(b),[]);
  } finally { await db.close(); }
});

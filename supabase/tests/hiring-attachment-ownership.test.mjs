import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

test("hiring attachments require uploader ownership, an administrative role and a request", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create schema storage;
      create function auth.uid() returns uuid language sql as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create function public.is_admin(uuid) returns boolean language sql as $$select current_setting('test.role')='admin'$$;
      create function public.has_role(uuid,text) returns boolean language sql as $$select current_setting('test.role')=$2$$;
      create function storage.foldername(text) returns text[] language sql as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
      create table public.hiring_requests(id uuid primary key);
      insert into public.hiring_requests values ('00000000-0000-4000-8000-000000000002');
      create table storage.objects(bucket_id text, name text, owner_id text, owner uuid);
      alter table storage.objects enable row level security;
      create policy general_access on storage.objects for all to authenticated using(true) with check(true);
      grant usage on schema storage,auth to authenticated;
      grant select on public.hiring_requests to authenticated;
      grant select,insert on storage.objects to authenticated;
    `);
    await db.exec(await readFile(new URL("../migrations/20261127100000_hiring_attachment_ownership.sql", import.meta.url), "utf8"));
    const folder = "00000000-0000-4000-8000-000000000002";
    const user = "00000000-0000-4000-8000-000000000001";
    const insert = (path, ownerId, owner) => db.query("insert into storage.objects values ('hiring-request-files',$1,$2,$3)", [path, ownerId, owner]);
    await insert(folder + "/other", folder, null);
    await db.exec("set role authenticated; set test.role='hr'");
    await insert(folder + "/current", user, null);
    await db.exec("set test.role='admin'");
    await insert(folder + "/legacy", null, user);
    const visible = async () => (await db.query("select name from storage.objects order by name")).rows.map(row => row.name);
    assert.deepEqual(await visible(), [folder + "/current", folder + "/legacy"]);
    await assert.rejects(insert(folder + "/other", folder, null), {code:"42501"});
    await assert.rejects(insert(user + "/missing", user, null), {code:"42501"});
    await assert.rejects(insert(folder + "/nested/file", user, null), {code:"42501"});
    await db.exec("set test.role='employee'");
    assert.deepEqual(await visible(), []);
    await assert.rejects(insert(folder + "/denied", user, null), {code:"42501"});
  } finally {
    await db.close();
  }
});

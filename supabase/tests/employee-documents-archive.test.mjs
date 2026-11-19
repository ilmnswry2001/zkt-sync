import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("employee archive paginates and enforces ownership, attachment paths and storage policies", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema storage;
    create schema auth;
    grant usage on schema storage, auth to authenticated, anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.archive_actor', true), '')::uuid
    $$;
    create function public.is_admin(uuid) returns boolean language sql stable as $$ select $1 = '${id(1)}' $$;
    create function public.has_role(uuid,text) returns boolean language sql stable as $$ select $1 = '${id(4)}' and $2 = 'hr' $$;
    create function public.erp_own_employee_id() returns uuid language sql stable as $$
      select case auth.uid() when '${id(2)}'::uuid then '${id(12)}'::uuid when '${id(3)}'::uuid then '${id(13)}'::uuid end
    $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
    create table public.departments(id uuid primary key, name text);
    create table public.employees(id uuid primary key, full_name text, employee_no text, position text, department_id uuid);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text, primary key (bucket_id, name));
    alter table storage.objects enable row level security;
    grant select on public.departments, public.employees to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated, anon;
    create policy broad_storage_test on storage.objects for all using (true) with check (true);
    insert into auth.users values ('${id(1)}'), ('${id(2)}'), ('${id(3)}'), ('${id(4)}');
    insert into departments values ('${id(100)}', 'الموارد البشرية');
    insert into employees values
      ('${id(12)}', 'حسين علي جوري', '0012', 'عامل', '${id(100)}'),
      ('${id(13)}', 'موظف آخر', '0013', null, null);
  `);
  await db.exec(
    await readFile(
      new URL("../migrations/20261119140000_employee_documents_archive.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("set role authenticated");
  const actor = (n) => db.query("select set_config('test.archive_actor', $1, false)", [id(n)]);
  const list = async (search = "", page = 0, type = null) =>
    (
      await db.query("select list_employee_documents(null,$1,$2,null,null,$3) as result", [
        type,
        search,
        page,
      ])
    ).rows[0].result;
  const path = `${id(12)}/${id(20)}/attachment`;
  await actor(1);
  await db.query(
    `insert into employee_documents
    (id, employee_id, document_type, document_number, document_date, title, file_path, file_name, file_size, mime_type, created_by)
    values ($1,$2,'work_commencement','A-100','2026-11-19','مباشرة',$3,'file.pdf',100,'application/pdf',$4)`,
    [id(20), id(12), path, id(1)],
  );
  await db.exec(`insert into employee_documents
    (employee_id, document_type, document_number, document_date, title, created_by)
    select '${id(13)}','official_letter','B-' || n,'2026-11-18','كتاب','${id(1)}' from generate_series(1,21) n`);
  await assert.rejects(
    db.query("insert into storage.objects values ('employee-documents','unlinked')"),
    { code: "42501" },
  );
  await db.query("insert into storage.objects values ('employee-documents',$1)", [path]);
  await db.query("update storage.objects set name = 'changed' where name = $1", [path]);
  assert.deepEqual((await db.query("select name from storage.objects")).rows, [{ name: path }]);
  assert.equal((await list()).totalCount, 22);
  assert.equal((await list()).rows.length, 20);
  assert.equal((await list("", 1)).rows.length, 2);
  assert.equal((await list("a-100")).rows[0].employee.departments.name, "الموارد البشرية");
  assert.equal((await list("حسين")).rows[0].document_number, "A-100");
  assert.equal((await list("", 0, "work_commencement")).totalCount, 1);
  assert.equal((await list()).stats.work_commencement, 1);
  await actor(2);
  assert.equal((await list()).totalCount, 1);
  assert.equal((await db.query("select name from storage.objects")).rows.length, 1);
  await db.query("delete from storage.objects where name = $1", [path]);
  assert.equal((await db.query("select name from storage.objects")).rows.length, 1);
  await assert.rejects(
    db.exec(`insert into employee_documents (employee_id, document_type, document_number, document_date, title, created_by)
    values ('${id(12)}','contract','x','2026-11-19','x','${id(2)}')`),
    { code: "42501" },
  );
  await actor(3);
  assert.equal((await list("حسين")).totalCount, 0);
  assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
  await db.exec("reset role; set role anon");
  assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
  await db.exec("reset role; set role authenticated");
  await actor(4);
  await db.query("delete from storage.objects where name = $1", [path]);
  await db.query("delete from employee_documents where id = $1", [id(20)]);
  assert.equal((await list()).totalCount, 21);
  assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
});

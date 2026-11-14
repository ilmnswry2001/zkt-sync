import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validate } from "../functions/_shared/form-schema.ts";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
test("public forms restrict data, preserve versions, reserve capacity and throttle retries", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create function public.is_admin(uuid) returns boolean language sql as $$select false$$;",
    );
    await db.exec(
      await readFile(
        new URL("../migrations/20261114150000_electronic_forms.sql", import.meta.url),
        "utf8",
      ),
    );
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const t = await one("select * from form_templates");
    const link = await one(
      "insert into form_links(template_id,max_submissions) values($1,1) returning *",
      [t.id],
    );
    const raw = {
      driver_name: "سائق",
      plate: "١٢",
      line: "خط",
      phone: "٠٧٧١٢٣٤٥٦٧٨",
      crew: [],
      extra: "ignore",
    };
    const clean = validate(t.schema, raw, { driver_name: "locked" }, ["driver_name"]);
    assert.equal(clean.driver_name, "locked");
    assert.equal(clean.plate, "12");
    assert.ok(!("extra" in clean));
    assert.throws(() => validate(t.schema, { ...raw, crew: [{}] }));
    assert.throws(() => validate(t.schema, { ...raw, crew: Array(31).fill({}) }));
    const get = async () => (await one("select get_public_form($1) f", [link.token])).f;
    await db.exec("set role anon");
    for (const table of [
      "form_templates",
      "form_template_versions",
      "form_links",
      "form_submissions",
      "site_settings",
    ])
      await assert.rejects(db.query("select * from " + table), /permission denied/);
    assert.equal((await get()).code, t.code);
    await db.exec("reset role");
    const save = async (request, ip = "hash") =>
      (
        await one("select commit_public_form($1,1,$2,$3,$4,'{}','{}') ref", [
          link.token,
          JSON.stringify(clean),
          ip,
          request,
        ])
      ).ref;
    const request = crypto.randomUUID(),
      ref = await save(request);
    assert.equal(await save(request), ref);
    assert.equal(await get(), null);
    await assert.rejects(save(crypto.randomUUID()), /link unavailable/);
    await db.query("update form_links set max_submissions=null,expires_at=now()-interval '1 day'");
    assert.equal(await get(), null);
    await assert.rejects(save(crypto.randomUUID()), /link unavailable/);
    await db.query("update form_links set expires_at=null,is_active=false");
    assert.equal(await get(), null);
    await assert.rejects(save(crypto.randomUUID()), /link unavailable/);
    await db.query("update form_links set is_active=true");
    for (let i = 1; i < 10; i++) await save(crypto.randomUUID());
    await assert.rejects(save(crypto.randomUUID()), /rate limit/);
    await db.query("update form_templates set title_ar='new'");
    assert.equal((await one("select version from form_templates")).version, 2);
    assert.equal(
      (await one("select title_ar from form_template_versions where version=1")).title_ar,
      t.title_ar,
    );
  } finally {
    await db.close();
  }
});

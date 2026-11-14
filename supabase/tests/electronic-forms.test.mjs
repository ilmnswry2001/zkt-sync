import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { submitPublicForm } from "../functions/_shared/submit-public-form.ts";
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
    await db.exec(
      await readFile(
        new URL("../migrations/20261114160000_public_form_reference_width.sql", import.meta.url),
        "utf8",
      ),
    );
    const sample = await one(
      "insert into form_links(template_id,max_submissions) values($1,1) returning token",
      [t.id],
    );
    const rpc = {
      async rpc(name, args) {
        const parameters = Object.entries(args);
        const binds = parameters.map(([key], i) => key + " => $" + (i + 1));
        const values = parameters.map(([key, v]) =>
          ["p_data", "p_locked"].includes(key) ? JSON.stringify(v) : v,
        );
        const row = await one("select " + name + "(" + binds.join(",") + ") as result", values);
        return { data: row.result, error: null };
      },
    };
    const payload = {
      token: sample.token,
      version: t.version,
      request_id: crypto.randomUUID(),
      data: raw,
    };
    const attempt = (body) =>
      submitPublicForm(
        new Request("http://localhost/api/public/submit-form", {
          method: "POST",
          headers: { "cf-connecting-ip": "192.0.2.1" },
          body: JSON.stringify(body),
        }),
        rpc,
        "test-only",
        undefined,
      );
    assert.equal((await attempt({ ...payload, website: "bot" })).status, 400);
    assert.equal((await attempt({ ...payload, data: {} })).status, 422);
    const response = await attempt(payload);
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.match(receipt.reference_code, /^TL-\d{4}-\d{8}$/);
    assert.deepEqual(await (await attempt(payload)).json(), receipt);
    assert.equal(
      (
        await one("select status from form_submissions where reference_code=$1", [
          receipt.reference_code,
        ])
      ).status,
      "pending_review",
    );
    assert.equal(
      (await one("select submissions_count from form_links where token=$1", [sample.token]))
        .submissions_count,
      1,
    );
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

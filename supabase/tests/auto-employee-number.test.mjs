import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

test("employee inserts allocate the next numeric number under the existing write policy", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TABLE public.employees (
        employee_no text NOT NULL UNIQUE,
        employee_import_data jsonb NOT NULL DEFAULT '{}'
      );
      ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT, UPDATE ON public.employees TO authenticated;
      CREATE POLICY read_employees ON public.employees FOR SELECT TO authenticated USING (true);
      CREATE POLICY manage_employees ON public.employees FOR ALL TO authenticated
        USING (current_setting('test.role', true) = 'hr')
        WITH CHECK (current_setting('test.role', true) = 'hr');
    `);
    await db.exec(await readFile(new URL("../migrations/20261119170000_auto_employee_number.sql", import.meta.url), "utf8"));
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.exec("INSERT INTO public.employees DEFAULT VALUES"), { code: "42501" });
    await db.exec("SET test.role = 'hr'");

    const addEmployee = () => db.query(
      "INSERT INTO public.employees DEFAULT VALUES RETURNING employee_no",
    );
    assert.deepEqual((await addEmployee()).rows, [{ employee_no: "1" }]);
    await db.exec("INSERT INTO public.employees (employee_no) VALUES ('99'), ('01000'), ('E7000')");
    await db.exec(`
      INSERT INTO public.employees (employee_no, employee_import_data)
      VALUES ('01000', '{"التسلسل":"01000"}')
      ON CONFLICT (employee_no) DO UPDATE SET
        employee_no = excluded.employee_no, employee_import_data = excluded.employee_import_data
    `);
    const created = await db.query(
      "INSERT INTO public.employees (employee_import_data) VALUES ($1) RETURNING employee_no, employee_import_data",
      [{ "التسلسل": null, "اسم الموظف": "موظف تجريبي" }],
    );
    assert.deepEqual(created.rows, [{
      employee_no: "1001",
      employee_import_data: { "التسلسل": "1001", "اسم الموظف": "موظف تجريبي" },
    }]);

    await db.exec("UPDATE public.employees SET employee_no = '2000' WHERE employee_no = '99'");
    await db.exec("BEGIN");
    assert.deepEqual((await addEmployee()).rows, [{ employee_no: "2001" }]);
    assert.deepEqual((await addEmployee()).rows, [{ employee_no: "2002" }]);
    await db.exec("ROLLBACK");
    assert.deepEqual((await addEmployee()).rows, [{ employee_no: "2001" }]);
    assert.deepEqual((await db.query("SELECT employee_no FROM public.employees ORDER BY employee_no")).rows
      .map(({ employee_no }) => employee_no), ["01000", "1", "1001", "2000", "2001", "E7000"]);
  } finally {
    await db.close();
  }
});

// Requires a separately installed PGlite module; never connects to production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("payroll recalculation is audited, reapproved and pays only allocated advance amounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${id(99)}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${id(99)}'::uuid $$;
 CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT COALESCE(current_setting('test.role',true),'')=$2 $$;
 CREATE FUNCTION public.is_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_role($1,'admin') $$;
 CREATE FUNCTION public.has_form_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_role($1,$2) $$;
 CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END; $$;
 CREATE TABLE wage_rates(id uuid PRIMARY KEY,title text,daily_rate numeric,monthly_rate numeric,currency text);ALTER TABLE wage_rates ENABLE ROW LEVEL SECURITY;
 CREATE TABLE employees(id uuid PRIMARY KEY,position text,salary_type text,pay_type text NOT NULL DEFAULT 'monthly',wage_rate_id uuid REFERENCES wage_rates(id),status text DEFAULT 'active');
 CREATE TABLE salary_additions(id uuid);ALTER TABLE salary_additions ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA public,auth TO authenticated;
 `);
    await db.exec(
      await readFile(
        new URL("../migrations/20261029120000_payroll_workflow_and_advances.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../migrations/20261111200000_payroll_specialty_recalculation.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query("INSERT INTO employees(id,position,salary_type) VALUES($1,$2,$3)", [
      id(1),
      "عامل/مدني",
      "DAILY",
    ]);
    await db.query("INSERT INTO employees(id,position) VALUES($1,$2),($3,$4)", [
      id(2),
      "نجار",
      id(3),
      "حداد",
    ]);
    await db.query(
      "INSERT INTO wage_rates VALUES($1,'نجار',35000,0,'IQD'),($2,'حداد',50000,0,'IQD'),($3,'حداد',55000,0,'IQD')",
      [id(10), id(11), id(12)],
    );
    await db.exec(
      await readFile(
        new URL("../migrations/20261111201000_employee_specialty_wage_repair.sql", import.meta.url),
        "utf8",
      ),
    );
    const repaired = await db.query("SELECT id,pay_type,wage_rate_id FROM employees ORDER BY id");
    assert.equal(repaired.rows[0].pay_type, "daily");
    assert.equal(repaired.rows[1].wage_rate_id, id(10));
    assert.equal(
      repaired.rows[2].wage_rate_id,
      null,
      "ambiguous rate must not be linked arbitrarily",
    );
    await db.exec("SET test.role='admin'");
    await db.query("INSERT INTO payroll_runs(id,month) VALUES($1,'2026-10-01')", [id(20)]);
    await db.query("INSERT INTO payroll_run_lines(payroll_run_id,employee_id) VALUES($1,$2)", [
      id(20),
      id(1),
    ]);
    await db.query("UPDATE payroll_runs SET status='review' WHERE id=$1", [id(20)]);
    await db.query("UPDATE payroll_runs SET status='approved' WHERE id=$1", [id(20)]);
    await db.query(
      "INSERT INTO employee_advances(id,employee_id,amount,installment_amount,installments_count,first_deduction_month) VALUES($1,$2,200,200,1,'2026-10-01')",
      [id(30), id(1)],
    );
    await db.query(
      "INSERT INTO employee_advance_installments(id,advance_id,month,amount) VALUES($1,$2,'2026-10-01',200)",
      [id(31), id(30)],
    );
    await db.exec("SET ROLE authenticated");
    await db.exec("SET test.role='accountant'");
    await assert.rejects(
      db.query("UPDATE payroll_runs SET status='draft' WHERE id=$1", [id(20)]),
      /immutable/,
    );
    const line = {
      employee_id: id(1),
      base_amount: 100,
      overtime_hours: 0,
      overtime_amount: 0,
      additions_amount: 0,
      deductions_amount: 0,
      calculation_snapshot: { payType: "daily" },
    };
    await db.query("SELECT recalculate_payroll_from_specialties($1,$2)", [
      id(20),
      JSON.stringify([line]),
    ]);
    let result = await db.query("SELECT status,total_amount FROM payroll_runs WHERE id=$1", [
      id(20),
    ]);
    assert.equal(result.rows[0].status, "review");
    assert.equal(Number(result.rows[0].total_amount), 0);
    result = await db.query(
      "SELECT advance_deduction FROM payroll_run_lines WHERE payroll_run_id=$1",
      [id(20)],
    );
    assert.equal(Number(result.rows[0].advance_deduction), 100);
    result = await db.query(
      "SELECT deducted_amount FROM employee_advance_installments WHERE id=$1",
      [id(31)],
    );
    assert.equal(Number(result.rows[0].deducted_amount), 0, "review does not consume installments");
    await assert.rejects(
      db.query("SELECT pay_payroll_with_advances($1,'cash',NULL)", [id(20)]),
      /Approved/,
    );
    await assert.rejects(
      db.query("SELECT recalculate_payroll_from_specialties($1,$2)", [
        id(20),
        JSON.stringify([{ ...line, base_amount: -1 }]),
      ]),
      /Invalid payroll/,
    );
    await db.exec("SET test.role='ceo'");
    await db.query("SELECT recalculate_payroll_from_specialties($1,$2)",[id(20),JSON.stringify([line])]);
    await db.exec("SET test.role='admin'");
    await db.query("UPDATE payroll_runs SET status='approved' WHERE id=$1", [id(20)]);
    await db.exec("SET test.role='accountant'");
    await db.query("SELECT pay_payroll_with_advances($1,'cash',NULL)", [id(20)]);
    result = await db.query(
      "SELECT status,deducted_amount FROM employee_advance_installments WHERE id=$1",
      [id(31)],
    );
    assert.equal(result.rows[0].status, "scheduled");
    assert.equal(
      Number(result.rows[0].deducted_amount),
      100,
      "partial advance must remain outstanding",
    );
    await assert.rejects(
      db.query("SELECT pay_payroll_with_advances($1,'cash',NULL)", [id(20)]),
      /Approved/,
    );
    await assert.rejects(
      db.query("SELECT recalculate_payroll_from_specialties($1,$2)", [
        id(20),
        JSON.stringify([line]),
      ]),
      /Paid/,
    );
    result = await db.query(
      "SELECT previous_run,previous_lines,completed FROM payroll_recalculation_audit ORDER BY created_at,id",
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].completed, true);
    assert.equal(result.rows[0].previous_run.status, "approved");
    assert.equal(Number(result.rows[0].previous_lines[0].net_amount), 0);
    await db.exec("SET test.role='accountant'");
    await db.query("INSERT INTO payroll_runs(id,month) VALUES($1,'2026-11-01')",[id(21)]);
    await db.query("INSERT INTO employee_advances(id,employee_id,amount,installment_amount,installments_count,first_deduction_month) VALUES($1,$2,100,100,1,'2026-11-01')",[id(32),id(2)]);
    await db.query("INSERT INTO employee_advance_installments(id,advance_id,month,amount) VALUES($1,$2,'2026-11-01',100)",[id(33),id(32)]);
    await db.query("SELECT recalculate_payroll_from_specialties($1,$2)",[id(21),JSON.stringify([{...line,employee_id:id(2),base_amount:500}])]);
    await db.exec("SET test.role='admin'");
    await db.query("UPDATE payroll_runs SET status='approved' WHERE id=$1",[id(21)]);
    await db.exec("SET test.role='accountant'");
    await db.query("SELECT pay_payroll_with_advances($1,'cash',NULL)",[id(21)]);
    const full=await db.query("SELECT a.status,i.deducted_amount FROM employee_advances a JOIN employee_advance_installments i ON i.advance_id=a.id WHERE a.id=$1",[id(32)]);
    assert.equal(full.rows[0].status,"settled");assert.equal(Number(full.rows[0].deducted_amount),100);
    await db.exec("SET test.role='viewer'");
    await assert.rejects(
      db.query("SELECT recalculate_payroll_from_specialties($1,$2)", [
        id(20),
        JSON.stringify([line]),
      ]),
      /Not authorized/,
    );
  } finally {
    await db.close();
  }
});

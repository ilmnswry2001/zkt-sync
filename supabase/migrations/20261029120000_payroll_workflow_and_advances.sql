-- Payroll runs retain the amounts calculated from the existing attendance and wage records.
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'paid')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_method text CHECK (payment_method IN ('cash', 'bank')),
  payment_reference text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month)
);

CREATE TABLE IF NOT EXISTS public.payroll_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  base_amount numeric(12,2) NOT NULL DEFAULT 0,
  overtime_hours numeric(8,2) NOT NULL DEFAULT 0,
  overtime_amount numeric(12,2) NOT NULL DEFAULT 0,
  additions_amount numeric(12,2) NOT NULL DEFAULT 0,
  deductions_amount numeric(12,2) NOT NULL DEFAULT 0,
  advance_deduction numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  calculation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  installment_amount numeric(12,2) NOT NULL CHECK (installment_amount > 0),
  installments_count integer NOT NULL CHECK (installments_count > 0),
  first_deduction_month date NOT NULL CHECK (EXTRACT(DAY FROM first_deduction_month) = 1),
  purpose text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_advance_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id uuid NOT NULL REFERENCES public.employee_advances(id) ON DELETE RESTRICT,
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE RESTRICT,
  month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'deducted', 'waived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (advance_id, month)
);

CREATE INDEX IF NOT EXISTS payroll_run_lines_employee_idx ON public.payroll_run_lines(employee_id, payroll_run_id);
CREATE INDEX IF NOT EXISTS employee_advances_employee_status_idx ON public.employee_advances(employee_id, status);
CREATE INDEX IF NOT EXISTS employee_advance_installments_month_status_idx ON public.employee_advance_installments(month, status);

ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_run_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_advance_installments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs, public.payroll_run_lines, public.employee_advances, public.employee_advance_installments TO authenticated;
GRANT ALL ON public.payroll_runs, public.payroll_run_lines, public.employee_advances, public.employee_advance_installments TO service_role;

CREATE POLICY "payroll roles read runs" ON public.payroll_runs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles manage runs" ON public.payroll_runs FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles read run lines" ON public.payroll_run_lines FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles manage run lines" ON public.payroll_run_lines FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles read advances" ON public.employee_advances FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles manage advances" ON public.employee_advances FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles read advance installments" ON public.employee_advance_installments FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "payroll roles manage advance installments" ON public.employee_advance_installments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'))
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant') OR public.has_form_role(auth.uid(), 'ceo'));
CREATE POLICY "company manager manage wage rates" ON public.wage_rates FOR ALL TO authenticated
  USING (public.has_form_role(auth.uid(), 'ceo') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_form_role(auth.uid(), 'ceo') OR public.has_role(auth.uid(), 'accountant'));
CREATE POLICY "company manager manage salary additions" ON public.salary_additions FOR ALL TO authenticated
  USING (public.has_form_role(auth.uid(), 'ceo') OR public.has_role(auth.uid(), 'accountant'))
  WITH CHECK (public.has_form_role(auth.uid(), 'ceo') OR public.has_role(auth.uid(), 'accountant'));

CREATE TRIGGER trg_payroll_runs_updated_at BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_employee_advances_updated_at BEFORE UPDATE ON public.employee_advances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
      RAISE EXCEPTION 'Only HR or accounting can remove a draft payroll run';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
      RAISE EXCEPTION 'Only HR can create a draft payroll run';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'paid' OR (OLD.status = 'approved' AND NEW.status <> 'paid') THEN
    RAISE EXCEPTION 'Approved or paid payroll runs are immutable';
  END IF;
  IF NEW.status = 'review' AND NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR can submit payroll for review';
  END IF;
  IF NEW.status = 'approved' AND NOT (public.is_admin(auth.uid()) OR public.has_form_role(auth.uid(), 'ceo')) THEN
    RAISE EXCEPTION 'Only the company manager can approve payroll';
  END IF;
  IF NEW.status = 'paid' AND NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR can record payroll payment';
  END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'review' THEN
    RAISE EXCEPTION 'Payroll must be reviewed before approval';
  END IF;
  IF NEW.status = 'paid' AND (OLD.status <> 'approved' OR NEW.payment_method IS NULL) THEN
    RAISE EXCEPTION 'Payroll must be approved and have a payment method before payment';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_payroll_run_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enforce_payroll_run_transition
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_run_transition();

CREATE OR REPLACE FUNCTION public.enforce_payroll_run_line_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.payroll_run_id ELSE NEW.payroll_run_id END;
  v_status text;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Only HR or accounting can edit payroll run lines';
  END IF;
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;
  IF v_status IS NULL OR v_status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Payroll lines cannot be edited after approval';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_payroll_run_line_edit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enforce_payroll_run_line_edit
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_run_line_edit();

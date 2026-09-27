-- Employee penalties and absences with a dated monthly report.
CREATE TABLE IF NOT EXISTS public.employee_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  employee_name text NOT NULL,
  penalty_type text NOT NULL CHECK (penalty_type IN ('absence', 'deduction', 'warning')),
  penalty_date date NOT NULL DEFAULT CURRENT_DATE,
  deduction_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_penalties_date_idx
  ON public.employee_penalties(penalty_date DESC, penalty_type);
CREATE INDEX IF NOT EXISTS employee_penalties_employee_idx
  ON public.employee_penalties(employee_id, penalty_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_penalties TO authenticated;
GRANT ALL ON public.employee_penalties TO service_role;
ALTER TABLE public.employee_penalties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read penalties" ON public.employee_penalties
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage penalties" ON public.employee_penalties
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS site_admin_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sites_site_admin_employee_idx
  ON public.sites(site_admin_employee_id);

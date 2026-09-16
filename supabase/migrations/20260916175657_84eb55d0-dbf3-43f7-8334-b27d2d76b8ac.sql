-- 1. أنواع
DO $$ BEGIN CREATE TYPE public.day_status AS ENUM ('present','absent','leave','holiday','rest'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. مواقع العمل (التخطيط)
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ctr_code text NOT NULL,
  client text,
  location text,
  description text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_ctr_code_key ON public.sites (ctr_code);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read sites" ON public.sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr admin manage sites" ON public.sites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'data_entry'));
CREATE TRIGGER trg_sites_upd BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. أجور التخصصات
CREATE TABLE IF NOT EXISTS public.wage_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  daily_rate numeric(12,2) NOT NULL DEFAULT 0,
  monthly_rate numeric(12,2) NOT NULL DEFAULT 0,
  overtime_hour_rate numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IQD',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wage_rates_title_key ON public.wage_rates (title);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wage_rates TO authenticated;
GRANT ALL ON public.wage_rates TO service_role;
ALTER TABLE public.wage_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read wages" ON public.wage_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr admin manage wages" ON public.wage_rates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'));
CREATE TRIGGER trg_wage_rates_upd BEFORE UPDATE ON public.wage_rates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. الإضافات على الراتب
CREATE TABLE IF NOT EXISTS public.salary_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  month date NOT NULL,
  kind text NOT NULL DEFAULT 'bonus',
  description text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_salary_additions_emp ON public.salary_additions (employee_id, month);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_additions TO authenticated;
GRANT ALL ON public.salary_additions TO service_role;
ALTER TABLE public.salary_additions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read additions" ON public.salary_additions FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr admin manage additions" ON public.salary_additions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr'));
CREATE TRIGGER trg_salary_additions_upd BEFORE UPDATE ON public.salary_additions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. حالة الحضور اليدوية لكل يوم
CREATE TABLE IF NOT EXISTS public.attendance_day_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status public.day_status NOT NULL,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_day_status_key ON public.attendance_day_status (employee_id, work_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_day_status TO authenticated;
GRANT ALL ON public.attendance_day_status TO service_role;
ALTER TABLE public.attendance_day_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read day status" ON public.attendance_day_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff manage day status" ON public.attendance_day_status FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'hr') OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'data_entry'));
CREATE TRIGGER trg_day_status_upd BEFORE UPDATE ON public.attendance_day_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. توسيع بيانات الموظف
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wage_rate_id uuid REFERENCES public.wage_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_salary numeric(12,2),
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS blood_type text,
  ADD COLUMN IF NOT EXISTS education text,
  ADD COLUMN IF NOT EXISTS contract_type text,
  ADD COLUMN IF NOT EXISTS contract_end_date date,
  ADD COLUMN IF NOT EXISTS passport_no text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS residency_no text,
  ADD COLUMN IF NOT EXISTS residency_expiry date,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS iban text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS ctr_code text;
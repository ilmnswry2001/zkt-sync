ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.employees
  ADD CONSTRAINT employees_pay_type_check CHECK (pay_type IN ('daily','monthly'));
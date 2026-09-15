ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS erp_no TEXT,
  ADD COLUMN IF NOT EXISTS id_no TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS last_working_day DATE,
  ADD COLUMN IF NOT EXISTS phone1 TEXT,
  ADD COLUMN IF NOT EXISTS phone2 TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS salary_type TEXT,
  ADD COLUMN IF NOT EXISTS salary_structure TEXT,
  ADD COLUMN IF NOT EXISTS project TEXT,
  ADD COLUMN IF NOT EXISTS safety_passport_no TEXT,
  ADD COLUMN IF NOT EXISTS safety_passport_expiry DATE,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_id_no ON public.employees(id_no);
CREATE INDEX IF NOT EXISTS idx_employees_name ON public.employees(full_name);
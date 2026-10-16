ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_import_data jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.employees.employee_import_data IS
  'Original source columns and values retained from employee workbook imports.';

BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SET LOCAL search_path = pg_catalog, public, extensions;

CREATE INDEX IF NOT EXISTS idx_employees_fullname_trgm ON public.employees USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_empno_trgm ON public.employees USING gin (employee_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_position_trgm ON public.employees USING gin (position gin_trgm_ops);
COMMIT;

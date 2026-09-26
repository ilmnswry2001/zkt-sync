-- Team follow-up ownership: a department can be assigned to one authenticated department head.
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS departments_manager_user_idx
  ON public.departments(manager_user_id);

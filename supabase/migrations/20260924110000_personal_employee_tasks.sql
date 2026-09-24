-- Personal task tracking: the authenticated account is the owner.
ALTER TABLE public.employee_tasks
  ALTER COLUMN employee_id DROP NOT NULL;

-- Existing employee_id values remain for historical compatibility, but new tasks
-- are owned and filtered by created_by = auth.uid().
COMMENT ON COLUMN public.employee_tasks.created_by IS 'Authenticated account that owns the personal task log';
COMMENT ON COLUMN public.employee_tasks.employee_id IS 'Optional legacy employee link; personal tasks use created_by';

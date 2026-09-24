-- Employee daily task log
CREATE TABLE IF NOT EXISTS public.employee_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  task_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 200),
  description text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'in_progress')),
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0 AND duration_minutes <= 1440),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_tasks_date_idx
  ON public.employee_tasks(task_date, archived_at, employee_id);
CREATE INDEX IF NOT EXISTS employee_tasks_employee_idx
  ON public.employee_tasks(employee_id, task_date DESC);
CREATE INDEX IF NOT EXISTS employee_tasks_created_by_idx
  ON public.employee_tasks(created_by, task_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_tasks TO authenticated;
GRANT ALL ON public.employee_tasks TO service_role;
ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees read own tasks" ON public.employee_tasks;
CREATE POLICY "employees read own tasks"
  ON public.employee_tasks FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
  );

DROP POLICY IF EXISTS "employees create own tasks" ON public.employee_tasks;
CREATE POLICY "employees create own tasks"
  ON public.employee_tasks FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR public.has_role(auth.uid(), 'supervisor')
      OR public.has_role(auth.uid(), 'data_entry')
      OR created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "employees update own tasks" ON public.employee_tasks;
CREATE POLICY "employees update own tasks"
  ON public.employee_tasks FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
  );

DROP POLICY IF EXISTS "employees delete own tasks" ON public.employee_tasks;
CREATE POLICY "employees delete own tasks"
  ON public.employee_tasks FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
  );

DROP TRIGGER IF EXISTS trg_employee_tasks_updated_at ON public.employee_tasks;
CREATE TRIGGER trg_employee_tasks_updated_at
  BEFORE UPDATE ON public.employee_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Department-scoped access and team roles for Lovable Cloud.
-- This migration is idempotent and must be applied to the live database.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'site_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'department_manager';

CREATE TABLE IF NOT EXISTS public.user_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, department_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_departments TO authenticated;
GRANT ALL ON public.user_departments TO service_role;
ALTER TABLE public.user_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all user departments" ON public.user_departments;
CREATE POLICY "Admins can manage all user departments"
  ON public.user_departments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view their own assigned departments" ON public.user_departments;
CREATE POLICY "Users can view their own assigned departments"
  ON public.user_departments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.can_access_department(_user_id uuid, _department_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_departments ud
      WHERE ud.user_id = _user_id AND ud.department_id = _department_id
    )
    OR (
      public.has_role(_user_id, 'hr')
      AND NOT EXISTS (SELECT 1 FROM public.user_departments ud WHERE ud.user_id = _user_id)
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_department(uuid, uuid) TO authenticated;

ALTER TABLE public.employee_tasks
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_note text;
CREATE INDEX IF NOT EXISTS employee_tasks_department_date_idx
  ON public.employee_tasks(department_id, task_date DESC, archived_at);

-- Managers see only tasks assigned to their allowed departments; owners keep their own access.
DROP POLICY IF EXISTS "employees read own tasks" ON public.employee_tasks;
CREATE POLICY "employees read own tasks"
  ON public.employee_tasks FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      department_id IS NOT NULL
      AND public.can_access_department(auth.uid(), department_id)
      AND (
        public.has_role(auth.uid(), 'supervisor')
        OR public.has_role(auth.uid(), 'department_manager')
      )
    )
  );

DROP POLICY IF EXISTS "employees update own tasks" ON public.employee_tasks;
CREATE POLICY "employees update own tasks"
  ON public.employee_tasks FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      department_id IS NOT NULL
      AND public.can_access_department(auth.uid(), department_id)
      AND (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'department_manager'))
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      department_id IS NOT NULL
      AND public.can_access_department(auth.uid(), department_id)
      AND (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'department_manager'))
    )
  );

DROP POLICY IF EXISTS "employees delete own tasks" ON public.employee_tasks;
CREATE POLICY "employees delete own tasks"
  ON public.employee_tasks FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
  );

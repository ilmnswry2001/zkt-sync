-- Individual guidance sent by department managers to employees in their scope.
CREATE TABLE IF NOT EXISTS public.employee_guidance_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 5000),
  guidance_date date NOT NULL DEFAULT CURRENT_DATE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS employee_guidance_notes_recipient_created_idx
  ON public.employee_guidance_notes (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS employee_guidance_notes_department_date_idx
  ON public.employee_guidance_notes (department_id, guidance_date DESC);

GRANT SELECT, INSERT ON public.employee_guidance_notes TO authenticated;
GRANT UPDATE (read_at) ON public.employee_guidance_notes TO authenticated;
GRANT ALL ON public.employee_guidance_notes TO service_role;
ALTER TABLE public.employee_guidance_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees and managers read guidance" ON public.employee_guidance_notes;
CREATE POLICY "Employees and managers read guidance"
  ON public.employee_guidance_notes FOR SELECT TO authenticated
  USING (
    target_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      public.has_role(auth.uid(), 'department_manager')
      AND public.can_access_department(auth.uid(), department_id)
    )
  );

DROP POLICY IF EXISTS "Department managers send scoped guidance" ON public.employee_guidance_notes;
CREATE POLICY "Department managers send scoped guidance"
  ON public.employee_guidance_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.has_role(auth.uid(), 'department_manager')
    AND public.can_access_department(auth.uid(), department_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees AS employee
      JOIN public.profiles AS profile
        ON lower(trim(profile.email)) = lower(trim(employee.email))
      WHERE employee.id = target_employee_id
        AND employee.department_id = employee_guidance_notes.department_id
        AND employee.status = 'active'
        AND profile.id = target_user_id
    )
  );

DROP POLICY IF EXISTS "Employees mark their guidance read" ON public.employee_guidance_notes;
CREATE POLICY "Employees mark their guidance read"
  ON public.employee_guidance_notes FOR UPDATE TO authenticated
  USING (target_user_id = auth.uid())
  WITH CHECK (target_user_id = auth.uid());

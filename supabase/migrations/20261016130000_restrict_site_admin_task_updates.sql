-- Site administrators may complete tasks assigned to their employee profile,
-- but do not receive broad UPDATE access to employee_tasks.
DROP POLICY IF EXISTS "employees update own tasks" ON public.employee_tasks;
CREATE POLICY "employees update own tasks" ON public.employee_tasks FOR UPDATE TO authenticated USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'supervisor')
  OR (department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
  OR employee_id IN (
    SELECT e.id FROM public.employees e
    JOIN public.profiles p ON lower(p.email) = lower(e.email)
    WHERE p.id = auth.uid()
  )
) WITH CHECK (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'supervisor')
  OR (department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
  OR employee_id IN (
    SELECT e.id FROM public.employees e
    JOIN public.profiles p ON lower(p.email) = lower(e.email)
    WHERE p.id = auth.uid()
  )
);

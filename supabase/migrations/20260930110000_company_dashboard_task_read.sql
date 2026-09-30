-- Allow the existing company-manager (form-role ceo) assignment to read
-- dashboard-wide team task totals without granting task write access.
DROP POLICY IF EXISTS "employees read own tasks" ON public.employee_tasks;
CREATE POLICY "employees read own tasks"
  ON public.employee_tasks FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
    OR (
      department_id IS NOT NULL
      AND public.can_access_department(auth.uid(), department_id)
      AND (
        public.has_role(auth.uid(), 'supervisor')
        OR public.has_role(auth.uid(), 'department_manager')
      )
    )
  );

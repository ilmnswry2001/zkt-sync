CREATE POLICY "managers delete department tasks" ON public.employee_tasks FOR DELETE TO authenticated USING (
  public.has_role(auth.uid(),'admin'::public.app_role) OR public.has_role(auth.uid(),'hr'::public.app_role)
  OR (public.has_role(auth.uid(),'department_manager'::public.app_role) AND department_id IS NOT NULL AND public.can_access_department(auth.uid(), department_id))
);
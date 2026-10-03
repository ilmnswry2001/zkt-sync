-- Only system admins may delete other users' tasks; task owners retain their own delete access.
DROP POLICY IF EXISTS "employees delete own tasks" ON public.employee_tasks;
CREATE POLICY "employees delete own tasks"
  ON public.employee_tasks FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- System admins can remove any guidance note from the management inbox.
GRANT DELETE ON public.employee_guidance_notes TO authenticated;
DROP POLICY IF EXISTS "System admins delete guidance" ON public.employee_guidance_notes;
CREATE POLICY "System admins delete guidance"
  ON public.employee_guidance_notes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Make data-entry accounts eligible to execute submitted forms directly.
-- Restrict their row policy to the execution queue and terminal execution outcomes.
DROP POLICY IF EXISTS "process forms" ON public.forms;
CREATE POLICY "process forms" ON public.forms FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr')
    OR has_form_role(auth.uid(), 'dept_manager') OR has_form_role(auth.uid(), 'ceo')
    OR has_form_role(auth.uid(), 'executor')
    OR (has_role(auth.uid(), 'data_entry') AND status = 'pending_execution')
    OR (created_by = auth.uid() AND status = 'pending_manager')
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'hr')
    OR has_form_role(auth.uid(), 'dept_manager') OR has_form_role(auth.uid(), 'ceo')
    OR has_form_role(auth.uid(), 'executor')
    OR (has_role(auth.uid(), 'data_entry') AND status IN ('executed', 'rejected'))
    OR (created_by = auth.uid() AND status = 'pending_manager')
  );
DROP POLICY IF EXISTS "delete own pending forms" ON public.forms;
CREATE POLICY "delete own pending forms" ON public.forms FOR DELETE TO authenticated
  USING (
    is_admin(auth.uid())
    OR (created_by = auth.uid() AND status IN ('pending_manager', 'pending_execution'))
  );

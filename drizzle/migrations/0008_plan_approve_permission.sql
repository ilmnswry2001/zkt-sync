ALTER TABLE public.plan_staffing_permissions ADD COLUMN IF NOT EXISTS can_approve boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.can_approve_plans_by_grant(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.plan_staffing_permissions p WHERE p.user_id = _user_id AND p.can_approve);
$$;

DROP POLICY IF EXISTS "Site work plans update access" ON public.site_work_plans;
CREATE POLICY "Site work plans update access" ON public.site_work_plans FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR has_role(auth.uid(),'hr') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'department_manager') OR requested_by = auth.uid()
  OR (public.can_approve_plans_by_grant(auth.uid()) AND status IN ('requested','planning_approved'))
  OR (can_staff_site_work_plans(auth.uid()) AND status IN ('planning_approved','management_review')))
WITH CHECK (is_admin(auth.uid()) OR has_role(auth.uid(),'hr') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'department_manager') OR requested_by = auth.uid()
  OR (public.can_approve_plans_by_grant(auth.uid()) AND status IN ('requested','planning_approved'))
  OR (can_staff_site_work_plans(auth.uid()) AND status IN ('planning_approved','management_review')));
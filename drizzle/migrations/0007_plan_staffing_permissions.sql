CREATE TABLE IF NOT EXISTS public.plan_staffing_permissions (
  user_id uuid PRIMARY KEY,
  can_request boolean NOT NULL DEFAULT false,
  can_staff_all boolean NOT NULL DEFAULT false,
  specialties text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_staffing_permissions TO authenticated;
GRANT ALL ON public.plan_staffing_permissions TO service_role;
ALTER TABLE public.plan_staffing_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan perms read own or admin" ON public.plan_staffing_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'hr'));
CREATE POLICY "plan perms admin write" ON public.plan_staffing_permissions FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.can_staff_site_work_plans(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.plan_staffing_permissions p
    WHERE p.user_id = _user_id AND (p.can_staff_all OR cardinality(p.specialties) > 0));
$$;

DROP POLICY IF EXISTS "Site work plans update access" ON public.site_work_plans;
CREATE POLICY "Site work plans update access" ON public.site_work_plans FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR has_role(auth.uid(),'hr') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'department_manager') OR requested_by = auth.uid()
    OR (public.can_staff_site_work_plans(auth.uid()) AND status IN ('planning_approved','management_review')))
  WITH CHECK (is_admin(auth.uid()) OR has_role(auth.uid(),'hr') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'department_manager') OR requested_by = auth.uid()
    OR (public.can_staff_site_work_plans(auth.uid()) AND status IN ('planning_approved','management_review')));
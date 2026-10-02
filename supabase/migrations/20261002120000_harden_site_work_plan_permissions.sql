-- Keep approval inside Planning and enforce the work-plan lifecycle in the database.
CREATE OR REPLACE FUNCTION public.can_approve_site_work_plans(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(_user_id)
    OR public.has_role(_user_id, 'hr')
    OR public.has_role(_user_id, 'supervisor')
    OR public.has_role(_user_id, 'department_manager');
$$;

CREATE OR REPLACE FUNCTION public.can_operate_site_work_plans(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_approve_site_work_plans(_user_id)
    OR public.has_role(_user_id, 'engineer')
    OR public.has_role(_user_id, 'site_admin');
$$;

DROP POLICY IF EXISTS "Site work plans read access" ON public.site_work_plans;
CREATE POLICY "Site work plans read access"
  ON public.site_work_plans FOR SELECT TO authenticated
  USING (public.can_operate_site_work_plans(auth.uid()) OR requested_by = auth.uid());

DROP POLICY IF EXISTS "Site work plans write access" ON public.site_work_plans;
CREATE POLICY "Site work plans write access"
  ON public.site_work_plans FOR INSERT TO authenticated
  WITH CHECK (
    public.can_operate_site_work_plans(auth.uid())
    AND requested_by = auth.uid()
    AND status = 'requested'
  );

DROP POLICY IF EXISTS "Site work plans update access" ON public.site_work_plans;
CREATE POLICY "Site work plans update access"
  ON public.site_work_plans FOR UPDATE TO authenticated
  USING (public.can_operate_site_work_plans(auth.uid()) OR requested_by = auth.uid())
  WITH CHECK (public.can_operate_site_work_plans(auth.uid()) OR requested_by = auth.uid());

DROP POLICY IF EXISTS "Site work plans delete access" ON public.site_work_plans;
CREATE POLICY "Site work plans delete access"
  ON public.site_work_plans FOR DELETE TO authenticated
  USING (public.can_approve_site_work_plans(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_site_work_plan_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_approver boolean := public.can_approve_site_work_plans(auth.uid());
  is_operator boolean := public.can_operate_site_work_plans(auth.uid());
  is_owner boolean := OLD.requested_by = auth.uid();
BEGIN
  IF is_approver THEN
    IF OLD.status = 'requested' AND NEW.status = 'planning_approved' THEN
      IF (to_jsonb(NEW) - ARRAY['status','planning_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','planning_notes','updated_at']) THEN
        RAISE EXCEPTION 'Planning approval may only update approval status and planning notes';
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'management_review' AND NEW.status = 'finalized' THEN
      IF (to_jsonb(NEW) - ARRAY['status','final_plan','engineer_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','final_plan','engineer_notes','updated_at']) THEN
        RAISE EXCEPTION 'Final approval may only update final plan and status';
      END IF;
      RETURN NEW;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Invalid site work plan status transition';
    ELSIF OLD.status = 'requested' THEN
      IF (to_jsonb(NEW) - ARRAY['planning_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['planning_notes','updated_at']) THEN
        RAISE EXCEPTION 'Planning review may only update planning notes before approval';
      END IF;
    ELSIF OLD.status IN ('planning_approved','management_review') THEN
      IF (to_jsonb(NEW) - ARRAY['assigned_staff','management_notes','planning_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['assigned_staff','management_notes','planning_notes','updated_at']) THEN
        RAISE EXCEPTION 'Review updates may only change staffing or review notes';
      END IF;
    ELSE
      RAISE EXCEPTION 'Finalized plans cannot be edited';
    END IF;
    RETURN NEW;
  END IF;

  IF is_operator THEN
    IF is_owner AND OLD.status = 'requested' AND NEW.status = 'requested' THEN
      IF (to_jsonb(NEW) - ARRAY['site_id','site_name','request_date','applicant_name','request_notes','specialties','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['site_id','site_name','request_date','applicant_name','request_notes','specialties','updated_at']) THEN
        RAISE EXCEPTION 'Request owners may only edit request details before approval';
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'planning_approved' AND NEW.status = 'planning_approved' THEN
      IF (to_jsonb(NEW) - ARRAY['assigned_staff','management_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['assigned_staff','management_notes','updated_at']) THEN
        RAISE EXCEPTION 'Staffing updates may only change assignments and management notes';
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'planning_approved' AND NEW.status = 'management_review' THEN
      IF (to_jsonb(NEW) - ARRAY['status','assigned_staff','management_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','assigned_staff','management_notes','updated_at']) THEN
        RAISE EXCEPTION 'Staffing may only update assignments, management notes and status';
      END IF;
      RETURN NEW;
    ELSIF OLD.status = 'management_review' AND NEW.status = 'management_review' THEN
      IF (to_jsonb(NEW) - ARRAY['assigned_staff','management_notes','updated_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['assigned_staff','management_notes','updated_at']) THEN
        RAISE EXCEPTION 'Staffing updates may only change assignments and management notes';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Site work plan is not available for staffing updates';
  END IF;

  RAISE EXCEPTION 'Not authorized to update this site work plan';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_site_work_plan_workflow ON public.site_work_plans;
CREATE TRIGGER trg_guard_site_work_plan_workflow
BEFORE UPDATE ON public.site_work_plans
FOR EACH ROW EXECUTE FUNCTION public.guard_site_work_plan_workflow();

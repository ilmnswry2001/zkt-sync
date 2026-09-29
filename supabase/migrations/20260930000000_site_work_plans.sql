-- Work-plan tracking for construction/project planning workflow.
-- This table is required by the planning UI and must be applied in Lovable Cloud.

CREATE TABLE IF NOT EXISTS public.site_work_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  site_name text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_name text,
  request_date date NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'planning_approved', 'management_review', 'finalized')),
  request_notes text,
  planning_notes text,
  management_notes text,
  specialties jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_staff jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_work_plans_site_date_idx
  ON public.site_work_plans(site_id, request_date DESC);

CREATE INDEX IF NOT EXISTS site_work_plans_status_idx
  ON public.site_work_plans(status, request_date DESC);

ALTER TABLE public.site_work_plans ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_work_plans TO authenticated;
GRANT ALL ON public.site_work_plans TO service_role;

DROP POLICY IF EXISTS "Site work plans read access" ON public.site_work_plans;
CREATE POLICY "Site work plans read access"
  ON public.site_work_plans FOR SELECT TO authenticated
  USING (
    true
  );

DROP POLICY IF EXISTS "Site work plans write access" ON public.site_work_plans;
CREATE POLICY "Site work plans write access"
  ON public.site_work_plans FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'department_manager')
    OR requested_by = auth.uid()
  );

DROP POLICY IF EXISTS "Site work plans update access" ON public.site_work_plans;
CREATE POLICY "Site work plans update access"
  ON public.site_work_plans FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'department_manager')
    OR requested_by = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'department_manager')
    OR requested_by = auth.uid()
  );

DROP POLICY IF EXISTS "Site work plans delete access" ON public.site_work_plans;
CREATE POLICY "Site work plans delete access"
  ON public.site_work_plans FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'department_manager')
  );

CREATE OR REPLACE FUNCTION public.set_site_work_plan_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_site_work_plan_updated_at ON public.site_work_plans;
CREATE TRIGGER trg_site_work_plan_updated_at
BEFORE UPDATE ON public.site_work_plans
FOR EACH ROW
EXECUTE FUNCTION public.set_site_work_plan_updated_at();

BEGIN;

-- RLS policies cannot read auth.users directly as an authenticated client.
-- Resolve the employee through a narrowly scoped SECURITY DEFINER helper.
CREATE OR REPLACE FUNCTION public.can_read_self_attendance_employee(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.employees e
      JOIN auth.users u ON lower(u.email) = lower(e.email)
      WHERE e.id = p_employee_id
        AND u.id = auth.uid()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_self_attendance_employee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_self_attendance_employee(uuid) TO authenticated;

DROP POLICY IF EXISTS "read own self attendance site access"
  ON public.employee_self_attendance_access;
CREATE POLICY "read own self attendance site access"
  ON public.employee_self_attendance_access
  FOR SELECT TO authenticated
  USING (public.can_read_self_attendance_employee(employee_id));

DROP POLICY IF EXISTS "read own self attendance sites"
  ON public.employee_self_attendance_sites;
CREATE POLICY "read own self attendance sites"
  ON public.employee_self_attendance_sites
  FOR SELECT TO authenticated
  USING (public.can_read_self_attendance_employee(employee_id));

COMMIT;

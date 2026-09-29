-- Team-wide guidance notes scoped by department and date.
-- Run after the department access migration has been committed.

CREATE TABLE IF NOT EXISTS public.team_guidance_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  content text NOT NULL,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, note_date)
);

GRANT SELECT, INSERT, UPDATE ON public.team_guidance_notes TO authenticated;
GRANT ALL ON public.team_guidance_notes TO service_role;
ALTER TABLE public.team_guidance_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read department guidance" ON public.team_guidance_notes;
CREATE POLICY "Managers read department guidance"
  ON public.team_guidance_notes FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      public.has_role(auth.uid(), 'department_manager')
      AND public.can_access_department(auth.uid(), department_id)
    )
  );

DROP POLICY IF EXISTS "Managers create department guidance" ON public.team_guidance_notes;
CREATE POLICY "Managers create department guidance"
  ON public.team_guidance_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
      OR (
        public.has_role(auth.uid(), 'department_manager')
        AND public.can_access_department(auth.uid(), department_id)
      )
    )
  );

DROP POLICY IF EXISTS "Managers update department guidance" ON public.team_guidance_notes;
CREATE POLICY "Managers update department guidance"
  ON public.team_guidance_notes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      public.has_role(auth.uid(), 'department_manager')
      AND public.can_access_department(auth.uid(), department_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      public.has_role(auth.uid(), 'department_manager')
      AND public.can_access_department(auth.uid(), department_id)
    )
  );

CREATE TABLE IF NOT EXISTS public.user_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, department_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_departments TO authenticated;
GRANT ALL ON public.user_departments TO service_role;

ALTER TABLE public.user_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all user departments" ON public.user_departments;
CREATE POLICY "Admins can manage all user departments"
ON public.user_departments FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users can view their own assigned departments" ON public.user_departments;
CREATE POLICY "Users can view their own assigned departments"
ON public.user_departments FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.can_access_department(_user_id UUID, _department_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.user_departments ud WHERE ud.user_id = _user_id AND ud.department_id = _department_id)
    OR (NOT EXISTS (SELECT 1 FROM public.user_departments ud WHERE ud.user_id = _user_id) AND public.has_role(_user_id, 'hr'));
$$;

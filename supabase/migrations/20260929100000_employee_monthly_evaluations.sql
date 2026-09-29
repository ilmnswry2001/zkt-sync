-- Monthly employee evaluations with an auditable bonus transaction.
-- Run after the existing app_role and salary_additions tables are available.

CREATE TABLE IF NOT EXISTS public.employee_monthly_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  evaluation_month date NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, evaluation_month)
);

GRANT SELECT, INSERT ON public.employee_monthly_evaluations TO authenticated;
GRANT ALL ON public.employee_monthly_evaluations TO service_role;
ALTER TABLE public.employee_monthly_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers read scoped evaluations" ON public.employee_monthly_evaluations;
CREATE POLICY "Managers read scoped evaluations"
  ON public.employee_monthly_evaluations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'hr')
    OR (
      public.has_role(auth.uid(), 'department_manager')
      AND EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = employee_monthly_evaluations.employee_id
          AND public.can_access_department(auth.uid(), e.department_id)
      )
    )
  );

CREATE OR REPLACE FUNCTION public.submit_employee_monthly_evaluation(
  _employee_id uuid,
  _evaluation_month date,
  _score integer
)
RETURNS TABLE (evaluation_id uuid, bonus_added numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _department_id uuid;
  _evaluation_id uuid;
  _bonus numeric := 0;
  _month date := date_trunc('month', _evaluation_month)::date;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول أولاً'; END IF;
  IF _score < 0 OR _score > 100 THEN RAISE EXCEPTION 'الدرجة يجب أن تكون بين 0 و100'; END IF;
  SELECT department_id INTO _department_id FROM public.employees WHERE id = _employee_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'الموظف غير موجود أو غير نشط'; END IF;
  IF NOT (
    public.has_role(_user, 'admin') OR public.has_role(_user, 'hr') OR
    (public.has_role(_user, 'department_manager') AND public.can_access_department(_user, _department_id))
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية تقييم هذا الموظف'; END IF;
  IF EXISTS (SELECT 1 FROM public.employee_monthly_evaluations WHERE employee_id = _employee_id AND evaluation_month = _month) THEN
    RAISE EXCEPTION 'تم تقييم هذا الموظف هذا الشهر بالفعل';
  END IF;
  INSERT INTO public.employee_monthly_evaluations(employee_id, evaluation_month, score, created_by)
    VALUES (_employee_id, _month, _score, _user)
    RETURNING id INTO _evaluation_id;
  IF _score > 90 THEN
    _bonus := 100000;
    INSERT INTO public.salary_additions(employee_id, month, kind, description, amount, created_by)
      VALUES (_employee_id, _month, 'bonus', 'مكافأة تقييم شهري بدرجة ' || _score, _bonus, _user);
  END IF;
  RETURN QUERY SELECT _evaluation_id, _bonus;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_employee_monthly_evaluation(uuid, date, integer) TO authenticated;

CREATE TABLE public.gamification_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('workshop', 'employee')),
  target_id uuid NOT NULL,
  target_name text NOT NULL CHECK (length(trim(target_name)) BETWEEN 1 AND 200),
  badge_type text NOT NULL CHECK (
    badge_type IN ('hse_guardian', 'punctuality_champion', 'field_hero', 'top_workshop')
  ),
  period_month text NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  incentive_iqd numeric(12,2) NOT NULL DEFAULT 0 CHECK (incentive_iqd >= 0),
  salary_addition_id uuid REFERENCES public.salary_additions(id) ON DELETE SET NULL,
  notes text,
  CHECK (
    (target_type = 'employee' AND badge_type <> 'top_workshop')
    OR (target_type = 'workshop' AND badge_type = 'top_workshop')
  )
);

CREATE INDEX gamification_badges_awarded_at_idx
  ON public.gamification_badges(awarded_at DESC);
CREATE INDEX gamification_badges_target_period_idx
  ON public.gamification_badges(target_type, target_id, period_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gamification_badges TO authenticated;
ALTER TABLE public.gamification_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read gamification badges"
  ON public.gamification_badges FOR SELECT TO authenticated USING (true);
CREATE POLICY "hr admin manage gamification badges"
  ON public.gamification_badges FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE OR REPLACE FUNCTION public.award_badge_incentive(p_badge_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_badge public.gamification_badges%ROWTYPE;
  v_addition_id uuid;
BEGIN
  IF auth.uid() IS NULL
    OR NOT (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'hr')
    )
  THEN
    RAISE EXCEPTION 'غير مصرح بصرف حوافز الأوسمة';
  END IF;

  SELECT * INTO v_badge
  FROM public.gamification_badges
  WHERE id = p_badge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'وسام لوحة الشرف غير موجود';
  END IF;

  IF v_badge.target_type <> 'employee' OR v_badge.incentive_iqd <= 0 THEN
    RAISE EXCEPTION 'لا يمكن صرف حافز لهذا الوسام';
  END IF;

  IF v_badge.salary_addition_id IS NOT NULL THEN
    RETURN v_badge.salary_addition_id;
  END IF;

  INSERT INTO public.salary_additions (
    employee_id,
    month,
    kind,
    description,
    amount,
    created_by
  )
  VALUES (
    v_badge.target_id,
    to_date(v_badge.period_month || '-01', 'YYYY-MM-DD'),
    'bonus',
    'مكافأة لوحة الشرف - ' || v_badge.target_name,
    v_badge.incentive_iqd,
    auth.uid()
  )
  RETURNING id INTO v_addition_id;

  UPDATE public.gamification_badges
  SET salary_addition_id = v_addition_id
  WHERE id = v_badge.id;

  RETURN v_addition_id;
END;
$$;

REVOKE ALL ON FUNCTION public.award_badge_incentive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_badge_incentive(uuid) TO authenticated;

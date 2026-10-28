BEGIN;

CREATE OR REPLACE FUNCTION public.approve_self_attendance_early_exit(p_form_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form public.forms%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT (
    public.is_admin(v_actor) OR public.has_form_role(v_actor, 'ceo')
  ) THEN
    RAISE EXCEPTION 'الموافقة النهائية متاحة لمدير الشركة فقط';
  END IF;

  SELECT f.* INTO v_form
  FROM public.forms f
  WHERE f.id = p_form_id
  FOR UPDATE;

  IF v_form.id IS NULL OR v_form.kind <> 'early_exit' OR v_form.status <> 'pending_ceo' THEN
    RAISE EXCEPTION 'طلب الخروج المبكر غير موجود أو لم يصل إلى مرحلة اعتماد مدير الشركة';
  END IF;

  UPDATE public.forms f
  SET status = 'executed',
      ceo_approved_by = v_actor,
      ceo_approved_at = now(),
      executed_by = v_actor,
      executed_at = now()
  WHERE f.id = p_form_id;

  INSERT INTO public.attendance_day_status(employee_id, work_date, status, notes, updated_by)
  VALUES (v_form.employee_id, v_form.work_date, 'present',
    format('حضور معتمد بطلب خروج مبكر رقم %s: %s', v_form.form_no, v_form.reason), v_actor)
  ON CONFLICT (employee_id, work_date) DO UPDATE
    SET status = 'present', notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by;

  INSERT INTO public.form_events(form_id, action, note, actor)
  VALUES (p_form_id, 'approve', 'اعتماد مدير الشركة وتثبيت حضور اليوم', v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_self_attendance_early_exit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_self_attendance_early_exit(uuid) TO authenticated;

COMMIT;

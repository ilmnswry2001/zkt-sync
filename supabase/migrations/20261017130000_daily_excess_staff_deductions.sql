ALTER TABLE public.employee_penalties
  ADD COLUMN source_report_line_id uuid
  REFERENCES public.daily_workshop_report_lines(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX employee_penalties_daily_excess_source_idx
  ON public.employee_penalties(source_report_line_id)
  WHERE source_report_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_daily_excess_staff_deductions(
  _report_line_ids uuid[],
  _accountable_employee_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_accountable_name text;
  v_total numeric(12,2) := 0;
  v_line record;
  v_line_id uuid;
  v_plan jsonb;
  v_required integer;
  v_rank integer;
  v_rate numeric(12,2);
BEGIN
  IF v_user_id IS NULL OR NOT (
    public.has_role(v_user_id, 'admin') OR public.has_role(v_user_id, 'hr')
  ) THEN
    RAISE EXCEPTION 'تسجيل استقطاع تكلفة الكادر الزائد متاح للموارد البشرية والإدارة فقط';
  END IF;
  IF coalesce(array_length(_report_line_ids, 1), 0) = 0 OR array_length(_report_line_ids, 1) > 100 THEN
    RAISE EXCEPTION 'حدد أفراد الزيادة أولاً';
  END IF;
  SELECT full_name INTO v_accountable_name
  FROM public.employees
  WHERE id = _accountable_employee_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'اختر موظفاً مسؤولاً نشطاً'; END IF;

  FOREACH v_line_id IN ARRAY _report_line_ids LOOP
    SELECT line.id, line.employee_id, line.employee_name_snapshot, line.role_label,
           line.site_id, report.report_date, site.name AS site_name, site.ctr_code
    INTO v_line
    FROM public.daily_workshop_report_lines AS line
    JOIN public.daily_workshop_reports AS report ON report.id = line.report_id
    JOIN public.sites AS site ON site.id = line.site_id
    WHERE line.id = v_line_id AND line.attended AND line.site_id IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'أحد سجلات الحضور أو إسناد CTR غير صالح'; END IF;
    IF EXISTS (SELECT 1 FROM public.employee_penalties WHERE source_report_line_id = v_line.id) THEN
      RAISE EXCEPTION 'سبق تسجيل استقطاع لهذا العامل الزائد';
    END IF;

    v_plan := NULL;
    SELECT CASE
      WHEN jsonb_typeof(plan.final_plan->'specialties') = 'array'
        AND jsonb_array_length(plan.final_plan->'specialties') > 0
      THEN plan.final_plan->'specialties'
      ELSE plan.specialties
    END INTO v_plan
    FROM public.site_work_plans AS plan
    WHERE plan.site_id = v_line.site_id AND plan.status = 'finalized'
    ORDER BY plan.request_date DESC, plan.created_at DESC
    LIMIT 1;
    IF v_plan IS NULL THEN RAISE EXCEPTION 'لا توجد خطة نهائية للموقع المحدد'; END IF;

    v_required := 0;
    SELECT coalesce(nullif(item->>'quantity', '')::integer, 0)
    INTO v_required
    FROM jsonb_array_elements(v_plan) AS item
    WHERE lower(trim(coalesce(item->>'specialty', item->>'name', ''))) = lower(trim(coalesce(v_line.role_label, '')))
    LIMIT 1;
    v_required := coalesce(v_required, 0);

    v_rank := NULL;
    SELECT ranked.position INTO v_rank
    FROM (
      SELECT line.id,
        row_number() OVER (ORDER BY line.employee_name_snapshot, line.id)::integer AS position
      FROM public.daily_workshop_report_lines AS line
      JOIN public.daily_workshop_reports AS report ON report.id = line.report_id
      WHERE report.report_date = v_line.report_date
        AND line.site_id = v_line.site_id
        AND line.attended
        AND lower(trim(coalesce(line.role_label, ''))) = lower(trim(coalesce(v_line.role_label, '')))
    ) AS ranked
    WHERE ranked.id = v_line.id;
    IF coalesce(v_rank, 0) <= v_required THEN
      RAISE EXCEPTION 'هذا الموظف ضمن العدد المطلوب في الخطة ولا يصح استقطاع كلفة عليه';
    END IF;

    v_rate := 0;
    SELECT CASE
      WHEN coalesce(wage.daily_rate, 0) > 0 THEN wage.daily_rate
      WHEN coalesce(wage.monthly_rate, 0) > 0 THEN round(wage.monthly_rate / 26, 2)
      ELSE 0
    END INTO v_rate
    FROM public.wage_rates AS wage
    WHERE lower(trim(wage.title)) = lower(trim(coalesce(v_line.role_label, '')))
    LIMIT 1;
    IF coalesce(v_rate, 0) <= 0 THEN
      RAISE EXCEPTION 'لا يوجد أجر يومي مهيأ لهذا التخصص: %', coalesce(v_line.role_label, 'بدون صفة');
    END IF;

    INSERT INTO public.employee_penalties (
      employee_id, employee_name, penalty_type, penalty_date, deduction_amount,
      notes, created_by, source_report_line_id
    ) VALUES (
      _accountable_employee_id,
      v_accountable_name,
      'deduction',
      v_line.report_date,
      v_rate,
      format('كلفة كادر زائد: %s (%s) · %s · %s / CTR %s',
        v_line.employee_name_snapshot, coalesce(v_line.role_label, 'بدون صفة'),
        v_line.site_name, v_line.report_date, v_line.ctr_code),
      v_user_id,
      v_line.id
    );
    v_total := v_total + v_rate;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.record_daily_excess_staff_deductions(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_daily_excess_staff_deductions(uuid[], uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

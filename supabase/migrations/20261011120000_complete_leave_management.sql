-- Complete leave policies, auditable balances, and schedule-aware request validation.
-- Existing forms and leave settings remain in place and are migrated without deleting data.

CREATE TABLE IF NOT EXISTS public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  is_paid boolean NOT NULL DEFAULT true,
  annual_allowance_days numeric(6,2) CHECK (
    annual_allowance_days IS NULL
    OR (annual_allowance_days BETWEEN 0 AND 365 AND annual_allowance_days = trunc(annual_allowance_days))
  ),
  carryover_cap_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (
    carryover_cap_days BETWEEN 0 AND 365 AND carryover_cap_days = trunc(carryover_cap_days)
  ),
  count_non_working_days boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_leave_types_upd ON public.leave_types;
CREATE TRIGGER trg_leave_types_upd BEFORE UPDATE ON public.leave_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.leave_types TO authenticated;
GRANT ALL ON public.leave_types TO service_role;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read leave types" ON public.leave_types;
CREATE POLICY "authenticated read leave types" ON public.leave_types
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin hr manage leave types" ON public.leave_types;
CREATE POLICY "admin hr manage leave types" ON public.leave_types FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

INSERT INTO public.leave_types
  (code, name, is_paid, annual_allowance_days, count_non_working_days, sort_order)
SELECT 'annual', 'إجازة سنوية', true, s.annual_allowance_days, true, 10
FROM public.leave_settings s WHERE s.id = 1
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.leave_types
  (code, name, is_paid, annual_allowance_days, count_non_working_days, sort_order)
VALUES
  ('sick', 'إجازة مرضية', true, NULL, true, 20),
  ('unpaid', 'إجازة بدون راتب', false, NULL, true, 30)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS leave_type_id uuid;
UPDATE public.forms
SET leave_type_id = (SELECT id FROM public.leave_types WHERE code = 'annual')
WHERE kind = 'leave' AND leave_type_id IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.forms'::regclass AND conname = 'forms_leave_type_id_fkey'
  ) THEN
    ALTER TABLE public.forms ADD CONSTRAINT forms_leave_type_id_fkey
      FOREIGN KEY (leave_type_id) REFERENCES public.leave_types(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS forms_leave_type_employee_date_idx
  ON public.forms (leave_type_id, employee_id, work_date) WHERE kind = 'leave';

CREATE TABLE IF NOT EXISTS public.leave_balance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
  effective_year integer NOT NULL CHECK (effective_year BETWEEN 2000 AND 2200),
  amount numeric(6,2) NOT NULL CHECK (
    amount <> 0 AND amount BETWEEN -365 AND 365 AND amount = trunc(amount)
  ),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_balance_transactions_employee_year_idx
  ON public.leave_balance_transactions (employee_id, leave_type_id, effective_year, created_at DESC);
ALTER TABLE public.leave_balance_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leave_balance_transactions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.leave_balance_transactions TO authenticated;
GRANT ALL ON public.leave_balance_transactions TO service_role;
DROP POLICY IF EXISTS "admin hr read leave balance transactions" ON public.leave_balance_transactions;
CREATE POLICY "admin hr read leave balance transactions" ON public.leave_balance_transactions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));
DROP POLICY IF EXISTS "admin hr create leave balance transactions" ON public.leave_balance_transactions;
CREATE POLICY "admin hr create leave balance transactions" ON public.leave_balance_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  );

CREATE OR REPLACE FUNCTION public.leave_work_dates(
  _employee_id uuid,
  _start_date date,
  _end_date date,
  _count_non_working_days boolean DEFAULT true
)
RETURNS TABLE(work_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT days.day::date
  FROM generate_series(_start_date::timestamp, _end_date::timestamp, interval '1 day') AS days(day)
  JOIN public.employees employee ON employee.id = _employee_id
  WHERE _start_date IS NOT NULL AND _end_date IS NOT NULL AND _end_date >= _start_date
    AND (
      _count_non_working_days
      OR EXISTS (
        SELECT 1
        FROM public.employee_weekly_schedules schedule
        WHERE schedule.employee_id = employee.id
          AND schedule.weekday = extract(dow FROM days.day)::integer
          AND schedule.effective_from = (
            SELECT max(version.effective_from)
            FROM public.employee_weekly_schedules version
            WHERE version.employee_id = employee.id
              AND version.effective_from <= days.day::date
              AND (version.effective_until IS NULL OR version.effective_until >= days.day::date)
          )
          AND (schedule.effective_until IS NULL OR schedule.effective_until >= days.day::date)
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.employee_weekly_schedules version
          WHERE version.employee_id = employee.id
            AND version.effective_from <= days.day::date
            AND (version.effective_until IS NULL OR version.effective_until >= days.day::date)
        )
        AND (employee.pay_type = 'daily' OR extract(dow FROM days.day)::integer <> 5)
      )
    )
  ORDER BY days.day::date
$$;
REVOKE ALL ON FUNCTION public.leave_work_dates(uuid, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_work_dates(uuid, date, date, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_leave_form_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type public.leave_types%ROWTYPE;
  v_requested integer;
  v_year integer;
  v_days integer;
  v_used integer;
  v_adjustment numeric(8,2);
  v_carryover numeric(8,2);
BEGIN
  IF NEW.kind <> 'leave' OR NEW.status = 'rejected' THEN
    RETURN NEW;
  END IF;
  IF NEW.leave_end_date IS NULL THEN NEW.leave_end_date := NEW.work_date; END IF;
  IF NEW.leave_end_date < NEW.work_date THEN
    RAISE EXCEPTION 'تاريخ نهاية الإجازة يسبق تاريخ بدايتها';
  END IF;
  IF NEW.leave_end_date - NEW.work_date > 730 THEN
    RAISE EXCEPTION 'مدة طلب الإجازة لا يمكن أن تتجاوز سنتين';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.employee_id::text, 0));

  SELECT * INTO v_type FROM public.leave_types WHERE id = NEW.leave_type_id;
  IF v_type.id IS NULL THEN RAISE EXCEPTION 'نوع الإجازة غير موجود'; END IF;
  IF TG_OP = 'INSERT' AND NOT v_type.is_active THEN
    RAISE EXCEPTION 'نوع الإجازة غير متاح للطلبات الجديدة';
  END IF;

  SELECT count(*)::integer INTO v_requested
  FROM public.leave_work_dates(NEW.employee_id, NEW.work_date, NEW.leave_end_date, v_type.count_non_working_days);
  IF v_requested = 0 THEN
    RAISE EXCEPTION 'لا توجد أيام دوام ضمن الفترة المحددة';
  END IF;
  NEW.leave_days := v_requested;

  IF EXISTS (
    SELECT 1
    FROM public.forms prior
    JOIN public.leave_types prior_type ON prior_type.id = prior.leave_type_id
    CROSS JOIN LATERAL public.leave_work_dates(
      prior.employee_id, prior.work_date, coalesce(prior.leave_end_date, prior.work_date), prior_type.count_non_working_days
    ) prior_day
    CROSS JOIN LATERAL public.leave_work_dates(
      NEW.employee_id, NEW.work_date, NEW.leave_end_date, v_type.count_non_working_days
    ) requested_day
    WHERE prior.kind = 'leave' AND prior.status <> 'rejected'
      AND prior.employee_id = NEW.employee_id AND prior.id <> NEW.id
      AND prior_day.work_date = requested_day.work_date
  ) THEN
    RAISE EXCEPTION 'يوجد تداخل مع طلب إجازة آخر في أحد أيام الدوام';
  END IF;

  IF v_type.annual_allowance_days IS NOT NULL THEN
    FOR v_year IN
      SELECT DISTINCT extract(year FROM requested.work_date)::integer
      FROM public.leave_work_dates(NEW.employee_id, NEW.work_date, NEW.leave_end_date, v_type.count_non_working_days) requested
    LOOP
      SELECT count(*)::integer INTO v_used
      FROM public.forms prior
      JOIN public.leave_types prior_type ON prior_type.id = prior.leave_type_id
      CROSS JOIN LATERAL public.leave_work_dates(
        prior.employee_id, prior.work_date, coalesce(prior.leave_end_date, prior.work_date), prior_type.count_non_working_days
      ) prior_day
      WHERE prior.kind = 'leave' AND prior.status <> 'rejected'
        AND prior.employee_id = NEW.employee_id AND prior.leave_type_id = NEW.leave_type_id
        AND prior.id <> NEW.id
        AND extract(year FROM prior_day.work_date)::integer = v_year;

      SELECT count(*)::integer INTO v_days
      FROM public.leave_work_dates(NEW.employee_id, NEW.work_date, NEW.leave_end_date, v_type.count_non_working_days) requested
      WHERE extract(year FROM requested.work_date)::integer = v_year;

      SELECT coalesce(sum(transaction.amount), 0) INTO v_adjustment
      FROM public.leave_balance_transactions transaction
      WHERE transaction.employee_id = NEW.employee_id
        AND transaction.leave_type_id = NEW.leave_type_id AND transaction.effective_year = v_year;

      v_carryover := 0;
      IF v_year > 2000 AND v_type.carryover_cap_days > 0 THEN
        SELECT greatest(0,
          v_type.annual_allowance_days
          + coalesce((
            SELECT sum(transaction.amount)
            FROM public.leave_balance_transactions transaction
            WHERE transaction.employee_id = NEW.employee_id
              AND transaction.leave_type_id = NEW.leave_type_id
              AND transaction.effective_year = v_year - 1
          ), 0)
          - coalesce((
            SELECT count(*)
            FROM public.forms prior
            JOIN public.leave_types prior_type ON prior_type.id = prior.leave_type_id
            CROSS JOIN LATERAL public.leave_work_dates(
              prior.employee_id, prior.work_date, coalesce(prior.leave_end_date, prior.work_date), prior_type.count_non_working_days
            ) prior_day
            WHERE prior.kind = 'leave' AND prior.status <> 'rejected'
              AND prior.employee_id = NEW.employee_id AND prior.leave_type_id = NEW.leave_type_id
              AND prior.id <> NEW.id
              AND extract(year FROM prior_day.work_date)::integer = v_year - 1
          ), 0)
          - (
            SELECT count(*)
            FROM public.leave_work_dates(
              NEW.employee_id, NEW.work_date, NEW.leave_end_date, v_type.count_non_working_days
            ) requested_prior_year
            WHERE extract(year FROM requested_prior_year.work_date)::integer = v_year - 1
          )
        ) INTO v_carryover;
        v_carryover := least(v_type.carryover_cap_days, v_carryover);
      END IF;

      IF v_used + v_days > v_type.annual_allowance_days + v_carryover + v_adjustment THEN
        RAISE EXCEPTION 'رصيد الإجازة غير كافٍ لعام %. المستخدم والمحجوز % يوم، والرصيد المتاح % يوم',
          v_year, v_used, v_type.annual_allowance_days + v_carryover + v_adjustment;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_leave_form_balance() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_guard_leave_form_balance ON public.forms;
CREATE TRIGGER trg_guard_leave_form_balance
BEFORE INSERT OR UPDATE OF employee_id, work_date, leave_end_date, leave_type_id, kind
ON public.forms FOR EACH ROW EXECUTE FUNCTION public.guard_leave_form_balance();

COMMENT ON TABLE public.leave_types IS 'Configurable leave categories and paid status used by requests, attendance, and payroll.';
COMMENT ON TABLE public.leave_balance_transactions IS 'Append-only HR adjustments to employee leave balances by type and year.';
COMMENT ON FUNCTION public.leave_work_dates(uuid, date, date, boolean) IS 'Returns calendar days or scheduled workdays according to employee weekly schedules.';

CREATE OR REPLACE FUNCTION public.leave_balance_summary(_year integer)
RETURNS TABLE (
  employee_id uuid,
  employee_no text,
  full_name text,
  department_id uuid,
  department_name text,
  leave_type_id uuid,
  leave_type_code text,
  leave_type_name text,
  is_paid boolean,
  allowance_days numeric,
  carryover_days numeric,
  used_days numeric,
  reserved_days numeric,
  adjustment_days numeric,
  available_days numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_self_employee_id uuid;
BEGIN
  IF _year NOT BETWEEN 2000 AND 2200 THEN RAISE EXCEPTION 'سنة الرصيد غير صالحة'; END IF;
  SELECT employee.id INTO v_self_employee_id
  FROM public.employees employee
  JOIN public.profiles profile ON lower(profile.email) = lower(employee.email)
  WHERE profile.id = auth.uid() AND employee.status = 'active'
    AND (SELECT count(*) FROM public.employees matching
      WHERE matching.status = 'active' AND lower(matching.email) = lower(profile.email)) = 1;
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'data_entry') OR public.has_role(auth.uid(), 'department_manager')
    OR public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'site_admin')
    OR public.has_form_role(auth.uid(), 'dept_manager') OR public.has_form_role(auth.uid(), 'ceo')
    OR public.has_form_role(auth.uid(), 'executor') OR v_self_employee_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية عرض أرصدة الإجازات'; END IF;

  RETURN QUERY
  WITH request_totals AS (
    SELECT form.employee_id, form.leave_type_id,
      count(*) FILTER (WHERE form.status = 'executed')::numeric AS used_days,
      count(*) FILTER (WHERE form.status IN ('pending_manager', 'pending_ceo', 'pending_execution'))::numeric AS reserved_days
    FROM public.forms form
    JOIN public.leave_types type ON type.id = form.leave_type_id
    CROSS JOIN LATERAL public.leave_work_dates(
      form.employee_id, form.work_date, coalesce(form.leave_end_date, form.work_date), type.count_non_working_days
    ) leave_day
    WHERE form.kind = 'leave' AND form.status <> 'rejected'
      AND leave_day.work_date >= make_date(_year, 1, 1)
      AND leave_day.work_date < make_date(_year + 1, 1, 1)
    GROUP BY form.employee_id, form.leave_type_id
  ), prior_year_requests AS (
    SELECT form.employee_id, form.leave_type_id, count(*)::numeric AS used_days
    FROM public.forms form
    JOIN public.leave_types type ON type.id = form.leave_type_id
    CROSS JOIN LATERAL public.leave_work_dates(
      form.employee_id, form.work_date, coalesce(form.leave_end_date, form.work_date), type.count_non_working_days
    ) leave_day
    WHERE form.kind = 'leave' AND form.status <> 'rejected'
      AND leave_day.work_date >= make_date(_year - 1, 1, 1)
      AND leave_day.work_date < make_date(_year, 1, 1)
    GROUP BY form.employee_id, form.leave_type_id
  ), prior_year_adjustments AS (
    SELECT transaction.employee_id, transaction.leave_type_id, sum(transaction.amount)::numeric AS adjustment_days
    FROM public.leave_balance_transactions transaction
    WHERE transaction.effective_year = _year - 1
    GROUP BY transaction.employee_id, transaction.leave_type_id
  ), adjustment_totals AS (
    SELECT transaction.employee_id, transaction.leave_type_id, sum(transaction.amount)::numeric AS adjustment_days
    FROM public.leave_balance_transactions transaction
    WHERE transaction.effective_year = _year
    GROUP BY transaction.employee_id, transaction.leave_type_id
  )
  SELECT employee.id, employee.employee_no, employee.full_name,
    employee.department_id, department.name,
    type.id, type.code, type.name, type.is_paid,
    CASE WHEN type.annual_allowance_days IS NULL THEN NULL
      ELSE type.annual_allowance_days + least(type.carryover_cap_days, greatest(0::numeric,
        type.annual_allowance_days + coalesce(prior_adjustment.adjustment_days, 0)
          - coalesce(prior_request.used_days, 0)
      ))
    END,
    CASE WHEN type.annual_allowance_days IS NULL THEN 0::numeric
      ELSE least(type.carryover_cap_days, greatest(0::numeric,
        type.annual_allowance_days + coalesce(prior_adjustment.adjustment_days, 0)
          - coalesce(prior_request.used_days, 0)
      ))
    END,
    coalesce(request.used_days, 0), coalesce(request.reserved_days, 0), coalesce(adjustment.adjustment_days, 0),
    CASE WHEN type.annual_allowance_days IS NULL THEN NULL
      ELSE type.annual_allowance_days
        + least(type.carryover_cap_days, greatest(0::numeric,
            type.annual_allowance_days + coalesce(prior_adjustment.adjustment_days, 0)
              - coalesce(prior_request.used_days, 0)
          ))
        + coalesce(adjustment.adjustment_days, 0)
        - coalesce(request.used_days, 0) - coalesce(request.reserved_days, 0)
    END
  FROM public.employees employee
  CROSS JOIN public.leave_types type
  LEFT JOIN public.departments department ON department.id = employee.department_id
  LEFT JOIN request_totals request ON request.employee_id = employee.id AND request.leave_type_id = type.id
  LEFT JOIN prior_year_requests prior_request ON prior_request.employee_id = employee.id AND prior_request.leave_type_id = type.id
  LEFT JOIN prior_year_adjustments prior_adjustment ON prior_adjustment.employee_id = employee.id AND prior_adjustment.leave_type_id = type.id
  LEFT JOIN adjustment_totals adjustment ON adjustment.employee_id = employee.id AND adjustment.leave_type_id = type.id
  WHERE employee.status = 'active'
    AND (
      type.is_active OR request.employee_id IS NOT NULL OR adjustment.employee_id IS NOT NULL
      OR prior_request.employee_id IS NOT NULL OR prior_adjustment.employee_id IS NOT NULL
    )
    AND (
      public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
      OR public.has_role(auth.uid(), 'data_entry') OR public.has_form_role(auth.uid(), 'dept_manager')
      OR public.has_form_role(auth.uid(), 'ceo') OR public.has_form_role(auth.uid(), 'executor')
      OR public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'site_admin')
      OR employee.id = v_self_employee_id
      OR (
        public.has_role(auth.uid(), 'department_manager')
        AND EXISTS (
          SELECT 1 FROM public.department_managers manager
          WHERE manager.user_id = auth.uid() AND manager.department_id = employee.department_id
        )
      )
    )
  ORDER BY employee.employee_no, type.sort_order, type.name;
END $$;
REVOKE ALL ON FUNCTION public.leave_balance_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_balance_summary(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.leave_calendar_month(_year integer, _month integer)
RETURNS TABLE (
  work_date date,
  form_id uuid,
  form_no bigint,
  employee_id uuid,
  employee_no text,
  full_name text,
  department_name text,
  leave_type_id uuid,
  leave_type_name text,
  is_paid boolean,
  status public.form_status
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date;
  v_end date;
  v_self_employee_id uuid;
BEGIN
  IF _year NOT BETWEEN 2000 AND 2200 OR _month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'الشهر المحدد غير صالح';
  END IF;
  SELECT employee.id INTO v_self_employee_id
  FROM public.employees employee
  JOIN public.profiles profile ON lower(profile.email) = lower(employee.email)
  WHERE profile.id = auth.uid() AND employee.status = 'active'
    AND (SELECT count(*) FROM public.employees matching
      WHERE matching.status = 'active' AND lower(matching.email) = lower(profile.email)) = 1;
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'data_entry') OR public.has_role(auth.uid(), 'department_manager')
    OR public.has_form_role(auth.uid(), 'dept_manager') OR public.has_form_role(auth.uid(), 'ceo')
    OR public.has_form_role(auth.uid(), 'executor') OR v_self_employee_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'لا تملك صلاحية عرض تقويم الإجازات'; END IF;
  v_start := make_date(_year, _month, 1);
  v_end := (v_start + interval '1 month')::date;

  RETURN QUERY
  SELECT leave_day.work_date, form.id, form.form_no, employee.id, employee.employee_no,
    employee.full_name, department.name, type.id, type.name, type.is_paid, form.status
  FROM public.forms form
  JOIN public.employees employee ON employee.id = form.employee_id
  JOIN public.leave_types type ON type.id = form.leave_type_id
  LEFT JOIN public.departments department ON department.id = employee.department_id
  CROSS JOIN LATERAL public.leave_work_dates(
    form.employee_id, form.work_date, coalesce(form.leave_end_date, form.work_date), type.count_non_working_days
  ) leave_day
  WHERE form.kind = 'leave' AND form.status <> 'rejected'
    AND leave_day.work_date >= v_start AND leave_day.work_date < v_end
    AND (
      public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
      OR public.has_role(auth.uid(), 'data_entry') OR public.has_form_role(auth.uid(), 'dept_manager')
      OR public.has_form_role(auth.uid(), 'ceo') OR public.has_form_role(auth.uid(), 'executor')
      OR employee.id = v_self_employee_id
      OR (
        public.has_role(auth.uid(), 'department_manager')
        AND EXISTS (
          SELECT 1 FROM public.department_managers manager
          WHERE manager.user_id = auth.uid() AND manager.department_id = employee.department_id
        )
      )
    )
  ORDER BY leave_day.work_date, employee.full_name;
END $$;
REVOKE ALL ON FUNCTION public.leave_calendar_month(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_calendar_month(integer, integer) TO authenticated, service_role;

-- Forms are visible to their submitter and to users who have a defined workflow role.
DROP POLICY IF EXISTS "read forms" ON public.forms;
CREATE POLICY "read forms" ON public.forms FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
  OR public.has_role(auth.uid(), 'data_entry') OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'site_admin')
  OR public.has_form_role(auth.uid(), 'ceo') OR public.has_form_role(auth.uid(), 'executor')
  OR public.has_form_role(auth.uid(), 'dept_manager')
  OR created_by = auth.uid()
  OR (
    public.has_role(auth.uid(), 'department_manager')
    AND EXISTS (
      SELECT 1 FROM public.department_managers manager
      WHERE manager.user_id = auth.uid() AND manager.department_id = forms.department_id
    )
  )
);

DROP POLICY IF EXISTS "process forms" ON public.forms;
CREATE POLICY "process forms" ON public.forms FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
  OR (public.has_form_role(auth.uid(), 'dept_manager') AND status = 'pending_manager')
  OR (
    public.has_role(auth.uid(), 'department_manager') AND status = 'pending_manager'
    AND EXISTS (
      SELECT 1 FROM public.department_managers manager
      WHERE manager.user_id = auth.uid() AND manager.department_id = forms.department_id
    )
  )
  OR (public.has_form_role(auth.uid(), 'ceo') AND status = 'pending_ceo')
  OR (public.has_form_role(auth.uid(), 'executor') AND status = 'pending_execution')
  OR (public.has_role(auth.uid(), 'data_entry') AND status = 'pending_execution')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
  OR (public.has_form_role(auth.uid(), 'dept_manager') AND status IN ('pending_ceo', 'rejected'))
  OR (
    public.has_role(auth.uid(), 'department_manager') AND status IN ('pending_ceo', 'rejected')
    AND EXISTS (
      SELECT 1 FROM public.department_managers manager
      WHERE manager.user_id = auth.uid() AND manager.department_id = forms.department_id
    )
  )
  OR (public.has_form_role(auth.uid(), 'ceo') AND status IN ('pending_execution', 'rejected'))
  OR (public.has_form_role(auth.uid(), 'executor') AND status IN ('executed', 'rejected'))
  OR (public.has_role(auth.uid(), 'data_entry') AND status IN ('executed', 'rejected'))
);

DROP POLICY IF EXISTS "read form events" ON public.form_events;
CREATE POLICY "read form events" ON public.form_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.forms form WHERE form.id = form_events.form_id));

-- Employees may submit their own leave requests; HR and data entry may submit on their behalf.
DROP POLICY IF EXISTS "create forms" ON public.forms;
CREATE POLICY "create forms" ON public.forms FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid()
  AND (
    kind <> 'leave'
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'data_entry')
    OR EXISTS (
      SELECT 1 FROM public.employees employee
      JOIN public.profiles profile ON lower(profile.email) = lower(employee.email)
      WHERE profile.id = auth.uid() AND employee.id = forms.employee_id AND employee.status = 'active'
        AND (SELECT count(*) FROM public.employees matching
          WHERE matching.status = 'active' AND lower(matching.email) = lower(profile.email)) = 1
    )
  )
);

DROP POLICY IF EXISTS "withdraw own pending leave" ON public.forms;
CREATE POLICY "withdraw own pending leave" ON public.forms FOR UPDATE TO authenticated
USING (
  created_by = auth.uid() AND kind = 'leave'
  AND status IN ('pending_manager', 'pending_ceo', 'pending_execution')
  AND EXISTS (
    SELECT 1 FROM public.employees employee
    JOIN public.profiles profile ON lower(profile.email) = lower(employee.email)
    WHERE profile.id = auth.uid() AND employee.id = forms.employee_id AND employee.status = 'active'
      AND (SELECT count(*) FROM public.employees matching
        WHERE matching.status = 'active' AND lower(matching.email) = lower(profile.email)) = 1
  )
)
WITH CHECK (
  created_by = auth.uid() AND kind = 'leave' AND status = 'rejected'
  AND rejection_reason = 'تم سحب الطلب من مقدم الطلب'
  AND rejected_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.employees employee
    JOIN public.profiles profile ON lower(profile.email) = lower(employee.email)
    WHERE profile.id = auth.uid() AND employee.id = forms.employee_id AND employee.status = 'active'
      AND (SELECT count(*) FROM public.employees matching
        WHERE matching.status = 'active' AND lower(matching.email) = lower(profile.email)) = 1
  )
);

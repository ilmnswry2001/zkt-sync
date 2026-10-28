BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_daily_overtime (
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  overtime_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);
ALTER TABLE public.attendance_daily_overtime ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.attendance_daily_overtime TO authenticated;
GRANT ALL ON public.attendance_daily_overtime TO service_role;
DROP POLICY IF EXISTS "authenticated read daily overtime" ON public.attendance_daily_overtime;
CREATE POLICY "authenticated read daily overtime" ON public.attendance_daily_overtime
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.refresh_attendance_day_overtime(
  p_employee_id uuid,
  p_work_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_end time;
  v_grace_minutes integer := 0;
  v_check_in_exists boolean;
  v_check_out timestamptz;
  v_overtime numeric(6,2) := 0;
BEGIN
  IF p_employee_id IS NULL OR p_work_date IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.attendance_logs l
    WHERE l.employee_id = p_employee_id
      AND (l.verify_time AT TIME ZONE 'Asia/Baghdad')::date = p_work_date
      AND (l.self_event_type = 'check_in' OR (l.self_event_type IS NULL AND
        (l.status = 0 OR (l.status IS NULL AND l.verify_type = 0))))
  ) INTO v_check_in_exists;

  SELECT max(l.verify_time) INTO v_check_out
  FROM public.attendance_logs l
  WHERE l.employee_id = p_employee_id
    AND (l.verify_time AT TIME ZONE 'Asia/Baghdad')::date = p_work_date
    AND (l.self_event_type = 'check_out' OR (l.self_event_type IS NULL AND
      (l.status = 1 OR (l.status IS NULL AND l.verify_type = 1))));

  IF v_check_in_exists AND v_check_out IS NOT NULL THEN
    SELECT ws.end_time, ws.grace_minutes
      INTO v_shift_end, v_grace_minutes
    FROM public.employee_weekly_schedules ws
    WHERE ws.employee_id = p_employee_id
      AND ws.weekday = extract(dow FROM p_work_date)::smallint
      AND ws.effective_from <= p_work_date
      AND (ws.effective_until IS NULL OR ws.effective_until >= p_work_date)
    ORDER BY ws.effective_from DESC
    LIMIT 1;

    IF NOT FOUND OR v_shift_end IS NULL THEN
      SELECT s.end_time, coalesce(s.grace_minutes, 0)
        INTO v_shift_end, v_grace_minutes
      FROM public.employees e
      LEFT JOIN public.shifts s ON s.id = e.shift_id
      WHERE e.id = p_employee_id;
    END IF;

    IF v_shift_end IS NOT NULL THEN
      v_overtime := round(greatest(
        0,
        extract(epoch FROM (
          v_check_out - ((p_work_date + v_shift_end) AT TIME ZONE 'Asia/Baghdad')
        )) / 3600 - greatest(coalesce(v_grace_minutes, 0), 0)::numeric / 60
      )::numeric, 2);
    END IF;
  END IF;

  IF v_check_in_exists AND v_check_out IS NOT NULL THEN
    INSERT INTO public.attendance_daily_overtime(employee_id, work_date, overtime_hours)
    VALUES (p_employee_id, p_work_date, v_overtime)
    ON CONFLICT (employee_id, work_date) DO UPDATE
      SET overtime_hours = EXCLUDED.overtime_hours, updated_at = now();
  ELSE
    UPDATE public.attendance_daily_overtime
      SET overtime_hours = 0, updated_at = now()
    WHERE employee_id = p_employee_id AND work_date = p_work_date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_attendance_day_overtime_from_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.self_event_type = 'check_out' OR (NEW.self_event_type IS NULL AND
      (NEW.status = 1 OR (NEW.status IS NULL AND NEW.verify_type = 1))) THEN
    PERFORM public.refresh_attendance_day_overtime(
      NEW.employee_id,
      (NEW.verify_time AT TIME ZONE 'Asia/Baghdad')::date
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_day_overtime_from_log ON public.attendance_logs;
CREATE TRIGGER trg_attendance_day_overtime_from_log
  AFTER INSERT OR UPDATE ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_attendance_day_overtime_from_log();

REVOKE ALL ON FUNCTION public.refresh_attendance_day_overtime(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_attendance_day_overtime_from_log() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT DISTINCT l.employee_id, (l.verify_time AT TIME ZONE 'Asia/Baghdad')::date AS work_date
    FROM public.attendance_logs l
    WHERE l.employee_id IS NOT NULL
      AND (l.self_event_type = 'check_out' OR (l.self_event_type IS NULL AND
        (l.status = 1 OR (l.status IS NULL AND l.verify_type = 1))))
  LOOP
    PERFORM public.refresh_attendance_day_overtime(v_row.employee_id, v_row.work_date);
  END LOOP;
END;
$$;

COMMIT;

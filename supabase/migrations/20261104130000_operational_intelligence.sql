CREATE TABLE public.operational_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_type text NOT NULL CHECK (
    anomaly_type IN (
      'SUSPICIOUS_FUEL',
      'ODOMETER_ROLLBACK',
      'PHANTOM_PRESENCE',
      'UNASSIGNED_PRESENCE',
      'EXCESSIVE_OVERTIME',
      'MAINTENANCE_OVERDUE',
      'DRIVER_ABSENT_ON_FUELING',
      'SUSPICIOUS_FUEL_RATE',
      'DAILY_WAGE_DURING_LEAVE'
    )
  ),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  entity_type text NOT NULL CHECK (entity_type IN ('vehicle', 'employee', 'workshop', 'payroll')),
  entity_id uuid NOT NULL,
  entity_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (is_resolved AND resolved_at IS NOT NULL)
    OR (NOT is_resolved AND resolved_at IS NULL)
  )
);

CREATE UNIQUE INDEX operational_anomalies_dedup_idx
  ON public.operational_anomalies (
    anomaly_type,
    entity_type,
    entity_id,
    (details ->> 'dedupe_key')
  );
CREATE INDEX operational_anomalies_open_idx
  ON public.operational_anomalies(severity, created_at DESC)
  WHERE NOT is_resolved;

ALTER TABLE public.operational_anomalies ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.operational_anomalies TO authenticated;
GRANT ALL ON public.operational_anomalies TO service_role;

CREATE POLICY "authorized users read operational anomalies"
  ON public.operational_anomalies FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
  );
CREATE POLICY "hr admin resolve operational anomalies"
  ON public.operational_anomalies FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
  );

CREATE TABLE public.vehicle_maintenance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN ('oil_change', 'tires', 'brakes', 'general')),
  interval_km integer NOT NULL DEFAULT 5000 CHECK (interval_km > 0),
  last_service_odometer integer NOT NULL DEFAULT 0 CHECK (last_service_odometer >= 0),
  next_due_odometer integer NOT NULL CHECK (next_due_odometer >= 0),
  warning_threshold_km integer NOT NULL DEFAULT 500 CHECK (warning_threshold_km >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, service_type)
);

CREATE INDEX vehicle_maintenance_schedules_due_idx
  ON public.vehicle_maintenance_schedules(vehicle_id, next_due_odometer);
ALTER TABLE public.vehicle_maintenance_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_maintenance_schedules TO authenticated;
GRANT ALL ON public.vehicle_maintenance_schedules TO service_role;

CREATE POLICY "authenticated read vehicle maintenance schedules"
  ON public.vehicle_maintenance_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "maintenance staff manage vehicle schedules"
  ON public.vehicle_maintenance_schedules FOR ALL TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.is_maintenance_staff(auth.uid())
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.is_maintenance_staff(auth.uid())
  );

CREATE TRIGGER trg_vehicle_maintenance_schedules_updated_at
  BEFORE UPDATE ON public.vehicle_maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.audit_fuel_voucher_anomalies(p_voucher_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voucher public.vehicle_fuel_vouchers%ROWTYPE;
  v_previous public.vehicle_fuel_vouchers%ROWTYPE;
  v_vehicle_name text;
  v_driver_name text;
  v_distance numeric;
  v_rate numeric;
  v_inserted integer := 0;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتدقيق قسائم الوقود';
  END IF;

  SELECT * INTO v_voucher
  FROM public.vehicle_fuel_vouchers
  WHERE id = p_voucher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'قسيمة الوقود غير موجودة';
  END IF;

  SELECT name INTO v_vehicle_name
  FROM public.vehicles
  WHERE id = v_voucher.vehicle_id;

  IF v_voucher.driver_id IS NOT NULL THEN
    SELECT full_name INTO v_driver_name
    FROM public.employees
    WHERE id = v_voucher.driver_id;

    IF NOT EXISTS (
      SELECT 1
      FROM public.attendance_logs l
      WHERE l.employee_id = v_voucher.driver_id
        AND (l.verify_time AT TIME ZONE 'Asia/Baghdad')::date = v_voucher.voucher_date
        AND l.source IN ('device', 'zkteco_auto_agent', 'zk_agent', 'mobile_self')
        AND NOT l.is_suspicious
    ) THEN
      INSERT INTO public.operational_anomalies(
        anomaly_type, severity, entity_type, entity_id, entity_name, details
      )
      VALUES (
        'DRIVER_ABSENT_ON_FUELING', 'high', 'vehicle', v_voucher.vehicle_id,
        v_vehicle_name,
        jsonb_build_object(
          'dedupe_key', 'voucher:' || v_voucher.id,
          'voucher_id', v_voucher.id,
          'voucher_no', v_voucher.voucher_no,
          'driver_id', v_voucher.driver_id,
          'driver_name', v_driver_name,
          'voucher_date', v_voucher.voucher_date
        )
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_inserted := v_inserted + v_count;
    END IF;
  END IF;

  SELECT * INTO v_previous
  FROM public.vehicle_fuel_vouchers previous
  WHERE previous.vehicle_id = v_voucher.vehicle_id
    AND previous.id <> v_voucher.id
    AND previous.odometer_reading IS NOT NULL
    AND previous.voucher_date <= v_voucher.voucher_date
    AND (previous.voucher_date, previous.created_at, previous.id)
      < (v_voucher.voucher_date, v_voucher.created_at, v_voucher.id)
  ORDER BY previous.voucher_date DESC, previous.created_at DESC, previous.id DESC
  LIMIT 1;

  IF FOUND AND v_voucher.odometer_reading IS NOT NULL THEN
    v_distance := v_voucher.odometer_reading - v_previous.odometer_reading;

    IF v_distance < 0 THEN
      INSERT INTO public.operational_anomalies(
        anomaly_type, severity, entity_type, entity_id, entity_name, details
      )
      VALUES (
        'ODOMETER_ROLLBACK', 'critical', 'vehicle', v_voucher.vehicle_id,
        v_vehicle_name,
        jsonb_build_object(
          'dedupe_key', 'voucher:' || v_voucher.id,
          'voucher_id', v_voucher.id,
          'voucher_no', v_voucher.voucher_no,
          'previous_voucher_id', v_previous.id,
          'previous_odometer', v_previous.odometer_reading,
          'current_odometer', v_voucher.odometer_reading,
          'voucher_date', v_voucher.voucher_date
        )
      )
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_inserted := v_inserted + v_count;
    ELSIF v_distance > 0 THEN
      v_rate := v_voucher.liters / v_distance * 100;
      IF v_rate > 35 THEN
        INSERT INTO public.operational_anomalies(
          anomaly_type, severity, entity_type, entity_id, entity_name, details
        )
        VALUES (
          'SUSPICIOUS_FUEL_RATE', 'high', 'vehicle', v_voucher.vehicle_id,
          v_vehicle_name,
          jsonb_build_object(
            'dedupe_key', 'voucher:' || v_voucher.id,
            'voucher_id', v_voucher.id,
            'voucher_no', v_voucher.voucher_no,
            'liters', v_voucher.liters,
            'distance_km', v_distance,
            'liters_per_100km', round(v_rate, 2),
            'voucher_date', v_voucher.voucher_date
          )
        )
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_inserted := v_inserted + v_count;
      END IF;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_fuel_voucher_anomalies(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_fuel_voucher_anomalies(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_vehicle_fuel_voucher_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.audit_fuel_voucher_anomalies(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_vehicle_fuel_voucher_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_vehicle_fuel_voucher ON public.vehicle_fuel_vouchers;
CREATE TRIGGER trg_audit_vehicle_fuel_voucher
  AFTER INSERT OR UPDATE
  ON public.vehicle_fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.audit_vehicle_fuel_voucher_trigger();

CREATE OR REPLACE FUNCTION public.run_biometric_vs_inventory_audit(p_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_inserted integer := 0;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'data_entry')
    OR public.has_form_role(auth.uid(), 'ceo')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتدقيق حضور الورش';
  END IF;

  FOR v_row IN
    SELECT l.id AS line_id, l.employee_id, l.employee_name_snapshot,
      r.workshop_id, w.name AS workshop_name, r.id AS report_id
    FROM public.daily_workshop_reports r
    JOIN public.daily_workshop_report_lines l ON l.report_id = r.id
    JOIN public.daily_workshops w ON w.id = r.workshop_id
    WHERE r.report_date = p_date
      AND l.attended
      AND l.employee_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.attendance_logs a
        WHERE a.employee_id = l.employee_id
          AND (a.verify_time AT TIME ZONE 'Asia/Baghdad')::date = p_date
          AND a.source IN ('device', 'zkteco_auto_agent', 'zk_agent', 'mobile_self')
          AND NOT a.is_suspicious
      )
  LOOP
    INSERT INTO public.operational_anomalies(
      anomaly_type, severity, entity_type, entity_id, entity_name, details
    )
    VALUES (
      'PHANTOM_PRESENCE', 'high', 'workshop', v_row.workshop_id,
      v_row.workshop_name,
      jsonb_build_object(
        'dedupe_key', 'report-line:' || v_row.line_id,
        'report_id', v_row.report_id,
        'report_line_id', v_row.line_id,
        'employee_id', v_row.employee_id,
        'employee_name', v_row.employee_name_snapshot,
        'work_date', p_date
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_inserted := v_inserted + v_count;
  END LOOP;

  FOR v_row IN
    SELECT a.id AS log_id, a.employee_id, a.employee_no,
      e.full_name, a.site_id, s.name AS site_name
    FROM public.attendance_logs a
    LEFT JOIN public.employees e ON e.id = a.employee_id
    LEFT JOIN public.sites s ON s.id = a.site_id
    WHERE (a.verify_time AT TIME ZONE 'Asia/Baghdad')::date = p_date
      AND a.source IN ('device', 'zkteco_auto_agent', 'zk_agent')
      AND (a.status = 0 OR (a.status IS NULL AND a.verify_type = 0))
      AND a.employee_id IS NOT NULL
      AND NOT a.is_suspicious
      AND NOT EXISTS (
        SELECT 1
        FROM public.daily_workshop_members m
        WHERE m.employee_id = a.employee_id AND m.is_active
      )
  LOOP
    INSERT INTO public.operational_anomalies(
      anomaly_type, severity, entity_type, entity_id, entity_name, details
    )
    VALUES (
      'UNASSIGNED_PRESENCE', 'medium', 'employee', v_row.employee_id,
      coalesce(v_row.full_name, v_row.employee_no),
      jsonb_build_object(
        'dedupe_key', 'attendance-log:' || v_row.log_id,
        'attendance_log_id', v_row.log_id,
        'employee_no', v_row.employee_no,
        'site_id', v_row.site_id,
        'site_name', v_row.site_name,
        'work_date', p_date
      )
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_inserted := v_inserted + v_count;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.run_biometric_vs_inventory_audit(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_biometric_vs_inventory_audit(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.run_pre_payroll_audit(p_month date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_form_role(auth.uid(), 'ceo')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتدقيق الرواتب';
  END IF;
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد شهر الرواتب';
  END IF;

  v_month_start := date_trunc('month', p_month)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  INSERT INTO public.operational_anomalies(
    anomaly_type, severity, entity_type, entity_id, entity_name, details
  )
  SELECT
    'DAILY_WAGE_DURING_LEAVE', 'high', 'payroll', e.id, e.full_name,
    jsonb_build_object(
      'dedupe_key', 'daily-leave:' || e.id || ':' || leave_day.work_date,
      'employee_id', e.id,
      'employee_no', e.employee_no,
      'work_date', leave_day.work_date,
      'form_id', leave_day.form_id,
      'period_month', to_char(v_month_start, 'YYYY-MM')
    )
  FROM public.employees e
  JOIN LATERAL (
    SELECT DISTINCT f.id AS form_id, work_day::date AS work_date
    FROM public.forms f
    CROSS JOIN LATERAL generate_series(
      greatest(f.work_date, v_month_start)::timestamp,
      least(coalesce(f.leave_end_date, f.work_date), v_month_end - 1)::timestamp,
      interval '1 day'
    ) AS days(work_day)
    WHERE f.employee_id = e.id
      AND f.kind = 'leave'
      AND f.status IN ('pending_execution', 'executed')
      AND f.work_date < v_month_end
      AND coalesce(f.leave_end_date, f.work_date) >= v_month_start
      AND (
        EXISTS (
          SELECT 1 FROM public.attendance_day_status d
          WHERE d.employee_id = e.id AND d.work_date = work_day::date AND d.status = 'present'
        )
        OR EXISTS (
          SELECT 1 FROM public.attendance_logs a
          WHERE a.employee_id = e.id
            AND (a.verify_time AT TIME ZONE 'Asia/Baghdad')::date = work_day::date
            AND NOT a.is_suspicious
        )
      )
  ) leave_day ON true
  WHERE e.status = 'active' AND e.pay_type = 'daily'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.operational_anomalies(
    anomaly_type, severity, entity_type, entity_id, entity_name, details
  )
  SELECT
    'EXCESSIVE_OVERTIME', 'high', 'payroll', e.id, e.full_name,
    jsonb_build_object(
      'dedupe_key', 'overtime:' || e.id || ':' || o.work_date,
      'employee_id', e.id,
      'employee_no', e.employee_no,
      'work_date', o.work_date,
      'overtime_hours', o.overtime_hours,
      'period_month', to_char(v_month_start, 'YYYY-MM')
    )
  FROM public.attendance_daily_overtime o
  JOIN public.employees e ON e.id = o.employee_id
  WHERE o.work_date >= v_month_start
    AND o.work_date < v_month_end
    AND o.overtime_hours > 4
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendance_logs a
      WHERE a.employee_id = o.employee_id
        AND (a.verify_time AT TIME ZONE 'Asia/Baghdad')::date = o.work_date
        AND (
          a.self_event_type = 'check_out'
          OR (a.self_event_type IS NULL AND (a.status = 1 OR (a.status IS NULL AND a.verify_type = 1)))
        )
    )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'month', to_char(v_month_start, 'YYYY-MM'),
    'flags', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'anomaly_type', a.anomaly_type,
        'severity', a.severity,
        'entity_id', a.entity_id,
        'entity_name', a.entity_name,
        'details', a.details
      ) ORDER BY a.created_at DESC)
      FROM public.operational_anomalies a
      WHERE a.entity_type = 'payroll'
        AND a.details ->> 'period_month' = to_char(v_month_start, 'YYYY-MM')
        AND NOT a.is_resolved
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_pre_payroll_audit(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_pre_payroll_audit(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_executive_daily_brief(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active integer;
  v_present integer;
  v_critical integer;
  v_overdue integer;
  v_anomalies integer;
  v_rate numeric;
  v_anomaly_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'hr')
    OR public.has_form_role(auth.uid(), 'ceo')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بعرض الملخص التنفيذي';
  END IF;

  SELECT count(*) INTO v_active FROM public.employees WHERE status = 'active';
  SELECT count(DISTINCT a.employee_id) INTO v_present
  FROM public.attendance_logs a
  JOIN public.employees e ON e.id = a.employee_id AND e.status = 'active'
  WHERE (a.verify_time AT TIME ZONE 'Asia/Baghdad')::date = p_date
    AND NOT a.is_suspicious
    AND (
      a.self_event_type = 'check_in'
      OR (a.self_event_type IS NULL AND (a.status = 0 OR (a.status IS NULL AND a.verify_type = 0)))
    );

  v_rate := CASE WHEN v_active = 0 THEN 0 ELSE round(v_present::numeric * 100 / v_active, 1) END;

  PERFORM public.run_biometric_vs_inventory_audit(p_date);

  INSERT INTO public.operational_anomalies(
    anomaly_type, severity, entity_type, entity_id, entity_name, details
  )
  SELECT
    'MAINTENANCE_OVERDUE',
    CASE
      WHEN v.current_odometer - s.next_due_odometer > s.warning_threshold_km * 2 THEN 'critical'
      ELSE 'high'
    END,
    'vehicle',
    v.id,
    v.name,
    jsonb_build_object(
      'dedupe_key', 'schedule:' || s.id || ':due:' || s.next_due_odometer,
      'schedule_id', s.id,
      'vehicle_no', v.vehicle_no,
      'service_type', s.service_type,
      'current_odometer', v.current_odometer,
      'next_due_odometer', s.next_due_odometer,
      'overdue_km', v.current_odometer - s.next_due_odometer
    )
  FROM public.vehicle_maintenance_schedules s
  JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE v.current_odometer >= s.next_due_odometer
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_critical
  FROM public.operational_anomalies
  WHERE NOT is_resolved AND severity = 'critical';
  SELECT count(*) INTO v_anomalies
  FROM public.operational_anomalies
  WHERE NOT is_resolved;
  SELECT count(*) INTO v_overdue
  FROM public.vehicle_maintenance_schedules s
  JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE v.current_odometer >= s.next_due_odometer;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'anomaly_type', a.anomaly_type,
    'severity', a.severity,
    'entity_type', a.entity_type,
    'entity_id', a.entity_id,
    'entity_name', a.entity_name,
    'details', a.details,
    'created_at', a.created_at
  ) ORDER BY
    CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    a.created_at DESC
  ), '[]'::jsonb)
  INTO v_anomaly_rows
  FROM (
    SELECT * FROM public.operational_anomalies
    WHERE NOT is_resolved
    ORDER BY created_at DESC
    LIMIT 20
  ) a;

  RETURN jsonb_build_object(
    'date', p_date,
    'attendance_percentage', v_rate,
    'active_employees', v_active,
    'present_employees', v_present,
    'critical_anomalies', v_critical,
    'unresolved_anomalies', v_anomalies,
    'overdue_maintenance', v_overdue,
    'anomalies', v_anomaly_rows,
    'summary_ar',
      'ملخص ' || to_char(p_date, 'YYYY-MM-DD') || ': حضور ' ||
      v_present || ' من ' || v_active || ' موظف (' || v_rate ||
      '%)، و' || v_critical || ' تنبيه حرج، و' || v_overdue ||
      ' جدول صيانة متجاوز للاستحقاق.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_executive_daily_brief(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_executive_daily_brief(date) TO authenticated;

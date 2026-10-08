-- Mobile self-attendance with server-side geofencing and duplicate protection.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 200;

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'device',
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS distance_meters numeric(10,2),
  ADD COLUMN IF NOT EXISTS device_info jsonb,
  ADD COLUMN IF NOT EXISTS self_event_type text;

ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_geofence_radius_check;
ALTER TABLE public.sites ADD CONSTRAINT sites_geofence_radius_check
  CHECK (geofence_radius_meters BETWEEN 25 AND 5000);

ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_source_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_source_check
  CHECK (source IN ('device', 'mobile_self', 'manual'));

ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_self_event_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_self_event_check
  CHECK (self_event_type IS NULL OR self_event_type IN ('check_in', 'check_out'));

CREATE INDEX IF NOT EXISTS attendance_logs_employee_time_idx
  ON public.attendance_logs(employee_id, verify_time DESC);
CREATE INDEX IF NOT EXISTS attendance_logs_mobile_source_idx
  ON public.attendance_logs(source, verify_time DESC);

CREATE OR REPLACE FUNCTION public.record_mobile_self_attendance(
  p_event_type text,
  p_latitude numeric,
  p_longitude numeric,
  p_device_info jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id uuid,
  employee_id uuid,
  recorded_at timestamptz,
  event_type text,
  distance_meters numeric,
  site_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_site public.sites%ROWTYPE;
  v_distance numeric;
  v_now timestamptz := now();
  v_id uuid;
BEGIN
  IF p_event_type NOT IN ('check_in', 'check_out') THEN
    RAISE EXCEPTION 'نوع حركة الحضور غير صالح';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'إحداثيات GPS غير صالحة';
  END IF;

  SELECT e.* INTO v_employee
  FROM public.employees e
  JOIN auth.users u ON lower(u.email) = lower(e.email)
  WHERE u.id = auth.uid() AND e.status = 'active'
  LIMIT 1;

  IF v_employee.id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد سجل موظف نشط مرتبط بهذا الحساب';
  END IF;
  IF v_employee.site_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم تخصيص موقع عمل لهذا الموظف';
  END IF;

  SELECT s.* INTO v_site FROM public.sites s WHERE s.id = v_employee.site_id;
  IF v_site.id IS NULL OR v_site.latitude IS NULL OR v_site.longitude IS NULL THEN
    RAISE EXCEPTION 'إحداثيات موقع العمل غير مكتملة؛ اطلب من الإدارة تحديث الموقع';
  END IF;

  v_distance := 6371000 * 2 * asin(sqrt(
    power(sin(radians(p_latitude - v_site.latitude) / 2), 2)
    + cos(radians(v_site.latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - v_site.longitude) / 2), 2)
  ));

  IF v_distance > v_site.geofence_radius_meters THEN
    RAISE EXCEPTION 'خارج نطاق موقع العمل: تبعد % متراً', round(v_distance);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.attendance_logs l
    WHERE l.employee_id = v_employee.id
      AND l.verify_time >= v_now - interval '5 minutes'
  ) THEN
    RAISE EXCEPTION 'يجب الانتظار 5 دقائق بين حركتي الحضور والانصراف';
  END IF;

  IF p_event_type = 'check_out' AND NOT EXISTS (
    SELECT 1 FROM public.attendance_logs l
    WHERE l.employee_id = v_employee.id
      AND l.verify_time::date = (v_now AT TIME ZONE 'Asia/Baghdad')::date
      AND (l.self_event_type = 'check_in' OR l.verify_type = 0)
  ) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل الانصراف قبل تسجيل الحضور';
  END IF;

  INSERT INTO public.attendance_logs (
    employee_no, employee_id, device_id, upload_id, verify_time, verify_type,
    source, latitude, longitude, distance_meters, device_info, self_event_type
  ) VALUES (
    v_employee.employee_no, v_employee.id, NULL, NULL, v_now,
    CASE WHEN p_event_type = 'check_in' THEN 0 ELSE 1 END,
    'mobile_self', p_latitude, p_longitude, round(v_distance, 2), p_device_info, p_event_type
  ) RETURNING attendance_logs.id INTO v_id;

  RETURN QUERY SELECT v_id, v_employee.id, v_now, p_event_type, round(v_distance, 2), v_site.name;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb) TO authenticated;

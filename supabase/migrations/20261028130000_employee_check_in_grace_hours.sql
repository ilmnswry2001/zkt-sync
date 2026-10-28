BEGIN;

ALTER TABLE public.employee_self_attendance_access
  ADD COLUMN IF NOT EXISTS check_in_grace_hours numeric(4,2) NOT NULL DEFAULT 0;

ALTER TABLE public.employee_self_attendance_access
  DROP CONSTRAINT IF EXISTS employee_self_attendance_access_check_in_grace_hours_check;
ALTER TABLE public.employee_self_attendance_access
  ADD CONSTRAINT employee_self_attendance_access_check_in_grace_hours_check
  CHECK (check_in_grace_hours BETWEEN 0 AND 24);

CREATE OR REPLACE FUNCTION public.set_employee_self_attendance_check_in_grace(
  p_employee_id uuid,
  p_hours numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'غير مخول لتعديل مهلة تسجيل الحضور';
  END IF;
  IF p_hours IS NULL OR p_hours < 0 OR p_hours > 24 THEN
    RAISE EXCEPTION 'مهلة تسجيل الدخول يجب أن تكون بين صفر و24 ساعة';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RAISE EXCEPTION 'الموظف غير موجود';
  END IF;

  INSERT INTO public.employee_self_attendance_access(
    employee_id, check_in_grace_hours, updated_at, updated_by
  ) VALUES (p_employee_id, p_hours, now(), auth.uid())
  ON CONFLICT (employee_id) DO UPDATE
    SET check_in_grace_hours = EXCLUDED.check_in_grace_hours,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_self_attendance_check_in_grace(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_self_attendance_check_in_grace(uuid, numeric) TO authenticated;
CREATE OR REPLACE FUNCTION public.record_mobile_self_attendance(
  p_event_type text,
  p_latitude numeric,
  p_longitude numeric,
  p_device_info jsonb DEFAULT '{}'::jsonb,
  p_accuracy_meters numeric DEFAULT 1000,
  p_client_recorded_at timestamptz DEFAULT NULL,
  p_selfie_path text DEFAULT NULL,
  p_submitted_offline boolean DEFAULT false,
  p_client_event_id uuid DEFAULT NULL,
  p_face_score double precision DEFAULT NULL,
  p_liveness_verified boolean DEFAULT false
)
RETURNS TABLE(id uuid, employee_id uuid, recorded_at timestamptz, event_type text, distance_meters numeric, site_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_site_id uuid;
  v_site_name text;
  v_site_geofence_radius_meters numeric;
  v_distance numeric;
  v_now timestamptz := clock_timestamp();
  v_recorded_at timestamptz;
  v_id uuid;
  v_previous record;
  v_speed numeric;
  v_existing record;
  v_allow_all_sites boolean := false;
  v_has_site_assignments boolean := false;
  v_latest_check_in_time time;
  v_latest_check_out_time time;
  v_check_in_grace_hours numeric := 0;
BEGIN
  v_recorded_at := CASE
    WHEN coalesce(p_submitted_offline, false) AND p_client_recorded_at IS NOT NULL THEN p_client_recorded_at
    ELSE v_now
  END;
  IF p_event_type NOT IN ('check_in', 'check_out') THEN RAISE EXCEPTION 'نوع حركة الحضور غير صالح'; END IF;
  IF p_accuracy_meters IS NULL OR p_accuracy_meters < 0 OR p_accuracy_meters > 100 THEN
    RAISE EXCEPTION 'دقة GPS أضعف من 100 متر';
  END IF;
  IF p_face_score IS NULL OR p_face_score < 75 OR p_face_score > 100 OR NOT coalesce(p_liveness_verified, false) THEN
    RAISE EXCEPTION 'يجب اجتياز مطابقة الوجه والتحقق من الحيوية قبل تسجيل الحركة';
  END IF;
  IF p_selfie_path IS NULL OR length(trim(p_selfie_path)) = 0 THEN RAISE EXCEPTION 'صورة التحقق مطلوبة'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'إحداثيات GPS غير صالحة';
  END IF;

  SELECT e.* INTO v_employee
  FROM public.employees e
  JOIN auth.users u ON lower(u.email) = lower(e.email)
  WHERE u.id = auth.uid() AND e.status = 'active'
  LIMIT 1;
  IF v_employee.id IS NULL THEN RAISE EXCEPTION 'لا يوجد سجل موظف نشط مرتبط بهذا الحساب'; END IF;
  IF v_employee.face_descriptor IS NULL THEN RAISE EXCEPTION 'بصمة الوجه غير مسجلة لهذا الموظف'; END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT l.id, l.verify_time, l.self_event_type, l.distance_meters INTO v_existing
    FROM public.attendance_logs l WHERE l.client_event_id = p_client_event_id LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing.id, v_employee.id, v_existing.verify_time,
        coalesce(v_existing.self_event_type, p_event_type), v_existing.distance_meters, NULL::text;
      RETURN;
    END IF;
  END IF;

  SELECT coalesce(a.allow_all_sites, false), coalesce(a.check_in_grace_hours, 0)
    INTO v_allow_all_sites, v_check_in_grace_hours
  FROM public.employee_self_attendance_access a WHERE a.employee_id = v_employee.id;
  v_allow_all_sites := coalesce(v_allow_all_sites, false);
  SELECT EXISTS (SELECT 1 FROM public.employee_self_attendance_sites eas WHERE eas.employee_id = v_employee.id)
    INTO v_has_site_assignments;
  SELECT c.latest_check_in_time, c.latest_check_out_time
    INTO v_latest_check_in_time, v_latest_check_out_time
  FROM public.self_attendance_settings c WHERE c.id = true;

  IF p_event_type = 'check_in' AND v_latest_check_in_time IS NOT NULL
     AND (v_recorded_at AT TIME ZONE 'Asia/Baghdad') >
       ((v_recorded_at AT TIME ZONE 'Asia/Baghdad')::date + v_latest_check_in_time + v_check_in_grace_hours * interval '1 hour') THEN
    RAISE EXCEPTION 'انتهى وقت تسجيل الدخول المسموح، بما في ذلك مهلة الموظف البالغة % ساعة', v_check_in_grace_hours;
  END IF;
  IF p_event_type = 'check_out' AND v_latest_check_out_time IS NOT NULL
     AND (v_recorded_at AT TIME ZONE 'Asia/Baghdad')::time > v_latest_check_out_time THEN
    RAISE EXCEPTION 'انتهى الوقت المسموح لتسجيل الانصراف';
  END IF;

  SELECT s.id, s.name, s.geofence_radius_meters,
    6371000 * 2 * asin(sqrt(
      power(sin(radians(p_latitude - s.latitude) / 2), 2)
      + cos(radians(s.latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - s.longitude) / 2), 2)
    )) AS calculated_distance
  INTO v_site_id, v_site_name, v_site_geofence_radius_meters, v_distance
  FROM public.sites s
  WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND (
      v_allow_all_sites
      OR EXISTS (
        SELECT 1 FROM public.employee_self_attendance_sites eas
        WHERE eas.employee_id = v_employee.id AND eas.site_id = s.id
      )
      OR (NOT v_has_site_assignments AND s.id = v_employee.site_id)
    )
  ORDER BY (calculated_distance <= s.geofence_radius_meters) DESC, calculated_distance ASC
  LIMIT 1;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'لا يوجد موقع حضور مسموح لهذا الموظف'; END IF;
  IF v_distance > v_site_geofence_radius_meters THEN
    RAISE EXCEPTION 'خارج نطاق المواقع المسموحة؛ أقرب موقع هو % ويبعد % متراً', v_site_name, round(v_distance);
  END IF;

  SELECT l.latitude, l.longitude, l.verify_time INTO v_previous
  FROM public.attendance_logs l
  WHERE l.employee_id = v_employee.id AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
  ORDER BY l.verify_time DESC LIMIT 1;
  IF v_previous.verify_time IS NOT NULL THEN
    IF v_now <= v_previous.verify_time THEN RAISE EXCEPTION 'وقت الحركة غير صالح'; END IF;
    v_speed := (6371000 * 2 * asin(sqrt(
      power(sin(radians(p_latitude - v_previous.latitude) / 2), 2)
      + cos(radians(v_previous.latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - v_previous.longitude) / 2), 2)
    ))) / extract(epoch FROM (v_now - v_previous.verify_time)) * 3.6;
    IF v_speed > 200 THEN
      INSERT INTO public.attendance_suspicious_attempts(employee_id, client_recorded_at, latitude, longitude, selfie_path, reason)
      VALUES (v_employee.id, p_client_recorded_at, p_latitude, p_longitude, p_selfie_path,
        format('سرعة انتقال غير منطقية: %s كم/ساعة', round(v_speed, 1)));
      RETURN QUERY SELECT NULL::uuid, v_employee.id, v_now, p_event_type, round(v_distance, 2), v_site_name;
      RETURN;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_logs l
    WHERE l.employee_id = v_employee.id AND l.verify_time >= v_now - interval '5 minutes'
  ) THEN RAISE EXCEPTION 'يجب الانتظار 5 دقائق بين حركتي الحضور والانصراف'; END IF;
  IF p_event_type = 'check_out' AND NOT EXISTS (
    SELECT 1 FROM public.attendance_logs l
    WHERE l.employee_id = v_employee.id
      AND (l.verify_time AT TIME ZONE 'Asia/Baghdad')::date = (v_recorded_at AT TIME ZONE 'Asia/Baghdad')::date
      AND (l.self_event_type = 'check_in' OR l.verify_type = 0)
  ) THEN RAISE EXCEPTION 'لا يمكن تسجيل الانصراف قبل تسجيل الحضور'; END IF;

  INSERT INTO public.attendance_logs(
    employee_no, employee_id, site_id, device_id, upload_id, verify_time, verify_type,
    source, latitude, longitude, distance_meters, gps_accuracy_meters, device_info, self_event_type,
    selfie_path, client_recorded_at, submitted_offline, client_event_id, face_match_score, is_liveness_verified
  ) VALUES (
    v_employee.employee_no, v_employee.id, v_site_id, NULL, NULL, v_recorded_at,
    CASE WHEN p_event_type = 'check_in' THEN 0 ELSE 1 END,
    'mobile_self', p_latitude, p_longitude, round(v_distance, 2), p_accuracy_meters,
    p_device_info, p_event_type, p_selfie_path, p_client_recorded_at, p_submitted_offline,
    p_client_event_id, round(p_face_score::numeric, 2), coalesce(p_liveness_verified, false)
  ) RETURNING attendance_logs.id INTO v_id;
  RETURN QUERY SELECT v_id, v_employee.id, v_recorded_at, p_event_type, round(v_distance, 2), v_site_name;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb, numeric, timestamptz, text, boolean, uuid, double precision, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb, numeric, timestamptz, text, boolean, uuid, double precision, boolean) TO authenticated;

COMMIT;

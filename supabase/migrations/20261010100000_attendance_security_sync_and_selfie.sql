-- Security hardening and attendance sync/selfie foundations. Existing migrations stay immutable.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', f.nspname, f.proname, f.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon', f.nspname, f.proname, f.args);
  END LOOP;
END $$;

-- RLS policy helpers remain available to signed-in users; anonymous calls are removed.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_form_role(uuid, public.form_role) TO authenticated;

-- Explicit signatures document the intended access for the high-risk RPCs.
REVOKE ALL ON FUNCTION public.get_employee_custody(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_custody(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_mobile_self_attendance(text, numeric, numeric, jsonb) TO authenticated;
DO $$ BEGIN
  IF to_regprocedure('public.return_employee_custody(uuid,uuid,uuid,numeric,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.return_employee_custody(uuid,uuid,uuid,numeric,text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.return_employee_custody(uuid,uuid,uuid,numeric,text) TO authenticated;
  END IF;
END $$;

ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS gps_accuracy_meters numeric(8,2),
  ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_event_id uuid,
  ADD COLUMN IF NOT EXISTS is_suspicious boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_offline boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_client_event_id_idx
  ON public.attendance_logs(client_event_id) WHERE client_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attendance_suspicious_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  client_recorded_at timestamptz,
  latitude numeric(9,6) NOT NULL,
  longitude numeric(9,6) NOT NULL,
  selfie_path text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_suspicious_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_suspicious_attempts FROM PUBLIC, anon;
GRANT SELECT ON public.attendance_suspicious_attempts TO authenticated;
CREATE POLICY "admin hr read suspicious attendance" ON public.attendance_suspicious_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

DROP FUNCTION IF EXISTS public.record_mobile_self_attendance(text, numeric, numeric, jsonb);
CREATE OR REPLACE FUNCTION public.record_mobile_self_attendance(
  p_event_type text,
  p_latitude numeric,
  p_longitude numeric,
  p_device_info jsonb DEFAULT '{}'::jsonb,
  p_accuracy_meters numeric DEFAULT 1000,
  p_client_recorded_at timestamptz DEFAULT NULL,
  p_selfie_path text DEFAULT NULL,
  p_submitted_offline boolean DEFAULT false,
  p_client_event_id uuid DEFAULT NULL
)
RETURNS TABLE(id uuid, employee_id uuid, recorded_at timestamptz, event_type text, distance_meters numeric, site_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_site public.sites%ROWTYPE;
  v_distance numeric;
  v_now timestamptz := now();
  v_id uuid;
  v_previous record;
  v_speed numeric;
  v_existing record;
BEGIN
  IF p_event_type NOT IN ('check_in', 'check_out') THEN RAISE EXCEPTION 'نوع حركة الحضور غير صالح'; END IF;
  IF p_accuracy_meters IS NULL OR p_accuracy_meters < 0 OR p_accuracy_meters > 100 THEN
    RAISE EXCEPTION 'دقة GPS أضعف من 100 متر';
  END IF;
  IF p_selfie_path IS NULL OR length(trim(p_selfie_path)) = 0 THEN RAISE EXCEPTION 'صورة التحقق مطلوبة'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'إحداثيات GPS غير صالحة';
  END IF;
  SELECT e.* INTO v_employee FROM public.employees e JOIN auth.users u ON lower(u.email) = lower(e.email)
    WHERE u.id = auth.uid() AND e.status = 'active' LIMIT 1;
  IF v_employee.id IS NULL THEN RAISE EXCEPTION 'لا يوجد سجل موظف نشط مرتبط بهذا الحساب'; END IF;
  IF p_client_event_id IS NOT NULL THEN
    SELECT id, verify_time, self_event_type, distance_meters INTO v_existing
      FROM public.attendance_logs WHERE client_event_id = p_client_event_id LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing.id, v_employee.id, v_existing.verify_time,
        coalesce(v_existing.self_event_type, p_event_type), v_existing.distance_meters, NULL::text;
      RETURN;
    END IF;
  END IF;
  IF v_employee.site_id IS NULL THEN RAISE EXCEPTION 'لم يتم تخصيص موقع عمل لهذا الموظف'; END IF;
  SELECT s.* INTO v_site FROM public.sites s WHERE s.id = v_employee.site_id;
  IF v_site.id IS NULL OR v_site.latitude IS NULL OR v_site.longitude IS NULL THEN RAISE EXCEPTION 'إحداثيات موقع العمل غير مكتملة'; END IF;
  v_distance := 6371000 * 2 * asin(sqrt(power(sin(radians(p_latitude - v_site.latitude) / 2), 2)
    + cos(radians(v_site.latitude)) * cos(radians(p_latitude)) * power(sin(radians(p_longitude - v_site.longitude) / 2), 2)));
  IF v_distance > v_site.geofence_radius_meters THEN RAISE EXCEPTION 'خارج نطاق موقع العمل: تبعد % متراً', round(v_distance); END IF;
  SELECT latitude, longitude, verify_time INTO v_previous FROM public.attendance_logs
    WHERE employee_id = v_employee.id AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY verify_time DESC LIMIT 1;
  IF v_previous.verify_time IS NOT NULL THEN
    IF v_now <= v_previous.verify_time THEN RAISE EXCEPTION 'وقت الحركة غير صالح'; END IF;
    v_speed := (6371000 * 2 * asin(sqrt(power(sin(radians(p_latitude - v_previous.latitude) / 2), 2)
      + cos(radians(v_previous.latitude)) * cos(radians(p_latitude)) * power(sin(radians(p_longitude - v_previous.longitude) / 2), 2))))
      / extract(epoch FROM (v_now - v_previous.verify_time)) * 3.6;
    IF v_speed > 200 THEN
      INSERT INTO public.attendance_suspicious_attempts(employee_id, client_recorded_at, latitude, longitude, selfie_path, reason)
      VALUES(v_employee.id, p_client_recorded_at, p_latitude, p_longitude, p_selfie_path,
        format('سرعة انتقال غير منطقية: %s كم/ساعة', round(v_speed, 1)));
      RETURN QUERY SELECT NULL::uuid, v_employee.id, v_now, p_event_type, round(v_distance, 2), v_site.name;
      RETURN;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_logs l WHERE l.employee_id = v_employee.id AND l.verify_time >= v_now - interval '5 minutes') THEN
    RAISE EXCEPTION 'يجب الانتظار 5 دقائق بين حركتي الحضور والانصراف';
  END IF;
  IF p_event_type = 'check_out' AND NOT EXISTS (SELECT 1 FROM public.attendance_logs l WHERE l.employee_id = v_employee.id
    AND l.verify_time::date = (v_now AT TIME ZONE 'Asia/Baghdad')::date AND (l.self_event_type = 'check_in' OR l.verify_type = 0)) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل الانصراف قبل تسجيل الحضور';
  END IF;
  INSERT INTO public.attendance_logs(employee_no, employee_id, device_id, upload_id, verify_time, verify_type,
    source, latitude, longitude, distance_meters, gps_accuracy_meters, device_info, self_event_type,
    selfie_path, client_recorded_at, submitted_offline, client_event_id)
  VALUES(v_employee.employee_no, v_employee.id, NULL, NULL, v_now, CASE WHEN p_event_type='check_in' THEN 0 ELSE 1 END,
    'mobile_self', p_latitude, p_longitude, round(v_distance, 2), p_accuracy_meters, p_device_info, p_event_type,
    p_selfie_path, p_client_recorded_at, p_submitted_offline, p_client_event_id) RETURNING attendance_logs.id INTO v_id;
  RETURN QUERY SELECT v_id, v_employee.id, v_now, p_event_type, round(v_distance, 2), v_site.name;
END $$;
REVOKE ALL ON FUNCTION public.record_mobile_self_attendance(text,numeric,numeric,jsonb,numeric,timestamptz,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_mobile_self_attendance(text,numeric,numeric,jsonb,numeric,timestamptz,text,boolean,uuid) TO authenticated;

ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_source_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_source_check
  CHECK (source IN ('device', 'mobile_self', 'manual', 'zkteco_auto_agent', 'zk_agent'));

CREATE TABLE IF NOT EXISTS public.device_sync_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  key_prefix text NOT NULL CHECK (length(key_prefix) <= 12),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_sync_keys_active_device_idx ON public.device_sync_keys(device_id) WHERE revoked_at IS NULL;
ALTER TABLE public.device_sync_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_sync_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.device_sync_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.sync_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  record_count integer NOT NULL DEFAULT 0 CHECK (record_count BETWEEN 0 AND 5000),
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS sync_batches_device_time_idx ON public.sync_batches(device_id, received_at DESC);
ALTER TABLE public.sync_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sync_batches FROM PUBLIC, anon;
GRANT SELECT ON public.sync_batches TO authenticated;
GRANT ALL ON public.sync_batches TO service_role;
CREATE POLICY "admins read sync batches" ON public.sync_batches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_zk_agent_dedupe_idx
  ON public.attendance_logs(employee_no, verify_time, device_id) WHERE source = 'zk_agent';

CREATE TABLE IF NOT EXISTS public.employee_weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 240),
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from),
  UNIQUE(employee_id, weekday, effective_from)
);
ALTER TABLE public.employee_weekly_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_weekly_schedules TO authenticated;
CREATE POLICY "authenticated read weekly schedules" ON public.employee_weekly_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin hr manage weekly schedules" ON public.employee_weekly_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

CREATE TABLE IF NOT EXISTS public.attendance_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_push_subscriptions TO authenticated;
CREATE POLICY "employees manage own push subscription" ON public.attendance_push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.attendance_push_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reminder_date date NOT NULL,
  reminder_type text NOT NULL CHECK (reminder_type IN ('before_shift', 'missing_checkout')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, reminder_date, reminder_type)
);
ALTER TABLE public.attendance_push_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_push_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.attendance_push_reminders TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attendance-selfies', 'attendance-selfies', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "employees upload own attendance selfies" ON storage.objects;
CREATE POLICY "employees upload own attendance selfies" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-selfies' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "authenticated read attendance selfies" ON storage.objects;
CREATE POLICY "authenticated read attendance selfies" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-selfies' AND ((storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr')));

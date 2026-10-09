-- Cloud ingestion for ZKTeco LAN sync agents.
ALTER TABLE public.attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_source_check;
ALTER TABLE public.attendance_logs ADD CONSTRAINT attendance_logs_source_check
  CHECK (source IN ('device', 'mobile_self', 'manual', 'zkteco_auto_agent'));

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS auto_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_synced_logs_total bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.zkteco_sync_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  key_prefix text NOT NULL CHECK (length(key_prefix) <= 12),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS zkteco_sync_keys_active_device_idx
  ON public.zkteco_sync_keys(device_id) WHERE revoked_at IS NULL;
ALTER TABLE public.zkteco_sync_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zkteco_sync_keys FROM anon, authenticated;
GRANT ALL ON public.zkteco_sync_keys TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_logs_zkteco_auto_dedupe_idx
  ON public.attendance_logs(employee_no, verify_time, source)
  WHERE source = 'zkteco_auto_agent';

CREATE OR REPLACE FUNCTION public.ingest_zkteco_sync(p_device_id uuid, p_logs jsonb)
RETURNS TABLE(inserted_count bigint, unmatched_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inserted bigint := 0;
  v_unmatched bigint := 0;
BEGIN
  IF jsonb_typeof(p_logs) <> 'array' THEN
    RAISE EXCEPTION 'logs must be a JSON array';
  END IF;

  SELECT count(*) INTO v_unmatched
  FROM (SELECT DISTINCT value->>'employee_no' AS employee_no FROM jsonb_array_elements(p_logs)) incoming
  LEFT JOIN public.employees e ON e.employee_no = incoming.employee_no
  WHERE e.id IS NULL;

  INSERT INTO public.attendance_logs (
    employee_no, employee_id, device_id, upload_id, verify_time, verify_type, status, source, self_event_type
  )
  SELECT
    incoming_log.value->>'employee_no', e.id, p_device_id, NULL,
    (incoming_log.value->>'timestamp')::timestamptz,
    coalesce((incoming_log.value->>'verify_type')::integer, 0),
    coalesce((incoming_log.value->>'status')::integer, 0),
    'zkteco_auto_agent', incoming_log.value->>'punch_type'
  FROM jsonb_array_elements(p_logs) AS incoming_log(value)
  LEFT JOIN public.employees e ON e.employee_no = incoming_log.value->>'employee_no'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.attendance_logs existing
    WHERE existing.employee_no = incoming_log.value->>'employee_no'
      AND date_trunc('second', existing.verify_time) = date_trunc('second', (incoming_log.value->>'timestamp')::timestamptz)
  )
  ON CONFLICT (employee_no, verify_time, source) WHERE source = 'zkteco_auto_agent' DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.devices
  SET auto_last_sync_at = now(),
      last_sync_at = now(),
      auto_synced_logs_total = auto_synced_logs_total + v_inserted
  WHERE id = p_device_id;

  RETURN QUERY SELECT v_inserted, v_unmatched;
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_zkteco_sync(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_zkteco_sync(uuid, jsonb) TO service_role;
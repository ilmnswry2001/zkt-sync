BEGIN;

CREATE TABLE public.mobile_device_sync_keys (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
ALTER TABLE public.mobile_device_sync_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_device_sync_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mobile_device_sync_keys TO service_role;
CREATE INDEX mobile_device_sync_keys_operator_idx ON public.mobile_device_sync_keys(device_id, operator_id);

ALTER TABLE public.sync_batches
  ADD COLUMN mobile_operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN mobile_operator_name text,
  ADD COLUMN mobile_payload_hash text,
  ADD COLUMN mobile_pulled_at timestamptz,
  ADD COLUMN mobile_status text CHECK (mobile_status IN ('succeeded', 'failed'));
CREATE INDEX mobile_sync_batches_recent_idx ON public.sync_batches(received_at DESC) WHERE mobile_status IS NOT NULL;
CREATE INDEX mobile_sync_batches_operator_idx ON public.sync_batches(mobile_operator_id, received_at DESC) WHERE mobile_status IS NOT NULL;

CREATE FUNCTION public.ingest_mobile_device_sync(
  p_key_hash text, p_device_id uuid, p_serial text, p_batch_id uuid, p_payload_hash text, p_pulled_at timestamptz, p_logs jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  operator_id uuid;
  operator_name text;
  prior public.sync_batches%ROWTYPE;
  inserted integer;
  duplicates integer;
  unmatched integer;
  movement record;
  log_id uuid;
  outcome text;
BEGIN
  SELECT k.operator_id INTO operator_id
  FROM public.mobile_device_sync_keys k JOIN public.devices d ON d.id = k.device_id
  WHERE k.key_hash = p_key_hash AND k.device_id = p_device_id AND k.revoked_at IS NULL
    AND k.expires_at > now() AND d.serial_number = p_serial AND d.status = 'active'
    AND (public.is_admin(k.operator_id) OR public.has_role(k.operator_id, 'hr')
      OR public.has_role(k.operator_id, 'supervisor') OR public.has_role(k.operator_id, 'site_admin'))
  FOR SHARE OF k;
  IF operator_id IS NULL THEN RAISE EXCEPTION 'Invalid mobile credential' USING ERRCODE = '42501'; END IF;
  IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid mobile batch' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));
  SELECT * INTO prior FROM public.sync_batches WHERE id = p_batch_id FOR UPDATE;
  IF FOUND THEN
    IF prior.device_id IS DISTINCT FROM p_device_id OR prior.mobile_operator_id IS DISTINCT FROM operator_id
      OR prior.mobile_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'Batch identifier already in use' USING ERRCODE = '23505';
    END IF;
    IF prior.mobile_status = 'succeeded' THEN
      RETURN jsonb_build_object('inserted', prior.inserted_count, 'duplicates', prior.duplicate_count, 'unmatched', prior.unmatched_count);
    END IF;
  ELSE
    SELECT nullif(btrim(p.full_name), '') INTO operator_name FROM public.profiles p WHERE p.id = operator_id;
    INSERT INTO public.sync_batches(id, device_id, record_count, mobile_operator_id, mobile_operator_name, mobile_payload_hash, mobile_pulled_at, mobile_status)
    VALUES (p_batch_id, p_device_id, jsonb_array_length(p_logs), operator_id, coalesce(operator_name, 'حساب ميداني'), p_payload_hash, p_pulled_at, 'failed');
  END IF;

  BEGIN
    inserted := 0; duplicates := 0; unmatched := 0;
    FOR movement IN
      WITH input AS MATERIALIZED (
        SELECT item, ordinal, btrim(item->>'user_pin') AS pin
        FROM jsonb_array_elements(p_logs) WITH ORDINALITY AS logs(item, ordinal)
      ), matches AS MATERIALIZED (
        SELECT e.attendance_device_id AS pin, min(e.id::text)::uuid AS employee_id, min(e.employee_no) AS employee_no
        FROM public.employees e JOIN (SELECT DISTINCT pin FROM input) p ON p.pin = e.attendance_device_id
        GROUP BY e.attendance_device_id HAVING count(*) = 1
      )
      SELECT i.item, i.pin, m.employee_id, m.employee_no FROM input i LEFT JOIN matches m USING (pin)
      ORDER BY m.employee_no, (i.item->>'verify_time')::timestamptz, i.ordinal
    LOOP
      log_id := NULL;
      outcome := 'unmatched';
      IF movement.employee_id IS NOT NULL THEN
        INSERT INTO public.attendance_logs(employee_no, employee_id, device_id, verify_time, verify_type, status, external_log_id, source)
        VALUES(movement.employee_no, movement.employee_id, p_device_id, (movement.item->>'verify_time')::timestamptz,
          (movement.item->>'verify_type')::integer, (movement.item->>'status')::integer, (movement.item->>'external_id')::integer, 'zk_agent')
        ON CONFLICT DO NOTHING RETURNING id INTO log_id;
        outcome := CASE WHEN log_id IS NULL THEN 'duplicate' ELSE 'inserted' END;
      END IF;
      INSERT INTO public.device_sync_records(sync_batch_id, device_id, user_pin, employee_id, employee_no, attendance_log_id,
        verify_time, verify_type, status, external_log_id, processing_status, error_message)
      VALUES (p_batch_id, p_device_id, movement.pin, movement.employee_id, movement.employee_no, log_id,
        (movement.item->>'verify_time')::timestamptz, (movement.item->>'verify_type')::integer,
        (movement.item->>'status')::integer, (movement.item->>'external_id')::integer, outcome,
        CASE WHEN outcome = 'unmatched' THEN 'معرف بصمة غير مرتبط بموظف واحد' END);
      CASE outcome WHEN 'inserted' THEN inserted := inserted + 1;
        WHEN 'duplicate' THEN duplicates := duplicates + 1;
        ELSE unmatched := unmatched + 1; END CASE;
    END LOOP;
    UPDATE public.devices SET last_sync_at = now() WHERE id = p_device_id;
    UPDATE public.sync_batches SET inserted_count = inserted, duplicate_count = duplicates, unmatched_count = unmatched,
      error_count = 0, error_details = '[]'::jsonb, mobile_status = 'succeeded' WHERE id = p_batch_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.sync_batches SET error_count = jsonb_array_length(p_logs),
      error_details = jsonb_build_array(jsonb_build_object('code', SQLSTATE, 'message', SQLERRM)) WHERE id = p_batch_id;
    RETURN jsonb_build_object('failed', true);
  END;
  RETURN jsonb_build_object('inserted', inserted, 'duplicates', duplicates, 'unmatched', unmatched);
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_mobile_device_sync(text, uuid, text, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_mobile_device_sync(text, uuid, text, uuid, text, timestamptz, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

ALTER TABLE public.sync_batches ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.device_sync_records ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.device_sync_records ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.uploaded_files(id) ON DELETE CASCADE;
ALTER TABLE public.device_sync_records ADD COLUMN IF NOT EXISTS upload_row_index integer;
CREATE UNIQUE INDEX IF NOT EXISTS device_sync_records_upload_row_idx ON public.device_sync_records(upload_id, upload_row_index) WHERE upload_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS device_sync_records_attendance_backfill_idx ON public.device_sync_records(attendance_log_id) WHERE upload_row_index IS NULL AND attendance_log_id IS NOT NULL;
GRANT SELECT ON public.device_sync_records, public.sync_batches TO authenticated;
GRANT ALL ON public.device_sync_records, public.sync_batches TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_uploaded_attendance_chunk(p_upload_id uuid, p_offset integer, p_logs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f public.uploaded_files%ROWTYPE;
  r jsonb;
  emp_id uuid;
  emp_no text;
  pin text;
  log_id uuid;
  outcome text;
  ordinal integer := p_offset;
  n_inserted integer := 0;
  n_duplicate integer := 0;
  n_unmatched integer := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'data_entry')) THEN
    RAISE EXCEPTION 'غير مصرح بمعالجة ملفات الحضور' USING ERRCODE = '42501';
  END IF;
  IF p_offset < 0 OR jsonb_typeof(p_logs) <> 'array' OR jsonb_array_length(p_logs) > 1000 THEN
    RAISE EXCEPTION 'دفعة حركات غير صالحة';
  END IF;
  SELECT * INTO f FROM public.uploaded_files WHERE id = p_upload_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الملف غير موجود'; END IF;
  INSERT INTO public.sync_batches(id, device_id) VALUES (f.id, f.device_id) ON CONFLICT (id) DO NOTHING;
  FOR r IN SELECT value FROM jsonb_array_elements(p_logs) LOOP
    outcome := NULL;
    SELECT processing_status INTO outcome FROM public.device_sync_records WHERE upload_id = f.id AND upload_row_index = ordinal;
    IF outcome IS NULL THEN
      pin := btrim(coalesce(r->>'user_pin', ''));
      emp_id := NULL; emp_no := NULL; log_id := NULL;
      SELECT e.id, e.employee_no INTO emp_id, emp_no FROM public.employees e
        WHERE e.attendance_device_id = pin AND pin <> ''
        AND (SELECT count(*) FROM public.employees x WHERE x.attendance_device_id = pin) = 1;
      outcome := 'unmatched';
      IF emp_id IS NOT NULL THEN
        INSERT INTO public.attendance_logs(employee_no, employee_id, device_id, upload_id, verify_time, verify_type, status, external_log_id, source)
        VALUES(emp_no, emp_id, f.device_id, f.id, (r->>'verify_time')::timestamptz, (r->>'verify_type')::integer, (r->>'status')::integer, (r->>'external_id')::integer, 'device')
        ON CONFLICT DO NOTHING RETURNING id INTO log_id;
        IF log_id IS NOT NULL THEN outcome := 'inserted';
        ELSE
          outcome := 'duplicate';
          SELECT id INTO log_id FROM public.attendance_logs WHERE employee_no = emp_no AND verify_time = (r->>'verify_time')::timestamptz LIMIT 1;
        END IF;
      END IF;
      INSERT INTO public.device_sync_records(sync_batch_id, device_id, upload_id, upload_row_index, user_pin, employee_no, employee_id, attendance_log_id, verify_time, verify_type, status, external_log_id, processing_status, error_message)
      VALUES(f.id, f.device_id, f.id, ordinal, pin, emp_no, emp_id, log_id, (r->>'verify_time')::timestamptz, (r->>'verify_type')::integer, (r->>'status')::integer, (r->>'external_id')::integer, outcome,
        CASE WHEN outcome = 'unmatched' THEN 'معرف بصمة فارغ أو غير مرتبط بموظف واحد' ELSE NULL END);
    END IF;
    IF outcome = 'inserted' THEN n_inserted := n_inserted + 1;
    ELSIF outcome = 'duplicate' THEN n_duplicate := n_duplicate + 1;
    ELSE n_unmatched := n_unmatched + 1;
    END IF;
    ordinal := ordinal + 1;
  END LOOP;
  UPDATE public.sync_batches SET
    record_count = a.total, inserted_count = a.ins, duplicate_count = a.dup, unmatched_count = a.unm
  FROM (SELECT count(*) AS total, count(*) FILTER(WHERE processing_status = 'inserted') AS ins,
    count(*) FILTER(WHERE processing_status = 'duplicate') AS dup, count(*) FILTER(WHERE processing_status = 'unmatched') AS unm
    FROM public.device_sync_records WHERE sync_batch_id = f.id) a WHERE id = f.id;
  RETURN jsonb_build_object('inserted', n_inserted, 'duplicates', n_duplicate, 'unmatched', n_unmatched);
END;
$$;
REVOKE ALL ON FUNCTION public.ingest_uploaded_attendance_chunk(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_uploaded_attendance_chunk(uuid, integer, jsonb) TO authenticated;

INSERT INTO public.sync_batches(id, device_id, received_at)
SELECT DISTINCT f.id, f.device_id, coalesce(f.processed_at, f.created_at)
FROM public.uploaded_files f JOIN public.attendance_logs l ON l.upload_id = f.id
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.device_sync_records(sync_batch_id, device_id, upload_id, user_pin, employee_no, employee_id, attendance_log_id, verify_time, verify_type, status, external_log_id, processing_status, error_message)
SELECT l.upload_id, l.device_id, l.upload_id, coalesce(nullif(e.attendance_device_id, ''), l.employee_no), l.employee_no, l.employee_id, l.id, l.verify_time, l.verify_type, l.status, l.external_log_id,
 CASE WHEN l.employee_id IS NULL THEN 'unmatched' ELSE 'inserted' END, 'سجل تاريخي: معرف البصمة الأصلي قد لا يكون محفوظاً'
FROM public.attendance_logs l LEFT JOIN public.employees e ON e.id = l.employee_id
WHERE l.upload_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.device_sync_records d WHERE d.attendance_log_id = l.id)
ON CONFLICT DO NOTHING;
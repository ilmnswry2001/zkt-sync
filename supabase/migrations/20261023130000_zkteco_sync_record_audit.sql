CREATE TABLE IF NOT EXISTS public.device_sync_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_batch_id uuid NOT NULL REFERENCES public.sync_batches(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  user_pin text NOT NULL,
  employee_no text,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  attendance_log_id uuid REFERENCES public.attendance_logs(id) ON DELETE SET NULL,
  verify_time timestamptz NOT NULL,
  verify_type integer,
  status integer,
  external_log_id integer,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'inserted', 'duplicate', 'unmatched', 'error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_sync_records_batch_idx
  ON public.device_sync_records(sync_batch_id, created_at);
CREATE INDEX IF NOT EXISTS device_sync_records_device_time_idx
  ON public.device_sync_records(device_id, verify_time DESC);
CREATE INDEX IF NOT EXISTS device_sync_records_status_time_idx
  ON public.device_sync_records(processing_status, verify_time DESC);
CREATE INDEX IF NOT EXISTS device_sync_records_user_pin_idx
  ON public.device_sync_records(user_pin);

ALTER TABLE public.device_sync_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_sync_records FROM PUBLIC, anon;
GRANT SELECT ON public.device_sync_records TO authenticated;
GRANT ALL ON public.device_sync_records TO service_role;
CREATE POLICY "admins and hr read device sync records" ON public.device_sync_records
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'hr'));

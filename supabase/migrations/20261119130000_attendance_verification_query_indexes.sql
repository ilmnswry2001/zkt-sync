CREATE INDEX IF NOT EXISTS idx_device_sync_records_active_device_time
  ON public.device_sync_records (device_id, verify_time DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_sync_records_active_status_time
  ON public.device_sync_records (processing_status, verify_time DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_device_verify_time
  ON public.attendance_logs (device_id, verify_time DESC);

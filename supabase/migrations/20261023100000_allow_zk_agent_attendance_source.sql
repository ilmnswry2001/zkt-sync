-- Keep attendance sources accepted by the LAN ZKTeco sync endpoint.
ALTER TABLE public.attendance_logs
  DROP CONSTRAINT IF EXISTS attendance_logs_source_check;

ALTER TABLE public.attendance_logs
  ADD CONSTRAINT attendance_logs_source_check
  CHECK (source IN ('device', 'mobile_self', 'manual', 'zkteco_auto_agent', 'zk_agent'));

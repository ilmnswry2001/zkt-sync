create index if not exists device_sync_records_verify_time_active_idx
  on public.device_sync_records (verify_time desc, id desc)
  where archived_at is null;

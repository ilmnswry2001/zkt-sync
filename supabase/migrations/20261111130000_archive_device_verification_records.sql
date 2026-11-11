alter table public.device_sync_records
  add column archived_at timestamptz,
  add column archived_by uuid;

create function public.archive_device_verification_records(
  p_verify_type integer, p_status integer, p_device uuid, p_processing text,
  p_search text, p_external bigint, p_from timestamptz, p_until timestamptz
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  affected bigint;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'غير مصرح بحذف سجلات التحقق' using errcode = '42501';
  end if;
  if p_verify_type is null and p_status is null then
    raise exception 'حدد نوع التحقق أو حالة الجهاز';
  end if;
  update public.device_sync_records set archived_at = now(), archived_by = auth.uid()
  where archived_at is null
    and (p_verify_type is null or verify_type = p_verify_type)
    and (p_status is null or status = p_status)
    and (p_device is null or device_id = p_device)
    and (p_processing = 'all' or processing_status = p_processing or
         (p_processing = 'unprocessed' and processing_status in ('pending','error','unmatched')))
    and (p_search = '' or user_pin ilike '%' || p_search || '%' or employee_no ilike '%' || p_search || '%')
    and (p_external is null or external_log_id = p_external)
    and (p_from is null or verify_time >= p_from)
    and (p_until is null or verify_time < p_until);
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.archive_device_verification_records(integer,integer,uuid,text,text,bigint,timestamptz,timestamptz) from public, anon;
grant execute on function public.archive_device_verification_records(integer,integer,uuid,text,text,bigint,timestamptz,timestamptz) to authenticated;

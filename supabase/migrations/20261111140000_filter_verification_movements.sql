create function public.filtered_verification_records(f jsonb)
returns setof public.device_sync_records
language sql stable security invoker set search_path = '' as $$
  select r.* from public.device_sync_records r
  where r.archived_at is null
    and (not (f ? 'verify') or r.verify_type is not distinct from (f->>'verify')::integer)
    and (not (f ? 'status') or r.status is not distinct from (f->>'status')::integer)
    and (f->>'device' is null or r.device_id = (f->>'device')::uuid)
    and (f->>'processing' is null or r.processing_status = f->>'processing'
      or (f->>'processing' = 'unprocessed' and r.processing_status in ('pending','error','unmatched')))
    and (f->>'external' is null or r.external_log_id = (f->>'external')::integer)
    and (f->>'search' is null or r.user_pin ilike '%' || (f->>'search') || '%' or r.employee_no ilike '%' || (f->>'search') || '%')
    and (f->>'from' is null or r.verify_time >= (f->>'from')::timestamptz)
    and (f->>'until' is null or r.verify_time < (f->>'until')::timestamptz)
    and (f->>'batch' is null or r.sync_batch_id::text ilike (f->>'batch') || '%')
    and (f->>'error' is null or r.error_message ilike '%' || (f->>'error') || '%')
    and (f->>'employee' is null or exists (select from public.employees e where e.id = r.employee_id and e.full_name ilike '%' || (f->>'employee') || '%'))
    and (f->>'file' is null or exists (select from public.uploaded_files u where u.id = r.upload_id and u.file_name ilike '%' || (f->>'file') || '%'))
    and ((f->>'receivedFrom' is null and f->>'receivedUntil' is null) or exists (
      select from public.sync_batches b where b.id = r.sync_batch_id
        and (f->>'receivedFrom' is null or b.received_at >= (f->>'receivedFrom')::timestamptz)
        and (f->>'receivedUntil' is null or b.received_at < (f->>'receivedUntil')::timestamptz)
    ))
$$;

create function public.archive_filtered_verification_records(f jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare affected bigint;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'غير مصرح بحذف سجلات التحقق' using errcode = '42501';
  end if;
  if not coalesce(f ?| array['verify','status'],false) or jsonb_typeof(f) <> 'object' then
    raise exception 'حدد نوع التحقق أو حالة الجهاز';
  end if;
  update public.device_sync_records set archived_at = now(), archived_by = auth.uid()
    where archived_at is null and id in (select id from public.filtered_verification_records(f));
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.filtered_verification_records(jsonb), public.archive_filtered_verification_records(jsonb) from public, anon;
grant execute on function public.filtered_verification_records(jsonb), public.archive_filtered_verification_records(jsonb) to authenticated;

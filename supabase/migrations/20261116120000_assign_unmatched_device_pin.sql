create function public.assign_unmatched_device_pin(p_record_id uuid, p_employee_id uuid, p_previous_pin text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  pin text;
  emp public.employees%rowtype;
  affected integer;
begin
  if auth.uid() is null or not coalesce(public.is_admin(auth.uid()) or public.has_role(auth.uid(),'hr'),false) then
    raise exception 'التنسيب متاح لمدير النظام والموارد البشرية فقط' using errcode='42501';
  end if;
  select btrim(user_pin) into pin from public.device_sync_records
    where id=p_record_id and archived_at is null and processing_status='unmatched';
  if coalesce(pin,'') in ('','0') then raise exception 'الحركة غير متاحة للتنسيب'; end if;
  perform pg_advisory_xact_lock(hashtextextended(pin,0));
  perform 1 from public.device_sync_records where id=p_record_id and archived_at is null
    and processing_status='unmatched' and btrim(user_pin)=pin for update;
  if not found then raise exception 'تمت معالجة الحركة، حدّث السجل'; end if;
  select * into emp from public.employees where id=p_employee_id for update;
  if not found or nullif(btrim(emp.employee_no),'') is null then raise exception 'تعذر تحديد الموظف ورقمه الوظيفي'; end if;
  if emp.attendance_device_id is distinct from p_previous_pin then raise exception 'تغير رقم بصمة الموظف، أعد اختياره'; end if;
  if exists(select from public.employees where attendance_device_id=pin and id<>emp.id) then
    raise exception 'رقم البصمة منسّب إلى موظف آخر';
  end if;
  update public.employees set attendance_device_id=pin where id=emp.id;

  with pending as materialized (
    select r.* from public.device_sync_records r where btrim(r.user_pin)=pin
      and r.archived_at is null and r.processing_status='unmatched' order by r.id for update
  ), first_punch as (
    select distinct on (verify_time) * from pending order by verify_time,created_at,id
  ), inserted as (
    insert into public.attendance_logs(employee_no,employee_id,device_id,upload_id,verify_time,verify_type,status,external_log_id,source)
    select emp.employee_no,emp.id,device_id,upload_id,verify_time,verify_type,status,external_log_id,
      case when upload_id is null then 'zk_agent' else 'device' end from first_punch
    on conflict do nothing returning id,verify_time
  ), updated as (
    update public.device_sync_records r set employee_id=emp.id,employee_no=emp.employee_no,error_message=null,
      attendance_log_id=case when p.id=f.id then i.id else null end,
      processing_status=case when p.id=f.id and i.id is not null then 'inserted' else 'duplicate' end
    from pending p join first_punch f using(verify_time) left join inserted i using(verify_time)
    where r.id=p.id returning r.sync_batch_id,r.device_id,r.upload_id,r.processing_status
  ), batches as (
    update public.sync_batches b set inserted_count=b.inserted_count+n.ins,duplicate_count=b.duplicate_count+n.dup,
      unmatched_count=greatest(0,b.unmatched_count-n.ins-n.dup)
    from (select sync_batch_id,count(*) filter(where processing_status='inserted') as ins,
      count(*) filter(where processing_status='duplicate') as dup from updated group by sync_batch_id) n
    where b.id=n.sync_batch_id
  ), devices as (
    update public.devices d set auto_synced_logs_total=d.auto_synced_logs_total+n.ins
    from (select device_id,count(*) as ins from updated where processing_status='inserted' and upload_id is null group by device_id) n
    where d.id=n.device_id
  ) select count(*) into affected from updated;
  return affected;
end $$;
revoke all on function public.assign_unmatched_device_pin(uuid,uuid,text) from public,anon;
grant execute on function public.assign_unmatched_device_pin(uuid,uuid,text) to authenticated;

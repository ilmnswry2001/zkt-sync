create function public.set_employee_profile_workshop(p_employee uuid, p_workshop uuid, p_role text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce((
    public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'hr') or
    public.has_role(auth.uid(),'supervisor')
  ), false) then raise exception 'غير مصرح بتعديل التنسيب' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));
  if p_workshop is not null then
    perform 1 from public.daily_workshops where id = p_workshop and is_active for share;
    if not found then raise exception 'الورشة غير نشطة أو غير متاحة'; end if;
  end if;
  update public.daily_workshop_members set is_active = false
    where employee_id = p_employee and is_active and workshop_id is distinct from p_workshop;
  if p_workshop is not null then
    insert into public.daily_workshop_members(workshop_id,employee_id,role_label,is_active)
      values(p_workshop,p_employee,nullif(trim(p_role),''),true)
    on conflict(workshop_id,employee_id) do update
      set role_label = excluded.role_label, is_active = true;
  end if;
end;
$$;
revoke all on function public.set_employee_profile_workshop(uuid,uuid,text) from public, anon;
grant execute on function public.set_employee_profile_workshop(uuid,uuid,text) to authenticated;

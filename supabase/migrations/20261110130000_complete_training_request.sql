create or replace function public.complete_training_request(p_request uuid, p_number text, p_issue date, p_expiry date, p_renewal date, p_attachment text)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.training_requests;
begin
  if p_issue is null or p_expiry is null or p_expiry < p_issue or
    (p_attachment is not null and p_attachment !~* '^https?://') then
    raise exception 'تحقق من تاريخ الإصدار والانتهاء ورابط المرفق';
  end if;
  update public.training_requests set status = 'completed'
  where id = p_request and status = 'approved' returning * into strict r;
  insert into public.employee_certifications(employee_id,course_type_id,request_id,certificate_no,issue_date,expiry_date,renewal_date,attachment_url,created_by,status)
  values (r.employee_id,r.course_type_id,r.id,p_number,p_issue,p_expiry,p_renewal,p_attachment,auth.uid(),
    case when p_expiry < current_date then 'expired' when p_expiry <= current_date + 30 then 'expiring_soon' else 'active' end);
end $$;
revoke all on function public.complete_training_request(uuid,text,date,date,date,text) from public,anon;
grant execute on function public.complete_training_request(uuid,text,date,date,date,text) to authenticated;

-- Resolve the approval recipient from the selected department on the server.
create function public.assign_training_approver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.employees where id = new.employee_id and status = 'active')
    or not exists (select 1 from public.training_course_types where id = new.course_type_id and is_active) then
    raise exception 'يجب اختيار موظف ودورة نشطين';
  end if;
  select p.employee_id into new.target_approver_id
    from public.departments d join public.profiles p on p.id = d.manager_user_id
    where d.id = new.target_department_id;
  if new.target_approver_id is null then raise exception 'مسؤول القسم غير مرتبط بملف موظف'; end if;
  return new;
end $$;
revoke all on function public.assign_training_approver() from public,anon,authenticated;
create trigger assign_training_request_approver before insert or update of target_department_id
on public.training_requests for each row execute function public.assign_training_approver();

alter policy "digital submissions employee insert own" on public.digital_form_submissions
with check (
  employee_id = public.get_employee_id_for_user(auth.uid()) and status = 'pending_review'
  and exists (select 1 from public.digital_form_templates t where t.id = template_id and t.is_active)
);

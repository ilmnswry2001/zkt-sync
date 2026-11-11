create table public.employee_report_history (
  id bigint generated always as identity primary key,
  source text not null,
  subject_id uuid not null,
  subject_name text not null,
  effective_date date,
  actor_id uuid,
  actor_name text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index on public.employee_report_history (subject_id, created_at desc);
create index on public.employee_report_history (effective_date);
alter table public.employee_report_history enable row level security;
revoke all on public.employee_report_history from public, anon, authenticated;
grant select on public.employee_report_history to authenticated;
create policy read_visible_subject_history on public.employee_report_history for select to authenticated using (
  case source
    when 'vehicle_monthly_operations' then exists (select from public.vehicles where id = subject_id)
    when 'machinery_monthly_operations' then exists (select from public.machinery where id = subject_id)
    else exists (select from public.employees where id = subject_id)
  end
);

create function public.capture_employee_report_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb;
  subject uuid;
  label text;
  day date;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then return null; end if;
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  case tg_table_name
    when 'employees' then
      subject := (row_data->>'id')::uuid;
      label := row_data->>'full_name';
    when 'attendance_day_status' then
      subject := (row_data->>'employee_id')::uuid;
      day := (row_data->>'work_date')::date;
      select full_name into label from public.employees where id = subject;
    when 'vehicle_monthly_operations' then
      subject := (row_data->>'vehicle_id')::uuid;
      day := (row_data->>'month')::date;
      select vehicle_no into label from public.vehicles where id = subject;
    when 'machinery_monthly_operations' then
      subject := (row_data->>'machinery_id')::uuid;
      day := (row_data->>'month')::date;
      select name into label from public.machinery where id = subject;
  end case;
  insert into public.employee_report_history(source,subject_id,subject_name,effective_date,actor_id,actor_name,action)
  values(tg_table_name,subject,coalesce(label,subject::text),day,auth.uid(),coalesce(nullif(auth.jwt()->>'email',''),auth.uid()::text,'النظام'),tg_op);
  return null;
end;
$$;
revoke all on function public.capture_employee_report_history() from public, anon, authenticated;
create trigger employee_profile_history after update on public.employees for each row execute function public.capture_employee_report_history();
create trigger report_history after insert or update or delete on public.attendance_day_status for each row execute function public.capture_employee_report_history();
create trigger report_history after insert or update or delete on public.vehicle_monthly_operations for each row execute function public.capture_employee_report_history();
create trigger report_history after insert or update or delete on public.machinery_monthly_operations for each row execute function public.capture_employee_report_history();
